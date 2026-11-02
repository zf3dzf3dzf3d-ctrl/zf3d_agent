#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mobile_control - 手机控制（阶段1：ADB 通道，PC 大脑 + 手机手脚）
通过 adb 控制已连接（USB 或 WiFi）的安卓设备：
- devices:  列出已连接设备
- screenshot: 截屏并保存 PNG（返回路径，可喂给视觉模型）
- tap / swipe: 触摸点击 / 滑动
- text: 输入文本（英文数字为主，中文走 ADBKeyboard 时可用）
- key: 按键（back/home/menu/power 等 keyevent）
- app: 启动/停止/列出应用（pm list / monkey 启动）
- ui: dump UI 层级（uiautomator dump），返回控件树供 AI 决策
- shell: 透传任意 adb shell 命令（受限超时）
- wifi: 无线调试配对（adb tcpip 5555 + connect ip:port）
"""
import os
import re
import subprocess
import time

TOOL_NAME = 'mobile_control'

_ADB_CACHE = {'path': None, 'checked': 0}
DEV_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SHOT_DIR = os.path.join(DEV_ROOT, 'public', 'mobile_shots')

# 常见 adb 位置（scrcpy / platform-tools）
_ADB_CANDIDATES = [
    r'C:\platform-tools\adb.exe',
    r'C:\scrcpy\adb.exe',
    r'C:\Program Files\scrcpy\adb.exe',
    r'C:\Program Files (x86)\scrcpy\adb.exe',
    os.path.expandvars(r'%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe'),
]


def _find_adb():
    now = time.time()
    if _ADB_CACHE['path'] and now - _ADB_CACHE['checked'] < 30:
        return _ADB_CACHE['path']
    path = None
    for c in _ADB_CANDIDATES:
        if os.path.isfile(c):
            path = c
            break
    if not path:
        try:
            r = subprocess.run(['where', 'adb'], capture_output=True, timeout=5, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            if r.returncode == 0 and (r.stdout or b'').strip():
                path = (r.stdout or b'').decode('gbk', 'replace').strip().splitlines()[0]
        except Exception:
            pass
    # 探测失败不缓存，避免用户刚装好 adb 后 30s 内仍误报未找到
    if path:
        _ADB_CACHE['path'] = path
        _ADB_CACHE['checked'] = now
    elif _ADB_CACHE['path']:
        _ADB_CACHE['path'] = None
    return path


def _adb(args, device=None, timeout=15, binary=False):
    exe = _find_adb()
    if not exe:
        return None, '未找到 adb。请安装 Android platform-tools（下载 platform-tools 解压到 C:\\platform-tools）或 scrcpy，并确保 adb 在 PATH 中。'
    cmd = [exe]
    if device:
        cmd += ['-s', device]
    cmd += args
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=timeout, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if binary:
            return r.stdout, None
        out = (r.stdout or b'').decode('utf-8', 'replace') + (r.stderr or b'').decode('utf-8', 'replace')
        return out.strip(), None
    except subprocess.TimeoutExpired:
        return None, 'adb 命令超时（%ds）' % timeout
    except Exception as e:
        return None, 'adb 执行失败: %s' % e


def _devices():
    out, err = _adb(['devices', '-l'])
    if err:
        return None, err
    devs = []
    for line in (out or '').splitlines()[1:]:
        if not line.strip() or 'daemon' in line:
            continue
        parts = line.split()
        if len(parts) >= 2:
            info = line.split('device:', 1)[1].strip() if 'device:' in line else ''
            devs.append({'serial': parts[0], 'state': parts[1], 'info': info})
    return devs, None


def _pick_device(body):
    dev = body.get('device')
    if dev:
        return dev, None
    devs, err = _devices()
    if err:
        return None, err
    online = [d for d in (devs or []) if d['state'] == 'device']
    if not online:
        return None, '未检测到在线安卓设备。请：① USB 连接手机并开启「USB调试」；② 或先用 action=wifi 无线连接。可用 action=devices 查看状态。'
    return online[0]['serial'], None


KEY_EVENTS = {
    'back': 4, 'home': 3, 'menu': 82, 'power': 26, 'volume_up': 24, 'volume_down': 25,
    'enter': 66, 'del': 67, 'tab': 61, 'up': 19, 'down': 20, 'left': 21, 'right': 22,
    'recent': 187, 'camera': 27, 'focus': 80, 'mute': 164, 'call': 5, 'endcall': 6,
}


def handle(body, ctx):
    import json as _json
    action = body.get('action') or 'devices'

    # 列设备（不需要选设备）
    if action == 'devices':
        devs, err = _devices()
        if err:
            ctx.send_json({'ok': False, 'message': err, 'tool': TOOL_NAME})
            return
        if not devs:
            ctx.send_json({'ok': True, 'devices': [], 'message': '当前无任何设备连接（含离线）。', 'tool': TOOL_NAME})
            return
        lines = ['%s  [%s]  %s' % (d['serial'], d['state'], d['info']) for d in devs]
        ctx.send_json({'ok': True, 'devices': devs, 'message': '已连接 %d 台设备:\n%s' % (len(devs), '\n'.join(lines)), 'tool': TOOL_NAME})
        return

    # 无线连接
    if action == 'wifi':
        dev, err = _pick_device(body)
        if err and not body.get('connect'):
            ctx.send_json({'ok': False, 'message': err + '（USB 先连一次才能开 tcpip；若已有 ip:port 请传 connect 参数）', 'tool': TOOL_NAME})
            return
        connect = body.get('connect')  # 形如 192.168.1.100:5555
        if connect:
            out, err = _adb(['connect', connect])
            ctx.send_json({'ok': not err and 'connected' in (out or '').lower(), 'message': out or err, 'tool': TOOL_NAME})
            return
        out, err = _adb(['tcpip', '5555'], device=dev)
        if err:
            ctx.send_json({'ok': False, 'message': err, 'tool': TOOL_NAME})
            return
        ip_out, _ = _adb(['shell', 'ip', 'route'], device=dev)
        m = re.search(r'src\s+(\d+\.\d+\.\d+\.\d+)', ip_out or '')
        ip = m.group(1) if m else '手机IP'
        ctx.send_json({'ok': True, 'message': '已开启 tcpip 5555。请拔线后执行 action=wifi, connect=%s:5555' % ip, 'tool': TOOL_NAME})
        return

    # 以下动作都需要设备
    dev, err = _pick_device(body)
    if err:
        ctx.send_json({'ok': False, 'message': err, 'tool': TOOL_NAME})
        return

    if action == 'screenshot':
        os.makedirs(SHOT_DIR, exist_ok=True)
        remote = '/sdcard/_zf_shot.png'
        _adb(['shell', 'screencap', '-p', remote], device=dev, timeout=20)
        name = 'shot_%d.png' % int(time.time() * 1000)
        local = os.path.join(SHOT_DIR, name)
        out, err = _adb(['pull', remote, local], device=dev, timeout=30)
        _adb(['shell', 'rm', remote], device=dev)
        if err or not os.path.isfile(local):
            ctx.send_json({'ok': False, 'message': '截屏失败: %s %s' % (out or '', err or ''), 'tool': TOOL_NAME})
            return
        rel = os.path.relpath(local, DEV_ROOT).replace('\\', '/')
        ctx.send_json({
            'ok': True, 'path': local, 'rel_path': rel,
            'message': '截屏已保存: %s（可用视觉/读图能力查看，或在工作台打开 %s）' % (local, rel),
            'tool': TOOL_NAME,
        })
        return

    if action == 'tap':
        x, y = body.get('x'), body.get('y')
        if x is None or y is None:
            ctx.send_json({'ok': False, 'message': 'tap 需要 x/y 坐标（建议先 action=screenshot 或 ui 看屏幕）', 'tool': TOOL_NAME})
            return
        out, err = _adb(['shell', 'input', 'tap', str(int(x)), str(int(y))], device=dev)
        ctx.send_json({'ok': not err, 'message': err or '已点击 (%s, %s)' % (x, y), 'tool': TOOL_NAME})
        return

    if action == 'swipe':
        pts = [str(int(body.get(k, 0))) for k in ('x1', 'y1', 'x2', 'y2')]
        dur = str(int(body.get('duration', 300)))
        if not all(pts):
            ctx.send_json({'ok': False, 'message': 'swipe 需要 x1/y1/x2/y2', 'tool': TOOL_NAME})
            return
        out, err = _adb(['shell', 'input', 'swipe'] + pts + [dur], device=dev)
        ctx.send_json({'ok': not err, 'message': err or '已滑动 (%s,%s)→(%s,%s)' % tuple(pts), 'tool': TOOL_NAME})
        return

    if action == 'text':
        txt = body.get('text') or ''
        if not txt:
            ctx.send_json({'ok': False, 'message': 'text 需要文本内容', 'tool': TOOL_NAME})
            return
        safe = txt.replace(' ', '%s').replace("'", '')
        out, err = _adb(['shell', 'input', 'text', safe], device=dev)
        note = '' if '%s' not in txt else ''
        ctx.send_json({'ok': not err, 'message': (err or '已输入文本（空格已转义；中文输入需装 ADBKeyboard，当前仅可靠输入英文/数字/符号）'), 'tool': TOOL_NAME})
        return

    if action == 'key':
        k = (body.get('key') or '').lower()
        code = KEY_EVENTS.get(k)
        if code is None and k.startswith('keycode_'):
            code = k
        if code is None:
            ctx.send_json({'ok': False, 'message': '未知按键 %r。可用: %s 或 keycode_*' % (k, ', '.join(sorted(KEY_EVENTS))), 'tool': TOOL_NAME})
            return
        out, err = _adb(['shell', 'input', 'keyevent', str(code)], device=dev)
        ctx.send_json({'ok': not err, 'message': err or '已按 %s' % k, 'tool': TOOL_NAME})
        return

    if action == 'app':
        op = body.get('op') or 'launch'
        pkg = body.get('package') or ''
        if op == 'list':
            f = body.get('filter') or ''
            out, err = _adb(['shell', 'pm', 'list', 'packages', '-3'] if not f else ['shell', 'pm', 'list', 'packages', f], device=dev, timeout=30)
            pkgs = sorted(l.replace('package:', '') for l in (out or '').splitlines() if l.startswith('package:'))
            ctx.send_json({'ok': not err, 'packages': pkgs[:200], 'message': err or '共 %d 个第三方包（前200）:\n%s' % (len(pkgs), '\n'.join(pkgs[:200])), 'tool': TOOL_NAME})
            return
        if not pkg:
            ctx.send_json({'ok': False, 'message': 'app 操作需要 package（如 com.tencent.mm）。可用 op=list 查包名', 'tool': TOOL_NAME})
            return
        if op == 'launch':
            out, err = _adb(['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], device=dev, timeout=20)
            ok = not err and 'Events injected: 1' in (out or '')
            ctx.send_json({'ok': ok, 'message': err or ('已启动 %s' % pkg if ok else '启动失败，确认包名正确: ' + (out or '')[:200]), 'tool': TOOL_NAME})
            return
        if op == 'stop':
            out, err = _adb(['shell', 'am', 'force-stop', pkg], device=dev)
            ctx.send_json({'ok': not err, 'message': err or '已停止 %s' % pkg, 'tool': TOOL_NAME})
            return
        ctx.send_json({'ok': False, 'message': '未知 app op: %r（launch/stop/list）' % op, 'tool': TOOL_NAME})
        return

    if action == 'ui':
        _adb(['shell', 'uiautomator', 'dump', '/sdcard/_zf_ui.xml'], device=dev, timeout=25)
        local = os.path.join(SHOT_DIR, 'ui_%d.xml' % int(time.time() * 1000))
        os.makedirs(SHOT_DIR, exist_ok=True)
        out, err = _adb(['pull', '/sdcard/_zf_ui.xml', local], device=dev, timeout=20)
        _adb(['shell', 'rm', '/sdcard/_zf_ui.xml'], device=dev)
        if not os.path.isfile(local):
            ctx.send_json({'ok': False, 'message': 'UI dump 失败: %s %s' % (out or '', err or ''), 'tool': TOOL_NAME})
            return
        xml = open(local, encoding='utf-8', errors='replace').read()
        # 提炼可交互节点，压缩给 AI
        nodes = re.findall(r'<node[^>]*?(?:text="([^"]*)")[^>]*?(?:resource-id="([^"]*)")[^>]*?(?:bounds="(\[[^"]*\])")?[^>]*/?>', xml)
        items = []
        for t, rid, bounds in nodes:
            if t or rid:
                m = re.search(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds or '')
                cx = cy = ''
                if m:
                    cx, cy = str((int(m.group(1)) + int(m.group(3))) // 2), str((int(m.group(2)) + int(m.group(4))) // 2)
                items.append({'text': t, 'id': rid, 'center': [cx, cy]})
        ctx.send_json({
            'ok': True, 'xml_path': local, 'nodes': items[:300],
            'message': '共提炼 %d 个带文本/ID 的控件（截取前300，含中心坐标可直接 tap）:\n%s' % (
                len(items), '\n'.join('%s | %s | 点击(%s,%s)' % (i['text'] or '-', i['id'] or '-', *i['center']) for i in items[:60])),
            'tool': TOOL_NAME,
        })
        return

    if action == 'shell':
        cmd = body.get('command') or ''
        if not cmd:
            ctx.send_json({'ok': False, 'message': 'shell 需要 command', 'tool': TOOL_NAME})
            return
        # 高危命令二次确认（审核建议）：rm/uninstall/pm clear/reboot 等 dangerous 前缀需显式 confirm=true
        head = cmd.split()[0] if cmd.split() else ''
        dangerous = head in ('reboot',) or head in ('rm', 'pm', 'am', 'settings') and bool(
            re.search(r'\b(uninstall|clear|disable|wipe|reboot)\b', cmd))
        if dangerous and not body.get('confirm'):
            ctx.send_json({'ok': False, 'need_confirm': True,
                           'message': '高危 shell 命令（%s...），可能不可逆。确认执行请携带 confirm=true 重新调用' % cmd[:80], 'tool': TOOL_NAME})
            return
        out, err = _adb(['shell'] + cmd.split(), device=dev, timeout=int(body.get('timeout') or 15))
        ctx.send_json({'ok': not err, 'output': (out or '')[:4000], 'message': err or (out or '(无输出)')[:4000], 'tool': TOOL_NAME})
        return

    ctx.send_json({'ok': False, 'message': '未知 action: %r。可用: devices/wifi/screenshot/tap/swipe/text/key/app/ui/shell', 'tool': TOOL_NAME})
