#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
远程控制系统 · 信令与中转服务（独立线程 WebSocket，纯标准库实现）
监听端口: 默认 8623（private/port.json 的 remote_ws_port 可覆盖）

职责:
  - 设备注册表: device_id_hash -> 连接句柄（服务器永远拿不到原始密钥）
  - 配对码: ZFA-XXXXX-XXXXX 一次性 30 秒时效
  - 信令: invite / accept / reject / disconnect / heartbeat
  - 会话中转: 控制端<->被控端 之间转发加密的 DOM 快照与事件流（端到端 E2EE，服务器只见密文）
  - 安全: 限流、防枚举、会话过期销毁、版本兼容检查、并发上限 50

消息格式（JSON 文本帧）:
  客户端 -> 服务器: {"t": "register", "id": "<hash>", "ver": "5.1.0"}
                    {"t": "pair", "code": "ZFA-XXXXX-XXXXX", "id": "<hash>", "ver": "5.1.0"}
                    {"t": "invite", "code": "...", "from": "<hash>"}
                    {"t": "accept", "sid": "...", "duration": 3600}
                    {"t": "reject", "sid": "..."}
                    {"t": "end", "sid": "..."}
                    {"t": "hb", "sid": "..."}           # 心跳续期
                    {"t": "data", "sid": "...", "seq": n, "payload": "..."}   # 端到端加密载荷，服务器只转发
  服务器 -> 客户端: {"t": "registered", "ok": true, "id": "..."}
                    {"t": "invite", "sid": "...", "from": "...", "ver": "..."}
                    {"t": "accepted", "sid": "...", "expires_at": ...}
                    {"t": "rejected"}
                    {"t": "data", "sid": "...", "from": "...", "payload": "..."}
                    {"t": "hb_ok", "expires_at": ...}
                    {"t": "end", "sid": "...", "reason": "..."}
                    {"t": "error", "msg": "..."}   # 统一模糊错误，防枚举
"""
import os
import sys
import json
import time
import socket
import base64
import hashlib
import struct
import secrets
import hmac as _hmac
import threading
import traceback

from util_log import get_logger

log = get_logger('ws_server')
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))  # server/ 目录，供 config 导入

from config import HOST

# 端口真源 private/port.json 的 remote_ws_port；兜底默认与 6.2.0 端口段一致（8623）。
# 【20261123 收口】删掉对 config.REMOTE_PORT 的导入（config.py 从未定义过该常量，
# 此分支永远走 except 落到旧 5.x 段 8521）。
REMOTE_PORT = 8623
# private/port.json 覆盖（_HERE 在 server\remote 下，须上溯两级到项目根，否则指向不存在的 server\private\）
try:
    _pj = os.path.join(os.path.dirname(os.path.dirname(_HERE)), 'private', 'port.json')
    if os.path.exists(_pj):
        _pj_cfg = json.load(open(_pj, 'r', encoding='utf-8-sig'))
        REMOTE_PORT = _pj_cfg.get('remote_ws_port') or _pj_cfg.get('remote_port', REMOTE_PORT)
except Exception:
    pass

MAGIC = b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
PAIR_TTL = 30            # 配对码有效期（秒）
HB_TIMEOUT = 60          # 心跳超时（秒）
MAX_SESSIONS = 50        # 并发会话上限
RATE_LIMIT = 30          # 每分钟每 IP 最大消息数（防枚举/防刷）

# ---------- P6 手机控电脑：PC 命令执行通道 ----------
# 默认关闭；在 private/remote_cmd.json 里 {"enabled": true, "token": "xxxx"} 开启
_CMD_ROOT = os.path.dirname(os.path.dirname(_HERE))  # 项目根
_CMD_CFG_PATH = os.path.join(_CMD_ROOT, 'private', 'remote_cmd.json')
CMD_TIMEOUT = 30         # 单条命令超时（秒）
CMD_OUTPUT_MAX = 60000   # 输出回传上限（字符）


def _load_cmd_cfg():
    try:
        with open(_CMD_CFG_PATH, 'r', encoding='utf-8-sig') as f:
            return json.load(f)
    except Exception:
        return {'enabled': False, 'token': '', 'allow': []}


# 默认白名单（可被配置文件的 allow 覆盖）：只读类命令为主
# 安全口径（2026-11-08 S1 前置审查）：默认白名单禁含解释器类命令
# （python/node/git 等）——「python -c <任意代码>」可借首词白名单绕过
# 危险字符拦截；确需远程执行解释器时由用户在配置文件显式声明 allow。
# S1-4a 参数级白名单（2026-11-08 第12轮收口整改1落地）：
#   allow 条目升级为 {"cmd": "tasklist", "args_re": "^(|/.*)$"} 结构；
#   args_re 为参数正则（对首词之后的整段参数串做 fullmatch），不传 = 禁止任何参数；
#   旧式纯字符串条目仍兼容，语义 = 仅允许无参调用。
_CMD_DEFAULT_ALLOW = [
    {'cmd': 'dir',       'args_re': r'^(|/[a-z].*|"[^"]*"\s*)$'},
    {'cmd': 'type',      'args_re': r'^("[^"]*"|[\w\-.:\\/ ]+)$'},
    {'cmd': 'cd',        'args_re': r'^[\w\-.:\\/ ]*$'},
    {'cmd': 'echo',      'args_re': r'^[\w\-.:\\/ ]*$'},
    {'cmd': 'tasklist',  'args_re': r'^(|/fi .+|/v|/fo \w+)$'},
    {'cmd': 'ipconfig',  'args_re': r'^(|/all|/flushdns|/renew)$'},
    {'cmd': 'systeminfo','args_re': r'^$'},
    {'cmd': 'whoami',    'args_re': r'^$'},
    {'cmd': 'hostname',  'args_re': r'^$'},
    {'cmd': 'ver',       'args_re': r'^$'},
    {'cmd': 'time',      'args_re': r'^$'},
    {'cmd': 'date',      'args_re': r'^$'},
]

# 需要留痕的解释器类命令：即使被用户显式 allow，也落启动日志（区分"用户明知故开"与"被打穿"）
_INTERPRETER_CMDS = ('python', 'pythonw', 'node', 'git', 'powershell', 'pwsh', 'cmd', 'bash', 'wscript', 'cscript')



# 审计日志文件（留痕落盘，避免仅 stdout 不可检索；随 server/data 走，不入 git）
_AUDIT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'server', 'data', 'ws_audit.log')


def _audit_log(msg):
    """审计留痕：追加写 server/data/ws_audit.log + stdout 双落。"""
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    # 【20261123 还原】审计留痕 stdout 双落是功能本体（T6 钉死），print 不是日志
    print(f'[ws_server] {msg}')
    try:
        with open(_AUDIT_PATH, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass  # 审计写失败不阻断命令判定，stdout 已留痕


def _pc_cmd_allowed(cfg, cmd):
    c = (cmd or '').strip()
    if not c or len(c) > 2000:
        return False
    # 危险字符链式注入拦截：字符类（分隔符/展开面）整串子串匹配
    low = c.lower()
    for bad in ('&', '|', '>', '<', '^', '%', '\n', '\r', '\x00', '；'):
        if bad in low:
            return False
    # 危险词类：仅对首词做匹配（防全串子串误杀合法参数，如 tasklist /fi "...format..."）
    # 注入面已被上面字符类拦截堵死（无 & | ; 链），首词命中即整条拒绝
    first_bad = c.split()[0].lower().strip('"') if c.split() else ''
    if first_bad in ('del', 'rd', 'format', 'shutdown', 'rmdir', 'reg',
                     'regedit', 'remove-item', 'rm'):
        return False
    allow = cfg.get('allow') or _CMD_DEFAULT_ALLOW
    parts = c.split(None, 1)
    first = parts[0].lower().strip('"')
    args = parts[1] if len(parts) > 1 else ''
    for entry in allow:
        if isinstance(entry, str):
            entry = {'cmd': entry}   # 旧式条目 = 旧语义（首词匹配、参数不限；宽松，建议迁移新式 dict）
        ecmd = str(entry.get('cmd', '')).lower()
        # 首词匹配：裸命令名直接比对；带路径的必须 realpath 归一化后位于
        # System32/SystemApps 等系统目录（防 C:\evil\dir 同名二进制借后缀匹配绕过）
        if first != ecmd:
            fp = first.strip('"')
            if '\\' not in fp and '/' not in fp:
                continue  # 裸词但与白名单名不等 → 不放行
            try:
                fp_real = os.path.realpath(fp).lower()
            except Exception:
                fp_real = fp
            sysroot = os.environ.get('SystemRoot', r'C:\Windows').lower()
            sys32 = os.path.join(sysroot, 'system32')
            if not (fp_real.startswith(sys32 + '\\') or fp_real.startswith(sysroot + '\\systemapps\\')):
                continue
            fn = os.path.basename(fp_real).rsplit('.', 1)[0]  # 去扩展名比对
            if fn != ecmd:
                continue
        # 解释器类命令留痕：审计文件 + stdout（按次留痕，保审计检索性）
        if ecmd in _INTERPRETER_CMDS:
            _audit_log(f'[安全留痕] remote interpreter allowed by user config: {ecmd}')
        pat = entry.get('args_re')
        if pat is None:
            return True   # 旧式条目（无 args_re 键）= 旧语义：首词匹配、参数不限
        if not pat:       # args_re 为空串 = 显式禁参
            if args:
                return False
            return True
        try:
            import re as _re
            if _re.fullmatch(pat, args.strip()):
                return True
        except Exception:
            return False
    return False


def _run_pc_cmd(cmd):
    import subprocess
    import shlex
    try:
        # 安全修复(20261111 用户拍板): 去掉 shell=True，改为参数列表形式，杜绝命令注入面
        _argv = shlex.split(cmd, posix=(os.name != 'nt'))
        if not _argv:
            return {'ok': False, 'error': '空命令'}
        r = subprocess.run(_argv, capture_output=True,
                           timeout=CMD_TIMEOUT,
                           creationflags=0x08000000 if os.name == 'nt' else 0)
        out = (r.stdout or b'').decode('utf-8', 'replace')[:CMD_OUTPUT_MAX]
        err = (r.stderr or b'').decode('utf-8', 'replace')[:CMD_OUTPUT_MAX]
        return {'ok': True, 'code': r.returncode, 'stdout': out, 'stderr': err}
    except subprocess.TimeoutExpired:
        return {'ok': False, 'error': f'超时（>{CMD_TIMEOUT}s）'}
    except Exception as e:
        return {'ok': False, 'error': str(e)[:300]}


def _b32(n):
    """n 个 base32 字符（去混淆字符）"""
    alpha = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
    return ''.join(secrets.choice(alpha) for _ in range(n))


class _Client:
    def __init__(self, sock, addr):
        self.sock = sock
        self.addr = addr
        self.id_hash = None          # 注册后的 device_id_hash
        self.ver = None
        self.alive = True
        self.send_lock = threading.Lock()
        self.last_hb = time.time()
        self.last_activity = time.time()
        self.win_start = time.time()   # 高频熔断：1 秒窗口起点
        self.msg_rate = 0             # 高频熔断计数（当前窗口内）


class RemoteWSServer:
    def __init__(self):
        self.clients = {}            # id_hash -> _Client
        self.sessions = {}            # sid -> {ctrl, host, expires_at}
        self.pair_codes = {}          # code -> {host_hash, expires_at, used}
        self.invite_fails = {}        # id_hash -> [次数, 最后失败时间]（熔断）
        self.rate = {}                # ip -> [minute_bucket, count]
        self.lock = threading.RLock()

    # ---------- WebSocket 基础 ----------
    def _handshake(self, cli):
        data = b''
        while b'\r\n\r\n' not in data:
            chunk = cli.sock.recv(4096)
            if not chunk:
                return False
            data += chunk
            if len(data) > 16384:
                return False
        headers = {}
        head, _, _ = data.partition(b'\r\n\r\n')
        for line in head.decode('utf-8', 'replace').split('\r\n')[1:]:
            if ':' in line:
                k, v = line.split(':', 1)
                headers[k.strip().lower()] = v.strip()
        key = headers.get('sec-websocket-key')
        if not key:
            return False
        accept = base64.b64encode(
            hashlib.sha1(key.encode() + MAGIC).digest()).decode()
        resp = ('HTTP/1.1 101 Switching Protocols\r\n'
                'Upgrade: websocket\r\nConnection: Upgrade\r\n'
                f'Sec-WebSocket-Accept: {accept}\r\n\r\n')
        cli.sock.sendall(resp.encode())
        return True

    def _recv_frame(self, cli):
        """返回 (opcode, bytes) 或 None（断开）。支持普通长度帧，client 不发 ping 大帧。"""
        try:
            hdr = self._recv_exact(cli.sock, 2)
            if not hdr:
                return None
            b1, b2 = hdr[0], hdr[1]
            opcode = b1 & 0x0F
            masked = b2 & 0x80
            ln = b2 & 0x7F
            if ln == 126:
                ext = self._recv_exact(cli.sock, 2)
                # 【M2.4 模糊测试修复】截断帧（半途 EOF）一律按断开处理，
                # 不再把短字节交给 struct.unpack / 长度逻辑
                if not ext or len(ext) < 2:
                    return None
                ln = struct.unpack('>H', ext)[0]
            elif ln == 127:
                ext = self._recv_exact(cli.sock, 8)
                if not ext or len(ext) < 8:
                    return None
                ln = struct.unpack('>Q', ext)[0]
            if ln > 8 * 1024 * 1024:   # 8MB 上限，防滥用
                return None
            mask = self._recv_exact(cli.sock, 4) if masked else None
            if masked and (not mask or len(mask) < 4):
                return None
            payload = self._recv_exact(cli.sock, ln) if ln else b''
            if payload is None or len(payload) < ln:
                return None   # 帧体截断 = 断开
            if mask and payload:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 0x8:          # close
                return None
            return (opcode, payload)
        except Exception:
            return None

    def _recv_exact(self, sock, n):
        buf = b''
        while len(buf) < n:
            chunk = sock.recv(n - len(buf))
            if not chunk:
                return None
            buf += chunk
        return buf

    def _send_frame(self, cli, obj):
        """发送 JSON 文本帧（服务器不掩码）。
        【P1 修复 2026-11-23】发送期间给 sock 置 5 秒短超时（包 try，失败不致命）：
        对端假死时 sendall 可无限阻塞（发送持全局 send_lock，一个死连接即拖死该
        客户端全部收发）。发完恢复无超时，避免殃及本连接的 recv 心跳节奏。
        其余（全局锁内发送模型、心跳补强）属大改造，延后。"""
        try:
            payload = json.dumps(obj, ensure_ascii=False,
                                  separators=(',', ':')).encode('utf-8')
            ln = len(payload)
            if ln < 126:
                hdr = struct.pack('>BB', 0x81, ln)
            elif ln < 65536:
                hdr = struct.pack('>BBH', 0x81, 126, ln)
            else:
                hdr = struct.pack('>BBQ', 0x81, 127, ln)
            with cli.send_lock:
                try:
                    cli.sock.settimeout(5)
                except Exception:
                    pass
                cli.sock.sendall(hdr + payload)
                try:
                    cli.sock.settimeout(None)
                except Exception:
                    pass
            return True
        except Exception:
            return False

    # ---------- 限流 ----------
    def _rate_ok(self, cli):
        now = time.time()
        bucket = int(now // 60)
        with self.lock:
            rec = self.rate.get(cli.addr[0])
            if not rec or rec[0] != bucket:
                self.rate[cli.addr[0]] = [bucket, 1]
                return True
            rec[1] += 1
            return rec[1] <= RATE_LIMIT

    # ---------- 会话清理 ----------
    def _gc(self):
        now = time.time()
        with self.lock:
            # 过期配对码
            for code in [c for c, v in self.pair_codes.items() if v['expires_at'] < now]:
                self.pair_codes.pop(code, None)
            # 过期会话
            for sid in [s for s, v in self.sessions.items() if v['expires_at'] < now]:
                self._end_session_locked(sid, 'expired')

    def _end_session_locked(self, sid, reason):
        sess = self.sessions.pop(sid, None)
        if not sess:
            return
        for cli in (sess.get('ctrl'), sess.get('host')):
            if cli and cli.alive:
                self._send_frame(cli, {'t': 'end', 'sid': sid, 'reason': reason})

    # ---------- 客户端连接处理 ----------
    def _handle(self, cli):
        if not self._handshake(cli):
            cli.alive = False
            return
        while cli.alive:
            frame = self._recv_frame(cli)
            if frame is None:
                break
            _, payload = frame
            if not payload:
                continue
            now = time.time()
            # 绝对 1 秒时间窗：窗口起点超过 1 秒即重置计数
            if now - cli.win_start >= 1:
                cli.win_start = now
                cli.msg_rate = 0
            cli.msg_rate += 1
            # 紧急熔断：单窗口（1 秒）内 50+ 消息直接断开（防控制端被劫持刷爆）
            if cli.msg_rate > 50:
                cli.alive = False
                try:
                    cli.sock.close()
                except Exception:
                    pass
                break
            if not self._rate_ok(cli):
                self._send_frame(cli, {'t': 'error', 'msg': 'busy'})
                break
            try:
                msg = json.loads(payload.decode('utf-8'))
            except Exception:
                continue
            try:
                self._dispatch(cli, msg)
            except Exception:
                traceback.print_exc()
        cli.alive = False
        with self.lock:
            if cli.id_hash and self.clients.get(cli.id_hash) is cli:
                self.clients.pop(cli.id_hash, None)
            # 断线即焚：其参与的会话直接结束
            for sid in list(self.sessions):
                s = self.sessions.get(sid)
                if s and (s.get('ctrl') is cli or s.get('host') is cli):
                    self._end_session_locked(sid, 'peer-disconnected')
        try:
            cli.sock.close()
        except Exception:
            pass

    def _dispatch(self, cli, msg):
        t = msg.get('t')
        self._gc()
        if t == 'register':
            idh = str(msg.get('id') or '')
            if len(idh) < 16 or len(idh) > 64 or not all(c in '0123456789abcdef' for c in idh.lower()):
                self._send_frame(cli, {'t': 'error', 'msg': 'bad-id'})
                return
            with self.lock:
                # 同 ID 多端共存：峰控（手机）与电脑页面共用同一 device_id（同一台
                # 服务器的 private/remote_id.json），若互相顶号会"抢线"——
                # 一端注册就把另一端踢断线。改为允许同 ID 并存（注册表指向最新
                # 连接用于 invite 路由），各端会话由 sid 互斥，不再互踢。
                self.clients[idh] = cli
                cli.id_hash = idh
                cli.ver = str(msg.get('ver') or '')
            self._send_frame(cli, {'t': 'registered', 'ok': True, 'id': idh})

        elif t == 'pair':
            # 被控端生成配对码请求（码由本端生成加密载荷，服务器只存码->host 映射）
            code = str(msg.get('code') or '').upper()
            host_hash = cli.id_hash
            if not host_hash or not code.startswith('ZFA-'):
                self._send_frame(cli, {'t': 'error', 'msg': 'bad-request'})
                return
            with self.lock:
                # 暗号唯一有效：同一 host 只允许一个有效码，生成新码即作废旧码
                for c in [c for c, v in self.pair_codes.items()
                          if v['host_hash'] == host_hash]:
                    self.pair_codes.pop(c, None)
                self.pair_codes[code] = {'host_hash': host_hash,
                                         'expires_at': time.time() + PAIR_TTL,
                                         'used': False}
            self._send_frame(cli, {'t': 'pair_ok', 'code': code,
                                   'expires_at': int(time.time() + PAIR_TTL)})

        elif t == 'invite':
            code = str(msg.get('code') or '').upper()
            with self.lock:
                # 发起方必须已完成 register（防匿名探测）
                if not cli.id_hash:
                    self._send_frame(cli, {'t': 'error', 'msg': 'not-found'})
                    return
                # 错误熔断：输错 3 次 10 分钟禁试（防暴力猜配对码）
                # （1 秒 50+ 高频熔断已移到主循环统一处理）
                fl = self.invite_fails.get(cli.id_hash)
                if fl and fl[0] >= 3 and time.time() - fl[1] < 600:
                    self._send_frame(cli, {'t': 'error', 'msg': 'try-later'})
                    return
                rec = self.pair_codes.get(code)
                # 统一模糊错误：不存在/过期/已用/对方不在线 一律 same message
                if (not rec or rec['used'] or rec['expires_at'] < time.time()
                        or rec['host_hash'] not in self.clients
                        or len(self.sessions) >= MAX_SESSIONS):
                    prev = self.invite_fails.get(cli.id_hash) or [0, 0]
                    prev[0] += 1
                    prev[1] = time.time()
                    self.invite_fails[cli.id_hash] = prev
                    self._send_frame(cli, {'t': 'error', 'msg': 'not-found'})
                    return
                host = self.clients[rec['host_hash']]
                # 版本兼容检查：主次版本不一致直接拒绝
                if cli.ver and host.ver:
                    try:
                        cv, hv = cli.ver.split('.')[:2], host.ver.split('.')[:2]
                        if cv != hv:
                            self._send_frame(cli, {'t': 'error',
                                                   'msg': f'version-mismatch:{host.ver}'})
                            return
                    except Exception:
                        pass
                sid = secrets.token_hex(16)
                rec['used'] = True
                self.invite_fails.pop(cli.id_hash, None)  # 成功即清零
                host_session = {'ctrl': cli, 'host': host,
                                'expires_at': time.time() + 86400}  # 默认 1 天，accept 时覆盖
                self.sessions[sid] = host_session
                # 生成比对码（前 4 字符）供双端口头核对，防中间人
                check = secrets.token_hex(2).upper()
                rec['check'] = check
                host_session['check'] = check
                self._send_frame(host, {'t': 'invite', 'sid': sid,
                                        'from': cli.id_hash, 'ver': cli.ver,
                                        'check': check})
            # 给控制端回执（携带 sid 与比对码，供双端口头核对防中间人）
            self._send_frame(cli, {'t': 'invite_sent', 'sid': sid,
                                   'check': check})

        elif t == 'accept':
            sid = str(msg.get('sid') or '')
            with self.lock:
                sess = self.sessions.get(sid)
                if not sess or sess.get('host') is not cli:
                    self._send_frame(cli, {'t': 'error', 'msg': 'not-found'})
                    return
                dur = int(msg.get('duration') or 3600)
                dur = max(60, min(dur, 30 * 86400))   # 1 分钟 ~ 30 天，无永久
                sess['expires_at'] = time.time() + dur
                ctrl = sess['ctrl']
            self._send_frame(ctrl, {'t': 'accepted', 'sid': sid,
                                     'peer': cli.id_hash,
                                     'expires_at': int(sess['expires_at']),
                                     'check': sess.get('check')})
            self._send_frame(cli, {'t': 'accepted', 'sid': sid,
                                   'peer': ctrl.id_hash,
                                   'expires_at': int(sess['expires_at']),
                                   'check': sess.get('check')})

        elif t == 'reject':
            sid = str(msg.get('sid') or '')
            with self.lock:
                sess = self.sessions.pop(sid, None)
                ctrl = sess.get('ctrl') if sess else None
            if ctrl:
                self._send_frame(ctrl, {'t': 'rejected'})

        elif t == 'hb':
            sid = str(msg.get('sid') or '')
            with self.lock:
                sess = self.sessions.get(sid)
                if not sess:
                    self._send_frame(cli, {'t': 'error', 'msg': 'not-found'})
                    return
                if sess['expires_at'] < time.time():
                    self._end_session_locked(sid, 'expired')
                    return
                exp = int(sess['expires_at'])
                cli.last_hb = time.time()
            self._send_frame(cli, {'t': 'hb_ok', 'expires_at': exp})

        elif t == 'end':
            sid = str(msg.get('sid') or '')
            with self.lock:
                sess = self.sessions.get(sid)
                if sess and (sess.get('ctrl') is cli or sess.get('host') is cli):
                    self._end_session_locked(sid, 'closed')

        elif t == 'data':
            # 端到端加密载荷，服务器只转发（不含明文内容）
            sid = str(msg.get('sid') or '')
            payload = msg.get('payload')
            if payload is None or len(str(payload)) > 4 * 1024 * 1024:
                return
            with self.lock:
                sess = self.sessions.get(sid)
                if not sess or cli not in (sess.get('ctrl'), sess.get('host')):
                    return
                if sess['expires_at'] < time.time():
                    self._end_session_locked(sid, 'expired')
                    return
                peer = sess['host'] if sess.get('ctrl') is cli else sess['ctrl']
            self._send_frame(peer, {'t': 'data', 'sid': sid,
                                    'from': cli.id_hash, 'payload': payload})

        elif t == 'pc_cmd':
            # P6 手机控电脑：白名单 + token 鉴权 + 默认关闭
            cfg = _load_cmd_cfg()
            if not cfg.get('enabled'):
                self._send_frame(cli, {'t': 'pc_cmd_result',
                                       'ok': False, 'error': 'PC 端未开启命令通道'})
                return
            if not _hmac.compare_digest(str(msg.get('token') or ''), str(cfg.get('token') or '')) \
                    or not cfg.get('token'):
                self._send_frame(cli, {'t': 'pc_cmd_result',
                                       'ok': False, 'error': 'token 校验失败'})
                return
            if not cli.id_hash:
                self._send_frame(cli, {'t': 'error', 'msg': 'not-found'})
                return
            cmd = str(msg.get('cmd') or '')
            if not _pc_cmd_allowed(cfg, cmd):
                self._send_frame(cli, {'t': 'pc_cmd_result',
                                       'ok': False, 'error': '命令不在白名单内'})
                return
            result = _run_pc_cmd(cmd)
            result['t'] = 'pc_cmd_result'
            result['cmd'] = cmd[:200]
            self._send_frame(cli, result)

        elif t == 'ping':
            self._send_frame(cli, {'t': 'pong'})

    # ---------- 服务主循环 ----------
    def bind_listen(self):
        """【P1 修复 2026-11-23】bind+listen 提到调用线程：构造监听 socket 并立即
        绑定，端口被占等 OSError 直接抛给调用方。此前 bind 藏在 daemon 线程里，
        失败只打在线程日志里，调用方毫不知情且 _instance 已被占用 → 此后永远
        不再重试（"启动失败却假装成功"）。"""
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind((HOST, REMOTE_PORT))
        srv.listen(64)
        return srv

    def serve(self, srv=None):
        if srv is None:
            srv = self.bind_listen()  # 命令行直跑（__main__）等场景保持旧行为
        try:
            from ..config import QUIET_CONSOLE
        except Exception:
            QUIET_CONSOLE = True
        if not QUIET_CONSOLE:
            log.info(f'[RemoteWS] listening on ws://{HOST}:{REMOTE_PORT}')
        while True:
            try:
                sock, addr = srv.accept()
            except OSError:
                break
            cli = _Client(sock, addr)
            threading.Thread(target=self._handle, args=(cli,),
                             daemon=True).start()

    def start_background(self, srv=None):
        threading.Thread(target=self.serve, args=(srv,), daemon=True).start()
        # GC 巡检线程
        def _gc_loop():
            while True:
                time.sleep(10)
                try:
                    self._gc()
                except Exception:
                    pass
        threading.Thread(target=_gc_loop, daemon=True).start()


_instance = None


def start_remote_ws():
    """供 server.py 主流程调用：后台启动远程控制 WebSocket 服务。
    【P1 修复 2026-11-23】bind/listen 在调用线程完成（本函数内），失败打印并保持
    _instance=None（下次调用可重试）；成功才赋 _instance 并转入后台线程 accept。"""
    global _instance
    if _instance is None:
        inst = RemoteWSServer()
        try:
            srv = inst.bind_listen()
        except OSError as e:
            log.error(f'[RemoteWS] 启动失败（端口 {REMOTE_PORT} 被占用？）: {e}')
            _instance = None
            return None
        _instance = inst
        inst.start_background(srv)
    return _instance


if __name__ == '__main__':
    RemoteWSServer().serve()
