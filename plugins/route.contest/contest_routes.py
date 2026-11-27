# -*- coding: utf-8 -*-
"""i大赛域路由（M1 MVP，2026-11-12）。

场次/分支数据全部存 db.py 的 app_data 表（category='contest'），
键形如 contest:<contest_id> / contest:<contest_id>:branch:<n>。
计时零新模块：直接轮询 chat_pool.status_snapshot() 拿各分支槽位
turn 的 started_at/ended_at/state，落库为 actual_started_at/finished_at。

端点：
  GET  /api/contest/list            → 场次列表（含各分支状态）
  POST /api/contest/create          → 建场次（题+分支模型配置）
  POST /api/contest/start           → 一键开始：逐分支向会话池 submit 发题
  GET  /api/contest/status?ids=     → 轮询分支计时/状态（读池快照并落库）
  POST /api/contest/finish          → 手动收卷某分支（超时兜底）
  POST /api/contest/report          → 派记录员对话写战报（落盘 server/data/contest_results/）

v4 修订（2026-11-13，蜂群收口采纳）：
  ① 同模型多分支：branch 带 replica 副本号字段（不改模型名，防污染池选路/展示）
  ② question_mode：题库(question)/自定义(custom, ≤4000字)，custom 贯通 status回显+judge
  ③ 计时透明化：submit→actual_started_at(gate放行)→finished_at 三时刻，差值即排队等待
  ④ 限时自动收卷：后台 daemon 定时器（默认10分钟，不依赖前端轮询），终态含 interrupted
  ⑤ report 战报：记录员对话产出 + md 落盘（.tmp 原子改名），md 为准，作答预算截断
"""
import json
import time
import traceback
from routes.dispatcher import route_get, route_post

from db import get_db as _get_db

CATEGORY = 'contest'

# 状态常量集（S2：消除字面量散落）
ST_READY, ST_RUNNING, ST_DONE, ST_FAILED, ST_INTERRUPTED = \
    'ready', 'running', 'done', 'failed', 'interrupted'
BRANCH_TERMINAL = (ST_DONE, ST_FAILED, ST_INTERRUPTED)

# v4：限时自动收卷（后台定时器，不依赖前端轮询；反驳师②采纳）
AUTO_FINISH_SEC = 600        # 默认限时 10 分钟
CUSTOM_PROMPT_MAX = 4000     # 自定义题长度上限（进化师④采纳）
_REPORT_DIR = 'data/contest_results'
_REPORTER_BOX = 'contest-reporter'
_ANSWER_BUDGET = 1500        # 战报拼接时每分支作答预算（字符）


def _extract_cid(handler, parsed):
    """S1：从原始 path 提取 id/contest_id 参数（parse_qs 一行替手写解析）。"""
    import urllib.parse as _up
    raw = getattr(handler, 'path', '') or ''
    q = _up.urlparse(raw).query
    kv = _up.parse_qs(q)
    for k in ('id', 'contest_id'):
        if kv.get(k):
            return kv[k][0]
    return ''



def _load(key):
    conn = _get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT value FROM app_data WHERE category=? AND key=?", (CATEGORY, key))
        row = cur.fetchone()
        return json.loads(row[0]) if row else None
    finally:
        conn.close()


def _save(key, obj):
    conn = _get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM app_data WHERE category=? AND key=?", (CATEGORY, key))
        if cur.fetchone():
            cur.execute("UPDATE app_data SET value=? WHERE category=? AND key=?",
                        (json.dumps(obj, ensure_ascii=False), CATEGORY, key))
        else:
            cur.execute("INSERT INTO app_data(category, key, value) VALUES(?,?,?)",
                        (CATEGORY, key, json.dumps(obj, ensure_ascii=False)))
        conn.commit()
    finally:
        conn.close()


def _contest_list_ids():
    conn = _get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT key FROM app_data WHERE category=? AND key LIKE 'contest:%' AND key NOT LIKE '%:branch:%'",
                    (CATEGORY,))
        return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()


def _default_target_url(model):
    """v4 修复：_target_url 为空时按模型名查 ai_proxy 渠道表补默认上游 URL
    （否则 chat_pool.submit 报 Missing _target_url，start/report 全军覆没）。"""
    import sys as _s, os as _o
    # 【v4.1 复核整改】_root 提到函数开头：原作用域在 if model 的 try 块内，
    # 空 model 路径下兜底分支引用 _root 会 NameError→被 except 吞掉→port.json 读取静默失效。
    _root = _o.path.dirname(_o.path.dirname(_o.path.dirname(_o.path.abspath(__file__))))
    if model:
        try:
            if _root not in _s.path:
                _s.path.insert(0, _root)
            import ai_proxy as _ap
            ch = _ap._default_channel(str(model))
            url = (_ap.CHANNELS().get(ch) or {}).get('url') if ch else ''
            if url:
                return url
        except Exception:
            pass
    # 兜底：走本机 ai_proxy 转发网关（其内部再按模型路由到真实上游）
    # 【端口修正】6.2.0 端口段迁移后网关实际端口在 private/port.json 的 ai_proxy_port
    # （本版=8624），不能硬编码旧默认 8787——否则兜底必打空端口，分支瞬时 failed。
    try:
        import json as _j
        _pj = _o.path.join(_root, 'private', 'port.json')
        with open(_pj, 'r', encoding='utf-8-sig') as _f:  # utf-8-sig: port.json 实际带 BOM
            _port = (_j.load(_f) or {}).get('ai_proxy_port') or 8624
        return 'http://127.0.0.1:%s/v1/chat/completions' % _port
    except Exception:
        return 'http://127.0.0.1:8624/v1/chat/completions'


def _submit_question(branch_body, question, turn_id):
    """向会话池投递一轮（chat_pool.submit：同 box 串行、跨 box 并行）。"""
    body = dict(branch_body)
    body['_question'] = question
    # v4 修复：_target_url 空串会被 chat_pool 拒收（Missing _target_url），按模型补默认上游
    if not body.get('_target_url'):
        body['_target_url'] = _default_target_url(body.get('model') or body.get('provider') or '')
    import chat_pool
    return chat_pool.submit(body, turn_id)


def _pool_poll_and_record(contest, branches):
    """读会话池快照，给每个 running/done 分支落库计时（幂等，首次见到才写）。"""
    try:
        import chat_pool
        snap = chat_pool.status_snapshot()
    except Exception:
        return
    by_box = {}
    for s in snap.get('slots', []):
        by_box[str(s.get('box'))] = s
    changed = False
    for b in branches:
        if b.get('status') not in ('running', 'waiting'):
            continue
        s = by_box.get(str(b.get('box_id')))
        t = (s or {}).get('turn') or {}
        tid = b.get('turn_id')
        if t.get('turn_id') != tid:
            # 池中该槽位已不是本分支的轮次：要么已完成回收，要么被顶掉
            if b.get('status') == ST_RUNNING and b.get('submitted_at'):
                # 已被顶掉/回收：若从没记到 finished_at，标 unknown 兜底
                if not b.get('finished_at'):
                    b['status'] = ST_INTERRUPTED
                    b['finished_at'] = time.time()
                    changed = True
            continue
        st = t.get('state')
        if st in ('waiting', 'running'):
            b['status'] = ST_RUNNING
            if t.get('started_at') and not b.get('actual_started_at'):
                b['actual_started_at'] = t['started_at']  # 闸门放行后真正起跑时刻
                changed = True
        elif st in ('done', 'failed', 'cancelled', 'finished'):
            # cancelled 归 done：主动收卷（finish 端点）语义上视为完成作答
            b['status'] = ST_FAILED if st == 'failed' else ST_DONE
            if not b.get('finished_at'):
                b['finished_at'] = t.get('ended_at') or time.time()
            if t.get('started_at') and not b.get('actual_started_at'):
                b['actual_started_at'] = t['started_at']
            # 领取作答文本（contest_capture 由 chat_pool result 拦截写入）
            try:
                import contest_capture
                cap = contest_capture.take(tid)
                if cap and not b.get('answer'):
                    b['answer'] = cap.get('text', '')
                    changed = True
            except Exception:
                pass
            changed = True
    if changed:
        _save('contest:%s' % contest['id'], contest)


# 插件路径适配（T2.4 批量）：副本位于 plugins/，自持导入重指 __file__ 到源路径，
# 使全部 dirname 链与源文件（server/routes/）语义一致，逻辑零改动
import os as _pf_os  # noqa: E402  适配器自持导入
__file__ = _pf_os.path.join(_pf_os.path.dirname(_pf_os.path.abspath(__file__)),
                            '..', '..', 'server', 'routes', 'domain_contest.py')
@route_get('/api/contest/list')
def _get_list(handler, path, parsed):
    out = []
    try:
        for k in _contest_list_ids():
            c = _load(k)
            if c:
                out.append({'id': c['id'], 'title': c.get('title'), 'question_id': c.get('question_id'),
                            'question_mode': c.get('question_mode') or 'question',
                            'created_at': c.get('created_at'), 'status': c.get('status'),
                            'branches': [{'box_id': b.get('box_id'), 'model': b.get('model'),
                                          'status': b.get('status'),
                                          'started_at': b.get('actual_started_at'),
                                          'finished_at': b.get('finished_at'),
                                          'answer': (b.get('answer') or '')[:200]} for b in c.get('branches', [])]})
        handler._send_json({'ok': True, 'contests': out})
    except Exception as e:
        traceback.print_exc()
        handler._send_json({'ok': False, 'error': str(e)}, 500)


@route_post('/api/contest/create')
def _post_create(handler, path, parsed):
    try:
        body = handler._read_json()
    except Exception:
        handler._send_json({'ok': False, 'error': 'body 必须为 JSON'}, 400)
        return
    title = str(body.get('title') or '').strip()
    question_id = str(body.get('question_id') or '').strip()
    custom_prompt = str(body.get('custom_prompt') or '').strip()
    branches = body.get('branches') or []
    question_mode = str(body.get('question_mode') or ('custom' if custom_prompt else 'question'))
    if question_mode == 'custom':
        if not custom_prompt:
            handler._send_json({'ok': False, 'error': 'custom 模式必须提供 custom_prompt'}, 400)
            return
        if len(custom_prompt) > CUSTOM_PROMPT_MAX:
            handler._send_json({'ok': False, 'error': '自定义题超长（%d>%d 字符）' % (len(custom_prompt), CUSTOM_PROMPT_MAX)}, 400)
            return
        question_id = ''
    else:
        if not title or not question_id or not isinstance(branches, list) or not branches:
            handler._send_json({'ok': False, 'error': 'title/question_id/branches 必填'}, 400)
            return
        q = _load('question:%s' % question_id)
        if not q:
            handler._send_json({'ok': False, 'error': '题目不存在: %s' % question_id}, 400)
            return
    if not title or not isinstance(branches, list) or not branches:
        handler._send_json({'ok': False, 'error': 'title/branches 必填'}, 400)
        return
    # v4·M3（进化师①采纳）：分支上限守卫，防逐个派出占满 chat_pool 槽位
    MAX_BRANCHES = 10
    if len(branches) > MAX_BRANCHES:
        handler._send_json({'ok': False, 'error': '分支数超上限（最多 %d 个，当前 %d 个）' % (MAX_BRANCHES, len(branches))}, 400)
        return
    cid = 'c%d' % int(time.time() * 1000)
    # v4①：同模型允许，副本号按「同 model 出现序」标 replica（不改模型名，突破师④采纳）
    _seen = {}
    _branch_list = []
    for i, bc in enumerate(branches):
        m = str(bc.get('model') or '').strip()
        _seen[m] = _seen.get(m, 0) + 1
        _branch_list.append({
            'idx': i, 'box_id': str(bc.get('box_id') or '').strip() or ('contest-%s-b%d' % (cid, i)),
            'model': m,
            'replica': _seen[m],
            'provider': str(bc.get('provider') or '').strip(),
            'status': ST_READY,  # ready/running/done/failed/interrupted
        })
    contest = {
        'id': cid, 'title': title, 'question_id': question_id,
        'question_mode': question_mode, 'custom_prompt': custom_prompt,
        'auto_finish_sec': int(body.get('auto_finish_sec') or AUTO_FINISH_SEC),
        'created_at': time.time(), 'status': ST_READY,
        'branches': _branch_list,
    }
    _save('contest:%s' % cid, contest)
    handler._send_json({'ok': True, 'contest_id': cid, 'contest': contest})


@route_post('/api/contest/start')
def _post_start(handler, path, parsed):
    try:
        body = handler._read_json()
    except Exception:
        handler._send_json({'ok': False, 'error': 'body 必须为 JSON'}, 400)
        return
    cid = str(body.get('contest_id') or '')
    contest = _load('contest:%s' % cid)
    if not contest:
        handler._send_json({'ok': False, 'error': '场次不存在'}, 400)
        return
    if contest.get('status') not in (ST_READY,):
        handler._send_json({'ok': False, 'error': '场次状态不可开始（当前 %s）' % contest.get('status')}, 400)
        return
    # v4②：custom 模式直接用自定义题；question 模式读题库
    if contest.get('question_mode') == 'custom':
        prompt = contest.get('custom_prompt') or ''
        if not prompt:
            handler._send_json({'ok': False, 'error': '自定义题为空'}, 400)
            return
    else:
        q = _load('question:%s' % contest['question_id'])
        if not q:
            handler._send_json({'ok': False, 'error': '题目不存在'}, 400)
            return
        prompt = (q.get('prompt') or q.get('text') or '')
    results = []
    now = time.time()
    for b in contest['branches']:
        if b.get('status') != ST_READY:
            continue
        turn_id = '%s-b%d-%d' % (cid, b['idx'], int(now))
        body_msg = {
            '_box_id': b['box_id'],
            '_target_url': b.get('_target_url') or '',  # 由前端按模型配置带出；缺省走默认上游
            'messages': [{'role': 'user', 'content': prompt}],
        }
        if b.get('model'):
            body_msg['model'] = b['model']
        if b.get('provider'):
            body_msg['provider'] = b['provider']
        r = _submit_question(body_msg, prompt, turn_id)
        if r.get('ok'):
            b['status'] = ST_RUNNING
            b['turn_id'] = turn_id
            b['submitted_at'] = now
        else:
            b['status'] = ST_FAILED
            b['error'] = str(r.get('error') or '')
        results.append({'box_id': b['box_id'], 'ok': r.get('ok'), 'error': r.get('error'),
                        'fallback': r.get('fallback')})
    if all(b.get('status') == ST_FAILED for b in contest['branches']):
        contest['status'] = ST_FAILED
    else:
        contest['status'] = ST_RUNNING
        contest['started_at'] = now
    _save('contest:%s' % cid, contest)
    # v4④：后台定时器限时自动收卷（反驳师②：不能依赖前端轮询；daemon 线程，重启即失但 status 轮询的 >限时 收敛兜底）
    _arm_auto_finish(cid, contest.get('auto_finish_sec') or AUTO_FINISH_SEC)
    handler._send_json({'ok': True, 'contest': contest, 'submit_results': results})


@route_get('/api/contest/status')
def _get_status(handler, path, parsed):
    cid = _extract_cid(handler, parsed)
    if not cid:
        handler._send_json({'ok': False, 'error': '缺 id 参数'}, 400)
        return
    contest = _load('contest:%s' % cid)
    if not contest:
        handler._send_json({'ok': False, 'error': '场次不存在'}, 400)
        return
    _converge(cid, contest)
    out = _timeout_guard(cid, contest)
    handler._send_json({'ok': True, 'contest': out})


def _converge(cid, contest):
    """池快照轮询落库 + 场次级终态收敛（单次落库，消写放大）。"""
    _pool_poll_and_record(contest, contest.get('branches', []))
    if contest.get('status') == ST_RUNNING:
        sts = {b.get('status') for b in contest.get('branches', [])}
        if sts and sts <= set(BRANCH_TERMINAL):
            contest['status'] = 'finished'
            contest['finished_at'] = time.time()
        # v4④：status 轮询兜底限时收敛（后台定时器因 server 重启丢失时，轮询仍能收卷）
        else:
            _auto_finish_if_due(cid, contest)
    _save('contest:%s' % cid, contest)


_AUTO_TIMERS = {}  # cid -> threading.Timer（防重复挂定时器）


def _arm_auto_finish(cid, sec):
    """v4④：挂后台 daemon 定时器，到点自动收卷全部未终态分支为 interrupted。
    双保险：定时器（用户关页也生效）+ status 轮询 _auto_finish_if_due（server 重启兜底）。"""
    import threading
    old = _AUTO_TIMERS.get(cid)
    if old:
        return  # 已挂，不重复
    t = threading.Timer(sec, _auto_finish_all, args=(cid,))
    t.daemon = True
    _AUTO_TIMERS[cid] = t
    t.start()


def _auto_finish_if_due(cid, contest):
    """轮询路径的限时收敛（server 重启后定时器丢失时兜底）。"""
    started = contest.get('started_at')
    if not started:
        return
    sec = contest.get('auto_finish_sec') or AUTO_FINISH_SEC
    if time.time() - started < sec:
        return
    _auto_finish_all(cid)


def _auto_finish_all(cid):
    """限时到点：所有未终态分支标 interrupted（区别于自然结束的 done），场次收敛。"""
    try:
        contest = _load('contest:%s' % cid)
        if not contest or contest.get('status') != ST_RUNNING:
            return
        now = time.time()
        for b in contest.get('branches', []):
            if b.get('status') not in BRANCH_TERMINAL:
                b['status'] = ST_INTERRUPTED
                b['finished_at'] = now
                b['timeout_auto'] = True
                try:
                    import chat_pool
                    chat_pool.cancel(b.get('box_id'), b.get('turn_id') or '')
                except Exception:
                    pass
        contest['status'] = 'finished'
        contest['finished_at'] = now
        contest['auto_finished'] = True
        _save('contest:%s' % cid, contest)
    finally:
        _AUTO_TIMERS.pop(cid, None)


def _timeout_guard(cid, contest):
    """超时兜底：>1h 前端标红 overdue；>24h 转 interrupted（与收敛合并一次落库）。"""
    now = time.time()
    out_branches = []
    dirty = False
    for b in contest.get('branches', []):
        started = b.get('actual_started_at')
        finished = b.get('finished_at')
        dur = (finished - started) if (started and finished) else ((now - started) if started else None)
        overdue = bool(started and not finished and (now - started) > 3600)
        if started and not finished and (now - started) > 86400:
            b['status'] = ST_INTERRUPTED
            b['finished_at'] = now
            dirty = True
        out_branches.append({
            'idx': b.get('idx'), 'box_id': b.get('box_id'), 'model': b.get('model'),
            'replica': b.get('replica'),  # v4①：同模型副本号
            'status': b.get('status'), 'started_at': started, 'finished_at': finished,
            'submitted_at': b.get('submitted_at'),   # v4③：提交时刻（排队起点）
            'gate_released_at': started,             # v4③：gate 放行即真实起跑（=actual_started_at）
            'duration_sec': round(dur, 1) if dur else None, 'overdue': overdue,
            'timeout_auto': b.get('timeout_auto', False),
            'score': b.get('score'), 'answer': (b.get('answer') or '')[:400],
            'error': b.get('error'),
        })
    if dirty:
        _save('contest:%s' % cid, contest)
    return {'id': contest['id'], 'title': contest.get('title'),
            'status': contest.get('status'), 'branches': out_branches,
            'question_mode': contest.get('question_mode') or 'question',
            'custom_prompt': contest.get('custom_prompt') or '',
            'auto_finished': contest.get('auto_finished', False)}


@route_post('/api/contest/finish')
def _post_finish(handler, path, parsed):
    try:
        body = handler._read_json()
    except Exception:
        handler._send_json({'ok': False, 'error': 'body 必须为 JSON'}, 400)
        return
    cid = str(body.get('contest_id') or '')
    idx = body.get('idx')
    contest = _load('contest:%s' % cid)
    if not contest:
        handler._send_json({'ok': False, 'error': '场次不存在'}, 400)
        return
    for b in contest.get('branches', []):
        if b.get('idx') == idx and b.get('status') in (ST_RUNNING, 'waiting'):
            b['status'] = 'done'
            b['finished_at'] = time.time()
            try:
                import chat_pool
                chat_pool.cancel(b.get('box_id'), b.get('turn_id') or '')
            except Exception:
                pass
    _save('contest:%s' % cid, contest)
    handler._send_json({'ok': True})


# ===== 题库（M1 首批：仅带参考答案的纯文本题，外置 json，schema 强制 answer/rubric） =====
_QUESTIONS_FILE = 'data/contest_questions.json'


def _load_questions_file():
    try:
        with open(_QUESTIONS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []


def _ensure_seed_questions():
    """v4·M3：改为按题 id 增量补灌——DB 缺哪题补哪题，已有题不覆盖（保留人工改动）。"""
    try:
        existing = set()
        conn = _get_db()
        try:
            cur = conn.cursor()
            cur.execute("SELECT key FROM app_data WHERE category=? AND key LIKE 'question:%' AND key != 'question:question_seed_v1'",
                        (CATEGORY,))
            existing = {r[0] for r in cur.fetchall()}
        finally:
            conn.close()
        for q in _load_questions_file():
            key = 'question:%s' % q['id']
            if key not in existing:
                _save(key, q)
    except Exception:
        return


def _judge_score(contest, q):
    """评委模型 rubric 打分（突破师杠杆：复用一次普通池调用，不建新评分模块）。
    同步阻塞等待评委结果（评委题短，一般 <60s）；失败时不阻塞收卷，返回 error。"""
    import chat_pool
    branches = [b for b in contest.get('branches', [])
                if b.get('status') == ST_DONE and b.get('answer')]
    if not branches:
        return {'ok': False, 'error': '没有可评的已完成分支（需 done 且有作答）'}
    answers_txt = '\n\n'.join(
        '【分支%d %s】\n%s' % (b['idx'], b.get('model') or b.get('box_id'),
                              (b.get('answer') or '')[:3000])
        for b in branches)
    prompt = ('你是竞赛评委。题目：%s\n评分标准：%s\n参考答案：%s\n\n各分支作答：\n%s\n\n'
              '请严格按评分标准给每个分支打分（0-100），输出 JSON 数组，'
              '格式：[{"idx": 分支号, "score": 分数, "reason": "一句话理由"}]，不要输出其他内容。'
              % (q.get('prompt', '')[:800], q.get('rubric', ''), q.get('answer', ''),
                 answers_txt))
    turn_id = 'judge-%s-%d' % (contest['id'], int(time.time()))
    body = {'_box_id': 'contest-judge', 'messages': [{'role': 'user', 'content': prompt}]}
    judge_model = contest.get('judge_model')
    if judge_model:
        body['model'] = judge_model
    r = chat_pool.submit(body, turn_id)
    if not r.get('ok'):
        return {'ok': False, 'error': str(r.get('error') or '评委调用失败')}
    # 轮询等待评委完成（上限 120s）
    import contest_capture
    deadline = time.time() + 120
    text = ''
    while time.time() < deadline:
        time.sleep(2)
        cap = contest_capture.take(turn_id)
        if cap:
            text = cap.get('text', '')
            break
        # 查池状态是否已终态
        try:
            snap = chat_pool.status_snapshot()
            s = next((x for x in snap.get('slots', []) if x.get('box') == 'contest-judge'), None)
            stt = ((s or {}).get('turn') or {}).get('state')
            if stt in ('done', 'failed', 'cancelled'):
                cap = contest_capture.take(turn_id)
                text = (cap or {}).get('text', '')
                break
        except Exception:
            pass
    if not text:
        return {'ok': False, 'error': '评委超时未返回（120s），可稍后重评'}
    # 解析评委 JSON
    scores = []
    try:
        m = text[text.find('['):text.rfind(']') + 1]
        scores = json.loads(m)
    except Exception:
        return {'ok': False, 'error': '评委输出无法解析为 JSON', 'raw': text[:500]}
    applied = 0
    for sc in scores:
        try:
            idx = int(sc.get('idx'))
            for b in contest['branches']:
                if b['idx'] == idx:
                    b['score'] = {'score': int(sc.get('score') or 0),
                                  'reason': str(sc.get('reason') or '')[:200],
                                  'judged_at': time.time()}
                    applied += 1
        except Exception:
            continue
    contest['judged_at'] = time.time()
    _save('contest:%s' % contest['id'], contest)
    return {'ok': True, 'applied': applied, 'scores': scores}


@route_post('/api/contest/judge')
def _post_judge(handler, path, parsed):
    try:
        body = handler._read_json()
    except Exception:
        handler._send_json({'ok': False, 'error': 'body 必须为 JSON'}, 400)
        return
    cid = str(body.get('contest_id') or '')
    contest = _load('contest:%s' % cid)
    if not contest:
        handler._send_json({'ok': False, 'error': '场次不存在'}, 400)
        return
    q = _load('question:%s' % contest['question_id']) if contest.get('question_id') else None
    if contest.get('question_mode') == 'custom' or not q:
        # v4②：custom 自定义题无 rubric/参考答案 → 禁用评委打分（进化师④）
        handler._send_json({'ok': False, 'error': '自定义题无评分标准(rubric)，评委打分不可用'}, 400)
        return
    if body.get('judge_model'):
        contest['judge_model'] = str(body['judge_model']).strip()
    r = _judge_score(contest, q)
    handler._send_json(r)


def _contest_report_md(cid, contest):
    """v4⑤：拼战报 prompt（作答预算截断防超上下文，反驳师⑤）。"""
    lines = ['# i大赛战报 · %s（%s）' % (contest.get('title') or cid, cid)]
    lines.append('- 题目模式：%s' % (contest.get('question_mode') or 'question'))
    qtext = contest.get('custom_prompt') or ''
    if contest.get('question_id'):
        q = _load('question:%s' % contest['question_id'])
        qtext = (q or {}).get('prompt') or qtext
    lines.append('- 题目：%s' % (qtext or '')[:300])
    lines.append('- 开始：%s / 收卷：%s%s' % (
        time.strftime('%H:%M:%S', time.localtime(contest.get('started_at') or 0)),
        time.strftime('%H:%M:%S', time.localtime(contest.get('finished_at') or 0)),
        '（限时自动收卷）' if contest.get('auto_finished') else ''))
    lines.append('')
    for b in sorted(contest.get('branches', []), key=lambda x: (x.get('duration_sec') is None, x.get('duration_sec') or 0)):
        dur = b.get('duration_sec')
        wait = ''
        if b.get('submitted_at') and b.get('actual_started_at'):
            wait = '（排队%.1fs）' % (b['actual_started_at'] - b['submitted_at'])
        lines.append('## 分支%d %s%s%s → %s %.1fs%s' % (
            b.get('idx'), b.get('model') or b.get('box_id'),
            '#%d' % b['replica'] if b.get('replica') and b['replica'] > 1 else '',
            wait, b.get('status'), dur if dur else -1,
            ' ⚖%s' % b['score']['score'] if b.get('score') else ''))
        ans = (b.get('answer') or '')
        lines.append('> %s' % (ans[:_ANSWER_BUDGET] + ('…[截断]' if len(ans) > _ANSWER_BUDGET else '')))
        lines.append('')
    return '\n'.join(lines)


def _write_report_md(cid, md_text):
    """v4⑤：.tmp 原子改名落盘（防半截战报，进化师②）。md 为准（反驳师⑤）。"""
    import os
    d = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), _REPORT_DIR)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, '%s.md' % cid)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(md_text)
    os.replace(tmp, path)
    return path


@route_post('/api/contest/report')
def _post_report(handler, path, parsed):
    """v4⑥：派记录员对话写战报 + md 落盘（md 为准）。非阻塞：先落 md，记录员产出异步可查。"""
    try:
        body = handler._read_json()
    except Exception:
        handler._send_json({'ok': False, 'error': 'body 必须为 JSON'}, 400)
        return
    cid = str(body.get('contest_id') or '')
    contest = _load('contest:%s' % cid)
    if not contest:
        handler._send_json({'ok': False, 'error': '场次不存在'}, 400)
        return
    if contest.get('status') != 'finished':
        handler._send_json({'ok': False, 'error': '场次未收卷完成，不能出战报'}, 400)
        return
    md = _contest_report_md(cid, contest)
    try:
        md_path = _write_report_md(cid, md)
    except Exception as e:
        handler._send_json({'ok': False, 'error': '战报落盘失败: %s' % e}, 500)
        return
    # 派记录员对话润色战报（复用池 submit；产出可再落盘覆盖）
    prompt = ('你是大赛记录员。以下是系统自动生成的比赛战报，请补一段 200 字以内的赛况评述'
              '（谁最快、亮点与失误），直接输出评述，不要重复原文：\n\n%s' % md[:6000])
    turn_id = 'report-%s-%d' % (cid, int(time.time()))
    try:
        import chat_pool
        r = chat_pool.submit({'_box_id': _REPORTER_BOX,
                              '_target_url': _default_target_url(''),  # v4 修复：空 _target_url 会被池拒收
                              'messages': [{'role': 'user', 'content': prompt}]}, turn_id)
        reporter_ok = bool(r.get('ok'))
    except Exception:
        reporter_ok = False
    contest['report_md'] = md_path
    contest['report_turn_id'] = turn_id if reporter_ok else ''
    _save('contest:%s' % cid, contest)
    handler._send_json({'ok': True, 'report_path': md_path, 'reporter_turn_id': contest['report_turn_id'],
                        'report': md})


@route_get('/api/contest/questions')
def _get_questions(handler, path, parsed):
    _ensure_seed_questions()
    conn = _get_db()
    qs = []
    try:
        cur = conn.cursor()
        cur.execute("SELECT key, value FROM app_data WHERE category=? AND key LIKE 'question:%' AND key != 'question:question_seed_v1'",
                    (CATEGORY,))
        for k, v in cur.fetchall():
            try:
                qs.append(json.loads(v))
            except Exception:
                continue
    finally:
        conn.close()
    handler._send_json({'ok': True, 'questions': qs})
