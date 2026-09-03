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

        if path == '/api/version':
            self.do_GET_version()
            return
        if path == '/api/app-root':
            # 返回软件真实安装根目录（含盘符），前端动态注入 system prompt，禁止硬编码
            self._send_json({'ok': True, 'base_root': BASE_DIR.replace('/', '\\')}, 200)
            return
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
        if path == '/api/zf3d/heartbeat-status':
            self._handle_zf3d_heartbeat_status()
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
        if path == '/api/tasknotes':
            self._handle_tasknotes_get()
            return

        self._serve_static(path)

