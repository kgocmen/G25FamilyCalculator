import unittest

from build.build_calculator_data import ROOT, read_rows


class PcaMapTests(unittest.TestCase):
    def test_map_covers_modern_source_in_source_order(self):
        source = read_rows(ROOT / "data" / "modern_g25.txt", "modern")
        lines = (ROOT / "build" / "pca_map.txt").read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(lines), len(source))
        self.assertTrue(all(line.startswith(f"{row[1]}, ")
                            for line, row in zip(lines, source)))
        self.assertFalse(any(line.endswith(", Unassigned") for line in lines))
        entries = dict(line.split(", ", 1) for line in lines)
        self.assertEqual(entries["Qizilbash_(n=1)"], "17-Iran-Main:Qizilbash")
        self.assertEqual(entries["Anglo-American_Kentucky_(n=125)"],
                         "13-Northwest Europe-DeepMixed:British Isles")
        self.assertEqual(entries["Bolivian_Mestizo_(n=5)"],
                         "11-Indigenous America-DeepMixed:Andes")
        self.assertEqual(entries["Algerian_Jew_(n=9)"],
                         "6-Jewish-Deep:Jewish Middle East")
        self.assertEqual(entries["Iraqi_Arab_Baghdad_(Irano-Mesopotamian_Profile)_(n=9)"],
                         "18-Arabia-Main:Irano-Mesopotamian")


if __name__ == "__main__":
    unittest.main()
