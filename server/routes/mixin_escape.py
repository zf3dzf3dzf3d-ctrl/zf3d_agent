# -*- coding: utf-8 -*-
"""Mixin: i密室 每局AI生成关卡 API（P1.5施工，2026-11-21，策划案-i密室AI生成关卡 v2.1 落地）

定位：密室玩法后端。每局由 escape_solver 程序生成骨架+槽位模板谜题链（突破师定式1/3），
服务端持答案、下发前裁剪呈现层（反驳师③防泄底），判定全在服务端。
Solver 真源：server/escape_solver.py（validate_level / generate_level）。

接口（本阶段）：
  GET  /api/escape/new?difficulty=1..3   -> 生成一局：下发无答案呈现层 + run_id
  POST /api/escape/action                -> {run_id, action:map|move|pickup|solve, ...} 服务端判定
数据落盘：private/escape/<run_id>.json（HTTP 不可直读）
"""
import os
import json
import time
import copy
import threading
from routes._shared import *  # noqa: F401,F403
from routes.mixin_base import MixinBase
from escape_solver import validate_level, generate_level

from util_log import get_logger

log = get_logger('escape')
_ESCAPE_ROOT = os.path.normpath(os.path.join(BASE_DIR, 'private', 'escape'))
_escape_lock = threading.Lock()
_runs = {}  # run_id -> 内存态（含答案），落盘副本双写

_ANSWER_KEYS = ('answer', 'answer_keywords')


def _strip_answers(level):
    """下发前裁剪呈现层：删全部答案字段（反驳师③防泄底硬缺口）。"""
    pub = copy.deepcopy(level)
    for p in pub.get('puzzles') or []:
        for k in _ANSWER_KEYS:
            p.pop(k, None)
    return pub


class MixinEscape(MixinBase):

    # ---------- GET /api/escape/new ----------
    def _handle_escape_new(self, qs):
        try:
            difficulty = 1
            try:
                difficulty = max(1, min(3, int((qs.get('difficulty') or ['1'])[0])))
            except Exception:
                pass
            level = generate_level(difficulty=difficulty)
            ok, errs = validate_level(level)
            if not ok:
                self._send_json({'ok': False, 'err': 'generated level invalid: %s' % errs}, 500)
                return
            rid = 'run-%d' % int(time.time() * 1000)
            start = list(level['rooms'][level['entrance_room']]['pos'])
            run = {'run_id': rid, 'level': level, 'state': {
                'pos': start, 'inventory': [], 'solved': [],
                'moves': 0, 'finished': False, 'started': time.time()}}
            with _escape_lock:
                _runs[rid] = run
                os.makedirs(_ESCAPE_ROOT, exist_ok=True)
                with open(os.path.join(_ESCAPE_ROOT, rid + '.json'), 'w', encoding='utf-8') as f:
                    json.dump({'run_id': rid, 'level': level, 'state': run['state']},
                              f, ensure_ascii=False)
            self._send_json({'ok': True, 'run_id': rid,
                             'level': _strip_answers(level), 'state': run['state']})
        except Exception as e:
            log.info('[GET /api/escape/new] 500: %s' % e)
            self._send_json({'ok': False, 'err': str(e)}, 500)

    # ---------- POST /api/escape/action ----------
    def _handle_escape_action(self, body):
        try:
            rid = str(body.get('run_id') or '')
            act = str(body.get('action') or '')
            with _escape_lock:
                run = _runs.get(rid)
            if not run:
                self._send_json({'ok': False, 'err': 'run not found'}, 404)
                return
            level, st = run['level'], run['state']
            if st.get('finished'):
                self._send_json({'ok': False, 'err': 'run finished'}, 400)
                return
            out = {'ok': True, 'run_id': rid}
            if act == 'map':
                out['state'] = st
            elif act == 'move':
                step = {'up': (0, -2), 'down': (0, 2), 'left': (-2, 0), 'right': (2, 0)}.get(
                    str(body.get('dir') or ''))
                if not step:
                    self._send_json({'ok': False, 'err': 'dir must be up|down|left|right'}, 400)
                    return
                grid = level['grid']
                ny, nx = st['pos'][0] + step[0], st['pos'][1] + step[1]
                if not (0 <= ny < len(grid) and 0 <= nx < len(grid[0])) or grid[ny][nx] == '#':
                    out.update({'moved': False, 'reason': 'wall'})
                else:
                    st['pos'] = [ny, nx]
                    st['moves'] += 1
                    room = _room_at(level, ny, nx)
                    out.update({'moved': True, 'state': st,
                                'room': {'id': room[0], 'name': room[1]['name'],
                                         'desc': room[1]['desc']} if room else None})
            elif act == 'pickup':
                got = []
                for oid, o in (level.get('objects') or {}).items():
                    if list(o['pos']) == list(st['pos']) and oid not in st['inventory']:
                        st['inventory'].append(oid)
                        got.append({'id': oid, 'name': o['name']})
                out.update({'picked': got, 'state': st})
            elif act == 'solve':
                pid = str(body.get('puzzle_id') or '')
                p = next((x for x in (level.get('puzzles') or []) if x.get('id') == pid), None)
                if not p:
                    self._send_json({'ok': False, 'err': 'puzzle not found'}, 404)
                    return
                room = _room_at(level, st['pos'][0], st['pos'][1])
                if not room or room[0] != p.get('room'):
                    out.update({'solved': False, 'reason': 'not in puzzle room',
                                'hint': '请先移动到谜题所在房间：%s' % ((level.get('rooms') or {}).get(p.get('room'), {}).get('name', p.get('room'))),
                                'puzzle_room_pos': list((level.get('rooms') or {}).get(p.get('room'), {}).get('pos', []))})
                elif pid in st['solved']:
                    out.update({'solved': True, 'already': True, 'state': st})
                elif _check_answer(p, body.get('answer'), st):
                    st['solved'].append(pid)
                    out.update({'solved': True, 'state': st})
                else:
                    out.update({'solved': False, 'reason': 'wrong answer',
                                'type_hint': {'code': '这是数字密码题——3位数字，多试几种组合或先找线索',
                                    'sequence': '这是顺序题——按颜色顺序点击，线索藏在房间物品里',
                                    'item': '这是道具题——需要先拾取对应道具并在正确房间使用',
                                    'riddle': '这是谜语题——答一个关键词即可，想想谜面指什么'}.get(p.get('type'), '答案不对，再想想')})
                if _exit_open(level, st):
                    st['finished'] = True
                    out['finished'] = True
                    out['elapsed'] = round(time.time() - st['started'], 1)
                out['state'] = st
            else:
                self._send_json({'ok': False, 'err': 'action must be map|move|pickup|solve'}, 400)
                return
            self._send_json(out)
        except Exception as e:
            log.info('[POST /api/escape/action] 500: %s' % e)
            self._send_json({'ok': False, 'err': str(e)}, 500)


def _room_at(level, y, x):
    for rid, r in (level.get('rooms') or {}).items():
        if list(r['pos']) == [y, x]:
            return (rid, r)
    return None


def _check_answer(p, ans, st):
    t = p.get('type')
    if t == 'code':
        return str(ans).strip() == str(p.get('answer')).strip()
    if t == 'sequence':
        return list(ans or []) == list(p.get('answer') or [])
    if t == 'item':
        return ans == p.get('answer') and p.get('requires') in st['inventory']
    if t == 'riddle':
        a = str(ans or '').strip().lower()
        return any(a == w.lower() or w.lower() in a
                   for w in (p.get('answer_keywords') or []))
    return False


def _exit_open(level, st):
    """出口开启：出口房内全部谜题已解。"""
    ex = level.get('exit_room')
    return all(p.get('id') in st['solved']
               for p in (level.get('puzzles') or []) if p.get('room') == ex)
