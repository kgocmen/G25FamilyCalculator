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
