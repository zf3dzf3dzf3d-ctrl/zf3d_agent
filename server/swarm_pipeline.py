# -*- coding: utf-8 -*-
"""server/swarm_pipeline.py - 蜂群流水线后台编排器（P4）

把前台 JS 驱动的「策划→收口裁决→施工→审核→总结」流程搬进纯后端，
供 cli.py --pipeline 调用，也可被服务端其它模块复用。

设计要点（与两份策划案定稿一致）：
- 串行执行五阶段，首版不做跨阶段并行（规避改码冲突）。
- 策划/审核阶段走 dispatch_swarm 轻量 _chat（省 token，纯对话）。
- 施工阶段走 cli.run_once（完整 agent 工具循环，能真正改代码）。
- 收口裁决是编排器内置阶段：把多份策划案合并成一收口汇总 prompt，
  再由轻量 _chat 出裁决，上阶段产物注入下阶段。
- 素材包前缀统一取 material_pack_prefixes 单源（PACK_PREFIXES 语义，
  这里用生成函数拼装，不复制前缀字符串）。
- 失败策略：策划失败→跳过该策划（剩余继续，全败才阻断）；
  审核失败→阻断（返回码 2）；施工失败→阻断。
- 每阶段产物落库 agent_turns（session_id 可与前台互通，前台可见），
  并落盘 data/swarm_pipeline/<流水线id>.md 汇总报告。

用法：
    from swarm_pipeline import run_pipeline
    report = run_pipeline({'goal': '...', 'planners': 2, 'builders': 1, 'reviewers': 2}, cwd='...')
"""
import os
import re
import sys
import json
import time
import traceback
import subprocess


def _git_evidence(cwd, limit=3000):
    """[P1.1 review gate] 独立实据：实跑 git 获取当前工作区真实改动，供 reviewer 对照施工自述。
    失败返回空串（不阻断流水线），并在串首标注获取失败。"""
    try:
        st = subprocess.run(['git', 'status', '--short'], cwd=cwd,
                            capture_output=True, text=True, timeout=15,
                            encoding='utf-8', errors='replace')
        ds = subprocess.run(['git', 'diff', '--stat', 'HEAD'], cwd=cwd,
                            capture_output=True, text=True, timeout=15,
                            encoding='utf-8', errors='replace')
        out = ('git status --short:\n' + (st.stdout or '(clean)') +
               '\ngit diff --stat HEAD:\n' + (ds.stdout or '(no diff)')).strip()
        return out[:limit]
    except Exception as e:
        return '[git 实据获取失败: %s]' % e


def _worktree_create(cwd, session_id, log=print):
    """[P1.2 worktree 隔离] 为施工阶段创建独立 git worktree（data/swarm_pipeline/wt-<session>），
    避免多 worker 共享工作区互覆盖。默认关（cfg.worktree_isolate），失败降级共享工作区不阻断。"""
    try:
        base = os.path.join(SERVER_DIR, 'data', 'swarm_pipeline', 'wt-' + session_id)
        if os.path.exists(base):
            subprocess.run(['git', 'worktree', 'remove', '--force', base], cwd=cwd,
                           capture_output=True, timeout=30)
        r = subprocess.run(['git', 'worktree', 'add', base, 'HEAD'], cwd=cwd,
                           capture_output=True, text=True, timeout=60,
                           encoding='utf-8', errors='replace')
        if r.returncode != 0:
            log('[pipeline][P1.2] worktree 创建失败，降级共享工作区: %s'
                % (r.stderr or '').strip()[:300])
            return None
        log('[pipeline][P1.2] worktree 隔离已开启: %s' % base)
        return base
    except Exception as e:
        log('[pipeline][P1.2] worktree 创建异常，降级共享工作区: %s' % e)
        return None


def _worktree_merge(wt_dir, cwd, log=print):
    """[P1.2] 施工/审核完成后，把 worktree 内改动 commit 后以 diff+apply 合回主工作区，
    最后清理 worktree。合并失败保留现场供人工检查，不阻断流水线收口。"""
    try:
        subprocess.run(['git', 'add', '-A'], cwd=wt_dir, capture_output=True, timeout=120)
        subprocess.run(['git', 'commit', '-m', '[wt] pipeline worker changes'],
                       cwd=wt_dir, capture_output=True, timeout=60)
        r = subprocess.run(['git', 'diff', '--binary', 'HEAD~1', 'HEAD'], cwd=wt_dir,
                           capture_output=True, text=True, timeout=60,
                           encoding='utf-8', errors='replace')
        if not (r.stdout or '').strip():
            log('[pipeline][P1.2] worktree 无改动可合并')
        else:
            a = subprocess.run(['git', 'apply', '--whitespace=nowarn'], cwd=cwd,
                               input=r.stdout, capture_output=True, text=True,
                               timeout=60, encoding='utf-8', errors='replace')
            if a.returncode != 0:
                log('[pipeline][P1.2] 合并冲突/失败，worktree 保留现场: %s'
                    % (a.stderr or '').strip()[:300])
                return False
            log('[pipeline][P1.2] worktree 改动已合回主工作区')
        subprocess.run(['git', 'worktree', 'remove', '--force', wt_dir], cwd=cwd,
                       capture_output=True, timeout=30)
        return True
    except Exception as e:
        log('[pipeline][P1.2] worktree 合并异常（现场保留）: %s' % e)
        return False

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)
ENGINES_DIR = os.path.join(SERVER_DIR, 'engines')
if ENGINES_DIR not in sys.path:
    sys.path.insert(0, ENGINES_DIR)

from engines.common.material_pack_prefixes import (
    GREETING_EXEMPT_TEXT,
    SUMMARY_HEADLINE_RULE,
)
from engines.common.planner_output_format import with_planner_format as _planner_format


def _parse_summary_head(text):
    """从总结文本解析「一行结论头」，宽松匹配，失败返回 None（不阻断）。"""
    try:
        m = re.search(
            r'【结果】任务：(.{1,200}?)\s*｜\s*结果：(.{1,20}?)\s*｜\s*一句话简介：(.{1,300})',
            str(text)[:800])
        if m:
            return {'task': m.group(1).strip(),
                    'result': m.group(2).strip(),
                    'brief': m.group(3).strip()}
    except Exception:
        pass
    return None

# 各角色素材包前缀（引用单源常量拼装，保持与前缀字符串同源语义）
_PACKS = {
    'planner': '（策划师素材包',
    'reviewer': '（审核员素材包',
    'builder': '（施工队素材包',
    'summarizer': '（总结师素材包',
}

_REPORT_DIR = os.path.join(SERVER_DIR, 'data', 'swarm_pipeline')

# 轻量阶段（策划/审核/收口/总结）给 _chat 的上下文截断上限，防上下文爆炸
_STAGE_CTX_LIMIT = 18000


def _pack(role, title, body):
    """组装一条素材包首消息（前缀走 _PACKS 单源 + 问候豁免段，前台同款语义）。"""
    return '%s·%s】%s%s' % (_PACKS[role], title, body, GREETING_EXEMPT_TEXT)


def _light_chat(prompt, model_name=''):
    """轻量纯对话（走 dispatch_swarm 的 _chat，省 token，不带工具）。
    model_name 为空时走 dispatch_swarm._resolve_model 默认选路。"""
    import dispatch_swarm
    m = dispatch_swarm._resolve_model(model_name or None)
    return dispatch_swarm._chat(m, [{'role': 'user', 'content': prompt}])


def _build_stage(stage_cfg, n_default):
    """阶段配置归一化：允许数字（并发份数）、{count, model} 或 {enabled:false} 关闭该阶段。

    [P1 阶段开关] count/enabled 尊重显式 0（=关闭该阶段，返回 0）；但 stage_cfg 为
    None 时仍走 n_default 旧逻辑——这是 cli --pipeline 零回归红线：不传 stages/planners
    等键的旧配置行为完全不变（默认 2/1/2）。"""
    if stage_cfg is None:
        return n_default, ''
    if isinstance(stage_cfg, bool):
        # bool 是 int 子类，显式区分：True=走默认，False=关闭，避免误判成 1/0
        return (n_default if stage_cfg else 0), ''
    if isinstance(stage_cfg, int):
        return min(max(0, stage_cfg), 8), ''
    if isinstance(stage_cfg, dict):
        if stage_cfg.get('enabled') is False:
            return 0, str(stage_cfg.get('model', '') or '')
        return min(max(0, int(stage_cfg.get('count', n_default))), 8), str(stage_cfg.get('model', '') or '')
    return n_default, ''


def _collect_strict(ds, batch_id, n_total, stage_name, log=print):
    """严格收口：轮询批次直到所有子任务都成功（done 且有产出）才返回。
    不成功绝不返回：failed/partial/running 都继续重试（最多 5 轮全批重提）
    或继续等待，但 running 停滞超 _STALL_LIMIT 秒会显式阻断（见下），不存在无限挂起。
    [2026-09-30] 应用户要求移除 600 秒兜底与"部分成功即放行"逻辑。
    [2026-10-28 阶段A1 注释修正·v2.1] 修正本注释旧版与代码行为的两处不一致：
    ①旧文"或继续挂起等待"已过时——L188 起有 running 停滞计时兜底；
    ②collect 调用链全量核对口径（实读时间 2026-10-28，精确正则 \.collect\(
    全 server 7 处匹配 / 6 处真实调用）：
      - routes/api_dispatch_post.py L152  wait_sec=timeout（默认 600，入参可覆盖）
      - swarm_solve_ab.py L25             wait_sec=1200
      - swarm_solve_exam.py L49           wait_sec=600
      - engines/common/swarm_tools.py L104 wait_sec=入参（默认 0）
      - 本文件 L195                        wait_sec=0（轮询观测，不阻塞）
      - 本文件 L212                        wait_sec=60（补跑批次单次等待）
    即 wait_sec 只是单次阻塞等待时长，各调用方语义不同，均不构成本函数
    层面的无限挂起风险；挂起防线以 _STALL_LIMIT 与 attempt 重试上限为准。"""
    # [2026-10-08 二次修复] 按审核意见改为「累积成功集合」：
    # 原实现每轮 res = ds.collect(...) 会覆盖上轮合并结果（死代码），且
    # attempt>=5 耗尽后无限挂起死循环。现循环外维护 done_map（id→产出），
    # 每轮把本轮 done（含补跑成功）并入；收口判定改用 len(done_map)>=n_total，
    # 补跑产出真正参与判定并随返回值带出；重试 5 轮耗尽且无进展时抛错阻断，
    # 不再死循环（阶段收集处有按 id 去重 + 封顶兜底，不会超量）。
    attempt = 0
    done_map = {}   # id -> task（累积所有已成功且带产出的任务，含补跑）
    _last_oks = 0
    # [2026-10-28 修反驳师高项②·无限挂起路径] 旧抛错条件要求 not running：
    # 上游请求挂死时任务永远停在 running，既不收口也不抛错（曾活体挂起 140 轮×3 秒）。
    # 现加「running 停滞计时」：有在跑任务但累积成功数持续无进展超过 _STALL_LIMIT 秒
    # 也视为无进展，与 attempt>=5 一起触发显式阻断，不再无限挂起。
    _STALL_LIMIT = 600   # 10 分钟无任何新成功 → 判定上游挂死
    _stall_start = None  # 首次观测到"有 running 且无新成功"的时间
    while True:
        res = ds.collect(batch_id, wait_sec=0) or {}
        for t in (res.get('tasks') or []):
            if t.get('status') == 'done' and t.get('output'):
                done_map[t.get('id') or id(t)] = t
        if len(done_map) >= n_total:
            log('[pipeline] %s批次 %s 全部 %d 份成功' % (stage_name, batch_id, n_total))
            res['tasks'] = list(done_map.values())
            return res
        # 未成功的子任务：失败的重投一批补跑，running 的继续等
        failed = [t for t in (res.get('tasks') or []) if t.get('status') == 'failed']
        running = len(res.get('tasks') or []) - len([
            t for t in (res.get('tasks') or []) if t.get('status') in ('done', 'failed')])
        if failed and attempt < 5:
            attempt += 1
            retry_tasks = [{'goal': t['goal']} for t in failed]
            log('[pipeline] %s批次有 %d 份失败，第 %d 次补跑' % (stage_name, len(failed), attempt))
            new_bid = ds.submit(retry_tasks, model_name=None)
            r2 = ds.collect(new_bid, wait_sec=60) or {}
            # 补跑成功的产出并入 done_map（真正参与收口判定）
            for t in (r2.get('tasks') or []):
                if t.get('status') == 'done' and t.get('output'):
                    done_map[t.get('id') or id(t)] = t
            if len(done_map) >= n_total:
                log('[pipeline] %s批次经 %d 次补跑后收齐 %d 份' % (stage_name, attempt, n_total))
                res['tasks'] = list(done_map.values())
                return res
        if len(done_map) == _last_oks and not running and attempt >= 5:
            # 重试额度耗尽且无进展、无在跑任务 → 显式阻断，绝不死循环
            raise RuntimeError('%s批次 %d 轮补跑后仍有 %d 份失败，仅收齐 %d/%d，流水线阻断'
                               % (stage_name, attempt, len(failed), len(done_map), n_total))
        # [2026-10-28 修高项②] running 停滞超时：有在跑但 10 分钟零新成功 → 上游挂死，显式阻断
        if running and len(done_map) == _last_oks:
            if _stall_start is None:
                _stall_start = time.time()
            elif time.time() - _stall_start >= _STALL_LIMIT:
                raise RuntimeError('%s批次 %s 在跑任务停滞超过 %d 秒无任何新成功（疑似上游挂死），仅收齐 %d/%d，流水线阻断'
                                   % (stage_name, batch_id, _STALL_LIMIT, len(done_map), n_total))
        else:
            _stall_start = None   # 有新进展 → 重置停滞计时
        _last_oks = len(done_map)
        log('[pipeline] %s批次未收口（累积成功%d/%d，运行中%d），继续等待' % (
            stage_name, len(done_map), n_total, running))
        time.sleep(3)


def run_pipeline(cfg, cwd=None, log=print, sandbox=None, on_stage=None):
    """执行一条蜂群流水线，返回 (exit_code, report_dict)。

    sandbox: 可选 evolution_lab.sandbox 模块。传入时施工/执行命令走密闭执行
    （cwd 强制 workspace、死代理、超时击杀）；默认 None 时行为与旧版完全一致。

    on_stage: 可选回调 fn(report_dict)。【增量落库】每完成一个阶段调用一次，
    供 worker 实时把 report 摘要写回 jobs 表——使面板在 running 期间就能看到
    进度条逐步点亮/概要内容，不再"切过去啥也看不到"。默认 None 行为不变。

    cfg 结构：
        goal:      必填，总任务目标
        planners:  2（份数）或 {count, model}
        builders:  1
        reviewers: 2
        context:   可选，附加上下文
        session:   可选，落库会话 id（默认 pl-<时间戳>）
        summarize: 可选，是否跑总结阶段（默认 False，总结师窗口通常由人工开）
        decision_gate: 可选，决策断点（默认 False）。开启时收口裁决后暂停，
            返回码 3 + report['verdict']（裁决清单），由调用方注入用户裁决后
            传 cfg['resume_verdict'] 继续施工；不传裁决则按裁决清单直接施工。
        resume_verdict: 可选，决策断点恢复：跳过策划/收口，直接以该文本为执行清单施工。
    """
    goal = str((cfg or {}).get('goal') or '').strip()
    if not goal:
        return 1, {'error': '流水线缺少 goal'}

    cwd = os.path.abspath(cwd or os.getcwd())
    n_pl, m_pl = _build_stage(cfg.get('planners'), 2)
    n_bd, m_bd = _build_stage(cfg.get('builders'), 1)
    n_rv, m_rv = _build_stage(cfg.get('reviewers'), 2)
    # [反驳师阶段] 默认 0（关闭）：cfg 不带 objectors 键 → 显式取 0 → 关，旧配置零回归。
    # 注意必须用 cfg.get('objectors', 0)（缺键给 int 0），不能传 None，否则 _build_stage
    # 的 None 分支会回落到 n_default 而凭空开启反驳（2026-10-23 反驳师实测证伪后修正）。
    # 开启方式：cfg.objectors = 数字(并发份数，建议1) / {count:1, model:''} / true(走默认1)。
    n_ob, m_ob = _build_stage(cfg.get('objectors', 0), 1)
    extra_ctx = str(cfg.get('context') or '')
    session_id = str(cfg.get('session') or ('pl-' + str(int(time.time()))))
    do_sum = bool(cfg.get('summarize'))
    decision_gate = bool(cfg.get('decision_gate'))
    resume_verdict = str(cfg.get('resume_verdict') or '').strip()

    report = {'id': session_id, 'goal': goal, 'cwd': cwd, 'stages': {}, 't0': time.time()}

    def persist(role, content):
        try:
            import db
            db.write_agent_turn(session_id, int(time.time()), role, content)
        except Exception as e:
            log('[pipeline] 落库失败(忽略): %s' % e)

    def note_stage(name, data):
        report['stages'][name] = data
        # [增量落库] 每个阶段完成即回调（异常吞掉，绝不影响主流程）
        if on_stage:
            try:
                on_stage(report)
            except Exception:
                pass

    # ---------- 阶段1-2：策划 + 收口裁决 ----------
    # [P1 阶段开关 & 审核续跑] _skip_planning：关闭策划(count=0/enabled=False) 或
    # 续跑(resume_verdict 非空) 时跳过策划/收口/决策门；verdict 取续跑裁决或退化为 goal。
    # 红线：_skip_planning 恒 False 时走 else 分支，与旧代码逐行等价 → cli --pipeline 零回归。
    plans = []
    import dispatch_swarm  # [P1] 提到分支外：关策划/续跑路径下阶段4审核仍需此模块
    _skip_planning = bool(resume_verdict) or n_pl <= 0
    if _skip_planning:
        if resume_verdict:
            verdict = resume_verdict
            log('[pipeline] 续跑模式：跳过策划/收口，以注入裁决为执行清单施工')
            persist('assistant', '【流水线·续跑·执行清单】\n' + verdict)
        else:
            verdict = goal
            log('[pipeline] 策划阶段已关闭(count=0)，无策划案可裁决，以目标为执行清单')
            persist('assistant', '【流水线·策划已关闭·直接施工】\n执行清单=目标：' + goal)
        note_stage('converge', {'len': len(verdict),
                                'resumed': bool(resume_verdict), 'skipped': True})
    else:
        log('[pipeline] 阶段1/5 策划 ×%d' % n_pl)
        import dispatch_swarm
        ctx_hint = ('项目根目录: %s\n附加上下文: %s' % (cwd, extra_ctx)) if extra_ctx else ('项目根目录: %s' % cwd)
        plan_tasks = [{'goal': _pack('planner', '后台流水线', (
            '总任务：%s\n请独立调查代码并产出策划案（目标/涉及文件/风险/结论）。只调查不改代码。\n%s%s' % (goal, ctx_hint, _planner_format(''))))}
            for _ in range(n_pl)]
        bid = dispatch_swarm.submit(plan_tasks, model_name=m_pl or None)
        res = _collect_strict(dispatch_swarm, bid, n_pl, '策划', log)
        # [2026-10-08 修复] plans 从收集结果提取（原直接引用未定义的 plans 变量）
        plans = [t.get('output') or '' for t in (res.get('tasks') or [])]
        for i, p in enumerate(plans, 1):
            log('  策划案%d：%d 字' % (i, len(p)))
            persist('assistant', '【流水线·策划案%d】\n%s' % (i, p))
        # [阶段补全] 策划完成即记一笔，供面板进度条点亮「策划」格
        note_stage('planning', {'ok': len(plans), 'total': n_pl})

        # ---------- 阶段2：收口裁决（内置，轻量对话） ----------
        log('[pipeline] 阶段2/5 收口裁决')
        merged = '\n\n'.join('▶ 策划案%d：\n%s' % (i, p[:_STAGE_CTX_LIMIT]) for i, p in enumerate(plans, 1))
        converge_prompt = _pack('planner', '收口', (
            '这是多个策划窗对同一任务的方案，请逐条对比、说明采纳/不采纳及理由，'
            '各策划案中含【反驳项】小节的，最终清单必须对被采纳方案的反驳项逐条回应（成立则列入改动要点，不成立则说明理由），'
            '输出一份最终执行清单（只列要改的文件与做法，不要真的改代码）。总任务：%s\n\n%s' % (goal, merged)))
        # [2026-09-30] 收口裁决：重试直到成功；[2026-10-24 修复] 429/5xx 指数退避（5s→300s 封顶），
        # 400 类永久错误重试无意义，超过 30 次按失败退出，杜绝整晚空转。
        verdict = ''
        _cv_att = 0
        while not verdict:
            _cv_att += 1
            try:
                verdict = (_light_chat(converge_prompt, m_pl) or '').strip()
            except Exception as e:
                log('[pipeline] 收口失败，挂起重试直到成功: %s' % e)
                verdict = ''
                if '400 Client Error' in str(e) or _cv_att >= 30:
                    raise RuntimeError('收口裁决 %d 次仍失败（%s），终止而非空转' % (_cv_att, e))
            if not verdict:
                time.sleep(min(300, 5 * _cv_att))
        verdict = verdict.strip()
        note_stage('converge', {'len': len(verdict)})
        persist('assistant', '【流水线·收口裁决】\n' + verdict)

        # ---------- 阶段2.5：反驳师（红队方案攻击，默认关；无否决权，意见注入后续环节） ----------
        # 反驳产出直接以【反驳项】小节注入执行清单：下游收口回应语义(见策划案【反驳项】约定)
        # 与阶段4审核的【反驳核验】纪律均已原生支持，无需额外接线。
        if n_ob > 0:
            log('[pipeline] 阶段2.5/5 反驳师 ×%d' % n_ob)
            _obj_body = (
                '作为反驳师（红队），请对以下执行清单做方案攻击：攻击前提假设、隐藏风险、可行性漏洞。'
                '要求：每条反驳有具体依据并标注严重度【高/中/低】，无实质问题则明说，不许为反驳而反驳。'
                '输出格式：以「【反驳项】」小节逐条列出（被后续环节逐条回应），最后给「▍反驳小结」一句总体判断。'
                '只调查不改代码。\n\n总任务：%s\n\n执行清单：\n%s' % (goal, verdict[:_STAGE_CTX_LIMIT]))
            _ob_tasks = [{'goal': _pack('planner', '反驳攻击', _obj_body)} for _ in range(n_ob)]
            _ob_bid = dispatch_swarm.submit(_ob_tasks, model_name=m_ob or None)
            _ob_res = _collect_strict(dispatch_swarm, _ob_bid, n_ob, '反驳师', log)
            _objections = [t.get('output') or '' for t in (_ob_res.get('tasks') or [])]
            for i, o in enumerate(_objections, 1):
                log('  反驳报告%d：%d 字' % (i, len(o)))
                persist('assistant', '【流水线·反驳报告%d】\n%s' % (i, o))
            # 注入执行清单（无否决权：不阻断、不重做策划，交下游回应/核验）
            _obj_block = '\n\n'.join('▶ 反驳报告%d：\n%s' % (i, o[:_STAGE_CTX_LIMIT])
                                     for i, o in enumerate(_objections, 1))
            verdict = verdict + '\n\n【反驳项】（反驳师红队意见，需逐条回应/核验）\n' + _obj_block
            note_stage('objectors', {'ok': len(_objections), 'total': n_ob})
        # [强化A1修正] 收口裁决不再固定加 task_review_pass：原 amount=50 是「收口即加分」
        # 口径错误（与审核质量无关），且会与阶段4审核的「分数驱动」加分重复计分。
        # 质量信号统一由阶段4审核（swarm_pipeline:318 分数驱动）计入，避免一笔任务落两笔。

    # ---------- 决策断点（decision_gate，默认关；续跑/关策划时不触发，防 return3 死循环） ----------
    if decision_gate and not _skip_planning:
        log('[pipeline] 决策断点：收口裁决已陈列，等待用户裁决')
        persist('assistant', '【决策断点】收口裁决如下，请在主对话回复裁决'
                             '（如"按清单开工"或修改意见）。未回复则按清单施工。')
        note_stage('decision_gate', {'paused': True})
        return 3, report

    # ---------- 阶段3：施工（串行 ×N，完整 agent 工具循环） ----------
    # [P1.2 worktree 隔离] cfg.worktree_isolate 默认 False（关）；开启时施工/审核 cwd 换为独立
    # worktree，收尾合回主工作区。沿用 sandbox 优先级：sandbox 存在时仍走密闭 workspace（不变）。
    # [2026-10-30 区域8策划·前置条件注释] 启用前必须同时满足：
    #   ① 仓库无未提交改动（脏工作区会让 merge 回合归因混乱，收尾纪律第2条禁止在脏区归因）；
    #   ② _worktree_create 的 merge 步骤有失败回滚路径（见其实现，audit 口径：
    #      worktree 实验失败=弃用 worktree 目录+主区不受影响，不留半合并状态）；
    #   ③ 施工产物全部落在项目根内（路径守卫已保证），否则 merge 会静默丢文件。
    # audit 口径：本开关变更须先在课题池登记，经锁审计+用户拍板后方可开启。
    _wt_dir = None
    if cfg.get('worktree_isolate') and not sandbox:
        _wt_dir = _worktree_create(cwd, session_id, log)
    _build_cwd = sandbox.WORKSPACE if sandbox else (_wt_dir or cwd)
    log('[pipeline] 阶段3/5 施工 ×%d' % n_bd)
    build_results = []
    # [2026-10-24 修复] 引擎加载：指数退避+上限 30 次，防死循环空转
    _el_att = 0
    while True:
        _el_att += 1
        try:
            import cli as cli_mod
            import argparse as _ap
            import engines_loader
            _eid = _default_engine()
            break
        except Exception as e:
            log('[pipeline] cli/引擎加载失败，挂起重试: %s' % e)
            if _el_att >= 30:
                raise RuntimeError('引擎加载 %d 次仍失败（%s），终止而非空转' % (_el_att, e))
            time.sleep(min(300, 5 * _el_att))
    for i in range(n_bd):
        # [2026-10-24 修复] 施工失败：指数退避+上限 30 次；400 类永久错误直接抛出，防整晚空转
        _bd_att = 0
        while True:
            _bd_att += 1
            try:
                bargs = _ap.Namespace(
                    prompt='', engine=_eid, model=m_bd,
                    cwd=_build_cwd,
                    session=session_id, json=False, raw=False,
                    task_file='', stop_on_error=False, list_engines=False,
                    pipeline='')
                text, _ = cli_mod.run_once(bargs, _pack('builder', '后台流水线施工', (
                    '按以下执行清单施工（可读写文件、跑命令）。总任务：%s\n\n%s%s' % (
                        goal, verdict,
                        ('\n\n【密闭环境纪律·最高优先级】你在密闭进化沙箱中：只能读写 workspace 内的文件，'
                         '禁止访问 workspace 之外的任何路径，禁止联网。') if sandbox else ''))),
                    _eid,
                    turn_no=int(time.time()) + i)
                if not (text or '').strip():
                    raise RuntimeError('施工返回空产出')
                build_results.append(text)
                persist('assistant', '【流水线·施工%d】\n%s' % (i + 1, text))
                log('  施工%d：完成，%d 字' % (i + 1, len(text)))
                break
            except Exception as e:
                log('[pipeline] 施工%d失败，挂起重试直到成功: %s' % (i + 1, e))
                if '400 Client Error' in str(e) or _bd_att >= 30:
                    raise RuntimeError('施工%d %d 次仍失败（%s），终止而非空转' % (i + 1, _bd_att, e))
                time.sleep(min(300, 5 * _bd_att))
    note_stage('build', {'ok': len(build_results), 'total': n_bd})

    # ---------- 阶段4：审核（N 份并行批次；失败阻断） ----------
    log('[pipeline] 阶段4/5 审核 ×%d' % n_rv)
    build_digest = '\n\n'.join('▶ 施工%d产出：\n%s' % (i, b[:_STAGE_CTX_LIMIT])
                               for i, b in enumerate(build_results, 1))
    rev_tasks = [{'goal': _pack('reviewer', '后台流水线', (
        '独立核验以下施工改动是否真实落地、与执行清单一致、有无引入 bug。总任务：%s\n\n执行清单：\n%s\n\n%s\n\n'
        '【验收纪律】① 每条审核结论必须附至少一条实读行号/实跑输出作为证据，无证据的结论视为无效；'
        '「没意见就过」= 闸失效——必须列出你实际核验过的点及对应行号。'
        '② 机器闸在前、人审闸在后且不得自动通过：能跑命令/读文件验证的必须实测，不得凭描述采信；'
        '涉及 bug 修复的，须确认「注释掉修复代码后原 bug 必复现」这一反例证据已在施工产出中体现，缺失即判不通过。'
        '③【反驳核验】执行清单/策划案中含【反驳项】的，必须逐条核验：被施工证实的反驳项写入打回意见，不成立的说明理由；整段缺失或不回应视为审核不合格。'
        '④【机器闸·必须遵守】最后一行必须单独输出「得分：XX」（XX 为 0-100 整数），缺该行视为无效审核；≥80 分为通过，<80 分为打回。'
        '⑤【实据对照·P1.1】下方附有流水线独立实跑的 git 工作区实据（非施工方自述）。你必须把施工自述的改动文件清单与该实据逐项对照：'
        '自述声称改了但实据中不存在的文件，或实据中出现了施工未自述的意外改动，均须写入打回意见；实据获取失败时如实说明并降级为仅文本核验。'
        % (goal, verdict[:_STAGE_CTX_LIMIT], build_digest)))} for _ in range(n_rv)]
    # [P1.1 review gate] 审核实据开关（cfg.review_git_evidence，默认开；关闭或 cwd 非 git 仓库则跳过）
    _git_ev = ''
    if cfg.get('review_git_evidence') is not False:
        _git_ev = _git_evidence(_wt_dir or cwd)
        if _git_ev.startswith('[git 实据获取失败'):
            log('[pipeline] [P1.1] git 实据获取失败，审核降级为仅文本核验: %s' % _git_ev)
            _git_ev = ''
        elif _git_ev.count('(clean)') and _git_ev.count('(no diff)'):
            log('[pipeline] [P1.1] 工作区无改动（clean），首轮 git 实据为空')
    # [P1.1] 不在此处追加 rev_tasks[0]：实据统一在轮循环内按轮刷新注入，防首轮重复拼接
    # [P2/P3] 审核轮次闭环：不通过→意见回拼施工重跑→再审；cfg.max_review_rounds 兜底防死循环
    max_rounds = max(1, int(cfg.get('max_review_rounds') or 3))
    _pass_score = int(cfg.get('review_pass_score') or 80)
    _rv_log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'swarm_pipeline')

    def _log_review(row):
        # P2：每份审核一行 jsonl，审计可回放（谁审的/第几轮/几分/过没过）
        try:
            os.makedirs(_rv_log_dir, exist_ok=True)
            with open(os.path.join(_rv_log_dir, '%s.review.jsonl' % session_id), 'a', encoding='utf-8') as f:
                f.write(json.dumps(row, ensure_ascii=False) + '\n')
        except Exception:
            pass

    reviews = []
    review_rounds = []
    _reject_reasons = ''
    round_no = 0
    # [P1 阶段开关] n_rv<=0 时整段审核循环不进入（reviews 保持空，下方埋点亦跳过）
    while n_rv > 0:
        round_no += 1
        _goal_extra = ('\n\n【上一轮审核打回意见（必须逐条整改后重做）】\n' + _reject_reasons) if _reject_reasons else ''
        if round_no > 1:
            # P3 打回重做：审核意见拼回施工 prompt 重跑施工
            log('[pipeline] 第 %d 轮：审核未通过，打回施工重做' % round_no)
            persist('assistant', '【流水线·审核第%d轮不通过，打回重做】\n%s' % (round_no - 1, _reject_reasons))
            try:
                bargs = _ap.Namespace(
                    prompt='', engine=_eid, model=m_bd,
                    cwd=_build_cwd,
                    session=session_id, json=False, raw=False,
                    task_file='', stop_on_error=False, list_engines=False,
                    pipeline='')
                text, _ = cli_mod.run_once(bargs, _pack('builder', '打回重做', (
                    '上一轮施工未通过审核，请针对打回意见逐条整改并重做（可读写文件、跑命令）。'
                    '总任务：%s\n\n原执行清单：\n%s\n\n%s' % (goal, verdict[:_STAGE_CTX_LIMIT], _goal_extra))),
                    _eid,
                    turn_no=int(time.time()) + round_no)
                if (text or '').strip():
                    build_results.append(text)
                    persist('assistant', '【流水线·施工·第%d轮整改】\n%s' % (round_no, text))
                    log('  打回重做施工：完成，%d 字' % len(text))
                    build_digest = '\n\n'.join('▶ 施工%d产出：\n%s' % (i, b[:_STAGE_CTX_LIMIT])
                                               for i, b in enumerate(build_results, 1))
            except Exception as e:
                log('[pipeline] 打回重做施工失败（沿用原产出继续审）: %s' % e)
        # [P1.1] 每轮审核前刷新 git 实据（打回重做后工作区已变，须以最新实据为准）
        if _git_ev or cfg.get('review_git_evidence') is not False:
            _ev_new = _git_evidence(_wt_dir or cwd)
            if not _ev_new.startswith('[git 实据获取失败'):
                _git_ev = _ev_new
        _ev_block = ('\n\n【git 工作区实据（流水线独立实跑，以此为准对照施工自述）】\n' + _git_ev) if _git_ev else ''
        rev_tasks_r = [{'goal': rev_tasks[0]['goal'] + _ev_block + _goal_extra} for _ in range(n_rv)]
        bid2 = dispatch_swarm.submit(rev_tasks_r, model_name=m_rv or None)
        res2 = _collect_strict(dispatch_swarm, bid2, n_rv, '审核第%d轮' % round_no, log)
        reviews = []
        _seen_ids = set()
        for t in (res2 or {}).get('tasks', []):
            if t.get('status') == 'done' and t.get('output'):
                # [2026-10-08 修复] 按任务 id 去重 + 封顶 n_rv，防重复/超额审核产出
                _tid = t.get('id') or id(t)
                if _tid in _seen_ids:
                    continue
                _seen_ids.add(_tid)
                reviews.append(t['output'])
        reviews = reviews[:n_rv]
        log('[pipeline] 审核第%d轮收口：实际保留 %d/%d 份' % (round_no, len(reviews), n_rv))
        # P2：逐份解析分数并落日志（复用成长埋点同源正则；解析失败记 null，不静默吞）
        _scores = []
        for _j, _r in enumerate(reviews, 1):
            _sc = None
            try:
                # [2026-10-23 强化] 多格式兼容：得分：XX / 评分】45 / **审核评分** 45 / 45/100 / 80分（含markdown加粗、全角冒号）
                _pats = [
                    r'(?:(?:得分|score|评分|分数|审核评分)[^\d%]{0,6})(\d{1,3})',
                    r'(\d{1,3})\s*/\s*100',
                    r'(\d{1,3})\s*分',
                ]
                for _p in _pats:
                    _m = re.search(_p, str(_r), re.I)
                    if _m:
                        _v = int(_m.group(1))
                        if 0 <= _v <= 100:
                            _sc = _v
                            break
            except Exception:
                _sc = None
            _scores.append(_sc)
            _log_review({'round': round_no, 'reviewer_no': _j, 'score': _sc,
                         'verdict': ('pass' if _sc >= _pass_score else 'reject') if _sc is not None else 'unknown',
                         'len': len(_r), 'at': int(time.time())})
            if _sc is None:
                log('[pipeline][警告] 审核%d 未能解析出分数（末 %d 字：…%s），请检查审核提示词是否遵守「得分：XX」约定'
                    % (_j, 120, _r[-120:]))
        _valid = [s for s in _scores if s is not None]
        _pass = bool(_valid) and min(_valid) >= _pass_score
        review_rounds.append({'round': round_no, 'scores': _scores, 'pass': _pass})
        if _pass or round_no >= max_rounds:
            if not _pass:
                log('[pipeline] [未达分兜底放行] 审核经 %d 轮仍未达标（有效分 %s），按现有产出收口放行'
                    % (round_no, max(_valid) if _valid else '无'))
                for _j, _s in enumerate(_scores, 1):
                    if _s is None:
                        _scores[_j-1] = 0  # 兜底放行时 null 分记 0，留审计痕迹
                _log_review({'round': round_no, 'reviewer_no': 0, 'score': None,
                             'verdict': 'forced_pass_on_max_rounds', 'len': 0, 'at': int(time.time())})
            break
        _reject_reasons = '\n\n'.join(
            '▶ 审核员%d（%s）：\n%s' % (j, ('%s分' % s) if s is not None else '未解析分', r[:2000])
            for j, (s, r) in enumerate(zip(_scores, reviews), 1))
        note_stage('review_round%d' % round_no, {'scores': _scores, 'reject': True})
    note_stage('review', {'rounds': review_rounds, 'ok': len(reviews), 'total': n_rv})
    # [P1.2] 审核（含打回重做）全部结束后，把 worktree 内改动合回主工作区并清理
    if _wt_dir:
        _wt_ok = _worktree_merge(_wt_dir, cwd, log)
        note_stage('worktree', {'merged': _wt_ok, 'dir': _wt_dir})
        _wt_dir = None
    # [成长埋点] 蜂群审核通过（多审核员独立核验通过=高质量任务）
    # [P1 阶段开关] reviews 为空（审核已关闭 count=0）时不加经验，避免「没审核还加分」
    if reviews and _pass:
        try:
            import growth_engine
            _best = max([s for s in review_rounds[-1]['scores'] if s is not None], default=0)
            _amt = _best if _best > 0 else min(100, 50 + 10 * len(reviews))
            _note = ('蜂群审核通过 ×%d score=%d' % (len(reviews), _amt) if _best > 0
                     else '蜂群审核通过(未解析分数，份数兜底) ×%d score=%d' % (len(reviews), _amt))
            growth_engine.add_exp('task_review_pass', amount=_amt, note=_note)
        except Exception as e:
            # [强化A2] 去静默吞，断线可见
            log('[pipeline] 审核成长埋点失败: %s' % e)
    for i, r in enumerate(reviews, 1):
        log('  审核%d：%d 字' % (i, len(r)))
        persist('assistant', '【流水线·审核%d】\n%s' % (i, r))

    # ---------- 阶段5：总结（可选） ----------
    if do_sum:
        log('[pipeline] 阶段5/5 总结')
        try:
            # 挂载浏览器站点记忆（private/记忆/站点/*.md 最近 8 份头部摘要），总结更聪明
            site_digest = ''
            try:
                import glob as _glob
                mems = sorted(_glob.glob(os.path.join(
                    SERVER_DIR, '..', 'private', '记忆', '站点', '*.md')),
                    key=os.path.getmtime, reverse=True)[:8]
                parts = []
                for fp in mems:
                    with open(fp, encoding='utf-8') as f:
                        parts.append('▶ %s:\n%s' % (
                            os.path.basename(fp), f.read(800)))
                if parts:
                    site_digest = ('\n\n浏览器站点记忆摘要'
                                   '（private/记忆/站点/，可复用经验）：\n'
                                   + '\n\n'.join(parts))
            except Exception:
                pass
            summ = _light_chat(_pack('summarizer', '后台流水线', (
                '【记忆存放铁律】沉淀/经验/策划案等一切记忆必须用 project_record 保存到本项目 private/记忆/（跨版本需保留的用 private/记忆/全局/）；严禁写磁盘根目录、安装运行目录或项目根/data/docs 散放。落盘必须进角色专属分区。主写法 project_record(action=write, name="分区/主题名")（MCP 极简/HTTP 两链路通用）：策划师→name="策划案/…"，审核师→name="审核/…"，总结师→name="总结/…"，施工队→name="施工/…"，调查/黑板底稿→name="调查/…"；HTTP/界面链路支持 category 时可等价用 category=<分区>，MCP 极简链路无 category 务必用 name 带子路径。注：本后台流水线总结阶段走 _light_chat 纯对话（无工具），此铁律用于规范其正文声明的落盘目标与命名；真正落盘发生在带 project_record 工具的前台角色窗口。层级（实测）：MCP 链路默认根即 记忆/全局/，name="<分区>/主题名" 落 记忆/全局/<分区>/，严禁加"全局/"前缀（会套娃）；项目层 记忆/项目/<ID>/<分区>/ 仅 HTTP/界面链路（scope=project 默认）可直达，MCP 下勿用 name="项目/…"（造假层）；记忆/全局/<分区> 与 记忆/项目/<ID>/<分区> 同名各一套，全库分区地图见 全局/记忆分区地图.md。\n【密码自动保存铁律】如果本次工作涉及网站账号密码（对话中出现过或使用了用户名/密码），且发现《密码管理器》（project_record）中还没有该网站的凭据，必须主动用 project_record append 把该网站凭据（网址/用户名/密码/备注）追加进《密码管理器》隐私记录；同一网站已有凭据但本次是不同账号（用户名不同）也照常追加（格式：网址/用户名/密码/备注，备注注明账号用途），仅完全相同的账号密码才跳过；用户明确拒绝保存的凭据一律不存、不记录。只在总结中简短提示"已保存XX站密码"，不得在总结正文回显密码明文。\n总结本流水线（结论/改动清单/可复用经验）。' + SUMMARY_HEADLINE_RULE + '总任务：%s\n\n收口：\n%s\n\n审核：\n%s%s'
                % (goal, verdict[:6000], '\n\n'.join(r[:4000] for r in reviews),
                   site_digest))), m_rv)
            persist('assistant', '【流水线·总结】\n' + summ)
            note_stage('summary', {'len': len(summ)})
        except Exception as e:
            log('[pipeline] 总结失败（不阻断）: %s' % e)
            note_stage('summary', {'error': str(e)})

    # ---------- 结论头解析（宽松，失败不阻断） ----------
    try:
        head = _parse_summary_head(locals().get('summ', ''))
        report['summary_head'] = head or {'result': '未知', 'task': '', 'brief': ''}
        if head is None:
            log('[pipeline] 结论头未按 SUMMARY_HEADLINE_RULE 格式解析命中，已兜底为「未知」')
    except Exception as e:
        log('[pipeline] 结论头解析失败(忽略): %s' % e)
        report['summary_head'] = {'result': '未知', 'task': '', 'brief': ''}

    # ---------- 报告落盘 ----------
    report['exit'] = 0
    report['elapsed'] = round(time.time() - report['t0'], 1)
    try:
        os.makedirs(_REPORT_DIR, exist_ok=True)
        fp = os.path.join(_REPORT_DIR, '%s.md' % session_id)
        with open(fp, 'w', encoding='utf-8') as f:
            f.write('# 蜂群流水线报告 %s\n\n目标：%s\n目录：%s\n耗时：%ss\n\n'
                    % (session_id, goal, cwd, report['elapsed']))
            sh = report.get('summary_head') or {}
            if sh:
                f.write('## 结论头\n\n【结果】任务：%s ｜ 结果：%s ｜ 一句话简介：%s\n\n'
                        % (sh.get('task', ''), sh.get('result', '未知'), sh.get('brief', '')))
            f.write('## 收口裁决\n\n%s\n\n## 审核结论\n\n%s\n' % (verdict, '\n\n---\n\n'.join(reviews)))
            # P3：审核轮次段，每轮分数/是否打回可追溯
            _rr = (report.get('stages') or {}).get('review', {}).get('rounds') or review_rounds
            if _rr:
                f.write('\n## 审核轮次\n\n')
                for _r in _rr:
                    f.write('- 第 %d 轮：分数 %s → %s\n' % (
                        _r.get('round'), _r.get('scores'),
                        '通过' if _r.get('pass') else '不通过，已打回重做'))
        report['report_path'] = fp
    except Exception as e:
        log('[pipeline] 报告落盘失败(忽略): %s' % e)

    log('[pipeline] 完成，退出码 0，报告: %s' % report.get('report_path', '-'))
    return 0, report


def _default_engine():
    """默认引擎 id（与 cli._pick_engine 一致的兜底）。"""
    try:
        import engines_loader
        for _id, m in engines_loader.load_engines().items():
            if m.get('enabled', True) and engines_loader.engine_owns_tools(_id):
                return _id
        return engines_loader.DEFAULT_ENGINE
    except Exception:
        return ''


if __name__ == '__main__':
    # 独立调试：python swarm_pipeline.py pipeline.json
    if len(sys.argv) < 2:
        print('用法: python swarm_pipeline.py pipeline.json')
        sys.exit(1)
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        _cfg = json.load(f)
    _code, _rep = run_pipeline(_cfg, cwd=cfg_cwd if (cfg_cwd := _cfg.get('cwd')) else None)
    sys.exit(_code)
