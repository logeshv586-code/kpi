import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, parseaddr

from .database import settings

logger = logging.getLogger(__name__)


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


def email_gateway_configured() -> bool:
    """Return True when the backend has enough SMTP configuration to send mail."""
    return bool(
        settings.email_notifications_enabled
        and settings.smtp_host.strip()
        and _valid_email(settings.smtp_from)
    )


def _deliver(smtp, msg: EmailMessage) -> None:
    if settings.smtp_username:
        smtp.login(settings.smtp_username, settings.smtp_password)
    smtp.send_message(msg)


def send_email(to_email: str, subject: str, body: str) -> bool:
    """Send one KPI email through the configured company SMTP gateway.

    Delivery failures return False instead of aborting the reminder run. The KPI
    notification log only marks a message as sent when this function returns
    True, so a temporary SMTP failure can be retried by the next scheduler run.
    """
    recipient = _valid_email(to_email)
    sender = _valid_email(settings.smtp_from)
    if not recipient or not sender or not email_gateway_configured():
        return False

    msg = EmailMessage()
    msg["From"] = formataddr((settings.smtp_from_name.strip(), sender)) if settings.smtp_from_name.strip() else sender
    msg["To"] = recipient
    msg["Subject"] = subject
    msg.set_content(body)

    context = ssl.create_default_context()
    try:
        if settings.smtp_use_ssl:
            with smtplib.SMTP_SSL(
                settings.smtp_host,
                settings.smtp_port,
                timeout=settings.smtp_timeout_seconds,
                context=context,
            ) as smtp:
                _deliver(smtp, msg)
        else:
            with smtplib.SMTP(
                settings.smtp_host,
                settings.smtp_port,
                timeout=settings.smtp_timeout_seconds,
            ) as smtp:
                smtp.ehlo()
                if settings.smtp_use_tls:
                    smtp.starttls(context=context)
                    smtp.ehlo()
                _deliver(smtp, msg)
        return True
    except (smtplib.SMTPException, OSError, TimeoutError):
        # Do not log credentials or full SMTP responses. A failed recipient is
        # intentionally left unsent in the KPI notification log for retry.
        logger.warning("KPI email delivery failed for %s", recipient)
        return False
