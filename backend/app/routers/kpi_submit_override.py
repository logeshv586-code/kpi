from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db, settings
from ..models import AssignmentStatus, Role, User
from ..services import audit, recalc_assignment
from .kpi_router import _load_assignment, _notify

router = APIRouter(prefix="/api/kpi", tags=["kpi"])


@router.post("/assignments/{assignment_id}/submit")
def submit_assignment_optional_evidence(
    assignment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Submit KPI answers without requiring evidence or description.

    The KPI result/answer is mandatory. PDF evidence, URL evidence, measurement
    notes and description/remarks are optional for every KPI item.
    """
    assignment = _load_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    if user.role == Role.employee and assignment.user_id != user.id:
        raise HTTPException(403, "Forbidden")
    if user.role == Role.manager and assignment.user_id != user.id:
        raise HTTPException(403, "Managers cannot submit KPI on behalf of employees")
    if assignment.status in {
        AssignmentStatus.submitted,
        AssignmentStatus.manager_reviewed,
        AssignmentStatus.finalized,
    }:
        raise HTTPException(409, "Assignment has already been submitted")

    items = [item for kra in assignment.template.kras for item in kra.items]
    response_map = {response.kpi_item_id: response for response in assignment.responses}
    missing_answers = []

    for item in items:
        response = response_map.get(item.id)
        if not response:
            missing_answers.append(item.question)
            continue
        if item.input_type in {"choice", "yesno"}:
            answered = bool(response.selected_option)
        else:
            answered = response.actual_numeric is not None
        if not answered:
            missing_answers.append(item.question)

    if missing_answers:
        raise HTTPException(
            400,
            f"Please answer all KPI items before submission. Missing: {', '.join(missing_answers[:5])}",
        )

    recalc_assignment(db, assignment.id)
    assignment.status = AssignmentStatus.submitted
    assignment.submitted_at = datetime.utcnow()
    audit(
        db,
        user.id,
        "submit",
        "kpi_assignment",
        assignment.id,
        {"evidence_optional": True},
    )
    db.commit()

    _notify(
        assignment.user.manager,
        f"KPI review required - {assignment.user.name}",
        f"{assignment.user.name} submitted {assignment.cycle.name} KPI. Review it at {settings.frontend_url}/approvals.",
    )
    return {"ok": True, "score": assignment.calculated_score}
