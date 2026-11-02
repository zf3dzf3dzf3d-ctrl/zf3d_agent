# -*- coding: utf-8 -*-
"""sys_tools.py - 系统感知工具集（智能体OS·阶段A：只读，零依赖兜底）

工具（全部只读，public 级）：
- sys_overview:    系统总览（OS/开机时长/CPU/内存/磁盘/网速摘要）——一行看全系统
- sys_process_list: 进程列表（CPU/内存占用 Top N，可选关键词过滤）
- sys_disk:        磁盘分区用量
- sys_battery:     电池/电源状态（无电池则提示）

设计原则（对齐 syscall.py）：
- psutil 可用则用 psutil；不可用则退化到标准库（os/platform/shutil）
- 任何异常都收敛为字符串，不外抛
- ZF_SYSTOOLS=0 一键降级关闭
- 输出均截断防刷屏
"""
import os
import json
import platform
import time

_ENABLED = os.environ.get('ZF_SYSTOOLS', '1') != '0'
_MAX_OUT = 6000

# 懒加载 psutil，失败则置 None（退化到标准库）
_psutil = None
_psutil_tried = False


def _ps():
    global _psutil, _psutil_tried
    if not _psutil_tried:
        _psutil_tried = True
        try:
            import psutil
            _psutil = psutil
        except Exception:
            _psutil = None
    return _psutil


def _j(obj):
    return json.dumps(obj, ensure_ascii=False)[:_MAX_OUT]


# ---------------------------------------------------------------- 工具实现

def _overview(args, ctx):
    ps = _ps()
    out = {'platform': platform.platform(),
           'python': platform.python_version(),
           'boot_time': None, 'uptime_h': None,
           'cpu_percent': None, 'cpu_count': os.cpu_count(),
           'mem': None, 'disks': None}
    if ps:
        try:
            boot = ps.boot_time()
            out['boot_time'] = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(boot))
            out['uptime_h'] = round((time.time() - boot) / 3600.0, 1)
        except Exception:
            pass
        try:
            out['cpu_percent'] = ps.cpu_percent(interval=0.3)
        except Exception:
            pass
        try:
            m = ps.virtual_memory()
            out['mem'] = {'total_gb': round(m.total / 2**30, 1),
                          'used_gb': round(m.used / 2**30, 1),
                          'percent': m.percent}
        except Exception:
            pass
        try:
            out['disks'] = [{'dev': p.device, 'percent': ps.disk_usage(p.mountpoint).percent}
                            for p in ps.disk_partitions() if 'cdrom' not in (p.opts or '').lower()][:8]
        except Exception:
            pass
    else:
        # 标准库退化：磁盘用 shutil
        import shutil
        usage = shutil.disk_usage(os.path.expanduser('~'))
        out['disks'] = [{'dev': '~', 'total_gb': round(usage.total / 2**30, 1),
                         'free_gb': round(usage.free / 2**30, 1)}]
    return True, _j(out)


def _process_list(args, ctx):
    ps = _ps()
    if not ps:
        return False, 'psutil 不可用，进程列表无法获取（可用 tasklist 手动查）'
    limit = int(args.get('limit') or 15)
    limit = max(1, min(limit, 50))
    kw = str(args.get('filter') or '').lower()
    sort_key = str(args.get('sort') or 'cpu')
    rows = []
    for p in ps.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent']):
        try:
            info = p.info
            if kw and kw not in (info.get('name') or '').lower():
                continue
            rows.append({'pid': info['pid'],
                         'name': (info.get('name') or '')[:40],
                         'cpu': info.get('cpu_percent') or 0.0,
                         'mem_pct': round(info.get('memory_percent') or 0.0, 1)})
        except Exception:
            continue
    rows.sort(key=lambda r: r[sort_key if sort_key in ('cpu', 'mem_pct') else 'cpu'], reverse=True)
    return True, _j({'count': len(rows), 'top': rows[:limit]})


def _disk(args, ctx):
    ps = _ps()
    out = []
    if ps:
        for p in ps.disk_partitions():
            if 'cdrom' in (p.opts or '').lower():
                continue
            try:
                u = ps.disk_usage(p.mountpoint)
                out.append({'dev': p.device, 'mount': p.mountpoint,
                            'total_gb': round(u.total / 2**30, 1),
                            'used_gb': round(u.used / 2**30, 1),
                            'free_gb': round(u.free / 2**30, 1),
                            'percent': u.percent})
            except Exception:
                continue
    else:
        import shutil
        u = shutil.disk_usage(os.path.expanduser('~'))
        out.append({'dev': '~', 'total_gb': round(u.total / 2**30, 1),
                    'free_gb': round(u.free / 2**30, 1)})
    return True, _j(out)


def _net(args, ctx):
    """网络 IO 概览 + 活动连接数（只读）。"""
    ps = _ps()
    out = {}
    if ps:
        try:
            c1 = ps.net_io_counters()
            time.sleep(0.5)
            c2 = ps.net_io_counters()
            out['net'] = {'up_kb_s': round((c2.bytes_sent - c1.bytes_sent) * 2 / 1024, 1),
                          'down_kb_s': round((c2.bytes_recv - c1.bytes_recv) * 2 / 1024, 1),
                          'total_sent_gb': round(c2.bytes_sent / 2**30, 2),
                          'total_recv_gb': round(c2.bytes_recv / 2**30, 2)}
        except Exception:
            pass
        try:
            conns = ps.net_connections(kind='inet')
            out['connections'] = {'total': len(conns),
                                  'established': sum(1 for c in conns if c.status == 'ESTABLISHED'),
                                  'listening': sum(1 for c in conns if c.status == 'LISTEN')}
        except Exception:
            pass
    if not out:
        return False, 'psutil 不可用，网络感知无法获取'
    return True, _j(out)


# ---------------------------------------------------------------- schema + 分发

def _schema(name, desc, props=None, req=None):
    return {'type': 'function', 'function': {
        'name': name, 'description': desc,
        'parameters': {'type': 'object',
                       'properties': props or {},
                       'required': req or []}}}


def get_schemas():
    if not _ENABLED:
        return []
    return [
        _schema('sys_overview',
                '系统总览：一行看全 Windows——OS版本、开机时长、CPU占用、内存占用、各磁盘用量。想快速了解这台电脑的当前状态时先用它。'),
        _schema('sys_process_list',
                '进程列表：按 CPU/内存占用排 Top N 进程（可按名称过滤）。排查"什么在吃资源"时用。',
                {'limit': {'type': 'integer', 'description': '返回条数，默认15，上限50'},
                 'filter': {'type': 'string', 'description': '按进程名关键词过滤（可选）'},
                 'sort': {'type': 'string', 'description': '排序键 cpu 或 mem_pct，默认 cpu'}}),
        _schema('sys_disk',
                '磁盘分区用量：每个分区的总容量/已用/剩余/百分比。'),
        _schema('sys_net',
                '网络感知：实时上传/下载速度、累计流量、活动连接统计（established/listening 数）。'),
    ]


_SYS_TOOL_NAMES = ('sys_overview', 'sys_process_list', 'sys_disk', 'sys_net')


def execute(name, args, ctx):
    if not _ENABLED:
        return False, 'sys_tools 已通过 ZF_SYSTOOLS=0 降级关闭'
    fn = {'sys_overview': _overview,
          'sys_process_list': _process_list,
          'sys_disk': _disk,
          'sys_net': _net}.get(name)
    if not fn:
        return False, 'unknown sys tool: %s' % name
    t0 = time.time()
    try:
        ok, out = fn(args if isinstance(args, dict) else {}, ctx or {})
    except Exception as e:
        ok, out = False, 'sys error: %s' % e
    # 系统调用审计（对齐 tool_base 范式，异常静默）
    try:
        from engines.common.syscall import audit as _sc_audit, register as _sc_reg
        _sc_reg(name, 'common:sys_tools', False, '系统感知')
        _sc_audit(name, 'common:sys_tools', ok, (time.time() - t0) * 1000,
                  err=('' if ok else str(out)[:120]))
    except Exception:
        pass
    return ok, out
