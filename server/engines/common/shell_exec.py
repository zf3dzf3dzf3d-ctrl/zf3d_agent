# -*- coding: utf-8 -*-
"""统一的 shell 执行入口（修复：Windows cmd.exe 不支持多行命令导致静默截断、假成功）。

规则：
- Linux/Mac：原样 shell=True 执行（bash 天然支持多行）。
- Windows 单行：原样 cmd.exe 执行（行为不变）。
- Windows 多行：
  * 若是 `python -c` / `py -c` 多行脚本 → 拆出解释器与参数，脚本整体作为单个
    argv 参数直接传给解释器（绕过 cmd 解析，换行安全）。
  * 其余多行命令 → 写入临时 .bat 用 `cmd /c` 执行（批处理天然按行执行）。
返回 (returncode, stdout_bytes, stderr_bytes, note)，note 为执行方式说明（可为空）。
"""
import logging
import os
import re
import subprocess
import tempfile
import time

# server 自身目录（兜底 cwd），多行 .bat 也可安全落这里
_SERVER_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 活动项目兜底解析的缓存（{pid, path, ts}），避免兜底路径反复查 DB；
# 项目切换由 kv 写入接口主动调用 invalidate_cwd_cache() 失效；
# 保留 60 秒兜底 TTL 作为被动防御：若失效调用路径被绕过/异常，
# 缓存最多滞后 60 秒后自动回源 DB，不会静默兜底到旧项目路径
_CACHE_TTL = 60
_cache = {}


def invalidate_cwd_cache():
    """主动清空 cwd 兜底缓存（活动项目切换时由 API 层调用）。永不抛异常。"""
    try:
        _cache.clear()
    except Exception:
        pass


def _resolve_cwd(cwd):
    """统一 cwd 解析（阶段一收口）：
    1) cwd 存在且为目录 → 原样使用；
    2) cwd 为空/不存在 → 从 DB 取全局活动项目(kv_store.active_project_id)的 folder_path；
    3) 仍取不到或目录不存在 → 回退 server 目录。永不抛异常。
    返回 (生效cwd, 兜底说明 or '')。
    活动项目解析结果走缓存（主动失效 + 60 秒兜底 TTL），避免兜底高频路径反复查 DB。
    """
    try:
        if cwd and os.path.isdir(str(cwd)):
            return str(cwd), ''
        fallback = ''
        if cwd:
            fallback = ' (原cwd无效: %r)' % cwd
        # 缓存复用：主动失效(kv 切换调 invalidate_cwd_cache) + 60 秒兜底 TTL 双保险；
        # 复用时目录仍需存在，目录消失同样回源 DB
        try:
            cached_pid = _cache.get('pid')
            if time.time() - _cache.get('ts', 0) < _CACHE_TTL and cached_pid:
                p = _cache.get('path')
                if p and os.path.isdir(p):
                    return p, '[cwd 兜底→活动项目]%s' % fallback
        except Exception:
            pass
        try:
            from db import get_db, _db_lock
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                row = cur.execute(
                    "SELECT value FROM kv_store WHERE key='active_project_id' LIMIT 1").fetchone()
                root = None
                if row and str(row[0] or '').strip():
                    pid = str(row[0]).strip()
                    r2 = cur.execute(
                        'SELECT folder_path FROM projects WHERE id=?', (pid,)).fetchone()
                    if r2 and str(r2[0] or '').strip():
                        root = str(r2[0])
                conn.close()
            if root and os.path.isdir(root):
                _cache['pid'] = pid
                _cache['path'] = root
                _cache['ts'] = time.time()
                return root, '[cwd 兜底→活动项目]%s' % fallback
        except Exception as e:
            logging.info('run_shell cwd 兜底解析失败: %s' % e)
        return _SERVER_DIR, '[cwd 兜底→server目录]%s' % fallback
    except Exception:
        return cwd or os.getcwd(), ''

_PY_RE = re.compile(
    r'^\s*(?:"[^"]*python[^"]*"|\'[^\']*python[^\']*\'|[A-Za-z]:[^ ]*python[^ ]*|py(?:thon)?(?:w)?(?:\.\w+)?)\s+(?:-[A-Za-z]\S*\s+)*-c\b',
    re.IGNORECASE,
)


def _split_py_c(code):
    """把 `python -X -c <多行脚本>` 拆成 (argv列表, 剩余脚本)。不是该形态返回 None。"""
    m = _PY_RE.match(code)
    if not m:
        return None
    prefix = code[: m.end()]          # 例如: python -u -c
    script = code[m.end():].strip()   # 脚本本体（含换行）
    # 安全检查：-c 之后若含引号外的 shell 分隔符（&& || ; | & 换行），说明
    # `-c` 脚本后面还拼接了其他命令，整段不适合作为单个 argv 传给解释器，
    # 交回 .bat 方案处理，避免拆错。
    quote = None
    for ch in script:
        if quote:
            if ch == quote:
                quote = None
        elif ch in ('"', "'"):
            quote = ch
        elif ch in (';', '|', '&'):
            return None
    # 引号包裹校验：若以引号开头，必须由对应引号收尾（包裹全部剩余内容），
    # 否则说明 -c 后还有其他参数/命令，交回 .bat 方案。
    if len(script) >= 1 and script[0] in ('"', "'"):
        if len(script) < 2 or script[-1] != script[0]:
            return None
    # 去掉包裹整段脚本的引号：python -c "print(1)\nprint(2)"
    if len(script) >= 2 and script[0] == script[-1] and script[0] in '"\'':
        script = script[1:-1]
    try:
        import shlex
        argv = shlex.split(prefix, posix=False)
    except ValueError:
        argv = prefix.split()
    # shlex.split 会保留引号，统一剥掉；-c 保留
    argv = [a.strip('"\'') for a in argv]
    return argv, script


def _inject_git_c(cmd, cwd):
    """git 仓库跟随强制钩子：
    - 检测 shell 命令中的 git 调用，凡未显式带 `-C` 的，自动注入 `git -C <cwd>`；
    - 显式带 `-C` 的保持不变（由调用方负责路径正确）。
    cwd 为空时原样返回。防止多项目/多仓库场景下 git 操作落到错误的默认目录。
    """
    if not cwd:
        return cmd
    # 字符级扫描切段（&& || ; | & 换行），跳过引号内的分隔符，
    # 只判定每段首 token 是否为 git，避免字符串参数里的 git 词/分隔符被误处理
    _SEG_RE = re.compile(r'(\s*(?:&&|\|\||;|\||&|\n)\s*)')

    def _split_segments(cmd):
        segs, buf, i, quote = [], [], 0, None
        while i < len(cmd):
            ch = cmd[i]
            if quote:
                buf.append(ch)
                if ch == quote:
                    quote = None
                i += 1
                continue
            if ch in ('"', "'"):
                quote = ch
                buf.append(ch)
                i += 1
                continue
            two = cmd[i:i + 2]
            if two in ('&&', '||') or ch in (';', '|', '&', '\n'):
                segs.append(''.join(buf))
                buf = [two if len(two) == 2 else ch]
                i += 2 if (len(two) == 2 and two in ('&&', '||')) else 1
                segs.append(''.join(buf))
                buf = []
                continue
            buf.append(ch)
            i += 1
        segs.append(''.join(buf))
        return segs

    def _fix_segment(seg):
        s = seg.strip()
        toks = s.split()
        if not toks or toks[0] != 'git':
            return seg
        if len(toks) > 1 and toks[1] in ('-C', '--git-dir', '--work-tree'):
            return seg
        lead = seg[: len(seg) - len(seg.lstrip())]  # 保留前导空白
        tail = seg[len(seg.rstrip()):]              # 保留尾随空白
        return lead + ' '.join(['git -C "%s"' % cwd] + toks[1:]) + tail

    parts = _split_segments(cmd)
    return ''.join(p if _SEG_RE.fullmatch(p) else _fix_segment(p)
                   for p in parts)


def run_shell(cmd, timeout=60, cwd=None):
    """返回 (returncode, stdout_bytes, stderr_bytes, note)。

    note 末尾统一附加 [cwd: <实际生效工作目录>]（阶段二回显），
    cwd 为空/无效时按 _resolve_cwd 兜底（活动项目 → server 目录）。
    """
    cwd, cwd_note = _resolve_cwd(cwd)
    cwd_tag = '[cwd: %s]' % cwd
    cmd = _inject_git_c(cmd, cwd)

    # P0 沙箱：Windows 下统一走 Job Object 资源围栏（off/非 Windows 直通）
    try:
        from engines.common.sandbox import sandbox_mode, run_isolated
        if sandbox_mode() == 'job':
            p = run_isolated(cmd, timeout=timeout, cwd=cwd, shell=True)
            note_parts = [cwd_note, getattr(p, 'sandbox_note', ''), cwd_tag]
            return p.returncode, p.stdout or b'', p.stderr or b'', ' '.join(filter(None, note_parts))
    except ImportError:
        pass
    if os.name != 'nt' or '\n' not in cmd.strip():
        p = subprocess.run(cmd, shell=True, capture_output=True,
                           timeout=timeout, cwd=cwd,
                           creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        return p.returncode, p.stdout or b'', p.stderr or b'', ' '.join(filter(None, [cwd_note, cwd_tag]))

    # --- Windows 多行 ---
    pc = _split_py_c(cmd)
    if pc:
        argv, script = pc
        try:
            from engines.common.sandbox import sandbox_mode, run_isolated
            if sandbox_mode() == 'job':
                p = run_isolated(argv + [script], timeout=timeout, cwd=cwd, shell=False)
                note = ' '.join(filter(None, ['[multi-line via interpreter argv]',
                                              getattr(p, 'sandbox_note', ''), cwd_note, cwd_tag]))
                return p.returncode, p.stdout or b'', p.stderr or b'', note
        except ImportError:
            pass
        try:
            p = subprocess.run(argv + [script], capture_output=True,
                               timeout=timeout, cwd=cwd,
                               creationflags=subprocess.CREATE_NO_WINDOW)
            return p.returncode, p.stdout or b'', p.stderr or b'', ' '.join(filter(None, ['[multi-line via interpreter argv]', cwd_note, cwd_tag]))
        except Exception as e:
            # argv 直传失败不再静默，把原因写进 note 落回 .bat 方案
            note = '[multi-line via temp .bat, interpreter argv failed: %r] %s' % (e, cwd_note)

    # .bat 统一落系统临时目录（避免进程被 kill 时残留在项目目录），
    # 通过 `cd /d` 在批处理内切换到目标 cwd
    fd, bat = tempfile.mkstemp(suffix='.bat', dir=None, prefix='_ml_')
    note = locals().get('note') or None
    if not note:
        note = ' '.join(filter(None, ['[multi-line via temp .bat]', cwd_note]))
        note = note.strip()
    else:
        note = ' '.join(filter(None, [note, cwd_note]))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', errors='replace') as f:
            # UTF-8 写入 + chcp 65001，避免中文/emoji 在 mbcs 下乱码或改变语义
            f.write('@echo off\r\n')
            f.write('chcp 65001 >nul\r\n')
            if cwd and os.path.isdir(cwd):
                f.write('cd /d "%s"\r\n' % str(cwd).replace('%', '%%'))
            # cmd 批处理中 % 是变量展开符，写 .bat 前转义为 %%，防止
            # 代码中的 %（格式化字符串/URL encode 等）被静默吞掉或展开错
            f.write(cmd.replace('%', '%%').replace('\r\n', '\n').replace('\n', '\r\n'))
            f.write('\r\nexit /b %errorlevel%\r\n')
        from engines.common.sandbox import sandbox_mode, run_isolated as _ri
        if sandbox_mode() == 'job':
            p = _ri(['cmd', '/c', bat], timeout=timeout, cwd=cwd, shell=False)
        else:
            p = subprocess.run(['cmd', '/c', bat],
                               capture_output=True, timeout=timeout,
                               cwd=cwd, creationflags=subprocess.CREATE_NO_WINDOW)
        return p.returncode, p.stdout or b'', p.stderr or b'', ' '.join(filter(None, [note, cwd_tag]))
    finally:
        try:
            os.remove(bat)
        except OSError:
            pass
