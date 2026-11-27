# -*- coding: utf-8 -*-
"""
独立 WebSocket 服务：默认端口 8622（private/port.json -> tts_stream.port）。
纯标准库、daemon 线程，崩溃只影响本模块。
"""
import base64
import json
import queue
import socket
import struct
import threading
import time

from . import providers
from . import queue as tq

from util_log import get_logger

log = get_logger('server')
_clients = []          # [_Cli, ...]
_c_lock = threading.Lock()


class _Cli:
    """【W2 修复】每连接发送队列载体：广播/单发只 put_nowait 入队即返回，
    实际 sendall 由该客户端专属 daemon 发送线程完成。慢客户端（对端接收
    窗口为 0）最多拖住自己的队列，队满即被 _drop 剔除，不再冻结全员广播。"""
    __slots__ = ('sock', 'send_lock', 'outq', 'closed', 'th')

    def __init__(self, sock):
        self.sock = sock
        self.send_lock = threading.Lock()   # 单发送线程后理论冗余，保留无害
        self.outq = queue.Queue(maxsize=200)
        self.closed = False
        self.th = None                      # 专属发送线程句柄（断开时宽限排队用）


def start_tts_stream(host='127.0.0.1', port=8622):
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    # 【P1 修复】去掉 SO_REUSEADDR：Windows 下它允许双进程同时 bind 同一端口且不报错，
    # 连接会被内核投递到任意一个（往往是旧实例）→ 播报随机失灵且难排查。
    # 端口被占就让 start 失败、由 server_runtime 捕获跳过（本模块崩溃只影响自己）。
    srv.bind((host, port))
    srv.listen(8)
    threading.Thread(target=_accept_loop, args=(srv,), daemon=True).start()
    threading.Thread(target=_worker_loop, daemon=True).start()
    try:
        from ..config import QUIET_CONSOLE
    except Exception:
        QUIET_CONSOLE = True
    if not QUIET_CONSOLE:
        log.info('[tts_stream] 流式TTS服务已启动 ws://%s:%d (provider=%s)' % (
            host, port, (providers.active() or providers.get()) and (providers.active() or providers.get()).name or 'none'))
    return True


def _accept_loop(srv):
    while True:
        try:
            sock, _ = srv.accept()
            # 【P1 修复】accept 后给客户端 sock 置 5 秒超时：假死/半开连接的
            # recv/send 不再无限阻塞（此前一个死连接可拖死 worker 广播线程）。
            # 前端 onclose 后 3 秒自动重连（tts_stream_client.js），超时断开可自愈。
            try:
                sock.settimeout(5)
            except Exception:
                pass
            threading.Thread(target=_client_thread, args=(sock,), daemon=True).start()
        except Exception:
            continue


def _handshake(sock):
    data = b''
    while b'\r\n\r\n' not in data:
        chunk = sock.recv(4096)
        if not chunk:
            return False
        data += chunk
        if len(data) > 8192:
            return False
    key = ''
    for line in data.partition(b'\r\n\r\n')[0].decode('utf-8', 'replace').split('\r\n')[1:]:
        if ':' in line:
            k, v = line.split(':', 1)
            if k.strip().lower() == 'sec-websocket-key':
                key = v.strip()
    if not key:
        return False
    import hashlib
    accept = base64.b64encode(hashlib.sha1(
        (key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
    sock.sendall((
        'HTTP/1.1 101 Switching Protocols\r\n'
        'Upgrade: websocket\r\nConnection: Upgrade\r\n'
        'Sec-WebSocket-Accept: %s\r\n\r\n' % accept).encode())
    return True


def _recv_frame(sock):
    """返回 (opcode, payload) 或 None。"""
    hdr = _recv_n(sock, 2)
    if not hdr:
        return None
    fin_op = hdr[0]
    opcode = fin_op & 0x0F
    masked = hdr[1] & 0x80
    ln = hdr[1] & 0x7F
    if ln == 126:
        ext = _recv_n(sock, 2)
        if not ext:
            return None
        ln = struct.unpack('>H', ext)[0]
    elif ln == 127:
        ext = _recv_n(sock, 8)
        if not ext:
            return None
        ln = struct.unpack('>Q', ext)[0]
    if ln > 1 << 20:
        return None
    mask = _recv_n(sock, 4) if masked else b'\x00\x00\x00\x00'
    if not mask:
        return None
    payload = _recv_n(sock, ln) if ln else b''
    if payload is None:
        return None
    if masked:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return opcode, payload


def _recv_n(sock, n):
    buf = b''
    while len(buf) < n:
        c = sock.recv(n - len(buf))
        if not c:
            return None
        buf += c
    return buf


def _send_json(cli, obj):
    """cli = _Cli。文本帧。只入队立即返回，发送由 cli 专属发送线程完成。
    【W2 修复】队满 = 该客户端消费不动（慢/假死）：立即 _drop 剔除并关闭，
    绝不阻塞 worker 广播线程。已关闭客户端直接丢弃消息。"""
    if cli.closed:
        return False
    try:
        cli.outq.put_nowait(obj)
        return True
    except queue.Full:
        _drop(cli)
        return False


def _sender_thread(cli):
    """【W2 修复】该客户端专属 daemon 发送线程：循环取队列 → sendall。
    发送异常/超时 → 走既有 _drop。socket 仍保留 FK 加的 settimeout(5)：
    5 秒发不出去（对端假死/接收窗口 0）即视为死连接剔除。"""
    while True:
        try:
            obj = cli.outq.get(timeout=5)
        except queue.Empty:
            if cli.closed:
                return
            continue
        if obj is None:      # None = 关闭哨兵（已出队的消息尽力发完，不因 closed 丢弃）
            return
        payload = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        try:
            with cli.send_lock:
                if len(payload) < 126:
                    hdr = struct.pack('>BB', 0x81, len(payload))
                elif len(payload) < 65536:
                    hdr = struct.pack('>BBH', 0x81, 126, len(payload))
                else:
                    hdr = struct.pack('>BBQ', 0x81, 127, len(payload))
                cli.sock.sendall(hdr + payload)
        except (socket.timeout, TimeoutError):
            _drop(cli)   # 发送超时：视为死连接，立即剔除
            return
        except Exception:
            _drop(cli)   # 连接已断/被关 → 剔除，发送线程退出
            return


def _drop(cli):
    """剔除客户端（幂等）：置关闭标志 + 出注册表 + 唤醒发送线程退出 + 关 socket。"""
    cli.closed = True
    with _c_lock:
        if cli in _clients:
            _clients.remove(cli)
    try:
        cli.outq.put_nowait(None)   # 关闭哨兵：发送线程取到即退出
    except Exception:
        pass
    try:
        cli.sock.close()            # 兜底：阻塞中的 sendall/recv 立刻抛错退出
    except Exception:
        pass


def _client_thread(sock):
    if not _handshake(sock):
        try:
            sock.close()
        except Exception:
            return
        return
    cli = _Cli(sock)
    with _c_lock:
        _clients.append(cli)
    cli.th = threading.Thread(target=_sender_thread, args=(cli,), daemon=True)
    cli.th.start()
    _send_json(cli, {'t': 'hello', 'provider': (providers.active() or providers.get()) and (providers.active() or providers.get()).name or 'none'})
    try:
        while True:
            frame = _recv_frame(sock)
            if frame is None:
                break
            opcode, payload = frame
            if opcode == 0x8:   # close
                break
            if opcode == 0x9:   # ping
                continue
            try:
                msg = json.loads(payload.decode('utf-8'))
            except Exception:
                continue
            _handle_msg(cli, msg)
    except Exception:
        pass
    finally:
        # 【W2 修复】有界宽限：让专属发送线程把队尾消息（如刚回的 pong）发完再关，
        # 队列空/发送线程已死/2 秒超时即止；对端真死时 sendall 会立刻失败不拖时间。
        _deadline = time.time() + 2.0
        while (not cli.outq.empty() and cli.th is not None
               and cli.th.is_alive() and time.time() < _deadline):
            time.sleep(0.05)
        _drop(cli)


def _handle_msg(cli, msg):
    t = msg.get('t')
    if t == 'ping':
        _send_json(cli, {'t': 'pong'})
    elif t == 'stop':
        tq.clear()
    elif t == 'say':
        text = (msg.get('text') or '').strip()
        if text:
            # 【P1 修复】tq.put 队满返回 None：此前静默丢弃，前端永远等不到 start/end
            # 分片，表现为"偶尔不播报"。向来源客户端回明确错误。
            sid = tq.put(text, voice=msg.get('voice'), rate=msg.get('rate') or 100)
            if sid is None:
                _send_json(cli, {'t': 'error', 'msg': '队列已满'})


def _broadcast(obj):
    with _c_lock:
        clis = list(_clients)
    for cli in clis:
        _send_json(cli, obj)


def _worker_loop():
    """后台播报线程：从队列取任务 → provider 流式合成 → 广播分片。"""
    while True:
        try:
            item = tq.get()
        except Exception:
            continue
        sid = item['sid']
        tq.reset_stop()
        provider = providers.active() or providers.get()
        if not provider:
            _broadcast({'t': 'error', 'sid': sid, 'msg': '无可用TTS引擎(未配置key或模块禁用)'})
            tq.task_done()
            continue
        _broadcast({'t': 'start', 'sid': sid})
        seq = 0
        try:
            for audio, err in provider.synthesize_stream(item['text'], voice=item.get('voice'), rate=item.get('rate') or 100):
                if tq.stop_requested():
                    break
                if err:
                    _broadcast({'t': 'error', 'sid': sid, 'msg': err})
                    break
                if audio:
                    _broadcast({'t': 'chunk', 'sid': sid, 'seq': seq,
                                'data': base64.b64encode(audio).decode('ascii')})
                    seq += 1
            _broadcast({'t': 'end', 'sid': sid, 'seqs': seq})
        except Exception as e:
            try:
                _broadcast({'t': 'error', 'sid': sid, 'msg': str(e)})
                _broadcast({'t': 'end', 'sid': sid, 'seqs': seq})
            except Exception:
                pass
        tq.task_done()
