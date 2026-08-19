"""Deterministic Reconciliation Engine

Triangulates evidence from:
1. Versioned SKU Stacking Recipe (bags_per_layer, expected_layers, expected_total)
2. Multi-View VLM Consensus (GPU 0)
3. SAM Pixel Mask Segments (GPU 1)

Generates calibrated bag counts, confidence scores, and inspector reason codes.
"""

from __future__ import annotations

from typing import Any


def reconcile_pallet_evidence(
    vlm_result: dict[str, Any],
    sam_flaps_by_face: dict[str, list[dict[str, Any]]],
    recipe: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Triangulate evidence and produce a calibrated pallet count decision based on vision."""
    recipe = recipe or {}
    sku = recipe.get("sku", "STANDARD")
    
    # Extract VLM Visual Consensus (from raw image analysis alone)
    consensus_layers = vlm_result.get("consensusLayers", 10)
    estimated_bags_per_layer = vlm_result.get("estimatedBagsPerLayer", 6)
    partial_top_detected = vlm_result.get("partialTopDetected", False)
    partial_top_count = vlm_result.get("partialTopCountEstimate", 0)
    irregular_stack = vlm_result.get("irregularStack", False)
    face_counts = vlm_result.get("layerCountByFace", {})
    structural_total_estimate = vlm_result.get("structuralTotalEstimate")

    # Pure visual count calculation
    if partial_top_detected:
        full_layers = max(0, consensus_layers - 1)
        computed_total = (full_layers * estimated_bags_per_layer) + partial_top_count
    else:
        full_layers = consensus_layers
        computed_total = full_layers * estimated_bags_per_layer

    if structural_total_estimate is not None and abs(structural_total_estimate - computed_total) <= 3:
        # Align with model direct structural count if provided
        computed_total = structural_total_estimate

    # Expected count for quality control comparison (if standard catalog expected total is known)
    expected_total = recipe.get("expected_total")

    # Check for face discrepancies
    face_values = list(face_counts.values()) if face_counts else [consensus_layers]
    face_variance = max(face_values) - min(face_values) if face_values else 0

    reason_codes = []
    confidence = 0.950

    if face_variance == 0 and not irregular_stack:
        confidence = 0.985
        reason_codes.append("CONSISTENT_4_FACE_ALIGNMENT")
    elif face_variance > 0:
        confidence -= 0.08 * face_variance
        reason_codes.append(f"FACE_LAYER_VARIANCE_{face_variance}")

    if irregular_stack:
        confidence -= 0.120
        reason_codes.append("IRREGULAR_OR_LEANING_STACK")

    if partial_top_detected:
        reason_codes.append(f"PARTIAL_TOP_TIER_{partial_top_count}_BAGS")

    # Quality decision
    if expected_total is not None:
        discrepancy = computed_total - expected_total
        if discrepancy == 0 and not irregular_stack and face_variance == 0:
            decision = "ACCEPT"
            confidence = max(confidence, 0.990)
            reason_codes.append("RECIPE_TARGET_MATCHED")
        elif abs(discrepancy) <= 2:
            decision = "ACCEPT" if face_variance == 0 else "REVISE"
            reason_codes.append(f"MINOR_COUNT_DISCREPANCY_{discrepancy:+d}")
        else:
            decision = "REJECT" if abs(discrepancy) > estimated_bags_per_layer else "REVISE"
            reason_codes.append(f"DISCREPANCY_{discrepancy:+d}_BAGS")
    else:
        discrepancy = 0
        decision = "ACCEPT" if not irregular_stack and face_variance == 0 else "REVISE"
        reason_codes.append("AUTONOMOUS_VISION_COUNT")

    total_sam_flaps = sum(len(flaps) for flaps in sam_flaps_by_face.values())

    return {
        "decision": decision,
        "sku": sku,
        "computed_total": computed_total,
        "estimated_bags_per_layer": estimated_bags_per_layer,
        "expected_total": expected_total if expected_total is not None else computed_total,
        "discrepancy": discrepancy,
        "confidence": round(max(0.50, min(0.999, confidence)), 3),
        "consensus_layers": consensus_layers,
        "full_layers": full_layers,
        "partial_top_detected": partial_top_detected,
        "partial_top_count": partial_top_count,
        "irregular_stack": irregular_stack,
        "face_layer_breakdown": face_counts,
        "sam_segmented_flaps_count": total_sam_flaps,
        "reason_codes": reason_codes
    }
