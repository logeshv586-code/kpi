"""Regression checks for spreadsheet-style KRA/KPI scoring and measurement targets.

Run from project root:
    DATABASE_URL=sqlite:////tmp/kpi_kra_average.db PYTHONPATH=backend python backend/tests/run_kra_average_scoring_tests.py
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

from pydantic import ValidationError

TEST_DB = Path(tempfile.gettempdir()) / "kpi_kra_average.db"
TEST_DB.unlink(missing_ok=True)
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ.setdefault("SECRET_KEY", "test-secret-test-secret-test-secret-123")

from app.models import KpiItem, KpiResponse
from app.schemas import ResponseIn
from app.services import calculate_achievement_percent, calculate_item_score, calculate_kpi_score_100, item_config, threshold_status


def score_item(*, contribution_weight: float, minimum: int = 0) -> KpiItem:
    """Older direct-score current model kept for backward compatibility."""
    return KpiItem(
        question="KPI score",
        input_type="number",
        weight=contribution_weight,
        target_value=100,
        direction="higher",
        options={
            "score_map": {},
            "meta": {
                "scoring_model": "kra_average_100",
                "scoring_method": "direct_score_100",
                "score_base": 100,
                "minimum_score": minimum,
                "threshold_rule": "minimum" if minimum > 0 else "none",
                "threshold_min": minimum,
                "threshold_max": 60,
                "score_cap_pct": 100,
            },
        },
    )


def measured_item(
    *,
    input_type: str,
    target: int,
    qualifier: int = 0,
    direction: str = "higher",
    unit: str = "units",
    contribution_weight: float = 25,
) -> KpiItem:
    return KpiItem(
        question="Measured KPI",
        input_type=input_type,
        weight=contribution_weight,
        target_value=target,
        direction=direction,
        options={
            "score_map": {},
            "meta": {
                "scoring_model": "kra_average_100",
                "scoring_method": "measurement_target",
                "measurement_type": input_type,
                "score_base": 100,
                "marks": 100,
                "unit": unit,
                "qualifying_value": qualifier,
                "qualification_direction": direction,
                "minimum_score": 0,
                "threshold_rule": "none",
                "threshold_min": None,
                "threshold_max": None,
                "score_cap_pct": 100,
            },
        },
    )


# Original Excel example remains supported for templates created before the
# measurement-type enhancement: KRA 20, KPI inputs 50 and 60 => 11.00.
kpi_a = score_item(contribution_weight=10, minimum=0)
kpi_b = score_item(contribution_weight=10, minimum=0)
mark_a = calculate_item_score(kpi_a, KpiResponse(actual_numeric=50))
mark_b = calculate_item_score(kpi_b, KpiResponse(actual_numeric=60))
assert mark_a == 5.0
assert mark_b == 6.0
assert calculate_achievement_percent(kpi_a, KpiResponse(actual_numeric=50)) == 50
assert calculate_achievement_percent(kpi_b, KpiResponse(actual_numeric=60)) == 60
assert round(mark_a + mark_b, 2) == 11.0
assert item_config(kpi_a)["meta"]["threshold_max"] is None

# Original minimum-score example: KRA 100, minimum 25, inputs 24/60/50/100.
values = [24, 60, 50, 100]
marks = []
calculated = []
for value in values:
    item = score_item(contribution_weight=25, minimum=25)
    response = KpiResponse(actual_numeric=value)
    marks.append(calculate_item_score(item, response))
    calculated.append(calculate_achievement_percent(item, response))
assert marks == [0.0, 15.0, 12.5, 25.0]
assert calculated == [0, 60, 50, 100]
assert round(sum(marks), 2) == 52.5
assert threshold_status(score_item(contribution_weight=25, minimum=25), 24)["passed"] is False
assert threshold_status(score_item(contribution_weight=25, minimum=25), 25)["passed"] is True

# Currency / higher-is-better example. Business value is not capped at 100.
# Target INR 100000 = 100 marks; minimum qualifying sales INR 25000.
currency = measured_item(input_type="currency", target=100000, qualifier=25000, unit="INR")
assert calculate_kpi_score_100(currency, KpiResponse(actual_numeric=24000)) == 0
assert calculate_kpi_score_100(currency, KpiResponse(actual_numeric=25000)) == 25
assert calculate_kpi_score_100(currency, KpiResponse(actual_numeric=60000)) == 60
assert calculate_kpi_score_100(currency, KpiResponse(actual_numeric=100000)) == 100
assert calculate_kpi_score_100(currency, KpiResponse(actual_numeric=125000)) == 100
assert threshold_status(currency, 24000)["passed"] is False
assert threshold_status(currency, 25000)["passed"] is True
assert item_config(currency)["meta"]["unit"] == "INR"

# Quantity/count target converts the achieved business count to marks /100.
count = measured_item(input_type="count", target=200, qualifier=0, unit="tickets", contribution_weight=20)
assert calculate_kpi_score_100(count, KpiResponse(actual_numeric=100)) == 50
assert calculate_item_score(count, KpiResponse(actual_numeric=100)) == 10.0

# Percentage works the same way and retains whole-number values.
percentage = measured_item(input_type="percentage", target=100, qualifier=25, unit="%")
assert calculate_kpi_score_100(percentage, KpiResponse(actual_numeric=24)) == 0
assert calculate_kpi_score_100(percentage, KpiResponse(actual_numeric=56)) == 56

# Days/time can use lower-is-better. Target 5 days = 100 marks. Maximum
# qualifying time 10 days; above 10 days receives zero marks.
days = measured_item(input_type="days", target=5, qualifier=10, direction="lower", unit="days")
assert calculate_kpi_score_100(days, KpiResponse(actual_numeric=4)) == 100
assert calculate_kpi_score_100(days, KpiResponse(actual_numeric=10)) == 50
assert calculate_kpi_score_100(days, KpiResponse(actual_numeric=11)) == 0
assert threshold_status(days, 10)["passed"] is True
assert threshold_status(days, 11)["passed"] is False

# Do not round each KPI contribution before the KRA total.
share = 20 / 3
three_marks = [calculate_item_score(score_item(contribution_weight=share), KpiResponse(actual_numeric=100)) for _ in range(3)]
assert round(sum(three_marks), 2) == 20.0

# Employee and manager achieved values are whole integers at the API boundary.
assert ResponseIn(kpi_item_id=1, actual_numeric=56000, manager_actual_numeric=75000).actual_numeric == 56000
try:
    ResponseIn(kpi_item_id=1, actual_numeric=56.5)
    raise AssertionError("Decimal KPI input should not be accepted")
except ValidationError:
    pass

# Direct-score compatibility remains capped at 100.
capped = score_item(contribution_weight=20, minimum=0)
assert calculate_item_score(capped, KpiResponse(actual_numeric=125)) == 20.0
assert calculate_achievement_percent(capped, KpiResponse(actual_numeric=125)) == 100

print("PASS: every KPI carries 100 marks while business measurement values may exceed 100")
print("PASS: Number, Quantity/Count, Currency, Percentage, and Days/Time target scoring works")
print("PASS: higher-is-better and lower-is-better directions work")
print("PASS: qualification value gates KPI marks to zero when not achieved")
print("PASS: employee and manager achieved values are whole integers")
print("PASS: legacy direct-score spreadsheet examples remain 11.00 and 52.50")
print("ALL KRA MEASUREMENT SCORING TESTS PASSED")
