#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""i聊天安全加固回归测试【2026-11-23】（隔离端口，不碰线上广场服务）。

覆盖四项安全/稳定加固：
  ① WS 握手 Origin 白名单：跨站网页 / DNS 重绑定页 403 拒绝，
     本机回环 Origin（跨端口）与无 Origin 本机脚本（bot）放行；
  ② authticket Host 回环硬校验：重绑定域（Origin==Host==evil.com）不再下发 token；
  ③ 互刷熔断滚动窗口：窗口内计数正确、过期修剪、只读 peek 不追加假消息；
  ④ 端到端冒烟：Origin 放行后 join→direct→hall 全链路仍通（加固未破坏原功能）。

与 test_plaza.py 不同：本测试在随机空闲端口起独立 PlazaServer 实例（不挂云桥、
不出外网），可安全地在生产服务运行时执行。
"""
import os, sys, json, time, socket, base64, threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'server'))
sys.path.insert(0, ROOT)

# 【A4 20261123】防同进程污染：先收集的脚本式测试会把 server/ 目录插进 sys.path
# （banner 还会 chdir 进去），其中的 server/server.py 会以普通模块抢注 `server`
# 模块名（命名空间包仅在无普通模块/包候选时成立），导致 ws_plaza 的
# `from server.common import ws_frame` 崩、兜底拿错 engines/common。
# 导入前：拉回 cwd、摘除 server/ path 条目、清错误缓存、以绝对包名预锚定；
# 导入后：恢复 path 条目与 common 绑定（engines 模块期望 engines/common）。
os.chdir(ROOT)
import importlib as _il
_srv_dir = os.path.join(ROOT, 'server')
while _srv_dir in sys.path:
    sys.path.remove(_srv_dir)
sys.modules.pop('server', None)
sys.modules.pop('server.common', None)
_server_common = _il.import_module('server.common')
sys.path.insert(0, _srv_dir)
_saved_common = sys.modules.get('common')
sys.modules['common'] = _server_common
from plaza import ws_plaza, authticket
if _saved_common is None:
    del sys.modules['common']
else:
    sys.modules['common'] = _saved_common
try:
    from server.common import ws_frame
except ImportError:
    from common import ws_frame

results = []
def check(name, ok):
    results.append((name, ok)); print(('PASS' if ok else 'FAIL'), name)

def _free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p

def _load_token():
    # 与服务端 _load_tokens 同源（含 6.0.0 未配置时回落同机旧版安装的兜底链）
    toks = ws_plaza._load_tokens()
    return next(iter(toks)) if toks else ''

PORT = _free_port()
ws_plaza.PLAZA_PORT = PORT           # 隔离端口：不动线上 8625
srv = ws_plaza.PlazaServer()
threading.Thread(target=srv.serve, daemon=True).start()
time.sleep(0.5)

# ---------- ① WS 握手 Origin 白名单 ----------
def ws_handshake_with_origin(origin):
    """带指定 Origin 头做 WS 握手，返回 (是否升级成功, 响应头首行)"""
    try:
        s = socket.create_connection(('127.0.0.1', PORT), timeout=5)
    except Exception:
        return False, 'conn-failed'
    key = base64.b64encode(os.urandom(16)).decode()
    lines = ['GET / HTTP/1.1', 'Host: 127.0.0.1:%d' % PORT,
             'Upgrade: websocket', 'Connection: Upgrade',
             'Sec-WebSocket-Key: ' + key, 'Sec-WebSocket-Version: 13']
    if origin is not None:
        lines.insert(4, 'Origin: ' + origin)
    s.sendall(('\r\n'.join(lines) + '\r\n\r\n').encode())
    s.settimeout(5)
    data = b''
    try:
        while b'\r\n\r\n' not in data:
            chunk = s.recv(4096)
            if not chunk:
                break
            data += chunk
    except Exception:
        pass
    head = data.partition(b'\r\n\r\n')[0].decode('utf-8', 'replace')
    first_line = head.split('\r\n')[0] if head else '(no response)'
    try:
        s.close()
    except Exception:
        pass
    return '101' in first_line, first_line

ok, line = ws_handshake_with_origin('http://evil.com:80')
check('跨站网页 Origin(evil.com) 握手被拒', not ok and '403' in line)
ok, line = ws_handshake_with_origin('https://evil.com')
check('跨站网页 Origin(https evil.com) 握手被拒', not ok and '403' in line)
ok, line = ws_handshake_with_origin('http://127.0.0.1.evil.com')
check('仿冒回环 Origin(127.0.0.1.evil.com) 握手被拒', not ok and '403' in line)
ok, line = ws_handshake_with_origin('http://attacker-rebind.example')
check('DNS 重绑定页 Origin 握手被拒', not ok and '403' in line)
ok, line = ws_handshake_with_origin(None)
check('无 Origin（本机脚本/bot）握手放行', ok)
ok, line = ws_handshake_with_origin('http://127.0.0.1:8620')
check('本机回环 Origin 跨端口（页面8600→WS）放行', ok)
ok, line = ws_handshake_with_origin('http://LOCALHOST:8620')
check('localhost Origin（大小写不敏感）放行', ok)
ok, line = ws_handshake_with_origin('http://[::1]:8620')
check('IPv6 回环 Origin 放行', ok)

# ---------- ② authticket Host 回环硬校验（DNS 重绑定防偷 token） ----------
class _FakeHandler:
    def __init__(self, origin, host):
        self.headers = {'Origin': origin, 'Host': host}
        self.headers = type('H', (), {
            'get': staticmethod(lambda k, d=None: {'Origin': origin, 'Host': host}.get(k, d))})()

check('authticket: 本机 Origin+Host 放行',
      authticket._is_local_origin(_FakeHandler('http://127.0.0.1:8580', '127.0.0.1:8580')))
check('authticket: localhost 放行',
      authticket._is_local_origin(_FakeHandler('http://localhost:8580', 'localhost:8580')))
check('authticket: IPv6 回环放行',
      authticket._is_local_origin(_FakeHandler('http://[::1]:8580', '[::1]:8580')))
check('authticket: DNS 重绑定(evil.com==Host) 拒绝',
      not authticket._is_local_origin(_FakeHandler('http://evil.com:8580', 'evil.com:8580')))
check('authticket: 无 Origin 拒绝',
      not authticket._is_local_origin(_FakeHandler('', '127.0.0.1:8580')))
check('authticket: 局域网 Host 拒绝',
      not authticket._is_local_origin(_FakeHandler('http://192.168.1.5:8580', '192.168.1.5:8580')))
check('authticket: 仿冒回环域名(127.0.0.1.evil.com) 拒绝',
      not authticket._is_local_origin(_FakeHandler('http://127.0.0.1.evil.com:8580',
                                                   '127.0.0.1.evil.com:8580')))

# ---------- ③ 互刷熔断滚动窗口 ----------
now = time.time()
store_a, store_b = {}, {}
for i in range(7):
    ws_plaza._window_count(store_a, 'Bob', now - 10)   # A 7 秒前起 7 条
check('窗口内 7 条=7（未达 8 阈值）', ws_plaza._window_peek(store_a, 'Bob', now) == 7)
check('第 8 条后=8（达阈值）', ws_plaza._window_count(store_a, 'Bob', now) == 8)
store_a['Bob'].appendleft(now - 121)                   # 塞入窗口外的旧时间戳（保持时序）
check('过期时间戳被修剪（>120s）', ws_plaza._window_peek(store_a, 'Bob', now) == 8)
check('peek 只读不追加（Bob 修剪后剩 8 条不变，X 未被新建）',
      len(store_a['Bob']) == 8 and ws_plaza._window_peek(store_a, 'X', now) == 0
      and 'X' not in store_a)
# 派发条件复算：A 窗口 8 条 + B 窗口 5 条 → 不熔断；B 第 6 条 → 熔断
for _ in range(4):
    ws_plaza._window_count(store_b, 'Alice', now)
peer_b = ws_plaza._window_count(store_b, 'Alice', now)
check('B 窗口 5 条时双向条件不成立',
      not (ws_plaza._window_peek(store_a, 'Bob', now) >= 8 and peer_b >= 6))
peer_b = ws_plaza._window_count(store_b, 'Alice', now)
check('B 窗口 6 条时双向熔断成立',
      ws_plaza._window_peek(store_a, 'Bob', now) >= 8 and peer_b >= 6)

# ---------- ④ 端到端冒烟：加固后原功能不回归 ----------
TOK = _load_token()
if TOK:
    class WSC:
        def __init__(self, name):
            self.name = name
            self.s = socket.create_connection(('127.0.0.1', PORT), timeout=5)
            assert ws_frame.client_handshake(self.s, '127.0.0.1', PORT), 'handshake failed'
        def send(self, obj):
            ws_frame.send_frame(self.s, obj)
        def recv_until(self, tname, timeout=5):
            end = time.time() + timeout
            while time.time() < end:
                self.s.settimeout(max(0.2, end - time.time()))
                f = ws_frame.recv_frame(self.s)
                if not f:
                    return None
                try:
                    m = json.loads(f[1].decode('utf-8'))
                except Exception:
                    continue
                if m.get('t') == tname:
                    return m
            return None
        def close(self):
            try:
                self.s.close()
            except Exception:
                pass

    c1 = WSC('SecA')
    c1.send({'t': 'join', 'name': 'SecA', 'token': ''})
    m = c1.recv_until('error')
    check('无 token join 仍被拒(denied)', m and m.get('msg') == 'denied')
    c1.close()

    a, b = WSC('SecA'), WSC('SecB')
    a.send({'t': 'join', 'name': 'SecA', 'token': TOK})
    ma = a.recv_until('joined')
    b.send({'t': 'join', 'name': 'SecB', 'token': TOK})
    mb = b.recv_until('joined')
    check('Origin 放行后 token join 成功 ×2', bool(ma and mb))
    a.send({'t': 'direct', 'to': 'SecB', 'text': '烟雾私聊', 'trace_id': 'sec-d1'})
    md = b.recv_until('direct')
    check('私聊端到端仍通', md is not None and md.get('text') == '烟雾私聊')
    time.sleep(2.2)  # 过 direct 限频窗
    a.send({'t': 'hall', 'text': '烟雾广播', 'trace_id': 'sec-h1'})
    mh = b.recv_until('hall')
    check('大厅广播端到端仍通', mh is not None and mh.get('text') == '烟雾广播')
    a.close(); b.close()
else:
    print('SKIP 端到端冒烟（未配置 论坛配置.json token，负面用例已覆盖）')

fails = [n for n, ok in results if not ok]
print('\n==== %d/%d PASS ====' % (len(results) - len(fails), len(results)))


def test_plaza_safety():
    """pytest 入口（快速优化冲刺 A4 20261123）：模块导入时已完整执行上述四组检查。"""
    bad = [n for n, ok in results if not ok]
    assert not bad, 'i聊天安全回归失败: ' + ', '.join(bad)


if __name__ == '__main__':
    sys.exit(1 if fails else 0)
