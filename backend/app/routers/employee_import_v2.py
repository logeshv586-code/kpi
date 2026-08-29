from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..auth import hash_password, require_roles
from ..database import get_db
from ..file_storage import TEMPLATE_EXTENSIONS, read_table, save_upload
from ..models import Department, Designation, Division, Role, User
from ..services import audit

router = APIRouter(prefix="/api/admin", tags=["admin"])
# Same handler on a non-/admin/ path — some proxies/firewalls block /api/admin/* uploads.
employees_import_router = APIRouter(prefix="/api/employees", tags=["employees"])
admin_roles = require_roles(Role.superadmin, Role.hr)


def _row_get(row: dict, *names: str):
    lookup = {str(k or "").strip().lower(): v for k, v in row.items()}
    for name in names:
        if name.lower() in lookup:
            return lookup[name.lower()]
    return None


def _normalize_role(value: object) -> Role | None:
    raw = str(value or "employee").strip().lower().replace(" ", "").replace("_", "")
    aliases = {
        "superadmin": Role.superadmin,
        "admin": Role.superadmin,
        "hr": Role.hr,
        "manager": Role.manager,
        "employee": Role.employee,
        "staff": Role.employee,
    }
    return aliases.get(raw)


@router.post("/import-employees-excel-v2")
@employees_import_router.post("/import-excel-v2")
async def import_employees_excel_v2(
    file: UploadFile,
    preview: str = Form("true"),
    db: Session = Depends(get_db),
    actor=Depends(admin_roles),
):
    """Import employees using the same labels shown in the current Add Employee UI."""
    try:
        return await _import_employees_excel_v2(file, preview, db, actor)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Duplicate email or employee number already exists in the database") from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(500, f"Employee import failed: {exc}") from exc


async def _import_employees_excel_v2(
    file: UploadFile,
    preview: str,
    db: Session,
    actor: User,
):
    is_preview = preview.lower() not in ("false", "0", "no", "off")
    saved = await save_upload(file, TEMPLATE_EXTENSIONS)
    rows = read_table(Path(saved["path"]))
    if not rows:
        raise HTTPException(400, "The workbook contains no employee rows")

    departments = db.scalars(select(Department).options(joinedload(Department.designations))).unique().all()
    general_division = db.scalar(select(Division).where(Division.name == "General"))
    if not general_division:
        general_division = Division(name="General")
        db.add(general_division)
        db.flush()
    users = db.scalars(select(User)).all()
    existing_by_email = {u.email.strip().lower(): u for u in users if u.email}
    existing_by_employee_no = {
        str(u.employee_no).strip().lower(): u for u in users if u.employee_no
    }

    imported_emails = {
        str(_row_get(r, "Email", "Email ID") or "").strip().lower()
        for r in rows
        if _row_get(r, "Email", "Email ID")
    }
    workbook_employee_nos: set[str] = set()
    prepared = []

    for index, row in enumerate(rows, 2):
        raw_emp_no = _row_get(
            row,
            "Employee No / Unique ID",
            "Employee No",
            "Employee ID",
            "Unique ID",
            "Emp No",
            "Emp ID",
        )
        if raw_emp_no is not None:
            if isinstance(raw_emp_no, float) and raw_emp_no.is_integer():
                employee_no = str(int(raw_emp_no)).strip()
            else:
                employee_no = str(raw_emp_no).strip()
                if employee_no.endswith(".0") and employee_no[:-2].isdigit():
                    employee_no = employee_no[:-2]
        else:
            employee_no = ""

        name = str(_row_get(row, "Full Name", "Name", "Employee Name") or "").strip()
        email = str(_row_get(row, "Email", "Email ID") or "").strip().lower()
        department_name = str(_row_get(row, "Department") or "").strip()
        designation_name = str(_row_get(
            row,
            "Designation / Role",
            "Designation",
            "Role / Designation",
        ) or "").strip()
        manager_email = str(_row_get(
            row,
            "Reporting Manager Email",
            "Manager Email",
            "Reporting Manager",
            "Manager",
        ) or "").strip().lower()
        role = _normalize_role(_row_get(row, "System Role", "Role"))
        password = str(_row_get(row, "Temporary Password", "Password") or "Admin@123").strip()

        errors = []
        if not name:
            errors.append("Full Name is required")
        if not email or "@" not in email:
            errors.append("Valid Email is required")
        if not role:
            errors.append("System Role must be employee, manager, HR, or superadmin")

        employee_no_key = employee_no.lower()
        if employee_no_key:
            existing_employee = existing_by_employee_no.get(employee_no_key)
            if existing_employee and existing_employee.email.strip().lower() != email:
                errors.append(f"Employee No / Unique ID '{employee_no}' already belongs to {existing_employee.email}")
            elif employee_no_key in workbook_employee_nos:
                errors.append(f"Employee No / Unique ID '{employee_no}' is duplicated in this file")
            workbook_employee_nos.add(employee_no_key)

        matching_departments = [
            d for d in departments if d.name.strip().lower() == department_name.lower()
        ] if department_name else []
        if department_name and not matching_departments:
            department = Department(name=department_name, division_id=general_division.id)
            db.add(department)
            db.flush()
            departments.append(department)
            matching_departments = [department]

        designation = None
        if designation_name:
            candidates = []
            for dep in matching_departments or departments:
                candidates.extend([
                    x for x in dep.designations
                    if x.name.strip().lower() == designation_name.lower()
                ])
            if len(candidates) == 1:
                designation = candidates[0]
            elif not candidates and len(matching_departments) == 1:
                designation = Designation(
                    name=designation_name,
                    department_id=matching_departments[0].id,
                )
                db.add(designation)
                db.flush()
                matching_departments[0].designations.append(designation)
            elif not candidates:
                errors.append(f"Designation / Role '{designation_name}' is ambiguous; include Department")
            else:
                errors.append(f"Designation / Role '{designation_name}' is ambiguous; include Department")
        elif department_name:
            errors.append("Designation / Role is required when Department is provided")

        if manager_email and manager_email not in existing_by_email and manager_email not in imported_emails:
            errors.append(f"Reporting Manager '{manager_email}' was not found")

        status = "error" if errors else ("existing" if email in existing_by_email else "ready")
        prepared.append({
            "row": index,
            "employee_no": employee_no,
            "name": name,
            "email": email,
            "role": role.value if role else str(_row_get(row, "System Role", "Role") or ""),
            "department": department_name,
            "designation": designation_name,
            "designation_id": designation.id if designation else None,
            "manager_email": manager_email,
            "password": password,
            "status": status,
            "errors": errors,
        })

    if is_preview:
        return {
            "preview": True,
            "file": {k: saved[k] for k in ("file_id", "filename", "url", "size")},
            "total_rows": len(prepared),
            "valid_rows": sum(1 for r in prepared if r["status"] in {"ready", "existing"}),
            "created": sum(1 for r in prepared if r["status"] == "ready"),
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
            existing_user = existing_by_email[row["email"]]
            if not existing_user.employee_no and row["employee_no"]:
                existing_user.employee_no = row["employee_no"]
            if not existing_user.designation_id and row["designation_id"]:
                existing_user.designation_id = row["designation_id"]
            continue
        user = User(
            employee_no=row["employee_no"] or None,
            name=row["name"],
            email=row["email"],
            password_hash=hash_password(row["password"]),
            role=Role(row["role"]),
            designation_id=row["designation_id"],
            active=True,
        )
        db.add(user)
        db.flush()
        if not user.employee_no:
            user.employee_no = f"EMP-{user.id:04d}"
            db.flush()
        created_users[user.email] = user
        existing_by_employee_no[user.employee_no.lower()] = user
        audit(db, actor.id, "import_employee", "user", user.id, {
            "email": user.email,
            "employee_no": user.employee_no,
        })

    all_by_email = {**existing_by_email, **created_users}
    for row in prepared:
        user = all_by_email.get(row["email"])
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
        "temporary_password_note": "Rows without Temporary Password use Admin@123.",
    }
