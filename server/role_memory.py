# -*- coding: utf-8 -*-
"""角色经验记忆层（员工体系 P1）
每个角色在每个项目的经验沉淀，落 private/记忆/角色/<roleId>[_<projectId>].md。
- 三节模板：偏好 / 教训 / 参数，每条带日期
- 单文件上限 2KB，追加时超限淘汰最旧条目
- mtime 缓存防每请求 IO（与 roles_db 同模式）
"""
import os, time, threading

_BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     'private', '记忆', '角色')
MAX_BYTES = 2048
_cache = {}          # path -> {'mtime':, 'text':}
_lock = threading.Lock()

TEMPLATE = ('# 角色经验：{rid}\n\n'
            '## 偏好\n\n## 教训\n\n## 参数\n')


def _path(role_id, project_id=None):
    name = '%s_%s.md' % (role_id, project_id) if project_id else '%s.md' % role_id
    return os.path.join(_BASE, name)


def _read(path):
    try:
        mtime = os.path.getmtime(path)
        c = _cache.get(path)
        if c and c['mtime'] == mtime:
            return c['text']
        with open(path, 'r', encoding='utf-8') as f:
            text = f.read()
        _cache[path] = {'mtime': mtime, 'text': text}
        return text
    except Exception:
        return ''


def get_experience(role_id, project_id=None, max_bytes=1536):
    """读经验正文（给注入用，超限从头部截断到最近条目边界，失败返回空串）。"""
    text = _read(_path(role_id, project_id))
    if not text:
        return ''
    enc = text.encode('utf-8')
    if len(enc) > max_bytes:
        text = enc[:max_bytes].decode('utf-8', errors='ignore')
        # 截到最后一个完整行
        text = text[:text.rfind('\n') + 1] if '\n' in text else text
    return text


def add_experience(role_id, entry, section='教训', project_id=None):
    """追加一条经验（自动加日期），超 2KB 淘汰最旧条目。返回 bool。"""
    if not role_id or not entry or not entry.strip():
        return False
    path = _path(role_id, project_id)
    today = time.strftime('%Y-%m-%d')
    line = '- [%s] %s\n' % (today, entry.strip())
    with _lock:
        try:
            text = _read(path)
            if not text:
                text = TEMPLATE.format(rid=role_id)
            if '\n## %s\n' % section not in text:
                text = text.rstrip('\n') + '\n\n## %s\n' % section
            # 插到该节标题后（该节现有条目之前=新条目在前，淘汰时删尾部=删最旧）
            head, _, tail = text.partition('\n## %s\n' % section)
            text = head + '\n## %s\n' % section + line + tail
            # 裁剪：超 2KB 时从尾部丢行（最旧的在节尾）
            while len(text.encode('utf-8')) > MAX_BYTES:
                lines = text.splitlines(keepends=True)
                if len(lines) <= 3:
                    break
                text = ''.join(lines[:-1])
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'w', encoding='utf-8') as f:
                f.write(text)
            _cache[path] = {'mtime': os.path.getmtime(path), 'text': text}
            return True
        except Exception:
            return False


def clear_experience(role_id, project_id=None):
    """删除经验文件（面板用）。返回 bool。"""
    try:
        os.remove(_path(role_id, project_id))
        _cache.pop(_path(role_id, project_id), None)
        return True
    except Exception:
        return False
