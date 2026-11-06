import tempfile
import unittest
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from build.build_calculator_data import (ROOT, build_neolithic_data, build_ydnatr, read_global_ancient_rows,
                                         read_global_modern_pcas,
                                         read_modern_pcas, read_neolithic_data, read_row_sections, read_rows, read_ydnatr_data,
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
                     "Main:\nDeep Mixed:\nDeep:\n", "Main:\nDeep:\nDeep Mixed:\nDeep Mixed:\n",
                     f"Group:One,{coordinates}\nMain:\n"):
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, "Main:, optional Deep:, then Deep Mixed:"):
                self.read(text, "modern")
        self.assertEqual(self.read(f"Main:\nGroup:One,{coordinates}\nDeep Mixed:\n", "modern"),
                         [["modern", "Group:One", *([0.0] * 25)]])

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
            self.assertNotIn("Iran:Punjab and North India", {row[1] for row in rows})

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
                         ["Assyrian", "Upper Mesopotamian", "Syrio-Mesopotamian", "North Levantine",
                          "Mesopotamian", "Irano-Mesopotamian",
                          "Christian Arab", "South Levantine", "Cypriot", "Arabian Peninsula"])
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
                                    ("Assyrian", "Assyrian_", levant_mesopotamia),
                                    ("Upper Mesopotamian", "Mardini_Arab_", levant_mesopotamia),
                                    ("Syrio-Mesopotamian", "Syrian_Arab_(Syrio-Mesopotamian_", levant_mesopotamia),
                                    ("North Levantine", "Lebanese_Arab_Muslim_", levant_mesopotamia),
                                    ("Mesopotamian", "Iraqi_Arab_(Mesopotamian_Arab_", levant_mesopotamia),
                                    ("Irano-Mesopotamian", "Iraqi_Arab_(Irano-Mesopotamian_", levant_mesopotamia),
                                    ("Syrio-Mesopotamian", "Iraqi_Arab_(Mesopotamian_Pre-Islamic_", levant_mesopotamia),
                                    ("Christian Arab", "Lebanese_Arab_Christian_", levant_mesopotamia),
                                    ("South Levantine", "Palestinian_Arab_", levant_mesopotamia),
                                    ("Cypriot", "Greek_Cyprus_", levant_mesopotamia),
                                    ("Arabian Peninsula", "Saudi_Arab_", levant_mesopotamia)):
            self.assertTrue(any(row[1].split(":", 1)[0].strip() == group and
                                row[1].split(":", 1)[1].strip().startswith(prefix)
                                for row in rows), (group, prefix))
        self.assertEqual(len(levant_mesopotamia), 78)
        upper = {row[1].split(":", 1)[1].strip() for row in levant_mesopotamia
                 if row[1].startswith("Upper Mesopotamian:")}
        self.assertEqual(upper, {
            "Mhallami_(n=12)", "Mardini_Arab_(Mardelli)_(n=18)",
            "Bitlisi_Arab_(n=2)", "Siirti_Arab_(n=2)",
            "Kosewi_(n=30)", "Tatavi_(n=3)",
        })
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
        main = {row[1].split(":", 1)[1].strip(): row[1].split(":", 1)[0]
                for row in pca["references"]}
        deep = {row[1].split(": ", 1)[1]: row[1].split(":", 1)[0]
                for row in pca["deepReferences"]}
        self.assertEqual(set(main.values()), {
            "Pakistan and Northwest India", "Central Indian", "East Indian", "South Indian",
            "Dalit", "Tribes", "Eastern Tribes", "Roma", "Himalayan", "Hindu Kush"})
        self.assertEqual(len(main), len(pca["references"]))
        self.assertEqual(len(deep), len(pca["deepReferences"]))
        self.assertTrue(all(deep.get(label) == group for label, group in main.items()))
        self.assertFalse(any(label.startswith(("Hazara_", "Balochi_", "Brahui_", "Makrani_"))
                             for label in main | deep))
        for label, group in (
            ("Punjabi_Jat_Sikh_(n=60)", "Pakistan and Northwest India"),
            ("Pashtun_Kasabgar_Zargar_(n=2)", "Pakistan and Northwest India"),
            ("Bengali_Bangladesh_(n=90)", "East Indian"),
            ("Tamil_Brahmin_Iyer_Tamil_Nadu_(n=24)", "Central Indian"),
            ("Sinhalese_(n=16)", "South Indian"),
            ("Tamil_Pallan_(n=20)", "Dalit"),
            ("Irula_(n=61)", "Tribes"),
            ("Gond_Chhattisgarh_(n=9)", "Tribes"),
            ("Munda_(n=5)", "Eastern Tribes"),
            ("Khond_(n=14)", "Eastern Tribes"),
        ):
            self.assertEqual(main[label], group)
        moved_deep = {"Tajik_Ghazni_(n=1)", "Tajik_Laghman_(n=1)",
                      "Pashtun_Pakistan_Kurram_(n=8)",
                      "Pashtun_Kasabgar_Chamar_(n=1)", "Pashtun_Kasabgar_Dum_(n=1)",
                      "Pashtun_Kasabgar_Ingar_(n=2)", "Pashtun_Kasabgar_Julaha_(n=1)",
                      "Pashtun_Kasabgar_Kolal_(n=1)", "Pashtun_Kasabgar_Nai_(n=1)",
                      "Pashtun_Kasabgar_Paracha_(n=1)", "Pashtun_Kasabgar_Shah_Khel_(n=1)"}
        self.assertTrue(all(deep[name] == "Pakistan and Northwest India" for name in moved_deep))
        iran = next(pca for pca in read_global_modern_pcas(modern) if pca["id"] == "global-iran")
        iran_labels = {row[1].split(":", 1)[1].strip() for row in iran["deepReferences"]}
        self.assertFalse((moved_deep | {"Pashtun_Kasabgar_Zargar_(n=2)"}) & iran_labels)
        source_deep = read_rows(ROOT / "data" / "pca" / "modern_pca2.g25.txt", "modern", section="deep")
        deprecated = {row[1].split(": ", 1)[1] for row in source_deep
                      if row[1].startswith("Deprecated: ")}
        self.assertEqual(deprecated, set())
        excluded = {
            "Balochi_Pakistan_(Siddi-Mixed)_(n=3)",
            "Brahui_(Siddi-Mixed)_(n=2)",
            "Makrani_(Siddi-Mixed)_(n=4)",
            "Sindhi_(Siddi-Mixed)_(n=2)"}
        self.assertTrue(excluded.isdisjoint(deep))
        mixed = {row[1].split(":", 1)[1].strip()
                 for row in pca["deepMixedReferences"]}
        self.assertIn("Sindhi_(Siddi-Mixed)_(n=2)", mixed)

    def test_iranic_pca_uses_regions_and_moves_tats_to_caucasus(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        source = {row[1]: row[2:] for row in modern}
        pcas = {pca["id"]: pca for pca in read_global_modern_pcas(modern)}
        pca = pcas["global-iran"]
        main = {row[1].split(":", 1)[1].strip(): row[1].split(":", 1)[0]
                for row in pca["references"]}
        deep = {row[1].split(": ", 1)[1]: row[1].split(":", 1)[0]
                for row in pca["deepReferences"]}
        self.assertTrue({
            "West Iran", "Turkic Iran", "East Iran", "Balochistan",
            "Central Asia", "Pamir", "Pashtun"} <= set(main.values()))
        self.assertNotIn("Afghanistan and Pakistan", main.values())
        self.assertEqual({group: list(main.values()).count(group) for group in
                          ("West Iran", "Pamir", "Pashtun")},
                         {"West Iran": 13, "Pamir": 8, "Pashtun": 12})
        self.assertEqual(len(main), len(pca["references"]))
        self.assertEqual(len(deep), len(pca["deepReferences"]))
        self.assertTrue(all(deep.get(label) == group for label, group in main.items()))
        self.assertEqual({group: list(deep.values()).count(group) for group in
                          ("West Iran", "Pamir", "Pashtun")},
                         {"West Iran": 84, "Pamir": 16, "Pashtun": 36})
        self.assertNotIn("Hindu Kush", main.values())
        self.assertNotIn("Hindu Kush", deep.values())
        self.assertNotIn("?", main.values())
        self.assertFalse(any(label.startswith(("Ossetian_", "Tat_"))
                             for label in main | deep))
        for label, group in (
            ("Kurdish_Kurmanji_Turkey_Konya_(n=29)", "West Iran"),
            ("Kurdish_(n=19)", "West Iran"),
            ("Persian_Khorasan_(n=12)", "East Iran"),
            ("Persian_Sistan_(n=1)", "East Iran"),
            ("Persian_Bandari_(n=9)", "East Iran"),
            ("Parsi_India_(n=30)", "East Iran"),
            ("Parsi_Pakistan_(n=23)", "East Iran"),
            ("Balochi_Pakistan_(n=17)", "Balochistan"),
            ("Brahui_(n=23)", "Balochistan"),
            ("Pashtun_Durrani_(n=13)", "Pashtun"),
            ("Tajik_Balkh_(n=6)", "Pamir"),
            ("Pashtun_Bettani_(n=7)", "Pashtun"),
            ("Pashtun_Ghilji_(n=17)", "Pashtun"),
            ("Pashtun_Yusufzai_(n=41)", "Pashtun"),
            ("Pashtun_Kakar_(n=1)", "Pashtun"),
            ("Pamiri_Shugnan_(n=8)", "Pamir"),
            ("Tajik_(n=16)", "Central Asia"),
            ("Qizilbash_(n=1)", "Qizilbash"),
        ):
            self.assertIn(label, source)
            self.assertEqual(deep[label], group)
        for label in ("Tajik_Balkh_(n=6)", "Tajik_Jowzjan_(n=1)",
                      "Tajik_Samangan_(n=1)", "Tajik_Takhar_(n=5)",
                      "Uzbek_Afghanistan_(n=14)", "Turkmen_Afghanistan_(n=5)"):
            self.assertEqual(deep[label], "Pamir")
        for row in (*pca["references"], *pca["deepReferences"],
                    *pca["deepMixedReferences"]):
            label = row[1].split(":", 1)[1].strip()
            self.assertEqual(row[2:], source[label])

        caucasus = pcas["global-caucasus"]
        caucasus_main = {row[1].split(":", 1)[1]: row[1].split(":", 1)[0]
                         for row in caucasus["references"]}
        caucasus_deep = {row[1].split(": ", 1)[1]: row[1].split(":", 1)[0]
                         for row in caucasus["deepReferences"]}
        tats = {"Tat_Azerbaijan_Ciscaucasia_(n=6)", "Tat_Dagestan_Dzhalgan_(n=15)",
                "Tat_Dagestan_Nyugdi_(n=13)", "Tat_Azerbaijan_(n=5)",
                "Tat_Iran_(n=1)"}
        self.assertEqual({label for label in caucasus_deep if label.startswith("Tat_")}, tats)
        self.assertTrue(all(caucasus_deep[label] == "Ciscaucasia" for label in tats))
        self.assertEqual({label for label in caucasus_main if label.startswith("Tat_")},
                         tats - {"Tat_Azerbaijan_(n=5)", "Tat_Iran_(n=1)"})
        for row in (*caucasus["references"], *caucasus["deepReferences"]):
            label = row[1].split(":", 1)[1].strip()
            if label in tats:
                self.assertEqual(row[2:], source[label])

    def test_global_pca13_deep_covers_its_main_groups_and_ethnicities(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        source = {row[1]: row[2:] for row in modern}
        pca = next(pca for pca in read_global_modern_pcas(modern)
                   if pca["id"] == "global-europe")
        main = {row[1].split(":", 1)[1].strip(): row[1].split(":", 1)[0]
                for row in pca["references"]}
        expected_groups = {"Sardinia", "France South", "Basque", "Iberia",
                           "Corsica", "Italy North", "Celtic", "Germanic North",
                           "Germanic East", "West Europe", "Swedish",
                           "Central Europe", "Balto-Slavic"}
        self.assertEqual(set(main.values()), expected_groups)
        self.assertLessEqual(len(main), 75)
        self.assertEqual(len(main), len(pca["references"]))
        deep = {}
        for row in pca["deepReferences"]:
            group, label = (part.strip() for part in row[1].split(":", 1))
            self.assertIn(group, expected_groups)
            self.assertNotIn(label, deep)
            self.assertEqual(row[2:], source[label], label)
            deep[label] = group
        self.assertTrue(set(main) <= set(deep))
        self.assertTrue(all(deep[label] == group for label, group in main.items()))
        self.assertEqual(set(deep.values()), expected_groups)
        mixed = {}
        for row in pca["deepMixedReferences"]:
            group, label = (part.strip() for part in row[1].split(":", 1))
            self.assertNotIn(label, deep)
            self.assertNotIn(label, mixed)
            self.assertEqual(row[2:], source[label], label)
            mixed[label] = group
        for label, group in {
            "Breton_(n=3)": "Celtic",
            "Irish_(n=106)": "Celtic",
            "English_(n=44)": "Germanic North",
            "Dutch_North_(n=7)": "Germanic North",
            "Danish_(n=87)": "Germanic North",
            "Norwegian_(n=49)": "Germanic North",
            "Flemish_Belgium_(n=16)": "West Europe",
            "German_North_Rhine_(n=8)": "West Europe",
            "German_East_(n=16)": "Germanic East",
            "Austrian_(n=18)": "Central Europe",
            "German_Bavaria_(n=3)": "West Europe",
            "Alsatian_Bas-Rhin_(n=44)": "West Europe",
            "French_Hauts-de-France_Nord_(n=39)": "West Europe",
            "Swedish_(n=114)": "Swedish",
        }.items():
            self.assertEqual(main[label], group)
        self.assertEqual(deep["German_Hamburg_(n=16)"], "Germanic East")
        self.assertEqual(deep["Anglo-American_Kentucky_(n=125)"], "Germanic North")
        self.assertEqual(deep["Northern_Irish_Mixed_(Ulster_Irish+Ulster_Scot)_(n=2)"], "Celtic")
        self.assertEqual(mixed["Cuban_Blanco_(n=429)"], "Iberia")
        self.assertEqual(mixed["Russian_Kamchatka_(n=1)"], "Balto-Slavic")
        self.assertEqual(sum(group == "Sardinia" for group in main.values()), 4)
        self.assertEqual(sum(group == "Corsica" for group in main.values()), 2)

    def test_french_regions_remain_in_europe_pca_south_and_west_groups(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        source = {row[1]: row[2:] for row in modern}
        pcas = {pca["id"]: pca for pca in read_global_modern_pcas(modern)}
        europe = pcas["global-europe"]
        self.assertEqual(europe["title"], "Europe")

        south_main = {row[1].split(":", 1)[1].strip() for row in europe["references"]
                      if row[1].startswith("France South:")}
        west_main = {row[1].split(":", 1)[1].strip() for row in europe["references"]
                     if row[1].startswith("West Europe:")}
        self.assertEqual(len(south_main), 5)
        self.assertEqual(len(west_main), 11)
        self.assertFalse(south_main & west_main)
        self.assertIn("French_(n=64)", west_main)

        south_deep = {row[1].split(":", 1)[1].strip(): row
                      for row in europe["deepReferences"]
                      if row[1].startswith("France South:")}
        west_deep = {row[1].split(":", 1)[1].strip(): row
                     for row in europe["deepReferences"]
                     if row[1].startswith("West Europe:")}
        self.assertGreaterEqual(len(south_deep), 37)
        self.assertGreaterEqual(len(west_deep), 80)
        self.assertIn("Swiss_French_(Romand)_(n=8)", south_deep)
        self.assertIn("Belgian_(n=311)", west_deep)
        self.assertIn("French_(n=64)", west_deep)
        self.assertFalse(south_deep.keys() & west_deep.keys())
        self.assertTrue(south_main <= south_deep.keys())
        self.assertTrue(west_main <= west_deep.keys())
        for label, row in (south_deep | west_deep).items():
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
                                             "Greek Aegean", "Greek Anatolian", "Balkans", "Turk Balkans",
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
        self.assertEqual({label for group in ("Greek", "Greek Aegean", "Greek Anatolian",
                                             "Turk Balkans", "Crimea")
                          for label in labels(southeast, group, True)
                          if label.startswith("Greek_")},
                         {label for label in source_labels if label.startswith("Greek_")})
        self.assertTrue({"Greek_Cappadocia_Kaisareia_(n=14)", "Greek_Pontus_(n=22)",
                         "Greek_Armenian_Highland_Erzurum_(n=13)",
                         "Greek_Cappadocia_Nigdi_(n=3)"}
                        <= labels(southeast, "Greek Anatolian"))
        self.assertTrue({"Greek_Cyprus_(n=41)", "Greek_Cyclades_Andros_(n=7)",
                         "Greek_North_Aegean_Chios_(n=31)",
                         "Greek_Western_Anatolia_Balia_(n=2)",
                         "Greek_Western_Anatolia_Smyrna_(n=9)"}
                        <= labels(southeast, "Greek Aegean"))
        self.assertTrue({"Greek_Crete_Muslim_(Cretan_Turk)_(n=8)",
                         "Turkish_Cyprus_(n=33)"} <= labels(southeast, "Greek Aegean"))
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

    def test_southeast_greek_aegean_and_anatolian_groups(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        pca = next(pca for pca in read_global_modern_pcas(modern)
                   if pca["id"] == "global-southeast-europe")
        self.assertLessEqual(len(pca["references"]), 65)
        main_groups = {row[1].split(":", 1)[1].strip(): row[1].split(":", 1)[0]
                       for row in pca["references"]}
        self.assertEqual(main_groups["Greek_Western_Anatolia_Smyrna_(n=9)"], "Greek Aegean")
        self.assertEqual(main_groups["Greek_Crete_Heraklion_(n=93)"], "Greek Aegean")
        self.assertEqual(main_groups["Greek_Cappadocia_Kaisareia_(n=14)"], "Greek Anatolian")
        self.assertEqual(sum(group == "Greek Aegean" for group in main_groups.values()), 10)
        self.assertEqual(sum(group == "Greek Anatolian" for group in main_groups.values()), 5)
        deep_groups = {row[1].split(":", 1)[1].strip(): row[1].split(":", 1)[0]
                       for row in pca["deepReferences"]}
        self.assertEqual(deep_groups["Greek_Western_Anatolia_Krini_(n=1)"], "Greek Aegean")
        self.assertEqual(deep_groups["Greek_Dodecanese_Rhodes_(n=15)"], "Greek Aegean")
        self.assertTrue(all(group == "Greek Aegean" for label, group in deep_groups.items()
                            if label.startswith("Greek_Western_Anatolia_")))
        self.assertNotIn("Greek Asia Minor", deep_groups.values())

    def test_pca11_uses_five_groups_without_a_deep_section(self):
        path = ROOT / "data" / "pca" / "modern_pca11.g25.txt"
        sections = read_row_sections(path, "modern")
        expected = ["Inuit", "North America", "Mexico", "South America", "Brazil"]
        self.assertNotIn("deep", sections)
        source = {row[1]: row[2:]
                  for row in read_rows(ROOT / "data" / "modern_g25.txt", "modern")}
        placements = {}
        for section in ("main", "deep mixed"):
            rows = sections[section]
            self.assertEqual(list(dict.fromkeys(row[1].split(":", 1)[0]
                                                     for row in rows)),
                             [group for group in expected
                              if any(row[1].startswith(group + ":") for row in rows)])
            for row in rows:
                group, label = (part.strip() for part in row[1].split(":", 1))
                self.assertNotIn(label, placements)
                self.assertEqual(row[2:], source[label], label)
                placements[label] = (section, group)
        self.assertEqual(len(sections["main"]), 68)
        self.assertEqual(len(sections["deep mixed"]), 151)
        self.assertEqual(len(placements), 219)
        self.assertEqual(set(group for _, group in placements.values()), set(expected))
        pca = next(pca for pca in read_global_modern_pcas(read_rows(
            ROOT / "data" / "modern_g25.txt", "modern"))
            if pca["id"] == "global-indigenous-america")
        self.assertNotIn("deepReferences", pca)
        self.assertEqual(len(pca["deepMixedReferences"]), 151)
        for label, placement in {
            "Greenlander_East_(n=4)": ("main", "Inuit"),
            "Greenlander_East_(European-Mixed)_(n=5)": ("deep mixed", "Inuit"),
            "Aleut_(European-Mixed)_(n=9)": ("deep mixed", "Inuit"),
            "Luiseño_(n=1)": ("main", "North America"),
            "Lumbee_(n=7)": ("deep mixed", "North America"),
            "Pima_(n=12)": ("main", "Mexico"),
            "Maya_(n=10)": ("main", "Mexico"),
            "Amerindian_Guatemala_(n=12)": ("main", "South America"),
            "Amerindian_Panama_(n=4)": ("main", "South America"),
            "Garifuna_Belize_(n=3)": ("deep mixed", "South America"),
            "Mapuche_(n=2)": ("main", "South America"),
            "Quechua_Peru_(n=21)": ("main", "South America"),
            "Karitiana_(n=14)": ("main", "Brazil"),
            "Kaingang_(n=1)": ("main", "Brazil"),
            "Suruí_(n=8)": ("main", "Brazil"),
            "Brazilian_Caboclo_(n=6)": ("deep mixed", "Brazil"),
            "Brazilian_Branco_(n=2032)": ("deep mixed", "Brazil"),
            "Brazilian_Pardo_(n=967)": ("deep mixed", "Brazil"),
            "Cuban_Blanco_(n=429)": ("deep mixed", "North America"),
            "Cuban_Mestizo_(n=15)": ("deep mixed", "North America"),
            "Cuban_Mulato_(n=1)": ("deep mixed", "North America"),
            "Peruvian_Mestizo_(SSA-Mixed)_(n=37)": ("deep mixed", "South America"),
            "Mexican_Mestizo_(n=772)": ("deep mixed", "Mexico"),
            "Mexican_Euro-Mestizo_(n=199)": ("deep mixed", "Mexico"),
            "Guatemalan_Ladino_(n=42)": ("deep mixed", "South America"),
        }.items():
            self.assertEqual(placements[label], placement)
        for file, labels in (
            ("modern_pca13.g25.txt", {"Cuban_Blanco_(n=429)",
                                     "Brazilian_Branco_(n=2032)"}),
            ("modern_pca4.g25.txt", {"Brazilian_Pardo_(n=967)",
                                    "Cuban_Mulato_(n=1)"}),
        ):
            copied_source = read_row_sections(path.with_name(file), "modern")["deep mixed"]
            self.assertTrue(labels <= {row[1].split(":", 1)[1].strip()
                                       for row in copied_source})
        european_mixed = read_row_sections(path.with_name("modern_pca13.g25.txt"),
                                           "modern")["deep mixed"]
        copied_european_labels = {row[1].split(":", 1)[1].strip()
                                  for row in european_mixed
                                  if row[1].startswith("Iberia:")}
        self.assertEqual(len(copied_european_labels), 17)
        self.assertTrue(all(placements[label][0] == "deep mixed"
                            for label in copied_european_labels))

    def test_global_modern_maps_have_requested_regions_and_valid_anchors(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        by_label = {row[1]: row for row in modern}
        pcas = read_global_modern_pcas(modern)
        self.assertEqual([pca["title"] for pca in pcas],
                         ["Southwest Europe", "South Asia", "Central Asia and Siberia",
                          "Sub-Saharan Africa", "North Africa and the Horn", "Jewish and Roma", "Caucasus",
                          "East Asia", "Southeast Asia", "Australia and Pacific",
                          "Indigenous America", "West Turkistan", "Northwest Europe",
                          "Northeast Europe", "Southeast Europe", "Arabian Peninsula", "Iranic",
                          "Levant and Mesopotamia", "West Siberia", "Himalaya"])
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
                     for label in [row[1].split(":", 1)[1].strip()]}
        central_asia = {row[1].split(":", 1)[1].strip() for row in pcas[2]["references"]}
        for prefix in ("Tibetan", "Sherpa", "Gurung"):
            with self.subTest(prefix=prefix):
                self.assertFalse(any(label.startswith(prefix + "_") for label in central_asia))
                self.assertFalse(any(label.startswith(prefix + "_") for label in east_asia))
                self.assertTrue(any(label.startswith(prefix + "_")
                                    for label in pcas[19]["referenceAnchors"]))
                self.assertEqual({label.strip() for label in south_asia
                                  if label.strip().startswith(prefix + "_")}, set())
        southeast_asia = {row[1].split(":", 1)[1].strip() for row in pcas[8]["references"]}
        self.assertNotIn("Tamang_(n=8)", southeast_asia)
        self.assertIn("Tamang_(n=8)", pcas[19]["referenceAnchors"])
        for prefix in ("Garo", "Khasi", "Tripuri"):
            self.assertTrue(any(label.startswith(prefix + "_") for label in southeast_asia))
            self.assertFalse(any(label.strip().startswith(prefix + "_") for label in south_asia))
            self.assertFalse(any(label.startswith(prefix + "_") for label in east_asia))
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
        self.assertTrue(any(row[1].startswith("Northern China:Han_")
                            for row in pcas[7]["references"]))
        self.assertTrue(any(row[1].startswith("Tai-Kadai:Thai_")
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
        self.assertEqual(len(assigned), 318)
        self.assertEqual(assigned["Anglo-American_Kentucky_(n=125)"],
                         ("Northwest Europe", "Germanic North"))
        self.assertEqual(assigned["Bolivian_Mestizo_(n=5)"],
                         ("Indigenous America", "South America"))
        self.assertEqual(assigned["Babur-Bura_(n=1)"],
                         ("Sub-Saharan Africa", "Central African"))
        self.assertEqual(assigned["Malagasy_Temoro_(n=24)"],
                         ("Sub-Saharan Africa", "Southern Bantu"))
        self.assertEqual(assigned["Namibian_Bantu_(Coloured-Mixed)_(n=4)"],
                         ("Sub-Saharan Africa", "Southern Bantu"))
        self.assertEqual(assigned["Baggara_Chad_(Highly_Arabian-Mixed)_(n=12)"],
                         ("North Africa and the Horn", "Sahara-Sahel"))

    def test_all_global_modern_maps_have_usable_deep_references(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        source = {row[1]: row[2:] for row in modern}
        pcas = {pca["id"]: pca for pca in read_global_modern_pcas(modern)}
        self.assertEqual(len(pcas), 20)
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
        self.assertNotIn("Yao_(n=29)", deep_labels("global-east-asia", "South China and Vietnam"))
        self.assertIn("Kom_(n=2)", deep_labels("global-himalaya", "Tibeto-Burman"))
        self.assertNotIn("Kom_(n=2)", deep_labels("global-sub-saharan-africa", "Central African"))
        self.assertIn("Dai_Yunnan_Xishuangbanna_(n=101)",
                      deep_labels("global-east-asia", "South China and Vietnam"))
        self.assertNotIn("Dai_Yunnan_Xishuangbanna_(n=101)",
                         deep_labels("global-southeast-asia", "Mainland"))
        self.assertIn("Greek_Cyprus_(n=41)",
                      deep_labels("global-southeast-europe", "Greek Aegean") &
                      deep_labels("global-levant-mesopotamia", "Cypriot"))

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

    def test_levant_mesopotamia_has_supported_mesopotamian_groups(self):
        source = ROOT / "data" / "pca" / "modern_pca18.g25.txt"
        sections = read_row_sections(source, "modern")
        main = {row[1].split(":", 1)[1].strip(): row[1].split(":", 1)[0]
                for row in sections["main"]}
        deep = {row[1].split(":", 1)[1].strip(): row[1].split(":", 1)[0]
                for row in sections["deep"]}
        for group in ("Assyrian", "Upper Mesopotamian", "Syrio-Mesopotamian",
                      "Mesopotamian", "Irano-Mesopotamian"):
            self.assertGreaterEqual(list(main.values()).count(group), 5, group)
        self.assertEqual(list(main.values()).count("Syrio-Mesopotamian"), 10)
        self.assertNotIn("Pre-Islamic Mesopotamian", set(main.values()) | set(deep.values()))
        self.assertEqual(main["Mandaean_Iraq_(n=20)"], "Syrio-Mesopotamian")
        self.assertTrue(all(group == "Syrio-Mesopotamian"
                            for label, group in (main | deep).items()
                            if "Mesopotamian_Pre-Islamic_Profile" in label))
        irano = {label for label in main | deep if "Irano-Mesopotamian_Profile" in label}
        self.assertEqual(len(irano), 7)
        self.assertEqual({label for label, group in main.items()
                          if group == "Irano-Mesopotamian"},
                         irano - {"Iraqi_Arab_West_(Irano-Mesopotamian_Profile)_(n=1)",
                                  "Iraqi_Arab_Babylon_(Irano-Mesopotamian_Profile)_(n=1)"})
        self.assertTrue(all((main | deep)[label] == "Irano-Mesopotamian"
                            for label in irano))
        self.assertEqual(deep["Iraqi_Arab_West_(Irano-Mesopotamian_Profile)_(n=1)"],
                         "Irano-Mesopotamian")

    def test_levant_mesopotamia_arabian_rows_follow_mixed_status(self):
        source = ROOT / "data" / "pca" / "modern_pca18.g25.txt"
        sections = read_row_sections(source, "modern")

        def labels(section, group=None):
            return [row[1].split(":", 1)[1].strip() for row in sections[section]
                    if group is None or row[1].split(":", 1)[0] == group]

        main = labels("main", "Arabian Peninsula")
        deep = labels("deep", "Arabian Peninsula")
        deep_mixed = labels("deep mixed", "Arabian Peninsula")
        self.assertFalse(any(row[1].split(":", 1)[0] in
                             {"Omani", "Saudi", "Bedouin", "Yemeni", "Gulf"}
                             for rows in sections.values() for row in rows))
        self.assertGreaterEqual(len(main), 5)
        self.assertIn("Saudi_Arab_(n=246)", main)
        self.assertIn("Yemeni_Arab_(n=8)", main)
        self.assertIn("Bedouin_Jordan_(n=4)", main)
        self.assertIn("Omani_Arab_(n=2)", deep)
        self.assertNotIn("Omani_Arab_(n=2)", deep_mixed)
        self.assertIn("Saudi_Arab_(Arabian-Mixed_Profile)_(n=6)", deep)
        self.assertIn("Emirati_Arab_(Ajam-Mixed)_(n=2)", deep)
        self.assertIn("Afro-Emirati_(n=7)", deep_mixed)
        self.assertEqual(deep_mixed.count("Afro-Emirati_(n=7)"), 1)
        self.assertIn("Yemeni_Arab_(South_Asian-Mixed)_(n=1)", deep_mixed)
        self.assertIn("Bedouin_Jordan_(African-Mixed)_(n=4)", deep_mixed)
        self.assertIn("Lebanese_Arab_Muslim_Sunni_Beirut_(Afro-Arab-Mixed)_(n=5)",
                      labels("deep mixed", "North Levantine"))
        self.assertTrue(all("mixed" not in label.lower() for label in labels("main")))
        self.assertTrue(all(any(token in label.lower() for token in
                                ("afro", "african", "south_asian"))
                            for label in labels("deep mixed")))
        self.assertTrue(all(not any(token in label.lower() for token in
                                    ("afro", "african", "south_asian"))
                            for label in labels("deep")))

    def test_arabian_peninsula_has_its_own_main_and_deep_groups(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        pcas = {pca["id"]: pca for pca in read_global_modern_pcas(modern)}
        arabian = pcas["global-arabian-peninsula"]
        levant_mesopotamia = pcas["global-levant-mesopotamia"]
        groups = list(dict.fromkeys(row[1].split(":", 1)[0]
                                    for row in arabian["references"]))
        self.assertEqual(groups, ["Afro-Arabian", "Yemeni", "Saudi", "Omani",
                                  "Gulf", "Bedouin", "Jordan", "Coptic"])
        self.assertTrue(any(row[1].startswith("Arabian Peninsula:")
                            for row in levant_mesopotamia["references"]))
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
