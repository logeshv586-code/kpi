from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from .models import AuditLog, KpiAssignment, KpiItem, KpiResponse, KpiTemplate


def audit(db: Session, actor_id: int | None, action: str, entity_type: str, entity_id: int | None = None, details: dict | None = None):
    db.add(AuditLog(actor_id=actor_id, action=action, entity_type=entity_type, entity_id=entity_id, details=details))


def item_config(item: KpiItem) -> dict[str, Any]:
    """Return normalized dynamic KPI configuration.

    Older templates stored choice mappings directly in ``options``. Newer templates
    use ``options={score_map, meta, thresholds}``. Supporting both makes the
    upgraded package backward compatible with the first version of the app.
    """
    raw = item.options or {}
    if not isinstance(raw, dict):
        raw = {}
    meta = raw.get("meta") if isinstance(raw.get("meta"), dict) else {}
    score_map = raw.get("score_map") if isinstance(raw.get("score_map"), dict) else None
    if score_map is None and item.input_type in {"choice", "yesno"}:
        # Backward-compatible flat option map from older templates.
        score_map = {k: v for k, v in raw.items() if isinstance(v, (int, float)) and k not in {"max"}}
    max_rating = raw.get("max", meta.get("max_rating", 5))
    thresholds = raw.get("thresholds") if isinstance(raw.get("thresholds"), list) else []
    return {
        "meta": meta,
        "score_map": score_map or {},
        "max_rating": max_rating,
        "thresholds": thresholds,
    }


def validate_template(template: KpiTemplate, strict: bool = True) -> tuple[bool, str]:
    """Validate a KPI template.

    Drafts may be incomplete so HR can build them gradually. Publishing uses
    strict=True and requires every KRA/KPI weight to reconcile exactly to 100.
    """
    if not template.kras:
        return False, "Add at least one KRA"

    kra_total = round(sum(float(k.weight or 0) for k in template.kras), 4)
    # Drafts can be built incrementally, but no template may allocate more
    # than the available 100 marks. Publishing requires the full allocation.
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
            if strict and item.input_type == "choice":
                score_map = item_config(item)["score_map"]
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
    """Evaluate configurable threshold bands.

    Each threshold may be ``{"min":95,"score":100}`` for higher-is-better or
    ``{"max":2,"score":100}`` for lower-is-better. The first matching band,
    ordered best-to-worst, is used.
    """
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


def calculate_item_score(item: KpiItem, response: KpiResponse, is_manager: bool = False) -> float:
    cfg = item_config(item)
    meta = cfg["meta"]
    scoring_method = meta.get("scoring_method", "target_ratio")
    cap_pct = float(meta.get("score_cap_pct", 100))
    cap_ratio = max(0.0, cap_pct / 100.0)

    if item.input_type in {"percentage", "number", "currency", "days", "count"}:
        actual_val = response.manager_actual_numeric if is_manager else response.actual_numeric
        if actual_val is None:
            return 0.0
        actual = float(actual_val)

        if scoring_method == "threshold":
            pct = _threshold_score_pct(actual, cfg["thresholds"], item.direction)
            ratio = max(0.0, min((pct or 0) / 100.0, cap_ratio))
            return round(float(item.weight) * ratio, 2)

        if scoring_method == "direct_percentage" or (item.input_type == "percentage" and item.target_value is None):
            ratio = actual / 100.0
        elif item.target_value is None:
            # Safe generic fallback for a numeric KPI with no target.
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
        return round(float(item.weight) * ratio, 2)

    if item.input_type in {"choice", "yesno"}:
        selected = response.manager_selected_option if is_manager else response.selected_option
        if not selected:
            return 0.0
        pct = float(cfg["score_map"].get(selected, 0))
        return round(float(item.weight) * max(0.0, min(pct / 100.0, cap_ratio)), 2)

    if item.input_type == "rating":
        actual_val = response.manager_actual_numeric if is_manager else response.actual_numeric
        if actual_val is None:
            return 0.0
        max_rating = max(1.0, float(cfg["max_rating"] or 5))
        return round(float(item.weight) * max(0.0, min(float(actual_val) / max_rating, cap_ratio)), 2)

    return 0.0


def calculate_achievement_percent(item: KpiItem, response: KpiResponse) -> float:
    """Return human-readable achievement percentage independent of mark weight."""
    if float(item.weight or 0) <= 0:
        return 0.0
    score = calculate_item_score(item, response)
    return round(score / float(item.weight) * 100.0, 1)


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
    for response in assignment.responses:
        response.score = calculate_item_score(response.item, response, is_manager=False)
        response.manager_score = calculate_item_score(response.item, response, is_manager=True)
        total += response.score
        manager_total += response.manager_score
    assignment.calculated_score = round(min(total, 100.0), 2)
    assignment.manager_score = round(min(manager_total, 100.0), 2)
    db.flush()
    return assignment.calculated_score
