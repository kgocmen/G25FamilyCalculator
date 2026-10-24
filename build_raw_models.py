"""Build browser models from the public source files listed in raw_data/README.md.

Usage: python build_raw_models.py /path/to/downloaded/source/files
Requires numpy; convert the two K12b RData objects to whitespace tables with R first.
No personal DNA files are used in this build.
"""
import csv
import gzip
import hashlib
import json
from pathlib import Path
import re
import struct
import sys

import numpy as np

ROOT = Path(__file__).parent / "calculator" / "raw_data"
K12B = ["Gedrosia", "Siberian", "Northwest_African", "Southeast_Asian",
        "Atlantic_Med", "North_European", "South_Asian", "East_African",
        "Southwest_Asian", "East_Asian", "Caucasus", "Sub_Saharan"]
VBN_SOURCE_SHA256 = "05339d34c09fea4ee68119f7b638df3313a76ec17528a2846255d88948961cb7"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def published_regression(source, components):
    """Extract the published numeric formula without executing downloaded JavaScript."""
    path = source / "K36vertical.js"
    if digest(path) != VBN_SOURCE_SHA256:
        raise ValueError("The Vbknethio source differs from the audited revision.")
    script = path.read_text()
    number = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?"
    coefficients = np.zeros((36, 25))
    intercept = []
    for pc in range(25):
        equation = re.search(r"\bv" + str(pc + 1) + r"\s*=\s*(" + number + r")(.*?);", script)
        if not equation:
            raise ValueError(f"Missing published equation for PC{pc + 1}.")
        terms = re.findall(r"\bcom(\d+)\s*\*\s*(" + number + ")", equation[2])
        if [int(index) for index, _ in terms] != list(range(1, 37)):
            raise ValueError(f"Unexpected component order for PC{pc + 1}.")
        intercept.append(float(equation[1]))
        for index, value in terms:
            coefficients[int(index) - 1, pc] = float(value)
    return {
        "version": 2, "id": "vbknethio-k36-scaled-05339d34", "name": "Vbknethio K36 regression",
        "output": "scaled", "input": "percentages", "method": "published affine linear regression",
        "components": components, "coefficients": coefficients.tolist(), "intercept": intercept,
        "source": "https://allelocator.ovh/K36vertical.js",
        "sourcePage": "https://allelocator.ovh/K36vertical.html", "sourceSha256": VBN_SOURCE_SHA256,
        "validation": {"kind": "published-source conformance", "independentAccuracyEstimate": None},
    }


def build(source):
    ROOT.mkdir(exist_ok=True)
    manifest = {"version": 1, "models": {}}
    for model, stem, components in [
        ("k36", "eurogenes", (source / "eurogenes.txt").read_text().split()),
        ("k12b", "K12b", K12B),
    ]:
        alleles = source / f"{stem}.alleles"
        frequencies = source / f"{stem}.{len(components)}.F"
        rows = [line.split() for line in alleles.read_text().splitlines()]
        f = np.loadtxt(frequencies, dtype="<f4")
        assert f.shape == (len(rows), len(components))
        assert np.isfinite(f).all() and (f >= 0).all() and (f <= 1).all()
        assert len({row[0] for row in rows}) == len(rows)
        ids = np.array([int(row[0].removeprefix("rs")) for row in rows], dtype="<u4")
        codes = bytes("ACGT".index(row[1]) * 4 + "ACGT".index(row[2]) for row in rows)
        # F describes the SECOND allele in the original DIYDodecad allele table.
        header = b"G25RAW01" + struct.pack("<II", len(rows), len(components))
        payload = header + ids.tobytes() + codes + bytes((-len(codes)) % 4) + f.tobytes()
        output = ROOT / f"{model}.bin.gz"
        output.write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))
        manifest["models"][model] = {
            "file": output.name, "snps": len(rows), "components": components,
            "bytes": output.stat().st_size, "sha256": digest(output),
            "sourceSha256": {alleles.name: digest(alleles), frequencies.name: digest(frequencies)},
        }
        print(model, len(rows), output.stat().st_size)

    def table(name):
        with (source / name).open() as handle:
            reader = csv.reader(handle)
            header = next(reader)
            rows = {row[0]: np.array(row[1:], dtype=float) for row in reader}
        return header[1:], rows

    components, k36 = table("training-k36.csv")
    pcs, g25 = table("training-g25.csv")
    assert components == manifest["models"]["k36"]["components"]
    assert pcs == [f"PC{i}" for i in range(1, 26)]
    names = sorted(k36.keys() & g25.keys())
    x = np.array([k36[name] for name in names])
    y = np.array([g25[name] for name in names])
    x /= x.sum(axis=1, keepdims=True)
    # The simplex sum makes an intercept redundant: 36 fractions -> 25 scaled PCs.
    coefficients, _, rank, _ = np.linalg.lstsq(x, y, rcond=None)
    assert rank == 36
    indices = np.random.default_rng(25).permutation(len(names))
    test, train = indices[:len(indices) // 5], indices[len(indices) // 5:]
    validation_coef = np.linalg.lstsq(x[train], y[train], rcond=None)[0]
    errors = np.linalg.norm(x[test] @ validation_coef - y[test], axis=1)
    regression = {
        "version": 1, "id": "k36-g25-ols-20261024", "output": "scaled",
        "components": components, "coefficients": coefficients.tolist(),
        "trainingSamples": len(names), "trainingPopulations": len({n.split(":")[0] for n in names}),
        "input": "fractions summing to one", "intercept": "implicit in simplex",
        "validation": {"method": "seed 25, 80/20 individual holdout; refit all samples for release",
                       "samples": len(test), "euclideanRmse": float(np.sqrt(np.mean(errors ** 2))),
                       "medianDistance": float(np.median(errors)),
                       "p95Distance": float(np.quantile(errors, .95))},
        "sources": {name: digest(source / name) for name in ["training-k36.csv", "training-g25.csv"]},
    }
    # Keep the original custom OLS fit reproducible as a legacy artifact.
    (ROOT / "k36_g25.json").write_text(json.dumps(regression, separators=(",", ":")) + "\n")
    active = published_regression(source, components)
    active_path = ROOT / "k36_g25_vbknethio.json"
    active_path.write_text(json.dumps(active, separators=(",", ":")) + "\n")
    manifest["regression"] = {"file": active_path.name, "id": active["id"], "sha256": digest(active_path)}
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("legacy regression", regression["trainingSamples"], regression["validation"])
    print("active regression", active["id"])


if __name__ == "__main__":
    build(Path(sys.argv[1]))
