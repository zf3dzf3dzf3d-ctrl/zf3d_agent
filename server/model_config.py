# -*- coding: utf-8 -*-
"""
model_config.py - 大模型配置读写（双源拆分版）
- 公开配置: <BASE_DIR>/public/config/models.json   （模型定义，无 key）
- 私有配置: <BASE_DIR>/private/api_keys.json       （按 name 索引的 key）
- 前端通过 /api/models/config 读写；读写时自动合并两个文件。
"""
import json
import os
import tempfile
import threading
import time
from config import BASE_DIR

MODELS_FILE = os.path.join(BASE_DIR, 'public', 'config', 'models.json')
API_KEYS_FILE = os.path.join(BASE_DIR, 'private', 'api_keys.json')
VERSION = 3


def _ensure_dir(path):
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)


def _load_json(path, default):
    """安全读取 JSON 文件，失败返回 default。"""
    if not os.path.isfile(path):
        return default
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


# 写盘全局锁：防止多线程/并发请求同时写同一文件（Windows 下 os.replace
# 会因文件被另一线程占用而 PermissionError，即前端看到的「写盘失败」）
_SAVE_LOCK = threading.Lock()
# 最后一次写盘失败的异常信息（供排查）
_LAST_SAVE_ERROR = None


def _save_json(path, data):
    """原子写入 JSON 文件（线程安全）。"""
    global _LAST_SAVE_ERROR
    with _SAVE_LOCK:
        tmp = None
        try:
            _ensure_dir(path)
            # 用唯一临时文件名，避免并发写入同一 .tmp 互相覆盖/占用
            fd, tmp = tempfile.mkstemp(
                dir=os.path.dirname(path) or '.',
                prefix='.models_tmp_',
                suffix='.json')
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
            tmp = None
            return True
        except Exception as e:
            _LAST_SAVE_ERROR = '%s -> %s: %r' % (time.strftime('%Y-%m-%dT%H:%M:%S'), path, e)
            try:
                import traceback
                _LAST_SAVE_ERROR += '\n' + traceback.format_exc()
            except Exception:
                pass
            return False
        finally:
            if tmp and os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except Exception:
                    pass


def _load_keys_map():
    """读取 key 映射表，返回 {name: key}。"""
    data = _load_json(API_KEYS_FILE, {'keys': {}})
    keys = data.get('keys') if isinstance(data, dict) else None
    return keys if isinstance(keys, dict) else {}


def _save_keys_map(keys_map):
    """写入 key 映射表。"""
    return _save_json(API_KEYS_FILE, {
        '_meta': {
            'version': VERSION,
            'updated_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
        },
        'keys': keys_map,
    })


def _normalize_model(m):
    """规范化单条模型配置：补默认字段，过滤掉 key（避免误写回公开区）。"""
    if not isinstance(m, dict):
        return None
    mm = {
        'name': m.get('name', ''),
        'displayName': m.get('displayName', m.get('name', '')),
        'provider': m.get('provider', ''),
        'baseUrl': m.get('baseUrl', m.get('endpoint', '')),
        'endpoint': m.get('endpoint', m.get('baseUrl', '')),
        'modelId': m.get('modelId', ''),
        'officialUrl': m.get('officialUrl', ''),
        'maxTokens': m.get('maxTokens', 4096),
        'temperature': m.get('temperature', 0.7),
        'enabled': bool(m.get('enabled', True)),
        'isDefault': bool(m.get('isDefault', False)),
        'preset': bool(m.get('preset', False)),
        'visible': bool(m.get('visible', True)),
        'imageGen': bool(m.get('imageGen', False)),
        # imageGen = 图片生成；visionInput = 接收并理解图片输入，二者不能混用。
        'visionInput': bool(m.get('visionInput', False)),
        'visionInputFormats': list(m.get('visionInputFormats', [])) if isinstance(m.get('visionInputFormats', []), list) else [],
        'noKeyRequired': bool(m.get('noKeyRequired', False)),
    }
    # 保留扩展字段（用户/未来新增的），但排除密钥相关字段（避免泄露到公开区）
    for k, v in m.items():
        if k not in mm and k not in ('key', 'apiKey'):
            mm[k] = v
    return mm if mm['name'] else None


def load_models_config():
    """
    读取并合并模型配置。
    返回: { 'list': [ {..., 'key': '...'}, ... ], '_meta': {...} }
    前端拿到的 list 里每条都带 key（合并自 api_keys.json）。
    """
    public_data = _load_json(MODELS_FILE, {'models': []})
    models = public_data.get('models') if isinstance(public_data, dict) else None
    if not isinstance(models, list):
        models = []

    keys_map = _load_keys_map()

    merged = []
    for raw in models:
        nm = _normalize_model(raw)
        if nm:
            if not isinstance(nm.get('modelIdOptions'), list):
                nm['modelIdOptions'] = []
        if not nm:
            continue
        # 优先使用模型专属密钥；未配置时才按 keyRef 复用已保存的渠道密钥。
        # keyRef 仅是私有密钥映射的引用名，绝不写入公开配置中的 key/apiKey 字段。
        direct_key = keys_map.get(nm['name'], '')
        ref_key = keys_map.get(nm.get('keyRef', ''), '') if nm.get('keyRef') else ''
        nm['key'] = direct_key or ref_key
        nm['apiKey'] = nm['key']  # 前端兼容
        merged.append(nm)

    return {
        '_meta': {
            'version': VERSION,
            'sources': {
                'public': 'public/config/models.json',
                'private': 'private/api_keys.json',
            },
        },
        'list': merged,
    }


def save_models_config(payload):
    """
    整体覆盖写入。
    - list 中每条的 name + 公开字段 -> 写回 public/config/models.json
    - list 中每条的 key -> 写回 private/api_keys.json
    两者按 name 一一对应。
    返回 True/False。
    """
    if not isinstance(payload, dict):
        return False
    items = payload.get('list') or []
    if not isinstance(items, list):
        return False

    public_models = []
    keys_map = {}
    seen_names = set()
    for m in items:
        if not isinstance(m, dict):
            continue
        nm = _normalize_model(m)
        if not nm:
            continue
        name = nm['name']
        if name in seen_names:
            continue  # 去重
        seen_names.add(name)
        # 公开区不写 key
        public_models.append(nm)
        # 私有区只存 key（兼容前端发送的 key 或 apiKey 字段）
        keys_map[name] = m.get('key', '') or m.get('apiKey', '')

    # 写入公开区
    public_payload = {
        '_meta': {
            'version': VERSION,
            'updated_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
        },
        'models': public_models,
    }
    if not _save_json(MODELS_FILE, public_payload):
        return False
    # 写入私有区
    if not _save_keys_map(keys_map):
        return False
    return True


def get_model_by_name(name):
    """根据 name 取单条模型（合并 key）。未找到返回 None。"""
    cfg = load_models_config()
    for m in cfg.get('list', []):
        if m.get('name') == name:
            return m
    return None


def get_default_model():
    """取 isDefault=true 的模型；没有则取第一个。"""
    cfg = load_models_config()
    items = cfg.get('list', [])
    for m in items:
        if m.get('isDefault'):
            return m
    return items[0] if items else None


def import_from_legacy_json(items):
    """从前端提交的老格式 list 导入。返回构造好的 payload dict。"""
    items = items or []
    list_out = []
    for m in items:
        if not isinstance(m, dict):
            continue
        nm = _normalize_model(m)
        if not nm:
            continue
        nm['key'] = m.get('key', '')
        list_out.append(nm)
    return {
        '_meta': {
            'version': VERSION,
            'note': '从旧版 localStorage/SQLite 迁移',
            'migrated_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
        },
        'list': list_out,
    }
