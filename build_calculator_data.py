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
MODERN_PCA_OUTPUT = ROOT / "calculator" / "modern_pca_references.js"
MODERN_PCA_DIRECTORY = ROOT / "data" / "pca"
MODERN_PCA_MIXED_SOURCE = MODERN_PCA_DIRECTORY / "turkish_modern_pca_mixed_g25.txt"
MODERN_PCA_MIXED_OUTPUT = ROOT / "calculator" / "mixed_pca_references.js"


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


def read_modern_pcas(modern_rows: list[list], directory: Path = MODERN_PCA_DIRECTORY) -> list[dict]:
    config = json.loads((directory / "turkish_pca_config.txt").read_text(encoding="utf-8"))
    if not isinstance(config, dict) or not isinstance(config.get("modern"), list):
        raise ValueError("PCA config must contain a modern list")
    modern_by_coordinates = {tuple(row[2:]): row[1] for row in modern_rows}
    result = []
    ids = set()
    for entry in config["modern"]:
        if not isinstance(entry, dict) or not all(isinstance(entry.get(key), str) and entry[key]
                                                   for key in ("id", "title", "file")):
            raise ValueError("Each modern PCA needs an id, title and file")
        if entry["id"] in ids:
            raise ValueError(f"Duplicate modern PCA id: {entry['id']}")
        ids.add(entry["id"])
        filename = entry["file"]
        if Path(filename).name != filename or not filename.endswith("_g25.txt"):
            raise ValueError(f"Invalid PCA filename: {filename}")
        rows = read_rows(directory / filename, "modern")
        if len(rows) < 3:
            raise ValueError(f"{filename}: PCA needs at least three references")
        anchors = []
        for row in rows:
            label = modern_by_coordinates.get(tuple(row[2:]))
            if label is None:
                raise ValueError(f"{filename}: {row[1]} is not in the Turkish modern dataset")
            anchors.append(label)
        result.append({"id": entry["id"], "title": entry["title"],
                       "references": rows, "referenceAnchors": anchors,
                       "anchorLabels": list(dict.fromkeys(anchors))})
    return result


def rebuild_mixed_pca(pcas: list[dict], output: Path = MODERN_PCA_MIXED_SOURCE) -> int:
    lines = []
    for pca in pcas:
        if pca["id"] == "istanbul":
            continue
        groups = {}
        for row in pca["references"]:
            name = row[1].split(":", 1)[0] if ":" in row[1] else row[1].split("_", 1)[0]
            groups.setdefault(name, []).append(row)
        for name, rows in groups.items():
            values = []
            for index in range(2, 27):
                total = 0.0
                for row in rows:
                    total += row[index]
                values.append(total / len(rows))
            label = f"{pca['title'].replace(' ', '_')}:{name}"
            lines.append(",".join([label, *map(str, values)]))
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return len(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--turkish", action="store_true", help="Rebuild only the Turkish modern, ancient, medieval and PCA bundles")
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
    modern_pcas = read_modern_pcas([row for row in turkish_rows if row[0] == "modern"])
    MODERN_PCA_OUTPUT.write_text(
        "window.G25_MODERN_PCAS = "
        + json.dumps(modern_pcas, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"Bundled {len(modern_pcas)} Turkish modern PCA into {MODERN_PCA_OUTPUT}")
    rebuild_mixed_pca(modern_pcas)
    mixed_rows = read_rows(MODERN_PCA_MIXED_SOURCE, "modern")
    if len(mixed_rows) < 3:
        raise ValueError("Mixed PCA needs at least three references")
    MODERN_PCA_MIXED_OUTPUT.write_text(
        "window.G25_MODERN_MIXED_PCA = "
        + json.dumps({"id": "mixed", "title": "Mixed PCA", "references": mixed_rows,
                      "referenceAnchors": []}, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"Bundled {len(mixed_rows)} mixed PCA references into {MODERN_PCA_MIXED_OUTPUT}")
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
