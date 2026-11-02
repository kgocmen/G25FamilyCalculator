import json
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

    def test_central_asia_has_unique_tungusic_mongolic_and_arctic_profiles(self):
        pca = self.pcas["global-central-asia"]
        regular = self.populations(pca["id"])
        mixed = self.populations(pca["id"], "deepMixedReferences")
        self.assertNotIn("Northeast Asia", set(regular.values()) | set(mixed.values()))
        for key in ("references", "deepReferences", "deepMixedReferences"):
            names = [row[1].split(":", 1)[1].strip() for row in pca[key]]
            self.assertEqual(len(names), len(set(names)), key)
        self.assertTrue(set(regular).isdisjoint(mixed))
        for name in ("Even_(n=8)", "Evenk_(n=19)", "Hezhen_(n=5)",
                     "Nanai_(n=10)", "Negidal_(n=3)", "Oroqen_(n=3)",
                     "Ulchi_(n=23)", "Xibo_(n=3)"):
            self.assertEqual(regular[name], "Tungusic")
        self.assertEqual(regular["Evenk_Khabarovsk_(n=2)"], "Tungusic")
        self.assertEqual(regular["Buryat_Aginsky_(n=11)"], "Mongolic")
        self.assertEqual(regular["Mongol_Khalkha_Mongolia_(n=26)"], "Mongolic")
        self.assertEqual(regular["Chukchi_(n=29)"], "East Siberia")
        self.assertEqual(regular["Nivkh_(n=10)"], "East Siberia")
        main = self.populations(pca["id"], "references")
        self.assertEqual(main["Mongol_Khorchin_Inner_Mongolia_(n=6)"], "Mongolic")
        self.assertEqual(main["Buryat_Aginsky_(n=11)"], "Mongolic")
        self.assertEqual(main["Evenk_Khabarovsk_(n=2)"], "Tungusic")

    def test_european_mixed_profiles_only_enter_mixed_deep(self):
        pca = self.pcas["global-central-asia"]
        mixed = self.populations(pca["id"], "deepMixedReferences")
        self.assertEqual(len(mixed), 21)
        self.assertTrue(all("European-Mixed" in name for name in mixed))
        for key in ("references", "deepReferences"):
            self.assertFalse(any("European-Mixed" in row[1] for row in pca[key]))
        self.assertEqual(mixed["Buryat_(European-Mixed)_(n=2)"], "Mongolic")
        self.assertEqual(mixed["Even_(European-Mixed)_(n=6)"], "Tungusic")
        self.assertEqual(mixed["Kazakh_Kazakhstan_(Eastern_European-Mixed)_(n=10)"],
                         "Steppe Turkic")

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
        self.assertEqual(self.populations("global-east-asia")["Tu_(n=5)"], "Western China")

    def test_southeast_asia_combines_language_families_geography_and_population_history(self):
        pca = self.pcas["global-southeast-asia"]
        self.assertEqual(list(dict.fromkeys(row[1].split(":", 1)[0] for row in pca["references"])),
                         ["Tai-Kadai", "Hmong-Mien", "Austroasiatic", "Tibeto-Burman", "Indo-Burmese",
                          "Malay Negrito", "Philippine Negrito", "Malay Peninsula",
                          "Western Austronesian", "Taiwan-Philippines", "Andamanese"])
        populations = self.populations(pca["id"])
        for name, group in (
            ("Thai_(n=11)", "Tai-Kadai"), ("Zhuang_Guangxi_Chongzuo_(n=10)", "Tai-Kadai"),
            ("Vietnamese_(Dong_Profile)_(n=2)", "Tai-Kadai"),
            ("Hmong_Thailand_(n=10)", "Hmong-Mien"), ("Bunu_Youmai_Yao_(n=28)", "Hmong-Mien"),
            ("Miao_Guizhou_Qiandongnan_Leishan_(n=49)", "Hmong-Mien"),
            ("Hani_(n=15)", "Tibeto-Burman"), ("Mizo_(n=112)", "Tibeto-Burman"),
            ("Khasi_(n=3)", "Indo-Burmese"), ("Manipuri_Brahmin_(n=20)", "Indo-Burmese"),
            ("Batek_(n=45)", "Malay Negrito"), ("Maniq_(n=9)", "Malay Negrito"),
            ("Aeta_(n=2)", "Philippine Negrito"), ("Batak_Palawan_(n=2)", "Philippine Negrito"),
            ("Batak_Toba_(n=34)", "Western Austronesian"), ("Javanese_(n=29)", "Western Austronesian"),
            ("Cheq_Wong_(n=11)", "Malay Peninsula"), ("Mah_Meri_(n=21)", "Malay Peninsula"),
            ("Nyah_Kur_(n=10)", "Austroasiatic"), ("Kinh_(n=99)", "Austroasiatic"),
            ("Ami_(n=35)", "Taiwan-Philippines"), ("Filipino_(n=82)", "Taiwan-Philippines"),
            ("Onge_(n=40)", "Andamanese"), ("Jarawa_(n=19)", "Andamanese"),
        ):
            self.assertEqual(populations[name], group, name)
        hmong = {row[1] for row in self.source if row[1].startswith(("Bunu_", "Miao_"))}
        self.assertEqual(len(hmong), 15)
        self.assertTrue(all(populations[name] == "Hmong-Mien" for name in hmong))
        mixed = self.populations(pca["id"], "deepMixedReferences")
        self.assertEqual(mixed, {"Nicobarese_(n=6)": "Austroasiatic"})
        self.assertEqual(len(populations) + len(mixed), 137)
        main = self.populations(pca["id"], "references")
        self.assertEqual(main["Bouyei_Guizhou_Anshun_Guanling_(n=44)"], "Tai-Kadai")
        self.assertEqual(main["Zhuang_Guizhou_Congjiang_(n=49)"], "Tai-Kadai")
        self.assertEqual(main["Malay_Malaysia_(n=9)"], "Malay Peninsula")

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

    def test_east_asia_keeps_six_groups_after_himalayan_references_move(self):
        pca = self.pcas["global-east-asia"]
        groups = list(dict.fromkeys(row[1].split(":", 1)[0] for row in pca["references"]))
        self.assertEqual(groups, ["Western China", "Northern China", "Southern China",
                                  "Manchu", "Korean", "Japanese"])
        regular = self.populations(pca["id"])
        for name, group in (
            ("Tibetan_(n=19)", "Tibet"), ("Sherpa_Khumbu_(n=173)", "Tibet"),
            ("Tibetan_Lhasa_(n=9)", "Tibet"), ("Tibetan_Gangcha_(n=19)", "Tibet"),
            ("Tibetan_Gannan_(n=5)", "Western China"),
            ("Tibetan_Xinlong_(n=10)", "Western China"),
            ("Tibetan_Xunhua_(n=3)", "Western China"),
            ("Naxi_(n=5)", "Western China"), ("Baima_(n=1)", "Western China"),
            ("Qiang_Sichuan_Garze_Danba_(n=8)", "Western China"),
            ("Qiang_Sichuan_Garze_Daofu_(n=8)", "Tibet"),
            ("Qiang_Guizou_Tongren_Jiangkou_(n=11)", "Southern China"),
            ("Salar_(n=34)", "Western China"), ("Dongxiang_(n=38)", "Western China"),
            ("Bonan_(n=40)", "Western China"), ("Yugur_(n=30)", "Western China"),
            ("Hui_Gansu_(n=21)", "Western China"), ("Han_Qinghai_(n=1)", "Western China"),
            ("Han_Beijing_(Northern_China_Profile)_(n=65)", "Northern China"),
            ("Han_Shandong_Jinan_(n=10)", "Northern China"),
            ("Han_Jiangsu_Wuxi_(n=2)", "Northern China"),
            ("Han_Beijing_(Southern_China_Profile)_(n=15)", "Southern China"),
            ("Han_Fujian_(n=35)", "Southern China"),
            ("Manchu_Guizhou_Bijie_(n=27)", "Southern China"),
            ("Manchu_Liaoning_(n=96)", "Manchu"),
            ("Korean_(n=102)", "Korean"), ("Korean_Jeju_Island_(n=47)", "Korean"),
            ("Japanese_(n=476)", "Japanese"),
        ):
            if name in self.populations("global-himalaya"):
                self.assertNotIn(name, regular)
            else:
                self.assertEqual(regular[name], group, name)
        self.assertEqual(len(regular), len(pca["deepReferences"]))
        mixed = self.populations(pca["id"], "deepMixedReferences")
        self.assertEqual(mixed, {"Dungan_(European-Mixed)_(n=1)": "Western China"})
        self.assertTrue(set(regular).isdisjoint(mixed))
        self.assertEqual(len(regular) + len(mixed), 193)

    def test_east_asia_main_keeps_western_and_northern_china(self):
        pca = self.pcas["global-east-asia"]
        main = self.populations(pca["id"], "references")
        counts = Counter(main.values())
        self.assertEqual(counts["Tibet"], 0)
        self.assertEqual(counts["Western China"], 8)
        self.assertEqual(counts["Northern China"], 18)
        self.assertEqual(main["Han_Hebei_Baoding_(n=1)"], "Northern China")
        self.assertEqual(main["Han_Jilin_Changchun_(n=1)"], "Northern China")
        self.assertEqual(main["Han_Liaoning_Dalian_(n=1)"], "Northern China")
        self.assertNotIn("Tibetan_Lhasa_(n=9)", main)
        self.assertNotIn("Sherpa_Rolwaling_Himal_(n=30)", main)
        deep = self.populations(pca["id"])
        self.assertEqual(self.populations("global-himalaya")["Tibetan_Lhasa_(n=9)"], "Tibet and Sherpa")
        self.assertEqual(self.populations("global-himalaya")["Sherpa_Rolwaling_Himal_(n=30)"], "Tibet and Sherpa")

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
