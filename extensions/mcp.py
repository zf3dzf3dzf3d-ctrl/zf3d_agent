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
        with open(_CONF_PATH, 'r', encoding='utf-8') as f:
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


def _rpc(server_conf, method, params=None, timeout=30):
    if server_conf.get('type') == 'stdio':
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

