#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地双智能体互聊客户端（i聊天 plaza）。

功能：
- 两个 bot（各自人设）通过广场 WS 互聊，用户打开 i聊天 可围观。
- 短句限长：每句 <= 60 字（需求② 不要长篇大论）。
- 走现有安全层：token 鉴权、私聊/大厅限频、互刷熔断均继承 ws_plaza 服务端约束；
  客户端自身再限制：单轮对话最多 ROUNDS=6 回合，防无休止刷屏。
- 人设句子为固定模板池随机挑选 + 简单回声追问，不依赖外部模型，纯本地运行。

用法：
  python bot_chat.py            # 默认聊 6 回合后自动退出
  python bot_chat.py 10         # 指定回合数

BOT_NAMES / BOT_PERSONAS 可按需改人设。
"""
import json
import os
import random
import socket
import sys
import threading
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))
sys.path.insert(0, os.path.dirname(os.path.dirname(_HERE)))

try:
    from server.common import ws_frame
except ImportError:
    from common import ws_frame

try:
    from config import HOST
except Exception:
    HOST = '127.0.0.1'

try:
    from plaza.ws_plaza import PLAZA_PORT
except Exception:
    PLAZA_PORT = 8625
PLAZA_PORT = int(os.environ.get('PLAZA_PORT') or PLAZA_PORT)  # 便于测试/多实例

# ---------- 人设 ----------
BOT_A = '小峰'
BOT_B = '阿灵'
MAX_LEN = 60          # 短句限长（需求②）
ROUNDS_DEFAULT = 6    # 单场对话回合上限

OPENERS = {
    BOT_A: ['今天状态怎么样呀？', '我刚整理完画布，你呢？', '早上好呀，广场真热闹~'],
    BOT_B: ['还不错！你呢你呢？', '我刚看了几页漫画，嘿嘿。', '好呀好呀，一起聊会儿？'],
}
REPLIES = {
    BOT_A: ['听起来不错！', '哈哈我也是这么想的~', '那要加油哦！', '改天一起试试？'],
    BOT_B: ['嗯嗯，好主意！', '你说得对诶。', '那我先去忙啦，回头聊~', '嘿嘿，被你发现了。'],
}
FOLLOWUPS = ['然后呢？', '为什么呀？', '具体说说？']


def _pick(pool):
    return random.choice(pool)


class Bot:
    """一个最小 WS 客户端：join → 收 hall/direct → 回 direct（短句）。"""

    def __init__(self, name, token):
        self.name = name
        self.token = token
        self.sock = None
        self.lock = threading.Lock()
        self.last_from = None
        self.last_text = ''
        self.joined = False

    def connect(self):
        s = socket.create_connection((HOST, PLAZA_PORT), timeout=10)
        s.settimeout(None)
        if not ws_frame.client_handshake(s, HOST, PLAZA_PORT):
            raise RuntimeError('handshake failed')
        self.sock = s
        self.send({'t': 'join', 'name': self.name, 'token': self.token})
        # 等 joined
        deadline = time.time() + 5
        while time.time() < deadline and not self.joined:
            self.pump_once()
        return self.joined

    def send(self, obj):
        ws_frame.send_frame(self.sock, obj, self.lock)

    def pump_once(self, timeout=5):
        """读一帧并处理；返回是否还有连接。"""
        self.sock.settimeout(timeout)
        frame = ws_frame.recv_frame(self.sock)
        if frame is None:
            return False
        try:
            m = json.loads(frame[1].decode('utf-8'))
        except Exception:
            return True
        t = m.get('t')
        if t == 'joined':
            self.joined = True
        elif t in ('hall', 'direct'):
            frm = m.get('from')
            if frm and frm != self.name:
                self.last_from = frm
                self.last_text = m.get('text') or ''
        return True

    def say_direct(self, to, text):
        text = text[:MAX_LEN]        # 短句限长（需求②）
        tid = self.name + '-bot-' + str(time.time())
        self.send({'t': 'direct', 'to': to, 'text': text, 'trace_id': tid})

    def say_hall(self, text):
        text = text[:MAX_LEN]
        tid = self.name + '-bot-hall-' + str(time.time())
        self.send({'t': 'hall', 'text': text, 'trace_id': tid})


def load_token():
    # 优先本版配置；6.0.0 若未配置则回落到同机 5.8.0 安装的论坛配置（仅本地）
    paths = [
        os.path.join(os.path.dirname(os.path.dirname(_HERE)),
                     'private', '论坛配置.json'),
        r'',
    ]
    for cfg in paths:
        try:
            c = json.load(open(cfg, 'r', encoding='utf-8-sig'))
            t = c.get('token')
            t = (t[0] if isinstance(t, list) else t) or ''
            if t:
                return t
        except Exception:
            continue
    return ''



def main():
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else ROUNDS_DEFAULT
    token = load_token()
    if not token:
        print('[bot_chat] 未找到论坛 token，退出')
        return 1
    a, b = Bot(BOT_A, token), Bot(BOT_B, token)
    if not a.connect():
        print('[bot_chat] %s join 失败' % BOT_A); return 1
    if not b.connect():
        print('[bot_chat] %s join 失败' % BOT_B); return 1
    print('[bot_chat] 两个智能体已进入广场：', BOT_A, '&', BOT_B)

    DIRECT_WINDOW = 2  # 与 ws_plaza 私聊限频对齐
    # A 开场（大厅广播，围观可见）
    a.say_hall(_pick(OPENERS[BOT_A]))
    time.sleep(DIRECT_WINDOW + 0.5)
    b.pump_once(2)

    for r in range(rounds):
        # B → A
        b.say_direct(a.name, _pick(REPLIES[BOT_B]) if r else _pick(OPENERS[BOT_B]))
        time.sleep(DIRECT_WINDOW + 0.5)
        a.pump_once(2)
        # A → B
        a.say_direct(b.name, _pick(REPLIES[BOT_A]))
        time.sleep(DIRECT_WINDOW + 0.5)
        b.pump_once(2)
        print('[bot_chat] 回合 %d/%d 完成' % (r + 1, rounds))

    print('[bot_chat] 对话结束，bot 退出广场')
    return 0


if __name__ == '__main__':
    sys.exit(main())
