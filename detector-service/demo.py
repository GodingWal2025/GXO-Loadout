"""
Batch-run the detector over a folder of pallet photos and produce a reviewable demo.

Writes, per image, an annotated JPEG with numbered boxes, plus a results.json and
a printed table comparing the model against the pallet totals encoded in the
filenames (e.g. "Pallet2-60.jpg" -> 60 bags on that pallet).

    python demo.py --src ~/Desktop/Bags_Phots --out demo-output --backend owlv2

Read the comparison honestly: `estimatedBags` counts only bags VISIBLE on the
photographed face, while the filename total is the whole pallet including the
occluded interior. They are not supposed to match. The column is there to show
the relationship (and to sanity-check that detections track stack size at all),
not as an accuracy score.
"""

import argparse
import json
import os
import sys


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Batch pallet bag-count demo.")
    p.add_argument("--src", required=True, help="folder of pallet photos")
    p.add_argument("--out", default="demo-output", help="where annotated images + results.json go")
    p.add_argument("--backend", default="owlv2", choices=["owlv2", "rfdetr"])
    p.add_argument("--conf", default=None, help="override backend confidence threshold")
    p.add_argument("--min-size", type=int, default=640,
                   help="skip images whose long edge is under this (thumbnails)")
    p.add_argument("--limit", type=int, default=0, help="only process the first N images")
    return p.parse_args()


args = parse_args()

# Backend selection has to land in the environment BEFORE app is imported —
# app.py loads the model at module scope.
os.environ["DETECTOR_BACKEND"] = args.backend
if args.conf:
    os.environ["OWL_CONF" if args.backend == "owlv2" else "RFDETR_CONF"] = args.conf

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

import app as service  # noqa: E402


def ground_truth(filename: str) -> int | None:
    """
    Pull the pallet total out of names like 'Pallet2-60.jpg' / 'Pallet7.1-50.jpg'.

    This is the whole-pallet quantity off the SKU label, NOT a visible-face count.
    """
    stem = os.path.splitext(filename)[0]
    if "-" not in stem:
        return None
    tail = stem.rsplit("-", 1)[1]
    return int(tail) if tail.isdigit() else None


def annotate(img: Image.Image, dets, result: dict, title: str) -> Image.Image:
    canvas = img.copy()
    draw = ImageDraw.Draw(canvas, "RGBA")

    scale = max(1, canvas.width // 800)
    try:
        font = ImageFont.truetype("arial.ttf", 14 * scale)
    except OSError:
        font = ImageFont.load_default()

    for i, d in enumerate(sorted(dets, key=lambda d: ((d.y1 + d.y2) / 2, d.x1)), start=1):
        draw.rectangle([d.x1, d.y1, d.x2, d.y2], outline=(0, 200, 90), width=2 * scale)
        label = f"{i} {d.score:.2f}"
        tx, ty = d.x1 + 2 * scale, d.y1 + 2 * scale
        box = draw.textbbox((tx, ty), label, font=font)
        draw.rectangle(box, fill=(0, 0, 0, 190))
        draw.text((tx, ty), label, fill=(255, 255, 255), font=font)

    banner = (
        f"{title}   visible bags: {result['estimatedBags'] or 0}   "
        f"layers: {result['layers'] or 0}   conf: {result['confidence'] or 0}"
    )
    bh = 26 * scale
    draw.rectangle([0, 0, canvas.width, bh], fill=(0, 0, 0, 205))
    draw.text((6 * scale, 5 * scale), banner, fill=(255, 255, 255), font=font)
    return canvas


def main() -> None:
    src = os.path.expanduser(args.src)
    out = os.path.expanduser(args.out)
    os.makedirs(out, exist_ok=True)

    names = sorted(
        n for n in os.listdir(src) if n.lower().endswith((".jpg", ".jpeg", ".png"))
    )
    if args.limit:
        names = names[: args.limit]
    if not names:
        sys.exit(f"No images found in {src}")

    print(f"backend={args.backend} model={service.MODEL_VERSION}")
    print(f"{len(names)} candidate image(s) in {src}\n")

    rows, skipped = [], []
    for n in names:
        path = os.path.join(src, n)
        with open(path, "rb") as fh:
            img = service.load_image(fh.read())

        if max(img.size) < args.min_size:
            skipped.append((n, f"{img.width}x{img.height} below --min-size"))
            continue

        dets = service.detect(img)
        result = service.analyze_image(img)

        dest = os.path.join(out, f"{os.path.splitext(n)[0]}_annotated.jpg")
        annotate(img, dets, result, n).save(dest, quality=88)

        gt = ground_truth(n)
        rows.append(
            {
                "file": n,
                "palletTotalFromFilename": gt,
                "visibleBags": result["estimatedBags"] or 0,
                "layers": result["layers"] or 0,
                "confidence": result["confidence"],
                "annotated": os.path.basename(dest),
                "result": result,
            }
        )
        print(
            f"  {n:<20} visible={result['estimatedBags'] or 0:>3}  "
            f"layers={result['layers'] or 0:>2}  "
            f"conf={result['confidence'] if result['confidence'] is not None else '-':>5}  "
            f"palletTotal={gt if gt is not None else '-'}"
        )

    with open(os.path.join(out, "results.json"), "w", encoding="utf-8") as fh:
        json.dump(
            {"backend": args.backend, "model": service.MODEL_VERSION,
             "results": rows, "skipped": skipped},
            fh,
            indent=2,
        )

    print(f"\n{len(rows)} processed, {len(skipped)} skipped")
    for n, why in skipped:
        print(f"  skipped {n}: {why}")
    print(f"\nAnnotated images + results.json -> {out}")


if __name__ == "__main__":
    main()
