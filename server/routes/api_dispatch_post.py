# -*- coding: utf-8 -*-
"""Mixin: POST 分发（自动拆分自 mixin_dispatch.py，方法体未改动）"""
from routes._shared import *
from urllib.parse import urlparse, parse_qs
from routes.mixin_base import MixinBase
from routes.mixin_download import MixinDownload
from routes.mixin_share import ShareRoutesMixin


from routes.api_dispatch_post_extra import MixinDispatchPostExtra


class MixinDispatchPost(ShareRoutesMixin, MixinDispatchPostExtra, MixinDownload, MixinBase):
    # ===== 🧬 记忆大师：跨版本记忆导入 =====
    def _handle_memory_import(self):
        import memory_import
        try:
            body = self._read_body()
        except Exception:
            body = {}
        path = self.path.split('?')[0]
        if path == '/api/memory/import/candidates':
            self._send_json(memory_import.list_candidates())
            return
        if path == '/api/memory/import/scan':
            src = str(body.get('src') or '')
            self._send_json(memory_import.scan_import(src))
            return
        if path == '/api/memory/import/run':
            src = str(body.get('src') or '')
            self._send_json(memory_import.run_import(src))
            return

    # ===== 多线程下载器 =====
    def _route_download_post(self):
        path = self.path.split('?')[0]
        if path == '/api/download/start':
            self._handle_download_start()
            return True
        if path == '/api/download/cancel':
            self._handle_download_cancel()
            return True
        return False

    # ===== 蜂群：对话内并发子任务派发（/api/swarm/*）=====
    def _handle_swarm_post(self):
        import json as _json
        import dispatch_swarm as swarm
        path = self.path.split('?')[0]
        try:
            body = self._read_body()
        except Exception:
            body = {}
        try:
            if path == '/api/swarm/submit':
                tasks = body.get('tasks')
                if not isinstance(tasks, list) or not tasks:
                    self._send_json({'ok': False, 'err': 'tasks 不能为空'})
                    return
                batch_id = swarm.submit(tasks,
                                        model_name=body.get('model') or None,
                                        shared_context=str(body.get('context') or ''))
                self._send_json({'ok': True, 'batch_id': batch_id})
                return
            if path == '/api/swarm/status':
                batch_id = str(body.get('batch_id') or '')
                st = swarm.status(batch_id)
                if st is None:
                    self._send_json({'ok': False, 'err': '批次不存在: ' + batch_id}, 404)
                    return
                self._send_json({'ok': True, 'batch': st})
                return
            if path == '/api/swarm/collect':
                batch_id = str(body.get('batch_id') or '')
                wait = bool(body.get('wait', True))
                if wait:
                    try:
                        timeout = float(body.get('timeout', 600))
                    except (TypeError, ValueError):
                        timeout = 600.0
                    st = swarm.collect(batch_id, wait_sec=timeout)
                else:
                    st = swarm.status(batch_id)
                if st is None:
                    self._send_json({'ok': False, 'err': '批次不存在: ' + batch_id}, 404)
                    return
                self._send_json({'ok': True, 'batch': st})
                return
            if path == '/api/swarm/list':
                self._send_json({'ok': True, 'batches': swarm.list_batches()})
                return
            self._send_json({'ok': False, 'err': '未知蜂群接口: ' + path}, 404)
        except Exception as e:
            try:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            except Exception:
                pass

    # ===== 游戏存档 POST /api/save：{key, data} 落 SQLite（server/data/game_saves.db） =====
    def _handle_game_save_post(self):
        try:
            body = self._read_body()
            key = str(body.get('key', '') or '').strip()
            data = body.get('data')
            if not key or data is None:
                self._send_json({'ok': False, 'err': '需要 key 和 data'})
                return
            import json as _json, sqlite3
            db_dir = os.path.join(BASE_DIR, 'data')
            os.makedirs(db_dir, exist_ok=True)
            conn = sqlite3.connect(os.path.join(db_dir, 'game_saves.db'), timeout=30)
            conn.execute('PRAGMA busy_timeout=30000')
            try:
                conn.execute('CREATE TABLE IF NOT EXISTS saves (key TEXT PRIMARY KEY, data TEXT, updated REAL)')
                conn.execute('INSERT OR REPLACE INTO saves (key, data, updated) VALUES (?,?,?)',
                             (key, _json.dumps(data, ensure_ascii=False), time.time()))
                conn.commit()
            finally:
                conn.close()
            self._send_json({'ok': True})
        except Exception as e:
            try:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            except Exception:
                pass

    def _handle_engine2d_console_report(self):
        """接收 engine2d 页面 devconsole 上报的报错，落盘到 private/engine2d-console.log"""
        try:
            body = self._read_body()
        except Exception:
            body = {}
        logs = body.get('logs') or []
        if not isinstance(logs, list):
            logs = []
        try:
            from datetime import datetime
            log_dir = os.path.join(BASE_DIR, 'private')
            os.makedirs(log_dir, exist_ok=True)
            log_path = os.path.join(log_dir, 'engine2d-console.log')
            with open(log_path, 'a', encoding='utf-8') as f:
                for item in logs[-100:]:
                    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                    text = str(item.get('text', item.get('msg', ''))).replace('\n', ' | ')
                    f.write(ts + ' [' + str(item.get('type', item.get('level', 'log'))) + '] ' +
                            str(item.get('page', '')) + ' :: ' + text + '\n')
            self._send_json({'ok': True, 'saved': len(logs)})
        except Exception as e:
            try:
                self._send_json({'ok': False, 'error': str(e)}, 500)
            except Exception:
                pass

    def _handle_perf_log_post(self):
        """接收前端性能埋点数据，写入 logs/perf_log.csv"""
        import os, time as _t
        try:
            # perf 前端上报的是 CSV 文本，不能用 _read_body()（其内部 json.loads 会抛异常）
            raw = getattr(self, '_cached_raw_body', None)
            if raw is None:
                length = int(self.headers.get('Content-Length', 0) or 0)
                raw = self.rfile.read(length) if length > 0 else b''
            if isinstance(raw, bytes):
                raw = raw.decode('utf-8', 'ignore')
            body = raw or ''
            rows = body.split('\n')
            log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'logs')
            os.makedirs(log_dir, exist_ok=True)
            log_path = os.path.join(log_dir, 'perf_log.csv')
            # 日志只保留最近 1 天：写入前顺手清理过期行（跨过一天才触发一次全量重写）
            try:
                today = _t.strftime('%Y-%m-%d')
                marker_path = log_path + '.day'
                last_day = ''
                if os.path.exists(marker_path):
                    with open(marker_path, 'r', encoding='utf-8') as mf:
                        last_day = mf.read().strip()
                if last_day != today:
                    if os.path.exists(log_path):
                        keep = []
                        cutoff = _t.time() - 86400  # 24 小时前
                        with open(log_path, 'r', encoding='utf-8') as rf:
                            for line in rf:
                                try:
                                    ts = _t.mktime(_t.strptime(line[:19], '%Y-%m-%d %H:%M:%S'))
                                except Exception:
                                    ts = _t.time()  # 无法解析的行视为新数据保留
                                if ts >= cutoff:
                                    keep.append(line)
                        with open(log_path, 'w', encoding='utf-8') as wf:
                            wf.writelines(keep)
                    with open(marker_path, 'w', encoding='utf-8') as mf:
                        mf.write(today)
            except Exception:
                pass  # 清理失败不影响正常记录
            with open(log_path, 'a', encoding='utf-8') as f:
                for r in rows:
                    r = r.strip()
                    if r:
                        f.write(_t.strftime('%Y-%m-%d %H:%M:%S,') + r + '\n')
            self._send_json({'ok': True, 'written': len(rows)})
        except Exception as e:
            try:
                self._send_json({'ok': False, 'error': str(e)}, 500)
            except Exception:
                pass

    def do_POST(self):
        # keep-alive 防线：入口先排干请求体，防止某些 handler 不读 body
        # 直接返回响应时，残留字节污染下一个请求（501 "Unsupported method ('{}GET')"）。
        self._drain_body()
        # 安全：拦截恶意网页的跨站写请求（CSRF）
        # 注意：此处早退时请求体尚未读掉，若复用 keep-alive 连接，
        # 残留 body 会污染下一个请求（报 501 "Unsupported method ('{}GET')"），
        # 因此拦截后直接标记关闭连接。
        if not self._check_origin():
            self.close_connection = True
            return
        # 安全：token 认证（默认关闭不影响使用）
        from security import check_request_token
        if not check_request_token(self):
            self.close_connection = True
            return
        parsed = urlparse(self.path)
        path = parsed.path

        # ===== 删除缓冲垃圾箱（恢复/强制删除/清空/过期清理） =====
        # ===== 图片工作台：AI 图片工具注册表 / 执行 =====
        if path == '/api/workbench/tools':
            self._handle_wb_tools_list()
            return
        if path == '/api/workbench/tools/apply':
            self._handle_wb_tools_apply(self._read_body())
            return

        # ===== 路径守卫：放行对话框（用户确认项目外路径的读/写） =====
        if path == '/api/pathguard/approve':
            body = self._read_body() or {}
            from tools.coding.backend import _pathguard as _pg
            r = _pg.approve(body.get('path', ''), bool(body.get('permanent')))
            self._send_json({'ok': True, 'result': r})
            return
        if path == '/api/pathguard/revoke':
            body = self._read_body() or {}
            from tools.coding.backend import _pathguard as _pg
            r = _pg.revoke(body.get('path'))
            self._send_json({'ok': True, 'result': r})
            return

        # ===== 图片工作台：状态持久化 =====
        if path == '/api/workbench/state':
            self._handle_wb_state_post(self._read_body())
            return

        # ===== 前端性能监控上报（FPS 排查） =====
        if path == '/api/perf-log':
            self._handle_perf_log_post()
            return

        # ===== 浏览器关闭通知（sendBeacon，页面卸载时也能送达）=====
        # 前端 beforeunload 触发；服务端记录浏览器关闭事件，供运维排查参考
        if path == '/api/agent/browser-closing':
            try:
                _log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'private')
                os.makedirs(_log_dir, exist_ok=True)
                with open(os.path.join(_log_dir, 'browser_close.log'), 'a', encoding='utf-8') as _f:
                    import time as _t
                    _f.write(_t.strftime('%m-%d %H:%M:%S') + ' browser closing (beacon)\n')
            except OSError:
                pass
            self._send_json({'ok': True})
            return

        # ===== Agent 双协议/挡位配置（保存） =====
        if path == '/api/agent/protocol':
            self._handle_agent_protocol_post()
            return

        # ===== 监督师开关（保存） =====
        # ===== 密码库（保存/删除） =====
        if path.startswith('/api/vault/'):
            self._handle_vault_post(self._read_body())
            return

        if path == '/api/supervisor':
            self._handle_supervisor_post()
            return

        # ===== Agent 双协议：endpoint 探测（读缓存/指定 URL 探测） =====
        if path == '/api/agent/protocol/probe':
            self._handle_agent_protocol_probe()
            return

        # ===== 主脑：人工对话 / 控制 / 手动总结 =====
        # ===== 电脑管家（替代做梦系统） =====
        # ===== 角色数据库：注入角色 / 角色面板 CRUD =====
        if path == '/api/roles':
            self._handle_roles_post()
            return

        # ===== 管家团记录/档案写入（role 参数缺省=健康师） =====
        if path == '/api/butler/record':
            try:
                import butler_store as _bs
                text = str((body or {}).get('text') or '')
                _role = str((body or {}).get('role') or '健康师')
                updates, hits = _bs.record_from_text(text, role=_role)
                self._send_json({'ok': True, 'updates': updates, 'hits': hits})
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            return
        if path == '/api/butler/profile':
            try:
                import butler_store as _bs
                _bs.save_profile((body or {}).get('profile') or {},
                                 role=str((body or {}).get('role') or '健康师'))
                self._send_json({'ok': True})
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            return
        if path == '/api/brain/chat':
            self._handle_brain_chat()
            return
        if path == '/api/brain/control':
            self._handle_brain_control()
            return
        if path == '/api/brain/summary':
            self._handle_brain_summary()
            return

        if path == '/api/cleanup/speed':
            from routes.mixin_cleanup import handle_cleanup_speed
            handle_cleanup_speed(self, do_run=True)
            return
        if path == '/api/cleanup/step':
            from routes.mixin_cleanup import handle_cleanup_step
            _q = parse_qs(urlparse(self.path).query)
            handle_cleanup_step(self, do_run=True, key=(_q.get('key') or [''])[0])
            return
        if path == '/api/trash/op':
            self._handle_trash_op()
            return

        # ===== 健康守护配置 =====
        if path == '/api/health/config':
            self._handle_health_config_post()
            return

        # 健康守卫多实例冷却锁（抢到锁的实例才弹窗+语音）
        if path == '/api/health/remind':
            self._handle_health_remind()
            return

        # 健康守护数据库持久化
        if path == '/api/health/heartbeat':
            self._handle_health_heartbeat()
            return
        if path == '/api/health/event':
            self._handle_health_event()
            return

        # ===== 在线升级：手动检查/手动升级 =====
        if path == '/api/updater/check':
            self._handle_updater_check_post()
            return
        if path == '/api/updater/apply':
            self._handle_updater_apply()
            return
        if path == '/api/updater/config':
            self._handle_updater_config_post()
            return
        if path == '/api/updater/restore_stash':
            self._handle_updater_restore_stash()
            return

        # ===== 一键重启后台服务器 =====
        if path == '/api/restart_server':
            self._handle_restart_server()
            return

        # ===== 网络守护状态 =====
        if path == '/api/network_guard':
            self._handle_network_guard()
            return

        # ===== 备用版本：手动触发升级流程（拉起备用+写修复请求） =====
        if path == '/api/backup_version/escalate':
            self._handle_backup_escalate()
            return

        # ===== 备用版本：修复请求应答（备用版本智能体回传结果） =====
        if path == '/api/backup_version/repair_ack':
            self._handle_backup_repair_ack()
            return

        # ===== 游戏引擎页面报错上报（devconsole.js） =====
        if path == '/api/engine2d/console-report':
            self._handle_engine2d_console_report()
            return

        # ===== 画布玩偶 TTS =====
        if path == '/api/avatar/tts':
            self._handle_avatar_tts(body=self._read_body())
            return

        # ===== 游戏存档系统（engine2d core.js 双通道：JSON 本地 + SQLite 服务端） =====
        if path == '/api/save':
            self._handle_game_save_post()
            return

        # ===== 真沙箱：状态查询 / 档位设置 =====
        if path == '/api/sandbox/status':
            from engines.common.sandbox import sandbox_status
            self._send_json({'ok': True, **sandbox_status()})
            return
        if path == '/api/sandbox/set':
            from engines.common.sandbox import set_config, sandbox_status
            try:
                body = self._read_body()
            except Exception:
                body = {}
            ok, msg = set_config(mode=body.get('mode'),
                                 mem_mb=body.get('mem_mb') if isinstance(body.get('mem_mb'), int) else None)
            self._send_json({'ok': ok, 'msg': msg, **({'status': sandbox_status()} if ok else {})})
            return

        # ===== 蜂群：对话内并发子任务派发 =====
        if path == '/api/swarm/submit':
            self._handle_swarm_post()
            return
        if path == '/api/swarm/status':
            self._handle_swarm_post()
            return
        if path == '/api/swarm/collect':
            self._handle_swarm_post()
            return

        if path == '/api/swarm/list':
            self._handle_swarm_post()
            return

        # ===== 🧬 记忆大师：跨版本记忆导入（/api/memory/import/*） =====
        if path in ('/api/memory/import/candidates', '/api/memory/import/scan', '/api/memory/import/run'):
            self._handle_memory_import()
            return

        # ===== 多线程下载器（/api/download/*） =====
        if self._route_download_post():
            return

        # ===== 可选组件下载（设置面板）：状态检测 / 安装 / 日志 =====
        if path == '/api/components/install':
            self._handle_components_install()
            return
        if path == '/api/components/status':
            self._handle_components_status()
            return
        if path == '/api/components/log':
            self._handle_components_log()
            return
        if path == '/api/components/progress':
            self._handle_components_progress()
            return

        # ===== 插件中心：总览统计 / 白名单清理 =====
        if path == '/api/plugins/center/status':
            self._handle_plugins_center_status()
            return
        if path == '/api/plugins/center/clean':
            self._handle_plugins_center_clean()
            return
        # ===== 按需插件：状态 / 安装 / 卸载 =====
        if path == '/api/plugins/ondemand/status':
            self._handle_plugins_ondemand_status()
            return
        if path == '/api/plugins/ondemand/install':
            self._handle_plugins_ondemand_install()
            return
        if path == '/api/plugins/ondemand/uninstall':
            self._handle_plugins_ondemand_uninstall()
            return

        # ===== 可选插件（录音/录像依赖）：状态查询 / 安装 =====
        if path == '/api/plugins/audio-video/install':
            self._handle_plugin_install()
            return
        if path == '/api/plugins/audio-video/status':
            self._handle_plugin_status()
            return

        # ===== 大模型统一配置 =====
        if path == '/api/models/config':
            self._handle_models_config_post()
            return

        # ===== 3D 模型生成（Tripo 等代理） =====
        if path == '/api/models/3d/generate':
            from mixin_models_3d import handle_3d_generate
            handle_3d_generate(self)
            return

        # ===== 模型配置管家：独立长期记忆（POST 写，config_agent_memory 表） =====
        if path == '/api/config-agent/memory':
            self._handle_config_agent_memory_post()
            return

        # ===== API 代理（解决 CORS）=====
        if path == '/api/proxy':
            self._handle_proxy()
            return

        # ===== 真实流式代理：透传上游 SSE 到浏览器（逐块 flush）=====
        # ===== 对话串行管理器控制（独立面板 /gate-panel.html） =====
        if path == '/api/gate/control':
            self._handle_gate_control()
            return

        if path == '/api/proxy_stream':
            self._handle_proxy_stream()
            return

        # ===== 对话池（chat_pool v1.0）：托管发起 + 停止（前端 db.js 探测开关后走这里）=====
        if path == '/api/chat-pool/chat':
            self._handle_chat_pool_chat()
            return
        if path.startswith('/api/chat-pool/slot/') and path.endswith('/cancel'):
            self._handle_chat_pool_cancel()
            return
        if path.startswith('/api/chat-pool/slot/') and path.endswith('/discard'):
            self._handle_chat_pool_discard()
            return

        # ===== 扩展子系统（MCP / Declarative UI / Skills，独立模块） =====
        if path == '/api/ext/skills/prompt':
            from extensions import skills as _ext_skills
            _ext_skills.handle(self, 'GET', ['prompt'], {})
            return
        # 注意：这里不要拦截其余 /api/ext/* POST —— 统一走下方 POST 分发（带真实 body），
        # 否则 settings / mcp call 等写入接口会被误判为 GET 而静默失效。

        # ===== 基础工具：读取 / 写入 / 运行 =====
        if path.startswith('/api/tools/'):
            self._handle_tools_post(path)
            return

        # ===== 共享空间（/api/share/*，POST：上传/配置/索引发布） =====
        if path.startswith('/api/share'):
            self.route_share()
            return

        # ===== 内置浏览器同域代理（POST：表单/接口透传） =====
        if path == '/api/webproxy':
            self._handle_webproxy('POST')
            return

        # ===== 内置浏览器（Playwright 持久化会话） =====
        if path == '/api/browser':
            self._handle_browser_post(self._read_body())
            return

        # ===== 网址安全探测（浏览器节点 🛡 按钮） =====
        if path == '/api/webrecon':
            self._handle_webrecon_post(self._read_body())
            return

        # ===== 扩展子系统 POST 分发（/api/ext/*） =====
        if path.startswith('/api/ext/'):
            try:
                body = self._read_body()
            except Exception:
                body = {}
            from extensions import dispatch as _ext_dispatch
            _ext_dispatch(self, 'POST', path, body)
            return

        # ===== 在线朗读（edge-tts 后端代理：返回 mp3）=====
        if path == '/api/tts':
            self._handle_tts()
            return

        # ===== 免费生图（暂未开放，保留 image_gen 模块供后续恢复）=====
        if path == '/api/image-gen':
            try:
        # ===== 免费生图（暂未开放，保留 image_gen 模块供后续恢复）=====
                if action == 'status':
                    from tools import get_handler
                    from tools.coding.backend.base import ToolContext
                    _mod = get_handler('image_gen')
                    _status = {}
                    class _StatusCap(ToolContext):
                        def send_json(self, obj, *a, **kw):
                            _status.update(obj or {})
                    _mod.handle({'action': 'status'}, _StatusCap(self))
                    self._send_json({'ok': True, 'data': {'channels': [], 'providers': _status.get('providers', {}), 'total_today': 0, 'hint': '视觉模型与免费渠道已接入'}})
                    return
                elif action in ('set_key', 'clear_key'):
                    self._send_json({'ok': False, 'data': {'error': '请通过模型配置管理视觉模型密钥'}})
                    return
                else:
                    prompt = str(body.get('prompt', '') or '').strip()
                    if action == 'edit':
                        source_prompt = str(body.get('source_prompt', '') or '').strip()
                        instruction = str(body.get('instruction', '') or prompt).strip()
                        source_image = str(body.get('source_image', '') or body.get('image_url', '') or '').strip()
                        prompt = (source_prompt + '\n修改要求：' + instruction).strip() if source_prompt else instruction
                    if not prompt:
                        self._send_json({'ok': False, 'data': {'error': '请输入图片描述或修改要求'}}, 400)
                        return
                    from tools import get_handler
                    from tools.coding.backend.base import ToolContext as _TC
                    _mod = get_handler('image_gen')
                    _captured = {}
                    class _CtxCap(_TC):
                        def send_json(self, obj, *a, **kw):
                            _captured.update(obj or {})
                    _mod.handle({'action': 'generate', 'prompt': prompt,
                                 'size': body.get('size', '1024x1024'),
                                 'model': body.get('model') or None,
                                 'image_url': (body.get('source_image') if action == 'edit' else None) or None}, _CtxCap(self))
                    result = _captured
                    if result.get('url'):
                        self._send_json({'ok': True, 'data': {'tools': 'image_gen', 'images': [{'url': result.get('url')}], 'url': result.get('url'), 'provider': result.get('provider'), 'model': result.get('model'), 'channel': result.get('provider'), 'channel_name': result.get('provider'), 'size': result.get('size'), 'bytes': result.get('bytes', '')}})
                    else:
                        self._send_json({'ok': False, 'data': {'error': result.get('error', '图片生成失败')}})
            except Exception as e:
                self._send_json({'ok': False, 'data': {'error': str(e)}})
            return

        # ===== PPT 本地生成（python-pptx，零API费）=====
        if path == '/api/ppt-gen':
            try:
                from tools import get_handler
                from tools.coding.backend.base import ToolContext
                _mod = get_handler('ppt_gen')
                body = self._read_body()
                if body.get('action') == 'status':
                    class _StCap(ToolContext):
                        def send_json(self, obj, *a, **kw):
                            self._out = obj or {}
                    _c = _StCap(self)
                    _mod.handle({'action': 'status'}, _c)
                    self._send_json({'ok': True, 'data': getattr(_c, '_out', {})})
                    return
                class _PptCap(ToolContext):
                    def send_json(self, obj, *a, **kw):
                        self._out = obj or {}
                _c = _PptCap(self)
                _mod.handle(body, _c)
                _out = getattr(_c, '_out', {})
                if _out.get('ok'):
                    self._send_json({'ok': True, 'data': {'tools': 'ppt_gen', **_out.get('data', {})}})
                else:
                    self._send_json({'ok': False, 'data': {'error': _out.get('data', {}).get('error', 'PPT 生成失败')}})
            except Exception as e:
                self._send_json({'ok': False, 'data': {'error': str(e)}})
            return

        # ===== 视频生成（免费管线：文生图→ffmpeg 合成）=====
        if path == '/api/video-free-gen':
            try:
                from tools import get_handler
                from tools.coding.backend.base import ToolContext
                _mod = get_handler('video_gen')
                body = self._read_body()

                class _VCap(ToolContext):
                    def __init__(self, *a, **k):
                        self._out = {}
                    def send_json(self, obj, *a, **kw):
                        self._out = obj or {}

                _c = _VCap(self)
                _mod.handle(body, _c)
                _out = getattr(_c, '_out', {})
                if _out.get('ok'):
                    self._send_json({'ok': True, 'data': {'tools': 'video_gen', **_out.get('data', {})}})
                else:
                    self._send_json({'ok': False, 'data': {'error': _out.get('data', {}).get('error', '视频生成失败')}})
            except Exception as e:
                self._send_json({'ok': False, 'data': {'error': str(e)}})
            return

        # ===== 3D 模型生成（云端优先，本地占位 GLB 兜底）=====
        if path == '/api/model3d':
            try:
                from tools import get_handler
                from tools.coding.backend.base import ToolContext
                _mod = get_handler('model3d_gen')
                body = self._read_body()

                class _M3Cap(ToolContext):
                    def __init__(self, *a, **k):
                        self._out = {}
                    def send_json(self, obj, *a, **kw):
                        self._out = obj or {}

                _c = _M3Cap(self)
                _mod.handle(body, _c)
                _out = getattr(_c, '_out', {})
                if _out.get('ok'):
                    self._send_json({'ok': True, 'data': {'tools': 'model3d_gen', **_out.get('data', {})}})
                else:
                    self._send_json({'ok': False, 'data': {'error': _out.get('data', {}).get('error', '3D 生成失败')}})
            except Exception as e:
                self._send_json({'ok': False, 'data': {'error': str(e)}})
            return

        # ===== AI 导演台：一句话 → 分镜 → 逐镜生成 → 成片 =====
        if path == '/api/video-director':
            try:
                _srv_video = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'video')
                if _srv_video not in sys.path:
                    sys.path.insert(0, _srv_video)
                import director_ai as _director
                _body = self._read_body()
                self._send_json({'ok': True, 'data': _director.handle(_body)})
            except Exception as e:
                self._send_json({'ok': False, 'data': {'error': str(e)}})
            return

        if path == '/api/video-gen':
            try:
                _tool_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'tools')
                if _tool_dir not in sys.path:
                    sys.path.insert(0, _tool_dir)
                import video_gen_engine as _vgen
                body = self._read_body()
                act = body.get('action', 'generate')
                if act == 'status':
                    self._send_json({'ok': True, 'data': _vgen.video_status()})
                else:
                    r = _vgen.generate_video(
                        body.get('prompt', ''),
                        key=body.get('key', '') or '',
                        size=body.get('size', '832x480'),
                        duration=body.get('duration') or 5,
                        model=body.get('model', ''),
                        negative_prompt=body.get('negative_prompt', '') or '',
                        seed=body.get('seed'),
                        image_url=body.get('image_url', '') or '')
                    # 统一返回格式（含 videos 数组，兼容前端画布节点）
                    if r.get('ok'):
                        self._send_json({
                            'ok': True,
                            'data': {
                                'tools': 'video_gen',
                                'videos': (r.get('videos') or ([{'url': r.get('url'), 'provider': r.get('provider', ''), 'task_id': r.get('task_id', '')}] if r.get('url') else [])),

                                'model': r.get('model'),
                                'duration': r.get('duration'),
                                'provider': r.get('provider')
                            }
                        })
                    else:
                        self._send_json({'ok': False, 'data': {'error': r.get('error', '\u89c6\u9891\u751f\u6210\u5931\u8d25'),
                                                                  'provider': r.get('provider')}})
            except Exception as e:
                self._send_json({'ok': False, 'data': {'error': str(e)}})
            return


        # ===== 璁颁綇鐢ㄦ埛鏈€鍚庝娇鐢ㄧ殑澶фā鍨嬶紙鍓嶇姣忔鍙戞秷鎭椂涓婃姤锛?====
        if path == '/api/chat/report-model':
            self._handle_report_last_model()
            return
        if path == '/api/chat/last-model':
            self._handle_report_last_model()
            return

        # ===== Conversation loop mode config (POST write) =====
        if path == '/api/loop-mode-config':
            self._handle_loop_mode_config_post()
            return

        # ===== 协作施工队（Crew 模式，/api/crew/*，独立于赛马两条线） =====
        if path.startswith('/api/crew/'):
            import sys as _sys2, os as _os2
            _srv2 = _os2.path.dirname(_os2.path.dirname(_os2.path.abspath(__file__)))
            if _srv2 not in _sys2.path:
                _sys2.path.insert(0, _srv2)
            from engines.common.crew_board import (crew_create, crew_board_get, crew_claim,
                                                   crew_done, crew_bus_post, crew_bus_tail, crew_close,
                                                   crew_slices_upsert, crew_force_release)
            body = self._read_body() or {}
            # 注入请求真实基地址（含本机实际监听端口），供 board 返回 api_base 自描述
            try:
                _host = self.headers.get('Host') or ''
                if _host:
                    body['_api_base'] = 'http://' + _host
            except Exception:
                pass
            # 【长期目标·v29】路由层兜底注入 _goal_md（private/计划书 最新一份），
            # 但黑板里存有用户任务指定的 task_md 时必须让位（见 crew_board_get），
            # 防止施工窗被指到私有文件夹的旧策划案而不是本次对话指定的 md。
            try:
                import os as _osg
                _proj_root = _os2.path.dirname(_srv2)
                _goal_path = _os2.path.join(_proj_root, 'private', '计划书')
                if _osg.path.isdir(_goal_path):
                    _goals = sorted(f for f in _osg.listdir(_goal_path) if f.endswith('.md'))
                    if _goals:
                        body['_goal_md'] = _os2.path.join(_goal_path, _goals[-1])
            except Exception:
                pass
            _cm = {'/api/crew/create': crew_create,
                   '/api/crew/slices-upsert': crew_slices_upsert,
                   '/api/crew/board': crew_board_get,
                   '/api/crew/claim': crew_claim,
                   '/api/crew/done': crew_done,
                   '/api/crew/bus-post': crew_bus_post,
                   '/api/crew/bus-tail': crew_bus_tail,
                   '/api/crew/close': crew_close,
                   '/api/crew/force-release': crew_force_release}
            # 【总指挥】管家调度接口：ready 扫描+派发标记、status 看板
            if path in ('/api/crew/butler-scan', '/api/crew/butler-status', '/api/crew/butler-reclaim'):
                try:
                    import engines.common.butler_conductor as _butler
                    if path == '/api/crew/butler-scan':
                        sc = _butler.self_check()
                        if not sc.get('ok'):
                            self._send_json({'ok': False, 'error': '路径自检失败(总指挥与黑板目录错位)，已阻止派发', 'self_check': sc})
                            return
                        real = bool(body.get('real'))
                        def _hook(crew_id, slice_obj, model):
                            import dispatch_swarm as _swarm
                            goal = '[施工队:%s/分片:%s] %s' % (crew_id, slice_obj.get('id'), slice_obj.get('title') or '')
                            ctx = '分片简介：%s\n认领方式：POST /api/crew/claim {crew_id:%s, slice_id:%s}\n完成后：POST /api/crew/done' % (
                                slice_obj.get('brief') or '', crew_id, slice_obj.get('id'))
                            batch_id = _swarm.submit([{'goal': goal, 'context': ctx, 'track': 'auto'}],
                                                     model_name=model)
                            try:
                                _butler.attach_batch(crew_id, slice_obj.get('id'), batch_id)
                            except Exception:
                                pass
                            return {'batch_id': batch_id}
                        self._send_json({'ok': True, 'self_check': sc,
                                         'results': _butler.scan_all(dispatch_hook=_hook if real else None,
                                                                     real=real)})
                    elif path == '/api/crew/butler-reclaim':
                        self._send_json({'ok': True, 'result': _butler.reclaim_stale(body.get('crew_id'))})
                    else:
                        self._send_json(_butler.status(body.get('crew_id')))
                except Exception as _be:
                    import traceback as _tb3
                    self._send_json({'ok': False, 'error': 'butler 异常: %r' % _be,
                                     'traceback': _tb3.format_exc()})
                return
            h = _cm.get(path)
            if h:
                try:
                    self._send_json(h(body))
                except Exception as _crew_e:
                    import traceback as _tb2
                    _tb2.print_exc()
                    try:
                        self._send_json({'ok': False, 'error': 'crew 接口异常: %r' % _crew_e,
                                         'traceback': _tb2.format_exc()})
                    except Exception:
                        pass
            else:
                self._send_json({'ok': False, 'error': '未知协作操作: ' + path})
            return

        # ===== zf3d 路由（POST）：登录/签到/心跳配置 =====
        if path == '/api/zf3d/login':
            self._handle_zf3d_login()
            return
        if path == '/api/zf3d/relay-proxy':
            self._handle_zf_relay_proxy()
            return
        # 【修复】原条件 '/api/git/branch/' 漏掉赛马接口（/api/git/race/*、/api/git/race-window-*），
        # 导致施工队建窗全部 404「Unknown path」。放宽到 /api/git/ 前缀。
        if path.startswith('/api/git/'):
            import sys as _sys, os as _os
            _srv = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
            if _srv not in _sys.path:
                _sys.path.insert(0, _srv)
            import git_branch_api as _gb
            body = self._read_body() or {}
            if path == '/api/git/functional-commit':
                self._send_json(_gb.handle_functional_commit(body))
            elif path.startswith('/api/git/race'):
                try:
                    _rm = {'/api/git/race/worktree-add': getattr(_gb, 'race_worktree_add', None),
                           '/api/git/race/worktree-list': getattr(_gb, 'race_worktree_list', None),
                           '/api/git/race/worktree-remove': getattr(_gb, 'race_worktree_remove', None),
                           '/api/git/race/diff-summary': getattr(_gb, 'race_diff_summary', None),
                           '/api/git/race/worktree-health': getattr(_gb, 'race_worktree_health', None),
                           '/api/git/race-window-register': getattr(_gb, 'race_window_register', None),
                           '/api/git/race-window-unregister': getattr(_gb, 'race_window_unregister', None)}
                    h = _rm.get(path)
                    if path not in _rm:
                        self._send_json({'ok': False, 'error': '未知赛马操作: ' + path})
                    elif h is None or not callable(h):
                        # 模块里缺该函数（旧版 git_branch_api 被缓存）：明确报错而不是裸崩断连
                        self._send_json({'ok': False,
                                         'error': 'git_branch_api 模块缺少函数 %s（服务加载的是旧版模块，请重启服务）' % path})
                    else:
                        self._send_json(h(body))
                except Exception as _race_e:
                    import traceback as _tb
                    _tb.print_exc()
                    try:
                        self._send_json({'ok': False, 'error': 'race 接口异常: %r' % _race_e,
                                         'traceback': _tb.format_exc()})
                    except Exception:
                        pass
            elif path == '/api/git/branch/merge':
                self._send_json(_gb.handle_branch_merge(body))
            elif path == '/api/git/branch/checkout':
                self._send_json(_gb.handle_branch_checkout(body))
            elif path == '/api/git/branch/create':
                self._send_json(_gb.handle_branch_create(body))
            elif path == '/api/git/branch/delete':
                self._send_json(_gb.handle_branch_delete(body))
            else:
                self._send_json({'ok': False, 'error': '未知分支操作: ' + path})
            return
        if path == '/api/zf3d/checkin':
            self._handle_zf3d_checkin()
            return
        if path == '/api/zf3d/heartbeat-config':
            self._handle_zf3d_heartbeat_config()
            return
        if path == '/api/zf3d/site-config':
            self._handle_zf3d_site_config()

        if path == '/api/zf3d/ai-channels':
            # 朱峰模型 · 保存识图/生图通道费率与配置（站长后台用）
            import zf_channel_config
            body = self._read_json_body() if hasattr(self, '_read_json_body') else {}
            if not isinstance(body, dict) or not body:
                try:
                    import json as _json
                    ln = int(self.headers.get('Content-Length') or 0)
                    raw = self.rfile.read(ln) if ln else b'{}'
                    body = _json.loads(raw.decode('utf-8', errors='replace') or '{}')
                except Exception:
                    body = {}
            zf_channel_config.save_channels(body.get('channels') or {})
            self._send_json({'ok': True, 'channels': zf_channel_config.load_channels(False),
                             'rates_ready': {
                                 'vision': zf_channel_config.rates_ready('vision'),
                                 'imagegen': zf_channel_config.rates_ready('imagegen')}})
            return

        # ===== zf3d 兜底（POST，未识别路径）：读取并丢弃请求体，避免残留体污染 keep-alive 连接 =====
        if path.startswith('/api/zf3d/'):
            try:
                self._read_body()
            except Exception:
                pass
            self._send_json({'ok': False, 'error': 'zf3d module removed'}, 200)
            return

        # ===== Chat mode restriction rules (POST write, private/chat_mode_rules.json) =====
        if path == '/api/chat-mode-rules':
            self._handle_chat_mode_rules_post()
            return

        # ===== Tool result exit limits (POST write, private/tool_result_limits.json) =====
        if path == '/api/tools-result-limits':
            self._handle_tool_result_limits_post()
            return

        # ===== 用户设置（POST 写，private/用户设置/user_settings.json） =====
        if path == '/api/user-settings':
            self._handle_user_settings_post()
            return

        # ===== 聊天附件暂存（POST 写，private/用户设置/chat_attachments.json，跨重启恢复待发附件） =====
        if path == '/api/chat-attachments':
            self._handle_chat_attachments_post()
            return

        # ===== 画布背景/特效配置（POST 写，独立 private/用户设置/background.json） =====
        if path == '/api/background':
            self._handle_background_post()
            return

        # ===== 用户习惯（POST 写，private/用户设置/user_preferences.json） =====
        if path == '/api/user-preferences':
            self._handle_user_preferences_post()
            return

        if path == '/api/hot-reload/reload':
            self._handle_hot_reload_manual()
            return

        # ===== 工作日志（POST 追加，private/用户设置/worklog.json）=====
        if path == '/api/worklog':
            self._handle_worklog_post()
            return

        # ===== AI 轻量自验收（git 双快照对比）=====
        if path == '/api/self-check/start':
            self._handle_self_check_start_post()
            return

        if path == '/api/self-check/finish':
            self._handle_self_check_finish_post()
            return

        # ===== 关联本地文件夹到项目 =====
        if path == '/api/project/link-folder':
            self._handle_link_folder()
            return

        # ===== 【项目上下文工具】选中文件内容预览 =====
        if path == '/api/project/context':
            self._handle_project_context()
            return

        # ===== 生成项目记忆 =====
        if path == '/api/project/memory/generate':
            self._handle_generate_project_memory()
            return

        # ===== 备份管理 =====
        if path == '/api/workspace/save':
            self._handle_workspace_save()
            return
        if path == '/api/app/restart':
            self._handle_app_restart()
            return
        if path == '/api/app/quit':
            self._handle_app_quit()
            return
        if path == '/api/backup/create':
            self._handle_backup_create()
            return
        if path == '/api/config/import':
            self._handle_config_import()
            return
        if path == '/api/backup/restore':
            self._handle_backup_restore()
            return

        # ===== 画布参考板：POST 保存（GET 分发里的 refboard-save 是给老调用方式兼容）=====
        if path == '/api/refboard-save':
            self._handle_refboard_save()
            return
        if path == '/api/refboard-load':
            self._handle_refboard_load()
            return
        # ===== 画布参考图媒体：上传（base64 → 持久文件） =====
        if path == '/api/refboard-media-save':
            self._handle_refboard_media_save()
            return

        # ===== 录音（系统音频/麦克风） =====
        if path == '/api/record-devices':
            self._handle_record_devices()
            return
        if path == '/api/record-start':
            self._handle_record_start()
            return
        if path == '/api/record-stop':
            self._handle_record_stop()
            return
        if path == '/api/record-status':
            self._handle_record_status()
            return
        if path == '/api/record-logs':
            self._handle_record_logs()
            return

        # ===== 录屏（ffmpeg gdigrab → MP4） =====
        if path == '/api/screenrecord-settings':
            self._handle_screenrecord_settings()
            return
        if path == '/api/screenrecord-devices':
            self._handle_screenrecord_devices()
            return
        if path == '/api/screenrecord-select-area':
            self._handle_screenrecord_select_area()
            return
        if path == '/api/screenrecord-start':
            self._handle_screenrecord_start()
            return
        if path == '/api/screenrecord-stop':
            self._handle_screenrecord_stop()
            return
        if path == '/api/screenrecord-status':
            self._handle_screenrecord_status()
            return
        if path == '/api/screenrecord-logs':
            self._handle_screenrecord_logs()
            return
        if path == '/api/screenrecord-log':
            self._handle_screenrecord_log()
            return
        if path == '/api/screenrecord-test-volume':
            self._handle_screenrecord_test_volume()
            return

        # ===== 对话拖拽出浏览器 → 直接弹出独立窗口（无缝衔接） =====
        if path == '/api/chatbox-pop':
            self._handle_chatbox_pop()
            return

        # ===== QQ 机器人 =====
        # ===== QQ 机器人：模块已移除，返回占位响应避免 AttributeError =====
        if path == '/api/qqbot/start':
            self._send_json({'ok': False, 'err': 'QQ机器人模块已移除'})
            return
        if path == '/api/qqbot/stop':
            self._send_json({'ok': True, 'removed': True})
            return
        if path == '/api/qqbot/autoreply':
            self._send_json({'ok': True, 'removed': True})
            return

        # ===== 文本文件保存（代码编辑器 Ctrl+S / 保存按钮） =====
        if path == '/api/fs/text-save':
            self._handle_fs_text_save()
            return

        # ===== 游戏场景存储（engine2d 场景编辑器） =====
        if path == '/api/scenes' or path.startswith('/api/scenes/'):
            self._handle_scenes_post(path)
            return

        # ===== HTML 演示工作台 API（写大纲/保存页面/保存演示） =====
        if path == '/api/demo/save':
            self._handle_demo_save()
            return

        # ===== 大模型表格/文档保存 API =====
        if path == '/api/sheets/save':
            self._handle_docs_save('sheets'); return
        if path == '/api/docs/save':
            self._handle_docs_save('docs'); return
        if path == '/api/minds/save':
            self._handle_docs_save('minds'); return
        if path == '/api/psds/save':
            self._handle_docs_save('psds'); return
        if path == '/api/boards/save':
            self._handle_docs_save('boards'); return

        # ===== 文件写操作（删除/移动/复制/重命名/新建文件夹）=====
        if path == '/api/fs/ops':
            self._handle_fs_ops(); return

        # ===== 格式转换 API（上传文件→自动转换；扫描收件箱） =====
        if path == '/api/convert/upload':
            self._handle_convert_upload(self._read_body()); return
        if path == '/api/convert/inbox/scan':
            self._handle_convert_scan(); return

        # ===== 安全重启后台（auto_revive --force：等 AI 代码可加载后再启动） =====
        if path == '/api/revive':
            self._handle_revive_backend()
            return

        # ===== FPS 守卫：低帧现场上报（前端 POST；此前只挂在 GET 分发导致 404） =====
        if path == '/api/fps-guard/report':
            self._handle_fps_guard_report()
            return

        if not path.startswith('/api/db/'):
            # 兜底 404 前必须读掉请求体，否则残留 body 会污染 keep-alive 连接，
            # 后续请求报 501 "Unsupported method ('{...}POST')"
            try:
                self._read_body()
            except Exception:
                try: self.close_connection = True
                except Exception: pass
            self._send_error('Unknown path: ' + path, 404)
            return

        parts = path[len('/api/db/'):].split('/')
        resource = parts[0] if parts else ''

        result = None
        conn = None
        try:
            body = self._read_body()
            now = int(__import__('time').time() * 1000)

            with _db_lock:
                conn = get_db()
                cur = conn.cursor()

                if resource == 'nodes' and len(parts) > 2 and parts[2] == 'project':
                    # POST /nodes/{id}/project 鈥?璁剧疆鑺傜偣鐨勯」鐩綊灞?
                    node_id = parts[1]
                    proj_id = body.get('projectId', None)
                    cur.execute('UPDATE canvas_nodes SET project_id=?, updated_at=? WHERE id=?', (proj_id, now, node_id))
                    conn.commit()
                    result = {'ok': True}

                elif resource == 'nodes':
                    node_id = body.get('id', 'n' + str(now))
                    cur.execute('''
                        INSERT OR REPLACE INTO canvas_nodes
                        (id, title, model_id, x, y, w, h, collapsed, z_index, scroll_pos, project_id, created_at, updated_at,
                         session_total_tokens, session_total_api_calls, session_total_duration,
                         session_total_prompt_tokens, session_total_completion_tokens,
                         session_total_cache_hit_tokens, session_total_cache_miss_tokens,
                         model_id_override, reasoning_effort, engine)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                                ?, ?, ?, ?, ?, ?, ?,
                                ?, ?, ?)
                    ''', (
                        node_id, body.get('title', ''), body.get('modelId', ''),
                        body.get('x', 0), body.get('y', 0),
                        body.get('w', 320), body.get('h', 420),
                        1 if body.get('collapsed') else 0,
                        body.get('z', 50),
                        body.get('scrollPos', 0),
                        body.get('projectId', None),
                        body.get('createdAt', now), now,
                        body.get('sessionTotalTokens', 0), body.get('sessionTotalApiCalls', 0),
                        body.get('sessionTotalDuration', 0), body.get('sessionTotalPromptTokens', 0),
                        body.get('sessionTotalCompletionTokens', 0),
                        body.get('sessionTotalCacheHitTokens', 0), body.get('sessionTotalCacheMissTokens', 0),
                        body.get('modelIdOverride', '') or '', body.get('reasoningEffort', '') or '',
                        body.get('engine', '') or ''
                    ))
                    conn.commit()
                    result = {'ok': True, 'id': node_id}

                elif resource == 'canvas' and len(parts) > 1 and parts[1] == 'view':
                    cur.execute('''
                        UPDATE canvas_view SET x=?, y=?, scale=?, updated_at=? WHERE id=1
                    ''', (body.get('x', 0), body.get('y', 0), body.get('scale', 1), now))
                    conn.commit()
                    result = {'ok': True}

                elif resource == 'kv':
                    key = body.get('key', '')
                    value = json.dumps(body.get('value'), ensure_ascii=False)
                    cur.execute('''
                        INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
                    ''', (key, value, now))
                    conn.commit()
                    result = {'ok': True}
                    # 活动项目被切换时，主动失效 shell_exec 的 cwd 兜底缓存，
                    # 使其无需每 5 秒查一次 DB 比对 active_project_id
                    if key == 'active_project_id':
                        try:
                            from engines.common import shell_exec
                            shell_exec.invalidate_cwd_cache()
                        except Exception:
                            pass

                elif resource == 'chat-history' and len(parts) > 1 and parts[1] == 'sessions':
                    # Existing installations may predate the archive table.
                    cur.execute('''
                        CREATE TABLE IF NOT EXISTS chat_history_archive (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            session_id TEXT NOT NULL,
                            session_name TEXT,
                            role TEXT,
                            content TEXT,
                            model_id TEXT,
                            created_at INTEGER
                        )
                    ''')
                    cur.execute("PRAGMA table_info(chat_history_archive)")
                    archive_columns = {row['name'] for row in cur.fetchall()}
                    if 'model_id' not in archive_columns:
                        cur.execute('ALTER TABLE chat_history_archive ADD COLUMN model_id TEXT')
                    cur.execute('''
                        SELECT session_id, session_name, role, content, model_id, created_at
                        FROM (
                            SELECT ch.session_id, COALESCE(s.name, ch.session_id) AS session_name,
                                   ch.role, ch.content, ch.model_id, ch.created_at
                            FROM chat_history ch
                            LEFT JOIN sessions s ON s.id = ch.session_id
                            WHERE ch.role = 'user'
                            UNION ALL
                            SELECT session_id, COALESCE(session_name, session_id) AS session_name,
                                   role, content, model_id, created_at
                            FROM chat_history_archive
                            WHERE role = 'user'
                        ) all_history
                        ORDER BY created_at DESC
                    ''')
                    result = {'ok': True, 'data': [dict(row) for row in cur.fetchall()]}

                elif resource == 'sessions':
                    sid = body.get('id', 's' + str(now))
                    cur.execute('''
                        INSERT OR REPLACE INTO sessions (id, name, created_at, updated_at)
                        VALUES (?, ?, ?, ?)
                    ''', (sid, body.get('name', ''), now, now))
                    conn.commit()
                    result = {'ok': True, 'id': sid}

                elif resource == 'projects' and len(parts) > 1:
                    # POST /projects/{id} 鈥?閲嶅懡鍚?
                    proj_id = parts[1]
                    new_name = body.get('name', '')
                    cur.execute('UPDATE projects SET name=?, updated_at=? WHERE id=?', (new_name, now, proj_id))
                    conn.commit()
                    result = {'ok': True}

                elif resource == 'projects':
                    proj_id = body.get('id', 'proj_' + str(now))
                    proj_name = body.get('name', '新项目')
                    cur.execute('''
                        INSERT OR REPLACE INTO projects (id, name, created_at, updated_at)
                        VALUES (?, ?, ?, ?)
                    ''', (proj_id, proj_name, now, now))
                    conn.commit()
                    result = {'ok': True, 'id': proj_id}

                elif resource == 'chat' and len(parts) > 1:
                    sid = parts[1]
                    parent_id = body.get('parentId', None)
                    # 支持客户端传入原始时间戳 ts（恢复已关闭对话时保留原时间，避免伪重复归档）
                    msg_ts = body.get('ts')
                    try:
                        if msg_ts is not None and int(msg_ts) > 0:
                            msg_ts = int(msg_ts)
                        else:
                            msg_ts = now
                    except (TypeError, ValueError):
                        msg_ts = now
                    cur.execute('''
                        INSERT INTO chat_history (session_id, role, content, model_id, created_at, parent_id)
                        VALUES (?, ?, ?, ?, ?, ?)
                    ''', (sid, body.get('role', 'user'), body.get('content', ''), body.get('modelId', ''), msg_ts, parent_id))
                    conn.commit()
                    result = {'ok': True, 'id': cur.lastrowid}

                elif resource == 'data' and len(parts) > 1:
                    category = parts[1]
                    key = body.get('key', '')
                    value = json.dumps(body.get('value'), ensure_ascii=False)
                    cur.execute('''
                        INSERT OR REPLACE INTO app_data (category, key, value, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                    ''', (category, key, value, now, now))
                    conn.commit()
                    result = {'ok': True}

                elif resource == 'app_data':
                    # POST /api/db/app_data - 鏀寔 action: delete (app-zf3d.js 閫€鍑虹櫥褰曟椂璋冪敤)
                    action = body.get('action', '')
                    filt = body.get('filter', {})
                    cat = filt.get('category', '')
                    if action == 'delete' and cat:
                        cur.execute('DELETE FROM app_data WHERE category=?', (cat,))
                        conn.commit()
                        result = {'ok': True, 'deleted': cur.rowcount}
                    elif action == 'delete' and len(parts) > 1:
                        cat = parts[1]
                        cur.execute('DELETE FROM app_data WHERE category=?', (cat,))
                        conn.commit()
                        result = {'ok': True, 'deleted': cur.rowcount}
                    else:
                        result = None  # 404

                elif resource == 'logs':
                    # 支持批量：body 带 logs 数组时一次性插入（前端 1s 批处理，减少请求数）
                    batch = body.get('logs')
                    if isinstance(batch, list) and batch:
                        rows = []
                        for item in batch[:200]:
                            if not isinstance(item, dict):
                                continue
                            rows.append((now, str(item.get('level', 'info')),
                                         str(item.get('boxId', '')),
                                         str(item.get('action', '')),
                                         str(item.get('detail', ''))))
                        if rows:
                            cur.executemany('''
                                INSERT INTO app_logs (ts, level, box_id, action, detail)
                                VALUES (?, ?, ?, ?, ?)
                            ''', rows)
                            conn.commit()
                        result = {'ok': True, 'saved': len(rows)}
                    else:
                        cur.execute('''
                            INSERT INTO app_logs (ts, level, box_id, action, detail)
                            VALUES (?, ?, ?, ?, ?)
                        ''', (now, body.get('level', 'info'), body.get('boxId', ''),
                              body.get('action', ''), body.get('detail', '')))
                        conn.commit()
                        result = {'ok': True, 'id': cur.lastrowid}

                elif resource == 'stats':
                    cur.execute('''
                        INSERT INTO task_stats (session_id, model_id, task_title, success, tokens_used, duration_ms, depth, api_calls, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        body.get('sessionId', ''),
                        body.get('modelId', ''),
                        body.get('taskTitle', ''),
                        1 if body.get('success') else 0,
                        body.get('tokensUsed', 0) or 0,
                        body.get('durationMs', 0) or 0,
                        body.get('depth', 0) or 0,
                        body.get('apiCalls', 0) or 0,
                        now
                    ))
                    conn.commit()
                    result = {'ok': True, 'id': cur.lastrowid}

                else:
                    result = None  # 404

                conn.close()
                conn = None
        except Exception as e:
            print(f'[POST /api/db] 500 閿欒: {e}')
            traceback.print_exc()
            if conn:
                try: conn.close()
                except Exception: pass
            self._send_error(str(e), 500)
            return

        # 连接已关闭，安全发送响应
        if result is not None:
            self._send_json(result)
        else:
            # 兜底 404：请求体已在 do_POST 入口被 _drain_body 排干并缓存，
            # 这里读缓存即可；不要再直接 rfile.read（排干后二次读会永久阻塞）。
            try:
                self._read_body()
            except Exception:
                try: self.close_connection = True
                except Exception: pass
            self._send_error('Unknown POST route: ' + path, 404)

    # ==================== 可选插件（录音/录像依赖） ====================
    # 插件包默认放在 <根目录>/plugins/audio-video-plugin，
    # 用户在设置面板点击"安装"后才复制到 python 运行目录生效。