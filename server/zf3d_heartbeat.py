#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
朱峰智能体智能体 - 心跳上报模块
参考自：新系统_v2_开发版/公共区/内核/网页服务.py 的 _上报心跳() 函数

功能：
  - 后台守护线程，每 120 秒向朱峰智能体网站 API 上报心跳
  - 上报内容：machine_id、version、logged_in、username、user_id
  - 管理员账号跳过心跳
  - api_key 无内置默认值：仅读数据库 heartbeat_api_key（如 private/heartbeat_key.json 有自定义值则优先，未配置则为空、心跳不上报）
  - 登录状态从数据库的 cookies + username 判断
"""

import os
import sys
import json
import time
import uuid
import threading
import urllib.request
import urllib.parse

from util_log import get_logger

log = get_logger('zf3d_heartbeat')
# 同目录导入
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import BASE_DIR, VERSION as _APP_VERSION
import logging

def _dbg(msg):
    try:
        from config import QUIET_CONSOLE
    except Exception:
        return
    if QUIET_CONSOLE:
        return
    log.info(msg)

# ===== 常量 =====
ZF3D_WEBSITE = 'https://www.zf3d.com'  # [修复] 必须用 https：服务器 http 会 301 跳 https，POST 被 urllib 跟随重定向后变成 GET，心跳数据(machine_id等)丢失，服务端返回 "X machine_id" 导致本机永远统计不到
HEARTBEAT_INTERVAL = 120  # 秒，每2分钟一次
# [修复] 版本号统一取自 config.VERSION（由版本配置文件加载），
#         不再硬编码，避免上报旧版本号（此前硬编码 '4.2.0' 导致统计页面版本不准）
VERSION = _APP_VERSION

# 心跳打印节流：[上次打印状态, 上次打印时间戳]，每小时汇总一次
_LAST_PRINT_STATE = [None, 0.0]
_PRINT_SUMMARY_INTERVAL = 3600

# 默认 API Key（心跳/命令协议认证，不依赖用户登录）
# 优先级：本地数据库 config(zf3d/heartbeat_api_key) > private/heartbeat_key.json
# [安全] 密钥只存 private/heartbeat_key.json（隐私区，不入 git），代码内不硬编码
def _load_default_key():
    try:
        _kf = os.path.join(BASE_DIR, 'private', 'heartbeat_key.json')
        with open(_kf, 'r', encoding='utf-8-sig') as f:
            _k = json.load(f).get('api_key', '')
            if _k:
                return _k
    except Exception: logging.debug("swallow", exc_info=True)
    # 未配置时返回空串：服务端会拒绝认证，需在 private/heartbeat_key.json 配置 api_key
    return ''

DEFAULT_API_KEY = _load_default_key()

# 【隐私整改 2026-11-05】心跳匿名化：不再使用硬件指纹 machine_id，
# 改为首次运行随机生成、本地存 private/anon_id.txt 的匿名 ID（不含任何硬件/系统标识）。
_ANON_ID_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             os.pardir, 'private', 'anon_id.txt')
def _gen_machine_id():
    try:
        if os.path.exists(_ANON_ID_PATH):
            with open(_ANON_ID_PATH, 'r', encoding='utf-8') as _f:
                _v = _f.read().strip()
            if _v:
                return _v
        _v = uuid.uuid4().hex[:16]
        os.makedirs(os.path.dirname(_ANON_ID_PATH), exist_ok=True)
        with open(_ANON_ID_PATH, 'w', encoding='utf-8') as _f:
            _f.write(_v)
        return _v
    except Exception:
        return uuid.uuid4().hex[:16]

_MACHINE_ID = _gen_machine_id()

# 心跳唤醒事件：登录成功等关键时刻立即触发上报，无需等待下个轮询周期
_wake_event = threading.Event()

# 心跳线程引用
_heartbeat_thread = None
_heartbeat_running = False


def _get_config_value(category, key, default=''):
    """从数据库 app_data 表读取配置值"""
    try:
        # F2 读锁分离：纯 SELECT 不再排队全局 _db_lock
        from db import db_read
        row = db_read(
            "SELECT value FROM app_data WHERE category=? AND key=?",
            (category, key), fetch='one')
        if row:
            return row['value']
        return default
    except Exception as e:
        _dbg(f'[zf3d-heartbeat] get_config_value({category}/{key}) error: {e}')
        return default


def is_heartbeat_enabled():
    """心跳独立开关（issue#83②，2026-11-26）。
    默认关（OFF）：出厂未配置即不外传任何数据（machine_id/version/logged_in 也不传）。
    用户须显式写入 app_data(zf3d, heartbeat_enabled)='1' 才开启。"""
    return str(_get_config_value('zf3d', 'heartbeat_enabled', '') or '') == '1'


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
            except (json.JSONDecodeError, AttributeError, ValueError): logging.debug("swallow", exc_info=True)
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
                            logging.debug("swallow", exc_info=True)
            except (json.JSONDecodeError, ValueError): logging.debug("swallow", exc_info=True)
        # 管理员也正常上报心跳（user_group 仅为标记，不再跳过）

        return (1 if logged_in else 0), username, user_id
    except Exception as e:
        _dbg(f'[zf3d-heartbeat] get_login_status error: {e}')
        return 0, '', 0


def _send_heartbeat():
    """执行一次心跳上报
    【隐私整改 2026-11-05】最小化载荷：只报 version/logged_in/匿名ID。
    username/user_id/models_json(完整模型配置含自填endpoint)/projects_json(项目名)
    不再默认上报；仅当用户在设置页明确开启 chat_sync_enabled 且已登录时，
    才随心跳附 username（用于网站端显示在线状态）。
    【issue#83② 2026-11-26】双重闸门：heartbeat_enabled 总开关(默认关) + api_key。
    docstring 原文「仅当开启 chat_sync_enabled 且已登录时才上报」与旧代码不符，
    现行为为真：开关关 or 未配 key => 直接 return False，零外传。"""
    api_key = _get_config_value('zf3d', 'heartbeat_api_key', '')
    if not api_key:
        return False  # 未配置 api_key，跳过（不再回退默认 key）
    # 【issue#83② 2026-11-26】心跳独立总开关：默认关。用户未显式开启 heartbeat_enabled
    # 时绝不外传任何数据（即使残留了历史 api_key 也不上报 machine_id/version）。
    if not is_heartbeat_enabled():
        return False

    logged_in, username, user_id = _get_login_status()
    share_identity = _get_config_value('zf3d', 'chat_sync_enabled', '') == '1' and logged_in

    try:
        # 【安全 2026-11-06】api_key 从 URL 查询串移入 POST body，避免落入代理/网关日志
        params = urllib.parse.urlencode({
            'key': api_key,
            'a': 'heartbeat',
            'machine_id': _MACHINE_ID,
            'version': VERSION,
            'logged_in': str(logged_in),
            'username': username if share_identity else '',
            'user_id': str(user_id) if share_identity else '0',
            'models_json': '',
            'projects_json': '',
        }).encode('utf-8')

        url = f'{ZF3D_WEBSITE}/api/agent_api.asp'
        req = urllib.request.Request(url, data=params, method='POST')
        req.add_header('Content-Type', 'application/x-www-form-urlencoded')
        req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')

        # [SSL 2026-11-02] 改走 _shared 统一证书校验（含 ssl_verify 开关），不再硬编码禁验
        from routes import _shared as _sh

        resp_body = ''
        try:
            resp = urllib.request.urlopen(req, timeout=10, context=_sh._SSL_CTX)
            resp_body = resp.read().decode('utf-8', errors='replace')
        except urllib.error.HTTPError as _he:
            resp_body = 'HTTP %s: %s' % (_he.code, _he.read().decode('utf-8', errors='replace')[:500])
            _dbg(f'[zf3d-heartbeat] HTTP错误响应: {resp_body}')
            return False
        # 静默上报：状态变化或每小时汇总时才打印，避免控制台刷屏
        now = time.time()
        state = (logged_in, username)
        if state != _LAST_PRINT_STATE[0] or now - _LAST_PRINT_STATE[1] >= _PRINT_SUMMARY_INTERVAL:
            _LAST_PRINT_STATE[0] = state
            _LAST_PRINT_STATE[1] = now
            _dbg(f'[zf3d-heartbeat] 心跳已上报: logged_in={logged_in}, user={username}, resp={resp_body[:200]}')
        return True
    except Exception as e:
        _dbg(f'[zf3d-heartbeat] 心跳上报失败: {e}')
        return False


def _heartbeat_loop():
    """心跳循环（后台守护线程）"""
    _dbg(f'[zf3d-heartbeat] 心跳线程已启动，机器ID: {_MACHINE_ID}')
    time.sleep(3)  # 启动后等3秒让服务初始化完成

    while _heartbeat_running:
        _send_heartbeat()
        # 等待：要么到点(HEARTBEAT_INTERVAL秒)，要么被 _wake_event 立即唤醒
        _wake_event.wait(timeout=HEARTBEAT_INTERVAL)
        _wake_event.clear()


def start_heartbeat():
    """启动心跳后台线程"""
    global _heartbeat_thread, _heartbeat_running

    # 热更新会重载本模块、把命名空间里的 _heartbeat_thread 重置为 None，
    # 但旧线程仍在跑（控制台出现"心心跳跳已已上上报报"交错输出）。
    # 按线程名查活：只要进程里还有活着的 zf3d-heartbeat 线程就接管它，绝不重复启动。
    for t in threading.enumerate():
        if t is not _heartbeat_thread and t.name == 'zf3d-heartbeat' and t.is_alive():
            _heartbeat_thread = t
            _heartbeat_running = True
            _dbg('[zf3d-heartbeat] 心跳线程已在运行（热更新后接管旧线程）')
            return

    if _heartbeat_thread and _heartbeat_thread.is_alive():
        _dbg('[zf3d-heartbeat] 心跳线程已在运行')
        return

    _heartbeat_running = True
    _heartbeat_thread = threading.Thread(target=_heartbeat_loop, daemon=True, name='zf3d-heartbeat')
    _heartbeat_thread.start()
    # 线程循环首行会打印"心跳线程已启动，机器ID: xxx"，这里不再重复打印


def trigger_immediate_heartbeat():
    """立即触发一次心跳上报（登录成功等关键时刻调用，无需等待下个轮询周期）"""
    try:
        start_heartbeat()  # 确保线程在运行（未运行则启动）
        _wake_event.set()  # 唤醒睡眠中的线程，立即执行下一次上报
        _dbg('[zf3d-heartbeat] 已触发立即心跳上报')
    except Exception as e:
        _dbg(f'[zf3d-heartbeat] 触发立即上报失败: {e}')


def stop_heartbeat():
    """停止心跳线程"""
    global _heartbeat_running
    _heartbeat_running = False
    _dbg('[zf3d-heartbeat] 心跳线程已停止')


def get_heartbeat_status():
    """获取心跳状态信息"""
    api_key = _get_config_value('zf3d', 'heartbeat_api_key', '')
    logged_in, username, user_id = _get_login_status()
    return {
        'machine_id': _MACHINE_ID,
        'api_key_configured': bool(api_key),
        'api_key_masked': f'{api_key[:4]}****{api_key[-4:]}' if len(api_key) > 8 else ('****' if api_key else ''),
        'enabled': is_heartbeat_enabled(),  # issue#83②：独立开关状态，供设置页展示
        'running': _heartbeat_running,
        'interval': HEARTBEAT_INTERVAL,
        'website': ZF3D_WEBSITE,
        'logged_in': logged_in,
        'username': username,
        'user_id': user_id,
    }
