#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
git_async - git 子进程调用统一封装（防卡死）
=============================================
背景：tools/coding/backend 下多个 git 工具直接 subprocess.run 同步阻塞且无超时，
git push / 网络慢 / index.lock 等情况会把 HTTP 请求线程挂住几十秒，表现为
"git 操作时其他功能全部卡死"。

方案：
1. 所有调用强制带 timeout（本地操作 30s，含 push/fetch 的网络操作 120s）。
2. 提供 run_in_thread：把整段耗时 git 流程丢到子线程执行，不阻塞调用方线程；
   调用方等待结果时带上限超时，超时返回友好错误而不是永久挂起。
3. 进程级互斥锁 _git_lock：同一仓库同时只跑一条 git 写命令，避免 index.lock 互踩。
"""
import subprocess
import threading
import time

_CREATE_FLAGS = getattr(subprocess, 'CREATE_NO_WINDOW', 0)

# 本地操作（add/commit/status/log）默认超时
LOCAL_TIMEOUT = 30
# 网络操作（push/fetch/pull）默认超时
NET_TIMEOUT = 120

# 进程级互斥：git 写操作串行化，防止并发 index.lock 冲突
_git_lock = threading.Lock()


def run(cmd, cwd=None, timeout=LOCAL_TIMEOUT, net=False):
    """同步执行 shell 命令，带超时 + 写锁（net=True 走网络用长超时）。
    返回 subprocess.CompletedProcess 或超时时的伪结果对象。"""
    if net:
        timeout = NET_TIMEOUT
    with _git_lock:
        try:
            return subprocess.run(cmd, shell=True, capture_output=True, text=True,
                                  cwd=cwd, timeout=timeout,
                                  encoding='utf-8', errors='replace',
                                  creationflags=_CREATE_FLAGS)
        except subprocess.TimeoutExpired:
            return _FakeResult(-9, '', 'git 命令超时(%ds)，已终止: %s' % (timeout, cmd))
        except Exception as e:
            return _FakeResult(-1, '', str(e))


class _FakeResult(object):
    def __init__(self, code, out, err):
        self.returncode = code
        self.stdout = out
        self.stderr = err


def run_in_thread(fn, args=(), kwargs=None, wait_timeout=NET_TIMEOUT + 30):
    """把耗时函数 fn 放到子线程执行，当前线程最多等 wait_timeout 秒。
    返回 (ok, result_or_error_str)。超时后子线程继续跑完（结果丢弃），
    但调用方立即拿到错误返回，不再阻塞。"""
    kwargs = kwargs or {}
    box = {}

    def _worker():
        try:
            box['r'] = fn(*args, **kwargs)
        except Exception as e:
            box['e'] = str(e)

    t = threading.Thread(target=_worker, daemon=True, name='git-async-worker')
    t.start()
    t.join(wait_timeout)
    if t.is_alive():
        return False, 'git 操作超时(%ds)，已转为后台执行，请稍后查看结果' % wait_timeout
    if 'e' in box:
        return False, box['e']
    return True, box.get('r')
