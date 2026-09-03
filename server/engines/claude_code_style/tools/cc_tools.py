#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""claude_code_style 工具集（对齐 Claude Code 语义）：
Read / Write / Edit / Glob / Grep / Bash / TodoWrite
核心纪律：Edit 前必须 Read 过（引擎在 ctx['_cc_read_files'] 记录）。"""

import os
import re
import subprocess

OK, ERR = "OK", "ERR"


def _proj(ctx):
    return os.path.abspath((ctx or {}).get("project_path") or os.getcwd())


def _safe(ctx, rel):
    root = _proj(ctx)
    parts = [p for p in re.split(r"[\\/]", rel or "") if p and p not in (".", "..")]
    if not parts:
        return None
    path = os.path.abspath(os.path.join(root, *parts))
    return path if path.startswith(root + os.sep) or path == root else None


def _need_read(ctx, path):
    return path in (ctx or {}).get("_cc_read_files", set())


# ---------------- Read ----------------

def _t_read(args, ctx):
    path = _safe(ctx, args.get("file_path", ""))
    if not path or not os.path.isfile(path):
        return "%s file not found: %s" % (ERR, args.get("file_path"))
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except OSError as e:
        return "%s read failed: %s" % (ERR, e)
    s = max(1, int(args.get("offset") or 1))
    lim = int(args.get("limit") or 400)
    e = min(len(lines), s - 1 + lim)
    ctx.setdefault("_cc_read_files", set()).add(path)  # 登记：后续 Edit 需要此记录
    body = "".join("%6d\t%s" % (i, l) for i, l in enumerate(lines[s - 1:e], s))
    return "%s %s (%d-%d/%d lines)\n%s" % (OK, args["file_path"], s, e, len(lines), body[:20000])


SCHEMA_Read = {
    "type": "function",
    "function": {
        "name": "Read",
        "description": "Read a text file with line numbers. Must be called before editing the same file. Optional offset (1-based) and limit (lines, default 400).",
        "parameters": {
            "type": "object",
            "properties": {
                "file_path": {"type": "string"},
                "offset": {"type": "integer"},
                "limit": {"type": "integer"},
            },
            "required": ["file_path"],
        },
    },
}


# ---------------- Write ----------------

def _t_write(args, ctx):
    path = _safe(ctx, args.get("file_path", ""))
    if not path:
        return "%s bad path: %s" % (ERR, args.get("file_path"))
    existed = os.path.isfile(path)
    # CC 纪律：覆写已存在文件前也要求读过
    if existed and not _need_read(ctx, path):
        return "%s refusing to overwrite %s: Read it first." % (ERR, args.get("file_path"))
    try:
        os.makedirs(os.path.dirname(path) or path, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(args.get("content") or "")
    except OSError as e:
        return "%s write failed: %s" % (ERR, e)
    ctx.setdefault("_cc_read_files", set()).add(path)
    return "%s %s %s (%d chars)" % (OK, "updated" if existed else "created", args.get("file_path"), len(args.get("content") or ""))


SCHEMA_Write = {
    "type": "function",
    "function": {
        "name": "Write",
        "description": "Create a new file (or overwrite a file you have Read this session) with the given content.",
        "parameters": {
            "type": "object",
            "properties": {"file_path": {"type": "string"}, "content": {"type": "string"}},
            "required": ["file_path", "content"],
        },
    },
}


# ---------------- Edit ----------------

def _t_edit(args, ctx):
    path = _safe(ctx, args.get("file_path", ""))
    if not path or not os.path.isfile(path):
        return "%s file not found: %s" % (ERR, args.get("file_path"))
    if not _need_read(ctx, path):
        return "%s refusing to edit %s: Read it first (read-before-write discipline)." % (ERR, args.get("file_path"))
    old = args.get("old_string", "")
    new = args.get("new_string", "")
    if old == new:
        return "%s old_string and new_string must be different" % ERR
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except OSError as e:
        return "%s read failed: %s" % (ERR, e)
    n = content.count(old)
    if n == 0:
        return "%s old_string not found in %s. Read the file again to get exact text." % (ERR, args.get("file_path"))
    if n > 1 and not args.get("replace_all"):
        return "%s old_string matches %d places. Add more context to make it unique, or set replace_all=true." % (ERR, n)
    if n > 1 and args.get("replace_all"):
        content = content.replace(old, new)
    else:
        content = content.replace(old, new, 1)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
    except OSError as e:
        return "%s write failed: %s" % (ERR, e)
    return "%s edited %s (replaced %d occurrence(s))" % (OK, args.get("file_path"), n if args.get("replace_all") else 1)


SCHEMA_Edit = {
    "type": "function",
    "function": {
        "name": "Edit",
        "description": "Exact string replacement in a file. Requires the file to have been Read this session. old_string must match uniquely unless replace_all=true.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_path": {"type": "string"},
                "old_string": {"type": "string"},
                "new_string": {"type": "string"},
                "replace_all": {"type": "boolean"},
            },
            "required": ["file_path", "old_string", "new_string"],
        },
    },
}


# ---------------- Glob ----------------

def _t_glob(args, ctx):
    import glob as _g
    pat = args.get("pattern", "**/*")
    base = _safe(ctx, args.get("path") or "") or _proj(ctx)
    full = os.path.join(base, pat)
    hits = sorted(_g.glob(full, recursive=True))
    files = [h for h in hits if os.path.isfile(h)]
    out = [os.path.relpath(h, _proj(ctx)) for h in files[:100]]
    return "%s %d file(s)\n%s" % (OK, len(files), "\n".join(out))


SCHEMA_Glob = {
    "type": "function",
    "function": {
        "name": "Glob",
        "description": "Find files by glob pattern (e.g. **/*.py) inside the project.",
        "parameters": {
            "type": "object",
            "properties": {"pattern": {"type": "string"}, "path": {"type": "string"}},
            "required": ["pattern"],
        },
    },
}


# ---------------- Grep ----------------

def _t_grep(args, ctx):
    pat = args.get("pattern", "")
    flags = re.I if args.get("-i") else 0
    try:
        rx = re.compile(pat, flags)
    except re.error as e:
        return "%s bad pattern: %s" % (ERR, e)
    root = _proj(ctx)
    base = _safe(ctx, args.get("path") or "") or root
    glb = args.get("glob")
    mode = args.get("output_mode", "files_with_matches")
    hits, counts = [], {}
    targets = []
    if os.path.isfile(base):
        targets = [base]
    else:
        for dp, dns, fns in os.walk(base):
            dns[:] = [d for d in dns if d not in (".git", "node_modules", "__pycache__")]
            for fn in fns:
                if glb and not fn.endswith(glb.lstrip("*")):
                    continue
                targets.append(os.path.join(dp, fn))
    for t in targets[:3000]:
        try:
            with open(t, "r", encoding="utf-8", errors="replace") as f:
                c = 0
                for i, line in enumerate(f, 1):
                    if rx.search(line):
                        c += 1
                        if mode == "content":
                            hits.append("%s:%d: %s" % (os.path.relpath(t, root), i, line.strip()[:300]))
            if c:
                counts[t] = c
        except OSError:
            continue
        if len(hits) >= 80:
            break
    if mode == "content":
        return "%s %d line(s)\n%s" % (OK, len(hits), "\n".join(hits))
    if mode == "count":
        body = "\n".join("%s: %d" % (os.path.relpath(k, root), v) for k, v in counts.items())
        return "%s %d file(s)\n%s" % (OK, len(counts), body)
    return "%s %d file(s)\n%s" % (OK, len(counts), "\n".join(os.path.relpath(k, root) for k in counts))


SCHEMA_Grep = {
    "type": "function",
    "function": {
        "name": "Grep",
        "description": "Search file contents with regex. output_mode: files_with_matches (default) | content (with line numbers) | count.",
        "parameters": {
            "type": "object",
            "properties": {
                "pattern": {"type": "string"},
                "path": {"type": "string"},
                "glob": {"type": "string"},
                "output_mode": {"type": "string", "enum": ["content", "files_with_matches", "count"]},
                "-i": {"type": "boolean"},
            },
            "required": ["pattern"],
        },
    },
}


# ---------------- Bash ----------------

def _t_bash(args, ctx):
    cmd = args.get("command", "")
    timeout = min(int(args.get("timeout") or 120), 600)
    try:
        p = subprocess.run(cmd, shell=True, cwd=_proj(ctx), capture_output=True,
                           text=True, encoding="utf-8", errors="replace", timeout=timeout)
        out = ((p.stdout or "") + (("\n[stderr] " + p.stderr) if p.stderr else "")).strip()
        if len(out) > 12000:  # CC 行为：截中段，保留头尾
            out = out[:6000] + "\n...[middle truncated]...\n" + out[-3000:]
        return "%s exit=%d\n%s" % (OK, p.returncode, out)
    except subprocess.TimeoutExpired:
        return "%s timeout after %ds" % (ERR, timeout)
    except Exception as e:
        return "%s %s" % (ERR, e)


SCHEMA_Bash = {
    "type": "function",
    "function": {
        "name": "Bash",
        "description": "Run a shell command in the project directory (use for builds/tests/git). timeout in seconds (default 120, max 600).",
        "parameters": {
            "type": "object",
            "properties": {"command": {"type": "string"}, "timeout": {"type": "integer"}},
            "required": ["command"],
        },
    },
}


# ---------------- TodoWrite ----------------

def _t_todo(args, ctx):
    todos = args.get("todos") or []
    for t in todos:
        if t.get("status") not in ("pending", "in_progress", "completed"):
            return "%s invalid status: %s" % (ERR, t.get("status"))
    ctx["_cc_todos"] = todos
    lines = []
    marks = {"pending": "[ ]", "in_progress": "[~]", "completed": "[x]"}
    for t in todos:
        lines.append("%s %s" % (marks[t["status"]], t.get("content", "")))
    return "%s todo list updated (%d items)\n%s" % (OK, len(todos), "\n".join(lines))


SCHEMA_TodoWrite = {
    "type": "function",
    "function": {
        "name": "TodoWrite",
        "description": "Write the task todo list. Each item: {content, status: pending|in_progress|completed}. Use before starting multi-step work.",
        "parameters": {
            "type": "object",
            "properties": {
                "todos": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "content": {"type": "string"},
                            "status": {"type": "string", "enum": ["pending", "in_progress", "completed"]},
                        },
                        "required": ["content", "status"],
                    },
                }
            },
            "required": ["todos"],
        },
    },
}


TOOLS = [
    {"name": "Read",      "SCHEMA": SCHEMA_Read,      "run": _t_read},
    {"name": "Write",     "SCHEMA": SCHEMA_Write,     "run": _t_write},
    {"name": "Edit",      "SCHEMA": SCHEMA_Edit,      "run": _t_edit},
    {"name": "Glob",      "SCHEMA": SCHEMA_Glob,      "run": _t_glob},
    {"name": "Grep",      "SCHEMA": SCHEMA_Grep,      "run": _t_grep},
    {"name": "Bash",      "SCHEMA": SCHEMA_Bash,      "run": _t_bash},
    {"name": "TodoWrite", "SCHEMA": SCHEMA_TodoWrite, "run": _t_todo},
]
