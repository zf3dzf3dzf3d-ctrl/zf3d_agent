# -*- coding: utf-8 -*-
"""index.py —— 索引块：只增不改，前缀稳定的关键

缓存命中的前提是 messages 前缀逐字节稳定。所以索引不能"每轮重写"，
只能"新轮 append 新块"。块数涨到阈值后，把最老的一批折成一段摘要
——这是唯一允许的前缀变动点，且折叠只发生在老块上，影响面可控。
"""
import json
import os
import re
import threading
import time

from . import config
from . import archive

_LOCK = threading.RLock()

# 结论/未决的常见标记词（规则抽取，零成本起步）
_DONE_WORDS = ('已完成', '已修复', '已确认', '结论', '所以', '因此', '修复方式', '根因')
_TODO_WORDS = ('待', 'TODO', '未决', '下一步', '需要你', '尚未', '还没')


def _head(text, n=None):
    n = n or config.INDEX_HEAD_CHARS
    t = re.sub(r'\s+', ' ', str(text or '')).strip()
    return t[:n]


def _files_of(text):
    """抽涉及的文件路径（windows 风格 + 常见后缀）。"""
    if not text:
        return []
    pats = re.findall(r'[A-Za-z]:\\[^\s\'"<>|]+\.(?:py|js|json|md|css|html|txt|bat|asp)', text)
    pats += re.findall(r'\b[\w./-]+\.(?:py|js|json|md|css|html)\b', text)
    out = []
    for p in pats:
        if p not in out:
            out.append(p)
    return out[:6]


def _load(sdir):
    p = os.path.join(sdir, config.INDEX_FILE)
    if not os.path.exists(p):
        return {'blocks': [], 'folded': [], 'checkpoints': []}
    try:
        with open(p, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {'blocks': [], 'folded': [], 'checkpoints': []}


def _save(sdir, data):
    p = os.path.join(sdir, config.INDEX_FILE)
    tmp = p + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, p)


def _block_id(turn_no):
    return int(turn_no) // config.FOLD_BLOCK_SIZE


def add_turn(session_id, turn_no, user_text, assistant_text):
    """登记一轮到索引。同一轮重复调用是幂等的（覆盖本块内该轮条目）。"""
    sdir = config.session_dir(session_id)
    with _LOCK:
        data = _load(sdir)
        entry = {
            'turn': int(turn_no),
            'ts': round(time.time(), 3),
            'files': _files_of((user_text or '') + ' ' + (assistant_text or '')),
            'concl': _head(assistant_text, 240),
            'todo': _pick_todo(assistant_text),
        }
        bid = _block_id(turn_no)
        blk = None
        for b in data['blocks']:
            if b.get('id') == bid:
                blk = b
                break
        if blk is None:
            blk = {'id': bid, 'from': int(turn_no), 'to': int(turn_no), 'items': []}
            data['blocks'].append(blk)
            data['blocks'].sort(key=lambda x: x['id'])
        # 铁律：entry 一旦建立就永不改写（改写已发送过的前缀会让缓存全丢）
        for it in blk['items']:
            if it.get('turn') == int(turn_no):
                return it
        blk['items'].append(entry)
        blk['items'].sort(key=lambda x: x.get('turn') or 0)
        # to 只用于折叠判断，不渲染（见 render）
        blk['to'] = max(int(blk.get('to') or 0), int(turn_no))
        _maybe_fold(data)
        _save(sdir, data)
        return entry


def _pick_todo(text):
    if not text:
        return ''
    for line in str(text).splitlines():
        if any(w in line for w in _TODO_WORDS) and len(line.strip()) > 4:
            return _head(line, 160)
    return ''


def _maybe_fold(data):
    """块数超阈值时，把最老 FOLD_KEEP_TAIL 之外的块折叠成一段。

    注意：只动老块，且折叠结果本身也稳定（不再变），
    所以不会造成每轮前缀抖动。
    """
    keep = config.FOLD_KEEP_TAIL
    if len(data['blocks']) <= keep + 1:
        return
    old = data['blocks'][:-keep]
    if not old:
        return
    seg = _fold_text(old)
    # 折叠段按被折叠的最后一块 id 归并，重复折叠则替换（幂等）
    last_id = old[-1]['id']
    data['folded'] = [f for f in data['folded'] if f.get('to_id') != last_id]
    data['folded'].append({'to_id': last_id, 'from': old[0]['from'],
                           'to': old[-1]['to'], 'text': seg})
    data['folded'].sort(key=lambda x: x.get('to_id') or 0)
    data['blocks'] = data['blocks'][-keep:]
    # 折叠段过多时，把最老的两段再合并（索引体积必须有上限）
    while len(data['folded']) > config.FOLDED_MAX_SEGMENTS:
        a, b = data['folded'][0], data['folded'][1]
        merged = {
            'to_id': b['to_id'], 'from': a['from'], 'to': b['to'],
            'text': _head(a['text'] + '\n' + b['text'], 3000),
        }
        data['folded'] = [merged] + data['folded'][2:]


def _fold_text(blocks):
    """把若干老块压成一段紧凑摘要（保留轮号与结论，丢掉细节）。"""
    lines = []
    for b in blocks:
        for it in b.get('items') or []:
            parts = ['#%s' % it.get('turn')]
            if it.get('files'):
                parts.append('[' + ','.join(it['files'][:3]) + ']')
            if it.get('concl'):
                parts.append(it['concl'])
            lines.append(' '.join(parts))
    return _head('\n'.join(lines), 3000)


def add_checkpoint(session_id, text, turn_no=None):
    """agent 自产关键结论，置顶进索引（最值钱的部分）。"""
    sdir = config.session_dir(session_id)
    with _LOCK:
        data = _load(sdir)
        data['checkpoints'].append({
            'turn': turn_no,
            'ts': round(time.time(), 3),
            'text': _head(text, 1200),
        })
        data['checkpoints'] = data['checkpoints'][-20:]
        _save(sdir, data)


def render(session_id):
    """渲染索引为注入文本。顺序固定：折叠段 -> 存活块 -> checkpoints。"""
    sdir = config.session_dir(session_id)
    data = _load(sdir)
    out = []
    for f in data.get('folded') or []:
        out.append('[早期摘要 #%s-#%s]\n%s' % (f.get('from'), f.get('to'), f.get('text') or ''))
    for b in data.get('blocks') or []:
        rows = []
        for it in b.get('items') or []:
            row = '#%s' % it.get('turn')
            if it.get('files'):
                row += ' [' + ','.join(it['files'][:3]) + ']'
            if it.get('concl'):
                row += ' ' + it['concl']
            if it.get('todo'):
                row += ' | 未决: ' + it['todo']
            rows.append(row)
        if rows:
            # 块头只写 from（建块时定死）。若写 to，每来一轮新块尾都会改写块头，
            # 而块头排在块体之前 —— 已发送过的前缀就变了，缓存全丢。
            out.append('[块 %s 起于 #%s]\n%s' % (b.get('id'), b.get('from'),
                                              '\n'.join(rows)))
    return '\n\n'.join(out)


def render_checkpoints(session_id):
    """单独渲染 checkpoint（作为紧随 system 的第二条消息）。

    刻意与索引分开：索引块只增不改，checkpoint 每 10 轮追加一次，
    两者混在一条消息里会互相打断前缀缓存。
    """
    sdir = config.session_dir(session_id)
    data = _load(sdir)
    cps = data.get('checkpoints') or []
    if not cps:
        return ''
    lines = ['[关键结论@#%s] %s' % (cp.get('turn'), cp.get('text') or '')
             for cp in cps]
    return ('【超长任务关键结论】以下是任务推进中固化的关键结论，'
            '优先级高于索引，与索引冲突时以这里为准。\n' + '\n'.join(lines))


def need_checkpoint(session_id, turn_no):
    """是否该要求 agent 产 checkpoint（每 CHECKPOINT_EVERY 轮一次）。"""
    n = archive.count_turns(session_id)
    return n > 0 and (n % config.CHECKPOINT_EVERY == 0)
