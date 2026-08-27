#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
朱峰社区无限智能体 - SQLite 数据服务
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
import threading
import json
import re

# ===== 路径配置 =====
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

# 旧版兼容文件（已废弃，仅在 json 缺失时回退读取）
LEGACY_PORT_PATH    = os.path.join(PRIVATE_DIR, 'port.txt')
LEGACY_VERSION_PATH = os.path.join(BASE_DIR, 'VERSION')
LEGACY_APP_CONFIG   = os.path.join(PRIVATE_DIR, 'app_config.json')  # 4.2.1 时代的统一文件

# 默认兜底值（仅在所有配置文件都缺失时使用）
DEFAULT_VERSION  = '5.0.1'
DEFAULT_API_PORT = 8501
DEFAULT_WS_PORT  = 8511
DEFAULT_HOST     = '0.0.0.0'

# ===== 控制台输出控制 =====
# True  = 静默模式:控制台只显示启动大字横幅,屏蔽 [SQLite]/[Server]/[HotReload] 过程日志
# False = 调试模式:显示全部过程日志(排查问题时改回 False)
QUIET_CONSOLE = True


def _load_version():
    """
    读取版本号：优先 private/version.json，缺失时回退到旧版文件。
    顺序：version.json → app_config.json(旧) → VERSION(旧) → DEFAULT
    """
    # 1) 优先读 version.json
    if os.path.exists(VERSION_JSON_PATH):
        try:
            with open(VERSION_JSON_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, dict) and isinstance(data.get('version'), str) and data['version'].strip():
                return data['version'].strip()
        except Exception:
            pass
    # 2) 回退：app_config.json（旧统一文件）
    if os.path.exists(LEGACY_APP_CONFIG):
        try:
            with open(LEGACY_APP_CONFIG, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, dict) and isinstance(data.get('version'), str) and data['version'].strip():
                return data['version'].strip()
        except Exception:
            pass
    # 3) 回退：旧版 VERSION 文件
    if os.path.exists(LEGACY_VERSION_PATH):
        try:
            with open(LEGACY_VERSION_PATH, 'r', encoding='utf-8') as f:
                v = f.read().strip()
                if v:
                    return v
        except Exception:
            pass
    return DEFAULT_VERSION


def _load_port():
    """
    读取端口配置：优先 private/port.json，缺失时回退到旧版文件。
    顺序：port.json → app_config.json(旧) → port.txt(旧) → DEFAULT
    """
    cfg = {
        'api_port': DEFAULT_API_PORT,
        'ws_port':  DEFAULT_WS_PORT,
        'host':     DEFAULT_HOST,
    }
    # 1) 优先读 port.json
    if os.path.exists(PORT_JSON_PATH):
        try:
            with open(PORT_JSON_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, dict):
                if isinstance(data.get('api_port'), int) and 1 <= data['api_port'] <= 65535:
                    cfg['api_port'] = data['api_port']
                if isinstance(data.get('ws_port'), int) and 1 <= data['ws_port'] <= 65535:
                    cfg['ws_port'] = data['ws_port']
                if isinstance(data.get('host'), str) and data['host'].strip():
                    cfg['host'] = data['host'].strip()
            return cfg
        except Exception:
            pass
    # 2) 回退：app_config.json（旧统一文件）
    if os.path.exists(LEGACY_APP_CONFIG):
        try:
            with open(LEGACY_APP_CONFIG, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, dict):
                if isinstance(data.get('api_port'), int) and 1 <= data['api_port'] <= 65535:
                    cfg['api_port'] = data['api_port']
                if isinstance(data.get('ws_port'), int) and 1 <= data['ws_port'] <= 65535:
                    cfg['ws_port'] = data['ws_port']
            return cfg
        except Exception:
            pass
    # 3) 回退：旧版 port.txt
    if os.path.exists(LEGACY_PORT_PATH):
        try:
            with open(LEGACY_PORT_PATH, 'r', encoding='utf-8') as f:
                m = re.search(r'\d{2,5}', f.read())
                if m:
                    p = int(m.group())
                    if 1 <= p <= 65535:
                        cfg['api_port'] = p
                        cfg['ws_port']  = p + 1
        except Exception:
            pass
    return cfg


# 统一对外暴露的常量
VERSION    = _load_version()
_PORT_CFG  = _load_port()
PORT       = _PORT_CFG['api_port']   # 兼容旧代码（很多地方用 PORT）
WS_PORT    = _PORT_CFG['ws_port']
HOST       = _PORT_CFG['host']

# 旧版常量名兼容（防止外部代码引用到不存在的名字）
APP_CONFIG_PATH = PORT_JSON_PATH     # 旧代码引用 APP_CONFIG_PATH 时指向新文件
CONFIG_PATH     = PORT_JSON_PATH


def _load_app_config():
    """兼容旧 API：从 version.json + port.json 合并成一个 dict 返回。"""
    return {
        'version':  VERSION,
        'api_port': PORT,
        'ws_port':  WS_PORT,
        'host':     HOST,
    }


def sync_legacy_files():
    """启动时把 version.json + port.json 内容同步到旧版兼容文件（保持向后兼容）。"""
    try:
        with open(LEGACY_PORT_PATH, 'w', encoding='utf-8') as f:
            f.write(str(PORT))
    except Exception:
        pass
    try:
        with open(LEGACY_VERSION_PATH, 'w', encoding='utf-8') as f:
            f.write(VERSION)
    except Exception:
        pass


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
_db_lock = threading.Lock()

# SSE 心跳间隔（秒）—— 默认 10s
# 设太短（<5s）浪费连接；设太长（>20s）部分反向代理会在空闲 30s 时切断
# 10s 是经验上能同时避开浏览器代理 60s 切断和反代 30s 切断的甜点值
SSE_HEARTBEAT_SEC = 10.0
