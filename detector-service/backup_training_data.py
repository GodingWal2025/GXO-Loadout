#!/usr/bin/env python3
"""Backup all collected pallet training data (manifests, CSV, photos) from Azure Storage.

Usage:
    python backup_training_data.py --api https://<your-app>.azurestaticapps.net [--out-dir ./backups]
"""

from __future__ import annotations

import argparse
import csv
import datetime
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

CSV_COLUMNS = [
    "sample_id",
    "pallet_id",
    "site",
    "collector",
    "quality",
    "captured_at",
    "submitted_at",
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
    "photos",
    "notes",
]


def fetch_json(url: str, timeout: int = 60) -> Any:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_bytes(url: str, timeout: int = 60) -> bytes:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--api", required=True, help="Base URL of the deployed app, e.g. https://<app>.azurestaticapps.net")
    parser.add_argument("--out-dir", default="./backups", help="Base backup directory (default: ./backups)")
    parser.add_argument("--timeout", type=int, default=60, help="HTTP request timeout in seconds")
    args = parser.parse_args()

    api = args.api.rstrip("/")
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%SZ")
    backup_root = Path(args.out_dir).expanduser().resolve() / f"training_backup_{timestamp}"
    photos_dir = backup_root / "photos"
    backup_root.mkdir(parents=True, exist_ok=True)
    photos_dir.mkdir(parents=True, exist_ok=True)

    print(f"[*] Starting backup from {api}/api/training/samples...")
    try:
        data = fetch_json(f"{api}/api/training/samples", timeout=args.timeout)
    except Exception as e:
        print(f"[!] Failed to fetch sample list from {api}: {e}", file=sys.stderr)
        return 1

    samples = data.get("samples", [])
    print(f"[*] Found {len(samples)} samples on server ({data.get('photoCount', 0)} reported photos).")

    # 1. Save full JSON manifest
    manifest_path = backup_root / "all_samples_manifest.json"
    manifest_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"[+] Full JSON manifest saved to: {manifest_path}")

    # 2. Download all photos and build CSV rows
    csv_rows = []
    total_photos_downloaded = 0
    failed_photos = 0

    for idx, s in enumerate(samples, 1):
        sample_id = s.get("id", f"sample_{idx}")
        sample_folder = photos_dir / sample_id
        sample_folder.mkdir(exist_ok=True)

        # Save individual sample manifest
        (sample_folder / "manifest.json").write_text(json.dumps(s, indent=2), encoding="utf-8")

        per = s.get("bagsPerLayer") or 0
        layers = s.get("fullLayers") or 0
        partial = s.get("partialBags") or 0
        computed = per * layers + partial
        total = s.get("totalBags") or 0

        photo_refs = []
        for p in s.get("photos", []):
            p_id = p.get("id")
            role = p.get("role", "UNKNOWN")
            photo_file = sample_folder / f"{role}__{p_id}.jpg"
            photo_url = f"{api}/api/training/photos/{sample_id}/{p_id}"
            photo_refs.append(f"{role}:{p_id}")

            try:
                img_bytes = fetch_bytes(photo_url, timeout=args.timeout)
                photo_file.write_bytes(img_bytes)
                total_photos_downloaded += 1
            except Exception as pe:
                print(f"  [!] Failed to download photo {photo_url}: {pe}", file=sys.stderr)
                failed_photos += 1

        csv_rows.append({
            "sample_id": sample_id,
            "pallet_id": s.get("palletId", ""),
            "site": s.get("site", ""),
            "collector": s.get("collector", ""),
            "quality": s.get("quality", "good"),
            "captured_at": s.get("capturedAt", ""),
            "submitted_at": s.get("submittedAt", ""),
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
            "photos": "; ".join(photo_refs),
            "notes": s.get("notes") or "",
        })

    # 3. Write CSV summary
    csv_path = backup_root / "samples_summary.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(csv_rows)

    print(f"[+] CSV summary written to: {csv_path}")
    print(f"[+] Downloaded {total_photos_downloaded} photos successfully ({failed_photos} failed).")
    print(f"\n[✓] Complete backup successfully written to: {backup_root.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
