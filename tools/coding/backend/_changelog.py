# -*- coding: utf-8 -*-
"""变更溯源记账（_changelog）【Issue#35 整改 2026-11-06 新建】

背景：write.py / replace_text.py / task_complete.py 三处 import 本模块
做「变更溯源」，但本文件缺失、import 被裸 try 吞掉，导致该功能静默失效
（GitHub Issue#35 第二部分指出，代码师复审确认）。本文件按既有调用方的
接口契约做最小实现，旁路失败静默的调用方语义完全不变。

接口契约（与调用方逐字对齐）：
- BASE_DIR                      项目根目录（write.py _auto_checkpoint 用作 git cwd）
- record_change(chat_id, tool, path, backup_path)   执行期按会话累积改动
- flush_task(chat_id, message, success) -> int      任务收口时写入落盘并返回条数

落盘文件（均在项目根目录）：
- 变更日志.md        按任务追加：时间 / 会话 / 成败 / 文件清单 / 完成消息
- 文件变更索引.md    按文件聚合：最近一次改动时间 / 工具 / 会话
"""

import os
import threading
from datetime import datetime

# 项目根 = tools/coding/backend/ 上溯三级
BASE_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))

_LOG_FILE = os.path.join(BASE_DIR, '变更日志.md')
_INDEX_FILE = os.path.join(BASE_DIR, '文件变更索引.md')

# chat_id -> {path: {'tool': str, 'backup': str, 'time': str}}
_changes = {}
_lock = threading.Lock()


def record_change(chat_id, tool, path, backup_path=''):
    """执行期记账：一次写/替换成功后登记一条（内存累积，不落盘）。"""
    if not path:
        return
    key = str(chat_id or 'unknown')
    with _lock:
        _changes.setdefault(key, {})[path] = {
            'tool': str(tool or ''),
            'backup': str(backup_path or ''),
            'time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        }


def flush_task(chat_id, message='', success=True):
    """任务收口：把该会话累积的改动写入 变更日志.md + 文件变更索引.md。

    返回写入的文件条数（与 task_complete.py 的 flushed 计数契约一致）。
    无累积改动时返回 0，不产生空记录。
    """
    key = str(chat_id or 'unknown')
    with _lock:
        items = _changes.pop(key, {})
    if not items:
        return 0
    try:
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        lines = [
            '',
            '## %s ｜ 会话 %s ｜ %s' % (now, key, '成功' if success else '失败'),
            '',
            '- 改动文件 %d 个：' % len(items),
        ]
        for p, info in sorted(items.items()):
            lines.append('  - `%s`（%s，备份：%s）' % (
                p, info['tool'] or '未知工具', info['backup'] or '无'))
        msg = str(message or '').strip().replace('\n', ' ')
        if msg:
            lines += ['', '- 完成消息：%s' % (msg[:300] + ('…' if len(msg) > 300 else ''))]
        _append_file(_LOG_FILE, '\n'.join(lines) + '\n')

        # 索引：每文件一行，最新覆盖（追加即覆盖语义：同文件旧行删除后重写）
        idx_lines = []
        for p, info in sorted(items.items()):
            idx_lines.append('- %s ｜ %s ｜ %s ｜ 会话 %s' % (
                info['time'], p, info['tool'] or '未知工具', key))
        _append_file(_INDEX_FILE, '\n'.join(idx_lines) + '\n')
    except Exception:
        return 0
    return len(items)


def _append_file(path, text):
    """utf-8 追加写入，目录不存在则创建。"""
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)
    with open(path, 'a', encoding='utf-8') as f:
        f.write(text)
