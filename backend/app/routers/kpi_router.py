from datetime import datetime
import csv
import io
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..auth import get_current_user, require_roles
from ..database import get_db, settings
from ..mail import send_email
from ..file_storage import TEMPLATE_EXTENSIONS, parse_response_rows, parse_template_rows, save_upload, upload_metadata
from ..importing import create_template_from_import_rows, match_response_rows
from ..models import (
    AssignmentStatus,
    CycleStatus,
    Department,
    Designation,
    Division,
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
from ..schemas import AssignmentIn, AutoAssignIn, CycleIn, CycleUpdate, ReopenIn, ResponseIn, ReviewIn, TemplateImportIn, TemplateIn
from ..services import audit, calculate_achievement_percent, item_config, recalc_assignment, validate_template

router = APIRouter(prefix="/api/kpi", tags=["kpi"])
admin_roles = require_roles(Role.superadmin, Role.hr)
review_roles = require_roles(Role.superadmin, Role.hr, Role.manager)


def _validate_scope(payload: TemplateIn, db: Session):
    if payload.designation_id:
        designation = db.scalar(select(Designation).where(Designation.id == payload.designation_id))
        if not designation:
            raise HTTPException(400, "Selected role was not found")
        if payload.department_id and payload.department_id != designation.department_id:
            raise HTTPException(400, "Selected role does not belong to the selected department")
        if payload.division_id and payload.division_id != designation.department.division_id:
            raise HTTPException(400, "Selected role does not belong to the selected division")
    if payload.department_id:
        department = db.scalar(select(Department).where(Department.id == payload.department_id))
        if not department:
            raise HTTPException(400, "Selected department was not found")
        if payload.division_id and payload.division_id != department.division_id:
            raise HTTPException(400, "Selected department does not belong to the selected division")
    if payload.division_id and not db.scalar(select(Division).where(Division.id == payload.division_id)):
        raise HTTPException(400, "Selected division was not found")


def _template_matches_employee(template: KpiTemplate, employee: User):
    designation = employee.designation
    department = designation.department if designation else None
    division = department.division if department else None
    if template.designation_id and (not designation or template.designation_id != designation.id):
        return False
    if template.department_id and (not department or template.department_id != department.id):
        return False
    if template.division_id and (not division or template.division_id != division.id):
        return False
    return True


def _template_scope_rank(template: KpiTemplate):
    return (bool(template.designation_id), bool(template.department_id), bool(template.division_id))


def template_json(t: KpiTemplate):
    # Older templates only stored designation_id. Derive the full hierarchy
    # for them so filters and assignment continue to work consistently.
    scope_department = t.department or (t.designation.department if t.designation else None)
    scope_division = t.division or (scope_department.division if scope_department else None)
    return {
        "id": t.id,
        "name": t.name,
        "division_id": t.division_id,
        "division": scope_division.name if scope_division else None,
        "department_id": t.department_id,
        "department": scope_department.name if scope_department else None,
        "designation_id": t.designation_id,
        "designation": t.designation.name if t.designation else None,
        "status": t.status.value,
        "version": t.version,
        "total_weight": round(sum(k.weight for k in t.kras), 2),
        "validation": {
            "publishable": validate_template(t, strict=True)[0],
            "message": validate_template(t, strict=True)[1],
        },
        "kras": [
            {
                "id": k.id,
                "name": k.name,
                "weight": k.weight,
                "items": [
                    {
                        "id": i.id,
                        "question": i.question,
                        "input_type": i.input_type,
                        "weight": i.weight,
                        "target_value": i.target_value,
                        "direction": i.direction,
                        "options": i.options,
                        "config": item_config(i),
                    }
                    for i in k.items
                ],
            }
            for k in t.kras
        ],
    }


def _load_template(db: Session, template_id: int):
    return db.scalar(
        select(KpiTemplate)
        .where(KpiTemplate.id == template_id)
        .options(joinedload(KpiTemplate.division), joinedload(KpiTemplate.department), joinedload(KpiTemplate.designation), joinedload(KpiTemplate.kras).joinedload(Kra.items))
    )


def _load_assignment(db: Session, assignment_id: int):
    return db.scalar(
        select(KpiAssignment)
        .where(KpiAssignment.id == assignment_id)
        .options(
            joinedload(KpiAssignment.user),
            joinedload(KpiAssignment.cycle),
            joinedload(KpiAssignment.template).joinedload(KpiTemplate.designation),
            joinedload(KpiAssignment.template).joinedload(KpiTemplate.kras).joinedload(Kra.items),
            joinedload(KpiAssignment.responses),
        )
    )


def _can_view_assignment(user: User, a: KpiAssignment):
    if user.role in {Role.superadmin, Role.hr}:
        return True
    if user.role == Role.manager:
        return a.user_id == user.id or a.user.manager_id == user.id
    return a.user_id == user.id


def _notify(user: User | None, subject: str, body: str):
    if not user:
        return
    try:
        send_email(user.email, subject, body)
    except Exception:
        # Email is best-effort and must never block KPI workflow.
        pass


@router.get("/templates")
def templates(db: Session = Depends(get_db), _=Depends(get_current_user)):
    items = db.scalars(
        select(KpiTemplate)
        .options(joinedload(KpiTemplate.division), joinedload(KpiTemplate.department), joinedload(KpiTemplate.designation), joinedload(KpiTemplate.kras).joinedload(Kra.items))
        .order_by(KpiTemplate.id.desc())
    ).unique().all()
    return [template_json(t) for t in items]


@router.post("/templates")
def create_template(payload: TemplateIn, db: Session = Depends(get_db), user=Depends(admin_roles)):
    _validate_scope(payload, db)
    t = KpiTemplate(name=payload.name.strip(), division_id=payload.division_id, department_id=payload.department_id, designation_id=payload.designation_id, status=TemplateStatus.draft)
    db.add(t)
    db.flush()
    for kra_in in payload.kras:
        kra = Kra(template_id=t.id, name=kra_in.name.strip(), weight=kra_in.weight)
        db.add(kra)
        db.flush()
        for item in kra_in.items:
            db.add(KpiItem(kra_id=kra.id, **item.model_dump()))
    db.flush()
    t = _load_template(db, t.id)
    valid, msg = validate_template(t, strict=False)
    if not valid:
        db.rollback()
        raise HTTPException(400, msg)
    audit(db, user.id, "create", "kpi_template", t.id, {"version": t.version})
    db.commit()
    return template_json(t)


@router.put("/templates/{template_id}")
def update_template(template_id: int, payload: TemplateIn, db: Session = Depends(get_db), user=Depends(admin_roles)):
    t = _load_template(db, template_id)
    if not t:
        raise HTTPException(404, "Template not found")
    if t.status != TemplateStatus.draft:
        raise HTTPException(409, "Published templates are locked. Create a new version before editing.")
    t.name = payload.name.strip()
    _validate_scope(payload, db)
    t.division_id = payload.division_id
    t.department_id = payload.department_id
    t.designation_id = payload.designation_id
    for kra in list(t.kras):
        db.delete(kra)
    db.flush()
    for kra_in in payload.kras:
        kra = Kra(template_id=t.id, name=kra_in.name.strip(), weight=kra_in.weight)
        db.add(kra)
        db.flush()
        for item in kra_in.items:
            db.add(KpiItem(kra_id=kra.id, **item.model_dump()))
    db.flush()
    t = _load_template(db, t.id)
    valid, msg = validate_template(t, strict=False)
    if not valid:
        db.rollback()
        raise HTTPException(400, msg)
    audit(db, user.id, "update", "kpi_template", t.id, {"version": t.version})
    db.commit()
    return template_json(t)


@router.post("/templates/{template_id}/unpublish")
def unpublish_template(template_id: int, db: Session = Depends(get_db), user=Depends(admin_roles)):
    """Move an unused active template back to draft so HR can edit it."""
    t = _load_template(db, template_id)
    if not t:
        raise HTTPException(404, "Template not found")
    if t.status != TemplateStatus.active:
        raise HTTPException(409, "Only an active template can be unpublished.")
    assignments = db.scalar(select(func.count(KpiAssignment.id)).where(KpiAssignment.template_id == template_id)) or 0
    if assignments:
        raise HTTPException(409, "This template is already assigned. Use Edit target to create a safe editable version.")
    t.status = TemplateStatus.draft
    audit(db, user.id, "unpublish", "kpi_template", t.id, {"version": t.version})
    db.commit()
    return {"ok": True, "status": t.status.value}


@router.delete("/templates/{template_id}")
def delete_template(template_id: int, db: Session = Depends(get_db), user=Depends(admin_roles)):
    """Remove a template that has never been used by an assignment."""
    t = _load_template(db, template_id)
    if not t:
        raise HTTPException(404, "Template not found")
    assignments = db.scalar(select(func.count(KpiAssignment.id)).where(KpiAssignment.template_id == template_id)) or 0
    if assignments:
        raise HTTPException(409, "This template cannot be removed because it has KPI assignments.")
    status = t.status.value
    db.delete(t)
    audit(db, user.id, "delete", "kpi_template", template_id, {"status": status})
    db.commit()
    return {"ok": True}


@router.post("/templates/import-csv")
def import_template_csv(payload: TemplateImportIn, db: Session = Depends(get_db), user=Depends(admin_roles)):
    """Import a KRA/KPI CSV into an editable draft template.

    Expected columns are flexible but ``KRA`` and ``KPI`` are preferred. A KPI
    cell may contain multiple bullet/newline items. When the source has no
    weightage, the importer distributes provisional weights to exactly 100 and
    tags the parameters so HR knows to review them before publishing.
    """
    reader = csv.DictReader(io.StringIO(payload.csv_text.strip()))
    rows = list(reader)
    if not rows:
        raise HTTPException(400, "CSV contains no rows")

    def get(row, *names):
        lowered = {str(k).strip().lower(): (v or "") for k, v in row.items()}
        for name in names:
            if name.lower() in lowered:
                return str(lowered[name.lower()]).strip()
        return ""

    parsed = []
    for row in rows:
        kra_name = get(row, "KRA", "Key Result Area", "Goal")
        kpi_text = get(row, "KPI", "Key Performance Indicator", "Parameter")
        if not kra_name or not kpi_text:
            continue
        measurement = get(row, "Measurement", "Measure")
        target = get(row, "Target")
        frequency = get(row, "Frequency")
        bullets = []
        for line in kpi_text.replace("•", "\n").splitlines():
            clean = line.strip(" \t-–—•")
            if clean:
                bullets.append(clean)
        if not bullets:
            bullets = [kpi_text]
        parsed.append({"kra": kra_name, "items": bullets, "measurement": measurement, "target": target, "frequency": frequency})
    if not parsed:
        raise HTTPException(400, "Could not find KRA/KPI rows. Use columns named KRA and KPI.")

    # Exact 100 split with two decimal precision; any remainder is applied to the last row.
    kra_count = len(parsed)
    base = round(100 / kra_count, 2)
    kra_weights = [base] * kra_count
    kra_weights[-1] = round(100 - sum(kra_weights[:-1]), 2)

    t = KpiTemplate(name=payload.name.strip(), designation_id=payload.designation_id, status=TemplateStatus.draft)
    db.add(t); db.flush()
    default_score_map = {"Excellent": 100, "Good": 80, "Average": 60, "Poor": 40, "Not achieved": 0}
    for idx, row in enumerate(parsed):
        kw = kra_weights[idx]
        k = Kra(template_id=t.id, name=row["kra"], weight=kw); db.add(k); db.flush()
        count = len(row["items"])
        per = round(kw / count, 2)
        item_weights = [per] * count
        item_weights[-1] = round(kw - sum(item_weights[:-1]), 2)
        target_num = None
        if row["target"]:
            try:
                target_num = float(row["target"].replace("%", "").replace(",", ""))
            except ValueError:
                target_num = None
        for j, question in enumerate(row["items"]):
            input_type = "percentage" if target_num is not None else "choice"
            options = {
                "score_map": default_score_map if input_type == "choice" else {},
                "meta": {
                    "frequency": row["frequency"] or "Monthly / as configured",
                    "measurement": row["measurement"],
                    "source": "CSV import",
                    "weight_basis": "Provisional auto-balanced weight; HR should review",
                    "scoring_method": "target_ratio",
                    "score_cap_pct": 100,
                    "evidence_required": False,
                },
            }
            db.add(KpiItem(kra_id=k.id, question=question, input_type=input_type, weight=item_weights[j], target_value=target_num, direction="higher", options=options))
    audit(db, user.id, "import_csv", "kpi_template", t.id, {"rows": len(parsed), "provisional_weights": True})
    db.commit()
    return template_json(_load_template(db, t.id))


@router.post("/templates/import-excel")
async def import_template_excel(
    file: UploadFile,
    name: str = Form(...),
    designation_id: int | None = Form(None),
    db: Session = Depends(get_db),
    user=Depends(admin_roles),
):
    saved = await save_upload(file, TEMPLATE_EXTENSIONS)
    rows = parse_template_rows(Path(saved["path"]))
    template = create_template_from_import_rows(
        db,
        name=name,
        designation_id=designation_id,
        rows=rows,
        source=f"Excel import: {saved['filename']}",
    )
    valid, message = validate_template(template, strict=False)
    if not valid:
        db.rollback()
        raise HTTPException(400, message)
    audit(db, user.id, "import_excel", "kpi_template", template.id, {"rows": len(rows), "file_id": saved["file_id"]})
    db.commit()
    return template_json(_load_template(db, template.id))


@router.post("/templates/{template_id}/publish")
def publish(template_id: int, db: Session = Depends(get_db), user=Depends(admin_roles)):
    t = _load_template(db, template_id)
    if not t:
        raise HTTPException(404, "Template not found")
    valid, msg = validate_template(t, strict=True)
    if not valid:
        raise HTTPException(400, msg)
    previous = db.scalars(
        select(KpiTemplate).where(
            KpiTemplate.id != t.id,
            KpiTemplate.name == t.name,
            KpiTemplate.division_id == t.division_id,
            KpiTemplate.department_id == t.department_id,
            KpiTemplate.designation_id == t.designation_id,
            KpiTemplate.status == TemplateStatus.active,
        )
    ).all()
    for old in previous:
        old.status = TemplateStatus.archived
    t.status = TemplateStatus.active
    audit(db, user.id, "publish", "kpi_template", t.id, {"version": t.version, "archived_versions": [x.id for x in previous]})
    
    # Auto-assign newly published template to matching active users for running cycles
    running_cycles = db.scalars(select(KpiCycle).where(KpiCycle.status == CycleStatus.running)).all()
    if running_cycles:
        active_users = db.scalars(
            select(User)
            .where(User.active.is_(True))
            .options(joinedload(User.designation).joinedload(Designation.department).joinedload(Department.division))
        ).unique().all()
        for cycle in running_cycles:
            for emp in active_users:
                if emp.role == Role.superadmin:
                    continue
                if _template_matches_employee(t, emp):
                    existing = db.scalar(select(KpiAssignment).where(KpiAssignment.cycle_id == cycle.id, KpiAssignment.user_id == emp.id))
                    if not existing:
                        db.add(KpiAssignment(cycle_id=cycle.id, user_id=emp.id, template_id=t.id))
    db.commit()
    return {"ok": True}


@router.post("/templates/{template_id}/new-version")
def new_version(template_id: int, db: Session = Depends(get_db), user=Depends(admin_roles)):
    old = _load_template(db, template_id)
    if not old:
        raise HTTPException(404, "Template not found")
    clone = KpiTemplate(name=old.name, division_id=old.division_id, department_id=old.department_id, designation_id=old.designation_id, status=TemplateStatus.draft, version=old.version + 1)
    db.add(clone)
    db.flush()
    for old_kra in old.kras:
        new_kra = Kra(template_id=clone.id, name=old_kra.name, weight=old_kra.weight)
        db.add(new_kra)
        db.flush()
        for old_item in old_kra.items:
            db.add(
                KpiItem(
                    kra_id=new_kra.id,
                    question=old_item.question,
                    input_type=old_item.input_type,
                    weight=old_item.weight,
                    target_value=old_item.target_value,
                    direction=old_item.direction,
                    options=old_item.options,
                )
            )
    audit(db, user.id, "version", "kpi_template", clone.id, {"from_template_id": old.id, "version": clone.version})
    db.commit()
    return template_json(_load_template(db, clone.id))


@router.get("/cycles")
def cycles(db: Session = Depends(get_db), _=Depends(get_current_user)):
    rows = db.scalars(select(KpiCycle).order_by(KpiCycle.month.desc())).all()
    return [
        {"id": c.id, "name": c.name, "month": c.month, "start_date": c.start_date, "end_date": c.end_date, "status": c.status.value}
        for c in rows
    ]


@router.post("/cycles")
def create_cycle(payload: CycleIn, db: Session = Depends(get_db), user=Depends(admin_roles)):
    try:
        status = CycleStatus(payload.status)
    except ValueError:
        raise HTTPException(400, "Invalid cycle status")
    if payload.end_date < payload.start_date:
        raise HTTPException(400, "End date must be on or after start date")
    c = KpiCycle(**payload.model_dump(exclude={"status"}), status=status)
    db.add(c)
    db.flush()
    audit(db, user.id, "create", "kpi_cycle", c.id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A KPI cycle with this name already exists")
    return {"id": c.id, "name": c.name, "status": c.status.value}


@router.patch("/cycles/{cycle_id}")
def update_cycle(cycle_id: int, payload: CycleUpdate, db: Session = Depends(get_db), user=Depends(admin_roles)):
    c = db.get(KpiCycle, cycle_id)
    if not c:
        raise HTTPException(404, "Cycle not found")
    try:
        c.status = CycleStatus(payload.status)
    except ValueError:
        raise HTTPException(400, "Invalid cycle status")
    audit(db, user.id, "cycle_status", "kpi_cycle", c.id, {"status": c.status.value})
    db.commit()
    return {"ok": True, "status": c.status.value}


@router.post("/assignments")
def assign(payload: AssignmentIn, db: Session = Depends(get_db), actor=Depends(admin_roles)):
    template = _load_template(db, payload.template_id)
    if not template:
        raise HTTPException(404, "Template not found")
    if template.status != TemplateStatus.active:
        raise HTTPException(409, "Only active templates can be assigned")
    valid, msg = validate_template(template, strict=True)
    if not valid:
        raise HTTPException(400, msg)
    employee = db.scalar(select(User).where(User.id == payload.user_id).options(joinedload(User.designation).joinedload(Designation.department).joinedload(Department.division)))
    cycle = db.get(KpiCycle, payload.cycle_id)
    if not employee:
        raise HTTPException(404, "Employee not found")
    if not cycle:
        raise HTTPException(404, "Cycle not found")
    if cycle.status == CycleStatus.closed:
        raise HTTPException(409, "Cannot assign KPI to a closed cycle")
    if not _template_matches_employee(template, employee):
        raise HTTPException(400, "Template hierarchy does not match this employee")
    a = KpiAssignment(**payload.model_dump())
    db.add(a)
    db.flush()
    audit(db, actor.id, "assign", "kpi_assignment", a.id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This employee already has a KPI assignment for the selected cycle")
    _notify(employee, f"KPI assigned - {cycle.name}", f"Your {cycle.name} KPI is ready. Open {settings.frontend_url}/kpi-input to complete it.")
    return {"id": a.id, "status": a.status.value}


@router.post("/assignments/auto")
def auto_assign(payload: AutoAssignIn, db: Session = Depends(get_db), actor=Depends(admin_roles)):
    cycle = db.get(KpiCycle, payload.cycle_id)
    if not cycle:
        raise HTTPException(404, "Cycle not found")
    if cycle.status == CycleStatus.closed:
        raise HTTPException(409, "Cannot assign KPI to a closed cycle")

    users = db.scalars(select(User).where(User.active.is_(True)).options(joinedload(User.designation).joinedload(Designation.department).joinedload(Department.division)).order_by(User.id)).unique().all()
    templates = db.scalars(
        select(KpiTemplate)
        .where(KpiTemplate.status == TemplateStatus.active)
        .options(joinedload(KpiTemplate.division), joinedload(KpiTemplate.department), joinedload(KpiTemplate.designation), joinedload(KpiTemplate.kras).joinedload(Kra.items))
        .order_by(KpiTemplate.version.desc(), KpiTemplate.id.desc())
    ).unique().all()
    by_scope = {}
    for t in templates:
        if validate_template(t, strict=True)[0]:
            key = (t.division_id, t.department_id, t.designation_id)
            by_scope.setdefault(key, t)

    assigned, skipped, no_template = [], [], []
    for employee in users:
        if employee.role == Role.superadmin:
            continue
        if employee.role == Role.manager and not payload.include_managers:
            continue
        if employee.role == Role.hr and not payload.include_hr:
            continue
        existing = db.scalar(select(KpiAssignment).where(KpiAssignment.cycle_id == cycle.id, KpiAssignment.user_id == employee.id))
        if existing:
            skipped.append(employee.name); continue
        matching = [t for t in by_scope.values() if _template_matches_employee(t, employee)]
        template = max(matching, key=_template_scope_rank) if matching else None
        if not template:
            no_template.append(employee.name); continue
        a = KpiAssignment(cycle_id=cycle.id, user_id=employee.id, template_id=template.id)
        db.add(a); db.flush()
        assigned.append(employee.name)
        audit(db, actor.id, "auto_assign", "kpi_assignment", a.id, {"template_id": template.id, "cycle_id": cycle.id})
    db.commit()
    for name in assigned:
        employee = next((u for u in users if u.name == name), None)
        _notify(employee, f"KPI assigned - {cycle.name}", f"Your {cycle.name} KPI is ready. Open {settings.frontend_url}/kpi-input to complete it.")
    return {"assigned": assigned, "skipped_existing": skipped, "no_active_template": no_template}


def _auto_assign_user_on_access(db: Session, user: User):
    if user.role == Role.superadmin:
        return
    cycles = db.scalars(select(KpiCycle).order_by(KpiCycle.id.desc())).all()
    if not cycles:
        return
    emp = db.scalar(select(User).where(User.id == user.id).options(joinedload(User.designation).joinedload(Designation.department).joinedload(Department.division)))
    if not emp:
        return
    for cycle in cycles:
        existing = db.scalar(select(KpiAssignment).where(KpiAssignment.cycle_id == cycle.id, KpiAssignment.user_id == user.id))
        if existing:
            continue
        templates = db.scalars(
            select(KpiTemplate)
            .where(KpiTemplate.status == TemplateStatus.active)
            .options(joinedload(KpiTemplate.division), joinedload(KpiTemplate.department), joinedload(KpiTemplate.designation), joinedload(KpiTemplate.kras).joinedload(Kra.items))
            .order_by(KpiTemplate.version.desc(), KpiTemplate.id.desc())
        ).unique().all()
        matching = [t for t in templates if validate_template(t, strict=True)[0] and _template_matches_employee(t, emp)]
        if matching:
            best_template = max(matching, key=_template_scope_rank)
            a = KpiAssignment(cycle_id=cycle.id, user_id=user.id, template_id=best_template.id)
            db.add(a)
            try:
                db.commit()
            except Exception:
                db.rollback()


@router.get("/my")
def my_assignments(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _auto_assign_user_on_access(db, user)
    stmt = (
        select(KpiAssignment)
        .options(
            joinedload(KpiAssignment.user),
            joinedload(KpiAssignment.cycle),
            joinedload(KpiAssignment.template).joinedload(KpiTemplate.designation),
            joinedload(KpiAssignment.template).joinedload(KpiTemplate.kras).joinedload(Kra.items),
            joinedload(KpiAssignment.responses),
        )
        .order_by(KpiAssignment.id.desc())
    )
    if user.role == Role.employee:
        stmt = stmt.where(KpiAssignment.user_id == user.id)
    elif user.role == Role.manager:
        stmt = stmt.join(User, KpiAssignment.user_id == User.id).where((User.manager_id == user.id) | (KpiAssignment.user_id == user.id))
    rows = db.scalars(stmt).unique().all()

    def progress(a):
        items = [i for kra in a.template.kras for i in kra.items]
        response_map = {r.kpi_item_id: r for r in a.responses}
        answered = 0
        for item in items:
            r = response_map.get(item.id)
            if not r:
                continue
            if item.input_type in {"choice", "yesno"}:
                answered += 1 if r.selected_option else 0
            else:
                answered += 1 if r.actual_numeric is not None else 0
        return round((answered / len(items) * 100) if items else 0)

    return [
        {
            "id": a.id,
            "employee_id": a.user_id,
            "employee_no": a.user.employee_no if a.user and a.user.employee_no else f"EMP-{a.user.id:04d}",
            "employee": a.user.name if a.user else None,
            "division": a.user.designation.department.division.name if a.user and a.user.designation and a.user.designation.department and a.user.designation.department.division else None,
            "department": a.user.designation.department.name if a.user and a.user.designation and a.user.designation.department else None,
            "designation": a.user.designation.name if a.user and a.user.designation else None,
            "manager_id": a.user.manager_id if a.user else None,
            "cycle": a.cycle.name,
            "cycle_id": a.cycle_id,
            "month": a.cycle.month.isoformat() if a.cycle and a.cycle.month else None,
            "status": a.status.value,
            "calculated_score": a.calculated_score,
            "manager_score": a.manager_score,
            "final_score": a.final_score,
            "progress_percent": progress(a),
            "template": template_json(a.template),
        }
        for a in rows
    ]


@router.get("/assignments/{assignment_id}")
def get_assignment(assignment_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    a = _load_assignment(db, assignment_id)
    if not a:
        raise HTTPException(404, "Assignment not found")
    if not _can_view_assignment(user, a):
        raise HTTPException(403, "Forbidden")
    response_map = {r.kpi_item_id: r for r in a.responses}
    data = template_json(a.template)
    for k in data["kras"]:
        for item in k["items"]:
            r = response_map.get(item["id"])
            item["response"] = None if not r else {
                "actual_numeric": r.actual_numeric,
                "answer_text": r.answer_text,
                "selected_option": r.selected_option,
                "measurement": r.measurement,
                "remarks": r.remarks,
                "evidence_url": r.evidence_url,
                "evidence_file_id": r.evidence_file_id,
                "evidence_file": upload_metadata(r.evidence_file_id),
                "score": r.score,
                "achievement_pct": calculate_achievement_percent(r.item, r),
            }
    return {
        "id": a.id,
        "employee": a.user.name,
        "employee_id": a.user_id,
        "cycle": a.cycle.name,
        "status": a.status.value,
        "calculated_score": a.calculated_score,
        "manager_score": a.manager_score,
        "final_score": a.final_score,
        "template": data,
    }


@router.post("/assignments/{assignment_id}/import-responses")
async def import_assignment_responses(assignment_id: int, file: UploadFile, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    a = _load_assignment(db, assignment_id)
    if not a:
        raise HTTPException(404, "Assignment not found")
    if not _can_view_assignment(user, a):
        raise HTTPException(403, "Forbidden")
    saved = await save_upload(file)
    rows = parse_response_rows(Path(saved["path"]))
    if not rows:
        raise HTTPException(400, "No KPI response rows found. Use columns: KPI Parameter | Actual Value | Remarks | Evidence File")
    preview = match_response_rows(a, rows)
    audit(db, user.id, "preview_import_responses", "kpi_assignment", a.id, {"file_id": saved["file_id"], "rows": len(rows)})
    db.commit()
    return {"file": {k: saved[k] for k in ("file_id", "filename", "url", "size")}, "rows": preview, "matched": sum(1 for x in preview if x["matched"]), "unmatched": sum(1 for x in preview if not x["matched"])}


@router.get("/assignments/{assignment_id}/pdf")
def assignment_pdf(assignment_id: int, date_label: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    a = _load_assignment(db, assignment_id)
    if not a:
        raise HTTPException(404, "Assignment not found")
    if not _can_view_assignment(user, a):
        raise HTTPException(403, "Forbidden")
    response_map = {r.kpi_item_id: r for r in a.responses}
    has_data = any(
        r and (r.actual_numeric is not None or r.selected_option or r.answer_text or r.remarks)
        for r in response_map.values()
    )
    period_title = date_label if date_label else a.cycle.name
    if not has_data:
        raise HTTPException(400, f"No KPI input data registered for {period_title} yet.")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=14*mm, rightMargin=14*mm, topMargin=14*mm, bottomMargin=14*mm)
    styles = getSampleStyleSheet()
    period_title = date_label if date_label else a.cycle.name
    story = [Paragraph("KPI Performance Summary Report", styles["Title"]), Spacer(1, 6)]
    story.append(Paragraph(f"<b>Employee:</b> {a.user.name} &nbsp;&nbsp; <b>Period / Selected Date:</b> {period_title} &nbsp;&nbsp; <b>Status:</b> {a.status.value.replace('_',' ').title()}", styles["BodyText"]))
    score = a.final_score if a.final_score is not None else (a.manager_score if a.manager_score is not None else a.calculated_score)
    story.append(Paragraph(f"<b>Score:</b> {score:.1f} / 100 &nbsp;&nbsp; <b>Template:</b> {a.template.name}", styles["BodyText"]))
    story.append(Spacer(1, 10))
    data = [["KRA / KPI", "Target", "Actual / Answer", "Weight", "Score", "Remarks"]]
    for kra in a.template.kras:
        data.append([Paragraph(f"<b>{kra.name}</b>", styles["BodyText"]), "", "", f"{kra.weight:g}", "", ""])
        for item in kra.items:
            r = response_map.get(item.id)
            actual = "—"
            remarks = ""
            item_score = 0
            if r:
                actual = r.selected_option or ("—" if r.actual_numeric is None else f"{r.actual_numeric:g}")
                remarks = r.remarks or ""
                item_score = r.score or 0
            data.append([Paragraph(item.question, styles["BodyText"]), "—" if item.target_value is None else f"{item.target_value:g}", actual, f"{item.weight:g}", f"{item_score:.1f}", Paragraph(remarks, styles["BodyText"])])
    table = Table(data, repeatRows=1, colWidths=[58*mm, 20*mm, 28*mm, 16*mm, 16*mm, 42*mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#EAF2FF")),
        ("TEXTCOLOR", (0,0), (-1,0), colors.HexColor("#0F172A")),
        ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE", (0,0), (-1,-1), 7.5),
        ("GRID", (0,0), (-1,-1), 0.35, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#F8FAFC")]),
        ("LEFTPADDING", (0,0), (-1,-1), 4), ("RIGHTPADDING", (0,0), (-1,-1), 4),
    ]))
    story.append(table)
    doc.build(story)
    buf.seek(0)
    clean_tag = period_title.replace(' ', '_').replace('/', '_')
    filename = f"KPI_{a.user.name.replace(' ','_')}_{clean_tag}.pdf"
    return StreamingResponse(buf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.put("/assignments/{assignment_id}/responses")
def save_response(assignment_id: int, payload: list[ResponseIn], db: Session = Depends(get_db), user: User = Depends(get_current_user)):

    a = _load_assignment(db, assignment_id)
    if not a:
        raise HTTPException(404, "Assignment not found")
    if user.role == Role.employee and a.user_id != user.id:
        raise HTTPException(403, "Forbidden")
    if user.role == Role.manager and a.user_id != user.id:
        raise HTTPException(403, "Managers review KPI submissions; they cannot edit employee answers")
    if a.status in {AssignmentStatus.finalized, AssignmentStatus.submitted, AssignmentStatus.manager_reviewed}:
        if user.role not in {Role.superadmin, Role.hr}:
            raise HTTPException(409, "KPI entry has already been submitted and locked for this period. Employees are permitted only one submission per period. Contact HR or Super Admin to edit or reopen.")
    valid_ids = set(db.scalars(select(KpiItem.id).join(Kra).where(Kra.template_id == a.template_id)).all())
    for p in payload:
        if p.kpi_item_id not in valid_ids:
            raise HTTPException(400, f"KPI item {p.kpi_item_id} is not part of this assignment")
        r = db.scalar(select(KpiResponse).where(KpiResponse.assignment_id == assignment_id, KpiResponse.kpi_item_id == p.kpi_item_id))
        if not r:
            r = KpiResponse(assignment_id=assignment_id, kpi_item_id=p.kpi_item_id)
            db.add(r)
        for key, value in p.model_dump().items():
            if key != "kpi_item_id":
                setattr(r, key, value)
    if a.status == AssignmentStatus.not_started:
        a.status = AssignmentStatus.draft
    db.flush()
    score = recalc_assignment(db, a.id)
    audit(db, user.id, "save_responses", "kpi_assignment", a.id, {"score": score})
    db.commit()
    return {"ok": True, "score": score}


@router.post("/assignments/{assignment_id}/submit")
def submit_assignment(assignment_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    a = _load_assignment(db, assignment_id)
    if not a:
        raise HTTPException(404, "Assignment not found")
    if user.role == Role.employee and a.user_id != user.id:
        raise HTTPException(403, "Forbidden")
    if user.role == Role.manager and a.user_id != user.id:
        raise HTTPException(403, "Managers cannot submit KPI on behalf of employees")
    if a.status in {AssignmentStatus.submitted, AssignmentStatus.manager_reviewed, AssignmentStatus.finalized}:
        raise HTTPException(409, "Assignment has already been submitted")
    items = [i for kra in a.template.kras for i in kra.items]
    response_map = {r.kpi_item_id: r for r in a.responses}
    missing_answers = []
    missing_evidence = []
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
        if item_config(item)["meta"].get("evidence_required") and not ((response.evidence_url or "").strip() or response.evidence_file_id):
            missing_evidence.append(item.question)
    if missing_answers:
        raise HTTPException(400, f"Please answer all KPI items before submission. Missing: {', '.join(missing_answers[:5])}")
    if missing_evidence:
        raise HTTPException(400, f"Evidence is required before submission for: {', '.join(missing_evidence[:5])}")
    recalc_assignment(db, a.id)
    a.status = AssignmentStatus.submitted
    a.submitted_at = datetime.utcnow()
    audit(db, user.id, "submit", "kpi_assignment", a.id)
    db.commit()
    _notify(a.user.manager, f"KPI review required - {a.user.name}", f"{a.user.name} submitted {a.cycle.name} KPI. Review it at {settings.frontend_url}/approvals.")
    return {"ok": True, "score": a.calculated_score}


@router.post("/assignments/{assignment_id}/manager-review")
def manager_review(assignment_id: int, payload: ReviewIn, db: Session = Depends(get_db), user: User = Depends(review_roles)):
    a = _load_assignment(db, assignment_id)
    if not a:
        raise HTTPException(404, "Assignment not found")
    if user.role == Role.manager and a.user.manager_id != user.id:
        raise HTTPException(403, "Not your direct report")
    if a.status != AssignmentStatus.submitted:
        raise HTTPException(409, "Employee submission is required first")
    if payload.decision == "rejected":
        a.status = AssignmentStatus.draft
        db.add(KpiReview(assignment_id=a.id, reviewer_id=user.id, stage="manager", **payload.model_dump()))
        audit(db, user.id, "manager_reject", "kpi_assignment", a.id)
        db.commit()
        _notify(a.user, f"KPI returned - {a.cycle.name}", payload.comments or "Your KPI was returned for correction.")
        return {"ok": True, "status": a.status.value}
    score = payload.score_override if payload.score_override is not None else a.calculated_score
    a.manager_score = score
    a.status = AssignmentStatus.manager_reviewed
    db.add(KpiReview(assignment_id=a.id, reviewer_id=user.id, stage="manager", **payload.model_dump()))
    audit(db, user.id, "manager_review", "kpi_assignment", a.id, {"score": score})
    db.commit()
    return {"ok": True, "manager_score": score}


@router.post("/assignments/{assignment_id}/finalize")
def finalize(assignment_id: int, payload: ReviewIn, db: Session = Depends(get_db), user: User = Depends(admin_roles)):
    a = _load_assignment(db, assignment_id)
    if not a:
        raise HTTPException(404, "Assignment not found")
    if a.user.manager_id and a.status != AssignmentStatus.manager_reviewed:
        raise HTTPException(409, "Manager review is required before HR finalization")
    if not a.user.manager_id and a.status not in {AssignmentStatus.submitted, AssignmentStatus.manager_reviewed}:
        raise HTTPException(409, "Submission is required before HR finalization")
    if payload.decision == "rejected":
        a.status = AssignmentStatus.draft
        db.add(KpiReview(assignment_id=a.id, reviewer_id=user.id, stage="hr", **payload.model_dump()))
        audit(db, user.id, "hr_reject", "kpi_assignment", a.id)
        db.commit()
        _notify(a.user, f"KPI reopened - {a.cycle.name}", payload.comments or "HR reopened your KPI for correction.")
        return {"ok": True, "status": a.status.value}
    base = a.manager_score if a.manager_score is not None else a.calculated_score
    score = payload.score_override if payload.score_override is not None else base
    a.final_score = score
    a.status = AssignmentStatus.finalized
    a.finalized_at = datetime.utcnow()
    db.add(KpiReview(assignment_id=a.id, reviewer_id=user.id, stage="hr", **payload.model_dump()))
    audit(db, user.id, "finalize", "kpi_assignment", a.id, {"score": score})
    db.commit()
    _notify(a.user, f"KPI finalized - {a.cycle.name}", f"Your final KPI score is {score:.1f}/100.")
    return {"ok": True, "final_score": score}


@router.post("/assignments/{assignment_id}/reopen")
def reopen(assignment_id: int, payload: ReopenIn, db: Session = Depends(get_db), user: User = Depends(admin_roles)):
    a = _load_assignment(db, assignment_id)
    if not a:
        raise HTTPException(404, "Assignment not found")
    a.status = AssignmentStatus.draft
    a.manager_score = None
    a.final_score = None
    a.finalized_at = None
    audit(db, user.id, "reopen", "kpi_assignment", a.id, {"reason": payload.reason})
    db.commit()
    _notify(a.user, f"KPI reopened - {a.cycle.name}", payload.reason)
    return {"ok": True, "status": a.status.value}
