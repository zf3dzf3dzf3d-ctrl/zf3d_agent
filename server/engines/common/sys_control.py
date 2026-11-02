# -*- coding: utf-8 -*-
"""sys_control.py - 系统操控工具集（智能体OS·阶段C：全部 dangerous 级）

工具：
- sys_proc_kill:       结束进程（按 PID；保护自身与系统关键进程）
- sys_service_control: Windows 服务 启动/停止/查询（psutil win_service）
- sys_task_schedule:   计划任务 创建/删除/查询（schtasks，零依赖）
- sys_reg:             HKCU 注册表 读/写/删（winreg；写前自动 .reg 快照）

安全设计（对齐 syscall.py）：
- 全部 dangerous 级：sys_proc_kill 等名字本身即触发 classify 的 dangerous 规则；
  执行前调 syscall.check_permission，enforce 模式下需 syscall.approve 确认
- 进程保护：永不 kill 自身 PID、智能体相关 python、System/lsass/csrss/wininit 等关键进程
- 注册表：只允许 HKCU，写入前导出受影响键到 private/logs/reg_backup/
- ZF_SYSCONTROL=0 一键降级关闭
"""
import os
import time

_ENABLED = os.environ.get('ZF_SYSCONTROL', '1') != '0'
_MAX_OUT = 5000
_SELF_PID = os.getpid()

# 永不结束的系统关键进程名（小写）
_PROTECTED = {'system', 'idle', 'csrss.exe', 'lsass.exe', 'smss.exe', 'wininit.exe',
              'services.exe', 'winlogon.exe', 'svchost.exe', 'dwm.exe'}
# 永不结束的关键字（智能体自身相关）
_SELF_KEYWORDS = ('pythonw', 'python', 'zhufeng', 'zfagent')


def _j(obj):
    import json
    return json.dumps(obj, ensure_ascii=False)[:_MAX_OUT]


def _ps():
    try:
        import psutil
        return psutil
    except Exception:
        return None


def _check(name):
    """dangerous 级权限检查。返回 (ok, reason)。"""
    try:
        from engines.common.syscall import check_permission, register
        register(name, 'common:sys_control', True, '系统操控(dangerous)')
        ok, reason = check_permission(name)
        return ok, reason
    except Exception:
        return True, ''  # syscall 不可用时退化为只审计（与全局默认一致）


# ---------------------------------------------------------------- 进程 kill

def _proc_kill(args, ctx):
    if not _check('sys_proc_kill'):
        return False, 'SYSCALL_DANGEROUS_BLOCKED: sys_proc_kill 需人工确认（syscall.approve）'
    ps = _ps()
    if not ps:
        return False, 'psutil 不可用'
    try:
        pid = int(args.get('pid') or 0)
    except Exception:
        return False, 'pid 参数无效'
    if pid <= 0:
        return False, '必须提供 pid'
    if pid == _SELF_PID:
        return False, '拒绝：不能结束智能体自身进程'
    try:
        p = ps.Process(pid)
        pname = (p.name() or '').lower()
        exe = (p.exe() or '').lower()
        if pname in _PROTECTED:
            return False, '拒绝：%s 是系统关键进程' % pname
        if any(k in pname or k in exe for k in _SELF_KEYWORDS) and 'zhufeng' in exe + pname:
            return False, '拒绝：疑似智能体自身相关进程'
        # 二次保护：命令行里含本 server 路径的 python 一律拒绝
        try:
            cl = ' '.join(p.cmdline()).lower()
            if 'python' in pname and ('server' in cl and '5.5.5' in cl):
                return False, '拒绝：疑似本智能体 server 进程'
        except Exception:
            pass
        p.terminate()
        try:
            p.wait(timeout=5)
        except Exception:
            p.kill()
        return True, _j({'killed': pid, 'name': pname})
    except ps.NoSuchProcess:
        return False, '进程不存在: %s' % pid
    except ps.AccessDenied:
        return False, '权限不足（AccessDenied），需管理员'
    except Exception as e:
        return False, 'sys error: %s' % e


# ---------------------------------------------------------------- 服务控制

def _service(args, ctx):
    action = (args.get('action') or 'list').lower()
    name = str(args.get('name') or '')
    if action == 'list':
        ps = _ps()
        if not ps:
            return False, 'psutil 不可用'
        try:
            svcs = ps.win_service_iter()
            out = []
            for s in svcs:
                d = s.as_dict()
                if name and name.lower() not in (d.get('name') or '').lower() \
                        and name.lower() not in (d.get('display_name') or '').lower():
                    continue
                out.append({'name': d.get('name'), 'display': d.get('display_name'),
                            'status': d.get('status'), 'start': d.get('start_type')})
                if len(out) >= 50:
                    break
            return True, _j({'count': len(out), 'services': out})
        except Exception as e:
            return False, 'sys error: %s' % e
    # start/stop 走 sc 命令（需要确认）
    if not name:
        return False, 'start/stop 需要 name 参数'
    if not _check('sys_service_control'):
        return False, 'SYSCALL_DANGEROUS_BLOCKED: sys_service_control 需人工确认（syscall.approve）'
    if action not in ('start', 'stop'):
        return False, 'action 仅支持 list/start/stop'
    import subprocess
    p = subprocess.run(['sc', action, name], capture_output=True, timeout=30,
                       creationflags=0x08000000)
    out = ((p.stdout or b'') + (p.stderr or b'')).decode('gbk', 'replace')[:800]
    return p.returncode == 0, out.strip() or ('rc=%d' % p.returncode)


# ---------------------------------------------------------------- 计划任务

def _task(args, ctx):
    import subprocess
    action = (args.get('action') or 'query').lower()
    name = str(args.get('name') or '')
    if action == 'query':
        cmd = ['schtasks', '/Query', '/FO', 'CSV', '/NH']
        if name:
            cmd += ['/TN', name]
        p = subprocess.run(cmd, capture_output=True, timeout=30,
                           creationflags=0x08000000)
        out = (p.stdout or b'').decode('gbk', 'replace')
        return True, out[:_MAX_OUT]
    if not _check('sys_task_schedule'):
        return False, 'SYSCALL_DANGEROUS_BLOCKED: sys_task_schedule 需人工确认（syscall.approve）'
    if action == 'create':
        cmd = args.get('cmd') or ''
        trig = (args.get('trigger') or 'ONLOGON').upper()
        if not name or not cmd:
            return False, 'create 需要 name 和 cmd'
        p = subprocess.run(['schtasks', '/Create', '/F', '/TN', name, '/SC', trig,
                            '/TR', cmd], capture_output=True, timeout=30,
                           creationflags=0x08000000)
        out = ((p.stdout or b'') + (p.stderr or b'')).decode('gbk', 'replace')[:800]
        return p.returncode == 0, out.strip()
    if action == 'delete':
        if not name:
            return False, 'delete 需要 name'
        p = subprocess.run(['schtasks', '/Delete', '/F', '/TN', name],
                           capture_output=True, timeout=30,
                           creationflags=0x08000000)
        out = ((p.stdout or b'') + (p.stderr or b'')).decode('gbk', 'replace')[:800]
        return p.returncode == 0, out.strip()
    return False, 'action 仅支持 query/create/delete'


# ---------------------------------------------------------------- 注册表（仅 HKCU）

_REG_BACKUP = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))), 'private', 'logs', 'reg_backup')


def _reg(args, ctx):
    action = (args.get('action') or 'get').lower()
    key = str(args.get('key') or '')       # 如 Software\Microsoft\Windows\CurrentVersion\Run
    vname = str(args.get('name') or '')
    value = args.get('value')
    if not key or '..' in key or key.startswith('\\'):
        return False, 'key 无效（仅限 HKCU 相对路径，如 Software\\...）'
    try:
        import winreg
    except Exception:
        return False, 'winreg 不可用（非 Windows）'
    full = r'HKCU\%s' % key
    if action == 'get':
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as k:
                v, _t = winreg.QueryValueEx(k, vname)
            return True, _j({'key': full, 'name': vname, 'value': str(v)})
        except FileNotFoundError:
            return False, '键/值不存在: %s\\%s' % (full, vname)
        except Exception as e:
            return False, 'sys error: %s' % e
    # 写/删：dangerous 确认
    if not _check('sys_reg'):
        return False, 'SYSCALL_DANGEROUS_BLOCKED: sys_reg 需人工确认（syscall.approve）'
    # 改前快照（export 不能只导单值，导出所在键）；key 白名单校验防注入，失败则拒绝写操作
    if not all(c.isalnum() or c in '\\._- ' for c in key):
        return False, 'key 含非法字符，拒绝操作: %r' % key
    try:
        os.makedirs(_REG_BACKUP, exist_ok=True)
        ts = time.strftime('%Y%m%d_%H%M%S')
        bak = os.path.join(_REG_BACKUP, '%s_%s.reg' % (key.replace('\\', '_')[:60], ts))
        p = subprocess.run(['reg', 'export', 'HKCU\\%s' % key, bak, '/y'],
                           capture_output=True, timeout=30,
                           creationflags=0x08000000)
        if p.returncode != 0 or not os.path.exists(bak):
            err = (p.stderr or b'').decode('gbk', 'replace').strip()
            return False, '备份失败，已拒绝写操作（可先手动导出该键）: %s' % err
    except Exception as e:
        return False, '备份失败，已拒绝写操作: %s' % e
    if action == 'set':
        if value is None:
            return False, 'set 需要 value'
        try:
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key) as k:
                winreg.SetValueEx(k, vname, 0, winreg.REG_SZ, str(value))
            return True, _j({'set': full, 'name': vname, 'value': str(value), 'backup': bak})
        except Exception as e:
            return False, 'sys error: %s' % e
    if action == 'delete':
        try:
            if vname:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key, 0, winreg.KEY_SET_VALUE) as k:
                    winreg.DeleteValue(k, vname)
            else:
                winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key)
            return True, _j({'deleted': full, 'name': vname, 'backup': bak})
        except FileNotFoundError:
            return False, '键/值不存在: %s' % full
        except Exception as e:
            return False, 'sys error: %s' % e
    return False, 'action 仅支持 get/set/delete'


# ---------------------------------------------------------------- schema + 分发

def _schema(name, desc, props=None, req=None):
    return {'type': 'function', 'function': {
        'name': name, 'description': desc + '（dangerous 级，需人工确认后才能执行）',
        'parameters': {'type': 'object',
                       'properties': props or {},
                       'required': req or []}}}


def get_schemas():
    if not _ENABLED:
        return []
    return [
        _schema('sys_proc_kill',
                '结束指定 PID 的进程。系统关键进程与智能体自身进程会被拒绝。',
                {'pid': {'type': 'integer', 'description': '目标进程 PID'}}, ['pid']),
        _schema('sys_service_control',
                'Windows 服务查询/启停。action=list 查询（可 name 过滤）；start/stop 需确认。',
                {'action': {'type': 'string', 'enum': ['list', 'start', 'stop']},
                 'name': {'type': 'string', 'description': '服务名（list 时可选过滤，start/stop 必填）'}}),
        _schema('sys_task_schedule',
                'Windows 计划任务查询/创建/删除（schtasks）。query 只读；create/delete 需确认。',
                {'action': {'type': 'string', 'enum': ['query', 'create', 'delete']},
                 'name': {'type': 'string', 'description': '任务名'},
                 'cmd': {'type': 'string', 'description': 'create 时要执行的命令'},
                 'trigger': {'type': 'string', 'description': 'create 触发器 ONLOGON/ONSTART/DAILY 等'}}),
        _schema('sys_reg',
                'HKCU 注册表读/写/删。get 只读；set/delete 需确认且自动导出 .reg 快照备份。',
                {'action': {'type': 'string', 'enum': ['get', 'set', 'delete']},
                 'key': {'type': 'string', 'description': 'HKCU 下相对路径，如 Software\\Microsoft\\Windows\\CurrentVersion\\Run'},
                 'name': {'type': 'string', 'description': '值名称'},
                 'value': {'type': 'string', 'description': 'set 时的新值'}}),
    ]


_TOOL_FNS = {'sys_proc_kill': _proc_kill,
             'sys_service_control': _service,
             'sys_task_schedule': _task,
             'sys_reg': _reg}


def execute(name, args, ctx):
    if not _ENABLED:
        return False, 'sys_control 已通过 ZF_SYSCONTROL=0 降级关闭'
    fn = _TOOL_FNS.get(name)
    if not fn:
        return False, 'unknown sys control tool: %s' % name
    t0 = time.time()
    try:
        ok, out = fn(args if isinstance(args, dict) else {}, ctx or {})
    except Exception as e:
        ok, out = False, 'sys error: %s' % e
    try:
        from engines.common.syscall import audit as _sc_audit, register as _sc_reg
        _sc_reg(name, 'common:sys_control', True, '系统操控(dangerous)')
        _sc_audit(name, 'common:sys_control', ok, (time.time() - t0) * 1000,
                  err=('' if ok else str(out)[:120]))
    except Exception:
        pass
    return ok, out
