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

    def test_himalayan_profiles_are_split_by_cluster_and_keep_source_coordinates(self):
        south = self.populations("global-south-asia")
        central = self.populations("global-central-asia")
        east = self.populations("global-east-asia")
        southeast = self.populations("global-southeast-asia")
        foothills = {"Kusunda_(n=10)", "Newar_(n=21)", "Tharu_(n=26)",
                     "Rajbanshi_West_Bengal_(n=15)", "Magar_(Newar_Profile)_(n=20)",
                     "Tibetan_Muslim_Srinagar_(n=15)", "Khas_Dalit_Nepal_(n=3)",
                     "Khas_Dalit_Damai_Nepal_(n=2)"}
        self.assertTrue({"Khas_Dalit_Nepal_(n=3)", "Khas_Dalit_Damai_Nepal_(n=2)"}
                        <= {name for name, group in south.items() if group == "Himalaya"})
        self.assertEqual(south["Newar_(n=21)"], "Newar")
        self.assertEqual(south["Magar_(Newar_Profile)_(n=20)"], "Newar")
        self.assertNotIn("Tibetan and Himalayan", set(central.values()))
        plateau = {name for name in east if name.startswith((
            "Tibetan_", "Sherpa_", "Tamang_", "Gurung_", "Gyalrong_", "Magar_", "Naxi_",
            "Pumi_", "Qiang_", "Rai_", "Baima_", "Tu_", "Kusunda_"))}
        self.assertEqual(east["Tu_(n=5)"], "Western China")
        self.assertEqual(len(plateau), 28)
        for name in ("Tibetan_(n=19)", "Sherpa_Khumbu_(n=173)",
                     "Gurung_(n=5)", "Gyalrong_(n=3)", "Naxi_(n=5)"):
            self.assertIn(name, plateau)
        northern_prefixes = ("Balti_", "Brokpa_", "Dogra_", "Garhwali_", "Himachali_",
                             "Khas_", "Kumaoni_", "Madhesi_", "Pahari_")
        northern = {row[1] for row in self.source if row[1].startswith(northern_prefixes)}
        self.assertEqual(len(northern), 19)
        self.assertTrue(northern <= {name for name, group in south.items() if group == "Himalaya"})
        self.assertEqual(south["Dogra_Kashmir_(n=5)"], "Himalaya")
        self.assertEqual(south["Khas_Dalit_Nepal_(n=3)"], "Himalaya")
        southeast_himalayans = {"Kusunda_(n=10)", "Tibetan_Muslim_Srinagar_(n=15)",
                                "Magar_(n=17)", "Tamang_(n=8)", "Tamang_Simigaon_(n=20)"}
        moved = northern | plateau | foothills | southeast_himalayans
        self.assertEqual(len(moved), 56)
        self.assertEqual(moved & set(east), plateau)
        self.assertFalse(plateau & set(south))
        self.assertFalse(plateau & set(central))
        self.assertFalse(foothills & set(central))
        self.assertEqual(southeast["Tharu_(n=26)"], "Indo-Burmese")
        self.assertEqual(southeast["Rajbanshi_West_Bengal_(n=15)"], "Indo-Burmese")
        # The loader checks every row against the source by label AND coordinates.
        for pca_id in ("global-south-asia", "global-central-asia", "global-east-asia"):
            pca = self.pcas[pca_id]
            for key in ("references", "deepReferences"):
                counts = Counter(row[1].split(":", 1)[1].strip() for row in pca[key])
                self.assertTrue(all(count == 1 for count in counts.values()))

    def test_himalaya_merges_foothills_and_northern_shift_without_southeast_extremes(self):
        south = self.populations("global-south-asia")
        southeast = self.populations("global-southeast-asia")
        himalaya = {name for name, group in south.items() if group == "Himalaya"}
        self.assertEqual(len(himalaya), 24)
        self.assertTrue({"Himalayan Foothills", "Nepal", "Northeast India"}.isdisjoint(south.values()))
        for name in ("Balti_(n=17)", "Garhwali_Rajput_(n=7)",
                     "Himachali_Rajput_Mandi_(n=1)", "Khas_Kshatriya_Chhetri_Nepal_(n=24)",
                     "Kumaoni_Rajput_Thakur_(n=18)", "Himachali_Brahmin_Kangra_(n=2)",
                     "Garhwali_Brahmin_(n=2)", "Kumaoni_Brahmin_(n=8)", "Madhesi_Brahmin_(n=1)",
                     "Khas_Brahmin_(Bahun)_Nepal_(n=35)", "Brokpa_(Minaro)_(n=5)",
                     "Pahari_Mirpur_(n=2)", "Kashmiri_Pandit_(n=26)",
                     "Kashmiri_Muslim_Srinagar_(n=15)", "Gujar_Kashmir_(n=13)", "Burusho_(n=20)"):
            self.assertIn(name, himalaya)
        for name in ("Punjabi_Jat_Sikh_(n=60)", "Saraiki_Jat_(n=4)", "Sindhi_(n=9)"):
            self.assertEqual(south[name], "Punjab and North India")
        sections = read_row_sections(ROOT / "data/pca/modern_pca2.g25.txt", "modern")
        self.assertEqual({row[1].split(":", 1)[1].strip() for row in sections["deep"]
                          if row[1].startswith("Himalaya:")},
                         {"Gujar_Kashmir_(n=13)", "Kashmiri_Muslim_Srinagar_(n=15)"})
        moved = {"Garo_(n=2)", "Khasi_(n=3)", "Hmar_(n=4)", "Kuki_(n=6)",
                 "Mizo_(n=112)", "Kom_(n=2)", "Tripuri_(n=19)",
                 "Tripuri_Jamatia_(n=18)", "Tripuri_Reang_(n=10)",
                 "Nyishi_(n=7)", "Naga_Myanmar_(n=28)", "Poumai_Naga_Manipur_(n=3)",
                 "Sumi_Naga_(n=3)", "Naga_Chakhesang_(n=5)", "Naga_India_(n=5)",
                 "Tharu_(n=26)", "Rajbanshi_West_Bengal_(n=15)", "Manipuri_Brahmin_(n=20)"}
        self.assertFalse(moved & set(south))
        for name in moved:
            expected = ("Indo-Burmese" if name in {"Khasi_(n=3)", "Tharu_(n=26)",
                        "Rajbanshi_West_Bengal_(n=15)", "Manipuri_Brahmin_(n=20)"}
                        else "Tibeto-Burman")
            self.assertEqual(southeast[name], expected)
        pca = self.pcas["global-southeast-asia"]
        names = [row[1].split(":", 1)[1].strip() for row in pca["deepReferences"]]
        self.assertEqual(len(names), len(set(names)))
        east = self.populations("global-east-asia")
        for name in ("Kusunda_(n=10)", "Tibetan_Muslim_Srinagar_(n=15)"):
            self.assertEqual(southeast[name], "Indo-Burmese")
            self.assertNotIn(name, east)
            self.assertNotIn(name, south)
        for number in (2, 8, 9):
            sections = read_row_sections(ROOT / f"data/pca/modern_pca{number}.g25.txt", "modern")
            names = [row[1].split(":", 1)[1].strip()
                     for rows in sections.values() for row in rows]
            self.assertEqual(len(names), len(set(names)), f"PCA{number} source duplicates")

    def test_southeast_asia_combines_language_families_geography_and_population_history(self):
        pca = self.pcas["global-southeast-asia"]
        self.assertEqual(list(dict.fromkeys(row[1].split(":", 1)[0] for row in pca["references"])),
                         ["Tai-Kadai", "Hmong-Mien", "Austroasiatic", "Tibeto-Burman", "Indo-Burmese",
                          "Malay Negrito", "Philippine Negrito", "Malay Peninsula",
                          "Western Austronesian", "Taiwan-Philippines", "Wallacea"])
        populations = self.populations(pca["id"])
        for name, group in (
            ("Thai_(n=11)", "Tai-Kadai"), ("Zhuang_Guangxi_Chongzuo_(n=10)", "Tai-Kadai"),
            ("Vietnamese_(Dong_Profile)_(n=2)", "Tai-Kadai"),
            ("Hmong_Thailand_(n=10)", "Hmong-Mien"), ("Bunu_Youmai_Yao_(n=28)", "Hmong-Mien"),
            ("Miao_Guizhou_Qiandongnan_Leishan_(n=49)", "Hmong-Mien"),
            ("Hani_(n=15)", "Tibeto-Burman"), ("Mizo_(n=112)", "Tibeto-Burman"),
            ("Khasi_(n=3)", "Indo-Burmese"), ("Assamese_(n=1)", "Indo-Burmese"),
            ("Batek_(n=45)", "Malay Negrito"), ("Maniq_(n=9)", "Malay Negrito"),
            ("Aeta_(n=2)", "Philippine Negrito"), ("Batak_Palawan_(n=2)", "Philippine Negrito"),
            ("Batak_Toba_(n=34)", "Western Austronesian"), ("Javanese_(n=29)", "Western Austronesian"),
            ("Cheq_Wong_(n=11)", "Malay Peninsula"), ("Mah_Meri_(n=21)", "Malay Peninsula"),
            ("Nyah_Kur_(n=10)", "Austroasiatic"), ("Kinh_(n=99)", "Austroasiatic"),
            ("Ami_(n=35)", "Taiwan-Philippines"), ("Filipino_(n=82)", "Taiwan-Philippines"),
            ("Ngadha_Bena_(n=31)", "Wallacea"), ("Alor_(n=23)", "Wallacea"),
        ):
            self.assertEqual(populations[name], group, name)
        hmong = {row[1] for row in self.source if row[1].startswith(("Bunu_", "Miao_"))}
        self.assertEqual(len(hmong), 15)
        self.assertTrue(all(populations[name] == "Hmong-Mien" for name in hmong))
        mixed = self.populations(pca["id"], "deepMixedReferences")
        self.assertEqual(mixed, {"Nicobarese_(n=6)": "Austroasiatic"})
        self.assertEqual(len(populations) + len(mixed), 165)
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

    def test_east_asia_has_seven_requested_groups_and_distinct_profile_assignments(self):
        pca = self.pcas["global-east-asia"]
        groups = list(dict.fromkeys(row[1].split(":", 1)[0] for row in pca["references"]))
        self.assertEqual(groups, ["Tibet", "Western China", "Northern China", "Southern China",
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
            self.assertEqual(regular[name], group, name)
        self.assertEqual(len(regular), len(pca["deepReferences"]))
        mixed = self.populations(pca["id"], "deepMixedReferences")
        self.assertEqual(mixed, {"Dungan_(European-Mixed)_(n=1)": "Western China"})
        self.assertTrue(set(regular).isdisjoint(mixed))
        self.assertEqual(len(regular) + len(mixed), 219)

    def test_east_asia_main_balances_tibet_western_and_northern_china(self):
        pca = self.pcas["global-east-asia"]
        main = self.populations(pca["id"], "references")
        counts = Counter(main.values())
        self.assertEqual(counts["Tibet"], 7)
        self.assertEqual(counts["Western China"], 12)
        self.assertEqual(counts["Northern China"], 18)
        self.assertEqual(main["Han_Hebei_Baoding_(n=1)"], "Northern China")
        self.assertEqual(main["Han_Jilin_Changchun_(n=1)"], "Northern China")
        self.assertEqual(main["Han_Liaoning_Dalian_(n=1)"], "Northern China")
        self.assertNotIn("Tibetan_Lhasa_(n=9)", main)
        self.assertNotIn("Sherpa_Rolwaling_Himal_(n=30)", main)
        deep = self.populations(pca["id"])
        self.assertEqual(deep["Tibetan_Lhasa_(n=9)"], "Tibet")
        self.assertEqual(deep["Sherpa_Rolwaling_Himal_(n=30)"], "Tibet")

    def test_eastern_himalayan_branch_moves_without_moving_the_plateau_core(self):
        east = self.populations("global-east-asia")
        southeast = self.populations("global-southeast-asia")
        for name, group in (
            ("Kusunda_(n=10)", "Indo-Burmese"),
            ("Tibetan_Muslim_Srinagar_(n=15)", "Indo-Burmese"),
            ("Magar_(n=17)", "Tibeto-Burman"),
            ("Tamang_(n=8)", "Tibeto-Burman"),
            ("Tamang_Simigaon_(n=20)", "Tibeto-Burman"),
        ):
            self.assertEqual(southeast[name], group)
            self.assertNotIn(name, east)
        for name in ("Tibetan_(n=19)", "Tibetan_Nepal_(n=1000)", "Tibetan_Lhasa_(n=9)",
                     "Sherpa_Khumbu_(n=173)", "Tamang_Tashinam_(n=11)", "Gurung_(n=5)"):
            self.assertEqual(east[name], "Tibet")
            self.assertNotIn(name, southeast)
        sections = read_row_sections(ROOT / "data/pca/modern_pca9.g25.txt", "modern")
        main = {row[1].split(":", 1)[1].strip() for row in sections["main"]}
        self.assertNotIn("Tamang_Simigaon_(n=20)", main)
        self.assertIn("Tamang_Simigaon_(n=20)",
                      {row[1].split(":", 1)[1].strip() for row in sections["deep"]})

    def test_saved_bundle_matches_the_editable_pca_files(self):
        text = (ROOT / "calculator/modern_pca_references.js").read_text()
        saved = json.loads(text.split(" = ", 1)[1].rstrip(";\n"))
        self.assertEqual(saved, list(self.pcas.values()))


if __name__ == "__main__":
    unittest.main()
