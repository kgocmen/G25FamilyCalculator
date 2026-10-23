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
                          "Levant", "Mesopotamia"])
        for group, prefix in (("North Caucasus", "Avar_"),
                              ("Iranic West", "Kurdish_"),
                              ("Armenian", "Armenian_"),
                              ("Georgia", "Georgian_"),
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
                                        "Turk Azerbaijan", "Turk Iran", "Turk Yoruk Cepni"])
        self.assertIn("Turkish_Artvin_(n=7)", groups["Turk East"])
        self.assertIn("Iraqi_Turkmen_(n=18)", groups["Turk Iraq"])
        self.assertIn("Azeri_Iran_East_Azerbaijan_Tabriz_(n=6)", groups["Turk Iran"])
        self.assertIn("Azeri_Azerbaijan_(n=6)", groups["Turk Azerbaijan"])
        self.assertIn("Turkish_Manisa_Yörük_(n=9)", groups["Turk Yoruk Cepni"])
        self.assertEqual({row[1].split(":", 1)[1] for row in west_asia} &
                         {row[1].split(":", 1)[1] for row in turkic},
                         {"Iraqi_Turkmen_(n=18)"})

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
        self.assertTrue(any(row[1].startswith("Deprecated: Turk Balkans: Thrace: ") for row in deep))
        self.assertTrue(any(row[1].startswith("Deprecated: Turk Island: Cyprus: ") for row in deep))
        self.assertTrue(any(row[1].startswith("Deprecated: Turk Island: Aegean Islands: ") for row in deep))
        self.assertTrue(any(row[1].startswith("Deprecated: Turk Island: Crete: ") for row in deep))
        related = {"Iraqi_Turkmen_(n=18)", "Karapapakh_Turkey_Ardahan_(n=3)",
                   "Karapapakh_Turkey_Iğdır_(n=1)", "Karapapakh_Turkey_Kars_(n=3)",
                   "Khamseh_Turkic_(n=1)", "Khorasani_Turk_(n=2)",
                   "Qashqai_(n=1)", "Turkmen_Golestan_(n=8)"}
        expected = {label for label in source if label.startswith(("Turkish_", "Azeri_"))}
        expected.add("Greek_Crete_Muslim_(Cretan_Turk)_(n=8)")
        deprecated_labels = {row[1].rsplit(":", 1)[-1].strip() for row in deprecated}
        self.assertEqual(labels, (expected | related) - deprecated_labels)

    def test_global_pca13_deep_covers_its_main_groups_and_ethnicities(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        source = {row[1]: row[2:] for row in modern}
        pca = next(pca for pca in read_global_modern_pcas(modern)
                   if pca["id"] == "global-north-europe")
        main = {row[1].split(":", 1)[1]: row[1].split(":", 1)[0]
                for row in pca["references"]}
        expected_groups = {"Germanic East", "Germanic West", "Germanic South",
                           "Scandinavian", "British Isles", "North France"}
        self.assertEqual(set(main.values()), expected_groups)
        self.assertEqual(len(main), len(pca["references"]))
        self.assertEqual(len(pca["deepReferences"]), 141)
        deep = {}
        subgroups = set()
        for row in pca["deepReferences"]:
            group, subgroup, label = row[1].split(": ", 2)
            self.assertIn(group, expected_groups)
            self.assertNotIn(label, deep)
            self.assertEqual(row[2:], source[label], label)
            deep[label] = group
            subgroups.add((group, subgroup))
        self.assertTrue(set(main) <= set(deep))
        self.assertTrue(all(deep[label] == group for label, group in main.items()))
        self.assertTrue({("Germanic West", "Dutch"), ("Germanic West", "Flemish"),
                         ("Germanic South", "Austrian"), ("Scandinavian", "Faroese"),
                         ("British Isles", "Cornish"), ("North France", "Brittany")}
                        <= subgroups)

    def test_french_regions_are_split_between_north_and_south_europe(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        source = {row[1]: row[2:] for row in modern}
        pcas = {pca["id"]: pca for pca in read_global_modern_pcas(modern)}
        south = pcas["global-southwest-europe"]
        north = pcas["global-north-europe"]
        self.assertEqual(south["title"], "Southwest Europe")
        self.assertEqual(north["title"], "North Europe")

        south_main = {row[1].split(":", 1)[1] for row in south["references"]
                      if row[1].startswith("South France:")}
        north_main = {row[1].split(":", 1)[1] for row in north["references"]
                      if row[1].startswith("North France:")}
        self.assertEqual(len(south_main), 7)
        self.assertEqual(len(north_main), 7)
        self.assertFalse(south_main & north_main)
        self.assertNotIn("French_(n=64)", south_main | north_main)

        south_deep = {row[1].split(": ", 2)[2]: row
                      for row in south["deepReferences"]
                      if row[1].startswith("South France: ")}
        north_deep = {row[1].split(": ", 2)[2]: row
                      for row in north["deepReferences"]
                      if row[1].startswith("North France: ")}
        self.assertEqual(len(south_deep), 31)
        self.assertEqual(len(north_deep), 33)
        self.assertFalse(south_deep.keys() & north_deep.keys())
        self.assertTrue(south_main <= south_deep.keys())
        self.assertTrue(north_main <= north_deep.keys())
        self.assertEqual({row[1].split(": ", 2)[1] for row in south_deep.values()},
                         {"Auvergne-Rhône-Alpes", "Midi-Pyrénées", "Nouvelle-Aquitaine",
                          "Occitanie", "Provence-Alpes-Côte d'Azur"})
        self.assertEqual({row[1].split(": ", 2)[1] for row in north_deep.values()},
                         {"Bourgogne-Franche-Comté", "Brittany", "Centre-Val de Loire",
                          "Grand Est", "Hauts-de-France", "Normandy", "Pays de la Loire",
                          "Wallonia", "Île-de-France"})
        for label, row in (south_deep | north_deep).items():
            self.assertEqual(row[2:], source[label], label)

    def test_southwest_southeast_and_balto_slavic_maps_partition_references(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        source_labels = {row[1] for row in modern}
        pcas = {pca["id"]: pca for pca in read_global_modern_pcas(modern)}
        southwest = pcas["global-southwest-europe"]
        southeast = pcas["global-southeast-europe"]
        balto_slavic = pcas["global-balto-slavic"]

        def groups(pca):
            return {row[1].split(":", 1)[0] for row in pca["references"]}

        def labels(pca, group, deep=False):
            rows = pca["deepReferences"] if deep else pca["references"]
            return {row[1].rsplit(":", 1)[1].strip() for row in rows
                    if row[1].split(":", 1)[0] == group}

        self.assertEqual(groups(southwest),
                         {"South France", "Basque", "Iberia", "Corsica", "Italy", "Sardinia"})
        self.assertEqual(groups(southeast), {"South Italy", "Albanian", "Greek", "Greek Islands",
                                             "Greek Anatolia", "Slavic Balkans", "Turk Balkans",
                                             "Turk Islands"})
        self.assertEqual(groups(balto_slavic),
                         {"Slav East", "Slav West", "Balkan Slav", "Finnic", "Baltic"})
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
        self.assertEqual(labels(southeast, "Slavic Balkans"),
                         labels(balto_slavic, "Balkan Slav"))
        self.assertEqual(labels(southeast, "Slavic Balkans", True),
                         labels(balto_slavic, "Balkan Slav", True))
        for pca, group, prefixes in (
            (southeast, "Slavic Balkans", ("Bosniak_", "Bulgarian_", "Croat_",
                                         "Macedonian_", "Montenegrin_", "Pomak_",
                                         "Serb_", "Slovene_", "Torbeši_")),
            (balto_slavic, "Slav East", ("Belarusian_", "Russian_", "Ukrainian_", "Rusyn_")),
            (balto_slavic, "Slav West", ("Czech_", "Polish_", "Slovak_",
                                          "Kashubian_", "Sorb_")),
            (balto_slavic, "Finnic", ("Estonian_", "Finnish_", "Ingrian_",
                                      "Karelian_", "Veps_")),
            (balto_slavic, "Baltic", ("Latvian_", "Lithuanian_")),
        ):
            self.assertEqual(labels(pca, group, True),
                             {label for label in source_labels if label.startswith(prefixes)})
        self.assertEqual({label for group in ("Greek", "Greek Islands", "Greek Anatolia",
                                              "Turk Islands")
                          for label in labels(southeast, group, True)
                          if label.startswith("Greek_")},
                         {label for label in source_labels if label.startswith("Greek_")})
        self.assertTrue({"Greek_Cappadocia_Kaisareia_(n=14)",
                         "Greek_Pontus_(n=22)"} <= labels(southeast, "Greek Anatolia"))
        self.assertTrue({"Greek_Cyprus_(n=41)", "Greek_Cyclades_Andros_(n=7)"}
                        <= labels(southeast, "Greek Islands"))
        self.assertTrue({"Kashubian_(n=2)", "Slovak_(n=6)",
                         "Sorb_Niederlausitz_(n=1)"} <= labels(balto_slavic, "Slav West"))
        self.assertTrue({"Lithuanian_East_Aukštaitija_(n=78)",
                         "Finnish_North_(n=9)"} <=
                        (labels(balto_slavic, "Baltic", True) |
                         labels(balto_slavic, "Finnic", True)))
        for pca in (southwest, southeast, balto_slavic):
            main = {row[1].split(":", 1)[0]: set() for row in pca["references"]}
            for row in pca["references"]:
                group, label = row[1].split(":", 1)
                main[group].add(label)
            for group, group_labels in main.items():
                self.assertTrue(group_labels <= labels(pca, group, True))

    def test_global_modern_maps_have_requested_regions_and_valid_anchors(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        by_label = {row[1]: row for row in modern}
        pcas = read_global_modern_pcas(modern)
        self.assertEqual([pca["title"] for pca in pcas],
                         ["Southwest Europe", "South Asia", "Central Asia and Siberia",
                          "Sub-Saharan Africa", "North Africa", "Jewish", "West Asia and Caucasus",
                          "East Asia", "Southeast Asia", "Australia and Pacific",
                          "Indigenous America", "West Turkistan", "North Europe",
                          "Balto-Slavic", "Southeast Europe", "Arabian Peninsula"])
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
        self.assertEqual(len(labels_by_group["South France"]), 7)
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
        self.assertTrue(any(row[1].startswith("Horn of Africa:Somali_")
                            for row in pcas[3]["references"]))
        self.assertTrue(any(row[1].startswith("Amazigh:Berber_")
                            for row in pcas[4]["references"]))
        self.assertTrue(any(row[1].startswith("Jewish Europe:Ashkenazi_Jew_")
                            for row in pcas[5]["references"]))
        self.assertEqual({row[1].split(":", 1)[0] for row in pcas[5]["references"]},
                         {"Jewish Europe", "Jewish Ethiopia", "Jewish Asia",
                          "Jewish India", "Jewish Middle East"})
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
            self.assertFalse(any("mixed" in row[1].lower() for row in pca["references"]),
                             f"{pca['title']} contains a mixed-profile reference")
            for row, anchor in zip(pca["references"], pca["referenceAnchors"]):
                self.assertEqual(row[2:], by_label[anchor][2:])

    def test_all_global_modern_maps_have_usable_deep_references(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        source = {row[1]: row[2:] for row in modern}
        pcas = {pca["id"]: pca for pca in read_global_modern_pcas(modern)}
        self.assertEqual(len(pcas), 16)
        for pca in pcas.values():
            with self.subTest(pca=pca["id"]):
                self.assertIn("deepReferences", pca)
                main = {row[1].split(":", 1)[1]: row[1].split(":", 1)[0]
                        for row in pca["references"]}
                deep = {}
                for row in pca["deepReferences"]:
                    group, subgroup, label = (part.strip() for part in row[1].split(":", 2))
                    self.assertTrue(subgroup)
                    self.assertEqual(row[2:], source[label], label)
                    deep.setdefault(label, set()).add(group)
                missing = {label for label, group in main.items()
                           if group not in deep.get(label, set())}
                # This archive entry is deliberately omitted from active deep fitting.
                expected_missing = ({"Ashkenazi_Jew_(n=1209)"}
                                    if pca["id"] == "global-jewish" else set())
                self.assertEqual(missing, expected_missing)

        def deep_labels(pca_id, group):
            return {row[1].split(": ", 2)[2]
                    for row in pcas[pca_id]["deepReferences"]
                    if row[1].startswith(group + ": ")}

        self.assertIn("Yao_(n=29)", deep_labels("global-sub-saharan-africa", "Southern Africa"))
        self.assertNotIn("Yao_(n=29)", deep_labels("global-east-asia", "Southern China"))
        self.assertIn("Kom_(n=2)", deep_labels("global-east-asia", "Northeast India"))
        self.assertNotIn("Kom_(n=2)", deep_labels("global-sub-saharan-africa", "Central Africa"))
        self.assertIn("Dai_Yunnan_Xishuangbanna_(n=101)",
                      deep_labels("global-east-asia", "Southern China") &
                      deep_labels("global-southeast-asia", "Mainland Tai"))
        self.assertIn("Greek_Cyprus_(n=41)",
                      deep_labels("global-southeast-europe", "Greek Islands") &
                      deep_labels("global-west-asia-and-caucasus", "Levant"))

    def test_arabian_peninsula_has_its_own_main_and_deep_groups(self):
        modern = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        pcas = {pca["id"]: pca for pca in read_global_modern_pcas(modern)}
        arabian = pcas["global-arabian-peninsula"]
        west_asia = pcas["global-west-asia-and-caucasus"]
        groups = list(dict.fromkeys(row[1].split(":", 1)[0]
                                    for row in arabian["references"]))
        self.assertEqual(groups, ["Afro-Arabian", "Yemeni", "Saudi", "Omani",
                                  "Gulf", "Bedouin", "Jordan", "Coptic"])
        self.assertFalse(any(row[1].startswith("Arabian Peninsula:")
                             for row in west_asia["references"] + west_asia["deepReferences"]))
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
        self.assertEqual(deep["Jordanian_Arab_Muslim_(n=42)"], "Jordan")
        self.assertEqual(deep["Egyptian_Copt_(n=27)"], "Coptic")
        self.assertIn("Jordanian_Arab_Muslim_(n=42)", west_asia["referenceAnchors"])
        self.assertIn("Egyptian_Copt_(n=27)",
                      pcas["global-north-africa"]["referenceAnchors"])


if __name__ == "__main__":
    unittest.main()
