import tempfile
import unittest
from pathlib import Path

from build_calculator_data import read_modern_pcas, read_rows


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


if __name__ == "__main__":
    unittest.main()
