from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from ..auth import get_current_user, require_roles
from ..database import get_db
from ..models import AssignmentStatus, CycleStatus, Department, Designation, KpiAssignment, KpiCycle, KpiTemplate, Kra, Role, SystemSetting, User

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _visible_assignments(db: Session, user: User):
    rows = db.scalars(
        select(KpiAssignment)
        .options(
            joinedload(KpiAssignment.user)
            .joinedload(User.designation)
            .joinedload(Designation.department)
            .joinedload(Department.division),
            joinedload(KpiAssignment.cycle),
        )
    ).all()
    if user.role == Role.employee:
        return [a for a in rows if a.user_id == user.id]
    if user.role == Role.manager:
        return [a for a in rows if a.user_id == user.id or a.user.manager_id == user.id]
    return rows


@router.get("/summary")
def summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    running_cycles = db.scalars(select(KpiCycle).where(KpiCycle.status == CycleStatus.running).order_by(KpiCycle.month.desc())).all()
    running = len(running_cycles)
    assignments = _visible_assignments(db, user)
    current_cycle = running_cycles[0] if running_cycles else db.scalar(select(KpiCycle).order_by(KpiCycle.month.desc()).limit(1))
    current_assignments = [a for a in assignments if current_cycle and a.cycle_id == current_cycle.id]
    if user.role in {Role.superadmin, Role.hr}:
        total_employees = db.scalar(select(func.count(User.id)).where(User.active.is_(True))) or 0
    else:
        visible_people = {a.user_id for a in current_assignments or assignments}
        visible_people.add(user.id)
        total_employees = len(visible_people)
    submitted = [a for a in current_assignments if a.status in {AssignmentStatus.submitted, AssignmentStatus.manager_reviewed, AssignmentStatus.finalized}]
    if user.role == Role.employee:
        pending_fill = sum(1 for a in current_assignments if a.user_id == user.id and a.status in {AssignmentStatus.not_started, AssignmentStatus.draft})
        pending_review = 0
        pending_finalize = 0
    elif user.role == Role.manager:
        pending_fill = sum(1 for a in current_assignments if a.user_id == user.id and a.status in {AssignmentStatus.not_started, AssignmentStatus.draft})
        pending_review = sum(1 for a in current_assignments if a.user.manager_id == user.id and a.status == AssignmentStatus.submitted)
        pending_finalize = 0
    else:
        pending_fill = sum(1 for a in current_assignments if a.status in {AssignmentStatus.not_started, AssignmentStatus.draft})
        pending_review = sum(1 for a in current_assignments if a.status == AssignmentStatus.submitted)
        pending_finalize = sum(1 for a in current_assignments if a.status == AssignmentStatus.manager_reviewed or (a.status == AssignmentStatus.submitted and not a.user.manager_id))
    score_rows = [a.final_score if a.final_score is not None else a.calculated_score for a in current_assignments if (a.final_score is not None or a.calculated_score > 0)]
    division_scores = defaultdict(list)
    for a in current_assignments:
        if a.user.designation:
            div = a.user.designation.department.division.name
            score = a.final_score if a.final_score is not None else a.calculated_score
            if score > 0:
                division_scores[div].append(score)
    return {
        "total_employees": total_employees,
        "running_cycles": running,
        "current_cycle": current_cycle.name if current_cycle else None,
        "submission_rate": round((len(submitted) / len(current_assignments) * 100) if current_assignments else 0, 1),
        "average_score": round(sum(score_rows) / len(score_rows), 1) if score_rows else 0,
        "division_scores": [{"name": k, "score": round(sum(v) / len(v), 1)} for k, v in division_scores.items()],
        "status_counts": {s.value: sum(1 for a in current_assignments if a.status == s) for s in AssignmentStatus},
        "pending": {"fill": pending_fill, "review": pending_review, "finalize": pending_finalize},
    }


@router.get("/history/{user_id}")
def history(user_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Employee not found")
    if user.role == Role.employee and user.id != user_id:
        raise HTTPException(403, "Forbidden")
    if user.role == Role.manager and target.manager_id != user.id and target.id != user.id:
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
            "score": a.final_score if a.final_score is not None else a.calculated_score,
            "status": a.status.value,
        }
        for a in rows
    ]


@router.get("/monthly-matrix")
def monthly_matrix(db: Session = Depends(get_db), _=Depends(require_roles(Role.superadmin, Role.hr))):
    rows = db.scalars(
        select(KpiAssignment)
        .options(
            joinedload(KpiAssignment.user).joinedload(User.designation).joinedload(Designation.department).joinedload(Department.division),
            joinedload(KpiAssignment.cycle),
        )
        .order_by(KpiAssignment.user_id, KpiAssignment.id)
    ).all()
    matrix = defaultdict(dict)
    info = {}
    months = []
    for a in rows:
        label = a.cycle.month.strftime("%b %Y")
        if label not in months:
            months.append(label)
        division = a.user.designation.department.division.name if a.user.designation else "Corporate"
        info[a.user_id] = {"employee": a.user.name, "division": division}
        matrix[a.user_id][label] = a.final_score if a.final_score is not None else a.calculated_score
    return {
        "months": months,
        "rows": [
            {"user_id": uid, "employee": info[uid]["employee"], "division": info[uid]["division"], "scores": matrix[uid]}
            for uid in info
        ],
    }



def _can_view_user(viewer: User, target: User) -> bool:
    if viewer.role in {Role.superadmin, Role.hr}:
        return True
    if viewer.role == Role.manager:
        return target.id == viewer.id or target.manager_id == viewer.id
    return target.id == viewer.id


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
    scores = {r.kpi_item_id: float(r.score or 0) for r in assignment.responses}
    rows = []
    for kra in assignment.template.kras:
        score = round(sum(scores.get(i.id, 0) for i in kra.items), 2)
        rows.append({"kra": kra.name, "score": score, "weight": kra.weight, "percent": round(score / kra.weight * 100, 1) if kra.weight else 0})
    return {
        "assignment_id": assignment.id,
        "cycle_id": assignment.cycle_id,
        "cycle": assignment.cycle.name,
        "employee": target.name,
        "final_score": assignment.final_score if assignment.final_score is not None else assignment.calculated_score,
        "rows": rows,
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
