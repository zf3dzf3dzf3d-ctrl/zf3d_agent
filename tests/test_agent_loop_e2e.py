# -*- coding: utf-8 -*-
"""run_agent_loop 循环级端到端回归（工程基建总纲 Phase 2.1 续 20261123）。

【为什么存在】S3 重构（ee1c0e63）曾把 _build_tool_pipeline 错误切剩 docstring
（返回 None），每轮工具调用 TypeError、四层注入静默失效——当时无循环级测试，
"冒烟 20/20" 没拦住。本测试用假引擎 + 脚本化上游把主循环钉死：

  1) 双轮收敛：第 1 轮上游回工具调用 -> 第 2 轮回终答，循环恰好 2 次上游调用；
  2) 工具真执行：engine_tool 经四层包装链（iapp→sys→mcp→swarm→引擎 exec）
     送达假引擎执行器——工具管线断裂（返回 None）会在此处立刻暴露；
  3) 工具结果回填：messages 含 'engine-ok' 的 tool 消息；
  4) schema 传递：engine_tool 出现在发往上游的 tools 里；
  5) 终答返回：最终响应即第 2 轮上游响应。

上游 _call_upstream 为模块级函数，monkeypatch 注入脚本化双轮响应；
全程零网络、零真实 LLM。这也是 Phase 2.4 结构债拆解（run_agent_loop 拆分）
的前置安全网——先有本测试，才允许动刀。
"""
import os
import sys

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server'))

import engines.common.agent_loop as al  # noqa: E402


def json_dumps(obj):
    import json
    return json.dumps(obj, ensure_ascii=False, default=str)


_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, detail))
    if not cond:
        _fail.append(name)


FINAL_TEXT = '最终回答：任务完成'
upstream_payloads = []


def fake_upstream(ctx, payload):
    upstream_payloads.append(payload)
    if len(upstream_payloads) == 1:
        # 第 1 轮：要求调用引擎工具
        return {'choices': [{'message': {
            'role': 'assistant', 'content': '',
            'tool_calls': [{'id': 'c1', 'type': 'function',
                            'function': {'name': 'engine_tool',
                                         'arguments': '{"q": "测试"}'}}]}}]}
    # 第 2 轮：终答
    return {'choices': [{'message': {'role': 'assistant', 'content': FINAL_TEXT}}]}


class FakeEngine:
    executed = []

    @staticmethod
    def get_tool_schemas():
        return [{'function': {'name': 'engine_tool',
                              'parameters': {'type': 'object', 'properties': {}}}}]

    @staticmethod
    def execute_tool_calls(tool_calls, ctx):
        FakeEngine.executed.append([tc.get('function', {}).get('name') for tc in tool_calls])
        return [{'tool_call_id': tc.get('id'), 'role': 'tool',
                 'content': 'engine-ok', '_ok': True} for tc in tool_calls]


_orig_upstream = al._call_upstream
al._call_upstream = fake_upstream
try:
    messages = [{'role': 'user', 'content': '你好，帮我执行工具'}]
    final = al.run_agent_loop('fake-engine', FakeEngine, messages,
                              {'payload': {}}, on_event=None)

    check('终答返回', isinstance(final, dict)
          and FINAL_TEXT in json_dumps(final), '')
    check('上游恰好 2 轮（工具轮+终答轮）', len(upstream_payloads) == 2,
          'actual=%d' % len(upstream_payloads))
    check('引擎执行器收到工具调用（四层包装链贯通）',
          FakeEngine.executed and FakeEngine.executed[0] == ['engine_tool'],
          str(FakeEngine.executed))
    # 注意：run_agent_loop 对入参 messages 做防御性拷贝（messages = list(...)），
    # 循环在其副本上演进——正确的可观测面是第 2 轮发往上游的 payload['messages']
    # （即模型下一轮实际看到的对话）。
    turn2_msgs = upstream_payloads[1].get('messages') if len(upstream_payloads) > 1 else []
    roles = [m.get('role') for m in turn2_msgs]
    check('工具结果回填（第2轮上游可见）', any(
        m.get('role') == 'tool' and 'engine-ok' in str(m.get('content'))
        for m in turn2_msgs), 'roles=%s' % roles)
    check('assistant 工具调用消息在案', any(
        m.get('role') == 'assistant' and m.get('tool_calls') for m in turn2_msgs),
        'roles=%s' % roles)
    check('schema 传递到上游', 'engine_tool' in json_dumps(upstream_payloads[0].get('tools') or []),
          '')
finally:
    al._call_upstream = _orig_upstream


print('== run_agent_loop 循环级回归: %d fail ==' % len(_fail))
sys.exit(1 if _fail else 0)
