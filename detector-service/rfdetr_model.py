"""RF-DETR model selection shared by training and inference."""

from typing import Any


SUPPORTED_MODEL_SIZES = ("nano", "small", "medium", "base", "large")


def create_rfdetr_model(model_size: str, **kwargs: Any):
    """Instantiate an RF-DETR detector by its documented size name."""
    import rfdetr

    normalized = model_size.strip().lower()
    if normalized not in SUPPORTED_MODEL_SIZES:
        choices = ", ".join(SUPPORTED_MODEL_SIZES)
        raise ValueError(f"Unsupported RF-DETR model size '{model_size}'. Choose: {choices}.")

    class_name = {
        "nano": "RFDETRNano",
        "small": "RFDETRSmall",
        "medium": "RFDETRMedium",
        "base": "RFDETRBase",
        "large": "RFDETRLarge",
    }[normalized]
    model_class = getattr(rfdetr, class_name, None)
    if model_class is None:
        raise RuntimeError(
            f"Installed rfdetr does not provide {class_name}. "
            "Upgrade with: pip install -U -r requirements-rfdetr.txt"
        )
    return model_class(**kwargs)
