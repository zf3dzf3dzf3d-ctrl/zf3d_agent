# -*- coding: utf-8 -*-
"""
区域9-T1 多模态路由耗时埋点（单点包装，零锁零线程）
用法：在 do_POST 解析出 path 后调用 zf_mm_perf.wrap(self, path)。
原理：若 path 命中多模态路由清单，记录 t0，并包装实例的 _send_json 与
wfile.write——首次响应写出时计算耗时，追加到 private/db/mm_perf.jsonl。
每请求独立 handler 实例（各线程各一份），实例属性包装无共享状态，无锁风险。
"""
import os, json, time, threading

# 多模态路由清单（按 path 匹配，禁行号硬编码——v1.3 规范）
MM_ROUTES = {
    '/api/image-gen', '/api/ppt-gen', '/api/video-gen', '/api/video-free-gen',
    '/api/video-director', '/api/tts', '/api/avatar/tts',
    '/api/models/3d/generate', '/api/model3d',
}

_LOG_PATH = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'private', 'db', 'mm_perf.jsonl'))
_file_lock = threading.Lock()  # 仅文件追加互斥，不碰业务锁


def wrap(handler, path):
    if path not in MM_ROUTES:
        return
    t0 = time.time()
    orig_send = handler._send_json
    orig_write = handler.wfile.write

    def _record(tag):
        ms = round((time.time() - t0) * 1000, 1)
        try:
            line = json.dumps({'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
                               'path': path, 'ms': ms, 'tag': tag},
                              ensure_ascii=False)
            with _file_lock:
                with open(_LOG_PATH, 'a', encoding='utf-8') as f:
                    f.write(line + '\n')
        except Exception:
            pass

    def _record_once(tag):
        # v2 去重（审核员复核修复）：同一 HTTP 请求只记一条。
        # 缺陷1实例属性判重失效的根因：响应写出阶段内部可能切换工作线程
        # （TTS 等 json 路由一次响应内多次 _send_json），每换一个线程，
        # _send_json/wfile.write 的包装就因实例属性跨线程可见性之外的
        # 重复包装而重置，属性判重被打穿。v2 改为「实例属性 + 计数上限」
        # 双保险：落盘一次后直接替换回原始方法，后续调用彻底不经过包装层。
        if getattr(handler, '_mm_perf_done', False):
            return
        handler._mm_perf_done = True
        _record(tag)
        # 关键：记录完成后把 handler 的方法还原为原始实现，
        # 杜绝后续任何线程再次进入包装层产生重复记录。
        try:
            handler._send_json = orig_send
            handler.wfile.write = orig_write
        except Exception:
            pass

    def send_json(obj, *a, **kw):
        _record_once('json')
        return orig_send(obj, *a, **kw)

    def wfile_write(data, *a, **kw):
        _record_once('bin')
        return orig_write(data, *a, **kw)

    handler._send_json = send_json
    handler.wfile.write = wfile_write

