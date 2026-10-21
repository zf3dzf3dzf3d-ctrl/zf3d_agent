#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools_audit.py —— 工具后端一致性体检脚本（静态 AST 分析，不执行工具代码）。

检查项：
  1. 模块能否被 AST 解析（语法错误）
  2. 是否定义 handle(body, ctx)
  3. 是否有模块 docstring（工具用途说明）
  4. handle 内是否有 send_json / send_error 调用（返回响应）
  5. 是否显式返回 {'ok': ...} 结构（send_json 字面量含 'ok' 键）
  6. 异常分支是否有 send_error（错误不静默）

用法：python server/tools_audit.py [--json]
退出码：0=全部通过，1=有 FAIL/WARN。
"""
import ast
import json
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATEGORIES = ('minimal', 'coding', 'writing', 'vision')


def audit_file(path):
    """返回 (issues: list[(level, msg)], meta: dict)"""
    issues = []
    rel = os.path.relpath(path, ROOT)
    src = open(path, 'r', encoding='utf-8-sig', errors='replace').read()
    try:
        tree = ast.parse(src)
    except SyntaxError as e:
        return [('FAIL', f'语法错误: {e}')], {}

    mod_doc = ast.get_docstring(tree)
    if not mod_doc:
        issues.append(('WARN', '缺少模块 docstring（工具用途未说明）'))

    has_handle = False
    send_json_calls = 0
    send_error_calls = 0
    ok_literal = False

    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == 'handle':
            has_handle = True
            args = [a.arg for a in node.args.args]
            if len(args) < 2:
                issues.append(('FAIL', f'handle 签名参数不足: handle({", ".join(args)})，应为 (body, ctx)'))
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            name = node.func.attr
            if name == 'send_json':
                send_json_calls += 1
                # 检查第一个参数是否为含 'ok' 键的字典字面量
                if node.args and isinstance(node.args[0], ast.Dict):
                    keys = [k.value if isinstance(k, ast.Constant) else None for k in node.args[0].keys]
                    if 'ok' not in keys:
                        issues.append(('WARN', f'第 {node.lineno} 行 send_json 返回缺少 "ok" 字段'))
                    else:
                        ok_literal = True
            elif name == 'send_error':
                send_error_calls += 1

    tool_name = None
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == 'TOOL_NAME':
                    tool_name = 'declared'
    if not has_handle:
        # 与注册表 _scan 判定一致：无 handle 会被跳过；无 TOOL_NAME 说明是共享库而非工具
        if tool_name:
            issues.append(('FAIL', '声明了 TOOL_NAME 但未定义 handle(body, ctx) 入口函数'))
    else:
        # 委托模式豁免：handle 只调用了共享 _base 处理器（如 handle_writing）属合法
        delegates = False
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name == 'handle':
                for sub in ast.walk(node):
                    if (isinstance(sub, ast.Call) and isinstance(sub.func, ast.Name)
                            and sub.func.id.startswith('handle_')):
                        delegates = True
        if not delegates:
            if send_json_calls == 0 and send_error_calls == 0:
                issues.append(('FAIL', 'handle 内无 send_json/send_error 调用（不返回响应）'))
            elif send_json_calls > 0 and not ok_literal:
                issues.append(('WARN', 'send_json 返回值均未携带 "ok" 字段（上层无法判断成败）'))
            if send_error_calls == 0 and send_json_calls > 0:
                issues.append(('WARN', '无 send_error 调用（异常路径可能静默失败）'))

    return issues, {'doc': bool(mod_doc), 'send_json': send_json_calls, 'send_error': send_error_calls}


def main():
    as_json = '--json' in sys.argv
    results = []
    total_files = 0
    fail = warn = 0
    for cat in CATEGORIES:
        backend = os.path.join(ROOT, 'tools', cat, 'backend')
        if not os.path.isdir(backend):
            continue
        for fn in sorted(os.listdir(backend)):
            if not fn.endswith('.py') or fn.startswith('_') or fn == 'base.py':
                continue
            total_files += 1
            path = os.path.join(backend, fn)
            issues, meta = audit_file(path)
            f = sum(1 for lv, _ in issues if lv == 'FAIL')
            w = sum(1 for lv, _ in issues if lv == 'WARN')
            fail += f
            warn += w
            if issues:
                results.append({'tool': fn, 'category': cat,
                                'issues': [{'level': lv, 'msg': m} for lv, m in issues]})

    summary = {'total': total_files, 'fail': fail, 'warn': warn,
               'clean': total_files - len(results)}
    if as_json:
        print(json.dumps({'summary': summary, 'problems': results},
                         ensure_ascii=False, indent=2))
    else:
        print('=' * 60)
        print('工具后端一致性体检报告')
        print('=' * 60)
        print(f'扫描文件: {total_files}  FAIL: {fail}  WARN: {warn}  干净: {summary["clean"]}')
        for r in results:
            print(f'\n[{r["category"]}] {r["tool"]}')
            for i in r['issues']:
                mark = '✗' if i['level'] == 'FAIL' else '△'
                print(f'  {mark} {i["msg"]}')
        if not results:
            print('全部通过。')
        print()
        sys.exit(1 if (fail or warn) else 0)
    sys.exit(1 if (fail or warn) else 0)


if __name__ == '__main__':
    main()
