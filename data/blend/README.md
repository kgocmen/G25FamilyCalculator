# Local blend models

The website loads the published browser model at
`calculator/raw_data/g25_blend.bin.gz`. It does not read files from this folder.

To rebuild that browser model locally, place these files here:

- `ho50_model.npz`
- `ho100_model.npz`
- `ho25_model.npz`
- `direct_chip_all50_clean_neighbor.npz`
- `direct_chip_all100_clean_neighbor.npz`
- `direct_chip_all25_clean_neighbor.npz`
- `chip_marker_indices.npz`

The optional Python predictor also uses the MIT-licensed `g25_projector` source
folder. All local model files are ignored by Git. Do not store raw DNA here.

## Three-axis browser model

`ho25_model.npz` and `direct_chip_all25_clean_neighbor.npz` are the additional
mapper in the enabled 25/50/100 browser model. The 25-axis PCA model uses
the same AADR SNP panel and chip marker mask as the 50/100 models.

`build/project_g25_pca_variant.py` projects the same local paired individuals
through the 25-axis basis. `build/evaluate_g25_axis_blends.py` compares models
with identical population holdouts and deduplicated training people. On seeds
25, 26, and 27, the 50/100 blend versus equal-weight 25/50/100 blend had:

| Seed | 50/100 mean / p95 | 25/50/100 mean / p95 | High-coverage modern mean, old → new |
| --- | --- | --- | --- |
| 25 | 3.458 / 6.121 | 3.383 / 5.610 | 3.794 → 3.626 |
| 26 | 3.418 / 5.988 | 3.350 / 5.557 | 3.517 → 3.366 |
| 27 | 3.276 / 5.245 | 3.272 / 5.221 | 3.176 → 3.190 |

The high-coverage modern 95th percentile improved in all three splits. The
third split's modern mean worsened slightly, so the three-axis model does not
improve every genome. Across the three test folds, 607–655 of 1,076 individual
rows improved; 9–11 rows worsened by more than one G25 distance unit.

To reproduce the three-axis browser calculation locally, run
`python3 build/predict_g25_direct.py /path/to/raw.csv --experimental-25`.
It writes `*.g25_triple_scaled.txt`. The script's default output still uses the
earlier 50/100 model, so existing offline workflows retain their output path.

## Ancient-reference expansion

The published browser model can be rebuilt from the [AADR v66.p1 Human Origins
panel](https://doi.org/10.7910/DVN/FFIDCW) and the locally downloaded official
ancient individual scaled G25 table. Keep the AADR genotype panel and generated
individual anchor files outside this repository. The model only publishes fitted
coefficients and reference residuals, without individual genotypes.

`build/expand_g25_ancient_anchors.py` pairs additional official G25 rows labeled
as no-UDG or enhanced preparations with the same person's AADR genotype. It
requires a unique individual ID, at least 80,000 covered Human Origins markers,
and passing AADR quality metadata. It found 1,040 additional ancient pairings
with the local v66.p1 panel; 982–1,014 were usable in each training fold after
excluding held-out populations and people. These are preparation aliases, so
their labels are noisier than exact genotype-to-G25 pairs.

The expanded anchors lowered mean scaled G25 distance by 0.021–0.035 across
three population-held-out splits compared with exact-only anchors. This is a
small average improvement, not a guarantee for every individual.

After validation, `build/train_g25_full_mapper.py` chooses one preparation per
individual, preferring an exact G25 match and then greater SNP coverage. Run it
for all three axes to produce the ignored local mapper files; then run
`build/export_g25_blend.py` to rebuild the browser asset.
