# -*- coding: utf-8 -*-
"""Mixin: GET 分发（自动拆分自 mixin_dispatch.py，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinDispatchGet(MixinBase):
    def do_GET(self):
        # keep-alive 防线：GET 理论上无 body，但畸形请求可能带 Content-Length，
        # 排干以免污染连接上的下一个请求（501 "Unsupported method ('{}GET')"）
        self._drain_body()
        parsed = urlparse(self.path)
        path = parsed.path

        # ===== 对话串行管理器状态（独立面板轮询） =====
        # ===== Agent 双协议/上下文保留挡位（读写） =====
        if path == '/api/agent/protocol':
            self._handle_agent_protocol_get()
            return
        # ===== 主脑状态与消息流 =====
        if path == '/api/brain/state':
            self._handle_brain_state()
            return
        if path == '/api/brain/report':
            self._handle_brain_report()
            return
        # ===== 协议状态徽章：最近 N 轮实际协议记录 =====
        if path == '/api/agent/protocol/last':
            self._handle_agent_protocol_last()
            return

        if path == '/api/gate/status':
            self._handle_gate_status()
            return
        # ===== 闸门轻量快照（小狗守卫红绿灯联动轮询：仅活跃票据） =====
        if path == '/api/gate/active':
            self._handle_gate_active()
            return

        # 安全：token 认证（private/port.json 设 auth_token 才启用；默认关闭不影响使用）
        # 静态资源（非 /api/）放行并种认证 Cookie，浏览器后续请求自动携带，用户零感知
        from security import check_request_token
        if path.startswith('/api/'):
            if not check_request_token(self):
                return
        else:
            try:
                from security import AUTH_TOKEN as _T
                if _T and not check_request_token(self):
                    return
            except Exception:
                pass
        # ===== 删除缓冲垃圾箱（列表） =====
        # ===== 对话池（chat_pool v1.0）：事件订阅（SSE 断点续读）+ 只读快照 + 开关探测 =====
        if path.startswith('/api/chat-pool/slot/') and path.endswith('/events'):
            self._handle_chat_pool_events()
            return
        if path == '/api/chat-pool/status':
            self._handle_chat_pool_status()
            return
        if path == '/api/chat-pool/active':
            self._handle_chat_pool_active()
            return
        if path == '/api/chat-pool/config':
            self._handle_chat_pool_config()
            return

        if path == '/api/trash/list':
            self._handle_trash_list(parsed)
            return

        # 安全：/api/models/config 始终返回脱敏 key（load_models_config 默认 include_key=False）
        if path == '/api/models/config':
            from model_config import load_models_config
            cfg = load_models_config()
            if cfg is None:
                self._send_json({'ok': False, 'err': 'models.json 不存在，请通过 POST /api/models/config 初始化'}, 404)
            else:
                self._send_json({'ok': True, 'config': cfg})
            return

        # API 璺敱
        if path == '/api/health':
            self.do_GET_health()
            return

        if path == '/api/health/config':
            self._handle_health_config_get()
            return

        # ===== Token 用量统计（面板用）=====
        if path == '/api/usage/tokens':
            qs = parse_qs(parsed.query)
            month = (qs.get('month') or [''])[0]
            days = (qs.get('days') or ['31'])[0]
            try:
                import token_usage_stats
                data = token_usage_stats.token_usage_summary(days)
                if month:
                    data['month_detail'] = token_usage_stats.month_detail(month)
                self._send_json(data)
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            return

        # ===== agent_turns 恢复接口：重启后拉取中断轮次的全量记录（方案A）=====
        if path == '/api/agent/turns':
            qs = parse_qs(parsed.query)
            sid = (qs.get('session_id') or [''])[0]
            if not sid:
                self._send_json({'ok': False, 'err': 'missing session_id'}, 400)
                return
            try:
                from db import get_agent_turns
                rows = get_agent_turns(sid)
                self._send_json({'ok': True, 'session_id': sid, 'turns': rows})
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            return

        # ===== 网络守护状态查询（前端 app-network-restart.js 每 60s GET 轮询） =====
        if path == '/api/network_guard':
            self._handle_network_guard()
            return

        # ===== 备用版本状态查询（含修复请求/通知） =====
        if path == '/api/backup_version':
            self._handle_backup_version()
            return

        # ===== 修复请求注入状态查询（是否待注入/已注入） =====
        if path == '/api/repair_inject_status':
            self._handle_repair_inject_status()
            return

        # ===== 升级器：检查远程新版本 =====
        if path == '/api/updater/check':
            self._handle_updater_check()
            return
        # ===== 升级器：配置读写 =====
        if path == '/api/updater/config':
            self._handle_updater_config_get()
            return

        if path == '/api/version':
            self.do_GET_version()
            return
        if path == '/api/app-root':
            # 返回软件真实安装根目录（含盘符），前端动态注入 system prompt，禁止硬编码
            self._send_json({'ok': True, 'base_root': BASE_DIR.replace('/', '\\')}, 200)
            return
            return

        # ===== 游戏场景存储（engine2d 场景编辑器） =====
        if path == '/api/scenes' or path.startswith('/api/scenes/'):
            self._handle_scenes_get(path)
            return

        if path.startswith('/api/db/'):
            self._handle_db_get(path)
            return

        # ===== 工作区 JSON 保存/打开 =====
        if path == '/api/workspace/list':
            self._handle_workspace_list()
            return
        if path == '/api/workspace/open-folder':
            self._handle_workspace_open_folder()
            return
        if path == '/api/workspace/load':
            self._handle_workspace_load()
            return

        # ===== 应用重启/退出 =====
        if path == '/api/app/restart':
            self._handle_app_restart()
            return
        if path == '/api/app/quit':
            self._handle_app_quit()
            return

        # ===== 像素显示器面板轮询 =====
        if path == '/api/pixel/display':
            self._handle_pixel_display_poll()
            return

        # ===== 鍍忕礌鏄剧ず鍣ㄥ鍑篏IF =====
        if path == '/api/pixel/export_gif':
            self._handle_pixel_export_gif()
            return

        # ===== 鐩戞帶闃熷垪杞 =====
        if path == '/api/monitor/poll':
            self._handle_monitor_poll(parse_qs(parsed.query))
            return

        # ===== 备份管理 =====
        if path == '/api/backup/list':
            self._handle_backup_list()
            return
        if path == '/api/backup/open-folder':
            self._handle_backup_open_folder()
            return

        # ===== 大模型统一配置 =====
        if path == '/api/models/config':
            self._handle_models_config_get()
            return

        # ===== 提示词生成：拉线小圈 → 由大模型根据对话历史生成提示词 =====
        if path == '/api/prompt-gen' and self.command == 'POST':
            self._handle_prompt_gen()
            return

        # ===== 热更新：SSE 实时推送 =====
        if path == '/api/hot-reload/sse':
            self._handle_hot_reload_sse()
            return

        # ===== 获取/上报最后使用的模型 =====
        if path == '/api/chat/last-model' and self.command == 'GET':
            self._handle_get_last_model()
            return
        if path == '/api/chat/last-model' and self.command == 'POST':
            self._handle_report_last_model()
            return

        # ===== zf3d 项目状态 =====
        if path == '/api/zf3d/status':
            self._handle_get_zf3d_status()
            return

        # ===== zf3d 状态 =====
        if path == '/api/zf3d/status':
            self._handle_zf3d_status()
            return

        # ===== zf3d 路由（登录/签到/站点配置/心跳） =====
        if path == '/api/zf3d/site-config':
            self._handle_zf3d_site_config()
            return
        if path == '/api/zf3d/logo-img':
            self._handle_zf3d_logo_img()
            return
        # ===== IP 无感定位（天气栏显示用户地址用）=====
        if path == '/api/geo/ip':
            self._handle_geo_ip()
            return
        # ===== 精确定位反查城市名（浏览器 GPS 坐标 → 省+市）=====
        if path == '/api/geo/reverse':
            self._handle_geo_reverse(parse_qs(parsed.query))
            return

        # ===== QQ 机器人：模块已移除，返回占位响应避免 AttributeError 刷日志 =====
        if path == '/api/qqbot/status':
            self._send_json({'ok': True, 'running': False, 'removed': True})
            return
        if path == '/api/qqbot/messages':
            self._send_json({'ok': True, 'messages': [], 'removed': True})
            return
        if path == '/api/qqbot/login-status':
            self._send_json({'ok': True, 'logged_in': False, 'removed': True})
            return
        if path == '/api/zf3d/heartbeat-status':
            self._handle_zf3d_heartbeat_status()
            return

        # ===== 本机对话远程查看（zf3d agent_remote 联动）=====
        if path == '/api/zf3d/remote/sessions':
            self._handle_remote_sessions(parse_qs(parsed.query))
            return
        if path == '/api/zf3d/remote/history':
            self._handle_remote_history(parse_qs(parsed.query))
            return

        # ===== zf3d 兜底（未识别路径）：读取并丢弃请求体，返回 ok:false，避免 404 后残留体污染 keep-alive 连接 =====
        if path.startswith('/api/zf3d/'):
            try:
                self._read_body()
            except Exception:
                pass
            self._send_json({'ok': False, 'error': 'zf3d module removed'}, 200)
            return

        # ===== 更新状态 =====
        if path == '/api/update-status':
            self._handle_get_update_status()
            return

        # ===== 热更新：状态查询 =====
        if path == '/api/hot-reload/status':
            self._handle_hot_reload_status()
            return

        # 闈濧PI璺緞 -> 闈欐€佹枃浠舵湇鍔?
        # ===== 对话循环模式配置（GET/POST） =====
        if path == '/api/loop-mode-config':
            if self.command == 'POST':
                self._handle_loop_mode_config_post()
            else:
                self._handle_loop_mode_config_get()
            return

        # ===== 底层引擎列表（GET，前端动态渲染引擎选择器） =====
        if path == '/api/engines':
            try:
                import engines_loader
                self._send_json({'ok': True, 'engines': engines_loader.summary()})
            except Exception as e:
                print('[GET /api/engines] 500: %s' % e)
                self._send_json({'ok': False, 'engines': []}, 500)
            return

        # ===== 对话模式插件列表（GET，前端动态渲染模式选择） =====
        if path == '/api/modes':
            try:
                import mode_loader
                self._send_json({'ok': True, 'modes': mode_loader.summary()})
            except Exception as e:
                print('[GET /api/modes] 500: %s' % e)
                self._send_json({'ok': False, 'modes': []}, 500)
            return

        # ===== 打开项目文件夹（系统文件管理器） =====
        if path.startswith('/api/project/open-folder'):
            self._handle_open_project_folder(parsed)
            return

        # ===== 浏览目录（文件夹选择器） =====
        if path.startswith('/api/project/browse-folder'):
            self._handle_browse_folder(parsed)
            return
        if path.startswith('/api/project/filetree'):
            self._handle_project_filetree(parsed)
            return
        if path.startswith('/api/fs/browse'):
            self._handle_fs_browse(parsed)
            return
        if path.startswith('/api/starmap/scan'):
            self._handle_starmap_scan(parsed)
            return
        if path.startswith('/api/save'):
            self._handle_game_save_get(parsed)
            return
        if path.startswith('/api/git/graph'):
            self._handle_git_graph(parsed)
            return
        if path.startswith('/api/git/commit'):
            self._handle_git_commit(parsed)
            return
        if path.startswith('/api/remote/id'):
            self._handle_remote_id(parsed)
            return
        if path.startswith('/api/fs/file'):
            self._handle_fs_file(parsed)
            return
        if path.startswith('/api/fs/text'):
            self._handle_fs_text(parsed)
            return

        # ===== 画布参考板（PureRef 式）：保存/载入 =====
        if path == '/api/refboard-save':
            self._handle_refboard_save()
            return
        if path == '/api/refboard-load':
            self._handle_refboard_load()
            return
        # ===== 画布参考图媒体：读图（持久 URL） =====
        if path.startswith('/api/refboard-media/'):
            self._handle_refboard_media_get(path[len('/api/refboard-media/'):])
            return

        # ===== 文件写操作（删除/移动/复制） =====
        if path == '/api/fs/ops':
            self._handle_fs_ops()
            return

        # 说明：录音/录屏接口（/api/record-*、/api/screenrecord-*）已移至
        # api_dispatch_post.py 的 do_POST —— 前端全部用 POST 调用，挂在 GET
        # 分发里会导致 404（此为 5.0.2 拆分时的回归 bug，已修复）。

        # ===== 对话模式限制规则（GET 读 / POST 写，private/chat_mode_rules.json） =====
        if path == '/api/chat-mode-rules':
            if self.command == 'POST':
                self._handle_chat_mode_rules_post()
            else:
                self._handle_chat_mode_rules_get()
            return

        # ===== 工具结果出口限额（GET 读 / POST 写，private/tool_result_limits.json） =====
        if path == '/api/tool-result-limits':
            if self.command == 'POST':
                self._handle_tool_result_limits_post()
            else:
                self._handle_tool_result_limits_get()
            return

        # ===== 用户设置（GET 读 / POST 写，private/用户设置/user_settings.json） =====
        if path == '/api/user-settings':
            if self.command == 'POST':
                self._handle_user_settings_post()
            else:
                self._handle_user_settings_get()
            return

        # ===== 聊天附件暂存（GET 读，private/用户设置/chat_attachments.json，跨重启恢复待发附件） =====
        if path == '/api/chat-attachments':
            self._handle_chat_attachments_get(parse_qs(parsed.query))
            return

        # ===== 画布背景/特效配置（独立 private/用户设置/background.json） =====
        if path == '/api/background':
            if self.command == 'POST':
                self._handle_background_post()
            else:
                self._handle_background_get()
            return

        if path == '/api/user-preferences':
            if self.command == 'POST':
                self._handle_user_preferences_post()
            else:
                self._handle_user_preferences_get()
            return

        # ===== 工作日志（GET 查询最近 N 天）=====
        if path == '/api/worklog':
            self._handle_worklog_get()
            return

        # ===== 全部配置导出（GET 下载 JSON，含模型+密钥+用户设置） =====
        if path == '/api/config/export':
            self._handle_config_export()
            return

        # ===== 扩展子系统（GET：MCP servers/tools、Skills 列表等） =====
        if path.startswith('/api/ext/'):
            self._handle_ext(method='GET', path=path)
            return

        # ===== 模型配置管家：独立长期记忆（GET 读 / POST 写，config_agent_memory 表） =====
        if path == '/api/config-agent/memory':
            if self.command == 'POST':
                self._handle_config_agent_memory_post()
            else:
                self._handle_config_agent_memory_get()
            return

        # ===== 任务记事本（主人专属任务中枢，GET 列表 / POST 增删改+审核） =====

        # ===== 数据表查看器（可视化浏览 table_memory 的表） =====
        if path == '/api/table-viewer':
            self._handle_table_viewer_get(parsed.query)
            return

        # ===== 内置浏览器 =====
        if path == '/api/browser':
            self._handle_browser_get(parsed.query)
            return

        # ===== HTML 演示工作台 API（读大纲/单页数据/列表） =====
        if path == '/api/demo/list':
            self._handle_demo_list()
            return
        if path == '/api/demo/get':
            self._handle_demo_get(parse_qs(parsed.query))
            return

        # ===== 大模型表格/文档 API =====
        if path == '/api/sheets/list':
            self._handle_docs_list('sheets'); return
        if path == '/api/sheets/get':
            self._handle_docs_get('sheets', parse_qs(parsed.query)); return
        if path == '/api/docs/list':
            self._handle_docs_list('docs'); return
        if path == '/api/docs/get':
            self._handle_docs_get('docs', parse_qs(parsed.query)); return
        if path == '/api/minds/list':
            self._handle_docs_list('minds'); return
        if path == '/api/minds/get':
            self._handle_docs_get('minds', parse_qs(parsed.query)); return
        if path == '/api/psds/list':
            self._handle_docs_list('psds'); return
        if path == '/api/psds/get':
            self._handle_docs_get('psds', parse_qs(parsed.query)); return
        if path == '/api/boards/list':
            self._handle_docs_list('boards'); return
        if path == '/api/boards/get':
            self._handle_docs_get('boards', parse_qs(parsed.query)); return

        # ===== 格式转换 API（市面常用格式 → 朱峰自有大模型格式） =====
        if path == '/api/convert/status':
            self._handle_convert_status(); return

        # ===== 视频工作台本地预览流（带 Range 支持，供 <video> 标签播放） =====
        if path == '/api/video/stream':
            self._handle_video_stream(parsed)
            return

        # ===== 静态文件兜底（index.html / js / css 等）=====
        self._serve_static(path)

    # ===== 本机对话远程查看（zf3d agent_remote 联动）=====
    def _remote_check_key(self, qs):
        """校验访问 key（与 zf3d_commands 使用的 api_key 一致）"""
        try:
            from zf3d_commands import _get_api_key
            expect = _get_api_key() or ''
        except Exception:
            expect = ''
        key = (qs.get('key') or [''])[0]
        if not expect or key != expect:
            self._send_json({'ok': False, 'err': 'bad key'}, 403)
            return False
        return True

    # ===== IP 无感定位（天气栏显示用户地址）=====
    _GEO_IP_CACHE = {'ip': None, 'data': None, 't': 0}

    def _handle_geo_reverse(self, qs):
        """GET /api/geo/reverse?lat=&lon= — 坐标反查省+市（用于浏览器精确定位）。"""
        import urllib.request as _urq
        import urllib.parse as _upp
        try:
            lat = float((qs.get('lat') or [''])[0])
            lon = float((qs.get('lon') or [''])[0])
        except Exception:
            self._send_json({'ok': False, 'err': 'bad lat/lon'})
            return
        try:
            url = ('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude='
                   + _upp.quote(str(lat)) + '&longitude=' + _upp.quote(str(lon)) + '&localityLanguage=zh')
            req = _urq.Request(url, headers={'User-Agent': 'zf3d-agent/5.1'})
            with _urq.urlopen(req, timeout=6) as resp:
                data = __import__('json').loads(resp.read().decode('utf-8', 'ignore'))
            region = data.get('principalSubdivision') or ''
            city = data.get('city') or data.get('locality') or ''
            if city or region:
                self._send_json({'ok': True, 'region': region, 'city': city})
            else:
                self._send_json({'ok': False, 'err': 'no result'})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 502)

    def _handle_geo_ip(self):
        """GET /api/geo/ip — 按客户端 IP 无感定位城市，带 6 小时缓存。"""
        import json as _json
        import time as _time
        import urllib.request as _urq
        # 取客户端真实 IP（支持反向代理 X-Forwarded-For）
        ip = (self.headers.get('X-Forwarded-For') or '').split(',')[0].strip()
        if not ip:
            ip = (self.headers.get('X-Real-IP') or '').strip()
        if not ip:
            ip = self.client_address[0] if self.client_address else ''
        # 内网/回环地址无法直接 IP 定位：改用本机出口公网 IP 定位
        # （本机/局域网部署时，服务器出口公网 IP 即用户宽带出口，可定位到真实城市）
        if (not ip) or ip.startswith(('127.', '10.', '192.168.', '172.16.', '172.17.', '172.18.',
                                      '172.19.', '172.2', '172.30.', '172.31.', '169.254.', '::1')) or ip == 'localhost':
            try:
                req0 = _urq.Request('http://api.ipify.org', headers={'User-Agent': 'zf3d-agent/5.1'})
                with _urq.urlopen(req0, timeout=4) as r0:
                    pub = r0.read().decode('utf-8', 'ignore').strip()
                if not pub or len(pub) > 45 or ':' in pub and pub.count(':') > 1:
                    raise ValueError('no public ip')
                ip = pub
            except Exception:
                self._send_json({'ok': False, 'err': 'private ip'})
                return
        cache = self._GEO_IP_CACHE
        if cache['ip'] == ip and cache['data'] and (_time.time() - cache['t'] < 6 * 3600):
            self._send_json(cache['data'])
            return
        try:
            url = ('http://ip-api.com/json/' + ip +
                   '?fields=status,country,regionName,city,lat,lon&lang=zh-CN')
            req = _urq.Request(url, headers={'User-Agent': 'zf3d-agent/5.1'})
            with _urq.urlopen(req, timeout=4) as resp:
                data = _json.loads(resp.read().decode('utf-8', 'ignore'))
            if data.get('status') != 'success':
                raise ValueError(data.get('message') or 'geo failed')
            out = {'ok': True, 'city': data.get('city') or '', 'region': data.get('regionName') or '',
                   'lat': data.get('lat'), 'lon': data.get('lon')}
            cache.update({'ip': ip, 'data': out, 't': _time.time()})
            self._send_json(out)
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 502)

    def _handle_remote_sessions(self, qs):
        if not self._remote_check_key(qs):
            return
        try:
            import sqlite3
            from config import DB_PATH
            c = sqlite3.connect(DB_PATH, timeout=5)
            c.row_factory = sqlite3.Row
            rows = c.execute(
                "SELECT session_id, COUNT(*) AS n, MAX(created_at) AS last_time, "
                "MAX(CASE WHEN role='user' THEN substr(content,1,50) END) AS preview "
                "FROM chat_history WHERE role IN ('user','assistant') "
                "GROUP BY session_id ORDER BY last_time DESC LIMIT 50"
            ).fetchall()
            c.close()
            self._send_json({'ok': True, 'sessions': [dict(r) for r in rows]})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_remote_history(self, qs):
        if not self._remote_check_key(qs):
            return
        sid = (qs.get('session_id') or [''])[0]
        if not sid:
            self._send_json({'ok': False, 'err': 'missing session_id'}, 400)
            return
        try:
            import sqlite3
            from config import DB_PATH
            c = sqlite3.connect(DB_PATH, timeout=5)
            c.row_factory = sqlite3.Row
            rows = c.execute(
                "SELECT role, content, created_at FROM chat_history "
                "WHERE session_id = ? AND role IN ('user','assistant') "
                "ORDER BY created_at ASC LIMIT 500", (sid,)).fetchall()
            c.close()
            self._send_json({'ok': True, 'session_id': sid, 'messages': [dict(r) for r in rows]})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 500)


    # ===== 视频工作台本地预览流 =====
    _VIDEO_MIME = {
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
        '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.m4v': 'video/mp4',
        '.ts': 'video/mp2t', '.flv': 'video/x-flv', '.wmv': 'video/x-ms-wmv',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
        '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
        '.srt': 'text/plain; charset=utf-8',
    }

    def _handle_video_stream(self, parsed):
        """GET /api/video/stream?p=<本地路径> — 带 Range 的单文件预览流。"""
        import os as _os
        import re as _re
        from urllib.parse import parse_qs, unquote
        try:
            qs = parse_qs(parsed.query)
            p = unquote((qs.get('p') or [''])[0]).strip()
            if not p:
                raise ValueError('missing p')
            p = _os.path.abspath(p)
            if not _os.path.isfile(p):
                raise ValueError('file not found')
            ext = _os.path.splitext(p)[1].lower()
            ctype = self._VIDEO_MIME.get(ext, 'application/octet-stream')
            size = _os.path.getsize(p)
            start, end, status = 0, size - 1, 200
            m = _re.match(r'bytes=(\d*)-(\d*)$', (self.headers.get('Range') or '').strip())
            if m and (m.group(1) or m.group(2)):
                if m.group(1):
                    start = int(m.group(1))
                    if m.group(2):
                        end = min(int(m.group(2)), size - 1)
                else:
                    start = max(0, size - int(m.group(2)))
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{size}')
                    self.end_headers()
                    return
                status = 206
            length = max(0, end - start + 1)
            self.send_response(status)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(length))
            self.send_header('Accept-Ranges', 'bytes')
            if status == 206:
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.end_headers()
            with open(p, 'rb') as f:
                f.seek(start)
                remain = length
                while remain > 0:
                    chunk = f.read(min(1 << 20, remain))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remain -= len(chunk)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass
        except Exception as e:
            try:
                self._send_json({'ok': False, 'err': str(e)}, 400)
            except Exception:
                pass
 
