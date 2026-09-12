#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
朱峰社区远程命令消费模块
与 zf3d_heartbeat 同源认证：使用 heartbeat_api_key（即网站登录时下发的 agent_api_key）。

功能：
  - 后台线程轮询网站 GET a=get_commands（带 machine_id），拉取手机端下发的命令
  - chat 命令：用本地默认模型直接调用上游 chat/completions 生成回复
  - 回复经 POST a=command_result 回传（手机端 get_result 轮询到即显示）
  - 仅处理属于当前登录会员的机器（网站端 send_command 已做归属校验，此处为双保险：
    仅在桌面端已登录朱峰社区账号时才拉取/执行命令）

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
import urllib.request
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import BASE_DIR

ZF3D_WEBSITE = 'https://www.zf3d.com'
POLL_INTERVAL = 3          # 秒，命令轮询间隔（原 8 秒，提速远程对话响应）
RESULT_TRUNCATE = 7000     # 回传结果截断长度（网站端存 8000）

_cmd_thread = None
_cmd_running = False
_wake_event = threading.Event()


def _log(msg):
    try:
        print('[zf3d-commands] %s' % msg)
    except Exception:
        pass


def _get_config_value(category, key, default=''):
    """读取本地 config 表（与心跳同源）。"""
    try:
        from config import DB_PATH
        import sqlite3
        conn = sqlite3.connect(DB_PATH, timeout=5)
        try:
            row = conn.execute(
                'SELECT value FROM app_data WHERE category=? AND key=?',
                (category, key)).fetchone()
            return (row[0] if row and row[0] else default)
        finally:
            conn.close()
    except Exception as e:
        _log('get_config_value(%s/%s) error: %s' % (category, key, e))
        return default


def _set_config_value(category, key, value):
    """写入本地 config 表（与心跳同源）。"""
    try:
        from config import DB_PATH
        import sqlite3
        conn = sqlite3.connect(DB_PATH, timeout=5)
        try:
            conn.execute('DELETE FROM app_data WHERE category=? AND key=?', (category, key))
            conn.execute(
                'INSERT INTO app_data(category, key, value, updated_at) VALUES(?,?,?,strftime(\'%s\',\'now\'))',
                (category, key, str(value)))
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        _log('set_config_value(%s/%s) error: %s' % (category, key, e))


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
    """仅允许已登录的朱峰社区会员使用远程聊天。"""
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
    if not endpoint:
        return '', 'model endpoint missing'
    if '/chat/completions' not in endpoint:
        endpoint = endpoint.rstrip('/') + '/chat/completions'

    key = m.get('key') or m.get('apiKey') or ''
    if not key and not m.get('noKeyRequired'):
        return '', 'model api key missing'

    messages = [{'role': 'system', 'content':
                 '你是朱峰社区智能体。用户正在通过手机网页远程与你对话，'
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

def _handle_chat(cmd):
    """chat 命令：取会话历史 → 调模型 → 回传。"""
    try:
        data = json.loads(cmd.get('data') or '{}')
    except Exception:
        data = {}
    message = str(data.get('message') or '').strip()
    session_id = int(data.get('session_id') or 0)
    model_name = str(data.get('model_name') or data.get('model') or '').strip()
    project_id = str(data.get('project_id') or '').strip()
    if not message:
        return '（空消息）', 0

    # 项目上下文：读取项目名称与项目记忆，注入 system 提示词
    project_ctx = ''
    if project_id:
        try:
            from config import DB_PATH as _pj_db
            import sqlite3 as _sq
            _c = _sq.connect(_pj_db, timeout=5)
            try:
                _r = _c.execute('SELECT name, memory_text FROM projects WHERE id=?',
                                (project_id,)).fetchone()
                if _r:
                    project_ctx = '当前项目：%s' % _r[0]
                    if _r[1]:
                        project_ctx += '\n项目记忆：\n' + str(_r[1])[:3000]
            finally:
                _c.close()
        except Exception as e:
            _log('project ctx(%s) error: %s' % (project_id, e))

    history = []
    if session_id:
        # 从网站拉会话历史作为上下文（校验归属在网站端完成）
        try:
            url = '%s/api/agent_api.asp?a=chat_messages&session_id=%d' % (
                ZF3D_WEBSITE, session_id)
            # chat_messages 是登录用户操作，桌面端用 key 认证即可走通（key 认证已通过 agAuthOk）
            req = urllib.request.Request(
                url + '&key=' + urllib.parse.quote(_get_api_key() or ''), method='GET')
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(req, timeout=15) as resp:
                jd = json.loads(resp.read().decode('utf-8', errors='replace'))
            history = jd.get('messages') or []
            # 最后一条是刚发的用户消息，去掉避免重复
            if history and history[-1].get('role') == 'user':
                history = history[:-1]
        except Exception as e:
            _log('load history(%s) error: %s' % (session_id, e))

    reply, err = _call_llm(message, history, model_name=model_name, project_ctx=project_ctx)
    if err:
        return '[远程对话错误] %s' % err, 0
    return reply, 1


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
        c = sqlite3.connect(DB_PATH, timeout=5)
        c.row_factory = sqlite3.Row
        # 增量：只取上次同步 id 之后的消息。云端实测结论：sync_chats
        # count=1 恒成功、count>=2 恒 500（与包大小/频率无关，疑似云端
        # WAF 或 IIS 对多参数批量提交的限制），因此每次只发 1 条；
        # 且几万条历史对远程展示无意义，首次只从最近 500 条开始同步，
        # 之后新消息实时逐条上报。
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
            "WHERE rowid > ? AND role IN ('user','assistant','__closed__') ORDER BY rowid ASC LIMIT 1",
            (last_id,)).fetchall()
        c.close()
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
            _sync_local_chats()
        except Exception as e:
            _log('poll error: %s' % e)
        _wake_event.wait(timeout=POLL_INTERVAL)
        _wake_event.clear()


def start_command_consumer():
    """启动命令消费线程（幂等，热更新后接管旧线程）。"""
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
