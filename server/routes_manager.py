# -*- coding: utf-8 -*-
"""routes_manager — 对话线路多实例管理器（S2 2026-11-12 / S4 自动伸缩 2026-11-28）。

用途：在主线实例(8620)之外管理附属线路实例（独立进程、独立 API 端口），
实现"多端口对话线路"。端口通过环境变量 API_PORT/WS_PORT 覆盖（config.py S1 支持），
不回写 port.json、不绑定任何附属端口（TTS/AI proxy/广场WS 只挂主线）。

S4 自动伸缩（本版新增）：
- 固定保底线路 route2/route3（8628/8629）始终存在，行为与旧版完全一致。
- 动态线路：负载高时自动从端口池 8631~8638（ws=api+10）拉起，最多总计 30 条线路
  （"自动适应"上限封顶 30 条；端口池可扩 DYN_PORT_POOL 常量，非物理硬限）。
  负载双触发：主线 /api/health 延迟 > 800ms 或 主线并发连接 > 8。
  注意：当前扩容为"备线拉起"（新线路就绪待分流），前端/负载层主动分流属后续工作。
- 缩容：主线空闲（延迟 < 250ms 且并发 < 2）连续 3 轮，且【被关停线路自身 0 活跃连接】
  （零连接保护，不中断进行中对话），才关停最新拉起的动态线路（保底线路永不缩容）。
  注：缩容只回收零流量冗余线，池子稳定在历史高水位属设计行为。
- 主动分流最小版（S4.3 新增 pick_route）："健康度权重选线"——对主线+全部线路实测
  /api/health 延迟与当前连接数，alive 且延迟低/连接少者优先，返回推荐线路；
  不做负载均衡、不做请求代理（前端/调用方拿结果自行选端口）。CLI: `pick`。
- 状态持久化 private/routes_state.json（含 dynamic 段），重启 watch 后可识别回收。
- watch 单实例锁：private/watch.lock 写入持有者 PID+时间戳，启动时检测既有锁持有者
  是否存活，存活则拒绝二次启动（防双实例并存——曾实测出现 16608/18644 双跑）。

设计约束（蜂群收口定夺）：
- 附属实例命令行带 --route 标记：主线 _kill_stale_instances 据此排除，不误杀。
- 附属实例不写 private/server.pid（避免主线重启误杀）。
- 附属实例不启动 tts_stream / ai_proxy 看门狗 / 广场WS（ROUTE_INSTANCE=1 断言跳过）。
- ws 端口与 api 端口解耦指定（默认 api+10），规避 switch_port ws=api+1 冲突区。

用法（工具内调用）：
    python routes_manager.py start   # 拉起全部已知线路（保底 + 状态文件中的动态线路）
    python routes_manager.py stop    # 停掉全部附属实例（含动态）
    python routes_manager.py status  # 各线路健康状态 JSON
    python routes_manager.py ensure  # 探活自愈一轮
    python routes_manager.py watch [interval]  # 自愈 + 自动伸缩常驻循环
    python routes_manager.py scale   # 单独执行一轮扩缩容判断（调试用）
    python routes_manager.py pick    # 健康度权重选线：返回当前最优线路端口（分流最小版）
"""

import os
import sys
import json
import time
import socket
import subprocess
import urllib.request
from util_log import get_logger

zf_log = get_logger('routes_manager')

_HERE = os.path.dirname(os.path.abspath(__file__))
_BASE = os.path.dirname(_HERE)
_PY = os.path.join(_BASE, 'python', 'python.exe')
SERVER_PY = os.path.join(_BASE, 'server', 'server.py')
STATE_PATH = os.path.join(_BASE, 'private', 'routes_state.json')
MAIN_PORT = 8620  # 主线 API 端口（负载探测目标）

# ===== S4 伸缩参数 =====
MAX_TOTAL_ROUTES = 30      # 线路总数上限（含保底，不含主线）
LAT_SCALE_UP = 0.80        # 主线延迟超此秒数 → 触发扩容
LAT_SCALE_DOWN = 0.25      # 延迟低于此秒数视为空闲
CONN_SCALE_UP = 8          # 主线并发连接超此 → 触发扩容
CONN_SCALE_DOWN = 2        # 并发低于此视为空闲
SCALE_DOWN_STREAK = 3      # 连续 N 轮空闲才缩容

# 固定保底线路：api 与 ws 解耦，避开 switch_port 的 ws=api+1 冲突区（8621/8629 区）
FIXED_ROUTES = [
    {'route_id': 'route2', 'api_port': 8628, 'ws_port': 8638},
    {'route_id': 'route3', 'api_port': 8629, 'ws_port': 8639},
]

# 动态线路端口池：8631~8638（ws=api+10 → 8621~8648），均在 6.0.0 约定段外延且不与
# port.json（8620-8626）及其他版本段（858x/857x/855x）冲突
DYN_PORT_POOL = list(range(8631, 8659))

# 动态线路运行时表：route_id -> {'api_port', 'ws_port', 'started_ts'}
# 启动时从 routes_state.json 的 dynamic 段恢复
DYNAMIC_ROUTES = {}
_SCALE_STREAK = 0  # 连续空闲轮计数（缩容用）


def _load_dynamic_state():
    """从 routes_state.json 恢复动态线路表（watch 重启后不丢端口记忆）。"""
    global DYNAMIC_ROUTES
    try:
        with open(STATE_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        for r in (data.get('dynamic') or []):
            DYNAMIC_ROUTES[r['route_id']] = {
                'api_port': r['api_port'], 'ws_port': r['ws_port'],
                'started_ts': r.get('started_ts', 0)}
    except Exception:
        pass


def _save_state(results=None):
    """写状态文件：results=最近一次 start 结果（可选），dynamic=动态线路表（总是写）。"""
    try:
        old = {}
        try:
            with open(STATE_PATH, 'r', encoding='utf-8') as f:
                old = json.load(f)
        except Exception:
            pass
        doc = {
            'updated': time.strftime('%Y-%m-%d %H:%M:%S'),
            'routes': results if results is not None else old.get('routes', []),
            'dynamic': [
                {'route_id': k, 'api_port': v['api_port'], 'ws_port': v['ws_port'],
                 'started_ts': v.get('started_ts', 0)}
                for k, v in DYNAMIC_ROUTES.items()],
        }
        tmp = STATE_PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(doc, f, ensure_ascii=False, indent=2)
        os.replace(tmp, STATE_PATH)  # 原子写，防半截 JSON
    except Exception as e:
        zf_log.info('[routes_manager] _save_state failed: %r' % e)


def _all_routes():
    """保底 + 动态，全部线路配置列表。"""
    out = list(FIXED_ROUTES)
    for rid in sorted(DYNAMIC_ROUTES):
        v = DYNAMIC_ROUTES[rid]
        out.append({'route_id': rid, 'api_port': v['api_port'], 'ws_port': v['ws_port']})
    return out


def _health(port, timeout=2.0):
    """探活附属实例：/api/health 返回 ok 即存活。"""
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d/api/health' % port, timeout=timeout) as r:
            return r.status < 500
    except Exception:
        return False


def _port_free(port):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            return s.connect_ex(('127.0.0.1', port)) != 0
    except Exception:
        return False


# ===== S4 负载探测 =====

def _main_latency():
    """主线 /api/health 延迟（秒）；失败返回 None。"""
    t0 = time.time()
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d/api/health' % MAIN_PORT, timeout=3.0) as r:
            r.read(64)
        return time.time() - t0
    except Exception:
        return None


def _netstat_tcp_rows(state=None):
    """S4.5 S1 单次抓取 netstat -ano -p TCP 并解析为 parts 列表快照。
    state: 可选过滤（'ESTABLISHED'/'LISTENING'，大小写不敏感），None 不过滤。
    抓取失败返回 None（区别于空列表）。一次子进程，多端口消费方共享，消 O(n) 放大。"""
    try:
        out = subprocess.run(['netstat', '-ano', '-p', 'TCP'], capture_output=True, text=True,
                             errors='replace', timeout=8, creationflags=0x08000000).stdout
    except Exception as e:
        zf_log.info('[routes_manager] _netstat_tcp_rows probe failed: %r' % e)
        return None
    rows = []
    for ln in out.splitlines():
        u = ln.upper()
        if len(u.strip()) < 5:
            continue
        if state is not None and state not in u:
            continue
        parts = ln.split()
        # netstat 行首列是协议（TCP），本地地址在 parts[1]，需完整五元组
        if len(parts) >= 5:
            rows.append(parts)
    return rows


def _conns_of(port, _rows=None):
    """指定端口的服务端并发连接数（netstat ESTABLISHED，只算 local=该端口的入站连接，
    排除自身探活等出站回环连接，避免虚高误判）。探测失败返回 None（区别于真 0 连接，
    调用方应跳过本轮而非当空闲处理）。
    _rows：可选，外部传入 _netstat_tcp_rows('ESTABLISHED') 快照（多端口复用一次抓取）。"""
    rows = _rows if _rows is not None else _netstat_tcp_rows('ESTABLISHED')
    if rows is None:
        return None
    n = 0
    for parts in rows:
        if parts[1].rsplit(':', 1)[-1] == str(port):
            n += 1
    return n


def _main_conns():
    """主线端口并发连接数（兼容旧调用）。"""
    return _conns_of(MAIN_PORT)


def load_metrics():
    """一轮负载探测：{'latency': s|None, 'conns': int}"""
    return {'latency': _main_latency(), 'conns': _main_conns()}


# ===== 启停 =====

def _spawn(cfg):
    """拉起单条线路实例，返回 status 字符串。"""
    api, ws = cfg['api_port'], cfg['ws_port']
    if _health(api):
        return 'already_running'
    if not _port_free(api):
        return 'port_occupied'
    env = os.environ.copy()
    env['API_PORT'] = str(api)
    env['WS_PORT'] = str(ws)
    env['ROUTE_INSTANCE'] = cfg['route_id']  # 代码级断言：附属实例禁挂 TTS/proxy/pid
    env['PYTHONIOENCODING'] = 'utf-8'
    log = open(os.path.join(_BASE, 'server', 'route_%s.log' % cfg['route_id']), 'a', encoding='utf-8')
    log.write('[routes_manager] launching %s api=%d ws=%d env API_PORT=%r ROUTE=%r\n' % (
        SERVER_PY, api, ws, env.get('API_PORT'), env.get('ROUTE_INSTANCE')))
    log.flush()
    subprocess.Popen(
        [_PY, '-X', 'utf8', SERVER_PY, '--route', cfg['route_id'],
         '--port', str(api), '--ws', str(ws)],
        cwd=_BASE, stdout=log, stderr=log, stdin=subprocess.DEVNULL,
        creationflags=0x08000000)  # CREATE_NO_WINDOW
    return 'starting'


def start_all():
    """拉起全部已知线路（保底 + 状态文件恢复的动态线路）。"""
    results = []
    for cfg in _all_routes():
        st = _spawn(cfg)
        results.append({**cfg, 'status': st})
    _wait_and_save(results)
    return results


def _start_one(cfg):
    """拉起单条并等待其就绪（扩容用）；成功返回 True。"""
    st = _spawn(cfg)
    if st != 'starting':
        return st == 'already_running'
    deadline = time.time() + 20
    while time.time() < deadline:
        if _health(cfg['api_port'], 1.0):
            return True
        time.sleep(1)
    return False


def _wait_and_save(results, timeout=25):
    deadline = time.time() + timeout
    pending = {r['api_port']: r for r in results if r['status'] == 'starting'}
    while pending and time.time() < deadline:
        for port, r in list(pending.items()):
            if _health(port):
                r['status'] = 'running'
                del pending[port]
        if pending:
            time.sleep(1)
    for port, r in pending.items():
        r['status'] = 'start_failed'
    _save_state(results)


def _ps_processes():
    """列举 python.exe 进程 (pid, cmdline)。强制 UTF-8 输出（中文路径经 GBK 控制台会乱码，
    导致路径匹配失败——此坑已实测踩过）。失败回退 wmic。"""
    try:
        out = subprocess.run(
            ['powershell', '-NoProfile', '-Command',
             '[Console]::OutputEncoding=[Text.Encoding]::UTF8;'
             "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
             'ForEach-Object { "{0}`t{1}" -f $_.ProcessId, $_.CommandLine }'],
            capture_output=True, text=True, encoding='utf-8', errors='replace',
            timeout=15, creationflags=0x08000000).stdout
        pairs = []
        for ln in out.splitlines():
            if '\t' not in ln:
                continue
            pid_s, cmdline = ln.split('\t', 1)
            if pid_s.strip().isdigit():
                pairs.append((int(pid_s), cmdline.strip()))
        if pairs:
            return pairs
    except Exception:
        pass
    # 回退：wmic（旧系统；wmic CSV 输出原生 GBK，按 gbk 解码）
    pairs = []
    try:
        out = subprocess.run(
            ['wmic', 'process', 'where', "name='python.exe'", 'get', 'ProcessId,CommandLine', '/format:csv'],
            capture_output=True, text=True, encoding='gbk', errors='replace',
            timeout=10, creationflags=0x08000000).stdout
        for line in out.splitlines():
            line = line.strip()
            if 'server.py' not in line or ',' not in line:
                continue
            pid = line.rsplit(',', 1)[-1].strip()
            cmdline = line.rsplit(',', 1)[0]
            if pid.isdigit():
                pairs.append((int(pid), cmdline))
    except Exception:
        pass
    return pairs


def _find_route_pid(api_port):
    """按命令行 --port 精确匹配找进程 PID。找不到返回 None。"""
    marker = '--port %d' % api_port
    base_low = os.path.abspath(_BASE).lower()
    for pid, cmdline in _ps_processes():
        if 'server.py' in cmdline and marker in cmdline and base_low in cmdline.lower():
            return pid
    return None


def _graceful_kill(pid, timeout=8):
    """先 WM_CLOSE 温和关闭，超时再强杀；返回是否成功。"""
    try:
        subprocess.run(['taskkill', '/PID', str(pid)], capture_output=True, timeout=timeout,
                       creationflags=0x08000000)
        deadline = time.time() + timeout
        while time.time() < deadline:
            if not _pid_alive(pid):
                return True
            time.sleep(0.5)
    except Exception:
        pass
    try:
        subprocess.run(['taskkill', '/F', '/PID', str(pid)], capture_output=True, timeout=10,
                       creationflags=0x08000000)
        return not _pid_alive(pid)
    except Exception:
        return False


def _pid_alive(pid):
    try:
        out = subprocess.run(['tasklist', '/FI', 'PID eq %d' % pid], capture_output=True, text=True,
                             errors='replace', timeout=8, creationflags=0x08000000).stdout
        return str(pid) in out
    except Exception:
        return True  # 查不到时保守当作存活，避免误判


def stop_all():
    """按命令行 --route 定位杀全部附属实例（含动态），避免误杀主线。"""
    killed = []
    base_low = os.path.abspath(_BASE).lower()
    for pid, cmdline in _ps_processes():
        if '--route' not in cmdline or 'server.py' not in cmdline:
            continue
        if base_low not in cmdline.lower():
            continue
        if _graceful_kill(pid):
            killed.append(pid)
    DYNAMIC_ROUTES.clear()
    _save_state()
    return killed


def _listening_pid(api_port, _rows=None):
    """netstat 直取该端口 LISTENING 状态的进程 PID（兜底定位，不依赖命令行匹配）。找不到返回 None。
    _rows：可选，外部传入 _netstat_tcp_rows('LISTENING') 快照。"""
    rows = _rows if _rows is not None else _netstat_tcp_rows('LISTENING')
    if rows is None:
        return None
    pids = set()
    for parts in rows:
        if parts[1].rsplit(':', 1)[-1] == str(api_port):
            pid = parts[-1]
            if pid.isdigit():
                pids.add(int(pid))
    return next(iter(pids)) if pids else None


def _port_listening(api_port, _rows=None):
    """该端口是否仍有进程 LISTENING（杀后复核用）。探测异常时保守返回 True（宁可当没杀掉）。
    _rows：可选，外部传入 _netstat_tcp_rows('LISTENING') 快照。"""
    rows = _rows if _rows is not None else _netstat_tcp_rows('LISTENING')
    if rows is None:
        return True
    for parts in rows:
        if parts[1].rsplit(':', 1)[-1] == str(api_port):
            return True
    return False


def stop_route(api_port):
    """只停某一条线路（缩容用）。零连接保护：若有活跃连接（非探活）则跳过本次关停，
    返回 'busy'；无连接才温和终止进程。
    S4.4 假成功修复：杀后必须复核端口 LISTENING 确已释放，未释放返回 False，
    杜绝「探测超时误判进程已不在 → 返回 True 但进程还活着」的假成功。"""
    conns = _conns_of(api_port)
    if conns is None:
        return 'busy'  # 探测失败：保守当忙，宁可不杀不可误杀
    if conns > 0:
        return 'busy'
    pid = _find_route_pid(api_port)
    if pid is None:
        # 命令行匹配失败≠进程不存在：netstat 直取 LISTENING PID 兜底
        pid = _listening_pid(api_port)
    if pid is None:
        # 兜底也没找到 PID；此时再核实端口确实无监听才允许判成功
        if _port_listening(api_port):
            return False  # 端口仍在监听但拿不到 PID：如实报失败，不做假成功
        return True
    killed = _graceful_kill(pid)
    if not killed:
        return False
    # 杀后复核：端口 LISTENING 必须消失才算真停（防 taskkill 假阳/子进程残喘）
    if _port_listening(api_port):
        zf_log.info('[routes_manager] stop_route(%d) kill reported ok but port still LISTENING, retry -F'
              % api_port)
        lp = _listening_pid(api_port)
        if lp is not None:
            try:
                subprocess.run(['taskkill', '/F', '/PID', str(lp)], capture_output=True, timeout=10,
                               creationflags=0x08000000)
                time.sleep(1.0)
            except Exception:
                pass
        return not _port_listening(api_port)
    return True


def status():
    """线路状态列表（向后兼容字段保留，S4.1 观测化增量：conns/latency/limits/updated）。"""
    lat = _main_latency()
    # S4.5 S1：单次 netstat 快照供全部线路消费，消 O(n) 子进程放大
    est_rows = _netstat_tcp_rows('ESTABLISHED')
    return [{'route_id': c['route_id'], 'api_port': c['api_port'], 'ws_port': c['ws_port'],
             'dynamic': c['route_id'] in DYNAMIC_ROUTES,
             'alive': _health(c['api_port'], 1.2),
             'conns': _conns_of(c['api_port'], _rows=est_rows),
             'main_latency_ms': round(lat * 1000, 1) if lat is not None else None,
             'limits': {'max_total_routes': MAX_TOTAL_ROUTES,
                        'dynamic': len(DYNAMIC_ROUTES),
                        'fixed': len(FIXED_ROUTES),
                        'pool': '%d-%d' % (DYN_PORT_POOL[0], DYN_PORT_POOL[-1])}} for c in _all_routes()]


# ===== S4.3 主动分流最小版：健康度权重选线 =====

def pick_route(exclude_port=None, probe_timeout=1.2):
    """对主线+全部线路做一轮健康探测，返回最优线路 dict（或 None）。
    选线判据（健康度权重，非负载均衡）：
      1) 只在 alive（/api/health 可达）线路里选；
      2) 延迟 < LAT_SCALE_DOWN 秒视为"畅通"优先；连接数为 0/None（空闲或未知）其次；
      3) 同档内延迟低者优先；全挂时回退主线端口（由调用方决定是否等待重试）。
    exclude_port：排除某端口（如调用方正在用的线路），None 不排除。
    返回 {'route_id', 'api_port', 'ws_port', 'latency_ms', 'conns', 'tier'}，
    tier: 1=畅通 / 2=空闲可用 / 3=回退主线；None=无可选线路。
    """
    cands = [{'route_id': 'main', 'api_port': MAIN_PORT, 'ws_port': None}] + _all_routes()
    # S4.5 S1：单次 netstat 快照供全部候选线路消费，消 O(n) 子进程放大
    est_rows = _netstat_tcp_rows('ESTABLISHED')
    scored = []
    for c in cands:
        if exclude_port is not None and c['api_port'] == exclude_port:
            continue
        t0 = time.time()
        alive = _health(c['api_port'], probe_timeout)
        lat = (time.time() - t0) if alive else None
        conns = _conns_of(c['api_port'], _rows=est_rows) if alive else None
        if not alive:
            continue
        if lat is not None and lat < LAT_SCALE_DOWN and conns == 0:
            tier = 1  # 畅通：低延迟且零连接
        elif conns == 0 or conns is None:
            tier = 2  # 空闲可用（连接未知按保守可用计）
        else:
            tier = 3  # 有连接但在服务：仍可选（多车道本意就是摊流量）
        scored.append({'route_id': c['route_id'], 'api_port': c['api_port'],
                       'ws_port': c.get('ws_port'), 'latency_ms': round(lat * 1000, 1),
                       'conns': conns, 'tier': tier})
    if not scored:
        return None
    scored.sort(key=lambda x: (x['tier'], x['latency_ms']))
    best = scored[0]
    if best['route_id'] == 'main':
        best['ws_port'] = None  # 主线 ws 端口由调用方按主线配置解析
    return best


# ===== S4.3 watch 单实例锁 =====
WATCH_LOCK_PATH = os.path.join(_BASE, 'private', 'watch.lock')


def _watch_lock_acquire():
    """文件锁防双实例：写 PID+时间戳；若已有锁且持有者进程存活 → 拒绝（返回 False）。
    锁持有者死亡（崩溃残留）则接管覆写。成功返回 True 并持有锁句柄语义（进程退出自然释放，靠 PID 存活性判定）。"""
    try:
        if os.path.exists(WATCH_LOCK_PATH):
            try:
                with open(WATCH_LOCK_PATH, 'r', encoding='utf-8') as f:
                    old = json.load(f)
                old_pid = old.get('pid')
                if isinstance(old_pid, int) and _pid_alive(old_pid):
                    zf_log.info('[routes_manager] watch 已有实例在跑 (pid=%d, since=%s)，拒绝双开。' % (
                        old_pid, old.get('since', '?')))
                    return False
                zf_log.info('[routes_manager] 旧锁持有者 pid=%r 已死，接管锁。' % old_pid)
            except Exception:
                zf_log.info('[routes_manager] 锁文件损坏，接管。')
        with open(WATCH_LOCK_PATH, 'w', encoding='utf-8') as f:
            json.dump({'pid': os.getpid(), 'since': time.strftime('%Y-%m-%d %H:%M:%S')}, f)
        return True
    except Exception as e:
        zf_log.info('[routes_manager] watch lock acquire failed: %r（放行为单次运行，不加锁）' % e)
        return True  # 锁机制自身故障不阻断自愈（降级为旧行为），但记录


def _watch_lock_release():
    try:
        with open(WATCH_LOCK_PATH, 'r', encoding='utf-8') as f:
            d = json.load(f)
        if d.get('pid') == os.getpid():
            os.remove(WATCH_LOCK_PATH)
    except Exception:
        pass


# ===== S4 自动伸缩 =====

def _alloc_ports():
    """从端口池挑一对空闲 api/ws 端口；池满或被占返回 None。
    已用集合 = 全部线路（保底+动态）的 api/ws 端口，防动态 api 撞保底 ws。"""
    if len(DYNAMIC_ROUTES) + len(FIXED_ROUTES) >= MAX_TOTAL_ROUTES:
        return None
    used = set()
    for v in DYNAMIC_ROUTES.values():
        used.update((v['api_port'], v['ws_port']))
    for c in FIXED_ROUTES:
        used.update((c['api_port'], c['ws_port']))
    used.add(MAIN_PORT)
    for api in DYN_PORT_POOL:
        if api in used:
            continue
        ws = api + 10
        if ws in used:
            continue
        if _port_free(api) and _port_free(ws):
            return api, ws
    return None


def scale_once():
    """执行一轮扩缩容判断，返回动作描述 dict（供 watch 循环与调试命令共用）。"""
    global _SCALE_STREAK
    m = load_metrics()
    lat, conn = m['latency'], m['conns']
    act = {'metrics': m, 'action': 'none'}

    # 主线本身挂了：不伸缩（交给主线看门狗/HeartBeat，避免误判扩容）
    if lat is None:
        act['action'] = 'main_down_skip'
        return act

    # --- 扩容：延迟高 或 并发高 ---
    if lat > LAT_SCALE_UP or conn > CONN_SCALE_UP:
        alloc = _alloc_ports()
        if alloc is None:
            act['action'] = 'scale_up_blocked'  # 池满/上限
            return act
        api, ws = alloc
        rid = 'route_dyn_%d' % api
        cfg = {'route_id': rid, 'api_port': api, 'ws_port': ws}
        ok = _start_one(cfg)
        if ok:
            DYNAMIC_ROUTES[rid] = {'api_port': api, 'ws_port': ws, 'started_ts': time.time()}
            _save_state()
            act['action'] = 'scale_up'
            act['route'] = cfg
        else:
            act['action'] = 'scale_up_failed'
        _SCALE_STREAK = 0
        return act

    # --- 缩容：目标线路自身空闲（该线路 0 活跃连接）且动态线路存在 ---
    # 判据测"被关停线路自己"的连接数，而非主线（修复扩容不分流时的闭环断裂：
    # 新线路已分流流量时，主线空闲不代表该线路空闲）
    if DYNAMIC_ROUTES and lat is not None and lat < LAT_SCALE_DOWN and conn < CONN_SCALE_DOWN:
        rid = max(DYNAMIC_ROUTES, key=lambda k: DYNAMIC_ROUTES[k].get('started_ts', 0))
        v = DYNAMIC_ROUTES[rid]
        route_conns = _conns_of(v['api_port'])
        if route_conns is None:
            # 探测失败 → 跳过本轮缩容判据，不计 streak（防网络抖动误判线路空闲）
            act['action'] = 'scale_down_probe_skip'
            return act
        if route_conns > 0:
            # 该线路还有活跃连接 → 不缩容，也不计空闲 streak
            act['action'] = 'scale_down_busy'
            act['route'] = {'route_id': rid, 'api_port': v['api_port'], 'conns': route_conns}
            _SCALE_STREAK = 0
            return act
        _SCALE_STREAK += 1
        if _SCALE_STREAK >= SCALE_DOWN_STREAK:
            r = stop_route(v['api_port'])
            if r is True:
                DYNAMIC_ROUTES.pop(rid)  # 先停成功再摘表，防孤儿实例（进程活着但状态表无人认领）
                act['action'] = 'scale_down'
            elif r == 'busy':
                act['action'] = 'scale_down_busy'
                act['route'] = {'route_id': rid, 'api_port': v['api_port']}
                _SCALE_STREAK = 0
                return act
            else:
                act['action'] = 'scale_down_failed'
            _save_state()
            _SCALE_STREAK = 0
            act['route'] = {'route_id': rid, **v}
        else:
            act['action'] = 'scale_down_pending'
            act['streak'] = _SCALE_STREAK
        return act

    _SCALE_STREAK = 0
    return act


# ===== S3 心跳自愈（沿用原逻辑，改为遍历动态线路表）=====
# 在 routes_manager 进程内自愈，不另起独立进程；指数退避，连续 5 次失败停手。
_SELFHEAL_STATE = {}  # port -> {'fails': int, 'backoff': 秒, 'stopped': bool, 'last_check': ts}


def ensure_routes(max_fail=5, base_backoff=10):
    """探活全部线路（保底+动态）；挂了按指数退避拉起（10s→20s→40s…），连续 max_fail 次失败停手。"""
    now = time.time()
    out = []
    for cfg in _all_routes():
        api = cfg['api_port']
        st = _SELFHEAL_STATE.setdefault(api, {'fails': 0, 'backoff': base_backoff, 'stopped': False, 'last_check': 0})
        st['last_check'] = now
        if st['stopped']:
            out.append({**cfg, 'heal': 'stopped_max_fail'})
            continue
        if _health(api, 1.2):
            st['fails'] = 0
            st['backoff'] = base_backoff
            out.append({**cfg, 'heal': 'alive'})
            continue
        if now - st.get('last_start', 0) < st['backoff']:
            out.append({**cfg, 'heal': 'backoff_wait', 'backoff': st['backoff']})
            continue
        ok = _start_one(cfg)
        st['last_start'] = time.time()
        if ok:
            st['fails'] = 0
            st['backoff'] = base_backoff
            out.append({**cfg, 'heal': 'restarted'})
        else:
            st['fails'] += 1
            st['backoff'] = min(base_backoff * (2 ** st['fails']), 300)
            if st['fails'] >= max_fail:
                st['stopped'] = True
                out.append({**cfg, 'heal': 'stopped_max_fail', 'fails': st['fails']})
            else:
                out.append({**cfg, 'heal': 'restart_failed', 'fails': st['fails'], 'backoff': st['backoff']})
    return out


def _ensure_main_alive(max_fail=3, base_backoff=30):
    """探活主线 8620，挂了用 restart_server.py --auto 拉起（2026-11-16 盲区补齐：
    11-16 主线因 db 锁宕机一整夜无人发现——本看门狗只管附属线路，主线死了全绿）。
    不用 _spawn 直拉主线（主线非 --route 实例，须走 restart_server 的优雅关停+托盘链路）。
    返回动作描述 dict。"""
    st = _SELFHEAL_STATE.setdefault(
        'main', {'fails': 0, 'backoff': base_backoff, 'stopped': False, 'last_start': 0})
    now = time.time()
    if _health(MAIN_PORT, 3.0):
        st['fails'] = 0
        st['backoff'] = base_backoff
        return {'target': 'main', 'heal': 'alive'}
    if st['stopped']:
        return {'target': 'main', 'heal': 'stopped_max_fail'}
    if now - st.get('last_start', 0) < st['backoff']:
        return {'target': 'main', 'heal': 'backoff_wait', 'backoff': st['backoff']}
    st['last_start'] = time.time()
    try:
        creationflags = 0x08000000  # CREATE_NO_WINDOW
    except AttributeError:
        creationflags = 0
    try:
        subprocess.Popen(
            [_PY, '-X', 'utf8', os.path.join(_HERE, 'restart_server.py'), '--auto'],
            cwd=_BASE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL, creationflags=creationflags)
        st['fails'] += 1  # 拉起结果下轮探活才知道；失败累计退避，连续 max_fail 次停手
        if st['fails'] >= max_fail:
            st['stopped'] = True
            return {'target': 'main', 'heal': 'stopped_max_fail', 'fails': st['fails']}
        return {'target': 'main', 'heal': 'restart_triggered', 'fails': st['fails']}
    except Exception as e:
        st['fails'] += 1
        return {'target': 'main', 'heal': 'spawn_error', 'err': str(e), 'fails': st['fails']}


def heal_loop(interval=60):
    """常驻自愈 + 自动伸缩循环（S4：每轮先自愈后伸缩）。"""
    if not _watch_lock_acquire():
        return  # 已有实例在跑，静默退出
    _load_dynamic_state()
    zf_log.info('[routes_manager] 心跳自愈+自动伸缩循环启动，interval=%ds pid=%d' % (interval, os.getpid()))
    try:
        while True:
            try:
                # 【2026-11-16 盲区补齐】先探主线 8620（死了拉 restart_server --auto），再自愈附属线路
                m = _ensure_main_alive()
                if m.get('heal') != 'alive':
                    zf_log.info('[routes_manager] main: %s' % json.dumps(m, ensure_ascii=False))
                snap = ensure_routes()
                bad = [x for x in snap if x.get('heal') not in ('alive',)]
                if bad:
                    zf_log.info('[routes_manager] %s' % json.dumps(bad, ensure_ascii=False))
            except Exception as e:
                zf_log.info('[routes_manager] heal_loop err: %s' % e)
            try:
                act = scale_once()
                if act.get('action') != 'none':
                    zf_log.info('[routes_manager] scale: %s' % json.dumps(act, ensure_ascii=False))
            except Exception as e:
                zf_log.info('[routes_manager] scale_loop err: %s' % e)
            time.sleep(interval)
    finally:
        _watch_lock_release()


_load_dynamic_state()  # 模块导入即恢复动态线路表（API status 端点可见）

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
    if cmd == 'start':
        zf_log.info(json.dumps(start_all(), ensure_ascii=False))
    elif cmd == 'stop':
        zf_log.info(json.dumps({'killed': stop_all()}, ensure_ascii=False))
    elif cmd == 'watch':
        heal_loop(int(sys.argv[2]) if len(sys.argv) > 2 else 60)
    elif cmd == 'ensure':
        zf_log.info(json.dumps(ensure_routes(), ensure_ascii=False))
    elif cmd == 'scale':
        zf_log.info(json.dumps(scale_once(), ensure_ascii=False))
    elif cmd == 'pick':
        zf_log.info(json.dumps(pick_route(), ensure_ascii=False))
    else:
        zf_log.info(json.dumps(status(), ensure_ascii=False))
