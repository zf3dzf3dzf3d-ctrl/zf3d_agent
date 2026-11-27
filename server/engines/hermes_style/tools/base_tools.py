#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""hermes_style 基础工具：h_read / h_write / h_grep / h_run
风格：Hermes 直给，输出带 [OK]/[ERR] 前缀，路径限制在项目内。单模块多工具导出。"""

import os
import re
import subprocess
from engines.common.shell_exec import run_shell

OK, ERR = "OK", "ERR"


def _proj(ctx):
    return os.path.abspath((ctx or {}).get("project_path") or os.getcwd())


# [20261123 安全收口] 写操作显式白名单：系统临时目录（读/grep 不放行，仍锁项目内）
_TEMP_ROOT = os.path.normpath(os.environ.get("TEMP")
                              or os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "Temp"))


def _inside_root(root, path):
    """realpath 归一后的前缀断言（防 ../ 与 junction/symlink 逃逸）。"""
    try:
        r = os.path.normcase(os.path.realpath(root))
        c = os.path.normcase(os.path.realpath(path))
    except Exception:
        r = os.path.normcase(os.path.abspath(root))
        c = os.path.normcase(os.path.abspath(path))
    return c == r or c.startswith(r.rstrip("\\/") + os.sep)


def _safe(ctx, rel):
    root = _proj(ctx)
    rel = (rel or "").strip()
    if not rel:
        return None
    # 绝对路径与相对路径同规则：归一（含 ../ 折叠）+ realpath 前缀校验后必须落在项目根内
    full = os.path.abspath(rel) if os.path.isabs(rel) else os.path.abspath(os.path.join(root, rel))
    if not _inside_root(root, full):
        return None
    return full


# ---------------- h_read ----------------

def _t_read(args, ctx):
    path = _safe(ctx, args.get("path", ""))
    if not path or not os.path.isfile(path):
        return "%s file not found: %s" % (ERR, args.get("path"))
    try:
        with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
            lines = f.readlines()
    except OSError as e:
        return "%s read failed: %s" % (ERR, e)
    s = max(1, int(args.get("start") or 1))
    e = min(len(lines), int(args.get("end") or len(lines)) or len(lines))
    chunk = lines[s - 1:e]
    return "%s %s lines %d-%d/%d\n%s" % (OK, args["path"], s, e, len(lines), "".join(chunk)[:20000])


SCHEMA_h_read = {
    "type": "function",
    "function": {
        "name": "h_read",
        "description": "Read a text file inside the project. Optional line range [start, end] (1-based).",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "start": {"type": "integer"},
                "end": {"type": "integer"},
            },
            "required": ["path"],
        },
    },
}


# ---------------- h_write ----------------

def _t_write(args, ctx):
    path = _safe(ctx, args.get("path", ""))
    if not path:
        # [20261123 安全收口] 写操作显式白名单：允许落到系统临时目录（原绝对路径全放行收窄为此）
        p = (args.get("path") or "").strip()
        if p and _inside_root(_TEMP_ROOT, os.path.abspath(p)):
            path = os.path.abspath(p)
    if not path:
        return "%s bad path: %s" % (ERR, args.get("path"))
    try:
        os.makedirs(os.path.dirname(path) or path, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(args.get("content") or "")
    except OSError as e:
        return "%s write failed: %s" % (ERR, e)
    return "%s wrote %s (%d chars)" % (OK, args.get("path"), len(args.get("content") or ""))


SCHEMA_h_write = {
    "type": "function",
    "function": {
        "name": "h_write",
        "description": "Write (create or overwrite) a text file inside the project.",
        "parameters": {
            "type": "object",
            "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
            "required": ["path", "content"],
        },
    },
}


# ---------------- h_grep ----------------

def _t_grep(args, ctx):
    pat = args.get("pattern", "")
    flags = re.I if args.get("ignore_case") else 0
    if not args.get("regex"):
        pat = re.escape(pat)
    try:
        rx = re.compile(pat, flags)
    except re.error as e:
        return "%s bad pattern: %s" % (ERR, e)
    root = _proj(ctx)
    base = _safe(ctx, args.get("path") or "") or root
    hits = []
    ext = args.get("ext")
    if os.path.isfile(base):
        targets = [base]
    else:
        targets = []
        for dp, dns, fns in os.walk(base):
            dns[:] = [d for d in dns if d not in (".git", "node_modules", "__pycache__")]
            for fn in fns:
                if ext and not fn.endswith(ext):
                    continue
                targets.append(os.path.join(dp, fn))
    for t in targets[:3000]:
        try:
            with open(t, "r", encoding="utf-8-sig", errors="replace") as f:
                for i, line in enumerate(f, 1):
                    if rx.search(line):
                        hits.append("%s:%d: %s" % (os.path.relpath(t, root), i, line.strip()[:300]))
                        if len(hits) >= 60:
                            break
        except OSError:
            continue
        if len(hits) >= 60:
            break
    return "%s %d hit(s)\n%s" % (OK, len(hits), "\n".join(hits))


SCHEMA_h_grep = {
    "type": "function",
    "function": {
        "name": "h_grep",
        "description": "Search a keyword/regex in a file or directory (recursive). Returns matching lines with file:line prefix.",
        "parameters": {
            "type": "object",
            "properties": {
                "pattern": {"type": "string", "description": "keyword or regex"},
                "path": {"type": "string", "description": "file or directory, default project root"},
                "regex": {"type": "boolean"},
                "ext": {"type": "string", "description": "filter by extension e.g. '.py'"},
                "ignore_case": {"type": "boolean"},
            },
            "required": ["pattern"],
        },
    },
}


# ---------------- h_run ----------------

def _t_run(args, ctx):
    cmd = args.get("command", "")
    timeout = min(int(args.get("timeout") or 60), 300)
    try:
        rc, _o, _e, _note = run_shell(cmd, timeout=timeout, cwd=_proj(ctx))
        _ot, _et = _o.decode("utf-8", "replace"), _e.decode("utf-8", "replace")
        out = (_ot + (("\n[stderr] " + _et) if _et else "")).strip()
        head = (_note + "\n") if _note else ""
        return "%s exit=%d\n%s%s" % (OK, rc, head, out[:12000])
    except subprocess.TimeoutExpired:
        return "%s timeout after %ds" % (ERR, timeout)
    except Exception as e:
        return "%s %s" % (ERR, e)


SCHEMA_h_run = {
    "type": "function",
    "function": {
        "name": "h_run",
        "description": "Run a shell command in the project directory. Use for builds/tests/git. Avoid destructive commands.",
        "parameters": {
            "type": "object",
            "properties": {
                "command": {"type": "string"},
                "timeout": {"type": "integer", "description": "seconds, default 60"},
            },
            "required": ["command"],
        },
    },
}


TOOLS = [
    {"name": "h_read",  "SCHEMA": SCHEMA_h_read,  "run": _t_read},
    {"name": "h_write", "SCHEMA": SCHEMA_h_write, "run": _t_write},
    {"name": "h_grep",  "SCHEMA": SCHEMA_h_grep,  "run": _t_grep},
    {"name": "h_run",   "SCHEMA": SCHEMA_h_run,   "run": _t_run},
]
