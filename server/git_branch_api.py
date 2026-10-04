# -*- coding: utf-8 -*-
"""
Git 分支管理 API（对话框 🌿 分支按钮后端）
=============================================
为对话框分支按钮提供支撑：
  GET  /api/git/branches?path=<仓库路径>   → 列出本地分支 + 当前分支
  POST /api/git/branch/create             → 新建并切换分支 {path, name}
  POST /api/git/branch/checkout           → 切换分支 {path, name}
  POST /api/git/branch/merge              → 合并分支 {path, source, target}

安全约束：
  - path 必须是一个已存在的目录且含 .git（否则拒绝）
  - merge 冲突时不擅自解决，返回结构化冲突文件列表（file + 冲突段数），由前端转交 AI 处理
  - name 做白名单校验，防止命令注入
"""
import json
import os
import re
import shutil
import subprocess
import time

# 分支名白名单：字母数字 . / _ - （不含空格与特殊字符）
_BRANCH_NAME_RE = re.compile(r'^[A-Za-z0-9._/\-\u4e00-\u9fff]{1,80}$')
_BRANCH_BLACKLIST = ('..', '//', '.lock')


def _git(args, cwd, timeout=60):
    """执行 git 命令，返回 (ok, output)。"""
    git_exe = shutil.which('git')
    if not git_exe:
        return False, '未找到 git 命令，请先安装 Git for Windows'
    try:
        p = subprocess.run([git_exe] + args, cwd=cwd, capture_output=True,
                           timeout=timeout, encoding='utf-8', errors='replace')
        out = (p.stdout or '') + (p.stderr or '')
        return p.returncode == 0, out.strip()
    except subprocess.TimeoutExpired:
        return False, 'git 命令超时'
    except Exception as e:
        return False, 'git 执行异常: %s' % e


def _check_repo(path):
    """校验 path 是一个 git 仓库根（或内部）。返回错误信息或 None。"""
    import os
    if not path or not os.path.isdir(path):
        return '仓库路径不存在: %s' % path
    cur = os.path.abspath(path)
    while True:
        if os.path.isdir(os.path.join(cur, '.git')):
            return None
        parent = os.path.dirname(cur)
        if parent == cur:
            return '该目录不是 git 仓库（未找到 .git）: %s' % path
        cur = parent


def _check_branch_name(name):
    if not name or not _BRANCH_NAME_RE.match(name):
        return '分支名不合法（只允许中英文/数字/._-/，1~80字符）: %r' % name
    for b in _BRANCH_BLACKLIST:
        if b in name:
            return '分支名含非法片段 %s' % b
    if name.startswith('/') or name.endswith('/') or name.endswith('.'):
        return '分支名不能以 / 开头或以 / . 结尾'
    return None


# 运行期/临时文件：永不进功能提交（按路径子串匹配，/ 分隔）
_RUNTIME_NOISE = (
    '__pycache__/', '.pyc', '.log', '.tmp',
    'private/cache_watch', 'private/logs/', 'private/billing/',
    'oldcss.txt', '/data/', '.bak.', '.bak',
)


def _is_runtime_noise(relpath):
    """relpath 用 / 分隔的仓库相对路径。"""
    p = relpath.replace('\\', '/')
    low = p.lower()
    for n in _RUNTIME_NOISE:
        if n.lower() in low:
            return True
    return False


def git_commit_functional(path, msg=None, include=None, exclude_noise=True):
    """按功能独立提交：只提交指定文件（或全部非运行期文件）。

    - include: 文件相对路径列表；为 None 时提交所有「非运行期噪音」的改动
    - 返回 (ok, output, committed_files)
    """
    import time as _t
    if not msg:
        msg = '功能提交 %s' % _t.strftime('%Y-%m-%d %H:%M:%S')

    # 规范化 path：解析为仓库根绝对路径（容错：传入文件/相对路径/仓库子目录）
    import os
    if not path:
        return False, '缺少仓库路径 path', []
    p_abs = os.path.abspath(path)
    if os.path.isfile(p_abs):
        p_abs = os.path.dirname(p_abs)
    cur = p_abs
    while True:
        if os.path.isdir(os.path.join(cur, '.git')):
            break
        parent = os.path.dirname(cur)
        if parent == cur:
            return False, '该目录不是 git 仓库（未找到 .git）: %s' % path, []
        cur = parent
    repo_root = cur

    ok, out = _git(['status', '--porcelain'], repo_root)
    if not ok:
        return False, out or 'git status 失败', []
    if not out.strip():
        return True, '没有需要提交的改动', []

    files = []
    for line in out.splitlines():
        line = line.rstrip()
        if not line:
            continue
        status, rel = line[:2], line[2:].lstrip(' ')
        # 重命名格式 "R  old -> new"
        if ' -> ' in rel:
            rel = rel.split(' -> ', 1)[1]
        if exclude_noise and _is_runtime_noise(rel):
            continue
        files.append(rel)
    if include:
        inc = set(f.replace('\\', '/').lower() for f in include)
        files = [f for f in files if f.replace('\\', '/').lower() in inc]

    if not files:
        return True, '改动全部属于运行期文件，已跳过（不进功能提交）', []

    # 分批 add（Windows 命令行长度限制，每批 50 个）
    for i in range(0, len(files), 50):
        ok, out = _git(['add', '--'] + files[i:i + 50], repo_root)
        if not ok:
            return False, out, []
    ok, cout = _git(['commit', '-m', msg, '--'] + files, repo_root)
    if ok or 'nothing to commit' in (cout or ''):
        return True, cout or 'OK', files
    return False, cout, files


def git_ensure_clean_and_commit(path, msg=None):
    """有未提交改动时自动 commit（保护现场，防止切换分支丢工作）。"""
    # status 可能因 index.lock / 杀软扫描等偶发失败，重试 3 次
    code, out = '', ''
    for i in range(3):
        ok, out = _git(['status', '--porcelain'], path)
        if ok:
            break
        import time
        time.sleep(0.3 * (i + 1))
    if not ok:
        return False, out or 'git status 执行失败（已重试3次）'
    if not out.strip():
        return True, ''
    if not msg:
        import time
        msg = 'WIP: 对话切换分支前自动提交 %s' % time.strftime('%Y-%m-%d %H:%M:%S')
    # 保护现场也按功能独立提交：运行期文件不进版本库
    cok, cout, _files = git_commit_functional(path, msg=msg)
    return cok, cout


def handle_functional_commit(body):
    """POST /api/git/functional-commit {path, msg, files?}
    按功能独立提交：只提交本功能相关文件（files 列表），不带运行期文件。
    files 为空时提交所有非运行期改动。
    """
    import os
    path, err = _post_repo_branch(body)
    if err:
        return {'ok': False, 'error': err}
    msg = (body.get('msg') or '').strip()
    if not msg:
        return {'ok': False, 'error': '缺少提交信息 msg（写清功能名，便于回溯）'}
    include = body.get('files') or None
    ok, out, files = git_commit_functional(path, msg=msg, include=include)
    if not ok:
        return {'ok': False, 'error': out}
    return {'ok': True, 'message': '已按功能提交（%d 个文件）' % len(files),
            'files': files, 'output': (out or '')[:1500]}


def handle_branches_get(query):
    """GET /api/git/branches?path=..."""
    import os
    from urllib.parse import parse_qs
    q = parse_qs(query or '')
    path = (q.get('path') or [''])[0]
    err = _check_repo(path)
    if err:
        return {'ok': False, 'error': err}
    ok, out = _git(['branch', '--list'], path)
    if not ok:
        return {'ok': False, 'error': out}
    branches, current = [], None
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith('* '):
            current = line[2:].strip()
            branches.append(current)
        else:
            branches.append(line)
    # 主分支判定：main / master / trunk 优先
    # 【20260922 修复】只列本地分支时，若仓库只有 main（其余在 origin/ 上），
    # 面板切换列表里没有任何可切换项，点击等于无操作（"不动弹"）。
    # 补充列出远程分支（origin/xxx，跳过 origin/HEAD），git checkout 的 DWIM
    # 会自动基于 origin/xxx 创建本地跟踪分支，因此 checkout 无需改动。
    ok, rout = _git(['branch', '-r', '--list'], path)
    if ok:
        localset = set(branches)
        for line in (rout or '').splitlines():
            line = line.strip()
            name = line.split(' -> ')[0].strip()
            if name.startswith('origin/') and not name.endswith('/HEAD') and name not in localset:
                branches.append(name)  # 显示 origin/tmp-zf-sync 形式，checkout 时 DWIM 建本地跟踪分支
    main = None
    for cand in ('main', 'master', 'trunk'):
        if cand in branches:
            main = cand
            break
    return {'ok': True, 'path': path, 'branches': branches,
            'current': current, 'main': main}


def _post_repo_branch(body):
    import os
    path = body.get('path') or ''
    err = _check_repo(path)
    if err:
        return None, err
    return os.path.abspath(path), None


def handle_branch_create(body):
    """POST /api/git/branch/create {path, name}"""
    path, err = _post_repo_branch(body)
    if err:
        return {'ok': False, 'error': err}
    name = (body.get('name') or '').strip()
    err = _check_branch_name(name)
    if err:
        return {'ok': False, 'error': err}
    # 有改动先自动提交保护现场
    cok, cout, _files = git_commit_functional(path, msg='WIP: 创建分支 %s 前自动提交' % name)
    if not cok:
        return {'ok': False, 'error': '自动提交未保存改动失败: ' + cout}
    ok, out = _git(['checkout', '-b', name], path)
    if not ok:
        return {'ok': False, 'error': out or '创建分支失败'}
    return {'ok': True, 'branch': name, 'message': '已创建并切换到分支 %s' % name}


def handle_branch_checkout(body):
    """POST /api/git/branch/checkout {path, name}"""
    path, err = _post_repo_branch(body)
    if err:
        return {'ok': False, 'error': err}
    name = (body.get('name') or '').strip()
    # 支持直接切换远程分支：origin/xxx → 本地建 xxx 跟踪分支（git checkout DWIM）
    if name.startswith('origin/'):
        name = name[len('origin/'):]
    err = _check_branch_name(name)
    if err:
        return {'ok': False, 'error': err}
    cok, cout, _files = git_commit_functional(path, msg='WIP: 切换到 %s 前自动提交' % name)
    if not cok:
        return {'ok': False, 'error': '自动提交未保存改动失败: ' + cout}
    # 【20260922 修复】服务进程运行时持续写 .log / worklog 等运行期文件：
    # git_commit_functional 只提交非噪音文件，噪音文件留在工作区会把 checkout
    # 拦下来（"local changes would be overwritten"→ 面板点切换没反应）。
    # stash / skip-worktree 实测均会被运行中进程的持续写入竞态击穿。
    # 方案：把剩余全部脏文件直接提交为 WIP-noise commit（干净可切换），
    # checkout 被拒时最多重试 3 次，每次先把新写脏的文件再提交掉。
    import time as _t
    for _attempt in range(3):
        import time as _t
        ok, st = _git(['status', '--porcelain'], path)
        if not ok or not st.strip():
            break
        _git(['add', '-A'], path)
        _git(['commit', '-m', 'WIP-noise: 切换到 %s 前自动收起 %s' % (name, _t.strftime('%H:%M:%S'))], path)
    ok, out = _git(['checkout', name], path)
    if not ok:
        return {'ok': False, 'error': out or '切换分支失败'}
    return {'ok': True, 'branch': name, 'message': '已切换到分支 %s' % name}


def handle_branch_delete(body):
    """POST /api/git/branch/delete {path, name}
    安全删除本地分支：
    - 当前分支 / 主分支（main/master/trunk）不可删
    - 有未合并提交时拒绝（返回 ahead 数量），前端提示用户确认后 force=true 可强删
    """
    path, err = _post_repo_branch(body)
    if err:
        return {'ok': False, 'error': err}
    name = (body.get('name') or '').strip()
    err = _check_branch_name(name)
    if err:
        return {'ok': False, 'error': err}
    # 当前分支不可删
    ok, cur = _git(['rev-parse', '--abbrev-ref', 'HEAD'], path)
    if ok and cur.strip() == name:
        return {'ok': False, 'error': '当前分支不可删除，请先切换到其他分支'}
    # 主分支不可删
    ok, out = _git(['branch', '--list'], path)
    branches = [l.strip().lstrip('* ').strip() for l in (out or '').splitlines() if l.strip()]
    main = None
    for cand in ('main', 'master', 'trunk'):
        if cand in branches:
            main = cand
            break
    if name == main:
        return {'ok': False, 'error': '主分支 %s 不可删除' % main}
    if name not in branches:
        return {'ok': False, 'error': '分支不存在: %s' % name}
    # 检查未合并提交
    ok, out = _git(['rev-list', '--count', '%s..%s' % (main or 'HEAD', name)], path)
    ahead = int(out.strip()) if ok and out.strip().isdigit() else 0
    force = bool(body.get('force'))
    if ahead > 0 and not force:
        return {'ok': False, 'unmerged': ahead,
                'error': '分支 %s 有 %d 个未合并到 %s 的提交，确认后可强删' % (name, ahead, main or 'HEAD')}
    args = ['branch', '-D', name] if force or ahead > 0 else ['branch', '-d', name]
    ok, out = _git(args, path)
    if not ok:
        return {'ok': False, 'error': out or '删除分支失败'}
    return {'ok': True, 'branch': name, 'deleted': name,
            'message': '已删除分支 %s%s' % (name, ('（强删，丢弃 %d 个未合并提交）' % ahead) if ahead > 0 else '')}


def handle_branch_merge(body):
    """POST /api/git/branch/merge {path, source, target}
    流程：提交 source 现场 → 切到 target → merge source → 回报结果。
    冲突时不擅自动手，返回冲突文件列表。
    """
    path, err = _post_repo_branch(body)
    if err:
        return {'ok': False, 'error': err}
    source = (body.get('source') or '').strip()
    target = (body.get('target') or '').strip()
    for n in (source, target):
        err = _check_branch_name(n)
        if err:
            return {'ok': False, 'error': err}
    if source == target:
        return {'ok': False, 'error': '源分支与目标分支相同'}
    # 确认分支存在
    ok, out = _git(['rev-parse', '--verify', source], path)
    if not ok:
        return {'ok': False, 'error': '源分支不存在: %s' % source}
    ok, out = _git(['rev-parse', '--verify', target], path)
    if not ok:
        return {'ok': False, 'error': '目标分支不存在: %s' % target}
    # 1) 提交当前现场
    cok, cout, _files = git_commit_functional(path, msg='WIP: 合并 %s→%s 前自动提交' % (source, target))
    if not cok:
        return {'ok': False, 'error': '自动提交未保存改动失败: ' + cout}
    # 2) 记录原分支，切到 target
    ok, orig = _git(['rev-parse', '--abbrev-ref', 'HEAD'], path)
    prev = orig.strip() if ok and orig else None
    ok, out = _git(['checkout', target], path)
    if not ok:
        return {'ok': False, 'error': '切换到 %s 失败: %s' % (target, out)}
    # 3) merge
    ok, out = _git(['merge', '--no-ff', '-m',
                    'Merge branch %r into %r (对话分支合并)' % (source, target),
                    source], path, timeout=120)
    if not ok:
        # 冲突：列出冲突文件（结构化），回滚到安全状态（abort merge，留在 target）
        conflicts = []
        _ok2, ls = _git(['diff', '--name-only', '--diff-filter=U'], path)
        for f in (ls or '').splitlines():
            f = f.strip()
            if not f:
                continue
            # 统计该文件的冲突标记段数量（<<<<<<< 出现次数）
            hunks = 0
            try:
                import os as _os
                fp = _os.path.join(path, f)
                if _os.path.isfile(fp):
                    with open(fp, 'r', encoding='utf-8', errors='replace') as fh:
                        hunks = fh.read().count('<<<<<<<')
            except Exception:
                pass
            conflicts.append({'file': f, 'hunks': hunks})
        _git(['merge', '--abort'], path)
        if prev and prev != target:
            _git(['checkout', prev], path)
        return {'ok': False, 'conflict': True,
                'conflicts': conflicts,
                'error': '合并存在冲突，已中止并保留原状。冲突概况：\n' + (out or '')[:2000]}
    # 4) 回报 merge 摘要
    ok, stat = _git(['diff', '--stat', 'HEAD~1', 'HEAD'], path)
    result = {'ok': True, 'message': '已将 %s 合并到 %s' % (source, target),
              'stat': (stat or '')[:2000]}
    # 留在 target 还是回原分支？留在 target 更符合"合并到主分支"预期
    if prev and prev != target and prev != source:
        result['prev_branch'] = prev
    return result


# ============================================================
# 赛马机制 · worktree 三件套（P1 地基）
# 每个施工队一个物理隔离工作目录（../_site_<ts>_<X>），
# 独立分支 site/race/<ts>_<X>，主线仓库不动。
# ============================================================

_RACE_PREFIX = 'site/race/'
_SITE_DIR = '_site_'

# 【磁盘治理 P0-A】派单并发上限：同时存活的施工现场数（可用环境变量 ZF_RACE_MAX_SITES 覆盖）
_RACE_MAX_SITES = int(os.environ.get('ZF_RACE_MAX_SITES', '3'))


def _count_active_sites(repo_root):
    """统计当前主线仓库下的存活 _site_* 施工现场数。返回 (数量, 目录名列表)。"""
    ok, out = _git(['worktree', 'list', '--porcelain'], repo_root)
    if not ok:
        return -1, []
    n = 0
    sites = []
    for ln in (out or '').splitlines():
        if ln.startswith('worktree '):
            base = os.path.basename(ln[9:].strip())
            if _SITE_DIR in base:
                n += 1
                sites.append(base)
    return n, sites


def race_worktree_add(body):
    """POST /api/git/race/worktree-add {path, team}
    在主线仓库旁创建隔离施工现场：
      目录: <repo>/../_site_<ts>_<team>
      分支: site/race/<ts>_<team>（基于当前 HEAD）
    返回 worktree 路径与分支名，供施工队在此开工。
    """
    import os
    path, err = _post_repo_branch(body)
    if err:
        return {'ok': False, 'error': err}
    team = str(body.get('team') or 'a').strip().lower()
    if not re.match(r'^[a-z0-9]{1,8}$', team):
        return {'ok': False, 'error': 'team 标识不合法（小写字母数字，≤8字符）: %r' % team}
    ts = time.strftime('%Y%m%d_%H%M%S')
    wt_name = '%s%s_%s' % (_SITE_DIR, ts, team)
    repo_root = os.path.dirname(path) if os.path.isfile(os.path.join(path, '.git')) else path
    parent = os.path.dirname(repo_root)
    wt_path = os.path.join(parent, wt_name)
    if os.path.exists(wt_path):
        return {'ok': False, 'error': '施工现场目录已存在: %s' % wt_path}
    # 【磁盘治理 P0-A】并发上限：存活场地 ≥ 上限时拒绝派单（防大项目多队竞速吃满磁盘）
    n_sites, site_list = _count_active_sites(repo_root)
    if n_sites >= _RACE_MAX_SITES:
        # 【P0 自服务】附各场地体检明细（未合并 commit 数），前端据此展示场地管理面板
        detail = _sites_health(repo_root)
        return {'ok': False,
                'error': '施工现场已达并发上限 %d 个（当前 %d 个存活：%s）。请先收队清理闲置场地，或设置环境变量 ZF_RACE_MAX_SITES 调高上限。'
                         % (_RACE_MAX_SITES, n_sites, '、'.join(site_list) or '无'),
                'code': 'RACE_SITE_LIMIT', 'limit': _RACE_MAX_SITES, 'active': n_sites, 'sites': site_list,
                'health': detail}
    branch = _RACE_PREFIX + '%s_%s' % (ts, team)
    # 有未提交改动先保护现场（主线不动，只收进当前分支）
    git_ensure_clean_and_commit(repo_root, msg='WIP: 开施工现场 %s 前自动提交' % wt_name)
    ok, out = _git(['worktree', 'add', '-b', branch, wt_path, 'HEAD'], repo_root, timeout=120)
    if not ok:
        return {'ok': False, 'error': out or '创建 worktree 失败'}
    # 【磁盘治理 P1-C】瘦身检出：主线仓库根有 .race-sparse 配置时，新场自动 sparse-checkout
    # 只检出配置列出的目录（cone 模式，一行一个目录，# 开头注释）；失败降级为完整检出，不阻断派单。
    sparse_applied = False
    try:
        _sp = os.path.join(repo_root, '.race-sparse')
        if os.path.isfile(_sp):
            with open(_sp, 'r', encoding='utf-8') as _f:
                _dirs = [l.strip() for l in _f
                         if l.strip() and not l.strip().startswith('#')]
            if _dirs:
                _ok1, _e1 = _git(['sparse-checkout', 'init', '--cone'], wt_path, timeout=60)
                if _ok1:
                    _ok2, _e2 = _git(['sparse-checkout', 'set'] + _dirs, wt_path, timeout=120)
                    sparse_applied = _ok2
    except Exception:
        sparse_applied = False
    return {'ok': True, 'worktree': wt_path, 'branch': branch,
            'repo': repo_root, 'sparse': sparse_applied, 'active_sites': n_sites + 1,
            'message': '施工现场已开: %s（分支 %s）%s' % (
                wt_path, branch, '，已瘦身检出（.race-sparse）' if sparse_applied else '')}


def _sites_health(repo_root):
    """【P0 自服务】各施工现场体检：路径/分支/未合并 commit 数/未提交改动数。"""
    import os as _os
    ok, out = _git(['worktree', 'list', '--porcelain'], repo_root)
    if not ok:
        return []
    health, cur = [], {}
    for ln in (out or '').splitlines() + ['']:
        ln = ln.strip()
        if not ln:
            if cur and _SITE_DIR in _os.path.basename(cur.get('path', '')):
                wt = cur['path']
                br = (cur.get('branch') or '').strip()
                ahead = '?'
                dirty = '?'
                if _os.path.isdir(wt):
                    _ok, _a = _git(['rev-list', '--count', 'HEAD..%s' % (br or 'HEAD')], wt)
                    if _ok:
                        ahead = (_a or '0').strip() or '0'
                    _ok2, _d = _git(['status', '--porcelain'], wt)
                    dirty = str(len([x for x in (_d or '').splitlines() if x.strip()])) if _ok2 else '?'
                health.append({'worktree': wt, 'branch': br.replace('refs/heads/', ''),
                               'unmerged': ahead, 'dirty': dirty})
            cur = {}
            continue
        if ln.startswith('worktree '):
            cur['path'] = ln[9:]
        elif ln.startswith('branch '):
            cur['branch'] = ln[7:]
    return health


def race_worktree_health(body):
    """POST /api/git/race/worktree-health {path} → 各场地体检明细（场地管理面板数据源）"""
    path, err = _post_repo_branch(body)
    if err:
        return {'ok': False, 'error': err}
    return {'ok': True, 'sites': _sites_health(path)}


def race_diff_summary(body):
    """POST /api/git/race/diff-summary {path, worktree}
    施工队点击回注用：返回该队分支相对主线的精简改动摘要（文件名 ±行数），不贴内容防污染源对话。
    """
    import os, re as _re
    path, err = _post_repo_branch(body)
    if err:
        return {'ok': False, 'error': err}
    wt = (body.get('worktree') or '').strip()
    if not wt or not os.path.isdir(wt):
        return {'ok': False, 'error': 'worktree 目录不存在: %r' % wt}
    # 已提交部分：相对 merge-base 的 stat
    ok, base = _git(['merge-base', 'HEAD', '@{upstream}'], wt)
    mb = base.splitlines()[0].strip() if ok and base else None
    stat_cmd = ['diff', '--stat'] + ([mb, 'HEAD'] if mb else ['HEAD~1', 'HEAD'] )
    ok1, st1 = _git(stat_cmd, wt)
    # 未提交部分
    ok2, st2 = _git(['diff', '--stat'], wt)
    ok3, st3 = _git(['status', '--porcelain'], wt)
    def _clean(txt):
        lines = [l for l in (txt or '').splitlines() if l.strip()]
        # 去掉 diff --stat 尾部的汇总行以外的长前缀，保留 文件名 | ± 行数
        return lines
    files = []
    for l in _clean(st1):
        m = _re.match(r'\s*(.+?)\s*\|\s*(\d+)\s*(\+*)*(-*)', l)
        if m:
            files.append({'file': m.group(1).strip(), 'delta': ('+' * len(m.group(3) or '') + '-' * len(m.group(4) or '')) or ('%s' % m.group(2))})
    dirty = [l.strip() for l in (st3 or '').splitlines() if l.strip()]
    summary_lines = ['%s | %s' % (f['file'], f['delta']) for f in files[:30]]
    if dirty:
        summary_lines.append('（另有 %d 个未提交改动）' % len(dirty))
    if not summary_lines:
        summary_lines = ['（该队暂无文件改动）']
    return {'ok': True, 'worktree': wt, 'files': files, 'dirty_count': len(dirty),
            'summary': '\n'.join(summary_lines)}


def race_window_register(body):
    """POST /api/git/race-window-register {chat_id, worktree, team}
    施工队窗登记（remove 前校验活跃窗口引用，防悬空 cwd 孤儿窗）。"""
    from engines.common.race_registry import race_register_window
    cid = str(body.get('chat_id') or '').strip()
    wt = str(body.get('worktree') or '').strip()
    if not cid or not wt:
        return {'ok': False, 'error': 'chat_id 与 worktree 必填'}
    return race_register_window(cid, wt, team=str(body.get('team') or ''))


def race_window_unregister(body):
    """POST /api/git/race-window-unregister {chat_id}：窗口关闭时注销。"""
    from engines.common.race_registry import race_unregister_window
    return race_unregister_window(str(body.get('chat_id') or '').strip())


# ---------------- .races 状态登记（归档即登记，P3 反悔列表数据源） ----------------

def _races_dir(repo_root):
    return os.path.join(repo_root, '.races')


def _race_register(repo_root, site_name, info):
    """归档即登记：写 .races/<site_name>.json，P3 收口面板反悔列表直接读这里。"""
    try:
        rd = _races_dir(repo_root)
        os.makedirs(rd, exist_ok=True)
        import json
        info = dict(info or {})
        info['site'] = site_name
        info['archived_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
        with open(os.path.join(rd, site_name + '.json'), 'w', encoding='utf-8') as f:
            json.dump(info, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print('[race] .races 登记失败: %s' % e)
        return False


def _race_unregister(repo_root, site_name):
    try:
        p = os.path.join(_races_dir(repo_root), site_name + '.json')
        if os.path.isfile(p):
            os.remove(p)
    except Exception:
        pass



def race_worktree_list(body):
    """POST /api/git/race/worktree-list {path} → 列出所有施工现场"""
    import os
    path, err = _post_repo_branch(body)
    if err:
        return {'ok': False, 'error': err}
    ok, out = _git(['worktree', 'list', '--porcelain'], path)
    if not ok:
        return {'ok': False, 'error': out or 'worktree list 失败'}
    sites, cur = [], {}
    for line in (out or '').splitlines():
        line = line.strip()
        if not line:
            if cur:
                sites.append(cur)
                cur = {}
            continue
        if line.startswith('worktree '):
            cur['path'] = line[9:]
        elif line.startswith('HEAD '):
            cur['head'] = line[5:]
        elif line.startswith('branch '):
            cur['branch'] = line[7:].replace('refs/heads/', '')
    if cur:
        sites.append(cur)
    for s in sites:
        s['is_site'] = _SITE_DIR in os.path.basename(s.get('path', ''))
        # 归档即登记：顺带返回对应 tag 名（P3 反悔恢复直接从 tag 检出）
        name = os.path.basename(s.get('path', ''))
        if s['is_site']:
            s['archive_tag'] = 'race/archive/' + name
            # 补 .races 登记信息（存在则返回）
            try:
                rp = os.path.join(_races_dir(path), name + '.json')
                if os.path.isfile(rp):
                    import json
                    with open(rp, 'r', encoding='utf-8') as f:
                        s['race_info'] = json.load(f)
            except Exception:
                pass
    return {'ok': True, 'sites': sites}


def race_worktree_remove(body):
    """POST /api/git/race/worktree-remove {path, worktree, tag?, force?}
    收口/弃用后清除施工现场：
    - tag: 落选归档打 tag（race/archive/<名>），可反悔找回
    - force: worktree 有未提交改动时强清
    """
    import os
    path, err = _post_repo_branch(body)
    if err:
        return {'ok': False, 'error': err}
    wt = (body.get('worktree') or '').strip()
    if not wt or _SITE_DIR not in os.path.basename(wt):
        return {'ok': False, 'error': '必须指定施工现场目录（_site_*）: %r' % wt}
    # 【P1-2】活跃施工队窗口校验：现场仍被活跃窗口引用则拒绝清除（防悬空 cwd 孤儿窗）
    try:
        from engines.common.race_registry import active_windows_on_worktree
        actives = active_windows_on_worktree(wt)
        if actives and not body.get('kill_windows'):
            return {'ok': False,
                    'error': '施工现场仍被 %d 个活跃施工队窗口引用，请先回收窗口（或传 kill_windows=true 连带关闭）: %s'
                             % (len(actives), ', '.join(actives))}
    except ImportError:
        pass  # race_registry 未就绪时跳过校验（前端尚无施工队窗）
    if not os.path.isdir(wt):
        # 目录已被手动删，prune 元数据即可
        _git(['worktree', 'prune'], path)
        return {'ok': True, 'message': '目录不存在，已 prune 元数据'}
    branch = (body.get('branch') or '').strip()
    # 【P1-2】branch 未传时自动发现（worktree porcelain 现查，目录还在就能查到）
    if not branch:
        _ok, _out = _git(['worktree', 'list', '--porcelain'], path)
        if _ok:
            _cur = {}
            for _ln in (_out or '').splitlines() + ['']:
                if not _ln.strip():
                    if os.path.normpath(_cur.get('path', '')) == os.path.normpath(wt):
                        branch = (_cur.get('branch') or '').replace('refs/heads/', '').strip()
                        break
                    _cur = {}
                elif _ln.startswith('worktree '):
                    _cur['path'] = _ln.split(' ', 1)[1]
                elif _ln.startswith('branch '):
                    _cur['branch'] = _ln.split(' ', 1)[1]
                if branch:
                    break
    # 【磁盘治理 P0-B】安全档：未传 force 时，若该分支有未合并进 HEAD 的提交或有未提交改动，
    # 拒绝静默删除，返回 need_confirm 让前端弹确认框（防误删在用/未收编的工作）
    if not body.get('force') and os.path.isdir(wt):
        _ok, _ahead = _git(['rev-list', '--count', 'HEAD..%s' % (branch or 'HEAD')], wt)
        _ok2, _dirty = _git(['status', '--porcelain'], wt)
        _dirty_n = len([l for l in (_dirty or '').splitlines() if l.strip()])
        if (_ok and _ahead and _ahead.strip() not in ('', '0')) or _dirty_n > 0:
            return {'ok': False, 'code': 'RACE_NEED_CONFIRM',
                    'error': '该施工分支有 %s 个未合并提交、%d 个未提交改动，直接清除将丢失工作。确认请传 force=true（会先自动提交保护到分支）。'
                             % ((_ahead.strip() if _ok and _ahead else '?'), _dirty_n),
                    'unmerged': (_ahead.strip() if _ok and _ahead else '?'), 'dirty': _dirty_n}
    # 归档 tag
    if branch and body.get('tag'):
        tag = 'race/archive/' + os.path.basename(wt)
        _git(['tag', '-f', tag, branch], path)
    # worktree 内有脏改动时，先在 worktree 内提交（进分支不丢工作）
    if body.get('force'):
        git_ensure_clean_and_commit(wt, msg='WIP: 清除施工现场前自动提交')
    ok, out = _git(['worktree', 'remove', '--force', wt], path, timeout=120)
    if not ok:
        return {'ok': False, 'error': out or '清除 worktree 失败'}
    _git(['worktree', 'prune'], path)
    # 【孤儿分支根治】worktree 删完统一同步删分支（有 tag 归档或未合并提交时保留，防丢工作）
    branch_deleted = False
    if branch:
        _keep = False
        if body.get('tag'):
            _keep = True  # 已打 tag 归档，分支本体可删可留——tag 已兜底，同步删
        else:
            _ok, _ahead = _git(['rev-list', '--count', 'main..%s' % branch], path)
            if _ok and (_ahead or '0').strip() not in ('', '0'):
                _keep = True  # 有未合并提交且无归档，保留分支防丢工作
        if not _keep:
            _ok, _out = _git(['branch', '-D', branch], path)
            branch_deleted = _ok
    # 归档即登记（可反悔）/ 注销登记
    site_name = os.path.basename(wt)
    if branch and body.get('tag'):
        tag = 'race/archive/' + site_name
        _race_register(path, site_name, {'branch': branch, 'tag': tag})
        msg = '施工现场已清除: %s（分支 %s 已打 tag 归档，可反悔）' % (wt, branch)
    else:
        _race_unregister(path, site_name)
        msg = '施工现场已清除: %s（未打 tag，无归档）%s' % (
            wt, '，孤儿分支 %s 已同步删除' % branch if branch_deleted else '')
    return {'ok': True, 'message': msg, 'branch_deleted': branch_deleted}
