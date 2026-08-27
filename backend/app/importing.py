from __future__ import annotations

import difflib
import re
from collections import OrderedDict
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .models import KpiAssignment, KpiItem, KpiTemplate, Kra, TemplateStatus
from .services import item_config


def normalize_name(text: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).strip()


def parse_number(value: Any) -> float | None:
    text = str(value or "").strip()
    if not text:
        return None
    text = text.replace(",", "").replace("₹", "").replace("$", "").replace("%", "").strip()
    try:
        return float(text)
    except ValueError:
        match = re.search(r"-?\d+(?:\.\d+)?", text)
        return float(match.group(0)) if match else None


def parse_dropdown_results(value: Any) -> dict[str, float]:
    """Parse a user-defined score map from Excel/CSV.

    Accepted examples:
      Customer A=100; Customer B=80; Pending=40
      Completed:100 | Partial:50 | Not completed:0

    Result names are preserved exactly as typed while duplicate detection is
    case/punctuation-insensitive to match KPI input validation.
    """
    text = str(value or "").strip()
    if not text:
        return {}

    result: dict[str, float] = {}
    seen: set[str] = set()
    parts = [part.strip() for part in re.split(r"[;|\n]+", text) if part.strip()]
    for part in parts:
        match = re.match(r"^(.*?)\s*(?:=|:)\s*(-?\d+(?:\.\d+)?)\s*%?\s*$", part)
        if not match:
            raise HTTPException(
                400,
                f"Invalid Custom Dropdown Results value '{part}'. Use Result Name=Score; Result Name=Score",
            )
        label = match.group(1).strip()
        score = float(match.group(2))
        if not label:
            raise HTTPException(400, "Every custom dropdown result needs a name")
        if score < 0 or score > 100:
            raise HTTPException(400, f"Custom dropdown score for '{label}' must be between 0 and 100")
        key = normalize_name(label)
        if key in seen:
            raise HTTPException(400, f"Duplicate custom dropdown result '{label}'")
        seen.add(key)
        result[label] = score
    return result


def match_response_rows(assignment: KpiAssignment, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items = [item for kra in assignment.template.kras for item in kra.items]
    normalized = {item.id: normalize_name(item.question) for item in items}
    preview = []
    for row in rows:
        query = normalize_name(row.get("kpi_parameter"))
        best: KpiItem | None = None
        confidence = 0.0
        for item in items:
            target = normalized[item.id]
            ratio = 1.0 if query and query == target else difflib.SequenceMatcher(None, query, target).ratio()
            if query and (query in target or target in query):
                ratio = max(ratio, 0.92)
            if ratio > confidence:
                best, confidence = item, ratio
        matched = best is not None and confidence >= 0.62
        result: dict[str, Any] = {
            **row,
            "matched": matched,
            "confidence": round(confidence * 100, 1),
            "kpi_item_id": best.id if matched else None,
            "matched_question": best.question if matched else None,
            "input_type": best.input_type if matched else None,
            "actual_numeric": None,
            "selected_option": None,
            "value_valid": None,
            "value_message": None,
        }
        if matched and best:
            raw = str(row.get("actual_value") or "").strip()
            if best.input_type in {"choice", "yesno"}:
                score_map = item_config(best).get("score_map", {})
                # Result names are business-defined values (customer/status/result names).
                # Match them exactly after normalization so Customer A cannot silently
                # become Customer B through fuzzy matching.
                option = next((name for name in score_map if normalize_name(name) == normalize_name(raw)), None)
                result["selected_option"] = option
                result["value_valid"] = option is not None
                if option is None:
                    if not score_map:
                        result["value_message"] = "No custom dropdown results are configured for this KPI"
                    elif not raw:
                        result["value_message"] = "Enter one of the configured dropdown result names"
                    else:
                        result["value_message"] = f"'{raw}' is not a configured dropdown result"
            else:
                numeric = parse_number(raw)
                result["actual_numeric"] = numeric
                result["value_valid"] = numeric is not None
                if numeric is None:
                    result["value_message"] = "Enter a valid number or percentage"
        preview.append(result)
    return preview


def _truthy(value: Any) -> bool:
    return normalize_name(value) in {"yes", "true", "1", "required", "y"}


def _valid_input_type(value: Any) -> str:
    raw = normalize_name(value).replace(" ", "_")
    aliases = {
        "objective": "choice",
        "multiple_choice": "choice",
        "custom_dropdown": "choice",
        "dropdown": "choice",
        "boolean": "yesno",
        "yes_no": "yesno",
        "tat": "days",
    }
    raw = aliases.get(raw, raw)
    return raw if raw in {"percentage", "number", "currency", "days", "count", "choice", "yesno", "rating"} else "choice"


def create_template_from_import_rows(db: Session, name: str, designation_id: int | None, rows: list[dict[str, Any]], source: str) -> KpiTemplate:
    if not rows:
        raise HTTPException(400, "No KRA/KPI rows were found in the uploaded file")

    groups: OrderedDict[str, list[dict[str, Any]]] = OrderedDict()
    for row in rows:
        groups.setdefault(str(row["kra"]).strip(), []).append(row)

    # Determine KRA weights. If the source provides complete valid KRA weights, preserve them.
    provided_kra_weights: dict[str, float] = {}
    for kra_name, kra_rows in groups.items():
        vals = [parse_number(x.get("kra_weight")) for x in kra_rows]
        vals = [v for v in vals if v is not None]
        if vals:
            provided_kra_weights[kra_name] = vals[0]
    use_source_kra = len(provided_kra_weights) == len(groups) and abs(sum(provided_kra_weights.values()) - 100) <= 0.01
    if not use_source_kra:
        base = round(100 / len(groups), 2)
        weights = [base for _ in groups]
        weights[-1] = round(100 - sum(weights[:-1]), 2)
        kra_weights = {name_: weights[i] for i, name_ in enumerate(groups)}
    else:
        kra_weights = provided_kra_weights

    template = KpiTemplate(name=name.strip(), designation_id=designation_id, status=TemplateStatus.draft)
    db.add(template)
    db.flush()

    for kra_name, kra_rows in groups.items():
        kra_weight = float(kra_weights[kra_name])
        kra = Kra(template_id=template.id, name=kra_name, weight=kra_weight)
        db.add(kra)
        db.flush()
        source_item_weights = [parse_number(r.get("kpi_weight")) for r in kra_rows]
        use_source_items = all(v is not None for v in source_item_weights) and abs(sum(v or 0 for v in source_item_weights) - kra_weight) <= 0.01
        if use_source_items:
            item_weights = [float(v or 0) for v in source_item_weights]
        else:
            per = round(kra_weight / len(kra_rows), 2)
            item_weights = [per] * len(kra_rows)
            item_weights[-1] = round(kra_weight - sum(item_weights[:-1]), 2)

        for idx, row in enumerate(kra_rows):
            target = parse_number(row.get("target"))
            input_type = _valid_input_type(row.get("input_type"))
            if not row.get("input_type") and target is not None:
                input_type = "percentage" if "%" in str(row.get("target")) else "number"
            direction = normalize_name(row.get("direction"))
            direction = "lower" if direction.startswith("lower") or "less" in direction else "higher"

            if input_type == "yesno":
                score_map = {"Yes": 100, "No": 0}
            elif input_type == "choice":
                # Fully user-defined. When supplied in Excel/CSV, import the exact
                # result names and score percentages. When blank, keep it blank so
                # HR/Admin completes the draft in Template Builder before publish.
                score_map = parse_dropdown_results(row.get("dropdown_results"))
            else:
                score_map = {}

            options = {
                "score_map": score_map,
                "meta": {
                    "frequency": str(row.get("frequency") or "Monthly / as configured").strip(),
                    "measurement": str(row.get("measurement") or "").strip(),
                    "source": source,
                    "weight_basis": "Source-defined" if use_source_kra and use_source_items else "Provisional auto-balanced weight; HR should review",
                    "scoring_method": "target_ratio",
                    "score_cap_pct": 100,
                    "evidence_required": _truthy(row.get("evidence_required")),
                },
            }
            db.add(KpiItem(
                kra_id=kra.id,
                question=str(row["kpi"]).strip(),
                input_type=input_type,
                weight=item_weights[idx],
                target_value=target,
                direction=direction,
                options=options,
            ))
    db.flush()
    return template
