#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
朱峰社区智能体无限 - 自动/手动升级模块 (updater.py)
=====================================================
功能：
1. 检查远程(GitHub/Gitee)最新版本 — 通过 raw version.json 对比
2. 手动升级  — POST /api/updater/check + /api/updater/apply
3. 自动升级  — 启动时检查 + 可选定时检查(见 private/updater.json 配置)
4. 升级方式：git fetch + reset --hard origin/main（本地改动先 stash 保护，
   升级后可恢复），不依赖第三方库，纯标准库实现。
5. 升级完成后自动调用 restart_server.py 重启 → 达到最新版本。

远程源配置（private/updater.json）:
{
    "remote_type": "github",           # github | gitee
    "github_repo":  "user/repo",       # GitHub 仓库
    "gitee_repo":   "user/repo",       # Gitee 仓库（国内推荐，作为 fallback）
    "branch":       "main",
    "auto_check_on_start": true,       # 启动时自动检查
    "auto_apply": false,               # true=发现新版自动升级(全自动)；false=只提示
    "check_interval_hours": 6          # 定时检查间隔(小时)，0=不定时
}

依赖：git 命令行（Windows 用户装 Git for Windows 即可）。
"""

import os
import sys
import json
import time
import shutil
import subprocess
import threading
import urllib.request
import urllib.error

_HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(_HERE)
VERSION_JSON = os.path.join(PROJECT_ROOT, 'private', 'version.json')
UPDATER_JSON = os.path.join(PROJECT_ROOT, 'private', 'updater.json')
UPDATER_LOG  = os.path.join(PROJECT_ROOT, 'private', 'updater.log')
RESTART_SCRIPT = os.path.join(_HERE, 'restart_server.py')

DEFAULTS = {
    'remote_type': 'github',
    'github_repo': 'zf3dzf3dzf3d-ctrl/zf3d_agent',
    'gitee_repo':  '',
    'branch': 'main',
    'auto_check_on_start': True,
    'auto_apply': False,
    'check_interval_hours': 6,
    'last_check': 0,
    'last_check_result': None,   # {'remote_version','local_version','has_update','checked_at'}
}


def _log(msg):
    line = '[%s] %s' % (time.strftime('%Y-%m-%d %H:%M:%S'), msg)
    try:
        print('[Updater] ' + msg)
    except Exception:
        pass
    try:
        with open(UPDATER_LOG, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass


def load_cfg():
    cfg = dict(DEFAULTS)
    if os.path.exists(UPDATER_JSON):
        try:
            with open(UPDATER_JSON, 'r', encoding='utf-8-sig') as f:
                data = json.load(f)
            if isinstance(data, dict):
                cfg.update(data)
        except Exception as e:
            _log('读取 updater.json 失败: %s' % e)
    return cfg


def save_cfg(cfg):
    os.makedirs(os.path.dirname(UPDATER_JSON), exist_ok=True)
    with open(UPDATER_JSON, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def get_local_version():
    try:
        with open(VERSION_JSON, 'r', encoding='utf-8-sig') as f:
            data = json.load(f)
        v = data.get('version')
        if isinstance(v, str) and v.strip():
            return v.strip()
    except Exception:
        pass
    return 'unknown'


def _remote_raw_url(cfg):
    repo_key = cfg['remote_type'] + '_repo'
    repo = cfg.get(repo_key) or cfg.get('github_repo') or cfg.get('gitee_repo')
    if not repo:
        return None
    if cfg['remote_type'] == 'gitee':
        return 'https://gitee.com/%s/raw/%s/private/version.json' % (repo, cfg['branch'])
    return 'https://raw.githubusercontent.com/%s/%s/private/version.json' % (repo, cfg['branch'])


def _http_get(url, timeout=10):
    req = urllib.request.Request(url, headers={'User-Agent': 'ZF3D-Agent-Updater'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode('utf-8', errors='replace')


def _run_git(args, cwd=PROJECT_ROOT, timeout=120):
    """执行 git 命令，返回 (ok, output)。git 不存在时返回明确错误。"""
    git_exe = shutil.which('git')
    if not git_exe:
        return False, '未找到 git 命令。请安装 Git for Windows: https://git-scm.com/download/win'
    try:
        r = subprocess.run([git_exe] + args, cwd=cwd, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=timeout)
        out = (r.stdout or '') + (r.stderr or '')
        return r.returncode == 0, out.strip()
    except Exception as e:
        return False, str(e)


# ---------------------------------------------------------------------------
# 版本比较：'5.1.2' < '5.2.0'
# ---------------------------------------------------------------------------
def _v_tuple(v):
    try:
        return tuple(int(x) for x in str(v).split('.'))
    except Exception:
        return (0,)


def version_newer(remote, local):
    try:
        return _v_tuple(remote) > _v_tuple(local)
    except Exception:
        return str(remote) != str(local)


# ---------------------------------------------------------------------------
# 核心功能
# ---------------------------------------------------------------------------
def check_update(cfg=None):
    """检查远程是否有新版本。返回 dict 结果并写 last_check 到配置。
    双驱动：同时查询 GitHub 和 Gitee（哪个配置了查哪个），结果记入 sources，
    以版本号最高的源为准；升级时 git 双远程互为备份（见 apply_update）。"""
    cfg = cfg or load_cfg()
    local = get_local_version()
    sources = [t for t in ('github', 'gitee') if cfg.get(t + '_repo')]
    if not sources:
        res = {'ok': False, 'error': '未配置远程仓库(github_repo/gitee_repo)', 'local_version': local}
        _log('检查失败: 未配置远程仓库')
        return res

    results = []   # [(type, version, url)]
    src_detail = {}
    last_err = None
    for t in sources:
        sub = dict(cfg)
        sub['remote_type'] = t
        url = _remote_raw_url(sub)
        if not url:
            continue
        detail = {'ok': False}
        try:
            raw = _http_get(url)
            d = json.loads(raw)
            v = str(d.get('version', '')).strip()
            if v:
                results.append((t, v, url))
                detail.update(ok=True, version=v)
            else:
                last_err = '远程 version.json 缺少 version 字段'
                detail['error'] = last_err
        except urllib.error.HTTPError as e:
            if e.code == 404:
                last_err = '远程仓库还没有 private/version.json（请先把项目推送到 %s）' % cfg.get(t + '_repo')
            else:
                last_err = '远程访问失败(HTTP %s): %s' % (e.code, e)
            detail['error'] = last_err
            _log('[%s] 检查失败: %s' % (t, last_err))
        except Exception as e:
            last_err = '访问/解析远程版本失败(%s): %s' % (t, e)
            detail['error'] = last_err
            _log('[%s] 检查失败: %s' % (t, last_err))
        src_detail[t] = detail

    if not results:
        res = {'ok': False, 'error': last_err or '所有远程源均不可用',
               'local_version': local, 'sources': src_detail}
        _log('检查失败(全部源): %s' % last_err)
        _save_check_result(cfg, res, ok=False)
        return res

    # 双驱动：取版本号最高的源作为首选
    results.sort(key=lambda x: _v_tuple(x[1]), reverse=True)
    used_type, remote, url = results[0]
    for t, d in src_detail.items():
        d['is_primary'] = (t == used_type)

    # 记住首选源（双驱动），升级时优先用它
    if used_type != cfg.get('remote_type'):
        cfg['remote_type'] = used_type
        _log('双驱动: 以 %s 为首选源 (版本最高/可用)' % used_type)
    cfg['source_status'] = src_detail
    save_cfg(cfg)

    has_update = version_newer(remote, local) if remote else False
    res = {
        'ok': True,
        'local_version': local,
        'remote_version': remote,
        'has_update': has_update,
        'remote_url': url,
        'primary_source': used_type,
        'sources': src_detail,
        'checked_at': time.strftime('%Y-%m-%d %H:%M:%S'),
    }
    _log('检查完成: 本地 %s / 远程 %s / 首选源=%s / 需更新=%s' % (local, remote, used_type, has_update))
    _save_check_result(cfg, res, ok=True)
    return res


def _save_check_result(cfg, res, ok=True):
    try:
        cfg['last_check'] = time.time()
        if ok:
            cfg['last_check_result'] = {
                'remote_version': res.get('remote_version'),
                'local_version': res.get('local_version'),
                'has_update': res.get('has_update'),
                'checked_at': res.get('checked_at'),
            }
        save_cfg(cfg)
    except Exception:
        pass


def _git_state():
    """获取当前 git 状态：是否有本地改动、当前分支。"""
    ok, out = _run_git(['status', '--porcelain', '-b'])
    if not ok:
        return None, out
    branch = 'main'
    dirty = []
    for line in out.splitlines():
        if line.startswith('##'):
            branch = line[2:].split('...')[0].strip() or branch
        else:
            dirty.append(line)
    return {'branch': branch, 'dirty_files': dirty}, None


def apply_update(cfg=None):
    """执行升级：stash 本地改动 → fetch → reset 到远程 → 更新依赖(如有) → 重启。"""
    cfg = cfg or load_cfg()
    local = get_local_version()
    _log('===== 开始升级 (当前 %s) =====' % local)

    # 0) git 仓库存在性
    if not os.path.isdir(os.path.join(PROJECT_ROOT, '.git')):
        return {'ok': False, 'error': '本项目不是 git 仓库(.git 不存在)，无法在线升级。请到 GitHub 重新下载完整包。'}

    # 1) 检查远程版本
    pre = check_update(cfg)
    if not pre.get('ok'):
        return {'ok': False, 'error': pre.get('error', '检查远程版本失败')}
    if not pre.get('has_update'):
        return {'ok': True, 'updated': False, 'message': '已是最新版本 %s' % local,
                'local_version': local, 'remote_version': pre['remote_version']}

    remote = pre['remote_version']

    # 2) 确保配置了远程 origin
    ok, out = _run_git(['remote', 'get-url', 'origin'])
    if not ok:
        repo = cfg.get('github_repo') or cfg.get('gitee_repo')
        if not repo:
            return {'ok': False, 'error': 'git 未配置 origin 远程，且 updater.json 未指定仓库'}
        url = ('https://gitee.com/%s.git' % repo) if cfg['remote_type'] == 'gitee' \
              else ('https://github.com/%s.git' % repo)
        ok, out = _run_git(['remote', 'add', 'origin', url])
        if not ok:
            return {'ok': False, 'error': '配置 origin 失败: %s' % out}
        _log('已添加 origin: %s' % url)

    # 3) 保护本地改动：stash（含可恢复信息）
    st, err = _git_state()
    stashed = False
    if st and st['dirty_files']:
        stamp = time.strftime('%Y%m%d_%H%M%S')
        ok, out = _run_git(['stash', 'push', '-u', '-m', 'updater-auto-backup-%s' % stamp])
        if ok:
            stashed = True
            _log('本地改动已 stash 保护: %d 个文件 (stash@{0})' % len(st['dirty_files']))
        else:
            _log('stash 失败(继续用 reset --hard): %s' % out)

    # 4) fetch + reset：双远程互备，首选源失败自动换另一个
    def _src_url(t):
        r = cfg.get(t + '_repo')
        if not r:
            return None
        return ('https://gitee.com/%s.git' % r) if t == 'gitee' else ('https://github.com/%s.git' % r)

    order = [cfg['remote_type']] + [t for t in ('github', 'gitee')
                                    if t != cfg['remote_type'] and cfg.get(t + '_repo')]
    ok = False
    out = ''
    fetched_ref = None
    for t in order:
        want = _src_url(t)
        if not want:
            continue
        ok, cur = _run_git(['remote', 'get-url', 'origin'])
        if ok and cur.strip() != want:
            _run_git(['remote', 'set-url', 'origin', want])
        ok, out = _run_git(['fetch', 'origin', cfg['branch']], timeout=300)
        if ok:
            fetched_ref = 'origin/%s' % cfg['branch']
            _log('fetch 成功: %s (%s)' % (t, want))
            break
        _log('[%s] fetch 失败, 尝试下一个源: %s' % (t, out[:200]))
    if not ok or not fetched_ref:
        return {'ok': False, 'error': 'git fetch 失败(所有远程源均不可用): %s' % out}
    ok, out = _run_git(['reset', '--hard', fetched_ref])
    if not ok:
        return {'ok': False, 'error': 'git reset 失败: %s' % out}
    _log('已同步到 %s' % fetched_ref)

    # 5) 更新依赖（若新版本带 requirements.txt 且非嵌入式 python）
    pip_msg = ''
    req = os.path.join(_HERE, 'requirements.txt')
    py_exe = sys.executable
    embedded = 'python\\python.exe' in py_exe or 'python311' in py_exe
    if os.path.exists(req) and not embedded:
        try:
            r = subprocess.run([py_exe, '-m', 'pip', 'install', '-r', req, '--quiet'],
                               capture_output=True, text=True, timeout=600)
            pip_msg = '依赖已更新' if r.returncode == 0 else '依赖更新警告: %s' % (r.stderr or '')[:200]
        except Exception as e:
            pip_msg = '依赖更新跳过: %s' % e
        _log(pip_msg)

    new_ver = get_local_version()

    # 6) 重启服务器（restart_server.py 带导入自检，AI 半成品代码期间会等待）
    restart_ok = True
    restart_msg = ''
    if os.path.exists(RESTART_SCRIPT):
        try:
            subprocess.Popen([py_exe, RESTART_SCRIPT, '--manual'],
                             cwd=_HERE,
                             creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
            _log('已调用 restart_server.py，服务器即将重启')
        except Exception as e:
            restart_ok = False
            restart_msg = str(e)
    else:
        restart_ok = False
        restart_msg = '找不到 restart_server.py，请手动重启'

    result = {
        'ok': True,
        'updated': True,
        'old_version': local,
        'new_version': new_ver,
        'stashed': stashed,
        'pip_msg': pip_msg,
        'restart_ok': restart_ok,
        'restart_msg': restart_msg,
        'message': '已升级 %s → %s，服务正在重启...' % (local, new_ver),
    }
    _log('===== 升级完成: %s → %s =====' % (local, new_ver))
    return result


def restore_stash():
    """升级后如果用户想恢复自己的本地改动，可调用此接口（谨慎，可能冲突）。"""
    ok, out = _run_git(['stash', 'pop'])
    return {'ok': ok, 'output': out}


# ---------------------------------------------------------------------------
# 自动升级：启动检查 + 定时检查线程
# ---------------------------------------------------------------------------
_auto_thread_started = False


def _maybe_auto(cfg):
    """按配置执行一次自动检查（可选自动应用）。"""
    if not cfg.get('auto_check_on_start', True):
        return
    interval = float(cfg.get('check_interval_hours', 0) or 0)
    last = float(cfg.get('last_check', 0) or 0)
    if interval > 0 and (time.time() - last) < interval * 3600:
        return  # 未到间隔
    res = check_update(cfg)
    if res.get('ok') and res.get('has_update') and cfg.get('auto_apply'):
        _log('自动升级触发 (发现 %s)' % res['remote_version'])
        apply_update(cfg)


def start_auto_checker():
    """后台守护线程：延迟 30 秒做首次检查，然后按间隔循环。"""
    global _auto_thread_started
    if _auto_thread_started:
        return
    _auto_thread_started = True

    def _loop():
        time.sleep(30)  # 等服务器完全起来
        while True:
            try:
                cfg = load_cfg()
                if cfg.get('auto_check_on_start', True):
                    _maybe_auto(cfg)
                interval = float(cfg.get('check_interval_hours', 6) or 6)
                if interval <= 0:
                    break  # 用户关闭定时检查
                time.sleep(interval * 3600)
            except Exception as e:
                _log('自动检查线程异常: %s' % e)
                time.sleep(600)

    t = threading.Thread(target=_loop, daemon=True, name='zf3d-updater')
    t.start()
    _log('自动升级检查线程已启动')


if __name__ == '__main__':
    # 命令行手动用法：
    #   python updater.py check   → 只检查
    #   python updater.py apply   → 执行升级
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'check'
    if cmd == 'apply':
        r = apply_update()
    else:
        r = check_update()
    print(json.dumps(r, ensure_ascii=False, indent=2))
