# Local blend models

The website loads the published browser model at
`calculator/raw_data/g25_blend.bin.gz`. It does not read files from this folder.

To rebuild that browser model locally, place these files here:

- `ho50_model.npz`
- `ho100_model.npz`
- `direct_chip_all50_clean_neighbor.npz`
- `direct_chip_all100_clean_neighbor.npz`
- `chip_marker_indices.npz`

The optional Python predictor also uses the MIT-licensed `g25_projector` source
folder. All local model files are ignored by Git. Do not store raw DNA here.

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

`build/compare_g25_ancient_expansion.py` evaluates the exact-only and expanded
blends on the same population-held-out samples, keeping one preparation per
person in both training sets. In seeds 25, 26, and 27, mean scaled G25 distance
changed from 3.493 to 3.458, 3.440 to 3.418, and 3.297 to 3.276 respectively.
The 95th percentile changed from 6.359 to 6.123, 6.000 to 5.988, and 5.452
to 5.248. These are small improvements, not a guarantee
that every individual improves.

After validation, `build/train_g25_full_mapper.py` chooses one preparation per
individual, preferring an exact G25 match and then greater SNP coverage. Run it
for both axes to produce the two ignored local mapper files; then run
`build/export_g25_blend.py` to rebuild the browser asset.
