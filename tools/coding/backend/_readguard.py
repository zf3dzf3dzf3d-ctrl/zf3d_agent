# -*- coding: utf-8 -*-
"""重复读拦截（对话级 readFiles 计数 × 服务端 mtime 校验）。

背景（2026-09-09 事故）：AI 上下文重建后无视工具结果里的「已读文件清单⚠️」提示，
把同一文件反复读 6 次，read 工具结果占掉 53% 上下文 → 截断 → 再重建 → 死循环。
旧机制只有"提示"没有"拦截"。新机制：
  - 前端把对话级已读计数 {path: count} 透传（_read_count）；
  - 服务端用请求级 mtime 缓存判断"这轮对话会话内文件是否变更过"：
      * 未读过（count=0）→ 正常返回全文；
      * 读过且 mtime 与缓存一致（文件没被改）→ 返回 cached 提示，不回正文，
        模型必须复用已有上下文；确需重读时传 force=true（说明理由）；
      * 读过但 mtime 变了（AI 刚改过文件再读 = 合法验证）→ 正常返回全文并刷新 mtime。
  - mtime 缓存是进程级（服务端热重载/重启后自然失效 → 放行，安全方向）。
"""
import os

# {path: mtime} —— 进程级缓存；多线程读 dict 读写为原子操作，无需加锁
_MTIME_CACHE = {}


def should_serve_content(path, read_count, force=False):
    """返回 (serve_content, note)。
    serve_content=True 正常返回文件内容；False 时返回 note 提示（不回正文）。"""
    try:
        mt = os.path.getmtime(path)
    except OSError:
        return True, ''  # stat 不到（极端）→ 放行，安全方向
    key = os.path.normcase(os.path.abspath(path))
    cached_mt = _MTIME_CACHE.get(key)
    cnt = 0
    try:
        cnt = int(read_count or 0)
    except (TypeError, ValueError):
        cnt = 0
    if force:
        _MTIME_CACHE[key] = mt
        return True, ''
    # 首读：记录 mtime，正常返回
    if cached_mt is None or cnt <= 0:
        _MTIME_CACHE[key] = mt
        return True, ''
    # 重复读且文件未变更 → 拦截
    if mt == cached_mt:
        return False, (
            '【重复读拦截】该文件本轮已读取过且内容未变更（已读 %d 次）。'
            '请直接使用上下文中已有的内容，不要重复读取。'
            '若你认为内容已变化或确需重读，请携带参数 force: true 重试（首次强制重读不受限）。' % cnt
        )
    # 文件变了（AI 写/改过再读 = 合法验证）→ 放行并刷新
    _MTIME_CACHE[key] = mt
    return True, ''


def record_served(path):
    """成功返回内容后刷新 mtime 缓存（供无法预判的场景兜底）。"""
    try:
        _MTIME_CACHE[os.path.normcase(os.path.abspath(path))] = os.path.getmtime(path)
    except OSError:
        pass
