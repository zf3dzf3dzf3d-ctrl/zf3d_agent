# -*- coding: utf-8 -*-
"""写前预检：写回 / 替换内容前做语法自检，防止把文件改坏。

check_syntax(path, content) -> (ok: bool, err: str|None)
- 仅对 .py 文件用 ast.parse 做语法检查；其他扩展名直接放行
- 解析异常时返回可读错误（文件名+行号+列+摘要）
- 任何意外异常都不阻断写入（返回 ok），只在本模块内部兜底
"""
import ast


def check_syntax(path, content):
    try:
        if not str(path).lower().endswith('.py'):
            return True, None
        if not isinstance(content, str):
            return True, None
        try:
            ast.parse(content, filename=str(path))
            return True, None
        except SyntaxError as e:
            line = getattr(e, 'lineno', '?')
            col = getattr(e, 'offset', '?')
            msg = getattr(e, 'msg', str(e))
            text = getattr(e, 'text', '') or ''
            err = f'syntax check failed for {path}: line {line}, col {col}: {msg} | {text.strip()[:80]}'
            return False, err
    except Exception:
        # 预检自身出错不阻断正常写入
        return True, None
