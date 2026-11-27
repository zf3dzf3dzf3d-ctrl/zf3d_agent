# -*- coding: utf-8 -*-
"""
collab_inject —— 多路协作 hear 注入钩子（策划案 v3.2 #5）

挂载：routes/pool_worker.py run_upstream **顶层**（race worktree 块之后、
engine_preprocess 之前）——v3.2 2-1 裁决：不进 if not is_stream 分支，
流式/非流式双形态均生效（反驳师①同型假绿修复）。

职责：body 带 _collab_team/_collab_codename（协作窗标记，协议头随派出拼装）
时，把该成员 hear 队列新增内容（say 提要 + L1 服务器合成提要）注入
payload.messages 顶部 system 消息，推进水位并记注入日志（预演步骤④数据源）。
失败静默：协作注入任何异常不得阻断正式请求链（log 后返回 None）。
"""
import threading

_wm_lock = threading.Lock()
_wm = {}  # (team_id, codename, chat_id) -> 水位 ts（进程内；body 标记优先）
# 【重名防串号 v7.4·alpha 2026-11-25】key 增第三维 chat_id（对话窗 id，body._box_id 稳定持久）：
# 同组同代号若出现两个窗（历史：重启恢复链双开），旧 key (team, codename) 会让两窗共抢同一份
# 水位——say/L1 谁先醒来谁拉走，另一窗静默漏听（无声错误）。加窗维度后各记各账，双窗互不干扰。


def collab_hear_inject(body, payload, is_stream, box_id='', log=None):
    """返回注入的文本（未注入返回 None）。所有异常由调用方 try 兜底。"""
    team = str(body.get('_collab_team') or '').strip()
    codename = str(body.get('_collab_codename') or '').strip().lower()
    if not team or not codename:
        return None
    import collab_channel as cc
    if not cc.is_enabled():
        return None
    key = (team, codename, str(box_id or ''))
    # 【下线唤醒 v6.3·自动报到】协作窗每次请求把当前对话窗 id 绑进名册 chat_id 槽，
    # 供同伴 inject 退场目标时 wake 定位其对话窗。失败静默不阻断主链。
    try:
        cc.bind_chat_id(team, codename, str(box_id or ''))
    except Exception:
        pass
    with _wm_lock:
        wm = _wm.get(key, 0.0)
    h = cc.hear(team, codename, since_ts=wm)
    # 【耳朵心跳修复 2026-11-24】L1 心跳无条件发（在"有无 items 早退"之前）——
    # v3.3 A1 设计本意：心跳不依赖模型自觉 say。此前心跳写在早退之后，形成死锁：
    # 嘴哑(无 collab 工具)→say_count=0→items 恒空→早退→心跳永发不出→l1_count=0→
    # 同伴耳朵也永远收不到任何动静（本组 7f85 实测 inj_count=0/l1_count=0 铁证）。
    # 关耳/退场/节流由 synth 内部拒绝语义兜底，失败不阻断主链。
    try:
        cc.synth_l1(team, codename, '%s 进入新一轮请求（stream=%s）' % (codename, bool(is_stream)))
    except Exception:
        pass
    if int(h.get('ear', 0)) == 0 or not h.get('items'):
        return None
    lines = ['[协作旁听·组 %s]' % team]
    for it in h['items']:
        lines.append('- %s %s（%s）：%s' % (it['ts_str'], it['from'],
                                            'L1提要' if it['kind'] == 'l1' else 'say',
                                            it['brief']))
    content = '\n'.join(lines)
    msgs = payload.get('messages') if isinstance(payload, dict) else None
    if not isinstance(msgs, list):
        return None
    msgs.insert(0, {'role': 'system', 'content': content})
    # 【6.3 插话透传】登记本轮注入文本：pool_worker 尾注据此判断「本轮确有协作内容」，
    # 再钉一条尾部 user 强制响应要求（防机械循环惯性无视顶部旁听）。
    try:
        if isinstance(payload, dict):
            _prev = payload.get('_collab_injected_texts')
            _prev = _prev if isinstance(_prev, list) else []
            _prev.append(content)
            payload['_collab_injected_texts'] = _prev
    except Exception:
        pass
    with _wm_lock:
        _wm[key] = float(h.get('ts') or wm)
    # 记录失败（flag 竞态关闭/组刚被清）交给调用方兜底：pool_worker 顶层 catch + 留痕
    cc.record_injection(team, codename, stream=bool(is_stream),
                        content_len=len(content), box_id=box_id)
    if log is not None:
        log.info('[ChatPool][CollabInject] %s/%s stream=%s len=%d items=%d'
                 % (team, codename, bool(is_stream), len(content), len(h['items'])))
    return content


def reset_watermarks():
    """预演零残留：清空进程内水位表。"""
    with _wm_lock:
        n = len(_wm)
        _wm.clear()
        return n
