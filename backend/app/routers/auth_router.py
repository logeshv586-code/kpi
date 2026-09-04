from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..auth import create_token, get_current_user, hash_password, user_permissions, verify_password
from ..captcha import generate_captcha_svg, verify_captcha
from ..database import get_db
from ..models import Department, Designation, User
from ..schemas import ChangePasswordIn, LoginIn

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/captcha")
def get_captcha():
    """Generate a one-time visual captcha challenge."""
    captcha_id, svg = generate_captcha_svg()
    return {"captcha_id": captcha_id, "svg": svg}


def user_payload(user: User, db: Session | None = None):
    designation = user.designation
    department = designation.department if designation else None
    division = department.division if department else None
    is_reporting_manager = False
    if db is not None:
        is_reporting_manager = db.scalar(
            select(User.id)
            .where(User.manager_id == user.id, User.active.is_(True))
            .limit(1)
        ) is not None
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role.value,
        "manager_id": user.manager_id,
        "designation_id": user.designation_id,
        "designation": designation.name if designation else None,
        "department": department.name if department else None,
        "division": division.name if division else None,
        "permissions": user_permissions(user),
        # A person does not need the stored System Role "Manager" to review
        # direct reports. The Reports To relationship grants this capability.
        "is_reporting_manager": is_reporting_manager,
        "review_scope": "all" if user.role.value in {"superadmin", "hr"} else ("direct_reports" if is_reporting_manager else "self"),
    }


@router.post("/login")
def login(payload: LoginIn, db: Session = Depends(get_db)):
    is_valid, error_msg = verify_captcha(payload.captcha_id, payload.captcha_code)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_msg or "Invalid captcha code")

    user = db.scalar(
        select(User)
        .where(User.email == payload.email)
        .options(joinedload(User.designation).joinedload(Designation.department).joinedload(Department.division))
    )
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"access_token": create_token(user), "token_type": "bearer", "user": user_payload(user, db)}


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    hydrated = db.scalar(
        select(User)
        .where(User.id == user.id)
        .options(joinedload(User.designation).joinedload(Designation.department).joinedload(Department.division))
    )
    return user_payload(hydrated, db)


@router.post("/change-password")
def change_password(payload: ChangePasswordIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Allow a signed-in employee to replace their temporary password."""
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=400, detail="Choose a different new password")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"ok": True, "message": "Password changed successfully"}
