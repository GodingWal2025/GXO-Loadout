#!/usr/bin/env python3
"""Pull collected pallet photos + ground-truth counts into the repo.

Collectors submit from the bag-count console's **Collect** tab. Their photos go
to Azure blob storage and their counts to table storage; this script downloads
both into ``dataset/raw/`` so they can be reviewed, committed, and labeled.

    python sync_training_data.py --api https://<your-app>.azurestaticapps.net

Layout produced::

    dataset/raw/
      samples.csv                     # every pallet's ground-truth count
      <site>__<palletId>__<short-id>/
        manifest.json
        FRONT.jpg  RIGHT.jpg  BACK.jpg  LEFT.jpg
        FLAP_1.jpg [FLAP_2.jpg FLAP_3.jpg]

Already-downloaded pallets are skipped, so re-running is cheap and safe. Nothing
is deleted from the server: use ``--purge-remote`` once a pallet is committed, or
delete it from the console's queue view.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

# Order matters for the CSV and for eyeballing a folder — sides then flaps.
SIDE_ROLES = ("FRONT", "RIGHT", "BACK", "LEFT")
FLAP_ROLES = ("FLAP_1", "FLAP_2", "FLAP_3")

CSV_COLUMNS = [
    "sample_id",
    "pallet_id",
    "site",
    "collector",
    "captured_at",
    "batch_code",
    "material_description",
    "sku",
    "bags_per_layer",
    "full_layers",
    "partial_bags",
    "total_bags",
    "computed_total",
    "total_matches",
    "photo_count",
    "folder",
    "notes",
]


def slug(value: str, fallback: str = "unknown") -> str:
    """Filesystem-safe token. Pallet IDs come from a human typing on a phone."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", (value or "").strip()).strip("-.")
    return cleaned[:48] or fallback


def fetch_json(url: str, timeout: int) -> Any:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_bytes(url: str, timeout: int) -> bytes:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read()


def request_delete(url: str, timeout: int) -> None:
    req = urllib.request.Request(url, method="DELETE")
    with urllib.request.urlopen(req, timeout=timeout):
        pass


def folder_name(sample: dict) -> str:
    site = slug(sample.get("site") or "site", "site")
    pallet = slug(sample.get("palletId") or "pallet", "pallet")
    short = slug(sample.get("id", ""))[-8:] or "00000000"
    return f"{site}__{pallet}__{short}"


def download_sample(api: str, sample: dict, raw_dir: Path, timeout: int, force: bool) -> tuple[Path, int]:
    """Download one pallet. Returns (folder, photos written)."""
    dest = raw_dir / folder_name(sample)
    manifest_path = dest / "manifest.json"
    if manifest_path.exists() and not force:
        return dest, 0

    # Stage into a sibling ``.partial`` directory so an interrupted run never
    # leaves a folder that looks complete to the next run.
    staging = dest.with_name(dest.name + ".partial")
    if staging.exists():
        for leftover in staging.iterdir():
            leftover.unlink()
    staging.mkdir(parents=True, exist_ok=True)

    written = 0
    sample_id = sample["id"]
    for photo in sample.get("photos", []):
        role = photo.get("role", "UNKNOWN")
        url = f"{api}/api/training/photos/{sample_id}/{photo['id']}"
        data = fetch_bytes(url, timeout)
        (staging / f"{role}.jpg").write_bytes(data)
        written += 1

    (staging / "manifest.json").write_text(json.dumps(sample, indent=2), encoding="utf-8")

    if dest.exists():
        for leftover in dest.iterdir():
            leftover.unlink()
        dest.rmdir()
    staging.rename(dest)
    return dest, written


def write_csv(raw_dir: Path, samples: list[dict]) -> Path:
    """One row per pallet, rewritten from every manifest on disk.

    Rebuilding from disk rather than appending means the CSV always describes
    exactly what is committed, even if someone deletes a folder by hand.
    """
    rows = []
    for manifest_path in sorted(raw_dir.glob("*/manifest.json")):
        try:
            s = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            print(f"  ! skipping unreadable {manifest_path}", file=sys.stderr)
            continue
        per = s.get("bagsPerLayer") or 0
        layers = s.get("fullLayers") or 0
        partial = s.get("partialBags") or 0
        computed = per * layers + partial
        total = s.get("totalBags") or 0
        rows.append({
            "sample_id": s.get("id", ""),
            "pallet_id": s.get("palletId", ""),
            "site": s.get("site", ""),
            "collector": s.get("collector", ""),
            "captured_at": s.get("capturedAt", ""),
            "batch_code": s.get("batchCode") or "",
            "material_description": s.get("materialDescription") or "",
            "sku": s.get("sku") or "",
            "bags_per_layer": per,
            "full_layers": layers,
            "partial_bags": partial,
            "total_bags": total,
            "computed_total": computed,
            "total_matches": "yes" if computed == total else "NO",
            "photo_count": len(s.get("photos", [])),
            "folder": manifest_path.parent.name,
            "notes": s.get("notes") or "",
        })

    rows.sort(key=lambda r: (r["site"], r["pallet_id"], r["captured_at"]))
    csv_path = raw_dir / "samples.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    return csv_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--api", required=True, help="Base URL of the deployed app, e.g. https://<app>.azurestaticapps.net")
    parser.add_argument("--dataset-dir", default="./dataset", help="Dataset root (default: ./dataset)")
    parser.add_argument("--timeout", type=int, default=60, help="Per-request timeout in seconds")
    parser.add_argument("--force", action="store_true", help="Re-download pallets already present on disk")
    parser.add_argument("--purge-remote", action="store_true",
                        help="Delete each pallet from the server after a successful download. "
                             "Only use this once the previous batch is committed.")
    args = parser.parse_args()

    api = args.api.rstrip("/")
    raw_dir = Path(args.dataset_dir).expanduser().resolve() / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    print(f"Fetching sample list from {api}/api/training/samples")
    try:
        payload = fetch_json(f"{api}/api/training/samples", args.timeout)
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")[:400]
        print(f"Server returned HTTP {err.code}: {detail}", file=sys.stderr)
        return 1
    except (urllib.error.URLError, TimeoutError) as err:
        print(f"Could not reach {api}: {err}", file=sys.stderr)
        return 1

    samples = payload.get("samples", [])
    print(f"{len(samples)} sample(s) on the server, {payload.get('photoCount', 0)} photo(s)\n")

    downloaded = skipped = failed = 0
    for sample in samples:
        label = f"{sample.get('site','?')} / {sample.get('palletId','?')}"
        try:
            dest, written = download_sample(api, sample, raw_dir, args.timeout, args.force)
        except (urllib.error.URLError, urllib.error.HTTPError, OSError, KeyError, TimeoutError) as err:
            print(f"  x {label}: {err}", file=sys.stderr)
            failed += 1
            continue

        if written == 0:
            skipped += 1
            continue

        missing = [r for r in SIDE_ROLES if not (dest / f"{r}.jpg").exists()]
        flaps = [r for r in FLAP_ROLES if (dest / f"{r}.jpg").exists()]
        warn = ""
        if missing:
            warn = f"  [!] missing sides: {', '.join(missing)}"
        elif not flaps:
            warn = "  [!] no flap photo"
        print(f"  + {label} -> {dest.name} ({written} photos){warn}")
        downloaded += 1

        if args.purge_remote and not missing and flaps:
            try:
                request_delete(f"{api}/api/training/samples/{sample['id']}", args.timeout)
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as err:
                print(f"    ! could not purge from server: {err}", file=sys.stderr)

    csv_path = write_csv(raw_dir, samples)
    print(f"\n{downloaded} new, {skipped} already present, {failed} failed")
    print(f"Counts written to {csv_path}")
    print(f"\nNext: review {raw_dir}, commit it, then label the side photos on the console's Label tab.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
