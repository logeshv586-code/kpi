"""Regression checks for the KRA average-of-100 scoring model shown in the business spreadsheet.

Run from project root:
    DATABASE_URL=sqlite:////tmp/kpi_kra_average.db PYTHONPATH=backend python backend/tests/run_kra_average_scoring_tests.py
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

TEST_DB = Path(tempfile.gettempdir()) / "kpi_kra_average.db"
TEST_DB.unlink(missing_ok=True)
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ.setdefault("SECRET_KEY", "test-secret-test-secret-test-secret-123")

from app.models import KpiItem, KpiResponse
from app.services import calculate_achievement_percent, calculate_item_score, item_config, threshold_status


def score_item(*, contribution_weight: float, minimum: float = 0) -> KpiItem:
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
                # A stale legacy maximum must be ignored by the new model.
                "threshold_max": 60,
                "score_cap_pct": 100,
            },
        },
    )


# Screenshot example 1: KRA weight 20, two KPI scores 50 and 60.
# Average = 55, so KRA contribution = 55 * 20 / 100 = 11.00.
kpi_a = score_item(contribution_weight=10, minimum=0)
kpi_b = score_item(contribution_weight=10, minimum=0)
mark_a = calculate_item_score(kpi_a, KpiResponse(actual_numeric=50))
mark_b = calculate_item_score(kpi_b, KpiResponse(actual_numeric=60))
assert mark_a == 5.0
assert mark_b == 6.0
assert round(mark_a + mark_b, 2) == 11.0
assert item_config(kpi_a)["meta"]["threshold_max"] is None

# Screenshot example 2: KRA weight 100, four equal KPIs, minimum score 25.
# 24 is below minimum => 0. Remaining scores are 60, 50 and 100.
# Average = (0 + 60 + 50 + 100) / 4 = 52.50.
values = [24, 60, 50, 100]
marks = []
achievements = []
for value in values:
    item = score_item(contribution_weight=25, minimum=25)
    response = KpiResponse(actual_numeric=value)
    marks.append(calculate_item_score(item, response))
    achievements.append(calculate_achievement_percent(item, response))

assert marks == [0.0, 15.0, 12.5, 25.0]
assert achievements == [0, 60, 50, 100]
assert round(sum(marks), 2) == 52.5
assert threshold_status(score_item(contribution_weight=25, minimum=25), 24)["passed"] is False
assert threshold_status(score_item(contribution_weight=25, minimum=25), 25)["passed"] is True

# Scores are capped at 100 even if a caller sends a larger numeric value.
capped = score_item(contribution_weight=20, minimum=0)
assert calculate_item_score(capped, KpiResponse(actual_numeric=125)) == 20.0
assert calculate_achievement_percent(capped, KpiResponse(actual_numeric=125)) == 100

print("PASS: every KPI uses an independent 0-100 score base")
print("PASS: minimum defaults to 0 and below-minimum KPI scores become 0")
print("PASS: KRA contribution equals average KPI score multiplied by KRA weight")
print("PASS: screenshot examples calculate to 11.00 and 52.50")
print("ALL KRA AVERAGE SCORING TESTS PASSED")
