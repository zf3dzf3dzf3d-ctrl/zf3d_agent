#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""trash_intercept — 删除操作 100% 兜底（shell 命令改写层 + Python 钩子层共用）

目标：AI 执行工具（run_code 等）产生的"删除"动作，一律改为
  移入缓冲垃圾箱（<根>/system/trash/YYYYMMDD/）并在数据库 trash_items 表登记，
与 server/trash.py 共用同一张表、同一个垃圾箱根目录，
找回 / 强制删除 / 30 天过期清理全部沿用原有规则。

两个入口：
  1) rewrite_command(cmd, cwd)  —— shell 命令改写（tools/coding/backend/run.py、
     engines/codex_style 的 run_code 调用）
     支持 cmd 内建 del/erase/rd/rmdir、rm（Git Bash）、通配符、
     & && | || ; 拼接分段（引号与括号感知）、powershell -c（带/不带引号）内的
     Remove-Item 及别名（ri/del/erase/rm/rmdir/rd）。
  2) install_python_hooks()     —— Python 钩子（python/Lib/site-packages/sitecustomize.py
     自动安装）：补丁 os.remove / os.unlink / os.rmdir / shutil.rmtree。

放行（真删）条件：
  - 环境变量 TRASH_BYPASS=1 或命令文本含 TRASH_BYPASS=1（用户明确说"强制删除"时由 AI 设置）
  - 受保护路径：垃圾箱自身（=清空垃圾箱）、系统 TEMP、$Recycle.Bin、pip cache
  - 解析不了的复杂删除命令 → 原样放行 + 审计日志 + 结果备注（可观测，不静默）

审计：每次拦截/放行追加一行 JSON 到 <根>/system/trash/intercept.log
"""
import os
import re
import json
import glob
import time
import sqlite3

# 原生删除函数：在 install_python_hooks() 打补丁【之前】捕获（惰性），
# move_one 的跨盘 fallback 必须用它们，否则会二次入箱。
_NATIVE = {'remove': None, 'rmtree': None, 'rmdir': None}


# ---------- 路径推导（本文件位于 <根>/tools/coding/backend/，需上溯 4 层） ----------
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))))
TRASH_DIR = os.path.join(_ROOT, 'system', 'trash')
DB_PATH = os.path.join(_ROOT, 'private', 'db', 'zf3d_canvas.db')
RETENTION_DAYS = 30
AUDIT_LOG = os.path.join(TRASH_DIR, 'intercept.log')

# 与 server/trash.py 相同的表结构（幂等建表）
_TABLE_SQL = '''
    CREATE TABLE IF NOT EXISTS trash_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        orig_path TEXT NOT NULL,
        trash_path TEXT NOT NULL,
        name TEXT,
        size INTEGER DEFAULT 0,
        is_dir INTEGER DEFAULT 0,
        deleted_at INTEGER,
        expires_at INTEGER,
        source TEXT,
        restored INTEGER DEFAULT 0
    )
'''

# 删除类命令（小写）
_CMD_DELETE = {'del', 'erase', 'rd', 'rmdir', 'rm'}
# powershell 里 Remove-Item 的别名（小写）
_PS_DELETE = {'remove-item', 'ri', 'del', 'erase', 'rm', 'rmdir', 'rd'}
_PS_IGNORE_OPT = {'-recurse', '-force', '-confirm', '-whatif', '-verbose',
                  '-noninteractive', '-nologo', '-noexit', '-executionpolicy',
                  '-erroraction-silentlycontinue'}
_PS_PATH_OPT = {'-path', '-literalpath', '-lp'}


# ============================ 基础工具 ============================

def _within(path, folder):
    """path 是否在 folder 内（含相等）。先 realpath（解析 8.3 短名/软链）再比对。"""
    try:
        p = os.path.normcase(os.path.realpath(os.path.abspath(path)))
        f = os.path.normcase(os.path.realpath(os.path.abspath(folder)))
        return p == f or p.startswith(f.rstrip('\\') + os.sep)
    except Exception:
        return False


def _protected(rp):
    """受保护路径：这些位置的真删是合法清理语义，不拦截。"""
    if _within(rp, TRASH_DIR):          # 垃圾箱自身 = 清空垃圾箱/过期清理
        return True
    low = os.path.normcase(rp).lower()
    if '$recycle.bin' in low:           # Windows 回收站
        return True
    tmp_env = os.environ.get('TEMP') or os.environ.get('TMP')   # 系统 TEMP（缓存清理合法）
    if tmp_env and _within(rp, os.path.normcase(os.path.abspath(os.path.expanduser(tmp_env)))):
        return True
    pip_cache = os.path.join(os.path.expanduser('~'), 'AppData', 'Local', 'pip', 'cache')
    if _within(rp, pip_cache):          # pip 缓存清理合法
        return True
    return False


def _audit(record):
    """追加一行 JSON 审计日志（失败静默，不影响主流程）。"""
    try:
        os.makedirs(TRASH_DIR, exist_ok=True)
        record = dict(record)
        record.setdefault('ts', time.strftime('%Y-%m-%d %H:%M:%S'))
        with open(AUDIT_LOG, 'a', encoding='utf-8') as f:
            f.write(json.dumps(record, ensure_ascii=False) + '\n')
    except Exception:
        pass


def _bypass_env(cmd=None):
    """TRASH_BYPASS=1 时放行（命令文本里 set TRASH_BYPASS=1 也会被检测到）。"""
    if os.environ.get('TRASH_BYPASS', '').strip() == '1':
        return True
    if cmd and re.search(r'(?i)\bTRASH_BYPASS\s*=\s*1\b', cmd):
        return True
    return False


# ============================ 移入垃圾箱 ============================

def _unique_dst(directory, name):
    dst = os.path.join(directory, name)
    if not os.path.exists(dst):
        return dst
    base, ext = os.path.splitext(name)
    i = 2
    while True:
        dst = os.path.join(directory, '%s(%d)%s' % (base, i, ext))
        if not os.path.exists(dst):
            return dst
        i += 1


def _dir_size(path):
    total = 0
    if os.path.isfile(path):
        try:
            return os.path.getsize(path)
        except OSError:
            return 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


def _hard_delete_file(p):
    """跨盘 fallback 用的原生单文件删除（绝不走补丁）。"""
    fn = _NATIVE['remove']
    if fn is not None:
        try:
            fn(p)
            return
        except OSError:
            pass
    # 终极兜底：cmd 内建 del（子进程，不受 Python 补丁影响）
    try:
        import subprocess
        subprocess.run('del /f /q "%s"' % p, shell=True,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
                       capture_output=True, timeout=30)
    except Exception:
        pass


def _hard_rmtree(p):
    """跨盘 fallback 用的原生目录删除（绝不走补丁）。"""
    fn = _NATIVE['rmtree']
    if fn is not None:
        try:
            fn(p, ignore_errors=True)
            return
        except Exception:
            pass
    try:
        import subprocess
        subprocess.run('rd /s /q "%s"' % p, shell=True,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
                       capture_output=True, timeout=60)
    except Exception:
        pass


def move_one(rp, source='shell'):
    """把已存在的真实路径移入垃圾箱并登记 trash_items 表。返回记录 dict。"""
    day_dir = os.path.join(TRASH_DIR, time.strftime('%Y%m%d'))
    os.makedirs(day_dir, exist_ok=True)
    tpath = _unique_dst(day_dir, os.path.basename(rp) or 'unnamed')

    # 同盘 rename 一次到位；跨盘 fallback：复制 + 原生删除（复制已保证数据在垃圾箱）
    try:
        os.rename(rp, tpath)
    except OSError:
        import shutil as _sh
        if os.path.isdir(rp):
            try:
                _sh.copytree(rp, tpath)
                _hard_rmtree(rp)
            except Exception:
                pass
        else:
            try:
                _sh.copy2(rp, tpath)
                _hard_delete_file(rp)
            except Exception:
                pass

    size = _dir_size(tpath)
    is_dir = 1 if os.path.isdir(tpath) else 0
    now = int(time.time() * 1000)
    expires = now + RETENTION_DAYS * 86400 * 1000
    item_id = None
    try:
        conn = sqlite3.connect(DB_PATH, timeout=30)
        try:
            conn.execute(_TABLE_SQL)
            conn.execute('CREATE INDEX IF NOT EXISTS idx_trash_expires ON trash_items(expires_at)')
            cur = conn.execute(
                '''INSERT INTO trash_items
                   (orig_path, trash_path, name, size, is_dir, deleted_at, expires_at, source, restored)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)''',
                [rp, tpath, os.path.basename(tpath), size, is_dir, now, expires, source])
            item_id = cur.lastrowid
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        # 物理文件已在垃圾箱，登记失败不影响删除安全性，只记审计
        _audit({'action': 'db_error', 'path': rp, 'trash_path': tpath, 'error': str(e)})
    return {'id': item_id, 'orig_path': rp, 'trash_path': tpath,
            'name': os.path.basename(tpath), 'size': size,
            'is_dir': bool(is_dir), 'source': source}


def _move_targets(targets, source, cwd=None):
    """批量移入。返回 (moved, skipped)；每个 moved/skipped 是 dict。"""
    moved, skipped = [], []
    for t in targets:
        try:
            rp = os.path.realpath(_resolve(t, cwd))
        except Exception:
            skipped.append({'path': t, 'reason': 'bad_path'})
            continue
        if _protected(rp):
            skipped.append({'path': t, 'reason': 'protected'})
            continue
        if not os.path.lexists(rp):
            skipped.append({'path': t, 'reason': 'not_found'})
            continue
        try:
            moved.append(move_one(rp, source))
        except Exception as e:
            skipped.append({'path': t, 'reason': 'error: %s' % e})
    return moved, skipped


def _resolve(t, cwd):
    """把目标解析为绝对路径（相对路径以命令的 cwd 为基准，而非进程 CWD）。"""
    if not os.path.isabs(t):
        base = cwd if cwd and os.path.isdir(cwd) else os.getcwd()
        t = os.path.join(base, t)
    return t


def _expand(p, cwd=None):
    """展开通配符与用户/环境变量目录。返回路径列表（可能为空）。
    相对路径以命令 cwd 为基准（glob 也要在正确目录下展开）。"""
    p = os.path.expanduser(os.path.expandvars(p))
    if cwd and not os.path.isabs(p):
        p = os.path.join(cwd, p)
    if any(ch in p for ch in '*?'):
        return sorted(glob.glob(p))
    if '[' in p and not os.path.exists(p):
        return sorted(glob.glob(p))  # 疑似通配符
    return [p]


# ============================ 分词 / 分段 ============================

def _tokens(s):
    """按空白分词，感知成对引号（引号本身不出现在结果里）。"""
    toks, buf, q = [], '', None
    for c in s:
        if q:
            if c == q:
                q = None
            else:
                buf += c
            continue
        if c in '"\'':
            q = c
            continue
        if c.isspace():
            if buf:
                toks.append(buf)
                buf = ''
            continue
        buf += c
    if buf:
        toks.append(buf)
    return toks


def _split_segments(cmd, chars='&|;'):
    """顶层分段：引号/括号感知，按 chars 中字符切分（&& || 连续两字符一并切）。

    返回 (segs, ops)：segs 为段列表，ops 为每段后的连接符（用于原样重组）。
    """
    segs, ops, buf = [], [], ''
    q = None
    depth = 0
    i, n = 0, len(cmd)
    while i < n:
        c = cmd[i]
        if q:
            buf += c
            if c == q:
                q = None
            i += 1
            continue
        if c in '"\'':
            q = c
            buf += c
            i += 1
            continue
        if c == '(':
            depth += 1
        elif c == ')':
            depth = max(0, depth - 1)
        if depth == 0 and c in chars:
            j = i + 1
            while j < n and cmd[j] == c:
                j += 1
            segs.append(buf)
            ops.append(cmd[i:j])
            buf = ''
            i = j
            continue
        buf += c
        i += 1
    segs.append(buf)
    return segs, ops


# ============================ shell 段解析 ============================

def _parse_shell_del(toks):
    """解析 del/erase/rd/rmdir/rm 段。返回目标列表；None 表示无法安全解析。"""
    head = toks[0].lower()
    is_rmdir = head in ('rd', 'rmdir')
    is_del = head in ('del', 'erase')
    targets = []
    i = 1
    while i < len(toks):
        t = toks[i]
        if t.startswith('/') or t.startswith('-'):
            tl = t.lower()
            if head == 'rm' and tl in ('-r', '-f', '-rf', '-fr', '-rv', '-vr',
                                       '-rd', '-dr', '-v', '-d', '-i'):
                i += 1
                continue
            if is_rmdir and tl in ('/s', '/q', '-s', '-q'):
                i += 1
                continue
            if is_del and tl in ('/f', '/q', '/s', '/p', '/a', '/ar', '/ah',
                                 '/as', '/aa', '/a:h', '/a:r', '/a:s', '/a:a'):
                i += 1
                continue
            return None  # 未知的开关，保守放行
        if '%' in t or '$' in t:
            # 含变量/展开式：静态无法确认目标，保守放行（有审计）
            return None
        targets.append(t)
        i += 1
    return targets


# ============================ powershell 段解析 ============================

_PS_QUOTED_RE = re.compile(
    r'^\s*powershell(?:\.exe)?\s+(-c|-command)\s+"(.*)"\s*$', re.I | re.S)
_PS_BARE_RE = re.compile(
    r'^\s*powershell(?:\.exe)?\s+(-c|-command)\s+(.+)$', re.I | re.S)


def _parse_ps_sub(sub):
    """解析 PS 子段。返回 (targets|None, _)。None=无法安全解析；[]=无目标(非删除)。"""
    toks = _tokens(sub)
    if not toks:
        return None
    if toks[0].lower() not in _PS_DELETE:
        return None
    targets = []
    i = 1
    while i < len(toks):
        t = toks[i]
        tl = t.lower()
        if t.startswith('-'):
            if tl in _PS_IGNORE_OPT:
                i += 1
                continue
            if tl in ('-erroraction', '-ea'):
                i += 2  # 选项 + 值
                continue
            if tl in _PS_PATH_OPT:
                if i + 1 >= len(toks):
                    return None
                targets.append(toks[i + 1])
                i += 2
                continue
            return None  # 未知选项
        if '$' in t or '`' in t:
            return None  # 含 PS 变量/转义，无法静态解析
        targets.append(t)
        i += 1
    return targets


def _handle_ps_body(body, cwd, source, notes, stats):
    """处理 PS 命令体：';' 分段逐段解析删除。返回 (new_body, changed)。"""
    subs, ops = _split_segments(body, chars=';')
    new_subs = []
    changed = False
    for idx, sub in enumerate(subs):
        sub = sub.strip()
        targets = _parse_ps_sub(sub)
        if targets is None:
            if _DELETE_HINT_RE.search(sub):
                notes.append('[zf-trash] 无法解析的 PowerShell 删除按原样执行(已审计): %s'
                             % sub[:120])
                _audit({'action': 'passthrough_unparsed', 'cmd': sub[:500],
                        'cwd': cwd, 'source': source + ':ps'})
            new_subs.append(sub)
            if idx < len(ops):
                new_subs.append(ops[idx])
            continue
        if not targets:
            new_subs.append(sub)
            if idx < len(ops):
                new_subs.append(ops[idx])
            continue
        expanded = []
        for t in targets:
            expanded.extend(_expand(t, cwd))
        moved, skipped = _move_targets(expanded, source + ':ps', cwd)
        stats['moved'].extend(os.path.basename(x['trash_path']) for x in moved)
        stats['skipped'].extend('%s(%s)' % (os.path.basename(x['path']), x['reason'])
                                for x in skipped)
        if moved:
            changed = True
            notes.append('[zf-trash] 已拦截删除并移入垃圾箱: %s'
                         % ', '.join(os.path.basename(x['trash_path']) for x in moved))
        if skipped:
            notes.append('[zf-trash] 跳过(未移动): %s' % ', '.join(
                '%s(%s)' % (os.path.basename(x['path']), x['reason']) for x in skipped))
        new_subs.append(_echo_seg('zf-trash',
                                  [os.path.basename(x['trash_path']) for x in moved] +
                                  ['%s(%s)' % (os.path.basename(x['path']), x['reason'])
                                   for x in skipped]))
        if idx < len(ops):
            new_subs.append(ops[idx])
    return ''.join(new_subs), changed


def _esc_echo(s):
    """cmd echo 文本转义（% 用 %%，其余用 ^）。"""
    s = s.replace('%', '%%')
    return re.sub(r'([&<>|^"])', r'^\1', s)


def _echo_seg(prefix, names):
    body = ', '.join(names) if names else 'nothing'
    return 'echo [%s] %s' % (prefix, _esc_echo(body[:600]))


# ============================ 主入口 ============================

_DELETE_HINT_RE = re.compile(
    r'(?i)(^|\s|["\';&|(])(del|erase|rd|rmdir|rm|remove-item|ri)\s')


def rewrite_command(cmd, cwd, source='shell'):
    """返回 (new_cmd, notes)。notes 为给 AI 的说明列表（无改动时为 None）。

    规则：
      - 每个可安全解析的删除段 → 立即把目标移入垃圾箱，段改写为 echo 占位
      - 无法解析但疑似删除的段 → 原样放行 + 审计 + 备注（不静默）
      - TRASH_BYPASS=1 → 整条命令原样放行（强制删除）
    """
    notes = []
    stats = {'moved': [], 'skipped': []}

    if _bypass_env(cmd):
        _audit({'action': 'bypass', 'cmd': cmd[:500], 'cwd': cwd, 'source': source})
        return cmd, ['[zf-trash] TRASH_BYPASS=1，本命令按强制删除原样执行']

    segs, ops = _split_segments(cmd)
    out = []
    changed = False

    for idx, seg in enumerate(segs):
        seg = seg.strip()
        new_seg = None

        # --- powershell -c "..."（带引号）---
        m = _PS_QUOTED_RE.match(seg)
        if m:
            new_body, body_changed = _handle_ps_body(m.group(2), cwd, source, notes, stats)
            if body_changed:
                stats['moved'] and _audit({'action': 'intercept', 'cmd': seg[:500],
                                           'cwd': cwd, 'source': source + ':ps',
                                           'moved': stats['moved'][:50]})
                changed = True
                new_seg = 'powershell -c "%s"' % new_body
        else:
            # --- powershell -c ...（不带引号）---
            m2 = _PS_BARE_RE.match(seg)
            if m2 and not seg.lower().startswith('powershell -c -enc') \
                    and 'encodedcommand' not in seg.lower():
                new_body, body_changed = _handle_ps_body(m2.group(2), cwd, source,
                                                         notes, stats)
                if body_changed:
                    changed = True
                    new_seg = 'powershell -c %s' % new_body
            elif m2:
                _audit({'action': 'passthrough_encoded', 'cmd': seg[:500],
                        'cwd': cwd, 'source': source + ':ps'})
                notes.append('[zf-trash] EncodedCommand 无法审计，已原样放行')

        # --- 普通段 ---
        if new_seg is None:
            toks = _tokens(seg)
            if toks and toks[0].lower() in _CMD_DELETE:
                targets = _parse_shell_del(toks)
                if targets is None:
                    notes.append('[zf-trash] 无法解析的删除命令按原样执行(已审计): %s'
                                 % seg[:120])
                    _audit({'action': 'passthrough_unparsed', 'cmd': seg[:500],
                            'cwd': cwd, 'source': source})
                elif not targets:
                    pass
                else:
                    expanded = []
                    for t in targets:
                        expanded.extend(_expand(t, cwd))
                    moved, skipped = _move_targets(expanded, source, cwd)
                    if moved:
                        changed = True
                        names = [os.path.basename(x['trash_path']) for x in moved]
                        stats['moved'].extend(names)
                        _audit({'action': 'intercept', 'cmd': seg[:500], 'cwd': cwd,
                                'source': source, 'moved': names,
                                'skipped': ['%s(%s)' % (os.path.basename(x['path']),
                                                        x['reason']) for x in skipped]})
                        notes.append('[zf-trash] 已拦截删除并移入垃圾箱: %s'
                                     % ', '.join(names))
                    if skipped:
                        notes.append('[zf-trash] 跳过(未移动): %s' % ', '.join(
                            '%s(%s)' % (os.path.basename(x['path']), x['reason'])
                            for x in skipped))
                    new_seg = _echo_seg(
                        'zf-trash',
                        [os.path.basename(x['trash_path']) for x in moved] +
                        ['%s(%s)' % (os.path.basename(x['path']), x['reason'])
                         for x in skipped])
            elif new_seg is None and _DELETE_HINT_RE.search(seg):
                # for/if 等复合结构中的删除：放行但审计（可观测）
                _audit({'action': 'passthrough_complex', 'cmd': seg[:500],
                        'cwd': cwd, 'source': source})

        out.append(new_seg if new_seg is not None else seg)
        if idx < len(ops):
            out.append(ops[idx])

    if not changed:
        return cmd, (notes if notes else None)

    new_cmd = ''.join(out)
    if stats['moved']:
        _audit({'action': 'intercept_summary', 'cwd': cwd, 'source': source,
                'moved': stats['moved'][:100], 'total': len(stats['moved'])})
    return new_cmd, notes


# ============================ Python 钩子层 ============================

def install_python_hooks():
    """补丁 os.remove/unlink/rmdir + shutil.rmtree。
    由 python/Lib/site-packages/sitecustomize.py 在解释器启动时自动调用。
    必须在任何补丁生效前调用（sitecustomize 早于一切用户代码）。
    """
    import shutil

    if getattr(shutil, '_zf_trash_patched', False):
        return True
    if os.environ.get('TRASH_BYPASS', '').strip() == '1':
        return False

    # 先捕获原生函数（补丁前的实现），供跨盘 fallback / 内部清理使用
    _NATIVE['remove'] = os.remove
    _NATIVE['rmtree'] = shutil.rmtree
    _NATIVE['rmdir'] = os.rmdir

    # 预热 tempfile：其首次初始化会创建/删除探测文件，必须发生在钩子安装前，
    # 否则探测文件的删除会再触发 _guard -> _protected -> gettempdir 递归死锁
    try:
        import tempfile as _tf
        _tf.gettempdir()
    except Exception:
        pass

    busy = {'v': False}

    def _guard(path):
        """返回 True 表示放行给原函数。"""
        if busy['v']:
            return True
        # 实时检查 BYPASS：进程启动后才设置 TRASH_BYPASS=1 也要生效（强制删除）
        if os.environ.get('TRASH_BYPASS', '').strip() == '1':
            return True
        try:
            rp = os.path.realpath(os.fspath(path))
        except Exception:
            return True
        if not os.path.lexists(rp):
            return True   # 让原函数抛正常的 FileNotFoundError
        if _protected(rp):
            return True
        return False

    def _to_trash(path, fn_name):
        """返回 True=已移入垃圾箱；False=交回原函数处理。"""
        if _guard(path):
            return False
        rp = os.path.realpath(os.fspath(path))
        busy['v'] = True
        try:
            rec = move_one(rp, 'python:%s' % fn_name)
            _audit({'action': 'intercept', 'cmd': 'py:%s(%s)' % (fn_name, rp),
                    'source': 'python',
                    'moved': [os.path.basename(rec['trash_path'])]})
            return True
        except Exception as e:
            _audit({'action': 'hook_error', 'path': rp, 'error': str(e),
                    'source': 'python'})
            return False
        finally:
            busy['v'] = False

    def _remove(path, *a, **kw):
        if not _to_trash(path, 'os.remove'):
            return _NATIVE['remove'](path, *a, **kw)

    def _unlink(path, *a, **kw):
        if not _to_trash(path, 'os.unlink'):
            return _NATIVE['remove'](path, *a, **kw)

    def _rmdir(path, *a, **kw):
        if not _to_trash(path, 'os.rmdir'):
            return _NATIVE['rmdir'](path, *a, **kw)

    def _rmtree(path, *a, **kw):
        if not _to_trash(path, 'shutil.rmtree'):
            return _NATIVE['rmtree'](path, *a, **kw)

    os.remove = _remove
    os.unlink = _unlink
    os.rmdir = _rmdir
    shutil.rmtree = _rmtree
    shutil._zf_trash_patched = True
    return True


if __name__ == '__main__':
    # 自测：python trash_intercept.py "del a.txt" <cwd>
    import sys
    _c = sys.argv[1] if len(sys.argv) > 1 else ''
    _w = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()
    _nc, _n = rewrite_command(_c, _w)
    print('NEW_CMD:', _nc)
    print('NOTES:', _n)
