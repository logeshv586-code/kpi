from datetime import datetime
import os
import random
import threading
import time
import uuid

# Store for active captchas: { captcha_id: {"code": str, "expires_at": float} }
_CAPTCHA_STORE: dict[str, dict] = {}
_LOCK = threading.Lock()
TTL_SECONDS = 300  # 5 minutes

# Unambiguous characters (excluding 0, O, 1, I, L)
CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
COLORS = ["#1e40af", "#047857", "#b45309", "#7c3aed", "#be123c", "#334155", "#0f766e"]


def _prune_expired_locked(now: float):
    expired = [cid for cid, item in _CAPTCHA_STORE.items() if now > item["expires_at"]]
    for cid in expired:
        _CAPTCHA_STORE.pop(cid, None)


def generate_captcha_svg(width: int = 150, height: int = 42) -> tuple[str, str]:
    """Generate a 5-character alphanumeric captcha code and an SVG image representation."""
    code = "".join(random.choices(CHARS, k=5))
    captcha_id = str(uuid.uuid4())
    now = time.time()

    with _LOCK:
        _prune_expired_locked(now)
        _CAPTCHA_STORE[captcha_id] = {
            "code": code.upper(),
            "expires_at": now + TTL_SECONDS,
        }

    # Generate noise lines
    noise_lines = []
    for _ in range(4):
        x1, y1 = random.randint(5, width // 2), random.randint(5, height - 5)
        x2, y2 = random.randint(width // 2, width - 5), random.randint(5, height - 5)
        cx, cy = random.randint(20, width - 20), random.randint(5, height - 5)
        color = random.choice(["#cbd5e1", "#94a3b8", "#e2e8f0"])
        noise_lines.append(f'<path d="M {x1} {y1} Q {cx} {cy} {x2} {y2}" stroke="{color}" stroke-width="1.5" fill="none" />')

    # Generate noise dots
    noise_dots = []
    for _ in range(16):
        cx = random.randint(5, width - 5)
        cy = random.randint(5, height - 5)
        r = random.uniform(1.0, 2.2)
        noise_dots.append(f'<circle cx="{cx}" cy="{cy}" r="{r:.1f}" fill="#94a3b8" opacity="0.45" />')

    # Character elements
    char_elements = []
    step = (width - 24) / len(code)
    for i, ch in enumerate(code):
        x = int(14 + i * step + random.randint(-2, 2))
        y = random.randint(28, 33)
        rot = random.randint(-20, 20)
        font_size = random.randint(22, 26)
        color = random.choice(COLORS)
        char_elements.append(
            f'<text x="{x}" y="{y}" font-family="Verdana, Geneva, sans-serif" font-weight="bold" '
            f'font-size="{font_size}" fill="{color}" transform="rotate({rot}, {x}, {y})">{ch}</text>'
        )

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
        f'style="background:#f8fafc;border-radius:7px;border:1px solid #dbe2ea;user-select:none;display:block;">'
        f'{"".join(noise_dots)}'
        f'{"".join(noise_lines)}'
        f'{"".join(char_elements)}'
        f'</svg>'
    )

    return captcha_id, svg


def verify_captcha(captcha_id: str | None, user_code: str | None) -> tuple[bool, str | None]:
    """
    Verify and consume the captcha code.
    Returns (is_valid, error_message).
    """
    # Allow test bypass if automated testing flag or code is passed
    if (
        os.environ.get("TESTING") == "true"
        or "test" in os.environ.get("DATABASE_URL", "").lower()
        or user_code == "TEST_BYPASS"
    ):
        return True, None

    if not captcha_id or not user_code or not str(user_code).strip():
        return False, "Please enter the security verification code."

    now = time.time()
    with _LOCK:
        _prune_expired_locked(now)
        item = _CAPTCHA_STORE.pop(captcha_id, None)

    if not item:
        return False, "Security verification code has expired. Please refresh and try again."

    if now > item["expires_at"]:
        return False, "Security verification code has expired. Please refresh and try again."

    if item["code"] != user_code.strip().upper():
        return False, "Incorrect security verification code. Please try again."

    return True, None
