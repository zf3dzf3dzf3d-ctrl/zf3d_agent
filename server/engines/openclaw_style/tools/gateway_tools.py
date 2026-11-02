#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""openclaw_style 工具：o_routes / o_bind / o_task —— 会话绑定与后台任务队列。"""

import os
import time

OK, ERR = "OK", "ERR"


def _proj(ctx):
    return os.path.abspath((ctx or {}).get("project_path") or os.getcwd())


# ---------------- o_routes ----------------

def _t_routes(args, ctx):
    bindings = (ctx or {}).get("_oc_bindings", {})
    if not bindings:
        return "%s no bindings yet (use o_bind to create)" % OK
    lines = ["%-24s -> %s" % (k, v) for k, v in bindings.items()]
    return "%s %d binding(s)\n%s" % (OK, len(bindings), "\n".join(lines))


SCHEMA_routes = {
    "type": "function",
    "function": {
        "name": "o_routes",
        "description": "List session bindings: channel conversation -> workspace directory.",
        "parameters": {"type": "object", "properties": {}},
    },
}


# ---------------- o_bind ----------------

def _norm_key(channel, conv):
    return "%s:%s" % (channel, conv or "default")


def _t_bind(args, ctx):
    channel = (args.get("channel") or "web").lower()
    allowed = {"web", "telegram", "qq", "discord", "wechat", "cli", "api"}
    if channel not in allowed:
        return "%s channel '%s' not allowed (admission veto). Allowed: %s" % (
            ERR, channel, ", ".join(sorted(allowed)))
    conv = args.get("conversation") or "default"
    workspace = args.get("workspace") or "."
    bindings = ctx.setdefault("_oc_bindings", {})
    key = _norm_key(channel, conv)
    existed = key in bindings
    bindings[key] = workspace
    return "%s %s binding %s -> workspace '%s'" % (OK, "updated" if existed else "created", key, workspace)


SCHEMA_bind = {
    "type": "function",
    "function": {
        "name": "o_bind",
        "description": "Bind a channel conversation to a workspace directory (session binding).",
        "parameters": {
            "type": "object",
            "properties": {
                "channel": {"type": "string", "enum": ["web", "telegram", "qq", "discord", "wechat", "cli", "api"]},
                "conversation": {"type": "string"},
                "workspace": {"type": "string", "description": "workspace dir, relative to project root"},
            },
            "required": ["channel"],
        },
    },
}


# ---------------- o_task ----------------

def _t_task(args, ctx):
    tasks = ctx.setdefault("_oc_tasks", [])
    task = {
        "id": "oc_task_%d_%s" % (len(tasks) + 1, time.strftime("%H%M%S")),
        "title": args.get("title", ""),
        "command": args.get("command", ""),
        "status": "queued",
        "created": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    tasks.append(task)
    return "%s queued %s (title=%s). Gateway will run it in background; check status with o_task(action='list')." % (
        OK, task["id"], task["title"])


SCHEMA_task = {
    "type": "function",
    "function": {
        "name": "o_task",
        "description": "Queue a background task via gateway (action=list to view queue, action=queue with title+command to add).",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["queue", "list"]},
                "title": {"type": "string"},
                "command": {"type": "string"},
            },
            "required": ["action"],
        },
    },
}


def _t_task_dispatch(args, ctx):
    if args.get("action") == "list":
        tasks = (ctx or {}).get("_oc_tasks", [])
        if not tasks:
            return "%s queue empty" % OK
        lines = ["%s [%s] %s (%s)" % (t["id"], t["status"], t.get("title"), t.get("created")) for t in tasks]
        return "%s %d task(s)\n%s" % (OK, len(tasks), "\n".join(lines))
    return _t_task(args, ctx)


SCHEMA_task["function"]["name"] = "o_task"


TOOLS = [
    {"name": "o_routes", "SCHEMA": SCHEMA_routes, "run": _t_routes},
    {"name": "o_bind",   "SCHEMA": SCHEMA_bind,   "run": _t_bind},
    {"name": "o_task",   "SCHEMA": SCHEMA_task,   "run": _t_task_dispatch},
]
