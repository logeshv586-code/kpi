"""Focused regression checks for the KPI company email gateway.

Run from project root:
    DATABASE_URL=sqlite:////tmp/kpi_mail.db PYTHONPATH=backend python backend/tests/run_mail_gateway_tests.py
"""
from __future__ import annotations

import os
import smtplib
import tempfile
from pathlib import Path
from unittest.mock import patch

TEST_DB = Path(tempfile.gettempdir()) / "kpi_mail.db"
TEST_DB.unlink(missing_ok=True)
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ.setdefault("SECRET_KEY", "test-secret-test-secret-test-secret-123")

from app.database import settings
from app.mail import email_gateway_configured, send_email


class FakeSMTP:
    instances = []

    def __init__(self, host, port, timeout=None, context=None):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.context = context
        self.tls_started = False
        self.login_args = None
        self.message = None
        self.ehlo_count = 0
        self.__class__.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def ehlo(self):
        self.ehlo_count += 1

    def starttls(self, context=None):
        self.tls_started = True
        self.context = context

    def login(self, username, password):
        self.login_args = (username, password)

    def send_message(self, message):
        self.message = message


class FailingSMTP(FakeSMTP):
    instances = []

    def send_message(self, message):
        raise smtplib.SMTPException("simulated delivery failure")


settings.email_notifications_enabled = True
settings.smtp_host = "smtp.example.com"
settings.smtp_port = 587
settings.smtp_username = "kpi@example.com"
settings.smtp_password = "test-app-password"
settings.smtp_from = "kpi@example.com"
settings.smtp_from_name = "Company KPI"
settings.smtp_use_tls = True
settings.smtp_use_ssl = False
settings.smtp_timeout_seconds = 12

assert email_gateway_configured() is True

FakeSMTP.instances.clear()
with patch("app.mail.smtplib.SMTP", FakeSMTP):
    assert send_email("employee@example.com", "KPI reminder", "Please complete your KPI.") is True

client = FakeSMTP.instances[-1]
assert client.host == "smtp.example.com"
assert client.port == 587
assert client.timeout == 12
assert client.tls_started is True
assert client.login_args == ("kpi@example.com", "test-app-password")
assert client.message["To"] == "employee@example.com"
assert client.message["Subject"] == "KPI reminder"
assert "Company KPI" in client.message["From"]

# One invalid employee email must be skipped instead of stopping a company run.
assert send_email("not-an-email", "KPI reminder", "body") is False

# A temporary provider error must return False so the scheduler can retry later.
FailingSMTP.instances.clear()
with patch("app.mail.smtplib.SMTP", FailingSMTP):
    assert send_email("employee@example.com", "KPI reminder", "body") is False

# Notifications can be disabled without changing reminder business rules.
settings.email_notifications_enabled = False
assert email_gateway_configured() is False
assert send_email("employee@example.com", "KPI reminder", "body") is False

print("PASS: SMTP gateway is controlled by backend environment settings")
print("PASS: TLS, authentication and sender display name are applied")
print("PASS: invalid recipients and provider failures do not abort reminder processing")
print("ALL KPI MAIL GATEWAY TESTS PASSED")
