# -*- coding: utf-8 -*-
"""pytest 收集配置（工程基建总纲 P1.4 20261123）。

本仓库 tests/ 里混有两类文件：
  pytest 式（test_* 函数）—— 门禁收集对象；
  脚本式（模块级 sys.exit / 自带生产护栏的一次性实测脚本，如
  test_fullchain_boot.py 改写 port.json 启停服务）—— 只能单独手工执行。

脚本式文件一旦被收集，import 阶段的 sys.exit 会以 INTERNALERROR 炸掉
整个 pytest 进程。这里用 AST 在收集期自动识别"模块级含 sys.exit/exit
调用"的文件并排除，此后蜂群新增脚本式测试不再需要手工维护排除清单。

【A4 20261123 两级收集规则】实测发现部分脚本式文件 exit 虽在 __main__
守卫内，import 仍会启动整个服务内核（如 test_m0_baseline），不能仅凭
守卫放行。故规则收紧为：
  文件内定义了 def test_* 入口函数 = 作者显式声明 pytest 安全 → 收集；
  无 test_* 入口且含 exit 调用 → 照旧排除（防御不减弱）。
"""
import ast
from pathlib import Path

_HERE = Path(__file__).resolve().parent


def _has_pytest_entry(path):
    """是否定义了 pytest 入口函数（def test_*）——作者声明的可收集标记。"""
    try:
        tree = ast.parse(path.read_text('utf-8-sig'))
    except SyntaxError:
        return False
    return any(
        isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name.startswith('test_')
        for n in tree.body
    )


def _has_toplevel_exit(path):
    try:
        tree = ast.parse(path.read_text('utf-8-sig'))
    except SyntaxError:
        return True
    for node in tree.body:
        for sub in ast.walk(node):
            if isinstance(sub, ast.Call):
                fn = sub.func
                if isinstance(fn, ast.Name) and fn.id == 'exit':
                    return True
                if isinstance(fn, ast.Attribute) and fn.attr == 'exit':
                    return True
    return False


collect_ignore = [
    p.name for p in sorted(_HERE.glob('test_*.py'))
    if not _has_pytest_entry(p) and _has_toplevel_exit(p)
]
