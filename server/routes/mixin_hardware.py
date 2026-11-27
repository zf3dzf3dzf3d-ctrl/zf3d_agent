# -*- coding: utf-8 -*-
"""i硬件 M-H1 后端底座（策划案 v2.2）
GET /api/hw/info   -> 静态配置（CIM 低频采集，进程内缓存 10 分钟）
GET /api/hw/live   -> 实时仪表（纯 psutil，禁 CIM）
GET /api/hw/sanitize-preview -> 脱敏清单预览（结构化白名单组装，供"问AI"前核对）

安全红线（v2.2 采纳1）：
- 白话解读默认本地规则生成，不出网；
- 任何喂给云端模型的数据必须走 build_sanitized_context()——
  结构化字段白名单组装，禁整段文本正则清洗。
温度：Windows 无标准接口（psutil 无 sensors_temperatures），恒返回 available=False，
     前端显示占位提示（M-H1 验收项）。
"""
import json
import os
import platform
import re
import subprocess
import threading
import time
from urllib.parse import urlparse, parse_qs

from routes._shared import *
from routes.mixin_base import MixinBase

try:
    import psutil
    _PSUTIL_OK = True
except Exception:
    psutil = None
    _PSUTIL_OK = False

_BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# extra 轮询子进程缓存（2026-11-12 收口采纳：每5s轮询 spawn nvidia-smi/netsh 开销大，
# GPU/WiFi 结果缓存 30s，CPU 频率/每核占用仍实时 psutil 取）
_EXTRA_TTL = 30  # 秒
_extra_cache = {}  # key -> (data, ts)
_extra_lock = threading.Lock()


def _extra_cached(key, fn):
    """带 TTL 的子进程采集缓存；采集失败沿用上次结果。"""
    now = time.time()
    with _extra_lock:
        hit = _extra_cache.get(key)
        if hit and now - hit[1] < _EXTRA_TTL:
            return hit[0]
    try:
        data = fn()
    except Exception:
        return hit[0] if hit else None
    with _extra_lock:
        _extra_cache[key] = (data, now)
    return data


def _gpu_probe():
    """GPU 一次探测：N 卡 nvidia-smi，失败回退 CIM 型号/驱动。"""
    gpu = {'available': False}
    try:
        r = subprocess.run(
            ['nvidia-smi', '--query-gpu=name,utilization.gpu,memory.used,memory.total,driver_version',
             '--format=csv,noheader,nounits'],
            capture_output=True, timeout=_CIM_TIMEOUT, creationflags=0x08000000)
        line = r.stdout.decode('utf-8', 'ignore').strip().splitlines()
        if line and ',' in line[0]:
            f = [x.strip() for x in line[0].split(',')]
            if len(f) >= 5:
                gpu = {'available': True, 'vendor': 'NVIDIA', 'name': f[0][:60],
                       'utilPct': _f_or_none(f[1]),
                       'memUsedMB': _f_or_none(f[2]), 'memTotalMB': _f_or_none(f[3]),
                       'driverVersion': f[4][:40]}
                return gpu
    except Exception:
        pass
    g = _cim('Win32_VideoController', ['Name', 'DriverVersion', 'AdapterRAM'])
    if g:
        g0 = g[0]
        vram = g0.get('AdapterRAM')
        gpu = {'available': True, 'vendor': 'Other', 'name': str(g0.get('Name') or '')[:60],
               'utilPct': None, 'driverVersion': str(g0.get('DriverVersion') or '')[:40],
               'memTotalMB': round(int(vram) / 1024**2) if vram else None,
               'note': '该显卡无标准利用率接口，仅显示型号/驱动'}
    return gpu


def _wifi_probe():
    """WiFi 一次探测：netsh wlan show interfaces（本机回环限定）。"""
    try:
        r = subprocess.run(['netsh', 'wlan', 'show', 'interfaces'],
                           capture_output=True, timeout=_CIM_TIMEOUT, creationflags=0x08000000)
        out = r.stdout.decode('gbk', 'ignore')
        if not out.strip():
            return {'available': False}

        def _pick(key):
            mm = re.search(key + r'\s*:\s*(.+)', out)
            return mm.group(1).strip() if mm else None
        ssid = _pick(r'\bSSID')
        # SSID 行缺失时不兜底取 BSSID 行（那是 MAC 地址非网络名），置空走下方 note 提示
        if not ssid:
            b = _pick('BSSID')
            ssid = None if (b and re.match(r'^[0-9a-fA-F]{2}(-[0-9a-fA-F]{2}){5}$', b)) else b
        sig = _pick('信号')
        state_ = _pick('状态')
        wifi = {'available': True,
                'ssid': (ssid or '')[:32],
                'state': (state_ or '')[:16],
                'signalPct': _f_or_none(re.sub(r'\D', '', sig or '') or None),
                'radio': (_pick('无线电类型') or '')[:16],
                'auth': (_pick('身份验证') or '')[:16]}
        if not wifi['ssid']:
            wifi['note'] = '当前未连接 WLAN（可能使用有线或无网卡）'
        return wifi
    except Exception:
        return {'available': False}

def _disk_usage_list(full=False):
    """分区用量采集（psutil）：两处共用（_collect_info 要全字段，live 只要 pct/free）。
    含路径但只在本机展示、不进脱敏上下文。"""
    out = []
    for p in _safe_psutil(lambda: psutil.disk_partitions(), [])[:12]:
        if 'cdrom' in p.opts or not p.fstype:
            continue
        try:
            u = psutil.disk_usage(p.mountpoint)
            row = {'mount': p.mountpoint, 'pct': round(u.percent),
                   'freeGB': round(u.free / 1024**3)}
            if full:
                row.update({'totalGB': round(u.total / 1024**3),
                            'usedGB': round(u.used / 1024**3)})
            out.append(row)
        except Exception:
            pass
    return out


_info_cache = {'data': None, 'ts': 0}
_info_lock = threading.Lock()
_INFO_TTL = 600  # 秒

# CIM 采集超时（秒），防秒级阻塞拖垮请求
_CIM_TIMEOUT = 8


def _cim(cls, props):
    """PowerShell Get-CimInstance 采集（wmic 已弃用，仅此低频路径用 CIM）。"""
    props_s = ','.join(props)
    cmd = ['powershell', '-NoProfile', '-Command',
           'Get-CimInstance -ClassName %s | Select-Object -Property %s '
           '| ConvertTo-Json -Compress -Depth 2' % (cls, props_s)]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=_CIM_TIMEOUT,
                           creationflags=0x08000000)  # CREATE_NO_WINDOW
        out = r.stdout.decode('utf-8', 'ignore')
        if not out.strip():
            return []
        data = json.loads(out)
        return data if isinstance(data, list) else [data]
    except Exception:
        return []


def _safe_psutil(fn, default=None):
    if not _PSUTIL_OK:
        return default
    try:
        return fn()
    except Exception:
        return default


def _f_or_none(s):
    """字符串转 float，失败返回 None（netsh/nvidia-smi 解析用）。"""
    try:
        return float(s)
    except Exception:
        return None


# ============================================================
# 脱敏：结构化字段白名单组装（红线级，禁正则清洗整段文本）
# ============================================================

# 允许喂给云端模型的枚举字段白名单（值必须来自程序枚举，非用户文本）
_SANITIZE_FIELDS = {
    'cpu': ['name', 'coresPhysical', 'coresLogical', 'arch'],
    'memory': ['totalGB'],
    'disk': ['model', 'totalGB'],      # 只发型号/容量，绝不发卷路径/序列号
    'gpu': ['name', 'driverVersion'],
    'os': ['name', 'version'],
}


def build_sanitized_context(info):
    """从采集结果中只挑白名单枚举字段组装脱敏上下文。
    返回 (sanitized_dict, preview_list)：preview 为逐字段说明，供弹卡强制展示。
    """
    out = {}
    preview = []
    for sec, fields in _SANITIZE_FIELDS.items():
        src = info.get(sec)
        # 兼容三种产出形态：dict（cpu/memory/os）、{'list':[...]}（disk）、[...]（gpu）
        if isinstance(src, dict):
            items = src.get('list') if isinstance(src.get('list'), list) else [src]
        elif isinstance(src, list):
            items = src
        else:
            items = []
        multi = len([x for x in items if isinstance(x, dict)]) > 1
        for idx, it in enumerate(items):
            if not isinstance(it, dict):
                continue
            tag = '%s[%d]' % (sec, idx) if multi else sec
            for f in fields:
                v = it.get(f)
                if v in (None, '', 0):
                    continue
                out.setdefault(sec, {})
                out[sec].setdefault(str(idx) if multi else f, v)
                preview.append('%s.%s = %s' % (tag, f, v))
    return out, preview


def _redact(s):
    """双保险兜底：即便白名单字段意外携带路径/用户名形态，先抹再发。
    注意：这是兜底不是主手段，主手段是只挑枚举字段。"""
    if not isinstance(s, str):
        return s
    s = re.sub(r'[A-Za-z]:\\[^\s"\']+', '<path>', s)
    s = re.sub(r'\\Users\\[^\\]+', r'\\Users\\<user>', s)
    return s


class MixinHardware(MixinBase):

    # ---------- 来源校验（安全审查采纳①）：仅本机回环可访问 ----------
    def _hw_local_only(self):
        """服务可配 0.0.0.0 对局域网开放，硬件端点仅允许 127.0.0.1/::1。"""
        try:
            ip = self.client_address[0]
        except Exception:
            ip = ''
        if ip in ('127.0.0.1', '::1', 'localhost'):
            return True
        self._send_json({'ok': False, 'err': 'hardware endpoints are local-only'}, 403)
        return False

    # 装饰器版（收口R2·代码师②采纳）：安全检查不再靠人肉记得调用，
    # M-H2 新端点一律用 @hw_local 装饰，禁止裸函数直接挂分发。
    @staticmethod
    def _hw_local(fn):
        def wrapper(self, *a, **kw):
            if not self._hw_local_only():
                return
            return fn(self, *a, **kw)
        wrapper.__name__ = fn.__name__
        return wrapper

    # ---------- /api/hw/info：静态配置（CIM+psutil，缓存10分钟） ----------
    @_hw_local
    def _handle_hw_info(self):
        with _info_lock:
            now = time.time()
            if _info_cache['data'] and now - _info_cache['ts'] < _INFO_TTL:
                return self._send_json({'ok': True, 'cached': True,
                                        'info': _info_cache['data']})
            info = self._collect_info()
            _info_cache['data'] = info
            _info_cache['ts'] = now
        local_read = self._local_interpret(info)
        self._send_json({'ok': True, 'cached': False, 'info': info,
                         'localRead': local_read})

    def _collect_info(self):
        vm = _safe_psutil(lambda: psutil.virtual_memory(), None)
        cpu_name = platform.processor() or ''
        # CIM 补充 CPU 型号/磁盘/GPU（失败静默，关键项 psutil 兜底）
        cpu_cim = _cim('Win32_Processor', ['Name', 'NumberOfCores', 'NumberOfLogicalProcessors'])
        disks = _cim('Win32_DiskDrive', ['Model', 'Size'])
        gpus = _cim('Win32_VideoController', ['Name', 'DriverVersion'])
        if cpu_cim:
            cpu_name = str(cpu_cim[0].get('Name') or cpu_name)

        disk_list = []
        for d in disks[:8]:
            try:
                size = int(d.get('Size') or 0)
            except Exception:
                size = 0
            disk_list.append({'model': str(d.get('Model') or '')[:80],
                              'totalGB': round(size / 1024**3)})

        # 分区用量（psutil，含路径但只在本机展示、不进脱敏上下文）
        parts = _disk_usage_list(full=True)

        return {
            'cpu': {
                'name': cpu_name[:80],
                'coresPhysical': (cpu_cim[0].get('NumberOfCores') if cpu_cim else None)
                                 or _safe_psutil(lambda: psutil.cpu_count(logical=False)),
                'coresLogical': (cpu_cim[0].get('NumberOfLogicalProcessors') if cpu_cim else None)
                                or _safe_psutil(lambda: psutil.cpu_count()),
                'arch': platform.machine(),
            },
            'memory': {
                'totalGB': round((vm.total / 1024**3), 1) if vm else None,
            },
            'disk': {'list': disk_list},
            'partitions': parts,
            'gpu': [{'name': str(g.get('Name') or '')[:80],
                     'driverVersion': str(g.get('DriverVersion') or '')[:40]}
                    for g in gpus[:4]],
            'os': {
                'name': 'Windows',
                'version': platform.version(),
            },
            'temperature': {'available': False,
                            'note': '本机无标准温度接口，实时温度不可用'},
            'psutilOk': _PSUTIL_OK,
            'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
        }

    def _local_interpret(self, info):
        """本地白话解读（默认不出网）。纯规则：等级+建议。"""
        try:
            cores = int(info['cpu'].get('coresLogical') or 0)
            mem = float(info['memory'].get('totalGB') or 0)
        except Exception:
            cores, mem = 0, 0
        if cores >= 12 and mem >= 16:
            grade, note = '高配', '多开智能体窗口毫无压力'
        elif cores >= 6 and mem >= 8:
            grade, note = '主流', '日常多任务够用，大型任务建议关掉多余窗口'
        else:
            grade, note = '入门', '建议一次跑 1-2 个智能体窗口，避免卡顿'
        return {'grade': grade, 'note': note,
                'text': '%d核%dGB内存，%s：%s' % (cores, mem, grade, note)}

    # ---------- /api/hw/extra：CPU频率/每核占用 + GPU占用/显存 + WiFi ----------
    @_hw_local
    def _handle_hw_extra(self):
        if not _PSUTIL_OK:
            return self._send_json({'ok': False, 'err': 'psutil unavailable'}, 503)
        # CPU 频率与每核占用
        freq = _safe_psutil(lambda: psutil.cpu_freq(), None)
        per_core = _safe_psutil(lambda: psutil.cpu_percent(interval=0.2, percpu=True), [])
        load5 = _safe_psutil(lambda: [x / psutil.cpu_count() for x in psutil.getloadavg()], None) \
            if hasattr(psutil, 'getloadavg') else None
        # GPU：优先 nvidia-smi（N卡显存/利用率），失败则 available=False（30s 缓存）
        gpu = _extra_cached('gpu', _gpu_probe) or {'available': False}
        # WiFi：netsh wlan show interfaces（本机回环限定，30s 缓存）
        wifi = _extra_cached('wifi', _wifi_probe) or {'available': False}
        self._send_json({
            'ok': True,
            'cpu': {'freqMHz': round(freq.current) if freq else None,
                    'maxMHz': round(freq.max) if freq and freq.max else None,
                    'perCorePct': [round(x) for x in per_core]},
            'gpu': gpu,
            'wifi': wifi,
            'ts': time.strftime('%H:%M:%S'),
        })

    # ---------- POST /api/hw/driver-open：驱动更新对话框的系统入口 ----------
    # 安全边界：target 白名单显式常量，仅允许两个系统入口跳转；
    # 禁止扩展为任意命令执行——新增目标必须走 os.startfile 协议/Popen 数组且逐项评审
    DRIVER_OPEN_TARGETS = ('windowsupdate', 'devmgr')

    @_hw_local
    def _handle_hw_driver_open(self):
        target = ''
        try:
            # 入口 _drain_body 已读走 body，二次 rfile.read 会永久阻塞——必须走缓存
            body = json.loads(self._cached_body(int(self.headers.get('Content-Length') or 0)) or b'{}')
            target = str(body.get('target') or '')
        except Exception:
            target = ''
        if target not in self.DRIVER_OPEN_TARGETS:
            return self._send_json({'ok': False, 'err': 'bad target'}, 400)
        try:
            if target == 'windowsupdate':
                os.startfile('ms-settings:windowsupdate')
            else:
                subprocess.Popen(['devmgmt.msc'], creationflags=0x08000000)
            self._send_json({'ok': True})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)[:120]}, 500)

    # ---------- GET /api/hw/driver-check：驱动版本检测（策划案-i硬件驱动更新流程 v1） ----------
    # 官方下载页白名单：全部硬编码常量，禁止由探测字符串拼接 URL（防注入）
    DRIVER_VENDOR_URLS = {
        'NVIDIA': 'https://www.nvidia.cn/Download/index.aspx',
        'AMD': 'https://www.amd.com/zh-hans/support',
        'Intel': 'https://www.intel.cn/content/www/cn/zh/download-center/home.html',
        'Realtek': 'https://www.realtek.com/Download',
        'Qualcomm': 'https://www.qualcomm.com/support',
        'Broadcom': 'https://www.broadcom.com/support/download-search',
        'MediaTek': 'https://www.mediatek.com/products',
        'ASUSTeK': 'https://www.asus.com.cn/support/',
        'MSI': 'https://www.msi.cn/support/download',
        'Gigabyte': 'https://www.gigabyte.cn/Support',
        'ASRock': 'https://www.asrock.com/mb/download.asp',
    }

    # 供 vendor 探测比对的 key 集（与白名单对应，恒 None 兜底改 Other，防错引官网）
    DRIVER_VENDOR_KEYS = ('Realtek', 'NVIDIA', 'AMD', 'Intel',
                          'Qualcomm', 'Broadcom', 'MediaTek',
                          'ASUSTeK', 'MSI', 'Gigabyte', 'ASRock')

    def _hw_driver_check_data(self, typ):
        """按类型采集当前驱动版本（纯读，30s 缓存）。"""
        if typ == 'gpu':
            g = _extra_cached('gpu', _gpu_probe) or {}
            return {'ok': bool(g.get('available')), 'name': g.get('name'),
                    'vendor': g.get('vendor') or 'Other',
                    'version': g.get('driverVersion')}
        if typ == 'audio':
            r = _cim('Win32_SoundDevice', ['Name', 'Manufacturer', 'Status'])
            # 过滤虚拟/HDMI 伴音设备，优先真实主声卡（2026-11-12 收口采纳反驳师②）
            real = [s for s in (r or []) if not re.search(
                r'virtual|hdmi|display ?audio|nvidia|remote|webcam|camera',
                str(s.get('Name') or '') + ' ' + str(s.get('Manufacturer') or ''), re.I)]
            # 过滤后为空时回退未过滤列表，但须警示（代码师②：虚拟声卡残留缝隙，2026-11-12 收口）
            r0 = (real or r or [None])[0]
            if not r0:
                return {'ok': False}
            manu = str(r0.get('Manufacturer') or '')
            vendor = next((v for v in self.DRIVER_VENDOR_KEYS
                           if v.lower() in manu.lower()), None)
            note = '声卡驱动版本 WMI 不提供，请到官网对照'
            if not real:
                note = ('未识别到主声卡，当前选中项可能为虚拟/伴音设备，'
                        '信息仅供参考；请优先在设备管理器中确认主声卡')
            return {'ok': True, 'name': str(r0.get('Name') or '')[:80],
                    'vendor': vendor or 'Other', 'version': None,
                    'note': note}
        if typ in ('net_wired', 'net_wifi'):
            adapters = _cim('Win32_NetworkAdapter',
                            ['Name', 'Manufacturer', 'NetEnabled', 'PhysicalAdapter'])
            cands = [a for a in (adapters or [])
                     if a.get('PhysicalAdapter') and a.get('NetEnabled')]
            if typ == 'net_wifi':
                wifi = [a for a in cands if re.search(
                    r'wireless|wi-?fi|802\.11|wlan', str(a.get('Name') or ''), re.I)]
                cands = wifi or cands
            else:
                wired = [a for a in cands if not re.search(
                    r'wireless|wi-?fi|802\.11|wlan|virtual|bluetooth', str(a.get('Name') or ''), re.I)]
                cands = wired or cands
            if not cands:
                return {'ok': False}
            a0 = cands[0]
            manu = str(a0.get('Manufacturer') or '')
            # 非白名单厂商不再错引 Realtek，返回 None 由前端走设备管理器兜底（反驳师①）
            vendor = next((v for v in self.DRIVER_VENDOR_KEYS
                           if v.lower() in manu.lower()), None)
            return {'ok': True, 'name': str(a0.get('Name') or '')[:80],
                    'vendor': vendor or 'Other', 'version': None,
                    'note': '网卡驱动版本请到设备管理器或官网核对'}
        if typ == 'board':
            bb = _cim('Win32_BaseBoard', ['Manufacturer', 'Product'])
            bios = _cim('Win32_BIOS', ['Manufacturer', 'SMBIOSBIOSVersion', 'ReleaseDate'])
            if not bb:
                return {'ok': False}
            b0 = bb[0]
            bio0 = (bios or [{}])[0]
            return {'ok': True,
                    'name': (str(b0.get('Manufacturer') or '') + ' ' + str(b0.get('Product') or '')).strip()[:80],
                    'vendor': next((v for v in self.DRIVER_VENDOR_KEYS
                                    if v.lower() in str(b0.get('Manufacturer') or '').lower()), None) or 'Other',
                    'version': ('BIOS ' + str(bio0.get('SMBIOSBIOSVersion') or ''))[:60] or None,
                    'note': '主板驱动/BIOS 请按主板型号到厂商官网下载'}
        return {'ok': False}

    @_hw_local
    def _handle_hw_driver_check(self):
        """GET /api/hw/driver-check?type=gpu|audio|net_wired|net_wifi|board"""
        qs = getattr(self, 'parsed_qs', {}) or {}
        typ = ''
        try:
            q = parse_qs(urlparse(self.path).query)
            typ = (q.get('type') or [''])[0]
        except Exception:
            typ = ''
        if typ not in ('gpu', 'audio', 'net_wired', 'net_wifi', 'board'):
            return self._send_json({'ok': False, 'err': 'bad type'}, 400)
        data = _extra_cached('drv_' + typ, lambda: self._hw_driver_check_data(typ)) \
            or {'ok': False}
        # 官方页 URL：只按厂商查白名单常量；查不到恒 None（前端走设备管理器兜底），
        # 严禁 fallback 到其他厂商页面（防错引，2026-11-12 收口采纳反驳师①）。
        # board 已放开按主板厂商匹配白名单（2026-11-12 用户拍板 enable）
        vendor = str(data.get('vendor') or '')
        url = self.DRIVER_VENDOR_URLS.get(vendor)
        self._send_json({'ok': data.get('ok'), 'type': typ, 'name': data.get('name'),
                         'vendor': vendor, 'version': data.get('version'),
                         'note': data.get('note'), 'officialUrl': url})

    # ---------- /api/hw/live：实时仪表（纯 psutil，禁 CIM） ----------
    @_hw_local
    def _handle_hw_live(self):
        if not _PSUTIL_OK:
            return self._send_json({'ok': False, 'err': 'psutil unavailable'}, 503)
        cpu = _safe_psutil(lambda: psutil.cpu_percent(interval=0.2), 0)
        vm = _safe_psutil(lambda: psutil.virtual_memory(), None)
        disks = _disk_usage_list()
        try:
            procs = len(psutil.pids())
        except Exception:
            procs = 0
        self._send_json({
            'ok': True,
            'cpuPct': cpu,
            'memPct': round(vm.percent) if vm else None,
            'memUsedGB': round((vm.total - vm.available) / 1024**3, 1) if vm else None,
            'memTotalGB': round(vm.total / 1024**3, 1) if vm else None,
            'disks': disks,
            'processes': procs,
            'temperature': {'available': False},  # Windows 占位提示（验收项）
        })

