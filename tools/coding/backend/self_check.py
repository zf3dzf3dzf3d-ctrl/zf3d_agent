#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""self_check - AI 轻量自验收（git 双快照对比）

设计（2026-09-09 用户提出；2026-09-10 升级为逐文件 +/- 明细）：
  用户提问时打一次 git 快照（起点），任务终止时再打一次（终点），
  两快照必有差距。AI 收尾时对比两快照：
    - 无差距   → 「无改动交付」提示（纯问答/无文件任务属正常；
                 若声称改了文件却无差距 = 改动未落盘，立即暴露）
    - 有差距   → 输出提交数 + 逐文件改动明细（每个文件 +插入/-删除 行数、
                 新建/删除状态），作为轻验收依据， humans 可直接核对
    - 非 git 仓库 → 降级提示（不阻塞交付）

注册表：private/agent_steps/self_check_registry.json（软件根目录下）
  { chatId: {project, startCommit, startedAt} }   ← start 写入，finish 取走删除
  支持多会话并发、会话与项目路径解耦（finish 无需再传路径）。

HTTP 端点（api_dispatch_post.py → mixin_settings.py → 本模块）：
  POST /api/self-check/start  {chatId, path}     → 打起点快照
  POST /api/self-check/finish {chatId}           → 打终点快照 + 对比，返回差距摘要

安全：仓库根取 ToolContext.project_dir（请求体 _project_path 经校验，
非法路径回退软件根目录 BASE_DIR），不接受任意路径。
"""
import os
import json
import subprocess
import time

# 软件根目录（tools/coding/backend/self_check.py → 上溯 4 级到发布版根目录）
_BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
STATE_DIR = os.path.join('private', 'agent_steps')
REGISTRY_FILE = 'self_check_registry.json'
_REG_MAX = 20
_DETAIL_MAX_FILES = 15   # 明细最多列出多少个文件，超出折叠

_CREATE_FLAGS = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


def _registry_path():
    return os.path.join(_BASE, STATE_DIR, REGISTRY_FILE)


def _load_registry():
    p = _registry_path()
    try:
        with open(p, 'r', encoding='utf-8') as f:
            d = json.load(f)
            return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _save_registry(reg, err_out=None):
    d = os.path.dirname(_registry_path())
    try:
        os.makedirs(d, exist_ok=True)
        # 上限保护：超出则先丢最旧条目（dict 保序，先插即先旧）
        while len(reg) > _REG_MAX:
            k = next(iter(reg))
            reg.pop(k, None)
        with open(_registry_path(), 'w', encoding='utf-8') as f:
            json.dump(reg, f, ensure_ascii=False, indent=2)
    except Exception as e:
        if err_out is not None:
            err_out.append('_save_registry: ' + repr(e))


def _git(path, args):
    """执行 git 命令，返回 (exit_code, stdout, stderr)。"""
    cmd = ['git'] + list(args)
    try:
        r = subprocess.run(cmd, cwd=path, capture_output=True, text=True,
                           encoding='utf-8', errors='replace',
                           creationflags=_CREATE_FLAGS)
        return r.returncode, (r.stdout or '').strip(), (r.stderr or '').strip()
    except FileNotFoundError:
        return -1, '', 'git not found'


def _is_repo(path):
    code, _, _ = _git(path, ['rev-parse', '--is-inside-work-tree'])
    return code == 0


def _take_snapshot(path, pending_names=None):
    """打快照：git add -A + commit。返回 commit_hash or None。

    【2026-09-10 延迟合并提交】终点快照（pending_names 非空）时，把本轮
    write 工具暂存攒下的改动一次性提交，提交信息带文件名；同时写
    steps.jsonl 记账（供撤销本步使用）。
    """
    _git(path, ['add', '-A'])
    if pending_names:
        names = ', '.join(pending_names[:4])
        if len(pending_names) > 4:
            names += ' 等%d个' % len(pending_names)
        msg = '[auto-checkpoint] 修改 %s @ %s' % (names, time.strftime('%Y-%m-%d %H:%M:%S'))
    else:
        msg = '[self-checkpoint] ' + time.strftime('%Y-%m-%d %H:%M:%S')
    code, _, _ = _git(path, ['commit', '-m', msg, '--allow-empty', '-q'])
    if code != 0:
        return None
    code2, out2, _ = _git(path, ['rev-parse', '--short', 'HEAD'])
    commit = (out2 if code2 == 0 else None)
    # 写步骤日志（仅延迟合并提交时；起点快照保持原有行为不记账）
    if pending_names and commit:
        try:
            from tools.coding.backend.git_save_step import _next_step, _steps_path
            step_no = _next_step(path)
            record = {
                'step': step_no,
                'message': msg,
                'commit': commit,
                'nothing_to_commit': False,
                'time': time.strftime('%Y-%m-%d %H:%M:%S'),
                'auto': True
            }
            log_path = _steps_path(path)
            os.makedirs(os.path.dirname(log_path), exist_ok=True)
            with open(log_path, 'a', encoding='utf-8') as f:
                import json as _json
                f.write(_json.dumps(record, ensure_ascii=False) + '\n')
        except Exception:
            pass
    return commit


def _numstat_detail(path, *rev_args):
    """git diff --numstat 逐文件解析。

    返回明细列表 [{'file': 路径, 'ins': +行, 'del': -行, 'status': 状态}]，
    状态：新建/删除/修改/二进制（二进制文件行数记 0，状态标 二进制）。
    """
    code, out, _ = _git(path, ['diff', '--numstat'] + list(rev_args))
    detail = []
    if code == 0 and out.strip():
        for ln in out.splitlines():
            parts = ln.split('\t')
            if len(parts) >= 3:
                a, b, name = parts[0].strip(), parts[1].strip(), parts[2].strip()
                bin_file = (a == '-' or b == '-')
                try:
                    ins = 0 if a == '-' else int(a)
                except ValueError:
                    ins, bin_file = 0, True
                try:
                    dele = 0 if b == '-' else int(b)
                except ValueError:
                    dele, bin_file = 0, True
                if bin_file:
                    status = '二进制'
                elif ins > 0 and dele == 0:
                    status = '新建'
                elif dele > 0 and ins == 0:
                    status = '删除'
                else:
                    status = ''   # 普通修改不标注，人看到 +/- 即懂
                detail.append({'file': name, 'ins': ins, 'del': dele, 'status': status})
    return detail


def _numstat(path, *rev_args):
    """兼容包装：返回 (文件名列表, 插入总行, 删除总行)。"""
    detail = _numstat_detail(path, *rev_args)
    files = [d['file'] for d in detail]
    return files, sum(d['ins'] for d in detail), sum(d['del'] for d in detail)


def _fmt_detail(detail):
    """把逐文件明细渲染成 Markdown 表格（每文件一行：路径 | 状态 | ±行数）。

    行数列合并为一列「+X -Y」右对齐（`---:`），+ 染绿 / - 染红；
    +0 / -0 直接不输出（纯新增只显 +N，纯删除只显 -N，全零显空），
    状态列只标 新建/删除/二进制，普通修改留空（人看到 +/- 即懂）。
    非 Markdown 场景（纯文本日志）表格行也仍可读。
    """
    lines = []
    show = detail[:_DETAIL_MAX_FILES]
    for d in show:
        stat = (' ' + d['status']) if d['status'] else ''
        nums = []
        if d['ins'] > 0:
            nums.append('`+%d`' % d['ins'])
        if d['del'] > 0:
            nums.append('`-%d`' % d['del'])
        lines.append('| `%s` |%s | %s |' % (d['file'], stat, ' '.join(nums)))
    rest = len(detail) - len(show)
    if rest > 0:
        lines.append('| …（其余 %d 个文件未列出） | | |' % rest)
    return lines


def _commit_count_between(path, c1, c2):
    code, out, _ = _git(path, ['rev-list', '--count', c1 + '..' + c2])
    if code == 0 and out.strip().isdigit():
        return int(out.strip())
    return 0


def _start_impl(chat_id, project_dir, err_out=None):
    """打起点快照并登记注册表。"""
    if not _is_repo(project_dir):
        return {'ok': False, 'mode': 'no-git', 'message': '非 git 仓库，跳过起点快照'}
    start_commit = _take_snapshot(project_dir)
    if not start_commit:
        return {'ok': False, 'mode': 'git-error', 'message': '起点快照失败（git commit 异常）'}
    reg = _load_registry()
    reg[str(chat_id or '_default')] = {
        'project': project_dir,
        'startCommit': start_commit,
        'startedAt': time.strftime('%Y-%m-%d %H:%M:%S'),
    }
    _save_registry(reg, err_out)
    if err_out:
        return {'ok': False, 'mode': 'registry-save-failed', 'message': '起点快照成功但注册表写入失败: ' + '; '.join(err_out)}
    return {'ok': True, 'mode': 'git', 'startCommit': start_commit, 'project': project_dir}


def _finish_impl(chat_id, fallback_project):
    """打终点快照 + 与起点对比，返回轻验收结论（含逐文件 +/- 明细）。"""
    reg = _load_registry()
    key = str(chat_id or '_default')
    entry = reg.pop(key, None) or reg.pop('_default', None)
    _save_registry(reg)

    project_dir = (entry or {}).get('project') or fallback_project or _BASE
    if not os.path.isdir(project_dir):
        return {'ok': False, 'mode': 'error', 'message': '项目路径不存在: ' + str(project_dir)}
    if not _is_repo(project_dir):
        return {'ok': False, 'mode': 'no-git',
                'message': '⚠ 项目不是 git 仓库（或 git 不可用），跳过 AI 轻量自验收。'}

    # 取走本轮 write 攒下的待提交文件清单，终点快照一次性合并提交
    try:
        from tools.coding.backend.git_save_step import pending_take
        pending_names = pending_take(project_dir)
    except Exception:
        pending_names = []
    end_commit = _take_snapshot(project_dir, pending_names=pending_names or None)
    if not end_commit:
        return {'ok': False, 'mode': 'git-error', 'message': '终点快照失败（git commit 异常），跳过自验收。'}

    start_commit = (entry or {}).get('startCommit')

    # 无起点快照（服务重启/注册表丢失）：按工作区相对 HEAD 降级判断
    if not start_commit:
        detail = _numstat_detail(project_dir, 'HEAD')
        nf = len(detail)
        if nf == 0:
            msg = 'ℹ 轻验收：无起点快照可比（状态丢失），当前工作区相对 HEAD 无改动，按无改动交付处理。'
            return {'ok': True, 'mode': 'no-start', 'changedFiles': 0, 'insertions': 0,
                    'deletions': 0, 'changedList': [], 'detail': [], 'message': msg}
        ins = sum(d['ins'] for d in detail)
        dele = sum(d['del'] for d in detail)
        lines = ['⚠ 轻验收：无起点快照可比（状态丢失），但工作区相对 HEAD 有 %d 个文件改动（+%d/-%d 行），请确认确属本任务再交付：'
                 % (nf, ins, dele), '',
                 '| 文件 | 状态 | 行数 |',
                 '| --- | --- | ---: |']
        lines += _fmt_detail(detail)
        msg = '\n'.join(lines)
        return {'ok': True, 'mode': 'no-start', 'changedFiles': nf, 'insertions': ins,
                'deletions': dele,
                'changedList': [d['file'] for d in detail[:30]],
                'detail': detail[:30], 'message': msg}

    # 正常双快照对比：起点 → 终点
    n_commits = _commit_count_between(project_dir, start_commit, end_commit)
    detail = _numstat_detail(project_dir, start_commit, end_commit)
    nd = len(detail)
    d_ins = sum(d['ins'] for d in detail)
    d_del = sum(d['del'] for d in detail)

    if nd == 0:
        msg = ('ℹ 轻验收：起点→终点无 git 差距（0 文件改动）。若本任务为纯问答/无文件交付属正常；'
               '若声称改了文件但无差距，说明改动未落盘，请立即检查。')
        return {'ok': True, 'mode': 'no-change', 'startCommit': start_commit,
                'endCommit': end_commit, 'commits': n_commits,
                'changedFiles': 0, 'insertions': 0, 'deletions': 0,
                'changedList': [], 'detail': [], 'message': msg}

    head = ('✅ 轻验收通过：问题→答案 共 %d 个提交，改动 %d 个文件，合计 +%d/-%d 行'
            % (n_commits, nd, d_ins, d_del))
    lines = [head, '',
             '| 文件 | 状态 | 行数 |',
             '| --- | --- | ---: |'] + _fmt_detail(detail)
    msg = '\n'.join(lines)
    lst = [d['file'] for d in detail[:20]]
    return {'ok': True, 'mode': 'changed', 'startCommit': start_commit, 'endCommit': end_commit,
            'commits': n_commits, 'changedFiles': nd, 'insertions': d_ins,
            'deletions': d_del, 'changedList': lst, 'detail': detail[:30], 'message': msg}


def handle(body, ctx):
    """统一入口：body.action = 'start' | 'finish'（默认 finish）"""
    try:
        body = body or {}
        action = str(body.get('action') or 'finish').strip().lower()
        chat_id = str(body.get('chatId') or '')
        project_dir = getattr(ctx, 'project_dir', None) or _BASE
        if action == 'start':
            if not os.path.isdir(project_dir):
                ctx.send_error('项目路径不存在: ' + str(project_dir))
                return
            errs = []
            r = _start_impl(chat_id, project_dir, errs)
            ctx.send_json(r)
        else:
            ctx.send_json(_finish_impl(chat_id, project_dir))
    except Exception as e:
        ctx.send_error(str(e))
