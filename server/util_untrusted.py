# -*- coding: utf-8 -*-
"""util_untrusted.py - M1.5 不可信内容域名标记（策划案 M1.5）。

解决什么问题
------------
智能体会浏览/抓取不可信网页。页面里出现的域名（链接、脚本地址）是攻击者可影响的：
如果策略放行了某类目标，攻击者让自己的页面指向"策略恰好放行的域名"，就能引导智能体
把数据带去那里。本模块维护一个**不可信域名登记簿**：从不可信内容（浏览器页面等）里
提取过的域名记录在案；策略判定时，命中登记簿的目标即使规则放行（allow），也升级为
ask（交人判定）。

边界（诚实声明）
----------------
  - 只登记"页面文本里出现过的域名"——攻击者用 IP 直连或非常规编码仍可绕过（记入已知边界）；
  - 升级只发生在 allow 判定上；deny/ask 保持原判（不放宽也不加严）；
  - full 模式下升级被跳过（用户显式选择了免审批），strict 下天然全 ask。

用法
----
    import util_untrusted as uu
    uu.mark_from_text(page_html, source='browser_page')   # 抓取页面后登记
    uu.is_flagged('evil.example')                          # 策略判定时查询
    登记簿: private/policy/untrusted_domains.json（≤500 域名，7 天未出现自动清除）
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any, Dict, Iterable, Optional

from util_log import get_logger

log = get_logger('util_untrusted')

_MAX_DOMAINS = 500
_TTL_SEC = 7 * 24 * 3600
_URL_HOST_RE = re.compile(r'https?://([A-Za-z0-9._\-]+)(?::\d+)?', re.I)

_lock = threading.Lock()
_cache: Optional[Dict[str, Any]] = None


def _registry_path(base_dir: Optional[str] = None) -> str:
    base = base_dir
    if not base:
        try:
            from config import BASE_DIR
            base = BASE_DIR
        except ImportError:
            base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, 'private', 'policy', 'untrusted_domains.json')


def _load() -> Dict[str, Any]:
    global _cache
    if _cache is not None:
        return _cache
    path = _registry_path()
    try:
        with open(path, 'r', encoding='utf-8-sig') as f:
            raw = json.load(f)
        if isinstance(raw, dict) and isinstance(raw.get('domains'), dict):
            _cache = raw
        else:
            _cache = {'domains': {}}
    except FileNotFoundError:
        _cache = {'domains': {}}
    except (OSError, ValueError) as e:
        log.warning('不可信域名登记簿读取失败（按空处理）: %s' % e)
        _cache = {'domains': {}}
    return _cache


def _save() -> None:
    path = _registry_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(_cache, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def _norm(host: str) -> str:
    return str(host or '').strip().lower().rstrip('.')


def mark(domains: Iterable[str], source: str = 'unknown') -> int:
    """登记域名（去重、容量与 TTL 管理）。返回本轮新登记数。"""
    global _cache
    now = time.time()
    fresh = 0
    with _lock:
        reg = _load()['domains']
        # TTL 清理
        for h in [h for h, v in reg.items() if now - v.get('last_seen', 0) > _TTL_SEC]:
            reg.pop(h, None)
        for d in domains:
            h = _norm(d)
            if not h or h in ('127.0.0.1', 'localhost') or h.startswith('127.') or h == '::1':
                continue
            if h in reg:
                reg[h]['last_seen'] = now
                reg[h]['hits'] = int(reg[h].get('hits', 0)) + 1
                continue
            if len(reg) >= _MAX_DOMAINS:
                oldest = min(reg, key=lambda k: reg[k].get('last_seen', 0))
                reg.pop(oldest, None)
            reg[h] = {'first_seen': now, 'last_seen': now, 'source': str(source)[:40], 'hits': 1}
            fresh += 1
        _save()
    if fresh:
        log.info('不可信域名新登记 %d 个（来源 %s，总数 %d）' % (fresh, source, len(reg)))
    return fresh


def mark_from_text(text: str, source: str = 'unknown') -> int:
    """从不可信内容中提取 URL 域名并登记。"""
    if not text:
        return 0
    hosts = list(dict.fromkeys(m.group(1) for m in _URL_HOST_RE.finditer(text)))
    if not hosts:
        return 0
    return mark(hosts, source)


def is_flagged(host: str) -> bool:
    """该域名是否在不可信登记簿中（策略判定用）。"""
    with _lock:
        reg = _load()['domains']
        return _norm(host) in reg


def unflagged_count() -> int:
    with _lock:
        return len(_load()['domains'])


def reset_for_tests(base_dir: Optional[str] = None) -> None:
    """测试专用：清空登记簿并重置缓存。生产代码不得调用。"""
    global _cache
    with _lock:
        _cache = {'domains': {}}
        _save()
