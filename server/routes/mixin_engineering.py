# -*- coding: utf-8 -*-
"""Mixin: i工程（节点化任务流程画布）API — S0 骨架 v1.0

路由（经 api_dispatch_get / api_dispatch_post 分派）：
  GET  /api/engineering/graph            全量图快照：nodes + edges + ext（前端一次拉全）
  GET  /api/engineering/boards           任务板列表
  POST /api/engineering/node/upsert      节点语义扩展（title/body/status/group_id/board_id，软删）
  POST /api/engineering/node/status      只改状态（状态机：todo/doing/pass/fail）
  POST /api/engineering/edge/upsert      连线（kind: normal/pass/verify，pass=验证回流箭头）
  POST /api/engineering/edge/delete      删连线
  POST /api/engineering/summary          总结师：把 summary 回填到节点 ext

设计要点（策划案 v3.0 A2 旁挂路线）：
  - 两张旁挂表 canvas_node_ext / canvas_edge 落 roles 域（与 canvas_nodes 同库 join 零跨域）；
  - 宿主活表 canvas_nodes 不动（零侵入），i工程语义全在旁挂表；
  - ext.deleted=1 软删 + 检索接口可查回收站（节点永不丢）；
  - 状态写入用 get_db()（ATTACH 全库，SQL 直接表名），复用既有 WAL/线程本地连接。
"""
from routes._shared import *
from routes.mixin_base import MixinBase  # 修复:MixinEngineering 继承 MixinBase 但未导入导致 NameError
import json as _json
import uuid as _uuid

# 合法状态机（策划案：用户可设节点状态）
ENG_NODE_STATUS = ('todo', 'doing', 'pass', 'fail')
ENG_EDGE_KIND = ('normal', 'pass', 'verify')


def _parse_visible_in(s):
    """P3 规则表：visible_in JSON 字符串 → dict（容错，坏数据返回 {}）"""
    try:
        o = _json.loads(s) if s else {}
        return o if isinstance(o, dict) else {}
    except Exception:
        return {}


def _eng_body(self):
    try:
        raw = self._read_body()
        if isinstance(raw, bytes):
            raw = raw.decode('utf-8', errors='replace')
        if isinstance(raw, str):
            try:
                return _json.loads(raw or '{}')
            except Exception:
                return {}
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


def _eng_int(v, d=0):
    try:
        return int(v)
    except Exception:
        return d


def _eng_loopback(self):
    """安全加固：写操作仅允许本机（127.0.0.1/::1）调用，拒绝局域网任意写删。"""
    try:
        addr = self.client_address[0] if self.client_address else ''
    except Exception:
        addr = ''
    if addr in ('127.0.0.1', '::1', 'localhost'):
        return True
    self._send_json({'ok': False, 'err': 'forbidden: local only'}, 403)
    return False


def _eng_ensure_src_col(cur):
    """v1.9：canvas_node_ext 懒加 src 列（eng=由 i工程 创建的隔离标记）。只加列不改宿主表。"""
    try:
        cur.execute('SELECT COUNT(*) FROM pragma_table_info("canvas_node_ext") WHERE name="src"')
        if cur.fetchone()[0] < 1:
            cur.execute("ALTER TABLE canvas_node_ext ADD COLUMN src TEXT DEFAULT ''")
    except Exception:
        pass


def _eng_ensure_org_cols(cur):
    """i整理模式2.0：懒加 title_ext（整理层自定义标题，双轨）与 closed（可见性指挥台关闭态）。
    前端 app-minimap-organize.js 已在写这两个字段，此处在后端落库侧对齐（不新增表）。"""
    try:
        cur.execute('SELECT COUNT(*) FROM pragma_table_info("canvas_node_ext") WHERE name="title_ext"')
        if cur.fetchone()[0] < 1:
            cur.execute("ALTER TABLE canvas_node_ext ADD COLUMN title_ext TEXT DEFAULT ''")
        cur.execute('SELECT COUNT(*) FROM pragma_table_info("canvas_node_ext") WHERE name="closed"')
        if cur.fetchone()[0] < 1:
            cur.execute("ALTER TABLE canvas_node_ext ADD COLUMN closed INTEGER DEFAULT 0")
        cur.execute('SELECT COUNT(*) FROM pragma_table_info("canvas_node_ext") WHERE name="visible_in"')
        if cur.fetchone()[0] < 1:
            cur.execute("ALTER TABLE canvas_node_ext ADD COLUMN visible_in TEXT DEFAULT ''")
        cur.execute('SELECT COUNT(*) FROM pragma_table_info("canvas_node_ext") WHERE name="done"')
        if cur.fetchone()[0] < 1:
            cur.execute('ALTER TABLE canvas_node_ext ADD COLUMN done INTEGER DEFAULT 0')
    except Exception:
        pass


def _eng_ext_upsert(cur, nid, fields, now):
    """P2 修复(F3)：canvas_node_ext 语义 upsert 单一入口。
    fields: dict，键取 body/group_id/board_id/summary/deleted/status/src（缺省键=不改该字段）。
    status 走 COALESCE(NULLIF) 空串保持原值；其余 COALESCE 保持原值；deleted None=不改。
    v1.9.2 修复：src 并入本入口——旧实现先 UPDATE 再 upsert，新建节点 ext 行不存在时
    UPDATE 影响 0 行、INSERT 又不带 src，导致 src='eng' 丢失、前端过滤后节点永远不可见。
    """
    status = fields.get('status', '')
    deleted = fields.get('deleted')
    src = fields.get('src')  # None=不改；''=清空也合法（显式传入）
    title_ext = fields.get('title_ext')  # i整理：None=不改；''=清空恢复原题
    closed = fields.get('closed')        # i整理：None=不改；0/1 显式切换
    visible_in = fields.get('visible_in')  # i整理 P3 规则表：None=不改；''=清空；JSON 字符串 {"normal":b,"focus":b}
    done = fields.get('done')            # i整理：None=不改；0/1 用户手写「已完成/未完成」标记
    # 懒建 src 列必须先于 INSERT（INSERT 引用 src 列）
    _eng_ensure_src_col(cur)
    _eng_ensure_org_cols(cur)
    cur.execute('''
        INSERT INTO canvas_node_ext
            (node_id, status, body, group_id, board_id, summary, deleted, updated_at, src,
             title_ext, closed, visible_in, done)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(node_id) DO UPDATE SET
            status     = COALESCE(NULLIF(?, ''), status),
            body       = COALESCE(?, body),
            group_id   = COALESCE(?, group_id),
            board_id   = COALESCE(?, board_id),
            summary    = COALESCE(?, summary),
            deleted    = COALESCE(?, deleted),
            updated_at = ?,
            src        = COALESCE(?, src),
            title_ext  = COALESCE(?, title_ext),
            closed     = COALESCE(?, closed),
            visible_in = COALESCE(?, visible_in),
            done       = COALESCE(?, done)
    ''', (nid, status, fields.get('body'), fields.get('group_id'), fields.get('board_id'),
          fields.get('summary'), deleted, now,
          src if src is not None else '',
          title_ext if title_ext is not None else '',
          closed if closed is not None else 0,
          visible_in if visible_in is not None else '',
          done if done is not None else 0,
          status, fields.get('body'), fields.get('group_id'), fields.get('board_id'),
          fields.get('summary'), deleted, now, src,
          title_ext, closed, visible_in, done))


class MixinEngineering(MixinBase):

    # ---------- 图快照 ----------
    def _handle_eng_graph(self):
        conn = get_db()
        cur = conn.cursor()
        # 修复(2026-11-19)：graph 是纯 GET，此前不触发懒迁移——库缺 visible_in/done 列时
        # SELECT 直接 OperationalError → 500，前端整树画不出。GET 侧也先做列兜底。
        # 修复(2026-11-25 bravo)：补兜 src 列——v1.9 加的 src 只在写入口懒建，
        # 纯读库（从未走过 _eng_ext_upsert）缺 src 列时本接口每次 500：no such column: e.src
        _eng_ensure_org_cols(cur)
        _eng_ensure_src_col(cur)
        # 节点 = canvas_nodes（骨架/坐标/标题）LEFT JOIN ext（状态/题目正文/分组）
        cur.execute('''
            SELECT n.id, n.title, n.x, n.y, n.w, n.h, n.collapsed, n.z_index,
                   e.status, e.body, e.group_id, e.board_id, e.summary, e.deleted, e.updated_at, e.src,
                   e.title_ext, e.closed, e.visible_in, e.done
            FROM canvas_nodes n
            LEFT JOIN canvas_node_ext e ON e.node_id = n.id
            ORDER BY n.z_index DESC, n.id
        ''')
        nodes = []
        for r in cur.fetchall():
            nodes.append({
                'id': r[0], 'title': r[1], 'x': r[2], 'y': r[3], 'w': r[4], 'h': r[5],
                'collapsed': r[6], 'z': r[7],
                'status': r[8] or '', 'body': r[9] or '', 'groupId': r[10] or '',
                'boardId': r[11] or '', 'summary': r[12] or '',
                'deleted': bool(r[13]), 'extUpdated': r[14] or 0, 'src': r[15] or '',
                'titleExt': r[16] or '', 'closed': bool(r[17]),
                'visibleIn': _parse_visible_in(r[18]),
                'done': bool(r[19]),
            })
        cur.execute('SELECT id, src, dst, kind, label, created_at FROM canvas_edge ORDER BY id')
        edges = [{'id': r[0], 'src': r[1], 'dst': r[2], 'kind': r[3] or 'normal',
                  'label': r[4] or '', 'createdAt': r[5]} for r in cur.fetchall()]
        self._send_json({'ok': True, 'nodes': nodes, 'edges': edges})

    # ---------- 任务板列表 ----------
    def _handle_eng_boards(self):
        conn = get_db()
        cur = conn.cursor()
        cur.execute('''SELECT DISTINCT board_id FROM canvas_node_ext
                       WHERE board_id != '' ORDER BY board_id''')
        self._send_json({'ok': True,
                         'boards': [{'id': r[0]} for r in cur.fetchall()]})

    # ---------- v4.2 P0：工程独立存储（反驳师②：boards 派生查询空工程永不出现） ----------
    def _ensure_eng_projects(self, cur):
        """projects 旁挂表懒建（不碰宿主表）：id/name/created_at/updated_at"""
        cur.execute('''CREATE TABLE IF NOT EXISTS eng_projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at INTEGER,
            updated_at INTEGER
        )''')

    def _handle_eng_projects(self):
        conn = get_db()
        cur = conn.cursor()
        self._ensure_eng_projects(cur)
        cur.execute('SELECT id, name, created_at, updated_at FROM eng_projects ORDER BY created_at DESC')
        self._send_json({'ok': True,
                         'projects': [{'id': r[0], 'name': r[1], 'createdAt': r[2], 'updatedAt': r[3]}
                                      for r in cur.fetchall()]})

    def _handle_eng_project_create(self):
        if not _eng_loopback(self):
            return
        b = _eng_body(self)
        name = str(b.get('name') or '').strip()
        if not name:
            return self._send_json({'ok': False, 'err': 'name required'}, 400)
        conn = get_db()
        cur = conn.cursor()
        self._ensure_eng_projects(cur)
        now = int(time.time())
        pid = b.get('id') or ('ep%d_%s' % (now, _uuid.uuid4().hex[:6]))
        cur.execute('INSERT OR REPLACE INTO eng_projects (id, name, created_at, updated_at) VALUES (?,?,?,?)',
                    (str(pid), name, now, now))
        conn.commit()
        self._send_json({'ok': True, 'id': str(pid), 'name': name})

    def _handle_eng_project_rename(self):
        if not _eng_loopback(self):
            return
        b = _eng_body(self)
        pid = str(b.get('id') or '').strip()
        name = str(b.get('name') or '').strip()
        if not pid or not name:
            return self._send_json({'ok': False, 'err': 'id/name required'}, 400)
        conn = get_db()
        cur = conn.cursor()
        self._ensure_eng_projects(cur)
        cur.execute('UPDATE eng_projects SET name=?, updated_at=? WHERE id=?', (name, int(time.time()), pid))
        conn.commit()
        self._send_json({'ok': True, 'id': pid})

    def _handle_eng_project_delete(self):
        if not _eng_loopback(self):
            return
        b = _eng_body(self)
        pid = str(b.get('id') or '').strip()
        if not pid:
            return self._send_json({'ok': False, 'err': 'id required'}, 400)
        conn = get_db()
        cur = conn.cursor()
        self._ensure_eng_projects(cur)
        cur.execute('DELETE FROM eng_projects WHERE id=?', (pid,))
        conn.commit()
        self._send_json({'ok': True})

    # ---------- 节点语义扩展 upsert（软删走这里 deleted 字段） ----------
    def _handle_eng_node_upsert(self):
        if not _eng_loopback(self):
            return
        b = _eng_body(self)
        nid = str(b.get('id') or '').strip()
        if not nid:
            return self._send_json({'ok': False, 'err': 'id required'}, 400)
        status = str(b.get('status') or '').strip()
        if status and status not in ENG_NODE_STATUS:
            return self._send_json({'ok': False, 'err': 'bad status'}, 400)
        # S1 修复（代码师P2终审/安全师低危③）：仿 edge/upsert 范例，宿主节点必须实存，
        # 否则拒绝写入，防止产生 graph 看不到但 boards 会列出的孤儿 ext 行（口径分裂）
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT COUNT(*) FROM canvas_nodes WHERE id=?', (nid,))
        if cur.fetchone()[0] < 1:
            return self._send_json({'ok': False, 'err': 'node not found'}, 404)
        now = int(time.time())
        # F1 修复：拖拽坐标落库（canvas_nodes 宿主表已有 x/y 列，只写不改表结构）
        if 'x' in b or 'y' in b:
            nx = b.get('x'); ny = b.get('y')
            try:
                nx = float(nx); ny = float(ny)
                cur.execute('UPDATE canvas_nodes SET x=?, y=? WHERE id=?', (nx, ny, nid))
            except (TypeError, ValueError):
                pass
        # v1.9：节点宽高落库（宿主表已有 w/h 列）——i工程节点可拖拽调宽高并记忆
        if 'w' in b or 'h' in b:
            try:
                nw = int(float(b.get('w') or 0)); nh = int(float(b.get('h') or 0))
                if nw > 0 and nh > 0:
                    cur.execute('UPDATE canvas_nodes SET w=?, h=? WHERE id=?', (nw, nh, nid))
            except (TypeError, ValueError):
                pass
        # v1.9：标题重命名落库（主对话进入 i工程 后仍可改名）
        if 'title' in b:
            nt = str(b.get('title') or '').strip()
            if nt:
                cur.execute('UPDATE canvas_nodes SET title=? WHERE id=?', (nt, nid))
        # v1.9.2：src 隔离标记并入 _eng_ext_upsert 单一入口
        # （旧实现：ext 行不存在时 UPDATE 影响 0 行、随后 INSERT 不带 src → src 丢失 → 节点不可见）
        _eng_ext_upsert(cur, nid, {
            'status': status,
            'body': b.get('body'), 'group_id': b.get('group_id'),
            'board_id': b.get('board_id'), 'summary': b.get('summary'),
            'deleted': _eng_int(b.get('deleted')) if 'deleted' in b else None,
            'src': str(b.get('src'))[:16] if 'src' in b else None,
            # i整理模式2.0：title_ext 双轨标题（''=恢复原题合法）+ closed 可见性指挥台开关
            'title_ext': str(b.get('title_ext') or '')[:200] if 'title_ext' in b else None,
            'closed': _eng_int(b.get('closed')) if 'closed' in b else None,
            # i整理：done 完成标记（None=不改；0/1）
            'done': _eng_int(b.get('done')) if 'done' in b else None,
            # i整理 P3 规则表：visible_in 按模式显隐（{"normal":bool,"focus":bool}），JSON 串落库
            'visible_in': (_json.dumps({k: bool(v) for k, v in dict(b.get('visible_in') or {}).items() if k in ('normal', 'focus', 'organize')}) if isinstance(b.get('visible_in'), dict) else None) if 'visible_in' in b else None,
        }, now)
        conn.commit()
        self._send_json({'ok': True, 'id': nid, 'updatedAt': now})

    # ---------- 只改状态 ----------
    def _handle_eng_node_status(self):
        if not _eng_loopback(self):
            return
        b = _eng_body(self)
        nid = str(b.get('id') or '').strip()
        status = str(b.get('status') or '').strip()
        if not nid or status not in ENG_NODE_STATUS:
            return self._send_json({'ok': False, 'err': 'id/status required'}, 400)
        conn = get_db()
        cur = conn.cursor()
        now = int(time.time())
        _eng_ext_upsert(cur, nid, {'status': status}, now)
        conn.commit()
        self._send_json({'ok': True, 'id': nid, 'status': status})

    # ---------- 连线 upsert ----------
    def _handle_eng_edge_upsert(self):
        if not _eng_loopback(self):
            return
        b = _eng_body(self)
        src = str(b.get('src') or '').strip()
        dst = str(b.get('dst') or '').strip()
        kind = str(b.get('kind') or 'normal').strip()
        if not src or not dst:
            return self._send_json({'ok': False, 'err': 'src/dst required'}, 400)
        if kind not in ENG_EDGE_KIND:
            return self._send_json({'ok': False, 'err': 'bad kind'}, 400)
        if src == dst:
            return self._send_json({'ok': False, 'err': 'self loop not allowed'}, 400)
        conn = get_db()
        cur = conn.cursor()
        # 安全加固：校验 src/dst 节点真实存在，防跨任务伪造连线
        cur.execute('SELECT COUNT(*) FROM canvas_nodes WHERE id IN (?,?)', (src, dst))
        if cur.fetchone()[0] < 2:
            return self._send_json({'ok': False, 'err': 'node not found'}, 400)
        now = int(time.time())
        eid = str(b.get('id') or '').strip()
        if eid:
            cur.execute('UPDATE canvas_edge SET src=?, dst=?, kind=?, label=?, created_at=? '
                        'WHERE id=?', (src, dst, kind, b.get('label') or '', now, eid))
            if cur.rowcount == 0:
                eid = None
        if not eid:
            eid = 'eg%d_%s' % (now, _uuid.uuid4().hex[:8])
            cur.execute('INSERT INTO canvas_edge (id, src, dst, kind, label, created_at) '
                        'VALUES (?,?,?,?,?,?)', (eid, src, dst, kind, b.get('label') or '', now))
        conn.commit()
        self._send_json({'ok': True, 'id': eid, 'kind': kind})

    # ---------- 连线删除 ----------
    def _handle_eng_edge_delete(self):
        if not _eng_loopback(self):
            return
        b = _eng_body(self)
        eid = str(b.get('id') or '').strip()
        if not eid:
            return self._send_json({'ok': False, 'err': 'id required'}, 400)
        conn = get_db()
        conn.execute('DELETE FROM canvas_edge WHERE id=?', (eid,))
        conn.commit()
        self._send_json({'ok': True})

    # ---------- 总结师回填 ----------
    def _handle_eng_summary(self):
        if not _eng_loopback(self):
            return
        b = _eng_body(self)
        nid = str(b.get('id') or '').strip()
        if not nid:
            return self._send_json({'ok': False, 'err': 'id required'}, 400)
        conn = get_db()
        cur = conn.cursor()
        now = int(time.time())
        # P2 修复(F4)：总结师回填不再静默改状态机——status 仅显式传入合法值时才改，缺省保持原状态
        req_status = str(b.get('status') or '').strip()
        if req_status and req_status not in ENG_NODE_STATUS:
            return self._send_json({'ok': False, 'err': 'bad status'}, 400)
        _eng_ext_upsert(cur, nid, {'summary': b.get('summary') or '', 'status': req_status}, now)
        conn.commit()
        self._send_json({'ok': True, 'id': nid})
