from geometry import prompt_in_crop


def test_prompt_box_is_converted_to_normalized_center_xywh():
    prompt = (0.25, 0.30, 0.45, 0.50)
    crop = (100, 100, 900, 900)
    cx, cy, width, height = prompt_in_crop(prompt, crop, 1000, 1000)
    assert (cx, cy, width, height) == (0.3125, 0.375, 0.25, 0.25)
