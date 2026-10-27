#!/usr/bin/env python3
"""Bundle the exported G25 references for the offline calculator."""

import argparse
import csv
import json
import math
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "calculator" / "references.js"
TURKISH_OUTPUT = ROOT / "calculator" / "turkish_references.js"
MEDIEVAL_OUTPUT = ROOT / "calculator" / "turkish_medieval_references.js"
MODERN_PCA_OUTPUT = ROOT / "calculator" / "turkish_modern_pca_references.js"
GLOBAL_MODERN_PCA_OUTPUT = ROOT / "calculator" / "modern_pca_references.js"
MODERN_PCA_DIRECTORY = ROOT / "data" / "pca"
MODERN_PCA_MIXED_SOURCE = MODERN_PCA_DIRECTORY / "turkish_modern_pca_mixed.g25.txt"
MODERN_PCA_MIXED_OUTPUT = ROOT / "calculator" / "turkish_mixed_pca_references.js"
GLOBAL_MODERN_PCA_MIXED_SOURCE = MODERN_PCA_DIRECTORY / "modern_pca_mixed.g25.txt"
GLOBAL_MODERN_PCA_MIXED_OUTPUT = ROOT / "calculator" / "mixed_pca_references.js"
ydnatr_DIRECTORY = ROOT / "data" / "ydnatr"
K12B_OUTPUT = ROOT / "calculator" / "k12b_data.js"
HEALTH_OUTPUT = ROOT / "calculator" / "health_data.js"
NEOLITHIC_OUTPUT = ROOT / "calculator" / "neolithic_references.js"
GLOBAL_ANCIENT_MIN_ROWS = 4365
GLOBAL_ANCIENT_TAIL_LABEL = "Zambia_LSA_(low_res)_(n=1)"
K12B_COMPONENTS = ["Gedrosia", "Siberian", "Northwest_African", "Southeast_Asian",
                   "Atlantic_Med", "North_European", "South_Asian", "East_African",
                   "Southwest_Asian", "East_Asian", "Caucasus", "Sub_Saharan"]
K12B_SETS = ("yakinlik1", "yakinlik2tr", "ikili1", "ikili2tr")


def read_ydnatr_data(directory: Path = ydnatr_DIRECTORY) -> tuple[dict, dict]:
    """Read the editable K12b and Health source tables before bundling."""
    k12b = {"source": "https://www.ydnatr.com/p/qwewqfxgzdhdsaf.html",
            "components": K12B_COMPONENTS,
            "sets": {name: {"modern": [], "ancient": []} for name in K12B_SETS}}
    ancient_samples = []
    for period in ("modern", "ancient"):
        path = directory / f"k12b_{period}.txt"
        with path.open(encoding="utf-8", newline="") as file:
            reader = csv.DictReader(file)
            if reader.fieldnames != ["set", "kind", "label", *K12B_COMPONENTS]:
                raise ValueError(f"{path}: expected set, kind, label and K12b component columns")
            for number, entry in enumerate(reader, 2):
                name, kind, label = entry["set"], entry["kind"], entry["label"]
                if (name not in K12B_SETS or not label or
                        kind not in ({"modern"} if period == "modern" else {"average", "sample"}) or
                        (kind == "sample" and name != "yakinlik2tr") or
                        (period == "ancient" and name == "ikili2tr")):
                    raise ValueError(f"{path}:{number}: invalid set, kind or label")
                try:
                    values = [float(entry[component]) for component in K12B_COMPONENTS]
                except (TypeError, ValueError) as error:
                    raise ValueError(f"{path}:{number}: invalid percentages") from error
                if not all(math.isfinite(value) and value >= 0 for value in values):
                    raise ValueError(f"{path}:{number}: percentages must be finite and nonnegative")
                row = [label, *values]
                k12b["sets"][name][period].append(row)
                if kind == "sample":
                    ancient_samples.append(row)
    for name in ("yakinlik1", "ikili1"):
        k12b["sets"][name]["ancient"].extend(ancient_samples)
    if not ancient_samples or any(not values["modern"] for values in k12b["sets"].values()):
        raise ValueError("K12b Oracle is missing modern or ancient samples")

    health = json.loads((directory / "health.json").read_text(encoding="utf-8"))
    if (not isinstance(health, dict) or not isinstance(health.get("categories"), dict) or
            not isinstance(health.get("variants"), list) or not health["variants"]):
        raise ValueError("Invalid Health source table")
    ids = set()
    def is_sentence(value: object) -> bool:
        return (isinstance(value, str) and bool(value.strip()) and
                len(re.findall(r"(?<!\d)[.!?](?=\s|$)", value.strip())) == 1 and
                value.rstrip().endswith((".", "!", "?")))

    for variant in health["variants"]:
        if not isinstance(variant, dict) or not isinstance(variant.get("id"), str) or \
                not variant["id"].startswith("rs") or not variant["id"][2:].isdigit() or \
                variant["id"] in ids or variant.get("category") not in health["categories"]:
            raise ValueError("Health markers need unique rs IDs and known categories")
        ids.add(variant["id"])
        if not isinstance(variant.get("title"), str) or not variant["title"].strip():
            raise ValueError(f"{variant['id']}: missing title")
        if not is_sentence(variant.get("definition")):
            raise ValueError(f"{variant['id']}: definition must be one sentence")
        genotypes = variant.get("genotypes")
        if not isinstance(genotypes, dict) or not genotypes:
            raise ValueError(f"{variant['id']}: missing genotypes")
        for genotype, interpretation in genotypes.items():
            if (not isinstance(genotype, str) or not genotype or
                    any(base not in "ACGT" for base in genotype) or
                    not isinstance(interpretation, dict) or
                    interpretation.get("flag") not in {"positive", "neutral", "negative"} or
                    not is_sentence(interpretation.get("meaning"))):
                raise ValueError(f"{variant['id']}:{genotype}: invalid phenotype interpretation")
    return k12b, health


def write_data_bundle(data: dict, output: Path, symbol: str) -> None:
    output.write_text(
        "(function (root) {\n  const data = " +
        json.dumps(data, ensure_ascii=False, separators=(",", ":")) +
        f";\n  root.{symbol} = data;\n" +
        "  if (typeof module !== \"undefined\" && module.exports) module.exports = data;\n" +
        "})(typeof self === \"undefined\" ? globalThis : self);\n",
        encoding="utf-8",
    )


def build_ydnatr(directory: Path = ydnatr_DIRECTORY, k12b_output: Path = K12B_OUTPUT,
                 health_output: Path = HEALTH_OUTPUT) -> None:
    k12b, health = read_ydnatr_data(directory)
    write_data_bundle(k12b, k12b_output, "G25_K12B_DATA")
    write_data_bundle(health, health_output, "G25_HEALTH_DATA")
    total = sum(len(rows) for periods in k12b["sets"].values() for rows in periods.values())
    print(f"Bundled {total} K12b comparison rows into {k12b_output}")
    print(f"Bundled {len(health['variants'])} Health markers into {health_output}")


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


def read_global_ancient_rows(path: Path = ROOT / "data" / "ancient_g25.txt") -> list[list]:
    """Reject a cut-off global ancient source before building browser bundles."""
    rows = read_rows(path, "ancient")
    if len(rows) < GLOBAL_ANCIENT_MIN_ROWS or not any(row[1] == GLOBAL_ANCIENT_TAIL_LABEL for row in rows):
        raise ValueError(f"{path}: global ancient G25 dataset is incomplete")
    return rows


def read_neolithic_data(data_directory: Path = ROOT / "data") -> dict:
    """Group the selected G25 rows from the two editable Neolithic TXT files."""
    result = {}
    for scope, selected_filename, source_filename in (
            ("turkish", "turkish_neolithic_g25.txt", "turkish_ancient_g25.txt"),
            ("global", "neolithic_g25.txt", "ancient_g25.txt")):
        source_path = data_directory / source_filename
        source_rows = (read_global_ancient_rows(source_path) if scope == "global"
                       else read_rows(source_path, "ancient"))
        by_label = {row[1]: row[2:] for row in source_rows}
        if scope == "turkish":
            # Turkish groups can reuse selected sources from the global
            # Neolithic model while retaining their Turkish group names.
            for row in read_rows(data_directory / "neolithic_g25.txt", "ancient"):
                source = row[1].partition(":")[2]
                if not source:
                    raise ValueError("neolithic_g25.txt: expected Group:Source label")
                if source in by_label and by_label[source] != row[2:]:
                    raise ValueError(f"{source} differs between Neolithic G25 datasets")
                by_label[source] = row[2:]
        selected_rows = read_rows(data_directory / selected_filename, "ancient")
        if not selected_rows:
            raise ValueError(f"{selected_filename}: Neolithic references are missing")
        groups = {}
        seen_sources = set()
        for row in selected_rows:
            name, separator, source = row[1].partition(":")
            if not separator or not name.strip() or not source.strip():
                raise ValueError(f"{selected_filename}: expected Group:Source label")
            if source in seen_sources:
                raise ValueError(f"{selected_filename}: duplicate source: {source}")
            if source not in by_label or row[2:] != by_label[source]:
                source_description = ("turkish_ancient_g25.txt or neolithic_g25.txt"
                                      if scope == "turkish" else source_filename)
                raise ValueError(f"{selected_filename}: {source} does not match {source_description}")
            seen_sources.add(source)
            groups.setdefault(name, []).append((source, row[2:]))
        result[scope] = [
            {"name": name, "sources": [source for source, _ in rows],
             "values": [sum(values[dimension] for _, values in rows) / len(rows)
                        for dimension in range(25)]}
            for name, rows in groups.items()
        ]
    return result


def build_neolithic_data(data_directory: Path = ROOT / "data",
                         output: Path = NEOLITHIC_OUTPUT) -> None:
    data = read_neolithic_data(data_directory)
    write_data_bundle(data, output, "G25_NEOLITHIC_REFERENCES")
    print(f"Bundled {len(data['turkish'])} Turkish and {len(data['global'])} global Neolithic proxies into {output}")


def read_modern_pcas(modern_rows: list[list], directory: Path = MODERN_PCA_DIRECTORY,
                     config_name: str = "turkish_pca_config.txt", label_anchors: bool = False) -> list[dict]:
    config = json.loads((directory / config_name).read_text(encoding="utf-8"))
    if not isinstance(config, dict) or not isinstance(config.get("modern"), list):
        raise ValueError("PCA config must contain a modern list")
    modern_by_coordinates = {tuple(row[2:]): row[1] for row in modern_rows}
    modern_by_label = {row[1]: row for row in modern_rows}
    result = []
    ids = set()
    filenames = set()
    for entry in config["modern"]:
        if not isinstance(entry, dict) or not all(isinstance(entry.get(key), str) and entry[key]
                                                   for key in ("id", "title", "file")):
            raise ValueError("Each modern PCA needs an id, title and file")
        if entry["id"] in ids:
            raise ValueError(f"Duplicate modern PCA id: {entry['id']}")
        ids.add(entry["id"])
        filename = entry["file"]
        if Path(filename).name != filename or not filename.endswith(".g25.txt"):
            raise ValueError(f"Invalid PCA filename: {filename}")
        if filename in filenames:
            raise ValueError(f"Duplicate modern PCA file: {filename}")
        filenames.add(filename)
        rows = read_rows(directory / filename, "modern")
        if len(rows) < 3:
            raise ValueError(f"{filename}: PCA needs at least three references")
        anchors = []
        for row in rows:
            if label_anchors:
                label = row[1].split(":", 1)[-1]
                source = modern_by_label.get(label)
                if source is None or source[2:] != row[2:]:
                    raise ValueError(f"{filename}: {row[1]} does not match the global modern dataset")
            else:
                label = modern_by_coordinates.get(tuple(row[2:]))
                if label is None:
                    raise ValueError(f"{filename}: {row[1]} is not in the Turkish modern dataset")
            anchors.append(label)
        pca = {"id": entry["id"], "title": entry["title"],
               "references": rows, "referenceAnchors": anchors,
               "anchorLabels": list(dict.fromkeys(anchors))}
        deep_path = directory / filename.replace(".g25.txt", "_deep.g25.txt")
        if deep_path.exists():
            deep_rows = read_rows(deep_path, "modern")
            if not deep_rows:
                raise ValueError(f"{deep_path.name}: deep PCA needs references")
            main_groups = {row[1].split(":", 1)[0].strip() for row in rows}
            active_deep_rows = []
            deep_anchors = []
            deep_labels = set()
            for row in deep_rows:
                parts = [part.strip() for part in row[1].split(":")]
                if len(parts) != 2 or any(not part for part in parts):
                    raise ValueError(f"{deep_path.name}: expected Group: Population")
                if parts[0] not in main_groups:
                    raise ValueError(f"{deep_path.name}: unknown main PCA group {parts[0]}")
                if row[1] in deep_labels:
                    raise ValueError(f"{deep_path.name}: duplicate deep reference {row[1]}")
                deep_labels.add(row[1])
                label = parts[1]
                if label_anchors:
                    source = modern_by_label.get(label)
                    if source is None or source[2:] != row[2:]:
                        raise ValueError(f"{deep_path.name}: {row[1]} does not match the global modern dataset")
                else:
                    label = modern_by_coordinates.get(tuple(row[2:]))
                    if label is None:
                        raise ValueError(f"{deep_path.name}: {row[1]} is not in the Turkish modern dataset")
                active_deep_rows.append(row)
                deep_anchors.append(label)
            if active_deep_rows:
                pca["deepReferences"] = active_deep_rows
                pca["deepReferenceAnchors"] = deep_anchors
        result.append(pca)
    return result


def read_global_modern_pcas(modern_rows: list[list], directory: Path = MODERN_PCA_DIRECTORY) -> list[dict]:
    """Load the editable global PCA files and validate their source coordinates."""
    return read_modern_pcas(modern_rows, directory, "pca_config.txt", label_anchors=True)


def rebuild_mixed_pca(pcas: list[dict], output: Path = MODERN_PCA_MIXED_SOURCE,
                      excluded_ids: frozenset[str] = frozenset({"istanbul"})) -> int:
    lines = []
    for pca in pcas:
        if pca["id"] in excluded_ids:
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


def write_mixed_bundle(rows: list[list], output: Path, symbol: str) -> None:
    if len(rows) < 3:
        raise ValueError("Mixed PCA needs at least three references")
    output.write_text(
        f"window.{symbol} = "
        + json.dumps({"id": "mixed", "title": "Mixed PCA", "references": rows,
                      "referenceAnchors": []}, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"Bundled {len(rows)} mixed PCA references into {output}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--turkish", action="store_true", help="Rebuild only the Turkish modern, ancient, medieval and PCA bundles")
    selection.add_argument("--ydnatr", action="store_true", help="Rebuild only the K12b Oracle and Health bundles")
    selection.add_argument("--neolithic", action="store_true", help="Rebuild only the Neolithic reference bundle")
    args = parser.parse_args()
    if args.ydnatr:
        build_ydnatr()
        return
    if args.neolithic:
        build_neolithic_data()
        return
    if not args.turkish:
        global_modern_rows = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        rows = global_modern_rows + read_global_ancient_rows()
        OUTPUT.write_text(
            "window.G25_REFERENCES = " + json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + ";\n",
            encoding="utf-8",
        )
        print(f"Bundled {len(rows)} references into {OUTPUT}")
        global_pcas = read_global_modern_pcas(global_modern_rows)
        GLOBAL_MODERN_PCA_OUTPUT.write_text(
            "window.G25_MODERN_PCAS = "
            + json.dumps(global_pcas, ensure_ascii=False, separators=(",", ":")) + ";\n",
            encoding="utf-8",
        )
        print(f"Bundled {len(global_pcas)} global modern PCA into {GLOBAL_MODERN_PCA_OUTPUT}")
        rebuild_mixed_pca(global_pcas, GLOBAL_MODERN_PCA_MIXED_SOURCE, frozenset())
        write_mixed_bundle(read_rows(GLOBAL_MODERN_PCA_MIXED_SOURCE, "modern"),
                           GLOBAL_MODERN_PCA_MIXED_OUTPUT, "G25_MODERN_MIXED_PCA")
    turkish_rows = read_rows(ROOT / "data" / "turkish_modern_g25.txt", "modern")
    turkish_rows += read_rows(ROOT / "data" / "turkish_ancient_g25.txt", "ancient")
    TURKISH_OUTPUT.write_text(
        "window.G25_TURKISH_REFERENCES = " + json.dumps(turkish_rows, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"Bundled {len(turkish_rows)} Turkish modern and ancient references into {TURKISH_OUTPUT}")
    modern_pcas = read_modern_pcas([row for row in turkish_rows if row[0] == "modern"])
    MODERN_PCA_OUTPUT.write_text(
        "window.G25_TURKISH_MODERN_PCAS = "
        + json.dumps(modern_pcas, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"Bundled {len(modern_pcas)} Turkish modern PCA into {MODERN_PCA_OUTPUT}")
    rebuild_mixed_pca(modern_pcas)
    mixed_rows = read_rows(MODERN_PCA_MIXED_SOURCE, "modern")
    write_mixed_bundle(mixed_rows, MODERN_PCA_MIXED_OUTPUT,
                       "G25_TURKISH_MODERN_MIXED_PCA")
    medieval_rows = {
        "early": read_rows(ROOT / "data" / "turkish_early_medieval_g25.txt", "medieval"),
        "late": read_rows(ROOT / "data" / "turkish_late_medieval_g25.txt", "medieval"),
    }
    MEDIEVAL_OUTPUT.write_text(
        "window.G25_TURKISH_MEDIEVAL_REFERENCES = " + json.dumps(medieval_rows, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"Bundled {len(medieval_rows['early'])} early and {len(medieval_rows['late'])} late Turkish medieval references into {MEDIEVAL_OUTPUT}")
    if not args.turkish:
        build_ydnatr()
    build_neolithic_data()


if __name__ == "__main__":
    main()
