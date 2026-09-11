"""Regression checks for template deletion/report cleanup and return-to-employee rules.

Run from project root:
    DATABASE_URL=sqlite:////tmp/kpi_template_delete_return.db PYTHONPATH=backend python backend/tests/run_template_delete_return_tests.py
"""
from __future__ import annotations

import os
import tempfile
from datetime import date
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select

TEST_DB = Path(tempfile.gettempdir()) / "kpi_template_delete_return.db"
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
    KpiReview,
    KpiTemplate,
    Kra,
    Role,
    TemplateStatus,
    User,
)
from app.routers import kpi_router as kpi_router_module
from app.routers.kpi_router import _purge_template_dependencies
from app.routers.kpi_v2_enhancements import _dashboard_visible_assignments
from app.routers import manager_review_lock_override as review_lock
from app.routers.relationship_review_override import _complete_manager_review, _load_assignment
from app.schemas import ResponseIn, ReviewIn

# Notifications are best-effort workflow side effects; keep this regression test
# isolated from SMTP/network configuration.
kpi_router_module._notify = lambda *args, **kwargs: None

Base.metadata.create_all(bind=engine)

db = SessionLocal()
try:
    admin = User(
        employee_no="ADM-1",
        name="Super Admin",
        email="admin@example.com",
        password_hash="x",
        role=Role.superadmin,
        active=True,
    )
    manager = User(
        employee_no="MGR-1",
        name="Manager",
        email="manager@example.com",
        password_hash="x",
        role=Role.manager,
        active=True,
    )
    hr = User(
        employee_no="HR-1",
        name="HR",
        email="hr@example.com",
        password_hash="x",
        role=Role.hr,
        active=True,
    )
    db.add_all([admin, manager, hr])
    db.flush()

    draft_template = KpiTemplate(name="Draft KPI To Delete", status=TemplateStatus.draft)
    db.add(draft_template)
    db.flush()
    draft_kra = Kra(template_id=draft_template.id, name="Delivery", weight=100)
    db.add(draft_kra)
    db.flush()
    draft_item = KpiItem(
        kra_id=draft_kra.id,
        question="Deliver target",
        input_type="number",
        weight=100,
        target_value=100,
        direction="higher",
        options={"score_map": {}, "meta": {}},
    )
    db.add(draft_item)
    db.flush()

    employee = User(
        employee_no="EMP-1",
        name="Employee",
        email="employee@example.com",
        password_hash="x",
        role=Role.employee,
        manager_id=manager.id,
        kpi_template_id=draft_template.id,
        active=True,
    )
    db.add(employee)
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

    draft_assignment = KpiAssignment(
        cycle_id=cycle.id,
        user_id=employee.id,
        template_id=draft_template.id,
        status=AssignmentStatus.manager_reviewed,
        calculated_score=70,
        manager_score=80,
    )
    db.add(draft_assignment)
    db.flush()
    draft_response = KpiResponse(
        assignment_id=draft_assignment.id,
        kpi_item_id=draft_item.id,
        actual_numeric=70,
        manager_actual_numeric=80,
        score=70,
        manager_score=80,
    )
    draft_review = KpiReview(
        assignment_id=draft_assignment.id,
        reviewer_id=manager.id,
        stage="manager",
        decision="approved",
        comments="reviewed",
    )
    db.add_all([draft_response, draft_review])
    db.commit()

    # Unpublished/draft template data must never appear in reports.
    assert _dashboard_visible_assignments(db, admin) == []

    deleted = _purge_template_dependencies(db, draft_template.id)
    assert deleted == {
        "assignments": 1,
        "responses": 1,
        "reviews": 1,
        "employee_overrides": 1,
    }
    db.delete(db.get(KpiTemplate, draft_template.id))
    db.commit()

    db.refresh(employee)
    assert employee.kpi_template_id is None
    assert db.scalar(select(KpiAssignment.id).where(KpiAssignment.id == draft_assignment.id)) is None
    assert db.scalar(select(KpiResponse.id).where(KpiResponse.id == draft_response.id)) is None
    assert db.scalar(select(KpiReview.id).where(KpiReview.id == draft_review.id)) is None
    assert db.get(KpiTemplate, draft_template.id) is None

    # Build a published assignment to verify Return to Employee semantics.
    active_template = KpiTemplate(name="Published KPI", status=TemplateStatus.active)
    db.add(active_template)
    db.flush()
    active_kra = Kra(template_id=active_template.id, name="Quality", weight=100)
    db.add(active_kra)
    db.flush()
    active_item = KpiItem(
        kra_id=active_kra.id,
        question="Quality result",
        input_type="number",
        weight=100,
        target_value=100,
        direction="higher",
        options={"score_map": {}, "meta": {}},
    )
    db.add(active_item)
    db.flush()

    employee.kpi_template_id = active_template.id
    locked_cycle = KpiCycle(
        name="Locked September 2026 KPI",
        month=date(2026, 9, 1),
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
        status=CycleStatus.running,
        is_locked=True,
    )
    db.add(locked_cycle)
    db.flush()

    submitted = KpiAssignment(
        cycle_id=locked_cycle.id,
        user_id=employee.id,
        template_id=active_template.id,
        status=AssignmentStatus.submitted,
        calculated_score=75,
    )
    db.add(submitted)
    db.flush()
    db.add(
        KpiResponse(
            assignment_id=submitted.id,
            kpi_item_id=active_item.id,
            actual_numeric=75,
            score=75,
        )
    )
    db.commit()

    loaded = _load_assignment(db, submitted.id)
    result = _complete_manager_review(
        loaded,
        ReviewIn(decision="rejected", comments="Please correct and resubmit"),
        db,
        manager,
    )
    assert result["status"] == AssignmentStatus.draft.value
    assert db.get(KpiAssignment, submitted.id).status == AssignmentStatus.draft

    # HR is not the Reporting Manager and cannot use Return to Employee.
    submitted_row = db.get(KpiAssignment, submitted.id)
    submitted_row.status = AssignmentStatus.submitted
    db.commit()
    loaded = _load_assignment(db, submitted.id)
    try:
        _complete_manager_review(
            loaded,
            ReviewIn(decision="rejected", comments="HR return attempt"),
            db,
            hr,
        )
        raise AssertionError("HR return should have been rejected")
    except HTTPException as exc:
        assert exc.status_code == 403

    # Once Manager Review is submitted, Manager/HR cannot change the score again.
    locked_cycle.is_locked = False
    submitted_row = db.get(KpiAssignment, submitted.id)
    submitted_row.status = AssignmentStatus.submitted
    response_row = db.scalar(select(KpiResponse).where(KpiResponse.assignment_id == submitted.id))
    response_row.manager_actual_numeric = 80
    db.commit()

    loaded = _load_assignment(db, submitted.id)
    approved = _complete_manager_review(
        loaded,
        ReviewIn(decision="approved", comments="Manager Score submitted"),
        db,
        manager,
    )
    assert approved["manager_score"] == 80
    assert db.get(KpiAssignment, submitted.id).status == AssignmentStatus.manager_reviewed
    assert review_lock._review_already_submitted(_load_assignment(db, submitted.id), manager) is True
    assert review_lock._review_already_submitted(_load_assignment(db, submitted.id), hr) is True
    assert review_lock._review_already_submitted(_load_assignment(db, submitted.id), admin) is False

    try:
        review_lock.locked_relationship_save_responses(
            submitted.id,
            [ResponseIn(kpi_item_id=active_item.id, manager_actual_numeric=90)],
            db,
            manager,
        )
        raise AssertionError("Manager must not be able to change Manager Score after submission")
    except HTTPException as exc:
        assert exc.status_code == 409

    try:
        review_lock.locked_relationship_manager_review(
            submitted.id,
            ReviewIn(decision="approved", comments="Second manager submission"),
            db,
            manager,
        )
        raise AssertionError("Manager must not be able to submit Manager Review twice")
    except HTTPException as exc:
        assert exc.status_code == 409

    # Super Admin remains the only role allowed to update the submitted Manager Score.
    admin_update = review_lock.locked_relationship_save_responses(
        submitted.id,
        [ResponseIn(kpi_item_id=active_item.id, manager_actual_numeric=90)],
        db,
        admin,
    )
    assert admin_update["manager_score"] == 90

    # Finalized records cannot be returned, even by Super Admin.
    finalized_row = db.get(KpiAssignment, submitted.id)
    finalized_row.status = AssignmentStatus.finalized
    finalized_row.manager_score = 82
    finalized_row.final_score = 82
    db.commit()
    loaded = _load_assignment(db, submitted.id)
    try:
        _complete_manager_review(
            loaded,
            ReviewIn(decision="rejected", comments="Super Admin return attempt"),
            db,
            admin,
        )
        raise AssertionError("Finalized return should have been rejected")
    except HTTPException as exc:
        assert exc.status_code == 409

    print("PASS: draft template assignments/scores/reviews are excluded from reports")
    print("PASS: deleting a draft template clears employee override + KPI transaction data")
    print("PASS: Reporting Manager can return submitted KPI even when cycle is locked")
    print("PASS: HR cannot use Return to Employee unless they are the actual Reports To")
    print("PASS: Manager Score locks after first submitted review for Manager and HR")
    print("PASS: Super Admin can update a submitted Manager Score")
    print("PASS: finalized KPI cannot be returned without explicit reopen workflow")
    print("ALL TEMPLATE DELETE / RETURN REGRESSION TESTS PASSED")
finally:
    db.close()
