# -*- coding: utf-8 -*-
"""Mixin: 用户设置/聊天附件/画布背景/用户习惯/聊天模式规则（由 mixin_settings.py 拆出，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase


# MIRROR_STRIP constants
MIRROR = 'ls:zf3d_user_settings_mirror'
MIRROR_RAW = 'zf3d_user_settings_mirror'
_USER_SETTINGS_MAX_VAL = 256 * 1024


class MixinSettingsUser(MixinBase):
    # ===== 用户设置：GET/POST（private/用户设置/user_settings.json） =====

    def _user_settings_read(self):
        """读取用户设置 JSON（不存在则返回空对象）"""
        if not os.path.exists(_USER_SETTINGS_PATH):
            return {}
        with open(_USER_SETTINGS_PATH, 'r', encoding='utf-8-sig') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}


    def _handle_user_settings_get(self):
        try:
            with _USER_SETTINGS_LOCK:
                data = self._user_settings_read()
            data.pop('ls:zf3d_user_settings_mirror', None); data.pop('zf3d_user_settings_mirror', None)  # 防镜像键回流
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
                # MIRROR_STRIP: 服务器端终极防线——丢弃镜像键及超大值，彻底阻断套娃膨胀
                for bk in (MIRROR, MIRROR_RAW):
                    changes.pop(bk, None)
                changes = {k: v for k, v in changes.items()
                           if not isinstance(v, str) or len(v) <= _USER_SETTINGS_MAX_VAL}
                for k, v in changes.items():
                    if v is None:
                        current.pop(k, None)
                    else:
                        if str(k) == 'ls:zf3d_user_settings_mirror':
                            continue  # MIRROR_BLOCK: 镜像键禁止写入
                        s = json.dumps(v, ensure_ascii=False)
                        if len(s) > 262144:
                            continue  # 单值超 256KB，拒收防膨胀
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

    # ===== 聊天附件暂存：GET/POST（private/用户设置/chat_attachments.json） =====
    # 待发附件（图片 base64 / 粘贴卡片）跨重启恢复；按对话 box.id 分键，POST 全量覆盖该键

    def _handle_chat_attachments_get(self, qs=None):
        try:
            data = {}
            if os.path.exists(_CHAT_ATTACHMENTS_PATH):
                with open(_CHAT_ATTACHMENTS_PATH, 'r', encoding='utf-8-sig') as f:
                    data = json.load(f)
            if not isinstance(data, dict):
                data = {}
            box_id = ''
            if qs:
                try:
                    box_id = (qs.get('boxId') or [''])[0]
                except Exception:
                    box_id = ''
            if box_id:
                data = {box_id: data.get(box_id) or {'images': [], 'pastes': []}}
            self._send_json({'ok': True, 'attachments': data}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'attachments': {}, 'error': str(e)}, 200)

    def _handle_chat_attachments_post(self):
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self._cached_body(length) if length > 0 else b'{}'
            data = json.loads(raw.decode('utf-8') or '{}')
        except Exception as e:
            self._send_json({'ok': False, 'error': 'json 解析失败: ' + str(e)}, 400)
            return
        box_id = str(data.get('boxId') or '').strip()
        if not box_id:
            self._send_json({'ok': False, 'error': '缺少 boxId'}, 400)
            return
        images = data.get('images') if isinstance(data.get('images'), list) else []
        pastes = data.get('pastes') if isinstance(data.get('pastes'), list) else []
        try:
            with _CHAT_ATTACHMENTS_LOCK:
                current = {}
                if os.path.exists(_CHAT_ATTACHMENTS_PATH):
                    with open(_CHAT_ATTACHMENTS_PATH, 'r', encoding='utf-8-sig') as f:
                        current = json.load(f)
                if not isinstance(current, dict):
                    current = {}
                if not images and not pastes:
                    current.pop(box_id, None)   # 两类都空 → 清除该对话的暂存
                else:
                    current[box_id] = {'images': images, 'pastes': pastes}
                # 防膨胀：最多保留 12 个对话的暂存（对话关闭时前端会主动清理，此处兜底）
                if len(current) > 12:
                    for k in list(current.keys())[:-12]:
                        current.pop(k, None)
                os.makedirs(os.path.dirname(_CHAT_ATTACHMENTS_PATH), exist_ok=True)
                tmp = _CHAT_ATTACHMENTS_PATH + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(current, f, ensure_ascii=False)
                os.replace(tmp, _CHAT_ATTACHMENTS_PATH)
            self._send_json({'ok': True}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': '写 json 失败: ' + str(e)}, 500)

    # ===== 画布背景/特效配置：GET/POST（独立 background.json，不写入主设置） =====

    def _background_read(self):
        if not os.path.exists(_BACKGROUND_PATH):
            return {}
        with open(_BACKGROUND_PATH, 'r', encoding='utf-8-sig') as f:
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
            with open(_USER_PREFERENCES_PATH, 'r', encoding='utf-8-sig') as f:
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
