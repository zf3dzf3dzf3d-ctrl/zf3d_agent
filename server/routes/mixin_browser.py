# -*- coding: utf-8 -*-
"""Mixin: 内置浏览器（/api/browser）—— 薄适配层。

实际逻辑全部在 server/browser_plugin/ 独立插件包里（engine.py）：
  * 动作注册表：内置 goto/click/fill/screenshot/... 均可被外部覆盖/扩展
  * 多会话：POST 带 "session" 字段即用独立登录态会话
  * 本文件只做 HTTP <-> 引擎 的转换，不含任何浏览器逻辑

接口：
  POST /api/browser  {action, ...params}
  GET  /api/browser?action=...
特殊：action=shot 直接回 PNG（画布节点 <img> 用）
"""
import os
import re
import sys
import json
import time
import threading

_SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)

from browser_plugin import engine  # noqa: E402


# ---- session 名字安全：只允许 [A-Za-z0-9_.-]，且禁 ".." / "." 开头 ----
# 目的：GET 是只读入口，session 会参与拼 shots/<name>/ 路径，必须挡住
# "../" 目录穿越（否则可读到 shots/ 之外的任意文件）。
_SESSION_RE = re.compile(r'^[A-Za-z0-9_.\-]+$')


def _safe_session(name):
    """session 名白名单清洗：非法/超长/含分隔符一律回 'default'。"""
    name = (name or '').strip()
    if not name or len(name) > 64:
        return 'default'
    if _SESSION_RE.match(name) and '..' not in name and not name.startswith('.'):
        return name
    return 'default'


def _mapped_session(name):
    """会话隔离：每个对话框的 wb_* 会话名原样保留（每个对话一个独立浏览器+profile）。
    仅把空名归一为 default。"""
    return (name or '').strip() or 'default'


def _peek_session(name):
    """只读探测已存在会话：不存在返回 None（绝不新建会话/起 reaper/建目录）。"""
    try:
        with engine._sessions_lock:
            return engine._sessions.get(_mapped_session(name))
    except Exception:
        return None


def _shot_dir_of(name):
    """取截图目录（只读、零副作用）。

    优先用「已存在会话」的 shot_dir；否则退到已存在的 shots/<映射名> 目录；
    再退到 shots/default。绝不为凭空传入的 session 名新建目录。
    """
    name = _safe_session(name)
    s = _peek_session(name)
    if s is not None:
        try:
            return s.shot_dir
        except Exception:
            pass
    _base = os.path.join(engine._PLUGIN_DIR, 'data', 'shots')
    _d = os.path.join(_base, _mapped_session(name))
    if os.path.isdir(_d):
        return _d
    return os.path.join(_base, 'default')


def _browser_action(action, params):
    """执行浏览器动作，全部委托给插件引擎。"""
    if not action:
        action = 'status'
    params = dict(params or {})
    if 'session' in params:
        params['session'] = _safe_session(params.get('session'))
    return engine.dispatch(action, params)


def _webrecon_scan(url):
    """调用 tools/webrecon 探测引擎，输入网址返回结构化体检报告。"""
    _root = os.path.dirname(_SERVER_DIR)
    if _root not in sys.path:
        sys.path.insert(0, _root)
    from tools.webrecon import recon
    return recon.scan(url)


# ---- MJPEG 流连接登记：每会话只允许一条活跃视频流 ----
# 每会话多客户端共享单源：每个连接有自己的停止信号（客户端断开时 set 自己），
# 新连接不再踢旧连接，多个标签页可同时观看互不影响
_MJPEG_STOP = {}


class MixinBrowser:
    def _send_png(self, path, ctype='image/png'):
        try:
            raw = open(path, 'rb').read()
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(raw)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    # ===== MJPEG 视频流（GET /api/browser?action=mjpeg&session=..）=====
    def _browser_mjpeg(self, params):
        """multipart/x-mixed-replace 视频流：服务端驱动 screencast 落盘，
        只把「最新一帧」写给客户端——中间帧按时间自动裁剪丢弃，永不积压延迟。
        多客户端共享单源：同会话多个标签页各拉一路连接互不干扰，
        连接生命周期由客户端断开（BrokenPipe）自然回收。"""
        session_id = _safe_session(params.get('session'))
        try:
            fps = int(params.get('fps') or 15)
        except Exception:
            fps = 15
        fps = max(4, min(30, fps))
        stop_ev = threading.Event()
        _MJPEG_STOP[id(self)] = stop_ev
        interval = 1.0 / fps
        boundary = 'frame'
        try:
            # 确保 CDP screencast 已启动（没开就不产新帧）
            try:
                st = _browser_action('stream_poll', {'session': session_id})
                if isinstance(st, dict) and not st.get('streaming'):
                    _browser_action('stream_start', {'session': session_id})
            except Exception:
                pass
            self.send_response(200)
            self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=%s' % boundary)
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Connection', 'close')
            self.send_header('X-Accel-Buffering', 'no')
            self.end_headers()
            last_sig = ''
            while not stop_ev.is_set():
                sig = ''
                try:
                    r = _browser_action('stream_poll', {'session': session_id})
                    if isinstance(r, dict):
                        sig = r.get('sig') or ''
                except Exception:
                    sig = ''
                # 会话可能被回收重建，截图目录每帧现取（只读、零副作用）
                shot_dir = _shot_dir_of(session_id)
                p = os.path.join(shot_dir, 'stream.jpg')
                if not os.path.exists(p):
                    p = os.path.join(shot_dir, 'latest.jpg')
                if sig and os.path.exists(p):
                    try:
                        stt = os.stat(p)
                        cur = '%d_%d' % (int(stt.st_mtime), stt.st_size)
                    except OSError:
                        cur = ''
                    if cur and cur != last_sig:
                        raw = open(p, 'rb').read()
                        if raw:
                            last_sig = cur
                            head = ('--%s\r\nContent-Type: image/jpeg\r\n'
                                    'Content-Length: %d\r\n\r\n' % (boundary, len(raw))).encode('ascii')
                            self.wfile.write(head)
                            self.wfile.write(raw)
                            self.wfile.write(b'\r\n')
                            self.wfile.flush()
                time.sleep(interval)
        except Exception:
            # 客户端断开（BrokenPipe/ConnectionReset）/旧流被顶掉：正常退出
            pass
        finally:
            stop_ev.set()
            _MJPEG_STOP.pop(id(self), None)
            try:
                self.close_connection = True
            except Exception:
                pass

    # ===== GET /api/browser?action=... =====
    def _handle_browser_get(self, query):
        from urllib.parse import parse_qs
        qs = parse_qs(query or '')
        action = (qs.get('action') or ['status'])[0]
        params = {k: v[0] for k, v in qs.items() if k != 'action'}
        if action in ('mjpeg', 'stream'):
            # MJPEG 视频流：长连接推帧（服务端只发最新帧，中间帧自动丢弃）
            self._browser_mjpeg(params)
            return
        if action == 'shot':
            # 直接回图（画布节点 <img> 用，避免 base64 JSON 过大）
            # fmt=jpeg 回 JPEG 帧（体积小，轮询推帧用）；默认 PNG
            fmt = (params.get('fmt') or 'png').lower()
            fname = 'latest.jpg' if fmt == 'jpeg' else 'latest.png'
            ctype = 'image/jpeg' if fmt == 'jpeg' else 'image/png'
            if (params.get('src') or '').lower() == 'stream':
                fname = 'stream.jpg'
                ctype = 'image/jpeg'
            session_id = _safe_session(params.get('session'))
            # 会话隔离后 wb_* 原样保留，截图按会话名写在 shots/<name>/，
            # 取图与写入同名，路径自洽。
            _shot_dir = _shot_dir_of(session_id)
            p = os.path.join(_shot_dir, fname)
            if not os.path.exists(p):
                # 兜底：还没截图时现拍一张（画布节点初次打开不至于空白）
                try:
                    _browser_action('shot_jpeg' if (fmt == 'jpeg' or fname == 'stream.jpg') else 'screenshot', {'session': session_id})
                except Exception as e:
                    try:
                        print(f'[mixin_browser] shot 兜底现拍失败 session={session_id}: {e}')
                    except Exception:
                        pass
            if not os.path.exists(p) and fname == 'stream.jpg':
                # 流帧尚未生成（screencast 未推帧/引擎未就绪）时回退到最近截图，避免画布黑屏
                p2 = os.path.join(os.path.dirname(p), 'latest.jpg')
                if os.path.exists(p2):
                    p = p2
            if not os.path.exists(p):
                self._send_json({'ok': False, 'error': '还没有截图，先 POST action=screenshot'})
                return
            self._send_png(p, ctype)
            return
        if action == 'framesig':
            # 轻量帧签名：前端轮询它，变了才拉图（省带宽，画面更跟手）
            # 同样只读：会话还没起来时回 sig=0，不为凭空名字新建会话
            s = _peek_session(params.get('session'))
            if s is None:
                self._send_json({'ok': True, 'sig': 0})
                return
            try:
                self._send_json({'ok': True, 'sig': s.frame_sig()})
            except Exception as e:
                self._send_json({'ok': False, 'error': str(e)})
            return
        self._send_json(_browser_action(action, params))

    # ===== POST /api/browser {action, ...} =====
    def _handle_browser_post(self, body):
        try:
            # _read_body() 可能返回 dict（已解析）或原始 bytes
            if isinstance(body, dict):
                data = body
            else:
                data = json.loads(body or b'{}')
        except Exception:
            data = {}
        action = data.get('action')
        r = _browser_action(action, data)
        self._send_json(r)

    # ===== POST /api/webrecon {url} —— 网址安全探测（浏览器节点 🛡 按钮用） =====
    def _handle_webrecon_post(self, body):
        try:
            data = body if isinstance(body, dict) else json.loads(body or b'{}')
        except Exception:
            data = {}
        url = (data.get('url') or '').strip()
        if not url:
            self._send_json({'ok': False, 'error': '缺少 url 参数'}, 400)
            return
        try:
            report = _webrecon_scan(url)
            self._send_json({'ok': True, 'report': report})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)
