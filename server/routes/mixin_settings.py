# -*- coding: utf-8 -*-
"""Mixin: 配置读写（自动拆分自 handler_routes.py，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinSettings(MixinBase):
    def _handle_health_config_get(self):
        defaults = {
            'intervalMinutes': 30,
            'graceMinutes': 10,
            'forceLockMinutes': 10,
        }
        try:
            with _HEALTH_CONFIG_LOCK:
                if os.path.exists(_HEALTH_CONFIG_PATH):
                    with open(_HEALTH_CONFIG_PATH, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    if isinstance(data, dict):
                        defaults.update({k: data[k] for k in defaults if k in data})
            # 服务端强制约束：间隔只能 30~60 分钟
            defaults['intervalMinutes'] = max(30, min(60, int(defaults.get('intervalMinutes', 30))))
            self._send_json({'ok': True, 'config': defaults}, 200)
        except Exception as e:
            self._send_json({'ok': True, 'config': defaults, '_error': str(e)}, 200)


    def _handle_health_config_post(self):
        try:
            data = self._read_body()
            if not isinstance(data, dict):
                raise ValueError('配置必须是 JSON 对象')
            defaults = {
                'intervalMinutes': 30,
                'graceMinutes': 10,
                'forceLockMinutes': 10,
            }
            with _HEALTH_CONFIG_LOCK:
                existing = dict(defaults)
                if os.path.exists(_HEALTH_CONFIG_PATH):
                    try:
                        with open(_HEALTH_CONFIG_PATH, 'r', encoding='utf-8') as f:
                            loaded = json.load(f)
                        if isinstance(loaded, dict):
                            existing.update({k: loaded[k] for k in defaults if k in loaded})
                    except Exception:
                        pass
                for key in defaults:
                    if key in data:
                        value = int(data[key])
                        if value <= 0:
                            raise ValueError(key + ' 必须大于 0')
                        existing[key] = value
                # 服务端强制约束：提醒间隔只允许 30~60 分钟，不允许用户设置过久
                existing['intervalMinutes'] = max(30, min(60, int(existing.get('intervalMinutes', 30))))
                if 'graceMinutes' not in existing:
                    existing['graceMinutes'] = 10
                if 'forceLockMinutes' not in existing:
                    existing['forceLockMinutes'] = 10
                os.makedirs(os.path.dirname(_HEALTH_CONFIG_PATH), exist_ok=True)
                tmp = _HEALTH_CONFIG_PATH + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(existing, f, ensure_ascii=False, indent=2)
                os.replace(tmp, _HEALTH_CONFIG_PATH)
            self._send_json({'ok': True, 'config': existing}, 200)
        except ValueError as e:
            self._send_json({'ok': False, 'error': str(e)}, 400)
        except Exception as e:
            self._send_json({'ok': False, 'error': '写健康配置失败: ' + str(e)}, 500)


    def _handle_loop_mode_config_get(self):
        try:
            with _LOOP_MODE_CONFIG_LOCK:
                if not os.path.exists(_LOOP_MODE_CONFIG_PATH):
                    self._send_json({'default_mode': '1', 'per_chat': {}}, 200)
                    return
                with open(_LOOP_MODE_CONFIG_PATH, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            self._send_json(data, 200)
        except Exception as e:
            self._send_json({'default_mode': '1', 'per_chat': {}, '_error': str(e)}, 200)


    def _handle_loop_mode_config_post(self):
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self._cached_body(length) if length > 0 else b'{}'
            data = json.loads(raw.decode('utf-8') or '{}')
        except Exception as e:
            self._send_json({'ok': False, 'error': 'json 解析失败: ' + str(e)}, 400)
            return
        try:
            with _LOOP_MODE_CONFIG_LOCK:
                existing = {}
                if os.path.exists(_LOOP_MODE_CONFIG_PATH):
                    try:
                        with open(_LOOP_MODE_CONFIG_PATH, 'r', encoding='utf-8') as f:
                            existing = json.load(f) or {}
                    except Exception:
                        existing = {}
                # 当前选中即默认：default_mode 直接存选中值（数字或插件模式 id 字符串），失败才回退 '1'
                if 'default_mode' in data:
                    dm = data['default_mode']
                    try:
                        existing['default_mode'] = int(dm)
                    except (TypeError, ValueError):
                        existing['default_mode'] = str(dm).strip() if str(dm).strip() else '1'
                if 'per_chat' in data and isinstance(data['per_chat'], dict):
                    existing['per_chat'] = data['per_chat']
                os.makedirs(os.path.dirname(_LOOP_MODE_CONFIG_PATH), exist_ok=True)
                tmp = _LOOP_MODE_CONFIG_PATH + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(existing, f, ensure_ascii=False, indent=2)
                os.replace(tmp, _LOOP_MODE_CONFIG_PATH)
            self._send_json({'ok': True, 'config': existing}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': '写 json 失败: ' + str(e)}, 500)


    def _handle_tool_result_limits_get(self):
        # 工具结果出口限额：读取 private/tool_result_limits.json
        try:
            with _TOOL_RESULT_LIMITS_LOCK:
                if not os.path.exists(_TOOL_RESULT_LIMITS_PATH):
                    self._send_json({'exit_limits': {}}, 200)
                    return
                with open(_TOOL_RESULT_LIMITS_PATH, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            self._send_json(data, 200)
        except Exception as e:
            self._send_json({'exit_limits': {}, '_error': str(e)}, 200)


    def _handle_tool_result_limits_post(self):
        # 工具结果出口限额：整包写入 private/tool_result_limits.json（替换式保存）
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self._cached_body(length) if length > 0 else b'{}'
            data = json.loads(raw.decode('utf-8') or '{}')
        except Exception as e:
            self._send_json({'ok': False, 'error': 'json 解析失败: ' + str(e)}, 400)
            return
        try:
            with _TOOL_RESULT_LIMITS_LOCK:
                os.makedirs(os.path.dirname(_TOOL_RESULT_LIMITS_PATH), exist_ok=True)
                tmp = _TOOL_RESULT_LIMITS_PATH + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                os.replace(tmp, _TOOL_RESULT_LIMITS_PATH)
            self._send_json({'ok': True, 'config': data}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': '写 json 失败: ' + str(e)}, 500)

    # ===== 用户设置：GET/POST（private/用户设置/user_settings.json） =====

    def _user_settings_read(self):
        """读取用户设置 JSON（不存在则返回空对象）"""
        if not os.path.exists(_USER_SETTINGS_PATH):
            return {}
        with open(_USER_SETTINGS_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}


    def _handle_user_settings_get(self):
        try:
            with _USER_SETTINGS_LOCK:
                data = self._user_settings_read()
            self._send_json({'ok': True, 'settings': data}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'settings': {}, 'error': str(e)}, 200)


    def _handle_user_settings_post(self):
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self._cached_body(length) if length > 0 else b'{}'
            data = json.loads(raw.decode('utf-8') or '{}')
        except Exception as e:
            self._send_json({'ok': False, 'error': 'json 解析失败: ' + str(e)}, 400)
            return
        changes = data.get('changes') if isinstance(data, dict) else None
        if not isinstance(changes, dict):
            self._send_json({'ok': False, 'error': '请提交 {changes: {key: value, ...}}'}, 400)
            return
        try:
            with _USER_SETTINGS_LOCK:
                current = self._user_settings_read()
                for k, v in changes.items():
                    if v is None:
                        current.pop(k, None)
                    else:
                        current[str(k)] = v
                # 防膨胀：最多保留 _USER_SETTINGS_MAX_KEYS 个键
                if len(current) > _USER_SETTINGS_MAX_KEYS:
                    current = dict(list(current.items())[-_USER_SETTINGS_MAX_KEYS:])
                os.makedirs(os.path.dirname(_USER_SETTINGS_PATH), exist_ok=True)
                tmp = _USER_SETTINGS_PATH + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(current, f, ensure_ascii=False, indent=2)
                os.replace(tmp, _USER_SETTINGS_PATH)
            self._send_json({'ok': True, 'settings': current}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': '写 json 失败: ' + str(e)}, 500)

    # ===== 画布背景/特效配置：GET/POST（独立 background.json，不写入主设置） =====

    def _background_read(self):
        if not os.path.exists(_BACKGROUND_PATH):
            return {}
        with open(_BACKGROUND_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}

    def _handle_background_get(self):
        try:
            with _BACKGROUND_LOCK:
                data = self._background_read()
                # 兼容迁移：老版本背景存在主设置 zf_background 里，首次读取时搬到独立文件
                if not data:
                    raw = self._user_settings_read().get('zf_background')
                    if raw:
                        try:
                            migrated = json.loads(raw) if isinstance(raw, str) else raw
                            if isinstance(migrated, dict) and migrated:
                                data = migrated
                                os.makedirs(os.path.dirname(_BACKGROUND_PATH), exist_ok=True)
                                tmp = _BACKGROUND_PATH + '.tmp'
                                with open(tmp, 'w', encoding='utf-8') as f:
                                    json.dump(data, f, ensure_ascii=False, indent=2)
                                os.replace(tmp, _BACKGROUND_PATH)
                                # 迁移成功后从主设置中移除，避免 base64 图片把主设置撑爆
                                try:
                                    with _USER_SETTINGS_LOCK:
                                        cur = self._user_settings_read()
                                        cur.pop('zf_background', None)
                                        tmp2 = _USER_SETTINGS_PATH + '.tmp'
                                        with open(tmp2, 'w', encoding='utf-8') as f:
                                            json.dump(cur, f, ensure_ascii=False, indent=2)
                                        os.replace(tmp2, _USER_SETTINGS_PATH)
                                except Exception:
                                    pass
                        except Exception:
                            pass
            self._send_json({'ok': True, 'background': data}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'background': {}, 'error': str(e)}, 200)

    # ===== 用户习惯（读写 private/用户设置/user_preferences.json） =====
    def _user_preferences_read(self):
        if not os.path.exists(_USER_PREFERENCES_PATH):
            return {}
        try:
            with open(_USER_PREFERENCES_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _handle_user_preferences_get(self):
        try:
            with _USER_PREFERENCES_LOCK:
                data = self._user_preferences_read()
            self._send_json({'ok': True, 'preferences': data}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'preferences': {}, 'error': str(e)}, 500)

    def _handle_user_preferences_post(self):
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self._cached_body(length) if length > 0 else b'{}'
            data = json.loads(raw.decode('utf-8') or '{}')
        except Exception as e:
            self._send_json({'ok': False, 'error': 'json 解析失败: ' + str(e)}, 400)
            return
        prefs = data.get('preferences') if isinstance(data, dict) else None
        if not isinstance(prefs, dict):
            self._send_json({'ok': False, 'error': '请提交 {preferences: {...}}'}, 400)
            return
        try:
            with _USER_PREFERENCES_LOCK:
                os.makedirs(os.path.dirname(_USER_PREFERENCES_PATH), exist_ok=True)
                # 【2026 修复】合并写：旧文件内容为基底，仅覆盖本次提交的 key，
                # 避免前端分批提交（压缩档位/对话框大小等）时互相整文件覆盖丢失
                merged = self._user_preferences_read()
                for k, v in prefs.items():
                    if isinstance(v, dict) and isinstance(merged.get(k), dict):
                        merged[k] = {**merged[k], **v}
                    else:
                        merged[k] = v
                tmp = _USER_PREFERENCES_PATH + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(merged, f, ensure_ascii=False, indent=2)
                os.replace(tmp, _USER_PREFERENCES_PATH)
            self._send_json({'ok': True, 'preferences': merged}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': '写 json 失败: ' + str(e)}, 500)

    def _handle_background_post(self):
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self._cached_body(length) if length > 0 else b'{}'
            data = json.loads(raw.decode('utf-8') or '{}')
        except Exception as e:
            self._send_json({'ok': False, 'error': 'json 解析失败: ' + str(e)}, 400)
            return
        config = data.get('background') if isinstance(data, dict) else None
        if not isinstance(config, dict):
            self._send_json({'ok': False, 'error': '请提交 {background: {...}}'}, 400)
            return
        # 白名单过滤，防止无关字段混入膨胀文件
        clean = {}
        for k in ('mode', 'color', 'colorStar', 'imageUrl', 'imageBlur', 'imageDark', 'fx'):
            if k in config:
                clean[k] = config[k]
        try:
            with _BACKGROUND_LOCK:
                os.makedirs(os.path.dirname(_BACKGROUND_PATH), exist_ok=True)
                tmp = _BACKGROUND_PATH + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(clean, f, ensure_ascii=False, indent=2)
                os.replace(tmp, _BACKGROUND_PATH)
            self._send_json({'ok': True, 'background': clean}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': '写 json 失败: ' + str(e)}, 500)

    def _handle_chat_mode_rules_get(self):
        if chat_mode_rules is None:
            self._send_json({'ok': False, 'error': 'chat_mode_rules 模块不可用'}, 500)
            return
        try:
            data = chat_mode_rules.load_rules_cache()
            if not data:
                self._send_json({'ok': True, 'rules': None, 'hint': '规则文件缺失或为空，当前使用内置宽容默认值'}, 200)
            else:
                self._send_json({'ok': True, 'rules': data}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)


    def _handle_chat_mode_rules_post(self):
        if chat_mode_rules is None:
            self._send_json({'ok': False, 'error': 'chat_mode_rules 模块不可用'}, 500)
            return
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self._cached_body(length) if length > 0 else b'{}'
            data = json.loads(raw.decode('utf-8') or '{}')
        except Exception as e:
            self._send_json({'ok': False, 'error': 'json 解析失败: ' + str(e)}, 400)
            return
        # 接受两种提交格式：{rules: {...}} 整体替换，或直接提交规则对象本身
        rules = data.get('rules') if isinstance(data.get('rules'), dict) else (data if isinstance(data, dict) and 'modes' in data else None)
        if rules is None:
            self._send_json({'ok': False, 'error': '请提交 {rules: {...}}（含 modes 字段）或规则对象本身'}, 400)
            return
        try:
            saved = chat_mode_rules.save_rules(rules)
            self._send_json({'ok': True, 'rules': saved}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': '写规则失败: ' + str(e)}, 500)

    # ===== 工作日志：AI 任务完成记录（GET 查询 / POST 追加）=====

    def _worklog_read(self):
        if not os.path.exists(_WORKLOG_PATH):
            return {}
        try:
            with open(_WORKLOG_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _worklog_write(self, data):
        os.makedirs(os.path.dirname(_WORKLOG_PATH), exist_ok=True)
        tmp = _WORKLOG_PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, _WORKLOG_PATH)

    def _handle_worklog_get(self):
        """GET /api/worklog?days=N：返回最近 N 天（默认7）的工作日志"""
        try:
            qs = parse_qs(parsed_qs[1]) if (parsed_qs := urlparse(self.path)) else {}
            days = int((qs.get('days') or ['7'])[0] or 7)
            days = max(1, min(days, _WORKLOG_MAX_DAYS))
            with _WORKLOG_LOCK:
                data = self._worklog_read()
            # 只保留最近 days 天，按日期倒序
            keys = sorted(data.keys(), reverse=True)[:days]
            out = {k: data[k] for k in keys if isinstance(data.get(k), list)}
            total = sum(len(v) for v in out.values())
            self._send_json({'ok': True, 'days': days, 'total': total, 'log': out}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'log': {}, 'error': str(e)}, 200)

    def _handle_worklog_post(self):
        """POST /api/worklog {summary, chatId, success}：追加一条工作记录（防重）"""
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self._cached_body(length) if length > 0 else b'{}'
            body = json.loads(raw.decode('utf-8') or '{}')
        except Exception as e:
            self._send_json({'ok': False, 'error': 'json 解析失败: ' + str(e)}, 400)
            return
        summary = str(body.get('summary') or '').strip()
        if not summary:
            self._send_json({'ok': False, 'error': '缺少 summary'}, 400)
            return
        summary = summary[:2000]  # 单条上限
        day = time.strftime('%Y-%m-%d')
        now_ts = time.time()
        entry = {
            'ts': now_ts,
            'time': time.strftime('%H:%M:%S'),
            'summary': summary,
            'chat_id': str(body.get('chatId') or ''),
            'success': bool(body.get('success', True)),
        }
        try:
            with _WORKLOG_LOCK:
                data = self._worklog_read()
                day_list = data.get(day)
                if not isinstance(day_list, list):
                    day_list = []
                # 防重：同 chatId 同摘要内容 60 秒内不重复记录
                dup = False
                for it in day_list[-10:]:
                    if isinstance(it, dict) and it.get('chat_id') == entry['chat_id'] \
                            and it.get('summary') == summary and abs(float(it.get('ts', 0)) - now_ts) < 60:
                        dup = True
                        break
                if not dup:
                    day_list.append(entry)
                    # 单日条数上限
                    if len(day_list) > _WORKLOG_MAX_ENTRIES_PER_DAY:
                        day_list = day_list[-_WORKLOG_MAX_ENTRIES_PER_DAY:]
                    data[day] = day_list
                    # 只保留最近 N 天
                    keys = sorted(data.keys(), reverse=True)
                    for k in keys[_WORKLOG_MAX_DAYS:]:
                        data.pop(k, None)
                    self._worklog_write(data)
            self._send_json({'ok': True, 'day': day, 'count': len(day_list)}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': '写工作日志失败: ' + str(e)}, 500)


    # ===== 可选插件（录音/录像依赖）：状态查询 / 安装 =====
    _PLUGIN_DIR_NAME = 'audio-video-plugin'
    # 需要复制到 python\Lib\site-packages 的包/模块
    _PLUGIN_SP_ITEMS = ['soundcard', 'numpy', 'numpy.libs', 'cffi', 'pycparser', '_cffi_backend.cp311-win_amd64.pyd']
    # 需要复制到 python\ 根目录的 tcl/tk 运行时（_tkinter.pyd 放 DLLs）
    _PLUGIN_ROOT_ITEMS = ['tcl', 'tcl86t.dll', 'tk86t.dll']
    _PLUGIN_DLLS_ITEM = '_tkinter.pyd'
    _PLUGIN_INSTALLED_MARK = '.plugin-installed'

    def _plugin_src_dir(self):
        base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        return os.path.join(base, 'plugins', self._PLUGIN_DIR_NAME)

    def _plugin_py_dir(self):
        base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        return os.path.join(base, 'python')

    def _plugin_check_imports(self):
        """直接用嵌入式 Python 试导入，最可靠的 installed 判定"""
        py = os.path.join(self._plugin_py_dir(), 'python.exe')
        code = "import importlib\n" \
               "mods=['numpy','soundcard','tkinter']\n" \
               "r={}\n" \
               "for m in mods:\n" \
               "    try:\n" \
               "        importlib.import_module(m); r[m]=True\n" \
               "    except Exception:\n" \
               "        r[m]=False\n" \
               "import json;print(json.dumps(r))"
        try:
            out = subprocess.run([py, '-c', code], capture_output=True, text=True, timeout=60)
            for line in out.stdout.strip().splitlines():
                line = line.strip()
                if line.startswith('{'):
                    return json.loads(line)
        except Exception:
            pass
        return None

    def _handle_plugin_status(self):
        try:
            src = self._plugin_src_dir()
            source_available = os.path.isdir(src)
            res = self._plugin_check_imports()
            if res is not None:
                installed = all(res.values())
                missing = [k for k, v in res.items() if not v]
            else:
                # 导入测试失败时退回文件判定
                sp = os.path.join(self._plugin_py_dir(), 'Lib', 'site-packages')
                installed = (os.path.isdir(os.path.join(sp, 'numpy'))
                             and os.path.isdir(os.path.join(sp, 'soundcard'))
                             and os.path.isfile(os.path.join(self._plugin_py_dir(), 'tcl86t.dll')))
                missing = ['numpy/soundcard/tk'] if not installed else []
            self._send_json({
                'ok': True,
                'installed': installed,
                'sourceAvailable': source_available,
                'missing': missing,
            }, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_plugin_install(self):
        try:
            import shutil
            src = self._plugin_src_dir()
            pydir = self._plugin_py_dir()
            if not os.path.isdir(src):
                self._send_json({'ok': False, 'error': '插件包缺失（plugins/audio-video-plugin）'}, 400)
                return
            sp = os.path.join(pydir, 'Lib', 'site-packages')
            os.makedirs(sp, exist_ok=True)
            copied = 0
            for name in self._PLUGIN_SP_ITEMS:
                s = os.path.join(src, name)
                d = os.path.join(sp, name)
                if not os.path.exists(s):
                    continue
                if os.path.isdir(s):
                    if os.path.exists(d):
                        shutil.rmtree(d, ignore_errors=True)
                    shutil.copytree(s, d)
                else:
                    shutil.copy2(s, d)
                copied += 1
            for name in self._PLUGIN_ROOT_ITEMS:
                s = os.path.join(src, name)
                d = os.path.join(pydir, name)
                if not os.path.exists(s):
                    continue
                if os.path.isdir(s):
                    if os.path.exists(d):
                        shutil.rmtree(d, ignore_errors=True)
                    shutil.copytree(s, d)
                else:
                    shutil.copy2(s, d)
                copied += 1
            # _tkinter.pyd 放 DLLs
            s = os.path.join(src, self._PLUGIN_DLLS_ITEM)
            if os.path.exists(s):
                shutil.copy2(s, os.path.join(pydir, 'DLLs', self._PLUGIN_DLLS_ITEM))
                copied += 1
            # 写安装标记
            try:
                with open(os.path.join(src, self._PLUGIN_INSTALLED_MARK), 'w', encoding='utf-8') as f:
                    f.write('installed')
            except Exception:
                pass
            # 安装后复检
            res = self._plugin_check_imports()
            installed = bool(res and all(res.values()))
            if installed:
                self._send_json({'ok': True, 'installed': True, 'copied': copied, 'note': '重启程序后生效'}, 200)
            else:
                self._send_json({'ok': False, 'error': '文件已复制但导入校验未通过，请重启程序后再试',
                                 'copied': copied, 'check': res}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)


