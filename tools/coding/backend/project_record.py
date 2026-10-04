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
import re
import time
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'project_record'

INDEX_NAME = '索引.md'
SENSITIVE_CATEGORIES = {'密码与账号'}


_INDEX_CACHE_PATH = None  # 增量缓存文件路径（延迟初始化）


def _summary_of(fp, max_chars=80):
    """从记录文件提取记忆地图摘要：首个标题行（去掉#）+ 正文前若干字，单行合并。"""
    try:
        with open(fp, 'r', encoding='utf-8', errors='replace') as f:
            text = f.read(4096)
        title = ''
        body = text
        first = text.find('#')
        if first >= 0:
            end = text.find('\n', first)
            if end < 0:
                end = len(text)
            cand = text[first:end].lstrip('#').strip()
            if cand:
                title = cand
                body = text[end:].strip()
        body = ' '.join(body.split())
        s = (title + '：' + body) if title else body
        if not s:
            s = '（空记录）'
        return s[:max_chars] + ('…' if len(s) > max_chars else '')
    except Exception:
        return '（读取失败）'


def _ensure_index(records_dir):
    """维护 索引.md（每次写入/删除后自动调用）。

    v2 记忆地图：分类统计 + 最近更新 + 全量「标题+80字摘要」条目；
    用 mtime 增量缓存（.索引缓存.json）避免每次全量读文件首行。
    """
    try:
        cache_fp = os.path.join(records_dir, '.索引缓存.json')
        cache = {}
        try:
            import json
            with open(cache_fp, 'r', encoding='utf-8') as f:
                cache = json.load(f)
        except Exception:
            cache = {}
        cats = {}
        recents = []
        summaries = {}
        dirty = False
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
                mtime_key = '%.6f' % st.st_mtime
                ent = cache.get(rel)
                if not ent or ent.get('mtime') != mtime_key:
                    summaries[rel] = _summary_of(fp)
                    cache[rel] = {'mtime': mtime_key, 'summary': summaries[rel]}
                    dirty = True
                else:
                    summaries[rel] = ent.get('summary', '')
        recents.sort(reverse=True)
        total = sum(cats.values())
        lines = ['# 记忆索引（记忆地图）', '',
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
        lines += ['', '## 记忆地图（全部记录 · 标题+摘要）', '']
        for ts, rel in recents:
            mask = rel.split('/')[0] in SENSITIVE_CATEGORIES
            s = '【已打码·敏感类目】' if mask else summaries.get(rel, '')
            lines.append('- **%s** — %s' % (rel, s))
        with open(os.path.join(records_dir, INDEX_NAME), 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines) + '\n')
        if dirty:
            try:
                import json
                with open(cache_fp, 'w', encoding='utf-8') as f:
                    json.dump(cache, f, ensure_ascii=False)
            except Exception:
                pass
        # 无条件清理缓存与索引中已不存在文件的残影（防 delete 后残留）
        try:
            import json as _json
            alive = set(summaries)
            stale = [k for k in cache if k not in alive]
            if stale:
                for k in stale:
                    cache.pop(k, None)
                with open(cache_fp, 'w', encoding='utf-8') as f:
                    _json.dump(cache, f, ensure_ascii=False)
                print('[project_record] 索引缓存残影清理: %d 条 -> %s' % (len(stale), stale))
        except Exception as _purge_err:
            print('[project_record] 索引缓存残影清理失败(不阻断): %r' % (_purge_err,))
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

    # ===== 项目级隔离（两层结构）：全局/ + 项目/<proj_id>/ =====
    # scope 参数：'project'（默认，有项目上下文时）写/读进 项目/<proj_id>/；
    #             'global' 强制全局层；'all' 仅对 list/search 生效（递归本就覆盖）。
    # 兼容：旧记录仍在根目录（未迁移前）→ read/search/list 递归或回退可命中。
    GLOBAL_DIR_NAME = '全局'
    _pid_iso = str((body or {}).get('_project_id') or '').strip()
    scope_raw = str((body or {}).get('scope') or '').strip().lower()
    project_layer = None
    if _pid_iso and re.fullmatch(r'[A-Za-z0-9_\-]+', _pid_iso.strip()):  # 防目录穿越（fullmatch 防尾部换行等畸形字符）
        _pid_iso = _pid_iso.strip()
        project_layer = os.path.join(records_dir, '项目', _pid_iso)
        try:
            os.makedirs(project_layer, exist_ok=True)
            os.makedirs(os.path.join(records_dir, GLOBAL_DIR_NAME), exist_ok=True)
        except Exception:
            project_layer = None
    effective_scope = scope_raw or ('project' if project_layer else 'global')
    _root_records_dir = records_dir  # 记忆根目录（迁移兼容回退用）
    if project_layer and effective_scope == 'project':
        records_dir = project_layer  # 写/读/搜默认路由到项目层
    else:
        # 全局层：无项目上下文或显式 scope=global 时，写入 全局/ 子目录
        _gdir = os.path.join(_root_records_dir, '全局')
        try:
            os.makedirs(_gdir, exist_ok=True)
            records_dir = _gdir
        except Exception:
            records_dir = _root_records_dir

    # ===== 项目记忆兜底：保证 项目记忆-<project_id> 必存在且首行为项目完整路径 =====
    try:
        _pid = str((body or {}).get('_project_id') or '').strip()
        _pdir = getattr(ctx, 'project_dir', '') or ''
        if _pid and _pdir and os.path.isdir(_pdir):
            _mem_fp = os.path.join(records_dir, '项目记忆-' + _pid + '.md')
            if not os.path.isfile(_mem_fp):
                _pname = str((body or {}).get('_project_name')
                             or os.path.basename(_pdir.rstrip('\\/'))).strip()
                _txt = ('项目路径: ' + _pdir + '\n'
                        '项目ID: ' + _pid + '\n'
                        '项目名称: ' + _pname + '\n'
                        '项目记忆: private/记忆/项目记忆-' + _pid + '.md\n')
                with open(_mem_fp, 'w', encoding='utf-8') as _f:
                    _f.write(_txt)
                _ensure_index(records_dir)
    except Exception:
        pass  # 兜底失败静默，绝不阻塞正常工具调用

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
            # 项目层路由时合并根目录（含 全局/ 与旧记录），其它项目层排除
            _list_roots = [records_dir]
            if os.path.normpath(_root_records_dir) != os.path.normpath(records_dir):
                _list_roots.append(_root_records_dir)
            _seen_list = set()
            _cur_pid_seg = '项目/' + (_pid_iso or '') + '/'
            for _lroot in _list_roots:
              for root, dirs, files in os.walk(_lroot):
                dirs[:] = [d for d in dirs if not d.startswith('.')]
                for f in files:
                    if not f.endswith('.md') or f == INDEX_NAME:
                        continue
                    fp = os.path.join(root, f)
                    rel = os.path.relpath(fp, _lroot).replace('\\', '/')[:-3]
                    if rel.lower() in _seen_list:
                        continue
                    if _lroot is _root_records_dir and rel.startswith('项目/') \
                            and not rel.startswith(_cur_pid_seg):
                        continue
                    _seen_list.add(rel.lower())
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

    # ---------- read：单个 / 批量（可选 max_chars/head/tail 截断） ----------
    def _clip(text):
        """按 body 里的 max_chars/head/tail 可选参数截断文本，返回 (内容, 是否截断)。"""
        max_chars = body.get('max_chars')
        head = body.get('head')
        tail = body.get('tail')
        if not any(isinstance(x, int) and x > 0 for x in (max_chars, head, tail)):
            return text, False
        total = len(text)
        if isinstance(max_chars, int) and max_chars > 0:
            return text[:max_chars], total > max_chars
        parts = []
        if isinstance(head, int) and head > 0:
            parts.append(text[:head])
        if isinstance(tail, int) and tail > 0:
            parts.append(text[-tail:])
        clipped = ''
        if len(parts) == 2:
            sep = '\n…（中间省略 %d 字）…\n' % max(0, total - head - tail)
            clipped = parts[0] + sep + parts[1]
        else:
            clipped = parts[0] if parts else text
        return clipped, total > len(clipped)

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
                            c, clipped = _clip(f.read())
                        ent = {'name': rel[:-3], 'content': c}
                        if clipped:
                            ent['truncated'] = True
                        if rel.split('/')[0] in SENSITIVE_CATEGORIES:
                            ent['sensitive'] = True
                        results.append(ent)
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
            # 项目层未命中 → 兼容回退：全局层 / 旧根目录
            for _fb in (os.path.join(_root_records_dir, '全局', rel.split('/', 1)[-1] if '/' in rel else rel),
                        os.path.join(_root_records_dir, rel)):
                if os.path.isfile(_fb):
                    fp = _fb
                    rel = os.path.relpath(_fb, _root_records_dir).replace('\\', '/')[:-3]
                    break
        if not os.path.isfile(fp):
            ctx.send_json({'ok': False, 'error': 'Record not found: ' + name})
            return
        try:
            with open(fp, 'r', encoding='utf-8', errors='replace') as f:
                c, clipped = _clip(f.read())
            out = {'ok': True, 'name': rel[:-3], 'content': c}
            if clipped:
                out['truncated'] = True
            if rel.split('/')[0] in SENSITIVE_CATEGORIES:
                out['sensitive'] = True
            ctx.send_json(out)
        except Exception as e:
            ctx.send_json({'ok': False, 'error': str(e)})
        return

    # ---------- write：写入（自动建分类目录/可选分节替换）+ 更新索引 + 快照 ----------
    if action == 'write':
        rel, fp = _rel_path(name, category)
        if not fp:
            ctx.send_json({'ok': False, 'error': 'Invalid name: ' + name})
            return
        try:
            parent = os.path.dirname(fp)
            if parent and not os.path.isdir(parent):
                os.makedirs(parent, exist_ok=True)
            replace_section = (body.get('replace_section') or '').strip()
            replaced = False
            if replace_section and os.path.isfile(fp):
                # 分节替换：定位 markdown 标题节（## 到下一个同级/更高级标题），整节覆盖
                # 注：目标文件不存在时不会走此分支，按普通新建处理（避免误报错）
                with open(fp, 'r', encoding='utf-8', errors='replace') as f:
                    old = f.read()
                lines = old.split('\n')
                start = -1
                start_lv = 0
                for i, ln in enumerate(lines):
                    if ln.lstrip().startswith('#'):
                        lv = len(ln) - len(ln.lstrip('#'))
                        if ln.lstrip('#').strip() == replace_section or \
                           ln.lstrip('# ').strip() == replace_section:
                            start, start_lv = i, lv
                            break
                if start >= 0:
                    end = len(lines)
                    for j in range(start + 1, len(lines)):
                        ln = lines[j]
                        if ln.lstrip().startswith('#'):
                            lv = len(ln) - len(ln.lstrip('#'))
                            if lv <= start_lv:
                                end = j
                                break
                    # 强制备份
                    try:
                        import shutil
                        shutil.copy2(fp, fp + '.bak')
                    except Exception:
                        pass
                    lines[start:end] = content.split('\n')
                    with open(fp, 'w', encoding='utf-8') as f:
                        f.write('\n'.join(lines))
                    replaced = True
                else:
                    ctx.send_json({'ok': False,
                                   'error': 'Section not found: ' + replace_section})
                    return
            if not replaced:
                with open(fp, 'w', encoding='utf-8') as f:
                    f.write(content)
            _ensure_index(records_dir)
            try:
                from tools.coding.backend import _memory_tools
                _memory_tools.backup_memory_snapshot(ctx)
            except Exception:
                pass
            out = {'ok': True, 'name': rel[:-3],
                   'size': len(content.encode('utf-8'))}
            if replaced:
                out['note'] = '分节替换完成: ' + replace_section + '（原文件已备份 .bak）'
            ctx.send_json(out)
        except Exception as e:
            ctx.send_json({'ok': False, 'error': str(e)})
        return

    # ---------- append：追加 + 相似去重提示 + 更新索引 ----------
    if action == 'append':
        rel, fp = _rel_path(name, category)
        if not fp:
            ctx.send_json({'ok': False, 'error': 'Invalid name: ' + name})
            return
        try:
            parent = os.path.dirname(fp)
            if parent and not os.path.isdir(parent):
                os.makedirs(parent, exist_ok=True)
            dup_note = ''
            dedupe = body.get('dedupe') is not False  # 默认开启去重提示
            if dedupe and os.path.isfile(fp):
                # 词级 Jaccard 相似度（中英通用：按字符 bigram 对中文更稳）
                def _grams(s):
                    s = ''.join(s.split())
                    return set(s[i:i + 2] for i in range(max(0, len(s) - 1)))
                with open(fp, 'r', encoding='utf-8', errors='replace') as f:
                    old = f.read()
                g_old = _grams(old)
                g_new = _grams(content)
                if g_old and g_new:
                    inter = len(g_old & g_new)
                    jac = inter / float(len(g_old | g_new))
                    contain = inter / float(len(g_new))  # 新内容被原文包含的程度
                    if contain >= 0.6 or jac >= 0.3:
                        dup_note = ('提醒：本次追加内容与原记录相似度 %.0f%%，'
                                    '可能存在重复，请确认是否有必要追加。' % (jac * 100))
            with open(fp, 'a', encoding='utf-8') as f:
                f.write(content)
            _ensure_index(records_dir)
            out = {'ok': True, 'name': rel[:-3]}
            if dup_note:
                out['note'] = dup_note
            ctx.send_json(out)
        except Exception as e:
            ctx.send_json({'ok': False, 'error': str(e)})
        return

    # ---------- search：递归全文 + 文件名匹配（含命中片段） ----------
    if action == 'search':
        kw = keyword or body.get('kw', '')
        if not kw:
            ctx.send_json({'ok': False, 'error': 'No keyword specified'})
            return
        snippets_on = body.get('snippets', True) is not False  # 默认返回片段
        results = []
        hits = []  # 兼容层：records 始终为字符串名列表；片段放 hits
        # 项目层路由时：同时搜 记忆根目录（含 全局/ 与未迁移旧记录），并去重
        _search_roots = [records_dir]
        if os.path.normpath(_root_records_dir) != os.path.normpath(records_dir):
            _search_roots.append(_root_records_dir)
        _seen_rels = set()
        for _sroot in _search_roots:
          if os.path.isdir(_sroot):
            for root, dirs, files in os.walk(_sroot):
                dirs[:] = [d for d in dirs if not d.startswith('.')]
                for f in files:
                    if not f.endswith('.md') or f == INDEX_NAME:
                        continue
                    fp = os.path.join(root, f)
                    rel = os.path.relpath(fp, _sroot).replace('\\', '/')[:-3]
                    _rkey = rel.lower()
                    if _rkey in _seen_rels:
                        continue
                    _seen_rels.add(_rkey)
                    # 根目录搜索时排除其它项目的项目层记录（防串台）
                    _cur_pid_seg = '项目/' + (_pid_iso or '') + '/'
                    if _sroot is _root_records_dir and rel.startswith('项目/') \
                            and not rel.startswith(_cur_pid_seg):
                        continue
                    snippet = ''
                    try:
                        with open(fp, 'r', encoding='utf-8', errors='replace') as fh:
                            text = fh.read()
                        pos = text.find(kw)
                        hit = pos >= 0
                        if hit and snippets_on:
                            s = max(0, pos - 40)
                            snippet = ' '.join(text[s:pos + len(kw) + 80].split())
                            if s > 0:
                                snippet = '…' + snippet
                            if pos + len(kw) + 80 < len(text):
                                snippet = snippet + '…'
                    except Exception:
                        hit = False
                    name_hit = kw in rel
                    if hit or name_hit:
                        ent = {'name': rel}
                        if rel.split('/')[0] in SENSITIVE_CATEGORIES:
                            ent['snippet'] = '【已打码·敏感类目，请显式 read 查看】'
                            ent['sensitive'] = True
                        elif snippet:
                            ent['snippet'] = snippet
                        elif name_hit and not hit:
                            ent['snippet'] = '（仅文件名命中）'
                        if snippets_on:
                            hits.append(ent)
                        results.append(rel)
        ctx.send_json({'ok': True, 'keyword': kw, 'records': results,
                       'hits': hits})
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
                # 同步清理分节替换/备份产生的同名残留（.bak 与 .bak.时间戳）
                try:
                    import glob as _glob
                    for _bak in ([fp + '.bak'] + _glob.glob(fp + '.bak.*')):
                        try:
                            if os.path.isfile(_bak):
                                try:
                                    _m2t(_bak, source='project_record')
                                except Exception:
                                    os.remove(_bak)
                        except Exception:
                            pass
                except Exception:
                    pass
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
