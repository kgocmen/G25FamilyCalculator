#!/usr/bin/env python3
"""Audit global modern PCA coverage and write a population-to-PCA map."""

import json
from pathlib import Path
from build.build_calculator_data import read_global_modern_pcas, read_row_sections, read_rows


ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
PCA = DATA / "pca"
MAP = ROOT / "build" / "pca_map.txt"
SECTIONS = (("main", "Main"), ("deep", "Deep"), ("deep mixed", "DeepMixed"))
PRIORITY = {status: index for index, (_, status) in enumerate(SECTIONS)}


def collect_locations():
    modern_rows = read_rows(DATA / "modern_g25.txt", "modern")
    modern = {row[1]: {} for row in modern_rows}
    config = json.loads((PCA / "pca_config.txt").read_text(encoding="utf-8"))
    read_global_modern_pcas(modern_rows, PCA)
    for number, entry in enumerate(config["modern"], 1):
        if entry["file"] != f"modern_pca{number}.g25.txt":
            raise ValueError(f"PCA {number} does not match {entry['file']}")
        sections = read_row_sections(PCA / entry["file"], "modern")
        for section, status in SECTIONS:
            for row in sections.get(section, []):
                group, separator, population = row[1].partition(":")
                if not separator or not group.strip() or not population.strip():
                    raise ValueError(f"{entry['file']}: expected Group: Population")
                if group.strip() == "Deprecated":
                    continue
                population = population.strip()
                if population not in modern:
                    raise ValueError(f"{entry['file']}: {population} is not in modern_g25.txt")
                key = (number, entry["title"], group.strip())
                previous = modern[population].get(key)
                if previous is None or PRIORITY[status] < PRIORITY[previous]:
                    modern[population][key] = status
    return modern_rows, modern


def coverage():
    _, locations = collect_locations()
    regular = {name for name, entries in locations.items()
               if any(status != "DeepMixed" for status in entries.values())}
    mixed_only = {name for name, entries in locations.items()
                  if any(status == "DeepMixed" for status in entries.values())}
    return set(locations), regular, mixed_only


def main():
    modern_rows, locations = collect_locations()
    lines = []
    for row in modern_rows:
        entries = locations[row[1]]
        placements = [f"{number}-{title}-{status}:{group}"
                      for (number, title, group), status in sorted(entries.items())]
        lines.append(f"{row[1]}, {', '.join(placements) if placements else 'Unassigned'}")
    MAP.write_text("\n".join(lines) + "\n", encoding="utf-8")

    modern = set(locations)
    regular = {name for name, entries in locations.items()
               if any(status != "DeepMixed" for status in entries.values())}
    mixed_only = {name for name, entries in locations.items()
                  if any(status == "DeepMixed" for status in entries.values())}
    covered = regular | mixed_only
    missing = sorted(modern - covered, key=str.casefold)
    print(f"PCA map: {MAP} ({len(lines)} rows)")
    print(f"Modern populations: {len(modern)}")
    print(f"Covered by regular deep PCAs: {len(modern & regular)}")
    print(f"Covered only by Mixed Deep: {len(modern & (mixed_only - regular))}")
    print(f"Covered by all deep PCAs: {len(modern & covered)}")
    print(f"Missing from every deep PCA: {len(missing)}")
    for population in missing:
        print(population)


if __name__ == "__main__":
    main()
