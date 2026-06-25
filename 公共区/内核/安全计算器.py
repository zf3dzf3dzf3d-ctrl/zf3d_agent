"""
安全计算器 — 零eval，纯AST遍历的数学表达式求值器
用ast模块解析表达式为语法树，只允许安全节点类型，彻底消除注入风险
支持：四则运算、幂、模、一元负正、数学函数（sin/cos/log/sqrt等）、常量（pi/e）
"""
import ast
import operator
import math


class 安全计算器:
    """纯AST遍历的安全数学表达式计算器，无eval无exec"""

    _允许运算符 = {
        ast.Add: operator.add,
        ast.Sub: operator.sub,
        ast.Mult: operator.mul,
        ast.Div: operator.truediv,
        ast.FloorDiv: operator.floordiv,
        ast.Mod: operator.mod,
        ast.Pow: operator.pow,
        ast.USub: operator.neg,
        ast.UAdd: operator.pos,
    }

    _允许函数 = {
        'abs': abs,
        'round': round,
        'min': min,
        'max': max,
        'sum': sum,
        'pow': pow,
        'int': int,
        'float': float,
        'sqrt': math.sqrt,
        'sin': math.sin,
        'cos': math.cos,
        'tan': math.tan,
        'asin': math.asin,
        'acos': math.acos,
        'atan': math.atan,
        'log': math.log,
        'log2': math.log2,
        'log10': math.log10,
        'ceil': math.ceil,
        'floor': math.floor,
        'degrees': math.degrees,
        'radians': math.radians,
        'gcd': math.gcd,
    }

    _允许常量 = {
        'pi': math.pi,
        'e': math.e,
        'tau': math.tau,
        'inf': math.inf,
    }

    _允许节点 = (
        ast.Expression,
        ast.Constant,
        ast.Num,
        ast.BinOp,
        ast.UnaryOp,
        ast.Call,
        ast.Name,
        ast.Load,
        ast.Tuple,
    )

    _允许运算符类型 = (
        ast.Add, ast.Sub, ast.Mult, ast.Div,
        ast.FloorDiv, ast.Mod, ast.Pow,
        ast.USub, ast.UAdd,
    )

    def 计算(self, 表达式: str) -> float:
        """解析并计算数学表达式，返回数值结果"""
        表达式 = 表达式.strip()
        if not 表达式:
            raise ValueError("表达式为空")
        try:
            树 = ast.parse(表达式, mode='eval')
        except SyntaxError as e:
            raise ValueError(f"语法错误: {e}")
        return self._求值(树.body)

    def _求值(self, 节点):
        """递归遍历AST节点求值，非白名单节点直接拒绝"""

        # 数字常量
        if isinstance(节点, (ast.Constant, ast.Num)):
            return 节点.value

        # 二元运算
        if isinstance(节点, ast.BinOp):
            运算符类型 = type(节点.op)
            if 运算符类型 not in self._允许运算符:
                raise ValueError(f"不支持的运算符: {运算符类型.__name__}")
            左 = self._求值(节点.left)
            右 = self._求值(节点.right)
            return self._允许运算符[运算符类型](左, 右)

        # 一元运算（负号/正号）
        if isinstance(节点, ast.UnaryOp):
            运算符类型 = type(节点.op)
            if 运算符类型 not in self._允许运算符:
                raise ValueError(f"不支持的一元运算符: {运算符类型.__name__}")
            操作数 = self._求值(节点.operand)
            return self._允许运算符[运算符类型](操作数)

        # 函数调用
        if isinstance(节点, ast.Call):
            if not isinstance(节点.func, ast.Name):
                raise ValueError("只支持直接函数调用")
            函数名 = 节点.func.id
            if 函数名 not in self._允许函数:
                raise ValueError(f"不允许的函数: {函数名}")
            参数 = [self._求值(a) for a in 节点.args]
            return self._允许函数[函数名](*参数)

        # 常量名（pi、e等）
        if isinstance(节点, ast.Name):
            名 = 节点.id
            if 名 not in self._允许常量:
                raise ValueError(f"不允许的名称: {名}")
            return self._允许常量[名]

        # 元组（min/max/sum等多参数场景）
        if isinstance(节点, ast.Tuple):
            return tuple(self._求值(e) for e in 节点.elts)

        raise ValueError(f"不允许的表达式节点: {type(节点).__name__}")


# 全局单例
_计算器实例 = None


def 获取计算器() -> 安全计算器:
    """获取全局安全计算器实例"""
    global _计算器实例
    if _计算器实例 is None:
        _计算器实例 = 安全计算器()
    return _计算器实例


def 安全计算(表达式: str) -> float:
    """便捷函数：安全计算数学表达式"""
    return 获取计算器().计算(表达式)
