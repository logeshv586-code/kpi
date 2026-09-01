from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import AssignmentStatus, User
from ..schemas import ResponseIn, ReviewIn
from . import kpi_router, kpi_submit_override
from . import relationship_review_override as review


# Once a reporting person submits Manager Review, that review becomes read-only.
# Only Super Admin may change Manager Score afterwards.  This module is imported
# after relationship_review_override so these stricter routes replace its
# editable manager_reviewed behavior before FastAPI registers the routers.

_ASSIGNMENT_PATH = "/api/kpi/assignments/{assignment_id}"
_RESPONSES_PATH = "/api/kpi/assignments/{assignment_id}/responses"
_MANAGER_REVIEW_PATH = "/api/kpi/assignments/{assignment_id}/manager-review"
_SUBMIT_PATH = "/api/kpi/assignments/{assignment_id}/submit"

review._remove_route(kpi_router.router, _ASSIGNMENT_PATH, {"GET"})
review._remove_route(kpi_router.router, _RESPONSES_PATH, {"PUT"})
review._remove_route(kpi_router.router, _MANAGER_REVIEW_PATH, {"POST"})
review._remove_route(kpi_router.router, _SUBMIT_PATH, {"POST"})
review._remove_route(kpi_submit_override.router, _SUBMIT_PATH, {"POST"})


def _review_already_submitted(assignment, user: User) -> bool:
    """Return True when this non-Super-Admin reviewer has already submitted."""
    if review._is_superadmin(user):
        return False
    if not review._can_review(user, assignment):
        return False
    return assignment.status in {AssignmentStatus.manager_reviewed, AssignmentStatus.finalized}


def _raise_review_locked():
    raise HTTPException(
        409,
        "Manager Review has already been submitted and is locked. Only Super Admin can change the Manager Score now.",
    )


@kpi_router.router.get("/assignments/{assignment_id}")
def locked_relationship_get_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    data = review.relationship_get_assignment(assignment_id, db, user)
    if not review._is_superadmin(user) and data.get("status") in {
        AssignmentStatus.manager_reviewed.value,
        AssignmentStatus.finalized.value,
    }:
        data["can_edit_manager_score"] = False
        data["manager_review_submitted"] = True
    else:
        data["manager_review_submitted"] = False
    return data


@kpi_router.router.put("/assignments/{assignment_id}/responses")
def locked_relationship_save_responses(
    assignment_id: int,
    payload: list[ResponseIn],
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    assignment = review._load_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    if _review_already_submitted(assignment, user):
        _raise_review_locked()
    return review.relationship_save_responses(assignment_id, payload, db, user)


@kpi_router.router.post("/assignments/{assignment_id}/manager-review")
def locked_relationship_manager_review(
    assignment_id: int,
    payload: ReviewIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    assignment = review._load_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    if _review_already_submitted(assignment, user):
        _raise_review_locked()
    return review._complete_manager_review(assignment, payload, db, user)


@kpi_submit_override.router.post("/assignments/{assignment_id}/submit")
@kpi_router.router.post("/assignments/{assignment_id}/submit")
def locked_relationship_submit_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    assignment = review._load_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    if assignment.user_id != user.id and _review_already_submitted(assignment, user):
        _raise_review_locked()
    return review.relationship_submit_assignment(assignment_id, db, user)
