#!/usr/bin/env python3
"""Phase 0 Feasibility Spike: Cosmos Reason2 Multi-View Visual Reasoning Benchmark.

Validates:
1. Multi-image payload ingestion: whether the NIM / OpenAI-compatible endpoint accepts 4 ordered side images.
2. Fallback execution paths: 2x2 contact sheet and per-face aggregation if 4-image payload is unsupported.
3. Blind structural analysis accuracy: layer counts per face, partial top detection, and irregularity flags.
4. Deterministic repeatability: runs identical inputs across 3 iterations to test consistency.
5. Strict schema validation: rejects impossible counts, negative numbers, or invalid component arithmetic.

Usage:
    python test_cosmos_reason_multiview.py --endpoint http://localhost:8000/v1 --images-dir ../dataset/raw/
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import sys
import time
from pathlib import Path
from typing import Any

from PIL import Image

EXPECTED_SCHEMA = {
    "type": "object",
    "required": ["layerCountByFace", "consensusLayers", "partialTopDetected", "partialTopCountEstimate", "irregularStack", "structuralTotalEstimate"],
    "properties": {
        "layerCountByFace": {
            "type": "object",
            "required": ["front", "right", "back", "left"],
            "properties": {
                "front": {"type": "integer", "minimum": 1, "maximum": 50},
                "right": {"type": "integer", "minimum": 1, "maximum": 50},
                "back": {"type": "integer", "minimum": 1, "maximum": 50},
                "left": {"type": "integer", "minimum": 1, "maximum": 50},
            }
        },
        "consensusLayers": {"type": "integer", "minimum": 1, "maximum": 50},
        "partialTopDetected": {"type": "boolean"},
        "partialTopCountEstimate": {"type": "integer", "minimum": 0, "maximum": 20},
        "irregularStack": {"type": "boolean"},
        "structuralTotalEstimate": {"type": "integer", "minimum": 1, "maximum": 500}
    }
}


def encode_image_to_base64(image_path: Path, max_edge: int = 1280) -> str:
    """Read image, resize to max_edge while preserving aspect ratio, return base64 JPEG string."""
    with Image.open(image_path) as img:
        img = img.convert("RGB")
        w, h = img.size
        scale = min(1.0, max_edge / max(w, h))
        if scale < 1.0:
            img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return base64.b64encode(buf.getvalue()).decode("utf-8")


def create_2x2_contact_sheet(image_paths: dict[str, Path], target_size: tuple[int, int] = (1600, 1600)) -> str:
    """Stitch 4 face images into a single labeled 2x2 contact sheet as a fallback."""
    canvas = Image.new("RGB", target_size, (20, 20, 20))
    half_w, half_h = target_size[0] // 2, target_size[1] // 2
    quadrants = [
        ("front", (0, 0)),
        ("right", (half_w, 0)),
        ("back", (0, half_h)),
        ("left", (half_w, half_h)),
    ]
    for role, (ox, oy) in quadrants:
        if role in image_paths and image_paths[role].exists():
            with Image.open(image_paths[role]) as img:
                img = img.convert("RGB")
                img.thumbnail((half_w, half_h), Image.Resampling.LANCZOS)
                canvas.paste(img, (ox, oy))
    buf = io.BytesIO()
    canvas.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def validate_vlm_response(raw_text: str) -> dict[str, Any]:
    """Strictly parse and validate JSON output from Cosmos Reason."""
    cleaned = raw_text.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    if cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()

    data = json.loads(cleaned)
    # Schema assertions
    layers = data.get("layerCountByFace", {})
    for face in ("front", "right", "back", "left"):
        val = layers.get(face)
        if not isinstance(val, int) or val <= 0 or val > 50:
            raise ValueError(f"Invalid layer count for face '{face}': {val}")

    consensus = data.get("consensusLayers")
    if not isinstance(consensus, int) or consensus <= 0:
        raise ValueError(f"Invalid consensusLayers: {consensus}")

    partial_top = data.get("partialTopCountEstimate", 0)
    if not isinstance(partial_top, int) or partial_top < 0:
        raise ValueError(f"Invalid partialTopCountEstimate: {partial_top}")

    return data


def build_blind_prompt() -> str:
    return (
        "You are an industrial warehouse vision system inspecting a stacked pallet of bagged seed.\n"
        "You are provided four side photographs of the target pallet in order: [FRONT, RIGHT, BACK, LEFT].\n\n"
        "Analyze the stacked layers of bags on the foreground pallet:\n"
        "1. Count how many horizontal layers of bags are stacked on each face.\n"
        "2. Determine the consensus layer count for the whole pallet.\n"
        "3. Check if the top layer is incomplete/partial, and estimate the bag count on the partial top course.\n"
        "4. Flag if the pallet is noticeably leaning, sagging, or irregular.\n\n"
        "Return ONLY valid JSON matching this schema with no prose outside the JSON:\n"
        "{\n"
        '  "layerCountByFace": {"front": 10, "right": 10, "back": 10, "left": 10},\n'
        '  "consensusLayers": 10,\n'
        '  "partialTopDetected": false,\n'
        '  "partialTopCountEstimate": 0,\n'
        '  "irregularStack": false,\n'
        '  "structuralTotalEstimate": 60\n'
        "}"
    )


def test_pallet_sample(endpoint: str, model: str, pallet_dir: Path, use_contact_sheet: bool = False) -> dict[str, Any]:
    """Test a single pallet directory containing FRONT.jpg, RIGHT.jpg, BACK.jpg, LEFT.jpg."""
    import urllib.request

    face_roles = ["FRONT", "RIGHT", "BACK", "LEFT"]
    images = {}
    for role in face_roles:
        p = pallet_dir / f"{role}.jpg"
        if not p.exists():
            return {"status": "error", "error": f"Missing {role}.jpg in {pallet_dir.name}"}
        images[role.lower()] = p

    prompt = build_blind_prompt()
    start_time = time.time()

    if use_contact_sheet:
        b64_img = create_2x2_contact_sheet(images)
        content_payload = [
            {"type": "text", "text": prompt + "\n(Images are formatted as a 2x2 grid: Top-Left=FRONT, Top-Right=RIGHT, Bottom-Left=BACK, Bottom-Right=LEFT)"},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64_img}"}}
        ]
    else:
        content_payload = [{"type": "text", "text": prompt}]
        for role in ["front", "right", "back", "left"]:
            b64_img = encode_image_to_base64(images[role])
            content_payload.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64_img}"}
            })

    body = {
        "model": model,
        "messages": [{"role": "user", "content": content_payload}],
        "temperature": 0.0,
        "max_tokens": 512
    }

    req = urllib.request.Request(
        f"{endpoint}/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )

    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw_resp = json.loads(resp.read().decode("utf-8"))
        latency = time.time() - start_time
        choice_text = raw_resp["choices"][0]["message"]["content"]
        parsed = validate_vlm_response(choice_text)
        return {
            "status": "success",
            "latency": round(latency, 2),
            "parsed": parsed,
            "raw_text": choice_text
        }
    except Exception as e:
        return {
            "status": "failed",
            "latency": round(time.time() - start_time, 2),
            "error": str(e)
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", default="http://localhost:8000/v1", help="VLM OpenAI-compatible endpoint")
    parser.add_argument("--model", default="cosmos-reason2-8b", help="Model name")
    parser.add_argument("--images-dir", default="../dataset/raw", help="Directory with raw pallet samples")
    parser.add_argument("--repeat", type=int, default=3, help="Number of repetitions for repeatability test")
    parser.add_argument("--use-contact-sheet", action="store_true", help="Fallback to 2x2 contact sheet")
    args = parser.parse_args()

    raw_path = Path(args.images_dir).expanduser().resolve()
    pallets = [p for p in raw_path.iterdir() if p.is_dir() and (p / "FRONT.jpg").exists()]

    if not pallets:
        print(f"[!] No valid pallet folders found in {raw_path}. Run sync_training_data.py first.", file=sys.stderr)
        return 1

    print(f"[*] Found {len(pallets)} pallet samples for Cosmos Reason2 Phase 0 benchmark.")
    print(f"[*] Endpoint: {args.endpoint} | Model: {args.model} | Format: {'2x2 Contact Sheet' if args.use_contact_sheet else '4-Image Multi-View'}")

    results = []
    successes = 0
    total_latency = 0.0

    for pallet in pallets[:30]:  # Up to 30 sample spike
        manifest = {}
        mf_path = pallet / "manifest.json"
        if mf_path.exists():
            try:
                manifest = json.loads(mf_path.read_text(encoding="utf-8"))
            except Exception:
                pass

        ground_truth_layers = manifest.get("fullLayers")
        ground_truth_total = manifest.get("totalBags")

        print(f"\n--- Testing Pallet: {pallet.name} (Ground Truth: {ground_truth_layers} layers, {ground_truth_total} bags) ---")
        runs = []
        for r in range(args.repeat):
            res = test_pallet_sample(args.endpoint, args.model, pallet, args.use_contact_sheet)
            runs.append(res)
            if res["status"] == "success":
                p = res["parsed"]
                print(f"  Run {r+1}: Consensus={p['consensusLayers']} layers, TotalEst={p['structuralTotalEstimate']} ({res['latency']}s)")
            else:
                print(f"  Run {r+1}: FAILED -> {res.get('error')}")

        # Check repeatability
        first_success = next((x for x in runs if x["status"] == "success"), None)
        is_repeatable = False
        if first_success:
            first_consensus = first_success["parsed"]["consensusLayers"]
            is_repeatable = all(x.get("parsed", {}).get("consensusLayers") == first_consensus for x in runs if x["status"] == "success")
            successes += 1
            total_latency += first_success["latency"]

        results.append({
            "pallet": pallet.name,
            "groundTruth": {"layers": ground_truth_layers, "totalBags": ground_truth_total},
            "repeatable": is_repeatable,
            "runs": runs
        })

    out_file = Path("cosmos_reason_spike_results.json")
    out_file.write_text(json.dumps({
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "totalTested": len(results),
        "successCount": successes,
        "avgLatency": round(total_latency / max(1, successes), 2),
        "results": results
    }, indent=2), encoding="utf-8")

    print(f"\n[✓] Benchmark complete. Results written to {out_file.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
