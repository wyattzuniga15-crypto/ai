"""Run every headless test. `python tests/run_all.py`"""
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

loader = unittest.TestLoader()
suite = unittest.TestSuite([loader.discover(str(HERE), pattern="test_*.py")])
result = unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
