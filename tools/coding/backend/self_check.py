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
from tools.coding.backend import git_async
import time

# 软件根目录（tools/coding/backend/self_check.py → 上溯 4 级到发布版根目录）
_BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
STATE_DIR = os.path.join('private', 'agent_steps')
REGISTRY_FILE = 'self_check_registry.json'
_REG_MAX = 500   # 上限保护（2026-09-14：20 太小，多对话并发时会把其他会话的起点状态挤丢；
                 # 键是 chatId 且 finish 时即取走删除，500 足够且由过期清理兜底）
_REG_TTL = 7 * 24 * 3600   # 起点快照最长保留 7 天，过期视为丢失（防长期残留）
_DETAIL_MAX_FILES = 15   # 明细最多列出多少个文件，超出折叠

_CREATE_FLAGS = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


def _to_ts(s):
    """'YYYY-MM-DD HH:MM:SS' → epoch 秒，解析失败返回 0（视为过期）。"""
    try:
        return time.mktime(time.strptime(s, '%Y-%m-%d %H:%M:%S'))
    except Exception:
        return 0


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
        # 上限保护：超出则先丢最旧条目（dict 保序，先插即先旧）；同时清理过期条目
        now = time.time()
        for k in [k for k, v in reg.items()
                  if not isinstance(v, dict) or now - _to_ts(v.get('startedAt')) > _REG_TTL]:
            reg.pop(k, None)
        while len(reg) > _REG_MAX:
            k = next(iter(reg))
            reg.pop(k, None)
        with open(_registry_path(), 'w', encoding='utf-8') as f:
            json.dump(reg, f, ensure_ascii=False, indent=2)
    except Exception as e:
        if err_out is not None:
            err_out.append('_save_registry: ' + repr(e))


def _git(path, args):
    """执行 git 命令，返回 (exit_code, stdout, stderr)。带超时防卡死（2026-09-22）。"""
    cmd = ['git'] + list(args)
    r = git_async.run(cmd, cwd=path)
    return r.returncode, (r.stdout or '').strip(), (r.stderr or '').strip()


def _is_repo(path):
    code, _, _ = _git(path, ['rev-parse', '--is-inside-work-tree'])
    return code == 0


def _head_short(path):
    """当前 HEAD 短 hash；空仓库（无提交）返回 None。"""
    code, out, _ = _git(path, ['rev-parse', '--short', 'HEAD'])
    return (out if code == 0 and out.strip() else None)


def _guard_fffd(path):
    """编码污染拦截：git add -A 之后、commit 之前调用。

    对暂存区中与 HEAD 有差异的文本文件逐个检查 U+FFFD：
      - HEAD 版本无 U+FFFD、暂存版有 → 视为被错误编码覆盖，`git checkout HEAD -- <file>`
        还原（改动不丢弃到别处，仅阻止乱码入库）；多个文件时逐个处理。
      - HEAD 版本本就有 U+FFFD（历史遗留，如 style-kite.css）→ 不拦，保持现状。
    """
    code, out, _ = _git(path, ['diff', '--cached', '--name-only', '-z'])
    if code != 0 or not out:
        return
    files = [f for f in out.split('\x00') if f]
    for f in files:
        fp = os.path.join(path, f)
        if not os.path.isfile(fp):
            continue
        # 跳过明显二进制（按扩展名粗筛，避免误读大文件）
        ext = os.path.splitext(f)[1].lower()
        if ext in ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.zip',
                   '.gz', '.mp3', '.mp4', '.woff', '.woff2', '.ttf', '.eot',
                   '.pdf', '.exe', '.dll', '.psd', '.blend', '.fbx', '.glb'):
            continue
        try:
            with open(fp, 'rb') as fh:
                work = fh.read()
            # 注意：_git 返回的是解码后的文本（str），用文本级 U+FFFD 比较
            code_h, head_text, _ = _git(path, ['show', 'HEAD:' + f.replace(os.sep, '/')])
            if code_h != 0:
                continue  # 新文件，无 HEAD 基线，无法对比，不拦
            work_text = work.decode('utf-8', errors='strict')
            if '\ufffd' not in work_text:
                continue  # 工作区干净（可完整 UTF-8 解码即无污染）
            if '\ufffd' in head_text:
                continue  # HEAD 本就含乱码（历史遗留），不拦
            # HEAD 干净 + 工作区有 U+FFFD → 还原
            _git(path, ['checkout', 'HEAD', '--', f])
            print('[guard-fffd] 已还原被编码污染的文件: %s' % f)
        except Exception:
            pass

def _worktree_clean(path):
    """工作区是否干净（含未跟踪文件）。干净 → 无需打快照提交。

    注意必须包含 `??` 未跟踪行：终点快照是 `git add -A` 全量提交，
    未跟踪文件也会入库，所以"干净"的判定标准要和 add -A 一致。
    git 异常时返回 False（fail-closed：宁可多打一次快照也不漏）。
    """
    code, out, _ = _git(path, ['status', '--porcelain'])
    if code != 0:
        return False
    return not (out or '').strip()


def _commit_with_heal(path, msg):
    """git add -A + commit（带 --allow-empty）。

    自愈链（原 _take_snapshot 死代码中捞回）：
      1. add/commit 失败且 err 含 lock → 删残留锁文件（index.lock 等）后重试一次；
      2. 仍失败且 err 含 identity/user.name → 自动补 git 身份后再试一次；
      3. 全部失败返回 None（fail-loud：调用方按 git-error 上报，不静默）。

    【2026-09-26 质检修复】此前 add 的返回码被丢弃——add 静默失败时
    commit --allow-empty 仍会出一个空提交（消息还声称改了文件，实为假提交）。
    现 add 失败走自愈重试；commit 成功后再校验工作区无残留已跟踪改动，
    仍脏则重试一次 add+commit，再脏返回 None 暴露失败。
    成功返回 HEAD 短 hash。
    """
    def _try_once():
        a_code, _, a_err = _git(path, ['add', '-A'])
        if a_code != 0:
            return a_code, a_err
        c_code, _, c_err = _git(path, ['commit', '-m', msg, '--allow-empty', '-q'])
        if c_code != 0:
            return c_code, c_err
        # 提交成功后校验：不允许残留已跟踪文件的未提交改动（?? 未跟踪不拦，
        # 由 .gitignore 兜底；M/D 残留说明 add 阶段有文件被漏/被锁）
        s_code, s_out, _ = _git(path, ['status', '--porcelain'])
        dirty = [l for l in (s_out or '').splitlines()
                 if l.strip() and not l.startswith('??')]
        if dirty:
            return 1, 'post-commit dirty: ' + '; '.join(dirty[:5])
        return 0, ''

    code, err = _try_once()
    if code != 0:
        # 自愈（2026-09-18）：残留锁文件（之前 git 进程异常退出未清理）→ 删后重试
        if 'lock' in (err or '').lower():
            git_dir = os.path.join(path, '.git')
            for lock in ('index.lock', 'HEAD.lock', 'config.lock'):
                lp = os.path.join(git_dir, lock.replace('/', os.sep))
                try:
                    if os.path.isfile(lp):
                        os.remove(lp)
                except Exception:
                    pass
            code, err = _try_once()
        if code != 0:
            # 兜底：未配置 git 身份 → 自动补身份再试一次
            if 'identity' in (err or '').lower() or 'user.name' in (err or '').lower():
                _git(path, ['config', 'user.name', 'zf-agent'])
                _git(path, ['config', 'user.email', 'agent@zf.local'])
                code, err = _try_once()
            if code != 0:
                return None
    return _head_short(path)


def _start_message(question_text=''):
    """起点提交 message：有提问原文用 `[问] 内容`，否则回退旧格式（2026-09-29）。"""
    q = _clean_text(question_text, 40)
    if q:
        return '[问] ' + q + ' @ ' + time.strftime('%Y-%m-%d %H:%M:%S')
    return 'chore: 会话开始快照（用户提问） @ ' + time.strftime('%Y-%m-%d %H:%M:%S')


def _end_message(pending_names=None, answer_text=''):
    """终点提交 message：优先 `[答] 回答摘要`，无摘要则用 pending 文件名，再回退旧格式。"""
    a = _clean_text(answer_text, 40)
    if a:
        return '[答] ' + a + ' @ ' + time.strftime('%Y-%m-%d %H:%M:%S')
    if pending_names:
        names = ', '.join(pending_names[:4])
        if len(pending_names) > 4:
            names += ' 等%d个' % len(pending_names)
        return 'chore: 会话结束快照（修改 %s） @ %s' % (names, time.strftime('%Y-%m-%d %H:%M:%S'))
    return 'chore: 会话结束快照 @ ' + time.strftime('%Y-%m-%d %H:%M:%S')


def _take_snapshot(path, pending_names=None, chat_id='', answer_text=''):
    """打终点快照：git add -A + commit（[session-end]），返回终点 commit 短 hash。

    【2026-09-27 恢复（用户确认策划案）】此前一天本函数被短路为仅返回 HEAD、
    不提交（当时为根治 add -A 乱卷其他仓库文件的问题）；现按策划案恢复为
    「一条对话两个 commit」：起点 [session-start]，终点 [session-end]。
    全量 add -A 已知会把并发会话在途改动一并卷入——先接受（简单可靠），
    出问题再收紧为按 pending 清单提交。

    message：有 pending 清单用 `chore: 会话结束快照（修改 xxx）@ 时间`，
    否则 `chore: 会话结束快照 @ 时间`。
    提交前经 _guard_fffd 编码污染拦截（2026-09-24 public/index.html GBK 乱码事故防线）。
    --allow-empty：仅在有起点对比需求时兜底（防验收 diff 逻辑炸）。

    【2026-09-27 优化：无变化不提交】终点快照前先查工作区，干净则
    跳过 commit，直接返回当前 HEAD 短 hash 作为终点——纯问答对话
    不再产生 [session-end] 空提交。对比逻辑按 hash diff，不受影响。
    """
    _guard_fffd(path)   # 拦截器内部已有 try/except 兜底，不会抛
    if _worktree_clean(path):
        code_h, head, _ = _git(path, ['rev-parse', '--short', 'HEAD'])
        if code_h == 0 and head.strip():
            return head.strip()
        # HEAD 不可用（空仓库且工作区干净）→ 不可能也无需要打提交
        return None
    msg = _end_message(pending_names=pending_names, answer_text=answer_text)
    return _commit_with_heal(path, msg)


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
                # 【P0 小修 v5.4.7】运行时落库文件单独标注，不再稀释审核 diff 信号：
                # 这些文件是 Agent 运行时自动写入的数据（非任务改动），审核时无需人工分辨真伪。
                if _is_runtime_data_file(name):
                    status = (status + ' ' if status else '') + '运行时落库'
                detail.append({'file': name, 'ins': ins, 'del': dele, 'status': status})
    return detail


# 运行时自动落库的路径前缀（小写、正斜杠归一后前缀匹配）。
# 命中即标注「运行时落库」：属数据写入，与任务代码改动无关。
_RUNTIME_DATA_PREFIXES = (
    'private/roles_db.json',
    'private/app_logs',
    'private/agent_turns',
    'private/记忆/',
    'server/engines/common/_budget_snapshots/',
)


def _is_runtime_data_file(name):
    """判断 diff 文件名是否为运行时自动落库数据（而非任务改动）。"""
    n = str(name or '').lower().replace('\\', '/').lstrip('./')
    return any(n.startswith(p) or n == p.rstrip('/') for p in _RUNTIME_DATA_PREFIXES)


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


def _clean_text(s, max_len=40):
    """清洗文本用于 commit message：压平空白、去掉控制/敏感符号、截断。"""
    s = str(s or '')
    s = ' '.join(s.split())          # 压平换行/多空格
    s = s.replace('"', "'").replace('\\', ' ')
    # 去掉可能干扰 shell/显示的特殊字符，保留常用中英文标点
    s = ''.join(ch for ch in s if ch.isprintable() and ch not in '`$;&|<>*?!#()[]{}')
    s = s.strip()
    if len(s) > max_len:
        s = s[:max_len] + '…'
    return s


def _start_impl(chat_id, project_dir, err_out=None, question_text=''):
    """登记起点：先 `git add -A + commit` 打一次起点提交（[session-start]），再记基线。

    【2026-09-26 恢复（用户确认策划案）】用户要求恢复「一条对话两个 commit」：
    提问时 [session-start]，结束时 [session-end]，一条对话一个可回滚单元。
    【2026-09-27 优化：无变化不打快照】起点提交前先查工作区，
    干净则跳过 commit，直接以当前 HEAD 作为起点基线——纯问答对话
    不再产生 [session-start] 空提交。diff 对比用 hash，不受影响。
    全量 add -A 已知会把并发会话在途改动卷入起点提交——策划案确认先接受，
    出问题再收紧。
    【2026-09-29 优化】有用户提问原文时，message = `[问] 内容前40字 @ 时间`，
    减少功能性描述、增加实际内容；无文本回退旧格式。
    """
    if not _is_repo(project_dir):
        return {'ok': False, 'mode': 'no-git', 'message': '非 git 仓库，跳过起点快照'}
    if _worktree_clean(project_dir):
        # 工作区干净：无需起点提交，复用 HEAD 作为基线
        code_h, head, _ = _git(project_dir, ['rev-parse', '--short', 'HEAD'])
        if code_h == 0 and head.strip():
            start_commit = head.strip()
        else:
            start_commit = None
    else:
        start_commit = _commit_with_heal(
            project_dir,
            _start_message(question_text))
    if not start_commit:
        if err_out is not None:
            err_out.append('起点基线获取失败（commit 异常或空仓库且 HEAD 不可用）')
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


def _leftover_note(project_dir, own_names):
    """检查工作区残留（其他并发会话在途改动），返回提示语 or ''。

    【2026-09-20 并发隔离】本对话终点提交后，工作区若仍有未提交改动，
    即为其他并发对话的在途文件——不提交、不吞掉，仅在本对话验收结论里
    单独标注归属，避免误判为"本对话漏交"。
    """
    try:
        code, out, _ = _git(project_dir, ['status', '--porcelain'])
        if code != 0:
            return ''
        leftovers = []
        for ln in (out or '').splitlines():
            ln = ln.rstrip('\n\r')
            if not ln.strip():
                continue
            f = ln[3:].strip().strip('"')
            base = os.path.basename(f)
            if base in (own_names or []):
                continue  # 本对话文件（可能刚提交后有二次写入），不标
            leftovers.append(f)
        if not leftovers:
            return ''
        show = '、'.join(leftovers[:5]) + (' 等%d个' % len(leftovers) if len(leftovers) > 5 else '')
        return ' 【注意】工作区还有未提交改动（%s），属其他并发对话的在途文件，未纳入本次验收。' % show
    except Exception:
        return ''


def _finish_impl(chat_id, fallback_project, answer_text=''):
    """打终点快照 + 与起点对比，返回轻验收结论（含逐文件 +/- 明细）。"""
    reg = _load_registry()
    # 2026-09-14 修复：不再回退到 '_default' 兜底槽（原逻辑会让 A 对话的终点
    # 对比上 B 对话的起点，跨对话串台）。chatId 缺失/找不到就按无起点降级。
    key = str(chat_id or '')
    entry = reg.pop(key, None) if key else None
    if not entry:
        # 旧数据里可能存在历史 _default 槽，仅当 key 确为 _default 时才取走
        entry = reg.pop('_default', None) if key == '_default' else None
    _save_registry(reg)

    project_dir = (entry or {}).get('project') or fallback_project or _BASE
    if not os.path.isdir(project_dir):
        return {'ok': False, 'mode': 'error', 'message': '项目路径不存在: ' + str(project_dir)}
    if not _is_repo(project_dir):
        return {'ok': False, 'mode': 'no-git',
                'message': '⚠ 项目不是 git 仓库（或 git 不可用），跳过 AI 轻量自验收。'}

    # 取走本对话（chatId 隔离）的待提交文件清单，仅用于 commit message 展示。
    # 【2026-09-24 全量快照】终点快照正常 `git add -A` 全量提交，
    # 其他并发会话的在途改动也会一并纳入（用户已确认接受）。
    try:
        from tools.coding.backend.git_save_step import pending_take
        pending_names = pending_take(project_dir, chat_id=chat_id)
    except Exception:
        pending_names = []
    end_commit = _take_snapshot(project_dir, pending_names=pending_names or None,
                                chat_id=chat_id, answer_text=answer_text)
    if not end_commit:
        return {'ok': False, 'mode': 'git-error', 'message': '终点快照失败（git commit 异常），跳过自验收。'}

    start_commit = (entry or {}).get('startCommit')

    # 无起点快照（服务重启/注册表丢失/旧版本起点未记录）：
    # 对比刚打的终点 commit 相对其父提交的差距（= 本对话本次提交的内容）。
    # 【2026-09-20 修复】原实现 diff 'HEAD'（工作区 vs HEAD），而终点快照刚把
    # 改动 commit 进 HEAD，工作区已干净 → 永远显示"无改动"，恒空 bug。
    if not start_commit:
        code_p, parent, _ = _git(project_dir, ['rev-parse', '--short', end_commit + '^'])
        if code_p == 0 and parent.strip():
            detail = _numstat_detail(project_dir, parent, end_commit)
        else:
            # 终点 commit 是仓库首个提交：用空树 diff
            detail = _numstat_detail(project_dir, '4b825dc642cb6eb9a060e54bf8d69288fbee4904', end_commit)
        nf = len(detail)
        ins = sum(d['ins'] for d in detail)
        dele = sum(d['del'] for d in detail)
        extra = _leftover_note(project_dir, pending_names)
        if nf == 0:
            msg = ('自检：无起点快照可比（状态丢失），本次终点提交无文件改动，按无改动交付处理。' + extra)
            return {'ok': True, 'mode': 'no-start', 'silent': True, 'changedFiles': 0, 'insertions': 0,
                    'deletions': 0, 'changedList': [], 'detail': [], 'message': msg}
        lines = ['自检：无起点快照可比（状态丢失），本次终点提交 %d 个文件改动（+%d/-%d 行）：%s'
                 % (nf, ins, dele, extra), '']
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
        # 【空提交抑制】无 git 差距（纯问答/无文件交付）属正常，不产生任何用户可见输出，
        # 只静默返回结构化数据，避免每次回答后都追加大段自验收提示。
        return {'ok': True, 'mode': 'no-change', 'silent': True, 'startCommit': start_commit,
                'endCommit': end_commit, 'commits': n_commits,
                'changedFiles': 0, 'insertions': 0, 'deletions': 0,
                'changedList': [], 'detail': [], 'message': ''}

    # 【2026-10-31 恢复表格输出】用户要求恢复旧版表格样式：首行一行事实，
    # 下方 Markdown 表格（路径 | 状态 | ±行数），前端有配套染色/锁宽/hover 渲染。
    head = ('自检：共 %d 个提交，改动 %d 个文件，+%d/-%d 行'
            % (n_commits, nd, d_ins, d_del))
    lines = [head, '',
             '| 文件 | 状态 | 行数 |',
             '| --- | --- | ---: |']
    lines += _fmt_detail(detail)
    extra = _leftover_note(project_dir, pending_names)
    msg = '\n'.join(lines) + extra
    lst = [d['file'] for d in detail[:20]]
    return {'ok': True, 'mode': 'changed', 'startCommit': start_commit, 'endCommit': end_commit,
            'commits': n_commits, 'changedFiles': nd, 'insertions': d_ins,
            'deletions': d_del, 'changedList': lst, 'detail': detail[:30],
            'message': msg}


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
            r = _start_impl(chat_id, project_dir, errs,
                            question_text=str(body.get('questionText') or ''))
            ctx.send_json(r)
        else:
            ctx.send_json(_finish_impl(chat_id, project_dir,
                                       answer_text=str(body.get('answerText') or '')))
    except Exception as e:
        ctx.send_error(str(e))
