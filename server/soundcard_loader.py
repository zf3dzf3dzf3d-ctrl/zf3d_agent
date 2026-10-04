"""
soundcard 自愈加载器
解决：进程运行中 soundcard 库文件被覆盖/补装后，sys.modules 里仍缓存着
残缺的旧模块（例如缺少 default_speaker），导致 import 成功但属性缺失。
策略：导入后校验关键属性，校验不过就踢出 sys.modules 强制重新导入；
重新导入仍失败则抛 ImportError，由调用方回退 sounddevice。
"""
import sys
import importlib

_必需属性 = ("default_speaker", "all_speakers", "get_microphone")


def load_soundcard():
    """返回可用的 soundcard 模块；不可用时抛 ImportError。"""
    try:
        sc = importlib.import_module("soundcard")
    except ImportError:
        raise
    # 校验关键属性，缺失说明缓存了残缺模块，强制重导入
    if not all(hasattr(sc, a) for a in _必需属性):
        for m in [k for k in list(sys.modules) if k == "soundcard" or k.startswith("soundcard.")]:
            del sys.modules[m]
        sc = importlib.import_module("soundcard")
        if not all(hasattr(sc, a) for a in _必需属性):
            raise ImportError("soundcard 模块不完整（缺少 " + ", ".join(_必需属性) + "），请重装: pip install soundcard")
    return sc
