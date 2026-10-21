# -*- coding: utf-8 -*-
"""
ui_sync - 双端界面实时同步事件总线
================================
独立于 hot_reload 的通用 SSE 广播模块：任何一端（峰控/电脑端）发生状态变化，
服务端向所有已连接页面广播事件，前端 sync-client.js 收到后局部刷新。
纯标准库，线程安全，照抄 hot_reload.py 已验证的注册表模式。
"""
import json
import os
import socket
import threading
import time

_lock = threading.Lock()
_clients = []          # [{'wfile': wfile, 'cid': clientId, 't': 接入时间}]
_MAX_CLIENTS = 16      # 本地服务，客户端上限防线程耗尽
_last_emit = {}       # {(type, key): timestamp} 防抖节流

_SOCK_ERRS = (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError, ValueError)

# 【方案A·P1-1】单客户端写超时（秒）：手机切后台等慢客户端 TCP 缓冲打满时，
# write 卡死会拖慢整个串行广播链路；超时即视为 dead 踢除。可用环境变量覆盖。
try:
    SSE_WRITE_TIMEOUT = float(os.environ.get('SSE_WRITE_TIMEOUT', '3.0'))
except Exception:
    SSE_WRITE_TIMEOUT = 3.0
_kick_count = 0  # 累计踢除计数（可观测）


def _send_sse(wfile, data):
    """发送 SSE 帧。返回 False 表示客户端已 dead（写失败或写超时）。
    写超时依赖 socket timeout（add_client 时设置），socket.timeout 属 OSError 会被捕获。"""
    try:
        msg = f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
        wfile.write(msg.encode('utf-8', errors='surrogatepass'))
        wfile.flush()
        return True
    except _SOCK_ERRS:
        return False
    except Exception:
        return False


def _get_sock(wfile):
    """从 wfile 尽力取回底层 socket（不同 server 实现路径不同）。"""
    sock = getattr(wfile, 'raw', None)
    sock = getattr(sock, '_sock', sock) if sock is not None else None
    if sock is None:
        sock = getattr(wfile, '_sock', None)
    if sock is None:
        req = getattr(wfile, '_rfile', None) or getattr(wfile, 'request', None)
        sock = getattr(req, 'socket', None) if req is not None else None
    return sock if hasattr(sock, 'settimeout') else None


def add_client(wfile, cid=''):
    """注册 SSE 客户端。返回 False 表示超出上限。
    【方案A】注册时给底层 socket 设写超时，防慢客户端 write 无限卡死拖慢广播。"""
    sock = _get_sock(wfile)
    if sock is not None:
        try:
            sock.settimeout(SSE_WRITE_TIMEOUT)
        except Exception:
            pass
    with _lock:
        if len(_clients) >= _MAX_CLIENTS:
            return False
        # 同 cid 旧连接视为断开，先移除防重复
        _clients[:] = [c for c in _clients if c['cid'] != cid]
        _clients.append({'wfile': wfile, 'cid': cid, 't': time.time()})
    _send_sse(wfile, {'type': 'connected', 'message': 'ui-sync 已连接', 'clientId': cid})
    return True


def remove_client(wfile):
    with _lock:
        _clients[:] = [c for c in _clients if c['wfile'] is not wfile]


def client_count():
    with _lock:
        return len(_clients)


def broadcast(etype, key='', data=None, cid='', debounce=0.0):
    """向所有客户端广播事件（跳过来源端 cid 防回声）。
    debounce>0 时，相同 (type,key) 在该秒数内只广播一次（事件风暴防护）。"""
    if debounce > 0:
        now = time.time()
        with _lock:
            k = (etype, key)
            if now - _last_emit.get(k, 0) < debounce:
                return False
            _last_emit[k] = now
            # 清理过期防抖记录，防字典膨胀
            if len(_last_emit) > 256:
                cutoff = now - 60
                for kk in [kk for kk, ts in _last_emit.items() if ts < cutoff]:
                    _last_emit.pop(kk, None)
    payload = {'type': etype, 'key': key, 'data': data or {}, 'from': cid, 'ts': time.time()}
    # 【关键】锁内只做快照，发送放锁外：防止某个客户端 socket 写阻塞
    # （如手机峰控切后台暂停读网络）持锁卡死整个广播/发消息链路。
    with _lock:
        targets = [c for c in _clients if c['cid'] != cid]
    dead = [c for c in targets if not _send_sse(c['wfile'], payload)]
    if dead:
        global _kick_count
        with _lock:
            _clients[:] = [c for c in _clients if c not in dead]
            _kick_count += len(dead)
        print('[ui_sync] 🐢 踢除 %d 个慢/断开客户端（累计 %d），剩余 %d' %
              (len(dead), _kick_count, len(_clients)))
    return True
