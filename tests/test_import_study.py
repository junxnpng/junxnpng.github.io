import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path("/Users/jun/Documents/Jun's box/998_eng/basic_verbs")


class ImportStudyTest(unittest.TestCase):
    def test_daily_material_survives_export_and_repeated_import(self):
        # Catches dropped senses, lost register labels, and accumulating exports.
        with tempfile.TemporaryDirectory() as destination:
            command = [sys.executable, str(ROOT / "scripts/import-study.py"),
                       str(SOURCE), "--destination", destination]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            data_path = Path(destination) / "data/study/basic_verbs.json"
            days = json.loads(data_path.read_text())
            self.assertEqual(len(days), 14)
            cards = [card for day in days for card in day["items"]]
            self.assertEqual(len(cards), 285)
            self.assertEqual(len({card["id"] for card in cards}), 285)
            self.assertEqual(days[0]["items"][0]["id"], "GET-B001")
            self.assertEqual(days[-1]["items"][-1]["id"], "KEEP-B028")
            first = cards[0]
            self.assertEqual(first["definition"], "Receive something — 받다")
            self.assertEqual(first["examples"], ["예문 [직접 작성]: Did you get my message?"])
            self.assertIn("get N (from sb)", first["pattern"])
            self.assertIn("oxfordlearnersdictionaries.com", first["sources"])
            take = next(card for card in cards if card["id"] == "TAKE-B001")
            self.assertTrue(take["notes"], "Separate register labels must survive")
            for day in days:
                self.assertIn(len(day["items"]), (20, 21))
                page = Path(destination) / f'content/study/basic-verbs/day-{day["day"]:02}/index.md'
                self.assertTrue(page.exists())
                for card in day["items"]:
                    self.assertTrue(card["definition"])
                    self.assertTrue(card["pattern"])
                    self.assertTrue(card["examples"])
                    self.assertIn(card["tier"], (1, 2, 3))
            before = data_path.read_bytes()
            subprocess.run(command, check=True, capture_output=True)
            self.assertEqual(data_path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
