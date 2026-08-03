from geometry import estimate_layers, normalize_boxes


def test_estimate_layers_tolerates_uneven_bag_centers():
    boxes = [
        (0, 5, 20, 25), (25, 8, 45, 28),
        (0, 35, 20, 55), (25, 38, 45, 58),
        (0, 67, 20, 87), (25, 70, 45, 90),
    ]
    assert estimate_layers(boxes) == 3


def test_estimate_layers_handles_empty_input():
    assert estimate_layers([]) == 0


def test_normalize_boxes_clips_to_image():
    assert normalize_boxes([(-2, 5, 110, 45)], 100, 50) == [[0.0, 0.1, 1.0, 0.9]]
