#!/usr/bin/env python3
"""Export the public World Genetics G25 reference rows.

Run: python3 build/scrape_g25.py --output-dir data
"""

from __future__ import annotations

import argparse
import csv
from decimal import Decimal
import json
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


REPORT_URL = "https://www.worldgenetics.app/dna-report"
USER_AGENT = "worldgenetics-g25-export/1.0 (public reference data)"


def download(url: str) -> str:
    """Fetch a public page or asset, retrying temporary server/network failures."""
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT})
            with urlopen(request, timeout=30) as response:
                return response.read().decode("utf-8-sig")
        except (HTTPError, URLError, TimeoutError) as error:
            last_error = error
            if isinstance(error, HTTPError) and error.code < 500 and error.code != 429:
                break
            if attempt < 2:
                time.sleep(attempt + 1)
    raise RuntimeError(f"Could not fetch {url}: {last_error}") from last_error


def find_one(pattern: str, source: str, description: str) -> str:
    match = re.search(pattern, source)
    if not match:
        raise ValueError(f"Could not locate {description}; the site's asset layout may have changed")
    return match.group(1)


def asset_url(base_url: str, asset: str) -> str:
    url = urljoin(base_url, asset)
    if urlparse(url).netloc != urlparse(REPORT_URL).netloc:
        raise ValueError(f"Unexpected asset host: {url}")
    return url


def discover_assets(page: str, app: str) -> tuple[str, str, str]:
    app_path = find_one(r'script\.src\s*=\s*["\']([^"\']*app\.js[^"\']*)["\']', page, "app.js")
    modern_path = find_one(r'const\s+modernReferenceRowsAsset\s*=\s*["\']([^"\']+)["\']', app, "modern G25 asset")
    ancient_path = find_one(r'loadScriptOnce\(\s*["\']([^"\']*ancient-g25-data\.js[^"\']*)["\']', app, "ancient G25 asset")
    return app_path, modern_path, ancient_path


def parse_rows(source: str, variable: str) -> list[list[str]]:
    prefix = f"window.{variable} = "
    text = source.strip()
    if not text.startswith(prefix):
        raise ValueError(f"Expected a {variable} assignment")
    payload = text[len(prefix):].removesuffix(";").strip()
    rows = json.loads(payload, parse_float=Decimal, parse_int=Decimal)
    if not isinstance(rows, list) or not rows:
        raise ValueError(f"{variable} is empty or invalid")

    validated: list[list[str]] = []
    for number, row in enumerate(rows, start=1):
        if not isinstance(row, list) or len(row) != 26:
            raise ValueError(f"{variable} row {number} does not have a label and 25 coordinates")
        label, *values = row
        if not isinstance(label, str) or not label.strip():
            raise ValueError(f"{variable} row {number} has no population label")
        if any(not isinstance(value, Decimal) or not value.is_finite() for value in values):
            raise ValueError(f"{variable} row {number} has an invalid coordinate")
        validated.append([label, *(str(value) for value in values)])
    return validated


def write_g25(path: Path, rows: list[list[str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as file:
        csv.writer(file).writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path("data"), help="directory for exported files")
    args = parser.parse_args()

    page = download(REPORT_URL)
    app_path = find_one(r'script\.src\s*=\s*["\']([^"\']*app\.js[^"\']*)["\']', page, "app.js")
    app = download(asset_url(REPORT_URL, app_path))
    _, modern_path, ancient_path = discover_assets(page, app)

    modern_url = asset_url(REPORT_URL, modern_path)
    ancient_url = asset_url(REPORT_URL, ancient_path)
    modern = parse_rows(download(modern_url), "MODERN_G25_DATA")
    ancient = parse_rows(download(ancient_url), "ANCIENT_G25_DATA")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    write_g25(args.output_dir / "modern_g25.txt", modern)
    write_g25(args.output_dir / "ancient_g25.txt", ancient)
    with (args.output_dir / "all_g25.csv").open("w", encoding="utf-8", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(["category", "label", *(f"PC{i}" for i in range(1, 26))])
        writer.writerows(["modern", *row] for row in modern)
        writer.writerows(["ancient", *row] for row in ancient)

    print(f"Exported {len(modern)} modern and {len(ancient)} ancient rows to {args.output_dir}")
    print(f"Modern source: {modern_url}")
    print(f"Ancient source: {ancient_url}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, ValueError, OSError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)
