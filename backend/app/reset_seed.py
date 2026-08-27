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
from .models import AuditLog, Department, Designation, Division, KpiAssignment, KpiCycle, KpiResponse, KpiReview, KpiTemplate, Role, User


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

    templates = db.query(KpiTemplate).count()
    db.execute(delete(KpiTemplate))

    db.query(User).update({User.manager_id: None, User.designation_id: None})
    db.commit()

    if current_user_id:
        users = db.query(User).filter(User.id != current_user_id, User.role != Role.superadmin).count()
        db.execute(delete(User).where(User.id != current_user_id, User.role != Role.superadmin))
    else:
        users = db.query(User).filter(User.email != "superadmin@kpi.com").count()
        db.execute(delete(User).where(User.email != "superadmin@kpi.com"))

    designations = db.query(Designation).count()
    departments = db.query(Department).count()
    divisions = db.query(Division).count()

    db.execute(delete(Designation))
    db.execute(delete(Department))
    db.execute(delete(Division))

    db.commit()

    return {
        **tx_counts,
        "templates": templates,
        "users": users,
        "designations": designations,
        "departments": departments,
        "divisions": divisions,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm", required=True)
    args = parser.parse_args()
    if args.confirm != "RESET":
        raise SystemExit("Confirmation must be exactly RESET")
    db = SessionLocal()
    try:
        result = reset_transactional_data(db)
        print("Reset complete:", result)
    finally:
        db.close()


if __name__ == "__main__":
    main()
