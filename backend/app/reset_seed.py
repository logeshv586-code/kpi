"""Reset KPI transactional data while preserving organization, users and templates.

CLI usage:
    python -m app.reset_seed --confirm RESET
"""
from __future__ import annotations

import argparse
from sqlalchemy import delete
from sqlalchemy.orm import Session

from .database import SessionLocal
from .file_storage import clear_uploads
from .models import (
    AuditLog,
    Department,
    Designation,
    Division,
    KpiAssignment,
    KpiCycle,
    KpiItem,
    KpiResponse,
    KpiReview,
    KpiTemplate,
    Kra,
    Role,
    User,
)


def reset_transactional_data(db: Session, clear_files: bool = True) -> dict:
    # Explicit child deletion keeps this reliable on SQLite and PostgreSQL.
    responses = db.query(KpiResponse).count()
    reviews = db.query(KpiReview).count()
    assignments = db.query(KpiAssignment).count()
    cycles = db.query(KpiCycle).count()
    audits = db.query(AuditLog).count()
    db.execute(delete(KpiResponse))
    db.execute(delete(KpiReview))
    db.execute(delete(KpiAssignment))
    db.execute(delete(KpiCycle))
    db.execute(delete(AuditLog))
    db.commit()
    files = clear_uploads() if clear_files else 0
    return {"responses": responses, "reviews": reviews, "assignments": assignments, "cycles": cycles, "audit_logs": audits, "files": files}


def reset_full_system_data(db: Session, current_user_id: int | None = None, clear_files: bool = True) -> dict:
    tx_counts = reset_transactional_data(db, clear_files=clear_files)

    # 1. Clear foreign key links on all users
    db.query(User).update({
        User.manager_id: None,
        User.designation_id: None,
        User.kpi_template_id: None,
    })
    db.flush()

    # 2. Delete KPI items, KRAs, and KPI Templates explicitly
    items_count = db.query(KpiItem).count()
    kras_count = db.query(Kra).count()
    templates_count = db.query(KpiTemplate).count()
    db.execute(delete(KpiItem))
    db.execute(delete(Kra))
    db.execute(delete(KpiTemplate))
    db.flush()

    # 3. Preserve the single active superadmin user
    preserved_user = None
    if current_user_id:
        preserved_user = db.query(User).filter(User.id == current_user_id).first()
    if not preserved_user:
        preserved_user = db.query(User).filter(User.role == Role.superadmin).order_by(User.id.asc()).first()
    if not preserved_user:
        preserved_user = db.query(User).order_by(User.id.asc()).first()

    preserved_id = preserved_user.id if preserved_user else None

    # Delete all other users
    if preserved_id is not None:
        users_count = db.query(User).filter(User.id != preserved_id).count()
        db.execute(delete(User).where(User.id != preserved_id))
    else:
        users_count = db.query(User).count()
        db.execute(delete(User))
    db.flush()

    # 4. Delete designations, departments, divisions
    designations_count = db.query(Designation).count()
    departments_count = db.query(Department).count()
    divisions_count = db.query(Division).count()

    db.execute(delete(Designation))
    db.execute(delete(Department))
    db.execute(delete(Division))

    db.commit()

    return {
        **tx_counts,
        "items": items_count,
        "kras": kras_count,
        "templates": templates_count,
        "users": users_count,
        "designations": designations_count,
        "departments": departments_count,
        "divisions": divisions_count,
    }


def main():
    parser = argparse.ArgumentParser(description="Reset KPI System database data")
    parser.add_argument("--confirm", required=True, help="Must be RESET to confirm")
    parser.add_argument("--mode", choices=["full", "transactional"], default="full", help="Reset mode (default: full)")
    args = parser.parse_args()
    if args.confirm != "RESET":
        raise SystemExit("Confirmation must be exactly RESET")
    db = SessionLocal()
    try:
        if args.mode == "full":
            result = reset_full_system_data(db)
        else:
            result = reset_transactional_data(db)
        print("Reset complete:", result)
    finally:
        db.close()


if __name__ == "__main__":
    main()
