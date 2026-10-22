# -*- coding: utf-8 -*-
"""Mixin: GET 分发（自动拆分自 mixin_dispatch.py，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase
from routes.mixin_download import MixinDownload
from routes.mixin_share import ShareRoutesMixin
from routes.mixin_loginstate import MixinLoginState


from routes.mixin_file_bridge import FengkongFileBridge

class MixinDispatchGet(ShareRoutesMixin, MixinLoginState, MixinDownload, FengkongFileBridge):
    def do_GET(self):
        # keep-alive 防线：GET 理论上无 body，但畸形请求可能带 Content-Length，
        # 排干以免污染连接上的下一个请求（501 "Unsupported method ('{}GET')"）
        self._drain_body()
        parsed = urlparse(self.path)
        path = parsed.path

        # ===== 智能体互见与发现（agent_registry，阶段0/1）=====
        # 延迟 import：不碰 server.py 启动 import 链，热更新即可生效。
        if path in ('/api/agents', '/agent-info', '/.well-known/agent.json'):
            try:
                import agent_registry as _ar
                if path == '/api/agents':
                    _qs = parse_qs(parsed.query or '')
                    _scope = (_qs.get('scope') or ['local'])[0]
                    self._send_json(_ar.list_agents(scope=_scope))
                else:
                    # /agent-info 与 /.well-known/agent.json 同义：本实例自述卡
                    self._send_json(_ar.get_self_card_public())
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            return


        # ===== 审核师箭头配对：服务器端持久化（防客户端本地存储被清导致箭头全丢） =====
        if path == '/api/verify-pairs':
            try:
                _fp = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                    '..', '..', 'private', 'db', 'verify_pairs.json'))
                if os.path.isfile(_fp):
                    with open(_fp, 'r', encoding='utf-8') as f:
                        self._send_json({'ok': True, 'pairs': f.read()})
                else:
                    self._send_json({'ok': True, 'pairs': None})
            except Exception as e:
                self._send_json({'ok': False, 'error': str(e)}, 500)
            return

        if path == '/api/fengkong/files':
            self._handle_fk_files(parsed); return
        if path == '/api/fengkong/changes':
            self._handle_fk_changes(parsed); return
        if path == '/api/fengkong/download':
            self._handle_fk_download(parsed); return
        if path == '/api/fengkong/thumb':
            self._handle_fk_thumb(parsed); return

        # ===== 家庭设备网关 device_hub v1（峰控电视/家电控制） =====
        if path in ('/api/device/list', '/api/device/control', '/api/device/scene'):
            qs = parse_qs(parsed.query)
            g1 = lambda k, d='': (qs.get(k) or [d])[0]
            try:
                from tools.device_hub import list_devices, control, run_scene
                if path == '/api/device/list':
                    self._send_json(list_devices())
                elif path == '/api/device/control':
                    self._send_json(control(g1('device'), g1('action'),
                                            g1('value') or None,
                                            g1('confirm') or None))
                else:
                    self._send_json(run_scene(g1('scene'), g1('confirm') or None))
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            return

        # ===== 智能体养成系统（成长可视化） =====
        if path == '/api/growth/full':
            try:
                import growth_engine
                self._send_json(growth_engine.growth_full())
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            return
        if path == '/api/growth/summary':
            try:
                import growth_engine
                self._send_json(growth_engine.summary())
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            return

        # ===== 大模型链路统计（对话框头部徽章轮询） =====
        if path == '/api/model-link-stats':
            try:
                import model_link_stats as _mls
                self._send_json({'ok': True, 'enabled': _mls.is_enabled(),
                                 'data': _mls.summary()})
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            return

        # ===== 设置读取（只读，供前端开关判断，如 model_link_stats.enabled） =====
        if path == '/api/settings':
            cfg = {}
            try:
                import json as _json, os as _os
                _p = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                                   '..', 'private', 'settings.json')
                with open(_p, 'r', encoding='utf-8') as f:
                    cfg = _json.load(f) or {}
            except Exception:
                cfg = {}
            self._send_json({'ok': True, 'settings': cfg})
            return

        # ===== 多线程下载器 =====
        if path == '/api/download/progress':
            from urllib.parse import parse_qs as _pqs
            self._handle_download_progress(_pqs(parsed.query or ''))
            return
        if path == '/api/download/list':
            self._handle_download_list()
            return
        # ===== 对话串行管理器状态（独立面板轮询） =====
        # ===== Agent 双协议/上下文保留挡位（读写） =====
        # ===== 角色数据库：列表 + 当前对话选中角色 =====
        if path == '/api/roles':
            self._handle_roles_get()
            return
        # ===== 多智能体协作监控（独立监控页轮询） =====
            try:
                from urllib.parse import parse_qs as _pqs
                _q = _pqs(parsed.query or '')
                _st = _mon.get_stats(days=(_q.get('days') or ['7'])[0])
                self._send_json({'ok': True, 'stats': _st})
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            return
        if path == '/api/agent/protocol':
            self._handle_agent_protocol_get()
            return
        # ===== 监督师开关（独立面板轮询/前端切换） =====
        if path == '/api/supervisor':
            self._handle_supervisor_get()
            return
        # ===== 管家团档案状态（role 参数缺省=健康师，向后兼容） =====
        if path == '/api/butler/state':
            try:
                from urllib.parse import parse_qs as _pq, urlparse as _pu
                _q = _pq(_pu(self.path).query)
                _role = (_q.get('role') or ['健康师'])[0]
                import butler_store as _bs
                s, p, recs = _bs.summary(role=_role, days=7)
                self._send_json({'ok': True, 'summary': s, 'profile': p,
                                 'records_count': len(recs), 'role': _role})
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            return
        # ===== 管家团角色注册表 =====
        if path == '/api/butler/team':
            try:
                import butler_store as _bs
                self._send_json({'ok': True, 'team': _bs.get_team()})
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500)
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

        # ===== 循环内核化·阶段B：Loop-S 内核循环（事件流 SSE + 状态）=====
        if path == '/api/loop_s/events':
            self._handle_loop_s_events()
            return
        if path == '/api/loop_s/status':
            self._handle_loop_s_status()
            return

        # ===== 循环内核化·阶段C：审批列表 =====
        if path == '/api/approval/list':
            self._handle_approval_list()
            return

        # ===== 可编排后台流水线·Jobs（状态/列表/transcript）=====
        if path == '/api/jobs' or path.startswith('/api/jobs/'):
            self._handle_jobs_get(path)
            return

        if path == '/api/cleanup/speed':
            from routes.mixin_cleanup import handle_cleanup_speed
            handle_cleanup_speed(self, do_run=False)
            return
        if path == '/api/cleanup/step':
            from routes.mixin_cleanup import handle_cleanup_step
            handle_cleanup_step(self, do_run=False, key=(parse_qs(parsed.query or '').get('key') or [''])[0])
            return
        if path == '/api/trash/list':
            self._handle_trash_list(parsed)
            return

        # ===== 画布玩偶 TTS（GET 便捷形式） =====
        if path == '/api/avatar/tts':
            self._handle_avatar_tts(qs=parse_qs(parsed.query))
            return

        # ===== 朱峰官方模型即时同步（打开选择面板时前端触发，替代定时同步）=====
        if path == '/api/models/refresh':
            try:
                import zf_model_sync
                r = zf_model_sync.sync()
                self._send_json(r)
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500)
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

        # ===== 外部线路管理面（GET 只读：config/health/models/test）=====
        if path.startswith('/api/external/'):
            import external_router
            external_router.handle_external_admin(self, path[len('/api/external/'):])
            return

        # API 璺敱
        if path == '/api/health':
            self.do_GET_health()
            return

        if path == '/api/health/config':
            self._handle_health_config_get()
            return

        # 健康守护数据库持久化
        if path == '/api/health/state':
            self._handle_health_state_get()
            return
        if path == '/api/health/report':
            self._handle_health_report_get()
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

        if path == '/api/usage/detail':
            qs = parse_qs(parsed.query)
            try:
                import token_usage_stats
                data = token_usage_stats.usage_detail(
                    page=qs.get('page', ['1'])[0],
                    page_size=qs.get('page_size', ['30'])[0],
                    month=qs.get('month', [''])[0],
                    model=qs.get('model', [''])[0],
                    q=qs.get('q', [''])[0],
                    range_=qs.get('range', [''])[0])
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

        # ===== 每日开工简报（渐进式长期依赖·阶段1） =====
        if path == '/api/briefing':
            from routes.mixin_briefing import handle_route as _brief
            _brief(self)
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
        if path == '/api/appdocs':
            self.get_appdocs()
            return
        if path == '/api/app-root':
            # 返回软件真实安装根目录（含盘符），前端动态注入 system prompt，禁止硬编码
            self._send_json({'ok': True, 'base_root': BASE_DIR.replace('/', '\\')}, 200)
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

        # ===== 像素显示器导出GIF =====
        if path == '/api/pixel/export_gif':
            self._handle_pixel_export_gif()
            return

        # ===== 鐩戞帶闃熷垪杞 =====
        # ===== 監控隊列輪詢 (含乱码原文, 保持) =====
        if path == '/api/monitor/poll':
            self._handle_monitor_poll(parse_qs(parsed.query))
            return

        # ===== FPS 坠落真凶追查：主脑查询低帧现场 =====
        if path == '/api/fps-guard/list':
            self._handle_fps_guard_list(parse_qs(parsed.query))
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

        # ===== FPS 坠落真凶追查：低帧现场上报 =====
        if path == '/api/fps-guard/report' and self.command == 'POST':
            self._handle_fps_guard_report()
            return

        # ===== 双端界面实时同步：SSE =====
        if path.startswith('/api/ui-sync/sse'):
            self._handle_ui_sync_sse()
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

        # ===== 朱峰共享空间 =====
        if path.startswith('/api/share'):
            self.route_share()
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
        # ===== zf3d AI 余额（前端顶栏/面板判断登录态依赖此路由；缺失会落入下方兜底误报 "zf3d module removed"）=====
        if path == '/api/zf3d/ai-balance':
            self._handle_zf3d_ai_balance()
            return
        if path == '/api/zf3d/heartbeat-status':
            self._handle_zf3d_heartbeat_status()
            return
        if path == '/api/zf3d/ai-token':
            self._handle_zf3d_ai_token()
            return
        if path == '/api/zf3d/identity-ticket':
            self._handle_zf3d_identity_ticket()
            return
        elif path == '/api/zf3d/ai-channels':
            # 朱峰模型 · 识图/生图 独立通道与费率配置（apiKey 掩码返回）
            import zf_channel_config
            self._send_json({'ok': True, 'channels': zf_channel_config.load_channels(False),
                             'rates_ready': {
                                 'vision': zf_channel_config.rates_ready('vision'),
                                 'imagegen': zf_channel_config.rates_ready('imagegen')}})
            return

        # ===== 双端同步按钮：检测/拉取云端手机消息 =====
        if path == '/api/zf3d/remote_sync':
            self._handle_zf3d_remote_sync(parse_qs(parsed.query))
            return

        # ===== 本机对话远程查看（zf3d agent_remote 联动）=====
        if path == '/api/zf3d/remote/sessions':
            self._handle_remote_sessions(parse_qs(parsed.query))
            return
        if path == '/api/zf3d/remote/history':
            self._handle_remote_history(parse_qs(parsed.query))
            return
        if path == '/api/zf3d/remote/chat_status':
            self._handle_remote_chat_status(parse_qs(parsed.query))
            return
        if path == '/api/zf3d/remote/chat_pull':
            self._handle_remote_chat_pull(parse_qs(parsed.query))
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
        # ===== 密码库 =====
        if path.startswith('/api/vault/'):
            self._handle_vault_get(path, parsed)
            return

        # ===== 登录态管理（列表/档案） =====
        if path.startswith('/api/loginstate/'):
            self._handle_loginstate_get(path, parsed)
            return

        if path == '/api/update-status':
            self._handle_get_update_status()
            return

        # ===== 热更新：状态查询 =====
        if path == '/api/hot-reload/status':
            self._handle_hot_reload_status()
            return

        # 非API路径 -> 静态文件服务
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
        if path == '/api/git/branches':
            import sys as _sys, os as _os
            _srv = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
            if _srv not in _sys.path:
                _sys.path.insert(0, _srv)
            import git_branch_api as _gb
            self._send_json(_gb.handle_branches_get(parsed.query))
            return
        if path.startswith('/api/remote/id'):
            self._handle_remote_id(parsed)
            return
        if path.startswith('/api/fs/file'):
            self._handle_fs_file(parsed)
            return
        if path.startswith('/api/fs/thumb'):
            self._handle_fs_thumb(parsed)
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

        if path == '/api/macro-lib':
            if self.command == 'POST':
                self._handle_macro_lib_post()
            else:
                self._handle_macro_lib_get()
            return

        # ===== 内部 Python 工作台（指挥台第 2 tab，仅本机，ZF_PYCONSOLE=off 可禁用） =====
        # 注意：exec 是 POST 接口（处理函数读 POST body），已正确注册在 do_POST 链
        # （api_dispatch_post.py）。此处 do_GET 仅保留 history 只读回显。
        if path == '/api/pyconsole/history':
            self._handle_pyconsole_history()
            return

        # ===== 用户自定义工具库（三期自举 register_tool）=====
        if path == '/api/user-tools':
            if self.command == 'POST':
                self._handle_user_tools_post()
            else:
                self._handle_user_tools_get()
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
        # ===== 图片工作台：工具注册表 / 状态持久化 =====
        if path == '/api/workbench/tools':
            self._handle_wb_tools_list()
            return
        if path == '/api/workbench/state':
            self._handle_wb_state_get()
            return
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

        # ===== 每日开工简报 + 温和召回（server 端时间戳，GET 一次调用即记录本次访问） =====
        if path == '/api/user/brief':
            self._handle_user_brief()
            return

        # ===== 任务记事本（主人专属任务中枢，GET 列表 / POST 增删改+审核） =====

        # ===== 数据表查看器（可视化浏览 table_memory 的表） =====
        if path == '/api/table-viewer':
            self._handle_table_viewer_get(parsed.query)
            return

        # ===== 内置浏览器同域代理（iframe 直连真实网页） =====
        if path == '/api/webproxy':
            self._handle_webproxy('GET')
            return
        if path == '/api/webproxy_sync_cookies':
            self._handle_webproxy_cookie_sync(parsed.query)
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

        # ===== 路径守卫：白名单/临时票状态查询 =====
        if path == '/api/pathguard/status':
            from tools.coding.backend import _pathguard as _pg
            self._send_json({'ok': True, 'status': _pg.status()})
            return

        # ===== 视频工作台本地预览流（带 Range 支持，供 <video> 标签播放） =====
        if path == '/api/video/stream':
            self._handle_video_stream(parsed)
            return

        # ===== 静态文件兜底（index.html / js / css 等）=====
        self._serve_static(path)

    # ===== 每日开工简报 + 温和召回 =====
    # GET /api/user/brief —— server 端时间戳记录访问，返回召回信息+未完成计划+最近记录+git 快照
    # 全容错：查不到就省略，绝不让接口报错。
    def _brief_store(self):
        import os as _os
        try:
            here = _os.path.dirname(_os.path.abspath(__file__))
            data_dir = _os.path.normpath(_os.path.join(here, '..', 'data'))
            if not _os.path.isdir(data_dir):
                _os.makedirs(data_dir, exist_ok=True)
            return _os.path.join(data_dir, 'user_brief_state.json')
        except Exception:
            return _os.path.join(_os.path.expanduser('~'), '.zf_user_brief_state.json')

    def _handle_user_brief(self):
        import os as _os
        import json as _json
        import re as _re
        import subprocess as _sp
        from datetime import datetime as _dt
        now_ms = int(_dt.now().timestamp() * 1000)
        state = {'lastVisit': 0, 'visitCount': 0}
        fpath = self._brief_store()
        try:
            if _os.path.isfile(fpath):
                with open(fpath, 'r', encoding='utf-8') as f:
                    state = _json.load(f)
        except Exception:
            state = {'lastVisit': 0, 'visitCount': 0}
        last = int(state.get('lastVisit') or 0)
        cnt = int(state.get('visitCount') or 0) + 1
        days_away = max(0, int((now_ms - last) / 86400000)) if last else -1  # -1 = 首次
        try:
            with open(fpath, 'w', encoding='utf-8') as f:
                _json.dump({'lastVisit': now_ms, 'visitCount': cnt}, f)
        except Exception:
            pass

        out = {'ok': True, 'lastVisit': last, 'daysAway': days_away, 'visitCount': cnt}

        # 未完成计划（long_plan 的 MD 文件，容错扫常见目录）
        plans = []
        try:
            here = _os.path.dirname(_os.path.abspath(__file__))
            for d in (os.path.join('..', '..', 'system', 'longplan'),
                      os.path.join('..', '..', 'private', '记忆', 'longplan'),
                      os.path.join('..', 'data', 'longplan')):
                full = _os.path.normpath(_os.path.join(here, d))
                if not _os.path.isdir(full):
                    continue
                for fn in _os.listdir(full):
                    if not fn.endswith('.md'):
                        continue
                    try:
                        with open(_os.path.join(full, fn), 'r', encoding='utf-8', errors='ignore') as f:
                            txt = f.read()
                        pend = len(_re.findall(r'- \[ \]', txt))
                        done = len(_re.findall(r'- \[x\]', txt, _re.IGNORECASE))
                        if pend > 0:
                            title = fn[:-3]
                            m = _re.search(r'#\s*(.+)', txt)
                            if m:
                                title = m.group(1).strip()[:40] or title
                            plans.append({'id': fn[:-3], 'title': title, 'pending': pend, 'done': done})
                    except Exception:
                        continue
            plans.sort(key=lambda p: -p['pending'])
            plans = plans[:3]
        except Exception:
            plans = []
        out['unfinishedPlans'] = plans

        # 最近项目记录（private/记忆 按 mtime 取最近 5 个）
        recs = []
        try:
            mem_dir = _os.path.normpath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..', 'private', '记忆'))
            if _os.path.isdir(mem_dir):
                files = [(_os.path.getmtime(_os.path.join(mem_dir, fn)), fn[:-3]) for fn in _os.listdir(mem_dir) if fn.endswith('.md')]
                files.sort(reverse=True)
                recs = [n for _, n in files[:5]]
        except Exception:
            recs = []
        out['recentRecords'] = recs

        # git 快照
        gitinfo = {}
        try:
            base = _os.path.normpath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..'))
            r1 = _sp.run(['git', '-C', base, 'rev-parse', '--abbrev-ref', 'HEAD'], capture_output=True, text=True, timeout=3)
            if r1.returncode == 0:
                gitinfo['branch'] = r1.stdout.strip()
                r2 = _sp.run(['git', '-C', base, 'status', '--porcelain'], capture_output=True, text=True, timeout=3)
                gitinfo['dirty'] = len([l for l in r2.stdout.splitlines() if l.strip()])
        except Exception:
            gitinfo = {}
        out['git'] = gitinfo

        try:
            self._send_json(out)
        except Exception:
            pass

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
            # F4 直连收编：改走 db.get_db 线程本地复用连接（策划案 F4 第一批）
            from db import get_db
            c = get_db()
            c.row_factory = sqlite3.Row
            rows = c.execute(
                "SELECT session_id, COUNT(*) AS n, MAX(created_at) AS last_time, "
                "MAX(CASE WHEN role='user' THEN substr(content,1,50) END) AS preview "
                "FROM chat_history WHERE role IN ('user','assistant') "
                "GROUP BY session_id ORDER BY last_time DESC LIMIT 50"
            ).fetchall()
            # 线程本地连接不可 close（复用），仅丢弃 row_factory 影响面小的设置
            c.row_factory = None
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
            # F4 直连收编：改走 db.get_db 线程本地复用连接（策划案 F4 第一批）
            from db import get_db
            c = get_db()
            c.row_factory = sqlite3.Row
            rows = c.execute(
                "SELECT role, content, created_at FROM chat_history "
                "WHERE session_id = ? AND role IN ('user','assistant','progress') "
                "ORDER BY created_at ASC LIMIT 500", (sid,)).fetchall()
            c.row_factory = None
            self._send_json({'ok': True, 'session_id': sid, 'messages': [dict(r) for r in rows]})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_remote_chat_status(self, qs):
        """GET /api/zf3d/remote/chat_status — 手机峰控检测电脑本地会话是否更新（只回版本号，轻量）。"""
        if not self._remote_check_key(qs):
            return
        sid = (qs.get('session_id') or [''])[0]
        if not sid:
            self._send_json({'ok': False, 'err': 'missing session_id'}, 400)
            return
        try:
            import sqlite3
            # F4 直连收编：改走 db.get_db 线程本地复用连接（策划案 F4 第一批）
            from db import get_db
            c = get_db()
            row = c.execute(
                "SELECT COUNT(*) AS n, COALESCE(MAX(id),0) AS max_id FROM chat_history "
                "WHERE session_id = ? AND role IN ('user','assistant')", (sid,)).fetchone()
            c.row_factory = None
            self._send_json({'ok': True, 'session_id': sid, 'count': row[0], 'max_id': row[1]},
                            extra_headers={'Cache-Control': 'no-store'})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_remote_chat_pull(self, qs):
        """GET /api/zf3d/remote/chat_pull — 手机峰控增量拉取电脑本地会话新消息（since_id 之后）。"""
        if not self._remote_check_key(qs):
            return
        sid = (qs.get('session_id') or [''])[0]
        since = int((qs.get('since_id') or ['0'])[0] or 0)
        if not sid:
            self._send_json({'ok': False, 'err': 'missing session_id'}, 400)
            return
        try:
            import sqlite3
            # F4 直连收编：改走 db.get_db 线程本地复用连接（策划案 F4 第一批）
            from db import get_db
            c = get_db()
            c.row_factory = sqlite3.Row
            rows = c.execute(
                "SELECT id, role, content, created_at FROM chat_history "
                "WHERE session_id = ? AND role IN ('user','assistant','progress') AND id > ? "
                "ORDER BY id ASC LIMIT 200", (sid, since)).fetchall()
            row = c.execute(
                "SELECT COUNT(*) AS n, COALESCE(MAX(id),0) AS max_id FROM chat_history "
                "WHERE session_id = ? AND role IN ('user','assistant')", (sid,)).fetchone()
            c.row_factory = None
            self._send_json({'ok': True, 'session_id': sid, 'since_id': since,
                             'messages': [dict(r) for r in rows],
                             'count': row[0], 'max_id': row[1]},
                            extra_headers={'Cache-Control': 'no-store'})
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
            # ===== 路径守卫：项目外文件默认拒绝，需用户在放行对话框确认 =====
            from tools.coding.backend import _pathguard as _pg
            _ok, _reason = _pg.check(p)
            if not _ok:
                self._send_json({'ok': False, 'err': _reason}, 400)
                return
            # 项目外路径已自动放行并记录日志（_reason='auto'），不再弹确认对话框
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
 
