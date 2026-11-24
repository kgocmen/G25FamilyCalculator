"""Project the same local G25 anchors through another offline PCA basis.

The source anchor file supplies matched AADR individual columns, official G25
targets, and the chip SNP mask. The output contains coordinates only and should
remain outside the repository. It can be used to test another PCA axis count
without changing the browser model.
"""

import argparse
from pathlib import Path
import sys

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "data" / "blend" / "g25_projector"))
from g25.model import G25Model  # noqa: E402
from g25.panel import Panel  # noqa: E402
from g25.pca import standardization, standardize  # noqa: E402
from g25.project import lsq_per_individual  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--panel", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    with np.load(args.source) as source:
        cols, idx = source["cols"], source["snp_idx"]
        metadata = {key: source[key] for key in
                    ("scaled", "groups", "cols", "snp_idx", "source", "person_id")}
    model = G25Model.load(str(args.model))
    panel = Panel(prefix=str(args.panel), verbose=False)
    mean2p, inv_sd = standardization(model.freq[idx])
    rows = model.panel_snp_rows[idx]
    loadings = model.loadings[idx]
    scores = np.empty((len(cols), model.k))
    for start in range(0, len(cols), 64):
        stop = min(start + 64, len(cols))
        genotype = panel.view(rows, cols[start:stop], verbose=False).cache_dense(verbose=False)
        scores[start:stop] = lsq_per_individual(
            loadings, model.sv, standardize(genotype, mean2p, inv_sd), genotype != -1
        )
        if stop % 1024 == 0 or stop == len(cols):
            print(f"projected {stop}/{len(cols)}", flush=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.out, x=model.to_unscaled(scores), **metadata)
    print(f"saved {args.out}: {len(cols)} paired individuals, {model.k} axes", flush=True)


if __name__ == "__main__":
    main()
