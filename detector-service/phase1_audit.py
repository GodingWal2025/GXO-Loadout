"""Read-only source audit and resumable, checksum-verified training snapshot.

Never writes to the source API. Reusing --output resumes the original manifest;
it never refreshes that manifest or overwrites a downloaded photo. Requires Pillow.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import time
from urllib.request import urlopen

from PIL import Image, ImageOps

SIDES = ('FRONT', 'RIGHT', 'BACK', 'LEFT')


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2), encoding='utf-8')


def csv_file(path, rows, fields):
    with path.open('w', newline='', encoding='utf-8-sig') as out:
        writer = csv.DictWriter(out, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)


def safe_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value):
        raise ValueError('Unsafe manifest identifier')
    return value


def get(url):
    for attempt in range(3):
        try:
            with urlopen(url, timeout=60) as response:
                return response.read()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def inspect_photo(root, api, sample, photo):
    sid, pid = safe_id(sample['id']), safe_id(photo['id'])
    role = safe_id(photo['role'])
    rel = Path('photos') / sid / f'{role}__{pid}.jpg'
    path = root / rel
    row = dict(sampleId=sid, photoId=pid, role=role, path=rel.as_posix())
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            data = get(f'{api}/api/training/photos/{sid}/{pid}')
            # Validate before committing to the snapshot; preserve corrupt responses separately.
            try:
                with Image.open(io.BytesIO(data)) as im:
                    im.verify()
            except Exception:
                (path.with_suffix('.invalid')).write_bytes(data)
                raise
            with path.open('xb') as out:
                out.write(data)
        data = path.read_bytes()
        with Image.open(io.BytesIO(data)) as im:
            im.load()
            upright = ImageOps.exif_transpose(im).convert('RGB')
            thumb = upright.convert('L').resize((9, 8))
            values = list(thumb.get_flattened_data())
            bits = [values[y * 9 + x] > values[y * 9 + x + 1] for y in range(8) for x in range(8)]
            dhash = sum(int(v) << i for i, v in enumerate(bits))
            row.update(width=upright.width, height=upright.height, dhash=f'{dhash:016x}')
        row.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest(), status='readable', error='')
    except Exception as exc:
        row.update(status='failed', error=str(exc))
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--workers', type=int, default=6)
    args = parser.parse_args()
    api = args.api.rstrip('/')
    root = Path(args.output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    manifest = root / 'all_samples_manifest.json'
    if not manifest.exists():
        data = get(api + '/api/training/samples')
        json.loads(data)
        with manifest.open('xb') as out:
            out.write(data)
        write_json(root / 'snapshot.json', dict(source=api, capturedAt=datetime.now(timezone.utc).isoformat(),
                                              manifestSha256=hashlib.sha256(data).hexdigest()))
    meta = json.loads((root / 'snapshot.json').read_text())
    if meta['source'] != api or meta['manifestSha256'] != hashlib.sha256(manifest.read_bytes()).hexdigest():
        raise ValueError('Snapshot source or manifest checksum differs; use a new output directory')
    samples = json.loads(manifest.read_text(encoding='utf-8'))['samples']
    jobs = [(s, p) for s in samples for p in s['photos']]
    print(f'Snapshot: {len(samples)} pallets / {len(jobs)} photos', flush=True)
    photos = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        tasks = [pool.submit(inspect_photo, root, api, s, p) for s, p in jobs]
        for i, future in enumerate(as_completed(tasks), 1):
            photos.append(future.result())
            if i % 50 == 0:
                print(f'Inspected {i}/{len(jobs)}', flush=True)
    photos.sort(key=lambda r: (r['sampleId'], r['role']))
    previous = root / 'checksums.json'
    if previous.exists():
        old = {r['path']: r['sha256'] for r in json.loads(previous.read_text())}
        if any(r.get('sha256') != old[r['path']] for r in photos if r['path'] in old):
            raise ValueError('Previously snapshotted photo changed')
    good = [p for p in photos if p['status'] == 'readable']
    write_json(root / 'photo_inventory.json', photos)
    if not previous.exists():
        write_json(previous, [dict(path=p['path'], sha256=p['sha256']) for p in good])
    # Difference-hash matches are candidates only, never proof of a repeated pallet.
    pairs = []
    for i, a in enumerate(good):
        for b in good[i + 1:]:
            distance = (int(a['dhash'], 16) ^ int(b['dhash'], 16)).bit_count()
            exact = a['sha256'] == b['sha256']
            if exact or (a['role'] in SIDES and b['role'] in SIDES and distance <= 5):
                pairs.append(dict(sampleA=a['sampleId'], photoA=a['photoId'], sampleB=b['sampleId'],
                                  photoB=b['photoId'], distance=distance, exact=exact,
                                  disposition='unresolved', reason='Human comparison required'))
    write_json(root / 'duplicate_candidates.json', pairs)
    flagged = {p[k] for p in pairs for k in ('sampleA', 'sampleB')}
    # Identical sets of all four side bytes must stay together in any future split,
    # even before the operator resolves whether this was a repeat submission.
    signatures = {}
    evidence_groups = {}
    for s in sorted(samples, key=lambda s: s['id']):
        sides = sorted((p['role'], p['sha256']) for p in good if p['sampleId'] == s['id'] and p['role'] in SIDES)
        signature = tuple(sides)
        canonical = signatures.setdefault(signature, s['id']) if len(sides) == 4 else s['id']
        evidence_groups[s['id']] = canonical
    write_json(root / 'evidence_groups.json', evidence_groups)
    rows = []
    for s in samples:
        per, layers, partial, total = (s.get(k, 0) for k in ('bagsPerLayer', 'fullLayers', 'partialBags', 'totalBags'))
        missing = sorted(set(SIDES) - {p['role'] for p in s['photos']})
        failed = [p for p in photos if p['sampleId'] == s['id'] and p['status'] != 'readable']
        reasons = []
        if missing: reasons.append('missing_sides:' + '|'.join(missing))
        if failed: reasons.append('unreadable_photo')
        if total != per * layers + partial: reasons.append('arithmetic_mismatch')
        if partial > 0 and partial >= per: reasons.append('partial_field_meaning_needs_verifier')
        if s['id'] in flagged: reasons.append('duplicate_candidate')
        rows.append(dict(sampleId=s['id'], physicalPalletGroup=s.get('palletId') or '', evidenceGroup=evidence_groups[s['id']],
                         totalBags=total, bagsPerLayer=per, fullLayers=layers, partialBags=partial,
                         quality=s.get('quality') or 'unspecified', reviewStatus='unresolved' if reasons else 'unreviewed',
                         reasons=';'.join(reasons), verifier='', verificationMethod='', notes=s.get('notes') or ''))
    csv_file(root / 'sample_audit.csv', rows, list(rows[0]) if rows else ['sampleId'])
    # Balanced development shortlist, never a claim that photographs prove actual counts.
    selected = []
    def take(predicate, count, reason):
        candidates = sorted((s for s in samples if predicate(s) and evidence_groups[s['id']] == s['id'] and s['id'] not in {r['sampleId'] for r in selected}),
                            key=lambda s: hashlib.sha256(s['id'].encode()).hexdigest())
        for s in candidates[:count]: selected.append(dict(sampleId=s['id'], selectionReason=reason,
                                                         recordedTotal=s['totalBags']))
    take(lambda s: s.get('partialBags', 0) >= s['bagsPerLayer'], 4, 'unusual partial metadata')
    take(lambda s: 'mixed' in (s.get('notes') or '').lower(), 4, 'mixed stack noted')
    take(lambda s: s['totalBags'] <= 24, 4, 'short stack')
    take(lambda s: s.get('partialBags', 0) > 0, 4, 'partial stack')
    take(lambda s: s['totalBags'] == 60, 4, 'full stack')
    take(lambda s: True, 20 - len(selected), 'coverage fill')
    for row in selected:
        row.update(dict(verifierA='', frontA='', rightA='', backA='', leftA='', verifierB='', frontB='', rightB='',
                        backB='', leftB='', physicalTotal='', physicalCountMethod='', visibilityIssues='',
                        countingContractDecision='PENDING'))
    csv_file(root / 'verification_20_pallets.csv', selected, list(selected[0]) if selected else ['sampleId'])
    contact_dir = root / 'verification-photos'
    contact_dir.mkdir(exist_ok=True)
    for s in selected:
        strip = Image.new('RGB', (1200, 440), 'white')
        from PIL import ImageDraw
        draw = ImageDraw.Draw(strip)
        draw.text((8, 5), s['sampleId'] + ' | ' + s['selectionReason'], fill='black')
        for i, role in enumerate(SIDES):
            p = next((p for p in good if p['sampleId'] == s['sampleId'] and p['role'] == role), None)
            draw.text((i * 300 + 8, 28), role, fill='black')
            if p:
                with Image.open(root / p['path']) as im:
                    im = ImageOps.exif_transpose(im).convert('RGB')
                    im.thumbnail((295, 380))
                    strip.paste(im, (i * 300, 50))
        strip.save(contact_dir / (s['sampleId'] + '.jpg'))
    # Restore into a distinct directory and re-hash every byte, then decode every image.
    restore = root / 'restore-check'
    restore.mkdir(exist_ok=True)
    for p in good:
        dest = restore / p['path']
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root / p['path'], dest)
        if hashlib.sha256(dest.read_bytes()).hexdigest() != p['sha256']:
            raise ValueError('Restore checksum mismatch')
        with Image.open(dest) as im: im.load()
    summary = dict(snapshot=meta, pallets=len(samples), photosExpected=len(jobs), photosReadable=len(good),
                   photosFailed=len(photos)-len(good), restoreVerified=len(good),
                   exactDuplicatePairs=sum(p['exact'] for p in pairs), nearDuplicateCandidatePairs=sum(not p['exact'] for p in pairs),
                   unusualPartialRecords=sum(r['partialBags'] > 0 and r['partialBags'] >= r['bagsPerLayer'] for r in rows),
                   arithmeticMismatches=sum(r['totalBags'] != r['bagsPerLayer'] * r['fullLayers'] + r['partialBags'] for r in rows),
                   verificationPallets=len(selected), physicalVerification='pending independent warehouse counts')
    write_json(root / 'audit_summary.json', summary)
    print(json.dumps(summary, indent=2), flush=True)
    return 1 if len(good) != len(jobs) else 0


if __name__ == '__main__':
    raise SystemExit(main())
