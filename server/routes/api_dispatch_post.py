# -*- coding: utf-8 -*-
"""Mixin: POST 分发（自动拆分自 mixin_dispatch.py，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase


from routes.api_dispatch_post_extra import MixinDispatchPostExtra


class MixinDispatchPost(MixinDispatchPostExtra, MixinBase):
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

        # ===== 健康守护配置 =====
        if path == '/api/health/config':
            self._handle_health_config_post()
            return

        # ===== 派单池（命令行侧直接派小弟） =====
        if path == '/api/dispatch/pool':
            self._handle_dispatch_pool()
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

        # ===== 模型配置管家：独立长期记忆（POST 写，config_agent_memory 表） =====
        if path == '/api/config-agent/memory':
            self._handle_config_agent_memory_post()
            return

        # ===== API 代理（解决 CORS）=====
        if path == '/api/proxy':
            self._handle_proxy()
            return

        # ===== 真实流式代理：透传上游 SSE 到浏览器（逐块 flush）=====
        if path == '/api/proxy_stream':
            self._handle_proxy_stream()
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

        # ===== 任务记事本（主人专属任务中枢） =====
        if path == '/api/tasknotes':
            self._handle_tasknotes_post()
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
                body = self._read_body()
                action = body.get('action', 'generate')
                # 视觉模型联动：统一走 tools 注册表的 image_gen 后端（支持 models.json 中的 imageGen 模型）
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

        # ===== 鍏嶈垂鐢熷浘锛堟殏鏈紑鏀撅紝淇濈暀 image_gen 妯″潡渚涘悗缁仮澶嶏級 =====
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

        # ===== zf3d 路由（POST）：登录/签到/心跳配置 =====
        if path == '/api/zf3d/login':
            self._handle_zf3d_login()
            return
        if path == '/api/zf3d/checkin':
            self._handle_zf3d_checkin()
            return
        if path == '/api/zf3d/heartbeat-config':
            self._handle_zf3d_heartbeat_config()
            return
        if path == '/api/zf3d/site-config':
            self._handle_zf3d_site_config()
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

        # ===== 对话拖拽出浏览器 → 直接弹出独立窗口（无缝衔接） =====
        if path == '/api/chatbox-pop':
            self._handle_chatbox_pop()
            return

        # ===== 文本文件保存（代码编辑器 Ctrl+S / 保存按钮） =====
        if path == '/api/fs/text-save':
            self._handle_fs_text_save()
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

