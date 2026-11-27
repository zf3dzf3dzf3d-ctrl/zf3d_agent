#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
朱峰智能体无限 - 自动/手动升级模块 (updater.py)
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

from util_log import get_logger

log = get_logger('updater')
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
        from config import QUIET_CONSOLE
    except Exception:
        QUIET_CONSOLE = True
    if not QUIET_CONSOLE:
        try:
            log.info('[Updater] ' + msg)
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


# ---------------------------------------------------------------------------
# 【安全收口】升级源白名单：/api/updater/config 可写入任意 repo/branch，若无白名单，
# check/apply 会向任意仓库 git fetch + reset --hard（= 攻击者任意代码执行）。
# 允许：官方源（DEFAULTS 常量）+ 当前仓库 origin 实际指向（fork 用户 origin 指向
# 自己的 fork 仍可升级）；branch 仅允许 main。
# ---------------------------------------------------------------------------
_OFFICIAL_REPOS = frozenset({'zf3dzf3dzf3d-ctrl/zf3d_agent'})
_OFFICIAL_BRANCHES = frozenset({'main'})


def _repo_from_git_url(url):
    """从 git remote URL 提取 owner/repo（支持 https / git@ / .git 后缀）。"""
    try:
        u = str(url or '').strip().rstrip('/')
        if u.endswith('.git'):
            u = u[:-4]
        for sep in ('github.com/', 'gitee.com/', 'github.com:', 'gitee.com:'):
            i = u.find(sep)
            if i >= 0:
                return u[i + len(sep):].strip('/').strip()
    except Exception:
        pass
    return ''


def _allowed_repos():
    """官方源 + 当前 origin 动态提取的仓库。"""
    allowed = set(_OFFICIAL_REPOS)
    try:
        ok, out = _run_git(['remote', 'get-url', 'origin'], timeout=15)
        if ok:
            r = _repo_from_git_url(out)
            if r:
                allowed.add(r)
    except Exception:
        pass
    return allowed


def validate_update_cfg(cfg):
    """校验 cfg 中的 repo/branch 是否在白名单内。返回 None=通过，否则拒绝原因。"""
    try:
        allowed = _allowed_repos()
    except Exception:
        allowed = set(_OFFICIAL_REPOS)
    branch = str(cfg.get('branch') or '').strip()
    if branch and branch not in _OFFICIAL_BRANCHES:
        return ('分支 "%s" 不在允许列表(%s)内，已拒绝升级'
                % (branch, ','.join(sorted(_OFFICIAL_BRANCHES))))
    for t in ('github', 'gitee'):
        repo = str(cfg.get(t + '_repo') or '').strip()
        if repo and repo not in allowed:
            return ('%s 仓库 "%s" 不在允许列表内，已拒绝升级（仅允许官方源与当前 origin 指向的仓库）'
                    % (t, repo))
    return None


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
                           text=True, encoding='utf-8', errors='replace', timeout=timeout,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
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
    # 【安全收口】repo/branch 白名单：配置不在白名单直接拒绝（不向未知仓库发请求）
    _deny = validate_update_cfg(cfg)
    if _deny:
        _log('检查被拒: %s' % _deny)
        return {'ok': False, 'error': _deny, 'local_version': get_local_version()}
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


def _lock_has_hashes(path):
    """锁定文件是否带 sha256。只看文件开头一段：规范生成的锁定文件，第一个条目就带哈希。"""
    try:
        with open(path, 'r', encoding='utf-8', errors='replace') as f:
            return '--hash=sha256:' in f.read(65536).lower()
    except OSError:
        return False


def install_requirements(py_exe, here, run=None):
    """安装/更新依赖。返回给人看的结果消息。

    依赖来源与更新器一直以来的口径相同：server/requirements.lock（有则用），否则
    server/requirements.txt。两者都是跨平台清单。
      - 锁定文件带哈希    → pip install --require-hashes，逐个制品核对官方 SHA-256。
          · 哈希不符       → 就地阻止，绝不退回无哈希安装。镜像被污染、缓存被替换、
                             传输被篡改都会走到这里——退回去等于把这道校验拆掉。
          · 其它失败       → 退回同一份锁定文件的无哈希安装（制品取不到、网络中断之类，
                             与完整性无关），并在结果里写明“本次未能校验哈希”及原因。
      - 锁定文件不带哈希  → 按固定版本安装、不校验，与引入哈希之前的行为一致。
      - 没有锁定文件      → 按 server/requirements.txt 安装，与旧行为一致。

    Windows 正式版自带预装全部依赖的 python/ 目录，不走这一步（见 apply_update 的 embedded 判定）。
    server/requirements.win.lock 是给“用脚本重建内嵌运行时”准备的 Windows 专属锁定，不在这里使用。

    run 参数仅供测试注入（默认 subprocess.run）。"""
    run = run or subprocess.run
    kw = {'capture_output': True, 'text': True, 'timeout': 600,
          'creationflags': getattr(subprocess, 'CREATE_NO_WINDOW', 0)}
    lock = os.path.join(here, 'requirements.lock')
    req = os.path.join(here, 'requirements.txt')
    if os.path.exists(lock) and _lock_has_hashes(lock):
        r = run([py_exe, '-m', 'pip', 'install', '--require-hashes', '-r', lock, '--quiet'], **kw)
        if r.returncode == 0:
            return '依赖已更新（已按锁定文件逐个校验哈希）'
        err = r.stderr or r.stdout or ''
        if 'DO NOT MATCH THE HASHES' in err.upper():
            log.error('[updater] 锁定文件哈希校验失败，已阻止依赖安装: %s' % err[:300])
            return '依赖更新已阻止：安装包哈希与锁定文件不符（server/requirements.lock），详见 updater 日志'
        log.warning('[updater] 锁定文件安装失败（非哈希问题），改用无哈希安装: %s' % err[:300])
        r2 = run([py_exe, '-m', 'pip', 'install', '-r', lock, '--quiet'], **kw)
        if r2.returncode == 0:
            why = (err.strip().splitlines() or [''])[-1][:120]
            return '依赖已更新（本次未能校验哈希：%s）' % (why or '原因未知')
        return '依赖更新警告: %s' % (r2.stderr or '')[:200]
    target = lock if os.path.exists(lock) else req
    r = run([py_exe, '-m', 'pip', 'install', '-r', target, '--quiet'], **kw)
    return '依赖已更新' if r.returncode == 0 else '依赖更新警告: %s' % (r.stderr or '')[:200]


def apply_update(cfg=None):
    """执行升级：stash 本地改动 → fetch → reset 到远程 → 更新依赖(如有) → 重启。"""
    cfg = cfg or load_cfg()
    # 【安全收口】repo/branch 白名单：配置不在白名单直接拒绝应用（不 fetch/reset 未知源）
    _deny = validate_update_cfg(cfg)
    if _deny:
        _log('升级被拒: %s' % _deny)
        return {'ok': False, 'error': _deny}
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
            # 【2026-11-22 保险丝】原行为"stash 失败继续用 reset --hard"等于明抢在途改动；
            # 快照提交是延迟合并的混合提交，未必能兜底。stash 失败必须中止。
            _log('stash 失败，已中止升级: %s' % out)
            return {'ok': False, 'error': '本地改动 stash 失败，为保护在途改动已中止升级: %s' % (out or '')[:200]}

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
    # 【2026-11-22 保险丝】本地领先远程（有未推送提交）时先建备份分支再 reset：
    # reset --hard 会抹掉这些提交的分支指针；留一个 backup 分支随时可找回。
    ok_ahead, out_ahead = _run_git(['rev-list', '--count', 'HEAD', '--not', '--remotes'])
    if ok_ahead and out_ahead.strip().isdigit() and int(out_ahead.strip()) > 0:
        _br = 'backup-before-update-' + time.strftime('%Y%m%d_%H%M%S')
        ok_b, out_b = _run_git(['branch', _br])
        if ok_b:
            _log('本地领先 %s 个提交，已建备份分支 %s' % (out_ahead.strip(), _br))
        else:
            _log('建备份分支失败，中止升级: %s' % out_b)
            return {'ok': False, 'error': '本地有 %s 个未推送提交且备份分支创建失败，已中止升级' % out_ahead.strip()}
    ok, out = _run_git(['reset', '--hard', fetched_ref])
    if not ok:
        return {'ok': False, 'error': 'git reset 失败: %s' % out}
    _log('已同步到 %s' % fetched_ref)

    # 5) 更新依赖（若新版本带 requirements.txt 且非嵌入式 python）
    #    依赖安装走 install_requirements：有 requirements.lock 时强制哈希校验（见该函数说明）。
    pip_msg = ''
    req = os.path.join(_HERE, 'requirements.txt')
    py_exe = sys.executable
    embedded = 'python\\python.exe' in py_exe or 'python311' in py_exe
    if os.path.exists(req) and not embedded:
        try:
            pip_msg = install_requirements(py_exe, _HERE)
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
    log.info(json.dumps(r, ensure_ascii=False, indent=2))
