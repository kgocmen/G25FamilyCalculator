#!/usr/bin/env python3
"""List global modern populations absent from every active deep PCA."""

import csv
import json
from pathlib import Path
from build.build_calculator_data import read_rows


ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
PCA = DATA / "pca"


def names(path: Path):
    with path.open(encoding="utf-8", newline="") as source:
        for line_number, row in enumerate(csv.reader(source), 1):
            if not row or not row[0].strip():
                continue
            yield line_number, row[0].strip()


def main():
    config = json.loads((PCA / "pca_config.txt").read_text(encoding="utf-8"))
    modern = {name for _, name in names(DATA / "modern_g25.txt")}
    covered = set()
    for entry in config["modern"]:
        path = PCA / entry["file"]
        for row in read_rows(path, "modern", section="deep"):
            label = row[1]
            group, separator, population = label.partition(":")
            if not separator or not group.strip() or not population.strip():
                raise ValueError(f"{path}: expected Group: Population")
            if group.strip() != "Deprecated":
                covered.add(population.strip())

    missing = sorted(modern - covered, key=str.casefold)
    print(f"Modern populations: {len(modern)}")
    print(f"Covered by active deep PCAs: {len(modern & covered)}")
    print(f"Missing from every deep PCA: {len(missing)}")
    for population in missing:
        print(population)


if __name__ == "__main__":
    main()
