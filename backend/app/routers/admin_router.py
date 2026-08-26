from __future__ import annotations

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..auth import hash_password, require_roles
from ..database import get_db
from ..file_storage import TEMPLATE_EXTENSIONS, parse_template_rows, read_table, save_upload
from ..models import Department, Designation, Division, Role, SystemSetting, User
from ..reset_seed import reset_transactional_data
from ..sample_files import ensure_samples
from ..schemas import MasterCreate, ResetIn, SettingsIn, UserCreate, UserOut, UserUpdate
from ..services import audit

router = APIRouter(prefix="/api/admin", tags=["admin"])
admin_roles = require_roles(Role.superadmin, Role.hr)
superadmin_only = require_roles(Role.superadmin)


def _commit_or_conflict(db: Session, message: str):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, message)


@router.get("/masters")
def masters(db: Session = Depends(get_db), _=Depends(admin_roles)):
    divisions = db.scalars(
        select(Division)
        .options(joinedload(Division.departments).joinedload(Department.designations))
        .order_by(Division.name)
    ).unique().all()
    return [
        {
            "id": d.id,
            "name": d.name,
            "departments": [
                {
                    "id": dep.id,
                    "name": dep.name,
                    "designations": [{"id": x.id, "name": x.name} for x in dep.designations],
                }
                for dep in d.departments
            ],
        }
        for d in divisions
    ]


@router.post("/divisions")
def add_division(payload: MasterCreate, db: Session = Depends(get_db), user=Depends(admin_roles)):
    obj = Division(name=payload.name.strip())
    db.add(obj)
    db.flush()
    audit(db, user.id, "create", "division", obj.id, {"name": obj.name})
    _commit_or_conflict(db, "Division already exists")
    return {"id": obj.id, "name": obj.name}


@router.post("/departments")
def add_department(payload: MasterCreate, db: Session = Depends(get_db), user=Depends(admin_roles)):
    if not payload.parent_id:
        raise HTTPException(400, "division parent_id is required")
    if not db.get(Division, payload.parent_id):
        raise HTTPException(404, "Division not found")
    obj = Department(name=payload.name.strip(), division_id=payload.parent_id)
    db.add(obj)
    db.flush()
    audit(db, user.id, "create", "department", obj.id, {"name": obj.name})
    _commit_or_conflict(db, "Department already exists in this division")
    return {"id": obj.id, "name": obj.name}


@router.post("/designations")
def add_designation(payload: MasterCreate, db: Session = Depends(get_db), user=Depends(admin_roles)):
    if not payload.parent_id:
        raise HTTPException(400, "department parent_id is required")
    if not db.get(Department, payload.parent_id):
        raise HTTPException(404, "Department not found")
    obj = Designation(name=payload.name.strip(), department_id=payload.parent_id)
    db.add(obj)
    db.flush()
    audit(db, user.id, "create", "designation", obj.id, {"name": obj.name})
    _commit_or_conflict(db, "Designation already exists in this department")
    return {"id": obj.id, "name": obj.name}


@router.get("/users")
def list_users(db: Session = Depends(get_db), _=Depends(admin_roles)):
    users = db.scalars(
        select(User)
        .options(joinedload(User.designation).joinedload(Designation.department).joinedload(Department.division))
        .order_by(User.name)
    ).all()
    manager_names = {u.id: u.name for u in users}
    return [
        {
            "id": u.id,
            "employee_id": f"EMP-{u.id:04d}",
            "name": u.name,
            "email": u.email,
            "role": u.role.value,
            "manager_id": u.manager_id,
            "manager": manager_names.get(u.manager_id),
            "designation_id": u.designation_id,
            "designation": u.designation.name if u.designation else None,
            "department": u.designation.department.name if u.designation else None,
            "division": u.designation.department.division.name if u.designation else None,
            "active": u.active,
        }
        for u in users
    ]


@router.post("/users", response_model=UserOut)
def add_user(payload: UserCreate, db: Session = Depends(get_db), actor=Depends(admin_roles)):
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(409, "Email already exists")
    try:
        role = Role(payload.role)
    except ValueError:
        raise HTTPException(400, "Invalid role")
    if payload.manager_id and not db.get(User, payload.manager_id):
        raise HTTPException(404, "Manager not found")
    if payload.designation_id and not db.get(Designation, payload.designation_id):
        raise HTTPException(404, "Designation not found")
    user = User(
        name=payload.name.strip(),
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=role,
        manager_id=payload.manager_id,
        designation_id=payload.designation_id,
    )
    db.add(user)
    db.flush()
    audit(db, actor.id, "create", "user", user.id, {"email": user.email})
    db.commit()
    db.refresh(user)
    return user


@router.patch("/users/{user_id}")
def update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db), actor=Depends(admin_roles)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    data = payload.model_dump(exclude_unset=True)
    if "role" in data:
        try:
            data["role"] = Role(data["role"])
        except ValueError:
            raise HTTPException(400, "Invalid role")
    if data.get("manager_id") == user_id:
        raise HTTPException(400, "An employee cannot report to themselves")
    if data.get("manager_id") and not db.get(User, data["manager_id"]):
        raise HTTPException(404, "Manager not found")
    if data.get("designation_id") and not db.get(Designation, data["designation_id"]):
        raise HTTPException(404, "Designation not found")
    for key, value in data.items():
        setattr(user, key, value)
    audit(db, actor.id, "update", "user", user.id, {k: (v.value if isinstance(v, Role) else v) for k, v in data.items()})
    db.commit()
    return {"ok": True}


@router.get("/hierarchy")
def hierarchy(db: Session = Depends(get_db), _=Depends(admin_roles)):
    users = db.scalars(
        select(User)
        .options(joinedload(User.designation).joinedload(Designation.department).joinedload(Department.division))
        .order_by(User.name)
    ).all()
    names = {u.id: u.name for u in users}
    return [
        {
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "role": u.role.value,
            "manager_id": u.manager_id,
            "manager": names.get(u.manager_id),
            "designation": u.designation.name if u.designation else None,
            "department": u.designation.department.name if u.designation else None,
            "division": u.designation.department.division.name if u.designation else None,
        }
        for u in users
    ]


@router.get("/audit-logs")
def audit_logs(db: Session = Depends(get_db), _=Depends(admin_roles)):
    from ..models import AuditLog

    rows = db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(200)).all()
    users = {u.id: u.name for u in db.scalars(select(User)).all()}
    return [
        {
            "id": r.id,
            "actor_id": r.actor_id,
            "actor": users.get(r.actor_id, "System"),
            "action": r.action,
            "entity_type": r.entity_type,
            "entity_id": r.entity_id,
            "details": r.details,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


DEFAULT_SETTINGS = {
    "rating_bands": [
        {"min": 90, "label": "Outstanding"},
        {"min": 80, "label": "Very Good"},
        {"min": 70, "label": "Good"},
        {"min": 60, "label": "Needs Improvement"},
        {"min": 0, "label": "Improvement Required"},
    ],
    "default_choice_map": {"Excellent": 100, "Good": 80, "Average": 60, "Poor": 40, "Not achieved": 0},
    "score_cap_pct": 100,
    "require_evidence_by_default": False,
}


@router.get("/settings")
def get_settings(db: Session = Depends(get_db), _=Depends(admin_roles)):
    rows = {x.key: x.value for x in db.scalars(select(SystemSetting)).all()}
    return {k: rows.get(k, v) for k, v in DEFAULT_SETTINGS.items()}


@router.put("/settings")
def update_settings(payload: SettingsIn, db: Session = Depends(get_db), actor=Depends(admin_roles)):
    data = payload.model_dump(exclude_unset=True, exclude_none=True)
    for key, value in data.items():
        obj = db.get(SystemSetting, key)
        if not obj:
            obj = SystemSetting(key=key, value=value)
            db.add(obj)
        else:
            obj.value = value
    audit(db, actor.id, "update", "system_settings", None, {"keys": list(data)})
    db.commit()
    return {"ok": True}


def _row_get(row: dict, *names: str):
    lookup = {str(k or "").strip().lower(): v for k, v in row.items()}
    for name in names:
        if name.lower() in lookup:
            return lookup[name.lower()]
    return None


def _normalize_role(value: object) -> Role | None:
    raw = str(value or "employee").strip().lower().replace(" ", "")
    aliases = {"superadmin": Role.superadmin, "admin": Role.superadmin, "hr": Role.hr, "manager": Role.manager, "employee": Role.employee, "staff": Role.employee}
    return aliases.get(raw)


@router.post("/import-employees-excel")
async def import_employees_excel(
    file: UploadFile,
    preview: bool = Form(True),
    db: Session = Depends(get_db),
    actor=Depends(admin_roles),
):
    saved = await save_upload(file, TEMPLATE_EXTENSIONS)
    rows = read_table(__import__("pathlib").Path(saved["path"]))
    if not rows:
        raise HTTPException(400, "The workbook contains no employee rows")

    departments = db.scalars(select(Department).options(joinedload(Department.designations))).unique().all()
    users = db.scalars(select(User)).all()
    existing_by_email = {u.email.lower(): u for u in users}
    imported_emails = {str(_row_get(r, "Email") or "").strip().lower() for r in rows if _row_get(r, "Email")}
    prepared = []
    for index, row in enumerate(rows, 2):
        name = str(_row_get(row, "Name", "Employee Name") or "").strip()
        email = str(_row_get(row, "Email", "Email ID") or "").strip().lower()
        department_name = str(_row_get(row, "Department") or "").strip()
        designation_name = str(_row_get(row, "Designation") or "").strip()
        manager_email = str(_row_get(row, "Manager Email", "Reporting Manager Email", "Manager") or "").strip().lower()
        role = _normalize_role(_row_get(row, "Role"))
        password = str(_row_get(row, "Temporary Password", "Password") or "Admin@123").strip()
        errors = []
        if not name:
            errors.append("Name is required")
        if not email or "@" not in email:
            errors.append("Valid email is required")
        if not role:
            errors.append("Role must be employee, manager, HR, or superadmin")
        matching_departments = [d for d in departments if d.name.strip().lower() == department_name.lower()] if department_name else []
        designation = None
        if designation_name:
            candidates = []
            for dep in matching_departments or departments:
                candidates.extend([x for x in dep.designations if x.name.strip().lower() == designation_name.lower()])
            if len(candidates) == 1:
                designation = candidates[0]
            elif not candidates:
                errors.append(f"Designation '{designation_name}' was not found")
            else:
                errors.append(f"Designation '{designation_name}' is ambiguous; include Department")
        if manager_email and manager_email not in existing_by_email and manager_email not in imported_emails:
            errors.append(f"Manager '{manager_email}' was not found")
        status = "error" if errors else ("existing" if email in existing_by_email else "ready")
        prepared.append({
            "row": index,
            "name": name,
            "email": email,
            "role": role.value if role else str(_row_get(row, "Role") or ""),
            "department": department_name,
            "designation": designation_name,
            "designation_id": designation.id if designation else None,
            "manager_email": manager_email,
            "password": password,
            "status": status,
            "errors": errors,
        })

    if preview:
        return {
            "preview": True,
            "file": {k: saved[k] for k in ("file_id", "filename", "url", "size")},
            "total_rows": len(prepared),
            "valid_rows": sum(1 for r in prepared if r["status"] in {"ready", "existing"}),
            "created": 0,
            "skipped": sum(1 for r in prepared if r["status"] == "existing"),
            "rows": [{k: v for k, v in r.items() if k != "password"} for r in prepared],
        }

    invalid = [r for r in prepared if r["status"] == "error"]
    if invalid:
        raise HTTPException(400, f"Fix {len(invalid)} invalid employee row(s) before importing")

    created_users: dict[str, User] = {}
    skipped = 0
    for row in prepared:
        if row["email"] in existing_by_email:
            skipped += 1
            continue
        user = User(
            name=row["name"],
            email=row["email"],
            password_hash=hash_password(row["password"]),
            role=Role(row["role"]),
            designation_id=row["designation_id"],
            active=True,
        )
        db.add(user)
        db.flush()
        created_users[user.email] = user
        audit(db, actor.id, "import_employee", "user", user.id, {"email": user.email})

    all_by_email = {**existing_by_email, **created_users}
    for row in prepared:
        user = created_users.get(row["email"])
        if not user or not row["manager_email"]:
            continue
        manager = all_by_email.get(row["manager_email"])
        if manager and manager.id != user.id:
            user.manager_id = manager.id
    db.commit()
    return {
        "preview": False,
        "total_rows": len(prepared),
        "valid_rows": len(prepared),
        "created": len(created_users),
        "skipped": skipped,
        "rows": [{k: v for k, v in r.items() if k != "password"} for r in prepared],
        "temporary_password_note": "Rows without a password use Admin@123. Change this policy before production rollout if required.",
    }


@router.post("/reset-data")
def reset_all_data(payload: ResetIn, db: Session = Depends(get_db), _=Depends(superadmin_only)):
    if payload.confirm != "RESET":
        raise HTTPException(400, "Type RESET exactly to confirm the data reset")
    counts = reset_transactional_data(db, clear_files=True)
    return {
        "ok": True,
        "message": "Transactional KPI data was reset. Organization, users, templates, masters and scoring settings were preserved.",
        "deleted": counts,
    }


@router.get("/samples/{kind}")
def download_sample(kind: str, _=Depends(admin_roles)):
    samples = ensure_samples()
    if kind not in samples:
        raise HTTPException(404, "Unknown sample file")
    path = samples[kind]
    return FileResponse(path, filename=path.name, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
