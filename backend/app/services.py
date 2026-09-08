from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from .models import AuditLog, KpiAssignment, KpiItem, KpiResponse, KpiTemplate


NUMERIC_INPUT_TYPES = {"percentage", "number", "currency", "days", "count"}
THRESHOLD_RULES = {"none", "minimum", "maximum", "range"}


def audit(db: Session, actor_id: int | None, action: str, entity_type: str, entity_id: int | None = None, details: dict | None = None):
    db.add(AuditLog(actor_id=actor_id, action=action, entity_type=entity_type, entity_id=entity_id, details=details))


def _optional_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def item_config(item: KpiItem) -> dict[str, Any]:
    """Return normalized dynamic KPI configuration.

    Older templates stored choice mappings directly in ``options``. Newer templates
    use ``options={score_map, meta, thresholds}``. Supporting both keeps historical
    templates valid while v2 adds measurable min/max threshold rules.
    """
    raw = item.options or {}
    if not isinstance(raw, dict):
        raw = {}
    meta = raw.get("meta") if isinstance(raw.get("meta"), dict) else {}
    meta = dict(meta)
    score_map = raw.get("score_map") if isinstance(raw.get("score_map"), dict) else None
    if score_map is None and item.input_type in {"choice", "yesno"}:
        score_map = {k: v for k, v in raw.items() if isinstance(v, (int, float)) and k not in {"max"}}
    max_rating = raw.get("max", meta.get("max_rating", 5))
    thresholds = raw.get("thresholds") if isinstance(raw.get("thresholds"), list) else []

    threshold_min = _optional_float(meta.get("threshold_min"))
    threshold_max = _optional_float(meta.get("threshold_max"))
    threshold_rule = str(meta.get("threshold_rule") or "none").lower()
    if threshold_rule not in THRESHOLD_RULES:
        threshold_rule = "none"
    if threshold_rule == "none":
        if threshold_min is not None and threshold_max is not None:
            threshold_rule = "range"
        elif threshold_min is not None:
            threshold_rule = "minimum"
        elif threshold_max is not None:
            threshold_rule = "maximum"
    meta["threshold_rule"] = threshold_rule
    meta["threshold_min"] = threshold_min
    meta["threshold_max"] = threshold_max

    return {
        "meta": meta,
        "score_map": score_map or {},
        "max_rating": max_rating,
        "thresholds": thresholds,
    }


def validate_template(template: KpiTemplate, strict: bool = True) -> tuple[bool, str]:
    """Validate a KPI template."""
    if not template.kras:
        return False, "Add at least one KRA"

    kra_total = round(sum(float(k.weight or 0) for k in template.kras), 4)
    if kra_total > 100.001:
        return False, f"KRA total cannot exceed 100. Current total: {kra_total}"
    if strict and abs(kra_total - 100) > 0.001:
        return False, f"KRA total must equal 100. Current total: {kra_total}"

    for kra in template.kras:
        if not kra.name.strip():
            return False, "Every KRA needs a name"
        if strict and float(kra.weight or 0) <= 0:
            return False, f"KRA '{kra.name}' must have a positive weight"
        if not kra.items:
            return False, f"KRA '{kra.name}' must contain at least one KPI parameter"
        item_total = round(sum(float(i.weight or 0) for i in kra.items), 4)
        if item_total > float(kra.weight or 0) + 0.001:
            return False, f"KPI weights inside '{kra.name}' cannot exceed {kra.weight}. Current total: {item_total}"
        if strict and abs(item_total - float(kra.weight or 0)) > 0.001:
            return False, f"KPI weights inside '{kra.name}' must total {kra.weight}. Current total: {item_total}"
        for item in kra.items:
            if not item.question.strip():
                return False, f"Every KPI parameter inside '{kra.name}' needs a name"
            if strict and float(item.weight or 0) <= 0:
                return False, f"KPI '{item.question}' must have a positive weight"
            if item.direction not in {"higher", "lower"}:
                return False, f"KPI '{item.question}' has an invalid direction"

            cfg = item_config(item)
            meta = cfg["meta"]
            minimum = meta.get("threshold_min")
            maximum = meta.get("threshold_max")
            rule = meta.get("threshold_rule", "none")
            if minimum is not None and maximum is not None and minimum > maximum:
                return False, f"KPI '{item.question}' minimum threshold cannot be greater than maximum threshold"
            if item.input_type == "percentage":
                for label, value in (("minimum", minimum), ("maximum", maximum)):
                    if value is not None and not 0 <= value <= 100:
                        return False, f"KPI '{item.question}' {label} percentage threshold must be between 0 and 100"
            if rule == "minimum" and minimum is None:
                return False, f"KPI '{item.question}' requires a minimum threshold"
            if rule == "maximum" and maximum is None:
                return False, f"KPI '{item.question}' requires a maximum threshold"
            if rule == "range" and minimum is None and maximum is None:
                return False, f"KPI '{item.question}' requires at least one range boundary"

            if strict and item.input_type == "choice":
                score_map = cfg["score_map"]
                if not score_map:
                    return False, f"KPI '{item.question}' uses Custom Dropdown. Add at least one result name and score before publishing"
                for label, score in score_map.items():
                    if not str(label).strip():
                        return False, f"KPI '{item.question}' has a blank Custom Dropdown result name"
                    try:
                        score_value = float(score)
                    except (TypeError, ValueError):
                        return False, f"KPI '{item.question}' has an invalid score for result '{label}'"
                    if score_value < 0 or score_value > 100:
                        return False, f"KPI '{item.question}' result '{label}' score must be between 0 and 100"
    return True, "OK"


def _threshold_score_pct(actual: float, thresholds: list[dict], direction: str) -> float | None:
    if not thresholds:
        return None
    if direction == "lower":
        rows = sorted(thresholds, key=lambda x: float(x.get("max", float("inf"))))
        for row in rows:
            if "max" in row and actual <= float(row["max"]):
                return float(row.get("score", row.get("score_pct", 0)))
    else:
        rows = sorted(thresholds, key=lambda x: float(x.get("min", float("-inf"))), reverse=True)
        for row in rows:
            if "min" in row and actual >= float(row["min"]):
                return float(row.get("score", row.get("score_pct", 0)))
    return 0.0


def threshold_status(item: KpiItem, actual: float | None) -> dict[str, Any]:
    """Return threshold pass/fail information for measurable numeric KPIs."""
    cfg = item_config(item)
    meta = cfg["meta"]
    rule = meta.get("threshold_rule", "none")
    minimum = _optional_float(meta.get("threshold_min"))
    maximum = _optional_float(meta.get("threshold_max"))
    if actual is None or item.input_type not in NUMERIC_INPUT_TYPES:
        return {"rule": rule, "minimum": minimum, "maximum": maximum, "passed": None, "status": "not_completed"}

    value = float(actual)
    passed = True
    reason = "Threshold achieved"
    if rule == "minimum" and minimum is not None:
        passed = value >= minimum
        reason = "Minimum achieved" if passed else f"Minimum {minimum:g} not achieved"
    elif rule == "maximum" and maximum is not None:
        passed = value <= maximum
        reason = "Maximum limit met" if passed else f"Maximum {maximum:g} exceeded"
    elif rule == "range":
        if minimum is not None and value < minimum:
            passed = False
            reason = f"Minimum {minimum:g} not achieved"
        elif maximum is not None and value > maximum:
            passed = False
            reason = f"Maximum {maximum:g} exceeded"
        else:
            reason = "Within acceptable range"
    return {
        "rule": rule,
        "minimum": minimum,
        "maximum": maximum,
        "passed": passed,
        "status": "achieved" if passed else "not_achieved",
        "reason": reason,
    }


def _threshold_gate(item: KpiItem, actual: float) -> bool:
    status = threshold_status(item, actual)
    return status.get("passed") is not False


def calculate_item_score(item: KpiItem, response: KpiResponse, is_manager: bool = False) -> float:
    cfg = item_config(item)
    meta = cfg["meta"]
    scoring_method = meta.get("scoring_method", "target_ratio")
    cap_pct = float(meta.get("score_cap_pct", 100))
    cap_ratio = max(0.0, cap_pct / 100.0)

    if item.input_type in NUMERIC_INPUT_TYPES:
        actual_val = response.manager_actual_numeric if is_manager else response.actual_numeric
        if actual_val is None:
            return 0.0
        actual = float(actual_val)

        # Hard threshold rule: below the configured minimum / above the configured
        # maximum receives zero marks even when the target-ratio formula would
        # otherwise award partial marks.
        if not _threshold_gate(item, actual):
            return 0.0

        if scoring_method == "threshold":
            pct = _threshold_score_pct(actual, cfg["thresholds"], item.direction)
            ratio = max(0.0, min((pct or 0) / 100.0, cap_ratio))
            return float(round(float(item.weight) * ratio))

        if scoring_method == "direct_percentage" or (item.input_type == "percentage" and item.target_value is None):
            ratio = actual / 100.0
        elif item.target_value is None:
            ratio = actual / 100.0
        elif item.direction == "lower" and float(item.target_value) == 0:
            ratio = 1.0 if actual <= 0 else 0.0
        elif item.direction == "lower":
            if actual <= float(item.target_value):
                ratio = 1.0
            elif actual <= 0:
                ratio = 1.0
            else:
                ratio = float(item.target_value) / actual
        else:
            target = float(item.target_value)
            ratio = 1.0 if target == 0 and actual >= 0 else (actual / target if target else 0.0)

        ratio = max(0.0, min(ratio, cap_ratio))
        return float(round(float(item.weight) * ratio))

    if item.input_type in {"choice", "yesno"}:
        selected = response.manager_selected_option if is_manager else response.selected_option
        if not selected:
            return 0.0
        pct = float(cfg["score_map"].get(selected, 0))
        return float(round(float(item.weight) * max(0.0, min(pct / 100.0, cap_ratio))))

    if item.input_type == "rating":
        actual_val = response.manager_actual_numeric if is_manager else response.actual_numeric
        if actual_val is None:
            return 0.0
        max_rating = max(1.0, float(cfg["max_rating"] or 5))
        return float(round(float(item.weight) * max(0.0, min(float(actual_val) / max_rating, cap_ratio))))

    return 0.0


def calculate_achievement_percent(item: KpiItem, response: KpiResponse, is_manager: bool = False) -> int:
    """Return measurable achievement percentage, independent of threshold score gating."""
    cfg = item_config(item)
    if item.input_type in {"choice", "yesno"}:
        selected = response.manager_selected_option if is_manager else response.selected_option
        return int(round(float(cfg["score_map"].get(selected, 0)))) if selected else 0

    actual_val = response.manager_actual_numeric if is_manager else response.actual_numeric
    if actual_val is None:
        return 0
    actual = float(actual_val)
    if item.input_type == "percentage" and item.target_value is None:
        return int(round(max(0.0, actual)))
    if item.target_value is None:
        if float(item.weight or 0) <= 0:
            return 0
        score = calculate_item_score(item, response, is_manager=is_manager)
        return int(round(score / float(item.weight) * 100.0))

    target = float(item.target_value)
    if item.direction == "lower":
        if actual <= 0:
            pct = 100.0 if target >= 0 else 0.0
        elif target == 0:
            pct = 100.0 if actual <= 0 else 0.0
        else:
            pct = min(100.0, target / actual * 100.0)
    else:
        pct = 100.0 if target == 0 and actual >= 0 else (actual / target * 100.0 if target else 0.0)
    return int(round(max(0.0, pct)))


def recalc_assignment(db: Session, assignment_id: int) -> float:
    assignment = db.scalar(
        select(KpiAssignment)
        .where(KpiAssignment.id == assignment_id)
        .options(joinedload(KpiAssignment.responses).joinedload(KpiResponse.item))
    )
    if not assignment:
        return 0.0
    total = 0.0
    manager_total = 0.0
    has_manager_input = False
    for response in assignment.responses:
        response.score = calculate_item_score(response.item, response, is_manager=False)
        manager_present = response.manager_actual_numeric is not None or bool(response.manager_selected_option)
        response.manager_score = calculate_item_score(response.item, response, is_manager=True) if manager_present else 0.0
        total += response.score
        manager_total += response.manager_score
        has_manager_input = has_manager_input or manager_present
    assignment.calculated_score = float(round(min(total, 100.0)))
    assignment.manager_score = float(round(min(manager_total, 100.0))) if has_manager_input else None
    db.flush()
    return assignment.calculated_score
