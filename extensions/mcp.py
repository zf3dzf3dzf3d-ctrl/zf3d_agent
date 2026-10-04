#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MCP 子模块 - Model Context Protocol 客户端网关（独立文件，可整目录删除下线）

功能：
1. 管理外部 MCP server 连接配置（private/extensions/mcp_servers.json，文件级独立存储）
2. 通过 HTTP(SSE)/stdio transport 以 JSON-RPC 2.0 调用 MCP server：
   - initialize / tools/list / tools/call
3. 把外部 MCP 工具转换为 OpenAI function calling schema，供主智能体使用：
   - GET /api/ext/mcp/tools → 汇总所有 server 的工具（已转为 function calling 格式）
   - POST /api/ext/mcp/call → 调用外部工具 {server, tool, arguments}

本模块不修改主工具注册表，仅作为网关桥接。
"""

import os
import json
import subprocess
import threading
import urllib.request
import urllib.error

_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.normpath(os.path.join(_DIR, '..'))
_CONF_PATH = os.path.join(_ROOT, 'private', 'extensions', 'mcp_servers.json')
_LOCK = threading.Lock()

_RPC_ID = [0]


def _next_id():
    with _LOCK:
        _RPC_ID[0] += 1
        return _RPC_ID[0]


def _load_conf():
    try:
        with open(_CONF_PATH, 'r', encoding='utf-8-sig') as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {'servers': {}}


def _save_conf(conf):
    os.makedirs(os.path.dirname(_CONF_PATH), exist_ok=True)
    with open(_CONF_PATH, 'w', encoding='utf-8') as f:
        json.dump(conf, f, ensure_ascii=False, indent=2)


def _jsonrpc_http(url, method, params=None, timeout=30):
    """向 HTTP MCP server 发送 JSON-RPC 2.0 请求。"""
    payload = {'jsonrpc': '2.0', 'id': _next_id(), 'method': method}
    if params is not None:
        payload['params'] = params
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'},
        method='POST')
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode('utf-8', 'replace')
    # 兼容 SSE 包裹的响应：data: {...}
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith('data:'):
            raw = line[5:].strip()
            break
    data = json.loads(raw)
    if isinstance(data, dict) and 'error' in data and data['error']:
        raise RuntimeError('MCP error: %s' % json.dumps(data['error'], ensure_ascii=False))
    return data.get('result', {})



# ===== stdio 长连接管理器（对齐大厂规格：常驻子进程 + 会话复用 + 自动重启） =====

_stdio_procs = {}   # server_id -> {'proc': Popen, 'conf': dict, 'init': bool}
_stdio_lock = threading.Lock()


class _StdioSession:
    """常驻 stdio MCP 会话。线程安全：每 server 一把操作锁。"""

    def __init__(self, server_id, conf):
        self.server_id = server_id
        self.conf = conf
        self.op_lock = threading.Lock()
        self.proc = None
        self._start()

    def _start(self):
        cmd = [self.conf.get('command')] + list(self.conf.get('args') or [])
        env = dict(os.environ)
        env.update(self.conf.get('env') or {})
        _cf = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL, env=env, creationflags=_cf)
        # initialize 握手
        init = {'jsonrpc': '2.0', 'id': _next_id(), 'method': 'initialize',
                'params': {'protocolVersion': '2024-11-05', 'capabilities': {},
                           'clientInfo': {'name': 'zf-agent', 'version': '5.2.2'}}}
        self._write(init)
        self._write({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
        self._read(init['id'])  # 消费 initialize 应答

    def _write(self, obj):
        self.proc.stdin.write((json.dumps(obj) + '\n').encode('utf-8'))
        self.proc.stdin.flush()

    def _read(self, want_id, timeout=60):
        import time as _t
        deadline = _t.time() + timeout
        while _t.time() < deadline:
            line = self.proc.stdout.readline()
            if not line:
                raise RuntimeError('MCP stdio 会话已断开')
            if isinstance(line, bytes):
                line = line.decode('utf-8', 'replace')
            line = line.strip()
            if not line.startswith('{'):
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            if data.get('id') == want_id:
                if data.get('error'):
                    raise RuntimeError('MCP error: %s' % json.dumps(data['error'], ensure_ascii=False))
                return data.get('result', {})
        raise RuntimeError('MCP stdio 响应超时')

    def call(self, method, params=None, timeout=60):
        with self.op_lock:
            if self.proc is None or self.proc.poll() is not None:
                self._start()
            rpc = {'jsonrpc': '2.0', 'id': _next_id(), 'method': method}
            if params is not None:
                rpc['params'] = params
            try:
                self._write(rpc)
                return self._read(rpc['id'], timeout)
            except (RuntimeError, OSError):
                # 崩溃自动重启一次
                try:
                    self.proc.kill()
                except Exception:
                    pass
                self._start()
                rpc['id'] = _next_id()
                self._write(rpc)
                return self._read(rpc['id'], timeout)

    def close(self):
        try:
            self.proc.kill()
        except Exception:
            pass
        self.proc = None


def _get_session(server_id, conf):
    with _stdio_lock:
        sess = _stdio_procs.get(server_id)
        if sess is None or sess.proc is None or sess.proc.poll() is not None:
            sess = _StdioSession(server_id, conf)
            _stdio_procs[server_id] = sess
        return sess


def mcp_stdio_call(server_conf, server_id, method, params=None, timeout=60):
    """长连接版 stdio JSON-RPC 调用。失败回退一次性子进程。"""
    try:
        sess = _get_session(server_id, server_conf)
        return sess.call(method, params, timeout)
    except Exception:
        return _jsonrpc_stdio(server_conf, method, params, timeout)


# ===== agent_loop 注入接口（对齐大厂：MCP 工具进主循环 tool schemas） =====

def get_agent_tools():
    """返回所有已启用 MCP server 的工具（OpenAI function calling schema）。
    agent_loop 组装 tool schemas 时并入本列表；模型调用 mcp_* 工具时用 call_mcp_tool 分发。"""
    schemas = []
    try:
        conf = _load_conf()
        for sid, sc in (conf.get('servers') or {}).items():
            if not sc.get('enabled', True):
                continue
            try:
                # 带 server_id 走长连接会话；一次性子进程路径下 stdin 立即关闭，
                # 部分服务器（如 fastmcp）会在处理 tools/list 前退出导致无响应
                r = _rpc(sc, 'tools/list', server_id=sid)
                for t in (r.get('tools') or []):
                    schemas.append(_to_function_schema(sid, t))
            except Exception:
                continue
    except Exception:
        pass
    return schemas


def is_mcp_tool(name):
    return isinstance(name, str) and name.startswith('mcp_') and '__' in name


def call_mcp_tool(name, arguments):
    """分发 mcp_<server>__<tool> 调用。"""
    _, rest = name[4:].split('__', 1)
    conf = _load_conf()
    sc = (conf.get('servers') or {}).get(rest.split('__')[0] if '__' in rest else '')
    # 名称格式 mcp_<server>__<tool>，server 本身不含 __
    sid = name[4:].split('__', 1)[0]
    tool = name[4:].split('__', 1)[1]
    sc = (conf.get('servers') or {}).get(sid)
    if not sc:
        raise RuntimeError('未知 MCP server: ' + sid)
    return _rpc(sc, 'tools/call', {'name': tool, 'arguments': arguments or {}}, timeout=120, server_id=sid)



def _jsonrpc_stdio(server_conf, method, params=None, timeout=30):
    """通过 stdio 启动子进程 MCP server 并完成 JSON-RPC 往返（initialize → 目标调用）。"""
    cmd = [server_conf.get('command')] + list(server_conf.get('args') or [])
    env = dict(os.environ)
    env.update(server_conf.get('env') or {})
    rpc = {'jsonrpc': '2.0', 'id': _next_id(), 'method': method}
    if params is not None:
        rpc['params'] = params
    init = {'jsonrpc': '2.0', 'id': _next_id(), 'method': 'initialize',
            'params': {'protocolVersion': '2024-11-05', 'capabilities': {},
                       'clientInfo': {'name': 'zf-agent', 'version': '5.0.5'}}}
    payload = json.dumps(init) + '\n' + json.dumps({'jsonrpc': '2.0', 'method': 'notifications/initialized'}) + '\n' + json.dumps(rpc) + '\n'
    try:
        proc = subprocess.run(cmd, input=payload.encode('utf-8'),
                              capture_output=True, timeout=timeout, env=env)
        out = proc.stdout.decode('utf-8', 'replace')
    except (OSError, subprocess.TimeoutExpired) as e:
        raise RuntimeError('MCP stdio 启动失败: %s' % e)
    result = None
    want = rpc['id']
    for line in out.splitlines():
        line = line.strip()
        if not line.startswith('{'):
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue
        if data.get('id') == want:
            result = data
            break
    if result is None:
        raise RuntimeError('MCP stdio 无响应')
    if result.get('error'):
        raise RuntimeError('MCP error: %s' % json.dumps(result['error'], ensure_ascii=False))
    return result.get('result', {})


def _rpc(server_conf, method, params=None, timeout=30, server_id=None):
    if server_conf.get('type') == 'stdio':
        if server_id:
            return mcp_stdio_call(server_conf, server_id, method, params, timeout)
        return _jsonrpc_stdio(server_conf, method, params, timeout)
    return _jsonrpc_http(server_conf['url'], method, params, timeout)


# ===== OpenAI function calling schema 转换 =====

def _to_function_schema(server_id, tool):
    name = str(tool.get('name') or '')
    return {
        'type': 'function',
        'function': {
            'name': 'mcp_%s__%s' % (server_id, name),
            'description': '[MCP:%s] %s' % (server_id, tool.get('description') or ''),
            'parameters': tool.get('inputSchema') or {'type': 'object', 'properties': {}},
        },
    }


def _send(handler, data, code=200):
    try:
        handler._send_json(data, code)
    except Exception:
        pass


def handle(handler, method, tail, body):
    action = tail[0] if tail else ''

    # 全局开关：MCP 总开关关闭时除 settings 外全部拒绝
    from extensions import settings as _ext_settings
    if not _ext_settings.is_enabled('mcp') and action != 'settings':
        _send(handler, {'ok': False, 'error': 'MCP 扩展已在设置中关闭', 'disabled': True})
        return True

    if method == 'GET' and action == 'servers':
        conf = _load_conf()
        # 脱敏：不返回 env 明文
        safe = {}
        for sid, s in (conf.get('servers') or {}).items():
            safe[sid] = {k: v for k, v in s.items() if k != 'env'}
            safe[sid]['hasEnv'] = bool(s.get('env'))
        _send(handler, {'ok': True, 'servers': safe})
        return True

    if method == 'POST' and action == 'servers':
        # 添加/更新 server：{id, type: http|stdio, url/command, args, env, enabled}
        sid = str(body.get('id') or '').strip()
        if not sid or not sid.replace('_', '').replace('-', '').isalnum():
            _send(handler, {'ok': False, 'error': 'id 必填且只能为字母数字下划线连字符'})
            return True
        s = {'type': body.get('type') or 'http', 'enabled': bool(body.get('enabled', True))}
        if s['type'] == 'http':
            if not str(body.get('url') or '').startswith(('http://', 'https://')):
                _send(handler, {'ok': False, 'error': 'http 类型必须提供合法 url'})
                return True
            s['url'] = body['url']
        else:
            if not body.get('command'):
                _send(handler, {'ok': False, 'error': 'stdio 类型必须提供 command'})
                return True
            s['command'] = body['command']
            s['args'] = body.get('args') or []
        if body.get('env'):
            s['env'] = body['env']
        with _LOCK:
            conf = _load_conf()
            conf.setdefault('servers', {})[sid] = s
            _save_conf(conf)
        _send(handler, {'ok': True, 'id': sid})
        return True

    if method == 'POST' and action == 'servers_delete':
        sid = str(body.get('id') or '')
        with _LOCK:
            conf = _load_conf()
            conf.get('servers', {}).pop(sid, None)
            _save_conf(conf)
        _send(handler, {'ok': True})
        return True

    if method == 'GET' and action == 'tools':
        conf = _load_conf()
        # 汇总所有 enabled server 的工具，转 function calling schema
        results = []
        errors = {}
        for sid, s in (conf.get('servers') or {}).items():
            if not s.get('enabled', True):
                continue
            try:
                res = _rpc(s, 'tools/list')
                for t in (res.get('tools') or []):
                    results.append(_to_function_schema(sid, t))
            except Exception as e:
                errors[sid] = str(e)
        _send(handler, {'ok': True, 'tools': results, 'errors': errors})
        return True

    if method == 'POST' and action == 'call':
        conf = _load_conf()
        # {tool: "mcp_<server>__<name>", arguments: {...}} 或 {server, tool, arguments}
        full = str(body.get('tool') or '')
        sid = str(body.get('server') or '')
        tname = str(body.get('name') or '')
        if full.startswith('mcp_') and '__' in full:
            sid, tname = full[4:].split('__', 1)
        s = (conf.get('servers') or {}).get(sid)
        if not s:
            _send(handler, {'ok': False, 'error': '未知 MCP server: ' + sid})
            return True
        try:
            res = _rpc(s, 'tools/call', {'name': tname, 'arguments': body.get('arguments') or {}}, timeout=120)
        except Exception as e:
            _send(handler, {'ok': False, 'error': str(e)})
            return True
        _send(handler, {'ok': True, 'server': sid, 'tool': tname, 'result': res})
        return True

    if method == 'POST' and action == 'test':
        sid = str(body.get('id') or '')
        conf = _load_conf()
        s = (conf.get('servers') or {}).get(sid)
        if not s:
            _send(handler, {'ok': False, 'error': '未知 MCP server: ' + sid})
            return True
        try:
            _rpc(s, 'tools/list')
            _send(handler, {'ok': True, 'id': sid, 'status': 'connected'})
        except Exception as e:
            _send(handler, {'ok': False, 'id': sid, 'error': str(e)})
        return True

    _send(handler, {'ok': False, 'error': 'Unknown mcp action: ' + str(action)}, 404)
    return True

