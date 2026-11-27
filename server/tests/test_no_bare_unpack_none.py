# -*- coding: utf-8 -*-
"""
S2 防线（策划案-多端口多赛道优化突破v2 步骤2）：
AST 静态扫描 —— 检测「函数体可能隐式返回 None，但调用处按二元 tuple 解包」的洞。
背景：hot_reload.py `_collect_reload_set`（11-11 修）与 `_reload_exec_modules`（11-13 修）
同类缺 return bug 二次复发，本脚本防第三次复发。

检测策略（低误报优先，手动跑、不挂自动钩子）：
1. 找出所有 `x, y = expr` / `(x, y) = expr` 二元解包赋值；
2. 解析 expr 中的方法/函数名，定位本文件内的 def；
3. 若该函数体所有 return 路径都无带值 return（或干脆无 return）→ 报错。
"""
import ast
import sys
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent


def returns_none_always(fn_node):
    """函数体所有 return 都是无值 return（或没有 return）→ True"""
    has_any_return = False
    for node in ast.walk(fn_node):
        if isinstance(node, ast.Return):
            has_any_return = True
            if node.value is not None:
                return False
    return True  # 无 return 或全为 bare return


def collect_func_defs(tree):
    out = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            out[node.name] = node
    return out


def callee_names(expr):
    """仅提取被真正调用的函数名：
    - 顶层是 Name 调用（如 foo(...)）→ foo
    - 顶层是 Attribute 调用（如 self.foo(...) / mod.foo(...)）→ foo（self 方法/模块函数均可能）
    排除关键字参数值里的名字（log=_cli_log_stderr 这类引用不是调用）。
    """
    names = set()
    if isinstance(expr, ast.Call):
        f = expr.func
        if isinstance(f, ast.Name):
            names.add(f.id)
        elif isinstance(f, ast.Attribute):
            # 仅匹配 self.xxx(...)（本类方法，hot_reload 同类洞所在形态）；
            # mod.xxx(...) 跨模块调用与本文件同名 def 无关，排除防误报
            if isinstance(f.value, ast.Name) and f.value.id == 'self':
                names.add(f.attr)
    elif isinstance(expr, ast.Name):
        # a, b = some_var（变量本身可能是 tuple）无法静态判定，跳过不报
        pass
    return names


def check_file(path):
    problems = []
    src = path.read_text(encoding="utf-8-sig", errors="ignore")  # utf-8-sig: 兼容带 BOM 文件，消扫描盲区
    try:
        tree = ast.parse(src)
    except SyntaxError as e:
        print(f"[SKIP] {path.name} 语法错误: {e}")
        return problems
    funcs = collect_func_defs(tree)

    for node in ast.walk(tree):
        # 仅检查二元解包（含 self.x, self.y = 形式取 Tuple 赋值）
        if isinstance(node, ast.Assign) and isinstance(node.value, (ast.Name, ast.Call, ast.Attribute)):
            targets = node.targets
            if len(targets) != 1:
                continue
            t = targets[0]
            # 二元解包：a, b = ... 或 (a, b) = ...
            if isinstance(t, ast.Tuple) and len(t.elts) == 2:
                for name in callee_names(node.value):
                    fn = funcs.get(name)
                    if fn is not None and returns_none_always(fn):
                        problems.append(
                            f"{path.name}:{node.lineno} 解包赋值调用了 `{name}`"
                            f"（def 在 L{fn.lineno}），但该函数所有 return 路径均无返回值 → 必然 NoneType 解包崩溃"
                        )
        elif isinstance(node, (ast.AnnAssign, ast.AugAssign)):
            pass  # 单目标赋值不涉及解包
    # 含 typed 解包 x: t, y: t2 = 形式较少见，忽略
    return problems


def main():
    all_problems = []
    files = sorted(p for p in SERVER_DIR.rglob("*.py") if "__pycache__" not in p.parts)
    for f in files:
        all_problems.extend(check_file(f))
    if all_problems:
        print("❌ 发现缺 return 的解包洞：")
        for p in all_problems:
            print("  " + p)
        sys.exit(1)
    print(f"✅ AST 防线通过：递归扫描 server/ 下 {len(files)} 个 .py，未发现「无值 return 函数被二元解包」的洞")


if __name__ == "__main__":
    main()
