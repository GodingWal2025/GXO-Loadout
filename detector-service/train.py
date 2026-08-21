"""Launch the pinned official SAM 3 trainer with the GXO mask configuration."""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

from validate_dataset import validate_dataset


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune SAM 3 on reviewed bag-flap masks")
    parser.add_argument("--dataset-dir", required=True)
    parser.add_argument("--output-dir", default="output/sam3")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--grad-accum-steps", type=int, default=4)
    parser.add_argument("--num-gpus", type=int, default=1)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--sam3-repo", default=os.environ.get("SAM3_REPO", "./sam3-source"),
                        help="pinned upstream SAM 3 source checkout (training configs are not in its wheel)")
    args = parser.parse_args()
    dataset_dir = Path(args.dataset_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    validate_dataset(dataset_dir, require_test=True, minimum_images=1)

    sam3_repo = Path(args.sam3_repo).resolve()
    package_config = sam3_repo / "sam3" / "train" / "configs" / "gxo_bag_flaps.yaml"
    official_base = sam3_repo / "sam3" / "train" / "configs" / "roboflow_v100" / "roboflow_v100_full_ft_100_images.yaml"
    if not official_base.is_file():
        raise SystemExit("--sam3-repo must point to the pinned SAM 3 source checkout with training configs")
    shutil.copy2(Path(__file__).parent / "configs" / "gxo_bag_flaps.yaml", package_config)
    env = os.environ.copy()
    env.update({
        "GXO_DATASET_DIR": dataset_dir.as_posix(),
        "GXO_OUTPUT_DIR": output_dir.as_posix(),
        "GXO_EPOCHS": str(args.epochs),
        "GXO_BATCH_SIZE": str(args.batch_size),
        "GXO_GRAD_ACCUM": str(args.grad_accum_steps),
        "GXO_TRAIN_WORKERS": str(args.workers),
        "PYTHONPATH": str(sam3_repo) + os.pathsep + env.get("PYTHONPATH", ""),
    })
    command = [sys.executable, "-m", "sam3.train.train", "-c", "configs/gxo_bag_flaps",
               "--use-cluster", "0", "--num-gpus", str(args.num_gpus)]
    subprocess.run(command, env=env, check=True)
    print(f"SAM 3 training complete. Checkpoints: {output_dir / 'checkpoints'}")


if __name__ == "__main__":
    main()
