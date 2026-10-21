# -*- coding: utf-8 -*-
"""
POST /api/dispatch_successor —— 接棒者派发（接力机制 v1.0）
用户点击前端接棒按钮后调用：以上一条 AI 回答为上下文，派出 N 个接棒 AI
（策划师/审核师/自定义一句话），复用 dispatch_swarm.submit，接力深度限1防套娃。

请求体：{role: 策划师|审核师|自定义, count: 1-3, task: 任务说明,
        context: 上一条AI回答原文（可选，前端从消息里带）, model: 可选}
响应：{ok, batch_id, count, role}
"""
_ROLE_TMPL = {
    '策划师': '你是策划师。请基于以下回答与任务，独立调查后产出一份策划案（目标/涉及文件/风险/结论）：\n\n{ctx}\n\n任务：{task}',
    '审核师': '你是审核师。请严格复核以下回答的准确性、完整性、代码正确性与事实错误，逐条列出问题清单：\n\n{ctx}\n\n任务：{task}',
}
_ROLE_FALLBACK = '你是接棒审核AI。请复核以下回答并指出问题：\n\n{ctx}\n\n任务：{task}'

# 策划师角色追加格式铁律（单源：engines/common/planner_output_format.py）
try:
    import os as _os, sys as _sys
    _SD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if _SD not in _sys.path:
        _sys.path.insert(0, _SD)
    from engines.common.planner_output_format import with_planner_format
    _ROLE_TMPL['策划师'] = with_planner_format(_ROLE_TMPL['策划师'])
except Exception:
    pass


def dispatch_successor(body):
    """核心逻辑（与 HTTP 解耦，方便单测）。返回 (ok, payload)。"""
    try:
        role = str((body.get('role') or '')).strip() or '审核师'
        try:
            count = int(body.get('count') or 2)
        except (TypeError, ValueError):
            count = 2
        count = max(1, min(3, count))  # 数量宏上限3
        task = str(body.get('task') or '').strip() or ('复核并指出问题' if role == '审核师' else '评审并提出改进')
        ctx = str(body.get('context') or '').strip()[:8000]

        # 接力深度限1：上下文中已带接力标记则拒绝（防套娃）
        if '【接力任务·勿再派发】' in ctx:
            return False, {'ok': False, 'err': '已达接力深度上限（1），接棒AI不能再派发接棒'}

        tmpl = _ROLE_TMPL.get(role, _ROLE_FALLBACK)
        prompt = tmpl.format(ctx=ctx or '（无上下文）', task=task)
        prompt += '\n\n【接力任务·勿再派发】'  # 深度标记，随任务传入防套娃

        import dispatch_swarm
        tasks = []
        for i in range(count):
            tasks.append({
                'goal': prompt,
                'context': '',
                'track': 'auto',
            })
        batch_id = dispatch_swarm.submit(tasks,
                                         model_name=body.get('model') or None,
                                         shared_context='')
        return True, {'ok': True, 'batch_id': batch_id, 'count': count, 'role': role}
    except Exception as e:
        return False, {'ok': False, 'err': str(e)}


def handle_route(self):
    """Mixin 入口（供 api_dispatch_post 调用）。self 是 HTTP handler。"""
    try:
        body = self._read_body()
    except Exception:
        body = {}
    ok, payload = dispatch_successor(body if isinstance(body, dict) else {})
    self._send_json(payload, 200 if ok else 400)
