import json
import math
import unittest
from collections import Counter

from build.build_calculator_data import ROOT, read_global_modern_pcas, read_row_sections, read_rows


class AsianPcaGroupsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = read_rows(ROOT / "data/modern_g25.txt", "modern")
        cls.pcas = {pca["id"]: pca for pca in read_global_modern_pcas(cls.source)}

    def populations(self, pca_id, key="deepReferences"):
        return {row[1].split(":", 1)[1].strip(): row[1].split(":", 1)[0].strip()
                for row in self.pcas[pca_id].get(key, [])}

    def test_central_asia_separates_amur_and_kamchatka_profiles(self):
        pca = self.pcas["global-central-asia"]
        regular = self.populations(pca["id"])
        mixed = self.populations(pca["id"], "deepMixedReferences")
        self.assertNotIn("Northeast Asia", set(regular.values()) | set(mixed.values()))
        self.assertFalse({"Tungusic", "East Siberia", "Mongolic"} &
                         (set(regular.values()) | set(mixed.values())))
        for key in ("references", "deepReferences", "deepMixedReferences"):
            names = [row[1].split(":", 1)[1].strip() for row in pca[key]]
            self.assertEqual(len(names), len(set(names)), key)
        self.assertTrue(set(regular).isdisjoint(mixed))
        for name in ("Nanai_(n=10)", "Ulchi_(n=23)", "Negidal_(n=3)",
                     "Evenk_Khabarovsk_(n=2)", "Nivkh_(n=10)",
                     "Oroqen_(n=3)"):
            self.assertEqual(regular[name], "Amur")
        for name in ("Evenk_(n=19)", "Evenk_Zabaykalsky_(n=8)", "Even_(n=8)",
                     "Yukaghir_Tundra_(n=25)", "Chukchi_(n=29)",
                     "Itelmen_(n=7)", "Koryak_(n=24)"):
            self.assertEqual(regular[name], "Kamchatka")
        for name in ("Hezhen_(n=5)", "Xibo_(n=3)", "Daur_(n=3)"):
            self.assertEqual(regular[name], "Inner Mongolia")
        self.assertEqual(regular["Buryat_Aginsky_(n=11)"], "Buryat")
        self.assertEqual(regular["Khamnegan_(n=8)"], "Buryat")
        self.assertEqual(regular["Mongol_Khalkha_Mongolia_(n=26)"], "Mongolia")
        main = self.populations(pca["id"], "references")
        self.assertEqual(main["Dongxiang_(n=38)"], "Northwest China")
        self.assertEqual(main["Mongol_Khorchin_Inner_Mongolia_(n=6)"], "Inner Mongolia")
        self.assertEqual(main["Mongol_Inner_Mongolia_Baotu_(Outer_Mongolia_Profile)_(n=19)"],
                         "Mongolia")
        self.assertEqual(main["Buryat_Aginsky_(n=11)"], "Buryat")
        counts = Counter(row[1].split(":", 1)[0].strip() for row in pca["references"])
        self.assertEqual(counts["Amur"], 6)
        self.assertEqual(counts["Kamchatka"], 7)
        self.assertEqual(counts["Inner Mongolia"], 8)
        self.assertEqual(counts["Buryat"], 8)
        self.assertEqual(counts["Mongolia"], 19)

        rows = [row for row in pca["references"] if row[1].split(":", 1)[0] in {"Amur", "Kamchatka"}]
        groups = {group: [row for row in rows if row[1].startswith(group + ":")]
                  for group in ("Amur", "Kamchatka")}
        scores = []
        for group, members in groups.items():
            others = groups["Kamchatka" if group == "Amur" else "Amur"]
            for row in members:
                within = sum(math.dist(row[2:], peer[2:]) for peer in members if peer is not row) / (len(members) - 1)
                outside = sum(math.dist(row[2:], peer[2:]) for peer in others) / len(others)
                scores.append((outside - within) / max(within, outside))
        self.assertGreater(sum(scores) / len(scores), 0.5)

    def test_european_mixed_profiles_only_enter_mixed_deep(self):
        pca = self.pcas["global-central-asia"]
        mixed = self.populations(pca["id"], "deepMixedReferences")
        self.assertEqual(len(mixed), 22)
        self.assertTrue(all("European-Mixed" in name for name in mixed))
        for key in ("references", "deepReferences"):
            self.assertFalse(any("European-Mixed" in row[1] for row in pca[key]))
        self.assertEqual(mixed["Buryat_(European-Mixed)_(n=2)"], "Buryat")
        self.assertEqual(mixed["Even_(European-Mixed)_(n=6)"], "Kamchatka")
        self.assertEqual(mixed["Negidal_(European-Mixed)_(n=1)"], "Amur")
        self.assertEqual(mixed["Ulchi_(European-Mixed)_(n=3)"], "Amur")
        self.assertEqual(mixed["Yukaghir_Forest_(European-Mixed)_(n=6)"], "Kamchatka")
        self.assertEqual(mixed["Kazakh_Kazakhstan_(Eastern_European-Mixed)_(n=10)"],
                         "Kipchak")

    def test_central_asia_has_north_afghanistan_uyghur_hazara_and_transoxiana(self):
        pca = self.pcas["global-central-asia"]
        main = self.populations(pca["id"], "references")
        deep = self.populations(pca["id"])
        expected = {"North Afghanistan": 9, "Uyghur": 1, "Hazara": 2,
                    "Transoxiana": 6, "Tajik": 11, "Turkmen": 4}
        counts = Counter(main.values())
        self.assertEqual({group: counts[group] for group in expected}, expected)
        self.assertNotIn("Karluk", counts)
        for name, group in (
            ("Karakalpak_(n=22)", "Kipchak"),
            ("Kazakh_(n=23)", "Kipchak"),
            ("Kyrgyz_China_(n=93)", "Kipchak"),
            ("Turkmen_Afghanistan_(n=5)", "Turkmen"),
            ("Uzbek_Afghanistan_(n=14)", "North Afghanistan"),
            ("Tajik_Balkh_(n=6)", "North Afghanistan"),
            ("Tajik_Badakhshan_(n=22)", "North Afghanistan"),
            ("Tajik_Jowzjan_(n=1)", "North Afghanistan"),
            ("Tajik_Samangan_(n=1)", "North Afghanistan"),
            ("Tajik_Takhar_(n=5)", "North Afghanistan"),
            ("Pamiri_Rushan_(n=8)", "North Afghanistan"),
            ("Uyghur_(n=22)", "Uyghur"),
            ("Hazara_Afghanistan_(n=8)", "Hazara"),
            ("Hazara_Pakistan_(n=24)", "Hazara"),
            ("Uzbek_(n=18)", "Transoxiana"),
            ("Uzbek_Khorezm_(n=6)", "Transoxiana"),
            ("Uzbek_Tashkent_(n=9)", "Transoxiana"),
            ("Tajik_Khujand_(n=1)", "Transoxiana"),
            ("Tajik_Samarkand_(n=1)", "Transoxiana"),
            ("Tajik_Tashkent_(n=2)", "Transoxiana"),
            ("Tajik_(n=16)", "Tajik"),
            ("Tajik_Herat_(n=3)", "Tajik"),
        ):
            self.assertEqual(deep[name], group, name)
        self.assertEqual({group: Counter(deep.values())[group] for group in expected}, expected)

    def test_himalaya_pca20_has_distinct_regional_groups_and_source_coordinates(self):
        config = json.loads((ROOT / "data/pca/pca_config.txt").read_text())
        self.assertEqual(config["modern"][19], {"id": "global-himalaya", "title": "Himalaya",
                                                "file": "modern_pca20.g25.txt"})
        pca = self.pcas["global-himalaya"]
        self.assertEqual(Counter(self.populations(pca["id"]).values()), {
            "Tibet and Sherpa": 17, "Nepal Tibeto-Burman": 6, "Newar": 2,
            "Nepal Indo-Aryan": 5, "Western Himalaya": 19,
            "Himalayan Foothills": 4, "Eastern Himalaya": 6})
        source = {row[1]: row[2:] for row in self.source}
        for key in ("references", "deepReferences"):
            names = []
            for row in pca[key]:
                name = row[1].split(":", 1)[1].strip()
                names.append(name)
                self.assertEqual(row[2:], source[name], name)
            self.assertEqual(len(names), len(set(names)))
        self.assertEqual(len(pca["references"]), 56)
        self.assertEqual(len(pca["deepReferences"]), 59)
        main_groups = set(self.populations(pca["id"], "references").values())
        self.assertEqual(main_groups, set(self.populations(pca["id"]).values()))

    def test_himalayan_populations_move_without_duplicates_in_other_panels(self):
        himalaya = self.populations("global-himalaya")
        expected = {row[1] for row in self.source if row[1].startswith((
            "Tibetan_", "Sherpa_", "Gurung_", "Rai_", "Tamang_", "Magar_", "Khas_"))}
        self.assertTrue(expected <= set(himalaya))
        for name, group in (
            ("Tibetan_(n=19)", "Tibet and Sherpa"),
            ("Sherpa_Khumbu_(n=173)", "Tibet and Sherpa"),
            ("Khas_Brahmin_(Bahun)_Nepal_(n=35)", "Nepal Indo-Aryan"),
            ("Tamang_(n=8)", "Nepal Tibeto-Burman"),
            ("Newar_(n=21)", "Newar"), ("Burusho_(n=20)", "Western Himalaya"),
            ("Gyalrong_(n=3)", "Eastern Himalaya"),
            ("Tharu_(n=26)", "Himalayan Foothills"),
        ):
            self.assertEqual(himalaya[name], group)
        for pca_id in self.pcas:
            if pca_id == "global-himalaya":
                continue
            for key in ("references", "deepReferences", "deepMixedReferences"):
                self.assertFalse(set(himalaya) & set(self.populations(pca_id, key)), pca_id)
        self.assertEqual(self.populations("global-south-asia")["Punjabi_Jat_Sikh_(n=60)"],
                         "Punjab and North India")
        self.assertEqual(self.populations("global-southeast-asia")["Khasi_(n=3)"], "Indo-Burmese")
        self.assertEqual(self.populations("global-east-asia")["Tu_(n=5)"], "Northwest China")

    def test_southeast_asia_geographic_groups_keep_other_population_splits(self):
        pca = self.pcas["global-southeast-asia"]
        self.assertEqual(list(dict.fromkeys(row[1].split(":", 1)[0] for row in pca["references"])),
                         ["Mainland", "Malay Negrito", "Philippine Negrito",
                          "Malay Peninsula", "Archipelago", "Taiwan-Philippines", "Andamanese"])
        populations = self.populations(pca["id"])
        for name, group in (
            ("Thai_(n=11)", "Mainland"),
            ("Vietnamese_(Dong_Profile)_(n=2)", "Mainland"),
            ("Akha_Thailand_(n=31)", "Mainland"),
            ("Batek_(n=45)", "Malay Negrito"), ("Maniq_(n=9)", "Malay Negrito"),
            ("Aeta_(n=2)", "Philippine Negrito"), ("Batak_Palawan_(n=2)", "Philippine Negrito"),
            ("Batak_Toba_(n=34)", "Archipelago"), ("Javanese_(n=29)", "Archipelago"),
            ("Cheq_Wong_(n=11)", "Malay Peninsula"), ("Mah_Meri_(n=21)", "Malay Peninsula"),
            ("Nyah_Kur_(n=10)", "Mainland"), ("Kinh_(n=99)", "Mainland"),
            ("Ami_(n=35)", "Taiwan-Philippines"), ("Filipino_(n=82)", "Taiwan-Philippines"),
            ("Onge_(n=40)", "Andamanese"), ("Jarawa_(n=19)", "Andamanese"),
        ):
            self.assertEqual(populations[name], group, name)
        mixed = self.populations(pca["id"], "deepMixedReferences")
        self.assertEqual(mixed, {"Nicobarese_(n=6)": "Archipelago"})
        self.assertEqual(len(populations) + len(mixed), 70)
        main = self.populations(pca["id"], "references")
        self.assertEqual(main["Malay_Malaysia_(n=9)"], "Malay Peninsula")

    def test_southeast_asian_references_in_east_asia_have_logical_group_names(self):
        east = self.populations("global-east-asia")
        southeast = self.populations("global-southeast-asia")
        genetic_groups = {"Guizhou and Yunnan", "Yunnan and Thai Highlands",
                          "South China and Vietnam", "Mekong Mainland", "Central Thailand",
                          "Java and Borneo", "Dusun Nias and Philippines",
                          "Sulawesi and Bajo", "Taiwan and Cordillera"}
        for name, group in southeast.items():
            if group in {"Mainland", "Archipelago"}:
                self.assertIn(east[name], genetic_groups, name)
            elif group == "Malaysian Peninsula":
                self.assertEqual(east[name], "Malay Peninsula", name)

    def test_malay_and_philippine_negrito_splits_follow_g25_affinity(self):
        rows = self.pcas["global-southeast-asia"]["deepReferences"]
        malay = [row[2:] for row in rows if row[1].startswith("Malay Negrito:")]
        philippine = [row[2:] for row in rows if row[1].startswith("Philippine Negrito:")]
        import math
        def mean_distance(first, second, within=False):
            distances = [math.dist(x, y) for i, x in enumerate(first) for j, y in enumerate(second)
                         if not within or i != j]
            return sum(distances) / len(distances)
        self.assertEqual((len(malay), len(philippine)), (5, 4))
        self.assertGreater(mean_distance(malay, philippine),
                           2 * max(mean_distance(malay, malay, True),
                                   mean_distance(philippine, philippine, True)))

    def test_pca8_genetic_groups_replace_the_broad_groups(self):
        pca = self.pcas["global-east-asia"]
        main = self.populations(pca["id"], "references")
        counts = Counter(main.values())
        for broad_group in ("Mainland Southeast Asia", "Southern China Minorities", "Archipelago",
                            "Tai-Kadai", "Hmong-Mien", "Austroasiatic"):
            self.assertNotIn(broad_group, counts)
        expected = {"Guizhou and Yunnan": 12, "Yunnan and Thai Highlands": 8,
                    "South China and Vietnam": 16, "Mekong Mainland": 8,
                    "Central Thailand": 2, "Java and Borneo": 8,
                    "Dusun Nias and Philippines": 11, "Sulawesi and Bajo": 3,
                    "Taiwan and Cordillera": 5}
        self.assertEqual({group: counts[group] for group in expected}, expected)

        deep = self.populations(pca["id"])
        for name, group in (
            ("Qiang_Guizou_Tongren_Jiangkou_(n=11)", "Guizhou and Yunnan"),
            ("Jingpo_Yunnan_(n=21)", "Guizhou and Yunnan"),
            ("Blang_(n=13)", "Yunnan and Thai Highlands"),
            ("Hani_(n=15)", "Yunnan and Thai Highlands"),
            ("Hmong_Thailand_(n=10)", "South China and Vietnam"),
            ("Kinh_(n=99)", "South China and Vietnam"),
            ("Zhuang_Guangxi_Chongzuo_(n=10)", "South China and Vietnam"),
            ("Formosan_(Han-Mixed)_(n=1)", "South China and Vietnam"),
            ("Khmer_Cambodia_(n=11)", "Mekong Mainland"),
            ("Lao_(n=34)", "Mekong Mainland"),
            ("Thai_(n=11)", "Central Thailand"),
            ("Javanese_(n=29)", "Java and Borneo"),
            ("Iban_(low_res)_(n=25)", "Java and Borneo"),
            ("Nias_Hilitobara_(n=13)", "Dusun Nias and Philippines"),
            ("Filipino_(n=82)", "Dusun Nias and Philippines"),
            ("Makassarese_Konjo_Kajang_(n=6)", "Sulawesi and Bajo"),
            ("Ami_(n=35)", "Taiwan and Cordillera"),
            ("Atayal_(Han-Mixed)_(n=1)", "Taiwan and Cordillera"),
        ):
            self.assertEqual(deep[name], group, name)
        self.assertEqual(len(deep), len(pca["deepReferences"]))

    def test_pca8_genetic_groups_are_cohesive_and_deep_rows_use_nearest_center(self):
        pca = self.pcas["global-east-asia"]
        genetic_groups = {"Guizhou and Yunnan", "Yunnan and Thai Highlands",
                          "South China and Vietnam", "Mekong Mainland", "Central Thailand",
                          "Java and Borneo", "Dusun Nias and Philippines",
                          "Sulawesi and Bajo", "Taiwan and Cordillera"}
        grouped = {}
        for row in pca["references"]:
            group = row[1].split(":", 1)[0].strip()
            if group in genetic_groups:
                grouped.setdefault(group, []).append(row)
        self.assertEqual(sum(map(len, grouped.values())), 73)
        scores = []
        for group, rows in grouped.items():
            for row in rows:
                within = sum(math.dist(row[2:], other[2:]) for other in rows if other is not row) / (len(rows) - 1)
                outside = min(sum(math.dist(row[2:], other[2:]) for other in others) / len(others)
                              for other_group, others in grouped.items() if other_group != group)
                scores.append((outside - within) / max(within, outside))
        self.assertGreater(sum(scores) / len(scores), 0.4)

        centroids = {group: [sum(row[i] for row in rows) / len(rows) for i in range(2, 27)]
                     for group, rows in grouped.items()}
        main_names = set(self.populations(pca["id"], "references"))
        for row in pca["deepReferences"]:
            group, name = (part.strip() for part in row[1].split(":", 1))
            if group in genetic_groups and name not in main_names:
                nearest = min(centroids, key=lambda candidate: math.dist(row[2:], centroids[candidate]))
                self.assertEqual(group, nearest, name)

    def test_pca8_keeps_other_main_groups_and_mixed_reference(self):
        pca = self.pcas["global-east-asia"]
        main = self.populations(pca["id"], "references")
        self.assertEqual(main["Tu_(n=5)"], "Northwest China")
        self.assertEqual(main["Han_Fujian_(n=35)"], "Southern Han")
        self.assertEqual(main["Malay_Malaysia_(n=9)"], "Malay Peninsula")
        self.assertEqual(main["Nicobarese_(n=6)"], "Nicobar Islands")
        self.assertEqual(self.populations(pca["id"], "deepMixedReferences"),
                         {"Dungan_(European-Mixed)_(n=1)": "Northwest China"})

    def test_himalaya_deep_only_references_have_active_main_groups(self):
        pca = self.pcas["global-himalaya"]
        main = self.populations(pca["id"], "references")
        deep = self.populations(pca["id"])
        for name in ("Gyalrong_(n=3)", "Gujar_Kashmir_(n=13)",
                     "Kashmiri_Muslim_Srinagar_(n=15)"):
            self.assertNotIn(name, main)
            self.assertIn(deep[name], set(main.values()))

    def test_saved_bundle_matches_the_editable_pca_files(self):
        text = (ROOT / "calculator/modern_pca_references.js").read_text()
        saved = json.loads(text.split(" = ", 1)[1].rstrip(";\n"))
        self.assertEqual(saved, list(self.pcas.values()))


if __name__ == "__main__":
    unittest.main()
