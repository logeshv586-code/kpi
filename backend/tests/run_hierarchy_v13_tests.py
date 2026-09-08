"""KPI v1.3 recursive reporting-hierarchy regression checks."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

TEST_DB = Path(tempfile.gettempdir()) / "kpi_v13_hierarchy.db"
TEST_DB.unlink(missing_ok=True)
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ.setdefault("SECRET_KEY", "test-secret-test-secret-test-secret-123")

from app.database import Base, SessionLocal, engine
from app.models import Role, User
from app.routers.kpi_v2_enhancements import _descendant_ids
from app.routers.team_hierarchy_v13 import _visible_structure

Base.metadata.create_all(bind=engine)

db = SessionLocal()
try:
    svp = User(employee_no="SVP1", name="SVP", email="svp@example.com", password_hash="x", role=Role.manager, active=True)
    outsider = User(employee_no="OUT1", name="Outside", email="outside@example.com", password_hash="x", role=Role.manager, active=True)
    db.add_all([svp, outsider]); db.flush()

    avp = User(employee_no="AVP1", name="AVP", email="avp@example.com", password_hash="x", role=Role.manager, manager_id=svp.id, active=True)
    db.add(avp); db.flush()
    manager = User(employee_no="MGR1", name="Manager", email="manager@example.com", password_hash="x", role=Role.manager, manager_id=avp.id, active=True)
    db.add(manager); db.flush()
    employee = User(employee_no="EMP1", name="Employee", email="employee@example.com", password_hash="x", role=Role.employee, manager_id=manager.id, active=True)
    db.add(employee); db.commit()

    descendants = _descendant_ids(db, svp.id)
    assert descendants == {avp.id, manager.id, employee.id}, descendants
    assert outsider.id not in descendants

    users, _, _, visible_ids, _, levels, scope = _visible_structure(db, svp)
    assert scope == "descendants"
    assert visible_ids == {svp.id, avp.id, manager.id, employee.id}
    assert levels[svp.id] == 0
    assert levels[avp.id] == 1
    assert levels[manager.id] == 2
    assert levels[employee.id] == 3
    assert outsider.id not in visible_ids

    print("PASS: SVP sees AVP, Manager and Employee recursively")
    print("PASS: unrelated reporting trees remain hidden")
    print("PASS: hierarchy levels are preserved from Reports To")
    print("ALL KPI v1.3 HIERARCHY TESTS PASSED")
finally:
    db.close()
