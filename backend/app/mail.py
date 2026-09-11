import logging
import smtplib
import ssl
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr, parseaddr

from sqlalchemy.exc import SQLAlchemyError

from .database import SessionLocal, settings
from .models import SystemSetting

logger = logging.getLogger(__name__)

SMTP_CONFIG_KEY = "email_smtp_config"
SMTP_HEALTH_KEY = "email_smtp_health"


def _valid_email(value: str | None) -> str | None:
    if not value:
        return None
    _, address = parseaddr(value.strip())
    if not address or "@" not in address:
        return None
    local, _, domain = address.rpartition("@")
    if not local or not domain or "." not in domain:
        return None
    return address


def _env_smtp_config() -> dict:
    return {
        "enabled": bool(settings.email_notifications_enabled),
        "host": settings.smtp_host.strip(),
        "port": int(settings.smtp_port),
        "username": settings.smtp_username.strip(),
        "password": settings.smtp_password,
        "from_email": settings.smtp_from.strip(),
        "from_name": settings.smtp_from_name.strip(),
        "use_tls": bool(settings.smtp_use_tls),
        "use_ssl": bool(settings.smtp_use_ssl),
        "timeout_seconds": int(settings.smtp_timeout_seconds),
        "source": "environment",
    }


def get_smtp_config() -> dict:
    """Return the active server-side SMTP configuration.

    A validated Settings override takes precedence over backend/.env. The SMTP
    password is never returned by API endpoints; this function is backend-only.
    """
    config = _env_smtp_config()
    try:
        with SessionLocal() as db:
            row = db.get(SystemSetting, SMTP_CONFIG_KEY)
            value = row.value if row and isinstance(row.value, dict) else None
            if value and value.get("validated") is True:
                config.update({
                    "enabled": bool(value.get("enabled", config["enabled"])),
                    "host": str(value.get("host") or "").strip(),
                    "port": int(value.get("port") or config["port"]),
                    "username": str(value.get("username") or "").strip(),
                    "password": str(value.get("password") or ""),
                    "from_email": str(value.get("from_email") or "").strip(),
                    "from_name": str(value.get("from_name") or "").strip(),
                    "use_tls": bool(value.get("use_tls", True)),
                    "use_ssl": bool(value.get("use_ssl", False)),
                    "timeout_seconds": int(value.get("timeout_seconds") or config["timeout_seconds"]),
                    "source": "settings",
                })
    except (SQLAlchemyError, ValueError, TypeError):
        # During first-run migrations/tests the settings table may not exist yet.
        # Environment configuration remains the safe fallback.
        pass
    return config


def public_smtp_config() -> dict:
    config = get_smtp_config()
    return {
        "enabled": config["enabled"],
        "host": config["host"],
        "port": config["port"],
        "username": config["username"],
        "password_configured": bool(config["password"]),
        "from_email": config["from_email"],
        "from_name": config["from_name"],
        "use_tls": config["use_tls"],
        "use_ssl": config["use_ssl"],
        "timeout_seconds": config["timeout_seconds"],
        "source": config["source"],
    }


def email_gateway_configured(config: dict | None = None) -> bool:
    """Return True when the backend has enough SMTP configuration to send mail."""
    cfg = config or get_smtp_config()
    return bool(
        cfg.get("enabled")
        and str(cfg.get("host") or "").strip()
        and _valid_email(str(cfg.get("from_email") or ""))
    )


def _deliver(smtp, msg: EmailMessage, config: dict) -> None:
    if config.get("username"):
        smtp.login(config["username"], config.get("password") or "")
    smtp.send_message(msg)


def _open_smtp(config: dict):
    context = ssl.create_default_context()
    host = config["host"]
    port = int(config["port"])
    timeout = int(config.get("timeout_seconds") or 15)

    if config.get("use_ssl"):
        smtp = smtplib.SMTP_SSL(host, port, timeout=timeout, context=context)
        smtp.ehlo()
        return smtp

    smtp = smtplib.SMTP(host, port, timeout=timeout)
    smtp.ehlo()
    if config.get("use_tls"):
        smtp.starttls(context=context)
        smtp.ehlo()
    return smtp


def _smtp_error_message(exc: Exception) -> str:
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return "SMTP authentication failed. Update the email password or app password in Settings."
    if isinstance(exc, smtplib.SMTPConnectError):
        return "Could not connect to the SMTP server. Check host, port and network access."
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return "The SMTP server rejected the test recipient."
    if isinstance(exc, smtplib.SMTPSenderRefused):
        return "The SMTP server rejected the configured sender email."
    if isinstance(exc, (TimeoutError, OSError)):
        return "SMTP connection timed out or the server could not be reached."
    return "SMTP validation failed. Check the email gateway settings and password."


def test_smtp_connection(config: dict | None = None, send_to: str | None = None) -> dict:
    """Authenticate to SMTP and optionally send one real validation email."""
    cfg = dict(config or get_smtp_config())
    checked_at = datetime.now(timezone.utc).isoformat()

    if not cfg.get("enabled"):
        return {"ok": False, "checked_at": checked_at, "message": "Email notifications are disabled."}
    if not email_gateway_configured(cfg):
        return {"ok": False, "checked_at": checked_at, "message": "SMTP host and a valid sender email are required."}
    if cfg.get("use_ssl") and cfg.get("use_tls"):
        return {"ok": False, "checked_at": checked_at, "message": "Choose either SSL or STARTTLS, not both."}

    recipient = _valid_email(send_to) if send_to else None
    if send_to and not recipient:
        return {"ok": False, "checked_at": checked_at, "message": "Enter a valid test recipient email."}

    smtp = None
    try:
        smtp = _open_smtp(cfg)
        if cfg.get("username"):
            smtp.login(cfg["username"], cfg.get("password") or "")

        sent = False
        if recipient:
            sender = _valid_email(cfg.get("from_email"))
            msg = EmailMessage()
            msg["From"] = formataddr((str(cfg.get("from_name") or "").strip(), sender)) if str(cfg.get("from_name") or "").strip() else sender
            msg["To"] = recipient
            msg["Subject"] = "KPI email configuration test"
            msg.set_content(
                "KPI email alerts are connected successfully. "
                "This test confirms the current SMTP password and mail gateway configuration are valid."
            )
            smtp.send_message(msg)
            sent = True

        return {
            "ok": True,
            "checked_at": checked_at,
            "test_email_sent": sent,
            "message": "SMTP connection is valid and the test email was sent." if sent else "SMTP connection and authentication are valid.",
        }
    except (smtplib.SMTPException, OSError, TimeoutError) as exc:
        logger.warning("KPI SMTP health check failed: %s", exc.__class__.__name__)
        return {"ok": False, "checked_at": checked_at, "message": _smtp_error_message(exc)}
    finally:
        if smtp is not None:
            try:
                smtp.quit()
            except Exception:
                try:
                    smtp.close()
                except Exception:
                    pass


def record_smtp_health(result: dict) -> None:
    """Persist non-secret SMTP health state for Admin/HR login warnings."""
    try:
        with SessionLocal() as db:
            row = db.get(SystemSetting, SMTP_HEALTH_KEY)
            value = {
                "ok": bool(result.get("ok")),
                "checked_at": result.get("checked_at"),
                "message": str(result.get("message") or ""),
            }
            if row:
                row.value = value
            else:
                db.add(SystemSetting(key=SMTP_HEALTH_KEY, value=value))
            db.commit()
    except SQLAlchemyError:
        logger.warning("Unable to persist KPI SMTP health status")


def send_email(to_email: str, subject: str, body: str) -> bool:
    """Send one KPI email through the configured company SMTP gateway.

    Delivery failures return False instead of aborting the reminder run. The KPI
    notification log only marks a message as sent when this function returns
    True, so a temporary SMTP failure can be retried by the next scheduler run.
    """
    config = get_smtp_config()
    recipient = _valid_email(to_email)
    sender = _valid_email(config.get("from_email"))
    if not recipient or not sender or not email_gateway_configured(config):
        return False

    msg = EmailMessage()
    msg["From"] = formataddr((str(config.get("from_name") or "").strip(), sender)) if str(config.get("from_name") or "").strip() else sender
    msg["To"] = recipient
    msg["Subject"] = subject
    msg.set_content(body)

    smtp = None
    try:
        smtp = _open_smtp(config)
        _deliver(smtp, msg, config)
        return True
    except (smtplib.SMTPException, OSError, TimeoutError):
        # Do not log credentials or full SMTP responses. A failed recipient is
        # intentionally left unsent in the KPI notification log for retry.
        logger.warning("KPI email delivery failed for %s", recipient)
        return False
    finally:
        if smtp is not None:
            try:
                smtp.quit()
            except Exception:
                try:
                    smtp.close()
                except Exception:
                    pass
