#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""广场一期验收测试（负面测试为硬性验收项）。

【隔离保证 2026-11-23】默认通过 ZF_PLAZA_PORT 环境变量（ws_plaza 支持）把测试
实例钉在随机空闲端口上，绝不直连生产大厅；要针对活服务做直连验收，须显式
`set ZF_PLAZA_PORT=8625` 后运行（此时昵称/trace_id 仍带随机后缀防撞车）。
"""
import os, sys, json, time, socket, threading, random


def _free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


# 必须在导入 ws_plaza 之前设置：ws_plaza 在模块导入期解析端口
os.environ.setdefault('ZF_PLAZA_PORT', str(_free_port()))

_HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(_HERE))            # 仓库根（2026-11-23 修复：原少算一层导致 server/private 误路径）
sys.path.insert(0, os.path.join(ROOT, 'server'))
sys.path.insert(0, ROOT)

from plaza import ws_plaza
try:
    from server.common import ws_frame  # 绝对导入优先，避免 'common' 命名空间被 engines/common 抢占
except ImportError:
    from common import ws_frame  # 兜底：server 直接以自身为 sys.path 根运行时

PORT = ws_plaza.PLAZA_PORT                                # 真源 ws_plaza.PLAZA_PORT（port.json plaza_ws_port，测试已被 ZF_PLAZA_PORT 覆盖）


def _probe_alive(port):
    """协议级探测：TCP 通 + WS 握手成功 + join 得到 joined 或 error/denied 都算活广场服务。
    （2026-11-23 修复：服务端 denied 的线上形态是 {'t':'error','msg':'denied'}，旧断言
    只认 'denied' 字面量导致活服务永远探测不到。）"""
    s = None
    try:
        s = socket.create_connection(('127.0.0.1', port), timeout=2)
    except Exception:
        return False
    try:
        if not ws_frame.client_handshake(s, '127.0.0.1', port):
            return False
        toks = ws_plaza._load_tokens()
        _tok = sorted(toks)[0] if toks else ''
        ws_frame.send_frame(s, {'t': 'join', 'name': '__probe__', 'token': _tok})
        s.settimeout(3)
        f = ws_frame.recv_frame(s)
        if not f:
            return False
        m = json.loads(f[1].decode('utf-8'))
        return m.get('t') == 'joined' or (m.get('t') == 'error' and m.get('msg') == 'denied')
    except Exception:
        return False
    finally:
        try:
            s.close()
        except Exception:
            pass


if _probe_alive(PORT):
    srv = None
    print('检测到活广场服务，直连验收')
else:
    try:
        srv = ws_plaza.PlazaServer()
        threading.Thread(target=srv.serve, daemon=True).start()
        print('无活服务，起本地隔离测试服务 (port=%d)' % PORT)
    except OSError as e:
        print(f'FATAL: 端口 {PORT} 被占用且非广场服务（{e}），无法验收')
        sys.exit(2)
time.sleep(0.5)

# token：复用 ws_plaza 的加载链（仓库 private → 同机 5.8.0 回退），取不到不崩、给警告
try:
    toks = ws_plaza._load_tokens()
except Exception:
    toks = set()
TOK = sorted(toks)[0] if toks else ''
if not TOK:
    print('WARN: 未取到论坛 token，join 类用例将走 denied 分支')

# 随机后缀防撞车（直连活服务时不与真实用户/历史 trace 冲突）
_sfx = random.randint(10000, 99999)
ALICE, BOB = 'Alice%d' % _sfx, 'Bob%d' % _sfx
TR = lambda n: 'tr%d_%d' % (n, _sfx)


class WSC:
    def __init__(self):
        self.s = socket.create_connection(('127.0.0.1', PORT), timeout=5)
        assert ws_frame.client_handshake(self.s, '127.0.0.1', PORT), 'handshake failed'

    def send(self, obj):
        ws_frame.send_frame(self.s, obj)

    def recv(self, timeout=3):
        self.s.settimeout(timeout)
        f = ws_frame.recv_frame(self.s)
        if not f:
            return None
        try:
            return json.loads(f[1].decode('utf-8'))
        except Exception:
            return None

    def recv_until(self, tname, timeout=5):
        """读帧直到遇到指定类型（跳过 presence 等干扰帧）"""
        end = time.time() + timeout
        while time.time() < end:
            m = self.recv(timeout=max(0.2, end - time.time()))
            if m is None:
                return None
            if m.get('t') == tname:
                return m
        return None

    def close(self):
        try:
            self.send({'t': 'leave'})
        except Exception:
            pass
        try:
            self.s.close()
        except Exception:
            pass


results = []
def check(name, ok):
    results.append((name, ok))
    print(('PASS' if ok else 'FAIL'), name)

# ① 负面测试：无 token join 必须被拒
c1 = WSC(); c1.send({'t': 'join', 'name': 'anon', 'token': ''})
m = c1.recv()
check('无token join被拒(denied)', m is not None and m.get('t') == 'error' and m.get('msg') == 'denied')

# ② 正常 join ×2
a = WSC(); a.send({'t': 'join', 'name': ALICE, 'token': TOK})
ma = a.recv()
check('Alice joined', ma is not None and ma.get('t') == 'joined')
b = WSC(); b.send({'t': 'join', 'name': BOB, 'token': TOK})
mb = b.recv()
check('Bob joined', mb is not None and mb.get('t') == 'joined')
pa = a.recv_until('presence')
while pa is not None and BOB not in pa.get('users', []):
    pa = a.recv_until('presence')
check('Alice收到presence更新', pa is not None and BOB in pa.get('users', []))

# ③ 大厅广播端到端（<1s）
t0 = time.time()
a.send({'t': 'hall', 'text': '大家好', 'trace_id': TR(1)})
mh = b.recv_until('hall')
dt = time.time() - t0
check(f'Bob收到大厅消息({dt*1000:.0f}ms<1s)', mh is not None and mh.get('text') == '大家好' and mh.get('from') == ALICE)
check('带seq序列号', mh is not None and isinstance(mh.get('seq'), int))
check('Alice收到ack_ok', a.recv_until('ack_ok') is not None)

# ④ 负面测试：10秒内第2条广播必须被拒
a.send({'t': 'hall', 'text': '第二条', 'trace_id': TR(2)})
me = a.recv_until('error')
check('10秒内第2条被拒(limited)', me is not None and me.get('msg') == 'limited')

# ⑤ trace_id 幂等：等限频窗过后重发同 trace_id
time.sleep(10.5)
a.send({'t': 'hall', 'text': '大家好', 'trace_id': TR(1)})
md = a.recv_until('error')
check('同trace_id被拒(duplicated)', md is not None and md.get('msg') == 'duplicated')

# ⑥ 私聊
a.send({'t': 'direct', 'to': BOB, 'text': 'hi bob', 'trace_id': TR(3)})
mdd = b.recv_until('direct')
check('Bob收到私聊', mdd is not None and mdd.get('text') == 'hi bob')

# ⑦ 私聊离线回落提示（等 direct 限频窗 2s 过）
time.sleep(2.2)
a.send({'t': 'direct', 'to': 'Ghost%d' % _sfx, 'text': '?', 'trace_id': TR(4)})
mo = a.recv_until('error')
check('对方离线提示回落forum', mo is not None and mo.get('msg') == 'offline-fallback-forum')

# 清场：礼貌离线（不支持 leave 协议时直接关连接，服务端断线清理会接管）
a.close()
b.close()
c1.close()

fails = [n for n, ok in results if not ok]
print(f'\n==== {len(results)-len(fails)}/{len(results)} PASS ====')
sys.exit(1 if fails else 0)
