"""Regression checks for the spreadsheet-style KRA/KPI scoring model.

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
from app.services import calculate_achievement_percent, calculate_item_score, item_config, threshold_status


def score_item(*, contribution_weight: float, minimum: int = 0) -> KpiItem:
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
                # A stale legacy maximum must be ignored by the current model.
                "threshold_max": 60,
                "score_cap_pct": 100,
            },
        },
    )


# Excel example 1: KRA weight 20, two KPI inputs 50 and 60.
# Calculated KPI values remain 50 and 60. Average = 55.
# KRA score = 55 * 20 / 100 = 11.00.
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

# Excel example 2: KRA weight 100, four KPI inputs, minimum 25.
# 24 is below minimum => calculated KPI 0. The remaining values stay unchanged.
# Average = (0 + 60 + 50 + 100) / 4 = 52.50.
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

# Do not round each KPI contribution before the KRA total. Three perfect KPIs
# inside a KRA weighted 20 must still produce exactly 20.00 after final rounding.
share = 20 / 3
three_marks = [calculate_item_score(score_item(contribution_weight=share), KpiResponse(actual_numeric=100)) for _ in range(3)]
assert round(sum(three_marks), 2) == 20.0

# User-entered KPI values are whole integers. Decimal values are rejected by the API schema.
assert ResponseIn(kpi_item_id=1, actual_numeric=56, manager_actual_numeric=75).actual_numeric == 56
try:
    ResponseIn(kpi_item_id=1, actual_numeric=56.5)
    raise AssertionError("Decimal KPI input should not be accepted")
except ValidationError:
    pass

# Score calculations remain capped at 100 for defensive compatibility.
capped = score_item(contribution_weight=20, minimum=0)
assert calculate_item_score(capped, KpiResponse(actual_numeric=125)) == 20.0
assert calculate_achievement_percent(capped, KpiResponse(actual_numeric=125)) == 100

print("PASS: every KPI uses a fixed score base of 100")
print("PASS: minimum defaults to 0 and below-minimum input calculates to 0")
print("PASS: qualifying input is preserved as the calculated KPI value")
print("PASS: KRA score equals average calculated KPI x KRA weight / 100")
print("PASS: spreadsheet examples calculate to 11.00 and 52.50")
print("PASS: KPI input fields accept whole integers only")
print("PASS: contribution rounding happens at KRA/final level, not per KPI")
print("ALL KRA AVERAGE SCORING TESTS PASSED")
