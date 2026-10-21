import tempfile
import unittest
from pathlib import Path

from build_calculator_data import ROOT, read_modern_pcas, read_rows, rebuild_mixed_pca


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
                '{"modern":[{"id":"regional","title":"Region","file":"regional_g25.txt"}]}',
                encoding="utf-8")
            (path / "regional_g25.txt").write_text(
                "".join(f"Group:{name},{coordinates}\n" for name in ("One", "Two", "Three")),
                encoding="utf-8")
            self.assertEqual(read_modern_pcas(modern, path)[0]["anchorLabels"], ["Sample"])
            (path / "regional_g25.txt").write_text(
                "".join(f"Group:{name},{coordinates}\n" for name in ("One", "Two")) +
                "Group:Other," + ",".join(["1"] * 25), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "not in the Turkish modern dataset"):
                read_modern_pcas(modern, path)
            (path / "regional_g25.txt").write_text(
                "".join(f"Group:{name},{coordinates}\n" for name in ("One", "Two", "Three")),
                encoding="utf-8")
            (path / "other_g25.txt").write_text(
                "".join(f"Group:{name},{coordinates}\n" for name in ("Four", "Five", "Six")),
                encoding="utf-8")
            (path / "turkish_pca_config.txt").write_text(
                '{"modern":[{"id":"regional","title":"Region","file":"regional_g25.txt"},'
                '{"id":"other","title":"Other","file":"other_g25.txt"}]}',
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
            saved = ROOT / "data" / "pca" / "turkish_modern_pca_mixed_g25.txt"
            self.assertEqual(saved.read_text(encoding="utf-8"), output.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
