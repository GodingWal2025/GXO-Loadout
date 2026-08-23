import numpy as np
from PIL import Image

from cosmos_client import PalletLocation
from pipeline import CounterPrediction, PalletVisionPipeline
from sam3_model import Sam3Mask


class FakeCounter:
    version = "counter:fake"

    def __init__(self) -> None:
        self.image_sizes: list[tuple[int, int]] = []

    def predict(self, image, text_prompt, prompt_boxes):
        self.image_sizes.append(image.size)
        mask = np.ones((image.height, image.width), dtype=bool)
        return CounterPrediction(masks=[Sam3Mask(mask=mask, score=0.9)])


def location(*, safe: bool = True) -> PalletLocation:
    return PalletLocation(
        box=(0.1, 0.1, 0.9, 0.95), confidence=0.97, multiple_visible=True,
        ambiguous=False, reason=None if safe else "Pallet-face geometry confidence is too low",
        selection_reason="centered target", primary_face="front",
        primary_face_quad=((0.2, 0.15), (0.8, 0.2), (0.75, 0.9), (0.15, 0.85)),
        secondary_faces_visible=("right",), yaw_degrees=31, pitch_degrees=-4,
        visibility=0.91, safe_to_rectify=safe, geometry_confidence=0.95 if safe else 0.4,
    )


def test_prefer_mode_counts_rectified_face_and_maps_instances_to_source():
    counter = FakeCounter()
    pipeline = PalletVisionPipeline(counter=counter, rectification_mode="prefer")
    result = pipeline.count_located(Image.new("RGB", (1000, 800), "white"), location())

    assert result["countingInput"] == "rectified"
    assert result["rectification"]["applied"] is True
    assert result["rectification"]["canonicalSize"] == list(counter.image_sizes[0])
    assert result["geometry"]["secondaryFacesVisible"] == ["right"]
    assert result["maskCount"] == 1
    assert len(result["masks"]) == len(result["boxes"]) == 1
    assert all(0 <= coordinate <= 1 for coordinate in result["boxes"][0])


def test_unsafe_geometry_falls_back_to_existing_raw_crop_path():
    counter = FakeCounter()
    pipeline = PalletVisionPipeline(counter=counter, rectification_mode="prefer")
    result = pipeline.count_located(Image.new("RGB", (1000, 800), "white"), location(safe=False))

    assert result["countingInput"] == "raw"
    assert result["rectification"]["applied"] is False
    assert result["rectification"]["fallbackReason"] == "Pallet-face geometry confidence is too low"
    assert counter.image_sizes == [(848, 722)]


def test_shadow_mode_instruments_raw_and_rectified_counts():
    counter = FakeCounter()
    pipeline = PalletVisionPipeline(counter=counter, rectification_mode="shadow")
    result = pipeline.count_located(Image.new("RGB", (1000, 800), "white"), location())

    assert len(counter.image_sizes) == 2
    assert result["countingInput"] == "rectified"
    assert result["abComparison"]["executed"] is True
    assert result["abComparison"]["rawCount"] == 1
    assert result["abComparison"]["rectifiedCount"] == 1
    assert result["abComparison"]["countDelta"] == 0
