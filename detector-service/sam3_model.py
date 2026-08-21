"""SAM 3 image predictor adapter used for both annotation and production."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Iterable

import numpy as np
from PIL import Image


@dataclass
class Sam3Mask:
    mask: np.ndarray
    score: float


class Sam3BagFlapModel:
    def __init__(self) -> None:
        self.checkpoint = os.environ.get("SAM3_CHECKPOINT", "").strip()
        self.confidence = float(os.environ.get("SAM3_CONFIDENCE", "0.45"))
        self.stub = os.environ.get("SAM3_STUB_MODE", "false").lower() == "true"
        self.model = None
        self.processor = None
        self.version = f"sam3:{os.path.basename(self.checkpoint) or 'base'}"
        if self.stub:
            self.version = "sam3:stub"
            return

        try:
            import torch
            from sam3 import build_sam3_image_model
            from sam3.model.sam3_image_processor import Sam3Processor

            if self.checkpoint:
                saved = torch.load(self.checkpoint, map_location="cpu", weights_only=True)
                state_dict = saved.get("model", saved) if isinstance(saved, dict) else saved
                if not isinstance(state_dict, dict):
                    raise ValueError("SAM 3 checkpoint does not contain a model state dictionary")
                if any("detector." in key for key in state_dict):
                    # Official release/multiplex checkpoints use detector.* keys.
                    self.model = build_sam3_image_model(checkpoint_path=self.checkpoint)
                else:
                    # GXO fine-tuning instantiates the image model directly, so
                    # Trainer checkpoints contain backbone/transformer keys without
                    # the multiplex detector prefix expected by the stock loader.
                    self.model = build_sam3_image_model(load_from_HF=False)
                    missing, unexpected = self.model.load_state_dict(state_dict, strict=False)
                    if missing or unexpected:
                        raise ValueError(f"Checkpoint mismatch: {len(missing)} missing, {len(unexpected)} unexpected keys")
                    self.model.eval()
            else:
                self.model = build_sam3_image_model()
            self.processor = Sam3Processor(self.model, confidence_threshold=self.confidence)
        except Exception as error:
            raise RuntimeError(
                "SAM 3 could not be loaded. Request the official checkpoint, set SAM3_CHECKPOINT, "
                "and install requirements-sam3.txt. For contract tests only, set SAM3_STUB_MODE=true."
            ) from error

    def segment(
        self,
        image: Image.Image,
        text_prompt: str = "bag flap",
        prompt_boxes_xywh: Iterable[tuple[float, float, float, float]] = (),
    ) -> list[Sam3Mask]:
        if self.stub:
            return []
        state = self.processor.set_image(image)
        boxes = list(prompt_boxes_xywh)
        if boxes:
            # The pinned SAM 3 API accepts one normalized cx/cy/w/h box at a
            # time and accumulates prompts in the image state.
            for box in boxes:
                state = self.processor.add_geometric_prompt(
                    state=state, box=list(box), label=True
                )
        else:
            state = self.processor.set_text_prompt(state=state, prompt=text_prompt)

        masks = state.get("masks") if isinstance(state, dict) else None
        scores = state.get("scores") if isinstance(state, dict) else None
        if masks is None:
            return []
        mask_array = masks.detach().cpu().numpy() if hasattr(masks, "detach") else np.asarray(masks)
        score_array = scores.detach().cpu().numpy() if hasattr(scores, "detach") else np.asarray(scores or [])
        output: list[Sam3Mask] = []
        for index, mask in enumerate(mask_array):
            binary = np.squeeze(mask) > 0
            if binary.any():
                score = float(score_array[index]) if index < len(score_array) else 1.0
                output.append(Sam3Mask(binary, score))
        return output
