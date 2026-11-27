# -*- coding: utf-8 -*-
"""
util_http.py — HTTP JSON 响应公共工具（工程化整改 P1-5 · 20261123）
背景：_send_json 曾有 6 处独立实现，实查收口口径：
  - 权威版 handler_base._send_json（方法，全站主链路）——不动；
  - tts_stream/server.py 是 WebSocket 帧发送（非 HTTP），非重复；
  - script_engine/debug_test_domain_script.py 是测试替身（捕获进 _resp），非重复；
  - dispatch_swarm_infra.py 为 mock 用途，保留并注明；
  - external_router.py / plaza/test_plaza_upload.py 与本模块同语义（ensure_ascii=False、
    无 CORS 头、全异常吞掉）——收口到这里。
注意：本函数与权威版有两处刻意差异（ensure_ascii=False；不带 ACAO-Methods 预检头），
统一编码口径时再合并，勿在收口前悄悄改行为。
"""
import json


def send_json_http(handler, obj, code=200):
    """向 HTTP handler 回 JSON。任何发送异常静默吞掉（客户端断开等）。"""
    try:
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        handler.send_response(code)
        handler.send_header('Content-Type', 'application/json; charset=utf-8')
        handler.send_header('Content-Length', str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)
    except Exception:
        pass
