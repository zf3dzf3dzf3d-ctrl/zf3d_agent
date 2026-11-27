# -*- coding: utf-8 -*-
"""zf3d 登录域路由（重构 Step3：自 mixin_zf3d.py 按职责拆出，方法体未改动）。

包含：cookies 读写辅助、/api/zf3d/login 登录（含 consent 隐私门、心跳激活）。
依赖 _shared 的 json/time/os/urllib/_db_lock/get_db/db_read/_urlopen_retry/BASE_DIR。
"""
from routes._shared import *
from routes.mixin_base import MixinBase
import logging
from util_log import get_logger

log = get_logger('zf3d_login')


class Zf3dLoginMixin(MixinBase):
    """zf3d 登录域：cookies 辅助 + 登录端点。"""

    def _zf3d_get_cookies(self):
        """从数据库读取保存的朱峰智能体 cookies"""
        conn = None
        try:
            # F2 读锁分离：纯 SELECT 不再排队全局 _db_lock
            row = db_read("SELECT value FROM app_data WHERE category='zf3d' AND key='cookies'", fetch='one')
            if row:
                return json.loads(row['value'])
            return {}
        except Exception as e:
            log.info(f'[zf3d] get_cookies error: {e}')
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
            log.info(f'[zf3d] save_cookies error: {e}')
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
            # 【隐私整改 2026-11-05】登录必须显式带 consent=true 才保存 agent_api_key
            # 并激活心跳/对话同步；否则仅做身份认证，不激活任何数据外发。
            privacy_consent = body.get('consent') is True
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

            # [SSL 2026-11-02] 改走 _shared._SSL_CTX 统一证书校验（含 ssl_verify 开关），不再硬编码禁验
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
                now_ms = int(time.time() * 1000)
                conn = None
                try:
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
                except Exception as e:
                    log.info(f"[zf3d] save username error: {e}")
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
                    log.info(f'[zf3d] save login_data error: {e2}')

                # 自动从登录响应中提取 agent_api_key，保存为 heartbeat_api_key 并启动心跳
                # 【隐私整改 2026-11-05】仅在用户显式 consent=true 时才激活（登录≠授权数据外发）
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
                    if ag_key and not privacy_consent:
                        log.info('[zf3d] 登录成功，但用户未勾选数据同步知情同意，不激活心跳/对话上传')
                    elif ag_key:
                        with _db_lock:
                            conn3 = get_db()
                            conn3.execute(
                                "INSERT OR REPLACE INTO app_data (category, key, value, created_at) VALUES ('zf3d', 'heartbeat_api_key', ?, ?)",
                                (ag_key, now_ms)
                            )
                            # 记录知情同意状态（chat_sync_enabled），供对话同步/心跳身份上报读取
                            conn3.execute(
                                "INSERT OR REPLACE INTO app_data (category, key, value, created_at) VALUES ('zf3d', 'chat_sync_enabled', ?, ?)",
                                ('1' if privacy_consent else '0', now_ms)
                            )
                            conn3.commit()
                            conn3.close()
                        log.info(f'[zf3d] 自动获取 heartbeat_api_key 成功，启动心跳线程')
                        try:
                            from zf3d_heartbeat import start_heartbeat, trigger_immediate_heartbeat
                            start_heartbeat()
                            # [新增] 登录成功立即上报一次，朱峰智能体网站端马上能看到该用户已登录
                            trigger_immediate_heartbeat()
                        except Exception as e4:
                            log.error(f'[zf3d] 心跳线程启动失败: {e4}')
                    else:
                        log.info('[zf3d] 登录响应中未包含 agent_api_key，心跳/上传不激活（隐私整改：无默认 key 回退）')
                except Exception as e3:
                    log.info(f'[zf3d] auto save heartbeat_api_key error: {e3}')

                self._send_json({'ok': True, 'data': resp_data, 'username': username})
            else:
                self._send_json({'ok': False, 'error': resp_data.get('message', '登录失败'), 'data': resp_data})

        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8', errors='replace')
            log.info(f'[zf3d] login HTTP {e.code}: {err_body[:500]}')
            self._send_json({'ok': False, 'error': f'服务器返回 {e.code}', 'data': None})
        except urllib.error.URLError as e:
            log.info(f'[zf3d] login URL error: {e}')
            self._send_json({'ok': False, 'error': f'连接失败: {e.reason}', 'data': None})
        except Exception as e:
            log.info(f'[zf3d] login exception: {e}')
            traceback.print_exc()
            self._send_json({'ok': False, 'error': str(e), 'data': None})
