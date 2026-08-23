from PIL import Image
import numpy as np

from geometry import estimate_quad_skew, rectify_pallet_face, validate_quad


def test_validate_quad_accepts_normalized_polygon():
    quad = validate_quad([[0.2, 0.2], [0.8, 0.25], [0.75, 0.9], [0.15, 0.85]])
    assert quad is not None


def test_validate_quad_rejects_degenerate_polygon():
    assert validate_quad([[0.1, 0.1], [0.2, 0.2], [0.3, 0.3], [0.4, 0.4]]) is None


def test_rectify_pallet_face_returns_canonical_image():
    image = Image.fromarray(np.full((800, 1000, 3), 180, dtype=np.uint8))
    quad = ((0.20, 0.15), (0.80, 0.22), (0.74, 0.90), (0.15, 0.82))
    result = rectify_pallet_face(image, quad)
    assert result.width >= 384
    assert result.height >= 384
    assert result.image.size == (result.width, result.height)
    assert len(result.homography) == 3


def test_skew_score_increases_for_trapezoid():
    rectangle = ((0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8))
    trapezoid = ((0.35, 0.2), (0.65, 0.2), (0.85, 0.8), (0.15, 0.8))
    assert estimate_quad_skew(trapezoid, 1000, 1000) > estimate_quad_skew(rectangle, 1000, 1000)
