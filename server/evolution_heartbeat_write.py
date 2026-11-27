# -*- coding: utf-8 -*-
"""evolution heartbeat writer - 由 schedule 定时任务每 60s 调用。
【2026-11-25 bravo】原用 python -c 内联命令在 Windows cmd 下引号转义失败（SyntaxError rc=1），
心跳从未真正写入——改为独立脚本文件，零引号问题。"""
import time, os

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'private', 'evolution_heartbeat.txt')
os.makedirs(os.path.dirname(PATH), exist_ok=True)
with open(PATH, 'w') as f:
    f.write(repr(time.time()))
print('heartbeat written', PATH)
