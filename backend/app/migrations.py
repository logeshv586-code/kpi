from sqlalchemy import inspect, text
from .database import engine


def ensure_schema_upgrades():
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "kpi_responses" in tables:
        columns = {c["name"] for c in inspector.get_columns("kpi_responses")}
        if "evidence_file_id" not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE kpi_responses ADD COLUMN evidence_file_id VARCHAR(80)"))
            inspector = inspect(engine)
            columns.add("evidence_file_id")
        if "measurement" not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE kpi_responses ADD COLUMN measurement TEXT"))
            inspector = inspect(engine)
        indexes = {idx.get("name") for idx in inspector.get_indexes("kpi_responses")}
        if "ix_kpi_responses_evidence_file_id" not in indexes:
            with engine.begin() as conn:
                conn.execute(text("CREATE INDEX ix_kpi_responses_evidence_file_id ON kpi_responses (evidence_file_id)"))
    if "kpi_templates" in tables:
        columns = {c["name"] for c in inspector.get_columns("kpi_templates")}
        with engine.begin() as conn:
            if "division_id" not in columns:
                conn.execute(text("ALTER TABLE kpi_templates ADD COLUMN division_id INTEGER"))
            if "department_id" not in columns:
                conn.execute(text("ALTER TABLE kpi_templates ADD COLUMN department_id INTEGER"))
    if "users" in tables:
        columns = {c["name"] for c in inspector.get_columns("users")}
        if "employee_no" not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN employee_no VARCHAR(50)"))
