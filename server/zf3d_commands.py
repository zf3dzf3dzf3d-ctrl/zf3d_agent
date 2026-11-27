#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
朱峰智能体远程命令消费模块
与 zf3d_heartbeat 同源认证：使用 heartbeat_api_key（即网站登录时下发的 agent_api_key）。

功能：
  - 【2026-11-09】朱峰网站控制智能体通道（a=get_commands 网页 send_command 下发命令）已移除
  - 保留峰控遥控器中继：remote_register/remote_poll 轮询手机/网页遥控指令并回传
  - 保留双端对话同步：_sync_local_chats 上行镜像 + pull_remote_chats 下行拉回
  - chat 命令：用本地默认模型直接调用上游 chat/completions 生成回复
  - 仅在桌面端已登录朱峰智能体账号时才消费遥控指令

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

from util_log import get_logger

log = get_logger('zf3d_commands')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import BASE_DIR

# 端口集中配置：统一走 config.get_ai_proxy_port()（与代理实际监听同源，杜绝双源分叉）
def _load_zf_proxy_port():
    try:
        from config import get_ai_proxy_port
        return get_ai_proxy_port()
    except Exception:
        return 8624

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
            log.info('[zf3d-commands] %s' % msg)
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
    """与心跳同源的 API key。
    【隐私整改 2026-11-05】移除 DEFAULT_API_KEY 默认 key 回退：
    未登录且未配置 key 时不做任何外发（此前回退默认 key 会在登出后继续上传对话）。
    【2026-11-22 对齐取键优先级】与 zf3d_heartbeat / zf_model_sync 同一优先级：
    数据库 zf3d/heartbeat_api_key > private/heartbeat_key.json（用户手工配置的自带 key）。
    此前本函数只读数据库，导致 relay-proxy 在同机有 json key 的情况下仍不带
    X-ZF-Key 出网 → 上游恒 401 no-key。"""
    key = _get_config_value('zf3d', 'heartbeat_api_key', '')
    if key:
        return key
    try:
        _kf = os.path.join(BASE_DIR, 'private', 'heartbeat_key.json')
        with open(_kf, 'r', encoding='utf-8-sig') as _f:
            _k = (json.load(_f) or {}).get('api_key', '')
            if _k:
                return str(_k).strip()
    except Exception:
        pass
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


# 【功能移除 2026-11-09】朱峰网站控制智能体通道（a=get_commands 网页下发命令）已移除。
# 保留：峰控遥控器中继（remote_register/remote_poll）与双端对话同步（sync/pull）。


# ---- 室外4G遥控中继（remote_register / remote_poll）----

_remote_registered = False
_last_remote_reply = [0, '']  # [cmd_id, result] 待回传的上一条指令回复


def _remote_register(machine_id, api_key):
    """注册遥控中继通道，取得配对码（供网页 agent_remote.asp 使用）。"""
    global _remote_registered
    try:
        url = ZF3D_WEBSITE + '/api/agent_api.asp?a=remote_register'
        resp = _http_post(url, {'key': api_key, 'machine_id': machine_id})
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
        url = ZF3D_WEBSITE + '/api/agent_api.asp?a=remote_poll'
        data = {'key': api_key, 'machine_id': machine_id}
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
    """处理一条网页遥控指令：payload 为 JSON {type, data}，分发到本地命令处理器并回传。
    【2026-11-23 修复】①pseudo 键名对齐 _process_commands 实际消费的 id/type/data
    （此前 command_type/command_data 错位，所有遥控指令都落进“不支持的类型”分支）；
    ②回执唯一化：不再触发 _report_result（网站 command_result 通道已移除），
    结果由 _process_commands 返回，经 remote_poll reply 单点回传。"""
    cmd_id = item.get('cmd_id')
    try:
        pl = json.loads(item.get('payload') or '{}')
    except Exception:
        pl = {}
    rtype = str(pl.get('type') or '')
    rdata = pl.get('data')
    try:
        # 复用现有命令处理（白名单类型）：键名与 _process_commands / COMMAND_HANDLERS 消费端对齐
        pseudo = {'id': cmd_id, 'type': rtype,
                  'data': json.dumps(rdata if rdata is not None else {}, ensure_ascii=False)}
        result, ok = _process_commands([pseudo], report=False)
    except Exception as e:
        result, ok = 'error: %s' % e, 0
    return {'cmd_id': cmd_id, 'ok': 1 if ok else 0, 'result': result or ('ok' if ok else '')}


def _report_result(command_id, result, success=1):
    # 【2026-11-09 收窄】仅服务峰控遥控器中继回传（网站命令通道已移除）
    try:
        url = ZF3D_WEBSITE + '/api/agent_api.asp?a=command_result'
        _http_post(url, {
            'key': _get_api_key() or '',
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
    # 【P0-2 收编 20261123】relay 识别统一走 security.is_zf_relay_url（域名精确匹配，防子串误判）
    import security as _sec
    is_relay = _sec.is_zf_relay_url(endpoint)
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

# 重构 S3（2026-11-10）：命令处理器 + 注册表拆至 zf3d_command_handlers.py，
# 依赖注入（_db_write/_log/_call_llm），行为与拆分前一致。
import zf3d_command_handlers as _zfch
COMMAND_HANDLERS = _zfch.build(_db_write=_db_write, _log=_log, _call_llm=_call_llm)



def _process_commands(commands, report=True):
    """处理命令列表，返回最后一条的 (result, ok)。
    【2026-11-23】report=False 时不走 _report_result 回执（遥控中继路径由
    _handle_remote_cmd 借 remote_poll reply 单点回传，避免双重回执）。"""
    result, ok = '', 1
    for cmd in commands or []:
        cid = cmd.get('id')
        ctype = str(cmd.get('type') or '')
        handler = COMMAND_HANDLERS.get(ctype)
        if not handler:
            result, ok = '[远程命令] 不支持的类型: %s' % ctype, 0
            if report:
                _report_result(cid, result, ok)
            continue
        try:
            result, ok = handler(cmd)
        except Exception as e:
            result, ok = '[远程命令异常] %s' % e, 0
        if report:
            _report_result(cid, result, ok)
        _log('command %s (%s) done, ok=%s' % (cid, ctype, bool(ok)))
    return result, ok


# ===== 本地对话镜像上报（agent_remote 查看本机对话）=====
_sync_lock = threading.Lock()

def _sync_local_chats():
    """把本地 chat_history 的新消息增量上报到云端镜像（每轮轮询调用）。
    【隐私整改 2026-11-05】增加知情同意闸门：须 app_data(zf3d/chat_sync_enabled)='1' 才上传，
    默认不上传任何对话内容。"""
    if _get_config_value('zf3d', 'chat_sync_enabled', '') != '1':
        return
    if not _sync_lock.acquire(blocking=False):
        return
    try:
        api_key = _get_api_key()
        machine_id = _get_machine_id()
        if not api_key or not machine_id:
            return
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
        # 【安全 2026-11-06】api_key 从 URL 查询串移入 POST body，避免落入代理/网关日志
        url = ZF3D_WEBSITE + '/api/agent_api.asp?a=sync_chats'
        # 内容清洗：剔除控制字符和非法 UTF-8 序列（部分消息含二进制残留，
        # 会导致云端 ASP 解码 500）
        try:
            clean = (r0['content'] or '')[:4000]
            clean = clean.encode('utf-8', 'ignore').decode('utf-8', 'ignore')
            clean = ''.join(ch for ch in clean
                            if ch in '\n\r\t' or ord(ch) >= 32)
        except Exception:
            clean = ''
        params = {'key': api_key, 'machine_id': machine_id, 'count': '1',
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
        # 云端该机器最新的会话消息（复用 chat_messages 的会话列表接口思路：
        # 用 sync 方向的读接口；这里直接调 chat_sessions 列表 → 逐会话比对条数）
        # 【安全 2026-11-06】key 移入 POST body
        url = ZF3D_WEBSITE + '/api/agent_api.asp?a=chat_sessions'
        resp = _http_post(url, {'key': api_key, 'machine_id': machine_id})
        sessions = resp.get('sessions') or []
        if not sessions:
            return {'pulled': 0}
        from db import get_db
        c = get_db()
        try:
            return _pull_remote_chats_impl(c, sessions, api_key, machine_id, force)
        finally:
            # 【2026-10-16 修复】读连接用完必须关闭，避免长读事务/连接堆积
            try:
                c.close()
            except Exception:
                pass
    except Exception as e:
        _log('pull_remote_chats error: %s' % e)
        return {'pulled': 0, 'error': str(e)}


def _pull_remote_chats_impl(c, sessions, api_key, machine_id, force):
    """pull_remote_chats 的实际拉取逻辑（连接由调用方管理生命周期）。"""
    try:
        import time as _t
        pulled_total = 0
        touched = []
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
            murl = ZF3D_WEBSITE + '/api/agent_api.asp?a=chat_messages'
            mresp = _http_post(murl, {'key': api_key, 'machine_id': machine_id,
                                      'session_id': cloud_sid})
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
                # 未登录会员则不消费命令（安全要求）。
                # 【issue#83③ 2026-11-26】本地对话镜像同步也停止：
                # _sync_local_chats 内部需要 api_key+machine_id 才能上传，未登录时
                # 这两者通常已随登出清除——调用只会空转并可能读到残留凭据。
                # 登录成功后下一轮 poll 自动恢复同步，无需额外处理。
                _wake_event.wait(timeout=POLL_INTERVAL)
                _wake_event.clear()
                continue
            api_key = _get_api_key()
            machine_id = _get_machine_id()
            if api_key and machine_id:
                # 【2026-11-09】网站命令轮询（get_commands/_process_commands）已移除，不再消费网页下发命令
                # ---- 峰控遥控器中继：注册/轮询网页遥控指令并回传（保留） ----
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
        import datetime
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
    """启动命令消费线程（幂等，热更新后接管旧线程）。
    【隐私整改 2026-11-05】尊重 private/port.json "remote_commands" 开关，
    热更新重启也不绕过（此前 hot_reload 无条件调用本函数会重新拉起已关闭的线程）。"""
    import os as _os, json as _json
    try:
        _cfg_path = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                                  _os.pardir, 'private', 'port.json')
        if _os.path.exists(_cfg_path):
            with open(_cfg_path, 'r', encoding='utf-8-sig') as _f:
                _cfg = _json.load(_f)
            if not (isinstance(_cfg, dict) and _cfg.get('remote_commands') is True):
                _log('远程命令消费已按 port.json 配置保持关闭')
                return
    except Exception as _e:
        _log('读取 port.json 失败，默认不启动命令消费线程: %s' % _e)
        return
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
