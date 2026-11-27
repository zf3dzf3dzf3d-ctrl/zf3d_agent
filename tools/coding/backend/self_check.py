#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""self_check - AI 轻量自验收（git 双快照对比）

设计（2026-09-09 用户提出；2026-09-10 升级为逐文件 +/- 明细）：
  用户提问时打一次 git 快照（起点），任务终止时再打一次（终点），
  两快照必有差距。AI 收尾时对比两快照：
    - 无差距   → 「无改动交付」提示（纯问答/无文件任务属正常；
                 若声称改了文件却无差距 = 改动未落盘，立即暴露）
    - 有差距   → 输出单行摘要（N提交, N改动, +N/-N 行）+ 逐文件改动明细（每个文件 +插入/-删除 行数、
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


# 本地兜底表：_file_protect 规则模块不可用时退化为旧版行为（正常情况用 fp.BINARY_EXTS 单源）
_BINARY_EXTS_FALLBACK = ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.zip',
                         '.gz', '.mp3', '.mp4', '.woff', '.woff2', '.ttf', '.eot',
                         '.pdf', '.exe', '.dll', '.psd', '.blend', '.fbx', '.glb',
                         '.bat', '.ps1', '.cmd')
_QUARANTINE_DIR = os.path.join('private', 'rollback_quarantine')


def _quarantine_worktree(path, f, fp, work, reason):
    """把工作区问题副本隔离到 private/rollback_quarantine/ 并留痕（绝不静默丢弃）。

    返回隔离文件名；隔离失败返回 None（调用方按原防线继续处理，但必须打日志）。
    """
    quarantine_dir = os.path.join(path, _QUARANTINE_DIR)
    qname = None
    try:
        os.makedirs(quarantine_dir, exist_ok=True)
        safe_name = f.replace(os.sep, '__').replace('/', '__')
        qname = time.strftime('%Y%m%d_%H%M%S') + '_' + safe_name
        qpath = os.path.join(quarantine_dir, qname)
        if work is not None:
            with open(qpath, 'wb') as qf:
                qf.write(work)
        with open(os.path.join(quarantine_dir, 'quarantine.log'),
                  'a', encoding='utf-8') as lf:
            lf.write('%s | %s | %s | 隔离: %s\n'
                     % (time.strftime('%Y-%m-%d %H:%M:%S'), reason, f, qname))
    except Exception as _qe:
        print('[guard-hygiene] [警告] 隔离失败 %s：%r（处理照常执行，副本本次未保存）'
              % (f, _qe))
        try:
            with open(os.path.join(path, 'private', 'rollback_quarantine.log'),
                      'a', encoding='utf-8') as ef:
                ef.write('%s | 隔离失败 %s | %s | %r\n'
                         % (time.strftime('%Y-%m-%d %H:%M:%S'), reason, f, _qe))
        except Exception:
            print('[guard-hygiene] [警告] 隔离失败留痕日志也写入失败')
    return qname


def _guard_hygiene(path):
    """入库卫生五查闸门（2026-11-22 升级，取代 _guard_fffd 编码拦截）。

    git add 之后、commit 之前调用（_commit_with_heal 全量路径与 _commit_selective
    选择性路径都会经过）。规则源与 L0 写入端共用 tools/coding/backend/_file_protect.py。

    五查（仓库卫生策划案 2026-11-22）：
      ①畸形文件名（'"$%`/控制符/纯数字名/保留设备名/首尾空格点——仅新增文件查）
      ②空文件（__init__.py/.gitkeep/.keep 豁免——仅新增文件查）
      ③无效 UTF-8（二进制扩展名与 .bat/.ps1/.cmd 豁免；新文件也查——堵旧版盲区）
      ④U+FFFD 内容毁损（存量文件沿用 HEAD 基线对比；新文件按阈值 _FFFD_BLOCK_MIN）
      ⑤根目录白名单外新增文件（隔离留痕，不入库）
    拦截动作：先隔离工作区副本到 private/rollback_quarantine/（可找回），再
    按情况 checkout 还原（存量）或移出暂存区并删除（新增残渣），绝不静默入库。
    """
    try:
        from tools.coding.backend import _file_protect as _fprot
    except Exception:
        _fprot = None  # 规则模块不可用时退化为旧版纯 U+FFFD 行为
    _binexts = _fprot.BINARY_EXTS if _fprot is not None else _BINARY_EXTS_FALLBACK

    code, out, _ = _git(path, ['diff', '--cached', '--name-only', '-z'])
    if code != 0 or not out:
        return
    files = [f for f in out.split('\x00') if f]
    # 【2026-11-22 复核优化】HEAD 文件清单一次批量取回，替代旧版逐文件 `git show`
    # 判新增——大快照（历史实锤单次 13936 文件）逐文件 spawn 子进程是分钟级卡顿。
    # head_text 仅在"存量文件检出 FFFD 需基线比对"时懒加载。
    code_t, tree_out, _ = _git(path, ['ls-tree', '-r', 'HEAD', '--name-only', '-z'])
    head_files = set(tree_out.split('\x00')) if code_t == 0 else None  # None=空仓库，全部视为新增
    for f in files:
        fp = os.path.join(path, f)
        if not os.path.isfile(fp):
            continue
        rel = f.replace(os.sep, '/')
        ext = os.path.splitext(f)[1].lower()
        if _fprot is not None and _fprot.is_binary_path(rel) or (_fprot is None and rel.lower().endswith(_BINARY_EXTS_FALLBACK)):
            continue
        # 新增文件判定：HEAD 树中无此文件
        is_new = (head_files is None) or (rel not in head_files)
        try:
            # ①畸形文件名（仅新增：历史入库文件改名风险大于收益）
            if is_new and _fprot is not None:
                issue = _fprot._name_issue(f)
                if issue:
                    with open(fp, 'rb') as fh:
                        _work = fh.read()
                    _quarantine_worktree(path, f, fp, _work, '畸形文件名')
                    os.remove(fp)
                    _git(path, ['rm', '--cached', '-q', '--', f])
                    print('[guard-hygiene] 已拦截新增残渣文件: %s（%s；副本在 '
                          'private/rollback_quarantine/）' % (f, issue))
                    continue
            # ②空文件（仅新增；Python 包机制与占位文件豁免）
            if is_new and os.path.getsize(fp) == 0:
                exempt = (_fprot is not None and
                          os.path.basename(f).rsplit('.', 1)[0] in _fprot._EMPTY_OK_STEMS)
                if not exempt:
                    _quarantine_worktree(path, f, fp, b'', '空文件')
                    os.remove(fp)
                    _git(path, ['rm', '--cached', '-q', '--', f])
                    print('[guard-hygiene] 已拦截新增空文件: %s（副本已隔离）' % f)
                    continue
            # ③④编码查（存量沿用 HEAD 基线净增逻辑；新增查无效 UTF-8 + FFFD 阈值）
            with open(fp, 'rb') as fh:
                work = fh.read()
            if len(work) <= 2 * 1024 * 1024:
                try:
                    work_text = work.decode('utf-8', errors='strict')
                except UnicodeDecodeError as _ue:
                    # 无效 UTF-8：新文件=残渣直接拦；存量文件=被错误编码覆盖，隔离后还原
                    if is_new:
                        _quarantine_worktree(path, f, fp, work,
                                             '无效UTF-8(%s)' % _ue.reason)
                        os.remove(fp)
                        _git(path, ['rm', '--cached', '-q', '--', f])
                        print('[guard-hygiene] 已拦截无效编码新文件: %s（副本已隔离）' % f)
                        continue
                    _qname = _quarantine_worktree(path, f, fp, work, '无效UTF-8覆盖')
                    _git(path, ['checkout', 'HEAD', '--', f])
                    print('[guard-hygiene] 已还原被无效编码覆盖的文件: %s（污染副本已隔离: %s）'
                          % (f, _qname))
                    continue
                n_fffd = work_text.count('\ufffd')
                if n_fffd:
                    if is_new:
                        ok_max = (_fprot._FFFD_BLOCK_MIN if _fprot is not None else 1)
                        if n_fffd >= ok_max:
                            _quarantine_worktree(path, f, fp, work, 'U+FFFD内容毁损')
                            os.remove(fp)
                            _git(path, ['rm', '--cached', '-q', '--', f])
                            print('[guard-hygiene] 已拦截乱码新文件: %s（%d 处 U+FFFD，副本已隔离）'
                                  % (f, n_fffd))
                            continue
                    else:
                        # 懒加载基线：仅存量文件检出 FFFD 时才取 HEAD 版本比对
                        _ch, head_text, _ = _git(path, ['show', 'HEAD:' + rel])
                        if '\ufffd' not in (head_text or ''):
                            # 存量：HEAD 干净 + 工作区出现 U+FFFD → 沿用 9-24 事故防线还原
                            _qname = _quarantine_worktree(path, f, fp, work, 'U+FFFD覆盖')
                            _git(path, ['checkout', 'HEAD', '--', f])
                            print('[guard-hygiene] 已还原被编码污染的文件: %s（污染副本已隔离: %s）'
                                  % (f, _qname))
                            continue
            # ⑤根目录白名单外新增文件（隔离留痕；与 L0 提醒同源规则，这里是硬闸）
            if is_new and _fprot is not None:
                d = os.path.dirname(fp)
                if os.path.abspath(d) == os.path.abspath(path):
                    base_ok = os.path.basename(f).lower() in _fprot._ROOT_OK_NAMES \
                        or os.path.splitext(f)[1].lower() in _fprot._ROOT_OK_EXTS
                    if not base_ok:
                        with open(fp, 'rb') as fh:
                            _work = fh.read()
                        _quarantine_worktree(path, f, fp, _work, '根层白名单外')
                        os.remove(fp)
                        _git(path, ['rm', '--cached', '-q', '--', f])
                        print('[guard-hygiene] 已拦截根目录白名单外新文件: %s（探针请落 tmp/；'
                              '副本在 private/rollback_quarantine/）' % f)
                        continue
        except Exception as _ge:
            print('[guard-hygiene] [警告] guard 处理 %s 时异常：%r' % (f, _ge))


# 兼容别名：旧调用点与文档沿用旧名
_guard_fffd = _guard_hygiene

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


# 【P1-1 Phase B 2026-11-22】选择性快照开关：终点/起点快照只提交本对话 pending 清单内
# 文件，不再全量 add -A 卷入并发会话在途改动（混合提交 + 撤销/回退 = 历轮"改完被回滚"
# 的土壤）。失败自动回退全量提交（fail-open 旧行为），可用 ZF_SNAPSHOT_SELECTIVE=0 关闭。
_SNAPSHOT_SELECTIVE = os.environ.get('ZF_SNAPSHOT_SELECTIVE', '1').strip().lower() in ('1', 'true', 'yes')


def _pending_peek(project_dir, chat_id=''):
    """读取本对话 pending 清单（不取走不清空，供起点快照用）。失败返回 []。"""
    try:
        from tools.coding.backend.git_save_step import _pending_path
        import json as _j
        p = _pending_path(project_dir, chat_id)
        with open(p, 'r', encoding='utf-8') as f:
            data = _j.load(f)
        return [n for n in data if isinstance(n, str)] if isinstance(data, list) else []
    except Exception:
        return []


def _norm_ledger_names(names):
    """账本名归一为仓库相对正斜杠路径；剔除仓库外（../ 或盘符绝对）路径。
    返回 (可add清单, 是否全部仓库外)。
    【2026-11-22 复审修复】'..' 判定必须在 lstrip 之前——lstrip('./') 会把 '../x'
    吃成 'x'，导致仓库外路径被误收编（原始形态先判，再归一）。"""
    rels = []
    out_count = 0
    for n in names or []:
        raw = str(n).replace(os.sep, '/')
        if (not raw or raw.startswith('..') or '/../' in raw
                or (len(raw) > 1 and raw[1] == ':') or raw.startswith('/')):
            out_count += 1
            continue
        r = raw.lstrip('./')
        if not r or r not in rels:
            if r:
                rels.append(r)
    return rels, (out_count > 0 and not rels)


def _commit_selective(path, msg, names):
    """按清单选择性提交：只 add 清单内文件 → commit。返回 HEAD 短 hash 或 None。
    - 清单文件全部无改动 → nothing to commit → 返回当前 HEAD（等同无变化快照）；
    - add/commit 失败 → 返回 None（调用方回退全量 _commit_with_heal）；
    - 不做"工作区必须干净"校验：残留的已跟踪改动属其他并发会话在途文件，正是本机制
      特意不收编的部分（由 _leftover_note 标注归属）。
    """
    rels, all_outside = _norm_ledger_names(names)
    if not rels:
        # 清单为空或全在仓库外：按无清单处理，交回调用方走原全量逻辑
        return None
    # 【2026-11-22 第四轮复审】剔除 .gitignore 排除项（如 private/记忆/**）：智能体
    # 经常 write 记忆文件，账本会记下这些路径；不预过滤则 git add 报 "paths ignored"
    # → 误判失败 → 回退全量清扫（恰卷入他人在途改动）。ignored 文件本就不该入库，
    # 剔除后若清单为空按"无需提交"处理（返回当前 HEAD）。
    ci_code, ci_out, _ = _git(path, ['-c', 'core.quotepath=false', 'check-ignore', '--'] + rels)
    if ci_code == 0 and (ci_out or '').strip():
        # 【2026-11-22】core.quotepath=false 必须带上：git 默认对非 ASCII 路径输出
        # 八进制转义（"private/\350..."），中文路径（记忆/策划案等）永远比对不上、过滤失效
        _ignored = {l.strip().strip('"').replace(os.sep, '/') for l in ci_out.splitlines() if l.strip()}
        rels = [r for r in rels if r not in _ignored]
    if not rels:
        code_h, head, _ = _git(path, ['rev-parse', '--short', 'HEAD'])
        return head.strip() if code_h == 0 and head.strip() else None
    a_code, _, _a_err = _git(path, ['add', '--'] + rels)
    if a_code != 0:
        return None
    _guard_hygiene(path)   # 【2026-11-22】选择性提交同样过入库卫生五查
    c_code, c_out, c_err = _git(path, ['-c', 'zf.snapshot=1', 'commit', '-m', msg, '-q'])  # zf.snapshot=1 = 保护性快照：钩子的反模式硬拦截对其放行并留痕
    if c_code != 0:
        # 【2026-11-22 复审修复】nothing to commit 输出在 stdout（原只查 stderr，
        # 永远匹配不上 → 被误判为失败 → 回退全量 add -A，恰好卷入他人在途改动）。
        _combined = ((c_out or '') + (c_err or '')).lower()
        if 'nothing to commit' in _combined or 'nothing added' in _combined:
            code_h, head, _ = _git(path, ['rev-parse', '--short', 'HEAD'])
            return head.strip() if code_h == 0 and head.strip() else None
        return None
    code_h, head, _ = _git(path, ['rev-parse', '--short', 'HEAD'])
    return head.strip() if code_h == 0 and head.strip() else None


def _commit_fail_reason(out, err, limit=3, cap=180):
    """从 git（含 pre-commit 门禁钩子）输出提取失败原因紧凑摘要。

    【2026-11-23】此前 commit 失败只报「git commit 异常」，门禁钩子（hygiene_gate/
    check_plugin_only）具体拦了什么被吞掉——用户只见报错不知为何被拦。钩子输出随
    git 子进程 stdout/stderr 一并被捕获（git_async capture_output=True），从中提取：
    优先取含拦截特征词的行（表头 '=' 装饰剥掉），无特征行回退末尾几行（超时/身份
    等裸 git 错误）。最多 limit 行、单处截断 cap 字符。
    """
    lines = [ln.strip() for ln in ((out or '') + '\n' + (err or '')).splitlines() if ln.strip()]
    if not lines:
        return ''
    hits = [ln for ln in lines
            if ('拦截' in ln or '违禁' in ln or '门禁' in ln or '根层' in ln
                or 'hook' in ln.lower())]
    picks = hits or lines[-limit:]
    return (' / '.join(ln.strip('= ') for ln in picks[:limit]))[:cap]


def _commit_with_heal(path, msg, err_out=None):
    """git add -A + commit（带 --allow-empty）。

    自愈链（原 _take_snapshot 死代码中捞回）：
      1. add/commit 失败且 err 含 lock → 删残留锁文件（index.lock 等）后重试一次；
      2. 仍失败且 err 含 identity/user.name → 自动补 git 身份后再试一次；
      3. 全部失败返回 None（fail-loud：调用方按 git-error 上报，不静默）。
      【2026-11-23】最终失败时把末次尝试的输出摘要（通常是门禁钩子拦截原因）
      append 进 err_out（沿用本模块 err_out 旁路惯例；返回值语义不变：hash 或 None，
      task_list.py 等外部调用方兼容）。

    【2026-09-26 质检修复】此前 add 的返回码被丢弃——add 静默失败时
    commit --allow-empty 仍会出一个空提交（消息还声称改了文件，实为假提交）。
    现 add 失败走自愈重试；commit 成功后再校验工作区无残留已跟踪改动，
    仍脏则重试一次 add+commit，再脏返回 None 暴露失败。
    成功返回 HEAD 短 hash。
    """
    def _try_once():
        a_code, _, a_err = _git(path, ['add', '-A'])
        if a_code != 0:
            return a_code, '', a_err
        # 【2026-11-22】入库卫生五查必须在 add -A 之后跑（此前挂在 add 之前
        # 会因暂存区为空而空转，等于没设防）。
        _guard_hygiene(path)
        c_code, c_out, c_err = _git(path, ['-c', 'zf.snapshot=1', 'commit', '-m', msg, '--allow-empty', '-q'])  # 同上：保护性快照
        if c_code != 0:
            return c_code, c_out, c_err
        # 提交成功后校验：不允许残留已跟踪文件的未提交改动（?? 未跟踪不拦，
        # 由 .gitignore 兜底；M/D 残留说明 add 阶段有文件被漏/被锁）
        s_code, s_out, _ = _git(path, ['status', '--porcelain'])
        dirty = [l for l in (s_out or '').splitlines()
                 if l.strip() and not l.startswith('??')]
        if dirty:
            return 1, '', 'post-commit dirty: ' + '; '.join(dirty[:5])
        return 0, '', ''

    code, out, err = _try_once()
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
            code, out, err = _try_once()
        if code != 0:
            # 兜底：未配置 git 身份 → 自动补身份再试一次
            if 'identity' in (err or '').lower() or 'user.name' in (err or '').lower():
                _git(path, ['config', 'user.name', 'zf-agent'])
                _git(path, ['config', 'user.email', 'agent@zf.local'])
                code, out, err = _try_once()
            if code != 0:
                if err_out is not None:
                    err_out.append(_commit_fail_reason(out, err) or ('git 失败(码%s)' % code))
                return None
    return _head_short(path)


def _start_message(question_text=''):
    """起点提交 message：有提问原文用 `[问] 内容`，否则回退旧格式（2026-09-29）。"""
    q = _clean_text(question_text, 40)
    tag = '[自动快照] '
    if q:
        return tag + '[问] ' + q + ' @ ' + time.strftime('%Y-%m-%d %H:%M:%S')
    return tag + 'chore: 会话开始快照（用户提问） @ ' + time.strftime('%Y-%m-%d %H:%M:%S')


def _end_message(pending_names=None, answer_text=''):
    """终点提交 message：优先 `[答] 回答摘要`，无摘要则用 pending 文件名，再回退旧格式。"""
    a = _clean_text(answer_text, 40)
    tag = '[自动快照] '
    if a:
        return tag + '[答] ' + a + ' @ ' + time.strftime('%Y-%m-%d %H:%M:%S')
    if pending_names:
        names = ', '.join(pending_names[:4])
        if len(pending_names) > 4:
            names += ' 等%d个' % len(pending_names)
        return tag + 'chore: 会话结束快照（修改 %s） @ %s' % (names, time.strftime('%Y-%m-%d %H:%M:%S'))
    return tag + 'chore: 会话结束快照 @ ' + time.strftime('%Y-%m-%d %H:%M:%S')


def _take_snapshot(path, pending_names=None, chat_id='', answer_text='', err_out=None):
    """打终点快照：git add -A + commit（[session-end]），返回终点 commit 短 hash。

    【2026-09-27 恢复（用户确认策划案）】此前一天本函数被短路为仅返回 HEAD、
    不提交（当时为根治 add -A 乱卷其他仓库文件的问题）；现按策划案恢复为
    「一条对话两个 commit」：起点 [session-start]，终点 [session-end]。
    全量 add -A 已知会把并发会话在途改动一并卷入——先接受（简单可靠），
    出问题再收紧为按 pending 清单提交。

    message：有 pending 清单用 `chore: 会话结束快照（修改 xxx）@ 时间`，
    否则 `chore: 会话结束快照 @ 时间`。
    提交前经 _guard_hygiene 入库卫生五查拦截（2026-09-24 public/index.html GBK 乱码事故防线；
    2026-11-22 升级五查并移入 add -A 之后的 _commit_with_heal/_commit_selective 内）。
    --allow-empty：仅在有起点对比需求时兜底（防验收 diff 逻辑炸）。

    【2026-09-27 优化：无变化不提交】终点快照前先查工作区，干净则
    跳过 commit，直接返回当前 HEAD 短 hash 作为终点——纯问答对话
    不再产生 [session-end] 空提交。对比逻辑按 hash diff，不受影响。

    【2026-11-22】入库卫生五查已移入 _commit_with_heal（add -A 之后）与
    _commit_selective（选择性 add 之后）——必须在 add 之后跑才拦得到，
    本函数不再前置调用（此前前置调用因暂存区为空而空转）。
    """
    if _worktree_clean(path):
        code_h, head, _ = _git(path, ['rev-parse', '--short', 'HEAD'])
        if code_h == 0 and head.strip():
            return head.strip()
        # HEAD 不可用（空仓库且工作区干净）→ 不可能也无需要打提交
        if err_out is not None:
            err_out.append('工作区干净但 HEAD 不可用（空仓库？）')
        return None
    msg = _end_message(pending_names=pending_names, answer_text=answer_text)
    # 【P1-1 Phase B 2026-11-22】有本对话清单时优先选择性提交（只收编清单内文件，
    # 其他在途改动留给归属会话）；失败自动回退全量提交（fail-open 旧行为）。
    # 可用 ZF_SNAPSHOT_SELECTIVE=0 一键关回全量。
    if pending_names and _SNAPSHOT_SELECTIVE:
        _head0 = _head_short(path)
        h = _commit_selective(path, msg, pending_names)
        if h:
            # 【2026-11-22 复审修复】仅当确有新提交（HEAD 前进了）才 amend；
            # nothing-to-commit 时 h==原 HEAD，amend 会改写他人提交的 message。
            if _head0 and h != _head0:
                return _amend_msg_to_actual(path, h, msg)
            return h
    h = _commit_with_heal(path, msg, err_out=err_out)
    if h:
        h = _amend_msg_to_actual(path, h, msg)
    return h


def _amend_msg_to_actual(path, h, orig_msg=''):  # 【2026-11-24 快照归因改造】orig_msg=原 message：amend 时保留归因头不再毁尸
    """【根治 message-内容不符 20261119】commit 后按实际入库文件 amend 修正 message。

    根因：message 在 commit 前按 pending 清单先拼好，而 add -A 收的是
    快照时刻的实际脏文件（并发会话可能抢先/滞后），两者天然可能脱节
    （实锤：2bb1d96c / 1cb80353 / d8ed1394 message 声称的文件不在 commit 内）。
    修法：commit 成功后 git show --name-only HEAD 取真实文件清单，
    --amend 重写 message 为「实际改动: ...」（快照 commit 仅本地使用，amend 安全）。
    amend 失败不影响原 commit 有效性（返回原 hash，fail-soft）。
    """
    # 【并发竞态防护 20261119 第3轮】amend 前校验 HEAD 仍是自己刚产出的 commit；
    # 若并发会话已抢先 commit，放弃 amend（fail-soft 返回原 hash），绝不改写他人 message。
    try:
        c0, head0, _ = _git(path, ['rev-parse', '--short', 'HEAD'])
        if c0 != 0 or head0.strip() != h:
            return h
        c, out, _ = _git(path, ['show', '--name-only', '--format=', 'HEAD'])
        if c != 0 or not (out or '').strip():
            return h
        files = [ln.strip() for ln in out.splitlines() if ln.strip()]
        if not files:
            return h
        names = ', '.join(files[:4])
        if len(files) > 4:
            names += ' 等%d个' % len(files)
        # 沿用原 commit 时间戳（审计时序不失真），仅当取不到时用当前时间
        ct, ts, _ = _git(path, ['show', '-s', '--format=%ci', 'HEAD'])
        stamp = ts.strip() if (ct == 0 and ts.strip()) else time.strftime('%Y-%m-%d %H:%M:%S')
        # 【2026-11-24 快照归因改造】不再毁尸：原 message 含 [问]/[答] 归因头时
        # 保留其首行（剥旧标签与旧时间戳防叠加污染），仅更新实际文件清单；
        # 无原 message（兼容旧调用）回退 chore: 快照。
        _om = (orig_msg or '').strip()
        _head_txt = ''
        if _om:
            _head_txt = _om.splitlines()[0].strip()
            _head_txt = (_head_txt.replace('[自动快照·未归因] ', '')
                                   .replace('[自动快照] ', ''))
            _at = _head_txt.rfind(' @ ')
            if _at > 0:
                _head_txt = _head_txt[:_at].strip()
        if not _head_txt:
            _head_txt = 'chore: 快照'
        new_msg = ('[自动快照] %s（实际改动: %s） @ %s'
                   % (_head_txt, names, stamp))
        a, _, _ = _git(path, ['-c', 'zf.snapshot=1', 'commit', '--amend', '-m', new_msg, '-q'])  # 同上：保护性快照
        if a == 0:
            c2, head2, _ = _git(path, ['rev-parse', '--short', 'HEAD'])
            if c2 == 0 and head2.strip():
                return head2.strip()
    except Exception:
        pass
    return h


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
    'public/config/models',   # 【2026-11-22】model_config.py 周期回写，历轮快照"实际改动"几乎全是它，纯噪声
    'server/data/',           # 【2026-11-25 M26方案B】server 运行时数据区（swarm_pipeline 报告/worktree wt-* 等）：
                              # .gitignore /server/data/ 本就不跟踪，此处标注防其被全量收编时稀释审核 diff 信号
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
        # 状态列只输出 emoji 图标（Markdown 表格单元格里不能放原生 HTML，会被转义成可见文本）；
        # 新建/删除/二进制有独立图标，普通修改默认 ✏️
        _icon = {'新建': '🆕', '删除': '🗑️', '二进制': '📦'}.get(d['status'], '✏️')
        stat = ' %s' % _icon
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
        # 【缺口A 20261119 第3轮】开始快照同样 commit 后按实际入库内容 amend 修正 message，
        # 使 message-内容一致性在开始/结束两条快照路径上都闭合。
        # 【P1-1 Phase B 2026-11-22】起点同样优先只收编本对话 pending 清单内文件
        # （peek 不取走，finish 侧仍能取走用于 message 展示）；清单为空/选择性失败
        # 回退全量（fail-open 旧行为）。
        _own = _pending_peek(project_dir, chat_id) if _SNAPSHOT_SELECTIVE else []
        start_commit = None
        _sm = _start_message(question_text)
        if _own:
            _head0 = _head_short(project_dir)
            _sc0 = _commit_selective(project_dir, _sm, _own)
            if _sc0:
                # 【2026-11-22 复审修复】仅确有新提交（HEAD 前进）才 amend；
                # nothing-to-commit 时直接以当前 HEAD 为起点基线，绝不动他人提交。
                if _head0 and _sc0 != _head0:
                    _sc0 = _amend_msg_to_actual(project_dir, _sc0, _sm)
                start_commit = _sc0
        if not start_commit:
            # 清单为空/全在仓库外/选择性失败 → 回退全量（fail-open 旧行为）
            start_commit = _commit_with_heal(project_dir, _sm, err_out=err_out)
            if start_commit:
                start_commit = _amend_msg_to_actual(project_dir, start_commit, _sm)
    if not start_commit:
        _why = '；'.join((err_out or [])[-2:]) if err_out else ''
        if err_out is not None:
            err_out.append('起点基线获取失败（commit 异常或空仓库且 HEAD 不可用）')
        return {'ok': False, 'mode': 'git-error',
                'message': (('起点快照失败（git commit 异常：%s）' % _why) if _why
                            else '起点快照失败（git commit 异常）')}
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
            # 【2026-11-22】账本起改存仓库相对路径（历史为 basename），两种形态都认
            _own = own_names or []
            _own_bases = {os.path.basename(n) for n in _own}
            _own_norm = {str(n).replace(os.sep, '/').lstrip('./') for n in _own}
            if f.replace(os.sep, '/') in _own_norm or base in _own_bases:
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
    # 【2026-11-23】err_out 旁路带出失败原因（通常是门禁钩子拦截内容），消息不再只说"异常"
    snap_err = []
    end_commit = _take_snapshot(project_dir, pending_names=pending_names or None,
                                chat_id=chat_id, answer_text=answer_text, err_out=snap_err)
    if not end_commit:
        _why = '；'.join(snap_err[:2]) if snap_err else ''
        return {'ok': False, 'mode': 'git-error',
                'message': (('终点快照失败（git commit 异常：%s），跳过自验收。' % _why) if _why
                            else '终点快照失败（git commit 异常），跳过自验收。')}

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
            # 2026-11-17 修复：无起点快照且无 git 差距时必须完全静默（message 置空）。
            # 原先虽带 silent:true，但前端只判 message 非空就追加展示（agent-02-loop-core.js
            # 第 2117 行），导致多轮对话重启后每轮收尾都叠一条「（状态丢失）本次无文件改动」。
            return {'ok': True, 'mode': 'no-start', 'silent': True, 'changedFiles': 0, 'insertions': 0,
                    'deletions': 0, 'changedList': [], 'detail': [], 'message': ''}
        lines = ['（状态丢失）%d改动, `+%d`/`-%d` 行：%s'
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
    head = ('%d提交, %d改动, `+%d`/`-%d` 行'
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
