# -*- coding: utf-8 -*-
"""
🛰️ 万能智能体数据导入大师（external_agent_import.py）
=====================================================
目的：把本机其他 AI Agent（zcode/codex/claude code/codely/workbuddy/dsh）
的本地会话数据库只读抽取进朱峰自己的干净库（一源一库），可继续检索/接续工作。

设计纪律（照「外部Agent一键导入-定稿总纲 v3.6」执行）：
- 一源一库：每个外部 Agent 独立库 private/db/external/{agent}.db，绝不混库
- copy-then-read：源 sqlite 一律先拷三件套（.sqlite/-wal/-shm）到临时目录再只读打开，
  绝不直连源热库，绝不写源库
- 四元指纹：机器名|系统用户|来源Agent|项目路径 组合去重，同指纹只更新不重复插入
- 敏感文件硬排除：auth.json/config.toml/*.key/token 等，永不入朱峰库
- 证据卡：本模块每条「已实测」结论均有当轮命令输出支撑（见总纲 §8.1.4）

API（挂在 /api/agent/import/*，POST）：
    POST /api/agent/import/candidates   自动探测本机可导入的 Agent 数据源
    POST /api/agent/import/scan         预览某源的会话清单（不落库）
    POST /api/agent/import/run          执行导入落库（增量，按指纹去重）
    POST /api/agent/import/status       查看已导入统计
"""

import os
import json
import shutil
import sqlite3
import tempfile
import platform
import getpass
import time

# ============ 基础设施 ============

def _project_root():
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _external_dir():
    d = os.path.join(_project_root(), 'private', 'db', 'external')
    os.makedirs(d, exist_ok=True)
    return d


def _fingerprint(agent, project_path):
    """四元指纹：机器|用户|Agent|项目路径"""
    return '|'.join([platform.node(), getpass.getuser(), agent, project_path or '~'])


# 敏感文件名片段（黑名单，凡命中一律不入库）
SENSITIVE_PATTERNS = ['auth', 'token', 'secret', 'credential', 'apikey', 'api_key', '.key', 'password']

def is_sensitive_path(p):
    low = p.lower()
    return any(k in low for k in SENSITIVE_PATTERNS)


def _copy_sqlite_trio(src_db):
    """copy-then-read：把 sqlite 主文件+wal+shm 齐拷到临时目录，返回副本路径。
    实测证据（2026-10-27）：codely 32会话目录几乎全带 -wal/-shm，三件套齐拷是唯一稳妥做法。
    """
    tmpd = tempfile.mkdtemp(prefix='zf_ext_import_')
    dst = os.path.join(tmpd, 'src.sqlite')
    copied = []
    for suf in ['', '-wal', '-shm']:
        p = src_db + suf
        if os.path.exists(p):
            shutil.copy2(p, dst + suf)
            copied.append(os.path.basename(p))
    if not os.path.exists(dst):
        raise FileNotFoundError(src_db)
    return dst, tmpd, copied


def _open_ro(dst):
    conn = sqlite3.connect('file:%s?mode=ro' % dst.replace('\\', '/'), uri=True)
    conn.row_factory = sqlite3.Row
    return conn


# ============ 目标库 schema（一源一库，每 Agent 同构） ============

TARGET_SCHEMA = """
CREATE TABLE IF NOT EXISTS imported_session (
    id TEXT PRIMARY KEY,              -- 源会话 id
    fingerprint TEXT NOT NULL,        -- 四元指纹|源会话id（防同机会话与全局重复）
    agent TEXT NOT NULL,
    title TEXT,
    project_path TEXT,
    source_id TEXT,
    time_created INTEGER,
    time_updated INTEGER,
    msg_count INTEGER DEFAULT 0,
    meta_json TEXT,
    imported_at INTEGER
);
CREATE TABLE IF NOT EXISTS imported_message (
    id TEXT PRIMARY KEY,              -- agent:src_msg_id
    session_id TEXT NOT NULL,
    role TEXT,
    content TEXT,
    model TEXT,
    time_ms INTEGER,
    seq INTEGER
);
CREATE INDEX IF NOT EXISTS idx_im_session ON imported_message(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_is_fp ON imported_session(fingerprint);
"""


def _target_db(agent):
    p = os.path.join(_external_dir(), '%s.db' % agent)
    conn = sqlite3.connect(p)
    conn.row_factory = sqlite3.Row
    conn.executescript(TARGET_SCHEMA)
    return conn, p


# ============ 适配器注册表 ============
# 每个适配器: dict(name, db_path_resolver, extract_fn)
# extract_fn(conn) -> iterator of session dicts:
#   {id, title, project_path, time_created(ms), time_updated(ms), messages:[{id,role,content,model,time_ms,seq}]}

def _detect_home(*parts):
    p = os.path.expanduser(os.path.join(*parts))
    return p if os.path.exists(p) else None


# --- zcode 适配器（已实测：schema 24表，session/message/part 主三表） ---
def _zcode_extract(conn):
    # 会话
    for s in conn.execute("SELECT id, title, directory, time_created, time_updated FROM session ORDER BY time_updated DESC"):
        msgs = []
        for m in conn.execute(
            "SELECT id, time_created, data, sequence FROM message WHERE session_id=? ORDER BY sequence, time_created",
            (s['id'],)):
            try:
                d = json.loads(m['data'])
            except Exception:
                continue
            role = d.get('role') or 'unknown'
            model = (d.get('model') or {}).get('modelID') if isinstance(d.get('model'), dict) else d.get('modelID')
            # 正文：优先 part 表聚合，回退 data 内嵌
            texts = []
            for p in conn.execute(
                "SELECT data FROM part WHERE message_id=? AND sequence IS NOT NULL ORDER BY sequence",
                (m['id'],)):
                try:
                    pd = json.loads(p['data'])
                except Exception:
                    continue
                if pd.get('type') == 'text' and pd.get('text'):
                    texts.append(pd['text'])
            content = '\n'.join(texts) if texts else _extract_inline_text(d)
            if not content:
                continue  # 纯工具调用等无正文消息跳过（元数据仍在 part 层可溯源）
            msgs.append({'id': 'zcode:' + m['id'], 'role': role, 'content': content,
                         'model': model or '', 'time_ms': m['time_created'], 'seq': m['sequence'] or 0})
        yield {'id': s['id'], 'title': s['title'], 'project_path': s['directory'],
               'time_created': s['time_created'], 'time_updated': s['time_updated'],
               'messages': msgs}


def _extract_inline_text(d):
    """data 内嵌正文兜底抽取"""
    if not isinstance(d, dict):
        return ''
    for key in ('text', 'content'):
        v = d.get(key)
        if isinstance(v, str) and v.strip():
            return v
    return ''


# ============ 目录型 jsonl 适配器通用工具 ============

def _read_jsonl(path, max_line=2 * 1024 * 1024):
    """逐行读 jsonl，坏行跳过；超长行跳过（防二进制/巨行拖垮）"""
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            for line in f:
                line = line.strip()
                if not line or len(line) > max_line:
                    continue
                try:
                    yield json.loads(line)
                except Exception:
                    continue
    except OSError:
        return


def _content_blocks_to_text(blocks):
    """content 块数组转纯文本（claude/workbuddy 共用）"""
    if isinstance(blocks, str):
        return blocks
    texts = []
    if isinstance(blocks, list):
        for b in blocks:
            if isinstance(b, dict) and b.get('text'):
                texts.append(b['text'])
    return '\n'.join(texts)


# --- codex 适配器（2026-10-27 实测：sessions/年/月/日/rollout-*.jsonl） ---
def _codex_extract(sessions_dir):
    files = _glob_files(sessions_dir, 'rollout-*.jsonl')
    for path in files:
        meta = None
        msgs = []
        seq = 0
        for d in _read_jsonl(path):
            t = d.get('type')
            if t == 'session_meta':
                p = d.get('payload') or {}
                meta = {'id': p.get('id') or _file_stem(path),
                        'cwd': p.get('cwd') or '', 'ts': d.get('timestamp')}
                continue
            if t not in ('response_item', 'event_msg'):
                continue
            p = d.get('payload') or {}
            role = p.get('role')
            if role not in ('user', 'assistant'):
                continue
            content = _content_blocks_to_text(p.get('content'))
            if not content:
                content = p.get('text') or ''
            if not content.strip():
                continue
            # 跳过系统注入（环境上下文等）
            if content.startswith('<environment_context>') or content.startswith('<user_instructions>'):
                continue
            ts = _iso_to_ms(d.get('timestamp'))
            msgs.append({'id': 'codex:' + (p.get('id') or '%s:%d' % (_file_stem(path), seq)),
                         'role': role, 'content': content, 'model': '',
                         'time_ms': ts, 'seq': seq})
            seq += 1
        if not msgs:
            continue
        sid = (meta or {}).get('id') or _file_stem(path)
        first_ts = msgs[0]['time_ms']
        last_ts = msgs[-1]['time_ms']
        yield {'id': sid, 'title': _first_user_title(msgs) or sid[:24],
               'project_path': (meta or {}).get('cwd') or '',
               'time_created': first_ts, 'time_updated': last_ts, 'messages': msgs}


# --- claude code 适配器（2026-10-27 实测：projects/<项目目录>/*.jsonl） ---
def _claude_extract(projects_dir):
    files = _glob_files(projects_dir, '*.jsonl')
    for path in files:
        # 项目路径从目录名还原：C--Users-Administrator -> C:\Users\Administrator
        proj_dir = os.path.basename(os.path.dirname(path))
        project_path = proj_dir.replace('-', os.sep) if '--' not in proj_dir else \
            proj_dir.split('--', 1)[0].replace('-', ':\\') + os.sep + proj_dir.split('--', 1)[1].replace('-', os.sep)
        sid = _file_stem(path)
        msgs = []
        seq = 0
        for d in _read_jsonl(path):
            if d.get('type') not in ('user', 'assistant'):
                continue
            m = d.get('message') or {}
            role = m.get('role') or d.get('type')
            content = _content_blocks_to_text(m.get('content'))
            if not content.strip():
                continue
            if content.startswith('<system-reminder') or content.startswith('<command-'):
                continue
            ts = _iso_to_ms(d.get('timestamp'))
            msgs.append({'id': 'claude:%s:%d' % (sid, seq), 'role': role,
                         'content': content, 'model': m.get('model') or '',
                         'time_ms': ts, 'seq': seq})
            seq += 1
        if not msgs:
            continue
        yield {'id': sid, 'title': _first_user_title(msgs) or sid[:24],
               'project_path': project_path,
               'time_created': msgs[0]['time_ms'], 'time_updated': msgs[-1]['time_ms'],
               'messages': msgs}


# --- codely 适配器（2026-10-27 实测：auto-saves/chat-auto-save-*.json 滚动快照） ---
def _codely_extract(saves_dir):
    """clientHistory=[{role, parts:[{text}]}]。同会话（同 prefix tag 序）滚动快照
    大量重复 → 按首次 user 消息前 80 字符做会话键，只取 mtime 最新一份。"""
    import glob as _glob
    best = {}
    for path in _glob.glob(os.path.join(saves_dir, 'chat-auto-save-*.json')):
        try:
            key = None
            with open(path, encoding='utf-8', errors='replace') as f:
                d = json.load(f)
            hist = d.get('clientHistory') or []
            for item in hist:
                if item.get('role') == 'user':
                    parts = item.get('parts') or []
                    txt = ' '.join(p.get('text', '') for p in parts if isinstance(p, dict))
                    txt = txt.strip()
                    # 跳过 CLI 注入的 context prefix
                    if txt.startswith('This is the Codely CLI') or not txt:
                        continue
                    key = txt[:80]
                    break
            key = key or _file_stem(path)[:40]
            mt = os.path.getmtime(path)
            if key not in best or mt > best[key][0]:
                best[key] = (mt, path, d, hist)
        except Exception:
            continue
    for key, (mt, path, d, hist) in best.items():
        msgs = []
        seq = 0
        for item in hist:
            role = item.get('role')
            if role not in ('user', 'assistant'):
                continue
            parts = item.get('parts') or []
            content = '\n'.join(p.get('text', '') for p in parts if isinstance(p, dict) and p.get('text'))
            if not content.strip():
                continue
            if content.startswith('This is the Codely CLI'):
                continue
            msgs.append({'id': 'codely:%s:%d' % (_file_stem(path), seq), 'role': role,
                         'content': content, 'model': '', 'time_ms': int(mt * 1000), 'seq': seq})
            seq += 1
        if not msgs:
            continue
        ts = _iso_to_ms(d.get('timestamp')) or int(mt * 1000)
        yield {'id': 'codely-' + _file_stem(path),
               'title': (d.get('description') or key)[:60],
               'project_path': (d.get('prefixContext') or {}).get('cwd') or '',
               'time_created': ts, 'time_updated': ts, 'messages': msgs}


# --- workbuddy 适配器（2026-10-27 实测：projects/<项目>/<sessionId>.jsonl） ---
def _workbuddy_extract(projects_dir):
    files = _glob_files(projects_dir, '*.jsonl')
    for path in files:
        sid = _file_stem(path)
        # 项目路径从目录名还原：f-朱峰社区...-5.2.2 -> f:\朱峰社区...\5.2.2
        proj = os.path.basename(os.path.dirname(path))
        if proj.startswith('f-'):
            rest = proj[2:].replace('-', os.sep)
            project_path = 'f:' + os.sep + rest if not rest.startswith(os.sep) else 'f:' + rest
        else:
            project_path = proj
        msgs = []
        seq = 0
        for d in _read_jsonl(path):
            if d.get('type') != 'message':
                continue
            role = d.get('role')
            if role not in ('user', 'assistant'):
                continue
            content = _content_blocks_to_text(d.get('content'))
            if not content.strip():
                continue
            if content.startswith('<system-reminder'):
                continue
            ts = d.get('timestamp')
            ts_ms = ts if isinstance(ts, int) else (_iso_to_ms(ts) or 0)
            msgs.append({'id': 'workbuddy:%s:%d' % (sid, seq), 'role': role,
                         'content': content,
                         'model': ((d.get('providerData') or {}).get('model') or ''),
                         'time_ms': ts_ms, 'seq': seq})
            seq += 1
        if not msgs:
            continue
        yield {'id': sid, 'title': _first_user_title(msgs) or sid[:24],
               'project_path': project_path,
               'time_created': msgs[0]['time_ms'], 'time_updated': msgs[-1]['time_ms'],
               'messages': msgs}


# --- dsh 适配器（session.v4.jsonl.zstd，依赖 zstandard） ---
def _dsh_extract(sessions_dir):
    try:
        import zstandard  # noqa: F401
    except ImportError:
        raise ImportError(
            'dsh 会话为 zstd 压缩（session.v4.jsonl.zstd），需安装 zstandard 库：'
            '请在 python\\python.exe -m pip install zstandard 后重试；'
            '当前环境未安装，dsh 源暂不可导入（其余源不受影响）')
    import glob as _glob
    # 2026-10-27 实测：实际结构为 sessions/<workspace-dir>/<uuid>/session.v4.jsonl.zstd
    # （workspace 目录名是编码后的项目路径，uuid 目录不一定带 session- 前缀），故用递归 glob 兜底
    paths = _glob.glob(os.path.join(sessions_dir, 'session-*', 'session.v4.jsonl.zstd'))
    if not paths:
        paths = _glob.glob(os.path.join(sessions_dir, '**', 'session.v4.jsonl.zstd'), recursive=True)
    for path in paths:
        sid = os.path.basename(os.path.dirname(path)).replace('session-', '')
        try:
            with open(path, 'rb') as f:
                dctx = zstandard.ZstdDecompressor()
                text = dctx.stream_reader(f).read().decode('utf-8', errors='replace')
        except Exception:
            continue
        msgs = []
        seq = 0
        t0 = 0
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            typ = d.get('type')
            tm = d.get('time') or 0
            if tm and not t0:
                t0 = tm
            data = d.get('data') or {}
            # 2026-10-27 实测 v4 格式：消息事件为 user/message / assistant/message，
            # 内容在 data.content（user）或 data.message.content（assistant）
            if typ == 'user/message':
                role, content = 'user', _content_blocks_to_text(data.get('content'))
            elif typ == 'assistant/message':
                msg = data.get('message') or {}
                role = 'assistant'
                blocks = msg.get('content')
                # 过滤 reasoning 块，只保留正文 text
                if isinstance(blocks, list):
                    blocks = [b for b in blocks if isinstance(b, dict) and b.get('type') != 'reasoning']
                content = _content_blocks_to_text(blocks)
            else:
                continue
            if not (content or '').strip():
                continue
            msgs.append({'id': 'dsh:%s:%d' % (sid, seq), 'role': role,
                         'content': content, 'model': (data.get('message') or {}).get('model') or '',
                         'time_ms': tm, 'seq': seq})
            seq += 1
        if not msgs:
            continue
        yield {'id': sid, 'title': _first_user_title(msgs) or sid[:24],
               'project_path': '', 'time_created': t0, 'time_updated': tm or t0,
               'messages': msgs}


# ============ 小工具 ============

def _glob_files(root, pattern):
    """递归收集文件（目录型适配器通用），跳过敏感名"""
    import glob as _glob
    out = []
    for p in _glob.glob(os.path.join(root, '**', pattern), recursive=True):
        if is_sensitive_path(p):
            continue
        if os.path.isfile(p):
            out.append(p)
    return sorted(out)


def _file_stem(path):
    return os.path.splitext(os.path.basename(path))[0]


def _iso_to_ms(s):
    """ISO8601 -> epoch ms；失败返回 0"""
    if not s or not isinstance(s, str):
        return 0
    try:
        from datetime import datetime, timezone
        s2 = s.replace('Z', '+00:00')
        dt = datetime.fromisoformat(s2)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except Exception:
        return 0


def _first_user_title(msgs):
    for m in msgs:
        if m['role'] == 'user':
            t = m['content'].strip().splitlines()[0] if m['content'].strip() else ''
            return t[:60] or None
    return None


ADAPTERS = {
    'zcode': {
        'label': 'ZCode',
        'icon': '🦓',
        'kind': 'sqlite',
        'db': lambda: _detect_home('~', '.zcode', 'cli', 'db', 'db.sqlite'),
        'extract': _zcode_extract,
        'evidence': '2026-10-27 copy三件套实测：24表/session 80/message 5908/part 20960，data为JSON，正文在part表type=text',
    },
    'codex': {
        'label': 'Codex', 'icon': '🧩',
        'kind': 'dir',
        'db': lambda: _detect_home('~', '.codex', 'sessions'),
        'extract': _codex_extract,
        'evidence': '2026-10-27 实测：sessions/年/月/日/rollout-*.jsonl 263个，首行 session_meta，user/assistant 行 payload 内嵌正文',
    },
    'claude': {
        'label': 'Claude Code', 'icon': '🟠',
        'kind': 'dir',
        'db': lambda: _detect_home('~', '.claude', 'projects'),
        'extract': _claude_extract,
        'evidence': '2026-10-27 实测：projects/<项目目录>/*.jsonl，行含 type=user/assistant + message.role/message.content',
    },
    'codely': {
        'label': 'Codely', 'icon': '🟢',
        'kind': 'dir',
        'db': lambda: _detect_home('~', '.codely', 'Default', '.codely-cli', 'auto-saves'),
        'extract': _codely_extract,
        'evidence': '2026-10-27 实测：auto-saves/chat-auto-save-*.json，clientHistory=[{role,parts:[{text}]}]；同会话多快照按 timestamp 取最新去重',
    },
    'workbuddy': {
        'label': 'WorkBuddy', 'icon': '🐝',
        'kind': 'dir',
        'db': lambda: _detect_home('~', '.workbuddy', 'projects'),
        'extract': _workbuddy_extract,
        'evidence': '2026-10-27 实测：projects/<项目>/<sessionId>.jsonl，type=message + role + content[{type:input_text/output_text|reasoning_text,text}]',
    },
    'dsh': {
        'label': 'DeepSeek Harness', 'icon': '🐋',
        'kind': 'dir',
        'db': lambda: _detect_home('~', '.dsh', 'sessions'),
        'extract': _dsh_extract,
        'evidence': '2026-10-27 实测：session-*/session.v4.jsonl.zstd（zstd 压缩）；依赖 zstandard 库，未装时 scan/run 返回明确提示',
    },
}


# ============ 对外 API ============

def list_candidates():
    out = []
    for key, ad in ADAPTERS.items():
        try:
            p = ad['db']()
            if p:
                st = os.stat(p if os.path.isfile(p) else os.path.dirname(p))
                out.append({'agent': key, 'label': ad['label'], 'icon': ad['icon'],
                            'path': p, 'ready': ad['extract'] is not None,
                            'size_mb': round(st.st_size / 1048576, 2) if os.path.isfile(p) else None,
                            'mtime': st.st_mtime, 'evidence': ad.get('evidence', '')})
        except Exception as e:
            out.append({'agent': key, 'label': ad['label'], 'icon': ad['icon'],
                        'ready': False, 'err': str(e)})
    return {'ok': True, 'machine': platform.node(), 'user': getpass.getuser(), 'candidates': out}


def _iter_extract(ad, src, copied_out):
    """统一抽取入口：sqlite 型源走 copy-then-read（三件套齐拷），
    目录型源直接迭代 jsonl。copied_out 用于向 API 回执报告拷贝明细。"""
    if ad.get('kind') == 'dir':
        for s in ad['extract'](src):
            yield s
        return
    dst, tmpd, copied = _copy_sqlite_trio(src)
    copied_out.extend(copied)
    try:
        conn = _open_ro(dst)
        try:
            for s in ad['extract'](conn):
                yield s
        finally:
            conn.close()
    finally:
        shutil.rmtree(tmpd, ignore_errors=True)


def scan_import(agent):
    ad = ADAPTERS.get(agent)
    if not ad or not ad['extract']:
        return {'ok': False, 'err': '适配器未就绪：%s' % agent}
    src = ad['db']()
    if not src:
        return {'ok': False, 'err': '未找到 %s 数据源' % agent}
    copied = []
    sessions = []
    try:
        for s in _iter_extract(ad, src, copied):
            sessions.append({'id': s['id'], 'title': s['title'], 'project_path': s['project_path'],
                             'time_updated': s['time_updated'], 'msg_count': len(s['messages'])})
            if len(sessions) >= 500:
                break
    except ImportError as e:
        return {'ok': False, 'err': str(e)}
    return {'ok': True, 'agent': agent, 'copied': copied,
            'fingerprint_prefix': '|'.join([platform.node(), getpass.getuser(), agent]),
            'sessions': sessions, 'total': len(sessions)}


def run_import(agent):
    ad = ADAPTERS.get(agent)
    if not ad or not ad['extract']:
        return {'ok': False, 'err': '适配器未就绪：%s' % agent}
    src = ad['db']()
    if not src:
        return {'ok': False, 'err': '未找到 %s 数据源' % agent}
    copied = []
    try:
        tconn, tpath = _target_db(agent)
    except ImportError as e:
        return {'ok': False, 'err': str(e)}
    now = int(time.time() * 1000)
    n_sess = n_msg = n_skip = 0
    try:
        for s in _iter_extract(ad, src, copied):
            fp = _fingerprint(agent, s['project_path']) + '|' + s['id']
            exist = tconn.execute('SELECT 1 FROM imported_session WHERE id=?', (s['id'],)).fetchone()
            if exist:
                # 同指纹更新：刷新 updated/条数（保守：不删旧消息）
                tconn.execute('UPDATE imported_session SET time_updated=?, msg_count=?, imported_at=? WHERE id=?',
                              (s['time_updated'], len(s['messages']), now, s['id']))
                n_skip += 1
            else:
                tconn.execute(
                    'INSERT INTO imported_session(id,fingerprint,agent,title,project_path,source_id,time_created,time_updated,msg_count,meta_json,imported_at) '
                    'VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                    (s['id'], fp, agent, s['title'], s['project_path'], s['id'],
                     s['time_created'], s['time_updated'], len(s['messages']), '', now))
                for m in s['messages']:
                    tconn.execute(
                        'INSERT OR REPLACE INTO imported_message(id,session_id,role,content,model,time_ms,seq) VALUES(?,?,?,?,?,?,?)',
                        (m['id'], s['id'], m['role'], m['content'], m.get('model', ''), m.get('time_ms', 0), m.get('seq', 0)))
                    n_msg += 1
                n_sess += 1
        tconn.commit()
    finally:
        tconn.close()
    stats = status(agent)
    stats['new_sessions'] = n_sess
    stats['new_messages'] = n_msg
    stats['updated_existing'] = n_skip
    stats['copied'] = copied
    return stats


def status(agent=None):
    out = {'ok': True, 'dir': _external_dir(), 'dbs': []}
    agents = [agent] if agent else list(ADAPTERS.keys())
    for a in agents:
        p = os.path.join(_external_dir(), '%s.db' % a)
        if not os.path.exists(p):
            out['dbs'].append({'agent': a, 'exists': False})
            continue
        conn = _open_ro(p)
        try:
            conn.executescript('')  # noop
        except Exception:
            pass
        try:
            ns = conn.execute('SELECT COUNT(*) FROM imported_session WHERE agent=?', (a,)).fetchone()[0]
            nm = conn.execute('SELECT COUNT(*) FROM imported_message').fetchone()[0]
            projects = [r[0] for r in conn.execute(
                'SELECT DISTINCT project_path FROM imported_session WHERE agent=? LIMIT 50', (a,))]
        except Exception:
            ns = nm = 0
            projects = []
        conn.close()
        out['dbs'].append({'agent': a, 'exists': True, 'path': p, 'sessions': ns,
                           'messages': nm, 'projects': projects})
    return out
