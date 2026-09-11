"""Regression checks for Admin/HR SMTP password rotation and health status."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

TEST_DB = Path(tempfile.gettempdir()) / "kpi_email_settings_health.db"
TEST_DB.unlink(missing_ok=True)
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ.setdefault("SECRET_KEY", "test-secret-test-secret-test-secret-123")
os.environ.setdefault("SMTP_HOST", "smtp.env.example.com")
os.environ.setdefault("SMTP_PORT", "587")
os.environ.setdefault("SMTP_USERNAME", "env@example.com")
os.environ.setdefault("SMTP_PASSWORD", "env-password")
os.environ.setdefault("SMTP_FROM", "env@example.com")
os.environ.setdefault("EMAIL_NOTIFICATIONS_ENABLED", "true")

from app.database import Base, SessionLocal, engine
from app.mail import SMTP_CONFIG_KEY
from app.models import Role, SystemSetting, User
from app.routers import admin_router
from app.schemas import EmailSettingsIn

Base.metadata.create_all(bind=engine)

with SessionLocal() as db:
    hr = User(
        employee_no="HR-MAIL",
        name="HR Mail Admin",
        email="hr@example.com",
        password_hash="x",
        role=Role.hr,
        active=True,
    )
    db.add(hr)
    db.commit()
    db.refresh(hr)

    first_payload = EmailSettingsIn(
        enabled=True,
        host="smtp.company.example",
        port=587,
        username="kpi-alerts@company.example",
        password="month-one-password",
        from_email="kpi-alerts@company.example",
        from_name="Company KPI",
        use_tls=True,
        use_ssl=False,
        timeout_seconds=15,
        test_email="hr@example.com",
    )

    success = {
        "ok": True,
        "checked_at": "2026-09-11T07:30:00+00:00",
        "test_email_sent": True,
        "message": "SMTP connection is valid and the test email was sent.",
    }
    with patch("app.routers.admin_router.test_smtp_connection", return_value=success):
        result = admin_router.update_email_settings(first_payload, db, hr)

    assert result["ok"] is True
    stored = db.get(SystemSetting, SMTP_CONFIG_KEY)
    assert stored is not None
    assert stored.value["password"] == "month-one-password"
    assert stored.value["validated"] is True

    public = admin_router.get_email_settings(db, hr)
    assert public["config"]["password_configured"] is True
    assert "password" not in public["config"]
    assert public["config"]["source"] == "settings"

    # Leaving password blank must keep the last validated password.
    keep_password_payload = EmailSettingsIn(
        enabled=True,
        host="smtp.company.example",
        port=587,
        username="kpi-alerts@company.example",
        password=None,
        from_email="kpi-alerts@company.example",
        from_name="Company KPI Alerts",
        use_tls=True,
        use_ssl=False,
        timeout_seconds=15,
        test_email="hr@example.com",
    )
    with patch("app.routers.admin_router.test_smtp_connection", return_value=success):
        admin_router.update_email_settings(keep_password_payload, db, hr)
    db.refresh(stored)
    assert stored.value["password"] == "month-one-password"
    assert stored.value["from_name"] == "Company KPI Alerts"

    # A rotated password is not activated if SMTP authentication/test delivery
    # fails. The previously working password must stay active for retry alerts.
    bad_payload = EmailSettingsIn(
        enabled=True,
        host="smtp.company.example",
        port=587,
        username="kpi-alerts@company.example",
        password="bad-month-two-password",
        from_email="kpi-alerts@company.example",
        from_name="Company KPI Alerts",
        use_tls=True,
        use_ssl=False,
        timeout_seconds=15,
        test_email="hr@example.com",
    )
    failed = {
        "ok": False,
        "checked_at": "2026-10-01T07:30:00+00:00",
        "test_email_sent": False,
        "message": "SMTP authentication failed. Update the email password or app password in Settings.",
    }
    try:
        with patch("app.routers.admin_router.test_smtp_connection", return_value=failed):
            admin_router.update_email_settings(bad_payload, db, hr)
        raise AssertionError("Invalid rotated SMTP password should not be activated")
    except HTTPException as exc:
        assert exc.status_code == 400

    db.expire_all()
    stored_after_failure = db.get(SystemSetting, SMTP_CONFIG_KEY)
    assert stored_after_failure.value["password"] == "month-one-password"
    assert stored_after_failure.value["validated"] is True

print("PASS: HR can save a validated SMTP password override")
print("PASS: SMTP password is never returned to the frontend")
print("PASS: blank password keeps the last validated working password")
print("PASS: failed monthly password rotation does not overwrite working SMTP credentials")
print("ALL EMAIL SETTINGS / HEALTH TESTS PASSED")
