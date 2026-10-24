# Raw Data models

The calculator reads MyHeritage CSV/TSV locally, estimates K36 and K12b independently
from fixed reference allele frequencies, then applies a K36 → **simulated scaled G25**
regression. No DNA is uploaded, persisted, or included in application assets.

## Sources

- MyHeritage [raw-data documentation](https://www.myheritage.com/help/en/articles/12852246-how-should-i-interpret-my-raw-dna-data)
  describes forward-strand reporting and the split-allele layout. Older exports use
  quoted `RSID,CHROMOSOME,POSITION,RESULT` CSV, including comment-prefixed headers.
- [Eurogenes K36](https://bga101.blogspot.com/2013/03/eurogenes-k36-at-gedmatch.html),
  Davidski / Eurogenes Genetic Ancestry Project (2013). Model source mirror:
  [teepean/BAM-Analysis-Kit](https://github.com/teepean/BAM-Analysis-Kit/tree/3fee8010de4bb3d8809e3d48039efbf60d38a48a/ref/admixture).
  Download `eurogenes.alleles`, `eurogenes.36.F`, and `eurogenes.txt` from that directory.
  The binary contains all 165,688 SNPs and all 36 components, in original order.
- [Dodecad K12b](https://dodecad.blogspot.com/2012/01/k12b-and-k7b-calculators.html),
  Dienekes Pontikos / Dodecad Ancestry Project (2012). Source mirror:
  [WeGene radmixture](https://github.com/wegene-llc/radmixture/tree/bbe542448db555c13a64c3a9113f571635112b74/data).
  Download `K12b.alleles.RData` and `K12b.12.F.RData`. The binary contains all
  166,770 SNPs and 12 components. See [source license](DODECAD-LICENSE.txt):
  noncommercial use with attribution and a link to the Dodecad Ancestry Project.
- Nganasankhan's [published regression method and paired data](https://genoplot.com/discussions/topic/28494/r-and-shell-scripts-for-admixture-calculators?page=3):
  [K36 results](https://drive.google.com/file/d/1diCjHuUS_04ICJU68XjlXLpO-J6DOw1n/view)
  for the Reich 1240K+HO dataset, and
  [modern scaled G25 rows](https://drive.google.com/file/d/1HYrDwxEXv82DvDLoq736pS5ZTGJA4dn5/view)
  by Davidski / Eurogenes. Download these as `training-k36.csv` and `training-g25.csv`.
  We fit our own coefficients from the exact label intersection; we do not copy
  coefficients from an undocumented online simulator.

Retrieved 2026-10-24. `manifest.json` records SHA-256 digests of source tables and
compressed browser models. The regression JSON records hashes of its training files.
The K36 mirror does not supply a separate calculator-data license; the mirror is
provenance, not a claim that these data are MIT licensed. Preserve author attribution.

## Rebuild

Requires Python with NumPy, and R to extract the K12b source tables. Put the source
files named above into a directory, then run R from that directory:

```r
load("K12b.alleles.RData")
load("K12b.12.F.RData")
write.table(K12b.alleles, "K12b.alleles", quote=FALSE, row.names=FALSE, col.names=FALSE)
write.table(K12b.12.F, "K12b.12.F", quote=FALSE, row.names=FALSE, col.names=FALSE)
```

From the repository root:

```sh
OPENBLAS_NUM_THREADS=1 python build_raw_models.py /path/to/source/files
node --test calculator/raw_dna.test.js
```

`k36.bin.gz` and `k12b.bin.gz` use gzip with a deterministic zero timestamp. The
decompressed binary consists of an 8-byte `G25RAW01` magic, little-endian uint32
SNP/component counts, uint32 numeric rsIDs, one byte per allele pair (`4*a+b`,
with bases A=0, C=1, G=2, T=3), padding to four-byte alignment, and row-major
little-endian float32 frequencies. Conversion retains ~7 significant decimal
digits, exceeding the precision of the original frequency tables. The app checks
the compressed model hash when browser Web Crypto is available. Models are loaded
on demand in a dedicated worker, keeping existing tabs responsive.

## Inference and allele orientation

`raw_dna.js` matches rsID, excludes no-calls, indels, non-autosomal records and
conflicting duplicate rsIDs, and complements alleles only when an unambiguous
direct match fails. Positions are not used for matching, so no genome lift-over
is performed. Both supplied panels exclude A/T and C/G palindromic sites. The
engine also rejects any palindromic sites if a future panel contains them.

The original DIYDodecad `F` tables describe the **second** allele in each allele
table row. This is also explicit in radmixture's
[`tfrdpub` implementation](https://github.com/wegene-llc/radmixture/blob/bbe542448db555c13a64c3a9113f571635112b74/R/transfer_raw_data.R):
it uses `1-F` when counting the first allele. Our dosage counts the second allele
directly and uses the published `F` unchanged.

For each called SNP, let `g` be the second-allele dosage (0/1/2), `f` its fixed
component frequencies and `q` the ancestry fractions. Maximize:

```text
sum_SNPs [g log(dot(q,f)) + (2-g) log(1-dot(q,f))]
subject to q >= 0 and sum(q) = 1
```

The binomial coefficient is constant with respect to `q` and omitted. Spectral
projected gradient with an Armijo line search solves this convex problem.
Convergence uses the infinity norm of the projected gradient (<1e-7); runs are
limited to 1,200 iterations. Unconverged results are marked provisional and cannot
produce G25. At least 10,000 matched SNPs are required by this app; below 40,000,
coverage is flagged as low. These are application quality thresholds, not a claim
that every export exceeding them has a calibrated ancestry estimate.

K36 and K12b are independent fitted profiles; neither is inferred from the other.
Results are not claimed to reproduce GEDmatch exactly. Calculator effects,
reference coverage, array ascertainment and different numerical methods matter.

## G25 regression and validation

The build joins the two training tables on exact population:sample labels,
yielding **1,119 modern samples from 137 populations**. K36 rows are normalized to
fractions summing to one. NumPy least squares fits `X (1119×36) @ B (36×25) = Y`.
The design has rank 36. An intercept is redundant on the simplex; the 36 weights
already express an affine prediction for its normalized inputs. The output is
scaled G25 and is never scaled a second time.

Validation uses a deterministic seed-25 permutation and a held-out 20% (223
individuals), training only on the remaining 896 for validation. Euclidean errors
in scaled-coordinate units are:

| Metric | Distance |
| --- | ---: |
| Median | 0.0293409510 |
| Root mean squared Euclidean distance | 0.0369539877 |
| 95th percentile | 0.0688066699 |

Multiply these by 100 to compare with the distance display elsewhere in this app.
This is individual holdout validation; members of a population can occur in both
splits. It does not validate performance on unseen populations. The released
coefficients are refitted to all 1,119 samples after validation. Errors do not
include error introduced by fitting a consumer raw file to the allele-frequency
models, and are not individual confidence intervals. Ancient or out-of-distribution
samples are outside this modern-sample validation. Never present these predictions
as direct G25 PCA projections.
