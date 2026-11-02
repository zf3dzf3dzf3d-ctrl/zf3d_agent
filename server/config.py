#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
朱峰智能体无限智能体 - SQLite 数据服务
纯 Python 标准库实现，无第三方依赖。

版本号: 从 private/version.json 读取（唯一配置源）
端口号: 从 private/port.json    读取（唯一配置源）
数据库: private/db/zf3d_canvas.db
API 前缀: /api/db/*

6张表:
  1. canvas_nodes  — 画布节点（对话框位置/尺寸/模型）
  2. canvas_view   — 画布视口状态（平移/缩放）
  3. kv_store       — 通用键值存储（模型配置等）
  4. sessions       — 会话管理
  5. chat_history   — 对话历史
  6. app_data       — 通用数据表

启动: python server.py
"""

import os
import sys
import time
import threading
import traceback
import json
import re

# ===== 路径配置 =====
# PyInstaller 打包(frozen)时以可执行文件所在目录为基准，否则以源码目录为基准
if getattr(__import__('sys'), 'frozen', False):
    BASE_DIR = os.path.dirname(os.path.abspath(__import__('sys').executable))
else:
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, 'private', 'db', 'zf3d_canvas.db')
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')

# ===== 统一配置（版本号 + 端口号 各自独立配置源）=====
# 版本号 → private/version.json
# 端口号 → private/port.json
# 如需修改：编辑上述 json 即可，无需改代码
PRIVATE_DIR        = os.path.join(BASE_DIR, 'private')
VERSION_JSON_PATH  = os.path.join(PRIVATE_DIR, 'version.json')
PORT_JSON_PATH     = os.path.join(PRIVATE_DIR, 'port.json')

# 端口唯一配置源：private/port.json（无任何兜底，缺失或非法直接报错退出）

# ===== 控制台输出控制 =====
# True  = 静默模式:控制台只显示启动大字横幅,屏蔽 [SQLite]/[Server]/[HotReload] 过程日志
# False = 调试模式:显示全部过程日志(排查问题时改回 False)
QUIET_CONSOLE = True


def _load_version():
    """唯一来源 private/version.json。缺失时自动生成默认值（首装场景），解析失败才报错。"""
    if not os.path.exists(VERSION_JSON_PATH):
        try:
            os.makedirs(os.path.dirname(VERSION_JSON_PATH), exist_ok=True)
            with open(VERSION_JSON_PATH, 'w', encoding='utf-8') as f:
                json.dump({'version': '5.7.0'}, f, ensure_ascii=False, indent=4)
            print('[配置] 已自动生成默认版本配置: %s' % VERSION_JSON_PATH, flush=True)
        except Exception as e:
            raise SystemExit('[配置错误] 无法创建版本配置文件 %s: %s' % (VERSION_JSON_PATH, e))
    try:
        with open(VERSION_JSON_PATH, 'r', encoding='utf-8-sig') as f:
            data = json.load(f)
    except Exception as e:
        raise SystemExit('[配置错误] 版本配置文件解析失败: %s (%s)' % (VERSION_JSON_PATH, e))
    if not (isinstance(data, dict) and isinstance(data.get('version'), str) and data['version'].strip()):
        raise SystemExit('[配置错误] %s 中 version 必须是非空字符串' % VERSION_JSON_PATH)
    return data['version'].strip()


def _load_port():
    """唯一来源 private/port.json。缺失时自动生成默认值（首装场景），解析失败才报错。"""
    if not os.path.exists(PORT_JSON_PATH):
        _default = {
            "host": "127.0.0.1",
            "_comment": "【端口段约定】5.7.x 用 8570-8574 段，与 5.5.x（8555-8559）互不冲突",
            "api_port": 8570,
            "ws_port": 8571,
            "tts_stream": {"enabled": True, "port": 8572},
            "remote_ws_port": 8573,
            "auth_token": "",
            "ai_proxy_port": 8574,
        }
        try:
            os.makedirs(os.path.dirname(PORT_JSON_PATH), exist_ok=True)
            with open(PORT_JSON_PATH, 'w', encoding='utf-8') as f:
                json.dump(_default, f, ensure_ascii=False, indent=4)
            print('[配置] 已自动生成默认端口配置: %s' % PORT_JSON_PATH, flush=True)
        except Exception as e:
            raise SystemExit('[配置错误] 无法创建端口配置文件 %s: %s' % (PORT_JSON_PATH, e))
    try:
        with open(PORT_JSON_PATH, 'r', encoding='utf-8-sig') as f:
            data = json.load(f)
    except Exception as e:
        raise SystemExit('[配置错误] 端口配置文件解析失败: %s (%s)' % (PORT_JSON_PATH, e))
    if not isinstance(data, dict):
        raise SystemExit('[配置错误] %s 必须是 JSON 对象' % PORT_JSON_PATH)

    def _req_int(key):
        v = data.get(key)
        if not isinstance(v, int) or not (1 <= v <= 65535):
            raise SystemExit('[配置错误] %s 中 %s 必须是 1-65535 的整数，当前值: %r' % (PORT_JSON_PATH, key, v))
        return v

    def _req_host():
        v = data.get('host')
        if not isinstance(v, str) or not v.strip():
            raise SystemExit('[配置错误] %s 中 host 必须是非空字符串，当前值: %r' % (PORT_JSON_PATH, v))
        return v.strip()

    return {
        'api_port': _req_int('api_port'),
        'ws_port':  _req_int('ws_port'),
        'host':     _req_host(),
    }


# 统一对外暴露的常量
VERSION    = _load_version()
_PORT_CFG  = _load_port()
PORT       = _PORT_CFG['api_port']   # 兼容旧代码（很多地方用 PORT）
WS_PORT    = _PORT_CFG['ws_port']
HOST       = _PORT_CFG['host']

# 旧版常量名兼容（防止外部代码引用到不存在的名字）
APP_CONFIG_PATH = PORT_JSON_PATH     # 旧代码引用 APP_CONFIG_PATH 时指向新文件
CONFIG_PATH     = PORT_JSON_PATH


# ===== AI 代理网关端口：全系统唯一解析入口 =====
def get_ai_proxy_port():
    """AI 代理网关(ai_proxy.py)端口统一解析，与代理侧/服务端 _proxy_port 逐字等价：
      1) 环境变量 AI_PROXY_PORT
      2) private/port.json 的 ai_proxy_port 字段（唯一真源）
      3) 本版本端口段末 8574 兜底（5.7.x=8570-8574）

    所有『需要连本机 AI 网关』的调用方（zf_billing / zf_proxy_billing /
    mixin_zf3d / zf3d_commands）都必须走本函数，使『连网关的端口』与
    『网关实际监听的端口』永远同源，杜绝因升级残留 / 手动改端口造成的
    双源分叉（proxy_unavailable）。public/config/ai_proxy.json 不再作为
    端口来源（仅保留作展示/兼容，无同步义务）。
    """
    try:
        _p = int(os.environ.get('AI_PROXY_PORT', '0'))
        if 1 <= _p <= 65535:
            return _p
    except Exception:
        pass
    try:
        with open(PORT_JSON_PATH, 'r', encoding='utf-8-sig') as _f:
            _v = json.load(_f).get('ai_proxy_port')
        if isinstance(_v, int) and _v > 0:
            return _v
    except Exception:
        pass
    return 8574


def _load_app_config():
    """兼容旧 API：从 version.json + port.json 合并成一个 dict 返回。"""
    return {
        'version':  VERSION,
        'api_port': PORT,
        'ws_port':  WS_PORT,
        'host':     HOST,
    }


# 静态文件 MIME 类型
MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json',
}

# 确保数据库目录存在
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

# 线程锁：SQLite 不支持并发写，所有 DB 操作串行化
# 【防全站冻结 2026-09-22】带获取超时的锁：拿不到锁 30 秒后报错并让该请求失败，
# 而不是无限排队。此前某线程长期持有 _db_lock（写事务泄漏）时，所有请求线程
# 无限堆积，表现为「网络卡住 / 全站 500 / 无法对话」。
class _TimeoutLock:
    # 【A1 持锁栈诊断 2026-10-25】加持锁调用栈转储 + 慢锁守护线程：
    #   - release 慢锁（>SLOW_LOG_SEC）时，除线程名+时长外额外打印持锁线程调用栈，
    #     直接看见「是哪个请求/业务路径进入的慢事务」，避免盲改误伤无关路径。
    #   - 守护线程每 WATCHDOG_INTERVAL 秒巡检：若某线程持锁 > STUCK_SEC 仍未释放，
    #     实时 dump 其当前栈（解决旧实现「必须等 release 才看得到、线程卡死就永远看不到」）。
    #   纯只读可观测，不改任何加解锁语义，零功能风险。
    SLOW_LOG_SEC = 2.0       # release 时超过此秒数打 [DB-SLOW] + 栈
    STUCK_SEC = 15.0         # 持锁超过此秒数视为卡死，守护线程实时 dump [DB-STUCK] 栈
    WATCHDOG_INTERVAL = 5.0  # 守护线程巡检间隔

    def __init__(self, timeout=30.0):
        # 【2026-10-27 锁重入审计修复】改为 RLock：实测活体栈(pid 17972)显示 _turn_worker
        # (chat_pool.py:733 → record_token_usage, token_usage_stats.py:59) 与
        # do_POST(api_dispatch_post.py:1505) 两条入口均抢 _db_lock；同一请求链路存在
        # 持锁后再入锁的重入路径（正是 d4e4d8c4 修过的同型 bug 换锁复发）。非重入 Lock
        # 在重入时=同线程自我死锁且握着全局 DB 锁不放（全站冻结的根因形态）。
        self._lock = threading.RLock()
        self._timeout = timeout
        # 【持锁者追踪 2026-09-23】记录当前持锁线程与起始时间，便于超时定位元凶
        self._holder = None
        self._held_since = 0.0
        # 【A1】慢锁守护线程（懒启动，全局仅一个 daemon 线程）
        self._watchdog = None
        self._wd_init_lock = threading.Lock()

    @staticmethod
    def _stack_of(thread):
        # 取指定线程当前的调用栈文本：sys._current_frames 拿活线程栈帧，再 format_stack 还原
        try:
            frame = sys._current_frames().get(thread.ident)
            if frame is None:
                return '<线程已结束/无栈帧>'
            return ''.join(traceback.format_stack(frame))
        except Exception as e:
            return '<取栈失败: %r>' % e

    def _ensure_watchdog(self):
        # 首次持锁时拉起守护线程（双检锁，避免重复启动）
        if self._watchdog is not None:
            return
        with self._wd_init_lock:
            if self._watchdog is None:
                self._watchdog = threading.Thread(
                    target=self._watchdog_loop, name='DBLockWatchdog', daemon=True)
                self._watchdog.start()

    def _watchdog_loop(self):
        while True:
            time.sleep(self.WATCHDOG_INTERVAL)
            try:
                h = self._holder
                if h is None:
                    continue
                held = time.time() - self._held_since
                if held > self.STUCK_SEC:
                    print('[DB-STUCK] %s 持有 _db_lock %.1fs（仍未释放，实时栈↓）\n%s'
                          % (h.name, held, self._stack_of(h)), flush=True)
            except Exception:
                pass

    def acquire(self, timeout=None):
        _t = timeout if timeout is not None else self._timeout
        got = self._lock.acquire(timeout=_t)
        if not got:
            # 报错时附带当前持锁者信息，直接定位是哪个线程长期占库
            _info = ''
            try:
                if self._holder is not None:
                    _held = time.time() - self._held_since
                    _info = '，持锁者: %s（已持有 %.1fs）' % (self._holder.name, _held)
            except Exception:
                pass
            raise TimeoutError('_db_lock acquire timeout (%ss)%s：数据库被长期占用，请求放弃' % (_t, _info))
        self._holder = threading.current_thread()
        self._held_since = time.time()
        self._ensure_watchdog()
        return True

    def release(self):
        # 【慢锁预警 2026-09-23】持锁超过 SLOW_LOG_SEC 打日志 +【A1】附带释放时调用栈
        try:
            if self._holder is not None:
                _held = time.time() - self._held_since
                if _held > self.SLOW_LOG_SEC:
                    print('[DB-SLOW] %s 持有 _db_lock %.1fs（释放时栈↓）\n%s'
                          % (self._holder.name, _held, self._stack_of(self._holder)), flush=True)
        except Exception:
            pass
        self._holder = None
        self._held_since = 0.0
        self._lock.release()

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, *exc):
        self.release()
        return False

# 【卡顿优化 2026-10-11】30s→5s：等待锁太久（>5s）多半已异常，快速失败+前端提示，比让用户白等 30s 好
_db_lock = _TimeoutLock(5.0)

# SSE 心跳间隔（秒）—— 默认 10s
# 设太短（<5s）浪费连接；设太长（>20s）部分反向代理会在空闲 30s 时切断
# 10s 是经验上能同时避开浏览器代理 60s 切断和反代 30s 切断的甜点值
SSE_HEARTBEAT_SEC = 10.0



