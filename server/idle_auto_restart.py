# -*- coding: utf-8 -*-
"""auto_restart_idle.py — 空闲自动重启调度器（托盘内线程）"""
import os, sys, time, threading, urllib.request, json

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, _HERE)

STATE_FILE = os.path.join(_ROOT, 'server', '.combo_state.json')
CHECK_INTERVAL = 20 * 60          # 每 20 分钟检查一次
IDLE_CONFIRM = 10                 # 需连续空闲 10 秒
# 重启脚本（复用托盘同款无感重启）
RESTART_SCRIPT = os.path.join(_HERE, 'restart_server.py')
LOG = os.path.join(_ROOT, 'server', '.auto_idle_restart.log')


def _log(msg):
    try:
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(time.strftime('[%Y-%m-%d %H:%M:%S] ') + msg + '\n')
    except Exception:
        pass


def _get_combo():
    """读前端上报的暴击状态文件 {combo: n, ts: 时间戳}"""
    try:
        with open(STATE_FILE, encoding='utf-8') as f:
            d = json.load(f)
        return int(d.get('combo', -1)), float(d.get('ts', 0))
    except Exception:
        return -1, 0


def _get_port():
    """从 private/port.json 读取实际 api_port，失败兜底 8570。
    【自检抓 bug 2026-11-23】原候选两路径同为 server/private/port.json（不存在），
    根目录 private/port.json（真身，6.2.0 端口段 8620-8630）从未被读到 →
    永远用默认 8570 探活 → 永远"服务不在线" → 空闲重启看门狗自端口迁移后从未工作过。"""
    for cand in (os.path.join(_ROOT, 'private', 'port.json'),
                 os.path.join(_ROOT, 'server', 'private', 'port.json'),
                 os.path.join(_HERE, 'private', 'port.json')):
        try:
            # utf-8-sig：真身文件带 BOM（与其他读方 trustee/doctor 同口径），utf-8 会解析失败
            with open(cand, encoding='utf-8-sig') as f:
                return int(json.load(f).get('api_port', 8620))
        except Exception:
            continue
    return 8620  # 兜底默认与 6.2.0 端口段一致


def _health_ok():
    try:
        port = _get_port()
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=3) as r:
            return r.status == 200
    except Exception:
        return False


def _pool_busy():
    """有正在跑的 chat-pool Turn（AI 对话进行中）则视为非空闲，禁止重启。
    防止无感重启掐断进行中的对话：槽位在内存里，重启即丢，前端 SSE 会 404。"""
    try:
        port = _get_port()
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/chat-pool/active', timeout=3) as r:
            d = json.loads(r.read().decode('utf-8'))
        return bool(d.get('active') or d.get('slots') or d.get('turns') or d.get('items') or d.get('list'))
    except Exception:
        return True  # 探测失败/超时（往往是 server 正忙）→ 视为忙，跳过本轮重启更安全


def _town_busy():
    """有在途小镇工单（村民后台真工具干活中，15分钟内有心跳）则视为非空闲，禁止重启。
    【盲区修复 2026-11-23】原检查只看 chat-pool，村民派单跑在后台守护线程里完全不可见，
    无感重启照样掐断在途工单（job-1795378354282 审单半路死亡实锤）。探测失败按忙处理（保守）。"""
    try:
        port = _get_port()
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/town/jobs-active', timeout=3) as r:
            d = json.loads(r.read().decode('utf-8'))
        return bool(d.get('active'))
    except Exception:
        return True  # 探测失败/超时 → 视为忙，跳过本轮重启更安全


def _trigger_restart():
    import subprocess
    # 【对齐托盘】与 tray_server._on_restart 完全一致的启动方式：
    # exe 选择逻辑、cmd start /b 分离启动（脱离托盘进程树，防 taskkill /T 连带）、
    # cwd=项目根目录。本路径属自动重启，保留 --auto 供 restart_server 日志/语义
    # 识别（托盘手动交棒路径不带，二者由此区分）。
    exe = sys.executable
    base = os.path.basename(exe).lower()
    if not base.startswith('pythonw'):
        _pw = os.path.join(os.path.dirname(exe), 'pythonw.exe')
        if base == 'python.exe' and os.path.exists(_pw):
            exe = _pw
    _log('空闲确认，触发无感重启（托盘同款 start /b 交棒）')
    # 【安全收口】argv 列表 + shell=False（修复 shell 注入面），start /b 分离语义不变
    cmd = ['cmd', '/c', 'start', '', '/b', exe, RESTART_SCRIPT, '--auto']
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    subprocess.Popen(cmd, shell=False, cwd=os.path.dirname(os.path.dirname(RESTART_SCRIPT)),
                     creationflags=flags)


def start_watcher():
    """后台守护线程：每 10 分钟检查一次，暴击数==0 持续 10 秒 → 重启"""
    def _work():
        while True:
            time.sleep(CHECK_INTERVAL)
            if not _health_ok():
                _log('服务不在线/异常，跳过本轮（等托盘心跳自救处理）')
                continue
            combo, ts = _get_combo()
            if time.time() - ts > 300:
                _log('暴击状态过期(>5分钟无上报，页面可能已关闭)，跳过')
                continue
            if combo != 0:
                _log(f'combo={combo} 非空闲，跳过')
                continue
            if _pool_busy():
                _log('chat-pool 有活跃 Turn（AI 对话进行中），跳过重启')
                continue
            if _town_busy():
                _log('小镇有在途工单（村民干活中），跳过重启')
                continue
            # 确认持续空闲 10 秒（期间 combo 一直为 0 且页面没刷新出新数据）
            ok = True
            for _ in range(IDLE_CONFIRM):
                time.sleep(1)
                c2, ts2 = _get_combo()
                if time.time() - ts2 > 300:  # 页面恰在此期间关闭，状态过期
                    ok = False
                    break
                if c2 != 0:
                    ok = False
                    break
            if ok:
                _log('确认空闲 10 秒，执行自动重启')
                _trigger_restart()
            else:
                _log('等待期间暴击数变化，取消本轮重启')

    t = threading.Thread(target=_work, name='zf-idle-restart', daemon=True)
    t.start()
    _log('空闲自动重启守护线程已启动（每10分钟检查，combo==0 持续10秒才重启）')
    return t
