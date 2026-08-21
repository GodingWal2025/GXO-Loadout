"""Cosmos Reason 2 client for selecting the pallet centered in the capture guide."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass

import httpx

from schemas import NormalizedBox, validate_xyxy


@dataclass(frozen=True)
class PalletLocation:
    box: NormalizedBox | None
    confidence: float | None
    multiple_visible: bool
    ambiguous: bool
    reason: str | None
    selection_reason: str | None


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


class CosmosPalletLocator:
    def __init__(self) -> None:
        self.url = os.environ.get("COSMOS_URL", "http://127.0.0.1:8000/v1/chat/completions").strip()
        self.model = os.environ.get("COSMOS_MODEL", "nvidia/cosmos-reason2-2b").strip()
        self.timeout = float(os.environ.get("COSMOS_TIMEOUT_SECONDS", "12"))
        self.min_confidence = float(os.environ.get("COSMOS_MIN_CONFIDENCE", "0.70"))
        self.disabled = os.environ.get("COSMOS_DISABLED", "false").lower() == "true"
        self.version = f"cosmos:{self.model}"

    async def locate(self, data_url: str) -> PalletLocation:
        if self.disabled:
            return PalletLocation(None, None, False, True, "Cosmos is disabled", None)

        prompt = (
            "Identify the single pallet the inspector intends to photograph. The intended pallet is the pallet "
            "with the greatest overlap with the central 50% capture guide and is normally the closest/largest "
            "pallet. Set multiplePalletsVisible true whenever any other pallet is visible, but do not mark the "
            "target ambiguous merely because a clearly secondary pallet is present. Return ONLY JSON: "
            '{"targetPalletBox":[x1,y1,x2,y2],"confidence":0.0,"multiplePalletsVisible":false,'
            '"targetAmbiguous":false,"targetSelectionReason":"..."}. Coordinates are normalized 0 to 1. '
            "Set targetAmbiguous true when two candidates overlap the center similarly or the target is truncated."
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
            "max_tokens": 512,
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
            confidence = answer.get("confidence")
            confidence = float(confidence) if isinstance(confidence, (int, float)) else None
            multiple_visible = bool(answer.get("multiplePalletsVisible", False))
            ambiguous = bool(answer.get("targetAmbiguous", False)) or multiple_visible
            if box:
                x1, y1, x2, y2 = box
                area = (x2 - x1) * (y2 - y1)
                ratio = (x2 - x1) / max(y2 - y1, 1e-6)
                center_x, center_y = (x1 + x2) / 2, (y1 + y2) / 2
                if (area < 0.15 or not 0.3 <= ratio <= 3.0 or
                        not 0.2 <= center_x <= 0.8 or not 0.2 <= center_y <= 0.8):
                    ambiguous = True
            if confidence is None or confidence < self.min_confidence:
                ambiguous = True
            return PalletLocation(
                box,
                confidence,
                multiple_visible,
                ambiguous or box is None,
                "Cosmos could not isolate the centered pallet" if ambiguous or box is None else None,
                str(answer.get("targetSelectionReason") or "") or None,
            )
        except Exception as error:
            return PalletLocation(None, None, False, True, f"Cosmos localization failed: {type(error).__name__}", None)
