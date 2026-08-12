from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import slice as slicelib
import studio_ops as ops


class TestStudioOps(unittest.TestCase):
    def test_session_and_verify(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dest = Path(raw) / "demo"
            dest.mkdir()
            with mock.patch.object(ops, "under_projects", return_value=True):
                with mock.patch.object(ops, "project_search_roots", return_value=[Path(raw)]):
                    spec = slicelib.compile_prompt("neon shooter")
                    slicelib.write_web_slice(dest, spec)
                    v = ops.cached_verify(dest, force=True)
                    self.assertTrue(v.get("ok"), v)
                    self.assertGreaterEqual(int(v.get("score") or 0), 80)
                    ops.session_note(dest, "craft", "more enemies")
                    s = ops.load_session(dest)
                    self.assertEqual(s["crafts"][0]["text"], "more enemies")
                    ops.session_set_play(dest, "http://127.0.0.1:5173/")
                    s2 = ops.load_session(dest)
                    self.assertIn("5173", s2["last_play"])

    def test_export_zip(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            dest = root / "zipme"
            dest.mkdir()
            with mock.patch.object(ops, "project_search_roots", return_value=[root]):
                with mock.patch.object(ops, "under_projects", return_value=True):
                    slicelib.write_web_slice(dest, slicelib.compile_prompt("jumper"))
                    r = ops.export_zip(dest)
                    self.assertTrue(r.get("ok"), r)
                    self.assertTrue(Path(r["path"]).is_file())

    def test_diagnose_play_log(self) -> None:
        d = ops.diagnose_play_log("npm ERR! code ELSPROBLEMS\nmissing: three@")
        self.assertIn("npm", d["primary"].lower())
        d2 = ops.diagnose_play_log("Error: listen EADDRINUSE: address already in use :::5173")
        self.assertIn("port", d2["primary"].lower())
        d3 = ops.diagnose_play_log("  ➜  Local:   http://127.0.0.1:5173/\n  ready in 320 ms")
        self.assertTrue(d3.get("ok"))

    def test_soft_delete_and_restore(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            dest = root / "softme"
            dest.mkdir()
            (dest / "package.json").write_text("{}", encoding="utf-8")
            with mock.patch.object(ops, "project_search_roots", return_value=[root]):
                with mock.patch.object(ops, "projects_root_safe", return_value=root):
                    with mock.patch.object(ops, "under_projects", return_value=True):
                        r = ops.soft_delete(dest)
                        self.assertTrue(r.get("ok"), r)
                        self.assertTrue(r.get("soft"))
                        self.assertFalse(dest.exists())
                        trash_path = Path(r["trash_path"])
                        self.assertTrue(trash_path.is_dir())
                        items = ops.list_trash()
                        self.assertTrue(any(i["path"] == str(trash_path.resolve()) for i in items))
                        back = ops.restore_trash(trash_path)
                        self.assertTrue(back.get("ok"), back)
                        self.assertTrue(Path(back["path"]).is_dir())


if __name__ == "__main__":
    unittest.main()
