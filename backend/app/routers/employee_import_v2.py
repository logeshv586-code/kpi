from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..auth import hash_password, require_roles, verify_password
from ..database import get_db
from ..file_storage import TEMPLATE_EXTENSIONS, read_table, save_upload
from ..models import Department, Designation, Division, KpiTemplate, Role, TemplateStatus, User
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


def _resolve_kpi_template(
    template_name: str,
    active_templates: list[KpiTemplate],
    designation: Designation | None,
    department: Department | None,
) -> tuple[KpiTemplate | None, str | None]:
    if not template_name:
        return None, None

    candidates = [
        template
        for template in active_templates
        if template.name.strip().lower() == template_name.strip().lower()
    ]
    if not candidates:
        return None, f"KPI Template '{template_name}' was not found or is not active"

    if designation:
        exact_designation = [t for t in candidates if t.designation_id == designation.id]
        if len(exact_designation) == 1:
            return exact_designation[0], None
        if len(exact_designation) > 1:
            return None, f"KPI Template '{template_name}' is ambiguous for designation '{designation.name}'"

    if department:
        exact_department = [
            t for t in candidates
            if t.department_id == department.id and t.designation_id is None
        ]
        if len(exact_department) == 1:
            return exact_department[0], None
        if len(exact_department) > 1:
            return None, f"KPI Template '{template_name}' is ambiguous for department '{department.name}'"

    general = [t for t in candidates if t.department_id is None and t.designation_id is None]
    if len(general) == 1:
        return general[0], None
    if len(candidates) == 1:
        return candidates[0], None
    return None, f"KPI Template '{template_name}' is ambiguous; use a template scoped to the employee's designation or department"


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
    active_templates = db.scalars(
        select(KpiTemplate)
        .where(KpiTemplate.status == TemplateStatus.active)
        .options(joinedload(KpiTemplate.department), joinedload(KpiTemplate.designation))
    ).unique().all()
    general_division = db.scalar(select(Division).where(Division.name == "General"))
    if not general_division:
        general_division = Division(name="General")
        db.add(general_division)
        db.flush()
    users = db.scalars(select(User).options(joinedload(User.manager))).all()
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
    workbook_emails: set[str] = set()
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
        template_name = str(_row_get(
            row,
            "KPI Template",
            "KPI Template Name",
            "Assigned KPI Template",
        ) or "").strip()
        manager_email = str(_row_get(
            row,
            "Reporting Manager Email",
            "Manager Email",
            "Reporting Manager",
            "Manager",
        ) or "").strip().lower()
        role = _normalize_role(_row_get(row, "System Role", "Role"))
        password = str(_row_get(row, "Temporary Password", "Password") or "Admin" + "@123").strip()

        errors = []
        if not name:
            errors.append("Full Name is required")
        if not email or "@" not in email:
            errors.append("Valid Email is required")
        if not role:
            errors.append("System Role must be employee, manager, HR, or superadmin")

        employee_no_key = employee_no.lower() if employee_no else ""
        existing_user = None
        if employee_no_key:
            existing_user = existing_by_employee_no.get(employee_no_key)
            if existing_user:
                other_by_email = existing_by_email.get(email)
                if other_by_email and other_by_email.id != existing_user.id:
                    errors.append(f"Email '{email}' already belongs to another employee ({other_by_email.employee_no or other_by_email.name})")
            if employee_no_key in workbook_employee_nos:
                errors.append(f"Employee No / Unique ID '{employee_no}' is duplicated in this file")
            workbook_employee_nos.add(employee_no_key)

        if not existing_user and email in existing_by_email:
            existing_user = existing_by_email[email]
            if employee_no_key:
                other_by_emp = existing_by_employee_no.get(employee_no_key)
                if other_by_emp and other_by_emp.id != existing_user.id:
                    errors.append(f"Employee No / Unique ID '{employee_no}' already belongs to {other_by_emp.email}")

        if email in workbook_emails:
            errors.append(f"Email '{email}' is duplicated in this file")
        workbook_emails.add(email)

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

        employee_department = designation.department if designation else (matching_departments[0] if len(matching_departments) == 1 else None)
        kpi_template = None
        if template_name and role != Role.superadmin:
            kpi_template, template_error = _resolve_kpi_template(
                template_name,
                active_templates,
                designation,
                employee_department,
            )
            if template_error:
                errors.append(template_error)

        if manager_email and manager_email not in existing_by_email and manager_email not in imported_emails:
            errors.append(f"Reporting Manager '{manager_email}' was not found")

        if errors:
            status = "error"
        elif existing_user:
            email_changed = bool(email and existing_user.email.strip().lower() != email)
            name_changed = bool(name and existing_user.name != name)
            role_changed = bool(role and existing_user.role != role)
            desig_changed = bool(designation and existing_user.designation_id != designation.id)
            template_changed = bool(template_name and kpi_template and existing_user.kpi_template_id != kpi_template.id)
            emp_changed = bool(employee_no and existing_user.employee_no != employee_no)
            current_mgr_email = existing_user.manager.email.strip().lower() if existing_user.manager else ""
            mgr_changed = bool(manager_email and current_mgr_email != manager_email)
            raw_pwd = _row_get(row, "Temporary Password", "Password")
            pwd_changed = bool(raw_pwd and str(raw_pwd).strip() and not verify_password(str(raw_pwd).strip(), existing_user.password_hash))
            if email_changed or name_changed or role_changed or desig_changed or template_changed or emp_changed or mgr_changed or pwd_changed:
                status = "update"
            else:
                status = "existing"
        else:
            status = "ready"

        prepared.append({
            "row": index,
            "employee_no": employee_no,
            "name": name,
            "email": email,
            "role": role.value if role else str(_row_get(row, "System Role", "Role") or ""),
            "department": department_name,
            "designation": designation_name,
            "designation_id": designation.id if designation else None,
            "kpi_template": template_name,
            "kpi_template_id": kpi_template.id if kpi_template else None,
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
            "valid_rows": sum(1 for r in prepared if r["status"] in {"ready", "existing", "update"}),
            "created": sum(1 for r in prepared if r["status"] == "ready"),
            "updated": sum(1 for r in prepared if r["status"] == "update"),
            "skipped": sum(1 for r in prepared if r["status"] == "existing"),
            "rows": [{k: v for k, v in r.items() if k != "password"} for r in prepared],
        }

    invalid = [r for r in prepared if r["status"] == "error"]
    if invalid:
        raise HTTPException(400, f"Fix {len(invalid)} invalid employee row(s) before importing")

    created_users: dict[str, User] = {}
    updated_users: dict[str, User] = {}
    skipped = 0
    for row in prepared:
        employee_no_key = row["employee_no"].lower() if row["employee_no"] else ""
        existing_user = existing_by_employee_no.get(employee_no_key) if employee_no_key else None
        if not existing_user and row["email"]:
            existing_user = existing_by_email.get(row["email"])

        if existing_user:
            user_changed = False
            # 0. Update Email
            if row["email"] and existing_user.email.strip().lower() != row["email"]:
                old_email = existing_user.email.strip().lower()
                existing_user.email = row["email"]
                if old_email in existing_by_email:
                    del existing_by_email[old_email]
                existing_by_email[row["email"]] = existing_user
                user_changed = True

            # 1. Update Name
            if row["name"] and existing_user.name != row["name"]:
                existing_user.name = row["name"]
                user_changed = True

            # 2. Update Employee No / Unique ID
            if row["employee_no"] and existing_user.employee_no != row["employee_no"]:
                existing_user.employee_no = row["employee_no"]
                existing_by_employee_no[row["employee_no"].lower()] = existing_user
                user_changed = True

            # 3. Update Designation / Department
            if row["designation_id"] and existing_user.designation_id != row["designation_id"]:
                existing_user.designation_id = row["designation_id"]
                user_changed = True

            # 4. Update KPI Template if specified in Excel
            if row["kpi_template"] and row["kpi_template_id"] and existing_user.kpi_template_id != row["kpi_template_id"]:
                existing_user.kpi_template_id = row["kpi_template_id"]
                user_changed = True

            # 5. Update System Role
            if row["role"]:
                new_role = Role(row["role"])
                if existing_user.role != new_role:
                    if existing_user.role != Role.superadmin or actor.role == Role.superadmin:
                        existing_user.role = new_role
                        user_changed = True

            # 6. Update Password (only if explicitly provided in file and different)
            raw_pwd = _row_get(row, "Temporary Password", "Password")
            if raw_pwd and str(raw_pwd).strip():
                pwd_text = str(raw_pwd).strip()
                if not verify_password(pwd_text, existing_user.password_hash):
                    existing_user.password_hash = hash_password(pwd_text)
                    user_changed = True

            if user_changed:
                updated_users[existing_user.email] = existing_user
                audit(db, actor.id, "update_employee", "user", existing_user.id, {
                    "email": existing_user.email,
                    "employee_no": existing_user.employee_no,
                    "name": existing_user.name,
                    "designation_id": existing_user.designation_id,
                    "kpi_template_id": existing_user.kpi_template_id,
                    "role": existing_user.role.value,
                })
            else:
                skipped += 1
            continue

        user = User(
            employee_no=row["employee_no"] or None,
            name=row["name"],
            email=row["email"],
            password_hash=hash_password(row["password"]),
            role=Role(row["role"]),
            designation_id=row["designation_id"],
            kpi_template_id=row["kpi_template_id"],
            active=True,
        )
        db.add(user)
        db.flush()
        if not user.employee_no:
            user.employee_no = f"EMP-{user.id:04d}"
            db.flush()
        created_users[user.email] = user
        existing_by_employee_no[user.employee_no.lower()] = user
        existing_by_email[user.email.lower()] = user
        audit(db, actor.id, "import_employee", "user", user.id, {
            "email": user.email,
            "employee_no": user.employee_no,
            "kpi_template_id": user.kpi_template_id,
        })

    all_by_email = {**existing_by_email, **created_users}
    for row in prepared:
        user = all_by_email.get(row["email"])
        if not user and row["employee_no"]:
            user = existing_by_employee_no.get(row["employee_no"].lower())
        if not user or not row["manager_email"]:
            continue
        manager = all_by_email.get(row["manager_email"])
        if manager and manager.id != user.id and user.manager_id != manager.id:
            user.manager_id = manager.id
            if user.email not in created_users and user.email not in updated_users:
                updated_users[user.email] = user
                if skipped > 0:
                    skipped -= 1

    db.commit()
    return {
        "preview": False,
        "total_rows": len(prepared),
        "valid_rows": len(prepared),
        "created": len(created_users),
        "updated": len(updated_users),
        "skipped": skipped,
        "rows": [{k: v for k, v in r.items() if k != "password"} for r in prepared],
        "temporary_password_note": "Rows without Temporary Password use the system default temporary password.",
    }
