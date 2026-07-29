"""
Try NVIDIA-hosted vision NIMs against real pallet photos.

The Azure Function's Cosmos path (api/src/index.ts -> analyzePalletCount) already
speaks the OpenAI-compatible shape NVIDIA hosts at integrate.api.nvidia.com:
POST {base}/chat/completions, `Authorization: Bearer <key>`, image as a base64
data URI. So activating a hosted NVIDIA model is a CONFIG change, not a code
change — this script proves which model to configure before touching Azure.

It sends the SAME prompt the Function sends, so a good result here means a good
result in the app.

Setup (the key never passes through the app or this file):
    setx NVIDIA_API_KEY "nvapi-..."      # new shell after this, or:
    $env:NVIDIA_API_KEY = "nvapi-..."    # current PowerShell session only

Usage:
    python try_nvidia.py --list                     # what vision models are available
    python try_nvidia.py --src ~/Desktop/Bags_Phots  # run the pallet prompt
    python try_nvidia.py --src ... --model nvidia/cosmos-reason1-7b

Then configure the Function with the winner:
    COSMOS_NIM_URL=https://integrate.api.nvidia.com/v1
    COSMOS_NIM_KEY=nvapi-...
    COSMOS_NIM_MODEL=<model id>
"""

import argparse
import base64
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request

from PIL import Image, ImageOps

BASE_URL = os.environ.get("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1").rstrip("/")

# Verbatim from PALLET_COUNT_PROMPT in api/src/index.ts — keep these in sync, the
# whole point is to test what production actually sends.
PALLET_COUNT_PROMPT = "\n".join(
    [
        "You are inspecting one face of a warehouse pallet stacked with bags of product.",
        "Bags sag and occlude each other, so DO NOT try to count individual bags.",
        "Instead reason about the visible stack and report:",
        "- layers: how many horizontal layers (courses) are stacked, as an integer.",
        "- topLayerFull: is the top layer complete, or short/partial? boolean.",
        "- gaps: are there obvious missing bags or holes in the stack? boolean.",
        "- damage: any torn, crushed, or leaking bags visible? boolean.",
        "- estimatedBags: your best whole-number estimate of total bags on this face, or null if unsure.",
        "- confidence: your confidence from 0 to 1.",
        "- rationale: one short sentence explaining what you saw.",
        "Answer using the following format:<think>Your reasoning.</think>",
        "Immediately after the </think> tag, write ONLY a JSON object with exactly these keys and no extra text.",
    ]
)

# Matches cosmosNimMaxTokens in index.ts. A reasoning model that runs out of budget
# mid-thought returns no JSON at all, which reads as a bad model rather than a
# truncated one.
MAX_TOKENS = int(os.environ.get("NVIDIA_MAX_TOKENS", "1536"))

# NVIDIA's hosted endpoints reject large inline images (the documented cutoff is
# around 180KB of base64; past that you must use the NVCF assets API). Phone
# photos are ~2.5MB, so downscaling is mandatory, not an optimization. The
# Function needs this same treatment before it can use a hosted model.
MAX_B64_BYTES = 180_000


def api_key() -> str:
    key = os.environ.get("NVIDIA_API_KEY", "").strip()
    if not key:
        sys.exit(
            "NVIDIA_API_KEY is not set.\n"
            "Create a free key at https://build.nvidia.com (it starts with 'nvapi-'), then:\n"
            '  $env:NVIDIA_API_KEY = "nvapi-..."'
        )
    return key


def post_json(path: str, payload: dict, timeout: int = 180) -> dict:
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {api_key()}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def post_bytes(url: str, raw: bytes, timeout: int = 120) -> dict:
    """POST raw image bytes to the app's own endpoint (no NVIDIA key needed here —
    the Function holds it). 120s beats the 45s SWA gateway cutoff on purpose, so a
    timeout is distinguishable from a gateway 500."""
    req = urllib.request.Request(
        url,
        data=raw,
        headers={"Content-Type": "application/octet-stream", "Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def list_models() -> list[str]:
    req = urllib.request.Request(
        f"{BASE_URL}/models",
        headers={"Authorization": f"Bearer {api_key()}", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())
    return sorted(m.get("id", "") for m in data.get("data", []) if m.get("id"))


def encode_image(path: str, max_edge: int) -> tuple[bytes, int, tuple[int, int]]:
    """Upright, downscale, and JPEG-encode until the base64 fits the inline cap."""
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")

    edge, quality = max_edge, 80
    while True:
        probe = img.copy()
        probe.thumbnail((edge, edge))
        buf = io.BytesIO()
        probe.save(buf, format="JPEG", quality=quality)
        raw = buf.getvalue()
        if len(base64.b64encode(raw)) <= MAX_B64_BYTES:
            return raw, len(raw), probe.size
        # Shrink before sacrificing quality — resolution matters less than
        # keeping layer seams legible, and quality<50 smears them.
        if quality > 50:
            quality -= 15
        else:
            edge = int(edge * 0.8)
            quality = 80
        if edge < 200:
            raise RuntimeError(f"cannot fit {os.path.basename(path)} under the inline cap")


def extract_json(text: str) -> dict | None:
    """
    Mirror extractJsonObject() in index.ts — drop any <think> block, then take the
    LAST balanced object that parses, preferring one that has a "layers" key.

    Reasoning narration contains braces (coordinates, JSON sketches), so taking
    the first object would read the model's scratch work as its answer.
    """
    body = re.sub(r"<think>.*?</think>", " ", text, flags=re.DOTALL | re.IGNORECASE)

    last: dict | None = None
    start = -1
    depth = 0
    for i, ch in enumerate(body):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}" and depth > 0:
            depth -= 1
            if depth == 0 and start >= 0:
                try:
                    candidate = json.loads(body[start : i + 1])
                    if isinstance(candidate, dict) and "layers" in candidate:
                        last = candidate
                    elif last is None and isinstance(candidate, dict):
                        last = candidate
                except json.JSONDecodeError:
                    pass  # malformed block shouldn't abort the scan
                start = -1
    return last


def ground_truth(filename: str) -> int | None:
    stem = os.path.splitext(filename)[0]
    if "-" not in stem:
        return None
    tail = stem.rsplit("-", 1)[1]
    return int(tail) if tail.isdigit() else None


def main() -> None:
    p = argparse.ArgumentParser(description="Test NVIDIA-hosted VLMs on pallet photos.")
    p.add_argument("--src", help="folder of pallet photos")
    p.add_argument("--model", default="nvidia/cosmos3-nano-reasoner", help="model id to test")
    p.add_argument(
        "--endpoint",
        help="instead of calling NVIDIA directly, POST the resized JPEG to the app's own "
        "/api/analyze-pallet-count (e.g. https://<swa-host>). Tests the deployed "
        "Function + its configured model end to end; needs no NVIDIA_API_KEY locally.",
    )
    p.add_argument("--list", action="store_true", help="list available model ids and exit")
    p.add_argument("--vision-only", action="store_true", help="with --list, filter to likely VLMs")
    p.add_argument("--max-edge", type=int, default=1024, help="downscale long edge before sending")
    p.add_argument("--min-size", type=int, default=640, help="skip images smaller than this")
    p.add_argument("--limit", type=int, default=0, help="only process the first N images")
    p.add_argument("--out", default="nvidia-results.json")
    args = p.parse_args()

    if args.list:
        ids = list_models()
        if args.vision_only:
            hint = ("vl", "vision", "cosmos", "llava", "clip", "maverick", "scout", "vlm")
            ids = [i for i in ids if any(h in i.lower() for h in hint)]
        print(f"{len(ids)} model(s):")
        for i in ids:
            print(f"  {i}")
        return

    if not args.src:
        sys.exit("--src is required (or use --list)")

    src = os.path.expanduser(args.src)
    names = sorted(n for n in os.listdir(src) if n.lower().endswith((".jpg", ".jpeg", ".png")))
    if args.limit:
        names = names[: args.limit]

    if args.endpoint:
        print(f"via app endpoint={args.endpoint}  (model is whatever the Function is configured with)\n")
    else:
        print(f"model={args.model}  base={BASE_URL}\n")
    header = f"{'file':<20}{'layers':>7}{'bags':>6}{'conf':>6}{'top':>5}{'gap':>5}{'dmg':>5}   sent"
    print(header)
    print("-" * len(header))

    rows = []
    for n in names:
        path = os.path.join(src, n)
        with Image.open(path) as probe:
            upright = ImageOps.exif_transpose(probe)
            if max(upright.size) < args.min_size:
                continue

        try:
            jpeg, nbytes, size = encode_image(path, args.max_edge)
        except RuntimeError as e:
            print(f"  {n:<18} encode failed: {e}")
            continue

        if args.endpoint:
            # Through the deployed app: the Function already returns the parsed
            # contract, so there is no chat wrapper to unpack.
            try:
                parsed = post_bytes(
                    f"{args.endpoint.rstrip('/')}/api/analyze-pallet-count", jpeg
                )
            except urllib.error.HTTPError as e:
                detail = e.read().decode(errors="replace")[:400]
                hint = ""
                if e.code == 501:
                    hint = "  <- COSMOS_NIM_URL not visible to the Function yet"
                elif e.code == 502:
                    hint = "  <- Function reached the model but it errored"
                print(f"  {n:<18} HTTP {e.code}: {detail}{hint}")
                continue
            except Exception as e:  # noqa: BLE001
                print(f"  {n:<18} error: {e}")
                continue
        else:
            payload = {
                "model": args.model,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": PALLET_COUNT_PROMPT},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": "data:image/jpeg;base64,"
                                    + base64.b64encode(jpeg).decode()
                                },
                            },
                        ],
                    }
                ],
                "max_tokens": MAX_TOKENS,
                "temperature": 0,
            }

            try:
                completion = post_json("/chat/completions", payload)
            except urllib.error.HTTPError as e:
                detail = e.read().decode(errors="replace")[:400]
                print(f"  {n:<18} HTTP {e.code}: {detail}")
                continue
            except Exception as e:  # noqa: BLE001 — surface transport failures per image
                print(f"  {n:<18} error: {e}")
                continue

            content = (completion.get("choices") or [{}])[0].get("message", {}).get("content", "")
            parsed = extract_json(content)
        if not parsed:
            print(f"  {n:<18} unparseable: {content[:90]!r}")
            rows.append({"file": n, "raw": content})
            continue

        def fmt(v):
            return "-" if v is None else ("Y" if v is True else "N" if v is False else v)

        print(
            f"{n:<20}{str(fmt(parsed.get('layers'))):>7}"
            f"{str(fmt(parsed.get('estimatedBags'))):>6}"
            f"{str(fmt(parsed.get('confidence'))):>6}"
            f"{str(fmt(parsed.get('topLayerFull'))):>5}"
            f"{str(fmt(parsed.get('gaps'))):>5}"
            f"{str(fmt(parsed.get('damage'))):>5}"
            f"   {size[0]}x{size[1]} {nbytes // 1024}KB"
        )
        rows.append(
            {
                "file": n,
                "palletTotalFromFilename": ground_truth(n),
                "sentSize": list(size),
                "result": parsed,
            }
        )

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"model": args.model, "baseUrl": BASE_URL, "results": rows}, fh, indent=2)
    print(f"\n{len(rows)} result(s) -> {args.out}")
    print("\nRationales:")
    for r in rows:
        rat = (r.get("result") or {}).get("rationale")
        if rat:
            print(f"  {r['file']}: {rat}")


if __name__ == "__main__":
    main()
