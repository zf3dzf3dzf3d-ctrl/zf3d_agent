# -*- coding: utf-8 -*-
"""
外部线路网关托管（WorkBuddy 白嫖通道 / cli2api 网关）
=================================================
设计原则（三区隔离）：
- 朱峰线路 / 自定义 API / 外部线路 彻底分开：独立配置、独立路由、独立错误码
- 默认关闭（private/external_providers.json 中 enabled=false）
- 网关为外部进程（cli2api，Go 单二进制），本模块只做：启停/健康检查/模型发现
- 严禁 import 期网络请求：所有网络调用都在函数内、带超时熔断
- 失败直报、禁止跨区降级（外部线挂了就报错，绝不偷偷走朱峰线）
"""

import json
import os
import subprocess
import time
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, '..', 'private', 'external_providers.json')
GATEWAY_DIR = os.path.join(BASE_DIR, '..', 'tools', 'external-gateway')

DEFAULT_CONFIG = {
    'enabled': False,           # 总开关：默认关闭，用户在设置面板显式开启
    'gateway': {
        'url': 'http://127.0.0.1:8787',   # cli2api 网关地址
        'apiKey': '',                     # cli2api 后台设置的访问密钥
        'exePath': '',                    # cli2api 可执行文件路径（空=不自动拉起）
        'autoStart': True,                # 开关打开时是否自动拉起进程
    },
    '_disclaimer': '外部线路为第三方非官方通道，可能存在封号/失效风险，请自行评估',
}


def load_config():
    """读外部线路配置。文件不存在/损坏 -> 返回默认（关闭态），绝不自动创建。"""
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return dict(DEFAULT_CONFIG)
        cfg = dict(DEFAULT_CONFIG)
        cfg.update({k: v for k, v in data.items() if not k.startswith('_')})
        return cfg
    except Exception:
        return dict(DEFAULT_CONFIG)


def save_config(cfg):
    """保存配置（设置面板写入入口）。"""
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    return True


def is_enabled():
    return bool(load_config().get('enabled'))


def _gateway_url():
    return (load_config().get('gateway') or {}).get('url', '').rstrip('/')


def _gateway_key():
    return (load_config().get('gateway') or {}).get('apiKey', '') or ''


def health(timeout=2.0):
    """
    第一层探测：网关进程是否活着（GET {url}/v1/models 只要能建立连接即算活）。
    返回 {'alive': bool, 'latency_ms': int, 'error': str|None}
    """
    url = _gateway_url()
    if not url:
        return {'alive': False, 'latency_ms': 0, 'error': '未配置网关地址'}
    t0 = time.time()
    try:
        req = urllib.request.Request(url + '/v1/models', method='GET')
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            resp.read(1)
        return {'alive': True, 'latency_ms': int((time.time() - t0) * 1000), 'error': None}
    except Exception as e:
        return {'alive': False, 'latency_ms': int((time.time() - t0) * 1000), 'error': str(e)}


def fetch_external_models(timeout=2.0):
    """
    模型发现：GET {url}/v1/models（OpenAI 兼容），返回模型 id 列表。
    网关未活/超时 -> 返回空列表（绝不抛异常拖慢 load_models_config）。
    """
    if not is_enabled():
        return []
    url = _gateway_url()
    if not url:
        return []
    try:
        req = urllib.request.Request(url + '/v1/models')
        req.add_header('Authorization', 'Bearer ' + _gateway_key())
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        return [m.get('id') for m in (data.get('data') or []) if m.get('id')]
    except Exception:
        return []


_proc = None  # 网关子进程句柄（仅本进程内有效）


def start_gateway():
    """拉起 cli2api 外部进程（exePath 配置了才拉）。返回 (ok, message)。"""
    global _proc
    cfg = (load_config().get('gateway') or {})
    exe = cfg.get('exePath') or ''
    if not exe or not os.path.isfile(exe):
        return False, '未配置 cli2api 可执行文件或路径不存在'
    if health(timeout=1.0)['alive']:
        return True, '网关已在运行'
    try:
        flags = 0
        if os.name == 'nt':
            flags = subprocess.CREATE_NO_WINDOW
        _proc = subprocess.Popen(
            [exe], cwd=os.path.dirname(exe) or None,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=flags)
    except Exception as e:
        return False, '拉起失败: %s' % e
    # 等健康检查通过（最多 8 秒）
    for _ in range(16):
        if health(timeout=1.0)['alive']:
            return True, '网关已启动'
        time.sleep(0.5)
    return False, '进程已拉起但健康检查未通过'


def stop_gateway():
    """停掉本模块拉起的网关进程（只杀自己拉起的，不碰用户手开的）。"""
    global _proc
    if _proc is None:
        return True, '无本模块拉起的进程'
    try:
        _proc.terminate()
    except Exception:
        pass
    _proc = None
    return True, '已停止'


def test_channel(timeout=6.0):
    """
    第二层探测：通道真实可用性（拿第一个模型发一次最小对话）。
    与 health() 分开 —— 「网关活着」不等于「WorkBuddy 通道可用」。
    返回 {'ok': bool, 'model': str|None, 'reply': str, 'error': str|None}
    """
    if not is_enabled():
        return {'ok': False, 'model': None, 'reply': '', 'error': '外部线路未启用'}
    url = _gateway_url()
    ids = fetch_external_models(timeout=2.0)
    if not ids:
        return {'ok': False, 'model': None, 'reply': '', 'error': '网关无可用模型'}
    model = ids[0]
    body = json.dumps({
        'model': model,
        'messages': [{'role': 'user', 'content': 'hi'}],
        'max_tokens': 8, 'stream': False,
    }).encode('utf-8')
    try:
        req = urllib.request.Request(url + '/v1/chat/completions', data=body, method='POST')
        req.add_header('Content-Type', 'application/json')
        req.add_header('Authorization', 'Bearer ' + _gateway_key())
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        reply = ((data.get('choices') or [{}])[0].get('message') or {}).get('content', '')
        return {'ok': True, 'model': model, 'reply': (reply or '')[:80], 'error': None}
    except Exception as e:
        return {'ok': False, 'model': model, 'reply': '', 'error': str(e)}
