#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
智能体广场 · WS 广播服务（一期 MVP，纯标准库）
实现模式复制自 server/remote/ws_server.py @ commit 3f65072（握手/帧解析已抽共享模块 server/common/ws_frame.py）。
监听端口: 默认 8625（private/port.json 的 plaza_ws_port 可覆盖；端口冲突则跳过启动不拖死主服务。
历史注：5.8.x 时代曾用 8586——8585 = api_port+5 被 health_liveness 探针占用）

协议（JSON 六种消息，先定协议后写码 · 策划案v3 第三节）:
  客户端 -> 服务器:
    {"t":"join","name":"...","token":"..."}            # join 必带 token，匿名拒（安全层一期硬性项）
    {"t":"leave"}
    {"t":"hall","text":"...","trace_id":"..."}          # 大厅广播（限频 1条/10秒）
    {"t":"direct","to":"name","text":"...","trace_id":"..."}  # 1对1 私聊；对方离线回落 forum（客户端侧职责）
    {"t":"ack","trace_id":"..."}
    {"t":"ping"}
    {"t":"cloud_say","to":"machine_id|''","text":"...","trace_id":"..."}  # 云互联出站（to 空=互联大厅，云桥挂载时有效）
  服务器 -> 客户端:
    {"t":"joined","ok":true,"name":"..."}
    {"t":"presence","users":[...]}                      # 在线列表（含未读标记）
    {"t":"hall","from":"name","text":"...","seq":n,"ts":...}
    {"t":"direct","from":"name","text":"...","seq":n,"ts":...}
    {"t":"ack_ok","trace_id":"..."}
    {"t":"error","msg":"..."}                           # denied / limited / duplicated / bad-msg / cloud-off / cloud-failed
    {"t":"cloud_status","state":"on|off|err","err":"..."}   # 云互联状态（join 快照 + 变化推送）
    {"t":"cloud_presence","users":[{"machine","name"}],"me":"..."}  # 远端实例名册
    {"t":"cloud_msg","from_machine","from_name","room":"hall|direct","to_machine","text","ts"}  # 云端入站消息

安全层（一期硬性验收，策划案v3 第四节）:
  - 鉴权: 论坛配置.json 的 token，join 必带（hmac.compare_digest）
  - 限频: 同客户端广播/私聊 1 条/10 秒，超限回 error limited 不转发
  - 熔断: 互 @ 8 轮熔断——A↔B 互刷按【120 秒滚动窗口】计数（2026-11-23 修订：
    旧实现按连接全生命周期累计，真人连续私聊 8+6 条即误触断线；改窗口后
    机器人 2.5 秒/条 的互刷节奏 20 秒内必命中，正常人类对话不再误伤）
  - 幂等: trace_id 去重（保留最近 512 条）
  - 兜底: 1 秒窗口 50 条消息强制断开（防刷爆）
  - 握手 Origin 校验【2026-11-23】: 浏览器 WS 必带 Origin，非本机回环来源
    （127.0.0.1/localhost/[::1]，跨站网页/DNS 重绑定页）握手直接 403 拒绝；
    无 Origin 的本机脚本（bot_chat 等）放行——join 仍须过 token 鉴权
  - 资源防线【2026-11-23】: 握手 10 秒超时 + 空闲 300 秒超时 + 全机连接数上限
    MAX_CONNS=256，防死连接耗尽线程/句柄（前端 30s 心跳保活，远小于空闲阈值）
留缝（进化师课题①）: 全局 seq 序列号 + ROOMS 房间抽象（一期全部固定 'hall'）
"""
import os
import sys
import json
import time
import socket
import hmac
import queue
import threading
from collections import deque

from util_log import get_logger

log = get_logger('ws_plaza')
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))            # server/ 目录
sys.path.insert(0, os.path.dirname(os.path.dirname(_HERE)))  # 项目根

try:
    from server.common import ws_frame  # 绝对导入优先，避免 'common' 命名空间被 engines/common 抢占
except ImportError:
    from common import ws_frame  # 兜底：server 直接以自身为 sys.path 根运行时（此时顶层 common 即本包）

try:
    from config import HOST
except Exception:
    HOST = '127.0.0.1'

PLAZA_PORT = 8625  # 兜底默认与 6.2.0 端口段一致；真源 private/port.json 的 plaza_ws_port（历史：曾用 8586）
try:
    _pj = os.path.join(os.path.dirname(os.path.dirname(_HERE)),
                       'private', 'port.json')
    if os.path.exists(_pj):
        PLAZA_PORT = json.load(open(_pj, 'r', encoding='utf-8-sig')).get(
            'plaza_ws_port') or PLAZA_PORT
except Exception:
    pass

# 【测试隔离】ZF_PLAZA_PORT 环境变量可强制端口：test_plaza 用随机空闲端口起
# 隔离实例验收，避免直连生产大厅造成消息污染。生产环境不设此变量即不受影响。
try:
    PLAZA_PORT = int(os.environ.get('ZF_PLAZA_PORT') or PLAZA_PORT)
except Exception:
    pass

# 鉴权 token：沿用论坛配置.json（策划案v3 第四节）
# 6.0.0 若未配置，回落同机 5.8.0 安装目录的同名配置（仅本机 127.0.0.1 绑定，安全面不变）
_FORUM_CFG = os.path.join(os.path.dirname(os.path.dirname(_HERE)),
                          'private', '论坛配置.json')
_FORUM_CFG_FALLBACK = r''


def _load_tokens():
    for p in (_FORUM_CFG, _FORUM_CFG_FALLBACK):
        try:
            cfg = json.load(open(p, 'r', encoding='utf-8-sig'))
            t = cfg.get('token')
            if isinstance(t, list):
                return set(x for x in t if x)
            if t:
                return {t}
        except Exception:
            continue
    return set()


TOKEN_WINDOW = 10        # 大厅广播限频窗口（秒）：1 条/10 秒
DIRECT_WINDOW = 2        # 私聊限频窗口（秒）：与广播分桶互不挤占
BREAKDOWN_ROUNDS = 8     # 互 @ 8 轮熔断（阈值不变，计数口径见下）
BREAKDOWN_WINDOW = 120   # 互刷计数滚动窗口（秒）：只数窗口内私聊，真人长聊不误触
HANDSHAKE_TIMEOUT = 10   # WS 握手读超时（秒）：不发送握手的死连接快速回收
# 【P1 修复 2026-11-23】空闲超时 300 → 60 秒：recv 超时经 ws_frame.recv_frame 的
# 内部捕获返回 None → 主循环 break → 走既有下线清理（移出 presence/广播离线）。
# 前端 30s 心跳，正常连接远小于此值；半开死连接最多残留 60 秒。
IDLE_TIMEOUT = 60
MAX_CONNS = 256          # 全机并发连接上限（含未 join）：防本机异常脚本耗尽线程/句柄
TRACE_MAX = 512          # trace_id 幂等缓存上限
HALL_ROOM = 'hall'       # 一期固定大厅房间（房间抽象留缝）

MAX_USERS = 50
MAX_TEXT = 2000

# 云互联远端 machine_id 合法性（与云端 agent_chat.asp MachineOk 同口径）
import re as _re
_CLOUD_ID_OK = _re.compile(r'^[A-Za-z0-9_\-]{4,64}$')

# WS 握手 Origin 白名单【2026-11-23】：仅本机回环主机名（端口不限——页面在
# api 口 8620、WS 在 8625，跨端口属正常同机访问）；DNS 重绑定页的 Origin
# 主机名是攻击者域名，被此白名单拦下。无 Origin 头=非浏览器客户端，放行
# （bot_chat 等本机机器人依赖），join 仍须过 token 鉴权。
_LOOPBACK_HOSTS = {'127.0.0.1', 'localhost', '::1', '[::1]'}


def _ws_origin_ok(headers):
    origin = (headers.get('origin') or '').strip()
    if not origin:
        return True
    # 主机名二选一：[IPv6] 括号形式 或 常规主机名，端口可省
    m = _re.match(r'^https?://(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9._\-]+)(?::\d+)?/?$',
                  origin)
    host = (m.group(1) if m else origin).lower()
    return host in _LOOPBACK_HOSTS


def _prune_window(dq, now):
    while dq and now - dq[0] > BREAKDOWN_WINDOW:
        dq.popleft()


def _window_count(store, key, now):
    """熔断滚动窗口计数【2026-11-23】（记录本次发送）：修剪过期时间戳后
    追加当前时刻，返回窗口内该对端的私聊条数。store: {对端name: deque(ts)}。"""
    dq = store.setdefault(key, deque())
    _prune_window(dq, now)
    dq.append(now)
    return len(dq)


def _window_peek(store, key, now):
    """只读查看窗口内条数（不追加——对方此刻并未发消息，不得凭空计入）。"""
    dq = store.get(key)
    if not dq:
        return 0
    _prune_window(dq, now)
    return len(dq)


class _Client:
    def __init__(self, sock, addr):
        self.sock = sock
        self.addr = addr
        self.name = None
        self.alive = True
        self.send_lock = threading.Lock()  # 单发送线程后理论冗余，保留无害
        # 【W2 修复】每连接发送队列：send 只入队即返回，慢客户端不再阻塞广播方
        self.outq = queue.Queue(maxsize=200)
        self.sender_th = None               # 专属发送线程句柄（断开时宽限排队用）
        self.rate_ts = {}                  # 限频分桶: {bucket: 上次时间}
        self.peer_rounds = {}              # 对端name -> deque(窗口内私聊时间戳)（熔断）

    def send(self, obj):
        """【W2 修复】只 put_nowait 入队，实际发送由本连接专属发送线程完成。
        队满 = 该客户端消费不动（慢/假死）：置 alive=False + 关 socket（走既有
        下线清理），绝不阻塞广播方/其他客户端。"""
        try:
            self.outq.put_nowait(obj)
            return True
        except queue.Full:
            self.alive = False
            try:
                self.outq.put_nowait(None)   # 关闭哨兵：唤醒发送线程退出
            except Exception:
                pass
            try:
                self.sock.close()
            except Exception:
                pass
            return False


class PlazaServer:
    def __init__(self):
        self.clients = {}                  # name -> _Client
        self.seen_traces = set()           # trace_id 幂等
        self.trace_order = []              # FIFO 淘汰
        self.seq = 0                       # 全局消息序列号（留缝）
        self.bridge = None                 # i聊天·云互联桥（cloud_bridge，挂载失败为 None）
        self.lock = threading.RLock()
        self._live_conns = 0               # 全机并发连接数（含未 join，资源防线上限用）

    # ---------- 安全层 ----------
    def _token_ok(self, token):
        toks = _load_tokens()
        if not toks:
            return False
        return any(hmac.compare_digest(str(token or ''), t) for t in toks)

    def _safe_img(self, v):
        # 二期图片字段：只放行服务端白名单路径 /uploads/plaza/<随机文件名>，
        # 其余（javascript:/data:/绝对URL/..）一律丢弃 → 无注入面
        s = str(v or '').strip()
        if not s:
            return None
        import re as _re
        if _re.fullmatch(r'/uploads/plaza/[A-Za-z0-9_.]+\.(?:png|jpg|jpeg|gif|webp)', s) and '..' not in s:
            return s
        return None

    def _rate_ok(self, cli, bucket='hall'):        # 按消息类型分桶限频：广播(10s/条)与私聊互不挤占（私聊单独较宽窗口）
        now = time.time()
        last = cli.rate_ts.get(bucket, 0)
        win = TOKEN_WINDOW if bucket == 'hall' else DIRECT_WINDOW
        if now - last < win:
            return False
        cli.rate_ts[bucket] = now
        return True

    def _trace_dup(self, tid):
        if not tid:
            return False
        with self.lock:
            if tid in self.seen_traces:
                return True
            self.seen_traces.add(tid)
            self.trace_order.append(tid)
            while len(self.trace_order) > TRACE_MAX:
                self.seen_traces.discard(self.trace_order.pop(0))
            return False

    def _next_seq(self):
        with self.lock:
            self.seq += 1
            return self.seq

    def _presence(self):
        with self.lock:
            return sorted(self.clients.keys())

    def _sender_loop(self, cli):
        """【W2 修复】本连接专属 daemon 发送线程：循环取队列 → ws_frame 发送。
        只认 None 关闭哨兵退出（已出队消息尽力发完——denied/limited 等"报错即断"
        场景的最后一条不得丢）。发送失败 → alive=False 并关 socket，令其 recv
        循环即刻失败走既有下线清理。服务 stop/单例重建时靠 socket close 退出。"""
        while True:
            try:
                obj = cli.outq.get(timeout=5)
            except queue.Empty:
                if not cli.alive:
                    return
                continue
            if obj is None:                # None = 关闭哨兵
                return
            try:
                # sock 带 IDLE_TIMEOUT 超时：慢客户端发不动只拖住它自己的发送线程
                if not ws_frame.send_frame(cli.sock, obj, cli.send_lock):
                    cli.alive = False
                    self._drop(cli.sock)
                    return
            except Exception:
                cli.alive = False
                self._drop(cli.sock)
                return

    def _broadcast(self, obj, exclude=None):
        with self.lock:
            targets = [c for n, c in self.clients.items() if n != exclude]
        for c in targets:
            # 【W2 修复 2026-11-23】每连接发送队列：c.send 只 put_nowait 即返回，
            # 广播方永不被单个慢客户端的 socket 阻塞；队满时该客户端被 send()
            # 内部置 alive=False 并关 socket，只影响它自己。
            try:
                ok = c.send(obj)
            except Exception:
                ok = False
            if not ok:
                c.alive = False
                self._drop(c.sock)  # 立即关 socket，令其 recv 循环即刻失败并走下线清理

    # ---------- 消息分发 ----------
    def _dispatch(self, cli, msg):
        t = msg.get('t')
        if t == 'join':
            name = str(msg.get('name') or '').strip()[:32]
            if not name or not self._token_ok(msg.get('token')):
                cli.send({'t': 'error', 'msg': 'denied'})
                cli.alive = False
                return
            with self.lock:
                if name in self.clients and self.clients[name].alive:
                    cli.send({'t': 'error', 'msg': 'name-taken'})
                    return
                if len(self.clients) >= MAX_USERS:
                    cli.send({'t': 'error', 'msg': 'full'})
                    return
                self.clients[name] = cli
                cli.name = name
            cli.send({'t': 'joined', 'ok': True, 'name': name})
            self._send_cloud_snapshot(cli)       # 云互联快照（状态+远端名册，未启用不发）
            self._broadcast({'t': 'presence', 'users': self._presence()})
            return

        if not cli.name:
            cli.send({'t': 'error', 'msg': 'denied'})
            return

        if t == 'leave':
            cli.alive = False
            return

        if t == 'ping':
            cli.send({'t': 'pong'})
            return

        if t == 'hall':
            text = str(msg.get('text') or '')[:MAX_TEXT]
            img = self._safe_img(msg.get('img'))
            if (not text) and (not img):
                return
            if not self._rate_ok(cli, 'hall'):
                cli.send({'t': 'error', 'msg': 'limited'})
                return
            if self._trace_dup(msg.get('trace_id')):
                cli.send({'t': 'error', 'msg': 'duplicated'})
                return
            out = {'t': 'hall', 'room': HALL_ROOM,
                   'from': cli.name, 'text': text,
                   'seq': self._next_seq(), 'ts': int(time.time())}
            if img:
                out['img'] = img
            self._broadcast(out)
            cli.send({'t': 'ack_ok', 'trace_id': msg.get('trace_id')})
            return

        if t == 'direct':
            to = str(msg.get('to') or '').strip()[:32]
            text = str(msg.get('text') or '')[:MAX_TEXT]
            img = self._safe_img(msg.get('img'))
            if (not to) or (not text and not img) or to == cli.name:
                return
            if not self._rate_ok(cli, 'direct'):
                cli.send({'t': 'error', 'msg': 'limited'})
                return
            if self._trace_dup(msg.get('trace_id')):
                cli.send({'t': 'error', 'msg': 'duplicated'})
                return
            with self.lock:
                peer = self.clients.get(to)
                # 互 @ 熔断（策划案v3 安全层）：双向各在【120 秒滚动窗口】内
                # 计数私聊，A 窗口内对 B 发满 8 条且 B 对 A 也发满 6 条才断 A。
                # 旧版按连接全程累计，真人正常私聊十几条即被误断；机器人
                # 2.5 秒/条 的互刷节奏仍会在窗口内快速命中，防护不弱化。
                now = time.time()
                rounds = _window_count(cli.peer_rounds, to, now)
                peer_round = (_window_peek(peer.peer_rounds, cli.name, now)
                              if peer else 0)
                breakdown = (rounds >= BREAKDOWN_ROUNDS
                             and peer_round >= BREAKDOWN_ROUNDS - 2)
            if breakdown:
                cli.send({'t': 'error', 'msg': 'breakdown'})
                cli.alive = False
                return
            if peer and peer.alive:
                out = {'t': 'direct', 'from': cli.name, 'text': text,
                       'seq': self._next_seq(), 'ts': int(time.time())}
                if img:
                    out['img'] = img
                peer.send(out)
                cli.send({'t': 'ack_ok', 'trace_id': msg.get('trace_id')})
            else:
                # 对方离线 → 回落 forum 留言层由客户端/智能体侧执行（策划案v3）
                cli.send({'t': 'error', 'msg': 'offline-fallback-forum',
                          'to': to})
                # 提示在线列表刷新
                cli.send({'t': 'presence', 'users': self._presence()})

        # ---------- i聊天·云互联：出站到云中继（to='' 即互联大厅） ----------
        if t == 'cloud_say':
            if not (self.bridge and self.bridge.enabled):
                cli.send({'t': 'error', 'msg': 'cloud-off'})
                return
            to = str(msg.get('to') or '').strip()[:64]
            text = str(msg.get('text') or '')[:MAX_TEXT]
            if (not text) or (to and not _CLOUD_ID_OK.match(to)):
                return
            if not self._rate_ok(cli, 'cloud'):
                cli.send({'t': 'error', 'msg': 'limited'})
                return
            if self._trace_dup(msg.get('trace_id')):
                cli.send({'t': 'error', 'msg': 'duplicated'})
                return
            ok, err = self.bridge.send(to, text)
            if ok:
                cli.send({'t': 'ack_ok', 'trace_id': msg.get('trace_id')})
            else:
                cli.send({'t': 'error', 'msg': 'cloud-failed', 'detail': err})
            return

    # ---------- 云互联辅助 ----------
    def _send_cloud_snapshot(self, cli):
        """新客户端 join 后补发云互联快照：状态 + 远端名册（未挂载/未启用则发 off）。"""
        try:
            if not self.bridge:
                return
            st = self.bridge.state if self.bridge.enabled else 'off'
            cli.send({'t': 'cloud_status', 'state': st, 'err': self.bridge.state_err,
                      'machine': self.bridge.machine, 'name': self.bridge.name})
            if st == 'on':
                cli.send({'t': 'cloud_presence', 'users': self.bridge.presence(),
                          'me': self.bridge.machine})
        except Exception:
            pass

    # ---------- 连接处理 ----------
    def _handle(self, sock, addr):
        # 资源防线【2026-11-23】：并发连接超上限直接拒绝
        # （防本机异常脚本/泄漏连接耗尽线程与句柄，不影响主服务）
        with self.lock:
            self._live_conns += 1
            over_limit = self._live_conns > MAX_CONNS
        if over_limit:
            self._drop(sock)
            with self.lock:
                self._live_conns -= 1
            return
        try:
            self._serve_conn(sock, addr)
        finally:
            with self.lock:
                self._live_conns -= 1

    def _drop(self, sock):
        try:
            sock.close()
        except Exception:
            pass

    def _serve_conn(self, sock, addr):
        # 握手 10 秒读超时：不完成握手的死连接快速回收；
        # Origin 越界（跨站网页/DNS 重绑定页）在握手层 403 拒绝【2026-11-23】
        try:
            sock.settimeout(HANDSHAKE_TIMEOUT)
            hs_ok = ws_frame.handshake(sock, origin_checker=_ws_origin_ok)
        except Exception:
            hs_ok = False
        if not hs_ok:
            self._drop(sock)
            return
        sock.settimeout(IDLE_TIMEOUT)   # 空闲超时兜底回收半开连接（前端 30s 心跳，远小于此值）
        cli = _Client(sock, addr)
        # 【W2 修复】握手成功即启动本连接专属发送线程（早于 join：denied/
        # name-taken/full 等错误帧也要经队列送达该客户端）
        cli.sender_th = threading.Thread(target=self._sender_loop, args=(cli,),
                                         daemon=True, name='plaza-ws-sender')
        cli.sender_th.start()
        win_start = time.time()
        win_count = 0
        while cli.alive:
            frame = ws_frame.recv_frame(sock)
            if frame is None:
                break
            _, payload = frame
            if not payload:
                continue
            now = time.time()
            if now - win_start >= 1:
                win_start = now
                win_count = 0
            win_count += 1
            if win_count > 50:            # 防刷爆兜底
                break
            try:
                msg = json.loads(payload.decode('utf-8'))
            except Exception:
                continue
            try:
                self._dispatch(cli, msg)
            except Exception:
                pass
        # 清理下线
        # 【W2 修复】有界宽限：让发送线程把队尾消息（如 denied/limited 这类
        # "报错即断开"的最后一条）发完再关：队列空/发送线程已死/2 秒超时即止；
        # 对端真死时 sendall 立刻失败不会拖满宽限。
        _deadline = time.time() + 2.0
        while (not cli.outq.empty() and cli.sender_th is not None
               and cli.sender_th.is_alive() and time.time() < _deadline):
            time.sleep(0.05)
        time.sleep(0.1)             # 给最后一条的在途 sendall 留收尾时间
        cli.alive = False
        try:
            cli.outq.put_nowait(None)   # 【W2 修复】关闭哨兵：唤醒发送线程退出
        except Exception:
            pass
        with self.lock:
            if cli.name and self.clients.get(cli.name) is cli:
                self.clients.pop(cli.name, None)
        self._drop(sock)
        if cli.name:
            self._broadcast({'t': 'presence', 'users': self._presence()})

    def serve(self):
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            # 【P1 修复 2026-11-23】去掉 SO_REUSEADDR（Windows 双绑定危害：两个进程
            # 同绑一端口不报错、连接随机投递到旧实例）。绑定失败走既有降级分支。
            srv.bind((HOST, PLAZA_PORT))
        except OSError as e:
            log.error(f'[PlazaWS] 端口 {PLAZA_PORT} 绑定失败，广场服务跳过启动'
                  f'（不影响主服务）: {e}')
            srv.close()
            return False
        srv.listen(64)
        log.info(f'[PlazaWS] listening on ws://{HOST}:{PLAZA_PORT}  (广场广场！)')
        while True:
            try:
                sock, addr = srv.accept()
            except OSError:
                break
            threading.Thread(target=self._handle, args=(sock, addr),
                             daemon=True).start()
        return True

    def start_background(self):
        threading.Thread(target=self.serve, daemon=True,
                         name='plaza-ws').start()


_instance = None
_instance_lock = threading.Lock()


def start_plaza_ws():
    """供 server.py 主流程调用（同 start_thumb_warmup 挂载模式）"""
    global _instance
    with _instance_lock:
        if _instance is None:
            _instance = PlazaServer()
            # bind 失败在 serve() 内打日志并返回，不影响主服务
            _instance.start_background()
            # i聊天·云互联：挂载云桥（轮询 zf3d.com 中继，失败/未配置只降级不拖累广场）
            try:
                from plaza.cloud_bridge import attach_cloud_bridge
                _instance.bridge = attach_cloud_bridge(_instance)
            except Exception as _e:
                log.error(f'[PlazaWS] 云桥挂载失败（广场保持纯本机模式）: {_e}')
    return _instance


if __name__ == '__main__':
    PlazaServer().serve()
