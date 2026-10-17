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
MEDIEVAL_OUTPUT = ROOT / "calculator" / "medieval_references.js"


def read_rows(path: Path, category: str) -> list[list]:
    rows = []
    with path.open(encoding="utf-8", newline="") as file:
        for number, row in enumerate(csv.reader(file), 1):
            # Combined exports include a category before the label. Accept
            # matching prefixes even when they occur midway through a file.
            if len(row) == 27 and row[0].strip() == category:
                row = row[1:]
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
    parser.add_argument("--turkish", action="store_true", help="Rebuild only the Turkish modern, ancient and medieval bundles")
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
    turkish_rows += read_rows(ROOT / "data" / "turkish_ancient_g25.txt", "ancient")
    TURKISH_OUTPUT.write_text(
        "window.G25_TURKISH_REFERENCES = " + json.dumps(turkish_rows, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"Bundled {len(turkish_rows)} Turkish modern and ancient references into {TURKISH_OUTPUT}")
    medieval_rows = {
        "early": read_rows(ROOT / "data" / "turkish_early_medieval_g25.txt", "medieval"),
        "late": read_rows(ROOT / "data" / "turkish_late_medieval_g25.txt", "medieval"),
    }
    MEDIEVAL_OUTPUT.write_text(
        "window.G25_MEDIEVAL_REFERENCES = " + json.dumps(medieval_rows, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"Bundled {len(medieval_rows['early'])} early and {len(medieval_rows['late'])} late Turkish medieval references into {MEDIEVAL_OUTPUT}")


if __name__ == "__main__":
    main()
