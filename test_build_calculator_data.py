import tempfile
import unittest
from pathlib import Path

from build_calculator_data import (ROOT, read_global_modern_pcas, read_modern_pcas,
                                   read_rows, rebuild_mixed_pca)


class ReadRowsTests(unittest.TestCase):
    def read(self, text, category="ancient"):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "references.txt"
            path.write_text(text, encoding="utf-8")
            return read_rows(path, category)

    def test_mixed_plain_and_category_prefixed_rows_preserve_coordinates(self):
        values = [str((index - 12) / 1000) for index in range(25)]
        coordinates = ",".join(values)
        rows = self.read(f'Plain,{coordinates}\nancient,"With, comma",{coordinates}\n')
        self.assertEqual(rows, [
            ["ancient", "Plain", *map(float, values)],
            ["ancient", "With, comma", *map(float, values)],
        ])

    def test_wrong_category_and_missing_or_nonfinite_coordinates_are_rejected(self):
        coordinates = ",".join(["0"] * 25)
        for text in [f"modern,Wrong,{coordinates}", "Missing,0", f"Nonfinite,nan,{','.join(['0'] * 24)}"]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                self.read(text)

    def test_modern_pca_config_uses_matching_main_dataset_coordinates(self):
        coordinates = ",".join(["0"] * 25)
        modern = [["modern", "Sample", *([0.0] * 25)]]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "turkish_pca_config.txt").write_text(
                '{"modern":[{"id":"regional","title":"Region","file":"regional.g25.txt"}]}',
                encoding="utf-8")
            (path / "regional.g25.txt").write_text(
                "".join(f"Group:{name},{coordinates}\n" for name in ("One", "Two", "Three")),
                encoding="utf-8")
            self.assertEqual(read_modern_pcas(modern, path)[0]["anchorLabels"], ["Sample"])
            (path / "regional.g25.txt").write_text(
                "".join(f"Group:{name},{coordinates}\n" for name in ("One", "Two")) +
                "Group:Other," + ",".join(["1"] * 25), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "not in the Turkish modern dataset"):
                read_modern_pcas(modern, path)
            (path / "regional.g25.txt").write_text(
                "".join(f"Group:{name},{coordinates}\n" for name in ("One", "Two", "Three")),
                encoding="utf-8")
            (path / "other.g25.txt").write_text(
                "".join(f"Group:{name},{coordinates}\n" for name in ("Four", "Five", "Six")),
                encoding="utf-8")
            (path / "turkish_pca_config.txt").write_text(
                '{"modern":[{"id":"regional","title":"Region","file":"regional.g25.txt"},'
                '{"id":"other","title":"Other","file":"other.g25.txt"}]}',
                encoding="utf-8")
            shared = read_modern_pcas(modern, path)
            self.assertEqual([pca["anchorLabels"] for pca in shared], [["Sample"], ["Sample"]])
            (path / "turkish_pca_config.txt").write_text(
                '{"modern":[{"id":"regional","title":"Region","file":"regional.g25.txt"},'
                '{"id":"other","title":"Other","file":"regional.g25.txt"}]}',
                encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Duplicate modern PCA file"):
                read_modern_pcas(modern, path)
            (path / "turkish_pca_config.txt").write_text(
                '{"modern":[{"id":"regional","title":"Region","file":"regional.g25.txt"}]}',
                encoding="utf-8")
            (path / "regional_deep.g25.txt").write_text(
                f"Group: Inner: One,{coordinates}\n", encoding="utf-8")
            self.assertEqual(read_modern_pcas(modern, path)[0]["deepReferenceAnchors"], ["Sample"])
            (path / "regional_deep.g25.txt").write_text(
                f"Other: Inner: One,{coordinates}\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unknown main PCA group"):
                read_modern_pcas(modern, path)

            (path / "regional_deep.g25.txt").write_text(
                f"Group: Inner: One,{coordinates}\n"
                f"deprecated: Old region: Retired,{','.join(['1'] * 25)}\n"
                f"Deprecated: Another retired,{','.join(['2'] * 25)}\n",
                encoding="utf-8")
            active = read_modern_pcas(modern, path)[0]
            self.assertEqual([row[1] for row in active["deepReferences"]],
                             ["Group: Inner: One"])
            self.assertEqual(active["deepReferenceAnchors"], ["Sample"])
            (path / "regional_deep.g25.txt").write_text(
                f"deprecated: Old region: Retired,{','.join(['1'] * 25)}\n",
                encoding="utf-8")
            self.assertNotIn("deepReferences", read_modern_pcas(modern, path)[0])

    def test_mixed_pca_rebuilds_from_regular_maps_without_istanbul(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "mixed.txt"
            pcas = [{"id": "west", "title": "Batı Anadolu", "references": [
                ["modern", "Türk_Orta_Karadeniz:One", *([1.0] * 25)],
                ["modern", "Türk_Orta_Karadeniz:Two", *([3.0] * 25)],
                ["modern", "Rum:Three", *([4.0] * 25)],
            ]}, {"id": "istanbul", "title": "İstanbul", "references": [
                ["modern", "Türk:Four", *([9.0] * 25)],
            ]}]
            self.assertEqual(rebuild_mixed_pca(pcas, output), 2)
            rows = read_rows(output, "modern")
            self.assertEqual([row[1] for row in rows],
                             ["Batı_Anadolu:Türk_Orta_Karadeniz", "Batı_Anadolu:Rum"])
            self.assertEqual([row[2] for row in rows], [2.0, 4.0])

    def test_saved_mixed_pca_matches_current_sources(self):
        modern = read_rows(ROOT / "data" / "turkish_modern_g25.txt", "modern")
        pcas = read_modern_pcas(modern)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "mixed.txt"
            rebuild_mixed_pca(pcas, output)
            saved = ROOT / "data" / "pca" / "turkish_modern_pca_mixed.g25.txt"
            self.assertEqual(saved.read_text(encoding="utf-8"), output.read_text(encoding="utf-8"))

    def test_saved_global_mixed_pca_matches_all_global_maps(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        pcas = read_global_modern_pcas(modern)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "mixed.txt"
            rebuilt = rebuild_mixed_pca(pcas, output, frozenset())
            saved = ROOT / "data" / "pca" / "modern_pca_mixed.g25.txt"
            self.assertEqual(saved.read_text(encoding="utf-8"), output.read_text(encoding="utf-8"))
            rows = read_rows(saved, "modern")
            self.assertEqual(len(rows), rebuilt)
            self.assertEqual({row[1].split(":", 1)[0] for row in rows},
                             {pca["title"].replace(" ", "_") for pca in pcas})

    def test_global_west_asia_and_turkic_maps_have_current_groups(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        by_label = {row[1]: row for row in modern}
        pcas = read_global_modern_pcas(modern)
        west_asia = pcas[6]["references"]
        self.assertEqual(list(dict.fromkeys(row[1].split(":", 1)[0] for row in west_asia)),
                         ["North Caucasus", "Iranic West", "Armenian", "Georgia",
                          "Arabian Peninsula", "Levant", "Mesopotamia"])
        for group, prefix in (("North Caucasus", "Avar_"),
                              ("Iranic West", "Kurdish_"),
                              ("Armenian", "Armenian_"),
                              ("Georgia", "Georgian_"),
                              ("Arabian Peninsula", "Saudi_Arab_"),
                              ("Levant", "Palestinian_Arab_"),
                              ("Mesopotamia", "Iraqi_Arab_")):
            self.assertTrue(any(row[1].startswith(f"{group}:{prefix}") for row in west_asia))
        self.assertEqual(len({row[1] for row in west_asia}), len(west_asia))
        for row in west_asia:
            self.assertEqual(row[2:], by_label[row[1].split(":", 1)[1]][2:])
        turkic = pcas[11]["references"]
        groups = {}
        for row in turkic:
            group, label = row[1].split(":", 1)
            groups.setdefault(group, set()).add(label)
        self.assertEqual(list(groups), ["Turk East", "Turk Anatolia", "Turk Iraq",
                                        "Turk Balkans", "Turk Island",
                                        "Turk Azerbaijan", "Turk Iran", "Turk Yoruk Cepni"])
        self.assertIn("Turkish_Artvin_(n=7)", groups["Turk East"])
        self.assertGreaterEqual(len(groups["Turk Balkans"]), 4)
        self.assertGreaterEqual(len(groups["Turk Island"]), 4)
        self.assertIn("Turkish_East_Thrace_Edirne_(n=2)", groups["Turk Balkans"])
        self.assertIn("Turkish_North_Macedonia_(n=15)", groups["Turk Balkans"])
        self.assertIn("Turkish_Cyprus_(n=33)", groups["Turk Island"])
        self.assertIn("Turkish_Dodecanese_(n=2)", groups["Turk Island"])
        self.assertIn("Greek_Crete_Muslim_(Cretan_Turk)_(n=8)", groups["Turk Island"])
        self.assertIn("Iraqi_Turkmen_(n=18)", groups["Turk Iraq"])
        self.assertIn("Azeri_Iran_East_Azerbaijan_Tabriz_(n=6)", groups["Turk Iran"])
        self.assertIn("Azeri_Azerbaijan_(n=6)", groups["Turk Azerbaijan"])
        self.assertIn("Turkish_Manisa_Yörük_(n=9)", groups["Turk Yoruk Cepni"])
        self.assertEqual({row[1].split(":", 1)[1] for row in west_asia} &
                         {row[1].split(":", 1)[1] for row in turkic},
                         {"Iraqi_Turkmen_(n=18)", "Turkish_Cyprus_(n=33)"})

    def test_global_pca12_deep_covers_turkish_azeri_and_related_populations(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        source = {row[1]: row[2:] for row in modern}
        pca12 = read_rows(ROOT / "data" / "pca" / "modern_pca12.g25.txt", "modern")
        anchors = {row[1].split(":", 1)[1]: row[1].split(":", 1)[0] for row in pca12}
        deep = read_rows(ROOT / "data" / "pca" / "modern_pca12_deep.g25.txt", "modern")
        deprecated = [row for row in deep if row[1].split(":", 1)[0].strip().casefold() == "deprecated"]
        active_deep = [row for row in deep if row[1].split(":", 1)[0].strip().casefold() != "deprecated"]
        pcas = read_global_modern_pcas(modern)
        self.assertEqual(pcas[11]["deepReferences"], active_deep)
        self.assertEqual(pcas[11]["deepReferenceAnchors"],
                         [row[1].split(": ")[-1] for row in active_deep])
        self.assertTrue(all("deepReferences" not in pca for pca in pcas[:11]))
        labels = set()
        for row in active_deep:
            parts = row[1].split(": ")
            self.assertEqual(len(parts), 3, row[1])
            group, subregion, label = parts
            self.assertTrue(group and subregion)
            self.assertNotIn(label, labels)
            labels.add(label)
            self.assertEqual(row[2:], source[label], label)
            if label in anchors:
                self.assertEqual(group, anchors[label], label)
        self.assertTrue(set(anchors) <= labels)
        self.assertTrue(any(row[1].startswith("Turk Balkans: Thrace: ") for row in deep))
        self.assertTrue(any(row[1].startswith("Turk Island: Cyprus: ") for row in deep))
        self.assertTrue(any(row[1].startswith("Turk Island: Aegean Islands: ") for row in deep))
        self.assertTrue(any(row[1].startswith("Turk Island: Crete: ") for row in deep))
        related = {"Iraqi_Turkmen_(n=18)", "Karapapakh_Turkey_Ardahan_(n=3)",
                   "Karapapakh_Turkey_Iğdır_(n=1)", "Karapapakh_Turkey_Kars_(n=3)",
                   "Khamseh_Turkic_(n=1)", "Khorasani_Turk_(n=2)",
                   "Qashqai_(n=1)", "Turkmen_Golestan_(n=8)"}
        expected = {label for label in source if label.startswith(("Turkish_", "Azeri_"))}
        expected.add("Greek_Crete_Muslim_(Cretan_Turk)_(n=8)")
        deprecated_labels = {row[1].rsplit(":", 1)[-1].strip() for row in deprecated}
        self.assertEqual(labels, (expected | related) - deprecated_labels)

    def test_global_modern_maps_have_requested_regions_and_valid_anchors(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        by_label = {row[1]: row for row in modern}
        pcas = read_global_modern_pcas(modern)
        self.assertEqual([pca["title"] for pca in pcas],
                         ["Europe", "South Asia", "Central Asia and Siberia",
                          "Sub-Saharan Africa", "North Africa", "Jewish", "West Asia and Caucasus",
                          "East Asia", "Southeast Asia", "Australia and Pacific",
                          "Indigenous America", "West Turkistan"])
        europe = pcas[0]
        groups = list(dict.fromkeys(row[1].split(":", 1)[0] for row in europe["references"]))
        self.assertEqual(groups, ["French", "Iberia", "Italy", "Germanic", "Scandinavian",
                                  "British Isles", "Greek Albanian", "Balkan", "Sardinian",
                                  "Roma", "Slav", "Balto-Finnic"])
        self.assertTrue(any(row[1].startswith("Greek Albanian:Greek_") for row in europe["references"]))
        self.assertEqual([row[1] for row in europe["references"]
                          if row[1].startswith("Greek Albanian:Albanian_")],
                         ["Greek Albanian:Albanian_(n=13)"])
        self.assertTrue(any(row[1].startswith("Balkan:Hungarian_") for row in europe["references"]))
        self.assertTrue(any(row[1].startswith("Balkan:Serb_") for row in europe["references"]))
        self.assertFalse(any(row[1].startswith(("Balkan:Greek_", "Balkan:Albanian_"))
                             for row in europe["references"]))
        labels_by_group = {}
        for row in europe["references"]:
            group, label = row[1].split(":", 1)
            labels_by_group.setdefault(group, set()).add(label)
        for prefix in ("Bosniak", "Bulgarian", "Croat", "Hungarian", "Romanian", "Serb"):
            with self.subTest(prefix=prefix):
                self.assertEqual(sum(label.startswith(prefix + "_")
                                     for label in labels_by_group["Balkan"]), 1)
        self.assertGreater(sum(label.startswith("Italian_")
                               for label in labels_by_group["Italy"]), 10)
        self.assertGreater(sum(row[1].startswith("Germanic:German_")
                               for row in europe["references"]), 3)
        self.assertEqual(len(labels_by_group["Sardinian"]), 4)
        self.assertTrue({"English_(n=44)", "Irish_(n=106)", "Scottish_(n=41)",
                         "Welsh_(n=22)"} <= labels_by_group["British Isles"])
        self.assertEqual(len(labels_by_group["French"]), 8)
        self.assertTrue({"French_(n=64)",
                         "French_Hauts-de-France_Nord_(n=39)",
                         "French_Occitanie_Haute-Garonne_(n=37)",
                         "French_Île-de-France_Paris_(n=11)"} <= labels_by_group["French"])
        self.assertIn("Corsican_(n=14)", labels_by_group["Italy"])
        self.assertIn("Roma_Serbia_(n=7)", labels_by_group["Roma"])
        self.assertTrue({"Polish_(n=68)", "Russian_(n=4)",
                         "Ukrainian_(n=25)"} <= labels_by_group["Slav"])
        self.assertTrue({"Finnish_(n=53)", "Estonian_(n=11)",
                         "Latvian_(n=24)", "Lithuanian_(n=5)"}
                        <= labels_by_group["Balto-Finnic"])
        south_asia = {label for row in pcas[1]["references"]
                      for label in [row[1].split(":", 1)[1]]}
        east_asia = {label for row in pcas[7]["references"]
                     for label in [row[1].split(":", 1)[1]]}
        for prefix in ("Tibetan", "Sherpa", "Tamang", "Gurung", "Garo", "Khasi", "Tripuri"):
            with self.subTest(prefix=prefix):
                self.assertTrue(any(label.startswith(prefix + "_") for label in east_asia))
                self.assertFalse(any(label.startswith(prefix + "_") for label in south_asia))
        self.assertTrue(any(row[1].startswith("Horn of Africa:Somali_")
                            for row in pcas[3]["references"]))
        self.assertTrue(any(row[1].startswith("Amazigh:Berber_")
                            for row in pcas[4]["references"]))
        self.assertTrue(any(row[1].startswith("Jewish communities:Ashkenazi_Jew_")
                            for row in pcas[5]["references"]))
        self.assertEqual({row[1].split(":", 1)[0] for row in pcas[5]["references"]},
                         {"Jewish communities"})
        self.assertTrue(any(row[1].startswith("Sinic:Han_")
                            for row in pcas[7]["references"]))
        self.assertTrue(any(row[1].startswith("Mainland Tai:Thai_")
                            for row in pcas[8]["references"]))
        self.assertTrue(any(row[1].startswith("Papua:Papuan_")
                            for row in pcas[9]["references"]))
        self.assertTrue(any(row[1].startswith("Andes:Quechua_")
                            for row in pcas[10]["references"]))
        for pca in pcas:
            self.assertEqual(len(pca["references"]), len(pca["referenceAnchors"]))
            self.assertEqual(len({row[1].split(":", 1)[1] for row in pca["references"]}),
                             len(pca["references"]))
            self.assertFalse(any("mixed" in row[1].lower() for row in pca["references"]),
                             f"{pca['title']} contains a mixed-profile reference")
            for row, anchor in zip(pca["references"], pca["referenceAnchors"]):
                self.assertEqual(row[2:], by_label[anchor][2:])


if __name__ == "__main__":
    unittest.main()
