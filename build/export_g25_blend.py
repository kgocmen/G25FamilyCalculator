"""Pack the exact per-file least-squares G25 blend for supported chip markers."""

import gzip
import hashlib
import json
from pathlib import Path
import struct

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / "data" / "blend"
PUBLIC = ROOT / "calculator" / "raw_data"
BASES = {base: i for i, base in enumerate("ACGT")}
AXES = (25, 50, 100)


def packed_basis(model, chip_index):
    loadings = model["loadings"][chip_index].astype("<f4")
    gram = loadings.astype(np.float64).T @ loadings.astype(np.float64)
    metadata = json.loads(str(model["meta"][0]))
    scale = float(metadata.get("unscaled_scale", 0.04)) / (model["sv"] * model["pc_sd"])
    return scale.astype("<f8"), loadings, gram.astype("<f8")


def mapper_bytes(path, axes):
    with np.load(path) as model:
        a = model["a"].astype("<f8")
        c = model["c"].astype("<f8")
        train = model["train_x"].astype("<f8")
        residual = model["residual"].astype("<f8")
        k = int(model["neighbors"])
        power = float(model["power"])
        strength = float(model["strength"])
    if a.shape != (axes, 25) or c.shape != (25,) or train.shape != residual.shape or train.shape[1] != 25:
        raise ValueError(f"invalid {axes}-axis mapper")
    return (struct.pack("<IddI", k, power, strength, len(train))
            + a.tobytes() + c.tobytes() + train.tobytes() + residual.tobytes())


def main():
    models = {axes: np.load(PRIVATE / f"ho{axes}_model.npz", allow_pickle=True)
              for axes in AXES}
    chip_index = np.load(PRIVATE / "chip_marker_indices.npz")["snp_idx"]
    left = models[AXES[0]]
    for axes in AXES[1:]:
        right = models[axes]
        for key in ("snp_id", "freq", "snp_a1", "snp_a2", "snp_chrom", "snp_pos"):
            if not np.array_equal(left[key], right[key]):
                raise ValueError(f"the {axes}-axis PCA model has an incompatible {key} panel")
    by_id = {str(name): i for i, name in enumerate(left["snp_id"])}
    extra = (ROOT / "build" / "g25_blend_extra_markers.txt").read_text().splitlines()
    chip_index = np.array(sorted(set(map(int, chip_index)) | {by_id[name] for name in extra}), dtype=np.int64)
    ids = []
    for item in left["snp_id"][chip_index]:
        name = str(item)
        if not name.startswith("rs") or not name[2:].isdigit():
            raise ValueError(f"non-rsID marker {name}")
        ids.append(int(name[2:]))
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate SNP IDs")
    bases = []
    for key in ("snp_a1", "snp_a2"):
        bases.append(np.array([BASES[str(v)] for v in left[key][chip_index]], dtype="u1"))
    pieces = [b"G25BLSQ3", struct.pack("<II", len(chip_index), len(AXES)),
              np.asarray(ids, dtype="<u4").tobytes(), *[v.tobytes() for v in bases],
              left["snp_chrom"][chip_index].astype("u1").tobytes(),
              left["snp_pos"][chip_index].astype("<u4").tobytes(),
              left["freq"][chip_index].astype("<f8").tobytes()]
    for axes in AXES:
        scale, loadings, gram = packed_basis(models[axes], chip_index)
        pieces.extend((struct.pack("<I", axes), scale.tobytes(), loadings.tobytes(),
                       gram.tobytes(), mapper_bytes(
                           PRIVATE / f"direct_chip_all{axes}_clean_neighbor.npz", axes)))
    path = PUBLIC / "g25_blend.bin.gz"
    with path.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=0, compresslevel=9) as handle:
        for piece in pieces:
            handle.write(piece)
    compressed = path.read_bytes()
    manifest_path = PUBLIC / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["directBlend"] = {
        "enabled": manifest.get("directBlend", {}).get("enabled", False),
        "file": path.name, "snps": len(chip_index), "bytes": len(compressed),
        "sha256": hashlib.sha256(compressed).hexdigest(), "minCoverage": 0.99,
        "axes": list(AXES), "method": "G25 kgocmen algorithm (AADR per-file least-squares PCA + G25 neighbor blend)",
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(path, len(compressed), "bytes")


if __name__ == "__main__":
    main()
