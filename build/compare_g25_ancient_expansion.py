"""Compare expanded ancient anchors with an exact-match-only 50/100 blend.

Uses the same population holdout for both models, excludes duplicate people
from training, and reports errors separately by era. The published mapper is
used only for its neighbor hyperparameters. This does not replace the browser
model.
"""

import argparse
import csv
from pathlib import Path

import numpy as np

from evaluate_direct_g25 import neighbor_residual
from train_g25_mapper import distance, ridge_map, split_groups


def predict(mapper, x):
    baseline = x @ mapper["a"] + mapper["c"]
    return baseline + float(mapper["strength"]) * neighbor_residual(
        mapper["train_x"], mapper["residual"], baseline,
        int(mapper["neighbors"]), float(mapper["power"]),
    )


def summarize(name, prediction, truth, ancient):
    errors = distance(prediction, truth)
    print(f"{name:18s} n={len(errors):4d} mean={errors.mean():.3f} "
          f"median={np.median(errors):.3f} p95={np.percentile(errors, 95):.3f}")
    for label, mask in (("ancient", ancient), ("modern", ~ancient)):
        values = errors[mask]
        if len(values):
            print(f"  {label:16s} n={len(values):4d} mean={values.mean():.3f} "
                  f"p95={np.percentile(values, 95):.3f}")
    return errors


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--expanded-50", required=True, type=Path)
    ap.add_argument("--expanded-100", required=True, type=Path)
    ap.add_argument("--mapper-50", default="data/blend/direct_chip_all50_clean_neighbor.npz", type=Path)
    ap.add_argument("--mapper-100", default="data/blend/direct_chip_all100_clean_neighbor.npz", type=Path)
    ap.add_argument("--ancient-ref", required=True, type=Path)
    ap.add_argument("--panel-ind", required=True, type=Path)
    ap.add_argument("--panel-anno", required=True, type=Path)
    ap.add_argument("--out-50", type=Path)
    ap.add_argument("--out-100", type=Path)
    ap.add_argument("--seed", type=int, default=25)
    args = ap.parse_args()
    data = [np.load(args.expanded_50), np.load(args.expanded_100)]
    mappers = [np.load(args.mapper_50), np.load(args.mapper_100)]
    exact = np.flatnonzero(data[0]["source"] == "exact")
    aliases = np.flatnonzero(data[0]["source"] == "preparation_alias")
    if not np.array_equal(data[0]["cols"], data[1]["cols"]):
        ap.error("50 and 100-axis anchors must have identical individual order")
    train, valid, test = split_groups(data[0]["groups"][exact], 8, args.seed)
    holdout_groups = set(data[0]["groups"][exact[np.r_[valid, test]]])
    holdout_people = set(data[0]["person_id"][exact[np.r_[valid, test]]])
    safe_aliases = np.asarray([
        i for i in aliases if data[0]["groups"][i] not in holdout_groups
        and data[0]["person_id"][i] not in holdout_people
    ], dtype=int)
    safe_exact = np.asarray([
        i for i in exact[train] if data[0]["person_id"][i] not in holdout_people
    ], dtype=int)
    names = [line.split()[0] for line in args.panel_ind.open()]
    with args.panel_anno.open(newline="", encoding="utf-8") as handle:
        coverage = {}
        for fields in csv.reader(handle, delimiter="\t"):
            if len(fields) <= 27:
                continue
            try:
                coverage[fields[0]] = float(fields[27])
            except ValueError:
                continue

    def dedupe(indices):
        chosen = {}
        for i in indices:
            person = data[0]["person_id"][i]
            rank = (data[0]["source"][i] == "exact",
                    coverage.get(names[int(data[0]["cols"][i])], 0))
            if person not in chosen or rank > chosen[person][0]:
                chosen[person] = (rank, i)
        return np.asarray(sorted(i for _, i in chosen.values()))

    baseline_training = dedupe(safe_exact)
    training = dedupe(np.r_[safe_exact, safe_aliases])
    print(f"exact={len(exact)} aliases={len(aliases)} safe_training_aliases={len(safe_aliases)} "
          f"unique_exact_train={len(baseline_training)} "
          f"unique_expanded_train={len(training)} validation={len(valid)} test={len(test)}")
    official = set()
    with args.ancient_ref.open(newline="", encoding="utf-8-sig") as handle:
        for fields in csv.reader(handle):
            if len(fields) == 26 and fields[0]:
                official.add(fields[0].rsplit(":", 1)[-1])
    ancient = np.asarray([
        (name := names[i]) in official or name.rsplit(".", 1)[0] in official
        for i in data[0]["cols"][exact[test]]
    ])

    old, new = [], []
    for axis, block, mapper, destination in zip(
        (50, 100), data, mappers, (args.out_50, args.out_100)
    ):
        x, y = block["x"], block["scaled"]
        for indices, output in ((baseline_training, old), (training, new)):
            a, c = ridge_map(x[indices], y[indices], .01)
            baseline = x @ a + c
            residual = y[indices] - baseline[indices]
            candidate = {
                "a": a, "c": c, "train_x": baseline[indices],
                "residual": residual, "neighbors": mapper["neighbors"],
                "power": mapper["power"], "strength": mapper["strength"],
            }
            output.append(predict(candidate, x[exact[test]]))
            if indices is training and destination:
                np.savez_compressed(destination, **candidate)
                print(f"saved candidate {destination}")
        print(f"\n{axis}-axis:")
        summarize("exact-only", old[-1], y[exact[test]], ancient)
        summarize("expanded", new[-1], y[exact[test]], ancient)

    y = data[0]["scaled"][exact[test]]
    print("\n50/100 blend:")
    old_err = summarize("exact-only", (old[0] + old[1]) / 2, y, ancient)
    new_err = summarize("expanded", (new[0] + new[1]) / 2, y, ancient)
    print(f"improved={sum(new_err < old_err)}/{len(test)}; "
          f"large regressions (>1 distance unit)={sum(new_err > old_err + 1)}")


if __name__ == "__main__":
    main()
