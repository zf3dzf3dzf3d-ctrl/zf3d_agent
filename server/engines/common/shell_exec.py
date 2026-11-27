# -*- coding: utf-8 -*-
"""统一的 shell 执行入口（第 3 步职责分离重构后的薄编排层）。

原五类职责已拆分：
- cwd 兜底解析  → engines/common/cwd_resolver.py（本文件 re-export 保持兼容）
- git -C 注入   → engines/common/git_inject.py（本文件 re-export 保持兼容）
- python -c 拆分、熔断计数、9009 重试、友好报错、多行执行 → 本文件保留

规则：
- Linux/Mac：原样 shell=True 执行（bash 天然支持多行）。
- Windows 单行：原样 cmd.exe 执行（行为不变）。
- Windows 多行：
  * 若是 `python -c` / `py -c` 多行脚本 → 拆出解释器与参数，脚本整体作为单个
    argv 参数直接传给解释器（绕过 cmd 解析，换行安全）。
  * 其余多行命令 → 写入临时 .bat 用 `cmd /c` 执行（批处理天然按行执行）。
返回 (returncode, stdout_bytes, stderr_bytes, note)，note 为执行方式说明（可为空）。
"""
import os
import re
import subprocess
import tempfile
import time

# ===== 兼容 re-export：外部调用方（api_dispatch_post.py、main_brain_llm_tools.py
# 等仍 import shell_exec.invalidate_cwd_cache / _inject_git_c / _resolve_cwd）无感迁移 =====
from engines.common.cwd_resolver import (  # noqa: F401
    _SERVER_DIR, invalidate_cwd_cache, _resolve_cwd,
)
from engines.common.git_inject import inject_git_c as _inject_git_c  # noqa: F401

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


# ===== 失败熔断状态（A 项）：同一段命令连续失败计数（进程内，60 秒滚动窗口）=====
_FAIL_TTL = 60
_fail_counts = {}  # {cmd_hash: (count, first_fail_ts, cmd_head)}


def _friendly_shell_error(rc, stderr_text):
    """B 项：把常见失败退出码翻译成中文提示，stderr 为空时给出可行动指引。"""
    if rc == 9009:
        return ('命令未找到（退出码 9009）：系统在 PATH 中找不到该程序。'
                '若是 python/py，请使用项目自带解释器完整路径，'
                '或先确认程序已安装。')
    if rc == 1 and not stderr_text.strip():
        return ('命令以退出码 1 失败且无任何输出：可能是命令语法错误或被 shell '
                '静默吞掉，建议先运行 `where 程序名` 或拆小命令验证。')
    return ''


def _retry_with_project_python(cmd, timeout, cwd):
    """B 项：裸 `python`/`py` 调用 9009 时，改用项目自带解释器绝对路径重试一次。"""
    m = re.match(r'^\s*(pythonw?|py)(\.exe)?\s+(.*)$', cmd, re.IGNORECASE | re.DOTALL)
    if not m:
        return None
    proj_python = os.path.join(os.path.dirname(_SERVER_DIR), 'python', 'python.exe')
    if not os.path.isfile(proj_python):
        return None
    return proj_python + ' ' + m.group(3)


def run_shell(cmd, timeout=60, cwd=None):
    # [20261123 安全收口] 统一危险命令墙：所有 shell 通道（Bash/h_run/o_run/pi_run/
    # run_code 等全部经本函数执行）前置 safety_wall.check_shell_command。
    # codex/ds 工具内已各自调过一次，对同一命令串重复校验幂等无害（同串同结果）。
    try:
        from engines.common.safety_wall import check_shell_command as _csc
        _deny = _csc(cmd)
        if _deny:
            return 126, b'', ('[safety_wall] 危险命令被安全墙拦截: %s'
                              % _deny).encode('utf-8'), 'safety_wall blocked'
    except Exception:
        pass
    # [20261126 安全收口A2] 出域闸门：命令文本过 egress_gate.scan_sensitive,
    # 命中高敏感模式（sk-/Bearer/密码外传等）拦截并留痕，fail-open。
    try:
        import egress_gate
        eg = egress_gate.check('run_code', (cwd or 'cmd'), text=str(cmd)[:4000],
                               actor='shell_exec')
        if eg.get('decision') == 'block':
            return 126, b'', ('[egress_gate] 命令被安全闸门拦截: %s'
                              % eg.get('reason', '')).encode('utf-8'), 'egress_gate blocked'
    except Exception:
        pass
    """统一入口（在 _run_shell_raw 之上叠加 A 熔断 + B 9009 人性化重试）。"""
    import hashlib
    key = hashlib.md5(str(cmd).encode('utf-8', 'replace')).hexdigest()
    # 熔断检查：同一段命令 60 秒窗口内连续失败 >=3 次 → 直接拒绝
    cnt_info = _fail_counts.get(key)
    if cnt_info:
        cnt, ts, head = cnt_info
        if time.time() - ts < _FAIL_TTL and cnt >= 3:
            return 1, b'', (
                '[熔断] 这段命令在 60 秒内已连续失败 %d 次，本次已拦截不再执行。'
                '请先分析失败原因（检查上一轮 stderr），修改命令后再试，'
                '不要原样重复提交。命令开头: %r' % (cnt, head)
            ).encode('utf-8'), '[circuit-breaker]'

    rc, out, err, note = _run_shell_raw(cmd, timeout, cwd)

    # B 项：9009 且是裸 python/py → 用项目解释器绝对路径自动重试一次
    if rc == 9009:
        retry_cmd = _retry_with_project_python(cmd, timeout, cwd)
        if retry_cmd:
            rc2, out2, err2, note2 = _run_shell_raw(retry_cmd, timeout, cwd)
            if rc2 == 0:
                note2 = (note2 + ' [已自动用项目解释器 %s 重试成功，'
                         '今后请直接用该完整路径]' % retry_cmd.split(' ')[0]).strip()
                return rc2, out2, err2, note2
            rc, out, err, note = rc2, out2, err2, note2 + ' [裸 python 调用 9009，已自动改用项目解释器重试]'

    # 失败计数 / 成功清零；9009 附带中文提示
    if rc == 0:
        _fail_counts.pop(key, None)
    else:
        info = _fail_counts.get(key)
        now = time.time()
        if info and now - info[1] < _FAIL_TTL:
            _fail_counts[key] = (info[0] + 1, info[1], info[2])
        else:
            _fail_counts[key] = (1, now, str(cmd)[:120])
        tip = _friendly_shell_error(rc, (err or b'').decode('utf-8', 'replace'))
        if tip:
            tip_b = ('\n[提示] ' + tip).encode('utf-8')
            err = (err or b'') + tip_b
    return rc, out, err, note


def _run_shell_raw(cmd, timeout=60, cwd=None):
    """原始执行逻辑（无熔断/重试）。返回 (returncode, stdout_bytes, stderr_bytes, note)。

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
        p = subprocess.run(cmd, shell=True, capture_output=True,   # shell=True（Unix/单行路径）
                           timeout=timeout, cwd=cwd,
                           creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        return p.returncode, p.stdout or b'', p.stderr or b'', ' '.join(filter(None, [cwd_note, cwd_tag]))

    # --- Windows 多行（2026-11-22 步骤二拆分：抽 _run_win_multiline）---
    return _run_win_multiline(cmd, timeout, cwd, cwd_note, cwd_tag)


def _run_win_multiline(cmd, timeout, cwd, cwd_note, cwd_tag):
    """Windows 多行命令执行（原 _run_shell_raw L183-237 无改动搬移）。

    锁审计（2026-11-22）：本文件内无 Lock/Condition；_run_shell_raw 全部调用点
    （同文件 run_shell 两处）均不持锁，纯函数搬移无持锁重入风险。
    """
    # --- Windows 多行 ---
    note = None
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
