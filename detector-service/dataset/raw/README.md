# Raw collected pallets

Photos and hand counts gathered in the warehouse, before labeling. This is the
source of truth the labeled COCO splits are cut from — `train/`, `valid/`, and
`test/` are gitignored and reproducible, this folder is not.

## How it gets here

1. A collector opens the **Collect** tab of `/bag-count-console.html` on their
   phone, shoots four sides of a pallet plus one to three bag-flap close-ups,
   enters the count, and taps upload. No GitHub account or token involved.
2. Photos land in Azure blob storage, counts in table storage.
3. You pull them down:

   ```bash
   cd detector-service
   python sync_training_data.py --api https://<your-app>.azurestaticapps.net
   ```

4. Review, then commit.

## Layout

```
raw/
  samples.csv                       # every pallet's ground-truth count, rebuilt on each sync
  <site>__<palletId>__<short-id>/
    manifest.json                   # the full submission as the collector entered it
    FRONT.jpg  RIGHT.jpg  BACK.jpg  LEFT.jpg
    FLAP_1.jpg [FLAP_2.jpg] [FLAP_3.jpg]
```

The four sides are what you label (one `bag_flap` box per visible sewn end). The
flap close-ups are **not** training images for the detector — they carry the
batch code and material description so a pallet can be traced back to what was
actually on it.

`samples.csv` has a `total_matches` column. A `NO` there means the collector's
hand count disagreed with `bags_per_layer × full_layers + partial_bags`. That is
not automatically an error — a miscount in either direction is possible — but
those pallets are worth a second look before they become ground truth.

## Splitting

Split by **whole pallet**, never by photo. All four sides of one pallet must end
up in the same split or evaluation scores come out misleadingly high: the model
will have seen the same stack from another angle. Target 70/15/15.

## Storage budget — read before the collection drive gets big

Photos are capped at 1600px / ~900 KB each, so a pallet with 4 sides and 1 flap
runs about 4–5 MB.

| Pallets | Photos | Repo size |
|--------:|-------:|----------:|
|      50 |    250 |   ~220 MB |
|     200 |  1,000 |   ~900 MB |
|     500 |  2,500 |   ~2.2 GB |

`.gitattributes` routes these through **Git LFS**, whose free GitHub tier is
1 GB of storage and 1 GB/month of bandwidth. Around 200 pallets you will need a
paid LFS data pack.

If you would rather not pay for that, the photos are already durable in Azure
blob storage — the repo copy is a convenience, not the backup. Two ways out:

- Commit only the pallets you have actually labeled, and leave the rest on the
  server (`sync_training_data.py` skips what is already on disk, so you can pull
  selectively and delete folders you are not using yet).
- Drop the LFS rules from `.gitattributes` and gitignore `raw/*/` entirely,
  treating Azure as the only home for the photos. Keep `samples.csv` committed —
  it is small and it is the part that is painful to reconstruct.
