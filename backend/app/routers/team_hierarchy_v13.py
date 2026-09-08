from __future__ import annotations

from collections import defaultdict, deque

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..auth import get_current_user
from ..database import get_db
from ..models import AssignmentStatus, Department, Designation, Role, User
from . import kpi_router
from . import kpi_v2_enhancements as v13
from . import relationship_review_override as review


# ---------------------------------------------------------------------------
# Recursive reporting hierarchy
# ---------------------------------------------------------------------------


def _active_users(db: Session) -> list[User]:
    return db.scalars(
        select(User)
        .where(User.active.is_(True))
        .options(
            joinedload(User.manager),
            joinedload(User.designation)
            .joinedload(Designation.department)
            .joinedload(Department.division),
        )
        .order_by(User.name)
    ).unique().all()


def _children_map(users: list[User]) -> dict[int, list[int]]:
    children: dict[int, list[int]] = defaultdict(list)
    for employee in users:
        if employee.manager_id is not None:
            children[int(employee.manager_id)].append(int(employee.id))
    return children


def _levels_from(root_ids: list[int], children: dict[int, list[int]]) -> dict[int, int]:
    levels: dict[int, int] = {}
    queue = deque((root_id, 0) for root_id in root_ids)
    while queue:
        user_id, level = queue.popleft()
        if user_id in levels and levels[user_id] <= level:
            continue
        levels[user_id] = level
        for child_id in children.get(user_id, []):
            queue.append((child_id, level + 1))
    return levels


def _visible_structure(db: Session, viewer: User):
    users = _active_users(db)
    by_id = {u.id: u for u in users}
    children = _children_map(users)

    if viewer.role in {Role.superadmin, Role.hr}:
        visible_ids = set(by_id)
        roots = [u.id for u in users if u.manager_id is None or u.manager_id not in visible_ids]
        levels = _levels_from(roots, children)
        scope = "organization"
    else:
        visible_ids = v13._descendant_ids(db, viewer.id) | {viewer.id}
        roots = [viewer.id]
        levels = _levels_from(roots, children)
        scope = "descendants" if len(visible_ids) > 1 else "self"

    return users, by_id, children, visible_ids, roots, levels, scope


def _person_row(person: User, viewer: User, level: int) -> dict:
    designation = person.designation
    department = designation.department if designation else None
    division = department.division if department else None
    if person.id == viewer.id:
        relation = "self"
    elif person.manager_id == viewer.id:
        relation = "direct_report"
    else:
        relation = "descendant"
    return {
        "id": person.id,
        "employee_no": person.employee_no or f"EMP-{person.id:04d}",
        "name": person.name,
        "email": person.email,
        "role": person.role.value,
        "designation": designation.name if designation else None,
        "department": department.name if department else None,
        "division": division.name if division else None,
        "manager_id": person.manager_id,
        "manager_name": person.manager.name if person.manager else None,
        "hierarchy_level": level,
        "relation": relation,
        # Visibility and approval are intentionally different. Senior leaders
        # can see descendants; only the immediate reporting manager can review.
        "can_review": bool(person.id != viewer.id and (viewer.role in {Role.superadmin, Role.hr} or person.manager_id == viewer.id)),
    }


def _build_tree(root_ids: list[int], visible_ids: set[int], by_id: dict[int, User], children: dict[int, list[int]], viewer: User, levels: dict[int, int]) -> list[dict]:
    def node(user_id: int) -> dict:
        person = by_id[user_id]
        row = _person_row(person, viewer, levels.get(user_id, 0))
        row["children"] = [
            node(child_id)
            for child_id in children.get(user_id, [])
            if child_id in visible_ids
        ]
        return row

    return [node(root_id) for root_id in root_ids if root_id in visible_ids]


@kpi_router.router.get("/team-tree")
def team_tree(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    users, by_id, children, visible_ids, roots, levels, scope = _visible_structure(db, user)
    flat = [
        _person_row(person, user, levels.get(person.id, 0))
        for person in users
        if person.id in visible_ids
    ]
    flat.sort(key=lambda row: (row["hierarchy_level"], row["name"].lower()))
    return {
        "viewer_id": user.id,
        "scope": scope,
        "count": len(flat),
        "flat": flat,
        "tree": _build_tree(roots, visible_ids, by_id, children, user, levels),
    }


# ---------------------------------------------------------------------------
# KPI Input scope: ensure /api/kpi/my exposes every descendant, not only the
# first reporting level.  Keep immediate-manager review authority unchanged.
# ---------------------------------------------------------------------------

v13._remove_route(kpi_router.router, "/api/kpi/my", {"GET"})


@kpi_router.router.get("/my")
def hierarchy_my_assignments(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = v13.enhanced_my_assignments(db, user)
    _, _, _, visible_ids, _, levels, scope = _visible_structure(db, user)
    for row in rows:
        employee_id = int(row["employee_id"])
        row["hierarchy_level"] = levels.get(employee_id, 0)
        row["visibility_scope"] = (
            "self" if employee_id == user.id
            else "direct_report" if row.get("manager_id") == user.id
            else "descendant"
        )
        row["team_scope"] = scope
        # A senior manager may view a descendant but cannot overwrite the
        # immediate manager's review.
        row["can_review"] = bool(
            employee_id != user.id
            and (user.role in {Role.superadmin, Role.hr} or row.get("manager_id") == user.id)
        )
    return rows


# ---------------------------------------------------------------------------
# Backward-compatible Super Admin draft editing.
# The older regression suite expects Super Admin to be able to enter/correct
# employee draft answers before submission. Direct/senior managers remain
# unable to do this; they only enter Manager Score after employee submission.
# ---------------------------------------------------------------------------

_base_relationship_save = review.relationship_save_responses


def superadmin_compatible_save(assignment_id, payload, db, user):
    assignment = review._load_assignment(db, assignment_id)
    if (
        assignment
        and user.role == Role.superadmin
        and assignment.status in {AssignmentStatus.not_started, AssignmentStatus.draft}
    ):
        return kpi_router.save_response(assignment_id, payload, db, user)
    return _base_relationship_save(assignment_id, payload, db, user)


review.relationship_save_responses = superadmin_compatible_save
