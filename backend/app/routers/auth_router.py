from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..auth import create_token, get_current_user, verify_password
from ..database import get_db
from ..models import Department, Designation, User
from ..schemas import LoginIn

router = APIRouter(prefix="/api/auth", tags=["auth"])


def user_payload(user: User):
    designation = user.designation
    department = designation.department if designation else None
    division = department.division if department else None
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
    }


@router.post("/login")
def login(payload: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(
        select(User)
        .where(User.email == payload.email)
        .options(joinedload(User.designation).joinedload(Designation.department).joinedload(Department.division))
    )
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"access_token": create_token(user), "token_type": "bearer", "user": user_payload(user)}


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    hydrated = db.scalar(
        select(User)
        .where(User.id == user.id)
        .options(joinedload(User.designation).joinedload(Designation.department).joinedload(Department.division))
    )
    return user_payload(hydrated)
