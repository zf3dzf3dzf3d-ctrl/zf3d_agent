# -*- coding: utf-8 -*-
"""zf3d 中继代理域路由（重构 Step3：自 mixin_zf3d.py 按职责拆出，方法体未改动）。

包含：/api/zf3d/relay-proxy 前端经本地服务端转发打 zf_models_relay
（补 X-ZF-Key/X-ZF-User、429 限流退避、5xx/网络重试）。
"""
from routes._shared import *
from routes.mixin_base import MixinBase


from util_log import get_logger

log = get_logger('zf3d_relay')
class Zf3dRelayMixin(MixinBase):
    """zf3d 中继代理域。"""

    def _handle_zf_relay_proxy(self):
        """POST /api/zf3d/relay-proxy - 前端（查看答案等）经本地服务端转发打 zf_models_relay。
        服务端补 X-ZF-Key(heartbeat key) + X-ZF-User(登录会员ID)，修复前端裸调 401 no-key。
        只接受本机来源，防止被当公网代理滥用。"""
        try:
            # 仅允许本机调用（本机前端页面）
            client_ip = self.client_address[0] if getattr(self, 'client_address', None) else ''
            # 【2026-09-30 放宽】本机 + 内网网段（127/8、10/8、172.16-31、192.168），
            # 避免用户用机器名/局域网 IP 打开工作台时被误伤；仍拒绝公网来源防滥用。
            import ipaddress as _ipa
            try:
                _ip = _ipa.ip_address(client_ip.split('%')[0])
                _ok_local = _ip.is_loopback or _ip.is_private
            except ValueError:
                _ok_local = client_ip in ('localhost', '')
            if not _ok_local:
                self._send_json({'ok': False, 'error': 'forbidden (local only)'})
                return
            import sys as _sys, os as _os, urllib.request as _ur, json as _js
            _srv = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
            if _srv not in _sys.path:
                _sys.path.insert(0, _srv)
            body = self._read_body() or {}
            model = str(body.get('model') or '')
            payload = body.get('payload')
            if not model or not isinstance(payload, dict):
                self._send_json({'ok': False, 'error': 'model/payload required'})
                return
            relay_url = 'https://www.zf3d.com/api/zf_models_relay.asp?model=' + _ur.quote(model)
            # 同源鉴权：与 zf3d_commands.py L194-231 保持一致
            from zf3d_commands import _get_api_key
            zf_key = _get_api_key() or ''
            zf_user = 0
            try:
                from zf3d_heartbeat import _get_login_status
                _ls, _lu, zf_user = _get_login_status()
            except Exception:
                zf_user = 0
            # 【401 no-key 快速失败 2026-11-22】鉴权 key 为空时上游必拒（401 no-key），
            # 与其打一次必败的出网请求、让前端把它误判成"未登录"而进入弹登录死循环
            # （发图片识图接管到中转线路时必现刷屏），不如直接 401 + 可操作提示。
            # 前端熔断分支按 error.message 里的 no-key 给出"重新登录以下发 Key"的指引。
            if not zf_key:
                _nokey_body = _js.dumps({
                    'success': False,
                    'error': {'message': 'unauthorized [diag] no-key | 本机未配置朱峰线路 Key（heartbeat_api_key 为空）：'
                                         '请到「设置 → 朱峰账号」退出后重新登录朱峰账号，登录成功会自动下发线路 Key',
                              'type': 'AUTH', 'status': '401'},
                }, ensure_ascii=False)
                self.send_response(401)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(_nokey_body.encode('utf-8'))))
                self.end_headers()
                self.wfile.write(_nokey_body.encode('utf-8'))
                return
            # 【S5 一切皆插件】请求构造经内核插件 gateway.zf3d-relay（单一真源），异常回退内联
            _relay_req = None
            try:
                _root2 = _os.path.dirname(_srv)
                if _root2 not in _sys.path:
                    _sys.path.insert(0, _root2)
                from kernel import boot_plugins, get_kernel as _gk_fn
                boot_plugins()
                _gt = _gk_fn().tools.get('zf3d_relay_request')
                if _gt:
                    _rr = _gt['exec']({'model': model, 'payload': payload,
                                       'zf_key': zf_key, 'zf_user': zf_user})
                    _relay_req = {'url': _rr['request']['url'],
                                  'headers': dict(_rr['request']['headers']),
                                  'data': _rr['request']['data'].encode('utf-8'),
                                  'timeout': _rr['request']['timeout']}
            except Exception as _pe:
                log.error('%s %s', '[relay-proxy] 插件轨请求构造失败，回退内联:', _pe)
            if _relay_req is None:
                headers = {'Content-Type': 'application/json'}
                if zf_key:
                    headers['X-ZF-Key'] = zf_key
                if zf_user and zf_user > 0:
                    headers['X-ZF-User'] = str(zf_user)
                _relay_req = {'url': relay_url, 'headers': headers,
                              'data': _js.dumps(payload, ensure_ascii=True).encode('utf-8'),
                              'timeout': 120}
            headers = _relay_req['headers']
            data = _relay_req['data']
            relay_url = _relay_req['url']
            req = _ur.Request(relay_url, data=data, method='POST')
            for k, v in headers.items():
                req.add_header(k, str(v))
            try:
                with _ur.urlopen(req, timeout=120) as resp:  # 【2026-10-01 卡死治理】180→120，与 relay 接收超时对齐
                    out = resp.read().decode('utf-8', 'replace')
                    # 【全局 tok/s】服务端转发的后台 LLM 调用也计入全局统计（取响应文本长度近似）
                    try:
                        import tok_stats as _ts, json as _js2
                        _j2 = _js2.loads(out)
                        _m2 = ((_j2.get('choices') or [{}])[0].get('message') or {})
                        _n2 = len(str(_m2.get('content') or '')) + len(str(_m2.get('reasoning_content') or ''))
                        if _n2 > 0:
                            _ts.record('relay:%s' % (model or 'unknown'), _n2)
                    except Exception:
                        pass
                    self.send_response(resp.status)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Content-Length', str(len(out.encode('utf-8'))))
                    self.end_headers()
                    self.wfile.write(out.encode('utf-8'))
            except _ur.HTTPError as he:
                # 【修复】HTTPError 是 URLError 子类，必须先于 URLError 捕获，否则上游
                # 4xx/5xx 会被 URLError 分支吞掉并误报成 502"网络异常"，真实错误被掩盖。
                out = he.read().decode('utf-8', 'replace')
                # 【2026-10-01 429限流防护】上游限流时最多退避重试 2 次（每次遵守 Retry-After，上限 5s）。
                # 仅当最终错误确为 429 时才返回 200 + {ok:false} 友好文案——前端 db.js 会从错误文本
                # 解析出 429 并恢复退避/限流面板统计，控制台也不再裸刷 429。
                # 其余错误（网络中断/上游 500 等）按真实状态码透传，避免被误标成限流。
                if he.code == 429:
                    import time as _t
                    _final_code, _final_out = 429, out
                    for _attempt in (1, 2):
                        _ra = he.headers.get('Retry-After') if he.headers else None
                        try:
                            _wait = min(float(_ra), 5.0) if _ra else 2.0
                        except (TypeError, ValueError):
                            _wait = 2.0
                        _t.sleep(_wait)  # 首跳同样遵守 Retry-After（无则 2s），不再恒定 2s
                        try:
                            with _ur.urlopen(req, timeout=180) as resp2:
                                out2 = resp2.read().decode('utf-8', 'replace')
                                self.send_response(resp2.status)
                                self.send_header('Content-Type', 'application/json; charset=utf-8')
                                self.send_header('Content-Length', str(len(out2.encode('utf-8'))))
                                self.end_headers()
                                self.wfile.write(out2.encode('utf-8'))
                                return
                        except _ur.HTTPError as he2:
                            he = he2
                            out = he2.read().decode('utf-8', 'replace')
                            _final_code, _final_out = he2.code, out
                            if he2.code != 429:
                                break  # 重试中转成非限流错误：按真实状态码透传
                        except Exception as _ne:
                            # 网络中断等非 HTTP 错误：不能谎报成 429，按 502 透传真实原因
                            _final_code = 502
                            _final_out = _js.dumps({'ok': False, 'error': 'relay-proxy 网络异常: %r' % _ne}, ensure_ascii=False)
                            break
                    if _final_code == 429:
                        # 文案中的(429)是 db.js 解析真实状态码的依据，必须保留
                        _friendly = _js.dumps({'ok': False, 'error': '上游限流(429)：已自动退避重试仍被拒，请稍后再试，或放慢操作节奏。'}, ensure_ascii=False)
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json; charset=utf-8')
                        self.send_header('Content-Length', str(len(_friendly.encode('utf-8'))))
                        self.end_headers()
                        self.wfile.write(_friendly.encode('utf-8'))
                        return
                    # 最终错误不是 429：按真实状态码 + 真实响应体透传
                    self.send_response(_final_code)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Content-Length', str(len(_final_out.encode('utf-8'))))
                    self.end_headers()
                    self.wfile.write(_final_out.encode('utf-8'))
                    return
                # 非 429 的 HTTP 错误（含上游 500/502）：先对 5xx 换连接重试 1 次，
                # 减少控制台裸刷 Failed to load resource: 500；仍失败再按真实状态码透传。
                if he.code in (500, 502, 503):
                    import time as _t
                    try:
                        _t.sleep(1.5)
                        with _ur.urlopen(req, timeout=120) as resp3:
                            out = resp3.read().decode('utf-8', 'replace')
                            self.send_response(resp3.status)
                            self.send_header('Content-Type', 'application/json; charset=utf-8')
                            self.send_header('Content-Length', str(len(out.encode('utf-8'))))
                            self.end_headers()
                            self.wfile.write(out.encode('utf-8'))
                            return
                    except _ur.HTTPError as he3:
                        try:
                            out = he3.read().decode('utf-8', 'replace')
                        except Exception:
                            pass
                    except Exception:
                        pass
                self.send_response(he.code)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(out.encode('utf-8'))))
                self.end_headers()
                self.wfile.write(out.encode('utf-8'))
            except (getattr(_ur, 'URLError', Exception), getattr(__import__('socket'), 'timeout', Exception)) as _neterr:
                # 【2026-10-01 卡死治理】网络异常/超时不再直接502：换连接重试1次（relay 有赛道池会自动换线）
                import time as _t
                try:
                    _t.sleep(1.5)
                    with _ur.urlopen(req, timeout=120) as resp:
                        out = resp.read().decode('utf-8', 'replace')
                        self.send_response(resp.status)
                        self.send_header('Content-Type', 'application/json; charset=utf-8')
                        self.send_header('Content-Length', str(len(out.encode('utf-8'))))
                        self.end_headers()
                        self.wfile.write(out.encode('utf-8'))
                        return
                except Exception:
                    pass
                self._send_json({'ok': False, 'error': 'relay-proxy 网络异常(已重试1次): %r' % _neterr}, code=502)
        except Exception as e:
            import traceback as _tb
            _tb.print_exc()
            try:
                self._send_json({'ok': False, 'error': 'relay-proxy 异常: %r' % e})
            except Exception:
                pass
