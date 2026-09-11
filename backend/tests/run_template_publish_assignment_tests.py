"""Regression checks for KPI template republish and employee assignment history."""
from __future__ import annotations

import os
import tempfile
from datetime import date
from pathlib import Path

from fastapi import HTTPException

TEST_DB = Path(tempfile.gettempdir()) / "kpi_template_publish_assignment.db"
TEST_DB.unlink(missing_ok=True)
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ.setdefault("SECRET_KEY", "test-secret-test-secret-test-secret-123")
os.environ.setdefault("FRONTEND_URL", "http://localhost:5173")

from app.database import Base, SessionLocal, engine
from app.models import (
    AssignmentStatus,
    CycleStatus,
    KpiAssignment,
    KpiCycle,
    KpiItem,
    KpiResponse,
    KpiTemplate,
    Kra,
    Role,
    TemplateStatus,
    User,
)
from app.routers import kpi_router as kpi_router_module
from app.routers.kpi_router import _require_published_assignment_template, publish
from app.routers.kpi_v2_enhancements import enhanced_my_assignments

kpi_router_module._notify = lambda *args, **kwargs: None
Base.metadata.create_all(bind=engine)


def add_template(db, *, name: str, version: int, status: TemplateStatus):
    template = KpiTemplate(name=name, version=version, status=status)
    db.add(template)
    db.flush()
    kra = Kra(template_id=template.id, name="Delivery", weight=100)
    db.add(kra)
    db.flush()
    item = KpiItem(
        kra_id=kra.id,
        question=f"Delivery KPI v{version}",
        input_type="number",
        weight=100,
        target_value=100,
        direction="higher",
        options={
            "score_map": {},
            "meta": {
                "scoring_method": "measurement_target",
                "unit": "units",
                "threshold_rule": "none",
                "threshold_min": None,
                "threshold_max": None,
                "score_cap_pct": 100,
            },
        },
    )
    db.add(item)
    db.flush()
    return template, item


db = SessionLocal()
try:
    admin = User(
        employee_no="ADM-PUBLISH",
        name="Super Admin",
        email="admin-publish@example.com",
        password_hash="x",
        role=Role.superadmin,
        active=True,
    )
    untouched = User(
        employee_no="EMP-UNTOUCHED",
        name="Untouched Employee",
        email="untouched@example.com",
        password_hash="x",
        role=Role.employee,
        active=True,
    )
    started = User(
        employee_no="EMP-STARTED",
        name="Started Employee",
        email="started@example.com",
        password_hash="x",
        role=Role.employee,
        active=True,
    )
    db.add_all([admin, untouched, started])
    db.flush()

    cycle = KpiCycle(
        name="September 2026 KPI",
        month=date(2026, 9, 1),
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
        status=CycleStatus.running,
        is_locked=False,
    )
    db.add(cycle)
    db.flush()

    v1, v1_item = add_template(db, name="Company KPI", version=1, status=TemplateStatus.active)
    untouched_assignment = KpiAssignment(
        cycle_id=cycle.id,
        user_id=untouched.id,
        template_id=v1.id,
        status=AssignmentStatus.not_started,
    )
    started_assignment = KpiAssignment(
        cycle_id=cycle.id,
        user_id=started.id,
        template_id=v1.id,
        status=AssignmentStatus.draft,
    )
    db.add_all([untouched_assignment, started_assignment])
    db.flush()
    db.add(
        KpiResponse(
            assignment_id=started_assignment.id,
            kpi_item_id=v1_item.id,
            actual_numeric=40,
            score=40,
        )
    )
    db.commit()

    v2, _ = add_template(db, name="Company KPI", version=2, status=TemplateStatus.draft)
    db.commit()
    publish(v2.id, db, admin)

    db.refresh(v1)
    db.refresh(v2)
    db.refresh(untouched_assignment)
    db.refresh(started_assignment)

    assert v1.status == TemplateStatus.archived
    assert v2.status == TemplateStatus.active
    assert untouched_assignment.template_id == v2.id, "untouched assignment must move to newest published template"
    assert started_assignment.template_id == v1.id, "started draft must preserve original template and entered KPI data"

    # Archived templates were previously published, so an already-started
    # assignment can still finish on that exact historical version.
    _require_published_assignment_template(started_assignment)

    # Draft/unpublished templates remain blocked.
    draft_template, _ = add_template(db, name="Draft Only", version=1, status=TemplateStatus.draft)
    db.commit()
    draft_assignment = KpiAssignment(
        cycle_id=cycle.id,
        user_id=admin.id,
        template_id=draft_template.id,
        status=AssignmentStatus.not_started,
    )
    draft_assignment.template = draft_template
    try:
        _require_published_assignment_template(draft_assignment)
        raise AssertionError("unpublished draft template should be blocked")
    except HTTPException as exc:
        assert exc.status_code == 409

    # KPI Input/history must continue to expose assignments backed by archived
    # templates; only truly unpublished draft-template assignments are hidden.
    rows = enhanced_my_assignments(db=db, user=admin)
    ids = {row["id"] for row in rows}
    assert untouched_assignment.id in ids
    assert started_assignment.id in ids
    started_row = next(row for row in rows if row["id"] == started_assignment.id)
    assert started_row["template"]["status"] == TemplateStatus.archived.value

    print("PASS: republish moves untouched running assignment to newest matching template")
    print("PASS: started KPI draft keeps its original published version and data")
    print("PASS: archived assigned template remains usable and visible in KPI history")
    print("PASS: unpublished draft template remains blocked")
    print("ALL TEMPLATE PUBLISH / ASSIGNMENT HISTORY TESTS PASSED")
finally:
    db.close()
