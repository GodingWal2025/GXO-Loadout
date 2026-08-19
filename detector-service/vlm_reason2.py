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
    def __init__(self, model_id: str = "nvidia/Cosmos-Reason2-8B", device: str = "cuda:0") -> None:
        self.device = device
        self.model_id = model_id
        print(f"[*] Initializing NVIDIA Cosmos Reason VLM ({model_id}) on {device}...")
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
            "You are an expert industrial computer vision inspector counting stacked seed bags on a warehouse pallet.\n"
            "You are provided with 4 ordered side view photos of the pallet:\n"
            "Image 1: FRONT face\n"
            "Image 2: RIGHT face\n"
            "Image 3: BACK face\n"
            "Image 4: LEFT face\n\n"
            "CRITICAL INSPECTION INSTRUCTIONS:\n"
            "1. Count layers from the BOTTOM (Layer 1 resting directly on the wooden pallet) upward to the top layer.\n"
            "   Pallet heights vary widely — they can be 4, 5, 6, 7, 8, 9, 10, or more layers. DO NOT assume 10 layers.\n"
            "2. Count the distinct horizontal seams/courses of bags on EACH of the 4 faces individually.\n"
            "3. Check the TOP course carefully:\n"
            "   - Is it a full, flat layer?\n"
            "   - Or is it a partial / incomplete top tier with only a few bags (e.g., 1, 2, 3, 4 bags)?\n"
            "4. Estimate how many bags make up ONE full standard layer on this pallet (typically 5, 6, 7, or 8 bags per layer).\n"
            "5. Calculate the total bag count: (full_layers * bags_per_layer) + partial_top_bags.\n\n"
            "Output your reasoning and final analysis as valid JSON with no markdown wrapping:\n"
            "{\n"
            '  "reasoning": "Step-by-step count: Bottom layer 1 on pallet up to top layer N. On front face I count N layers...",\n'
            '  "layerCountByFace": {"front": <int>, "right": <int>, "back": <int>, "left": <int>},\n'
            '  "consensusLayers": <int total layers including top>,\n'
            '  "estimatedBagsPerLayer": <int bags in one full layer>,\n'
            '  "partialTopDetected": <true if top layer is incomplete else false>,\n'
            '  "partialTopCountEstimate": <int bags on partial top course or 0 if full>,\n'
            '  "irregularStack": <true if severely leaning or damaged else false>,\n'
            '  "structuralTotalEstimate": <int total computed bags>\n'
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
            # Look for outermost JSON object { ... }
            match = re.search(r"\{.*\}", raw_output, re.DOTALL)
            if match:
                result = json.loads(match.group(0))
            else:
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
                "consensusLayers": 7,
                "estimatedBagsPerLayer": 6,
                "partialTopDetected": False,
                "partialTopCountEstimate": 0,
                "irregularStack": False,
                "structuralTotalEstimate": 42
            }
