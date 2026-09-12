#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
common/sandbox.py - 沙箱保护模式（5.1.2）

原则：不打扰（不弹用户确认），但每一次 AI 对文件的更改都可退回。
机制：
  1. 任何写入前自动快照原文件到 server/data/sandbox/<时间片>/，并记录一条
     带时间戳的操作日志（谁、什么时候、改了哪个文件、快照在哪）。
  2. 撤销（undo）：把文件恢复到上一次操作前的状态（读快照写回原路径）。
     撤销前也会快照当前状态，所以撤销本身可被 redo 恢复。
  3. 时间线（timeline）：列出全部可撤销操作，供前端展示。
  4. 新建文件也记日志（快照为空内容，撤销=删除该文件）。

存储：
  server/data/sandbox/snapshots/  快照内容（<op_id>.snap）
  server/data/sandbox/journal.json  操作日志（只追加，undo 会追加撤销记录）
"""
import os
import re
import json
import time
import shutil
import subprocess
import threading

# git 图谱桥接（True=每次沙箱操作自动打一个 auto-checkpoint 提交）


def _git(*args):
    """在项目根跑 git 命令，返回 (ok, stdout)。绝不抛错。"""
    if not GIT_BRIDGE or not os.path.isdir(os.path.join(_PROJECT_ROOT, '.git')):
        return False, ''
    try:
        r = subprocess.run(['git'] + list(args), cwd=_PROJECT_ROOT,
                           capture_output=True, timeout=GIT_TIMEOUT)
        return r.returncode == 0, (r.stdout or b'').decode('utf-8', 'replace').strip()
    except Exception as e:
        _log('git failed: %s' % e)
        return False, ''


def _git_checkpoint(msg):
    """把当前全部改动提交为一个检查点，返回 commit 哈希（失败返回 ''）。"""
    ok, _ = _git('add', '-A')
    if not ok:
        return ''
    ok, _ = _git('commit', '-m', msg, '--no-gpg-sign')
    if not ok:
        return ''   # 没有变化时不产生提交，属正常
    _, out = _git('rev-parse', '--short', 'HEAD')
    return out


def git_history(limit=30):
    """给前端 git 图谱用：最近提交列表（新的在前）。"""
    ok, out = _git('log', '--pretty=format:%h|%ad|%s',
                   '--date=format:%Y-%m-%d %H:%M:%S', '-%d' % max(1, min(int(limit or 30), 200)))
    if not ok or not out:
        return []
    items = []
    for line in out.splitlines():
        parts = line.split('|', 2)
        if len(parts) == 3:
            items.append({'commit': parts[0], 'time': parts[1], 'msg': parts[2]})
    return items

_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.dirname(os.path.dirname(_DIR))   # engines/common -> engines -> server/
SB_DIR = os.path.join(SERVER_DIR, 'data', 'sandbox')
SNAP_DIR = os.path.join(SB_DIR, 'snapshots')
JOURNAL = os.path.join(SB_DIR, 'journal.json')
LOCK = threading.Lock()

# git 图谱桥接（True=每次沙箱操作自动打一个检查点提交）
GIT_BRIDGE = True
GIT_TIMEOUT = 15
_PROJECT_ROOT = os.path.dirname(SERVER_DIR)   # 项目根（server/ 的上一级）

# 单文件快照大小上限（超过不快照，只记日志；防止把大视频塞进沙箱）
MAX_SNAP_SIZE = 32 * 1024 * 1024
# 日志最大条数（超出裁剪最旧的）
JOURNAL_MAX = 600


def _log(msg):
    try:
        with open(os.path.join(SB_DIR, 'sandbox.log'), 'a', encoding='utf-8') as f:
            f.write(time.strftime('%m-%d %H:%M:%S ') + str(msg) + '\n')
    except OSError:
        pass


def _load_journal():
    try:
        with open(JOURNAL, 'r', encoding='utf-8-sig') as f:
            d = json.load(f)
        if isinstance(d, dict) and isinstance(d.get('ops'), list):
            return d
    except Exception:
        pass
    return {'ops': []}


def _prune_snap_files(removed_ops):
    """journal 裁剪后，删掉被裁掉记录引用的 .snap 快照（磁盘不无限涨）。"""
    try:
        for e in removed_ops:
            sp = e.get('snapshot')
            if sp and os.path.isfile(sp):
                os.remove(sp)
    except OSError:
        pass


def _prune_orphan_snaps(max_age_hours=48):
    """兜底：删掉 journal 里已不引用、且超过时限的孤儿 .snap 文件。"""
    try:
        d = _load_journal()
        referenced = {e.get('snapshot') for e in d['ops'] if e.get('snapshot')}
        now = time.time()
        for fn in os.listdir(SNAP_DIR):
            if not fn.endswith('.snap'):
                continue
            p = os.path.join(SNAP_DIR, fn)
            if p in referenced:
                continue
            try:
                if now - os.path.getmtime(p) > max_age_hours * 3600:
                    os.remove(p)
            except OSError:
                pass
    except OSError:
        pass


def _save_journal(d):
    os.makedirs(SB_DIR, exist_ok=True)
    ops = d['ops']
    removed = ops[:-JOURNAL_MAX] if len(ops) > JOURNAL_MAX else []
    d['ops'] = ops[-JOURNAL_MAX:]
    if removed:
        _prune_snap_files(removed)
    tmp = JOURNAL + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, JOURNAL)
    if removed:
        _prune_orphan_snaps()


def _new_op_id():
    return 'op_%d_%03d' % (int(time.time() * 1000), int(time.time() * 1000) % 1000)


def _safe_rel(full_path):
    """相对路径展示名。跨盘符（os.path.relpath 会抛 ValueError）时退化为绝对路径。"""
    try:
        return os.path.relpath(full_path, SERVER_DIR).replace('\\', '/')
    except ValueError:
        return full_path.replace('\\', '/')


def _safe_abs(project_path, rel):
    """把工具传来的相对路径钉在项目根目录内，防越界。"""
    root = os.path.abspath(project_path or os.getcwd())
    parts = [p for p in re.split(r'[\\/]', rel or '') if p and p not in ('.', '..')]
    if not parts:
        return None
    p = os.path.abspath(os.path.join(root, *parts))
    return p if p.startswith(root + os.sep) or p == root else None


def snapshot_before_write(full_path, tag='write', source='ai'):
    """写文件前调用。返回 op_id（未跟踪的文件返回 None）。
    永不抛错——沙箱坏了不能把正常功能拖死。"""
    op_id = None
    try:
        existed = os.path.isfile(full_path)
        size_ok = existed and os.path.getsize(full_path) <= MAX_SNAP_SIZE
        op_id = _new_op_id()
        snap_path = os.path.join(SNAP_DIR, op_id + '.snap')
        with LOCK:
            os.makedirs(SNAP_DIR, exist_ok=True)
            if size_ok:
                shutil.copy2(full_path, snap_path)
            entry = {
                'id': op_id,
                'ts': int(time.time() * 1000),
                'time': time.strftime('%Y-%m-%d %H:%M:%S'),
                'action': 'write',
                'path': full_path,
                'rel': _safe_rel(full_path),
                'existed_before': existed,
                'snapshot': snap_path if size_ok else '',
                'tag': tag,
                'source': source,
                'undone': 0,          # 0=生效 1=已撤销 2=撤销后被重做（重新生效）
            }
            d = _load_journal()
            d['ops'].append(entry)
            _save_journal(d)
        _log('snapshot %s %s' % (op_id, full_path))
        commit = _git_checkpoint('[sandbox] write %s @ %s' % (entry['rel'], entry['time']))
        if commit:
            try:
                with LOCK:
                    d = _load_journal()
                    for e in reversed(d['ops']):
                        if e.get('id') == op_id:
                            e['commit'] = commit
                            break
                    _save_journal(d)
            except Exception:
                pass
    except Exception as e:
        _log('snapshot failed: %s' % e)
        op_id = None
    return op_id


def _do_restore(entry):
    """按条目恢复文件到快照状态。新建文件且无快照 → 删除。"""
    path = entry.get('path') or ''
    snap = entry.get('snapshot') or ''
    if entry.get('existed_before'):
        if not snap or not os.path.isfile(snap):
            return False, '快照缺失，无法恢复: %s' % path
        os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
        shutil.copy2(snap, path)
    else:
        # 原本不存在的文件：撤销=删除
        if os.path.isfile(path):
            os.remove(path)
    return True, ''


def undo(op_id=None):
    """撤销最近一条未撤销的写操作（op_id 指定时撤销指定那条）。
    撤销前先快照当前状态（可 redo 找回）。返回 (ok, message)。"""
    try:
        with LOCK:
            d = _load_journal()
            ops = d['ops']
            target = None
            if op_id:
                for e in reversed(ops):
                    if e.get('id') == op_id:
                        target = e
                        break
                if not target:
                    return False, '未找到该操作: %s' % op_id
            else:
                for e in reversed(ops):
                    if e.get('action') == 'write' and not e.get('undone'):
                        target = e
                        break
            if not target:
                return False, '没有可撤销的操作'
            # 撤销前：快照当前内容（供 redo）
            redo_id = _new_op_id()
            redo_snap = os.path.join(SNAP_DIR, redo_id + '.snap')
            os.makedirs(SNAP_DIR, exist_ok=True)
            existed_now = os.path.isfile(target['path'])
            size_ok = existed_now and os.path.getsize(target['path']) <= MAX_SNAP_SIZE
            if size_ok:
                shutil.copy2(target['path'], redo_snap)
            ok, err = _do_restore(target)
            if not ok:
                return False, err
            target['undone'] = 1
            d['ops'].append({
                'id': redo_id,
                'ts': int(time.time() * 1000),
                'time': time.strftime('%Y-%m-%d %H:%M:%S'),
                'action': 'undo',
                'path': target['path'],
                'rel': target.get('rel', ''),
                'existed_before': existed_now,
                'snapshot': redo_snap if size_ok else '',
                'tag': 'undo_of_' + target['id'],
                'source': 'sandbox',
                'undone': 0,
                'undo_of': target['id'],
            })
            _save_journal(d)
        _log('undo %s %s' % (target['id'], target.get('rel')))
        commit = _git_checkpoint('[sandbox] undo %s @ %s' % (target.get('rel') or target['path'], time.strftime('%H:%M:%S')))
        if commit:
            try:
                with LOCK:
                    d = _load_journal()
                    for e in reversed(d['ops']):
                        if e.get('id') == redo_id:
                            e['commit'] = commit
                            break
                    _save_journal(d)
            except Exception:
                pass
        return True, '已撤销：%s（%s）' % (target.get('rel') or target['path'], target.get('time', ''))
    except Exception as e:
        _log('undo failed: %s' % e)
        return False, '撤销失败: %s' % e


def redo(op_id=None):
    """重做最近一条被撤销的操作。返回 (ok, message)。"""
    try:
        with LOCK:
            d = _load_journal()
            ops = d['ops']
            target = None
            if op_id:
                for e in reversed(ops):
                    if e.get('id') == op_id:
                        target = e
                        break
            else:
                for e in reversed(ops):
                    if e.get('action') == 'undo':
                        # 后面如果原 op 已被重新生效，则不能重做
                        origin = next((o for o in ops if o.get('id') == e.get('undo_of')), None)
                        if origin and not origin.get('undone'):
                            continue
                        target = e
                        break
            if not target:
                return False, '没有可重做的操作'
            ok, err = _do_restore(target)
            if not ok:
                return False, err
            if target.get('undo_of'):
                origin = next((o for o in ops if o.get('id') == target['undo_of']), None)
                if origin:
                    origin['undone'] = 0
            _save_journal(d)
        _log('redo %s' % target['id'])
        _git_checkpoint('[sandbox] redo %s @ %s' % (target.get('rel') or target.get('path', ''), time.strftime('%H:%M:%S')))
        return True, '已重做：%s' % (target.get('rel') or target['path'])
    except Exception as e:
        _log('redo failed: %s' % e)
        return False, '重做失败: %s' % e


TEST_PATH_PAT = ('_sb_bridge_test', '_sandbox_test')


def _is_test_op(e):
    """测试/桥接自检产生的记录（如 _sb_bridge_test.txt），不应出现在真实时间线里。"""
    p = str(e.get('path') or e.get('rel') or '')
    return any(k in p for k in TEST_PATH_PAT)


def timeline(limit=50, include_test=False):
    """返回最近的操作日志（新的在前）。默认过滤测试记录并给旧条目打 tag='test'。"""
    d = _load_journal()
    changed = False
    for e in d['ops']:
        if _is_test_op(e) and e.get('tag') != 'test':
            e['tag'] = 'test'
            changed = True
    if changed:
        try:
            _save_journal(d)
        except Exception:
            pass
    ops = [e for e in reversed(d['ops']) if include_test or e.get('tag') != 'test']
    ops = ops[:max(1, min(int(limit or 50), 200))]
    for e in ops:
        e['undone_label'] = {0: '', 1: '已撤销'}.get(e.get('undone', 0), '')
    return {'ok': True, 'ops': ops}


def stats():
    d = _load_journal()
    ops = d['ops']
    active = [o for o in ops if o.get('action') == 'write' and not o.get('undone')]
    undone = [o for o in ops if o.get('undone') == 1]
    return {'ok': True, 'total': len(ops), 'active_writes': len(active), 'undone': len(undone)}
