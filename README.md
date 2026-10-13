# G25 family calculator

## Family calculator

Open [calculator/index.html](calculator/index.html) in a browser. It works offline and needs no installation. Choose **2 parents**, **4 grandparents**, **8 great-grandparents**, or **16 great-great-grandparents**, then use **Choose** to search the bundled reference populations or **Paste** to enter a custom G25 row.

Fill every ancestor slot to calculate an offspring average. Its output label joins the ancestor names with `+`. If offspring is also entered, click any person (or use **Compare**) to select a comparison target. Clicking the offspring compares its entered coordinates with the calculated offspring. Clicking an ancestor compares their entered coordinates with the estimate inferred from the offspring and all other ancestors (`N × offspring − sum(other ancestors)` with equal weights). The selected row is highlighted and the output G25 row and all tables update for that person.

In the **2 parents** tab, the slots are **Mother** and **Father**. The small **Male** toggle changes their weights from 50%/50% to 51% mother and 49% father. The same weights apply when calculating offspring, a residual contribution, or a missing/selected parent. Other generation tabs keep equal weights.

The calculator shows up to 10 closest matches for both the entered and calculated selected person, with only that person's genetic distance in each table. These two lists rank all reference populations without a distance cutoff; the opposing target is included when it ranks in a top 10 list. Separate tables rank up to 10 smallest and largest values of AC − BC, AC / BC, and D3 = `(AC − BC) / (AC + BC)` across the selected modern, ancient, or combined reference set. Their shared distance slider starts at 10 and extends to the furthest AC or BC among the selected references; an entry appears only when both AC and BC are at or below the slider value. AC is the entered target's distance to a population; BC is the calculated target's distance. References with BC = 0 are excluded from ratio rankings, and rows with AC + BC = 0 are excluded from D3 rankings.

If offspring is entered and one or more ancestor slots are blank, the main output is their **combined residual contribution**: `offspring − sum(weight × known ancestor)`. With equal weights, each weight is `1/N`, where `N` is 2, 4, 8, or 16. Its label shows that subtraction, such as `Child-0.25*Pop1-0.25*Pop2` or `Child-0.0625*Pop1`. If exactly one ancestor is missing, its slot shows the full inferred coordinates (`residual / missing ancestor's weight`) and provides a Copy button. Several missing ancestors cannot be solved individually from these inputs. The inputs for each generation are retained while switching modes; **Clear all** resets them.

These results are coordinate arithmetic, not biological predictions of a specific person's DNA.
