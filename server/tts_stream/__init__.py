# -*- coding: utf-8 -*-
"""
流式 TTS 模块（可插拔、独立线程、独立 WebSocket 端口，与主服务零耦合）

架构:
  tts_stream/
    __init__.py   - 对外唯一入口 start_tts_stream()，失败返回 False 不影响主服务
    server.py     - 独立 WebSocket 服务（纯标准库，独立端口，daemon 线程）
    queue.py      - 播报任务队列（后台 worker 线程消费，可打断/可清空）
    providers/
      __init__.py - provider 注册表：按名字取 provider，可插拔
      volc.py     - 火山方舟 doubao-seed-tts-2.0（复用 tts_engine 的协议实现）
      null.py     - 空实现（未配置 key / 模块被禁用时占位）

消息协议（JSON 文本帧，端口默认 8524，private/port.json 的 tts_stream.port 可覆盖）:
  客户端 -> 服务端:
    {"t":"say",   "text":"...", "voice":"...", "rate":100}   # 入队播报
    {"t":"stop"}                                              # 清空队列+打断当前
    {"t":"ping"}
  服务端 -> 客户端:
    {"t":"start", "sid":"..."}                                # 某条开始合成
    {"t":"chunk", "sid":"...", "seq":n, "data":"<base64 mp3>"}# 音频分片（base64）
    {"t":"end",   "sid":"..."}                                # 播完
    {"t":"error", "msg":"..."}
    {"t":"pong"}

开关: private/port.json -> "tts_stream": {"enabled": true, "port": 8524}
"""
from .server import start_tts_stream  # noqa: F401
