"""
Fine-tune RF-DETR on pallet-bag photos.

RF-DETR trains on a COCO-format dataset (the "COCO" export option in Roboflow),
NOT a YOLO data.yaml. Expected layout under --dataset-dir:

    dataset/
      train/ _annotations.coco.json  + image files
      valid/ _annotations.coco.json  + image files
      test/  _annotations.coco.json  + image files   (optional)

Label one class "bag" (add "gap" and "damage" if you want those signals — then set
the matching RFDETR_*_CLASSES env vars on the service). The class order in the COCO
categories becomes the class_id order; pass the SAME order as RFDETR_CLASS_NAMES to
detector-service so names line up at inference time.

Usage:
    python train.py --dataset-dir ./pallet-bags-coco --epochs 100 --batch-size 4
    # -> best checkpoint at <output-dir>/checkpoint_best.pth
    # then run the service with:
    #   RFDETR_WEIGHTS=output/checkpoint_best.pth RFDETR_CLASS_NAMES=bag,gap,damage
"""

import argparse
import os

from rfdetr import RFDETRBase


def main() -> None:
    p = argparse.ArgumentParser(description="Fine-tune RF-DETR on pallet-bag photos.")
    p.add_argument("--dataset-dir", required=True,
                   help="COCO-format dataset dir (train/ valid/ [test/] with _annotations.coco.json)")
    p.add_argument("--output-dir", default="output", help="where checkpoints are written")
    p.add_argument("--epochs", type=int, default=100)
    p.add_argument("--batch-size", type=int, default=4)
    p.add_argument("--grad-accum-steps", type=int, default=4,
                   help="effective batch = batch-size x grad-accum-steps")
    p.add_argument("--lr", type=float, default=1e-4)
    p.add_argument("--resolution", type=int, default=None,
                   help="inference/train resolution, multiple of 56 (default: model default)")
    args = p.parse_args()

    if not os.path.isdir(os.path.join(args.dataset_dir, "train")):
        raise SystemExit(
            f"'{args.dataset_dir}/train' not found. Export from Roboflow as 'COCO' "
            "and point --dataset-dir at the unzipped folder."
        )

    kwargs = {}
    if args.resolution:
        kwargs["resolution"] = args.resolution

    model = RFDETRBase(**kwargs)
    model.train(
        dataset_dir=args.dataset_dir,
        epochs=args.epochs,
        batch_size=args.batch_size,
        grad_accum_steps=args.grad_accum_steps,
        lr=args.lr,
        output_dir=args.output_dir,
    )

    best = os.path.join(args.output_dir, "checkpoint_best.pth")
    print(f"\nDone. Best checkpoint: {best}")
    print("Serve it with:")
    print(f"  RFDETR_WEIGHTS={best} RFDETR_CLASS_NAMES=bag,gap,damage \\")
    print("    uvicorn app:app --port 8080")


if __name__ == "__main__":
    main()
