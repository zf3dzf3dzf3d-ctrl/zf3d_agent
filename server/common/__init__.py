#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# server/common 包：共享通信底座（ws_frame 等）
# 【命名空间冲突防线】engines/common（AI 引擎通用件）与本包（WS 通信底座）重名 'common'。
# 顶层 'common' 究竟指向谁取决于 sys.path 顺序，故这里 re-export 时自检：
# 若顶层 'common' 不是本包，则不静默 re-export 别家模块，而是显式报错，避免"导入成功但语义错误"。
try:
    from common import ws_frame as _ws_frame
    if not getattr(_ws_frame, '__file__', '').lower().replace('\\', '/').endswith('server/common/ws_frame.py'):
        raise ImportError(
            "顶层 'common' 被其他包占据（如 engines/common），"
            "server/common/__init__.py 拒绝 re-export 错误来源。"
            "请使用绝对导入 from server.common import ws_frame 或调整 sys.path。"
        )
    ws_frame = _ws_frame
except ImportError as _e:
    # 包内绝对导入兜底：包场景（server 作为包被导入）下用相对路径自己加载
    import os as _os
    _here = _os.path.dirname(_os.path.abspath(__file__))
    _ws_file = _os.path.join(_here, 'ws_frame.py')
    if not _os.path.exists(_ws_file):
        raise ImportError(f"server/common/ws_frame.py 缺失且顶层 'common' 不可用: {_e}") from _e
    import importlib.util as _ilu
    _spec = _ilu.spec_from_file_location('server.common.ws_frame', _ws_file)
    _mod = _ilu.module_from_spec(_spec)
    _spec.loader.exec_module(_mod)
    ws_frame = _mod
