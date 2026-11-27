# -*- coding: utf-8 -*-
"""批量提问端点（DSH v2.1 P1-③）。

POST /api/batch-ask
  body: {questions: ["q1", "q2", ...], chat_ids: ["c1","c2",...]?}
  - questions 拆条入 monitor_queue（category='monitor_queue'，与 monitor 工具同通道）
  - 并发闸门：同时处于 pending 状态的批次条数上限 MAX_ACTIVE=5（裁决：死锁前科，保守起步）
  - 失败隔离：单条入队失败不影响其余，逐条返回状态
  - 单批上限 200 条（防误粘贴超大文本）
  ⚠ 已知脆弱点（代码师收口C6，暂缓重构）：并发闸门按 value JSON 字符串
    LIKE '%"status": "pending"%' 计数，依赖 json.dumps 默认空格格式；
    序列化参数一变即漏计。上线验证后立项改为解析 JSON 精确计数。

POST /api/batch-ask/status
  body: {batch_id}
  - 返回该批各条队列状态（pending/done）
"""
import json
import time
import threading
import traceback
from routes.dispatcher import route_post
from db import get_db as _get_db

# 并发闸门（裁决值：≤5，压测通过后可评审放宽）
MAX_ACTIVE = 5
MAX_BATCH = 200
CATEGORY = 'monitor_queue'  # 与 monitor 工具同通道，复用现有轮询消费链

_batch_lock = threading.Lock()
_batch_seq = 0


def _register(handler):
    handler._send_json({'ok': True})


@route_post('/api/batch-ask')
def _post_batch_ask(handler, path, parsed):
    try:
        body = handler._read_json()  # 修复：body 已被入口 _drain_body 排干缓存，直接 rfile.read 会永久阻塞（连接黑洞）
    except Exception:
        handler._send_json({'ok': False, 'error': '请求体解析失败（须为合法 JSON）'}, 400)
        return

    questions = body.get('questions') or []
    if not isinstance(questions, list) or not questions:
        handler._send_json({'ok': False, 'error': 'questions 必须为非空数组'}, 400)
        return
    questions = [str(q).strip() for q in questions if str(q).strip()][:MAX_BATCH]
    if not questions:
        handler._send_json({'ok': False, 'error': 'questions 全部为空'}, 400)
        return

    # 并发闸门：统计当前 monitor_queue 中 pending 条数
    try:
        conn = _get_db()
        try:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM app_data WHERE category=? AND value LIKE '%\"status\": \"pending\"%'",
                        (CATEGORY,))
            row = cur.fetchone()
        finally:
            conn.close()
        active = int(row[0] if row else 0)
    except Exception:
        traceback.print_exc()
        handler._send_json({'ok': False, 'error': '服务器内部错误（详情见服务端日志）'}, 500)
        return

    if active >= MAX_ACTIVE * 40:  # 总队列积压上限 200 条（MAX_ACTIVE 5 × 每窗约40条积压则拒绝）
        handler._send_json({'ok': False,
                           'error': '队列积压 %d 条，超过闸门，请稍后再试' % active}, 429)
        return

    # 分配窗位：轮转分给 ≤MAX_ACTIVE 个 chat_id（前端传入或默认 batch_w1..w5）
    chat_ids = body.get('chat_ids') or []
    chat_ids = [str(c) for c in chat_ids if str(c)][:MAX_ACTIVE] or \
        ['batch_w%d' % (i + 1) for i in range(MAX_ACTIVE)]

    with _batch_lock:
        global _batch_seq
        _batch_seq += 1
        batch_id = 'batch-%d-%d' % (int(time.time()), _batch_seq)

    now = int(time.time() * 1000)
    items = []
    try:
        conn = _get_db()
        try:
            cur = conn.cursor()
            for i, q in enumerate(questions):
                cid = chat_ids[i % len(chat_ids)]
                key = '%s-%d' % (batch_id, i)
                data = json.dumps({'chat_id': cid, 'message': q,
                                   'timestamp': now + i, 'status': 'pending',
                                   'batch_id': batch_id}, ensure_ascii=False)
                try:
                    cur.execute(
                        'INSERT INTO app_data (category, key, value, created_at, updated_at) '
                        'VALUES (?, ?, ?, ?, ?)',
                        (CATEGORY, key, data, now, now))
                    items.append({'index': i, 'key': key, 'chat_id': cid,
                                  'status': 'queued'})
                except Exception as e:  # 失败隔离：单条失败继续
                    items.append({'index': i, 'key': key, 'chat_id': cid,
                                  'status': 'failed', 'error': str(e)})
            conn.commit()
        finally:
            conn.close()
    except Exception:
        traceback.print_exc()
        handler._send_json({'ok': False, 'error': '服务器内部错误（详情见服务端日志）'}, 500)
        return

    ok_n = sum(1 for it in items if it['status'] == 'queued')
    handler._send_json({'ok': True, 'batch_id': batch_id,
                       'total': len(questions), 'queued': ok_n,
                       'failed': len(questions) - ok_n,
                       'windows': chat_ids, 'items': items})


@route_post('/api/batch-ask/status')
def _post_batch_ask_status(handler, path, parsed):
    try:
        body = handler._read_json()  # 修复：body 已被入口 _drain_body 排干缓存，直接 rfile.read 会永久阻塞（连接黑洞）
    except Exception:
        handler._send_json({'ok': False, 'error': '请求体解析失败（须为合法 JSON）'}, 400)
        return
    batch_id = str(body.get('batch_id') or '')
    if not batch_id:
        handler._send_json({'ok': False, 'error': '需要 batch_id'}, 400)
        return
    try:
        conn = _get_db()
        try:
            cur = conn.cursor()
            cur.execute("SELECT key, value FROM app_data WHERE category=? AND value LIKE ? ORDER BY key",
                        (CATEGORY, '%' + batch_id + '%'))
            rows = cur.fetchall()
        finally:
            conn.close()
    except Exception:
        traceback.print_exc()
        handler._send_json({'ok': False, 'error': '服务器内部错误（详情见服务端日志）'}, 500)
        return
    items = []
    for k, v in rows:
        try:
            d = json.loads(v)
            items.append({'key': k, 'chat_id': d.get('chat_id'),
                          'message': (d.get('message') or '')[:80],
                          'status': d.get('status'), 'ts': d.get('timestamp')})
        except Exception:
            continue
    handler._send_json({'ok': True, 'batch_id': batch_id,
                       'total': len(items),
                       'pending': sum(1 for i in items if i.get('status') == 'pending'),
                       'items': items[:200]})
