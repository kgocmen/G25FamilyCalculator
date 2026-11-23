"""Train residual neural networks from paired public profiles to G25.

Input NPZ must contain `x` (K36 fractions or local PCA coordinates), `scaled`
(paired official scaled G25), and `groups` (population labels). Build it from
public reference individuals. A private --sample/--official pair is evaluated
only after model selection; it never enters training or validation.

Example:
  OPENBLAS_NUM_THREADS=1 python3 build/train_g25_mapper.py \
      --anchors /path/to/public_anchors.npz --runs 10 --epochs 10000 \
      --out /path/to/experimental_mapper.npz
"""

import argparse
import csv
import json
from pathlib import Path
import time

import numpy as np


def row(path, dimensions):
    with path.open(newline="", encoding="utf-8-sig") as handle:
        fields = next(csv.reader(handle))
    if len(fields) != dimensions + 1:
        raise ValueError(f"{path}: expected a label and {dimensions} coordinates")
    values = np.array(fields[1:], dtype=float)
    if not np.isfinite(values).all():
        raise ValueError(f"{path}: coordinates must be finite")
    return values


def split_groups(groups, folds, seed):
    unique, counts = np.unique(groups, return_counts=True)
    order = np.random.default_rng(seed).permutation(len(unique))
    buckets, sizes = [set() for _ in range(folds)], [0] * folds
    for i in sorted(order, key=lambda j: counts[j], reverse=True):
        fold = min(range(folds), key=lambda j: sizes[j])
        buckets[fold].add(unique[i])
        sizes[fold] += int(counts[i])
    test = np.isin(groups, list(buckets[0]))
    valid = np.isin(groups, list(buckets[1]))
    return np.flatnonzero(~(test | valid)), np.flatnonzero(valid), np.flatnonzero(test)


def ridge_map(x, y, penalty):
    xm, ym = x.mean(axis=0), y.mean(axis=0)
    xc = x - xm
    gram = xc.T @ xc
    ridge = penalty * np.trace(gram) / x.shape[1]
    weights = np.linalg.solve(gram + ridge * np.eye(x.shape[1]), xc.T @ (y - ym))
    return weights, ym - xm @ weights


def initialize(rng, width, depth, input_dimensions):
    dims = [input_dimensions] + [width] * depth + [25]
    params = []
    for before, after in zip(dims[:-1], dims[1:]):
        params += [rng.normal(0, np.sqrt(2 / (before + after)), (before, after)),
                   np.zeros(after)]
    return params


def forward(x, params):
    activations = [x]
    for layer in range(len(params) // 2 - 1):
        activations.append(np.tanh(activations[-1] @ params[2 * layer] + params[2 * layer + 1]))
    return activations[-1] @ params[-2] + params[-1], activations


def gradients(x, target, params, weight_decay):
    output, activations = forward(x, params)
    delta = 2 * (output - target) / len(x)
    result = [None] * len(params)
    for layer in range(len(params) // 2 - 1, -1, -1):
        weight = params[2 * layer]
        result[2 * layer] = activations[layer].T @ delta + weight_decay * weight
        result[2 * layer + 1] = delta.sum(axis=0)
        if layer:
            delta = (delta @ weight.T) * (1 - activations[layer] ** 2)
    return result


def distance(predicted, actual):
    return 100 * np.linalg.norm(predicted - actual, axis=1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--anchors", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--sample", type=Path, help="optional private local PCA row")
    parser.add_argument("--official", type=Path, help="matching private scaled G25 row")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--start-run", type=int, default=1,
                        help="one-based trial number to start with when resuming")
    parser.add_argument("--resume", type=Path,
                        help="checkpoint to retain as the incumbent best model")
    parser.add_argument("--hours", type=float, default=0,
                        help="stop after this many hours; use a large --runs cap")
    parser.add_argument("--search", action="store_true",
                        help="search depth, width, learning rate, and weight decay")
    parser.add_argument("--epochs", type=int, default=5000)
    parser.add_argument("--patience", type=int, default=300)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--width", type=int, default=64)
    parser.add_argument("--depth", type=int, default=2)
    parser.add_argument("--learning-rate", type=float, default=.001)
    parser.add_argument("--weight-decay", type=float, default=.001)
    parser.add_argument("--ridge", type=float, default=.01)
    parser.add_argument("--baseline-regression", type=Path,
                        help="optional published K36-to-G25 regression JSON")
    parser.add_argument("--folds", type=int, default=8)
    parser.add_argument("--seed", type=int, default=25)
    args = parser.parse_args()
    if bool(args.sample) != bool(args.official):
        parser.error("--sample and --official must be provided together")
    if args.runs < 1 or args.start_run < 1 or args.epochs < 1 or args.patience < 1 or args.batch < 1 or args.width < 2 or args.depth < 1 or args.folds < 3 or args.hours < 0:
        parser.error("runs, epochs, patience, batch, depth and folds must be positive; width >= 2, hours >= 0")
    if args.learning_rate <= 0 or args.weight_decay < 0 or args.ridge < 0:
        parser.error("learning rate must be positive; penalties cannot be negative")

    with np.load(args.anchors) as data:
        x = np.asarray(data["x"], dtype=float)
        y = np.asarray(data["scaled"], dtype=float)
        groups = np.asarray(data["groups"], dtype=str)
    if x.ndim != 2 or y.shape != (len(x), 25) or len(groups) != len(x):
        raise ValueError("anchors need N×D x, N×25 scaled, and N groups")
    if len(x) < 100 or not np.isfinite(x).all() or not np.isfinite(y).all():
        raise ValueError("anchors are too few or contain non-finite values")
    train, valid, test = split_groups(groups, args.folds, args.seed)
    if min(len(train), len(valid), len(test)) < 20:
        raise ValueError("population split has too few samples")
    mean = x[train].mean(axis=0)
    scale = np.maximum(x[train].std(axis=0), 1e-8)
    z = (x - mean) / scale
    if args.baseline_regression:
        regression = json.loads(args.baseline_regression.read_text())
        if x.shape[1] != 36 or regression.get("input") != "percentages" or regression.get("output") != "scaled":
            raise ValueError("baseline regression must be a scaled K36 percentage model")
        base_a = 100 * np.asarray(regression["coefficients"], dtype=float)
        base_c = np.asarray(regression["intercept"], dtype=float)
        if base_a.shape != (36, 25) or base_c.shape != (25,):
            raise ValueError("baseline regression has incompatible dimensions")
    else:
        base_a, base_c = ridge_map(x[train], y[train], args.ridge)
    base = x @ base_a + base_c
    target = (y - base) * 100
    base_valid = distance(base[valid], y[valid]).mean()
    base_test = distance(base[test], y[test]).mean()
    print(f"anchors={len(x)} populations={len(set(groups))} "
          f"train={len(train)} valid={len(valid)} test={len(test)}", flush=True)
    baseline_name = "published" if args.baseline_regression else "ridge"
    print(f"{baseline_name} baseline: validation={base_valid:.3f} test={base_test:.3f}", flush=True)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    deadline = started + args.hours * 3600 if args.hours else float("inf")
    best = None
    if args.resume:
        with np.load(args.resume) as saved_model:
            for key, expected in (("mean", mean), ("scale", scale),
                                  ("base_a", base_a), ("base_c", base_c)):
                if not np.allclose(saved_model[key], expected, rtol=1e-10, atol=1e-12):
                    raise ValueError(f"resume checkpoint uses different {key}")
            previous_run = int(saved_model["run"])
            if args.start_run <= previous_run:
                raise ValueError("--start-run must exceed the checkpoint's best run")
            depth = int(saved_model["depth"])
            previous = [saved_model[f"param{i}"].copy()
                        for i in range(2 * (depth + 1))]
            best = (float(saved_model["validation"]), previous_run - 1,
                    int(saved_model["epoch"]), previous)
        print(f"resumed best run={previous_run} validation={best[0]:.3f}; "
              f"next trial={args.start_run}", flush=True)
    try:
        for run in range(args.start_run - 1, args.start_run - 1 + args.runs):
            if run >= args.start_run and time.monotonic() >= deadline:
                break
            rng = np.random.default_rng(args.seed + 1000 + run)
            if args.search:
                width = int(rng.choice([64, 96, 128, 192, 256]))
                depth = int(rng.choice([2, 3, 4, 5]))
                learning_rate = float(10 ** rng.uniform(-3.5, -2.4))
                weight_decay = float(10 ** rng.uniform(-5, -2))
            else:
                width, depth = args.width, args.depth
                learning_rate, weight_decay = args.learning_rate, args.weight_decay
            params = initialize(rng, width, depth, x.shape[1])
            moments = [np.zeros_like(p) for p in params]
            variances = [np.zeros_like(p) for p in params]
            step = stale = 0
            run_best = (float("inf"), 0, None)
            for epoch in range(1, args.epochs + 1):
                for batch in np.array_split(rng.permutation(train), max(1, int(np.ceil(len(train) / args.batch)))):
                    grads = gradients(z[batch], target[batch], params, weight_decay)
                    step += 1
                    for i, grad in enumerate(grads):
                        moments[i] = .9 * moments[i] + .1 * grad
                        variances[i] = .999 * variances[i] + .001 * grad * grad
                        params[i] -= learning_rate * (moments[i] / (1 - .9 ** step)) / (
                            np.sqrt(variances[i] / (1 - .999 ** step)) + 1e-8)
                corrected = base[valid] + forward(z[valid], params)[0] / 100
                score = distance(corrected, y[valid]).mean()
                if score < run_best[0] - 1e-4:
                    run_best = (score, epoch, [p.copy() for p in params])
                    stale = 0
                else:
                    stale += 1
                if stale >= args.patience or time.monotonic() >= deadline:
                    break
            score, epoch, saved = run_best
            print(f"run={run + 1} width={width} depth={depth} "
                  f"lr={learning_rate:.6g} decay={weight_decay:.6g} "
                  f"best_epoch={epoch} validation={score:.3f} "
                  f"elapsed_hours={(time.monotonic() - started) / 3600:.3f}", flush=True)
            if best is None or score < best[0]:
                best = (score, run, epoch, saved)
                temporary = args.out.with_name(args.out.name + ".tmp")
                with temporary.open("wb") as handle:
                    np.savez_compressed(handle, mean=mean, scale=scale, base_a=base_a,
                                        base_c=base_c, validation=score, run=run + 1,
                                        epoch=epoch, width=width, depth=depth,
                                        **{f"param{i}": p for i, p in enumerate(saved)})
                temporary.replace(args.out)
    except KeyboardInterrupt:
        print("Interrupted; evaluating the best saved checkpoint.", flush=True)

    if best is None:
        raise RuntimeError("No completed training run")
    _, run, epoch, params = best
    predicted_test = base[test] + forward(z[test], params)[0] / 100
    errors = distance(predicted_test, y[test])
    print(f"selected run={run + 1} epoch={epoch} "
          f"held-out test mean={errors.mean():.3f} median={np.median(errors):.3f} "
          f"p95={np.percentile(errors, 95):.3f}", flush=True)
    if args.sample:
        private_x, private_y = row(args.sample, x.shape[1]), row(args.official, 25)
        private_base = private_x @ base_a + base_c
        private_pred = private_base + forward(((private_x - mean) / scale)[None, :], params)[0][0] / 100
        print(f"private benchmark: baseline={100 * np.linalg.norm(private_base - private_y):.3f} "
              f"network={100 * np.linalg.norm(private_pred - private_y):.3f}", flush=True)

    print(f"saved {args.out}", flush=True)


if __name__ == "__main__":
    main()
