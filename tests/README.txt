Run from the project root:

  node --test tests/*.test.js
  python3 -m unittest discover -s tests -p 'test_*.py'
  node tests/deep_pca_selfcheck.js

The deep PCA check uses the editable data/pca/*.g25.txt files and runs each
population found only in a deep file through the app's main-then-deep worker.
It passes when that exact deep reference contributes at least 99.9% and the
deep fit distance is at most 0.001. Results are written to
tests/results/successful.tsv and tests/results/unsuccessful.tsv. This directory
is ignored by Git. The command exits with status 1 if any entries fail.

Use --pca ID to check one PCA or --limit N for a short smoke test. Use
--output-dir DIR to put the reports elsewhere.
Use --per-pca-limit 1 to check one deep-only population from every configured
PCA without running the full deep check.
