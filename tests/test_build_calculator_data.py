import tempfile
import unittest
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from build.build_calculator_data import (ROOT, build_neolithic_data, build_ydnatr, read_global_ancient_rows,
                                         read_global_modern_pcas,
                                         read_modern_pcas, read_neolithic_data, read_rows, read_ydnatr_data,
                                         rebuild_mixed_pca)


class ydnatrDataTests(unittest.TestCase):
    def test_period_files_build_complete_oracle_and_health(self):
        k12b, health = read_ydnatr_data()
        self.assertEqual(len(k12b["sets"]["yakinlik1"]["modern"]), 521)
        self.assertEqual(len(k12b["sets"]["yakinlik1"]["ancient"]), 150)
        self.assertEqual(len(k12b["sets"]["yakinlik2tr"]["modern"]), 650)
        self.assertEqual(len(k12b["sets"]["yakinlik2tr"]["ancient"]), 150)
        self.assertEqual(len(k12b["sets"]["ikili1"]["ancient"]), 150)
        self.assertEqual(k12b["sets"]["ikili2tr"]["ancient"], [])
        self.assertEqual(len(health["variants"]), 97)
        with tempfile.TemporaryDirectory() as directory:
            k12b_output = Path(directory) / "k12b_data.js"
            health_output = Path(directory) / "health_data.js"
            build_ydnatr(k12b_output=k12b_output, health_output=health_output)
            self.assertEqual(k12b_output.read_bytes(), (ROOT / "calculator" / "k12b_data.js").read_bytes())
            self.assertEqual(health_output.read_bytes(), (ROOT / "calculator" / "health_data.js").read_bytes())


class NeolithicDataTests(unittest.TestCase):
    def test_editable_neolithic_groups_build_from_the_matching_ancient_datasets(self):
        data = read_neolithic_data()
        for scope, filename in (("turkish", "turkish_neolithic_g25.txt"),
                                ("global", "neolithic_g25.txt")):
            self.assertTrue(data[scope])
            selected_rows = read_rows(ROOT / "data" / filename, "ancient")
            self.assertEqual([entry["name"] for entry in data[scope]],
                             list(dict.fromkeys(row[1].partition(":")[0] for row in selected_rows)))
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "neolithic_references.js"
            build_neolithic_data(output=output)
            self.assertEqual(output.read_bytes(), (ROOT / "calculator" / "neolithic_references.js").read_bytes())

    def test_selected_txt_coordinates_must_match_the_source_dataset(self):
        with tempfile.TemporaryDirectory() as directory:
            data_directory = Path(directory)
            for filename in ("turkish_neolithic_g25.txt", "neolithic_g25.txt",
                             "turkish_ancient_g25.txt", "ancient_g25.txt"):
                (data_directory / filename).symlink_to(ROOT / "data" / filename)
            selected = data_directory / "neolithic_g25.txt"
            selected.unlink()
            lines = (ROOT / "data" / "neolithic_g25.txt").read_text(encoding="utf-8").splitlines()
            parts = lines[0].split(",")
            parts[1] = str(float(parts[1]) + 0.01)
            lines[0] = ",".join(parts)
            selected.write_text("\n".join(lines) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "does not match ancient_g25.txt"):
                read_neolithic_data(data_directory)


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

    def test_global_ancient_source_includes_the_rows_after_tanzania(self):
        rows = read_global_ancient_rows()
        self.assertEqual(len(rows), 4365)
        self.assertEqual(rows[-1][1], "Zambia_LSA_(low_res)_(n=1)")
        self.assertIn("Tanzania_Pastoral_N_(n=5)", {row[1] for row in rows})
        bundle = (ROOT / "calculator" / "references.js").read_text(encoding="utf-8")
        bundled_rows = json.loads(bundle.removeprefix("window.G25_REFERENCES = ").rstrip(";\n"))
        self.assertEqual([row for row in bundled_rows if row[0] == "ancient"], rows)
        with tempfile.TemporaryDirectory() as directory:
            truncated = Path(directory) / "ancient_g25.txt"
            truncated.write_text("\n".join(",".join([row[1], *map(str, row[2:])])
                                           for row in rows[:10]), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "incomplete"):
                read_global_ancient_rows(truncated)

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
            main = "Main:\n" + "".join(
                f"Group:{name},{coordinates}\n" for name in ("One", "Two", "Three"))
            (path / "regional.g25.txt").write_text(
                main + f"Deep:\nGroup: Sample,{coordinates}\n", encoding="utf-8")
            self.assertEqual(read_modern_pcas(modern, path)[0]["deepReferenceAnchors"], ["Sample"] * 4)
            (path / "regional.g25.txt").write_text(
                main + f"Deep:\nOther: Sample,{coordinates}\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unknown main PCA group"):
                read_modern_pcas(modern, path)

            (path / "regional.g25.txt").write_text(
                main + f"Deep:\nGroup: Inner: Sample,{coordinates}\n",
                encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "expected Group: Population"):
                read_modern_pcas(modern, path)
            (path / "regional.g25.txt").write_text(main + "Deep:\n", encoding="utf-8")
            self.assertEqual(read_modern_pcas(modern, path)[0]["deepReferenceAnchors"], ["Sample"] * 3)
            (path / "regional.g25.txt").write_text(main.removeprefix("Main:\n"), encoding="utf-8")
            self.assertNotIn("deepReferences", read_modern_pcas(modern, path)[0])

    def test_pca_sections_keep_main_separate_and_deduplicate_the_deep_union(self):
        coordinates = ",".join(["0"] * 25)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "regional.g25.txt"
            path.write_text(f"Main:\nGroup:One,{coordinates}\n\nDeep:\n"
                            f"Group: One,{coordinates}\nGroup: Two,{coordinates}\n")
            self.assertEqual([row[1] for row in read_rows(path, "modern")], ["Group:One"])
            self.assertEqual([row[1] for row in read_rows(path, "modern", section="deep")],
                             ["Group: One", "Group: Two"])
            path.write_text(f"Main:\nGroup:One,{coordinates}\nDeep:\n")
            self.assertEqual([row[1] for row in read_rows(path, "modern", section="deep")],
                             ["Group: One"])
            path.write_text(f"Main:\nGroup:One,{coordinates}\nDeep:\nGroup: One," +
                            ",".join(["1"] * 25) + "\n")
            with self.assertRaisesRegex(ValueError, "conflicting coordinates"):
                read_rows(path, "modern", section="deep")

    def test_pca_section_headers_must_be_in_order_and_unique(self):
        coordinates = ",".join(["0"] * 25)
        for text in ("Deep:\n", "Main:\nMain:\n", "Main:\nDeep:\nDeep:\n",
                     "Main:\nDeep Mixed:\n", "Main:\nDeep:\nDeep Mixed:\nDeep Mixed:\n",
                     f"Group:One,{coordinates}\nMain:\n"):
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, "Main:, Deep:, then Deep Mixed:"):
                self.read(text, "modern")

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

    def test_global_caucasus_levant_and_turkic_maps_have_current_groups(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        by_label = {row[1]: row for row in modern}
        pcas = read_global_modern_pcas(modern)
        caucasus = pcas[6]["references"]
        levant_mesopotamia = pcas[17]["references"]
        self.assertEqual(pcas[6]["title"], "Caucasus")
        self.assertEqual(pcas[17]["title"], "Levant and Mesopotamia")
        self.assertEqual(list(dict.fromkeys(row[1].split(":", 1)[0] for row in caucasus)),
                         ["Armenia", "Ciscaucasia", "Transcaucasia", "Georgia South", "Georgia"])
        self.assertEqual(list(dict.fromkeys(row[1].split(":", 1)[0] for row in levant_mesopotamia)),
                         ["Levant", "Mesopotamia"])
        for group, prefix, rows in (("Ciscaucasia", "Avar_", caucasus),
                                    ("Ciscaucasia", "Circassian_", caucasus),
                                    ("Transcaucasia", "Andi_(Transcaucasian_Profile)", caucasus),
                                    ("Transcaucasia", "Karata_(Transcaucasian_Profile)", caucasus),
                                    ("Armenia", "Armenian_", caucasus),
                                    ("Armenia", "Armenian_Artsakh_", caucasus),
                                    ("Georgia", "Mingrelian_", caucasus),
                                    ("Georgia South", "Georgian_Kartlian_", caucasus),
                                    ("Transcaucasia", "Georgian_Tushetian_", caucasus),
                                    ("Transcaucasia", "Georgian_Khevsurian_", caucasus),
                                    ("Georgia South", "Turkish_Meskhetian_", caucasus),
                                    ("Levant", "Palestinian_Arab_", levant_mesopotamia),
                                    ("Mesopotamia", "Iraqi_Arab_", levant_mesopotamia)):
            self.assertTrue(any(row[1].startswith(f"{group}:{prefix}") for row in rows))
        caucasus_labels = {row[1].split(":", 1)[1].strip() for row in pcas[6]["deepReferences"]}
        self.assertIn("Lak_(n=54)", caucasus_labels)
        self.assertIn("Nogai_Dagestan_(Ciscaucasian_Profile)_(n=3)", caucasus_labels)
        self.assertNotIn("Nogai_Dagestan_(n=3)", caucasus_labels)
        self.assertFalse(any(label.startswith(("Lak_Iran_", "Lak_Turkey_")) or
                             "Jew" in label for label in caucasus_labels))
        self.assertEqual(len({row[1] for row in caucasus + levant_mesopotamia}),
                         len(caucasus + levant_mesopotamia))
        for row in caucasus + levant_mesopotamia:
            self.assertEqual(row[2:], by_label[row[1].split(":", 1)[1].strip()][2:])
        turkic = pcas[11]["references"]
        groups = {}
        for row in turkic:
            group, label = row[1].split(":", 1)
            groups.setdefault(group, set()).add(label)
        self.assertEqual(list(groups), ["Azerbaijani", "Turk Northeast", "Turk East",
                                        "Turk Iraq", "Turk Anatolia",
                                        "Turk Anatolia (High Turkic)"])
        self.assertIn("Turkish_Artvin_(n=7)", groups["Turk Northeast"])
        self.assertIn("Iraqi_Turkmen_(n=18)", groups["Turk Iraq"])
        self.assertIn("Azeri_Iran_East_Azerbaijan_Tabriz_(n=6)", groups["Azerbaijani"])
        self.assertIn("Azeri_Azerbaijan_(n=6)", groups["Azerbaijani"])
        self.assertIn("Turk Anatolia (High Turkic): Turkish_Manisa_Yörük_(n=9)",
                      {row[1] for row in pcas[11]["deepReferences"]})
        self.assertIn("Turkish_Manisa_Çepni_(n=1)", groups["Turk Anatolia (High Turkic)"])
        self.assertIn("Turkish_Bursa_(n=6)", groups["Turk Anatolia (High Turkic)"])
        self.assertIn("Turkish_Kayseri_(n=35)", groups["Turk Anatolia"])
        self.assertEqual({row[1].split(":", 1)[1] for row in levant_mesopotamia} &
                         {row[1].split(":", 1)[1] for row in turkic},
                         {"Iraqi_Turkmen_(n=18)"})

    def test_global_pca12_deep_covers_turkish_azeri_and_related_populations(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        source = {row[1]: row[2:] for row in modern}
        pca12 = read_rows(ROOT / "data" / "pca" / "modern_pca12.g25.txt", "modern")
        anchors = {row[1].split(":", 1)[1].strip(): row[1].split(":", 1)[0] for row in pca12}
        deep = read_rows(ROOT / "data" / "pca" / "modern_pca12.g25.txt", "modern", section="deep")
        pcas = read_global_modern_pcas(modern)
        self.assertEqual(pcas[11]["deepReferences"], deep)
        self.assertEqual(pcas[11]["deepReferenceAnchors"],
                         [row[1].split(": ")[-1] for row in deep])
        labels = set()
        for row in deep:
            parts = row[1].split(": ")
            self.assertEqual(len(parts), 2, row[1])
            group, label = parts
            self.assertTrue(group)
            self.assertNotIn(label, labels)
            labels.add(label)
            self.assertEqual(row[2:], source[label], label)
            if label in anchors:
                self.assertEqual(group, anchors[label], label)
        self.assertTrue(set(anchors) <= labels)
        related = {"Iraqi_Turkmen_(n=18)", "Karapapakh_Turkey_Ardahan_(n=3)",
                   "Karapapakh_Turkey_Iğdır_(n=1)", "Karapapakh_Turkey_Kars_(n=3)",
                   "Khamseh_Turkic_(n=1)", "Khorasani_Turk_(n=2)",
                   "Qashqai_(n=1)", "Turkmen_Golestan_(n=8)"}
        expected = {label for label in source if label.startswith(("Turkish_", "Azeri_"))}
        expected.add("Greek_Crete_Muslim_(Cretan_Turk)_(n=8)")
        self.assertTrue(labels <= expected | related)
        self.assertTrue(set(anchors) <= labels)

    def test_south_asia_pca_uses_distinct_genetic_groups(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        pca = next(pca for pca in read_global_modern_pcas(modern)
                   if pca["id"] == "global-south-asia")
        main = {row[1].split(":", 1)[1]: row[1].split(":", 1)[0]
                for row in pca["references"]}
        deep = {row[1].split(": ", 1)[1]: row[1].split(":", 1)[0]
                for row in pca["deepReferences"]}
        self.assertEqual(set(main.values()), {
            "Punjab and North India", "Central India and Deccan", "Bengal-Assam", "South India-Sri Lanka",
            "South/West Dalit-Adivasi", "Gond-Kurukh", "Eastern Adivasi"})
        self.assertEqual(len(main), len(pca["references"]))
        self.assertEqual(len(deep), len(pca["deepReferences"]))
        self.assertTrue(all(deep.get(label) == group for label, group in main.items()))
        self.assertFalse(any(label.startswith(("Hazara_", "Rajbanshi_", "Balochi_", "Brahui_", "Makrani_"))
                             for label in main | deep))
        self.assertFalse(any(label.startswith("Pashtun_") and not label.startswith("Pashtun_India_")
                             for label in main | deep))
        for label, group in (
            ("Punjabi_Jat_Sikh_(n=60)", "Punjab and North India"),
            ("Kashmiri_Pandit_(n=26)", "Punjab and North India"),
            ("Bengali_Bangladesh_(n=90)", "Bengal-Assam"),
            ("Tamil_Brahmin_Iyer_Tamil_Nadu_(n=24)", "Central India and Deccan"),
            ("Sinhalese_(n=16)", "South India-Sri Lanka"),
            ("Gond_Chhattisgarh_(n=9)", "Gond-Kurukh"),
            ("Munda_(n=5)", "Eastern Adivasi"),
            ("Khond_(n=14)", "Eastern Adivasi"),
        ):
            self.assertEqual(main[label], group)
        source_deep = read_rows(ROOT / "data" / "pca" / "modern_pca2.g25.txt", "modern", section="deep")
        deprecated = {row[1].split(": ", 1)[1] for row in source_deep
                      if row[1].startswith("Deprecated: ")}
        self.assertEqual(deprecated, {
            "Balochi_Pakistan_(Siddi-Mixed)_(n=3)",
            "Brahui_(Siddi-Mixed)_(n=2)",
            "Makrani_(Siddi-Mixed)_(n=4)",
            "Sindhi_(Siddi-Mixed)_(n=2)"})
        self.assertTrue(deprecated.isdisjoint(deep))

    def test_iranic_pca_covers_source_without_ossetians(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        source = {row[1] for row in modern}
        pca = next(pca for pca in read_global_modern_pcas(modern)
                   if pca["id"] == "global-iranic")
        main = {row[1].split(":", 1)[1]: row[1].split(":", 1)[0]
                for row in pca["references"]}
        deep = {row[1].split(": ", 1)[1]: row[1].split(":", 1)[0]
                for row in pca["deepReferences"]}
        self.assertEqual(set(main.values()), {
            "Kurdish", "Persian and Lur", "Caspian and Tati", "Baloch and Makran",
            "Pashtun", "Tajik", "Pamir and Yaghnob"})
        self.assertTrue(all(deep.get(label) == group for label, group in main.items()))
        self.assertFalse(any(label.startswith("Ossetian_") for label in main | deep))
        iranian_language_prefixes = (
            "Kurdish_", "Lak_Iran_", "Yazidi_", "Yarsani_", "Shabak_",
            "Persian_", "Lur_", "Parsi_", "Ajam_",
            "Gilak_", "Mazandarani_", "Talysh_", "Tat_", "Tatavi_",
            "Balochi_", "Makrani_", "Pashtun_", "Ormur_",
            "Tajik_", "Pamiri_", "Wakhi_", "Yaghnobi_", "Hazara_")
        excluded = {"Hazara_Afghanistan_(n=8)", "Hazara_Pakistan_(n=24)", "Tatavi_(n=3)",
                    "Pashtun_India_Uttarakhand_(n=1)",
                    "Pashtun_India_Madhya_Pradesh_(n=2)",
                    "Pashtun_India_Uttar_Pradesh_(n=5)"}
        self.assertEqual(set(deep), ({label for label in source
                                      if label.startswith(iranian_language_prefixes)
                                      and "Mixed" not in label and "_Jew_" not in label} |
                                     {"Brahui_(n=23)"}) - excluded)
        for label, group in (
            ("Kurdish_(n=19)", "Kurdish"),
            ("Balochi_Pakistan_(n=17)", "Baloch and Makran"),
            ("Brahui_(n=23)", "Baloch and Makran"),
            ("Pashtun_Durrani_(n=13)", "Pashtun"),
            ("Tajik_(n=16)", "Tajik"),
        ):
            self.assertIn(label, source)
            self.assertEqual(deep[label], group)

    def test_global_pca13_deep_covers_its_main_groups_and_ethnicities(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        source = {row[1]: row[2:] for row in modern}
        pca = next(pca for pca in read_global_modern_pcas(modern)
                   if pca["id"] == "global-northwest-europe")
        main = {row[1].split(":", 1)[1]: row[1].split(":", 1)[0]
                for row in pca["references"]}
        expected_groups = {"Germanic East", "Germanic West", "Germanic South",
                           "Scandinavian", "British Isles", "France North"}
        self.assertEqual(set(main.values()), expected_groups)
        self.assertEqual(len(main), len(pca["references"]))
        self.assertGreaterEqual(len(pca["deepReferences"]), 141)
        deep = {}
        for row in pca["deepReferences"]:
            group, label = row[1].split(": ", 1)
            self.assertIn(group, expected_groups)
            self.assertNotIn(label, deep)
            self.assertEqual(row[2:], source[label], label)
            deep[label] = group
        self.assertTrue(set(main) <= set(deep))
        self.assertTrue(all(deep[label] == group for label, group in main.items()))
        self.assertEqual(set(deep.values()), expected_groups)

    def test_french_regions_are_split_between_north_and_south_europe(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        source = {row[1]: row[2:] for row in modern}
        pcas = {pca["id"]: pca for pca in read_global_modern_pcas(modern)}
        south = pcas["global-southwest-europe"]
        north = pcas["global-northwest-europe"]
        self.assertEqual(south["title"], "Southwest Europe")
        self.assertEqual(north["title"], "Northwest Europe")

        south_main = {row[1].split(":", 1)[1] for row in south["references"]
                      if row[1].startswith("South France:")}
        north_main = {row[1].split(":", 1)[1] for row in north["references"]
                      if row[1].startswith("France North:")}
        self.assertEqual(len(south_main), 8)
        self.assertEqual(len(north_main), 8)
        self.assertFalse(south_main & north_main)
        self.assertNotIn("French_(n=64)", south_main | north_main)

        south_deep = {row[1].split(": ", 1)[1]: row
                      for row in south["deepReferences"]
                      if row[1].startswith("South France: ")}
        north_deep = {row[1].split(": ", 1)[1]: row
                      for row in north["deepReferences"]
                      if row[1].startswith("France North: ")}
        self.assertGreaterEqual(len(south_deep), 31)
        self.assertGreaterEqual(len(north_deep), 33)
        self.assertIn("Swiss_French_(Romand)_(n=8)", south_deep)
        self.assertIn("Belgian_(n=311)", north_deep)
        self.assertIn("French_(n=64)", north_deep)
        self.assertFalse(south_deep.keys() & north_deep.keys())
        self.assertTrue(south_main <= south_deep.keys())
        self.assertTrue(north_main <= north_deep.keys())
        self.assertTrue(all(row[1].startswith("South France: ") for row in south_deep.values()))
        self.assertTrue(all(row[1].startswith("France North: ") for row in north_deep.values()))
        for label, row in (south_deep | north_deep).items():
            self.assertEqual(row[2:], source[label], label)

    def test_southwest_southeast_east_europe_and_uralic_maps_partition_references(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        source_labels = {row[1] for row in modern}
        pcas = {pca["id"]: pca for pca in read_global_modern_pcas(modern)}
        southwest = pcas["global-southwest-europe"]
        southeast = pcas["global-southeast-europe"]
        east_europe = pcas["global-northeast-europe"]
        uralic = pcas["global-west-siberia"]

        def groups(pca):
            return {row[1].split(":", 1)[0] for row in pca["references"]}

        def labels(pca, group, deep=False):
            rows = pca["deepReferences"] if deep else pca["references"]
            return {row[1].rsplit(":", 1)[1].strip() for row in rows
                    if row[1].split(":", 1)[0] == group}

        self.assertEqual(groups(southwest),
                         {"South France", "Basque", "Iberia", "Corsica", "Italy", "Sardinia"})
        self.assertEqual(groups(southeast), {"South Italy", "Albanian", "Greek",
                                             "Greek Asia Minor", "Balkans", "Turk Balkans",
                                             "Turk Thrace", "Crimea"})
        self.assertEqual(groups(east_europe),
                         {"Slavic", "Central Europe", "Baltic"})
        self.assertFalse(labels(southwest, "Italy") & labels(southeast, "South Italy"))
        self.assertFalse(labels(southwest, "Italy", True) &
                         labels(southeast, "South Italy", True))
        self.assertEqual({label for label in source_labels if label.startswith("Italian_")},
                         {label for label in labels(southwest, "Italy", True) |
                          labels(southwest, "Sardinia", True) |
                          labels(southeast, "South Italy", True)
                          if label.startswith("Italian_")})
        self.assertIn("Italian_Sardinia_(Sardinian)_(n=10)", labels(southwest, "Sardinia"))
        self.assertIn("Italian_Sicily_(Sicilian)_(n=2)", labels(southeast, "South Italy"))
        self.assertEqual({label for label in source_labels if label.startswith("Spanish_")},
                         {label for label in labels(southwest, "Iberia", True)
                          if label.startswith("Spanish_")})
        romance_prefixes = ("Moldovan_", "Romanian_", "Vlach_Aromanian_")
        slavic_balkan_prefixes = ("Bosniak_", "Bulgarian_", "Croat_", "Macedonian_",
                                  "Montenegrin_", "Pomak_", "Serb_", "Slovene_", "Torbeši_")
        central_balkan = ("Croat_", "Slovene_")
        for deep in (False, True):
            retained_balkan = {label for label in labels(east_europe, "Central Europe", deep) |
                              labels(east_europe, "Slavic", deep)
                              if label.startswith(central_balkan)}
            self.assertTrue(retained_balkan <= labels(southeast, "Balkans", deep))
        self.assertEqual(labels(southeast, "Balkans", True),
                         {label for label in source_labels
                          if label.startswith(slavic_balkan_prefixes + romance_prefixes)})
        central_slavic_prefixes = ("Belarusian_", "Russian_", "Ukrainian_", "Rusyn_",
                                  "Czech_", "Polish_", "Slovak_", "Slovincian_",
                                  "Kashubian_", "Sorb_", "Croat_", "Slovene_", "Hungarian_")
        central = labels(east_europe, "Central Europe", True)
        slavic = labels(east_europe, "Slavic", True)
        self.assertFalse(central & slavic)
        self.assertEqual(central | slavic,
                         {label for label in source_labels if label.startswith(central_slavic_prefixes)})
        for pca, group, prefixes in (
            (uralic, "Finnic", ("Estonian_", "Finnish_", "Ingrian_",
                                      "Karelian_", "Veps_", "Votian_",
                                      "Russian_Arkhangelsk_")),
            (east_europe, "Baltic", ("Estonian_", "Latvian_", "Lithuanian_")),
        ):
            self.assertEqual(labels(pca, group, True),
                             {label for label in source_labels if label.startswith(prefixes)})
        self.assertEqual({label for group in ("Greek", "Greek Asia Minor", "Turk Balkans", "Crimea")
                          for label in labels(southeast, group, True)
                          if label.startswith("Greek_")},
                         {label for label in source_labels if label.startswith("Greek_")})
        self.assertTrue({"Greek_Cappadocia_Kaisareia_(n=14)", "Greek_Pontus_(n=22)",
                         "Greek_Cyprus_(n=41)", "Greek_Cyclades_Andros_(n=7)"}
                        <= labels(southeast, "Greek Asia Minor"))
        self.assertTrue({"Greek_Crete_Muslim_(Cretan_Turk)_(n=8)",
                         "Turkish_Cyprus_(n=33)"} <= labels(southeast, "Greek Asia Minor"))
        self.assertTrue({"Turkish_Lesbos_(n=1)", "Turkish_Dodecanese_(n=2)",
                         "Turkish_East_Thrace_Edirne_(n=2)"}
                        <= labels(southeast, "Turk Thrace"))
        self.assertNotIn("Turkish_Thessaly_(n=3)", labels(southeast, "Turk Thrace"))
        southeast_deep_names = [row[1].split(":", 1)[1].strip()
                                for row in southeast["deepReferences"]]
        self.assertEqual(len(southeast_deep_names), len(set(southeast_deep_names)))
        self.assertTrue({"Czech_(n=175)", "Slovak_(n=6)", "Rusyn_Lemko_Poland_(n=4)",
                         "Hungarian_(n=23)", "Croat_(n=25)", "Slovene_(n=8)"} <=
                        labels(east_europe, "Central Europe"))
        self.assertTrue({"Polish_(n=68)", "Kashubian_(n=2)", "Sorb_Niederlausitz_(n=1)",
                         "Belarusian_(n=27)", "Ukrainian_(n=25)"} <=
                        labels(east_europe, "Slavic"))
        self.assertTrue({"Lithuanian_East_Aukštaitija_(n=78)",
                         "Finnish_North_(n=9)"} <=
                        (labels(east_europe, "Baltic", True) |
                         labels(uralic, "Finnic", True)))
        for pca in (southwest, southeast, east_europe):
            main = {row[1].split(":", 1)[0]: set() for row in pca["references"]}
            for row in pca["references"]:
                group, label = row[1].split(":", 1)
                main[group].add(label.strip())
            for group, group_labels in main.items():
                self.assertTrue(group_labels <= labels(pca, group, True))

    def test_southeast_greek_boundary_uses_peloponnese_and_crete(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        source = {row[1]: row[2:] for row in modern}
        pca = next(pca for pca in read_global_modern_pcas(modern)
                   if pca["id"] == "global-southeast-europe")
        peloponnese = source["Greek_Peloponnese_Arcadia_(n=34)"]
        crete = source["Greek_Crete_(n=16)"]
        self.assertLessEqual(len(pca["references"]), 60)
        main_groups = {row[1].split(":", 1)[1].strip(): row[1].split(":", 1)[0]
                       for row in pca["references"]}
        self.assertEqual(main_groups["Greek_Western_Anatolia_Smyrna_(n=9)"], "Greek")
        self.assertEqual(main_groups["Greek_Crete_Heraklion_(n=93)"], "Greek Asia Minor")
        for row in pca["deepReferences"]:
            group, label = (part.strip() for part in row[1].split(":", 1))
            if group not in {"Greek", "Greek Asia Minor"} or not label.startswith("Greek_"):
                continue
            expected = ("Greek" if math.dist(source[label], peloponnese) <
                        math.dist(source[label], crete) else "Greek Asia Minor")
            self.assertEqual(group, expected, label)

    def test_global_modern_maps_have_requested_regions_and_valid_anchors(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        by_label = {row[1]: row for row in modern}
        pcas = read_global_modern_pcas(modern)
        self.assertEqual([pca["title"] for pca in pcas],
                         ["Southwest Europe", "South Asia", "Central Asia and Siberia",
                          "Sub-Saharan Africa", "North Africa", "Jewish and Roma", "Caucasus",
                          "East Asia", "Southeast Asia", "Australia and Pacific",
                          "Indigenous America", "West Turkistan", "Northwest Europe",
                          "Northeast Europe", "Southeast Europe", "Arabian Peninsula", "Iranic",
                          "Levant and Mesopotamia", "West Siberia"])
        europe = pcas[0]
        groups = list(dict.fromkeys(row[1].split(":", 1)[0] for row in europe["references"]))
        self.assertEqual(groups, ["South France", "Basque", "Iberia", "Corsica",
                                  "Italy", "Sardinia"])
        labels_by_group = {}
        for row in europe["references"]:
            group, label = row[1].split(":", 1)
            labels_by_group.setdefault(group, set()).add(label)
        self.assertGreater(sum(label.startswith("Italian_")
                               for label in labels_by_group["Italy"]), 10)
        self.assertEqual(sum(label.startswith("Italian_Sardinia_")
                             for label in labels_by_group["Sardinia"]), 4)
        self.assertEqual(len(labels_by_group["South France"]), 8)
        self.assertTrue({"French_Auvergne-Rhône-Alpes_Puy-de-Dôme_(n=28)",
                         "French_Provence-Alpes-Côte_d'Azur_Bouches-du-Rhône_Marseille_(n=13)",
                         "French_Occitanie_Haute-Garonne_(n=37)",
                         "French_Nouvelle-Aquitaine_Pyrénées-Atlantiques_Béarn_(n=10)"}
                        <= labels_by_group["South France"])
        self.assertIn("Corsican_(n=14)", labels_by_group["Corsica"])
        south_asia = {label for row in pcas[1]["references"]
                      for label in [row[1].split(":", 1)[1]]}
        east_asia = {label for row in pcas[7]["references"]
                     for label in [row[1].split(":", 1)[1]]}
        for prefix in ("Tibetan", "Sherpa", "Tamang", "Gurung", "Garo", "Khasi", "Tripuri"):
            with self.subTest(prefix=prefix):
                self.assertTrue(any(label.startswith(prefix + "_") for label in east_asia))
                self.assertFalse(any(label.startswith(prefix + "_") for label in south_asia))
        self.assertTrue(any(row[1].startswith("Somalia:Somali_")
                            for row in pcas[4]["references"]))
        self.assertTrue(any(row[1].startswith("Maghreb:Berber_")
                            for row in pcas[4]["references"]))
        self.assertTrue(any(row[1].startswith("Jewish Ashkenazi:Ashkenazi_Jew_")
                            for row in pcas[5]["references"]))
        self.assertEqual({row[1].split(":", 1)[0] for row in pcas[5]["references"]},
                         {"Jewish Ashkenazi", "Jewish South Europe", "Jewish Crimea",
                          "Jewish Ethiopia", "Jewish Asia", "Jewish India",
                          "Jewish Middle East", "Roma"})
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
            self.assertEqual(len({row[1] for row in pca["references"]}),
                             len(pca["references"]))
            for row, anchor in zip(pca["references"], pca["referenceAnchors"]):
                self.assertEqual(row[2:], by_label[anchor][2:])

    def test_jewish_and_roma_pca_covers_every_roma_source(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        source = {row[1]: row[2:] for row in modern}
        pca = next(pca for pca in read_global_modern_pcas(modern)
                   if pca["id"] == "global-jewish")
        self.assertEqual(pca["title"], "Jewish and Roma")
        roma = {row[1].split(":", 1)[1].strip(): row[2:]
                for row in pca["deepReferences"] if row[1].startswith("Roma:")}
        self.assertEqual(set(roma), {label for label in source if label.startswith("Roma_")})
        for label, coordinates in roma.items():
            self.assertEqual(coordinates, source[label], label)
        self.assertEqual(sum(row[1].startswith("Roma:") for row in pca["references"]), 6)
        self.assertIn("Jewish South Europe: Romaniote_Jew_(n=7)",
                      {row[1] for row in pca["deepReferences"]})

    def test_sub_saharan_groups_follow_ethnolinguistic_lines(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        pca = next(pca for pca in read_global_modern_pcas(modern)
                   if pca["id"] == "global-sub-saharan-africa")
        groups = {row[1].split(":", 1)[1].strip(): row[1].split(":", 1)[0]
                  for row in pca["references"]}
        self.assertEqual(set(groups.values()), {
            "West African", "Fulani", "Central African", "Pygmy",
            "East African", "Swahili Coast", "Southern Bantu", "Khoe-San",
        })
        self.assertEqual(len(pca["references"]), 53)
        self.assertEqual(len(pca["deepReferences"]), 133)
        for population, group in (
            ("Mandinka_Gambia_(n=232)", "West African"),
            ("Fulani_Senegal_(n=25)", "Fulani"),
            ("Fulani_Burkina_Faso_(SSA_Profile)_(n=6)", "Fulani"),
            ("Yoruba_Nigeria_(n=38)", "West African"),
            ("Hausa_(n=4)", "West African"),
            ("Baka_(n=3)", "Pygmy"),
            ("Kongo_Republic_of_the_Congo_(n=2)", "Central African"),
            ("Dinka_(n=33)", "East African"),
            ("Kaba_(n=2)", "Central African"),
            ("Mada_(n=2)", "West African"),
            ("Kikuyu_(n=6)", "East African"),
            ("Hadza_(n=9)", "East African"),
            ("Sandawe_(n=30)", "East African"),
            ("Swahili_Kenya_Faza_(n=18)", "Swahili Coast"),
            ("Swahili_Kenya_Ndau_(n=19)", "Swahili Coast"),
            ("Yao_(n=29)", "Southern Bantu"),
            ("Nama_(n=10)", "Khoe-San"),
        ):
            self.assertEqual(groups[population], group)
        self.assertNotIn("Baster_(n=30)", groups)
        self.assertNotIn("Coloured_(n=18)", groups)
        self.assertNotIn("Cape_Verdean_(n=14)", groups)
        self.assertEqual({label for label, group in groups.items() if group == "Pygmy"},
                         {"Baka_(n=3)", "Biaka_(n=8)", "Mbuti_(n=5)", "Twa_Uganda_(n=5)"})
        self.assertEqual({label for label, group in groups.items() if group == "Fulani"}, {
            "Fulani_Senegal_(n=25)", "Fulani_Gambia_(North_African-Mixed)_(n=73)",
            "Fulani_Burkina_Faso_(SSA_Profile)_(n=6)",
            "Fulani_Guinea_(SSA_Profile)_(n=17)",
        })
        self.assertEqual({label for label, group in groups.items() if group == "Swahili Coast"}, {
            "Swahili_Kenya_Faza_(n=18)", "Swahili_Kenya_Ndau_(n=19)",
            "Swahili_Kenya_Pate_(n=6)", "Swahili_Kenya_Siyu_(n=7)",
            "Swahili_Kenya_Wasini_(n=10)",
        })
        deep_groups = {row[1].split(":", 1)[1].strip(): row[1].split(":", 1)[0]
                       for row in pca["deepReferences"]}
        self.assertEqual({label for label, group in deep_groups.items() if group == "Pygmy"}, {
            "Bedzan_(n=2)", "Baka_(n=3)", "Bakola_(n=2)",
            "Biaka_(n=8)", "Mbuti_(n=5)", "Twa_Uganda_(n=5)",
        })
        self.assertEqual(deep_groups["Duma_San_(n=5)"], "Southern Bantu")
        self.assertEqual(deep_groups["Xun_(n=13)"], "Khoe-San")
        self.assertEqual(deep_groups["Laal_(n=1)"], "West African")
        self.assertEqual(deep_groups["Laka_(n=2)"], "Central African")
        self.assertEqual(deep_groups["Nuer_(n=14)"], "East African")
        self.assertNotIn("Sahel and Nile", deep_groups.values())
        self.assertNotIn("East African Foragers", deep_groups.values())
        self.assertNotIn("Sahel and Nile", {
            row[1].split(":", 1)[0] for row in pca["deepMixedReferences"]})

        north_africa = next(pca for pca in read_global_modern_pcas(modern)
                            if pca["id"] == "global-north-africa")
        north_groups = {row[1].split(":", 1)[1].strip(): row[1].split(":", 1)[0]
                        for row in north_africa["references"]}
        self.assertEqual(north_groups["Somali_(n=14)"], "Somalia")
        self.assertEqual(north_groups["Amhara_(n=175)"], "Ethiopia")
        self.assertEqual(north_groups["Ari_(n=2)"], "Ari")

    def test_sahara_sahel_references_belong_to_north_africa(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        pcas = {pca["id"]: pca for pca in read_global_modern_pcas(modern)}
        sub_saharan = pcas["global-sub-saharan-africa"]
        north_africa = pcas["global-north-africa"]

        def labels(rows):
            return {row[1].split(":", 1)[1].strip() for row in rows}

        def in_groups(rows, groups):
            return [row for row in rows if row[1].split(":", 1)[0] in groups]

        moved = {
            "Baggara_Chad_(Arabian-Mixed)_(n=7)",
            "Baggara_Chad_(Highly_Arabian-Mixed)_(n=12)",
            "Baggara_Chad_(SSA_Profile)_(n=6)",
            "Baggara_Messiria_Sudan_(n=3)",
            "Baggara_Sudan_(n=17)",
            "Bulala_(n=2)",
            "Daju_Sudan_(n=17)",
            "Toubou_Daza_Chad_(n=18)",
            "Toubou_Teda_(n=2)",
            "Zaghawa_Chad_(n=11)",
            "Zaghawa_Sudan_(n=31)",
        }
        self.assertFalse(moved & labels(sub_saharan["deepReferences"]))
        self.assertTrue(moved <= labels(in_groups(
            north_africa["deepReferences"] + north_africa["deepMixedReferences"],
            {"Sahara-Sahel"})))
        self.assertEqual(labels(in_groups(north_africa["references"], {"Sahara-Sahel"})),
                         moved - {"Baggara_Messiria_Sudan_(n=3)",
                                  "Baggara_Chad_(Highly_Arabian-Mixed)_(n=12)"})

        north_groups = {row[1].split(":", 1)[1].strip(): row[1].split(":", 1)[0]
                        for row in north_africa["references"]}
        self.assertEqual(set(north_groups.values()), {
            "Maghreb", "Oasis Communities", "Egypt", "Nile Valley", "Sahara-Sahel",
            "Ethiopia",
            "Somalia", "East African Pastoralist", "Ari",
        })
        self.assertEqual(sum(group == "Oasis Communities" for group in north_groups.values()), 6)
        for population, group in (
            ("Berber_Algeria_Kabyle_(n=25)", "Maghreb"),
            ("Hartani_Berber_(Mozabite)_Algeria_(n=3)", "Oasis Communities"),
            ("Hartani_Berber_(Gourara)_Algeria_Timimoun_(n=10)", "Oasis Communities"),
            ("Shwashin_Arab_Tunisia_(n=3)", "Oasis Communities"),
            ("Nubian_Danagla_(n=10)", "Nile Valley"),
            ("Sudanese_Arab_Kababish_(n=17)", "Nile Valley"),
        ):
            self.assertEqual(north_groups[population], group)
        deep_groups = {row[1].split(":", 1)[1].strip(): row[1].split(":", 1)[0]
                       for row in north_africa["deepReferences"]}
        for population, group in (
            ("Bedouin_Libya_(n=6)", "Maghreb"),
            ("Nubian_Nobiin_Mahas_(n=13)", "Nile Valley"),
            ("Sudanese_Arab_Ja'alin_(n=13)", "Nile Valley"),
            ("Toubou_Daza_Chad_(n=18)", "Sahara-Sahel"),
            ("Hartani_Arab_Western_Sahara_(n=1)", "Oasis Communities"),
            ("Shwashin_Arab_Tunisia_Douz_(n=2)", "Oasis Communities"),
        ):
            self.assertEqual(deep_groups[population], group)
        self.assertNotIn("Bedouin_Sudan_Rashaida_(n=20)", deep_groups)

    def test_east_african_pastoralists_stay_north_and_swahili_return_to_sub_saharan(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        pcas = {pca["id"]: pca for pca in read_global_modern_pcas(modern)}
        sub_saharan = pcas["global-sub-saharan-africa"]
        north_africa = pcas["global-north-africa"]

        def group_labels(pca, group, section="references"):
            return {row[1].split(":", 1)[1].strip() for row in pca[section]
                    if row[1].startswith(group + ":")}

        pastoralist = {
            "Datog_(n=3)", "Kalenjin_Kenya_(n=1)", "Masai_Kenya_(n=64)",
            "Ogiek_Kenya_(n=2)", "Sengwer_(n=2)", "Tutsi_(n=4)",
            "Hima_(n=2)", "Tutsi_Banyamulenge_(n=5)",
            "Tutsi_Burundi_(n=4)", "Tutsi_Rwanda_(n=8)",
        }
        swahili = {
            "Swahili_Kenya_Faza_(n=18)", "Swahili_Kenya_Ndau_(n=19)",
            "Swahili_Kenya_Pate_(n=6)", "Swahili_Kenya_Siyu_(n=7)",
            "Swahili_Kenya_Tchundwa_(n=8)", "Swahili_Kenya_Wasini_(n=10)",
            "Swahili_Zanzibar_(n=1)",
        }
        self.assertEqual(group_labels(north_africa, "East African Pastoralist"), pastoralist)
        self.assertEqual(group_labels(north_africa, "Swahili Coast"), set())
        sub_saharan_labels = {row[1].split(":", 1)[1].strip()
                              for row in sub_saharan["deepReferences"]}
        north_african_labels = {row[1].split(":", 1)[1].strip()
                                for row in north_africa["deepReferences"]}
        self.assertFalse(pastoralist & sub_saharan_labels)
        self.assertFalse(swahili & north_african_labels)
        self.assertTrue(swahili <= group_labels(sub_saharan, "Swahili Coast",
                                                "deepReferences"))
        self.assertTrue({"Swahili_Kenya_(n=1)", "Swahili_Kenya_Jomvu_(n=12)"}
                        <= group_labels(sub_saharan, "East African", "deepReferences"))

    def test_global_deep_mixed_rows_are_complete_and_separate(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        source = {row[1]: row[2:] for row in modern}
        pcas = read_global_modern_pcas(modern)
        config = json.loads((ROOT / "data" / "pca" / "pca_config.txt").read_text())
        assigned = {}
        for pca, entry in zip(pcas, config["modern"]):
            text = (ROOT / "data" / "pca" / entry["file"]).read_text()
            self.assertEqual(text.count("\nDeep Mixed:\n"), 1, entry["file"])
            regular = {row[1].split(":", 1)[1].strip() for row in pca["deepReferences"]}
            main_groups = {row[1].split(":", 1)[0].strip() for row in pca["references"]}
            for row in pca.get("deepMixedReferences", []):
                group, label = (part.strip() for part in row[1].split(":", 1))
                self.assertIn(group, main_groups)
                self.assertNotIn(label, regular)
                self.assertNotIn(label, assigned)
                self.assertEqual(row[2:], source[label])
                assigned[label] = (pca["title"], group)
        self.assertEqual(len(assigned), 301)
        self.assertEqual(assigned["Anglo-American_Kentucky_(n=125)"],
                         ("Northwest Europe", "British Isles"))
        self.assertEqual(assigned["Bolivian_Mestizo_(n=5)"],
                         ("Indigenous America", "Andes"))
        self.assertEqual(assigned["Babur-Bura_(n=1)"],
                         ("Sub-Saharan Africa", "Central African"))
        self.assertEqual(assigned["Malagasy_Temoro_(n=24)"],
                         ("Sub-Saharan Africa", "Southern Bantu"))
        self.assertEqual(assigned["Namibian_Bantu_(Coloured-Mixed)_(n=4)"],
                         ("Sub-Saharan Africa", "Southern Bantu"))
        self.assertEqual(assigned["Baggara_Chad_(Highly_Arabian-Mixed)_(n=12)"],
                         ("North Africa", "Sahara-Sahel"))

    def test_all_global_modern_maps_have_usable_deep_references(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        source = {row[1]: row[2:] for row in modern}
        pcas = {pca["id"]: pca for pca in read_global_modern_pcas(modern)}
        self.assertEqual(len(pcas), 19)
        for pca in pcas.values():
            with self.subTest(pca=pca["id"]):
                self.assertIn("deepReferences", pca)
                main = {row[1].split(":", 1)[1].strip(): row[1].split(":", 1)[0].strip()
                        for row in pca["references"]}
                deep = {}
                for row in pca["deepReferences"]:
                    group, label = (part.strip() for part in row[1].split(":", 1))
                    self.assertEqual(row[2:], source[label], label)
                    deep.setdefault(label, set()).add(group)
                missing = {label for label, group in main.items()
                           if group not in deep.get(label, set())}
                self.assertEqual(missing, set())

        def deep_labels(pca_id, group):
            return {row[1].split(": ", 1)[1]
                    for row in pcas[pca_id]["deepReferences"]
                    if row[1].startswith(group + ": ")}

        self.assertIn("Yao_(n=29)", deep_labels("global-sub-saharan-africa", "Southern Bantu"))
        self.assertNotIn("Yao_(n=29)", deep_labels("global-east-asia", "Southern China"))
        self.assertIn("Kom_(n=2)", deep_labels("global-east-asia", "Northeast India"))
        self.assertNotIn("Kom_(n=2)", deep_labels("global-sub-saharan-africa", "Central African"))
        self.assertIn("Dai_Yunnan_Xishuangbanna_(n=101)",
                      deep_labels("global-east-asia", "Southern China") &
                      deep_labels("global-southeast-asia", "Mainland Tai"))
        self.assertIn("Greek_Cyprus_(n=41)",
                      deep_labels("global-southeast-europe", "Greek Asia Minor") &
                      deep_labels("global-levant-mesopotamia", "Levant"))

    def test_west_siberia_map_covers_uralic_turkic_ket_and_arkhangelsk_populations(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        pcas = {pca["id"]: pca for pca in read_global_modern_pcas(modern)}
        uralic = pcas["global-west-siberia"]
        prefixes = ("Saami_", "Estonian_", "Finnish_", "Ingrian_", "Karelian_",
                    "Veps_", "Votian_", "Besermyan_", "Komi_", "Mari_",
                    "Mordvin_", "Udmurt_", "Khanty_", "Mansi_", "Enets_",
                    "Nenets_", "Nganasan_", "Selkup_", "Bashkir_", "Chuvash_",
                    "Tatar_", "Nogai_", "Crimean_Tatar_", "Ket_",
                    "Russian_Arkhangelsk_")
        expected = {row[1] for row in modern if row[1].startswith(prefixes)}
        actual = {anchor for anchor in uralic["deepReferenceAnchors"]}
        expected -= {"Nogai_Dagestan_(Ciscaucasian_Profile)_(n=3)",
                     "Crimean_Tatar_Coast_(n=4)"}
        self.assertEqual(actual, expected)
        self.assertFalse(any(label.startswith("Hungarian_") for label in actual))
        previous_maps = (pcas["global-central-asia"], pcas["global-northeast-europe"])
        for pca in previous_maps:
            moved = {label for label in expected
                     if not label.startswith(("Ket_", "Russian_Arkhangelsk_", "Estonian_"))}
            self.assertFalse(moved & set(pca["deepReferenceAnchors"]))

    def test_arabian_peninsula_has_its_own_main_and_deep_groups(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        pcas = {pca["id"]: pca for pca in read_global_modern_pcas(modern)}
        arabian = pcas["global-arabian-peninsula"]
        levant_mesopotamia = pcas["global-levant-mesopotamia"]
        groups = list(dict.fromkeys(row[1].split(":", 1)[0]
                                    for row in arabian["references"]))
        self.assertEqual(groups, ["Afro-Arabian", "Yemeni", "Saudi", "Omani",
                                  "Gulf", "Bedouin", "Jordan", "Coptic"])
        self.assertFalse(any(row[1].startswith("Arabian Peninsula:")
                             for row in levant_mesopotamia["references"] + levant_mesopotamia["deepReferences"]))
        main = {row[1].split(":", 1)[1]: row[1].split(":", 1)[0]
                for row in arabian["references"]}
        deep = {row[1].rsplit(":", 1)[1].strip(): row[1].split(":", 1)[0]
                for row in arabian["deepReferences"]}
        self.assertTrue(all(deep.get(label) == group for label, group in main.items()))
        self.assertEqual(len(deep), len(arabian["deepReferences"]))
        self.assertEqual(deep["Saudi_Arab_(Afro-Arab-Mixed)_(n=250)"], "Afro-Arabian")
        self.assertEqual(deep["Saudi_Arab_Najd_(n=16)"], "Saudi")
        self.assertEqual(deep["Yemeni_Mehri_Mahra_(n=9)"], "Yemeni")
        self.assertEqual(deep["Bedouin_Sinai_(n=3)"], "Bedouin")
        self.assertEqual(deep["Bedouin_Sudan_Rashaida_(n=20)"], "Gulf")
        self.assertEqual(deep["Jordanian_Arab_Muslim_(n=42)"], "Jordan")
        self.assertEqual(deep["Egyptian_Copt_(n=27)"], "Coptic")
        self.assertIn("Jordanian_Arab_Muslim_(n=42)", levant_mesopotamia["referenceAnchors"])
        self.assertIn("Egyptian_Copt_(n=27)",
                      pcas["global-north-africa"]["referenceAnchors"])


if __name__ == "__main__":
    unittest.main()
