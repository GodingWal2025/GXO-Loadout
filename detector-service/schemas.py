from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


NormalizedBox = tuple[float, float, float, float]
NormalizedPoint = tuple[float, float]
NormalizedQuad = tuple[NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint]


def validate_xyxy(value: NormalizedBox) -> NormalizedBox:
    if len(value) != 4:
        raise ValueError("box must contain four coordinates")
    x1, y1, x2, y2 = (float(item) for item in value)
    if not (0.0 <= x1 < x2 <= 1.0 and 0.0 <= y1 < y2 <= 1.0):
        raise ValueError("box must be normalized xyxy with positive area")
    return (x1, y1, x2, y2)


class CocoRle(BaseModel):
    size: tuple[int, int]
    counts: str


class ProposalRequest(BaseModel):
    image: str
    targetPalletBox: NormalizedBox
    promptBoxes: list[NormalizedBox] = Field(default_factory=list)
    textPrompt: str = "bag flap"

    _target_box = field_validator("targetPalletBox")(validate_xyxy)

    @field_validator("promptBoxes")
    @classmethod
    def prompt_boxes(cls, value: list[NormalizedBox]) -> list[NormalizedBox]:
        return [validate_xyxy(item) for item in value]


class LocatePalletRequest(BaseModel):
    image: str


class FaceImage(BaseModel):
    index: int
    slotKey: str
    dataUrl: str


class AnalyzeFacesRequest(BaseModel):
    images: list[FaceImage] = Field(min_length=1, max_length=5)


class SegmentationInstance(BaseModel):
    id: str
    score: float
    bbox: NormalizedBox
    segmentationRle: CocoRle
    displayPolygon: list[list[float]]


class LocatePalletResult(BaseModel):
    success: bool
    targetPalletBox: NormalizedBox | None = None
    confidence: float | None = None
    multiplePalletsVisible: bool = False
    targetAmbiguous: bool = False
    targetSelectionReason: str | None = None
    primaryFace: str | None = None
    primaryFaceQuad: NormalizedQuad | None = None
    secondaryFacesVisible: list[str] = Field(default_factory=list)
    yawDegrees: float | None = None
    pitchDegrees: float | None = None
    faceVisibility: float | None = None
    geometryConfidence: float | None = None
    safeToRectify: bool = False
    reviewReason: str | None = None
    modelVersion: str
