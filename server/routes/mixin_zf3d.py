# -*- coding: utf-8 -*-
"""朱峰智能体登录、签到、更新和心跳相关路由（自 4.2.1 移植，方法体未改动）。"""
from routes._shared import *
from routes.mixin_base import MixinBase
import logging

# 端口集中配置：读取 public/config/ai_proxy.json（失败回退 8527）
def _load_zf_proxy_port():
    try:
        cfg = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'public', 'config', 'ai_proxy.json')
        with open(cfg, encoding='utf-8') as f:
            return int(json.load(f).get('port', 8527))
    except Exception:
        return 8527

_ZF_PROXY_PORT = _load_zf_proxy_port()


class Zf3dRoutesMixin(MixinBase):
    """朱峰智能体及相关系统路由。"""

        # ===== 朱峰智能体登录/签到/状态 =====

    def _zf3d_get_cookies(self):
        """从数据库读取保存的朱峰智能体 cookies"""
        conn = None
        try:
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("SELECT value FROM app_data WHERE category='zf3d' AND key='cookies'")
                row = cur.fetchone()
                conn.close()
                conn = None
                if row:
                    return json.loads(row['value'])
                return {}
        except Exception as e:
            print(f'[zf3d] get_cookies error: {e}')
            if conn:
                try:
                    conn.close()
                except Exception:
                    logging.debug("swallow", exc_info=True)
            return {}

    def _zf3d_save_cookies(self, cookie_dict):
        """保存 cookies 到数据库"""
        conn = None
        try:
            now_ms = int(time.time() * 1000)
            cookie_json = json.dumps(cookie_dict, ensure_ascii=False)
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute(
                    "INSERT INTO app_data (category, key, value, created_at, updated_at) VALUES ('zf3d', 'cookies', ?, ?, ?) "
                    "ON CONFLICT(category, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                    (cookie_json, now_ms, now_ms)
                )
                conn.commit()
                conn.close()
                conn = None
        except Exception as e:
            print(f'[zf3d] save_cookies error: {e}')
            if conn:
                try:
                    conn.close()
                except Exception:
                    logging.debug("swallow", exc_info=True)
    def _zf3d_cookie_header(self, cookies):
        """将 cookie dict 转换为 Cookie 请求头字符串"""
        if not cookies:
            return ''
        parts = []
        for k, v in cookies.items():
            parts.append(f'{k}={v}')
        return '; '.join(parts)

    def _zf3d_extract_cookies(self, resp, existing_cookies):
        """从 HTTP 响应中提取 Set-Cookie 并合并到现有 cookies"""
        cookies = dict(existing_cookies)
        for header in resp.headers.get_all('Set-Cookie') or []:
            cookie_part = header.split(';')[0].strip()
            if '=' in cookie_part:
                k, v = cookie_part.split('=', 1)
                cookies[k.strip()] = v.strip()
        return cookies

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
            headers = {'Content-Type': 'application/json'}
            if zf_key:
                headers['X-ZF-Key'] = zf_key
            if zf_user and zf_user > 0:
                headers['X-ZF-User'] = str(zf_user)
            data = _js.dumps(payload, ensure_ascii=True).encode('utf-8')
            req = _ur.Request(relay_url, data=data, method='POST')
            for k, v in headers.items():
                req.add_header(k, str(v))
            try:
                with _ur.urlopen(req, timeout=120) as resp:  # 【2026-10-01 卡死治理】180→120，与 relay 接收超时对齐
                    out = resp.read().decode('utf-8', 'replace')
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

    def _handle_zf3d_login(self):
        """POST /api/zf3d/login - 登录朱峰智能体"""
        import urllib.parse as up
        try:
            # 【LoginDiag 2026-09-22】全量记录登录请求到达情况（用户浏览器请求疑似未到本服务）
            try:
                with open(os.path.join(BASE_DIR, 'server', 'diag_zf3d_login_empty.log'), 'a', encoding='utf-8') as _f:
                    _f.write('[%s] REACH uid=%s CL=%s UA=%s\n' % (
                        __import__('time').strftime('%Y-%m-%d %H:%M:%S'),
                        id(self), self.headers.get('Content-Length'),
                        (self.headers.get('User-Agent') or '')[:80]))
            except Exception:
                pass
            body = self._read_body()
            username = body.get('username', '')
            password = body.get('password', '')
            if not username or not password:
                # 【LoginDiag 2026-09-22】前端明明发了值、服务端却收到空 body，
                # 记录请求头特征定位（缓存/代理/CL 缺失），正常请求零开销。
                try:
                    with open(os.path.join(BASE_DIR, 'server', 'diag_zf3d_login_empty.log'), 'a', encoding='utf-8') as _f:
                        _hdrs = {k: v for k, v in self.headers.items()
                                 if k.lower() in ('content-length', 'content-type', 'transfer-encoding',
                                                  'user-agent', 'host', 'via', 'proxy-connection',
                                                  'x-forwarded-for', 'x-forwarded-proto')}
                        _f.write('[%s] EMPTY-BODY type=%s raw_type=%s cached=%s consumed=%s hdrs=%s\n' % (
                            __import__('time').strftime('%Y-%m-%d %H:%M:%S'),
                            type(body).__name__,
                            type(getattr(self, '_cached_raw_body', None)).__name__,
                            repr(getattr(self, '_cached_raw_body', None))[:300],
                            getattr(self, '_body_consumed', None),
                            _hdrs))
                except Exception:
                    pass
                self._send_json({'ok': False, 'error': '用户名和密码不能为空'})
                return

            login_url = 'https://www.zf3d.com/api/auth.asp'
            post_data = up.urlencode({
                'a': 'login',
                'username': username,
                'password': password
            }).encode('utf-8')

            req = urllib.request.Request(login_url, data=post_data, method='POST')
            req.add_header('Content-Type', 'application/x-www-form-urlencoded')
            req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
            req.add_header('Referer', 'https://www.zf3d.com/')

            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE

            resp = _urlopen_retry(req, timeout=30, tag='Zf3dLogin')
            resp_body = resp.read().decode('utf-8', errors='replace')

            existing = self._zf3d_get_cookies()
            new_cookies = self._zf3d_extract_cookies(resp, existing)
            self._zf3d_save_cookies(new_cookies)

            try:
                resp_data = json.loads(resp_body)
            except json.JSONDecodeError:
                resp_data = {'raw': resp_body}

            if resp_data.get('success'):
                conn = None
                try:
                    now_ms = int(time.time() * 1000)
                    with _db_lock:
                        conn = get_db()
                        cur = conn.cursor()
                        cur.execute(
                            "INSERT OR REPLACE INTO app_data (category, key, value, created_at) VALUES ('zf3d', 'username', ?, ?)",
                            (username, now_ms)
                        )
                        conn.commit()
                        conn.close()
                        conn = None
                except:
                    if conn:
                        try:
                            conn.close()
                        except Exception:
                            logging.debug("swallow", exc_info=True)
                # 保存登录响应数据（供心跳上报使用 user_id/user_group）
                try:
                    login_json = json.dumps(resp_data, ensure_ascii=False)
                    with _db_lock:
                        conn2 = get_db()
                        conn2.execute(
                            "INSERT OR REPLACE INTO app_data (category, key, value, created_at) VALUES ('zf3d', 'login_data', ?, ?)",
                            (login_json, now_ms)
                        )
                        conn2.commit()
                        conn2.close()
                except Exception as e2:
                    print(f'[zf3d] save login_data error: {e2}')

                # 自动从登录响应中提取 agent_api_key，保存为 heartbeat_api_key 并启动心跳
                try:
                    ag_key = ''
                    data_obj = resp_data.get('data') if isinstance(resp_data, dict) else None
                    if isinstance(data_obj, dict):
                        ag_key = data_obj.get('agent_api_key', '')
                    if not ag_key and isinstance(data_obj, str):
                        try:
                            parsed = json.loads(data_obj)
                            ag_key = parsed.get('agent_api_key', '') if isinstance(parsed, dict) else ''
                        except (json.JSONDecodeError, TypeError): logging.debug("swallow", exc_info=True)
                    if ag_key:
                        with _db_lock:
                            conn3 = get_db()
                            conn3.execute(
                                "INSERT OR REPLACE INTO app_data (category, key, value, created_at) VALUES ('zf3d', 'heartbeat_api_key', ?, ?)",
                                (ag_key, now_ms)
                            )
                            conn3.commit()
                            conn3.close()
                        print(f'[zf3d] 自动获取 heartbeat_api_key 成功，启动心跳线程')
                        try:
                            from zf3d_heartbeat import start_heartbeat, trigger_immediate_heartbeat
                            start_heartbeat()
                            # [新增] 登录成功立即上报一次，朱峰智能体网站端马上能看到该用户已登录
                            trigger_immediate_heartbeat()
                        except Exception as e4:
                            print(f'[zf3d] 心跳线程启动失败: {e4}')
                    else:
                        print('[zf3d] 登录响应中未包含 agent_api_key，心跳将使用内置默认 key')
                except Exception as e3:
                    print(f'[zf3d] auto save heartbeat_api_key error: {e3}')

                self._send_json({'ok': True, 'data': resp_data, 'username': username})
            else:
                self._send_json({'ok': False, 'error': resp_data.get('message', '登录失败'), 'data': resp_data})

        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8', errors='replace')
            print(f'[zf3d] login HTTP {e.code}: {err_body[:500]}')
            self._send_json({'ok': False, 'error': f'服务器返回 {e.code}', 'data': None})
        except urllib.error.URLError as e:
            print(f'[zf3d] login URL error: {e}')
            self._send_json({'ok': False, 'error': f'连接失败: {e.reason}', 'data': None})
        except Exception as e:
            print(f'[zf3d] login exception: {e}')
            traceback.print_exc()
            self._send_json({'ok': False, 'error': str(e), 'data': None})

    def _handle_zf3d_checkin(self):
        """POST /api/zf3d/checkin - 朱峰智能体签到"""
        import urllib.parse as up
        try:
            cookies = self._zf3d_get_cookies()
            if not cookies:
                self._send_json({'ok': False, 'error': '请先登录朱峰智能体'})
                return

            checkin_url = 'https://www.zf3d.com/api/user.asp'
            post_data = up.urlencode({'a': 'checkin'}).encode('utf-8')

            req = urllib.request.Request(checkin_url, data=post_data, method='POST')
            req.add_header('Content-Type', 'application/x-www-form-urlencoded')
            req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
            req.add_header('Referer', 'https://www.zf3d.com/')
            cookie_str = self._zf3d_cookie_header(cookies)
            if cookie_str:
                req.add_header('Cookie', cookie_str)

            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE

            resp = _urlopen_retry(req, timeout=30, tag='Zf3dCheckin')
            resp_body = resp.read().decode('utf-8', errors='replace')

            new_cookies = self._zf3d_extract_cookies(resp, cookies)
            self._zf3d_save_cookies(new_cookies)

            try:
                resp_data = json.loads(resp_body)
            except json.JSONDecodeError:
                resp_data = {'raw': resp_body}

            # 智能判断成功：兼容 success / code:0 / status:ok / msg含成功字样
            is_ok = resp_data.get('success', False)
            if not is_ok and resp_data.get('code') in (0, 200, '0', '200'):
                is_ok = True
            if not is_ok and resp_data.get('status') in ('ok', 'success', 0, '0'):
                is_ok = True
            if not is_ok and isinstance(resp_data.get('msg'), str):
                m = resp_data['msg']
                if any(k in m for k in ['成功', '已签到', '已领取', '签到成功']):
                    is_ok = True
            if not is_ok and isinstance(resp_data.get('message'), str):
                m = resp_data['message']
                if any(k in m for k in ['成功', '已签到', '已领取', '签到成功']):
                    is_ok = True
            # 检查 data 嵌套层
            if not is_ok and isinstance(resp_data.get('data'), dict):
                inner = resp_data['data']
                if inner.get('success') or inner.get('code') in (0, 200, '0', '200'):
                    is_ok = True
            self._send_json({'ok': is_ok, 'data': resp_data})

        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8', errors='replace')
            print(f'[zf3d] checkin HTTP {e.code}: {err_body[:500]}')
            self._send_json({'ok': False, 'error': f'服务器返回 {e.code}', 'data': None})
        except urllib.error.URLError as e:
            print(f'[zf3d] checkin URL error: {e}')
            self._send_json({'ok': False, 'error': f'连接失败: {e.reason}', 'data': None})
        except Exception as e:
            print(f'[zf3d] checkin exception: {e}')
            traceback.print_exc()
            self._send_json({'ok': False, 'error': str(e), 'data': None})

    def _handle_zf3d_status(self):
        """GET/POST /api/zf3d/status - 查询朱峰智能体登录状态和签到情况"""
        try:
            cookies = self._zf3d_get_cookies()
            username = ''

            conn = None
            try:
                with _db_lock:
                    conn = get_db()
                    cur = conn.cursor()
                    cur.execute("SELECT value FROM app_data WHERE category='zf3d' AND key='username'")
                    row = cur.fetchone()
                    conn.close()
                    conn = None
                    if row:
                        username = row['value']
            except:
                if conn:
                    try:
                        conn.close()
                    except Exception:
                        logging.debug("swallow", exc_info=True)
            logged_in = bool(cookies) and bool(username)

            checkin_info = None
            if logged_in:
                try:
                    status_url = 'https://www.zf3d.com/api/user.asp?a=checkin_status'
                    req = urllib.request.Request(status_url, method='GET')
                    req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
                    req.add_header('Referer', 'https://www.zf3d.com/')
                    cookie_str = self._zf3d_cookie_header(cookies)
                    if cookie_str:
                        req.add_header('Cookie', cookie_str)

                    ctx = ssl.create_default_context()
                    ctx.check_hostname = False
                    ctx.verify_mode = ssl.CERT_NONE

                    resp = _urlopen_retry(req, timeout=15, tag='Zf3dStatus')
                    resp_body = resp.read().decode('utf-8', errors='replace')

                    new_cookies = self._zf3d_extract_cookies(resp, cookies)
                    self._zf3d_save_cookies(new_cookies)

                    try:
                        checkin_info = json.loads(resp_body)
                    except json.JSONDecodeError:
                        checkin_info = None
                except Exception as e:
                    print(f'[zf3d] status check error: {e}')

            self._send_json({
                'ok': True,
                'logged_in': logged_in,
                'username': username,
                'checkin': checkin_info
            })

        except Exception as e:
            print(f'[zf3d] status exception: {e}')
            self._send_json({'ok': False, 'error': str(e)})


    def _handle_zf3d_site_config(self):
        """GET/POST /api/zf3d/site-config - 获取网站配置（logo等），从数据库读取"""
        conn = None
        try:
            logo_url = ''
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("SELECT value FROM app_data WHERE category='zf3d' AND key='site_config'")
                row = cur.fetchone()
                conn.close()
                conn = None
                if row:
                    try:
                        cfg = json.loads(row['value'])
                        logo_url = cfg.get('logo_url', '')
                    except Exception: logging.debug("swallow", exc_info=True)
            if not logo_url:
                logo_url = 'https://www.zf3d.com/assets/images/logo-transparent.png'
            self._send_json({'ok': True, 'logo_url': logo_url})
        except Exception as e:
            print(f'[zf3d] site_config error: {e}')
            if conn:
                try:
                    conn.close()
                except Exception:
                    logging.debug("swallow", exc_info=True)
            self._send_json({'ok': True, 'logo_url': 'https://www.zf3d.com/assets/images/logo-transparent.png'})

    def _handle_zf3d_logo_img(self):
        """GET /api/zf3d/logo-img - 代理获取外部 logo 图片，避免 CORS 问题"""
        try:
            logo_url = ''
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("SELECT value FROM app_data WHERE category='zf3d' AND key='site_config'")
                row = cur.fetchone()
                conn.close()
                if row:
                    try:
                        cfg = json.loads(row['value'])
                        logo_url = cfg.get('logo_url', '')
                    except Exception: logging.debug("swallow", exc_info=True)
            if not logo_url:
                logo_url = 'https://www.zf3d.com/assets/images/logo-transparent.png'
            # 代理请求外部图片
            req = urllib.request.Request(logo_url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            with _urlopen_retry(req, timeout=10, attempts=3, tag='Zf3dLogo') as resp:
                img_data = resp.read()
                content_type = resp.headers.get('Content-Type', 'image/png')
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Cache-Control', 'public, max-age=3600')
            self.send_header('Content-Length', str(len(img_data)))
            self.end_headers()
            self.wfile.write(img_data)
        except Exception as e:
            print(f'[zf3d] logo-img proxy error: {e}')
            # 代理失败时返回本地 logo 图片
            local_logo = os.path.join(PUBLIC_DIR, 'assets', 'logo-transparent.png')
            if os.path.exists(local_logo):
                with open(local_logo, 'rb') as f:
                    img_data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'image/png')
                self.send_header('Cache-Control', 'public, max-age=300')
                self.send_header('Content-Length', str(len(img_data)))
                self.end_headers()
                self.wfile.write(img_data)
            else:
                self.send_error(404, 'Logo not found')

    def _handle_update_status(self):
        """GET/POST /api/update-status - 自动更新状态（前端轮询；首次调用会拉起守护线程）"""
        try:
            from update_checker import start_auto_update, get_auto_update_state
            state = start_auto_update()  # 幂等：已启动则只返回状态
            self._send_json({'success': True, **state})
        except Exception as e:
            self._send_json({'success': False, 'error': str(e)})

    def _handle_check_update(self):
        """POST /api/check-update - 检查是否有新版本"""
        try:
            from update_checker import UpdateChecker
            import json as _json
            config_path = os.path.join(BASE_DIR, 'private', 'config.json')
            config = {}
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8-sig') as f:
                    config = _json.load(f)
            config['project_root'] = BASE_DIR
            checker = UpdateChecker(config)
            result = checker.check_update(force=True)
            self._send_json(result)
        except Exception as e:
            self._send_json({'has_update': False, 'error': str(e)})

    def _handle_do_update(self, data):
        """POST /api/do-update - 执行更新"""
        try:
            from update_checker import UpdateChecker
            import json as _json
            config_path = os.path.join(BASE_DIR, 'private', 'config.json')
            config = {}
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8-sig') as f:
                    config = _json.load(f)
            config['project_root'] = BASE_DIR
            checker = UpdateChecker(config)
            download_url = data.get('download_url', '')
            if not download_url:
                result = checker.check_update(force=True)
                download_url = result.get('download_url', '')
            if not download_url:
                self._send_json({'success': False, 'error': '无法获取安装包下载地址'})
                return
            # 方案B：后台线程下载新版安装包，完成后自动弹出安装程序；立即响应前端"下载中"
            import tempfile, threading, urllib.request

            def _download_and_launch():
                installer_path = os.path.join(tempfile.gettempdir(), 'ZF-Agent-Setup-latest.exe')
                try:
                    req = urllib.request.Request(download_url, headers={'User-Agent': 'ZF-Agent-Updater'})
                    with urllib.request.urlopen(req, timeout=1800) as resp, open(installer_path, 'wb') as f:
                        while True:
                            chunk = resp.read(256 * 1024)
                            if not chunk:
                                break
                            f.write(chunk)
                    if os.path.getsize(installer_path) < 1024 * 1024:
                        print('[do-update] 下载的安装包异常（体积过小），已放弃')
                        return
                    # 启动安装程序（用户按提示下一步即可；覆盖安装不丢 private/ 隐私数据）
                    os.startfile(installer_path)
                    print(f'[do-update] 安装包已下载并启动: {installer_path}')
                except Exception as e2:
                    print(f'[do-update] 下载/启动安装包失败: {e2}')

            threading.Thread(target=_download_and_launch, daemon=True).start()
            self._send_json({'success': True, 'phase': 'downloading', 'message': '正在后台下载新版安装包，下载完成后将自动弹出安装程序'})
        except Exception as e:
            self._send_json({'success': False, 'error': str(e)})

    def _handle_zf3d_heartbeat_config(self):
        """POST /api/zf3d/heartbeat-config - 保存心跳API Key配置"""
        try:
            body = self._read_body()
            api_key = body.get('api_key', '').strip()
            now_ms = int(time.time() * 1000)
            conn = None
            try:
                with _db_lock:
                    conn = get_db()
                    conn.execute(
                        "INSERT OR REPLACE INTO app_data (category, key, value, created_at) VALUES ('zf3d', 'heartbeat_api_key', ?, ?)",
                        (api_key, now_ms)
                    )
                    conn.commit()
                    conn.close()
                    conn = None
            except Exception as e:
                if conn:
                    try:
                        conn.close()
                    except Exception:
                        logging.debug("swallow", exc_info=True)
            # 保存后自动启动/重启心跳线程
            try:
                from zf3d_heartbeat import start_heartbeat, stop_heartbeat
                if api_key:
                    start_heartbeat()
                    msg = 'API Key 已保存，心跳线程已启动'
                else:
                    stop_heartbeat()
                    msg = 'API Key 已清空，心跳线程已停止'
            except Exception as e2:
                print(f'[zf3d] heartbeat start/stop after config save: {e2}')
                msg = f'API Key 已保存（心跳线程启动失败: {e2}）'
            self._send_json({'ok': True, 'message': msg})
        except Exception as e:
            print(f'[zf3d] heartbeat_config error: {e}')
            self._send_json({'ok': False, 'error': str(e)})

    def _handle_zf3d_heartbeat_status(self):
        """GET/POST /api/zf3d/heartbeat-status - 查询心跳状态"""
        try:
            from zf3d_heartbeat import get_heartbeat_status
            status = get_heartbeat_status()
            self._send_json({'ok': True, 'data': status})
        except Exception as e:
            print(f'[zf3d] heartbeat_status error: {e}')
            self._send_json({'ok': False, 'error': str(e)})

    def _handle_zf3d_ai_token(self):
        if not self._check_origin():
            return
        """GET /api/zf3d/ai-token - 朱峰模型登录即用：根据本机 zf3d 登录态向代理幂等取会员令牌"""
        try:
            conn = None
            login_data = None
            try:
                with _db_lock:
                    conn = get_db()
                    cur = conn.cursor()
                    cur.execute("SELECT value FROM app_data WHERE category='zf3d' AND key='login_data'")
                    row = cur.fetchone()
                    if row and row[0]:
                        login_data = json.loads(row[0])
            except Exception as e:
                logging.debug(f"[zf3d] ai_token read login_data: {e}")
            finally:
                if conn:
                    try:
                        conn.close()
                    except Exception:
                        logging.debug("swallow", exc_info=True)
            if not login_data or not login_data.get('success'):
                self._send_json({'ok': False, 'error': 'not_login'})
                return
            uid = login_data.get('user_id') or (login_data.get('data') or {}).get('user_id')
            if uid in (None, ''):
                self._send_json({'ok': False, 'error': 'not_login'})
                return
            req = urllib.request.Request(
                f'http://127.0.0.1:{_ZF_PROXY_PORT}/internal/get_token',
                data=json.dumps({'user_id': int(uid)}).encode('utf-8'),
                method='POST')
            req.add_header('Content-Type', 'application/json')
            try:
                import zf_identity as _zfi
                _sec = _zfi.internal_secret()
                if _sec:
                    req.add_header('X-ZF-Internal', _sec)
            except Exception:
                pass
            try:
                resp = urllib.request.urlopen(req, timeout=10)
                data = json.loads(resp.read().decode('utf-8'))
                if data.get('token'):
                    self._send_json({'ok': True, 'token': data['token'], 'user_id': int(uid)})
                    return
                self._send_json({'ok': False, 'error': data.get('error') or 'proxy_error'})
            except Exception as e:
                print(f'[zf3d] ai_token proxy call: {e}')
                self._send_json({'ok': False, 'error': 'proxy_unavailable'})
        except Exception as e:
            print(f'[zf3d] ai_token error: {e}')
            self._send_json({'ok': False, 'error': str(e)})

    def _handle_zf3d_identity_ticket(self):
        if not self._check_origin():
            return
        """GET /api/zf3d/identity-ticket - 朱峰线路身份票签发：
        校验本机 zf3d 登录态后向 8787 网关 /internal/issue_identity 换取
        HMAC 签名一次性身份票（Cookie zf_idt），前端凭票调用朱峰通道，明文 key 不出站。"""
        try:
            conn = None
            login_data = None
            try:
                with _db_lock:
                    conn = get_db()
                    cur = conn.cursor()
                    cur.execute("SELECT value FROM app_data WHERE category='zf3d' AND key='login_data'")
                    row = cur.fetchone()
                    if row and row[0]:
                        login_data = json.loads(row[0])
            except Exception as e:
                logging.debug(f"[zf3d] identity_ticket read login_data: {e}")
            finally:
                if conn:
                    try:
                        conn.close()
                    except Exception:
                        logging.debug("swallow", exc_info=True)
            if not login_data or not login_data.get('success'):
                self._send_json({'ok': False, 'error': 'not_login'})
                return
            uid = login_data.get('user_id') or (login_data.get('data') or {}).get('user_id')
            if uid in (None, ''):
                self._send_json({'ok': False, 'error': 'not_login'})
                return
            req = urllib.request.Request(
                f'http://127.0.0.1:{_ZF_PROXY_PORT}/internal/issue_identity',
                data=json.dumps({'user_id': int(uid)}).encode('utf-8'),
                method='POST')
            req.add_header('Content-Type', 'application/json')
            try:
                import zf_identity as _zfi
                _sec = _zfi.internal_secret()
                if _sec:
                    req.add_header('X-ZF-Internal', _sec)
            except Exception:
                pass
            try:
                resp = urllib.request.urlopen(req, timeout=10)
                # 【关键】把网关签发的 Set-Cookie(zf_idt) 原样转发给浏览器：
                # Cookie 按 host(127.0.0.1) 存储、不分端口，之后前端带 credentials 请求 8787 时会自动携带身份票
                sc = resp.headers.get('Set-Cookie')
                data = json.loads(resp.read().decode('utf-8'))
                if data.get('ok'):
                    self._send_json({'ok': True, 'user_id': int(uid),
                                     'expires_in': data.get('expires_in', 0)},
                                    extra_headers=[('Set-Cookie', sc)] if sc else None)
                    return
                self._send_json({'ok': False, 'error': data.get('error') or 'issue_failed'})
            except urllib.error.HTTPError as e:
                self._send_json({'ok': False, 'error': f'upstream_{e.code}'})
            except Exception as e:
                print(f'[zf3d] identity_ticket proxy call: {e}')
                self._send_json({'ok': False, 'error': 'proxy_unavailable'})
        except Exception as e:
            print(f'[zf3d] identity_ticket error: {e}')
            self._send_json({'ok': False, 'error': str(e)})

    def _handle_zf3d_ai_balance(self):
        if not self._check_origin():
            return
        """GET /api/zf3d/ai-balance - 代理本机 AI 网关 internal/me 查询当前用户 AI 余额"""
        try:
            cookies = self._zf3d_get_cookies()
            username = ''
            uid = None
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("SELECT value FROM app_data WHERE category='zf3d' AND key='username'")
                row = cur.fetchone()
                if row:
                    username = row['value']
                # 余额按本地 user_id 查（网关 internal/me 只认 user_id），与 ai_token 同源
                cur.execute("SELECT value FROM app_data WHERE category='zf3d' AND key='login_data'")
                row = cur.fetchone()
                conn.close()
                if row and row[0]:
                    try:
                        login_data = json.loads(row[0])
                        uid = login_data.get('user_id') or (login_data.get('data') or {}).get('user_id')
                    except Exception:
                        uid = None
            if not cookies or not username:
                self._send_json({'ok': False, 'logged_in': False, 'balance': 0, 'username': ''})
                return
            if uid in (None, ''):
                self._send_json({'ok': True, 'logged_in': True, 'username': username,
                                 'balance': 0, 'status': 'none'})
                return
            req = urllib.request.Request(
                f'http://127.0.0.1:{_ZF_PROXY_PORT}/internal/me',
                data=json.dumps({'user_id': int(uid)}).encode('utf-8'),
                method='POST')
            req.add_header('Content-Type', 'application/json')
            try:
                import zf_identity as _zfi
                _sec = _zfi.internal_secret()
                if _sec:
                    req.add_header('X-ZF-Internal', _sec)
            except Exception:
                pass
            try:
                resp = urllib.request.urlopen(req, timeout=8)
                data = json.loads(resp.read().decode('utf-8', errors='replace'))
                self._send_json({'ok': True, 'logged_in': True, 'username': username,
                                 'balance': data.get('balance', 0),
                                 'status': data.get('status', 'none')})
            except Exception as e:
                print(f'[zf3d] ai-balance upstream error: {e}')
                self._send_json({'ok': True, 'logged_in': True, 'username': username,
                                 'balance': 0, 'upstream_err': True})
        except Exception as e:
            print(f'[zf3d] ai-balance exception: {e}')
            self._send_json({'ok': False, 'balance': 0, 'err': str(e)})
