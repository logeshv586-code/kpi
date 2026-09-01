from __future__ import annotations

from datetime import datetime
import io

from fastapi import Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..auth import get_current_user
from ..database import get_db, settings
from ..models import (
    AssignmentStatus,
    CycleStatus,
    Department,
    Designation,
    KpiAssignment,
    KpiCycle,
    KpiItem,
    KpiResponse,
    KpiReview,
    KpiTemplate,
    Kra,
    Role,
    TemplateStatus,
    User,
)
from ..schemas import ResponseIn, ReviewIn, ReopenIn
from ..services import audit, calculate_achievement_percent, calculate_item_score
from . import kpi_router, kpi_submit_override


# This module intentionally replaces a small set of KPI routes after the legacy
# router is imported. The Reports To relationship (users.manager_id) is the
# source of truth for review permissions; the stored system role does not need
# to be changed to Manager just because somebody has direct reports.


def _remove_route(router, path: str, methods: set[str]):
    router.routes[:] = [
        route
        for route in router.routes
        if not (
            getattr(route, "path", None) == path
            and bool(methods.intersection(set(getattr(route, "methods", set()) or set())))
        )
    ]


for _path, _methods in [
    ("/api/kpi/my", {"GET"}),
    ("/api/kpi/assignments/{assignment_id}", {"GET"}),
    ("/api/kpi/assignments/{assignment_id}/responses", {"PUT"}),
    ("/api/kpi/assignments/{assignment_id}/submit", {"POST"}),
    ("/api/kpi/assignments/{assignment_id}/manager-review", {"POST"}),
    ("/api/kpi/assignments/{assignment_id}/finalize", {"POST"}),
    ("/api/kpi/assignments/{assignment_id}/reopen", {"POST"}),
    ("/api/kpi/assignments/{assignment_id}/pdf", {"GET"}),
]:
    _remove_route(kpi_router.router, _path, _methods)

# main.py registers kpi_submit_override before kpi_router, so its legacy submit
# route must also be removed or it would win FastAPI route matching.
_remove_route(kpi_submit_override.router, "/api/kpi/assignments/{assignment_id}/submit", {"POST"})


def _is_admin_or_hr(user: User) -> bool:
    return user.role in {Role.superadmin, Role.hr}


def _is_superadmin(user: User) -> bool:
    return user.role == Role.superadmin


def _is_direct_reviewer(user: User, assignment: KpiAssignment) -> bool:
    return bool(assignment.user and assignment.user.manager_id == user.id and assignment.user_id != user.id)


def _can_view(user: User, assignment: KpiAssignment) -> bool:
    if _is_admin_or_hr(user):
        return True
    return assignment.user_id == user.id or _is_direct_reviewer(user, assignment)


def _can_review(user: User, assignment: KpiAssignment) -> bool:
    if assignment.user_id == user.id:
        return False
    return _is_admin_or_hr(user) or _is_direct_reviewer(user, assignment)


def _load_assignment(db: Session, assignment_id: int) -> KpiAssignment | None:
    return db.scalar(
        select(KpiAssignment)
        .where(KpiAssignment.id == assignment_id)
        .options(
            joinedload(KpiAssignment.user).joinedload(User.manager),
            joinedload(KpiAssignment.user).joinedload(User.designation).joinedload(Designation.department).joinedload(Department.division),
            joinedload(KpiAssignment.cycle),
            joinedload(KpiAssignment.template).joinedload(KpiTemplate.designation),
            joinedload(KpiAssignment.template).joinedload(KpiTemplate.kras).joinedload(Kra.items),
            joinedload(KpiAssignment.responses).joinedload(KpiResponse.item),
        )
    )


def _manager_answer_present(item: KpiItem, response: KpiResponse | None) -> bool:
    if not response:
        return False
    if item.input_type in {"choice", "yesno"}:
        return bool(response.manager_selected_option)
    return response.manager_actual_numeric is not None


def _employee_answer_present(item: KpiItem, response: KpiResponse | None) -> bool:
    if not response:
        return False
    if item.input_type in {"choice", "yesno"}:
        return bool(response.selected_option)
    return response.actual_numeric is not None


def _recalc_scores(db: Session, assignment: KpiAssignment) -> tuple[float, float | None]:
    employee_total = 0.0
    manager_total = 0.0
    has_manager_input = False
    for response in assignment.responses:
        response.score = calculate_item_score(response.item, response, is_manager=False)
        manager_present = _manager_answer_present(response.item, response)
        response.manager_score = calculate_item_score(response.item, response, is_manager=True) if manager_present else 0.0
        employee_total += response.score
        manager_total += response.manager_score
        has_manager_input = has_manager_input or manager_present

    assignment.calculated_score = round(min(employee_total, 100.0), 2)
    assignment.manager_score = round(min(manager_total, 100.0), 2) if has_manager_input else None
    if assignment.status == AssignmentStatus.finalized and assignment.manager_score is not None:
        # Manager Score is the official score. Super Admin changes to Manager
        # Score on a finalized record must remain reflected in Final Score.
        assignment.final_score = assignment.manager_score
    db.flush()
    return assignment.calculated_score, assignment.manager_score


def _clear_manager_review(assignment: KpiAssignment):
    for response in assignment.responses:
        response.manager_actual_numeric = None
        response.manager_selected_option = None
        response.manager_score = 0.0
    assignment.manager_score = None
    assignment.final_score = None
    assignment.finalized_at = None


def _ensure_assignments_for_scope(db: Session, user: User):
    cycles = db.scalars(
        select(KpiCycle)
        .where(KpiCycle.status != CycleStatus.closed)
        .order_by(KpiCycle.id.desc())
    ).all()
    if not cycles:
        return

    if _is_admin_or_hr(user):
        target_users = db.scalars(select(User).where(User.active.is_(True))).all()
    else:
        target_users = db.scalars(
            select(User).where(
                User.active.is_(True),
                (User.id == user.id) | (User.manager_id == user.id),
            )
        ).all()

    templates = db.scalars(
        select(KpiTemplate)
        .where(KpiTemplate.status == TemplateStatus.active)
        .options(
            joinedload(KpiTemplate.division),
            joinedload(KpiTemplate.department),
            joinedload(KpiTemplate.designation),
            joinedload(KpiTemplate.kras).joinedload(Kra.items),
        )
        .order_by(KpiTemplate.version.desc(), KpiTemplate.id.desc())
    ).unique().all()
    if not templates:
        return

    changed = False
    for target in target_users:
        if target.role == Role.superadmin:
            continue
        employee = db.scalar(
            select(User)
            .where(User.id == target.id)
            .options(joinedload(User.designation).joinedload(Designation.department).joinedload(Department.division))
        )
        if not employee:
            continue
        for cycle in cycles:
            existing = db.scalar(
                select(KpiAssignment).where(
                    KpiAssignment.cycle_id == cycle.id,
                    KpiAssignment.user_id == employee.id,
                )
            )
            if existing:
                continue
            template = kpi_router._employee_template_override(db, employee)
            if not template:
                matching = [t for t in templates if kpi_router._template_matches_employee(t, employee)]
                template = max(matching, key=kpi_router._template_scope_rank) if matching else None
            if template and template.kras:
                assignment = KpiAssignment(
                    cycle_id=cycle.id,
                    user_id=employee.id,
                    template_id=template.id,
                    status=AssignmentStatus.draft,
                )
                db.add(assignment)
                changed = True
    if changed:
        try:
            db.commit()
        except Exception:
            db.rollback()


def _progress(assignment: KpiAssignment) -> int:
    items = [item for kra in assignment.template.kras for item in kra.items]
    response_map = {r.kpi_item_id: r for r in assignment.responses}
    answered = sum(1 for item in items if _employee_answer_present(item, response_map.get(item.id)))
    return round((answered / len(items) * 100) if items else 0)


def _official_score(assignment: KpiAssignment) -> float | None:
    if assignment.final_score is not None:
        return assignment.final_score
    if assignment.status == AssignmentStatus.manager_reviewed and assignment.manager_score is not None:
        return assignment.manager_score
    return None


@kpi_router.router.get("/my")
def relationship_my_assignments(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ensure_assignments_for_scope(db, user)
    stmt = (
        select(KpiAssignment)
        .options(
            joinedload(KpiAssignment.user).joinedload(User.manager),
            joinedload(KpiAssignment.user).joinedload(User.designation).joinedload(Designation.department).joinedload(Department.division),
            joinedload(KpiAssignment.cycle),
            joinedload(KpiAssignment.template).joinedload(KpiTemplate.designation),
            joinedload(KpiAssignment.template).joinedload(KpiTemplate.kras).joinedload(Kra.items),
            joinedload(KpiAssignment.responses),
        )
        .order_by(KpiAssignment.id.desc())
    )
    if not _is_admin_or_hr(user):
        stmt = stmt.join(User, KpiAssignment.user_id == User.id).where(
            (KpiAssignment.user_id == user.id) | (User.manager_id == user.id)
        )

    rows = [
        a for a in db.scalars(stmt).unique().all()
        if a.template.status == TemplateStatus.active
    ]
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
            "month": a.cycle.month.isoformat() if a.cycle and a.cycle.month else None,
            "cycle_status": a.cycle.status.value if a.cycle else None,
            "is_locked": bool(a.cycle.is_locked) if a.cycle else False,
            "status": a.status.value,
            "calculated_score": a.calculated_score,
            "manager_score": a.manager_score,
            "final_score": a.final_score,
            "official_score": _official_score(a),
            "can_review": _can_review(user, a),
            "progress_percent": _progress(a),
            "template": kpi_router.template_json(a.template),
        }
        for a in rows
    ]


@kpi_router.router.get("/assignments/{assignment_id}")
def relationship_get_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    assignment = _load_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    if not _can_view(user, assignment):
        raise HTTPException(403, "Forbidden")
    kpi_router._require_published_assignment_template(assignment)

    response_map = {r.kpi_item_id: r for r in assignment.responses}
    data = kpi_router.template_json(assignment.template)
    for kra in data["kras"]:
        for item in kra["items"]:
            response = response_map.get(item["id"])
            item["response"] = None if not response else {
                "actual_numeric": response.actual_numeric,
                "answer_text": response.answer_text,
                "selected_option": response.selected_option,
                "manager_actual_numeric": response.manager_actual_numeric,
                "manager_selected_option": response.manager_selected_option,
                "measurement": response.measurement,
                "remarks": response.remarks,
                "evidence_url": response.evidence_url,
                "evidence_file_id": response.evidence_file_id,
                "evidence_file": kpi_router.upload_metadata(response.evidence_file_id),
                "score": response.score,
                "manager_score": response.manager_score,
                "achievement_pct": calculate_achievement_percent(response.item, response),
            }

    reviews = db.scalars(
        select(KpiReview)
        .where(KpiReview.assignment_id == assignment.id)
        .options(joinedload(KpiReview.reviewer))
        .order_by(KpiReview.created_at.desc(), KpiReview.id.desc())
    ).all()

    can_review = _can_review(user, assignment)
    superadmin = _is_superadmin(user)
    review_status_ok = assignment.status in {AssignmentStatus.submitted, AssignmentStatus.manager_reviewed}
    if superadmin and assignment.status == AssignmentStatus.finalized:
        review_status_ok = True
    cycle_editable = superadmin or (
        not assignment.cycle.is_locked and assignment.cycle.status != CycleStatus.closed
    )

    return {
        "id": assignment.id,
        "employee": assignment.user.name,
        "employee_id": assignment.user_id,
        "employee_no": assignment.user.employee_no,
        "manager_id": assignment.user.manager_id,
        "manager_name": assignment.user.manager.name if assignment.user.manager else None,
        "cycle": assignment.cycle.name,
        "cycle_status": assignment.cycle.status.value,
        "is_locked": bool(assignment.cycle.is_locked),
        "status": assignment.status.value,
        "calculated_score": assignment.calculated_score,
        "manager_score": assignment.manager_score,
        "final_score": assignment.final_score,
        "official_score": _official_score(assignment),
        "can_review": can_review,
        "can_edit_manager_score": bool(can_review and review_status_ok and cycle_editable),
        "template": data,
        "review_history": [
            {
                "id": review.id,
                "reviewer": review.reviewer.name if review.reviewer else None,
                "reviewer_id": review.reviewer_id,
                "stage": review.stage,
                "decision": review.decision,
                "comments": review.comments,
                "score_override": review.score_override,
                "created_at": review.created_at.isoformat() if review.created_at else None,
            }
            for review in reviews
        ],
    }


@kpi_router.router.put("/assignments/{assignment_id}/responses")
def relationship_save_responses(
    assignment_id: int,
    payload: list[ResponseIn],
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    assignment = _load_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    if not _can_view(user, assignment):
        raise HTTPException(403, "Forbidden")
    kpi_router._require_published_assignment_template(assignment)

    review_mode = _can_review(user, assignment)
    superadmin = _is_superadmin(user)
    if assignment.cycle.is_locked and not superadmin:
        raise HTTPException(409, "This KPI cycle has been locked by Super Admin.")
    if assignment.cycle.status == CycleStatus.closed and not superadmin:
        raise HTTPException(409, "This KPI cycle is closed.")

    if review_mode:
        allowed_statuses = {AssignmentStatus.submitted, AssignmentStatus.manager_reviewed}
        if superadmin:
            allowed_statuses.add(AssignmentStatus.finalized)
        if assignment.status not in allowed_statuses:
            raise HTTPException(409, "Employee submission is required before entering Manager Score.")
    elif assignment.status in {AssignmentStatus.submitted, AssignmentStatus.manager_reviewed, AssignmentStatus.finalized}:
        raise HTTPException(409, "KPI entry has already been submitted and is locked for employee editing.")

    valid_ids = set(
        db.scalars(select(KpiItem.id).join(Kra).where(Kra.template_id == assignment.template_id)).all()
    )
    response_map = {r.kpi_item_id: r for r in assignment.responses}

    for row in payload:
        if row.kpi_item_id not in valid_ids:
            raise HTTPException(400, f"KPI item {row.kpi_item_id} is not part of this assignment")
        response = response_map.get(row.kpi_item_id)
        if not response:
            response = KpiResponse(assignment_id=assignment.id, kpi_item_id=row.kpi_item_id)
            db.add(response)
            db.flush()
            response_map[row.kpi_item_id] = response

        values = row.model_dump()
        if review_mode:
            # Reviewers can change only the Manager Score answer. Employee
            # answers, notes and evidence remain exactly as submitted.
            response.manager_actual_numeric = values.get("manager_actual_numeric")
            response.manager_selected_option = values.get("manager_selected_option")
        else:
            response.actual_numeric = values.get("actual_numeric")
            response.answer_text = values.get("answer_text")
            response.selected_option = values.get("selected_option")
            response.measurement = values.get("measurement")
            response.remarks = values.get("remarks")
            response.evidence_url = values.get("evidence_url")
            response.evidence_file_id = values.get("evidence_file_id")

    if assignment.status == AssignmentStatus.not_started:
        assignment.status = AssignmentStatus.draft

    # Reload so newly-created responses include their KPI item relationship.
    db.flush()
    assignment = _load_assignment(db, assignment.id)
    employee_score, manager_score = _recalc_scores(db, assignment)
    if superadmin and assignment.status == AssignmentStatus.finalized and manager_score is not None:
        assignment.final_score = manager_score

    audit(
        db,
        user.id,
        "save_manager_scores" if review_mode else "save_responses",
        "kpi_assignment",
        assignment.id,
        {
            "employee_score": employee_score,
            "manager_score": manager_score,
            "review_mode": review_mode,
            "reports_to_user_id": assignment.user.manager_id,
        },
    )
    db.commit()
    return {
        "ok": True,
        "score": employee_score,
        "manager_score": manager_score,
        "official_score": _official_score(assignment),
    }


def _complete_manager_review(
    assignment: KpiAssignment,
    payload: ReviewIn,
    db: Session,
    user: User,
):
    if not _can_review(user, assignment):
        raise HTTPException(403, "Only the person selected in Reports To, HR, or Super Admin can review this KPI.")

    superadmin = _is_superadmin(user)
    if assignment.cycle.is_locked and not superadmin:
        raise HTTPException(409, "This KPI cycle has been locked by Super Admin.")
    if assignment.cycle.status == CycleStatus.closed and not superadmin:
        raise HTTPException(409, "This KPI cycle is closed.")

    allowed_statuses = {AssignmentStatus.submitted, AssignmentStatus.manager_reviewed}
    if superadmin:
        allowed_statuses.add(AssignmentStatus.finalized)
    if assignment.status not in allowed_statuses:
        raise HTTPException(409, "Employee submission is required first")

    stage = "superadmin_manager" if superadmin else ("hr_manager" if user.role == Role.hr else "manager")

    if payload.decision == "rejected":
        if assignment.status == AssignmentStatus.finalized and not superadmin:
            raise HTTPException(409, "Finalized KPI cannot be returned by this reviewer.")
        assignment.status = AssignmentStatus.draft
        _clear_manager_review(assignment)
        db.add(KpiReview(assignment_id=assignment.id, reviewer_id=user.id, stage=stage, **payload.model_dump()))
        audit(db, user.id, "manager_reject", "kpi_assignment", assignment.id, {"reports_to_user_id": assignment.user.manager_id})
        db.commit()
        kpi_router._notify(
            assignment.user,
            f"KPI returned - {assignment.cycle.name}",
            payload.comments or "Your KPI was returned for correction.",
        )
        return {"ok": True, "status": assignment.status.value}

    response_map = {r.kpi_item_id: r for r in assignment.responses}
    items = [item for kra in assignment.template.kras for item in kra.items]
    missing = [item.question for item in items if not _manager_answer_present(item, response_map.get(item.id))]
    if missing:
        raise HTTPException(
            400,
            f"Complete every Manager Score before submitting the review. Missing: {', '.join(missing[:5])}",
        )

    _, manager_score = _recalc_scores(db, assignment)
    if manager_score is None:
        raise HTTPException(400, "Manager Score is required before review can be completed.")

    was_finalized = assignment.status == AssignmentStatus.finalized
    if was_finalized and superadmin:
        assignment.final_score = manager_score
    else:
        assignment.status = AssignmentStatus.manager_reviewed

    review_payload = payload.model_dump()
    # Final scoring is never overridden by the employee score or a free-form
    # score override. The weighted Manager Score is authoritative.
    review_payload["score_override"] = None
    db.add(KpiReview(assignment_id=assignment.id, reviewer_id=user.id, stage=stage, **review_payload))
    audit(
        db,
        user.id,
        "superadmin_manager_score_change" if was_finalized and superadmin else "manager_review",
        "kpi_assignment",
        assignment.id,
        {"manager_score": manager_score, "reports_to_user_id": assignment.user.manager_id},
    )
    db.commit()
    kpi_router._notify(
        assignment.user,
        f"KPI manager review completed - {assignment.cycle.name}",
        f"Manager Score: {manager_score:.1f}/100.",
    )
    return {
        "ok": True,
        "status": assignment.status.value,
        "manager_score": manager_score,
        "final_score": assignment.final_score,
    }


@kpi_router.router.post("/assignments/{assignment_id}/manager-review")
def relationship_manager_review(
    assignment_id: int,
    payload: ReviewIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    assignment = _load_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    return _complete_manager_review(assignment, payload, db, user)


@kpi_submit_override.router.post("/assignments/{assignment_id}/submit")
def relationship_submit_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    assignment = _load_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(404, "Assignment not found")

    # Backward compatibility: if an older frontend uses the Submit KPI button
    # while a reporting person is viewing a direct report, treat it as Submit
    # Manager Review instead of allowing a manager to submit employee answers.
    if assignment.user_id != user.id:
        if _can_review(user, assignment):
            return _complete_manager_review(
                assignment,
                ReviewIn(decision="approved", comments="Manager review submitted from KPI Input."),
                db,
                user,
            )
        raise HTTPException(403, "Forbidden")

    if assignment.cycle.is_locked:
        raise HTTPException(409, "This KPI cycle has been locked by Super Admin.")
    if assignment.cycle.status == CycleStatus.closed:
        raise HTTPException(409, "This KPI cycle is closed.")
    kpi_router._require_published_assignment_template(assignment)
    if assignment.status in {AssignmentStatus.submitted, AssignmentStatus.manager_reviewed, AssignmentStatus.finalized}:
        raise HTTPException(409, "Assignment has already been submitted")

    response_map = {r.kpi_item_id: r for r in assignment.responses}
    items = [item for kra in assignment.template.kras for item in kra.items]
    missing = [item.question for item in items if not _employee_answer_present(item, response_map.get(item.id))]
    if missing:
        raise HTTPException(
            400,
            f"Please answer all KPI items before submission. Missing: {', '.join(missing[:5])}",
        )

    employee_score, _ = _recalc_scores(db, assignment)
    # Employee self-score is reference-only. Official score remains pending
    # until the reporting person submits every Manager Score.
    assignment.manager_score = None
    assignment.final_score = None
    assignment.status = AssignmentStatus.submitted
    assignment.submitted_at = datetime.utcnow()
    audit(db, user.id, "submit", "kpi_assignment", assignment.id, {"employee_score_reference_only": employee_score})
    db.commit()
    kpi_router._notify(
        assignment.user.manager,
        f"KPI review required - {assignment.user.name}",
        f"{assignment.user.name} submitted {assignment.cycle.name} KPI. Open {settings.frontend_url}/kpi-input and select the employee to enter Manager Score.",
    )
    return {"ok": True, "score": employee_score, "official_score": None}


@kpi_router.router.post("/assignments/{assignment_id}/submit")
def relationship_submit_assignment_fallback(
    assignment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return relationship_submit_assignment(assignment_id, db, user)


@kpi_router.router.post("/assignments/{assignment_id}/finalize")
def relationship_finalize(
    assignment_id: int,
    payload: ReviewIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _is_superadmin(user):
        raise HTTPException(403, "Only Super Admin can finalize KPI scores.")
    assignment = _load_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(404, "Assignment not found")

    if payload.decision == "rejected":
        assignment.status = AssignmentStatus.draft
        _clear_manager_review(assignment)
        db.add(KpiReview(assignment_id=assignment.id, reviewer_id=user.id, stage="superadmin_final", **payload.model_dump()))
        audit(db, user.id, "final_reject", "kpi_assignment", assignment.id)
        db.commit()
        kpi_router._notify(
            assignment.user,
            f"KPI reopened - {assignment.cycle.name}",
            payload.comments or "Super Admin reopened your KPI for correction.",
        )
        return {"ok": True, "status": assignment.status.value}

    if assignment.manager_score is None or assignment.status not in {AssignmentStatus.manager_reviewed, AssignmentStatus.finalized}:
        raise HTTPException(409, "Complete Manager Score review before finalization. Final score is based only on Manager Score.")

    assignment.final_score = assignment.manager_score
    assignment.status = AssignmentStatus.finalized
    assignment.finalized_at = datetime.utcnow()
    review_payload = payload.model_dump()
    review_payload["score_override"] = None
    db.add(KpiReview(assignment_id=assignment.id, reviewer_id=user.id, stage="superadmin_final", **review_payload))
    audit(db, user.id, "finalize", "kpi_assignment", assignment.id, {"final_score": assignment.final_score, "source": "manager_score"})
    db.commit()
    kpi_router._notify(
        assignment.user,
        f"KPI finalized - {assignment.cycle.name}",
        f"Your final KPI score is {assignment.final_score:.1f}/100.",
    )
    return {"ok": True, "final_score": assignment.final_score}


@kpi_router.router.post("/assignments/{assignment_id}/reopen")
def relationship_reopen(
    assignment_id: int,
    payload: ReopenIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _is_superadmin(user):
        raise HTTPException(403, "Only Super Admin can reopen KPI assignments.")
    assignment = _load_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    assignment.status = AssignmentStatus.draft
    _clear_manager_review(assignment)
    audit(db, user.id, "reopen", "kpi_assignment", assignment.id, {"reason": payload.reason})
    db.commit()
    kpi_router._notify(assignment.user, f"KPI reopened - {assignment.cycle.name}", payload.reason)
    return {"ok": True, "status": assignment.status.value}


@kpi_router.router.get("/assignments/{assignment_id}/pdf")
def relationship_assignment_pdf(
    assignment_id: int,
    date_label: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    assignment = _load_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    if not _can_view(user, assignment):
        raise HTTPException(403, "Forbidden")

    response_map = {r.kpi_item_id: r for r in assignment.responses}
    if not any(_employee_answer_present(r.item, r) for r in assignment.responses):
        raise HTTPException(400, "No KPI input data registered for this period yet.")

    review_complete = assignment.status in {AssignmentStatus.manager_reviewed, AssignmentStatus.finalized} and assignment.manager_score is not None
    period_title = date_label if date_label else assignment.cycle.name
    official = assignment.final_score if assignment.final_score is not None else (assignment.manager_score if review_complete else None)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=14 * mm, bottomMargin=14 * mm)
    styles = getSampleStyleSheet()
    story = [Paragraph("KPI Performance Summary Report", styles["Title"]), Spacer(1, 6)]
    story.append(
        Paragraph(
            f"<b>Employee:</b> {assignment.user.name} &nbsp;&nbsp; <b>Period:</b> {period_title} &nbsp;&nbsp; <b>Status:</b> {assignment.status.value.replace('_', ' ').title()}",
            styles["BodyText"],
        )
    )
    score_text = f"{official:.1f} / 100" if official is not None else "Pending Manager Review"
    story.append(
        Paragraph(
            f"<b>Official Score:</b> {score_text} &nbsp;&nbsp; <b>Reporting Manager:</b> {(assignment.user.manager.name if assignment.user.manager else 'Super Admin review required')} &nbsp;&nbsp; <b>Template:</b> {assignment.template.name}",
            styles["BodyText"],
        )
    )
    story.append(
        Paragraph(
            "Employee Your Score is shown for reference only. Weighted Marks Scored and the official result are calculated from Manager Score only.",
            styles["BodyText"],
        )
    )
    story.append(Spacer(1, 10))

    data = [["KRA / KPI", "Target", "Your Score", "Manager Score", "Weight", "Marks Scored", "Remarks"]]
    for kra in assignment.template.kras:
        data.append([Paragraph(f"<b>{kra.name}</b>", styles["BodyText"]), "", "", "", f"{kra.weight:g}", "", ""])
        for item in kra.items:
            response = response_map.get(item.id)
            employee_actual = "—"
            manager_actual = "—"
            remarks = ""
            manager_mark = 0.0
            if response:
                employee_actual = response.selected_option or ("—" if response.actual_numeric is None else f"{response.actual_numeric:g}")
                manager_actual = response.manager_selected_option or ("—" if response.manager_actual_numeric is None else f"{response.manager_actual_numeric:g}")
                remarks = response.remarks or ""
                manager_mark = response.manager_score or 0.0
            marks = f"{manager_mark:.1f}" if review_complete else "Pending"
            data.append([
                Paragraph(item.question, styles["BodyText"]),
                "—" if item.target_value is None else f"{item.target_value:g}",
                employee_actual,
                manager_actual,
                f"{item.weight:g}",
                marks,
                Paragraph(remarks, styles["BodyText"]),
            ])

    table = Table(data, repeatRows=1, colWidths=[45 * mm, 18 * mm, 24 * mm, 24 * mm, 15 * mm, 20 * mm, 36 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EAF2FF")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(table)
    doc.build(story)
    buf.seek(0)
    clean_tag = period_title.replace(" ", "_").replace("/", "_")
    filename = f"KPI_{assignment.user.name.replace(' ', '_')}_{clean_tag}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
