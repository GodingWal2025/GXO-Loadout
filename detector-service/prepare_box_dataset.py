"""Resolve reviewed console box exports against a preserved photo snapshot.

Produces an unsplit detection dataset. Mask training remains a separate contract;
no synthetic masks or train/test assignments are created here.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

SIDES = {'FRONT', 'RIGHT', 'BACK', 'LEFT'}


def prepare_boxes(annotation_file: Path, snapshot: Path, output: Path):
    data = json.loads(annotation_file.read_text(encoding='utf-8'))
    if data.get('info', {}).get('annotationType') != 'boxes':
        raise ValueError('Expected a reviewed four-side box export')
    if data.get('categories') != [{'id': 1, 'name': 'bag_flap', 'supercategory': 'pallet'}]:
        raise ValueError('Expected the bag_flap category')
    inventory = json.loads((snapshot / 'photo_inventory.json').read_text(encoding='utf-8'))
    lookup = {(p['sampleId'], p['photoId']): p for p in inventory if p['status'] == 'readable'}
    images = data.get('images', [])
    if not images: raise ValueError('No reviewed images')
    seen_ids, seen_names, seen_hashes = set(), set(), set()
    copies = []
    image_by_id = {}
    for im in images:
        name = im['file_name']
        if Path(name).name != name or '/' in name or '\\' in name or name in {'.', '..'}:
            raise ValueError('Unsafe image filename')
        if im['id'] in seen_ids or name in seen_names: raise ValueError('Duplicate image ID or filename')
        if im.get('role') not in SIDES or im.get('review_status') != 'reviewed' or not im.get('pallet_group_id') or not im.get('reviewer') or not im.get('review_reason'):
            raise ValueError('Image needs reviewed side metadata and physical pallet group')
        source = lookup.get((im.get('sample_id'), im.get('photo_id')))
        if not source or source['role'] != im['role']: raise ValueError('Photo does not match snapshot')
        source_path = (snapshot / source['path']).resolve()
        if not source_path.is_relative_to(snapshot.resolve()): raise ValueError('Unsafe snapshot path')
        digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
        if digest != im.get('sha256') or digest != source['sha256']: raise ValueError('Photo checksum mismatch')
        if digest in seen_hashes: raise ValueError('Duplicate photo bytes: resolve before preparing training data')
        if (im['width'], im['height']) != (source['width'], source['height']): raise ValueError('Image dimensions differ')
        seen_ids.add(im['id']); seen_names.add(name); seen_hashes.add(digest)
        image_by_id[im['id']] = im; copies.append((source_path, name))
    counts = dict.fromkeys(image_by_id, 0)
    annotation_ids = set()
    for a in data.get('annotations', []):
        im = image_by_id.get(a.get('image_id'))
        if not im or a.get('category_id') != 1 or a.get('id') in annotation_ids: raise ValueError('Invalid annotation reference')
        annotation_ids.add(a['id'])
        if a.get('segmentation'): raise ValueError('Masks need the segmentation workflow')
        box = a.get('bbox', [])
        if len(box) != 4: raise ValueError('Invalid box')
        x, y, w, h = box
        if not (0 <= x < x+w <= im['width'] and 0 <= y < y+h <= im['height']): raise ValueError('Box outside image')
        counts[im['id']] += 1
    if any(counts[im['id']] != im.get('visible_count') for im in images): raise ValueError('Visible count and boxes disagree')
    # Validate everything before creating output. Never merge over an old dataset.
    output.mkdir(parents=True, exist_ok=False)
    for source, name in copies: shutil.copyfile(source, output / name)
    (output / '_annotations.coco.json').write_text(json.dumps(data, indent=2), encoding='utf-8')
    (output / 'dataset-manifest.json').write_text(json.dumps({
        'schemaVersion': 1, 'annotationType': 'boxes', 'split': 'unassigned',
        'groups': sorted({im['pallet_group_id'] for im in images}),
        'sourceExportSha256': hashlib.sha256(annotation_file.read_bytes()).hexdigest(),
        'images': len(images), 'boxes': len(data.get('annotations', []))}, indent=2), encoding='utf-8')
    return len(images)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--annotations', type=Path, required=True)
    parser.add_argument('--snapshot', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(f'Prepared {prepare_boxes(args.annotations, args.snapshot, args.output)} reviewed images (unsplit).')
