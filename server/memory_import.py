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


def _is_sibling_safe(path):
    """白名单：路径必须位于项目根的同级目录下（兄弟版本目录）"""
    root = _project_root()
    parent = os.path.dirname(root)
    real = os.path.realpath(path)
    parent_real = os.path.realpath(parent)
    return real.startswith(parent_real + os.sep) and not real.startswith(os.path.realpath(root) + os.sep)


def list_candidates():
    """自动探测兄弟版本目录中含记忆库的候选"""
    root = _project_root()
    parent = os.path.dirname(root)
    cur_ver = os.path.basename(root)
    out = []
    try:
        for name in sorted(os.listdir(parent)):
            if name == cur_ver:
                continue
            cand_root = os.path.join(parent, name)
            if not os.path.isdir(cand_root):
                continue
            md = _mem_dir(cand_root)
            if not os.path.isdir(md):
                continue
            files = [f for f in os.listdir(md) if os.path.isfile(os.path.join(md, f))]
            if not files:
                continue
            out.append({
                'dir': cand_root,
                'name': name,
                'count': len(files),
                'mtime': int(os.path.getmtime(md)),
            })
    except Exception as e:
        return {'ok': False, 'err': str(e)}
    out.sort(key=lambda x: -x['mtime'])
    return {'ok': True, 'current': cur_ver, 'candidates': out}


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
