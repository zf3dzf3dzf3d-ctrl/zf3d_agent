# -*- coding: utf-8 -*-
"""
model_config.py - 大模型配置读写（双源拆分版）
- 公开配置: <BASE_DIR>/public/config/models.json   （模型定义，无 key）
- 私有配置: <BASE_DIR>/private/api_keys.json       （按 name 索引的 key）
- 前端通过 /api/models/config 读写；读写时自动合并两个文件。
"""
import json
import os
import shutil
import tempfile
import threading
import time
from config import BASE_DIR

MODELS_FILE = os.path.join(BASE_DIR, 'public', 'config', 'models.json')
API_KEYS_FILE = os.path.join(BASE_DIR, 'private', 'api_keys.json')

# 朱峰官方管理模型名单（写死，不可被用户增删改，始终置顶显示）。
# 新增/下架官方模型时改这里即可（需与 models.json 中的 name 一致）。
ZF_PROTECTED_MODELS = ['朱峰模型']
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
        # utf-8-sig：兼容带 BOM 文件（PowerShell Set-Content -Encoding UTF8 写出的 JSON），
        # 否则 json.load 抛异常被下方 except 吞掉 → 模型列表静默变空
        with open(path, 'r', encoding='utf-8-sig') as f:
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


MASK_PREFIX = '••••'


def mask_key(key):
    """将 key 脱敏为掩码（保留末 4 位），用于 API 返回。"""
    key = str(key or '')
    if not key:
        return ''
    tail = key[-4:] if len(key) > 8 else ''
    return MASK_PREFIX + tail


def is_masked_key(key):
    """判断字符串是否为掩码（前端原样回传时用于保留原值）。
    同时兼容 model_config 的 •••• 前缀格式与 security.py 的 **** 格式。"""
    if not isinstance(key, str):
        return False
    if key.startswith(MASK_PREFIX):
        return True
    import re
    return bool(re.match(r'^.{0,8}\*{4}', key))


def _load_keys_map():
    """读取 key 映射表，返回 {name: 明文key}。经 secure_store DPAPI 自动解密，
    兼容旧明文 api_keys.json（读到明文原样返回，写盘时统一加密迁移）。"""
    try:
        import secure_store
        return secure_store.load_keys(API_KEYS_FILE, _load_json)
    except Exception:
        data = _load_json(API_KEYS_FILE, {'keys': {}})
        keys = data.get('keys') if isinstance(data, dict) else None
        return keys if isinstance(keys, dict) else {}


def _load_model_file_keys():
    """从 public/config/models.json 补充真实 key。
    历史版本可能把真实 key 留在公开区 models.json（key/apiKey 字段），
    而 api_keys.json 对应条目为空，导致按尾号还原掩码失败。"""
    data = _load_json(MODELS_FILE, {'models': []})
    models = data.get('models') if isinstance(data, dict) else None
    out = {}
    if isinstance(models, list):
        for m in models:
            if isinstance(m, dict):
                k = str(m.get('key') or m.get('apiKey') or '')
                if k and not is_masked_key(k):
                    out[str(m.get('name') or '') or k[-4:]] = k
    return out


def find_key_by_tail(tail):
    """按末几位尾号在 api_keys.json / models.json 中查找真实 key，找不到返回 None。"""
    tail = str(tail or '')
    if not tail:
        return None
    for src in (_load_keys_map(), _load_model_file_keys()):
        for _, real in (src or {}).items():
            real = str(real or '')
            if real and real.endswith(tail):
                return real
    return None


def _save_keys_map(keys_map):
    """写入 key 映射表（secure_store DPAPI 加密落盘，兼容降级）。"""
    try:
        import secure_store
        return secure_store.save_keys(API_KEYS_FILE, keys_map, _save_json, VERSION)
    except Exception:
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
        # modelType 是面板分类的必要字段：缺了会被前端过滤隐藏（小米模型消失的根因）。
        # 任何写路径（保存/同步/迁移）经此规范化都保证有值，默认 language。
        # 官方/第三方下发的分类词（chat/vision/audio）必须映射为面板词汇，
        # 否则 chat 不被识别、vision 被当成生图分错 Tab（根治见 zf_model_sync 同款映射）。
        'modelType': {'chat': 'language', 'text': 'language', 'vision': 'types_vision',
                      'audio': 'speech', 'tts': 'speech', 'asr': 'speech'}.get(
                          str(m.get('modelType') or '').lower()) or m.get('modelType') or 'language',
    }
    # 识图模型必须带 visionInput=True，否则会被当成生图（imageGen）处理
    if mm['modelType'] == 'types_vision':
        mm['visionInput'] = True
    # 保留扩展字段（用户/未来新增的），但排除密钥相关字段（避免泄露到公开区）
    for k, v in m.items():
        if k not in mm and k not in ('key', 'apiKey'):
            mm[k] = v
    return mm if mm['name'] else None


# ========== 朱峰大模型（内置写死，登录会员免 key 即用）==========
ZF_BUILTIN_MODEL = {
    'name': 'zf-builtin',
    'displayName': '朱峰大模型（免配置 · 会员专享）',
    'provider': 'zhufeng',
    'baseUrl': '',   # 由网关侧解析，绝不暴露给前端
    'endpoint': '',
    'modelId': 'zhufeng-free',
    'maxTokens': 4096,
    'temperature': 0.7,
    'enabled': True,
    'isDefault': True,      # 新会员默认选中
    'preset': True,
    'visible': True,
    'imageGen': False,
    'visionInput': False,
    'visionInputFormats': [],
    'noKeyRequired': True,  # 登录会员免 key
    'builtin': True,        # 内置标记：前端隐藏删除按钮/配置表单
    'zfBadge': '免配置 · 会员专享',
}


def load_models_config(include_key=False):
    """
    读取并合并模型配置。
    返回: { 'list': [ {..., 'key': '...'}, ... ], '_meta': {...} }
    include_key=False（默认）时 key/apiKey 返回掩码（后4位），供 API 下发；
    内部调用（真实发请求/取默认模型）传 True 拿真实 key。
    """
    public_data = _load_json(MODELS_FILE, {'models': []})
    models = public_data.get('models') if isinstance(public_data, dict) else None
    if not isinstance(models, list):
        models = []
    # 【两文件分离】朱峰官方模型存放在独立文件 models_zf.json，读取时合并到列表末尾
    # （合并后仍由下方 zfManaged 保护逻辑强制置顶）
    _zf_path = os.path.join(os.path.dirname(MODELS_FILE), 'models_zf.json')
    _zf_data = _load_json(_zf_path, {'models': []})
    _zf_models = _zf_data.get('models') if isinstance(_zf_data, dict) else None
    if isinstance(_zf_models, list) and _zf_models:
        # 【合并去重】本地优先：按 id 与 name 双键去重，zf 条目仅在本地不存在同 id/同名时追加，
        # 避免 zf-2 双重占用等历史脏数据造成重复显示
        _local_ids = {str(m.get('id')) for m in models if isinstance(m, dict) and m.get('id')}
        _local_names = {m.get('name') for m in models if isinstance(m, dict)}
        for _m in _zf_models:
            if not isinstance(_m, dict):
                continue
            if str(_m.get('id') or '') in _local_ids or _m.get('name') in _local_names:
                continue
            models.append(_m)
            _local_ids.add(str(_m.get('id') or ''))
            _local_names.add(_m.get('name'))

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
        real_key = direct_key or ref_key
        nm['key'] = real_key if include_key else mask_key(real_key)
        nm['apiKey'] = nm['key']  # 前端兼容
        merged.append(nm)

    # ===== 朱峰官方模型保护：写死由朱峰统一管理 =====
    # 1) 官方线路模型从磁盘权威配置中重新读取（防止被前端保存篡改 baseUrl/modelId/enabled）
    # 2) 强制置顶显示（用户模型列表最上方）
    ZF_OFFICIAL_NAMES = ['朱峰模型']
    # 【两文件分离】权威定义同时从 models.json 与 models_zf.json 读取
    disk_official = {m.get('name'): m for m in
                     (_normalize_model(raw) for raw in
                      list(public_data.get('models', [])) + list(_zf_models or []))
                     if m and m.get('name') in ZF_OFFICIAL_NAMES}
    managed = [m for m in merged if m.get('name') in ZF_OFFICIAL_NAMES]
    for m in managed:
        disk_m = disk_official.get(m.get('name'))
        if disk_m:
            # 用磁盘上的权威定义覆盖运行时字段，但保留 key 合并结果
            disk_m['key'] = m.get('key', '')
            disk_m['apiKey'] = disk_m['key']
            merged[merged.index(m)] = disk_m
        m = merged[merged.index(m)]
        m['zfManaged'] = True   # 标记：朱峰官方管理，前端锁定不可编辑/删除
        m['zfPinned'] = True    # 标记：强制置顶
    # 官方模型置顶，其余模型保持用户自定义顺序（stable partition，不按名称排序——
    # 之前按 name 字母序重排会覆盖前端上移/下移保存的顺序，导致排序按钮“无效”）
    merged = sorted(merged, key=lambda m: 0 if m.get('zfManaged') else 1)

    # 朱峰大模型(zf-builtin)已下线：不再注入设置面板，
    # 收费统一走 models.json 中的「朱峰模型」(会员Token线路)
    merged = [m for m in merged if m.get('name') != ZF_BUILTIN_MODEL['name']]

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
    keys_map_old = _load_keys_map()
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
        if name == ZF_BUILTIN_MODEL['name']:
            continue  # 防冒名：拒绝保存与内置朱峰大模型同名的条目
        if name in ZF_PROTECTED_MODELS:
            # 朱峰官方模型写死保护：保存时忽略前端对该条目的任何增删改，
            # 保留磁盘上的权威定义（防止用户篡改线路/删除官方模型）
            preserved = next((pm for pm in _load_json(MODELS_FILE, {'models': []}).get('models', [])
                              if isinstance(pm, dict) and pm.get('name') == name), None)
            if preserved and preserved not in public_models:
                public_models.append(_normalize_model(preserved) or preserved)
            continue
        # 公开区不写 key
        public_models.append(nm)
        # 私有区只存 key（兼容前端发送的 key 或 apiKey 字段）
        # 掩码（原样回传）则保留服务端已存的真实 key，避免被掩码覆盖
        raw_key = str(m.get('key', '') or '')
        raw_api = str(m.get('apiKey', '') or '')
        if not raw_key:
            # key 字段为空 -> 主动清空（前端清空输入框/点清除后保存，key 始终携带）
            # apiKey 即使残留掩码也不算数，清空优先于掩码保留
            new_key = ''
        elif raw_key and not is_masked_key(raw_key):
            # key 是明文 -> 以 key 为准
            new_key = raw_key
        elif raw_api and not is_masked_key(raw_api):
            # key 为掩码但 apiKey 是明文 -> 以 apiKey 为准
            new_key = raw_api
        else:
            # 双方都是掩码（整体保存原样回传，key 未被用户改动）-> 保留服务端已存的真实 key
            old = keys_map_old.get(name, '') or keys_map_old.get(nm.get('keyRef', ''), '')
            if not old:
                # 掩码尾号兜底：改名后旧 key 挂在旧名称下，按掩码保留的末4位找回真实 key
                tail = str(raw_key or raw_api or '')[-4:]
                old = find_key_by_tail(tail) or ''
            new_key = old
        keys_map[name] = new_key

    # 改名迁移：旧名称的 key 若在新列表中找不到对应条目，
    # 且某个新条目的 id 等于该旧名称（UI 改名只改 name、id 保持不变），则把 key 迁移过去
    for old_name, old_key in keys_map_old.items():
        if old_name in seen_names or not old_key:
            continue
        for m in items:
            if isinstance(m, dict) and m.get('id') == old_name:
                new_name = str(m.get('name', '') or '')
                if new_name and new_name != old_name and not keys_map.get(new_name):
                    keys_map[new_name] = old_key
                break

    # ===== 缩水护栏：防止旧页面整体覆盖丢失模型 =====
    # 提交列表中缺失的磁盘模型，若未被显式删除（payload.removed），且没有以
    # 原 id 换新名字出现在列表里（改名场景），则保留磁盘权威定义与既有 key。
    try:
        removed_set = set(str(x) for x in (payload.get('removed') or []) if x)
        incoming_ids = set(str(m.get('id')) for m in items
                           if isinstance(m, dict) and m.get('id'))
        disk_models = _load_json(MODELS_FILE, {'models': []}).get('models', [])
        restored = []
        for pm in disk_models:
            if not isinstance(pm, dict):
                continue
            p_name = str(pm.get('name', '') or '')
            p_id = str(pm.get('id', '') or '')
            if not p_name or p_name in seen_names:
                continue
            if p_name in removed_set or (p_id and p_id in removed_set):
                continue          # 用户明确删除，允许缩水
            if p_id and p_id in incoming_ids:
                continue          # 改名：同 id 的新名字已在提交列表中
            nm2 = _normalize_model(pm)
            if nm2 and nm2['name'] not in seen_names:
                seen_names.add(nm2['name'])
                restored.append(nm2)
                # 同步保留该模型已存的真实 key，避免 api_keys.json 丢 key
                if nm2['name'] in keys_map_old and nm2['name'] not in keys_map:
                    keys_map[nm2['name']] = keys_map_old[nm2['name']]
        if restored:
            public_models = restored + public_models
    except Exception:
        pass

    # 写入公开区
    # 【两文件分离】朱峰官方条目(zfManaged/zfLine)不允许混入本地 models.json，
    # 独立写回 models_zf.json（官方线路只由同步接口维护，这里仅保序去重合并）
    _zf_out = [m for m in public_models
               if isinstance(m, dict) and (m.get('zfManaged') or m.get('zfLine'))]
    public_models = [m for m in public_models
                     if not (isinstance(m, dict) and (m.get('zfManaged') or m.get('zfLine')))]
    if _zf_out:
        try:
            _zf_path = os.path.join(os.path.dirname(MODELS_FILE), 'models_zf.json')
            _zf_cur = _load_json(_zf_path, {'models': []})
            _cur_names = {m.get('name') for m in _zf_cur.get('models', []) if isinstance(m, dict)}
            _merged_zf = list(_zf_cur.get('models', []))
            for m in _zf_out:
                if m.get('name') not in _cur_names:
                    _merged_zf.append(m)
            _save_json(_zf_path, {'models': _merged_zf, 'version': 3})
        except Exception:
            pass
    public_payload = {
        '_meta': {
            'version': VERSION,
            'updated_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
        },
        'models': public_models,
    }
    # ===== 滚动备份：每次覆盖 models.json 前留一份，最多保留 20 份 =====
    try:
        if os.path.isfile(MODELS_FILE):
            _bdir = os.path.join(os.path.dirname(MODELS_FILE), 'backups')
            os.makedirs(_bdir, exist_ok=True)
            _bak = os.path.join(_bdir, 'models-%s.json' % time.strftime('%Y%m%d-%H%M%S'))
            _i = 1
            while os.path.exists(_bak):   # 同秒多次保存：加序号，避免互相覆盖
                _bak = os.path.join(_bdir, 'models-%s-%d.json' % (time.strftime('%Y%m%d-%H%M%S'), _i))
                _i += 1
            shutil.copy2(MODELS_FILE, _bak)
            _baks = sorted(f for f in os.listdir(_bdir)
                           if f.startswith('models-') and f.endswith('.json'))
            for _old in _baks[:-20]:
                try:
                    os.remove(os.path.join(_bdir, _old))
                except OSError:
                    pass
    except Exception:
        pass
    if not _save_json(MODELS_FILE, public_payload):

        return False
    # 写入私有区
    if not _save_keys_map(keys_map):
        return False
    return True


def get_model_by_name(name):
    """根据 name 取单条模型（合并真实 key）。未找到返回 None。"""
    cfg = load_models_config(include_key=True)
    for m in cfg.get('list', []):
        if m.get('name') == name:
            return m
    return None


def get_default_model():
    """取 isDefault=true 且启用的模型；官方下发/朱峰线路优先。没有默认就返回 None（绝不取列表第一个瞎给）。"""
    cfg = load_models_config(include_key=True)
    items = cfg.get('list', [])
    def _usable(m):
        return m.get('isDefault') and m.get('enabled', True) and (m.get('endpoint') or m.get('baseUrl') or m.get('apiUrl'))
    def _is_zf(m):
        ep = str(m.get('endpoint') or m.get('baseUrl') or m.get('apiUrl') or '')
        return bool(m.get('zfLine') or m.get('zfManaged') or m.get('zfPinned') or m.get('keyRef') in ('zf_token', 'server'))
    usable = [m for m in items if _usable(m)]
    for m in usable:
        if _is_zf(m):
            return m
    for m in usable:
        return m
    return None


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
