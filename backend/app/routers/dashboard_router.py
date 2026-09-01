from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from ..auth import get_current_user
from ..database import get_db
from ..models import AssignmentStatus, CycleStatus, Department, Designation, KpiAssignment, KpiCycle, Kra, Role, SystemSetting, User

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _is_admin_or_hr(user: User) -> bool:
    return user.role in {Role.superadmin, Role.hr}


def _official_score(assignment: KpiAssignment) -> float | None:
    """Only completed Manager Score review contributes to official reporting."""
    if assignment.final_score is not None:
        return float(assignment.final_score)
    if assignment.status == AssignmentStatus.manager_reviewed and assignment.manager_score is not None:
        return float(assignment.manager_score)
    return None


def _visible_assignments(db: Session, user: User):
    rows = db.scalars(
        select(KpiAssignment)
        .options(
            joinedload(KpiAssignment.user)
            .joinedload(User.designation)
            .joinedload(Designation.department)
            .joinedload(Department.division),
            joinedload(KpiAssignment.user).joinedload(User.manager),
            joinedload(KpiAssignment.cycle),
        )
    ).all()
    if _is_admin_or_hr(user):
        return rows
    # Reports To is authoritative. Any person can review direct reports even
    # when their stored System Role is Employee.
    return [a for a in rows if a.user_id == user.id or a.user.manager_id == user.id]


@router.get("/summary")
def summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    running_cycles = db.scalars(select(KpiCycle).where(KpiCycle.status == CycleStatus.running).order_by(KpiCycle.month.desc())).all()
    running = len(running_cycles)
    assignments = _visible_assignments(db, user)
    current_cycle = running_cycles[0] if running_cycles else db.scalar(select(KpiCycle).order_by(KpiCycle.month.desc()).limit(1))
    current_assignments = [a for a in assignments if current_cycle and a.cycle_id == current_cycle.id]

    if _is_admin_or_hr(user):
        total_employees = db.scalar(select(func.count(User.id)).where(User.active.is_(True))) or 0
    else:
        visible_people = {a.user_id for a in current_assignments or assignments}
        visible_people.add(user.id)
        total_employees = len(visible_people)

    submitted = [a for a in current_assignments if a.status in {AssignmentStatus.submitted, AssignmentStatus.manager_reviewed, AssignmentStatus.finalized}]
    direct_reports = [a for a in current_assignments if a.user and a.user.manager_id == user.id and a.user_id != user.id]
    has_direct_reports = bool(direct_reports) or db.scalar(select(User.id).where(User.manager_id == user.id, User.active.is_(True)).limit(1)) is not None

    if _is_admin_or_hr(user):
        pending_fill = sum(1 for a in current_assignments if a.status in {AssignmentStatus.not_started, AssignmentStatus.draft})
        pending_review = sum(1 for a in current_assignments if a.status == AssignmentStatus.submitted)
        pending_finalize = sum(1 for a in current_assignments if a.status == AssignmentStatus.manager_reviewed)
    else:
        pending_fill = sum(1 for a in current_assignments if a.user_id == user.id and a.status in {AssignmentStatus.not_started, AssignmentStatus.draft})
        pending_review = sum(1 for a in direct_reports if a.status == AssignmentStatus.submitted) if has_direct_reports else 0
        pending_finalize = 0

    score_rows = [score for a in current_assignments if (score := _official_score(a)) is not None]
    division_scores = defaultdict(list)
    for assignment in current_assignments:
        if assignment.user.designation:
            division = assignment.user.designation.department.division.name
            score = _official_score(assignment)
            if score is not None:
                division_scores[division].append(score)

    return {
        "total_employees": total_employees,
        "running_cycles": running,
        "current_cycle": current_cycle.name if current_cycle else None,
        "submission_rate": round((len(submitted) / len(current_assignments) * 100) if current_assignments else 0, 1),
        "average_score": round(sum(score_rows) / len(score_rows), 1) if score_rows else 0,
        "division_scores": [{"name": name, "score": round(sum(values) / len(values), 1)} for name, values in division_scores.items()],
        "status_counts": {status.value: sum(1 for a in current_assignments if a.status == status) for status in AssignmentStatus},
        "pending": {"fill": pending_fill, "review": pending_review, "finalize": pending_finalize},
        "score_source": "manager_score",
    }


@router.get("/history/{user_id}")
def history(user_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Employee not found")
    if not _is_admin_or_hr(user) and target.id != user.id and target.manager_id != user.id:
        raise HTTPException(403, "Not your direct report")
    rows = db.scalars(
        select(KpiAssignment)
        .where(KpiAssignment.user_id == user_id)
        .options(joinedload(KpiAssignment.cycle))
        .order_by(KpiAssignment.id)
    ).all()
    return [
        {
            "month": a.cycle.month.strftime("%b %Y"),
            "score": _official_score(a),
            "employee_score": a.calculated_score,
            "manager_score": a.manager_score,
            "status": a.status.value,
        }
        for a in rows
    ]


def _rating_band_label(score: float) -> str:
    if score >= 90:
        return "Outstanding"
    if score >= 80:
        return "Very Good"
    if score >= 70:
        return "Good"
    if score >= 60:
        return "Needs Improvement"
    return "Improvement Required"


@router.get("/monthly-matrix")
def monthly_matrix(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = _visible_assignments(db, user)
    matrix = defaultdict(dict)
    info = {}
    month_dates = {}
    user_scores = defaultdict(list)

    for assignment in rows:
        if not assignment.cycle or not assignment.user:
            continue
        label = assignment.cycle.month.strftime("%b %Y")
        month_dates[label] = assignment.cycle.month
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
        }
        score = _official_score(assignment)
        matrix[employee.id][label] = score
        if score is not None:
            user_scores[employee.id].append(score)

    sorted_months = sorted(month_dates.keys(), key=lambda month: month_dates[month])

    output_rows = []
    for uid in sorted(info.keys(), key=lambda employee_id: info[employee_id]["employee"]):
        scores_list = user_scores[uid]
        overall_avg = round(sum(scores_list) / len(scores_list), 1) if scores_list else 0.0
        latest_sc = scores_list[-1] if scores_list else 0.0
        output_rows.append({
            "user_id": uid,
            "employee": info[uid]["employee"],
            "email": info[uid]["email"],
            "division": info[uid]["division"],
            "department": info[uid]["department"],
            "designation": info[uid]["designation"],
            "total_cycles": len(scores_list),
            "overall_average": overall_avg,
            "latest_score": round(latest_sc, 1),
            "rating_band": _rating_band_label(overall_avg),
            "scores": matrix[uid],
        })

    return {
        "months": sorted_months,
        "rows": output_rows,
        "score_source": "manager_score",
    }


def _can_view_user(viewer: User, target: User) -> bool:
    if _is_admin_or_hr(viewer):
        return True
    return target.id == viewer.id or target.manager_id == viewer.id


@router.get("/kra-breakdown/{user_id}")
def kra_breakdown(user_id: int, cycle_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Employee not found")
    if not _can_view_user(user, target):
        raise HTTPException(403, "Forbidden")

    stmt = (
        select(KpiAssignment)
        .where(KpiAssignment.user_id == user_id)
        .options(
            joinedload(KpiAssignment.cycle),
            joinedload(KpiAssignment.template).joinedload(KpiTemplate.kras).joinedload(Kra.items),
            joinedload(KpiAssignment.responses),
        )
        .order_by(KpiAssignment.cycle_id.desc())
    )
    if cycle_id:
        stmt = stmt.where(KpiAssignment.cycle_id == cycle_id)
    assignment = db.scalars(stmt).unique().first()
    if not assignment:
        return {"assignment_id": None, "cycle": None, "rows": []}

    review_complete = assignment.status in {AssignmentStatus.manager_reviewed, AssignmentStatus.finalized} and assignment.manager_score is not None
    scores = {response.kpi_item_id: float(response.manager_score or 0) for response in assignment.responses}
    result_rows = []
    for kra in assignment.template.kras:
        score = round(sum(scores.get(item.id, 0) for item in kra.items), 2) if review_complete else 0.0
        result_rows.append({
            "kra": kra.name,
            "score": score,
            "weight": kra.weight,
            "percent": round(score / kra.weight * 100, 1) if kra.weight and review_complete else 0,
        })
    return {
        "assignment_id": assignment.id,
        "cycle_id": assignment.cycle_id,
        "cycle": assignment.cycle.name,
        "employee": target.name,
        "final_score": _official_score(assignment),
        "employee_score": assignment.calculated_score,
        "manager_score": assignment.manager_score,
        "rows": result_rows,
        "score_source": "manager_score",
    }


@router.get("/rating-bands")
def rating_bands(db: Session = Depends(get_db), _=Depends(get_current_user)):
    obj = db.get(SystemSetting, "rating_bands")
    return obj.value if obj else [
        {"min": 90, "label": "Outstanding"},
        {"min": 80, "label": "Very Good"},
        {"min": 70, "label": "Good"},
        {"min": 60, "label": "Needs Improvement"},
        {"min": 0, "label": "Improvement Required"},
    ]
