#!/usr/bin/env python3
"""Bundle the exported G25 references for the offline calculator."""

import argparse
import csv
import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "calculator" / "references.js"
TURKISH_OUTPUT = ROOT / "calculator" / "turkish_references.js"


def read_rows(path: Path, category: str) -> list[list]:
    rows = []
    with path.open(encoding="utf-8", newline="") as file:
        for number, row in enumerate(csv.reader(file), 1):
            if len(row) != 26:
                raise ValueError(f"{path}:{number}: expected label and 25 coordinates")
            if not row[0].strip():
                raise ValueError(f"{path}:{number}: missing label")
            values = [float(value) for value in row[1:]]
            if not all(math.isfinite(value) for value in values):
                raise ValueError(f"{path}:{number}: coordinates must be finite")
            rows.append([category, row[0], *values])
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--turkish", action="store_true", help="Rebuild only the Turkish modern bundle")
    args = parser.parse_args()
    if not args.turkish:
        rows = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        rows += read_rows(ROOT / "data" / "ancient_g25.txt", "ancient")
        OUTPUT.write_text(
            "window.G25_REFERENCES = " + json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + ";\n",
            encoding="utf-8",
        )
        print(f"Bundled {len(rows)} references into {OUTPUT}")
    turkish_rows = read_rows(ROOT / "data" / "turkish_modern_g25.txt", "modern")
    TURKISH_OUTPUT.write_text(
        "window.G25_TURKISH_MODERN_REFERENCES = " + json.dumps(turkish_rows, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"Bundled {len(turkish_rows)} Turkish modern references into {TURKISH_OUTPUT}")


if __name__ == "__main__":
    main()
