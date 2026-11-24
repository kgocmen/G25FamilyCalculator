"""Predict experimental G25 coordinates from a raw-DNA CSV.

Requires the local models and MIT-licensed projector in data/blend.
The output is simulated G25, never an official Eurogenes coordinate row.
"""

import argparse
import csv
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import numpy as np

from g25_mapper_math import neighbor_residual


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "blend"


def read_row(path, dimensions):
    with path.open(newline="", encoding="utf-8-sig") as handle:
        row = next(csv.reader(handle))
    if len(row) != dimensions + 1:
        raise ValueError(f"{path}: expected {dimensions} coordinates")
    return np.array(row[1:], dtype=float)


def map_row(local, path):
    with np.load(path) as model:
        baseline = local @ model["a"] + model["c"]
        correction = neighbor_residual(
            model["train_x"], model["residual"], baseline[None, :],
            int(model["neighbors"]), float(model["power"]),
        )[0]
        return baseline + float(model["strength"]) * correction


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("raw", type=Path, help="23andMe/MyHeritage-style raw DNA file")
    parser.add_argument("--out-dir", type=Path, default=None)
    parser.add_argument("--name", default=None)
    parser.add_argument("--components", action="store_true",
                        help="also write separate rows for each PCA axis model")
    parser.add_argument("--experimental-25", action="store_true",
                        help="include the offline 25-axis candidate in an equal-weight blend")
    args = parser.parse_args()
    raw = args.raw.resolve()
    if not raw.is_file():
        parser.error(f"missing raw DNA file: {raw}")
    out_dir = args.out_dir or raw.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    name = args.name or raw.stem
    projector = DATA / "g25_projector" / "convert.py"
    if not projector.is_file():
        parser.error(f"missing projector: {projector}")
    predictions = {}
    axes_to_use = (25, 50, 100) if args.experimental_25 else (50, 100)
    with tempfile.TemporaryDirectory(prefix="g25_direct_") as folder:
        for axes in axes_to_use:
            model = DATA / f"ho{axes}_model.npz"
            mapper = DATA / f"direct_chip_all{axes}_clean_neighbor.npz"
            if not model.is_file() or not mapper.is_file():
                parser.error(f"missing model or mapper for {axes} axes")
            prefix = Path(folder) / f"local{axes}"
            env = dict(os.environ, OPENBLAS_NUM_THREADS="1")
            subprocess.run([
                sys.executable, str(projector), str(raw), "--model", str(model),
                "--out", str(prefix), "--no-calibrate", "--closest", "0",
            ], check=True, capture_output=True, text=True, env=env)
            local = read_row(Path(str(prefix) + ".g25.unscaled.txt"), axes)
            predictions[str(axes)] = map_row(local, mapper)
    predictions["blend"] = sum(predictions[str(axis)] for axis in axes_to_use) / len(axes_to_use)
    primary = out_dir / f"{name}.g25_{'triple_' if args.experimental_25 else ''}scaled.txt"
    primary.write_text(
        name + "," + ",".join(f"{v:.6f}" for v in predictions["blend"]) + "\n"
    )
    print(primary)
    if args.components:
        for label in map(str, axes_to_use):
            dest = out_dir / f"{name}.g25_{label}_scaled.txt"
            dest.write_text(name + "," + ",".join(f"{v:.6f}" for v in predictions[label]) + "\n")
            print(dest)


if __name__ == "__main__":
    main()
