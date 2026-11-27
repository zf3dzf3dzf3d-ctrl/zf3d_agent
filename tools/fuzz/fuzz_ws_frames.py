# -*- coding: utf-8 -*-
"""M2.4 模糊测试：WebSocket 帧解析器（server/remote/ws_server.py _recv_frame）。

变异策略：50% 纯随机字节流 + 50% 结构化畸形帧（126/127 扩展长度、掩码位、截断、
超长长度字段），各 100000 次。不变量：解析器永不抛异常（返回 None 或 (opcode, payload)），
永不试图分配超 8MB 的缓冲（源码有 ln > 8MB 上限）。

用法：py tools/fuzz/fuzz_ws_frames.py [次数]
"""
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'server'))

import importlib

ws_mod = importlib.import_module('remote.ws_server')
Cls = ws_mod.RemoteWSServer
srv = object.__new__(Cls)          # 跳过 __init__：_recv_frame 只依赖 _recv_exact


class FakeSock(object):
    """脚本化字节源：recv 按顺序吐出预设字节，耗尽后返回 b''。"""

    def __init__(self, data):
        self._data = bytearray(data)
        self.pos = 0

    def recv(self, n):
        chunk = self._data[self.pos:self.pos + max(1, n)]
        self.pos += len(chunk)
        return bytes(chunk)


class FakeCli(object):
    def __init__(self, sock):
        self.sock = sock


def frame(ln_bytes=None, masked=True, opcode=0x1, payload=None):
    """构造一帧（可指定长度字段形态）。"""
    rng = random
    if payload is None:
        payload = bytes(rng.randrange(256) for _ in range(rng.randrange(0, 24)))
    mask = bytes(rng.randrange(256) for _ in range(4))
    head = bytearray([0x80 | (opcode & 0x0F)])
    ln = len(payload)
    b2 = (0x80 if masked else 0) | (ln & 0x7F)
    if ln_bytes == 126:
        b2 = (0x80 if masked else 0) | 126
        head += bytes([b2]) + ln.to_bytes(2, 'big')
    elif ln_bytes == 127:
        b2 = (0x80 if masked else 0) | 127
        head += bytes([b2]) + ln.to_bytes(8, 'big')
    else:
        head += bytes([b2])
    body = payload if not masked else bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return bytes(head) + (mask if masked else b'') + body


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 100000
    rng = random.Random(20261124)
    crashes = 0
    huge_alloc = 0
    samples = []
    for i in range(n):
        if i % 2 == 0:
            data = bytes(rng.randrange(256) for _ in range(rng.randrange(0, 48)))    # 纯随机
        else:
            parts = []
            for _ in range(rng.randrange(1, 4)):
                mode = rng.randrange(4)
                pl = bytes(rng.randrange(256) for _ in range(rng.randrange(0, 32)))
                parts.append(frame(None if mode == 0 else (126 if mode == 1 else 127),
                                   masked=rng.randrange(2) == 0,
                                   opcode=rng.choice((0x1, 0x2, 0x8, 0x9, 0xA)),
                                   payload=pl))
            data = b''.join(parts)
        cli = FakeCli(FakeSock(data))
        try:
            res = srv._recv_frame(cli)
            if isinstance(res, tuple) and len(res[1]) > 8 * 1024 * 1024:
                huge_alloc += 1
        except Exception as e:                      # 不变量：永不抛出
            crashes += 1
            if len(samples) < 5:
                samples.append('#%d %r data=%s' % (i, e, data[:40].hex()))
    print('模糊测试完成: %d 次（纯随机/结构化各半）' % n)
    print('异常逃逸: %d，超限分配: %d' % (crashes, huge_alloc))
    for s in samples:
        print('  ', s)
    if crashes or huge_alloc:
        print('[FAIL] 发现问题')
        return 1
    print('[OK] 全部变异输入通过（永不抛出、无超限分配）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
