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

    def test_global_pca7_has_current_groups_and_source_coordinates(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        by_label = {row[1]: row for row in modern}
        west_asia = read_global_modern_pcas(modern)[6]["references"]
        self.assertEqual(list(dict.fromkeys(row[1].split(":", 1)[0] for row in west_asia)),
                         ["North Caucasus", "Turk Anatolia", "Turk East Anatolia",
                          "Turk Azerbaijan", "Iranic West", "Armenian", "Georgia"])
        for group, prefix in (("North Caucasus", "Avar_"),
                              ("Turk Anatolia", "Turkish_"),
                              ("Turk East Anatolia", "Turkish_"),
                              ("Turk Azerbaijan", "Azeri_"),
                              ("Iranic West", "Kurdish_"),
                              ("Armenian", "Armenian_"),
                              ("Georgia", "Georgian_")):
            self.assertTrue(any(row[1].startswith(f"{group}:{prefix}") for row in west_asia))
        self.assertEqual(len({row[1] for row in west_asia}), len(west_asia))
        for row in west_asia:
            self.assertEqual(row[2:], by_label[row[1].split(":", 1)[1]][2:])

    def test_global_modern_maps_have_requested_regions_and_valid_anchors(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        by_label = {row[1]: row for row in modern}
        pcas = read_global_modern_pcas(modern)
        self.assertEqual([pca["title"] for pca in pcas],
                         ["Europe", "South Asia", "Central Asia and Siberia",
                          "Sub-Saharan Africa", "North Africa", "Middle East", "West Asia",
                          "East Asia", "Southeast Asia", "Australia and Pacific",
                          "Indigenous America"])
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
