# -*- coding: utf-8 -*-
"""Mixin: 健康守护/循环模式/工具结果限额（由 mixin_settings.py 拆出，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinSettingsHealth(MixinBase):
    def _handle_health_config_get(self):
        defaults = {
            'intervalMinutes': 30,
            'graceMinutes': 10,
            'forceLockMinutes': 10,
        }
        try:
            with _HEALTH_CONFIG_LOCK:
                if os.path.exists(_HEALTH_CONFIG_PATH):
                    with open(_HEALTH_CONFIG_PATH, 'r', encoding='utf-8-sig') as f:
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
                        with open(_HEALTH_CONFIG_PATH, 'r', encoding='utf-8-sig') as f:
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
                with open(_LOOP_MODE_CONFIG_PATH, 'r', encoding='utf-8-sig') as f:
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
                        with open(_LOOP_MODE_CONFIG_PATH, 'r', encoding='utf-8-sig') as f:
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
                with open(_TOOL_RESULT_LIMITS_PATH, 'r', encoding='utf-8-sig') as f:
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
