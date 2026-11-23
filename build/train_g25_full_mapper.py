"""Fit a production neighbor mapper from validated local G25 anchors.

Run only after population-held-out evaluation. The output is an ignored local
model file; the browser asset is built separately by export_g25_blend.py.
"""

import argparse
import csv
from pathlib import Path

import numpy as np

from train_g25_mapper import ridge_map


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--anchors", required=True, type=Path)
    parser.add_argument("--template", required=True, type=Path)
    parser.add_argument("--panel-anno", required=True, type=Path)
    parser.add_argument("--panel-ind", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    with np.load(args.anchors) as anchors:
        x = anchors["x"]
        y = anchors["scaled"]
        ids = anchors["person_id"]
        cols = anchors["cols"]
        source = anchors["source"]
    if x.ndim != 2 or y.shape != (len(x), 25) or len(ids) != len(x):
        parser.error("anchors require N x D local and N x 25 official coordinates")
    panel_ids = [line.split()[0] for line in args.panel_ind.open()]
    with args.panel_anno.open(newline="", encoding="utf-8") as handle:
        coverage = {}
        for fields in csv.reader(handle, delimiter="\t"):
            if len(fields) <= 27:
                continue
            try:
                coverage[fields[0]] = float(fields[27])
            except ValueError:
                continue
    best = {}
    for index, person in enumerate(ids):
        name = panel_ids[int(cols[index])]
        rank = (source[index] == "exact", coverage.get(name, 0))
        if person not in best or rank > best[person][0]:
            best[person] = (rank, index)
    selected = np.asarray(sorted(index for _, index in best.values()))
    x, y = x[selected], y[selected]
    with np.load(args.template) as template:
        neighbors = int(template["neighbors"])
        power = float(template["power"])
        strength = float(template["strength"])
    a, c = ridge_map(x, y, .01)
    baseline = x @ a + c
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.out, a=a, c=c, train_x=baseline,
                        residual=y - baseline, neighbors=neighbors,
                        power=power, strength=strength)
    print(f"saved {args.out}: {len(x)} individuals, {x.shape[1]} axes")


if __name__ == "__main__":
    main()
