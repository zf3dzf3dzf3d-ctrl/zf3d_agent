#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""run - 运行 shell 命令（带安全防护）

安全策略：
  1. 总开关：默认允许，可在 private/port.json 设 "allow_shell": false 全局禁用
  2. 命令黑名单：拦截破坏性/危险命令片段
  3. 超时 300s，输出长度截断
"""
import os
import re
import json
import time
import subprocess
import threading
from util_log import get_logger

log = get_logger('run')
try:
    from tools.coding.backend import _egress
except ImportError:
    import _egress

# run_code 并发上限：防止卡死命令占满请求线程
_RUN_SEMAPHORE = threading.BoundedSemaphore(4)
_SLOT_LOCK = threading.Lock()
_SLOT_START = {}  # 占用序号 -> 获取时间，用于检测"永久卡死占满"并自愈
_STUCK_THRESHOLD = 90  # 所有槽被占用超过 90 秒视为卡死，强制重置（原600s期间前台全busy）


def _run_one(cmd, cwd):
    global _RUN_SEMAPHORE
    # 先排队等待（最长 60s），避免偶发高峰误报 busy
    if not _RUN_SEMAPHORE.acquire(timeout=60):
        # 检查是否所有槽都已占用超时（卡死），是则重置信号量自愈
        with _SLOT_LOCK:
            now = time.time()
            starts = list(_SLOT_START.values())
            if starts and len(starts) >= 4 and (now - min(starts)) > _STUCK_THRESHOLD:
                _RUN_SEMAPHORE = threading.BoundedSemaphore(4)
                _SLOT_START.clear()
                # 重建后立即占一个槽继续执行
                _RUN_SEMAPHORE.acquire()
                _SLOT_START[0] = now
            else:
                return {'ok': False, 'busy': True,
                        'stdout': '', 'stderr': 'run_code 并发已达上限(4)，有命令仍在执行/卡住，请稍后重试',
                        'exit_code': -1}
    with _SLOT_LOCK:
        slot = max(_SLOT_START.keys(), default=-1) + 1
        _SLOT_START[slot] = time.time()
    try:
        return _run_one_inner(cmd, cwd)
    finally:
        with _SLOT_LOCK:
            _SLOT_START.pop(slot, None)
        try:
            _RUN_SEMAPHORE.release()
        except Exception:
            pass


def _kill_tree(proc):
    """强杀进程树（shell=True 时 TimeoutExpired 只杀 shell 不杀实际子进程，必须 /T）"""
    try:
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)],
                       capture_output=True, timeout=10,
                       creationflags=subprocess.CREATE_NO_WINDOW)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass

# Windows PowerShell 5.1 默认按 ANSI(GBK) 读取无 BOM 的 UTF-8 文件：
# AI 用 Get-Content + Set-Content 改写项目文件会把全部中文写成乱码（不可逆）。
# 对 powershell -c "..." 形式的命令注入 UTF-8 默认编码，从源头杜绝。
_PS_ENC_PRELUDE = (
    "$PSDefaultParameterValues['Get-Content:Encoding']='UTF8';"
    "$PSDefaultParameterValues['Set-Content:Encoding']='UTF8';"
    "$PSDefaultParameterValues['Add-Content:Encoding']='UTF8';"
    "$PSDefaultParameterValues['Out-File:Encoding']='UTF8';"
)
_PS_QUOTED_RE = re.compile(
    r'^(\s*powershell(?:\.exe)?\s+(-c|-command)\s+)(\"|“)(.*)(\"|”)\s*$',
    re.I | re.S,
)


def _patch_powershell_utf8(cmd):
    """给 powershell -c "..." 命令前置 UTF-8 编码默认值（无法安全改写的形式原样返回）。"""
    if os.name != 'nt':
        return cmd
    m = _PS_QUOTED_RE.match(cmd)
    if not m:
        return cmd
    head, _flag, _q1, body, _q2 = m.groups()
    return head + '"' + _PS_ENC_PRELUDE + body + '"'


TOOL_NAME = 'run'


def _smart_decode(b):
    """智能解码：UTF-8 优先（含 BOM），失败回退本地 ANSI(GBK)，杜绝 ???? 乱码。"""
    if not b:
        return ''
    if b.startswith(b'\xef\xbb\xbf'):
        try:
            return b[3:].decode('utf-8')
        except Exception:
            pass
    try:
        return b.decode('utf-8')
    except UnicodeDecodeError:
        pass
    for enc in ('gbk', 'cp936'):
        try:
            return b.decode(enc)
        except Exception:
            continue
    return b.decode('utf-8', errors='replace')

# 危险命令黑名单（小写匹配，按词边界粗匹配）
_DANGEROUS_PATTERNS = [
    'rm -rf /', 'rm -rf ~', 'rm -rf *',
    'format ', 'del /f /s /q c:', 'rd /s /q c:',
    'mkfs', 'dd if=', ':(){:|:&};:',
    'reg delete', 'vssadmin delete',
    'curl | sh', 'curl | bash', 'iex (invoke-webrequest', 'iwr | iex',
    'certutil -urlcache', 'bitsadmin /transfer',
    'chmod -r 000 /', 'chown -r',
    '> /dev/sda', 'mkntfs',
    # 【2026-11-22】破坏性 git 操作：延迟合并提交模式下改动常无 commit 可兜底，
    # reset --hard / checkout -- / clean / stash drop 一旦执行即真丢（历轮"改完被回滚"
    # 事故的 shell 通道）。内部工具（undo_step/timeline/self_check）走 git_async 直调，
    # 不经过本分级器，不受影响；确需硬回退由人工在终端操作或走 revert。
    'git reset --hard',
    # 【2026-11-22 复审修复】'git checkout --' 带尾随空格：不放行 --track/--branch 等
    # 非破坏形态（-- 开头的长选项），只拦真正丢弃工作区改写的 'checkout -- <路径>'
    'git checkout -- ', 'git checkout head --',
    # 【2026-11-22】restore 一律破坏性（丢弃工作区/暂存区改写），单前缀全覆盖
    'git restore ',
    'git clean -f', 'git clean -d', 'git clean -x',
    'git stash drop', 'git stash clear',
    'git push --force', 'git push -f',
    'git filter-branch', 'git branch -d',
]
_DANGEROUS_TOKENS = [
    'net user', 'net localgroup',  # 账户操纵
    'schtasks /create',
    'attrib -s -h',
]


def _shell_allowed():
    """检查 port.json 中的 allow_shell 开关。
    fail 语义（2026-11-06 整改，原为 fail-open）：
      - 文件不存在 / 键缺失：按文档化默认值 True（允许），属既定契约
      - 文件存在但读取/解析失败（配置损坏）：fail-closed 返回 False 并打日志，
        杜绝"门锁坏了请进"
    """
    base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__)))))
    p = os.path.join(base, 'private', 'port.json')
    if not os.path.exists(p):
        return True  # 无配置文件：文档化默认允许
    try:
        with open(p, 'r', encoding='utf-8-sig') as f:
            cfg = json.load(f)
    except Exception as e:
        # 配置损坏时安全开关失效方向应为"拒绝"而非"放行"
        print('[run.py] port.json 解析失败，allow_shell fail-closed 拒绝执行: %r' % e,
              file=os.sys.stderr)
        return False
    if isinstance(cfg, dict):
        return cfg.get('allow_shell', True) is True
    return True  # 键缺失：文档化默认允许


def _is_dangerous(cmd):
    # 【2026-11-22 复审修复】空白归一：'git reset  --hard'（双空格）可绕过子串匹配；
    # 连续空白压成单空格后再匹配（tab/换行一并覆盖）。
    low = ' '.join((' ' + str(cmd).lower().replace('\n', ' ').replace('\t', ' ') + ' ').split())
    for pat in _DANGEROUS_PATTERNS:
        if pat in low:
            return pat
    for tok in _DANGEROUS_TOKENS:
        if tok in low:
            return tok
    # 【2026-09 根源防护】禁止 AI 杀掉 python/后台服务器/训练进程：
    # 曾有对话在"重启后台"时执行 taskkill /f /im python.exe，
    # 把网页后台和训练任务一起杀死（今日多次断线的根源之一）。
    # AI 需要重启后台时，应引导用户使用文件菜单的「一键重启后台」（安全模式）。
    if ('taskkill' in low or 'stop-process' in low or 'killall' in low):
        if ('python' in low or 'server.py' in low or ':8512' in low
                or 'continuous_train' in low):
            return 'taskkill/python（禁止杀掉 python/后台服务器/训练进程）'
    # 【文件保护清单】readonly 文件连 shell 改写/删除都硬拦
    hit = _protect_cmd_hit(cmd)
    if hit:
        return hit
    return None


# 删除保护拦截器不可用时的保守判定（fail-closed 降级用，见 _run_one_inner）
_DELETE_VERB_RE = re.compile(
    r'(?i)(?:^|[\s;&|()"\x27/\\])(?:del|erase|rd|rmdir|rm|ri|remove-item|clear-recyclebin)\b'
    r'|\b(?:rmtree|unlink|os\.remove|shutil\.move)\s*\(')


def _looks_like_delete(cmd):
    """删除保护拦截器不可用时的保守判定：疑似删除命令返回 True（宁可误拒，不可漏放）。

    仅在 trash_intercept 异常时启用：命中 → 拒绝执行；未命中 → 原样执行并留痕。"""
    return bool(_DELETE_VERB_RE.search(str(cmd or '')))


def _protect_cmd_hit(cmd):
    """命令里出现 readonly 保护文件的路径即拦截（防绕过 write 工具）。

    只拦 readonly（坚决不可动）；critical 不拦——它允许改，由写入口校验。
    命令未提及任何受保护路径时返回 None。
    """
    try:
        from tools.coding.backend import _file_protect as _fprot
        _all = _fprot.list_all()
        if _all.get('load_error'):
            # 【fail-closed】清单损坏 = 不知道什么受保护：一切命令拒绝，等人工修复
            return ('readonly protected: 只读保护清单无法解析，fail-closed 拒绝执行(%s)；'
                    '请人工检查或删除该清单' % _all['load_error'])
        ro = _all.get('readonly') or []
        if not ro:
            return None
        raw = str(cmd or '')
        low = raw.lower()
        for pat in ro:
            p = str(pat).strip()
            if not p:
                continue
            # 同时匹配原样、去引号、反斜杠、以及项目根绝对形态
            cands = [p, p.replace('/', '\\'), p.replace('\\', '/')]
            abs_norm = _fprot._norm(p)
            if abs_norm and not os.path.isabs(abs_norm):
                abs_norm = os.path.join(_fprot.PROJECT_ROOT, abs_norm)
            if abs_norm:
                cands.append(abs_norm)
                cands.append(abs_norm.replace('\\', '/'))
            hit_path = None
            for c in cands:
                c = c.strip().strip('"').strip("'")
                if c and c.lower() in low:
                    hit_path = c
                    break
            # 裸文件名：先切到文件所在目录再写（cd server\engines\common && echo x > syscall.py）
            # 不会带目录前缀，只按完整路径匹配会漏掉。无扩展名的名字要求够长，避免误伤短词；
            # 且前面不能紧贴字母、数字、下划线——tests/test_private_guard.py 里含着 _private_guard.py，但那是另一个文件
            base = p.replace('\\', '/').rsplit('/', 1)[-1]
            if hit_path is None and ('.' in base or len(base) >= 6) \
                    and re.search(r'(?<![\w])' + re.escape(base.lower()), low):
                hit_path = base
            if hit_path:
                return ('readonly protected: 命令触及只读保护文件「%s」，已拦截'
                        '（如需变更请先在管理工具中移除只读保护）' % p)
    except Exception as e:
        # 【fail-closed】只读保护清单读不到时不得按"未命中"放行——这是授权类检查，
        # 闸门异常即拒绝（原实现 return None 属 fail-open，等于保护失效）。
        return ('readonly protected: 只读保护清单读取异常，fail-closed 拒绝执行(%s)' % e)
    return None


def _classify(cmd):
    """命令风险分级：'blocked'（黑名单拦截）| 'safe'。原 danger 级「执行前自动 git 快照」钩子已按需求移除。"""
    if _is_dangerous(cmd):
        return 'blocked', None
    return 'safe', None


def _run_one_inner(cmd, cwd):
    level, tok = _classify(cmd)
    if level == 'blocked':
        return {'ok': False, 'blocked': True, 'reason': '命令包含危险片段 "%s"，已被安全策略拦截' % tok,
                'stdout': '', 'stderr': '', 'exit_code': -1}
    # 删除操作 100% 兜底：删除命令先移入缓冲垃圾箱再改写为占位 echo
    trash_notes = None
    try:
        try:
            import trash_intercept
        except ImportError:
            import sys as _sys
            _here = os.path.dirname(os.path.abspath(__file__))
            if _here not in _sys.path:
                _sys.path.insert(0, _here)
            import trash_intercept
        cmd, trash_notes = trash_intercept.rewrite_command(cmd, cwd)
    except Exception as _te:
        # 【fail-closed】删除保护拦截器异常时，删除类命令不得原样执行（原实现加一条备注后照跑，
        # 等于删除兜底失效）。降级策略：疑似删除 → 拒绝；非删除命令 → 照常执行并留痕。
        if _looks_like_delete(cmd):
            return {'ok': False, 'blocked': True,
                    'reason': '删除保护拦截器异常，fail-closed 拒绝执行删除类命令(%s)' % _te,
                    'stdout': '', 'stderr': '', 'exit_code': -1}
        trash_notes = [f'[zf-trash] 拦截器异常(非删除命令，原样执行): {_te}']
    cmd = _patch_powershell_utf8(cmd)
    proc = None
    raw_out, raw_err = b'', b''
    try:
        # 【2026-09-17 乱码修复】cmd.exe 默认输出 GBK(代码页936)，之前强制按 utf-8
        # 解码导致所有中文变 ????。改为按字节读取，智能解码：UTF-8 优先，失败回退本地 ANSI。
        proc = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE,
                                cwd=cwd, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            raw_out, raw_err = proc.communicate(timeout=120)
        except subprocess.TimeoutExpired:
            _kill_tree(proc)  # 超时必须杀整棵进程树，否则 shell 的子进程继续占住管道
            try:
                # 【2026-11-12 卡死修复】不再二次阻塞 communicate：
                # 残留孙进程占住管道时 communicate(join reader 线程)会永久挂起，
                # 导致请求线程卡死、前台区域转圈。改为非阻塞收割，拿不到就丢弃。
                raw_out, raw_err = proc.communicate(timeout=5)
            except Exception:
                raw_out, raw_err = b'', b''
        out = _smart_decode(raw_out)[:100000]
        err = _smart_decode(raw_err)[:50000]
        r = {'ok': True, 'stdout': out, 'stderr': err,
             'exit_code': proc.returncode if proc.returncode is not None else -1}
        if trash_notes:
            r['trash_notes'] = trash_notes
        return r
    except Exception as e:
        if proc is not None:
            _kill_tree(proc)
        # 【语义收敛 2026-11-06】原返回 ok:True + exit_code:-1，watchdog 等消费方
        # 以 result.get('ok') 判定成功，异常路径谎报 ok 会误导上层。改 ok:False。
        return {'ok': False, 'stdout': '', 'stderr': str(e), 'exit_code': -1,
                'error': str(e)}


def handle(body, ctx):
    if not _shell_allowed():
        ctx.send_json({'ok': False, 'error': 'shell 执行已被禁用（private/port.json 中 allow_shell=false）'})
        return

    codes = body.get('codes')
    if not codes:
        c = body.get('code', '')
        if not c:
            ctx.send_json({'ok': False, 'error': 'No code specified'})
            return
        codes = [{'code': c}]

    # 【M1.3 能力策略】shell：用户规则 deny 即拒；ask 须带审批票据（_policy_ticket）。
    # 策略模块缺失属授权类检查失效，fail-closed 拒绝执行。
    try:
        from util_policy import get_default_engine, check_tool_call
    except ImportError as _ipe:
        ctx.send_json({'ok': False, 'error': '能力策略模块缺失，fail-closed 拒绝执行: %s' % _ipe})
        return
    _pol_cmds = [item.get('code', '') if isinstance(item, dict) else str(item) for item in codes]
    _pol_engine = get_default_engine()
    _pol_params = {'cmds': [c[:200] for c in _pol_cmds]}
    _ok, _reason, _dec = check_tool_call(
        _pol_engine, 'shell',
        ' | '.join(c[:80] for c in _pol_cmds)[:160], _pol_params, body)
    if not _ok:
        ctx.send_json({'ok': False, 'error': '[能力策略] ' + _reason,
                       'policy': {'action': getattr(_dec, 'action', ''),
                                  'layer': getattr(_dec, 'layer', '')}})
        return

    # 【P2 出域闸门接线】shell 命令可能内嵌 curl/外传地址，命令文本整体过闸门
    for item in codes:
        _cmd = item.get('code', '') if isinstance(item, dict) else str(item)
        _dec, _reason = _egress.check('shell', _cmd[:100], text=_cmd, actor='run_code')
        if _dec == 'block':
            ctx.send_json({'ok': False,
                           'error': '[出域闸门] 命令被拦截: ' + _reason})
            return

    if len(codes) == 1:
        cmd = codes[0].get('code', '') if isinstance(codes[0], dict) else str(codes[0])
        r = _run_one(cmd, ctx.project_dir)
        # 【M1.7 明文密钥出站脱敏】工具结果回模型前，替换已知明文密钥（验收：上下文检索不到明文 Key）
        try:
            import util_key_scrub as _ks
            _any_hits = []
            for _field in ('stdout', 'stderr', 'error'):
                _r2, _hits = _ks.scrub(r.get(_field) or '')
                r[_field] = _r2
                _any_hits += _hits
            if _any_hits:
                r['key_redacted'] = sorted({tail for tail, _c in _any_hits})
        except ImportError as _kse:
            # 脱敏器缺失 = 无法保证结果无明文密钥：丢弃输出（fail-closed），保执行状态
            r['stdout'] = r['stderr'] = ''
            r['key_redact_error'] = '脱敏器缺失，输出已丢弃: ' + str(_kse)[:60]
        r['cwd'] = ctx.project_dir
        ctx.send_json(r)
        return

    results = []
    for item in codes:
        cmd = item.get('code', '') if isinstance(item, dict) else str(item)
        results.append(_run_one(cmd, ctx.project_dir))
    # 【M1.7】同上：多命令结果逐条出站脱敏；脱敏器缺失时丢弃输出（fail-closed）
    try:
        import util_key_scrub as _ks
        for r in results:
            _any_hits = []
            for _field in ('stdout', 'stderr', 'error'):
                _r2, _hits = _ks.scrub(r.get(_field) or '')
                r[_field] = _r2
                _any_hits += _hits
            if _any_hits:
                r['key_redacted'] = sorted({tail for tail, _c in _any_hits})
    except ImportError as _kse:
        for r in results:
            r['stdout'] = r['stderr'] = ''
            r['key_redact_error'] = '脱敏器缺失，输出已丢弃: ' + str(_kse)[:60]
    ctx.send_json({'ok': True, 'multi': True, 'runs': results})
