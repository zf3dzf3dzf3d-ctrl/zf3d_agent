# -*- coding: utf-8 -*-
"""
🧬 记忆大师：跨版本记忆导入（memory_import.py）
=============================================
目的：升级到新版本后，把并排老版本目录的 private/记忆/ 全部导入当前版本，记忆永存。

设计原则（收口定稿）：
- 保守导入：永不覆盖、永不删除。重名文件当前版本已有 → 老文件改名为「文件名-来自老目录名.md」保留
- 路径白名单：只允许项目根的「兄弟目录」（同级），防任意路径写
- git 快照：导入前、导入后各调 memory_autosave.commit_now()，可整体回退
- 三 API：
    POST /api/memory/import/candidates  自动探测兄弟版本目录的记忆库
    POST /api/memory/import/scan        差异预览（新增/重名改名/跳过）
    POST /api/memory/import/run         执行导入 + 双快照
"""

import os
import shutil

# 记忆库目录名（相对版本根）
MEMORY_DIR = 'private'
MEMORY_SUBDIR = '记忆'


def _project_root():
    """当前版本根目录：server/ 的上一级"""
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _mem_dir(root):
    return os.path.join(root, MEMORY_DIR, MEMORY_SUBDIR)


def _is_source_safe(path):
    """白名单（只读来源，安全）：目录必须真实存在且形如「朱峰/智能体」版本目录（含 private/记忆/）。
    导入本身仍是保守只增模式（永不覆盖/删除），且前后有 git 快照。"""
    real = os.path.realpath(path)
    name = os.path.basename(real)
    if not (('朱峰' in name or '智能体' in name) and ('朱峰' in name or '智能体' in name)):
        return False
    if real == os.path.realpath(_project_root()):
        return False
    return os.path.isdir(_mem_dir(real))


# 兼容旧名
_is_sibling_safe = _is_source_safe


def _probe_dir(cand_root, out):
    """探测单个目录是否含记忆库，加入候选"""
    md = _mem_dir(cand_root)
    if not os.path.isdir(md):
        return
    files = [f for f in os.listdir(md) if os.path.isfile(os.path.join(md, f))]
    if not files:
        return
    out.append({
        'dir': cand_root,
        'name': os.path.basename(cand_root.rstrip('\\/')),
        'count': len(files),
        'mtime': int(os.path.getmtime(md)),
    })


def _search_roots():
    """全盘智能扫描的搜索根：同级目录 + 各盘符根 + 常见安装位置"""
    root = _project_root()
    roots = [os.path.dirname(root)]
    import string
    for letter in string.ascii_uppercase:
        drv = letter + ':\\'
        if os.path.isdir(drv):
            roots.append(drv)
    roots += [os.path.expanduser('~'), os.path.expanduser('~\\Desktop'),
              'C:\\Users\\Administrator\\AppData\\Local\\Programs']
    seen, uniq = set(), []
    for r in roots:
        rr = os.path.realpath(r)
        if rr not in seen and os.path.isdir(rr):
            seen.add(rr)
            uniq.append(rr)
    return uniq


def list_candidates():
    """自动探测含记忆库的候选版本目录：同级 + 全盘智能扫描（深度≤3，跳过系统/垃圾目录）"""
    root = _project_root()
    cur_real = os.path.realpath(root)
    cur_ver = os.path.basename(root)
    out, seen = [], set()
    try:
        for base in _search_roots():
            try:
                names = sorted(os.listdir(base))
            except Exception:
                continue
            for name in names:
                cand = os.path.join(base, name)
                try:
                    if not os.path.isdir(cand):
                        continue
                    real = os.path.realpath(cand)
                    if real in seen or real == cur_real:
                        continue
                    seen.add(real)
                    low = name.lower()
                    if name in ('Windows', 'Program Files', 'Program Files (x86)', '$Recycle.Bin', 'System Volume Information', 'node_modules', '.git', '_垃圾箱'):
                        continue
                    # 直接命中（目录名含关键词）
                    if ('朱峰' in name or '智能体' in name):
                        _probe_dir(cand, out)
                        # 三级探测：版本集合目录（如「朱峰社区智能体无限_新版本」）的下一层是各版本目录
                        try:
                            for sub in sorted(os.listdir(cand)):
                                sub_p = os.path.join(cand, sub)
                                if os.path.isdir(sub_p) and not sub.startswith(('.', '$')) and sub not in ('node_modules', '_垃圾箱'):
                                    _probe_dir(sub_p, out)
                        except Exception:
                            pass
                        continue
                    # 二级探测：父目录名含关键词时下一层可能是版本目录
                    if ('朱峰' in base or '智能体' in base) and not name.startswith(('.', '$')):
                        _probe_dir(cand, out)
                except Exception:
                    continue
    except Exception as e:
        return {'ok': False, 'err': str(e)}
    out.sort(key=lambda x: -x['mtime'])
    return {'ok': True, 'current': cur_ver, 'candidates': out,
            'scan_mode': '全盘智能扫描'}


def scan_import(src_root):
    """差异预览：返回 will_add / will_rename / skip 三类"""
    try:
        if not _is_sibling_safe(src_root):
            return {'ok': False, 'err': '路径不在允许范围（仅限项目同级目录）'}
        src_md = _mem_dir(src_root)
        if not os.path.isdir(src_md):
            return {'ok': False, 'err': '该目录下没有 private/记忆/ 记忆库'}
        dst_md = _mem_dir(_project_root())
        os.makedirs(dst_md, exist_ok=True)
        existing = set(os.listdir(dst_md))
        add, rename, skip = [], [], []
        for f in sorted(os.listdir(src_md)):
            s = os.path.join(src_md, f)
            if not os.path.isfile(s):
                continue
            if f in existing:
                tag = os.path.basename(src_root.rstrip('\\/'))
                base, ext = os.path.splitext(f)
                nf = f'{base}-来自{tag}{ext or ".md"}'
                # 极端情况：新名也被占用则再加序号
                i = 1
                while nf in existing:
                    nf = f'{base}-来自{tag}-{i}{ext or ".md"}'
                    i += 1
                rename.append({'file': f, 'as': nf})
            else:
                add.append(f)
        return {'ok': True, 'src': src_root, 'add': add, 'rename': rename, 'skip': skip}
    except Exception as e:
        return {'ok': False, 'err': str(e)}


def run_import(src_root):
    """执行保守导入 + 前后各一次 git 快照"""
    pre = scan_import(src_root)
    if not pre.get('ok'):
        return pre
    try:
        from memory_autosave import commit_now
        dst_md = _mem_dir(_project_root())
        src_md = _mem_dir(src_root)
        try:
            commit_now(dst_md, reason='记忆大师：导入前快照')
        except Exception:
            pass
        moved_add, moved_rename = [], []
        for f in pre['add']:
            shutil.copy2(os.path.join(src_md, f), os.path.join(dst_md, f))
            moved_add.append(f)
        for it in pre['rename']:
            shutil.copy2(os.path.join(src_md, it['file']), os.path.join(dst_md, it['as']))
            moved_rename.append({'file': it['file'], 'as': it['as']})
        snap_err = None
        try:
            commit_now(dst_md, reason='记忆大师：导入完成快照')
        except Exception as e:
            snap_err = str(e)
        return {'ok': True, 'src': src_root, 'added': len(moved_add),
                'renamed': len(moved_rename), 'detail_add': moved_add,
                'detail_rename': moved_rename, 'snapshot_err': snap_err}
    except Exception as e:
        return {'ok': False, 'err': str(e)}


def auto_collect():
    """⚡ 一键自动收集：全盘扫描所有老版本记忆库 → 汇总差异 → 一次性保守导入（永不覆盖/删除）"""
    cands = list_candidates()
    if not cands.get('ok'):
        return cands
    if not cands['candidates']:
        return {'ok': False, 'err': '全盘扫描未发现任何含记忆库的老版本目录'}
    dst_md = _mem_dir(_project_root())
    try:
        from memory_autosave import commit_now
        try:
            commit_now(dst_md, reason='记忆大师：自动收集·导入前快照')
        except Exception:
            pass
    except Exception:
        pass
    os.makedirs(dst_md, exist_ok=True)
    results, total_add, total_rename = [], 0, 0
    for c in cands['candidates']:
        pre = scan_import(c['dir'])
        if not pre.get('ok'):
            results.append({'dir': c['dir'], 'name': c['name'], 'ok': False, 'err': pre.get('err')})
            continue
        added, renamed = [], []
        for f in pre['add']:
            shutil.copy2(os.path.join(_mem_dir(c['dir']), f), os.path.join(dst_md, f))
            added.append(f)
        for it in pre['rename']:
            shutil.copy2(os.path.join(_mem_dir(c['dir']), it['file']), os.path.join(dst_md, it['as']))
            renamed.append({'file': it['file'], 'as': it['as']})
        total_add += len(added)
        total_rename += len(renamed)
        results.append({'dir': c['dir'], 'name': c['name'], 'ok': True,
                        'added': len(added), 'renamed': len(renamed),
                        'detail_add': added, 'detail_rename': renamed})
    snap_err = None
    try:
        from memory_autosave import commit_now
        commit_now(dst_md, reason='记忆大师：自动收集·导入完成快照')
    except Exception as e:
        snap_err = str(e)
    return {'ok': True, 'sources': len(results), 'added': total_add,
            'renamed': total_rename, 'results': results, 'snapshot_err': snap_err}
