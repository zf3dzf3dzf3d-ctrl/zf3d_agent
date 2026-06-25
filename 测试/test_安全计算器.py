"""
安全计算器测试 — 正常表达式/注入攻击/边界情况
运行: python -m unittest 测试.test_安全计算器
"""
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "公共区" / "内核"))
from 安全计算器 import 安全计算器, 获取计算器, 安全计算


class Test安全计算(unittest.TestCase):

    def setUp(self):
        self.计算 = 获取计算器()

    def test_基本四则运算(self):
        self.assertEqual(self.计算.计算("1 + 2"), 3)
        self.assertEqual(self.计算.计算("10 - 5"), 5)
        self.assertEqual(self.计算.计算("3 * 4"), 12)
        self.assertEqual(self.计算.计算("15 / 3"), 5.0)

    def test_复合运算(self):
        self.assertAlmostEqual(self.计算.计算("2 + 3 * 4"), 14)
        self.assertEqual(self.计算.计算("(2 + 3) * 4"), 20)
        self.assertEqual(self.计算.计算("2 ** 10"), 1024)
        self.assertEqual(self.计算.计算("17 % 5"), 2)

    def test_数学函数(self):
        import math
        self.assertEqual(self.计算.计算("abs(-5)"), 5)
        self.assertEqual(self.计算.计算("round(3.7)"), 4)
        self.assertEqual(self.计算.计算("max(1, 2, 3)"), 3)
        self.assertEqual(self.计算.计算("min(1, 2, 3)"), 1)
        self.assertAlmostEqual(self.计算.计算("sqrt(16)"), 4.0)
        self.assertAlmostEqual(self.计算.计算("sin(0)"), 0.0)

    def test_常量(self):
        self.assertAlmostEqual(self.计算.计算("pi"), 3.141592653589793)
        self.assertAlmostEqual(self.计算.计算("e"), 2.718281828459045)

    def test_一元运算(self):
        self.assertEqual(self.计算.计算("-5"), -5)
        self.assertEqual(self.计算.计算("-(-5)"), 5)
        self.assertEqual(self.计算.计算("+5"), 5)

    def test_空表达式(self):
        with self.assertRaises(ValueError):
            self.计算.计算("")
        with self.assertRaises(ValueError):
            self.计算.计算("   ")

    def test_语法错误(self):
        with self.assertRaises(ValueError):
            self.计算.计算("1 +* 2")
        with self.assertRaises(ValueError):
            self.计算.计算("1 +")

    def test_注入攻击_禁止函数(self):
        """确保无法调用危险函数"""
        with self.assertRaises(ValueError):
            self.计算.计算("open('test.txt')")
        with self.assertRaises(ValueError):
            self.计算.计算("__import__('os')")
        with self.assertRaises(ValueError):
            self.计算.计算("exec('print(1)')")
        with self.assertRaises(ValueError):
            self.计算.计算("eval('1+1')")

    def test_注入攻击_禁止属性访问(self):
        """确保无法访问__builtins__等"""
        with self.assertRaises(ValueError):
            self.计算.计算("__builtins__")
        with self.assertRaises(ValueError):
            self.计算.计算("os.system('ls')")

    def test_注入攻击_禁止赋值(self):
        with self.assertRaises(ValueError):
            self.计算.计算("x = 1")
        with self.assertRaises(ValueError):
            self.计算.计算("import os")

    def test_小数运算(self):
        self.assertAlmostEqual(self.计算.计算("0.1 + 0.2"), 0.30000000000000004)
        self.assertAlmostEqual(self.计算.计算("3.14 * 2"), 6.28)


if __name__ == "__main__":
    unittest.main()
