"""
安全计算器测试 — 验证AST遍历求值器的正确性和安全性
"""
import sys
from pathlib import Path

# 确保内核目录在搜索路径
内核目录 = Path(__file__).parent.parent / "公共区" / "内核"
if str(内核目录) not in sys.path:
    sys.path.insert(0, str(内核目录))

from 安全计算器 import 安全计算器


class Test安全计算器:
    """安全计算器基础功能"""

    def setup_method(self):
        self.计算器 = 安全计算器()

    def test_四则运算(self):
        assert self.计算器.计算("1 + 2") == 3
        assert self.计算器.计算("10 - 3") == 7
        assert self.计算器.计算("4 * 5") == 20
        assert self.计算器.计算("15 / 3") == 5.0

    def test_优先级(self):
        assert self.计算器.计算("2 + 3 * 4") == 14
        assert self.计算器.计算("(2 + 3) * 4") == 20
        assert self.计算器.计算("2 ** 3") == 8

    def test_取模和整除(self):
        assert self.计算器.计算("10 % 3") == 1
        assert self.计算器.计算("10 // 3") == 3

    def test_一元运算(self):
        assert self.计算器.计算("-5") == -5
        assert self.计算器.计算("+-5") == -5

    def test_数学函数(self):
        assert self.计算器.计算("abs(-10)") == 10
        assert self.计算器.计算("round(3.14)") == 3
        assert self.计算器.计算("max(1, 2, 3)") == 3
        assert self.计算器.计算("min(1, 2, 3)") == 1

    def test_三角函数(self):
        import math
        assert self.计算器.计算("sin(0)") == 0.0
        assert abs(self.计算器.计算("cos(0)") - 1.0) < 1e-10

    def test_常量(self):
        import math
        assert self.计算器.计算("pi") == math.pi
        assert self.计算器.计算("e") == math.e

    def test_嵌套函数(self):
        assert self.计算器.计算("round(abs(-3.7))") == 4


class Test安全计算器_安全防护:
    """验证安全计算器能阻止恶意输入"""

    def setup_method(self):
        self.计算器 = 安全计算器()

    def test_空表达式(self):
        try:
            self.计算器.计算("")
            assert False, "应抛出异常"
        except ValueError:
            pass

    def test_禁止import(self):
        try:
            self.计算器.计算("__import__('os')")
            assert False, "应拒绝import调用"
        except ValueError:
            pass

    def test_禁止属性访问(self):
        try:
            self.计算器.计算("().__class__")
            assert False, "应拒绝属性访问"
        except ValueError:
            pass

    def test_禁止赋值(self):
        try:
            self.计算器.计算("x = 1")
            assert False, "应拒绝赋值语句"
        except ValueError:
            pass

    def test_禁止lambda(self):
        try:
            self.计算器.计算("(lambda: 1)()")
            assert False, "应拒绝lambda"
        except ValueError:
            pass

    def test_禁止未知函数(self):
        try:
            self.计算器.计算("eval('1+1')")
            assert False, "应拒绝未知函数"
        except ValueError:
            pass

    def test_禁止列表推导(self):
        try:
            self.计算器.计算("[x for x in range(10)]")
            assert False, "应拒绝列表推导"
        except ValueError:
            pass
