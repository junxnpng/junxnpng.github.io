import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

script = Path(__file__).parents[1] / 'scripts/ipa-obsidian-sync.py'
module = None
if script.exists():
    spec = importlib.util.spec_from_file_location('ipa_sync', script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


class Notes(unittest.TestCase):
    def state(self):
        return {'format': 'saymore-ipa-progress', 'version': 1, 'items': {'ipa-1': {'mastered': True, 'updatedAt': '2026-11-09T00:00:00.000Z', 'changeId': 'test'}}}

    def test_note_lists_mastered_symbols_and_preserves_personal_memos(self):
        self.assertIsNotNone(module, 'Obsidian mirror is not implemented')
        first = module.render_note(self.state())
        self.assertIn('1 / 67', first)
        self.assertEqual(first.count('- [x]'), 1)
        previous = first + '\n나의 메모: sheep / ship 비교하기\n'
        updated = self.state()
        updated['items']['ipa-1']['mastered'] = False
        note = module.render_note(updated, previous)
        self.assertIn('0 / 67', note)
        self.assertIn('나의 메모: sheep / ship 비교하기', note)
        self.assertEqual(note.count(module.START), 1)

    def test_unrelated_note_is_never_overwritten(self):
        self.assertIsNotNone(module)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'IPA 학습기록.md'
            path.write_text('내 기존 노트')
            with self.assertRaises(ValueError):
                module.write_note(path, self.state())
            self.assertEqual(path.read_text(), '내 기존 노트')

    def test_repeated_poll_does_not_touch_unchanged_note(self):
        self.assertIsNotNone(module)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'IPA 학습기록.md'
            module.write_note(path, self.state())
            before = path.stat().st_mtime_ns
            self.assertFalse(module.write_note(path, self.state()))
            self.assertEqual(path.stat().st_mtime_ns, before)

    def test_corrupt_remote_record_does_not_replace_existing_note(self):
        self.assertIsNotNone(module)
        with self.assertRaises(ValueError):
            module.validate_state({'format': 'saymore-ipa-progress', 'version': 2, 'items': {}})
        broken = self.state()
        broken['items']['ipa-1']['mastered'] = 'yes'
        with self.assertRaises(ValueError):
            module.validate_state(broken)


if __name__ == '__main__':
    unittest.main()
