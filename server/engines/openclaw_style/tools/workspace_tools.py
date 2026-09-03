#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
openclaw_style/tools/workspace_tools.py - Gateway Worker 工具集
o_read / o_write / o_list / o_run —— 绑定工作区内的文件与命令操作。

风格延续 gateway_tools.py：纯文本返回，OK/ERR 前缀，
路径一律限制在绑定的工作区（ctx._oc_bindings 的 workspace 或 project_path）内。
"""

import os
import subprocess

OK, ERR = "OK", "ERR"
CLIP = 6000
RUN_TIMEOUT = 30


def _proj(ctx):
    # 优先用 o_bind 绑定的 web 渠道工作区，否则用项目目录
    bindings = (ctx or {}).get("_oc_bindings") or {}
    ws = bindings.get("web:default") or bindings.get("web")
    if ws and ws not in (".", ""):
        try:
            return os.path.abspath(ws)
        except Exception:
            pass
    return os.path.abspath((ctx or {}).get("project_path") or os.getcwd())


def _resolve(p, ctx):
    root = _proj(ctx)
    if not p:
        return root
    full = os.path.abspath(os.path.join(root, str(p)))
    # 路径必须落在工作区内（Gateway 安全围栏）
    if not (full == root or full.startswith(root + os.sep)):
        return None
    return full


def _clip(text):
    text = str(text)
    if len(text) <= CLIP:
        return text
    head = int(CLIP * 0.8)
    return text[:head] + "\n…[gateway clip: output truncated]\n" + text[-CLIP // 5:]


def _schema(name, desc, props, required=None):
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": desc,
            "parameters": {"type": "object",
                           "properties": props,
                           "required": required or []},
        },
    }


# ---------------- o_list ----------------

def _t_list(args, ctx):
    d = _resolve(args.get("path") or ".", ctx)
    if not d or not os.path.isdir(d):
        return "%s not_found dir=%r" % (ERR, args.get("path"))
    try:
        entries = sorted(os.listdir(d))
    except OSError as e:
        return "%s io_error %s" % (ERR, e)
    lines = []
    for e in entries[:200]:
        full = os.path.join(d, e)
        tag = "dir " if os.path.isdir(full) else "file"
        lines.append("%s %s" % (tag, e))
    return "%s %d entries (root=%s)\n%s" % (OK, len(entries), d, "\n".join(lines))


SCHEMA_list = _schema(
    "o_list",
    "List files in the bound workspace directory. Parameter: path ('.' for root).",
    {"path": {"type": "string"}},
)


# ---------------- o_read ----------------

def _t_read(args, ctx):
    full = _resolve(args.get("path"), ctx)
    if not full or not os.path.isfile(full):
        return "%s not_found file=%r" % (ERR, args.get("path"))
    try:
        with open(full, "r", encoding="utf-8", errors="replace") as f:
            data = f.read()
    except OSError as e:
        return "%s io_error %s" % (ERR, e)
    return "%s path=%s bytes=%d\n%s" % (OK, args.get("path"), len(data), _clip(data))


SCHEMA_read = _schema(
    "o_read",
    "Read a text file from the bound workspace. Parameter: path.",
    {"path": {"type": "string"}},
    required=["path"],
)


# ---------------- o_write ----------------

def _t_write(args, ctx):
    full = _resolve(args.get("path"), ctx)
    if not full:
        return "%s path outside workspace (admission veto): %r" % (ERR, args.get("path"))
    try:
        os.makedirs(os.path.dirname(full) or ".", exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            f.write(args.get("content") or "")
    except OSError as e:
        return "%s io_error %s" % (ERR, e)
    return "%s wrote %s (%d bytes)" % (OK, args.get("path"), len(args.get("content") or ""))


SCHEMA_write = _schema(
    "o_write",
    "Write/overwrite a file inside the bound workspace. Parameters: path, content.",
    {"path": {"type": "string"}, "content": {"type": "string"}},
    required=["path", "content"],
)


# ---------------- o_run ----------------

def _t_run(args, ctx):
    code = args.get("code") or ""
    if not code.strip():
        return "%s empty command" % ERR
    try:
        r = subprocess.run(code, shell=True, capture_output=True,
                           timeout=RUN_TIMEOUT, cwd=_proj(ctx))
    except subprocess.TimeoutExpired:
        return "%s timeout after %ss" % (ERR, RUN_TIMEOUT)
    out = ((r.stdout or b"") + (r.stderr or b"")).decode("utf-8", "replace")
    return "%s exit=%d\n%s" % (OK, r.returncode, _clip(out))


SCHEMA_run = _schema(
    "o_run",
    "Run a shell command inside the bound workspace. Parameter: code.",
    {"code": {"type": "string"}},
    required=["code"],
)


TOOLS = [
    {"name": "o_list",  "SCHEMA": SCHEMA_list,  "run": _t_list},
    {"name": "o_read",  "SCHEMA": SCHEMA_read,  "run": _t_read},
    {"name": "o_write", "SCHEMA": SCHEMA_write, "run": _t_write},
    {"name": "o_run",   "SCHEMA": SCHEMA_run,   "run": _t_run},
]
