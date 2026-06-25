"""
一键运行全部测试
用法: python 测试/run_tests.py
"""
import unittest
import sys
from pathlib import Path

# 确保内核目录在sys.path中
sys.path.insert(0, str(Path(__file__).parent.parent / "公共区" / "内核"))

if __name__ == "__main__":
    loader = unittest.TestLoader()
    suite = loader.discover(str(Path(__file__).parent), pattern="test_*.py")
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
