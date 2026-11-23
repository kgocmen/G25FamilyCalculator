"""Add independently published ancient G25 rows to local AADR chip anchors.

The official G25 table sometimes labels a no-UDG or enhanced preparation of an
individual whose AADR genotype uses the base ID. These are paired only when the
normalized individual ID identifies exactly one AADR genotype and that genotype
is absent from the existing anchors. Output is a local training artifact; do not
publish individual genotypes or the generated anchor file.

Example (run separately for 50 and 100 axes):
  python3 build/expand_g25_ancient_anchors.py \
    --panel /tmp/g25_direct_trial/data/aadr/v66_HO \
    --official '/tmp/g25_individual_refs/Global25_PCA_scaled (Ancient Individuals).txt' \
    --base /tmp/g25_direct_trial/models/ho50.official_chip_anchors_all.npz \
    --model data/blend/ho50_model.npz \
    --out /tmp/g25_ancient_expanded_50.npz
"""

import argparse
import csv
from collections import defaultdict
from pathlib import Path
import sys

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "data" / "blend" / "g25_projector"))
from g25.model import G25Model  # noqa: E402
from g25.panel import Panel  # noqa: E402
from g25.pca import standardization, standardize  # noqa: E402
from g25.project import lsq_per_individual  # noqa: E402


PREPARATIONS = ("_noUDG", "_enhanced", "_udg", "_d")
SUFFIXES = {"HO", "AG", "DG", "SG", "TW", "WGC"}


def identity(name):
    """Discard the assay suffix and exactly one named preparation modifier."""
    name = name.rsplit(":", 1)[-1]
    if name.rsplit(".", 1)[-1] in SUFFIXES:
        name = name.rsplit(".", 1)[0]
    for modifier in PREPARATIONS:
        if name.lower().endswith(modifier.lower()):
            name = name[: -len(modifier)]
            break
    return name.casefold()


def official_rows(path):
    result = {}
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for fields in csv.reader(handle):
            if len(fields) != 26 or not fields[0]:
                continue
            try:
                row = np.asarray(fields[1:], dtype=float)
            except ValueError:
                continue
            if np.isfinite(row).all():
                result[fields[0].rsplit(":", 1)[-1]] = row
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--panel", required=True, type=Path)
    parser.add_argument("--official", required=True, type=Path)
    parser.add_argument("--base", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    model = G25Model.load(str(args.model))
    panel = Panel(prefix=str(args.panel), verbose=False)
    with np.load(args.base) as base:
        x = base["x"]
        y = base["scaled"]
        groups = base["groups"]
        cols = base["cols"]
        snp_idx = base["snp_idx"]
    if x.shape[1] != model.k or not np.array_equal(snp_idx, np.load(ROOT / "data/blend/chip_marker_indices.npz")["snp_idx"]):
        parser.error("base anchors and model/chip marker set are incompatible")

    by_id = defaultdict(list)
    for i, name in enumerate(panel.ind_id):
        by_id[identity(str(name))].append(i)
    already = set(map(int, cols))
    existing_names = {str(panel.ind_id[i]) for i in already}
    refs = official_rows(args.official)
    annotation = {str(row["id"]): row for row in panel.anno}
    additions = []
    skipped = defaultdict(int)
    for name, target in refs.items():
        # Exact genotype-to-coordinate pairs are already handled by the base file.
        if name in existing_names or any(
            name == str(panel.ind_id[i]).rsplit(".", 1)[0]
            for i in by_id[identity(name)] if i in already
        ):
            continue
        options = by_id[identity(name)]
        if len(options) != 1:
            skipped["missing_or_ambiguous"] += 1
            continue
        i = options[0]
        if i in already:
            skipped["already_anchored"] += 1
            continue
        if not any(modifier.casefold() in name.casefold() for modifier in PREPARATIONS):
            # Do not use a merely similar ID or a low-coverage exact pair.
            skipped["not_a_preparation_alias"] += 1
            continue
        record = annotation.get(str(panel.ind_id[i]))
        if record is None or record["snps_ho"] < 80000 or record["assessment"] not in {"Pass", "PROVISIONAL_PASS", "MERGE_PASS"}:
            skipped["coverage_or_quality"] += 1
            continue
        additions.append((i, target, name))

    # Deduplicate multiple published preparations of a single genotype.
    unique = {}
    duplicate = set()
    for i, target, name in additions:
        if i in unique or i in duplicate:
            skipped["multiple_preparations"] += 1
            unique.pop(i, None)
            duplicate.add(i)
        else:
            unique[i] = (target, name)
    additions = [(i, *entry) for i, entry in sorted(unique.items())]
    print(f"base={len(x)} ancient alias candidates={len(additions)} skipped={dict(skipped)}", flush=True)
    if not additions:
        raise SystemExit("no new ancient anchors")

    new_cols = np.asarray([item[0] for item in additions], dtype=np.int64)
    new_y = np.asarray([item[1] for item in additions])
    mean2p, inv_sd = standardization(model.freq[snp_idx])
    rows = model.panel_snp_rows[snp_idx]
    loadings = model.loadings[snp_idx]
    scores = np.empty((len(new_cols), model.k))
    for start in range(0, len(new_cols), 64):
        stop = min(start + 64, len(new_cols))
        genotype = panel.view(rows, new_cols[start:stop], verbose=False).cache_dense(verbose=False)
        scores[start:stop] = lsq_per_individual(
            loadings, model.sv, standardize(genotype, mean2p, inv_sd), genotype != -1
        )
        print(f"projected {stop}/{len(new_cols)}", flush=True)
    new_x = model.to_unscaled(scores)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.out, x=np.vstack((x, new_x)), scaled=np.vstack((y, new_y)),
        groups=np.concatenate((groups, np.asarray(panel.ind_group[new_cols], dtype=str))),
        cols=np.concatenate((cols, new_cols)), snp_idx=snp_idx,
        source=np.asarray(["exact"] * len(x) + ["preparation_alias"] * len(new_cols)),
        person_id=np.asarray([identity(str(panel.ind_id[i])) for i in np.concatenate((cols, new_cols))]),
    )
    print(f"saved {args.out} with {len(x) + len(new_cols)} anchors", flush=True)


if __name__ == "__main__":
    main()
