#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
独立存活探针服务 - health_liveness
【治本·防误关后台】背景：/api/health 原本由主服务 DBHandler 处理，与所有业务请求
（SSE 长连接、上游代理流、数据库读写）共享同一进程的工作线程池与 accept 队列。
当 DB 单写锁长时间被占、或并发把工作线程/backlog 打满时，连这个"纯静态"接口都会
连接超时，导致 network_guard 心跳探针误判"后台全卡死"→ 自动重启 → 表现为
用户口中的"后台被人关了"（实际是自己把还活着的后台误杀重启）。

本模块在【独立线程 + 独立端口】上只回答存活探测，绝不触碰任何业务锁/数据库/全局状态。
只要进程还活着，它就一定应答。心跳探针据此把两类情况分开：
  - 存活端口通   → 进程活着（哪怕业务暂时繁忙/DB 锁）→ 不判死，绝不重启；
  - 存活端口也不通 → 进程真死/僵死 → 才计入失败并在达阈值时重启。

端口约定：liveness_port = api_port + 5（默认 8570 → 8565），与 5.7.x 段内其余端口不冲突。
"""
import os
import sys
import json
import time
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _api_port():
    """读 private/port.json 的 api_port（兼容 port），失败回落 8558。"""
    try:
        with open(os.path.join(BASE_DIR, 'private', 'port.json'), 'r', encoding='utf-8-sig') as f:
            cfg = json.load(f)
        return int(cfg.get('api_port') or cfg.get('port') or 8558)
    except Exception:
        return 8558


LIVENESS_PORT = _api_port() + 5  # 默认 8570 -> 8565

_server = None
_running = False  # 仅当本模块确实成功 bind + 起线程后置 True


class _LivenessHandler(BaseHTTPRequestHandler):
    # 不写访问日志，避免高频探测刷屏
    def log_message(self, *args, **kwargs):
        pass

    def do_GET(self):
        # 任何路径都回 200 + 存活 JSON（探针只关心"进程在不在"，不关心路由）
        try:
            body = json.dumps({
                'ok': True,
                'liveness': True,
                'pid': os.getpid(),
                'ts': time.time(),
            }).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Connection', 'close')
            self.end_headers()
            self.wfile.write(body)
        except Exception:
            pass

    # 探针只用 GET，其余方法一律 404（不阻塞）
    def do_POST(self):
        try:
            self.send_error(404)
        except Exception:
            pass


def start():
    """启动独立存活探针线程。非阻塞，bind 失败时静默（探针会据此回退到旧的主端口判定）。"""
    global _server, _running
    if _running:
        return
    try:
        # 先用裸 socket 试 bind，端口被占就直接放弃（让调用方走回退逻辑），
        # 避免在 serve_forever 线程里抛异常刷屏。
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            probe.bind(('127.0.0.1', LIVENESS_PORT))
        finally:
            probe.close()
        _server = ThreadingHTTPServer(('127.0.0.1', LIVENESS_PORT), _LivenessHandler)
        _server.daemon_threads = True
        _server.request_queue_size = 32
        t = threading.Thread(target=_server.serve_forever,
                             name='liveness-probe-server', daemon=True)
        t.start()
        _running = True
        print('[Liveness] 独立存活探针已启动：127.0.0.1:%d（与业务线程池隔离，专判进程存活）' % LIVENESS_PORT)
    except Exception as e:
        _running = False
        print('[Liveness] 存活探针启动失败（不影响启动，心跳将回退到主端口判定）: %s' % e)


def is_running():
    return _running


def liveness_port():
    return LIVENESS_PORT
