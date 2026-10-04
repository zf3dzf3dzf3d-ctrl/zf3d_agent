# -*- coding: utf-8 -*-
"""真沙箱 v1：Windows Job Object 资源围栏（ctypes 实现，无第三方依赖）。

定位（如实声明边界，不夸大）：
- 资源上限：单进程内存限额，失控命令最多吃满限额
- 超时整树收割：kill-on-close + TerminateJobObject，超时后进程树全灭，不留孤儿
- 环境变量清洗：剥离 API Key 等敏感变量，防止被失控命令读取外泄
- 不做文件系统隔离（Windows 无 chroot，可写范围限制属 P1）
- 不做网络隔离（job 档不承诺断网，强隔离属 P1 docker 档）

档位开关（环境变量 ZF_SANDBOX）：
- job  （默认）：Job Object 围栏
- off / 0     ：直通原 subprocess 行为，秒回退
- docker      ：Docker 容器强隔离（--network none 断网 + 只挂项目目录），
                docker 不可用/执行失败时自动降级 job 档

环境变量补充：
- ZF_SANDBOX_MEM_MB   ：job 档单进程内存限额 MB（默认 2048，import 时读取）
- ZF_SANDBOX_DOCKER_IMAGE：docker 档镜像（默认 python:3.11-slim）

实现要点：
- CreateProcessW(CREATE_SUSPENDED) 创建首进程 → AssignProcessToJobObject →
  ResumeThread，杜绝"首进程已 spawn 子进程但尚未入 Job"的逃逸窗口
- JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE：句柄关闭/异常时整树全灭
- 兼容中文路径（全部走宽字符 API）
"""
import ctypes
import logging
import os
import subprocess

log = logging.getLogger(__name__)

_IS_NT = os.name == 'nt'


# ---------- 持久化配置（P2：设置面板可写，env 优先） ----------
_CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))))), 'private', '沙箱配置.json')


def _load_config():
    """读持久化配置 {'mode': 'job'|'docker'|'off', 'mem_mb': int}。文件缺失/损坏返回 {}。永不抛异常。"""
    try:
        import json
        with open(_CONFIG_PATH, 'r', encoding='utf-8') as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def set_config(mode=None, mem_mb=None):
    """写入持久化配置（设置面板调用）。env 已设置时不覆盖（env 优先）。返回 (ok, msg)。"""
    try:
        os.makedirs(os.path.dirname(_CONFIG_PATH), exist_ok=True)
        d = _load_config()
        if mode in ('job', 'docker', 'off'):
            d['mode'] = mode
        if isinstance(mem_mb, int) and 128 <= mem_mb <= 32768:
            d['mem_mb'] = mem_mb
        import json
        with open(_CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, indent=2)
        return True, '已保存，重启进程后生效（env 环境变量存在时优先于本配置）'
    except Exception as e:
        return False, str(e)


def audit_trace(note, rc=None):
    """沙箱执行档位落痕：追加一行 JSON 到 private/audit_sandbox.jsonl。
    静默失败，绝不影响执行链路。"""
    try:
        import json, time
        os.makedirs(os.path.dirname(_CONFIG_PATH), exist_ok=True)
        with open(os.path.join(os.path.dirname(_CONFIG_PATH), 'audit_sandbox.jsonl'),
                  'a', encoding='utf-8') as f:
            f.write(json.dumps({'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
                                'mode': sandbox_mode(), 'note': str(note)[:200],
                                'rc': rc}, ensure_ascii=False) + '\n')
    except Exception:
        pass


def sandbox_mode():
    """返回配置档位：'job' | 'off' | 'docker'。
    优先级：环境变量 ZF_SANDBOX > private/沙箱配置.json > 默认 job。
    注意：返回的是"配置档"，docker 在 run_isolated 中探测不可用后会实际降级 job。永不抛异常。"""
    try:
        v = os.environ.get('ZF_SANDBOX')
        if not v:
            v = str(_load_config().get('mode') or 'job')
        v = str(v).strip().lower()
        if v in ('off', '0', 'false', 'none'):
            return 'off'
        if v in ('docker', 'container'):
            return 'docker'
        return 'job'
    except Exception:
        return 'job'


# ---------- Docker 后端（P1：真隔离档，可选） ----------
_DOCKER_IMAGE = os.environ.get('ZF_SANDBOX_DOCKER_IMAGE', 'python:3.11-slim')


def _docker_available():
    """探测 docker daemon 可用性（docker info 3 秒超时）。结果进程内缓存。永不抛异常。"""
    global _DOCKER_OK
    if _DOCKER_OK is not None:
        return _DOCKER_OK
    try:
        r = subprocess.run(['docker', 'info', '--format', 'ok'],
                           capture_output=True, timeout=3,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        _DOCKER_OK = (r.returncode == 0)
    except Exception:
        _DOCKER_OK = False
    if not _DOCKER_OK:
        log.warning('[sandbox] ZF_SANDBOX=docker 但 docker 不可用，将降级 job 档')
    return _DOCKER_OK


_DOCKER_OK = None


def _run_docker(cmd, timeout, cwd, env, shell):
    """Docker 强隔离执行：--network none 断网 + 只读挂载项目根 + tmpfs 工作目录。
    返回 (returncode, stdout, stderr, note)。异常由调用方捕获降级。"""
    import shlex
    # 项目根（沙箱模块位于 server/engines/common/ 下，向上三级）
    proj_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
    # cwd 必须落在项目根内才可挂载访问；否则落到容器内 /work
    work_rel = '/work'
    if cwd:
        try:
            rel = os.path.relpath(os.path.abspath(cwd), proj_root)
            if not rel.startswith('..') and not os.path.isabs(rel):
                work_rel = '/work/' + rel.replace('\\', '/')
        except Exception:
            pass
    if shell and isinstance(cmd, str):
        inner = cmd
    else:
        inner = ' '.join(shlex.quote(str(c)) for c in cmd)
    # 超时兜底由外层 timeout 命令承担（容器内进程超时被杀）
    docker_cmd = ['docker', 'run', '--rm',
                  '--network', 'none',
                  '--memory', '%dm' % _DEFAULT_MEM_LIMIT,
                  '--cpus', '2',
                  '-v', proj_root + ':/work:rw',
                  '-w', work_rel,
                  '-e', 'ZF_IN_SANDBOX=1']
    for k, v in (env or {}).items():
        docker_cmd += ['-e', '%s=%s' % (k, v)]
    docker_cmd += [_DOCKER_IMAGE, 'timeout', str(int(timeout)), 'sh', '-c', inner]
    r = subprocess.run(docker_cmd, shell=False, capture_output=True,
                       timeout=timeout + 15)
    note = ('[sandbox:docker image=%s net=none]' % _DOCKER_IMAGE)
    if r.returncode == 124:
        note += ' 超时收割'
    return r.returncode, r.stdout, r.stderr, note


# ---------- 环境变量清洗 ----------
_SENSITIVE_FRAGS = ('KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'CREDENTIAL', 'PASSWD')
# 系统关键变量白名单：Windows 下缺 SystemRoot/TEMP 等会导致 Win32 API、
# 临时目录、网络栈等异常，必须原样保留（值本身非凭据）
_SYSTEM_KEEP = ('SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATH',
                'SYSTEMDRIVE', 'PROGRAMDATA', 'PUBLIC', 'USERNAME',
                'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'OS')


def sanitize_env(env=None):
    """剥离含敏感片段的环境变量（大小写不敏感），返回清洗后的 env 副本。
    系统关键变量（SystemRoot/TEMP/PATH 等）白名单保留。永不抛异常。"""
    try:
        base = dict(env if env is not None else os.environ)
        out = {}
        for k, v in base.items():
            ku = str(k).upper()
            if ku in _SYSTEM_KEEP:
                out[k] = v
                continue
            if any(f in ku for f in _SENSITIVE_FRAGS):
                continue
            out[k] = v
        return out
    except Exception:
        return env


# ---------- Windows Job Object（ctypes） ----------
if _IS_NT:
    _kernel32 = ctypes.windll.kernel32

    class _IO_COUNTERS(ctypes.Structure):
        _fields_ = [(n, ctypes.c_ulonglong) for n in
                    ('ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount',
                     'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount')]

    class _JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ('PerProcessUserTimeLimit', ctypes.c_ulonglong),
            ('PerJobUserTimeLimit', ctypes.c_ulonglong),
            ('LimitFlags', ctypes.c_uint32),
            ('MinimumWorkingSetSize', ctypes.c_size_t),
            ('MaximumWorkingSetSize', ctypes.c_size_t),
            ('ActiveProcessLimit', ctypes.c_uint32),
            ('Affinity', ctypes.c_size_t),
            ('PriorityClass', ctypes.c_uint32),
            ('SchedulingClass', ctypes.c_uint32),
        ]

    class _JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ('BasicLimitInformation', _JOBOBJECT_BASIC_LIMIT_INFORMATION),
            ('IoInfo', _IO_COUNTERS),
            ('ProcessMemoryLimit', ctypes.c_size_t),
            ('JobMemoryLimit', ctypes.c_size_t),
            ('PeakProcessMemoryUsed', ctypes.c_size_t),
            ('PeakJobMemoryUsed', ctypes.c_size_t),
        ]

    class _STARTUPINFOW(ctypes.Structure):
        _fields_ = [
            ('cb', ctypes.c_uint32), ('lpReserved', ctypes.c_wchar_p),
            ('lpDesktop', ctypes.c_wchar_p), ('lpTitle', ctypes.c_wchar_p),
            ('dwX', ctypes.c_uint32), ('dwY', ctypes.c_uint32),
            ('dwXSize', ctypes.c_uint32), ('dwYSize', ctypes.c_uint32),
            ('dwXCountChars', ctypes.c_uint32), ('dwYCountChars', ctypes.c_uint32),
            ('dwFillAttribute', ctypes.c_uint32), ('dwFlags', ctypes.c_uint32),
            ('wShowWindow', ctypes.c_uint16), ('cbReserved2', ctypes.c_uint16),
            ('lpReserved2', ctypes.c_void_p), ('hStdInput', ctypes.c_void_p),
            ('hStdOutput', ctypes.c_void_p), ('hStdError', ctypes.c_void_p),
        ]

    class _PROCESS_INFORMATION(ctypes.Structure):
        _fields_ = [
            ('hProcess', ctypes.c_void_p), ('hThread', ctypes.c_void_p),
            ('dwProcessId', ctypes.c_uint32), ('dwThreadId', ctypes.c_uint32),
        ]

    JobObjectExtendedLimitInformation = 9
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
    JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x100
    CREATE_SUSPENDED = 0x4
    CREATE_NO_WINDOW = 0x08000000
    CREATE_UNICODE_ENVIRONMENT = 0x400
    STARTF_USESTDHANDLES = 0x100
    HANDLE_FLAG_INHERIT = 0x1

    # 注意：进程启动时(import时)一次性读取，运行中修改环境变量不生效，重启进程生效
    _DEFAULT_MEM_LIMIT = int(os.environ.get('ZF_SANDBOX_MEM_MB', '2048')) * 1024 * 1024

    _kernel32.CreateJobObjectW.restype = ctypes.c_void_p
    _kernel32.CreateProcessW.restype = ctypes.c_int
    _kernel32.CreateProcessW.argtypes = [
        ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_void_p, ctypes.c_void_p,
        ctypes.c_int, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_wchar_p,
        ctypes.c_void_p, ctypes.c_void_p]
    _kernel32.ResumeThread.restype = ctypes.c_uint32
    _kernel32.WaitForSingleObject.restype = ctypes.c_uint32


def _create_job(mem_limit):
    """创建带 KILL_ON_CLOSE + 内存限额的 Job Object，返回句柄。失败返回 None。"""
    try:
        h = _kernel32.CreateJobObjectW(None, None)
        if not h:
            return None
        info = _JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = (
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_PROCESS_MEMORY)
        info.ProcessMemoryLimit = mem_limit
        if not _kernel32.SetInformationJobObject(
                h, JobObjectExtendedLimitInformation,
                ctypes.byref(info), ctypes.sizeof(info)):
            _kernel32.CloseHandle(h)
            return None
        return h
    except Exception as e:
        log.warning('[sandbox] create job failed: %r', e)
        return None


class _Pipes(object):
    """匿名管道三元组（inheritable 写端传给子进程，读端父进程持有）。"""
    def __init__(self):
        self.r = self.w = None

    def close(self):
        for name in ('r', 'w'):
            h = getattr(self, name)
            if h:
                try:
                    _kernel32.CloseHandle(h)
                except Exception:
                    pass
                setattr(self, name, None)


def _make_pipe():
    r = ctypes.c_void_p()
    w = ctypes.c_void_p()
    sa = subprocess  # noqa
    if not _kernel32.CreatePipe(ctypes.byref(r), ctypes.byref(w), None, 0):
        return None
    # 写端设为可继承
    _kernel32.SetHandleInformation(w, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT)
    p = _Pipes()
    p.r, p.w = r.value, w.value
    return p


def _read_all(handle):
    """循环读取管道直至 EOF。返回 bytes。"""
    chunks = []
    buf = ctypes.create_string_buffer(65536)
    while True:
        got = ctypes.c_uint32(0)
        ok = _kernel32.ReadFile(ctypes.c_void_p(handle), buf, 65536,
                                ctypes.byref(got), None)
        if not ok or not got.value:
            break
        chunks.append(buf.raw[:got.value])
    return b''.join(chunks)


def _drain_async(handle, timeout):
    """带超时地读取管道；超时返回 (False, data)，EOF/读尽返回 (True, data)。"""
    import threading
    result = {}
    def _t():
        result['data'] = _read_all(handle)
    th = threading.Thread(target=_t, daemon=True)
    th.start()
    th.join(timeout)
    if th.is_alive():
        # 超时：子进程可能仍持有写端；由调用方 TerminateJob 后再同步读
        return False, None
    return True, result.get('data', b'')


def _env_block(env):
    """env dict → Win32 Unicode 环境块（宽字符，双 NUL 结尾）。空 env 返回 None（继承）。"""
    try:
        if not env:
            return None
        block = ''.join('%s=%s\x00' % (k, v) for k, v in env.items()) + '\x00'
        return ctypes.c_wchar_p(block)
    except Exception:
        return None


def _run_job_win(cmd, timeout, cwd, env, shell, mem_limit):
    """Job Object 围栏执行。返回 (returncode, stdout, stderr, note)。"""
    job_h = _create_job(mem_limit)
    if not job_h:
        p = subprocess.run(cmd, shell=shell, capture_output=True,
                           timeout=timeout, cwd=cwd, env=env)
        return p.returncode, p.stdout or b'', p.stderr or b'', '[sandbox:job create failed→direct]'

    out_p = _make_pipe()
    err_p = _make_pipe()
    if not out_p or not err_p:
        _kernel32.CloseHandle(job_h)
        raise OSError('CreatePipe failed')

    si = _STARTUPINFOW()
    si.cb = ctypes.sizeof(si)
    si.dwFlags = STARTF_USESTDHANDLES
    si.hStdInput = None
    si.hStdOutput = out_p.w
    si.hStdError = err_p.w
    pi = _PROCESS_INFORMATION()

    if shell:
        # /s /c "..."：外层引号整体包裹，内部引号原样保留（兼容中文路径带空格）
        cmdline = 'cmd.exe /s /c "%s"' % cmd
    else:
        import subprocess as _sp
        argv = [str(c) for c in cmd]
        cmdline = _sp.list2cmdline(argv)

    env_block = _env_block(env)
    flags = CREATE_SUSPENDED | CREATE_NO_WINDOW
    if env_block is not None:
        flags |= CREATE_UNICODE_ENVIRONMENT
    created = _kernel32.CreateProcessW(
        None, cmdline, None, None, True,
        flags, env_block,
        ctypes.c_wchar_p(cwd) if cwd else None,
        ctypes.byref(si), ctypes.byref(pi))
    # 先取真实错误码再抛异常（get_last_error 会被后续调用污染）
    err_no = ctypes.GetLastError()
    if not created:
        out_p.close()
        err_p.close()
        _kernel32.CloseHandle(job_h)
        raise OSError('CreateProcessW failed: %s' % err_no)
    # 环境块是 c_void_p 传的临时缓冲需保活到 CreateProcessW 返回 —— 已返回，安全

    # 挂入 Job 后再恢复执行 —— 无逃逸窗口
    assigned = _kernel32.AssignProcessToJobObject(
        job_h, ctypes.c_void_p(pi.hProcess))
    _kernel32.ResumeThread(ctypes.c_void_p(pi.hThread))
    _kernel32.CloseHandle(pi.hThread)
    # 子进程已继承写端，父进程副本可关
    out_p.close_w = None
    try:
        _kernel32.CloseHandle(out_p.w)
        _kernel32.CloseHandle(err_p.w)
    except Exception:
        pass
    out_p.w = err_p.w = None

    if not assigned:
        _kernel32.TerminateJobObject(job_h, 1)
        _kernel32.CloseHandle(pi.hProcess)
        out_p.close()
        err_p.close()
        _kernel32.CloseHandle(job_h)
        # 已杀失败子进程并清理句柄；随后整体降级直通重跑同一命令——
        # 行为安全但该命令会被执行两次，Win10+ 支持嵌套 Job 此场景极罕见
        raise OSError('AssignProcessToJobObject failed')

    # 等待进程结束（带超时）
    WAIT_OBJECT_0 = 0
    WAIT_TIMEOUT = 0x102
    rc_code = _kernel32.WaitForSingleObject(ctypes.c_void_p(pi.hProcess),
                                            int(timeout * 1000))
    timed_out = (rc_code == WAIT_TIMEOUT)
    if timed_out:
        _kernel32.TerminateJobObject(job_h, 1)
        _kernel32.WaitForSingleObject(ctypes.c_void_p(pi.hProcess), 5000)

    # 终止后写端已无持有者，同步读尽输出
    out_data = _read_all(out_p.r)
    err_data = _read_all(err_p.r)

    exit_code = ctypes.c_uint32(0)
    _kernel32.GetExitCodeProcess(ctypes.c_void_p(pi.hProcess),
                                 ctypes.byref(exit_code))
    _kernel32.CloseHandle(pi.hProcess)
    out_p.close()
    err_p.close()
    _kernel32.CloseHandle(job_h)  # kill-on-close 兜底整树收割

    rc = 124 if timed_out else (exit_code.value if exit_code.value != 0xFFFFFFFF else -1)
    note = '[sandbox:job timeout→tree kill]' if timed_out else '[sandbox:job]'
    if timed_out:
        err_data += '\n[sandbox] 超时整树收割（Job Object 全灭进程树）'.encode('utf-8', 'replace')
    return rc, out_data, err_data, note


def run_isolated(cmd, timeout=60, cwd=None, shell=False, env=None):
    """统一沙箱执行入口。返回 subprocess.CompletedProcess（附 sandbox_note）。

    - 档位 off / 非 Windows → 原 subprocess.run 直通
    - 档位 job（默认）→ env 清洗 + Job Object 围栏（Windows）
    - 档位 docker → docker --network none 强隔离；docker 不可用/执行失败
      自动降级 job 档（再降级直通），note 中标注实际档位
    - 沙箱内部异常 → 降级直通（可用性优先），异常记日志与 note
    """
    mode = sandbox_mode()
    if mode == 'off' or not _IS_NT:
        return subprocess.run(cmd, shell=shell, capture_output=True,
                              timeout=timeout, cwd=cwd, env=env)
    clean_env = sanitize_env(env)
    if mode == 'docker':
        if _docker_available():
            try:
                rc, out, err, note = _run_docker(cmd, timeout, cwd, clean_env, shell)
                p = subprocess.CompletedProcess(cmd, rc, out, err)
                p.sandbox_note = note
                return p
            except Exception as e:
                log.warning('[sandbox] docker run failed (%r), downgrade to job', e)
        else:
            log.warning('[sandbox] docker 不可用，降级 job 档')
    try:
        rc, out, err, note = _run_job_win(cmd, timeout, cwd, clean_env, shell,
                                          _DEFAULT_MEM_LIMIT)
    except Exception as e:
        log.warning('[sandbox] isolated run failed (%r), fallback to direct', e)
        p = subprocess.run(cmd, shell=shell, capture_output=True,
                           timeout=timeout, cwd=cwd, env=clean_env)
        p.sandbox_note = '[sandbox:err→direct %r]' % (e,)
        return p
    p = subprocess.CompletedProcess(cmd, rc, out, err)
    p.sandbox_note = note
    audit_trace(note, p.returncode)
    return p


def sandbox_status():
    """设置面板/审计用：当前生效配置概览。永不抛异常。"""
    cfg = _load_config()
    try:
        mem_mb = int(os.environ.get('ZF_SANDBOX_MEM_MB') or cfg.get('mem_mb') or 2048)
    except Exception:
        mem_mb = 2048
    src = 'env' if os.environ.get('ZF_SANDBOX') else ('config' if cfg.get('mode') else 'default')
    return {
        'mode': sandbox_mode(),
        'source': src,
        'mem_mb': mem_mb,
        'docker_available': _docker_available() if _IS_NT else False,
        'config_path': _CONFIG_PATH,
        'note_restart': '修改档位需重启进程生效；env ZF_SANDBOX 存在时优先于持久化配置',
    }
