# -*- coding: utf-8 -*-
"""provider 注册表 —— 可插拔设计。新增引擎：写一个文件、import 并注册即可。"""
import threading

_lock = threading.Lock()
_registry = {}
_active = None          # 当前 provider 实例（None = 未初始化/被禁用）


class BaseProvider:
    """流式 TTS provider 基类。子类实现 synthesize_stream。"""
    name = 'base'

    def available(self):
        """是否可用（如是否配置了 key）。"""
        return False

    def synthesize_stream(self, text, voice=None, rate=100):
        """生成器，逐段产出 mp3 bytes。阻塞在生成器内是安全的（worker 线程）。"""
        yield b''


def register(provider):
    with _lock:
        _registry[provider.name] = provider
    return provider


def get(name=None):
    """按名字取 provider；不传名字返回第一个 available 的；都没有返回 None。"""
    with _lock:
        if name:
            p = _registry.get(name)
            return p if (p and p.available()) else None
        for p in _registry.values():
            try:
                if p.available():
                    return p
            except Exception:
                continue
        return None


def names():
    with _lock:
        return list(_registry.keys())


def set_active(p):
    global _active
    with _lock:
        _active = p


def active():
    with _lock:
        return _active


# —— 导入即注册所有内置 provider ——
from . import volc as _volc      # noqa: E402,F401
from . import null as _null      # noqa: E402,F401
