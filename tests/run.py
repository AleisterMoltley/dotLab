#!/usr/bin/env python3
"""Cheap suite: no Ollama, no network required (gh optional).

    python3 tests/run.py
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIN = ROOT / "bin"
sys.path.insert(0, str(BIN))


def main() -> int:
    suite = unittest.defaultTestLoader.discover(
        str(Path(__file__).resolve().parent),
        pattern="test_*.py",
    )
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
