#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
hermes_style 引擎 —— 移植 Nous Research Hermes-Agent 的精髓：
技能渐进披露 + 自学习闭环（只抄思路，不引入原码）。

差异化（对比 codex=审批流 / pi=流水线 / ds=直给极简）：
  1. 每轮开始自动注入技能索引（tier1 元数据，极省 token）
  2. 模型通过 skill_view 分层加载技能全文/引用（tier2/3）
  3. 任务中可 skill_save 沉淀新技能 -> 下次对话自动可用（自学习）
  4. 基础工具 h_read/h_write/h_grep/h_run

循环特征：反思式——工具结果后模型需先判断「是否值得沉淀为技能」再作答。
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

# TODO(1): 系统提示词 —— Hermes 技能智能体人格
SYSTEM_PROMPT = """你是 Hermes 技能智能体，运行在朱峰社区系统内。你的核心机制是「技能系统」：

1. **技能索引**已在每轮对话开始时注入（<skills> 段）。优先复用已有技能。
2. **渐进披露**：skill_list 只看元数据；skill_view 加载技能全文；skill_view(name, ref) 加载技能内的引用文件（references/templates）。
3. **自学习闭环**：当你在任务中摸索出可复用的方法/踩坑经验，且没有对应技能时，用 skill_save 把它沉淀为技能（SKILL.md + 可选 references/）。下次遇到同类任务就能直接调用。已有技能不重复创建。
4. 基础工具：h_read / h_write / h_grep / h_run（均限定在项目目录内）。
5. 工作方式：先查技能索引 -> 命中则 skill_view 加载后按技能执行；未命中则直接干，结束时判断是否值得沉淀技能。
6. 回答简洁直给，说明用了哪个技能（或为何没有）。技能名用小写 kebab-case。"""

# 上下文压缩参数
MAX_TURNS = 50          # 滑窗保留消息条数（技能内容可能较长，放宽）
TOOL_RESULT_MAX = 6000  # 工具结果注入上限字符

TOOLS_DIR_MARK = "hermes_skills"


# ---------- 工具加载（支持单模块多工具：模块可定义 TOOLS 列表） ----------

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
            if hasattr(mod, "TOOLS"):  # 多工具模块
                for t in mod.TOOLS:
                    tools[t["name"]] = t
            else:  # 单工具模块（TOOL_NAME/SCHEMA/run）
                name = getattr(mod, "TOOL_NAME", fn[:-3])
                tools[name] = {"name": name, "SCHEMA": mod.SCHEMA, "run": mod.run}
    return tools


_TOOLS = None

def _tools():
    global _TOOLS
    if _TOOLS is None:
        _TOOLS = _load_tools()
    return _TOOLS


def get_tool_schemas():
    """loader 统计工具数用。"""
    return [t["SCHEMA"] for t in _tools().values()]


# 敏感工具清单：真实控制桌面输入设备，调用前需向前端提示用户
SENSITIVE_TOOLS = {"control_mouse", "control_keyboard"}


def _notify_sensitive(tool_calls, ctx, on_event):
    """轻量防护：敏感工具调用时向前端推送提示事件（不阻断执行）。"""
    if not on_event:
        return
    try:
        for tc in tool_calls or []:
            fn = tc.get("function") or {}
            name = tc.get("name") or (fn.get("name") if isinstance(fn, dict) else "") or ""
            if name in SENSITIVE_TOOLS:
                raw = (fn.get("arguments") if isinstance(fn, dict) else None) or tc.get("arguments") or "{}"
                try:
                    args = json.loads(raw) if isinstance(raw, str) else (raw or {})
                except Exception:
                    args = {}
                on_event({"type": "tool_event", "kind": "sensitive_tool",
                          "data": {"tool": name, "args": args,
                                   "msg": "⚠️ AI 正在真实控制你的桌面输入设备（%s），请注意观察鼠标键盘行为" % name}})
    except Exception:
        pass


def execute_tool_calls(tool_calls, ctx):
    """本地工具执行入口。"""
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


# ---------- 技能索引注入（tier1，每轮一次） ----------

def _skills_index_block(ctx):
    """扫描项目技能目录，生成极简索引。"""
    try:
        skills_mod = _tools().get("skill_list")
        if skills_mod is None:
            return ""
        idx = skills_mod["run"]({}, ctx)
    except Exception:
        return ""
    return "<skills>\n%s\n</skills>\n" % idx


# ---------- 上下文压缩 ----------

def _compact(messages):
    sys_msgs = [m for m in messages if m.get("role") == "system"]
    rest = [m for m in messages if m.get("role") != "system"]
    for m in rest:
        c = m.get("content")
        if m.get("role") == "tool" and isinstance(c, str) and len(c) > TOOL_RESULT_MAX:
            m["content"] = c[:TOOL_RESULT_MAX] + "\n...[truncated]"
    return sys_msgs + rest[-MAX_TURNS:]


# ---------- 模型调用 ----------

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


# ---------- 主循环 ----------

def run(messages, ctx, on_event=None):
    """统一接口：messages + ctx -> OpenAI 兼容响应。"""
    msgs = [{"role": "system", "content": SYSTEM_PROMPT}]

    # hermes 差异点：开场注入技能索引（tier1）
    idx = _skills_index_block(ctx)
    user_first = True
    for m in messages or []:
        if user_first and m.get("role") == "user" and idx:
            msgs.append({"role": "user", "content": idx + (m.get("content") or "")})
            user_first = False
        else:
            msgs.append(dict(m))

    for _ in range(16):  # 工具循环上限，防失控
        resp = _chat_once(_compact(msgs), ctx, on_event)
        msg = (resp.get("choices") or [{}])[0].get("message", {})
        tool_calls = msg.get("tool_calls")
        if not tool_calls:
            return resp
        msgs.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": tool_calls})
        _notify_sensitive(tool_calls, ctx, on_event)
        msgs.extend(execute_tool_calls(tool_calls, ctx))

    return {"choices": [{"message": {"content": "reached tool loop limit"}}]}


if __name__ == "__main__":
    r = run([{"role": "user", "content": "ping"}], {"project_path": os.getcwd()})
    print(json.dumps(r, ensure_ascii=False)[:500])
