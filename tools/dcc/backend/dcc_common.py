#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dcc_common - DCC 连接器公共层（移植自老版本 3dsmax-mcp / BlenderMCP / Houdini-Agent）

三个 DCC 软件各自在本地开 TCP 服务监听（插件侧），本模块用统一的
「TCP 发 JSON → 收 JSON」协议与它们通信：
  - 3ds Max : 127.0.0.1:8765  {"command":..., "type":"maxscript", "requestId":..., "protocolVersion":2}
  - Blender : 127.0.0.1:9876  {"type":"execute_code", "params":{"code":...}}
  - Houdini : 127.0.0.1:45172（或 %LOCALAPPDATA%\HoudiniAgent\bridge.port 发现文件）
              JSON-lines: {"id":..., "action":"execute_tool", "payload":{...}}
"""
import json
import os
import socket
import uuid

DCC_HOST = '127.0.0.1'


def _recv_until_newline(sock, timeout=60.0):
    sock.settimeout(timeout)
    data = b''
    while not data.endswith(b'\n'):
        chunk = sock.recv(65536)
        if not chunk:
            break
        data += chunk
    return data


def _tcp_json(host, port, payload, timeout=60.0, newline=False):
    """TCP 发 JSON、收 JSON 的通用实现，返回 (ok, result_dict_or_errstr)。"""
    try:
        with socket.create_connection((host, int(port)), timeout=5.0) as sock:
            sock.settimeout(timeout)
            raw = json.dumps(payload, ensure_ascii=False)
            if newline:
                raw += '\n'
            sock.sendall(raw.encode('utf-8'))
            if newline:
                data = _recv_until_newline(sock, timeout)
            else:
                data = b''
                while True:
                    try:
                        chunk = sock.recv(65536)
                    except socket.timeout:
                        break
                    if not chunk:
                        break
                    data += chunk
            if not data:
                return False, '连接成功但未收到响应（软件插件可能未启动或超时）'
            try:
                return True, json.loads(data.decode('utf-8', 'replace'))
            except json.JSONDecodeError:
                return False, '响应不是合法 JSON: ' + data.decode('utf-8', 'replace')[:300]
    except ConnectionRefusedError:
        return False, ('连接被拒绝：%s:%s 无服务监听。请先启动 %s 侧插件/监听服务。'
                       % (host, port, _dcc_name(port)))
    except socket.timeout:
        return False, '连接/响应超时（%s 秒）' % timeout
    except OSError as e:
        return False, '网络错误: %s' % e


def _dcc_name(port):
    return {8765: '3ds Max', 9876: 'Blender', 45172: 'Houdini'}.get(int(port), 'DCC 软件')


# ---------------- 3ds Max ----------------

def max_send(command, cmd_type='maxscript', port=8765, host=None, timeout=60.0):
    """发 MaxScript/Python 命令到 3ds Max 桥（协议移植自老版 3dsmax-mcp max_client.py）。"""
    payload = {
        'command': command,
        'type': cmd_type,
        'requestId': uuid.uuid4().hex,
        'protocolVersion': 2,
    }
    return _tcp_json(host or DCC_HOST, port, payload, timeout=timeout)


# ---------------- Blender ----------------

def blender_send(command, params=None, port=9876, host=None, timeout=60.0):
    """发命令到 Blender 桥（协议移植自老版 BlenderMCP）。execute_code 可直接跑 bpy 代码。"""
    payload = {'type': command, 'params': params or {}}
    return _tcp_json(host or DCC_HOST, port, payload, timeout=timeout)


def blender_execute(code, port=9876, host=None, timeout=120.0):
    return blender_send('execute_code', {'code': code}, port=port, host=host, timeout=timeout)


# ---------------- Houdini ----------------

def _houdini_resolve_port(explicit=None):
    if explicit:
        return int(explicit)
    env = os.environ.get('HAGENT_BRIDGE_PORT')
    if env:
        try:
            return int(env)
        except ValueError:
            pass
    base = os.environ.get('LOCALAPPDATA') or os.path.expanduser('~')
    pf = os.path.join(base, 'HoudiniAgent', 'bridge.port')
    try:
        return int(open(pf, encoding='utf-8').read().strip())
    except Exception:
        return 45172


def houdini_request(action, payload=None, port=None, host=None, timeout=180.0):
    """发 JSON-lines 请求到 Houdini Agent 桥（协议移植自老版 Houdini-Agent bridge/client.py）。
    返回统一 (ok, result)。"""
    p = _houdini_resolve_port(port)
    rpc = {'id': uuid.uuid4().hex, 'action': action, 'payload': payload or {}}
    ok, res = _tcp_json(host or DCC_HOST, p, rpc, timeout=timeout, newline=True)
    if not ok:
        return False, res
    if isinstance(res, dict) and res.get('success') is False:
        return False, str(res.get('error') or 'bridge request failed')
    if isinstance(res, dict) and 'result' in res:
        return True, res['result']
    return True, res


def _fmt(obj, limit=4000):
    try:
        s = json.dumps(obj, ensure_ascii=False, indent=2, default=str)
    except Exception:
        s = str(obj)
    return s[:limit]
