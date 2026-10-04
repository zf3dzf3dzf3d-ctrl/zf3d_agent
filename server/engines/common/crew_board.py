# -*- coding: utf-8 -*-
"""协作施工队（Crew 模式）黑板 + 消息总线。

与赛马模式（race_registry.py）完全两条线：
- 赛马：N 份独立 worktree 物理隔离，冗余竞争，事后收口。
- 协作：1 个共享现场（site/crew/<ts> 分支），N 窗认领分片共干一活，
  黑板认领即锁文件，总线弱沟通，审核员照常收口。

数据落盘（server/data/_crew/）：
- <crew_id>.json      任务黑板（片列表、认领状态、窗口表）
- <crew_id>.bus.jsonl 消息总线（append-only，弱沟通）

并发安全：模块级 threading.Lock + 写临时文件后 os.replace 原子落盘。
"""

import json
import os
import subprocess
import threading
import time

_LOCK = threading.Lock()
_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), 'server', 'data', '_crew')

# 认领超时（秒）：超时未 done 的片视为死窗卡片，可被重新认领
CLAIM_TIMEOUT = int(os.environ.get('ZF_CREW_CLAIM_TIMEOUT', '1800'))

# api_base 兜底端口：优先环境变量，否则取服务真实端口（config.PORT），避免拼出写死的 8521 误导施工窗
try:
    from config import PORT as _FALLBACK_PORT
except Exception:
    _FALLBACK_PORT = os.environ.get('ZF_CREW_PORT') or '8521'


def _ensure_dir():
    os.makedirs(_DATA_DIR, exist_ok=True)


def _board_path(crew_id):
    return os.path.join(_DATA_DIR, '%s.json' % crew_id)


def _bus_path(crew_id):
    return os.path.join(_DATA_DIR, '%s.bus.jsonl' % crew_id)


def _load(crew_id):
    p = _board_path(crew_id)
    if not os.path.exists(p):
        return None
    try:
        with open(p, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def _save(crew_id, board):
    _ensure_dir()
    p = _board_path(crew_id)
    tmp = p + '.tmp.%d' % threading.get_ident()
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(board, f, ensure_ascii=False, indent=1)
    os.replace(tmp, p)  # 原子替换


def _recover_timeout(board):
    """【v34 定稿·自动回收】回收只允许两条路：用户点击回收（crew_force_release）
    或超时自动回收（本函数）。claimed 超过 claim_timeout（缺省 1800 秒，封顶 3600）
    未 done → 回收为 pending，总线广播告知原认领窗停止施工。
    防重复：回收时置 claimed_at=None，片回到 pending 后不再进入本回收循环，
    避免每次读黑板都重复回收同一片。
    回收次数记 redispatch_count，超 3 次自动转 blocked 挂起，防止死循环回收。"""
    if board.get('closed'):
        return False   # 【v34.1 审核采纳】已关闭现场不跑回收
    try:
        timeout = int(board.get('claim_timeout') or 0)
    except Exception:
        timeout = 0
    if timeout <= 0:
        timeout = CLAIM_TIMEOUT
    timeout = min(timeout, 3600)
    now = time.time()
    board['_stale_claimed'] = []
    for s in board.get('slices', []):
        if s.get('status') != 'claimed':
            continue
        if now - float(s.get('claimed_at') or 0) <= timeout:
            continue
        prev = s.get('claimed_by') or '-'
        rc = int(s.get('redispatch_count') or 0)
        if rc >= 3:
            s['status'] = 'blocked'
            s['blocked_reason'] = '自动回收 %d 次仍未完成，挂起等人工' % rc
            board['_stale_claimed'].append(s['id'])
            _bus_append(board.get('crew_id') or '', {'from': 'system', 'type': 'blocked',
                          'text': '分片 %s 自动回收超限，挂起待人工（原认领窗 %s）' % (s['id'], prev)})
        else:
            s['status'] = 'pending'
            s['claimed_by_prev'] = prev
            s['claimed_by'] = None
            s['claimed_at'] = None
            s['redispatch_count'] = rc + 1
            board['_stale_claimed'].append(s['id'])
            _bus_append(board.get('crew_id') or '', {'from': 'system', 'type': 'force-release',
                          'text': '分片 %s 认领超时被自动回收(第%d次)（原认领窗 %s）。原认领窗请勿继续施工该片。' % (s['id'], rc + 1, prev)})
    return bool(board['_stale_claimed'])


# ---------- 对外 API ----------

def crew_create(body):
    """创建协作现场黑板。body: {crew_id, project_root, branch, slices:[{id,title,files:[..],brief}]}"""
    crew_id = str(body.get('crew_id') or '').strip()
    if not crew_id:
        return {'ok': False, 'error': 'crew_id 不能为空'}
    slices = body.get('slices')
    if slices is None:
        slices = []
    if not isinstance(slices, list):
        return {'ok': False, 'error': 'slices 必须是数组（允许为空，后续 slices-upsert 补片）'}
    # 【v33 定稿闭环·硬拦截】无策划案/计划书 md 不允许创建协作现场（服务端兜底，防前端被绕过）
    task_md = str(body.get('task_md') or '').strip()
    if not task_md:
        return {'ok': False, 'error': '缺少计划书 md（task_md）：未定稿策划案不得开工。请主对话先完成「策划师落盘 md → 用户定稿」，派单时把【策划案路径：…】的 md 随任务上下文传入。'}
    # 【v33.1 审核采纳·验真】只查非空不够：伪造路径也能绕过。此处校验 md 真实存在且内容非空（兼容相对 project_root 的路径）
    _md = task_md.replace('\\', '/')
    # 【v33.2 审核采纳·基准统一】相对路径一律以 project_root 为唯一解析基准（与前端 /api/fs/text 一致），
    # 不再回退按服务进程 cwd 解析——避免 cwd 恰为项目根时命中意外同名文件、或前后端解析基准不一致。
    if not os.path.isabs(_md):
        _root = str(body.get('project_root') or '').strip()
        _md = os.path.join(_root, _md) if _root else _md
    if not os.path.isfile(_md):
        return {'ok': False, 'error': '计划书 md 不存在（task_md=%s）：请核对【策划案路径：…】是否真实落盘，伪造/失效路径不得开工。' % task_md}
    try:
        with open(_md, 'r', encoding='utf-8', errors='ignore') as _f:
            if not _f.read().strip():
                return {'ok': False, 'error': '计划书 md 是空文件（task_md=%s）：请让策划师补全内容后再定稿开工。' % task_md}
    except OSError as _e:
        return {'ok': False, 'error': '计划书 md 无法读取（task_md=%s）：%s' % (task_md, _e)}
    with _LOCK:
        if _load(crew_id) is not None:
            return {'ok': False, 'error': 'crew_id 已存在: ' + crew_id}
        norm = []
        seen_files = {}
        for s in slices:
            sid = str(s.get('id') or ('slice-%d' % (len(norm) + 1)))
            files = [str(x) for x in (s.get('files') or [])]
            for fp in files:
                if fp in seen_files:
                    return {'ok': False, 'error': '文件出现在多个分片（创建时即拒绝）: %s 在 %s 与 %s' % (fp, seen_files[fp], sid)}
                seen_files[fp] = sid
            norm.append({'id': sid, 'title': str(s.get('title') or sid),
                         'files': files, 'brief': str(s.get('brief') or ''),
                         'model': str(s.get('model') or ''),   # 【总指挥】模型路由：本片建议用哪个模型施工
                         'depends_on': [str(x) for x in (s.get('depends_on') or [])],  # 【总指挥】依赖链：前置分片 id 列表
                         'dispatched': False,                  # 【总指挥】防重复派发标记
                         'status': 'pending', 'claimed_by': None, 'claimed_at': None, 'done_summary': None})
        # 空分片时给一片 auto 兜底片（首个 worker 用 slices-upsert 拆片替换）
        if not norm:
            norm.append({'id': 'auto', 'title': '自动拆片（由首个施工窗补全）',
                         'files': [], 'brief': '本片为占位兜底。首个施工窗开工时必须先自行拆分任务为若干分片，'
                         '用 /api/crew/slices-upsert 整体替换分片清单后再认领施工。',
                         'status': 'pending', 'claimed_by': None, 'claimed_at': None, 'done_summary': None})
        board = {'crew_id': crew_id,
                 'project_root': str(body.get('project_root') or ''),
                 'branch': str(body.get('branch') or ('site/crew/' + crew_id)),
                 'created_at': time.time(),
                 'slices': norm,
                 'windows': {}}
        # v6：认领超时可按现场配置（秒，封顶 3600，缺省用模块 CLAIM_TIMEOUT）
        try:
            _ct = int(body.get('claim_timeout') or 0)
            if _ct > 0:
                board['claim_timeout'] = min(_ct, 3600)
        except Exception:
            pass
        _save(crew_id, board)
    # 【v29】主对话派工时从任务上下文提取的 md 计划书路径，落盘到黑板（board 读取时优先返回；v33 已在入口硬校验非空）
    if task_md:
        with _LOCK:
            board = _load(crew_id)
            if board is not None:
                board['task_md'] = task_md
                _save(crew_id, board)
    return {'ok': True, 'crew_id': crew_id, 'slices': len(norm)}


def crew_slices_upsert(body):
    """整体替换分片清单（仅全部片仍 pending 且黑板未关闭时允许）。
    body: {crew_id, slices:[{id,title,files:[..],brief}], by: 来源窗标记（可选）}
    用途：auto 兜底现场由首个施工窗自行拆片后回写。"""
    crew_id = str(body.get('crew_id') or '')
    slices = body.get('slices')
    if not isinstance(slices, list) or not slices:
        return {'ok': False, 'error': 'slices 不能为空'}
    by = str(body.get('by') or '')
    with _LOCK:
        board = _load(crew_id)
        if board is None:
            return {'ok': False, 'error': '黑板不存在: ' + crew_id}
        if board.get('closed'):
            return {'ok': False, 'error': '现场已关闭，禁止改分片'}
        busy = [s['id'] for s in board.get('slices', []) if s.get('status') != 'pending']
        if busy:
            return {'ok': False, 'error': '已有分片被认领/完成，禁止整体替换: %s' % ','.join(busy)}
        norm = []
        seen_files = {}
        for s in slices:
            sid = str(s.get('id') or ('slice-%d' % (len(norm) + 1)))
            files = [str(x) for x in (s.get('files') or [])]
            if not files:
                return {'ok': False, 'error': '分片 %s 的 files 为空，禁止回写空分片（请明确锁定文件清单）' % sid}
            for fp in files:
                if fp in seen_files:
                    return {'ok': False, 'error': '文件出现在多个分片: %s 在 %s 与 %s' % (fp, seen_files[fp], sid)}
                seen_files[fp] = sid
            norm.append({'id': sid, 'title': str(s.get('title') or sid),
                         'files': files, 'brief': str(s.get('brief') or ''),
                         'model': str(s.get('model') or ''),
                         'depends_on': [str(x) for x in (s.get('depends_on') or [])],
                         'dispatched': False,
                         'status': 'pending', 'claimed_by': None, 'claimed_at': None, 'done_summary': None})
        board['slices'] = norm
        board.setdefault('meta', {})['slices_upserted_by'] = by or 'unknown'
        board['meta']['slices_upserted_at'] = time.time()
        _save(crew_id, board)
    return {'ok': True, 'crew_id': crew_id, 'slices': len(norm)}


def crew_board_get(body):
    """读黑板（施工队开工前必读）。body: {crew_id}"""
    crew_id = str(body.get('crew_id') or '')
    with _LOCK:
        board = _load(crew_id)
        if board is None:
            return {'ok': False, 'error': '黑板不存在: ' + crew_id}
        if _recover_timeout(board):
            _save(crew_id, board)
    # api_base 自描述：优先请求体透传（路由层注入请求 Host），兜底环境变量，防止施工窗盲猜端口
    api_base = str(body.get('_api_base') or '') or 'http://127.0.0.1:' + str(os.environ.get('ZF_CREW_PORT') or _FALLBACK_PORT)
    resp = {'ok': True, 'board': board, 'api_base': api_base,
            'hint': '所有 /api/crew/* 请求都发到 ' + api_base + '，严禁猜测/扫描端口'}
    # 【v29 计划书锁定】黑板存有用户任务指定的 task_md 时优先返回它（真正锁定的策划案），
    # 仅当没有 task_md 时才用路由层兜底注入的 _goal_md（private/计划书 最新一份）。
    if board.get('task_md'):
        resp['goal_md'] = str(board['task_md'])
    elif body.get('_goal_md'):
        resp['goal_md'] = str(body['_goal_md'])
    return resp


def crew_claim(body):
    """原子认领分片（认领即锁文件）。body: {crew_id, window_id, slice_id}
    校验：片未被他人认领；本窗欲认领片的文件不与其他已认领片重叠（API 侧强校验，不靠自觉）。"""
    crew_id = str(body.get('crew_id') or '')
    window_id = str(body.get('window_id') or '')
    slice_id = str(body.get('slice_id') or '')
    if not (crew_id and window_id and slice_id):
        return {'ok': False, 'error': 'crew_id/window_id/slice_id 不能为空'}
    with _LOCK:
        board = _load(crew_id)
        if board is None:
            return {'ok': False, 'error': '黑板不存在: ' + crew_id}
        if _recover_timeout(board):
            _save(crew_id, board)   # 【v34.1 审核采纳】回收必须落盘，防重复广播
        target = None
        for s in board['slices']:
            if s['id'] == slice_id:
                target = s
                break
        if target is None:
            return {'ok': False, 'error': '分片不存在: ' + slice_id}
        if slice_id == 'auto' and not target.get('files'):
            return {'ok': False, 'error': 'CREW_AUTO_NOT_SPLICED',
                    'hint': 'auto 为占位兜底片，须先用 /api/crew/slices-upsert 提交拆片清单后再认领'}
        if target['status'] == 'claimed':
            return {'ok': False, 'error': 'CREW_CLAIMED', 'claimed_by': target['claimed_by'],
                    'hint': '该分片已被 %s 认领，请认领其他 pending 分片' % target['claimed_by']}
        if target['status'] == 'done':
            return {'ok': False, 'error': '该分片已完成，无需认领'}
        if target['status'] == 'blocked':
            return {'ok': False, 'error': 'CREW_BLOCKED', 'blocked_reason': target.get('blocked_reason'),
                    'hint': '该分片已挂起等人工，请先由用户点击回收（crew_force_release）释放后再认领'}
        # 【总指挥】依赖链强校验：前置片未全部 done 则拒绝认领
        _dep_wait = [d for d in (target.get('depends_on') or [])
                     if any(x['id'] == d and x['status'] != 'done' for x in board['slices'])]
        if _dep_wait:
            return {'ok': False, 'error': 'CREW_DEP_LOCKED', 'waiting_for': _dep_wait,
                    'hint': '前置分片 %s 未完成，本片暂不可认领' % ','.join(_dep_wait)}
        # 文件重叠强校验（其他 claimed/done 片）
        for s in board['slices']:
            if s['id'] == slice_id or s['status'] == 'pending':
                continue
            overlap = set(s['files']) & set(target['files'])
            if overlap:
                return {'ok': False, 'error': 'CREW_FILE_CONFLICT',
                        'conflict_with': s['id'], 'files': sorted(overlap),
                        'hint': '认领片与 %s 的锁文件重叠，禁止认领' % s['id']}
        target['status'] = 'claimed'
        target['claimed_by'] = window_id
        target['claimed_at'] = time.time()
        board.setdefault('windows', {})[window_id] = {'joined_at': time.time(), 'slices': board['windows'].get(window_id, {}).get('slices', []) + [slice_id]}
        _save(crew_id, board)
    _bus_append(crew_id, {'from': 'system', 'type': 'claim', 'text': '%s 认领分片 %s（锁文件 %d 个）' % (window_id, slice_id, len(target['files']))})
    return {'ok': True, 'slice': target, 'locked_files': target['files']}


def crew_done(body):
    """完工回写。body: {crew_id, window_id, slice_id, summary}"""
    crew_id = str(body.get('crew_id') or '')
    window_id = str(body.get('window_id') or '')
    slice_id = str(body.get('slice_id') or '')
    with _LOCK:
        board = _load(crew_id)
        if board is None:
            return {'ok': False, 'error': '黑板不存在: ' + crew_id}
        for s in board['slices']:
            if s['id'] == slice_id:
                if s['status'] == 'done':
                    return {'ok': False, 'error': '该分片已完成'}
                if s['status'] == 'claimed' and s['claimed_by'] != window_id:
                    return {'ok': False, 'error': '分片由 %s 认领，非本窗' % s['claimed_by']}
                s['status'] = 'done'
                s['done_summary'] = str(body.get('summary') or '')
                s['done_at'] = time.time()
                s['claimed_by_prev'] = s['claimed_by']
                _save(crew_id, board)
                all_done = all(x['status'] == 'done' for x in board['slices'])
                break
        else:
            return {'ok': False, 'error': '分片不存在: ' + slice_id}
    _bus_append(crew_id, {'from': window_id, 'type': 'done', 'text': '分片 %s 完成：%s' % (slice_id, s['done_summary'][:200])})
    commit = _slice_commit(board, s, window_id)
    return {'ok': True, 'all_done': all_done, 'commit': commit}


def _slice_commit(board, slice_obj, window_id):
    """分片独立 commit 署名（v2）：只 add 认领片 files 清单内文件（禁止整仓 add），冲突可溯源。
    best-effort：git 不可用/无改动时静默跳过，不影响 done 主流程。"""
    try:
        root = board.get('project_root') or ''
        if not root or not os.path.isdir(root):
            return None
        files = [f for f in (slice_obj.get('files') or []) if os.path.exists(os.path.join(root, f))]
        if not files:
            return None
        def _git(*args):
            return subprocess.run(['git'] + list(args), cwd=root, capture_output=True,
                                  text=True, encoding='utf-8', errors='replace', timeout=30)
        r = _git('add', '--', *files)  # 定点 add，绝不整仓
        if r.returncode != 0:
            return None
        msg = '[crew:%s:%s] %s 完成分片 %s' % (board.get('crew_id'), slice_obj['id'], window_id, slice_obj['id'])
        r = _git('commit', '-m', msg, '--', *files)
        if r.returncode != 0:
            return None  # 无改动或其他 git 错误，静默
        out = (r.stdout or '').strip()
        return {'committed': True, 'message': msg, 'detail': out[:200]}
    except Exception:
        return None


def crew_bus_post(body):
    """总线发消息。body: {crew_id, window_id, text, to(可选 @窗id)}"""
    crew_id = str(body.get('crew_id') or '')
    window_id = str(body.get('window_id') or 'anon')
    text = str(body.get('text') or '').strip()
    if not text:
        return {'ok': False, 'error': 'text 不能为空'}
    _bus_append(crew_id, {'from': window_id, 'to': body.get('to'), 'type': 'msg', 'text': text[:500]})
    return {'ok': True}


def crew_bus_tail(body):
    """读总线尾巴。body: {crew_id, last_n(默认20)}"""
    crew_id = str(body.get('crew_id') or '')
    p = _bus_path(crew_id)
    if not os.path.exists(p):
        return {'ok': True, 'messages': []}
    try:
        with open(p, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except Exception as e:
        return {'ok': False, 'error': repr(e)}
    n = max(1, min(200, int(body.get('last_n') or 20)))
    out = []
    for ln in lines[-n:]:
        try:
            out.append(json.loads(ln))
        except Exception:
            pass
    return {'ok': True, 'messages': out}


def _bus_append(crew_id, obj):
    _ensure_dir()
    obj['ts'] = time.time()
    try:
        with open(_bus_path(crew_id), 'a', encoding='utf-8') as f:
            f.write(json.dumps(obj, ensure_ascii=False) + '\n')
    except Exception:
        pass


def crew_close(body):
    """收口后关闭黑板（审核合并完成后调用）。body: {crew_id}
    v6：merge 可选传入 {merged: true, detail}；合并失败时仍允许标记 merge_failed
    （黑板保留现场分支，供人工恢复），面板会显式展示失败状态。"""
    crew_id = str(body.get('crew_id') or '')
    merged = bool(body.get('merged'))
    with _LOCK:
        board = _load(crew_id)
        if board is None:
            return {'ok': False, 'error': '黑板不存在: ' + crew_id}
        if board.get('closed'):
            return {'ok': True, 'already': True}
        if not all(s['status'] == 'done' for s in board['slices']):
            return {'ok': False, 'error': 'CREW_NOT_ALL_DONE', 'hint': '仍有未完成分片，不能关闭'}
        if body.get('merge_failed'):
            board['merge_failed'] = True
            board['merge_error'] = str(body.get('merge_error') or '')[:500]
            _save(crew_id, board)
            return {'ok': False, 'error': 'CREW_MERGE_FAILED',
                    'hint': '合并失败已记录，现场分支 %s 保留，可在面板查看错误后重试' % board.get('branch')}
        board['closed'] = True
        board['closed_at'] = time.time()
        if merged:
            board['merged'] = True
            board['merge_detail'] = str(body.get('merge_detail') or '')[:500]
        _save(crew_id, board)
    _bus_append(crew_id, {'from': 'system', 'type': 'closed', 'text': '现场已收口关闭，全部分片完成并合并。'})
    return {'ok': True}


def crew_force_release(body):
    """v6：强制回收单个分片为 pending（面板「强制回收」按钮用，处理死窗占片）。
    body: {crew_id, slice_id, by: 操作来源标记}
    回收后在总线广播告知原认领窗。done 片不允许回收（要回滚请走审核员打回）。"""
    crew_id = str(body.get('crew_id') or '')
    slice_id = str(body.get('slice_id') or '')
    by = str(body.get('by') or 'panel')
    with _LOCK:
        board = _load(crew_id)
        if board is None:
            return {'ok': False, 'error': '黑板不存在: ' + crew_id}
        if board.get('closed'):
            return {'ok': False, 'error': '现场已关闭，无需回收'}
        target = None
        for s in board['slices']:
            if s['id'] == slice_id:
                target = s
                break
        if target is None:
            return {'ok': False, 'error': '分片不存在: ' + slice_id}
        if target['status'] == 'done':
            return {'ok': False, 'error': 'CREW_SLICE_DONE', 'hint': '该片已完成，不可强制回收（打回请走审核员总线打回）'}
        if target['status'] == 'pending':
            return {'ok': True, 'already': True}
        prev = target.get('claimed_by') or '-'
        target['status'] = 'pending'
        target['claimed_by_prev'] = prev
        target['claimed_by'] = None
        target['claimed_at'] = None
        _save(crew_id, board)
    _bus_append(crew_id, {'from': 'system', 'type': 'force-release',
                          'text': '分片 %s 被主对话强制回收（原认领窗 %s，操作来源 %s）。原认领窗请勿继续施工该片。' % (slice_id, prev, by)})
    return {'ok': True, 'released_from': prev}
