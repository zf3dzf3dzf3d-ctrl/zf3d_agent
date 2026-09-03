# -*- coding: utf-8 -*-
"""朱峰社区登录、签到、更新和心跳相关路由（自 4.2.1 移植，方法体未改动）。"""
from routes._shared import *
from routes.mixin_base import MixinBase


class Zf3dRoutesMixin(MixinBase):
    """朱峰社区及相关系统路由。"""

        # ===== 朱峰社区登录/签到/状态 =====

    def _zf3d_get_cookies(self):
        """从数据库读取保存的朱峰社区 cookies"""
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
                try: conn.close()
                except Exception: pass
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
                    "INSERT OR REPLACE INTO app_data (category, key, value, created_at) VALUES ('zf3d', 'cookies', ?, ?)",
                    (cookie_json, now_ms)
                )
                conn.commit()
                conn.close()
                conn = None
        except Exception as e:
            print(f'[zf3d] save_cookies error: {e}')
            if conn:
                try: conn.close()
                except Exception: pass

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
        """POST /api/zf3d/login - 登录朱峰社区"""
        import urllib.parse as up
        try:
            body = self._read_body()
            username = body.get('username', '')
            password = body.get('password', '')
            if not username or not password:
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

            resp = urllib.request.urlopen(req, timeout=30, context=ctx)
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
                        try: conn.close()
                        except Exception: pass
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
                        except (json.JSONDecodeError, TypeError):
                            pass
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
                            # [新增] 登录成功立即上报一次，朱峰社区网站端马上能看到该用户已登录
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
        """POST /api/zf3d/checkin - 朱峰社区签到"""
        import urllib.parse as up
        try:
            cookies = self._zf3d_get_cookies()
            if not cookies:
                self._send_json({'ok': False, 'error': '请先登录朱峰社区'})
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

            resp = urllib.request.urlopen(req, timeout=30, context=ctx)
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
        """GET/POST /api/zf3d/status - 查询朱峰社区登录状态和签到情况"""
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
                    try: conn.close()
                    except Exception: pass

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

                    resp = urllib.request.urlopen(req, timeout=15, context=ctx)
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
                    except Exception:
                        pass
            if not logo_url:
                logo_url = 'https://www.zf3d.com/assets/images/logo-transparent.png'
            self._send_json({'ok': True, 'logo_url': logo_url})
        except Exception as e:
            print(f'[zf3d] site_config error: {e}')
            if conn:
                try: conn.close()
                except Exception: pass
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
                    except Exception:
                        pass
            if not logo_url:
                logo_url = 'https://www.zf3d.com/assets/images/logo-transparent.png'
            # 代理请求外部图片
            req = urllib.request.Request(logo_url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            with urllib.request.urlopen(req, timeout=10) as resp:
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
                with open(config_path, 'r', encoding='utf-8') as f:
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
                with open(config_path, 'r', encoding='utf-8') as f:
                    config = _json.load(f)
            config['project_root'] = BASE_DIR
            checker = UpdateChecker(config)
            download_url = data.get('download_url', '')
            if not download_url:
                result = checker.check_update(force=True)
                download_url = result.get('download_url', '')
            if not download_url:
                self._send_json({'success': False, 'error': '无法获取下载地址'})
                return
            result = checker.do_update(download_url)
            self._send_json(result)
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
                    try: conn.close()
                    except Exception: pass
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