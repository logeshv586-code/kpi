from __future__ import annotations

import difflib
import re
from collections import OrderedDict
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .models import Designation, KpiAssignment, KpiItem, KpiTemplate, Kra, TemplateStatus
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
      Pass=100, Fail=0
    """
    text = str(value or "").strip()
    if not text:
        return {}

    result: dict[str, float] = {}
    seen: set[str] = set()
    parts = [part.strip() for part in re.split(r"[;|\n]+", text) if part.strip()]
    if len(parts) == 1 and "," in parts[0] and ("=" in parts[0] or ":" in parts[0]):
        parts = [p.strip() for p in parts[0].split(",") if p.strip()]

    for part in parts:
        match = re.match(r"^(.*?)\s*(?:=|:)\s*(-?\d+(?:\.\d+)?)\s*%?\s*$", part)
        if match:
            label = match.group(1).strip()
            score = float(match.group(2))
            if not label:
                continue
            score = max(0.0, min(100.0, score))
            key = normalize_name(label)
            if key not in seen:
                seen.add(key)
                result[label] = score
        else:
            label = part.strip()
            if label:
                key = normalize_name(label)
                if key not in seen:
                    seen.add(key)
                    result[label] = 100.0 if not result else 0.0

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
        "number_quantity": "number",
        "quantity": "count",
        "quantity_count": "count",
        "number_count": "count",
        "days_time": "days",
        "time_days": "days",
        "boolean": "yesno",
        "yes_no": "yesno",
        "tat": "days",
    }
    raw = aliases.get(raw, raw)
    return raw if raw in {"percentage", "number", "currency", "days", "count", "choice", "yesno", "rating"} else "choice"


def _default_unit(input_type: str) -> str:
    return {
        "percentage": "%",
        "number": "units",
        "count": "units",
        "currency": "INR",
        "days": "days",
    }.get(input_type, "")


def create_template_from_import_rows(
    db: Session,
    name: str,
    designation_id: int | None,
    rows: list[dict[str, Any]],
    source: str,
) -> KpiTemplate:
    if not rows:
        raise HTTPException(400, "No KRA/KPI rows were found in the uploaded file")

    groups: OrderedDict[str, list[dict[str, Any]]] = OrderedDict()
    for row in rows:
        groups.setdefault(str(row["kra"]).strip(), []).append(row)

    provided_kra_weights: dict[str, float] = {}
    for kra_name, kra_rows in groups.items():
        vals = [parse_number(x.get("kra_weight")) for x in kra_rows]
        vals = [v for v in vals if v is not None]
        if vals:
            provided_kra_weights[kra_name] = vals[0]
    if provided_kra_weights and len(provided_kra_weights) == len(groups):
        total_p = sum(provided_kra_weights.values())
        if total_p > 0 and abs(total_p - 100) > 0.01:
            provided_kra_weights = {k: round(v * 100 / total_p, 2) for k, v in provided_kra_weights.items()}
            last_k = list(provided_kra_weights.keys())[-1]
            provided_kra_weights[last_k] = round(
                100 - sum(v for k, v in provided_kra_weights.items() if k != last_k), 2
            )

    use_source_kra = (
        len(provided_kra_weights) == len(groups)
        and abs(sum(provided_kra_weights.values()) - 100) <= 0.01
    )
    if not use_source_kra:
        base = round(100 / len(groups), 2)
        weights = [base for _ in groups]
        weights[-1] = round(100 - sum(weights[:-1]), 2)
        kra_weights = {name_: weights[i] for i, name_ in enumerate(groups)}
    else:
        kra_weights = provided_kra_weights

    designation = db.get(Designation, designation_id) if designation_id else None
    template = KpiTemplate(
        name=name.strip(),
        division_id=(designation.department.division_id if designation and designation.department else None),
        department_id=(designation.department_id if designation else None),
        designation_id=designation_id,
        status=TemplateStatus.draft,
    )
    db.add(template)
    db.flush()

    # Keep an explicit list of only the KRAs created by this import. Do not
    # rely on a relationship collection that may already be populated in a
    # long-lived session; that could combine an older template's KRAs with the
    # uploaded rows and re-normalize both sets of marks.
    imported_kras: list[Kra] = []
    for kra_name, kra_rows in groups.items():
        kra_weight = float(kra_weights[kra_name])
        kra = Kra(name=kra_name, weight=kra_weight)
        template.kras.append(kra)
        imported_kras.append(kra)
        db.flush()

        current_model = any(bool(row.get("current_model")) for row in kra_rows)
        if current_model:
            # Current UI: every KPI is scored out of 100, then KPI marks are
            # averaged inside the KRA. Database weights therefore represent the
            # equal KRA contribution share rather than a user-editable KPI mark.
            per = round(kra_weight / len(kra_rows), 2)
            item_weights = [per] * len(kra_rows)
            item_weights[-1] = round(kra_weight - sum(item_weights[:-1]), 2)
            use_source_items = False
        else:
            # Backward compatibility for old Excel templates that supplied KPI
            # contribution weights directly.
            source_item_weights = [parse_number(r.get("kpi_weight")) for r in kra_rows]
            use_source_items = (
                all(v is not None for v in source_item_weights)
                and abs(sum(v or 0 for v in source_item_weights) - kra_weight) <= 0.01
            )
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
                score_map = parse_dropdown_results(row.get("dropdown_results"))
            else:
                score_map = {}

            configured_source = str(row.get("source") or source or "").strip()
            is_current_row = bool(row.get("current_model"))
            if is_current_row:
                choice_like = input_type in {"choice", "yesno"}
                qualifying_value = parse_number(row.get("qualifying_value"))
                qualifying_value = 0 if qualifying_value is None else qualifying_value
                unit = "" if choice_like else str(row.get("unit") or _default_unit(input_type)).strip()
                meta = {
                    "frequency": str(row.get("frequency") or "Monthly").strip(),
                    "measurement": str(row.get("measurement") or "").strip(),
                    "measurement_type": input_type,
                    "unit": unit,
                    "evidence_required": False,
                    "scoring_model": "kra_average_100",
                    "scoring_method": "choice_map" if choice_like else "measurement_target",
                    "score_base": 100,
                    "marks": 100,
                    "score_cap_pct": 100,
                    "qualifying_value": 0 if choice_like else qualifying_value,
                    "qualification_direction": "none" if choice_like else direction,
                    "minimum_score": 0,
                    "threshold_rule": "none",
                    "threshold_min": None,
                    "threshold_max": None,
                    "source": configured_source,
                    "weight_basis": "Equal KPI average within KRA",
                    "task_responsibility": str(
                        row.get("task_responsibility") or row.get("kpi") or "Complete assigned KPI task"
                    ).strip(),
                    "score_limit": 100,
                }
                item_target = None if choice_like else target
                item_direction = "higher" if choice_like else direction
            else:
                default_weight_basis = (
                    "Source-defined"
                    if use_source_kra and use_source_items
                    else "Provisional auto-balanced weight; HR should review"
                )
                meta = {
                    "frequency": str(row.get("frequency") or "Monthly / as configured").strip(),
                    "unit": str(row.get("unit") or ("%" if input_type == "percentage" else "")).strip(),
                    "measurement": str(row.get("measurement") or "").strip(),
                    "task_responsibility": str(row.get("task_responsibility") or row.get("kpi") or "").strip(),
                    "source": configured_source,
                    "weight_basis": str(row.get("weight_basis") or default_weight_basis).strip(),
                    "scoring_method": "target_ratio",
                    "score_cap_pct": 100,
                    # Evidence/description remain optional in the current KPI Input workflow.
                    "evidence_required": False,
                }
                item_target = target
                item_direction = direction

            options = {"score_map": score_map, "meta": meta}
            db.add(
                KpiItem(
                    kra_id=kra.id,
                    question=str(row["kpi"]).strip(),
                    input_type=input_type,
                    weight=item_weights[idx],
                    target_value=item_target,
                    direction=item_direction,
                    options=options,
                )
            )
    db.flush()

    # Re-normalize template KRA weights so total KRA weight strictly equals 100 marks.
    kra_list = imported_kras
    if kra_list:
        total_k_weight = sum(float(k.weight or 0) for k in kra_list)
        if total_k_weight > 0 and abs(total_k_weight - 100) > 0.01:
            for k in kra_list:
                k.weight = round(float(k.weight or 0) * 100 / total_k_weight, 2)
            kra_list[-1].weight = round(
                100 - sum(float(k.weight) for k in kra_list[:-1]), 2
            )
            for k in kra_list:
                items = list(k.items)
                if items:
                    tot_i = sum(float(i.weight or 0) for i in items)
                    if tot_i > 0 and abs(tot_i - float(k.weight)) > 0.01:
                        for i in items:
                            i.weight = round(float(i.weight or 0) * float(k.weight) / tot_i, 2)
                        items[-1].weight = round(
                            float(k.weight) - sum(float(i.weight) for i in items[:-1]), 2
                        )

    return template
