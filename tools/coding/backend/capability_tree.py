#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
capability_tree - 能力涌现系统工具骨架（P0）
建 3 张表（capability / capability_link / emergence_event）落 private/db/zf3d_canvas.db。
最简 action：seed / add / evidence / link / query / render。
P0 不含侦测器、不含编辑 UI；只证明"能种树、加节点、写库、读回、产 json"。
设计准绳：docs/能力涌现系统-策划案.md v2.7。
"""
import os
import re
import json
import time
import sqlite3
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'capability_tree'


def _db_path(ctx):
    return os.path.join(ctx.base_dir, 'private', 'db', 'zf3d_canvas.db')


def _conn(ctx):
    p = _db_path(ctx)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    c = sqlite3.connect(p, timeout=15)
    c.row_factory = sqlite3.Row
    return c


DDL = """
CREATE TABLE IF NOT EXISTS capability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_type TEXT NOT NULL DEFAULT 'project',
    subject_id   TEXT NOT NULL DEFAULT '',
    parent_id    INTEGER,
    text         TEXT NOT NULL,
    path         TEXT NOT NULL DEFAULT '',
    depth        INTEGER NOT NULL DEFAULT 0,
    clarity      REAL NOT NULL DEFAULT 0.0,
    status       TEXT NOT NULL DEFAULT 'seed',
    icon         TEXT NOT NULL DEFAULT '',
    kind         TEXT NOT NULL DEFAULT 'capability',
    binds        TEXT NOT NULL DEFAULT '',
    x            REAL,
    y            REAL,
    created_at   REAL NOT NULL,
    updated_at   REAL NOT NULL,
    FOREIGN KEY(parent_id) REFERENCES capability(id)
);
CREATE INDEX IF NOT EXISTS idx_cap_subject ON capability(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_cap_parent  ON capability(parent_id);

CREATE TABLE IF NOT EXISTS capability_link (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    src INTEGER NOT NULL,
    dst INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'depend',
    created_at REAL NOT NULL,
    FOREIGN KEY(src) REFERENCES capability(id),
    FOREIGN KEY(dst) REFERENCES capability(id)
);

CREATE TABLE IF NOT EXISTS emergence_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cap_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    delta_clarity REAL NOT NULL DEFAULT 0.0,
    detail TEXT NOT NULL DEFAULT '',
    notified INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL,
    FOREIGN KEY(cap_id) REFERENCES capability(id)
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);
"""


def _now():
    return time.time()


def _init(ctx):
    with _conn(ctx) as c:
        c.executescript(DDL)
        # P1 幂等迁移：旧库补列
        for ddl in ('ALTER TABLE capability ADD COLUMN x REAL',
                    'ALTER TABLE capability ADD COLUMN y REAL',
                    'ALTER TABLE emergence_event ADD COLUMN notified INTEGER NOT NULL DEFAULT 0'):
            try:
                c.execute(ddl)
            except sqlite3.OperationalError:
                pass
        c.commit()


def _sub_filter(body):
    st = (body.get('subject_type') or 'project')
    sid = body.get('subject_id') or ''
    return st, sid


def _get_setting(c, key, default=''):
    r = c.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    return r['value'] if r else default


def _set_setting(c, key, value):
    c.execute('INSERT INTO settings(key,value) VALUES(?,?)'
              ' ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, str(value)))


def _make_path(c, parent_id, text):
    if not parent_id:
        return text
    pr = c.execute('SELECT path FROM capability WHERE id=?', (parent_id,)).fetchone()
    pp = (pr['path'] if pr and pr['path'] else '')
    return (pp + '/' if pp else '') + text


def _repath_subtree(c, node_id, new_path):
    """modify 移动子树后级联重算后代 path/depth。"""
    c.execute('UPDATE capability SET path=? WHERE id=?', (new_path, node_id))
    depth = new_path.count('/')
    kids = c.execute('SELECT id,text FROM capability WHERE parent_id=?', (node_id,)).fetchall()
    for k in kids:
        child_path = new_path + '/' + k['text']
        _repath_subtree(c, k['id'], child_path)


# ===== 方案A：统一为「一棵全局涌现树」 =====
# 涌现侦测器建候选不再按对话 chat_id 分树（旧行为导致候选与画布割裂、画布永远看不到候选）。
# 全部候选统一归到固定 subject（project / _emergence），并落盘到画布默认加载的同一个 maps 文件，
# 这样侦测建候选、confirm、reject 后画布经 liveTick(2s) 自动热刷新。
EMERGE_SUBJECT_TYPE = 'project'
EMERGE_SUBJECT_ID = '_emergence'


def _render_subject(c, ctx, st, sid, fname):
    """把指定 subject 的 DB 树导出为 maps/<fname>.emergence.tree.json，返回 (文件名, 节点数)。
    render action / _emergence 侦测 / confirm / reject 共用此落盘逻辑（单一真源）。"""
    rows = c.execute(
        'SELECT id,parent_id,text,path,depth,clarity,status,icon,kind,x,y'
        ' FROM capability WHERE subject_type=? AND subject_id=? ORDER BY id',
        (st, sid)).fetchall()
    nodes = [dict(r) for r in rows]
    by_id = {n['id']: dict(n, children=[]) for n in nodes}
    roots = []
    for n in nodes:
        item = by_id[n['id']]
        pid = n['parent_id']
        if pid and pid in by_id:
            by_id[pid]['children'].append(item)
        else:
            roots.append(item)
    links = [dict(r) for r in c.execute(
        'SELECT id,src,dst,kind FROM capability_link').fetchall()]
    tree = {
        'meta': {'title': '涌现能力树', 'subject_type': st, 'subject_id': sid,
                 'created': time.strftime('%Y-%m-%d')},
        'roots': roots,
        'links': links,
    }
    outdir = os.path.join(ctx.base_dir, 'public', 'canvas', '进化树', 'maps')
    os.makedirs(outdir, exist_ok=True)
    safe = re.sub(r'[^\w\-]', '_', fname) + '.emergence.tree.json'
    with open(os.path.join(outdir, safe), 'w', encoding='utf-8') as f:
        json.dump(tree, f, ensure_ascii=False, indent=2)
    return safe, len(nodes)


def _render_emerge(c, ctx):
    """侦测/确认/驳回后，把全局涌现树落盘到画布默认文件（EMERGE_SUBJECT_ID）。"""
    try:
        return _render_subject(c, ctx, EMERGE_SUBJECT_TYPE, EMERGE_SUBJECT_ID, EMERGE_SUBJECT_ID)
    except Exception:
        return None


def handle(body, ctx):
    action = (body.get('action') or '').strip()
    if not action:
        ctx.send_json({'ok': False, 'error': '缺少 action'}); return
    _init(ctx)
    st, sid = _sub_filter(body)
    c = _conn(ctx)
    try:
        if action == 'seed':
            text = (body.get('text') or '').strip()
            if not text:
                ctx.send_json({'ok': False, 'error': 'seed 需要 text'}); return
            clarity = float(body.get('clarity', 0.5))
            t = _now()
            cur = c.execute(
                'INSERT INTO capability(subject_type,subject_id,parent_id,text,path,depth,clarity,status,icon,kind,binds,created_at,updated_at)'
                ' VALUES(?,?,NULL,?,?,0,?,?,?,?,?,?,?)',
                (st, sid, text, text, clarity, body.get('status', 'seed'),
                 body.get('icon', ''), body.get('kind', 'capability'),
                 body.get('binds', ''), t, t))
            c.commit()
            cid = cur.lastrowid
            c.execute('INSERT INTO emergence_event(cap_id,kind,delta_clarity,detail,created_at) VALUES(?,?,?,?,?)',
                      (cid, 'seed', clarity, '种子播下', t))
            c.commit()
            ctx.send_json({'ok': True, 'action': 'seed', 'id': cid, 'path': text})
            return

        if action == 'add':
            parent_id = body.get('parent_id')
            text = (body.get('text') or '').strip()
            if not text:
                ctx.send_json({'ok': False, 'error': 'add 需要 text'}); return
            pr = c.execute('SELECT path,depth FROM capability WHERE id=?', (parent_id,)).fetchone() if parent_id else None
            depth = (pr['depth'] + 1) if pr else 0
            path = _make_path(c, parent_id, text)
            clarity = float(body.get('clarity', 0.2))
            t = _now()
            cur = c.execute(
                'INSERT INTO capability(subject_type,subject_id,parent_id,text,path,depth,clarity,status,icon,kind,binds,created_at,updated_at)'
                ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (st, sid, parent_id, text, path, depth, clarity,
                 body.get('status', 'sprout'), body.get('icon', ''),
                 body.get('kind', 'capability'), body.get('binds', ''), t, t))
            c.commit()
            cid = cur.lastrowid
            c.execute('INSERT INTO emergence_event(cap_id,kind,delta_clarity,detail,created_at) VALUES(?,?,?,?,?)',
                      (cid, 'add', clarity, '发芽', t))
            c.commit()
            ctx.send_json({'ok': True, 'action': 'add', 'id': cid, 'path': path, 'depth': depth})
            return

        if action == 'evidence':
            cid = body.get('id')
            if not cid:
                ctx.send_json({'ok': False, 'error': 'evidence 需要 id'}); return
            delta = float(body.get('delta_clarity', body.get('clarity_add', 0.1)))
            detail = body.get('detail', '')
            r = c.execute('SELECT clarity FROM capability WHERE id=?', (cid,)).fetchone()
            if not r:
                ctx.send_json({'ok': False, 'error': '节点不存在'}); return
            new_cl = max(0.0, min(1.0, r['clarity'] + delta))
            t = _now()
            c.execute('UPDATE capability SET clarity=?,updated_at=? WHERE id=?', (new_cl, t, cid))
            c.execute('INSERT INTO emergence_event(cap_id,kind,delta_clarity,detail,created_at) VALUES(?,?,?,?,?)',
                      (cid, 'evidence', delta, detail, t))
            c.commit()
            ctx.send_json({'ok': True, 'action': 'evidence', 'id': cid, 'clarity': new_cl})
            return

        if action == 'link':
            src = body.get('src'); dst = body.get('dst')
            if not src or not dst:
                ctx.send_json({'ok': False, 'error': 'link 需要 src/dst'}); return
            kind = body.get('kind', 'depend')
            t = _now()
            cur = c.execute('INSERT INTO capability_link(src,dst,kind,created_at) VALUES(?,?,?,?)',
                            (src, dst, kind, t))
            c.commit()
            ctx.send_json({'ok': True, 'action': 'link', 'id': cur.lastrowid})
            return

        if action == 'modify':
            cid = body.get('id')
            if not cid:
                ctx.send_json({'ok': False, 'error': 'modify 需要 id'}); return
            upd = {}
            if body.get('parent_id') is not None:
                upd['parent_id'] = body.get('parent_id')
            if body.get('text'):
                upd['text'] = body.get('text')
            if body.get('clarity') is not None:
                upd['clarity'] = float(body.get('clarity'))
            if body.get('status'):
                upd['status'] = body.get('status')
            if not upd:
                ctx.send_json({'ok': False, 'error': 'modify 无可改字段'}); return
            upd['updated_at'] = _now()
            cols = ','.join('%s=?' % k for k in upd)
            c.execute('UPDATE capability SET %s WHERE id=?' % cols,
                      tuple(upd.values()) + (cid,))
            # 改了 parent 或 text：重算本节点及子树 path/depth
            r = c.execute('SELECT text,parent_id FROM capability WHERE id=?', (cid,)).fetchone()
            new_path = _make_path(c, r['parent_id'], r['text'])
            _repath_subtree(c, cid, new_path)
            c.commit()
            ctx.send_json({'ok': True, 'action': 'modify', 'id': cid, 'path': new_path})
            return

        if action == 'move':
            # 拖拽回写：positions=[{id,x,y,parent_id?}] 单事务批量落库（P1-1）
            items = body.get('positions') or []
            if not items:
                ctx.send_json({'ok': False, 'error': 'move 需要 positions'}); return
            t = _now()
            repathed = []
            for it in items:
                iid = it.get('id')
                if not iid:
                    continue
                c.execute('UPDATE capability SET x=?,y=?,updated_at=? WHERE id=?',
                          (float(it.get('x', 0)), float(it.get('y', 0)), t, iid))
                newp = it.get('parent_id')
                if newp is not None:
                    old = c.execute('SELECT parent_id FROM capability WHERE id=?', (iid,)).fetchone()
                    if old and old['parent_id'] != newp:
                        # 防成环：新父不能是自己或自己的后代
                        anc, cur, ok = set(), newp, True
                        while cur:
                            if cur == iid or cur in anc:
                                ok = False; break
                            anc.add(cur)
                            rr = c.execute('SELECT parent_id FROM capability WHERE id=?', (cur,)).fetchone()
                            cur = rr['parent_id'] if rr else None
                        if ok:
                            c.execute('UPDATE capability SET parent_id=? WHERE id=?', (newp, iid))
                            rr = c.execute('SELECT text FROM capability WHERE id=?', (iid,)).fetchone()
                            np = _make_path(c, newp, rr['text'])
                            _repath_subtree(c, iid, np)
                            repathed.append({'id': iid, 'path': np})
            c.commit()
            ctx.send_json({'ok': True, 'action': 'move', 'updated': len(items), 'repathed': repathed})
            return

        if action == 'context':
            # 加号注入：返回该节点的祖先链 + 兄弟 + 子节点（P1-2，供 AI 防跑偏）
            cid = body.get('id')
            if not cid:
                ctx.send_json({'ok': False, 'error': 'context 需要 id'}); return
            r = c.execute('SELECT id,parent_id,text,path,depth,clarity,status FROM capability WHERE id=?', (cid,)).fetchone()
            if not r:
                ctx.send_json({'ok': False, 'error': '节点不存在'}); return
            ancestors, cur = [], r['parent_id']
            while cur:
                pr = c.execute('SELECT id,text,path,depth,clarity,parent_id FROM capability WHERE id=?', (cur,)).fetchone()
                if not pr: break
                ancestors.insert(0, {k: pr[k] for k in ('id', 'text', 'path', 'depth', 'clarity')}); cur = pr['parent_id']
            pid = r['parent_id']
            if pid:
                sib = c.execute('SELECT id,text,clarity,status FROM capability WHERE parent_id=? AND id!=? ORDER BY id', (pid, cid)).fetchall()
            else:
                sib = c.execute('SELECT id,text,clarity,status FROM capability WHERE parent_id IS NULL AND id!=? ORDER BY id', (cid,)).fetchall()
            kids = c.execute('SELECT id,text,clarity,status FROM capability WHERE parent_id=? ORDER BY id', (cid,)).fetchall()
            ctx.send_json({'ok': True, 'action': 'context', 'self': dict(r),
                           'ancestors': [dict(a) for a in ancestors],
                           'siblings': [dict(s) for s in sib], 'children': [dict(k) for k in kids]})
            return

        if action == 'emerge':
            # 侦测入库（P1-4）：开关 off 直接跳过；候选写 emergence_event(notified=0)
            sw = _get_setting(c, 'emerge_enabled', 'on')
            if sw == 'off':
                ctx.send_json({'ok': True, 'action': 'emerge', 'skipped': 'switch_off'}); return
            detail = body.get('detail', '')
            delta = float(body.get('delta_clarity', 0.05))
            cid = body.get('cap_id')
            t = _now()
            c.execute('INSERT INTO emergence_event(cap_id,kind,delta_clarity,detail,notified,created_at) VALUES(?,?,?,?,0,?)',
                      (cid, 'emerge', delta, detail, t))
            c.commit()
            pending = c.execute('SELECT COUNT(*) n FROM emergence_event WHERE kind=\'emerge\' AND notified=0').fetchone()['n']
            ctx.send_json({'ok': True, 'action': 'emerge', 'pending': int(pending)})
            return

        if action == 'emerge_pending':
            rows = c.execute(
                'SELECT e.id,e.cap_id,e.delta_clarity,e.detail,e.created_at,c.text,c.path,c.clarity '
                'FROM emergence_event e LEFT JOIN capability c ON c.id=e.cap_id '
                'WHERE e.kind=\'emerge\' AND e.notified=0 ORDER BY e.id').fetchall()
            ctx.send_json({'ok': True, 'action': 'emerge_pending', 'count': len(rows),
                           'items': [dict(r) for r in rows]})
            return

        if action == 'confirm':
            # 确认候选：采纳则给节点加 clarity（可选新建），标记 notified=1（P1-4）
            eid = body.get('event_id')
            if not eid:
                ctx.send_json({'ok': False, 'error': 'confirm 需要 event_id'}); return
            e = c.execute('SELECT * FROM emergence_event WHERE id=?', (eid,)).fetchone()
            if not e:
                ctx.send_json({'ok': False, 'error': '事件不存在'}); return
            cid = body.get('cap_id') or e['cap_id']
            new_cl = None
            if cid:
                r = c.execute('SELECT clarity FROM capability WHERE id=?', (cid,)).fetchone()
                if r:
                    new_cl = max(0.0, min(1.0, r['clarity'] + float(e['delta_clarity'] or 0.05)))
                    c.execute('UPDATE capability SET clarity=?,updated_at=? WHERE id=?', (new_cl, _now(), cid))
            c.execute('UPDATE emergence_event SET notified=1 WHERE id=?', (eid,))
            c.commit()
            _render_emerge(c, ctx)   # 方案A：确认即落盘，画布经 liveTick 自动刷新
            ctx.send_json({'ok': True, 'action': 'confirm', 'event_id': eid, 'cap_id': cid, 'clarity': new_cl})
            return

        if action == 'reject':
            eid = body.get('event_id')
            if not eid:
                ctx.send_json({'ok': False, 'error': 'reject 需要 event_id'}); return
            c.execute('UPDATE emergence_event SET notified=1 WHERE id=?', (eid,))
            c.commit()
            _render_emerge(c, ctx)   # 方案A：驳回即落盘（节点已删，画布同步移除）
            ctx.send_json({'ok': True, 'action': 'reject', 'event_id': eid})
            return

        if action == 'switch':
            # 侦测开关（缝3红线：与 confirm 同批）：state=on/off，或 toggle
            st = body.get('state')
            if st == 'toggle':
                st = 'off' if _get_setting(c, 'emerge_enabled', 'on') == 'on' else 'on'
            if st not in ('on', 'off'):
                ctx.send_json({'ok': False, 'error': 'switch 需要 state=on/off/toggle'}); return
            _set_setting(c, 'emerge_enabled', st)
            c.commit()
            ctx.send_json({'ok': True, 'action': 'switch', 'emerge_enabled': st})
            return

        if action == 'query':
            rows = c.execute(
                'SELECT id,parent_id,text,path,depth,clarity,status,icon,kind,binds,subject_type,subject_id,x,y'
                ' FROM capability WHERE subject_type=? AND subject_id=? ORDER BY id',
                (st, sid)).fetchall()
            nodes = [dict(r) for r in rows]
            links = [dict(r) for r in c.execute(
                'SELECT id,src,dst,kind FROM capability_link').fetchall()]
            evs = [dict(r) for r in c.execute(
                'SELECT id,cap_id,kind,delta_clarity,detail,created_at FROM emergence_event ORDER BY id DESC LIMIT 50').fetchall()]
            ctx.send_json({'ok': True, 'action': 'query', 'count': len(nodes),
                           'nodes': nodes, 'links': links, 'events': evs})
            return

        if action == 'render':
            # 产出 emergence.tree.json（嵌套树 + 顶层 links[]），落 public/canvas/进化树/maps/
            rows = c.execute(
                'SELECT id,parent_id,text,path,depth,clarity,status,icon,kind,x,y'
                ' FROM capability WHERE subject_type=? AND subject_id=? ORDER BY id',
                (st, sid)).fetchall()
            nodes = [dict(r) for r in rows]
            by_id = {n['id']: dict(n, children=[]) for n in nodes}
            roots = []
            for n in nodes:
                item = by_id[n['id']]
                pid = n['parent_id']
                if pid and pid in by_id:
                    by_id[pid]['children'].append(item)
                else:
                    roots.append(item)
            links = [dict(r) for r in c.execute(
                'SELECT id,src,dst,kind FROM capability_link').fetchall()]
            tree = {
                'meta': {'title': body.get('title') or ('进化树-' + (sid or st)),
                         'subject_type': st, 'subject_id': sid,
                         'created': time.strftime('%Y-%m-%d')},
                'roots': roots,
                'links': links,
            }
            outdir = os.path.join(ctx.base_dir, 'public', 'canvas', '进化树', 'maps')
            os.makedirs(outdir, exist_ok=True)
            fname = re.sub(r'[^\w\-]', '_', (body.get('file') or (sid or 'default'))) + '.emergence.tree.json'
            fp = os.path.join(outdir, fname)
            with open(fp, 'w', encoding='utf-8') as f:
                json.dump(tree, f, ensure_ascii=False, indent=2)
            ctx.send_json({'ok': True, 'action': 'render', 'file': fname,
                           'url': '/canvas/进化树/viewer.html?file=' + fname,
                           'node_count': len(nodes), 'path': fp})
            return

        if action == 'unlink':
            # 删除关系边：按 link id，或按 src+dst（P3-1 连线管理配套）
            lid = body.get('link_id')
            if lid:
                cur = c.execute('DELETE FROM capability_link WHERE id=?', (lid,))
                c.commit()
                ctx.send_json({'ok': True, 'action': 'unlink', 'deleted': cur.rowcount}); return
            src = body.get('src'); dst = body.get('dst')
            if not src or not dst:
                ctx.send_json({'ok': False, 'error': 'unlink 需要 link_id 或 src/dst'}); return
            kind = body.get('kind')
            if kind:
                cur = c.execute('DELETE FROM capability_link WHERE src=? AND dst=? AND kind=?', (src, dst, kind))
            else:
                cur = c.execute('DELETE FROM capability_link WHERE src=? AND dst=?', (src, dst))
            c.commit()
            ctx.send_json({'ok': True, 'action': 'unlink', 'deleted': cur.rowcount})
            return

        if action == 'replay':
            # 生长回放数据（P4）：按 id 升序返回本 subject 的涌现事件流 + 当前节点属性
            rows = c.execute(
                'SELECT e.id,e.cap_id,e.kind,e.delta_clarity,e.detail,e.created_at,'
                ' c.text,c.path,c.parent_id,c.depth,c.status '
                'FROM emergence_event e LEFT JOIN capability c ON c.id=e.cap_id '
                'WHERE c.subject_type=? AND c.subject_id=? ORDER BY e.id ASC',
                (st, sid)).fetchall()
            events = [dict(r) for r in rows]
            nodes = [dict(r) for r in c.execute(
                'SELECT id,parent_id,text,path,depth,clarity,status,x,y'
                ' FROM capability WHERE subject_type=? AND subject_id=? ORDER BY id',
                (st, sid)).fetchall()]
            ctx.send_json({'ok': True, 'action': 'replay', 'count': len(events),
                           'events': events, 'nodes': nodes})
            return

        if action == 'reset':
            c.execute('DELETE FROM capability'); c.execute('DELETE FROM capability_link')
            c.execute('DELETE FROM emergence_event'); c.commit()
            ctx.send_json({'ok': True, 'action': 'reset'})
            return

        ctx.send_json({'ok': False, 'error': '未知 action: ' + action})
    except Exception as e:
        ctx.send_json({'ok': False, 'error': str(e)})
    finally:
        c.close()
