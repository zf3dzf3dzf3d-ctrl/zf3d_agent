#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
朱峰社区智能体 - 心跳上报模块
参考自：新系统_v2_开发版/公共区/内核/网页服务.py 的 _上报心跳() 函数

功能：
  - 后台守护线程，每 120 秒向朱峰社区网站 API 上报心跳
  - 上报内容：machine_id、version、logged_in、username、user_id
  - 管理员账号跳过心跳
  - api_key 内置默认值，不依赖用户登录；如数据库有自定义值则优先使用
  - 登录状态从数据库的 cookies + username 判断
"""

import os
import sys
import json
import time
import ssl
import hashlib
import uuid
import threading
import urllib.request
import urllib.parse
import traceback

# 同目录导入
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import BASE_DIR, DB_PATH, _db_lock, VERSION as _APP_VERSION
from db import get_db

# ===== 常量 =====
ZF3D_WEBSITE = 'https://www.zf3d.com'
HEARTBEAT_INTERVAL = 120  # 秒，每2分钟一次
# [修复] 版本号统一取自 config.VERSION（由版本配置文件加载），
#         不再硬编码，避免上报旧版本号（此前硬编码 '4.2.0' 导致统计页面版本不准）
VERSION = _APP_VERSION

# 心跳打印节流：[上次打印状态, 上次打印时间戳]，每小时汇总一次
_LAST_PRINT_STATE = [None, 0.0]
_PRINT_SUMMARY_INTERVAL = 3600

# 默认 API Key（全局共享密钥，心跳认证用，不依赖用户登录）
# 如果数据库中配置了自定义 key 则优先使用数据库的
# [安全] 真 key 存放于 private/heartbeat_key.json（隐私区），代码内不再硬编码
_SHARED_FALLBACK_KEY = '575965d297945fc071f2da6203fd08a6'

def _load_default_key():
    # 1) private/heartbeat_key.json（隐私区，用户可自定义覆盖）
    try:
        _kf = os.path.join(BASE_DIR, 'private', 'heartbeat_key.json')
        with open(_kf, 'r', encoding='utf-8') as f:
            _k = json.load(f).get('api_key', '')
            if _k:
                return _k
    except Exception:
        pass
    # 2) 代码级共享key回退（社区心跳协议认证key，非AI密钥；保证发布包未登录用户也能上报）
    return _SHARED_FALLBACK_KEY

DEFAULT_API_KEY = _load_default_key()

# 全局机器ID（每台物理机器唯一，供心跳使用）
# [改进] 多指纹组合（MachineGuid + 主板UUID + MAC），每次启动实时计算、不落盘，
#        杜绝"拷贝目录/克隆系统导致多机同ID"
def _gen_machine_id():
    parts = []
    # 1) Windows MachineGuid（系统安装时生成，重装软件不变）
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\Microsoft\Cryptography') as _k:
            parts.append('guid:' + winreg.QueryValueEx(_k, 'MachineGuid')[0])
    except Exception:
        pass
    # 2) 主板/整机 UUID（来自硬件固件，克隆系统到不同硬件时不同）
    try:
        import subprocess, sys as _sys
        if _sys.platform == 'win32':
            _out = subprocess.run(
                ['wmic', 'csproduct', 'get', 'UUID'],
                capture_output=True, text=True, timeout=5
            ).stdout or ''
        else:
            # Linux/macOS：读 DMI/IOKit 硬件 UUID，权限不足时静默跳过
            import platform as _pf
            if _sys.platform == 'darwin':
                _out = subprocess.run(
                    ['ioreg', '-rd1', '-c', 'IOPlatformExpertDevice'],
                    capture_output=True, text=True, timeout=5
                ).stdout or ''
                for _line in _out.splitlines():
                    if 'IOPlatformUUID' in _line:
                        parts.append('board:' + _line.split('"')[-2] if _line.count('"') >= 2 else 'board:' + _line.strip())
                        break
                _out = ''
            else:
                for _f in ('/sys/class/dmi/id/product_uuid', '/etc/machine-id', '/var/lib/dbus/machine-id'):
                    try:
                        with open(_f) as _fh:
                            _v = _fh.read().strip()
                        if _v:
                            parts.append('board:' + _v)
                            break
                    except Exception:
                        continue
                _out = ''
        for _line in _out.splitlines():
            _line = _line.strip()
            if _line and _line.lower() != 'uuid' and '-' in _line:
                parts.append('board:' + _line)
                break
    except Exception:
        pass
    # 3) MAC 地址（getnode 拿不到真实 MAC 时返回随机数，需过滤）
    try:
        _mac = uuid.getnode()
        if _mac and (_mac >> 40) & 1 == 0:  # 组播位=1 表示伪造随机值，丢弃
            parts.append('mac:%x' % _mac)
    except Exception:
        pass
    seed = '|'.join(parts) if parts else 'fallback:%s|zf3d' % uuid.uuid4()
    return hashlib.md5(seed.encode('utf-8')).hexdigest()[:16]

_MACHINE_ID = _gen_machine_id()

# 心跳唤醒事件：登录成功等关键时刻立即触发上报，无需等待下个轮询周期
_wake_event = threading.Event()

# 心跳线程引用
_heartbeat_thread = None
_heartbeat_running = False


def _get_config_value(category, key, default=''):
    """从数据库 app_data 表读取配置值"""
    conn = None
    try:
        with _db_lock:
            conn = get_db()
            cur = conn.cursor()
            cur.execute(
                "SELECT value FROM app_data WHERE category=? AND key=?",
                (category, key)
            )
            row = cur.fetchone()
            conn.close()
            conn = None
            if row:
                return row['value']
            return default
    except Exception as e:
        print(f'[zf3d-heartbeat] get_config_value({category}/{key}) error: {e}')
        if conn:
            try: conn.close()
            except Exception: pass
        return default


def _get_login_status():
    """从数据库读取登录状态，返回 (logged_in, username, user_id)

    返回值:
      (-1, username, user_id)  = 管理员，跳过心跳
      (1, username, user_id)   = 已登录普通用户
      (0, '', 0)               = 未登录
    """
    try:
        cookies_raw = _get_config_value('zf3d', 'cookies', '')
        username = _get_config_value('zf3d', 'username', '')
        login_data = _get_config_value('zf3d', 'login_data', '')

        logged_in = bool(cookies_raw) and bool(username)

        user_id = 0
        user_group = ''

        # 优先从 login_data 提取 user_id 和 user_group
        if login_data:
            try:
                data = json.loads(login_data)
                user_info = {}
                if isinstance(data, dict):
                    user_info = data.get('data', {}).get('user', {}) if isinstance(data.get('data'), dict) else {}
                    if not user_info:
                        user_info = data.get('user', {}) if isinstance(data.get('user'), dict) else {}
                    if not user_info:
                        user_info = data.get('data', {}) if isinstance(data.get('data'), dict) else {}
                user_id = int(user_info.get('user_id', 0) or user_info.get('id', 0) or 0)
                user_group = str(user_info.get('user_group', ''))
            except (json.JSONDecodeError, AttributeError, ValueError):
                pass

        # 如果 login_data 中没有 user_id，尝试从 cookies 中提取
        if not user_id and cookies_raw:
            try:
                cookies = json.loads(cookies_raw) if cookies_raw.startswith('{') else {}
                import urllib.parse as _up
                for k, v in cookies.items():
                    decoded_key = _up.unquote(k)
                    if decoded_key == 'zf3d_user_id':
                        try:
                            user_id = int(v)
                        except ValueError:
                            pass
            except (json.JSONDecodeError, ValueError):
                pass

        # 管理员不计入统计，返回特殊标记
        if user_group == '-1':
            return -1, username, user_id

        return (1 if logged_in else 0), username, user_id
    except Exception as e:
        print(f'[zf3d-heartbeat] get_login_status error: {e}')
        return 0, '', 0


def _send_heartbeat():
    """执行一次心跳上报"""
    api_key = _get_config_value('zf3d', 'heartbeat_api_key', '') or DEFAULT_API_KEY
    if not api_key:
        return False  # 未配置 api_key，跳过

    logged_in, username, user_id = _get_login_status()

    # 管理员跳过
    if logged_in == -1:
        return True

    try:
        params = urllib.parse.urlencode({
            'machine_id': _MACHINE_ID,
            'version': VERSION,
            'logged_in': str(logged_in),
            'username': username,
            'user_id': str(user_id) if logged_in else '0'
        }).encode('utf-8')

        url = f'{ZF3D_WEBSITE}/api/agent_api.asp?key={urllib.parse.quote(api_key)}&a=heartbeat'
        req = urllib.request.Request(url, data=params, method='POST')
        req.add_header('Content-Type', 'application/x-www-form-urlencoded')
        req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')

        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        resp = urllib.request.urlopen(req, timeout=10, context=ctx)
        resp_body = resp.read().decode('utf-8', errors='replace')
        # 静默上报：状态变化或每小时汇总时才打印，避免控制台刷屏
        now = time.time()
        state = (logged_in, username)
        if state != _LAST_PRINT_STATE[0] or now - _LAST_PRINT_STATE[1] >= _PRINT_SUMMARY_INTERVAL:
            _LAST_PRINT_STATE[0] = state
            _LAST_PRINT_STATE[1] = now
            print(f'[zf3d-heartbeat] 心跳已上报: logged_in={logged_in}, user={username}, resp={resp_body[:200]}')
        return True
    except Exception as e:
        print(f'[zf3d-heartbeat] 心跳上报失败: {e}')
        return False


def _heartbeat_loop():
    """心跳循环（后台守护线程）"""
    print(f'[zf3d-heartbeat] 心跳线程已启动，机器ID: {_MACHINE_ID}')
    time.sleep(3)  # 启动后等3秒让服务初始化完成

    while _heartbeat_running:
        _send_heartbeat()
        # 等待：要么到点(HEARTBEAT_INTERVAL秒)，要么被 _wake_event 立即唤醒
        _wake_event.wait(timeout=HEARTBEAT_INTERVAL)
        _wake_event.clear()


def start_heartbeat():
    """启动心跳后台线程"""
    global _heartbeat_thread, _heartbeat_running

    if _heartbeat_thread and _heartbeat_thread.is_alive():
        print('[zf3d-heartbeat] 心跳线程已在运行')
        return

    _heartbeat_running = True
    _heartbeat_thread = threading.Thread(target=_heartbeat_loop, daemon=True, name='zf3d-heartbeat')
    _heartbeat_thread.start()
    print('[zf3d-heartbeat] 心跳线程已启动')


def trigger_immediate_heartbeat():
    """立即触发一次心跳上报（登录成功等关键时刻调用，无需等待下个轮询周期）"""
    try:
        start_heartbeat()  # 确保线程在运行（未运行则启动）
        _wake_event.set()  # 唤醒睡眠中的线程，立即执行下一次上报
        print('[zf3d-heartbeat] 已触发立即心跳上报')
    except Exception as e:
        print(f'[zf3d-heartbeat] 触发立即上报失败: {e}')


def stop_heartbeat():
    """停止心跳线程"""
    global _heartbeat_running
    _heartbeat_running = False
    print('[zf3d-heartbeat] 心跳线程已停止')


def get_heartbeat_status():
    """获取心跳状态信息"""
    api_key = _get_config_value('zf3d', 'heartbeat_api_key', '') or DEFAULT_API_KEY
    logged_in, username, user_id = _get_login_status()
    return {
        'machine_id': _MACHINE_ID,
        'api_key_configured': bool(api_key),
        'api_key_masked': f'{api_key[:4]}****{api_key[-4:]}' if len(api_key) > 8 else ('****' if api_key else ''),
        'running': _heartbeat_running,
        'interval': HEARTBEAT_INTERVAL,
        'website': ZF3D_WEBSITE,
        'logged_in': logged_in,
        'username': username,
        'user_id': user_id,
    }
