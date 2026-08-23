# Bag-flap dataset

Floor collectors can continue using the Collect/Review/Label workflow at
`/bag-count-console.html`. `sync_training_data.py` downloads those source photos
and ground truth into `raw/`; see [`raw/README.md`](raw/README.md).

The canonical `/bag-count-console.html` workflow owns the collected Azure records
and device queue. The retired `/admin/bag-count-console` URL redirects there so
operators do not create a second browser-local dataset. Run:

```bash
python prepare_dataset.py --source ./dataset-export --output ./dataset
python validate_dataset.py --dataset-dir ./dataset --require-test
```

This creates `train/`, `valid/`, and `test/` directories containing images and
`_annotations.coco.json`. Splits are assigned by whole pallet group (70/15/15),
never by individual image.

The validator requires one `bag flap` category, COCO RLE masks for every positive
annotation, normalized target-pallet boxes, existing image files, unique image
bytes, and strict pallet-group isolation. Reviewed zero-flap photos remain valid
negative examples. Generated splits and checkpoints remain gitignored.
