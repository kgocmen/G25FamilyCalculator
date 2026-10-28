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
- Vbknethio's published [K36-to-G25 converter](https://allelocator.ovh/K36vertical.html)
  and [coefficient source](https://allelocator.ovh/K36vertical.js). This is the
  active G25 regression, stored as `k36_g25_vbknethio.json`. The source SHA-256 is
  `05339d34c09fea4ee68119f7b638df3313a76ec17528a2846255d88948961cb7`.
  The [horizontal version](https://allelocator.ovh/K36horizontal.js) was separately
  checked: its coefficients and intercepts are identical. Attribution to
  Vbknethio, hosted by Allelocator; coordinate system by Davidski / Eurogenes.
- **Legacy regression only:** Nganasankhan's [published regression method and paired data](https://genoplot.com/discussions/topic/28494/r-and-shell-scripts-for-admixture-calculators?page=3):
  [K36 results](https://drive.google.com/file/d/1diCjHuUS_04ICJU68XjlXLpO-J6DOw1n/view)
  for the Reich 1240K+HO dataset, and
  [modern scaled G25 rows](https://drive.google.com/file/d/1HYrDwxEXv82DvDLoq736pS5ZTGJA4dn5/view)
  by Davidski / Eurogenes. Download these as `training-k36.csv` and `training-g25.csv`.
  These reproduce the earlier custom fit in `k36_g25.json`, which is no longer
  selected by the application.

Retrieved 2026-10-24. `manifest.json` records SHA-256 digests of source tables and
compressed browser models, and identifies the active regression file and its hash.
The published regression records its source hash; the legacy fit records training hashes.
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
OPENBLAS_NUM_THREADS=1 python build/build_raw_models.py /path/to/source/files
node --test tests/raw_dna.test.js
```

Also save the published script as `K36vertical.js` in the source directory.
The build checks its audited SHA-256, extracts only the numeric equations without
executing the downloaded script, and verifies the order of all 36 terms in each
of the 25 equations. A changed source revision is rejected. The legacy training
files remain required to reproduce the archived custom fit.

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

## Active G25 regression: published Vbknethio formula

The active calculation is:

```text
percentage[i] = 100 * fraction[i] / sum(fractions)
PC[j] = intercept[j] + sum_i percentage[i] * coefficient[i,j]
```

All 900 coefficients and all 25 intercepts come from the published source. The
25 outputs are already scaled. No additional PCA scale factors, inferred region,
sample-specific correction, or fitting to a user's comparison row is applied.
The K36 and K12b SNP-fitting models are independent of this regression selection.

The active model has an explicit `percentages` input unit. This matters because
the original custom model used fractions and had an implicit intercept. The
runtime validates model schema, component order, input unit and intercept shape;
it cannot silently interpret one formula as the other. `manifest.json` selects
the published model, and exported reports include its ID, source hash and units.
JSON assets are revalidated on each run to avoid silently reusing an old model.

The conformance fixtures in `vbknethio_reference.json` contain a public example
from the author's converter and a synthetic input, with expected output evaluated
by the original JavaScript. Tests cover intercepts and the percentage conversion;
an additional audit compared the matrix implementation with both original scripts
over all 36 component basis vectors and synthetic mixtures.

**Conformance is not an independent accuracy estimate.** A source-matching formula
does not prove proximity to a direct G25 projection, and a small distance from
another simulator does not establish which estimate is more accurate. No held-out
accuracy statistics for this published coefficient set are claimed here. The
statistics below belong exclusively to the inactive custom fit.

## Legacy custom regression and validation (inactive)

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
