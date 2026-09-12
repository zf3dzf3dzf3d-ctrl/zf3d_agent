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
import os
import re
import subprocess
import tempfile

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


def run_shell(cmd, timeout=60, cwd=None):
    """返回 (returncode, stdout_bytes, stderr_bytes, note)"""
    if os.name != 'nt' or '\n' not in cmd.strip():
        p = subprocess.run(cmd, shell=True, capture_output=True,
                           timeout=timeout, cwd=cwd,
                           creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        return p.returncode, p.stdout or b'', p.stderr or b'', ''

    # --- Windows 多行 ---
    pc = _split_py_c(cmd)
    if pc:
        argv, script = pc
        try:
            p = subprocess.run(argv + [script], capture_output=True,
                               timeout=timeout, cwd=cwd,
                               creationflags=subprocess.CREATE_NO_WINDOW)
            return p.returncode, p.stdout or b'', p.stderr or b'', '[multi-line via interpreter argv]'
        except Exception:
            pass  # 落回 .bat 方案

    bat_dir = cwd if cwd and os.path.isdir(cwd) else None
    fd, bat = tempfile.mkstemp(suffix='.bat', dir=bat_dir, prefix='_ml_')
    note = '[multi-line via temp .bat]'
    try:
        with os.fdopen(fd, 'w', encoding='mbcs', errors='replace') as f:
            f.write('@echo off\r\n')
            f.write(cmd.replace('\r\n', '\n').replace('\n', '\r\n'))
            f.write('\r\nexit /b %errorlevel%\r\n')
        p = subprocess.run(['cmd', '/c', bat],
                           capture_output=True, timeout=timeout,
                           cwd=cwd, creationflags=subprocess.CREATE_NO_WINDOW)
        return p.returncode, p.stdout or b'', p.stderr or b'', note
    finally:
        try:
            os.remove(bat)
        except OSError:
            pass
