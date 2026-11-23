"""Compare experimental K36-to-G25 mappings with held-out official coordinates.

The two public CSVs are described in calculator/raw_data/README.md. Keep private
raw DNA and coordinate files outside Git; this script reads them without saving
copies or printing genotype calls.

Example:
    python3 build/benchmark_g25.py --k36 /tmp/training-k36.csv \
        --g25 /tmp/training-g25.csv --raw /path/to/raw.csv \
        --official /path/to/scaled.txt
"""

import argparse
import csv
import json
from pathlib import Path
import re
import subprocess

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "calculator" / "raw_data" / "k36_g25_vbknethio.json"


def read_table(path, expected_columns):
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.reader(handle)
        header = next(reader)
        if len(header) != expected_columns + 1:
            raise ValueError(f"{path}: expected {expected_columns} numeric columns")
        rows = {}
        for row in reader:
            if len(row) != len(header) or row[0] in rows:
                raise ValueError(f"{path}: malformed or duplicate row")
            values = np.array(row[1:], dtype=float)
            if not np.isfinite(values).all():
                raise ValueError(f"{path}: non-finite value")
            rows[row[0]] = values
    return header[1:], rows


def raw_k36(path):
    # Use the browser's actual parser, SNP matching, and K36 fitter.
    script = """
const fs = require('fs'), zlib = require('zlib');
const raw = require('./calculator/raw_dna.js');
const parsed = raw.parse(fs.readFileSync(process.argv[1], 'utf8'));
const packed = zlib.gunzipSync(fs.readFileSync('calculator/raw_data/k36.bin.gz'));
const buffer = packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength);
const matched = raw.match(parsed.calls, raw.decodeModel(buffer));
const fit = raw.fit(matched);
if (!fit.converged) throw new Error('K36 fit did not converge');
console.log(JSON.stringify({proportions: fit.proportions, snps: matched.stats.matched}));
"""
    result = subprocess.run(["node", "-e", script, str(path.resolve())], cwd=ROOT,
                            capture_output=True, text=True, check=True)
    parsed = json.loads(result.stdout)
    return np.array(parsed["proportions"]), parsed["snps"]


def official_row(path):
    with path.open(newline="", encoding="utf-8-sig") as handle:
        row = next(csv.reader(handle))
    if len(row) != 26:
        raise ValueError(f"{path}: expected a label and 25 scaled coordinates")
    values = np.array(row[1:], dtype=float)
    if not np.isfinite(values).all():
        raise ValueError(f"{path}: non-finite coordinate")
    return values


def gedmatch_k36(path, components):
    lookup = {re.sub(r"[^a-z0-9]", "", name.lower()): i
              for i, name in enumerate(components)}
    values = np.zeros(36)
    seen = set()
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.reader(handle):
            if len(row) != 2:
                raise ValueError(f"{path}: expected component,percentage rows")
            key = re.sub(r"[^a-z0-9]", "", row[0].lower())
            if key == "component" and row[1].lower() == "percentage":
                continue
            if key not in lookup or key in seen:
                raise ValueError(f"{path}: unknown or duplicate K36 component")
            seen.add(key)
            values[lookup[key]] = float(row[1].rstrip("%")) / 100
    if not np.isfinite(values).all() or (values < 0).any() or abs(values.sum() - 1) > .005:
        raise ValueError(f"{path}: K36 percentages must sum to about 100")
    return values / values.sum()


def group_folds(groups, count=5):
    names = sorted(set(groups))
    np.random.default_rng(25).shuffle(names)
    sizes = {group: groups.count(group) for group in names}
    buckets, totals = [set() for _ in range(count)], [0] * count
    for group in sorted(names, key=lambda item: sizes[item], reverse=True):
        bucket = min(range(count), key=lambda index: totals[index])
        buckets[bucket].add(group)
        totals[bucket] += sizes[group]
    return [(np.array([i for i, group in enumerate(groups) if group not in bucket]),
             np.array([i for i, group in enumerate(groups) if group in bucket]))
            for bucket in buckets]


def neighbors(query, references, count=40):
    distances = np.sum((query[:, None, :] - references[None, :, :]) ** 2, axis=2)
    count = min(count, len(references))
    nearest = np.argpartition(distances, count - 1, axis=1)[:, :count]
    order = np.argsort(np.take_along_axis(distances, nearest, axis=1), axis=1)
    nearest = np.take_along_axis(nearest, order, axis=1)
    return nearest, np.take_along_axis(distances, nearest, axis=1)


def correction(residuals, nearest, distances, count, strength):
    selected = nearest[:, :count]
    weights = 1 / np.maximum(distances[:, :count], 1e-8)
    weights /= weights.sum(axis=1, keepdims=True)
    return strength * np.sum(residuals[selected] * weights[:, :, None], axis=1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--k36", required=True, type=Path, help="Public paired K36 CSV")
    parser.add_argument("--g25", required=True, type=Path, help="Public paired scaled G25 CSV")
    parser.add_argument("--raw", type=Path, help="Optional private raw DNA file")
    parser.add_argument("--official", type=Path, help="Matching private official scaled G25 row")
    parser.add_argument("--gedmatch-k36", type=Path,
                        help="Optional GEDmatch K36 component,percentage CSV for the same person")
    args = parser.parse_args()
    if bool(args.raw) != bool(args.official):
        parser.error("--raw and --official must be provided together")
    if args.gedmatch_k36 and not args.raw:
        parser.error("--gedmatch-k36 also needs --raw and --official")

    model = json.loads(MODEL.read_text())
    k36_columns, k36_rows = read_table(args.k36, 36)
    g25_columns, g25_rows = read_table(args.g25, 25)
    if k36_columns != model["components"] or g25_columns != [f"PC{i}" for i in range(1, 26)]:
        raise ValueError("The public CSV component order does not match the model")
    names = sorted(k36_rows.keys() & g25_rows.keys())
    if len(names) < 100:
        raise ValueError("Too few paired public samples for held-out testing")
    x = np.array([k36_rows[name] / k36_rows[name].sum() for name in names])
    y = np.array([g25_rows[name] for name in names])
    groups = [name.split(":")[0] for name in names]
    folds = group_folds(groups)
    coefficients = np.array(model["coefficients"])
    intercept = np.array(model["intercept"])
    predict = lambda values: intercept + 100 * values @ coefficients
    public_prediction = predict(x)
    private_x = private_y = None
    if args.raw:
        private_x, matched = raw_k36(args.raw)
        private_y = official_row(args.official)
        print(f"Private benchmark: {matched:,} K36 SNPs matched")
        if args.gedmatch_k36:
            gedmatch = gedmatch_k36(args.gedmatch_k36, model["components"])
            print(f"GEDmatch K36 vs app K36: "
                  f"{100 * np.abs(gedmatch - private_x).sum():.3f} percentage points L1")
    print(f"Public benchmark: {len(names):,} people, {len(set(groups))} populations; "
          "five folds with entire populations held out")

    def summarize(title, predictions, private_prediction=None):
        errors = 100 * np.linalg.norm(predictions - y, axis=1)
        turkish = np.array([group == "Turkish_Balikesir" for group in groups])
        fields = [f"median={np.median(errors):.3f}", f"mean={np.mean(errors):.3f}",
                  f"p95={np.percentile(errors, 95):.3f}"]
        if turkish.any():
            fields.append(f"Turkish_Balikesir_mean={np.mean(errors[turkish]):.3f}")
        if private_prediction is not None:
            fields.append(f"private={100 * np.linalg.norm(private_prediction - private_y):.3f}")
        print(f"{title}: " + ", ".join(fields))

    summarize("published", public_prediction, predict(private_x) if args.raw else None)
    if args.gedmatch_k36:
        print(f"published with GEDmatch K36: private="
              f"{100 * np.linalg.norm(predict(gedmatch) - private_y):.3f}")
    ols_predictions = np.zeros_like(y)
    for train, test in folds:
        weights = np.linalg.lstsq(x[train], y[train], rcond=None)[0]
        ols_predictions[test] = x[test] @ weights
    private_ols = private_x @ np.linalg.lstsq(x, y, rcond=None)[0] if args.raw else None
    summarize("linear OLS", ols_predictions, private_ols)

    for metric in ("K36", "predicted G25"):
        features = x if metric == "K36" else public_prediction
        fold_data = []
        for train, test in folds:
            nearest, distances = neighbors(features[test], features[train])
            fold_data.append((train, test, nearest, distances))
        private_neighbors = None
        if args.raw:
            query = private_x if metric == "K36" else predict(private_x)
            private_neighbors = neighbors(query[None, :], features)
        for count, strength in ((5, .5), (5, 1), (15, 1), (40, 1)):
            predictions = np.zeros_like(y)
            for train, test, nearest, distances in fold_data:
                residual = y[train] - public_prediction[train]
                predictions[test] = public_prediction[test] + correction(
                    residual, nearest, distances, count, strength)
            private_prediction = None
            if args.raw:
                nearest, distances = private_neighbors
                private_prediction = predict(private_x) + correction(
                    y - public_prediction, nearest, distances, count, strength)[0]
            summarize(f"{metric} neighbors k={count}, strength={strength}",
                      predictions, private_prediction)


if __name__ == "__main__":
    main()
