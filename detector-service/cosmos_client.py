"""Cosmos Reason 2 client for target-pallet selection and pallet-face geometry."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass

import httpx

from geometry import Quad, estimate_quad_skew, validate_quad
from schemas import NormalizedBox, validate_xyxy


@dataclass(frozen=True)
class PalletLocation:
    box: NormalizedBox | None
    confidence: float | None
    multiple_visible: bool
    ambiguous: bool
    reason: str | None
    selection_reason: str | None
    primary_face: str | None = None
    primary_face_quad: Quad | None = None
    secondary_faces_visible: tuple[str, ...] = ()
    yaw_degrees: float | None = None
    pitch_degrees: float | None = None
    visibility: float | None = None
    safe_to_rectify: bool = False
    geometry_confidence: float | None = None


def _last_json_object(text: str) -> dict | None:
    body = re.sub(r"<think>[\s\S]*?</think>", " ", text, flags=re.IGNORECASE)
    decoder = json.JSONDecoder()
    found: dict | None = None
    for index, char in enumerate(body):
        if char != "{":
            continue
        try:
            value, _ = decoder.raw_decode(body[index:])
            if isinstance(value, dict):
                found = value
        except json.JSONDecodeError:
            pass
    return found


def _number(value: object) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _quad_matches_box(quad: Quad, box: NormalizedBox, tolerance: float = 0.04) -> bool:
    x1, y1, x2, y2 = box
    return all(
        x1 - tolerance <= x <= x2 + tolerance and y1 - tolerance <= y <= y2 + tolerance
        for x, y in quad
    )


class CosmosPalletLocator:
    def __init__(self) -> None:
        self.url = os.environ.get("COSMOS_URL", "http://127.0.0.1:8000/v1/chat/completions").strip()
        self.model = os.environ.get("COSMOS_MODEL", "nvidia/cosmos-reason2-2b").strip()
        self.timeout = float(os.environ.get("COSMOS_TIMEOUT_SECONDS", "12"))
        self.min_confidence = float(os.environ.get("COSMOS_MIN_CONFIDENCE", "0.70"))
        self.min_geometry_confidence = float(os.environ.get("COSMOS_MIN_GEOMETRY_CONFIDENCE", "0.70"))
        self.min_visibility = float(os.environ.get("PALLET_MIN_FACE_VISIBILITY", "0.55"))
        self.max_skew = float(os.environ.get("PALLET_MAX_RECTIFY_SKEW", "0.70"))
        self.disabled = os.environ.get("COSMOS_DISABLED", "false").lower() == "true"
        self.version = f"cosmos:{self.model}:geometry-v1"

    async def locate(self, data_url: str) -> PalletLocation:
        if self.disabled:
            return PalletLocation(None, None, False, True, "Cosmos is disabled", None)

        prompt = (
            "You are the geometry model in an industrial pallet inspection system. Identify the ONE pallet the "
            "inspector intends to photograph. It normally has greatest overlap with the central 50% capture guide "
            "and is usually the closest/largest pallet. Other pallets may be visible; do not select them. Then "
            "identify the single visible pallet face best suited for bag counting. Prefer FRONT when sufficiently "
            "visible, otherwise choose LEFT or RIGHT. Return the four OUTER corners of that physical face, even "
            "when it is a perspective trapezoid, ordered top-left, top-right, bottom-right, bottom-left. Do not "
            "include an adjacent side face in the primary polygon. "
            "Estimate how much of the face is visible and whether perspective rectification is safe. Set "
            "targetAmbiguous only when the intended pallet itself cannot be resolved. Return ONLY JSON: "
            '{"targetPalletBox":[x1,y1,x2,y2],"confidence":0.0,"multiplePalletsVisible":false,'
            '"targetAmbiguous":false,"targetSelectionReason":"...","primaryFace":"front|left|right",'
            '"primaryFaceQuad":[[x,y],[x,y],[x,y],[x,y]],"secondaryFacesVisible":["left|right|top"],'
            '"yawDegrees":0.0,"pitchDegrees":0.0,"faceVisibility":0.0,"geometryConfidence":0.0,'
            '"safeToRectify":true}. All box and polygon coordinates must be normalized from 0 to 1.'
        )
        payload = {
            "model": self.model,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }],
            "temperature": 0,
            "max_tokens": 768,
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(self.url, json=payload)
                response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            answer = _last_json_object(content)
            if not answer:
                raise ValueError("Cosmos did not return JSON")
            raw_box = answer.get("targetPalletBox")
            box = validate_xyxy(tuple(raw_box)) if isinstance(raw_box, list) and len(raw_box) == 4 else None
            confidence = _number(answer.get("confidence"))
            geometry_confidence = _number(answer.get("geometryConfidence"))
            visibility = _number(answer.get("faceVisibility"))
            yaw = _number(answer.get("yawDegrees"))
            pitch = _number(answer.get("pitchDegrees"))
            quad = validate_quad(answer.get("primaryFaceQuad"))
            raw_face = str(answer.get("primaryFace") or "").lower()
            primary_face = raw_face if raw_face in {"front", "left", "right"} else None
            raw_secondary = answer.get("secondaryFacesVisible")
            secondary = tuple(
                face for face in (str(item).lower() for item in raw_secondary)
                if face in {"front", "left", "right", "top"}
            ) if isinstance(raw_secondary, list) else ()
            multiple_visible = bool(answer.get("multiplePalletsVisible", False))
            ambiguous = bool(answer.get("targetAmbiguous", False))
            if box:
                x1, y1, x2, y2 = box
                area = (x2 - x1) * (y2 - y1)
                ratio = (x2 - x1) / max(y2 - y1, 1e-6)
                center_x, center_y = (x1 + x2) / 2, (y1 + y2) / 2
                if area < 0.10 or not 0.2 <= ratio <= 4.0 or not 0.1 <= center_x <= 0.9:
                    ambiguous = True
            if confidence is None or not 0.0 <= confidence <= 1.0 or confidence < self.min_confidence:
                ambiguous = True

            safe_to_rectify = bool(answer.get("safeToRectify", False))
            geometry_reason: str | None = None
            if primary_face is None:
                safe_to_rectify = False
                geometry_reason = "VLM did not select a valid primary pallet face"
            elif quad is None:
                safe_to_rectify = False
                geometry_reason = "VLM did not return a valid pallet-face quadrilateral"
            elif box is None or not _quad_matches_box(quad, box):
                safe_to_rectify = False
                geometry_reason = "Pallet-face quadrilateral does not match the target pallet"
            elif (geometry_confidence is None or not 0.0 <= geometry_confidence <= 1.0
                  or geometry_confidence < self.min_geometry_confidence):
                safe_to_rectify = False
                geometry_reason = "Pallet-face geometry confidence is too low"
            elif visibility is None or not 0.0 <= visibility <= 1.0 or visibility < self.min_visibility:
                safe_to_rectify = False
                geometry_reason = "Not enough of the selected pallet face is visible"
            elif estimate_quad_skew(quad, 1000, 1000) > self.max_skew:
                safe_to_rectify = False
                geometry_reason = "Pallet-face perspective is beyond the configured rectification limit"

            return PalletLocation(
                box=box, confidence=confidence, multiple_visible=multiple_visible,
                ambiguous=ambiguous or box is None,
                reason=("Cosmos could not isolate the intended pallet" if ambiguous or box is None
                        else geometry_reason if not safe_to_rectify else None),
                selection_reason=str(answer.get("targetSelectionReason") or "") or None,
                primary_face=primary_face, primary_face_quad=quad,
                secondary_faces_visible=secondary, yaw_degrees=yaw, pitch_degrees=pitch,
                visibility=visibility, safe_to_rectify=safe_to_rectify,
                geometry_confidence=geometry_confidence,
            )
        except Exception as error:
            return PalletLocation(None, None, False, True, f"Cosmos localization failed: {type(error).__name__}", None)
