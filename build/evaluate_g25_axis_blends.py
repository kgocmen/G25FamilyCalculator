"""Compare 25/50/100-axis G25 ensembles on public population holdouts."""

import argparse
import csv
from pathlib import Path

import numpy as np

from g25_mapper_math import distance, neighbor_residual, ridge_map, split_groups


def score(prediction, truth, mask):
    error = distance(prediction, truth)
    modern = error[mask]
    return (error.mean(), np.percentile(error, 95),
            modern.mean(), np.percentile(modern, 95))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for axis in (25, 50, 100):
        parser.add_argument(f"--anchors-{axis}", required=True, type=Path)
    parser.add_argument("--coverage", required=True, type=Path)
    parser.add_argument("--ancient-ref", required=True, type=Path)
    parser.add_argument("--panel-ind", required=True, type=Path)
    parser.add_argument("--seed", type=int, default=25)
    args = parser.parse_args()
    blocks = {axis: np.load(getattr(args, f"anchors_{axis}"))
              for axis in (25, 50, 100)}
    reference = blocks[50]
    for block in blocks.values():
        if not np.array_equal(block["cols"], reference["cols"]):
            parser.error("all axis variants must have the same individual order")
    coverage = np.load(args.coverage)["coverage"]
    groups, people, sources, cols = (reference[key] for key in
                                     ("groups", "person_id", "source", "cols"))
    n_exact = int((sources == "exact").sum())
    train, valid, test = split_groups(groups[:n_exact], 8, args.seed)
    held_groups = set(groups[np.r_[valid, test]])
    held_people = set(people[np.r_[valid, test]])
    chosen = {}
    for i in range(len(coverage)):
        if groups[i] in held_groups or people[i] in held_people:
            continue
        person = people[i]
        rank = (sources[i] == "exact", coverage[i])
        if person not in chosen or rank > chosen[person][0]:
            chosen[person] = (rank, i)
    train = np.asarray(sorted(i for _, i in chosen.values()))
    names = [line.split()[0] for line in args.panel_ind.open()]
    ancient_ids = set()
    with args.ancient_ref.open(newline="", encoding="utf-8-sig") as handle:
        for fields in csv.reader(handle):
            if len(fields) == 26 and fields[0]:
                ancient_ids.add(fields[0].rsplit(":", 1)[-1])
    ancient = np.array([(name := names[i]) in ancient_ids
                        or name.rsplit(".", 1)[0] in ancient_ids
                        for i in cols])
    print(f"seed={args.seed} train={len(train)} valid={len(valid)} test={len(test)}", flush=True)
    predictions = {}
    for axis, block in blocks.items():
        x, y = block["x"], block["scaled"]
        a, c = ridge_map(x[train], y[train], .01)
        baseline = x @ a + c
        residual = y[train] - baseline[train]
        predictions[axis] = {}
        for label, indices in (("valid", valid), ("test", test)):
            predictions[axis][label] = baseline[indices] + neighbor_residual(
                baseline[train], residual, baseline[indices], 40, 4
            )
    ensembles = {"25": (25,), "50": (50,), "100": (100,),
                 "50+100": (50, 100), "25+50+100": (25, 50, 100),
                 "25+100": (25, 100)}
    for label, indices in (("valid", valid), ("test", test)):
        mask = ~ancient[indices] & (coverage[indices] >= .99)
        truth = reference["scaled"][indices]
        print(f"{label} high-coverage modern={mask.sum()}", flush=True)
        for title, axes in ensembles.items():
            prediction = sum(predictions[axis][label] for axis in axes) / len(axes)
            values = score(prediction, truth, mask)
            print(f"  {title:11s} all={values[0]:.3f}/{values[1]:.3f} "
                  f"modern99={values[2]:.3f}/{values[3]:.3f}", flush=True)
        if label == "test":
            old = distance((predictions[50][label] + predictions[100][label]) / 2, truth)
            new = distance(sum(predictions[axis][label] for axis in (25, 50, 100)) / 3, truth)
            print(f"  triple vs 50/100: improved={(new < old).sum()}/{len(old)} "
                  f"worsened by >1={(new > old + 1).sum()} "
                  f"modern99 improved={(new[mask] < old[mask]).sum()}/{mask.sum()}", flush=True)


if __name__ == "__main__":
    main()
