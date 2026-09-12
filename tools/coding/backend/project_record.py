#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""project_record - 项目记录管理（私有长期记忆，支持分类子目录）

目录结构：
  private/记忆/
    ├── 索引.md          ← 自动维护的统计索引（list/search 中隐藏）
    ├── 密码与账号/      ← 敏感类，面板默认打码
    ├── 技能/
    ├── 工作日志/        ← 短期自动日志
    ├── 阶段总结/
    ├── 长期目标/
    ├── 超长计划/
    └── 已归档/

name 支持 '分类/文件名'（可多级，如 '技能/游戏开发/xxx'）；
不带分类时读写根目录（兼容旧调用）。
"""
import os
import time
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'project_record'

INDEX_NAME = '索引.md'
SENSITIVE_CATEGORIES = {'密码与账号'}


def _ensure_index(records_dir):
    """扫描全目录重建 索引.md（每次写入/删除后自动调用）。"""
    try:
        cats = {}
        recents = []
        for root, dirs, files in os.walk(records_dir):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for f in files:
                if not f.endswith('.md') or f == INDEX_NAME:
                    continue
                fp = os.path.join(root, f)
                rel = os.path.relpath(fp, records_dir).replace('\\', '/')[:-3]
                cat = rel.split('/')[0] if '/' in rel else '（根目录）'
                try:
                    st = os.stat(fp)
                except Exception:
                    continue
                cats[cat] = cats.get(cat, 0) + 1
                recents.append((st.st_mtime, rel))
        recents.sort(reverse=True)
        total = sum(cats.values())
        lines = ['# 记忆索引', '',
                 '> 本文件由系统自动维护，请勿手动编辑。生成时间：'
                 + time.strftime('%Y-%m-%d %H:%M:%S'), '',
                 '## 分类统计', '']
        for cat in sorted(cats):
            lines.append('- %s：%d 个' % (cat, cats[cat]))
        lines.append('- 合计：%d 个' % total)
        lines += ['', '## 最近更新（Top 20）', '']
        for ts, rel in recents[:20]:
            lines.append('- %s（%s）' % (
                rel, time.strftime('%Y-%m-%d %H:%M', time.localtime(ts))))
        with open(os.path.join(records_dir, INDEX_NAME), 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines) + '\n')
    except Exception:
        pass


def handle(body, ctx):
    action = body.get('action', 'list')
    name = body.get('name', '')
    content = body.get('content', '')
    keyword = body.get('keyword', '')
    category = body.get('category', '')

    records_dir = os.path.join(ctx.base_dir, 'private', '记忆')
    if not os.path.isdir(records_dir):
        try:
            os.makedirs(records_dir, exist_ok=True)
        except Exception:
            pass

    def _rel_path(n, cat):
        """解析 category + name → (相对显示路径不含.md, 绝对路径)。
        支持 '分类/文件名' 多级路径；做路径逃逸校验。失败返回 (None, None)。"""
        parts = []
        cat = (cat or '').strip().replace('\\', '/').strip('/')
        if cat:
            parts.extend([p for p in cat.split('/') if p])
        n = (n or '').strip().replace('\\', '/').strip('/')
        if n:
            parts.extend([p for p in n.split('/') if p])
        if not parts:
            return None, None
        for p in parts:
            if p in ('.', '..') or ':' in p or not p.strip():
                return None, None
        if not parts[-1].endswith('.md'):
            parts[-1] += '.md'
        full = os.path.normpath(os.path.join(records_dir, *parts))
        base = os.path.normpath(records_dir)
        if not (full == base or full.startswith(base + os.sep)):
            return None, None
        return '/'.join(parts), full

    def _cleanup_empty_dirs(fp):
        """删除文件后清理空父目录（不动 records_dir 本身）。"""
        try:
            d = os.path.dirname(fp)
            base = os.path.normpath(records_dir)
            while d != base and d.startswith(base):
                try:
                    os.rmdir(d)
                except Exception:
                    break
                d = os.path.dirname(d)
        except Exception:
            pass

    # ---------- list：树形结构 + 兼容平铺列表 ----------
    if action == 'list':
        try:
            items = []
            tree = {}
            for root, dirs, files in os.walk(records_dir):
                dirs[:] = [d for d in dirs if not d.startswith('.')]
                for f in files:
                    if not f.endswith('.md') or f == INDEX_NAME:
                        continue
                    fp = os.path.join(root, f)
                    rel = os.path.relpath(fp, records_dir).replace('\\', '/')[:-3]
                    cat = rel.split('/')[0] if '/' in rel else ''
                    try:
                        st = os.stat(fp)
                        mt = time.strftime('%Y-%m-%d %H:%M', time.localtime(st.st_mtime))
                        ts = int(st.st_mtime)
                        size = st.st_size
                    except Exception:
                        ts, mt, size = 0, '', 0
                    items.append({'name': rel, 'category': cat, 'mtime': mt,
                                  'ts': ts, 'size': size,
                                  'sensitive': cat in SENSITIVE_CATEGORIES})
                    tree[cat] = tree.get(cat, 0) + 1
            items.sort(key=lambda x: (-x['ts'], x['name']))
            ctx.send_json({'ok': True,
                           'records': [it['name'] for it in items],
                           'items': items,
                           'tree': tree})
        except Exception as e:
            ctx.send_json({'ok': False, 'error': str(e)})
        return

    # ---------- read：单个 / 批量 ----------
    if action == 'read':
        names = body.get('names')
        if names and isinstance(names, list):
            results = []
            for n in names:
                rel, fp = _rel_path(n, category)
                if not fp:
                    results.append({'name': n, 'error': 'Invalid name'})
                    continue
                if os.path.isfile(fp):
                    try:
                        with open(fp, 'r', encoding='utf-8', errors='replace') as f:
                            results.append({'name': rel[:-3], 'content': f.read()})
                    except Exception as e:
                        results.append({'name': rel[:-3], 'error': str(e)})
                else:
                    results.append({'name': rel[:-3], 'error': 'Not found'})
            ctx.send_json({'ok': True, 'multi': True, 'records': results})
            return
        rel, fp = _rel_path(name, category)
        if not fp:
            ctx.send_json({'ok': False, 'error': 'Invalid name: ' + name})
            return
        if not os.path.isfile(fp):
            ctx.send_json({'ok': False, 'error': 'Record not found: ' + name})
            return
        try:
            with open(fp, 'r', encoding='utf-8', errors='replace') as f:
                c = f.read()
            ctx.send_json({'ok': True, 'name': rel[:-3], 'content': c})
        except Exception as e:
            ctx.send_json({'ok': False, 'error': str(e)})
        return

    # ---------- write：写入（自动建分类目录）+ 更新索引 + 每日快照 ----------
    if action == 'write':
        rel, fp = _rel_path(name, category)
        if not fp:
            ctx.send_json({'ok': False, 'error': 'Invalid name: ' + name})
            return
        try:
            parent = os.path.dirname(fp)
            if parent and not os.path.isdir(parent):
                os.makedirs(parent, exist_ok=True)
            with open(fp, 'w', encoding='utf-8') as f:
                f.write(content)
            _ensure_index(records_dir)
            try:
                from tools.coding.backend import _memory_tools
                _memory_tools.backup_memory_snapshot(ctx)
            except Exception:
                pass
            ctx.send_json({'ok': True, 'name': rel[:-3],
                           'size': len(content.encode('utf-8'))})
        except Exception as e:
            ctx.send_json({'ok': False, 'error': str(e)})
        return

    # ---------- append：追加 + 更新索引 ----------
    if action == 'append':
        rel, fp = _rel_path(name, category)
        if not fp:
            ctx.send_json({'ok': False, 'error': 'Invalid name: ' + name})
            return
        try:
            parent = os.path.dirname(fp)
            if parent and not os.path.isdir(parent):
                os.makedirs(parent, exist_ok=True)
            with open(fp, 'a', encoding='utf-8') as f:
                f.write(content)
            _ensure_index(records_dir)
            ctx.send_json({'ok': True, 'name': rel[:-3]})
        except Exception as e:
            ctx.send_json({'ok': False, 'error': str(e)})
        return

    # ---------- search：递归全文 + 文件名匹配 ----------
    if action == 'search':
        kw = keyword or body.get('kw', '')
        if not kw:
            ctx.send_json({'ok': False, 'error': 'No keyword specified'})
            return
        results = []
        if os.path.isdir(records_dir):
            for root, dirs, files in os.walk(records_dir):
                dirs[:] = [d for d in dirs if not d.startswith('.')]
                for f in files:
                    if not f.endswith('.md') or f == INDEX_NAME:
                        continue
                    fp = os.path.join(root, f)
                    rel = os.path.relpath(fp, records_dir).replace('\\', '/')[:-3]
                    try:
                        with open(fp, 'r', encoding='utf-8', errors='replace') as fh:
                            hit = kw in fh.read()
                    except Exception:
                        hit = False
                    if hit or kw in rel:
                        results.append(rel)
        ctx.send_json({'ok': True, 'keyword': kw, 'records': results})
        return

    # ---------- delete：删除 + 清理空目录 + 更新索引 ----------
    if action == 'delete':
        rel, fp = _rel_path(name, category)
        if not fp:
            ctx.send_json({'ok': False, 'error': 'Invalid name: ' + name})
            return
        try:
            if os.path.isfile(fp):
                try:
                    from trash import move_to_trash as _m2t
                except ImportError:
                    from server.trash import move_to_trash as _m2t
                try:
                    _m2t(fp, source='project_record')
                except Exception:
                    os.remove(fp)
                _cleanup_empty_dirs(fp)
                _ensure_index(records_dir)
                ctx.send_json({'ok': True, 'name': rel[:-3]})
            else:
                ctx.send_json({'ok': False, 'error': 'Record not found: ' + name})
        except Exception as e:
            ctx.send_json({'ok': False, 'error': str(e)})
        return

    # ---------- move：改分类 / 重命名 ----------
    if action == 'move':
        src = body.get('from', '')
        dst = body.get('to', '')
        rel_s, fp_s = _rel_path(src, '')
        rel_d, fp_d = _rel_path(dst, '')
        if not fp_s or not fp_d:
            ctx.send_json({'ok': False, 'error': 'Invalid from/to'})
            return
        try:
            if not os.path.isfile(fp_s):
                ctx.send_json({'ok': False, 'error': 'Not found: ' + src})
                return
            parent = os.path.dirname(fp_d)
            if parent and not os.path.isdir(parent):
                os.makedirs(parent, exist_ok=True)
            os.replace(fp_s, fp_d)
            _cleanup_empty_dirs(fp_s)
            _ensure_index(records_dir)
            ctx.send_json({'ok': True, 'from': rel_s[:-3], 'to': rel_d[:-3]})
        except Exception as e:
            ctx.send_json({'ok': False, 'error': str(e)})
        return

    ctx.send_json({'ok': False, 'error': 'Unknown action: ' + action})
