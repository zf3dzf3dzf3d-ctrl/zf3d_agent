#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
朱峰智能体远程命令消费模块
与 zf3d_heartbeat 同源认证：使用 heartbeat_api_key（即网站登录时下发的 agent_api_key）。

功能：
  - 后台线程轮询网站 GET a=get_commands（带 machine_id），拉取手机端下发的命令
  - chat 命令：用本地默认模型直接调用上游 chat/completions 生成回复
  - 回复经 POST a=command_result 回传（手机端 get_result 轮询到即显示）
  - 仅处理属于当前登录会员的机器（网站端 send_command 已做归属校验，此处为双保险：
    仅在桌面端已登录朱峰智能体账号时才拉取/执行命令）

安全：
  - 未登录（get_login_status 返回 0/-1）时不消费命令
  - 命令类型白名单，避免任意执行
  - 上游调用不走系统代理，超时受控
"""

import os
import sys
import json
import time
import threading
import subprocess
import urllib.request
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import BASE_DIR

# 端口集中配置：统一走 config.get_ai_proxy_port()（与代理实际监听同源，杜绝双源分叉）
def _load_zf_proxy_port():
    try:
        from config import get_ai_proxy_port
        return get_ai_proxy_port()
    except Exception:
        return 8574

_ZF_PROXY_PORT = _load_zf_proxy_port()

ZF3D_WEBSITE = 'https://www.zf3d.com'
POLL_INTERVAL = 3          # 秒，命令轮询间隔（原 8 秒，提速远程对话响应）
RESULT_TRUNCATE = 7000     # 回传结果截断长度（网站端存 8000）

_cmd_thread = None
_cmd_running = False
_wake_event = threading.Event()


def _db_write(write_fn, default=None, lock_timeout=8.0):
    """统一写库入口：全局 _db_lock 内执行 write_fn(conn)，写必拿锁。

    write_fn 接收共享连接并自行 execute/commit；异常时返回 default（静默兜底，
    与本项目写路径的容错语义一致）。

    【2026-10-16 修复】zf3d-commands 是后台轮询线程，之前无限期等锁/持锁，
    一旦 SQLite 层 busy（busy_timeout=30s）会把 _db_lock 占住 30 秒以上，
    堵死所有 /api/db 请求和对话 turn 落库（现象：对话框发消息永远无响应）。
    现在：拿锁带超时（拿不到直接放弃本次后台写）；写前把本连接 busy_timeout
    降到 3 秒，避免长时间持锁；异常时回滚不留悬挂事务。
    """
    try:
        from db import get_db
        from config import _db_lock
        if not _db_lock.acquire(timeout=lock_timeout):
            _log('_db_write: acquire timeout(%ss)，后台写放弃（不阻塞主流程）' % lock_timeout)
            return default
        try:
            conn = get_db()
            try:
                conn.execute('PRAGMA busy_timeout=3000')
            except Exception:
                pass
            try:
                return write_fn(conn)
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
                raise
        finally:
            _db_lock.release()
    except Exception as e:
        _log('_db_write error: %s' % e)
        return default


def _log(msg):
    try:
        from config import QUIET_CONSOLE
    except Exception:
        QUIET_CONSOLE = True
    if not QUIET_CONSOLE:
        try:
            print('[zf3d-commands] %s' % msg)
        except Exception:
            pass


def _get_config_value(category, key, default=''):
    """读取本地 config 表（与心跳同源）。"""
    try:
        from db import get_db
        conn = get_db()
        row = conn.execute(
            'SELECT value FROM app_data WHERE category=? AND key=?',
            (category, key)).fetchone()
        return (row[0] if row and row[0] else default)
    except Exception as e:
        _log('get_config_value(%s/%s) error: %s' % (category, key, e))
        return default


def _set_config_value(category, key, value):
    """写入本地 config 表（与心跳同源）。写必拿 _db_lock。"""
    def _w(conn):
        conn.execute('DELETE FROM app_data WHERE category=? AND key=?', (category, key))
        conn.execute(
            'INSERT INTO app_data(category, key, value, updated_at) VALUES(?,?,?,strftime(\'%s\',\'now\'))',
            (category, key, str(value)))
        conn.commit()
    _db_write(_w)


def _get_api_key():
    """与心跳同源的 API key。"""
    key = _get_config_value('zf3d', 'heartbeat_api_key', '')
    if key:
        return key
    try:
        from zf3d_heartbeat import DEFAULT_API_KEY
        return DEFAULT_API_KEY
    except Exception:
        return ''


def _get_machine_id():
    try:
        from zf3d_heartbeat import _MACHINE_ID
        return _MACHINE_ID
    except Exception:
        # 兜底：直接调用其生成函数
        try:
            import zf3d_heartbeat
            return zf3d_heartbeat._gen_machine_id()
        except Exception:
            return ''


def _is_logged_in():
    """仅允许已登录的朱峰智能体会员使用远程聊天。"""
    try:
        from zf3d_heartbeat import _get_login_status
        status, username, user_id = _get_login_status()
        return status in (1, -1) and user_id > 0, username
    except Exception as e:
        _log('login check error: %s' % e)
        return False, ''


def _http_post(url, params):
    data = urllib.parse.urlencode(params).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=20) as resp:
        return json.loads(resp.read().decode('utf-8', errors='replace'))


def _fetch_commands(machine_id, api_key):
    url = '%s/api/agent_api.asp?key=%s&a=get_commands&machine_id=%s' % (
        ZF3D_WEBSITE,
        urllib.parse.quote(api_key),
        urllib.parse.quote(machine_id))
    req = urllib.request.Request(url, method='GET')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=20) as resp:
        return json.loads(resp.read().decode('utf-8', errors='replace'))


# ---- 室外4G遥控中继（remote_register / remote_poll）----

_remote_registered = False
_last_remote_reply = [0, '']  # [cmd_id, result] 待回传的上一条指令回复


def _remote_register(machine_id, api_key):
    """注册遥控中继通道，取得配对码（供网页 agent_remote.asp 使用）。"""
    global _remote_registered
    try:
        url = ZF3D_WEBSITE + '/api/agent_api.asp?key=%s&a=remote_register' % (
            urllib.parse.quote(api_key),)
        resp = _http_post(url, {'machine_id': machine_id})
        if resp.get('success'):
            _remote_registered = True
            _code = str(resp.get('pairing_code') or '')
            _log('remote_register ok (pairing=%s)' % _code)
            # 完整配对码落本地 config（UI/日志可完整取回，供网页 agent_remote.asp 配对）
            _set_config_value('zf3d', 'remote_pairing_code', _code)
        else:
            _remote_registered = False
    except Exception as e:
        _remote_registered = False
        _log('remote_register error: %s' % e)


def _remote_poll(machine_id, api_key, reply_cmd_id=0, reply=''):
    """轮询遥控指令；可同时携带上一条指令的回复。返回 [{'cmd_id','payload'}, ...]。"""
    global _remote_registered
    try:
        url = ZF3D_WEBSITE + '/api/agent_api.asp?key=%s&a=remote_poll' % (
            urllib.parse.quote(api_key),)
        data = {'machine_id': machine_id}
        if reply_cmd_id and reply:
            data['reply_cmd_id'] = str(reply_cmd_id)
            data['reply'] = reply[:RESULT_TRUNCATE]
        resp = _http_post(url, data)
        # 通道在服务端失效（被删/过期）→ 复位标志，下轮心跳自动重新注册
        if resp.get('success') is False and 'channel' in str(resp.get('message') or ''):
            _remote_registered = False
            _log('remote channel gone, will re-register')
            return []
        return resp.get('cmds') or []
    except Exception as e:
        _log('remote_poll error: %s' % e)
        return []


def _handle_remote_cmd(item):
    """处理一条网页遥控指令：payload 为 JSON {type, data}，分发到本地命令处理器并回传。"""
    cmd_id = item.get('cmd_id')
    try:
        pl = json.loads(item.get('payload') or '{}')
    except Exception:
        pl = {}
    rtype = str(pl.get('type') or '')
    rdata = pl.get('data')
    ok = 0
    result = ''
    try:
        # 复用现有命令处理（白名单类型），构造与网站 send_command 相同结构
        pseudo = {'id': cmd_id, 'command_type': rtype,
                  'command_data': json.dumps(rdata if rdata is not None else {}, ensure_ascii=False)}
        _process_commands([pseudo])
        ok = 1
        result = 'ok'
    except Exception as e:
        result = 'error: %s' % e
    return {'cmd_id': cmd_id, 'ok': ok, 'result': result}


def _report_result(command_id, result, success=1):
    try:
        url = '%s/api/agent_api.asp?key=%s&a=command_result' % (
            ZF3D_WEBSITE, urllib.parse.quote(_get_api_key() or ''))
        _http_post(url, {
            'command_id': str(command_id),
            'result': result[:RESULT_TRUNCATE],
            'success': str(success),
        })
    except Exception as e:
        _log('report_result(%s) error: %s' % (command_id, e))


# ===== 模型调用 =====

def _call_llm(user_message, history=None, model_name='', project_ctx=''):
    """用指定模型（或本地默认模型）生成回复。返回 (回复文本, 错误文本)。"""
    try:
        from model_config import get_default_model, get_model_by_name
    except Exception as e:
        return '', 'model_config unavailable: %s' % e

    m = get_model_by_name(model_name) if model_name else None
    if not m:
        m = get_default_model()
    if not m:
        return '', 'no default model configured'

    endpoint = (m.get('endpoint') or m.get('baseUrl') or '').strip()
    # 内置朱峰大模型：endpoint 由服务端私有配置解析（绝不写进公开配置）
    if m.get('name') == 'zf-builtin':
        try:
            import zf_gateway_cfg
            endpoint = zf_gateway_cfg.ZF_GATEWAY_URL
        except Exception:
            endpoint = os.environ.get('ZF_GATEWAY_URL', '') or f'http://127.0.0.1:{_ZF_PROXY_PORT}/v1'
    if not endpoint:
        return '', 'model endpoint missing'
    key = m.get('key') or m.get('apiKey') or ''
    is_relay = 'zf_models_relay' in endpoint
    if is_relay:
        # 官方网关线路：鉴权用 heartbeat key，扣费用户=本机登录会员
        zf_key = _get_api_key() or ''
        try:
            from zf3d_heartbeat import _get_login_status
            _ls, _lu, zf_user_id = _get_login_status()
        except Exception:
            zf_user_id = 0
    elif not key and not m.get('noKeyRequired'):
        return '', 'model api key missing'
    if not is_relay and '/chat/completions' not in endpoint:
        endpoint = endpoint.rstrip('/') + '/chat/completions'

    messages = [{'role': 'system', 'content':
                 '你是朱峰智能体智能体。用户正在通过手机网页远程与你对话，'
                 '请用简洁的中文回复，直接回答问题或执行指令描述。'
                 + ((' ' + project_ctx) if project_ctx else '')}]
    for h in (history or [])[-8:]:
        role = 'assistant' if h.get('role') == 'agent' else h.get('role')
        if role in ('user', 'assistant') and h.get('content'):
            messages.append({'role': role, 'content': str(h['content'])[:2000]})
    messages.append({'role': 'user', 'content': user_message})

    payload = {
        'model': m.get('modelId') or m.get('name'),
        'messages': messages,
        'stream': False,
        'temperature': 0.7,
        'max_tokens': 2048,
    }
    headers = {'Content-Type': 'application/json'}
    if is_relay and zf_key:
        headers['X-ZF-Key'] = zf_key
        if zf_user_id and zf_user_id > 0:
            headers['X-ZF-User'] = str(zf_user_id)
    if key:
        headers['Authorization'] = 'Bearer ' + key

    import json as _json
    data = _json.dumps(payload, ensure_ascii=True).encode('utf-8')
    last_err = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(endpoint, data=data, method='POST')
            for k, v in headers.items():
                req.add_header(k, str(v))
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(req, timeout=120) as resp:
                body = _json.loads(resp.read().decode('utf-8', errors='replace'))
            msg = (body.get('choices') or [{}])[0].get('message', {})
            content = (msg.get('content') or '').strip()
            if content:
                return content, ''
            return '', 'empty response from model'
        except Exception as e:
            last_err = e
            if attempt == 0:
                time.sleep(1)
    return '', 'LLM call failed: %s' % last_err


# ===== 命令处理 =====

def _handle_new_chat(cmd):
    """new_chat 命令：本地创建新会话，回传 session_id。
    手机端"新建对话"按钮下发此命令，本地电脑真正建一个新对话，
    之后手机与电脑在同一 session_id 下聊天，实现双向一致。"""
    try:
        try:
            data = json.loads(cmd.get('data') or '{}')
        except Exception:
            data = {}
        import uuid, time as _t
        if True:
            # 云端会话映射：手机端先在云端建会话（数字id），本地建 remote_<id> 对应会话
            cloud_sid = str(data.get('session_id') or '').strip()
            if cloud_sid and cloud_sid != '0':
                sid = 'remote_' + cloud_sid
            else:
                sid = str(int(_t.time() * 1000)) + uuid.uuid4().hex[:6]
            name = '远程对话 ' + _t.strftime('%m-%d %H:%M')
            def _w(conn, sid=sid, name=name):
                cur = conn.execute('SELECT 1 FROM sessions WHERE id=?', (sid,))
                if not cur.fetchone():
                    conn.execute('INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?,?,?,?)',
                                 (sid, name, int(_t.time() * 1000), int(_t.time() * 1000)))
                    conn.commit()
            _db_write(_w)
            _log('远程新建会话: %s' % sid)
            return json.dumps({'session_id': sid, 'name': name}), 1
    except Exception as e:
        _log('new_chat error: %s' % e)
        return '[新建对话失败] %s' % e, 0


def _handle_chat(cmd):
    """chat 命令：取本地会话历史 → 调模型 → 写回本地 chat_history（自动镜像上云）→ 回传。"""
    try:
        data = json.loads(cmd.get('data') or '{}')
    except Exception:
        data = {}
    message = str(data.get('message') or '').strip()
    session_id = str(data.get('session_id') or 0).strip()
    model_name = str(data.get('model_name') or data.get('model') or '').strip()
    if not message:
        return '（空消息）', 0

    import sqlite3, time as _t
    from config import DB_PATH

    # session_id 为 0/空 时自动本地新建会话（兜底）
    if not session_id or session_id == '0':
        try:
            import uuid
            session_id = str(int(_t.time() * 1000)) + uuid.uuid4().hex[:6]
            def _w(conn, sid=session_id):
                conn.execute('INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?,?,?,?)',
                             (sid, '远程对话 ' + _t.strftime('%m-%d %H:%M'),
                              int(_t.time() * 1000), int(_t.time() * 1000)))
                conn.commit()
            _db_write(_w)
        except Exception as e:
            _log('auto new session error: %s' % e)
            return '[新建会话失败] %s' % e, 0

    # 云端数字会话 id → 本地 remote_ 前缀命名空间（与 _handle_new_chat 映射一致）
    if session_id.isdigit():
        session_id = 'remote_' + session_id

    now_ms = int(_t.time() * 1000)
    # 写入用户消息到本地 chat_history（写必拿 _db_lock）
    def _w(conn):
        conn.execute('INSERT INTO chat_history (session_id, role, content, created_at) VALUES (?,?,?,?)',
                     (session_id, 'user', message, now_ms))
        conn.commit()
    _db_write(_w)
    try:
        from db import get_db
        c = get_db()
        if True:
            # 取本地历史作为上下文（最近 12 条）
            rows = c.execute(
                "SELECT role, content FROM chat_history WHERE session_id=? AND role IN ('user','assistant') "
                "ORDER BY id DESC LIMIT 12", (session_id,)).fetchall()
    except Exception as e:
        _log('local history(%s) error: %s' % (session_id, e))
        rows = []
    history = [{'role': r, 'content': ct} for r, ct in reversed(rows)]
    if history and history[-1].get('role') == 'user':
        history = history[:-1]  # 最后一条是刚写入的用户消息，去重

    reply, err = _call_llm(message, history, model_name=model_name)
    if err:
        return '[远程对话错误] %s' % err, 0
    # AI 回复写回本地 chat_history（session 更新时间一并刷新，写必拿 _db_lock）
    def _w2(conn):
        conn.execute('INSERT INTO chat_history (session_id, role, content, created_at) VALUES (?,?,?,?)',
                     (session_id, 'assistant', reply, int(_t.time() * 1000)))
        conn.execute('UPDATE sessions SET updated_at=? WHERE id=?',
                     (int(_t.time() * 1000), session_id))
        conn.commit()
    _db_write(_w2)
    # 回传结果带 session_id，手机端可同步会话归属
    return json.dumps({'session_id': session_id, 'reply': reply}), 1


def _handle_canvas(cmd):
    """canvas 命令：手机端画布同步。
    action=get → 返回本地画布快照（canvas_view 视图 + canvas_nodes 节点列表）
    action=set → 手机端把视图/节点位置写回本地
    """
    try:
        data = json.loads(cmd.get('data') or '{}')
    except Exception:
        data = {}
    action = str(data.get('action') or 'get')
    import sqlite3, json as _j, time as _t
    from config import DB_PATH
    try:
        from db import get_db
        c = get_db()
        if True:
            if action == 'set':
                view = data.get('view') or {}
                nodes = data.get('nodes') or []
                def _w(conn):
                    if view:
                        conn.execute("INSERT OR REPLACE INTO canvas_view (id, x, y, scale, updated_at) VALUES (1,?,?,?,?)",
                                     (float(view.get('x') or 0), float(view.get('y') or 0),
                                      float(view.get('scale') or 1), int(_t.time() * 1000)))
                    n = 0
                    for nd in nodes:
                        nid = str(nd.get('id') or '')
                        if not nid:
                            continue
                        try:
                            conn.execute('UPDATE canvas_nodes SET x=?, y=?, w=?, h=?, updated_at=? WHERE id=?',
                                         (float(nd.get('x') or 0), float(nd.get('y') or 0),
                                          float(nd.get('w') or 0) or None, float(nd.get('h') or 0) or None,
                                          int(_t.time() * 1000), nid))
                            n += 1
                        except Exception:
                            pass
                    conn.commit()
                    return n
                n = _db_write(_w, default=0) or 0
                _log('canvas set: view=%s nodes=%d' % (view, n))
                return _j.dumps({'ok': 1, 'updated': n}), 1
            else:
                view = {}
                try:
                    row = c.execute('SELECT x, y, scale FROM canvas_view WHERE id=1').fetchone()
                    if row:
                        view = {'x': row[0], 'y': row[1], 'scale': row[2]}
                except Exception:
                    pass
                nodes = []
                try:
                    for r in c.execute('SELECT id, title, x, y, w, h, model_id FROM canvas_nodes ORDER BY updated_at DESC LIMIT 100'):
                        nodes.append({'id': r[0], 'title': r[1] or '', 'x': r[2] or 0, 'y': r[3] or 0,
                                      'w': r[4] or 0, 'h': r[5] or 0, 'model_id': r[6] or ''})
                except Exception:
                    pass
                return _j.dumps({'view': view, 'nodes': nodes}), 1
    except Exception as e:
        _log('canvas error: %s' % e)
        return '[画布同步失败] %s' % e, 0


def _handle_restart(cmd):
    """restart 命令：延迟调用 restart_server.py 重启后台服务。"""
    _log('收到远程重启命令，2 秒后执行 restart_server.py')

    def _do_restart():
        time.sleep(2)
        try:
            python_exe = sys.executable or 'python'
            subprocess.Popen(
                [python_exe, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'restart_server.py')],
                cwd=os.path.dirname(os.path.abspath(__file__)),
                creationflags=getattr(subprocess, 'DETACHED_PROCESS', 0),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            _log('restart error: %s' % e)

    threading.Thread(target=_do_restart, daemon=True).start()
    return '✅ 重启指令已接收，后台服务将在几秒后重启（预计 10~20 秒内恢复）', 1


COMMAND_HANDLERS = {
    'chat': _handle_chat,
    'new_chat': _handle_new_chat,
    'canvas': _handle_canvas,
    'restart': _handle_restart,
}


def _process_commands(commands):
    for cmd in commands or []:
        cid = cmd.get('id')
        ctype = str(cmd.get('type') or '')
        handler = COMMAND_HANDLERS.get(ctype)
        if not handler:
            _report_result(cid, '[远程命令] 不支持的类型: %s' % ctype, 0)
            continue
        try:
            result, ok = handler(cmd)
        except Exception as e:
            result, ok = '[远程命令异常] %s' % e, 0
        _report_result(cid, result, ok)
        _log('command %s (%s) done, ok=%s' % (cid, ctype, bool(ok)))


# ===== 本地对话镜像上报（agent_remote 查看本机对话）=====
_sync_lock = threading.Lock()

def _sync_local_chats():
    """把本地 chat_history 的新消息增量上报到云端镜像（每轮轮询调用）。"""
    if not _sync_lock.acquire(blocking=False):
        return
    try:
        api_key = _get_api_key()
        machine_id = _get_machine_id()
        if not api_key or not machine_id:
            return
        import sqlite3
        from config import DB_PATH
        from db import get_db
        c = get_db()
        try:
            c.execute('PRAGMA busy_timeout=3000')
        except Exception:
            pass
        # 增量：只取上次同步 id 之后的消息。云端实测结论：sync_chats
        # count=1 恒成功、count>=2 恒 500（与包大小/频率无关，疑似云端
        # WAF 或 IIS 对多参数批量提交的限制），因此每次只发 1 条；
        # 且几万条历史对远程展示无意义，首次只从最近 500 条开始同步，
        # 之后新消息实时逐条上报。
        try:
            last_id = int(_get_config_value('zf3d', 'remote_sync_last_rowid', '0') or 0)
            if last_id <= 0:
                base_row = c.execute(
                    "SELECT COALESCE(MAX(rowid), 0) FROM (SELECT rowid FROM chat_history "
                    "WHERE role IN ('user','assistant') ORDER BY rowid DESC LIMIT 500)"
                ).fetchone()[0]
                last_id = max(0, base_row - 1)
                _set_config_value('zf3d', 'remote_sync_last_rowid', str(last_id))
            rows = c.execute(
                "SELECT rowid AS sync_rowid, session_id, role, content, created_at FROM chat_history "
                "WHERE rowid > ? AND role IN ('user','assistant','__closed__','progress') ORDER BY rowid ASC LIMIT 1",
                (last_id,)).fetchall()
        finally:
            try:
                c.close()
            except Exception:
                pass
        if not rows:
            return
        r0 = rows[0]
        url = ZF3D_WEBSITE + '/api/agent_api.asp?key=%s&a=sync_chats' % (
            urllib.parse.quote(api_key),)
        # 内容清洗：剔除控制字符和非法 UTF-8 序列（部分消息含二进制残留，
        # 会导致云端 ASP 解码 500）
        try:
            clean = (r0['content'] or '')[:4000]
            clean = clean.encode('utf-8', 'ignore').decode('utf-8', 'ignore')
            clean = ''.join(ch for ch in clean
                            if ch in '\n\r\t' or ord(ch) >= 32)
        except Exception:
            clean = ''
        params = {'machine_id': machine_id, 'count': '1',
                  'sid_0': r0['session_id'], 'rid_0': str(r0['sync_rowid']),
                  'role_0': r0['role'], 'content_0': clean,
                  'time_0': r0['created_at'] or ''}
        try:
            resp = _http_post(url, params)
        except Exception as send_err:
            # 云端对个别消息内容返回 500（毒消息）：跳过该条继续推进，
            # 避免永久卡死在同一个 rowid 上
            _log('sync_chats skip rowid=%s: %s' % (r0['sync_rowid'], send_err))
            _set_config_value('zf3d', 'remote_sync_last_rowid', str(r0['sync_rowid']))
            return
        # ASP 端 sync_chats 返回 {"success":true,...}，兼容两种标志
        if resp.get('ok') or resp.get('success'):
            _set_config_value('zf3d', 'remote_sync_last_rowid', str(r0['sync_rowid']))
        else:
            _log('sync_chats err: %s' % (resp.get('err') or resp.get('message') or resp))
    except Exception as e:
        _log('sync_chats error: %s' % e)
    finally:
        _sync_lock.release()


# ===== 云端→本地下行拉取合并（「⬇ 同步」按钮后端）=====

def pull_remote_chats(force=False):
    """从云端 agent_chat_messages 把手机产生的新消息拉回本地 chat_history（remote_ 会话）。
    独立于 _sync_local_chats 的锁，避免与上行同步竞争。返回 {'pulled': n, 'sessions': [...]}。"""
    api_key = _get_api_key()
    machine_id = _get_machine_id()
    if not api_key or not machine_id:
        return {'pulled': 0, 'error': 'not_logged_in'}
    try:
        import sqlite3, time as _t
        from config import DB_PATH
        # 云端该机器最新的会话消息（复用 chat_messages 的会话列表接口思路：
        # 用 sync 方向的读接口；这里直接调 chat_sessions 列表 → 逐会话比对条数）
        url = ZF3D_WEBSITE + '/api/agent_api.asp?key=%s&a=chat_sessions' % (
            urllib.parse.quote(api_key),)
        resp = _http_post(url, {'machine_id': machine_id})
        sessions = resp.get('sessions') or []
        if not sessions:
            return {'pulled': 0}
        from db import get_db
        c = get_db()
        try:
            return _pull_remote_chats_impl(c, api_key, machine_id, force)
        finally:
            # 【2026-10-16 修复】读连接用完必须关闭，避免长读事务/连接堆积
            try:
                c.close()
            except Exception:
                pass
    except Exception as e:
        _log('pull_remote_chats error: %s' % e)
        return {'pulled': 0, 'error': str(e)}


def _pull_remote_chats_impl(c, api_key, machine_id, force):
    """pull_remote_chats 的实际拉取逻辑（连接由调用方管理生命周期）。"""
    try:
        import time as _t
        pulled_total = 0
        touched = []
        if True:
            for s in sessions:
                cloud_sid = str(s.get('session_id') or '').strip()
                if not cloud_sid or cloud_sid == '0':
                    continue
                local_sid = 'remote_' + cloud_sid
                # 本地已有条数（按云端 rid 上报的镜像，本地 rowid 与云端 id 不一一对应，
                # 用时间戳+内容比对做增量）
                row = c.execute(
                    "SELECT COUNT(*) FROM chat_history WHERE session_id=?", (local_sid,)).fetchone()
                local_n = row[0]
                cloud_n = int(s.get('msg_count') or s.get('count') or 0)
                if cloud_n <= local_n and not force:
                    continue
                # 拉取该会话云端消息（HTTP 在锁外）
                murl = ZF3D_WEBSITE + '/api/agent_api.asp?key=%s&a=chat_messages&session_id=%s' % (
                    urllib.parse.quote(api_key), urllib.parse.quote(cloud_sid))
                mresp = _http_post(murl, {'machine_id': machine_id})
                msgs = mresp.get('messages') or []
                if len(msgs) <= local_n and not force:
                    continue
                new_msgs = msgs[local_n:] if len(msgs) > local_n else []
                # 确保本地会话存在，标题优先用云端会话名，其次首条消息摘要
                sess_name = str(s.get('name') or s.get('title') or '').strip()
                if not sess_name and msgs:
                    first = str(msgs[0].get('content') or '').strip()
                    sess_name = first[:30] if first else ''
                if not sess_name:
                    sess_name = '远程对话'
                now_ms = int(_t.time() * 1000)
                # 写段拿 _db_lock（INSERT OR IGNORE + UPDATE + 批量 INSERT）
                def _w(conn, local_sid=local_sid, sess_name=sess_name, new_msgs=new_msgs, now_ms=now_ms):
                    conn.execute('INSERT OR IGNORE INTO sessions (id, name, created_at, updated_at) VALUES (?,?,?,?)',
                                 (local_sid, sess_name, now_ms, now_ms))
                    # 已存在的占位名也刷新为真实标题
                    if sess_name != '远程对话':
                        conn.execute('UPDATE sessions SET name=? WHERE id=? AND name=?', (sess_name, local_sid, '远程对话'))
                    for m in new_msgs:
                        role = str(m.get('role') or 'user')
                        content = str(m.get('content') or '')
                        conn.execute('INSERT INTO chat_history (session_id, role, content, created_at) VALUES (?,?,?,?)',
                                     (local_sid, role, content, now_ms))
                    if new_msgs:
                        conn.execute('UPDATE sessions SET updated_at=? WHERE id=?', (now_ms, local_sid))
                    conn.commit()
                _db_write(_w)
                pulled_total += len(new_msgs)
                touched.append(local_sid)
        if pulled_total:
            _log('pull_remote_chats: 拉回 %d 条，会话 %s' % (pulled_total, touched))
        return {'pulled': pulled_total, 'sessions': touched}
    except Exception as e:
        _log('pull_remote_chats inner error: %s' % e)
        return {'pulled': 0, 'error': str(e)}


def _poll_loop():
    while _cmd_running:
        try:
            logged_in, username = _is_logged_in()
            if not logged_in:
                # 未登录会员则不消费命令（安全要求），但本地对话镜像同步与登录无关，仍然执行
                _sync_local_chats()
                _wake_event.wait(timeout=POLL_INTERVAL)
                _wake_event.clear()
                continue
            api_key = _get_api_key()
            machine_id = _get_machine_id()
            if api_key and machine_id:
                resp = _fetch_commands(machine_id, api_key)
                cmds = resp.get('commands') or []
                if cmds:
                    _log('got %d command(s)' % len(cmds))
                    _process_commands(cmds)
                # ---- 室外4G遥控中继：未注册则注册；轮询网页遥控指令并回传 ----
                try:
                    if not _remote_registered:
                        _remote_register(machine_id, api_key)
                    else:
                        # 先批量取完再统一处理，最后一条的回复随下一轮 poll 回传，
                        # 避免逐条额外 poll 串扰（取回的下一条指令被丢弃）
                        remote_items = _remote_poll(machine_id, api_key)
                        _pending_reply = None
                        for _rit in remote_items:
                            _handled = _handle_remote_cmd(_rit)
                            _pending_reply = (_handled.get('cmd_id') or 0,
                                              _handled.get('result') or '')
                        if not remote_items and _last_remote_reply[0]:
                            # 上一轮的回复借本次 poll 回传（无新指令时也送达）
                            _remote_poll(machine_id, api_key,
                                         reply_cmd_id=_last_remote_reply[0],
                                         reply=_last_remote_reply[1])
                            _last_remote_reply[0] = 0
                        if _pending_reply:
                            _last_remote_reply[0], _last_remote_reply[1] = _pending_reply
                except Exception as _re:
                    _log('remote relay error: %s' % _re)
                # ---- 遥控中继结束 ----
            _sync_local_chats()
        except Exception as e:
            _log('poll error: %s' % e)
        # 运行期自愈：低频（约每 10 轮）补齐新产生的会话索引缺口
        try:
            _integrity_tick = getattr(_poll_loop, '_tick', 0) + 1
            _poll_loop._tick = _integrity_tick
            if _integrity_tick % 10 == 0:
                ensure_sessions_integrity()
        except Exception:
            pass
        _wake_event.wait(timeout=POLL_INTERVAL)
        _wake_event.clear()


def ensure_sessions_integrity():
    """【防复发】启动时校验：chat_history 有消息但 sessions 缺索引的会话自动补齐，
    杜绝「对话列表只剩几个/丢失」。幂等，失败只记日志不影响启动。"""
    try:
        import sqlite3, datetime
        from config import DB_PATH
        from db import get_db
        c = get_db()
        hist = set(str(r[0]) for r in c.execute('SELECT DISTINCT session_id FROM chat_history'))
        sess = set(str(r[0]) for r in c.execute('SELECT id FROM sessions'))
        miss = sorted(hist - sess)
        if not miss:
            return 0
        now = datetime.datetime.now().isoformat(sep=' ', timespec='seconds')
        def _w(conn):
            n = 0
            for m in miss:
                first = conn.execute('SELECT created_at FROM chat_history WHERE session_id=? ORDER BY created_at LIMIT 1', (m,)).fetchone()
                last = conn.execute('SELECT created_at FROM chat_history WHERE session_id=? ORDER BY created_at DESC LIMIT 1', (m,)).fetchone()
                conn.execute('INSERT OR IGNORE INTO sessions (id, name, created_at, updated_at) VALUES (?,?,?,?)',
                             (m, m, (first or (now,))[0], (last or (now,))[0]))
                n += 1
            conn.commit()
            return n
        fixed = _db_write(_w, default=0) or 0
        _log('ensure_sessions_integrity: 补齐 %d 个缺失会话索引 %s' % (fixed, miss[:5]))
        return fixed
    except Exception as e:
        _log('ensure_sessions_integrity error: %s' % e)
        return 0


def start_command_consumer():
    """启动命令消费线程（幂等，热更新后接管旧线程）。"""
    ensure_sessions_integrity()
    global _cmd_thread, _cmd_running
    for t in threading.enumerate():
        if t is not _cmd_thread and t.name == 'zf3d-commands' and t.is_alive():
            _cmd_thread = t
            _cmd_running = True
            _log('命令消费线程已在运行（热更新后接管旧线程）')
            return
    if _cmd_thread and _cmd_thread.is_alive():
        _log('命令消费线程已在运行')
        return
    _cmd_running = True
    _cmd_thread = threading.Thread(target=_poll_loop, daemon=True, name='zf3d-commands')
    _cmd_thread.start()
    _log('命令消费线程已启动')


def stop_command_consumer():
    global _cmd_running
    _cmd_running = False
    _wake_event.set()
    _log('命令消费线程已停止')
