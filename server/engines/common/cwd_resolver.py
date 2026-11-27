# -*- coding: utf-8 -*-
"""cwd 解析模块（自 shell_exec.py 拆出，第 3 步职责分离重构）。

职责：活动项目兜底解析 + 缓存（主动失效 + 60 秒 TTL）。
对外接口与原 shell_exec 完全一致：
- invalidate_cwd_cache()
- _resolve_cwd(cwd) -> (生效cwd, 兜底说明 or '')
- _SERVER_DIR（server 目录常量）
"""
import logging
import os
import time

# server 自身目录（兜底 cwd），多行 .bat 也可安全落这里
_SERVER_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 活动项目兜底解析的缓存（{pid, path, ts}），避免兜底路径反复查 DB；
# 项目切换由 kv 写入接口主动调用 invalidate_cwd_cache() 失效；
# 保留 60 秒兜底 TTL 作为被动防御：若失效调用路径被绕过/异常，
# 缓存最多滞后 60 秒后自动回源 DB，不会静默兜底到旧项目路径
_CACHE_TTL = 60
_cache = {}


def invalidate_cwd_cache():
    """主动清空 cwd 兜底缓存（活动项目切换时由 API 层调用）。永不抛异常。"""
    try:
        _cache.clear()
    except Exception:
        pass


def _resolve_cwd(cwd):
    """统一 cwd 解析（阶段一收口）：
    1) cwd 存在且为目录 → 原样使用；
    2) cwd 为空/不存在 → 从 DB 取全局活动项目(kv_store.active_project_id)的 folder_path；
    3) 仍取不到或目录不存在 → 回退 server 目录。永不抛异常。
    返回 (生效cwd, 兜底说明 or '')。
    活动项目解析结果走缓存（主动失效 + 60 秒兜底 TTL），避免兜底高频路径反复查 DB。
    """
    try:
        if cwd and os.path.isdir(str(cwd)):
            return str(cwd), ''
        fallback = ''
        if cwd:
            fallback = ' (原cwd无效: %r)' % cwd
        # 缓存复用：主动失效(kv 切换调 invalidate_cwd_cache) + 60 秒兜底 TTL 双保险；
        # 复用时目录仍需存在，目录消失同样回源 DB
        try:
            cached_pid = _cache.get('pid')
            if time.time() - _cache.get('ts', 0) < _CACHE_TTL and cached_pid:
                p = _cache.get('path')
                if p and os.path.isdir(p):
                    return p, '[cwd 兜底→活动项目]%s' % fallback
        except Exception:
            pass
        try:
            from db import db_read
            # F2 读锁分离：纯 SELECT 不再排队全局 _db_lock
            row = db_read("SELECT value FROM kv_store WHERE key='active_project_id' LIMIT 1", fetch='one')
            root = None
            if row and str(row['value'] or '').strip():
                pid = str(row['value']).strip()
                r2 = db_read('SELECT folder_path FROM projects WHERE id=?', (pid,), fetch='one')
                if r2 and str(r2['folder_path'] or '').strip():
                    root = str(r2['folder_path'])
            if root and os.path.isdir(root):
                _cache['pid'] = pid
                _cache['path'] = root
                _cache['ts'] = time.time()
                return root, '[cwd 兜底→活动项目]%s' % fallback
        except Exception as e:
            logging.info('run_shell cwd 兜底解析失败: %s' % e)
        return _SERVER_DIR, '[cwd 兜底→server目录]%s' % fallback
    except Exception:
        return cwd or os.getcwd(), ''
