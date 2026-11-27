#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""i聊天·云互联端到端验收测试（不依赖真实 zf3d.com）：

  A实例(plazaWS+云桥) ⇄ mock云中继(HTTP, 同 agent_chat.asp 契约) ⇄ B实例(plazaWS+云桥)

覆盖：
  1. 远程私聊双向（cloud_say → 云 → 对方 cloud_msg）
  2. 互联大厅广播（to='' ，己机不回显）
  3. 远端名册 cloud_presence
  4. 未挂云桥的广场 cloud_say → error cloud-off
  5. 坏凭据 → 云桥 state=err（退避不拖死广场）
跑法: python server/plaza/test_cloud_bridge.py   （全过 exit 0）
"""
import os
import sys
import json
import time
import socket
import threading
import tempfile
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from util_log import get_logger

log = get_logger('test_cloud_bridge')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'server'))
sys.path.insert(0, ROOT)

from plaza import ws_plaza, cloud_bridge
try:
    from server.common import ws_frame
except ImportError:
    from common import ws_frame

PASS = []
FAIL = []


def check(name, cond, detail=''):
    (PASS if cond else FAIL).append(name)
    log.info('%s %s %s' % ('✓' if cond else '✗', name, detail))


# ================= mock 云中继（同 agent_chat.asp 契约） =================
class MockCloud:
    def __init__(self):
        self.msgs = []            # {id,from,name,to,room,text,ts}
        self.users = {}           # machine -> [name, last_ts]
        self.next_id = 1
        self.lock = threading.Lock()

        outer = self

        class _Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                ln = int(self.headers.get('Content-Length') or 0)
                body = self.rfile.read(ln).decode('utf-8', 'replace')
                p = {k: v[0] for k, v in urllib.parse.parse_qs(body).items()}
                with outer.lock:
                    out = outer._serve(p)
                data = json.dumps(out).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=UTF-8')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass

        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), _Handler)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def _serve(self, p):
        if p.get('key') != 'testkey':
            return {'success': False, 'message': 'auth failed'}
        mid = p.get('machine_id') or ''
        a = p.get('a')
        if a == 'leave':
            self.users.pop(mid, None)
            return {'success': True, 'data': {}}
        # poll / say 都算心跳
        self.users[mid] = [p.get('from_name') or '', int(time.time())]
        if a == 'say':
            to = p.get('to') or ''
            self.msgs.append({'id': self.next_id, 'from': mid,
                              'name': p.get('from_name') or '',
                              'to': to, 'room': 'hall' if to == '' else 'direct',
                              'text': p.get('text') or '', 'ts': int(time.time())})
            self.next_id += 1
            return {'success': True, 'data': {'id': self.next_id - 1}}
        if a == 'poll':
            since = int(p.get('since') or 0)
            got = [m for m in self.msgs
                   if m['id'] > since and m['from'] != mid
                   and (m['room'] == 'hall' or m['to'] == mid)]
            cursor = got[-1]['id'] if got else (self.msgs[-1]['id'] if self.msgs else since)
            users = [{'machine': k, 'name': v[0]}
                     for k, v in self.users.items() if time.time() - v[1] <= 30]
            return {'success': True,
                    'data': {'cursor': cursor, 'msgs': got, 'users': users}}
        return {'success': False, 'message': 'unknown action'}

    def close(self):
        self.httpd.shutdown()


# ================= WS 测试客户端（同 bot_chat 模式） =================
class WsCli:
    def __init__(self, port, name, token='x'):
        self.name = name
        self.inbox = []
        self.lock = threading.Lock()
        s = socket.create_connection(('127.0.0.1', port), timeout=10)
        s.settimeout(None)
        if not ws_frame.client_handshake(s, '127.0.0.1', port):
            raise RuntimeError('handshake failed')
        self.sock = s
        self.send({'t': 'join', 'name': name, 'token': token})
        threading.Thread(target=self._pump, daemon=True).start()
        deadline = time.time() + 5
        while time.time() < deadline and not self._joined():
            time.sleep(0.05)

    def _joined(self):
        with self.lock:
            return any(m.get('t') == 'joined' for m in self.inbox)

    def send(self, obj):
        ws_frame.send_frame(self.sock, obj, self.lock)

    def _pump(self):
        while True:
            try:
                f = ws_frame.recv_frame(self.sock)
                if f is None:
                    return
                m = json.loads(f[1].decode('utf-8'))
                with self.lock:
                    self.inbox.append(m)
            except Exception:
                return

    def wait_for(self, pred, timeout=15):
        deadline = time.time() + timeout
        while time.time() < deadline:
            with self.lock:
                for m in self.inbox:
                    if pred(m):
                        return m
            time.sleep(0.05)
        return None


def _free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def _start_plaza_on(port):
    ws_plaza.PLAZA_PORT = port
    srv = ws_plaza.PlazaServer()
    srv._token_ok = lambda t: True          # 测试环境免论坛 token（hermetic）
    threading.Thread(target=srv.serve, daemon=True).start()
    deadline = time.time() + 5
    while time.time() < deadline:           # 等 bind+listen 完成再让下一个端口接管全局变量
        try:
            socket.create_connection(('127.0.0.1', port), timeout=0.3).close()
            return srv
        except OSError:
            time.sleep(0.05)
    raise RuntimeError('plaza %d 未监听' % port)


def main():
    mock = MockCloud()
    state_dir = tempfile.mkdtemp(prefix='zfcloud_')
    cloud_bridge._STATE_PATH = os.path.join(state_dir, '互联状态.json')

    portA, portB, portC = _free_port(), _free_port(), _free_port()
    srvA = _start_plaza_on(portA)
    srvB = _start_plaza_on(portB)
    srvC = _start_plaza_on(portC)           # 不挂云桥（对照组）

    cfgA = {'enable': True, 'url': 'http://127.0.0.1:%d' % mock.port,
            'key': 'testkey', 'machine': 'machineaaaa01', 'name': '甲机', 'poll_interval': 1}
    cfgB = dict(cfgA, machine='machinebbbb02', name='乙机')
    bA = cloud_bridge.CloudBridge(srvA, cfgA)
    bB = cloud_bridge.CloudBridge(srvB, cfgB)
    srvA.bridge = bA
    srvB.bridge = bB
    bA.start()
    bB.start()

    for b in (bA, bB):
        deadline = time.time() + 8
        while time.time() < deadline and b.state != 'on':
            time.sleep(0.05)
        check('云桥上线(%s)' % b.name, b.state == 'on')

    cliA = WsCli(portA, '甲本地')
    cliB = WsCli(portB, '乙本地')
    cliC = WsCli(portC, '丙本地')

    # 快照：join 后应收到 cloud_status on
    m = cliA.wait_for(lambda x: x.get('t') == 'cloud_status')
    check('join 快照带云状态', bool(m) and m.get('state') == 'on')

    # 1) 远程私聊 A → B
    cliA.send({'t': 'cloud_say', 'to': 'machinebbbb02', 'text': '端对端你好', 'trace_id': 't1'})
    m = cliA.wait_for(lambda x: x.get('t') == 'ack_ok' and x.get('trace_id') == 't1')
    check('cloud_say ack', bool(m))
    m = cliB.wait_for(lambda x: x.get('t') == 'cloud_msg' and '端对端你好' in (x.get('text') or ''))
    check('远程私聊 A→B', bool(m) and m.get('from_machine') == 'machineaaaa01'
          and m.get('room') == 'direct', str(m)[:80])

    # 2) 回程 B → A
    cliB.send({'t': 'cloud_say', 'to': 'machineaaaa01', 'text': '收到！乙机在此', 'trace_id': 't2'})
    m = cliA.wait_for(lambda x: x.get('t') == 'cloud_msg' and '乙机在此' in (x.get('text') or ''))
    check('远程私聊 B→A', bool(m))

    # 3) 互联大厅：A 广播 → B 收 hall，A 自己不回显（先让过 cloud 桶 2 秒限频，与真实用户节奏一致）
    time.sleep(2.2)
    cliA.send({'t': 'cloud_say', 'to': '', 'text': '大厅广播测试', 'trace_id': 't3'})
    m = cliB.wait_for(lambda x: x.get('t') == 'cloud_msg' and '大厅广播测试' in (x.get('text') or ''))
    check('互联大厅 A→B', bool(m) and m.get('room') == 'hall')
    time.sleep(2.5)  # 超过一个轮询周期，确认己机不回显
    with cliA.lock:
        echo = any('大厅广播测试' in (x.get('text') or '') for x in cliA.inbox
                   if x.get('t') == 'cloud_msg')
    check('己机大厅消息不回显', not echo)

    # 4) 远端名册
    m = cliA.wait_for(lambda x: x.get('t') == 'cloud_presence'
                      and any(u.get('machine') == 'machinebbbb02' for u in x.get('users') or []))
    check('远端名册含乙机', bool(m))

    # 5) 云桥断开时（模拟：临时摘桥）
    srvA.bridge = None
    cliA.send({'t': 'cloud_say', 'to': '', 'text': 'x', 'trace_id': 't4'})
    m = cliA.wait_for(lambda x: x.get('t') == 'error' and x.get('msg') == 'cloud-off')
    check('摘桥报 cloud-off', bool(m))
    srvA.bridge = bA

    # 6) 未挂桥的广场（对照组 C）
    cliC.send({'t': 'cloud_say', 'to': '', 'text': 'x', 'trace_id': 't5'})
    m = cliC.wait_for(lambda x: x.get('t') == 'error' and x.get('msg') == 'cloud-off')
    check('无云桥报 cloud-off', bool(m))

    # 7) 坏凭据实例 → err 退避（广场不拖死：本地 join/私聊照常）
    cfgBad = {'enable': True, 'url': 'http://127.0.0.1:%d' % mock.port,
              'key': 'wrongkey', 'machine': 'machinecccc03', 'name': '丙机', 'poll_interval': 1}
    bBad = cloud_bridge.CloudBridge(srvC, cfgBad)
    srvC.bridge = bBad
    bBad.start()
    deadline = time.time() + 8
    while time.time() < deadline and bBad.state != 'err':
        time.sleep(0.05)
    check('坏凭据 state=err', bBad.state == 'err')
    cliC2 = WsCli(portC, '丙本地2')
    cliC2.send({'t': 'direct', 'to': '丙本地', 'text': '本地不受影响', 'trace_id': 't6'})
    m = cliC.wait_for(lambda x: x.get('t') == 'direct' and '本地不受影响' in (x.get('text') or ''))
    check('坏凭据不影响本地广场', bool(m))

    # 游标持久化
    check('游标已持久化', os.path.exists(cloud_bridge._STATE_PATH)
          and (cloud_bridge._read_json(cloud_bridge._STATE_PATH) or {}).get('cursor', 0) >= 1)

    for b in (bA, bB, bBad):
        b.stop()
    mock.close()

    log.error('\n通过 %d / 失败 %d' % (len(PASS), len(FAIL)))
    if FAIL:
        log.error('%s %s', '失败项:', FAIL)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
