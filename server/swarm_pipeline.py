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
import sys
import json
import time
import traceback

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)
ENGINES_DIR = os.path.join(SERVER_DIR, 'engines')
if ENGINES_DIR not in sys.path:
    sys.path.insert(0, ENGINES_DIR)

from engines.common.material_pack_prefixes import (
    GREETING_EXEMPT_TEXT,
)

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
    """阶段配置归一化：允许数字（并发份数）或 {count, model} 形式。"""
    if stage_cfg is None:
        return n_default, ''
    if isinstance(stage_cfg, int):
        return max(1, stage_cfg), ''
    if isinstance(stage_cfg, dict):
        return max(1, int(stage_cfg.get('count', n_default))), str(stage_cfg.get('model', '') or '')
    return n_default, ''


def _collect_strict(ds, batch_id, n_total, stage_name):
    """严格收口：轮询批次直到所有子任务都成功（done 且有产出）才返回。
    不成功绝不返回：failed/partial/running 都继续重试（最多 5 轮全批重提）或继续挂起等待。
    [2026-09-30] 应用户要求移除 600 秒兜底与"部分成功即放行"逻辑。"""
    attempt = 0
    while True:
        res = ds.collect(batch_id, wait_sec=0) or {}
        tasks = res.get('tasks', [])
        oks = [t for t in tasks if t.get('status') == 'done' and t.get('output')]
        if len(oks) >= n_total:
            log('[pipeline] %s批次 %s 全部 %d 份成功' % (stage_name, batch_id, n_total))
            return res
        # 未成功的子任务：失败的重投一批补跑，running 的继续等
        failed = [t for t in tasks if t.get('status') == 'failed']
        running = len(tasks) - len(oks) - len(failed)
        if failed and attempt < 5:
            attempt += 1
            retry_tasks = [{'goal': t['goal']} for t in failed]
            log('[pipeline] %s批次有 %d 份失败，第 %d 次补跑' % (stage_name, len(failed), attempt))
            new_bid = ds.submit(retry_tasks, model_name=None)
            r2 = ds.collect(new_bid, wait_sec=0) or {}
            tasks = tasks + (r2.get('tasks') or [])
        if running > 0 or attempt >= 5:
            log('[pipeline] %s批次未收口（成功%d/%d，运行中%d），继续挂起等待' % (
                stage_name, len(oks), n_total, running))
            time.sleep(3)
        # 全失败且重试额度用尽 → 继续无限挂起，绝不中途返回
        time.sleep(2)


def run_pipeline(cfg, cwd=None, log=print):
    """执行一条蜂群流水线，返回 (exit_code, report_dict)。

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

    # ---------- 阶段1：策划（N 份并行 dispatch_swarm 批次） ----------
    log('[pipeline] 阶段1/5 策划 ×%d' % n_pl)
    import dispatch_swarm
    ctx_hint = ('项目根目录: %s\n附加上下文: %s' % (cwd, extra_ctx)) if extra_ctx else ('项目根目录: %s' % cwd)
    plan_tasks = [{'goal': _pack('planner', '后台流水线', (
        '总任务：%s\n请独立调查代码并产出策划案（目标/涉及文件/风险/结论）。只调查不改代码。\n%s' % (goal, ctx_hint)))}
        for _ in range(n_pl)]
    bid = dispatch_swarm.submit(plan_tasks, model_name=m_pl or None)
    res = _collect_strict(dispatch_swarm, bid, n_pl, '策划')
    for i, p in enumerate(plans, 1):
        log('  策划案%d：%d 字' % (i, len(p)))
        persist('assistant', '【流水线·策划案%d】\n%s' % (i, p))

    # ---------- 阶段2：收口裁决（内置，轻量对话） ----------
    log('[pipeline] 阶段2/5 收口裁决')
    merged = '\n\n'.join('▶ 策划案%d：\n%s' % (i, p[:_STAGE_CTX_LIMIT]) for i, p in enumerate(plans, 1))
    converge_prompt = _pack('planner', '收口', (
        '这是多个策划窗对同一任务的方案，请逐条对比、说明采纳/不采纳及理由，'
        '输出一份最终执行清单（只列要改的文件与做法，不要真的改代码）。总任务：%s\n\n%s' % (goal, merged)))
    # [2026-09-30] 收口裁决：无限重试直到成功，绝不降级兜底
    verdict = ''
    while not verdict:
        try:
            verdict = (_light_chat(converge_prompt, m_pl) or '').strip()
        except Exception as e:
            log('[pipeline] 收口失败，挂起重试直到成功: %s' % e)
            verdict = ''
        if not verdict:
            time.sleep(5)
    verdict = verdict.strip()
    note_stage('converge', {'len': len(verdict)})
    persist('assistant', '【流水线·收口裁决】\n' + verdict)

    # ---------- 决策断点（decision_gate，默认关） ----------
    if decision_gate:
        log('[pipeline] 决策断点：收口裁决已陈列，等待用户裁决')
        persist('assistant', '【决策断点】收口裁决如下，请在主对话回复裁决'
                             '（如"按清单开工"或修改意见）。未回复则按清单施工。')
        note_stage('decision_gate', {'paused': True})
        return 3, report

    # ---------- 阶段3：施工（串行 ×N，完整 agent 工具循环） ----------
    log('[pipeline] 阶段3/5 施工 ×%d' % n_bd)
    build_results = []
    # [2026-09-30] 引擎加载失败：无限重试直到成功，绝不中途返回
    while True:
        try:
            import cli as cli_mod
            import argparse as _ap
            import engines_loader
            _eid = _default_engine()
            break
        except Exception as e:
            log('[pipeline] cli/引擎加载失败，挂起重试: %s' % e)
            time.sleep(5)
    for i in range(n_bd):
        # [2026-09-30] 施工失败：无限重试直到成功，绝不中途返回
        while True:
            try:
                bargs = _ap.Namespace(
                    prompt='', engine=_eid, model=m_bd,
                    cwd=cwd, session=session_id, json=False, raw=False,
                    task_file='', stop_on_error=False, list_engines=False,
                    pipeline='')
                text, _ = cli_mod.run_once(bargs, _pack('builder', '后台流水线施工', (
                    '按以下执行清单施工（可读写文件、跑命令）。总任务：%s\n\n%s' % (goal, verdict))),
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
                time.sleep(5)
    note_stage('build', {'ok': len(build_results), 'total': n_bd})

    # ---------- 阶段4：审核（N 份并行批次；失败阻断） ----------
    log('[pipeline] 阶段4/5 审核 ×%d' % n_rv)
    build_digest = '\n\n'.join('▶ 施工%d产出：\n%s' % (i, b[:_STAGE_CTX_LIMIT])
                               for i, b in enumerate(build_results, 1))
    rev_tasks = [{'goal': _pack('reviewer', '后台流水线', (
        '独立核验以下施工改动是否真实落地、与执行清单一致、有无引入 bug。总任务：%s\n\n执行清单：\n%s\n\n%s'
        % (goal, verdict[:_STAGE_CTX_LIMIT], build_digest)))} for _ in range(n_rv)]
    bid2 = dispatch_swarm.submit(rev_tasks, model_name=m_rv or None)
    res2 = _collect_strict(dispatch_swarm, bid2, n_rv, '审核')
    reviews = []
    for t in (res2 or {}).get('tasks', []):
        if t.get('status') == 'done' and t.get('output'):
            reviews.append(t['output'])
    note_stage('review', {'batch': bid2, 'ok': len(reviews), 'total': n_rv})
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
                '总结本流水线（结论/改动清单/可复用经验）。总任务：%s\n\n收口：\n%s\n\n审核：\n%s%s'
                % (goal, verdict[:6000], '\n\n'.join(r[:4000] for r in reviews),
                   site_digest))), m_rv)
            persist('assistant', '【流水线·总结】\n' + summ)
            note_stage('summary', {'len': len(summ)})
        except Exception as e:
            log('[pipeline] 总结失败（不阻断）: %s' % e)
            note_stage('summary', {'error': str(e)})

    # ---------- 报告落盘 ----------
    report['exit'] = 0
    report['elapsed'] = round(time.time() - report['t0'], 1)
    try:
        os.makedirs(_REPORT_DIR, exist_ok=True)
        fp = os.path.join(_REPORT_DIR, '%s.md' % session_id)
        with open(fp, 'w', encoding='utf-8') as f:
            f.write('# 蜂群流水线报告 %s\n\n目标：%s\n目录：%s\n耗时：%ss\n\n'
                    % (session_id, goal, cwd, report['elapsed']))
            f.write('## 收口裁决\n\n%s\n\n## 审核结论\n\n%s\n'
                    % (verdict, '\n\n---\n\n'.join(reviews)))
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
