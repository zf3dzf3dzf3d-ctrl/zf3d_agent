#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
memory_autosave - 长期记忆自动 git 保存（方案5：定期强制 git）

设计要点：
- 记忆库目录 private/记忆/ 是【独立 git 仓库】（主仓库 .gitignore 忽略 private/，
  保证 apikey/密码等隐私永不进主仓库历史）。
- 由 server.py 启动的后台 daemon 线程定时调用 run_autosave()：
  有变更 → add+commit；无变更 → 跳过（不产生空提交）。
- 首次运行自动 git init（含用户级身份兜底，无 git 环境时静默放弃，绝不影响主服务）。
- commit 分两种：定时例行（chore 前缀）/ 服务关闭前最后一次（pre-shutdown 前缀）。

对外接口：
    run_autosave(reason='定时例行')  -> dict(ok, committed, commit_id, changed, msg)
    start_autosave_thread(interval_hours=1)  -> Thread（供 server.py main() 挂载）
    commit_now(reason='手动保存')    -> run_autosave 别名
"""
import os
import subprocess
import threading
import time

TOOL_REPO_NAME = 'memory_autosave'

# 提交间隔（秒），默认 1 小时；可被 private/memory_autosave.json 覆盖
DEFAULT_INTERVAL_HOURS = 1
_CFG_FILE = 'memory_autosave.json'

_lock = threading.Lock()


def _mem_dir(base_dir):
    return os.path.join(base_dir, 'private', '记忆')


def _load_interval_hours(base_dir):
    try:
        import json
        fp = os.path.join(base_dir, 'private', _CFG_FILE)
        if os.path.isfile(fp):
            with open(fp, 'r', encoding='utf-8-sig') as f:
                h = float(json.load(f).get('interval_hours', DEFAULT_INTERVAL_HOURS))
            if 0.05 <= h <= 168:
                return h
    except Exception:
        pass
    return DEFAULT_INTERVAL_HOURS


def _git(args, cwd, timeout=30):
    """执行 git 命令，返回 (returncode, stdout+stderr)。"""
    try:
        r = subprocess.run(['git'] + args, cwd=cwd, timeout=timeout,
                           capture_output=True, text=True,
                           encoding='utf-8', errors='replace',
                           creationflags=subprocess.CREATE_NO_WINDOW)
        return r.returncode, (r.stdout or '') + (r.stderr or '')
    except FileNotFoundError:
        return 127, 'git not found'
    except Exception as e:
        return 1, str(e)


def _has_identity(base_dir):
    """本地仓库/全局是否已配置 user.name/user.email，没有则用仓库级兜底身份。"""
    code, out = _git(['config', 'user.name'], base_dir)
    if code == 0 and out.strip():
        return True
    _git(['config', 'user.name', 'zf-agent-memory'], base_dir)
    _git(['config', 'user.email', 'memory@zf-agent.local'], base_dir)
    return False


def _ensure_repo(mem_dir):
    """确保记忆目录是【独立】git 仓库（有自己的 .git，而非主仓库的子目录）；
    首次 init 并配置兜底身份。返回 (is_repo, msg)。"""
    dot_git = os.path.join(mem_dir, '.git')
    if os.path.isdir(dot_git) or os.path.isfile(dot_git):
        return True, ''
    code, out = _git(['init'], mem_dir)
    if code != 0:
        return False, 'git init 失败: ' + out.strip()[:120]
    _has_identity(mem_dir)
    return True, 'initialized'


def run_autosave(base_dir, reason='定时例行'):
    """对记忆库执行一次 git 快照：有变更才提交。线程安全。"""
    with _lock:
        mem_dir = _mem_dir(base_dir)
        if not os.path.isdir(mem_dir):
            return {'ok': False, 'committed': False, 'msg': '记忆目录不存在'}
        is_repo, init_msg = _ensure_repo(mem_dir)
        if not is_repo:
            return {'ok': False, 'committed': False, 'msg': init_msg}

        # 忽略运行垃圾：时间戳 .bak / .auto.bak
        gi = os.path.join(mem_dir, '.gitignore')
        if not os.path.isfile(gi):
            try:
                with open(gi, 'w', encoding='utf-8') as f:
                    f.write('*.bak\n*.bak.*\n*.auto.bak\n.~*\nThumbs.db\n')
            except Exception:
                pass

        code, out = _git(['status', '--porcelain'], mem_dir)
        if code != 0:
            return {'ok': False, 'committed': False, 'msg': 'git status 失败: ' + out.strip()[:120]}
        changed = [l for l in out.splitlines() if l.strip()]
        if not changed:
            return {'ok': True, 'committed': False, 'changed': 0,
                    'msg': '无变更，跳过提交'}

        _git(['add', '-A'], mem_dir, timeout=60)
        msg = 'chore(记忆): %s 快照 %s（%d 个文件变更）' % (
            reason, time.strftime('%Y-%m-%d %H:%M'), len(changed))
        code, out = _git(['commit', '-m', msg], mem_dir, timeout=60)
        if code != 0:
            return {'ok': False, 'committed': False, 'changed': len(changed),
                    'msg': 'git commit 失败: ' + out.strip()[:160]}
        _, cid = _git(['rev-parse', '--short', 'HEAD'], mem_dir)
        return {'ok': True, 'committed': True, 'changed': len(changed),
                'commit_id': cid.strip(), 'msg': msg}


def commit_now(base_dir, reason='手动保存'):
    return run_autosave(base_dir, reason=reason)


def start_autosave_thread(base_dir, interval_hours=None):
    """启动记忆库定时 git 快照 daemon 线程（供 server.py main() 挂载）。
    启动即做一次快照，之后每 interval_hours 小时一次。"""
    if interval_hours is None:
        interval_hours = _load_interval_hours(base_dir)
    seconds = max(180, int(interval_hours * 3600))

    def _loop():
        # 启动稍等片刻，避开服务器启动最忙的窗口
        time.sleep(20)
        while True:
            try:
                r = run_autosave(base_dir, reason='定时例行')
                if r.get('committed'):
                    print('[MemoryGit] %s' % r.get('msg', ''))
                elif not r.get('ok'):
                    print('[MemoryGit] %s' % r.get('msg', 'unknown'))
            except Exception as e:
                print('[MemoryGit] error: %s' % e)
            time.sleep(seconds)

    t = threading.Thread(target=_loop, name='memory-git-autosave', daemon=True)
    t.start()
    return t
