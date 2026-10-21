# -*- coding: utf-8 -*-
"""sys_events.py - 系统事件桥（智能体OS·阶段B）

把 Windows 系统事件桥接到 event_bus（os.event 类型），让智能体"感知"系统变化：
- U盘/存储设备插拔（WMI win32_LogicalDisk 或 psutil 轮询磁盘分区）
- 网络断开/恢复（psutil.net_if_stats 轮询）
- 电池模式切换（交流/电池，psutil.sensors_battery）

设计：
- 后台 daemon 线程轮询（默认 10s），防抖：同 key 事件 5s 内只发一次
- 事件白名单三类，全部默认开启但 ZF_SYSEVENTS=0 一键关闭
- 只发事件不处理：响应逻辑由订阅方（butler_conductor 等）决定
- 绝不抛错；跨平台安全（非 Windows 直接不启动）
"""
import os
import time
import threading

_ENABLED = os.environ.get('ZF_SYSEVENTS', '1') != '0'
_INTERVAL = float(os.environ.get('ZF_SYSEVENTS_INTERVAL', '10') or 10)
_DEBOUNCE = 5.0          # 同 key 防抖秒数
_THREAD = None
_STOP = threading.Event()
_LAST = {}               # {debounce_key: ts}
_LOCK = threading.Lock()

# 事件白名单
_WHITELIST = ('usb.plug', 'usb.unplug', 'net.down', 'net.up', 'power.ac', 'power.battery')


def _publish(kind, detail, source='sys_events'):
    """发布 os.event 到 event_bus（防抖）。"""
    key = '%s:%s' % (kind, str(detail)[:40])
    now = time.time()
    with _LOCK:
        if now - _LAST.get(key, 0) < _DEBOUNCE:
            return
        _LAST[key] = now
        # 防状态表无限膨胀
        if len(_LAST) > 200:
            _LAST.clear()
    try:
        from engines.common.event_bus import publish
        publish('os.event', {'kind': kind, 'detail': str(detail)[:120]},
                source=source)
    except Exception:
        pass


# ---------------------------------------------------------------- 轮询器

class _Poller:
    def __init__(self):
        self.disks = {}      # {dev: mountpoint}
        self.net_ok = {}     # {iface: bool}
        self.ac = None       # 上次是否交流供电
        self._baseline = False
        self.ps = None
        try:
            import psutil
            self.ps = psutil
        except Exception:
            pass

    def poll(self):
        if self.ps is None:
            try:
                import psutil
                self.ps = psutil
            except Exception:
                return
        if self._baseline:
            self._poll_disks()
            self._poll_net()
            self._poll_power()
            return
        # 首轮：只建基线，不发事件（防止启动时全量误报）
        self.disks = self._snapshot()
        try:
            for iface, s in (self.ps.net_if_stats() or {}).items():
                if not iface.startswith('lo') and iface != 'Loopback Pseudo-Interface 1':
                    self.net_ok[iface] = bool(s.isup)
        except Exception:
            pass
        try:
            b = self.ps.sensors_battery()
            self.ac = bool(b.power_plugged) if b else None
        except Exception:
            pass
        self._baseline = True

    def _poll_disks(self):
        ps = self.ps
        cur = self._snapshot()
        for dev in cur:
            if dev not in self.disks:
                _publish('usb.plug', dev)
        for dev in self.disks:
            if dev not in cur:
                _publish('usb.unplug', dev)
        self.disks = cur

    def _poll_net(self):
        ps = self.ps
        try:
            stats = ps.net_if_stats()
        except Exception:
            return
        for iface, s in stats.items():
            if iface.startswith('lo') or iface == 'Loopback Pseudo-Interface 1':
                continue
            ok = bool(s.isup)
            prev = self.net_ok.get(iface)
            self.net_ok[iface] = ok
            if prev is not None and prev != ok:
                # 任一非回环接口变化即报（取第一个变化）
                _publish('net.down' if not ok else 'net.up', iface)
                break

    def _poll_power(self):
        try:
            b = ps.sensors_battery()
        except Exception:
            return
        if not b:
            return
        ac = bool(b.power_plugged)
        if self.ac is not None and self.ac != ac:
            _publish('power.ac' if ac else 'power.battery',
                     'plugged=%s pct=%s' % (ac, round(b.percent)))
        self.ac = ac


def _loop():
    p = _Poller()
    while not _STOP.is_set():
        try:
            p.poll()
        except Exception:
            pass
        _STOP.wait(_INTERVAL)


def start():
    """启动事件桥（幂等）。返回是否启动。"""
    global _THREAD
    if not _ENABLED:
        return False
    if os.name != 'nt':
        return False
    if _THREAD and _THREAD.is_alive():
        return True
    _STOP.clear()
    _THREAD = threading.Thread(target=_loop, name='sys-events', daemon=True)
    _THREAD.start()
    return True


def stop():
    _STOP.set()


def status():
    return {'enabled': _ENABLED, 'running': bool(_THREAD and _THREAD.is_alive()),
            'interval_s': _INTERVAL, 'whitelist': list(_WHITELIST)}


if __name__ == '__main__':
    # 手动测试：python sys_events.py，观察 os.event 输出
    from engines.common.event_bus import replay
    start()
    time.sleep(_INTERVAL * 2)
    stop()
    print(replay('os.event', limit=20))
