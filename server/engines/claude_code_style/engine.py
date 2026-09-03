#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
claude_code_style 引擎 —— 移植 Claude Code 的精髓（只抄思路，不引入原码）：

差异化（对比 codex=审批流 / pi=流水线 / ds=极简 / hermes=技能披露）：
  1. 「先读后写」纪律：Edit 工具强制要求同会话内先 Read 过该文件，防止盲改
  2. 精确字符串替换式编辑（old_string/new_string），而非整文件覆写，最小 diff
  3. TodoWrite 任务清单贯穿全程：开工前列计划，进行中更新状态（pending/in_progress/completed）
  4. 工具集按 Claude Code 命名与语义对齐：Read/Write/Edit/Glob/Grep/Bash/TodoWrite
  5. Bash 输出截断到中段（保留头尾），提示用 offset 持续查看 —— 与 CC 行为一致

循环特征：系统性 —— 模型被要求「探索(Read/Glob/Grep) → 计划(TodoWrite) → 实施(Edit) → 验证(Bash)」。
"""

import os
import sys
import json
import importlib

_ENG_DIR = os.path.dirname(os.path.abspath(__file__))
_SRV = os.path.dirname(os.path.dirname(_ENG_DIR))
for p in (_SRV, _SRV and os.path.join(_SRV, "zf_core")):
    if p and os.path.isdir(p) and p not in sys.path:
        sys.path.insert(0, p)

SYSTEM_PROMPT = """你是 Claude Code 风格的编码智能体，运行在朱峰社区系统内。工作纪律：

1. **先读后写**：修改任何文件前必须先用 Read 读过它；Edit 做精确字符串替换（old_string 必须与文件内容唯一匹配），不做整文件覆写。
2. **任务清单**：多步任务开工前用 TodoWrite 列出计划（pending），每步开始置 in_progress，完成后置 completed。
3. **探索工具**：Glob 找文件、Grep 搜内容，先探索再动手，不要臆测文件内容。
4. **验证**：改动后尽量用 Bash 跑测试/构建验证。
5. 回答简洁，先结论后细节。路径默认相对项目根目录。"""

MAX_TURNS = 40
TOOL_RESULT_MAX = 8000


def _load_tools():
    tools = {}
    tdir = os.path.join(_ENG_DIR, "tools")
    if not os.path.isdir(tdir):
        return tools
    if tdir not in sys.path:
        sys.path.insert(0, tdir)
    for fn in sorted(os.listdir(tdir)):
        if fn.endswith(".py") and not fn.startswith("_"):
            mod = importlib.import_module(fn[:-3])
            if hasattr(mod, "TOOLS"):
                for t in mod.TOOLS:
                    tools[t["name"]] = t
    return tools


_TOOLS = None

def _tools():
    global _TOOLS
    if _TOOLS is None:
        _TOOLS = _load_tools()
    return _TOOLS


def get_tool_schemas():
    return [t["SCHEMA"] for t in _tools().values()]


def execute_tool_calls(tool_calls, ctx):
    results = []
    for tc in tool_calls or []:
        name = (tc.get("function") or {}).get("name") or tc.get("name") or ""
        try:
            raw_args = (tc.get("function") or {}).get("arguments") or tc.get("arguments") or "{}"
            args = json.loads(raw_args) if isinstance(raw_args, str) else (raw_args or {})
        except json.JSONDecodeError:
            args = {}
        t = _tools().get(name)
        if t is None:
            out = "unknown tool: %s" % name
        else:
            try:
                out = t["run"](args, ctx)
            except Exception as e:
                out = "tool error: %s" % e
        if not isinstance(out, str):
            out = json.dumps(out, ensure_ascii=False)
        results.append({"role": "tool", "tool_call_id": tc.get("id", ""), "content": out[:TOOL_RESULT_MAX]})
    return results


def _compact(messages):
    sys_msgs = [m for m in messages if m.get("role") == "system"]
    rest = [m for m in messages if m.get("role") != "system"]
    for m in rest:
        c = m.get("content")
        if m.get("role") == "tool" and isinstance(c, str) and len(c) > TOOL_RESULT_MAX:
            m["content"] = c[:TOOL_RESULT_MAX] + "\n...[truncated]"
    return sys_msgs + rest[-MAX_TURNS:]


def _chat_once(messages, ctx, on_event=None):
    """模型调用：优先复用 common.agent_loop 的上游调用（统一重试/超时），
    兼容旧 zf_chat 网关（如存在）。"""
    try:
        from engines.common import agent_loop
        payload = dict(ctx.get('payload') or {})
        payload['messages'] = messages
        payload['model'] = payload.get('model') or (ctx.get('model_cfg') or {}).get('model') or 'gpt-4o-mini'
        return agent_loop._call_upstream(ctx, payload)
    except Exception as e:
        try:
            import zf_chat
            return zf_chat.chat(messages, ctx)
        except Exception as e2:
            return {"choices": [{"message": {"content": "model call failed: %s / %s" % (e, e2)}}]}


def run(messages, ctx, on_event=None):
    """统一接口。会话级状态（已读文件记录）挂在 ctx 上。"""
    ctx = ctx if isinstance(ctx, dict) else {}
    ctx.setdefault("_cc_read_files", set())  # claude-code 核心状态：本会话已 Read 的文件
    ctx.setdefault("_cc_todos", [])

    msgs = [{"role": "system", "content": SYSTEM_PROMPT}]
    msgs.extend(dict(m) for m in messages or [])

    for _ in range(20):
        resp = _chat_once(_compact(msgs), ctx, on_event)
        msg = (resp.get("choices") or [{}])[0].get("message", {})
        tool_calls = msg.get("tool_calls")
        if not tool_calls:
            return resp
        msgs.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": tool_calls})
        msgs.extend(execute_tool_calls(tool_calls, ctx))

    return {"choices": [{"message": {"content": "reached tool loop limit"}}]}


if __name__ == "__main__":
    r = run([{"role": "user", "content": "ping"}], {"project_path": os.getcwd()})
    print(json.dumps(r, ensure_ascii=False)[:500])
