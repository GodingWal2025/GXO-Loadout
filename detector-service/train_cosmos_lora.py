"""LoRA Supervised Fine-Tuning (SFT) for NVIDIA Cosmos-Reason2-8B on Warehouse Pallets.

Executes LoRA parameter-efficient fine-tuning on GPU 0 (RTX 5090 - 32GB VRAM).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from PIL import Image
import torch
from torch.utils.data import Dataset, DataLoader
from transformers import (
    AutoModelForImageTextToText,
    AutoProcessor,
    TrainingArguments,
    Trainer
)
from peft import LoraConfig, get_peft_model


class PalletSFTDataset(torch.utils.data.Dataset):
    def __init__(self, data_path: str):
        self.data = json.loads(Path(data_path).read_text(encoding="utf-8"))

    def __len__(self):
        return len(self.data)

    def __getitem__(self, idx):
        item = self.data[idx]
        image_paths = item["images"]
        images = []
        for p in image_paths:
            img_p = Path(p)
            if not img_p.exists():
                alt = Path("/workspace/GXO-Loadout") / p
                if alt.exists():
                    img_p = alt
                else:
                    alt2 = Path("/workspace/GXO-Loadout/detector-service") / p
                    if alt2.exists():
                        img_p = alt2
            img = Image.open(img_p).convert("RGB")
            img.thumbnail((768, 768), Image.Resampling.LANCZOS)
            images.append(img)
        
        user_prompt = item["conversations"][0]["value"]
        assistant_resp = item["conversations"][1]["value"]

        content = [{"type": "image", "image": img} for img in images]
        content.append({"type": "text", "text": user_prompt})

        messages = [
            {"role": "user", "content": content},
            {"role": "assistant", "content": assistant_resp}
        ]

        return {"messages": messages, "images": images}


class MultimodalDataCollator:
    def __init__(self, processor: Any):
        self.processor = processor

    def __call__(self, batch: list[dict[str, Any]]) -> dict[str, torch.Tensor]:
        texts = [
            self.processor.apply_chat_template(item["messages"], add_generation_prompt=False)
            for item in batch
        ]
        images_list = [item["images"] for item in batch]

        batch_inputs = self.processor(
            text=texts,
            images=images_list,
            padding=True,
            return_tensors="pt"
        )
        batch_inputs["labels"] = batch_inputs["input_ids"].clone()
        return batch_inputs


def run_training(
    model_id: str = "nvidia/Cosmos-Reason2-8B",
    dataset_path: str = "dataset/cosmos_sft_training.json",
    output_dir: str = "/workspace/models/cosmos_lora_adapter",
    epochs: int = 15,
    batch_size: int = 1,
    learning_rate: float = 2e-4
):
    # Resolve dataset path if running from detector-service or repo root
    dpath = Path(dataset_path)
    if not dpath.exists():
        for alt in [
            Path("../dataset/cosmos_sft_training.json"),
            Path("/workspace/GXO-Loadout/dataset/cosmos_sft_training.json")
        ]:
            if alt.exists():
                dpath = alt
                break

    print(f"[*] Initializing Cosmos-Reason2-8B LoRA fine-tuning...")
    print(f"[*] Target Model: {model_id}")
    print(f"[*] Dataset: {dpath}")
    print(f"[*] Output Directory: {output_dir}")

    processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
    model = AutoModelForImageTextToText.from_pretrained(
        model_id,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        trust_remote_code=True
    )

    lora_config = LoraConfig(
        r=16,
        lora_alpha=32,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM"
    )

    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    train_dataset = PalletSFTDataset(str(dpath))
    data_collator = MultimodalDataCollator(processor)
    print(f"[*] Prepared {len(train_dataset)} training examples.")

    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        gradient_accumulation_steps=4,
        learning_rate=learning_rate,
        bf16=True,
        logging_steps=5,
        save_strategy="epoch",
        save_total_limit=2,
        report_to="none",
        dataloader_num_workers=0,
        remove_unused_columns=False
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        data_collator=data_collator
    )

    print("[*] Starting LoRA training on GPU 0...")
    trainer.train()
    print(f"[✓] Training complete! Saving adapter to {output_dir}...")
    model.save_pretrained(output_dir)
    processor.save_pretrained(output_dir)
    print(f"[✓] Model adapter saved successfully.")


if __name__ == "__main__":
    run_training()
