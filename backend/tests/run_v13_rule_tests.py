"""Focused KPI v1.3 business-rule regression checks.

Run from project root:
    DATABASE_URL=sqlite:////tmp/kpi_v13_rules.db PYTHONPATH=backend python backend/tests/run_v13_rule_tests.py
"""
from __future__ import annotations

import os
import tempfile
from datetime import date
from pathlib import Path

TEST_DB = Path(tempfile.gettempdir()) / "kpi_v13_rules.db"
TEST_DB.unlink(missing_ok=True)
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ.setdefault("SECRET_KEY", "test-secret-test-secret-test-secret-123")

from app.database import Base, engine
from app.models import KpiItem, KpiResponse
from app.routers.kpi_v2_enhancements import _financial_year, _pending_target_month, _period_specs, _review_definition
from app.services import calculate_achievement_percent, calculate_item_score, threshold_status

Base.metadata.create_all(bind=engine)


def item(*, input_type="number", target=100, weight=20, rule="none", minimum=None, maximum=None, direction="higher", unit="count"):
    return KpiItem(
        question="Test KPI",
        input_type=input_type,
        target_value=target,
        weight=weight,
        direction=direction,
        options={
            "score_map": {},
            "meta": {
                "unit": unit,
                "threshold_rule": rule,
                "threshold_min": minimum,
                "threshold_max": maximum,
                "score_cap_pct": 100,
                "scoring_method": "target_ratio",
            },
        },
    )


# Minimum threshold: below qualification is always zero.
minimum_item = item(rule="minimum", minimum=50)
response = KpiResponse(actual_numeric=49)
assert calculate_item_score(minimum_item, response) == 0
assert threshold_status(minimum_item, 49)["status"] == "not_achieved"
response.actual_numeric = 75
assert calculate_item_score(minimum_item, response) == 15
assert calculate_achievement_percent(minimum_item, response) == 75
assert threshold_status(minimum_item, 75)["status"] == "achieved"

# Maximum threshold: useful for defects, complaints, days/TAT, etc.
maximum_item = item(target=5, weight=20, rule="maximum", maximum=5, direction="lower", unit="complaints")
response = KpiResponse(actual_numeric=7)
assert calculate_item_score(maximum_item, response) == 0
response.actual_numeric = 3
assert calculate_item_score(maximum_item, response) == 20

# Range threshold for percentage/quality qualification.
range_item = item(input_type="percentage", target=100, weight=25, rule="range", minimum=80, maximum=100, unit="%")
response = KpiResponse(actual_numeric=79)
assert calculate_item_score(range_item, response) == 0
response.actual_numeric = 87
assert calculate_item_score(range_item, response) == 22  # 21.75 rounds to whole marks
assert calculate_achievement_percent(range_item, response) == 87

# Currency/quantity remain numeric measurements, only display units differ.
currency_item = item(input_type="currency", target=100000, weight=20, rule="minimum", minimum=50000, unit="₹")
response = KpiResponse(actual_numeric=75000)
assert calculate_item_score(currency_item, response) == 15

# April-March financial-year labeling.
assert _financial_year(date(2026, 9, 1)) == "FY 2026-27"
assert _financial_year(date(2027, 3, 1)) == "FY 2026-27"

# September = Monthly + Q2 + H1. March = Monthly + Q4 + H2 + Annual.
sep_specs = _period_specs(date(2026, 9, 1))
assert [row["review_type"] for row in sep_specs] == ["monthly", "quarterly", "half_yearly"]
assert any(row["period_label"].startswith("Q2") for row in sep_specs)
assert any(row["period_label"].startswith("H1") for row in sep_specs)
mar_specs = _period_specs(date(2027, 3, 1))
assert [row["review_type"] for row in mar_specs] == ["monthly", "quarterly", "half_yearly", "annual"]
q4 = _review_definition("quarterly", date(2027, 3, 1))
assert q4[0] == date(2027, 1, 1) and q4[1] == date(2027, 3, 31)
annual = _review_definition("annual", date(2027, 3, 1))
assert annual[0] == date(2026, 4, 1) and annual[1] == date(2027, 3, 31)

# 26th through month-end follows the current review month; the 1st follows
# the previous month. It is a reminder window, never an input lock.
assert _pending_target_month(date(2026, 9, 25)) is None
assert _pending_target_month(date(2026, 9, 26)) == date(2026, 9, 1)
assert _pending_target_month(date(2026, 9, 30)) == date(2026, 9, 1)
assert _pending_target_month(date(2026, 10, 1)) == date(2026, 9, 1)
assert _pending_target_month(date(2026, 10, 2)) is None

print("PASS: min/max/range threshold qualification")
print("PASS: whole-number scoring and achievement")
print("PASS: currency/count/percentage measurement support")
print("PASS: April-March Monthly/Quarterly/Half-Yearly/Annual period rules")
print("PASS: 26th-to-1st reminder window does not restrict KPI input")
print("ALL KPI v1.3 RULE TESTS PASSED")
