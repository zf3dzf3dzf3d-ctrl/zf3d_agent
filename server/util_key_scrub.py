# -*- coding: utf-8 -*-
"""util_key_scrub.py - M1.7 明文密钥出站脱敏（策划案 M1.7）。

解决什么问题
------------
验收口径：**模型上下文与工具结果中检索不到明文 Key**。智能体的 shell 结果是最大的
泄漏面——一条 `type private\\api_keys.json` 配合 DPAPI 解密（同用户进程可解，见
SECURITY.md 已知边界）就能把全部密钥文本送进模型上下文。

本模块做的事：服务进程知道自己全部明文密钥（model_config 已解密清单），任何工具结果
在回给模型之前，把其中出现的**已知明文密钥**整体替换为掩码（保留尾 4 位以便对照）。
这是"代理注入"之外的另一半：出站（给模型的）文本不留明文。

边界（诚实声明）
----------------
  - 只处理已知密钥的精确匹配：模型自己拼一个"长得像密钥"的串不在覆盖范围；
  - 不阻止子进程在**自己的进程里**解密密文——那是 M1.6（沙箱读隔离/双用户令牌）的目标；
  - 超长输出（>2MB）跳过脱敏并记日志（性能护栏）。

用法
----
    import util_key_scrub as ks
    text, hits = ks.scrub(stdout_text)
    # hits: [('密钥尾4位', 出现次数), ...]，供调用方在结果里声明已脱敏
"""
from __future__ import annotations

import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from util_log import get_logger

log = get_logger('util_key_scrub')

_REFRESH_SEC = 60.0        # 密钥清单刷新间隔
_MAX_INPUT = 2 * 1024 * 1024
_MIN_KEY_LEN = 8           # 过短的串不做精确匹配（误伤风险大于收益）

_state: Dict[str, Any] = {'pairs': [], 'built_at': 0.0}
_lock = threading.Lock()


def _refresh() -> None:
    """重建 (明文, 掩码) 对照表。清单读取失败时本轮跳过脱敏并记日志（不缓存失败态）。"""
    pairs: List[Tuple[str, str]] = []
    try:
        import model_config
        srcs = (model_config._load_keys_map() or {}, model_config._load_model_file_keys() or {})
    except (ImportError, OSError, ValueError) as e:
        log.warning('密钥清单读取失败，本轮输出跳过脱敏: %s' % e)
        _state['built_at'] = time.time()
        _state['pairs'] = []
        return
    seen = set()
    for src in srcs:
        for _name, v in (src or {}).items():
            key = str(v or '').strip()
            if len(key) >= _MIN_KEY_LEN and key not in seen:
                seen.add(key)
                pairs.append((key, '••••••' + key[-4:]))
    # 最长优先：防止短键先替换、吃掉"以短键为前缀的长键"的匹配机会
    pairs.sort(key=lambda kv: -len(kv[0]))
    _state['pairs'] = pairs
    _state['built_at'] = time.time()


def scrub(text: Optional[str]) -> Tuple[Any, List[Tuple[str, int]]]:
    """把文本中出现的已知明文密钥替换为掩码。

    返回 (clean_text, hits)，hits = [(尾4位, 次数), ...]。非字符串与超长输入原样返回
    （超长记日志——性能护栏；调用方如需强保证可自行拒发）。"""
    if not isinstance(text, str) or not text:
        return text, []
    with _lock:
        if time.time() - _state['built_at'] >= _REFRESH_SEC:
            _refresh()
    pairs = _state['pairs']
    if not pairs:
        return text, []
    if len(text) > _MAX_INPUT:
        log.info('输出 %d 字符超脱敏上限，原样返回（不进脱敏）' % len(text))
        return text, []
    hits: Dict[str, int] = {}
    for key, mask in pairs:
        if key in text:
            cnt = text.count(key)
            text = text.replace(key, mask)
            hits[key[-4:]] = hits.get(key[-4:], 0) + cnt
    return text, sorted(hits.items())
