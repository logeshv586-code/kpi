from collections import defaultdict

from fastapi import Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import AssignmentStatus, CycleStatus, KpiCycle, Role, User
from . import dashboard_router
from .kpi_v2_enhancements import _dashboard_visible_assignments, _official_score, _remove_route


_remove_route(dashboard_router.router, "/api/dashboard/summary", {"GET"})


@dashboard_router.router.get("/summary")
def v13_summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    running_cycles = db.scalars(
        select(KpiCycle).where(KpiCycle.status == CycleStatus.running).order_by(KpiCycle.month.desc(), KpiCycle.id.desc())
    ).all()
    all_visible = _dashboard_visible_assignments(db, user)

    if running_cycles:
        current_month = max(cycle.month for cycle in running_cycles)
        current_cycles = [cycle for cycle in running_cycles if cycle.month == current_month]
    else:
        latest = db.scalar(select(func.max(KpiCycle.month)))
        current_cycles = db.scalars(select(KpiCycle).where(KpiCycle.month == latest)).all() if latest else []
    current_cycle_ids = {cycle.id for cycle in current_cycles}
    current_assignments = [assignment for assignment in all_visible if assignment.cycle_id in current_cycle_ids]

    if user.role in {Role.superadmin, Role.hr}:
        total_employees = db.scalar(select(func.count(User.id)).where(User.active.is_(True))) or 0
    else:
        visible_people = {assignment.user_id for assignment in current_assignments or all_visible}
        visible_people.add(user.id)
        total_employees = len(visible_people)

    submitted = [a for a in current_assignments if a.status in {AssignmentStatus.submitted, AssignmentStatus.manager_reviewed, AssignmentStatus.finalized}]
    direct_reports = [a for a in current_assignments if a.user and a.user.manager_id == user.id and a.user_id != user.id]
    has_direct_reports = bool(direct_reports) or db.scalar(select(User.id).where(User.manager_id == user.id, User.active.is_(True)).limit(1)) is not None

    if user.role in {Role.superadmin, Role.hr}:
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
        designation = assignment.user.designation if assignment.user else None
        department = designation.department if designation else None
        division = department.division if department else None
        score = _official_score(assignment)
        if division and score is not None:
            division_scores[division.name].append(score)

    average_score = int(round(sum(score_rows) / len(score_rows))) if score_rows else 0
    return {
        "total_employees": total_employees,
        "running_cycles": len(running_cycles),
        "current_cycle": ", ".join(cycle.period_label or cycle.name for cycle in current_cycles) or None,
        "submission_rate": int(round((len(submitted) / len(current_assignments) * 100) if current_assignments else 0)),
        "average_score": average_score,
        "division_scores": [
            {"name": name, "score": int(round(sum(values) / len(values)))} for name, values in division_scores.items()
        ],
        "status_counts": {status.value: sum(1 for a in current_assignments if a.status == status) for status in AssignmentStatus},
        "pending": {"fill": pending_fill, "review": pending_review, "finalize": pending_finalize},
        "score_source": "manager_score",
        "review_period_count": len(current_cycles),
    }
