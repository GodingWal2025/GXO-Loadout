import asyncio
import json

import httpx

from cosmos_client import CosmosPalletLocator


class FakeResponse:
    def __init__(self, answer: dict) -> None:
        self.answer = answer

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict:
        return {"choices": [{"message": {"content": json.dumps(self.answer)}}]}


class FakeClient:
    answer: dict = {}

    def __init__(self, **_kwargs) -> None:
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        pass

    async def post(self, *_args, **_kwargs) -> FakeResponse:
        return FakeResponse(self.answer)


def valid_answer() -> dict:
    return {
        "targetPalletBox": [0.1, 0.1, 0.9, 0.95], "confidence": 0.97,
        "multiplePalletsVisible": True, "targetAmbiguous": False,
        "targetSelectionReason": "centered", "primaryFace": "front",
        "primaryFaceQuad": [[0.2, 0.15], [0.8, 0.2], [0.75, 0.9], [0.15, 0.85]],
        "secondaryFacesVisible": ["right"], "yawDegrees": 31, "pitchDegrees": -4,
        "faceVisibility": 0.91, "geometryConfidence": 0.95, "safeToRectify": True,
    }


def test_secondary_pallet_does_not_make_resolved_target_ambiguous(monkeypatch):
    FakeClient.answer = valid_answer()
    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)

    result = asyncio.run(CosmosPalletLocator().locate("data:image/jpeg;base64,AA=="))

    assert result.multiple_visible is True
    assert result.ambiguous is False
    assert result.safe_to_rectify is True
    assert result.primary_face == "front"


def test_face_quad_outside_target_disables_rectification_without_losing_raw_target(monkeypatch):
    FakeClient.answer = {**valid_answer(),
                         "primaryFaceQuad": [[0.0, 0.0], [0.08, 0.0], [0.08, 0.08], [0.0, 0.08]]}
    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)

    result = asyncio.run(CosmosPalletLocator().locate("data:image/jpeg;base64,AA=="))

    assert result.box is not None
    assert result.ambiguous is False
    assert result.safe_to_rectify is False
    assert result.reason == "Pallet-face quadrilateral does not match the target pallet"
