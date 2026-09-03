#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
openclaw_style 引擎 —— 移植 OpenClaw 的精髓（只抄思路，不引入原码）：

差异化（对比 codex=审批 / pi=流水线 / ds=极简 / hermes=技能 / cc=读后写纪律）：
  1. **Gateway 编排**：每轮对话走生命周期阶段管道
     admission(准入) → preflight(预检) → dedupe(去重) → execute(执行) → deliver(交付)
     每阶段可否决，全部阶段元数据记录在 ctx['_oc_trace']（可审计）
  2. **多渠道会话绑定**：消息带 channel(telegram/qq/web/...) + conversation_id，
     o_bind/o_routes 工具管理「会话 ↔ 工作区」绑定，模拟 OpenClaw 的 session binding
  3. **队列化 + 去重**：相同 (channel, conv, hash) 的消息在同一 turn 内自动去重
  4. **channel 上下文注入**：每轮把来源渠道身份注入 system，模型知道「谁在哪个渠道说话」

循环特征：编排式 —— 引擎是 Gateway，模型是 Worker；工具 oc_* 模拟渠道与任务操作。
"""

import os
import sys
import json
import time
import importlib

_ENG_DIR = os.path.dirname(os.path.abspath(__file__))
_SRV = os.path.dirname(os.path.dirname(_ENG_DIR))
for p in (_SRV, _SRV and os.path.join(_SRV, "zf_core")):
    if p and os.path.isdir(p) and p not in sys.path:
        sys.path.insert(0, p)

SYSTEM_PROMPT = """你是 OpenClaw 风格的常驻助手智能体，运行在朱峰社区系统的 Gateway 之内。

你面对的不是单一用户，而是「多渠道」：消息可能来自 web/telegram/qq 等不同 channel，
每条消息都带有渠道上下文（<channel> 段）。规则：

1. **渠道意识**：回答风格跟随渠道（如 IM 渠道要短句、web 渠道可长文）。
2. **绑定路由**：用 o_routes 查看当前绑定关系，o_bind 把「渠道会话」绑定到工作区目录；后续操作都在该工作区里。
3. **队列纪律**：你的工具操作会经过 Gateway 的阶段管道（准入→预检→去重→执行→交付），被否决的操作会看到 [VETO] 前缀，需换方式重试，不要硬来。
4. **后台任务**：长任务用 o_task 交给队列（status=queued），不要阻塞当前对话。
5. **文件与命令**：o_list / o_read / o_write / o_run 可直接操作绑定工作区内的文件和命令（写文件、读文件、列目录、执行命令都支持）。
6. 回答末尾附一行 `[via gateway]` 表示本回复经编排管道交付。"""

MAX_TURNS = 40
TOOL_RESULT_MAX = 6000

# 模拟 OpenClaw gateway 的渠道白名单（admission 阶段用）
ALLOWED_CHANNELS = {"web", "telegram", "qq", "discord", "wechat", "cli", "api"}

CHANNEL_STYLE = {
    "telegram": "IM 渠道：短句、口语化、少格式。",
    "qq": "IM 渠道：短句、可直接用表情描述。",
    "discord": "社区渠道：轻松但有条理。",
    "web": "Web 渠道：可长文、可用 Markdown。",
    "wechat": "IM 渠道：极简、中文优先。",
    "cli": "终端渠道：直给、命令式。",
    "api": "机器调用：纯结果、无寒暄。",
}


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


# ---------- Gateway 阶段管道（OpenClaw agent-turn 生命周期的 Python 化） ----------

def _gateway_admit(msg, ctx):
    """admission：渠道白名单 + 渠道身份检查。"""
    ch = (msg.get("_channel") or "web").lower()
    if ch not in ALLOWED_CHANNELS:
        return False, "channel '%s' not in allowlist %s" % (ch, sorted(ALLOWED_CHANNELS))
    return True, ch


def _gateway_preflight(msg, ctx):
    """preflight：非空内容检查。"""
    body = msg.get("content") or ""
    if not isinstance(body, str) or not body.strip():
        return False, "empty message body"
    return True, "len=%d" % len(body)


def _gateway_dedupe(msg, ctx):
    """dedupe：同一会话内相同内容 60s 内去重。"""
    seen = ctx.setdefault("_oc_seen", {})
    import hashlib
    key = "%s|%s|%s" % (msg.get("_channel"), msg.get("_conv", "default"),
                        hashlib.md5((msg.get("content") or "").encode("utf-8")).hexdigest())
    now = time.time()
    last = seen.get(key)
    if last and now - last < 60:
        return False, "duplicate within 60s (key=%s)" % key[:40]
    seen[key] = now
    return True, key


def _gateway_stage(name, ok, detail, ctx):
    ctx.setdefault("_oc_trace", []).append(
        {"stage": name, "ok": bool(ok), "detail": str(detail)[:120], "ts": time.strftime("%H:%M:%S")})


def execute_tool_calls(tool_calls, ctx):
    """工具执行 + delivery 阶段标记（结果带 gateway 交付戳）。"""
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
    _gateway_stage("deliver_tools", True, "%d tool result(s) delivered" % len(results), ctx)
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


def _channel_block(msg):
    ch = (msg.get("_channel") or "web").lower()
    conv = msg.get("_conv") or "default"
    return "<channel>\nsource: %s\nconversation: %s\nstyle: %s\n</channel>\n" % (ch, conv, CHANNEL_STYLE.get(ch, ""))


def run(messages, ctx, on_event=None):
    """统一接口：messages + ctx -> OpenAI 兼容响应。每条消息走 Gateway 管道。"""
    ctx = ctx if isinstance(ctx, dict) else {}
    ctx.setdefault("_oc_bindings", {})   # conv key -> workspace（session binding）
    ctx.setdefault("_oc_tasks", [])      # 后台任务队列
    ctx.setdefault("_oc_trace", [])

    msgs = [{"role": "system", "content": SYSTEM_PROMPT}]

    for m in messages or []:
        admitted, d1 = _gateway_admit(m, ctx)
        _gateway_stage("admission", admitted, d1, ctx)
        if not admitted:
            msgs.append({"role": "user", "content": "[VETO admission] %s" % d1})
            continue
        ok2, d2 = _gateway_preflight(m, ctx)
        _gateway_stage("preflight", ok2, d2, ctx)
        if not ok2:
            msgs.append({"role": "user", "content": "[VETO preflight] %s" % d2})
            continue
        ok3, d3 = _gateway_dedupe(m, ctx)
        _gateway_stage("dedupe", ok3, d3, ctx)
        if not ok3:
            msgs.append({"role": "user", "content": "[VETO dedupe] %s" % d3})
            continue
        # execute 阶段：注入渠道上下文
        body = m.get("content") or ""
        ch = (m.get("_channel") or "web").lower()
        if ch in ("api", "cli") and m.get("role") == "user":
            msgs.append({"role": "user", "content": _channel_block(m) + body})
        else:
            msgs.append({"role": m.get("role", "user"), "content": _channel_block(m) + body})
    _gateway_stage("execute", True, "dispatched %d message(s) to agent" % len(messages or []), ctx)

    for _ in range(20):
        resp = _chat_once(_compact(msgs), ctx, on_event)
        msg = (resp.get("choices") or [{}])[0].get("message", {})
        tool_calls = msg.get("tool_calls")
        if not tool_calls:
            _gateway_stage("deliver", True, "final answer delivered", ctx)
            return resp
        msgs.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": tool_calls})
        msgs.extend(execute_tool_calls(tool_calls, ctx))

    return {"choices": [{"message": {"content": "reached tool loop limit"}}]}


if __name__ == "__main__":
    r = run([{"role": "user", "content": "ping", "_channel": "web"}], {"project_path": os.getcwd()})
    print(json.dumps(r, ensure_ascii=False)[:500])
