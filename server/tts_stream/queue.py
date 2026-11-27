# -*- coding: utf-8 -*-
"""播报任务队列：后台 worker 线程消费，支持清空/打断当前。"""
import queue
import threading
import time
import uuid

_lock = threading.RLock()
_q = queue.Queue(maxsize=64)
_stop_flag = threading.Event()   # 打断当前合成
_cur_sid = None                  # 当前正在播的 sid
_seq = 0


def put(text, voice=None, rate=100):
    """入队。返回 sid 或 None（队满/禁用）。"""
    global _seq
    with _lock:
        _seq += 1
        sid = '%d-%s' % (_seq, uuid.uuid4().hex[:6])
    try:
        _q.put_nowait({'sid': sid, 'text': text, 'voice': voice, 'rate': rate, 'ts': time.time()})
        return sid
    except queue.Full:
        return None


def clear():
    """清空队列 + 置打断标志（当前合成会在下一帧后停止）。"""
    global _cur_sid
    with _lock:
        while True:
            try:
                _q.get_nowait()
            except queue.Empty:
                break
        _stop_flag.set()


def current_sid():
    with _lock:
        return _cur_sid


def stop_requested():
    return _stop_flag.is_set()


def reset_stop():
    _stop_flag.clear()


def get(timeout=None):
    item = _q.get(timeout=timeout)
    global _cur_sid
    with _lock:
        _cur_sid = item['sid']
    return item


def task_done():
    global _cur_sid
    _q.task_done()
    with _lock:
        _cur_sid = None


def qsize():
    return _q.qsize()
