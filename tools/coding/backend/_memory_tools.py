#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_memory_tools - 记忆系统辅助：自动工作日志 / 阶段总结 / 每日快照备份"""
import os
import re
import time
import zipfile

TOOL_NAME = '_memory_tools'


def _mem_dir(ctx):
    return os.path.join(ctx.base_dir, 'private', '记忆')


# ---------------- 自动工作日志 ----------------

def append_work_log(ctx, title, detail=''):
    """任务完成时自动追加 工作日志/YYYY-MM.md。返回日志文件相对名。"""
    try:
        mem = _mem_dir(ctx)
        log_dir = os.path.join(mem, '工作日志')
        os.makedirs(log_dir, exist_ok=True)
        month = time.strftime('%Y-%m')
        name = month + '.md'
        fp = os.path.join(log_dir, name)
        if not os.path.isfile(fp):
            with open(fp, 'w', encoding='utf-8') as f:
                f.write('# 工作日志 %s\n' % month)
        ts = time.strftime('%Y-%m-%d %H:%M')
        one = ' '.join(str(detail or '').split())[:120]
        with open(fp, 'a', encoding='utf-8') as f:
            f.write('\n- **%s** %s%s\n' % (ts, title, (' — ' + one) if one else ''))
        # 同步刷新记忆索引（保持分类统计实时）
        try:
            from tools.coding.backend.project_record import _ensure_index
            _ensure_index(mem)
        except Exception:
            pass
        return name
    except Exception:
        return None


def count_log_entries(ctx, month=None):
    """统计当月工作日志条目数。"""
    try:
        month = month or time.strftime('%Y-%m')
        fp = os.path.join(_mem_dir(ctx), '工作日志', month + '.md')
        if not os.path.isfile(fp):
            return 0
        with open(fp, 'r', encoding='utf-8', errors='replace') as f:
            return len(re.findall(r'^- \*\*', f.read(), re.M))
    except Exception:
        return 0


# ---------------- 阶段总结 ----------------

def maybe_stage_summary(ctx, force=False, threshold=20):
    """工作日志攒满 threshold 条自动提炼阶段总结（每月最多 1 次，force 可手动触发）。"""
    try:
        mem = _mem_dir(ctx)
        month = time.strftime('%Y-%m')
        log_fp = os.path.join(mem, '工作日志', month + '.md')
        if not os.path.isfile(log_fp):
            return None
        n = count_log_entries(ctx, month)
        if n < threshold and not force:
            return None
        sum_dir = os.path.join(mem, '阶段总结')
        os.makedirs(sum_dir, exist_ok=True)
        out_fp = os.path.join(sum_dir, '阶段总结-' + month + '.md')
        if os.path.isfile(out_fp) and not force:
            return None  # 本月已总结过
        with open(log_fp, 'r', encoding='utf-8', errors='replace') as f:
            entries = re.findall(r'^- \*\*(.+?)\*\*\s*(.*)$', f.read(), re.M)
        if not entries:
            return None
        lines = ['# 阶段总结 %s', '', '> 由系统自动提炼自 工作日志/%s.md（%d 条）', '', '## 完成事项', '']
        for ts, rest in entries:
            lines.append('- %s %s' % (ts, rest.strip(' —')))
        lines += ['', '## 提炼建议', '',
                  '- 高频主题可升级为「技能/」条目长期沉淀',
                  '- 未完结线索可登记为「长期目标/」',
                  '']
        body = '\n'.join(lines) % (month, month, len(entries))
        with open(out_fp, 'w', encoding='utf-8') as f:
            f.write(body)
        return out_fp
    except Exception:
        return None


# ---------------- 每日快照备份 ----------------

def backup_memory_snapshot(ctx, keep=7):
    """每天首次写入记忆时打包快照，保留最近 keep 份。"""
    try:
        mem = _mem_dir(ctx)
        if not os.path.isdir(mem):
            return None
        bdir = os.path.join(ctx.base_dir, 'private', 'backups', '记忆快照')
        os.makedirs(bdir, exist_ok=True)
        today = time.strftime('%Y%m%d')
        # 当天已有快照则跳过
        for f in os.listdir(bdir):
            if f.startswith('记忆_' + today):
                return None
        tag = time.strftime('%Y%m%d_%H%M%S')
        zp = os.path.join(bdir, '记忆_' + tag + '.zip')
        with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED) as z:
            for root, dirs, files in os.walk(mem):
                dirs[:] = [d for d in dirs if not d.startswith('.')]
                for f in files:
                    fp = os.path.join(root, f)
                    z.write(fp, os.path.relpath(fp, mem))
        # 只保留最近 keep 份
        snaps = sorted(f for f in os.listdir(bdir) if f.startswith('记忆_') and f.endswith('.zip'))
        for f in snaps[:-keep] if len(snaps) > keep else []:
            try:
                os.remove(os.path.join(bdir, f))
            except Exception:
                pass
        return zp
    except Exception:
        return None
