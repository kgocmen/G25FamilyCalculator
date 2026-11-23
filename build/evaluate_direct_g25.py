"""Evaluate a genotype-PCA to official G25 map with population holdouts.

The input NPZ contains paired local PCA coordinates (`x`), official scaled
Global25 coordinates (`scaled`), and population labels (`groups`). A separate
local/official sample pair is evaluated only after validation selects a model.
"""

import argparse
from pathlib import Path

import numpy as np

from train_g25_mapper import distance, ridge_map, row, split_groups


def neighbor_residual(train_x, residual, query_x, neighbors, power):
    """Average nearby residuals in baseline-predicted scaled G25 space."""
    result = []
    for start in range(0, len(query_x), 128):
        query = query_x[start : start + 128]
        d2 = np.maximum(
            np.sum(query * query, axis=1)[:, None]
            + np.sum(train_x * train_x, axis=1)[None, :]
            - 2 * query @ train_x.T,
            0,
        )
        inds = np.argpartition(d2, neighbors - 1, axis=1)[:, :neighbors]
        selected = np.take_along_axis(d2, inds, axis=1)
        weights = (selected + 1e-6) ** (-power / 2)
        weights /= weights.sum(axis=1, keepdims=True)
        result.append(np.einsum("ij,ijk->ik", weights, residual[inds]))
    return np.concatenate(result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--anchors", required=True, type=Path)
    parser.add_argument("--sample", type=Path)
    parser.add_argument("--official", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    if bool(args.sample) != bool(args.official):
        parser.error("--sample and --official must be given together")
    with np.load(args.anchors) as data:
        x = np.asarray(data["x"], float)
        y = np.asarray(data["scaled"], float)
        groups = np.asarray(data["groups"], str)
    if x.ndim != 2 or y.shape != (len(x), 25) or len(groups) != len(x):
        parser.error("anchors require N x D local coordinates, N x 25 official coordinates, and N groups")
    train, validation, test = split_groups(groups, 8, 25)
    a, c = ridge_map(x[train], y[train], .01)
    baseline = x @ a + c
    residual = y[train] - baseline[train]
    val_baseline = distance(baseline[validation], y[validation])
    test_baseline = distance(baseline[test], y[test])
    print(f"anchors={len(x)} groups={len(set(groups))} "
          f"train={len(train)} validation={len(validation)} test={len(test)}", flush=True)
    print(f"ridge baseline: validation mean={val_baseline.mean():.3f} "
          f"test mean={test_baseline.mean():.3f} "
          f"test median={np.median(test_baseline):.3f}", flush=True)

    best = (float("inf"), None, None, None)
    for neighbors in (3, 5, 10, 20, 40, 80, 160):
        if neighbors > len(train):
            continue
        for power in (1, 2, 4):
            correction = neighbor_residual(
                baseline[train], residual, baseline[validation], neighbors, power
            )
            for strength in (.25, .5, .75, 1.0, 1.25):
                prediction = baseline[validation] + strength * correction
                score = distance(prediction, y[validation]).mean()
                if score < best[0]:
                    best = (score, neighbors, power, strength)
    val_score, neighbors, power, strength = best
    test_prediction = baseline[test] + strength * neighbor_residual(
        baseline[train], residual, baseline[test], neighbors, power
    )
    test_error = distance(test_prediction, y[test])
    print(f"selected: neighbors={neighbors} power={power} strength={strength} "
          f"validation mean={val_score:.3f}", flush=True)
    print(f"held-out test: mean={test_error.mean():.3f} "
          f"median={np.median(test_error):.3f} "
          f"p95={np.percentile(test_error, 95):.3f} "
          f"improved={(test_error < test_baseline).sum()}/{len(test)}", flush=True)
    for target in ("Turkish", "Azeri", "Iranian", "Greek"):
        subset = np.array([i for i in range(len(test))
                           if target.lower() in groups[test[i]].lower()])
        if len(subset):
            print(f"{target} held out n={len(subset)} "
                  f"baseline={test_baseline[subset].mean():.3f} "
                  f"corrected={test_error[subset].mean():.3f}", flush=True)
    if args.sample:
        private_x, private_y = row(args.sample, x.shape[1]), row(args.official, 25)
        private_base = private_x @ a + c
        private_corrected = private_base + strength * neighbor_residual(
            baseline[train], residual, private_base[None, :], neighbors, power
        )[0]
        print(f"private: baseline={distance(private_base[None, :], private_y[None, :])[0]:.3f} "
              f"corrected={distance(private_corrected[None, :], private_y[None, :])[0]:.3f}", flush=True)
        print("private prediction:", ",".join(f"{v:.6f}" for v in private_corrected), flush=True)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(args.out, a=a, c=c, train_x=baseline[train],
                            residual=residual, neighbors=neighbors,
                            power=power, strength=strength)
        print(f"saved {args.out}", flush=True)


if __name__ == "__main__":
    main()
