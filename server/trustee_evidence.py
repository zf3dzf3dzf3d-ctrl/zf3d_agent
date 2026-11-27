# -*- coding: utf-8 -*-
"""i托管 P1.5 审批证据持久化（2026-11-16 修复）。

修复前缺陷：mixin_trustee._gather_turn_evidence 按 turn_id 尾 12 位去
agent_turns.turn_no 对账——但 turn_no 实为秒级时间戳（纯数字10位），
turn_id 尾 12 位是含字母/连字符的随机段（如 hn-kj1hj6lx），
SQL 永远查空 → 审批包永远空卷 → LLM 永远 abstain。

本模块：chat_pool 在 result 事件拦截处调用 save()，按完整 turn_id
把收口正文追加落盘 JSONL（每行 {turn_id, box, model, at, text}），
trustee 取证时按完整 turn_id 精确匹配读取。只追加、原子写、限长。
"""
import io
import json
import os
import time  # noqa: E402
import threading

_LOCK = threading.Lock()
# 与 server/data/ 其他运行时数据同目录；.gitignore 已覆盖 server/data/
_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     'data', 'trustee_turn_bodies.jsonl')
_MAX_LINES = 5000   # 防无限增长：超限时重写保留尾段
_TEXT_LIMIT = 8000  # 单条正文截断


def save(turn_id, box_id, model, text):
    if not turn_id or not text:
        return False
    line = json.dumps({
        'turn_id': str(turn_id), 'box': str(box_id or ''),
        'model': str(model or ''), 'at': int(time.time() * 1000),
        'text': str(text)[:_TEXT_LIMIT],
    }, ensure_ascii=False)
    try:
        with _LOCK:
            os.makedirs(os.path.dirname(_PATH), exist_ok=True)
            n = 0
            if os.path.exists(_PATH):
                with io.open(_PATH, 'r', encoding='utf-8', errors='replace') as f:
                    for n, _ in enumerate(f, 1):
                        pass
            if n > _MAX_LINES:
                # 重写保留末尾一半（简单截尾，非关键路径，失败忽略）
                try:
                    with io.open(_PATH, 'r', encoding='utf-8', errors='replace') as f:
                        lines = f.readlines()[-(_MAX_LINES // 2):]
                    with io.open(_PATH, 'w', encoding='utf-8') as f:
                        f.writelines(lines)
                except Exception:
                    pass
            with io.open(_PATH, 'a', encoding='utf-8') as f:
                f.write(line + '\n')
        return True
    except Exception:
        return False


def load(turn_id):
    """按完整 turn_id 精确匹配取最近一条正文；无则返回 ''。"""
    if not turn_id:
        return ''
    tid = str(turn_id)
    hit = ''
    try:
        with _LOCK:
            if not os.path.exists(_PATH):
                return ''
            with io.open(_PATH, 'r', encoding='utf-8', errors='replace') as f:
                for line in f:
                    try:
                        d = json.loads(line)
                    except Exception:
                        continue
                    if d.get('turn_id') == tid:
                        hit = str(d.get('text') or '')
    except Exception:
        return ''
    return hit


# ===== P1.5 钩子补丁（2026-11-17）：重派凭据抄送 =====
# 缺陷根因：_auto_redispatch 的唯一凭据来源是 pool_resume 登记，而 mark_done
# 在任务完成时立即 del 登记；托管 60s 一轮旁观，想重派时凭据已清 → 永远
# 「无重派凭据转人工」。修复：托管在任务首见时抄送一份原 body 快照到自留
# 文件（_REQ_PATH），重派时登记没了就用自留快照兜底。
_REQ_LOCK = threading.Lock()
_REQ_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         'data', 'trustee_redispatch_reqs.jsonl')
_REQ_MAX_LINES = 3000


def save_req(turn_id, entry):
    """抄送重派凭据（entry 为 pool_resume 登记原样：slot_id/ts/body 等）。"""
    if not turn_id or not isinstance(entry, dict) or not entry.get('body'):
        return False
    line = json.dumps({'turn_id': str(turn_id), 'at': int(time.time() * 1000),
                       'entry': entry}, ensure_ascii=False)
    try:
        with _REQ_LOCK:
            os.makedirs(os.path.dirname(_REQ_PATH), exist_ok=True)
            n = 0
            if os.path.exists(_REQ_PATH):
                with io.open(_REQ_PATH, 'r', encoding='utf-8', errors='replace') as f:
                    for n, _ in enumerate(f, 1):
                        pass
            if n > _REQ_MAX_LINES:
                try:
                    with io.open(_REQ_PATH, 'r', encoding='utf-8', errors='replace') as f:
                        lines = f.readlines()[-(_REQ_MAX_LINES // 2):]
                    with io.open(_REQ_PATH, 'w', encoding='utf-8') as f:
                        f.writelines(lines)
                except Exception:
                    pass
            with io.open(_REQ_PATH, 'a', encoding='utf-8') as f:
                f.write(line + '\n')
        return True
    except Exception:
        return False


def load_req(turn_id):
    """按完整 turn_id 取自留凭据快照；无则 None。"""
    if not turn_id:
        return None
    tid = str(turn_id)
    hit = None
    try:
        with _REQ_LOCK:
            if not os.path.exists(_REQ_PATH):
                return None
            with io.open(_REQ_PATH, 'r', encoding='utf-8', errors='replace') as f:
                for line in f:
                    try:
                        d = json.loads(line)
                    except Exception:
                        continue
                    if d.get('turn_id') == tid:
                        e = d.get('entry')
                        if isinstance(e, dict) and e.get('body'):
                            hit = e
        return hit
    except Exception:
        return None
