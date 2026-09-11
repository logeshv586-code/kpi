from __future__ import annotations

import calendar
import threading
from collections import defaultdict
from datetime import date, datetime, timedelta
from time import sleep
from zoneinfo import ZoneInfo

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..auth import get_current_user, require_roles
from ..database import SessionLocal, get_db, settings
from ..mail import send_email
from ..models import (
    AssignmentStatus,
    CycleStatus,
    Department,
    Designation,
    KpiAssignment,
    KpiCycle,
    KpiTemplate,
    Role,
    SystemSetting,
    TemplateStatus,
    User,
    Kra,
)
from ..schemas import CycleIn, ReviewIn
from ..services import audit, calculate_item_score
from ..services import audit, calculate_item_score, item_config, threshold_status
from . import dashboard_router, kpi_router
from . import manager_review_lock_override as review_lock
from . import relationship_review_override as review


REVIEW_TYPES = {"monthly", "quarterly", "half_yearly", "annual"}
REVIEW_ORDER = {"monthly": 0, "quarterly": 1, "half_yearly": 2, "annual": 3}
review_period_roles = require_roles(Role.superadmin, Role.hr)
_scheduler_started = False


def _remove_route(router, path: str, methods: set[str]):
    router.routes[:] = [
        route
        for route in router.routes
        if not (
            getattr(route, "path", None) == path
            and bool(methods.intersection(set(getattr(route, "methods", set()) or set())))
        )
    ]


def _financial_year(period_date: date) -> str:
    start_year = period_date.year if period_date.month >= 4 else period_date.year - 1
    return f"FY {start_year}-{str(start_year + 1)[-2:]}"


def _month_end(day: date) -> date:
    return day.replace(day=calendar.monthrange(day.year, day.month)[1])


def _review_definition(review_type: str, month: date) -> tuple[date, date, str, str]:
    month = month.replace(day=1)
    review_type = review_type.lower()
    fy = _financial_year(month)

    if review_type == "monthly":
        return month, _month_end(month), month.strftime("%B %Y"), fy

    if review_type == "quarterly":
        quarter_map = {
            6: (date(month.year, 4, 1), date(month.year, 6, 30), "Q1"),
            9: (date(month.year, 7, 1), date(month.year, 9, 30), "Q2"),
            12: (date(month.year, 10, 1), date(month.year, 12, 31), "Q3"),
            3: (date(month.year, 1, 1), date(month.year, 3, 31), "Q4"),
        }
        if month.month not in quarter_map:
            raise HTTPException(400, "Quarterly reviews are available in June, September, December and March")
        start, end, label = quarter_map[month.month]
        return start, end, f"{label} · {fy}", fy

    if review_type == "half_yearly":
        if month.month == 9:
            return date(month.year, 4, 1), date(month.year, 9, 30), f"H1 · {fy}", fy
        if month.month == 3:
            return date(month.year - 1, 10, 1), date(month.year, 3, 31), f"H2 · {fy}", fy
        raise HTTPException(400, "Half-yearly reviews are available in September and March")

    if review_type == "annual":
        if month.month != 3:
            raise HTTPException(400, "Annual review is available in March")
        return date(month.year - 1, 4, 1), date(month.year, 3, 31), f"Annual · {fy}", fy

    raise HTTPException(400, "Invalid review type")


def _period_specs(month: date) -> list[dict]:
    month = month.replace(day=1)
    types = ["monthly"]
    if month.month in {6, 9, 12, 3}:
        types.append("quarterly")
    if month.month in {9, 3}:
        types.append("half_yearly")
    if month.month == 3:
        types.append("annual")

    specs = []
    for review_type in types:
        start, end, label, fy = _review_definition(review_type, month)
        display_type = {
            "monthly": "Monthly",
            "quarterly": "Quarterly",
            "half_yearly": "Half-Yearly",
            "annual": "Annual",
        }[review_type]
        name = f"{label} {display_type} Review" if review_type != "monthly" else f"{label} Monthly Review"
        specs.append(
            {
                "name": name,
                "month": month,
                "start_date": start,
                "end_date": end,
                "review_type": review_type,
                "financial_year": fy,
                "period_label": label,
            }
        )
    return specs


def _descendant_ids(db: Session, manager_id: int) -> set[int]:
    rows = db.execute(select(User.id, User.manager_id).where(User.active.is_(True))).all()
    children: dict[int, list[int]] = defaultdict(list)
    for user_id, reports_to in rows:
        if reports_to is not None:
            children[int(reports_to)].append(int(user_id))
    found: set[int] = set()
    queue = list(children.get(manager_id, []))
    while queue:
        user_id = queue.pop(0)
        if user_id in found or user_id == manager_id:
            continue
        found.add(user_id)
        queue.extend(children.get(user_id, []))
    return found


def _is_descendant(viewer: User, target: User | None) -> bool:
    if not target:
        return False
    current = target
    seen: set[int] = set()
    while current and current.id not in seen:
        seen.add(current.id)
        if current.id == viewer.id:
            return True
        if current.manager_id == viewer.id:
            return True
        current = current.manager if current.manager_id else None
    return False


def _enhanced_can_view(user: User, assignment: KpiAssignment) -> bool:
    if user.role in {Role.superadmin, Role.hr}:
        return True
    return _is_descendant(user, assignment.user)


# Preserve direct-report authority: only visibility becomes recursive.
review._can_view = _enhanced_can_view


def _dashboard_visible_assignments(db: Session, user: User):
    rows = db.scalars(
        select(KpiAssignment)
        .join(KpiTemplate, KpiAssignment.template_id == KpiTemplate.id)
        .where(KpiTemplate.status != TemplateStatus.draft)
        .options(
            joinedload(KpiAssignment.user)
            .joinedload(User.designation)
            .joinedload(Designation.department)
            .joinedload(Department.division),
            joinedload(KpiAssignment.user).joinedload(User.manager),
            joinedload(KpiAssignment.cycle),
        )
    ).all()
    if user.role in {Role.superadmin, Role.hr}:
        return rows
    visible_ids = _descendant_ids(db, user.id) | {user.id}
    return [assignment for assignment in rows if assignment.user_id in visible_ids]


def _dashboard_can_view_user(viewer: User, target: User) -> bool:
    if viewer.role in {Role.superadmin, Role.hr}:
        return True
    return _is_descendant(viewer, target)


dashboard_router._visible_assignments = _dashboard_visible_assignments
dashboard_router._can_view_user = _dashboard_can_view_user


def _official_score(assignment: KpiAssignment) -> int | None:
    if assignment.final_score is not None:
        return int(round(float(assignment.final_score)))
    if assignment.status == AssignmentStatus.manager_reviewed and assignment.manager_score is not None:
        return int(round(float(assignment.manager_score)))
    return None


def _subordinate_cap_info(db: Session, assignment: KpiAssignment) -> dict:
    direct_reports = db.scalars(
        select(User).where(User.manager_id == assignment.user_id, User.active.is_(True)).order_by(User.name)
    ).all()
    if not direct_reports:
        return {"applies": False, "cap": None, "pending": 0, "direct_reports": 0, "scores": []}

    scores = []
    pending = []
    for subordinate in direct_reports:
        subordinate_assignment = db.scalar(
            select(KpiAssignment).where(
                KpiAssignment.cycle_id == assignment.cycle_id,
                KpiAssignment.user_id == subordinate.id,
            )
        )
        score = _official_score(subordinate_assignment) if subordinate_assignment else None
        if score is None:
            pending.append(subordinate.name)
        else:
            scores.append({"user_id": subordinate.id, "employee": subordinate.name, "score": score})

    cap = int(round(sum(row["score"] for row in scores) / len(scores))) if scores and not pending else None
    return {
        "applies": True,
        "cap": cap,
        "pending": len(pending),
        "pending_names": pending,
        "direct_reports": len(direct_reports),
        "scores": scores,
    }


_base_get_assignment = review.relationship_get_assignment


def _enhanced_get_assignment(assignment_id: int, db: Session, user: User):
    data = _base_get_assignment(assignment_id, db, user)
    assignment = review._load_assignment(db, assignment_id)
    if not assignment:
        return data
    cap_info = _subordinate_cap_info(db, assignment)
    data["review_type"] = getattr(assignment.cycle, "review_type", "monthly") or "monthly"
    data["financial_year"] = getattr(assignment.cycle, "financial_year", None) or _financial_year(assignment.cycle.month)
    data["period_label"] = getattr(assignment.cycle, "period_label", None) or assignment.cycle.name
    data["subordinate_score_cap"] = cap_info["cap"]
    data["subordinate_pending_count"] = cap_info["pending"]
    data["subordinate_score_cap_applies"] = cap_info["applies"]
    data["subordinate_score_details"] = cap_info["scores"]
    for key in ("calculated_score", "manager_score", "final_score", "official_score"):
        if data.get(key) is not None:
            data[key] = int(round(float(data[key])))
    return data


# Manager-lock GET calls this function dynamically, so replacing it enriches
# both direct-review and senior read-only views without weakening edit rules.
review.relationship_get_assignment = _enhanced_get_assignment


_remove_route(kpi_router.router, "/api/kpi/my", {"GET"})


@kpi_router.router.get("/my")
def enhanced_my_assignments(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role in {Role.superadmin, Role.hr}:
        visible_ids = set(db.scalars(select(User.id).where(User.active.is_(True))).all())
        review._ensure_assignments_for_scope(db, user)
    else:
        descendant_ids = _descendant_ids(db, user.id)
        visible_ids = descendant_ids | {user.id}
        # Reuse the existing safe assignment routine for every visible person so
        # senior managers see newly-published KPI periods throughout the tree.
        visible_users = db.scalars(select(User).where(User.id.in_(visible_ids))).all()
        for visible_user in visible_users:
            review._ensure_assignments_for_scope(db, visible_user)

    stmt = (
        select(KpiAssignment)
        .where(KpiAssignment.user_id.in_(visible_ids))
        .options(
            joinedload(KpiAssignment.user).joinedload(User.manager),
            joinedload(KpiAssignment.user).joinedload(User.designation).joinedload(Designation.department).joinedload(Department.division),
            joinedload(KpiAssignment.cycle),
            joinedload(KpiAssignment.template).joinedload(KpiTemplate.designation),
            joinedload(KpiAssignment.template).joinedload(KpiTemplate.kras),
            joinedload(KpiAssignment.template).joinedload(KpiTemplate.kras).joinedload(Kra.items),
            joinedload(KpiAssignment.responses),
        )
        .order_by(KpiAssignment.id.desc())
    )
    rows = [a for a in db.scalars(stmt).unique().all() if a.template.status.value == "active"]

    return [
        {
            "id": a.id,
            "employee_id": a.user_id,
            "employee_no": a.user.employee_no if a.user and a.user.employee_no else f"EMP-{a.user.id:04d}",
            "employee": a.user.name if a.user else None,
            "division": a.user.designation.department.division.name if a.user and a.user.designation and a.user.designation.department else None,
            "department": a.user.designation.department.name if a.user and a.user.designation else None,
            "designation": a.user.designation.name if a.user and a.user.designation else None,
            "manager_id": a.user.manager_id if a.user else None,
            "manager_name": a.user.manager.name if a.user and a.user.manager else None,
            "cycle": a.cycle.name,
            "cycle_id": a.cycle_id,
            "month": a.cycle.month.isoformat(),
            "review_type": getattr(a.cycle, "review_type", "monthly") or "monthly",
            "financial_year": getattr(a.cycle, "financial_year", None) or _financial_year(a.cycle.month),
            "period_label": getattr(a.cycle, "period_label", None) or a.cycle.name,
            "cycle_status": a.cycle.status.value,
            "is_locked": bool(a.cycle.is_locked),
            "status": a.status.value,
            "calculated_score": int(round(float(a.calculated_score or 0))),
            "manager_score": None if a.manager_score is None else int(round(float(a.manager_score))),
            "final_score": None if a.final_score is None else int(round(float(a.final_score))),
            "official_score": _official_score(a),
            "can_review": review._can_review(user, a),
            "progress_percent": review._progress(a),
            "template": kpi_router.template_json(a.template),
        }
        for a in rows
    ]


# Replace the final manager-review route so the reviewed manager's score cannot
# exceed the summarized official score of their own direct reports.
_remove_route(kpi_router.router, "/api/kpi/assignments/{assignment_id}/manager-review", {"POST"})


@kpi_router.router.post("/assignments/{assignment_id}/manager-review")
def capped_manager_review(
    assignment_id: int,
    payload: ReviewIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    assignment = review._load_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    if payload.decision != "rejected" and review_lock._review_already_submitted(assignment, user):
        review_lock._raise_review_locked()

    if payload.decision != "rejected":
        cap_info = _subordinate_cap_info(db, assignment)
        if cap_info["applies"]:
            if cap_info["pending"]:
                names = ", ".join(cap_info.get("pending_names", [])[:5])
                raise HTTPException(
                    409,
                    f"Subordinate KPI reviews must be completed first. Pending: {names or cap_info['pending']}.",
                )
            proposed = int(
                round(
                    min(
                        100.0,
                        sum(
                            calculate_item_score(response.item, response, is_manager=True)
                            for response in assignment.responses
                        ),
                    )
                )
            )
            if cap_info["cap"] is not None and proposed > int(cap_info["cap"]):
                raise HTTPException(
                    400,
                    f"Manager Score cannot exceed summarized subordinate score {cap_info['cap']}/100. Current Manager Score is {proposed}/100.",
                )

    return review._complete_manager_review(assignment, payload, db, user)


# Review-period API: keep the existing kpi_cycles table and extend it so old
# monthly history remains intact.
_remove_route(kpi_router.router, "/api/kpi/cycles", {"GET", "POST"})
_remove_route(kpi_router.router, "/api/kpi/cycles/auto-generate", {"POST"})


@kpi_router.router.get("/cycles")
def enhanced_cycles(db: Session = Depends(get_db), _=Depends(get_current_user)):
    rows = db.scalars(select(KpiCycle).order_by(KpiCycle.month.desc(), KpiCycle.id.desc())).all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "month": c.month,
            "start_date": c.start_date,
            "end_date": c.end_date,
            "review_type": getattr(c, "review_type", "monthly") or "monthly",
            "financial_year": getattr(c, "financial_year", None) or _financial_year(c.month),
            "period_label": getattr(c, "period_label", None) or c.name,
            "status": c.status.value,
            "is_locked": c.is_locked,
        }
        for c in rows
    ]


@kpi_router.router.post("/cycles")
def enhanced_create_cycle(payload: CycleIn, db: Session = Depends(get_db), user=Depends(review_period_roles)):
    try:
        status = CycleStatus(payload.status)
    except ValueError:
        raise HTTPException(400, "Invalid cycle status")
    if payload.end_date < payload.start_date:
        raise HTTPException(400, "End date must be on or after start date")
    review_type = payload.review_type or "monthly"
    expected_start, expected_end, default_label, default_fy = _review_definition(review_type, payload.month)
    data = payload.model_dump(exclude={"status"})
    data["review_type"] = review_type
    data["financial_year"] = payload.financial_year or default_fy
    data["period_label"] = payload.period_label or default_label
    # For monthly periods retain custom dates; for FY aggregate periods the
    # financial-year boundaries are authoritative.
    if review_type != "monthly":
        data["start_date"] = expected_start
        data["end_date"] = expected_end
    cycle = KpiCycle(**data, status=status)
    db.add(cycle)
    db.flush()
    audit(db, user.id, "create", "kpi_cycle", cycle.id, {"review_type": review_type, "financial_year": data["financial_year"]})
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A KPI review period with this name already exists")
    return {"id": cycle.id, "name": cycle.name, "review_type": cycle.review_type, "status": cycle.status.value}


@kpi_router.router.post("/cycles/auto-generate")
def enhanced_auto_generate_cycle(db: Session = Depends(get_db), actor=Depends(review_period_roles)):
    current_month = date.today().replace(day=1)
    created = []
    existing = []
    for spec in _period_specs(current_month):
        cycle = db.scalar(
            select(KpiCycle).where(
                KpiCycle.month == current_month,
                KpiCycle.review_type == spec["review_type"],
            )
        )
        if cycle:
            existing.append(cycle.name)
            continue
        cycle = KpiCycle(**spec, status=CycleStatus.running)
        db.add(cycle)
        db.flush()
        audit(db, actor.id, "auto_generate", "kpi_cycle", cycle.id, {"review_type": spec["review_type"]})
        created.append(cycle.name)
    db.commit()
    review._ensure_assignments_for_scope(db, actor)
    return {"created": created, "existing": existing, "review_month": current_month.isoformat()}


_remove_route(dashboard_router.router, "/api/dashboard/history/{user_id}", {"GET"})


@dashboard_router.router.get("/history/{user_id}")
def enhanced_history(user_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    target = db.scalar(select(User).where(User.id == user_id).options(joinedload(User.manager)))
    if not target:
        raise HTTPException(404, "Employee not found")
    if not _dashboard_can_view_user(user, target):
        raise HTTPException(403, "This employee is outside your reporting hierarchy")
    rows = db.scalars(
        select(KpiAssignment)
        .join(KpiTemplate, KpiAssignment.template_id == KpiTemplate.id)
        .where(
            KpiAssignment.user_id == user_id,
            KpiTemplate.status != TemplateStatus.draft,
        )
        .options(joinedload(KpiAssignment.cycle))
        .order_by(KpiAssignment.cycle_id)
    ).all()
    return [
        {
            "period": a.cycle.period_label or a.cycle.name,
            "month": a.cycle.month.strftime("%b %Y"),
            "review_type": a.cycle.review_type or "monthly",
            "financial_year": a.cycle.financial_year or _financial_year(a.cycle.month),
            "score": _official_score(a),
            "employee_score": int(round(float(a.calculated_score or 0))),
            "manager_score": None if a.manager_score is None else int(round(float(a.manager_score))),
            "status": a.status.value,
        }
        for a in rows
    ]


@dashboard_router.router.get("/review-matrix")
def review_matrix(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    assignments = _dashboard_visible_assignments(db, user)
    period_by_id = {}
    info = {}
    scores = defaultdict(dict)
    employee_scores = defaultdict(dict)
    manager_scores = defaultdict(dict)
    threshold_failures = defaultdict(dict)

    for assignment in assignments:
        if not assignment.cycle or not assignment.user:
            continue
        cycle = assignment.cycle
        key = f"cycle-{cycle.id}"
        review_type = getattr(cycle, "review_type", "monthly") or "monthly"
        period_by_id[cycle.id] = {
            "key": key,
            "cycle_id": cycle.id,
            "label": getattr(cycle, "period_label", None) or cycle.name,
            "name": cycle.name,
            "month": cycle.month.isoformat(),
            "review_type": review_type,
            "financial_year": getattr(cycle, "financial_year", None) or _financial_year(cycle.month),
            "status": cycle.status.value,
        }
        employee = assignment.user
        designation = employee.designation
        department = designation.department if designation else None
        division = department.division if department else None
        info[employee.id] = {
            "employee": employee.name,
            "email": employee.email,
            "division": division.name if division else "Corporate",
            "department": department.name if department else "General",
            "designation": designation.name if designation else "Staff",
            "manager": employee.manager.name if employee.manager else None,
        }
        scores[employee.id][key] = _official_score(assignment)
        employee_scores[employee.id][key] = int(round(float(assignment.calculated_score or 0)))
        manager_scores[employee.id][key] = None if assignment.manager_score is None else int(round(float(assignment.manager_score)))
        responses = {response.kpi_item_id: response for response in assignment.responses}
        manager_reviewed = assignment.manager_score is not None or assignment.final_score is not None
        failures = []
        for kra in assignment.template.kras:
            for item in kra.items:
                response = responses.get(item.id)
                employee_actual = response.actual_numeric if response and response.actual_numeric is not None else None
                manager_actual = response.manager_actual_numeric if response and response.manager_actual_numeric is not None else None
                actual = manager_actual if manager_reviewed and manager_actual is not None else employee_actual
                status = threshold_status(item, actual)
                config = item_config(item)
                meta = config["meta"]
                minimum = meta.get("threshold_min")
                maximum = meta.get("threshold_max")
                failed_minimum = actual is not None and minimum is not None and float(actual) < float(minimum)
                failed_maximum = actual is not None and maximum is not None and float(actual) > float(maximum)
                if not failed_minimum and not failed_maximum and status["passed"] is not False:
                    continue
                unit = meta.get("unit") or ""
                suffix = f" {unit}" if unit else ""
                actual_text = f"; actual {float(actual):g}{suffix}" if actual is not None else ""
                reasons = []
                if failed_minimum:
                    reasons.append(f"Minimum {float(minimum):g}{suffix} not achieved")
                if failed_maximum:
                    reasons.append(f"Maximum {float(maximum):g}{suffix} exceeded")
                failures.append(f"{item.question}: {'; '.join(reasons) or status['reason']}{actual_text}")
        threshold_failures[employee.id][key] = failures
        scores[employee.id][key] = 0 if failures and _official_score(assignment) is not None else _official_score(assignment)

    periods = sorted(
        period_by_id.values(),
        key=lambda row: (row["month"], REVIEW_ORDER.get(row["review_type"], 99), row["cycle_id"]),
    )
    output = []
    for user_id in sorted(info, key=lambda uid: info[uid]["employee"].lower()):
        official_values = [value for value in scores[user_id].values() if value is not None]
        average = int(round(sum(official_values) / len(official_values))) if official_values else 0
        output.append(
            {
                "user_id": user_id,
                **info[user_id],
                "total_cycles": len(official_values),
                "overall_average": average,
                "latest_score": official_values[-1] if official_values else 0,
                "rating_band": dashboard_router._rating_band_label(average),
                "scores": scores[user_id],
                "employee_scores": employee_scores[user_id],
                "manager_scores": manager_scores[user_id],
                            "threshold_failures": threshold_failures[user_id],
            }
        )
    return {"periods": periods, "rows": output, "score_source": "manager_score", "financial_year_basis": "April-March"}


def _notification_log(db: Session) -> tuple[SystemSetting, dict]:
    setting = db.get(SystemSetting, "kpi_notification_log")
    if not setting:
        setting = SystemSetting(key="kpi_notification_log", value={"sent": {}})
        db.add(setting)
        db.flush()

    # Never mutate the dict currently attached to SQLAlchemy's JSON attribute.
    # Nested plain-dict changes are not tracked automatically and can therefore
    # disappear at flush/commit time. Work on a copy, then replace the whole
    # JSON value in _send_once so duplicate-reminder keys are truly persisted.
    raw_value = setting.value if isinstance(setting.value, dict) else {}
    raw_sent = raw_value.get("sent") if isinstance(raw_value.get("sent"), dict) else {}
    return setting, {"sent": dict(raw_sent)}


def _send_once(db: Session, key: str, to_email: str, subject: str, body: str) -> bool:
    setting, value = _notification_log(db)
    sent = value["sent"]
    if key in sent:
        return False
    delivered = send_email(to_email, subject, body)
    if delivered:
        sent[key] = datetime.utcnow().isoformat()
        # Bound the log so it never grows indefinitely.
        if len(sent) > 3000:
            for old_key in sorted(sent, key=sent.get)[:1000]:
                sent.pop(old_key, None)
        setting.value = {"sent": dict(sent)}
        db.flush()
    return delivered


def _pending_target_month(today: date) -> date | None:
    if today.day >= 26:
        return today.replace(day=1)
    if today.day == 1:
        previous = today - timedelta(days=1)
        return previous.replace(day=1)
    return None


def _hr_recipients(db: Session) -> list[User]:
    hr = db.scalars(select(User).where(User.active.is_(True), User.role == Role.hr)).all()
    if hr:
        return hr
    return db.scalars(select(User).where(User.active.is_(True), User.role == Role.superadmin)).all()


def run_due_notifications(db: Session, today: date | None = None) -> dict:
    today = today or datetime.now(ZoneInfo("Asia/Kolkata")).date()
    sent_employee = 0
    sent_hr = 0
    target_month = _pending_target_month(today)
    pending_count = 0

    if target_month:
        cycles = db.scalars(
            select(KpiCycle).where(
                KpiCycle.month == target_month,
                KpiCycle.status != CycleStatus.closed,
            )
        ).all()
        cycle_ids = [cycle.id for cycle in cycles]
        pending = []
        if cycle_ids:
            pending = db.scalars(
                select(KpiAssignment)
                .join(KpiTemplate, KpiAssignment.template_id == KpiTemplate.id)
                .where(
                    KpiAssignment.cycle_id.in_(cycle_ids),
                    KpiAssignment.status.in_([AssignmentStatus.not_started, AssignmentStatus.draft]),
                    KpiTemplate.status == TemplateStatus.active,
                )
                .options(joinedload(KpiAssignment.user), joinedload(KpiAssignment.cycle))
            ).all()
        pending_count = len(pending)
        by_employee: dict[int, list[KpiAssignment]] = defaultdict(list)
        for assignment in pending:
            if assignment.user and assignment.user.active:
                by_employee[assignment.user_id].append(assignment)

        for employee_id, assignments in by_employee.items():
            employee = assignments[0].user
            periods = ", ".join(a.cycle.period_label or a.cycle.name for a in assignments)
            key = f"employee-pending:{today.isoformat()}:{employee_id}:{target_month.isoformat()}"
            if _send_once(
                db,
                key,
                employee.email,
                "KPI completion reminder",
                f"Your published KPI is still pending for: {periods}. You can complete KPI any day after publication. This is the 26th-to-1st reminder window. Open {settings.frontend_url}/kpi-input to complete and submit it.",
            ):
                sent_employee += 1

        if pending:
            summary_lines = [f"- {a.user.name}: {a.cycle.period_label or a.cycle.name} ({a.status.value.replace('_', ' ')})" for a in pending[:100]]
            body = "KPI pending status for the 26th-to-1st follow-up window:\n\n" + "\n".join(summary_lines)
            if len(pending) > 100:
                body += f"\n...and {len(pending) - 100} more pending KPI records."
            for hr in _hr_recipients(db):
                key = f"hr-pending:{today.isoformat()}:{hr.id}:{target_month.isoformat()}"
                if _send_once(db, key, hr.email, "KPI pending staff summary", body):
                    sent_hr += 1

    # Before the next month begins, remind HR only when required review periods
    # are not initialized/assigned.  Employees are never blocked from filling
    # once a published assignment exists.
    if today.day in {25, 30}:
        next_month = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
        missing = []
        for spec in _period_specs(next_month):
            cycle = db.scalar(
                select(KpiCycle).where(
                    KpiCycle.month == next_month,
                    KpiCycle.review_type == spec["review_type"],
                )
            )
            assignment_exists = bool(
                cycle
                and db.scalar(
                    select(KpiAssignment.id)
                    .join(KpiTemplate, KpiAssignment.template_id == KpiTemplate.id)
                    .where(
                        KpiAssignment.cycle_id == cycle.id,
                        KpiTemplate.status == TemplateStatus.active,
                    )
                    .limit(1)
                )
            )
            if not cycle or not assignment_exists:
                missing.append(spec["period_label"])
        if missing:
            body = "HR action required before the next review month starts. Initialize/publish KPI targets and assignments for: " + ", ".join(missing) + "."
            for hr in _hr_recipients(db):
                key = f"hr-initialize:{today.isoformat()}:{hr.id}:{next_month.isoformat()}"
                if _send_once(db, key, hr.email, "KPI target initialization pending", body):
                    sent_hr += 1

    db.commit()
    return {"date": today.isoformat(), "pending": pending_count, "employee_emails": sent_employee, "hr_emails": sent_hr}


@kpi_router.router.post("/reminders/run")
def run_reminders_now(db: Session = Depends(get_db), _=Depends(review_period_roles)):
    return run_due_notifications(db)


def _notification_loop():
    while True:
        try:
            now = datetime.now(ZoneInfo("Asia/Kolkata"))
            if 7 <= now.hour <= 10:
                with SessionLocal() as db:
                    run_due_notifications(db, now.date())
        except Exception:
            pass
        sleep(3600)


def start_notification_scheduler():
    global _scheduler_started
    if _scheduler_started:
        return
    _scheduler_started = True
    threading.Thread(target=_notification_loop, name="kpi-reminder-scheduler", daemon=True).start()
