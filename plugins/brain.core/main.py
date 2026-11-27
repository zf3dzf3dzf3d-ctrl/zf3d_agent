# -*- coding: utf-8 -*-
"""brain.core — 主脑插件（S4，绞杀者过渡）。

桥接 server/brain/main_brain.py 的 start_brain_thread（单一真源不复制实现）。
brain 三个分段模块共享模块级 _state/_events/_lock，复制会分裂状态，故只桥接。
server.py 经内核 get_kernel().plugins 里 provides 'brain' 的实现启动，失败回退旧轨。
"""
import os
import sys
import threading

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
_SERVER = os.path.join(_ROOT, 'server')

_START_LOCK = threading.Lock()
_started = False


def setup(ctx):
    if _SERVER not in sys.path:
        sys.path.insert(0, _SERVER)
    if _ROOT not in sys.path:
        sys.path.insert(0, _ROOT)

    def start(base_dir=None):
        """启动主脑观察线程（幂等）。返回 True=本次启动，False=已在跑。"""
        global _started
        with _START_LOCK:
            if _started:
                return False
            _started = True
        from brain.main_brain import start_brain_thread
        start_brain_thread(base_dir or _ROOT)
        return True

    ctx.schedule = _schedule = type('_S', (), {'start': staticmethod(start)})()
    # 模块级同名暴露：server.py 内核轨可直接 mod.schedule.start()（同一幂等实例）
    globals()['schedule'] = _schedule
