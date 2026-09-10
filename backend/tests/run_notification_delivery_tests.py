"""Regression checks for KPI employee reminder delivery rules.

Run from project root:
    DATABASE_URL=sqlite:////tmp/kpi_notification_delivery.db PYTHONPATH=backend python backend/tests/run_notification_delivery_tests.py
"""
from __future__ import annotations

import os
import tempfile
from datetime import date
from pathlib import Path
from unittest.mock import patch

TEST_DB = Path(tempfile.gettempdir()) / "kpi_notification_delivery.db"
TEST_DB.unlink(missing_ok=True)
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ.setdefault("SECRET_KEY", "test-secret-test-secret-test-secret-123")

from app.database import Base, SessionLocal, engine
from app.models import (
    AssignmentStatus,
    CycleStatus,
    KpiAssignment,
    KpiCycle,
    KpiTemplate,
    Role,
    TemplateStatus,
    User,
)
from app.routers.kpi_v2_enhancements import run_due_notifications

Base.metadata.create_all(bind=engine)

sent_to: list[str] = []


def fake_send_email(to_email: str, subject: str, body: str) -> bool:
    sent_to.append(to_email)
    return True


# Seed once, then use a fresh SQLAlchemy session for each reminder execution.
# That matches the production scheduler, which creates a new SessionLocal on
# each hourly pass, and verifies that idempotency is persisted in the database.
with SessionLocal() as db:
    template = KpiTemplate(name="Reminder Test Template", status=TemplateStatus.active)
    pending_employee = User(
        employee_no="REM-001",
        name="Pending Employee",
        email="pending@example.com",
        password_hash="test",
        role=Role.employee,
        active=True,
    )
    completed_employee = User(
        employee_no="REM-002",
        name="Completed Employee",
        email="completed@example.com",
        password_hash="test",
        role=Role.employee,
        active=True,
    )
    cycle = KpiCycle(
        name="September 2026 Monthly Review",
        month=date(2026, 9, 1),
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
        review_type="monthly",
        financial_year="FY 2026-27",
        period_label="September 2026",
        status=CycleStatus.running,
    )
    db.add_all([template, pending_employee, completed_employee, cycle])
    db.flush()

    pending_assignment = KpiAssignment(
        cycle_id=cycle.id,
        user_id=pending_employee.id,
        template_id=template.id,
        status=AssignmentStatus.draft,
    )
    completed_assignment = KpiAssignment(
        cycle_id=cycle.id,
        user_id=completed_employee.id,
        template_id=template.id,
        status=AssignmentStatus.submitted,
    )
    db.add_all([pending_assignment, completed_assignment])
    db.flush()
    pending_assignment_id = pending_assignment.id
    db.commit()

with patch("app.routers.kpi_v2_enhancements.send_email", side_effect=fake_send_email):
    with SessionLocal() as db:
        first = run_due_notifications(db, date(2026, 9, 26))
        assert first["pending"] == 1
        assert first["employee_emails"] == 1
        assert sent_to == ["pending@example.com"]

    # Re-running the scheduler on the same date must not duplicate the alert.
    with SessionLocal() as db:
        second = run_due_notifications(db, date(2026, 9, 26))
        assert second["pending"] == 1
        assert second["employee_emails"] == 0
        assert sent_to == ["pending@example.com"]

    # Once the employee submits, later days in the 26th-to-1st window must
    # stop sending reminders automatically.
    with SessionLocal() as db:
        pending_assignment = db.get(KpiAssignment, pending_assignment_id)
        assert pending_assignment is not None
        pending_assignment.status = AssignmentStatus.submitted
        db.commit()

    with SessionLocal() as db:
        third = run_due_notifications(db, date(2026, 9, 27))
        assert third["pending"] == 0
        assert third["employee_emails"] == 0
        assert sent_to == ["pending@example.com"]

print("PASS: only active employees with not_started/draft KPI receive reminders")
print("PASS: submitted/completed employees receive no reminder")
print("PASS: same-day duplicate reminder is suppressed across scheduler runs")
print("ALL KPI NOTIFICATION DELIVERY TESTS PASSED")
