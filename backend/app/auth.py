from datetime import datetime, timedelta, timezone
import base64
import hashlib
import hmac
import os

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .database import get_db, settings
from .models import Role, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
ALGORITHM = "HS256"
# Every signed-in user has a self-service employee-profile view.  The
# directory endpoint restricts view-only users to their own record.
DEFAULT_TABS = {"kpi-input", "reports", "employees"}


def user_permissions(user: User) -> dict:
    """Return the effective, least-privilege tab permissions for a user."""
    if user.role == Role.superadmin:
        return {"tabs": ["*"], "editable_tabs": ["*"]}
    raw = user.access_permissions or {}
    tabs = set(raw.get("tabs") or []) | DEFAULT_TABS
    editable_tabs = set(raw.get("editable_tabs") or []) | {"kpi-input"}
    return {"tabs": sorted(tabs), "editable_tabs": sorted(editable_tabs)}


def has_tab_permission(user: User, tab: str, edit: bool = False) -> bool:
    permissions = user_permissions(user)
    allowed = permissions["editable_tabs" if edit else "tabs"]
    return "*" in allowed or tab in allowed


def require_tab_permission(tab: str, edit: bool = False):
    def checker(user: User = Depends(get_current_user)) -> User:
        if not has_tab_permission(user, tab, edit):
            raise HTTPException(status_code=403, detail="You do not have access to this area")
        return user
    return checker


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    iterations = 260_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return f"pbkdf2_sha256${iterations}${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(plain: str, hashed: str) -> bool:
    try:
        scheme, iterations, salt_b64, digest_b64 = hashed.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
        actual = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt, int(iterations))
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def create_token(user: User) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": str(user.id), "role": user.role.value, "exp": expires}
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
    except Exception:
        raise credentials_error
    user = db.get(User, user_id)
    if not user or not user.active:
        raise credentials_error
    return user


def require_roles(*roles: Role):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="You do not have permission for this action")
        return user
    return checker
