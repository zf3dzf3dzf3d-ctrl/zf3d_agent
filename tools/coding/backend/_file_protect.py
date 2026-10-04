# -*- coding: utf-8 -*-
"""文件保护清单（两级：readonly 只读 / critical 关键）。

设计目标：
- readonly  坚决不可动。连写都不发生；shell 改写/删除同样硬拦。
- critical  可以改，但必须过多重验证：
    1) 写前内容合法性检查（乱码 / 语法错 / 体量突然缩水 / 锚点缺失）
    2) 写后回读比对（落盘内容与拟写入内容是否一致）
    任一关不过即拒绝写入，并自动回滚到写前快照，不会留下半坏文件。

对外接口：
    check_write(path)                       -> (ok: bool, err: str|None)
        readonly 直接返回 (False, 原因)；critical 返回 (True, 提示文案)；
        不在清单返回 (True, None)
    precheck(path, new_content)             -> (ok: bool, err: str|None)
        仅对 critical 生效的写前校验
    verify_after_write(path, expected)      -> (ok: bool, err: str|None)
        写后回读比对
    rollback(path)                          -> dict
        从最近一次快照恢复
    add(path, level) / remove(path) / list() / level_of(path)

清单存储：private/file_protection.json（项目根 private 目录）。
支持 glob 与目录前缀；readonly 优先级高于 critical，两级互斥。
任何异常都不阻断正常写入（内部兜底返回放行），避免把正常业务流程打断。
"""

import ast
import json
import os
import re
import tempfile
import time

# 模块自身位于 tools/coding/backend/，上溯 3 层即项目根
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
PRIVATE_DIR = os.path.join(PROJECT_ROOT, 'private')
LIST_FILE = os.path.join(PRIVATE_DIR, 'file_protection.json')
SNAPSHOT_DIR = os.path.join(PRIVATE_DIR, 'file_protect_snapshots')

LEVEL_READONLY = 'readonly'
LEVEL_CRITICAL = 'critical'

# 快照保留份数（关键文件长期可回滚）
MAX_SNAPSHOTS = 20

_cache = {'data': None, 'mtime': None, 'loaded_at': 0.0}


# ---------------------------------------------------------------- 清单读写

def _default_list():
    return {
        'critical': [],
        'readonly': [],
        'anchors': {},
    }


def _load():
    """按文件 mtime 增量刷新清单，避免进程内缓存读到旧数据。"""
    global _cache
    try:
        mtime = os.path.getmtime(LIST_FILE)
    except OSError:
        mtime = None
    if _cache['data'] is not None and _cache['mtime'] == mtime:
        return _cache['data']
    data = _default_list()
    try:
        if os.path.isfile(LIST_FILE):
            with open(LIST_FILE, 'r', encoding='utf-8') as f:
                raw = json.load(f)
            if isinstance(raw, dict):
                for k in ('critical', 'readonly'):
                    v = raw.get(k)
                    if isinstance(v, list):
                        data[k] = [str(x) for x in v if isinstance(x, str)]
                a = raw.get('anchors')
                if isinstance(a, dict):
                    data['anchors'] = {str(k): v for k, v in a.items() if isinstance(v, (list, str))}
    except Exception:
        pass
    _cache['data'] = data
    _cache['mtime'] = mtime
    _cache['loaded_at'] = time.time()
    return data


def _save(data):
    try:
        os.makedirs(PRIVATE_DIR, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=PRIVATE_DIR, suffix='.tmp')
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, LIST_FILE)
        _cache['data'] = data
        try:
            _cache['mtime'] = os.path.getmtime(LIST_FILE)
        except OSError:
            _cache['mtime'] = None
        return True
    except Exception:
        return False


def _norm(path):
    try:
        p = str(path or '').strip()
        if not p:
            return ''
        return os.path.abspath(os.path.expanduser(p)).replace('\\', '/').rstrip('/')
    except Exception:
        return str(path or '')


def _entries(level):
    return [x for x in (_load().get(level) or []) if x]


def _match(path, patterns):
    """path 命中 patterns 中任一条目即返回该条目（供报错指明规则）。

    支持三种写法：
      - 绝对路径 / 项目内绝对路径：精确或前缀（目录）匹配
      - 相对项目根的路径：转绝对后匹配
      - glob：用 fnmatch 匹配绝对路径与相对路径两种形态
    """
    p = _norm(path)
    if not p:
        return None
    rel = p[len(PROJECT_ROOT):].lstrip('/') if p.startswith(PROJECT_ROOT) else p
    for pat in patterns:
        raw = str(pat).strip()
        if not raw:
            continue
        cand = _norm(raw)
        if p == cand or p.startswith(cand + '/'):
            return raw
        if raw.endswith('/') and (rel + '/').startswith(raw):
            return raw
        if any(ch in raw for ch in '*?['):
            import fnmatch
            if fnmatch.fnmatch(p, cand) or fnmatch.fnmatch(rel, raw):
                return raw
    return None


def level_of(path):
    """返回文件所属保护级别；不在清单返回 None。readonly 优先。"""
    try:
        data = _load()
        if _match(path, data.get('readonly') or []):
            return LEVEL_READONLY
        if _match(path, data.get('critical') or []):
            return LEVEL_CRITICAL
    except Exception:
        return None
    return None


def check_write(path):
    """写入前闸门。

    返回 (ok, err)：
      - readonly          -> (False, 'readonly protected: ...')
      - critical          -> (True, 'critical protected: 需通过多重校验')  （提示用）
      - 不在清单/异常      -> (True, None)
    """
    try:
        lvl = level_of(path)
    except Exception:
        return True, None
    if lvl == LEVEL_READONLY:
        return False, ('readonly protected: %s 是只读保护文件，禁止写入/修改/删除。'
                       '如需变更请先在管理工具中移除只读保护。' % path)
    if lvl == LEVEL_CRITICAL:
        return True, ('critical protected: %s 是关键文件，本次修改已启用多重校验'
                      '（写前内容检查 + 写后回读比对），校验失败将自动回滚。' % path)
    return True, None


# ---------------------------------------------------------------- 校验逻辑

_GARBLE_CHARS = '\ufffd'
_CTRL_RE = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f]')
_REPEAT_RE = re.compile(r'(.)\1{80,}')


def _looks_garbled(text):
    """乱码/半损坏内容检测。返回 (is_bad, reason)。"""
    if not isinstance(text, str):
        return True, 'content is not text'
    if _GARBLE_CHARS in text:
        return True, 'contains replacement char U+FFFD（内容疑似乱码）'
    m = _CTRL_RE.search(text)
    if m:
        return True, 'contains control char 0x%02x（内容疑似二进制损坏）' % ord(m.group(1))
    if _REPEAT_RE.search(text):
        return True, 'contains abnormally repeated characters（内容疑似写坏）'
    if text and not text.strip():
        return True, 'content is blank（清空关键文件视为损坏）'
    return False, None


def _syntax_check(path, content):
    """按扩展名做语法校验。无法校验的类型放行。"""
    low = str(path).lower()
    try:
        if low.endswith('.py'):
            ast.parse(content, filename=str(path))
            return True, None
        if low.endswith(('.js', '.jsx', '.mjs', '.ts')):
            # JS 用 node --check（无 node 时跳过，不阻断）
            import subprocess
            fd, tmp = tempfile.mkstemp(suffix=os.path.splitext(path)[1], dir=PRIVATE_DIR if os.path.isdir(PRIVATE_DIR) else None)
            try:
                with os.fdopen(fd, 'w', encoding='utf-8') as f:
                    f.write(content)
                r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                if r.returncode != 0 and r.stderr:
                    return False, 'JS syntax check failed: ' + (r.stderr or '').strip()[:300]
            finally:
                try:
                    os.remove(tmp)
                except OSError:
                    pass
            return True, None
        if low.endswith('.json'):
            json.loads(content)
            return True, None
    except SyntaxError as e:
        return False, 'syntax check failed for %s: line %s: %s' % (path, getattr(e, 'lineno', '?'), getattr(e, 'msg', str(e)))
    except json.JSONDecodeError as e:
        return False, 'JSON syntax check failed for %s: line %s col %s: %s' % (path, getattr(e, 'lineno', '?'), getattr(e, 'colno', '?'), getattr(e, 'msg', str(e)))
    except Exception:
        # 缺 node 等环境问题不阻断
        return True, None
    return True, None


def _size_check(path, new_content):
    """体量突变检查：新内容相对旧内容缩水过多视为损坏。"""
    try:
        if not os.path.isfile(path):
            return True, None
        with open(path, 'r', encoding='utf-8', errors='replace') as f:
            old = f.read()
        old_len, new_len = len(old), len(new_content)
        if old_len >= 2000 and new_len < old_len * 0.5:
            return False, ('size dropped too much: %d -> %d bytes（原文件 %d 字节，'
                           '新内容仅 %d，疑似被截断）' % (old_len, new_len, old_len, new_len))
    except Exception:
        return True, None
    return True, None


def _anchor_check(path, new_content):
    """锚点检查：清单里登记的关键函数/类名是否还在。比语法检查更能抓"被删段"。"""
    try:
        anchors = _load().get('anchors') or {}
        keys = _match(path, list(anchors.keys()))
        if not keys:
            return True, None
        names = anchors.get(keys) or []
        if isinstance(names, str):
            names = [names]
        missing = []
        for n in names:
            n = str(n).strip()
            if n and n not in new_content:
                missing.append(n)
        if missing:
            return False, 'anchor missing: 关键定义 %s 不在新内容中（疑似被误删）' % ', '.join(missing)
    except Exception:
        return True, None
    return True, None


def precheck(path, new_content):
    """critical 文件写前校验。返回 (ok, err)。非 critical 直接放行。"""
    try:
        if level_of(path) != LEVEL_CRITICAL:
            return True, None
        if not isinstance(new_content, str):
            return False, 'content must be text'
        bad, reason = _looks_garbled(new_content)
        if bad:
            return False, reason
        ok, err = _syntax_check(path, new_content)
        if not ok:
            return False, err
        ok, err = _size_check(path, new_content)
        if not ok:
            return False, err
        ok, err = _anchor_check(path, new_content)
        if not ok:
            return False, err
    except Exception as e:
        # 校验自身异常不阻断（宁可放行也不要打断正常业务流程）
        return True, None
    return True, None


# ---------------------------------------------------------------- 快照与回滚

def _snap_paths(path):
    key = re.sub(r'[^0-9A-Za-z._-]', '_', _norm(path))[-120:]
    d = os.path.join(SNAPSHOT_DIR, key)
    return d, os.path.join(d, '%d.content' % int(time.time() * 1000))


def make_snapshot(path):
    """写入前为关键文件留存长期快照（区别于 create_backup 的滚动备份）。"""
    try:
        if not os.path.isfile(path):
            return None
        d, dst = _snap_paths(path)
        os.makedirs(d, exist_ok=True)
        with open(path, 'rb') as f:
            data = f.read()
        with open(dst, 'wb') as f:
            f.write(data)
        # 只保留最近 MAX_SNAPSHOTS 份
        files = sorted((os.path.join(d, x) for x in os.listdir(d)), key=os.path.getmtime)
        for old in files[:-MAX_SNAPSHOTS]:
            try:
                os.remove(old)
            except OSError:
                pass
        return dst
    except Exception:
        return None


def _normalize_for_compare(data):
    """比对前统一行尾与 BOM，避免文本模式写入的 CRLF 造成误判。"""
    if isinstance(data, str):
        data = data.encode('utf-8')
    # 去 UTF-8 BOM
    if data.startswith(b'\xef\xbb\xbf'):
        data = data[3:]
    # 统一行尾为 \n
    return data.replace(b'\r\n', b'\n')


def verify_after_write(path, expected):
    """写后回读比对：落盘内容是否等于拟写入内容。

    行尾差异（CRLF/LF）与 BOM 视为一致——write 工具以文本模式落盘，
    这些是平台差异而非损坏。
    """
    try:
        if not os.path.isfile(path):
            return False, 'file missing after write: %s' % path
        with open(path, 'rb') as f:
            actual = _normalize_for_compare(f.read())
        if isinstance(expected, str):
            try:
                want = _normalize_for_compare(expected.encode('utf-8'))
            except Exception:
                want = _normalize_for_compare(expected)
        else:
            want = _normalize_for_compare(expected or b'')
        if actual != want:
            return False, ('write-back mismatch: %s 落盘内容与拟写入内容不一致'
                           '（磁盘 %d 字节 / 预期 %d 字节，疑似写入被打断或损坏）'
                           % (path, len(actual), len(want)))
        bad, reason = _looks_garbled(actual.decode('utf-8', errors='replace'))
        if bad:
            return False, reason
    except Exception as e:
        return False, 'verify_after_write error: %s' % e
    return True, None


def rollback(path):
    """从最近一次快照恢复关键文件。返回 {'ok':bool, ...}。"""
    try:
        p = _norm(path)
        d, _ = _snap_paths(path)
        if not os.path.isdir(d):
            return {'ok': False, 'error': 'no snapshot for %s' % p}
        files = sorted((os.path.join(d, x) for x in os.listdir(d)), key=os.path.getmtime)
        if not files:
            return {'ok': False, 'error': 'snapshot dir empty for %s' % p}
        src = files[-1]
        with open(src, 'rb') as f:
            data = f.read()
        with open(p, 'wb') as f:
            f.write(data)
        return {'ok': True, 'path': p, 'restored_from': src, 'size': len(data)}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


# ---------------------------------------------------------------- 清单维护

def add(path, level=LEVEL_CRITICAL):
    """把文件加入清单。返回 {'ok':bool, ...}。"""
    try:
        p = _norm(path)
        if not p:
            return {'ok': False, 'error': 'empty path'}
        if level not in (LEVEL_READONLY, LEVEL_CRITICAL):
            return {'ok': False, 'error': 'level must be readonly or critical'}
        data = _load()
        other = LEVEL_READONLY if level == LEVEL_CRITICAL else LEVEL_CRITICAL
        # 两级互斥：从另一级移除
        data[other] = [x for x in (data.get(other) or []) if x.strip() != str(path).strip()]
        cur = data.get(level) or []
        if str(path).strip() not in [x.strip() for x in cur]:
            cur = cur + [str(path).strip()]
        data[level] = cur
        if _save(data):
            return {'ok': True, 'path': p, 'level': level, 'list': list_all()}
        return {'ok': False, 'error': 'save failed'}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def remove(path):
    try:
        p = str(path or '').strip()
        data = _load()
        before = sum(len(data.get(k) or []) for k in ('critical', 'readonly'))
        for k in ('critical', 'readonly'):
            data[k] = [x for x in (data.get(k) or []) if x.strip() != p]
        after = sum(len(data.get(k) or []) for k in ('critical', 'readonly'))
        if _save(data):
            return {'ok': True, 'removed': before - after, 'path': _norm(path), 'list': list_all()}
        return {'ok': False, 'error': 'save failed'}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def set_anchors(path, names):
    try:
        p = str(path or '').strip()
        if not p:
            return {'ok': False, 'error': 'empty path'}
        data = _load()
        if isinstance(names, str):
            names = [x for x in re.split(r'[,，;；\s]+', names) if x]
        data['anchors'][p] = [str(x) for x in (names or [])]
        if _save(data):
            return {'ok': True, 'path': _norm(p), 'anchors': data['anchors'][p]}
        return {'ok': False, 'error': 'save failed'}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def list_all():
    data = _load()
    return {
        'critical': list(data.get('critical') or []),
        'readonly': list(data.get('readonly') or []),
        'anchors': dict(data.get('anchors') or {}),
        'list_file': LIST_FILE,
    }


def init_default():
    """首次启用时写入一份默认清单（已存在则不覆盖）。"""
    try:
        if os.path.isfile(LIST_FILE):
            return {'ok': True, 'already': True}
        data = {
            'critical': [
                'server.py',
                'security.py',
                'config.py',
                'db.py',
                'private/file_protection.json',
                'tools/coding/backend/write.py',
                'tools/coding/backend/replace_text.py',
                'tools/coding/backend/_file_protect.py',
                'tools/coding/backend/_preflight.py',
                'tools/coding/backend/_pathguard.py',
            ],
            'readonly': [
                'private/file_protection.json',
            ],
            'anchors': {
                'server.py': ['def main'],
            },
        }
        # 清单自身只读：防止被自身规则误伤后无法恢复
        data['critical'] = [x for x in data['critical'] if x != 'private/file_protection.json']
        return {'ok': _save(data), 'default': True, 'list': list_all()}
    except Exception as e:
        return {'ok': False, 'error': str(e)}
