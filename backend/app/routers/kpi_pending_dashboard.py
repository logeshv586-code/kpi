from collections import defaultdict

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..auth import get_current_user
from ..database import get_db
from ..models import AssignmentStatus, CycleStatus, KpiAssignment, Role, User
from . import kpi_router
from .kpi_v2_enhancements import _descendant_ids, _financial_year


@kpi_router.router.get("/pending-summary")
def pending_summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    stmt = (
        select(KpiAssignment)
        .join(KpiAssignment.cycle)
        .where(KpiAssignment.cycle.has(status=CycleStatus.running))
        .options(
            joinedload(KpiAssignment.user).joinedload(User.manager),
            joinedload(KpiAssignment.cycle),
        )
    )
    if user.role not in {Role.superadmin, Role.hr}:
        visible_ids = _descendant_ids(db, user.id) | {user.id}
        stmt = stmt.where(KpiAssignment.user_id.in_(visible_ids))
    rows = db.scalars(stmt).unique().all()

    counts = {status.value: 0 for status in AssignmentStatus}
    periods = defaultdict(lambda: {"not_started": 0, "draft": 0, "submitted": 0, "manager_reviewed": 0, "finalized": 0, "total": 0})
    pending_rows = []

    for assignment in rows:
        status = assignment.status.value
        counts[status] += 1
        label = assignment.cycle.period_label or assignment.cycle.name
        bucket = periods[label]
        bucket[status] += 1
        bucket["total"] += 1
        if assignment.status in {AssignmentStatus.not_started, AssignmentStatus.draft, AssignmentStatus.submitted, AssignmentStatus.manager_reviewed}:
            pending_rows.append({
                "assignment_id": assignment.id,
                "employee": assignment.user.name,
                "email": assignment.user.email,
                "manager": assignment.user.manager.name if assignment.user.manager else None,
                "period": label,
                "review_type": assignment.cycle.review_type or "monthly",
                "financial_year": assignment.cycle.financial_year or _financial_year(assignment.cycle.month),
                "status": status,
            })

    return {
        "counts": counts,
        "pending_staff": counts["not_started"] + counts["draft"],
        "pending_manager_review": counts["submitted"],
        "ready_for_hr": counts["manager_reviewed"],
        "finalized": counts["finalized"],
        "periods": [{"period": label, **value} for label, value in sorted(periods.items())],
        "rows": sorted(pending_rows, key=lambda row: (row["period"], row["employee"])),
    }
