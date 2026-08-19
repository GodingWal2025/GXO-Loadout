"""VLM Visual Reasoning Service (GPU 0)

Runs Qwen2.5-VL on GPU 0 to perform multi-view structural reasoning across
all 4 pallet sides (FRONT, RIGHT, BACK, LEFT) simultaneously.
"""

from __future__ import annotations

import base64
import io
import json
import re
from typing import Any

from PIL import Image
import torch
from transformers import AutoModelForImageTextToText, AutoProcessor


class VLMReasonService:
    def __init__(self, model_id: str = "Qwen/Qwen2.5-VL-7B-Instruct", device: str = "cuda:0") -> None:
        self.device = device
        self.model_id = model_id
        print(f"[*] Initializing VLM Reasoning Model ({model_id}) on {device}...")
        self.processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
        self.model = AutoModelForImageTextToText.from_pretrained(
            model_id,
            torch_dtype=torch.bfloat16,
            device_map=device,
            trust_remote_code=True
        )
        self.model.eval()
        print(f"[✓] VLM Reasoner loaded into VRAM on {device}!")

    def _build_prompt(self, recipe: dict[str, Any] | None = None) -> str:
        return (
            "You are a computer vision expert inspecting a seed bag pallet in a logistics warehouse.\n"
            "You are provided with 4 ordered side view photos of the pallet in this sequence:\n"
            "Image 1: FRONT face\n"
            "Image 2: RIGHT face\n"
            "Image 3: BACK face\n"
            "Image 4: LEFT face\n\n"
            "Carefully analyze all 4 faces and determine:\n"
            "1. How many horizontal bag layers are visible on EACH face (front, right, back, left).\n"
            "2. What is the consensus layer count across all 4 faces.\n"
            "3. Estimate the number of bags per layer by counting the distinct bag flaps visible on a single full layer.\n"
            "4. Is the top layer incomplete/partial (fewer bags than a full layer)? If so, estimate the bag count on the partial top course.\n"
            "5. Is the pallet noticeably leaning, sagging, or structurally irregular?\n"
            "6. Provide an estimated vertical bounding coordinate range (normalized 0.0 to 1.0) for each layer.\n\n"
            "Return ONLY valid JSON matching this schema with no extra text or markdown ticks outside the JSON:\n"
            "{\n"
            '  "layerCountByFace": {"front": 10, "right": 10, "back": 10, "left": 10},\n'
            '  "consensusLayers": 10,\n'
            '  "estimatedBagsPerLayer": 6,\n'
            '  "partialTopDetected": false,\n'
            '  "partialTopCountEstimate": 0,\n'
            '  "irregularStack": false,\n'
            '  "structuralTotalEstimate": 60,\n'
            '  "layerBounds": [{"layer": 1, "ymin": 0.15, "ymax": 0.22}, {"layer": 2, "ymin": 0.22, "ymax": 0.29}]\n'
            "}"
        )

    def analyze_multiview(
        self,
        images_dict: dict[str, Image.Image],
        recipe: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Analyze 4 ordered side images and return structural layer breakdown."""
        face_order = ["front", "right", "back", "left"]
        pil_images = []
        for face in face_order:
            img = images_dict.get(face)
            if img is None:
                raise ValueError(f"Missing {face.upper()} image in multiview payload")
            pil_images.append(img.convert("RGB"))

        prompt = self._build_prompt(recipe)

        content = []
        for img in pil_images:
            content.append({"type": "image", "image": img})
        content.append({"type": "text", "text": prompt})

        messages = [{"role": "user", "content": content}]
        text_prompt = self.processor.apply_chat_template(messages, add_generation_prompt=True)

        inputs = self.processor(
            text=[text_prompt],
            images=pil_images,
            padding=True,
            return_tensors="pt"
        ).to(self.device)

        with torch.no_grad():
            output_ids = self.model.generate(
                **inputs,
                max_new_tokens=768,
                temperature=0.01,
                do_sample=False
            )

        trimmed_ids = [
            out[len(inp):] for inp, out in zip(inputs.input_ids, output_ids)
        ]
        raw_output = self.processor.batch_decode(
            trimmed_ids,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False
        )[0].strip()

        # Parse JSON
        try:
            cleaned = re.sub(r"^```(?:json)?", "", raw_output, flags=re.MULTILINE)
            cleaned = re.sub(r"```$", "", cleaned, flags=re.MULTILINE).strip()
            result = json.loads(cleaned)
            result["status"] = "success"
            return result
        except Exception as e:
            print(f"[!] Failed to parse VLM JSON output: {e}\nRaw: {raw_output}")
            return {
                "status": "partial",
                "raw_output": raw_output,
                "consensusLayers": 10,
                "partialTopDetected": False,
                "partialTopCountEstimate": 0,
                "irregularStack": False,
                "structuralTotalEstimate": 60
            }
