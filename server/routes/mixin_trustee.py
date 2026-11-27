# -*- coding: utf-8 -*-
"""Mixin: i托管（trustee）——后台注意力管家 v0.1（P0 地基）

路由：
  GET  /api/trustee/status     托管状态简报（enabled/pool_state/seen_turns/brief）
  POST /api/trustee/config     开关 {enabled: true/false}——唯一开关：
                               开=AI全自动；关=人类接手（停止新巡查，在途裁决标 stale）
设计依据：private/记忆/策划案-i托管-20261115.md v1.7（五条铁律 + 精度补丁 #1/#3/#6/#7/#8）
读态真源：chat_pool.status_snapshot()（服务端内存快照，浏览器关也在跑，mixin_chat_pool.py:216 实测）
落盘真源：server/data/trustee.json（写探针实测可写可读）

v1.7 条款落实：
- #6 补扫：以 turn_id 集合差为准（seen 集合持久化），不依赖时间戳单调递进；快照易失（turn done
  可能被下一轮 submit 覆盖），漏检的 turn 从 trustee.json seen 集合对账补看。
- #7 熔断：连败 3 次熔断转人工，唯一解除=用户手动关→开（config enabled 切换时重置熔断计数）。
- #8 关闭：停止新巡查 + 在途事项标记 stale 不执行 + 简报留一行交接说明。
- #1 完成度评估主体/证据形式为 P1.5 LLM 审批阶段事项，本文件只做 P0 读态轮询与简报，不含任何裁决逻辑（防 v1.0 if-else 伪代码复活）。

P1.5 自动重派（2026-11-17，用户诉求：箭头返回后托管应确认结果并重新派出）：
- 触发：turn 到达 done 且 LLM 审批 verdict=reject（声称与实测不符/需返工）时，
  自动把该 turn 用【同一 turn_id】幂等重投对话池（复用 pool_resume._recover_one 同款
  机制：从 private/chat_pool_resume.json 暂存快照取原 body，注入「继续」提示）。
- 红线（全部满足才派）：
  1) verdict 必须= reject（approve/abstain 只简报不动手，宁缺勿滥）；
  2) 池开关开 + 托管开 + 未熔断；
  3) 同一 turn_id 最多自动重派 1 次（_redispatched 集合持久化，防无限循环）；
  4) 每轮巡查最多派 2 个（防批量惊群）；
  5) messages 末尾为 tool/assistant 的 AI 派生轮不派（护栏同 pool_resume._is_user_initiated，
     防派生轮重投导致对话凭空变多）；
  6) 仅当 resume 登记里还能捞到原 body 才能派（捞不到=无重派凭据，判死登记 rd_dead，
     转人工，不再每轮重试刷屏——2026-11-22 运行时实测修复）。

P2 收口裁决+自动派团队成员（2026-11-22，用户三点诉求落地）：
- LLM 审批员输出双分数：progress=工程完成度、review=审核质量分（0-100，按证据独立评，
  不接受自报值；见 trustee_llm_review.JUDGE_SYS_PROMPT）。
- 铁律门槛（用户铁律1/2，代码层执行）：进度≥95 且 审核>90 才可收口（adopt）；
  任一<60 → redo（换队重做）；其余 → dispatch_optimize/dispatch_verify；
  LLM reject 与分数达标矛盾时降级 dispatch_verify（不得收口护栏）。
- 自动派团队成员：按裁决查【宏命令库】data/trustee_macros.json（用户可编辑，
  首启自动落盘默认宏），展开占位符 {title}{tid}{progress}{review}{reason} 后调
  小镇派单 domain_town._town_assign_impl（真引擎+真工具+交付物硬校验+审单闸）。
- 派团红线：team_enabled 开关 + 每日上限（默认6）+ 同 turn_id 只派一次 + 未熔断；
  台账 team_jobs 落盘 trustee.json 可回溯。
- 僵尸收敛：离开快照超 24h 无进展的在途任务标 stale 转人工（不再永远挂「进行中」）。

P2.4 工单回查闭环（2026-11-23，用户诉求"派完单没人管"实锤修复）：
- 派团队单后每轮巡查对账 server/data/town_jobs.json（小镇工单阶段台账，
  domain_town._town_jobs_snapshot）：done/failed/dead 回写 team_jobs.settled 并简报；
  failed/dead → 转人工（防烧钱不自动重派，同 turn_id 只派一次红线不变）。
- 重启复活的工单（旧单 dead + revived_as 改道）跟随新 job_id 继续观察，不误报死亡。
- 非终态超 30 分钟无心跳视同死亡（兜底：复活扫描未跑/台账文件丢失的场景）。
- 早于持久化的历史单（无台账记录）一次性结清，不刷屏。

P2.5 团队单产出复审（2026-11-23 第3轮，闭环第三道意见）：
- 工单 done 后从 task 提取产出文件（outputs_villager/xxx.md）读正文喂 LLM 审批员独立复审，
  verdict/双分数回写 team_jobs.recheck 并简报；每轮巡查至多 1 次（防卡死巡查）。
- 纪律：复审结论只简报不自动重派（审单员村民+托管复审已两道意见，再自动派=自激励烧钱）。
- 开关 cfg.team_recheck（默认开，POST /api/trustee/config 可关）。
- 同轮：trustee.json 落盘改临时文件+os.replace 原子替换（与 town_jobs.json 同口径）。
"""
import json
import os
import threading
import time

from routes.mixin_base import MixinBase

TRUSTEE_JSON = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            'data', 'trustee.json')
TRUSTEE_MACRO_JSON = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                  'data', 'trustee_macros.json')
TRUSTEE_POLL_SEC = 60          # 巡查间隔（策划案 v1.1：60s；#6 漏检由 seen 集合对账兜底）
TRUSTEE_START_SILENT = 300     # 条款D 重启防抖：启动 5 分钟静默期
TRUSTEE_FUSE_LIMIT = 3         # 条款 #7：连败 3 次熔断
# P2 收口铁律（策划案 v1.7 用户铁律1/2）：完成度≥95 才可送审；审核全部分数>90 才可关闭。
# 分数由 LLM 审批员按证据独立评估（决策层=LLM），本文件代码层只做门槛执行（手脚+安全带）。
TRUSTEE_PROGRESS_PASS = 95
TRUSTEE_REVIEW_PASS = 90
TRUSTEE_TEAM_DAILY_CAP = 6     # 派团队成员（真引擎真工具，花钱类操作）每日上限（策划案红线）


def _today():
    """动态取当天日期（修复：原 import 期定死会导致跨午夜后每日派团计数永不重置）。"""
    return time.strftime('%Y-%m-%d')

_lock = threading.Lock()
_thread = None
_stop_event = threading.Event()   # P1挂账②：睡眠可中断（关开关/停巡查立即唤醒，不等最长300s）
_warned_gone = set()   # 安全师#2：已告警"离开快照"的 tid，防简报刷屏
_state = {
    'enabled': False,
    'started_at': 0,
    'last_poll_at': 0,
    'poll_count': 0,
    'seen_turns': {},      # turn_id -> {box_id, state, first_seen, last_seen}
    'fuse_count': 0,
    'fused': False,
    'stale_items': [],     # 条款 #8：关闭时在途事项标 stale
    'brief': [],           # 简报行（最新在头部）
    'pool_enabled': None,  # 条款A：池开关前置检查，False 则降级只读 db 模式提示
    'redispatched': [],    # P1.5：已自动重派过的 turn_id（红线3：同 tid 只派一次）
    'rd_dead': [],         # P2.1：重派已判死 tid（无凭据/池拒/派生轮，防每轮重试刷屏）
    '_rd_batch': 0,        # P1.5：本轮巡查已重派计数（红线4 限流）
    'team_jobs': [],       # P2.2：已派团队成员工单（最新在头部，上限40）
    'team_daily': {'date': _today(), 'count': 0},   # 派团每日计数（红线：花钱类设上限）
    'cfg': {'progress_pass': TRUSTEE_PROGRESS_PASS, 'review_pass': TRUSTEE_REVIEW_PASS,
            'team_enabled': True, 'team_daily_cap': TRUSTEE_TEAM_DAILY_CAP,
            'team_recheck': True, 'stale_job_sec': 1800},
}


def _load():
    # P1挂账③（审核员）：区分"文件不存在"（首次启动属正常，不告警）与"损坏"（真异常才 warn）
    if not os.path.exists(TRUSTEE_JSON):
        return  # 首启无状态文件，保持默认态，静默
    try:
        with open(TRUSTEE_JSON, 'r', encoding='utf-8') as f:
            d = json.load(f)
        if isinstance(d, dict):
            _state['enabled'] = bool(d.get('enabled'))
            _state['seen_turns'] = d.get('seen_turns') or {}
            _state['redispatched'] = d.get('redispatched') or []
            _state['rd_dead'] = d.get('rd_dead') or []
            _state['team_jobs'] = d.get('team_jobs') or []
            td = d.get('team_daily') or {}
            if td.get('date') == _today():
                _state['team_daily'] = {'date': td.get('date'), 'count': int(td.get('count') or 0)}
            cfg = d.get('cfg') or {}
            if isinstance(cfg, dict):
                for k in ('progress_pass', 'review_pass', 'team_daily_cap'):
                    if isinstance(cfg.get(k), int) and 0 <= cfg[k] <= 100:
                        _state['cfg'][k] = cfg[k]
                _state['cfg']['team_enabled'] = bool(cfg.get('team_enabled', True))
                _state['cfg']['team_recheck'] = bool(cfg.get('team_recheck', True))  # P2.5 团队单产出复审开关
                _v_stale = cfg.get('stale_job_sec')  # P2.6 工单超时无心跳阈值（默认1800s，纯LLM长生成场景可调大）
                if isinstance(_v_stale, int) and 300 <= _v_stale <= 86400:
                    _state['cfg']['stale_job_sec'] = _v_stale
    except Exception as e:
        # 代码师第2轮#2：trustee.json 损坏/不可读时告警，不再静默丢开关状态
        # （import 期调用安全：_brief 纯内存不落盘不回调）
        _brief('trustee.json 读取失败（文件损坏或不存在），开关状态已回退默认: %s' % e, 'warn')


def _save():
    # P2.5（2026-11-23 第3轮）：临时文件+os.replace 原子替换——trustee.json 与
    # town_jobs.json 同口径。直接覆写若进程死于写入中途会留半截损坏 JSON，
    # 重启后开关状态全丢（_load 已有损坏告警，但数据回不来）。
    try:
        os.makedirs(os.path.dirname(TRUSTEE_JSON), exist_ok=True)
        _tmp = TRUSTEE_JSON + '.tmp'
        with open(_tmp, 'w', encoding='utf-8') as f:
            json.dump({
                'enabled': _state['enabled'],
                'seen_turns': _state['seen_turns'],
                'fused': _state['fused'],
                'fuse_count': _state['fuse_count'],
                'last_poll_at': _state['last_poll_at'],
                'redispatched': _state.get('redispatched') or [],
                'rd_dead': _state.get('rd_dead') or [],
                'team_jobs': (_state.get('team_jobs') or [])[:40],
                'team_daily': _state.get('team_daily') or {},
                'cfg': _state.get('cfg') or {},
            }, f, ensure_ascii=False, indent=1)
        os.replace(_tmp, TRUSTEE_JSON)
    except Exception as e:
        # 代码师#3：不再静默吞错，写简报告警（_brief 不回调 _save，无递归风险）
        _brief('trustee.json 落盘失败: %s' % e, 'warn')


# ---------- P2.2 宏命令库（decision → role/task 模板，用户可改 trustee_macros.json） ----------
# 模板纪律（2026-11-22 生产实锤）：交付物要求必须写明具体文件名——村民空手报 done 会被
# outputs_villager 交付物硬闸判败（6/6 单 no_deliverable 的教训）。
# 第2轮口径升级（2026-11-23）：「第一件事先建产出文件」会诱导村民先建骨架占坑，
# 实测骨架骗过存在闸、成稿前死亡全单蒸发 → 改「先取证再成稿」，与 domain_town
# _deliverable_gate 内容闸同口径（占位标记/不足100字节=判败）。
_GATE_RULE = '交付以最终成稿验收：文件含「草稿/取证中/待补」等占位字样或不足100字节=判败'
_DEFAULT_MACROS = {
    'dispatch_optimize': {
        'label': '优化宏', 'role': '', 'enabled': True,
        'task': '【先取证，再成稿】最终把完整分析与方案写入 outputs_villager/optimize-{tid}.md，'
                '没有该文件=本单判败（%s）。然后执行：【i托管·优化单】任务「{title}」初审未达收口门槛：'
                '工程进度{progress}分/审核{review}分（门槛：进度≥{progress_pass}，审核>{review_pass}）。'
                '问题：{reason}。请复核后给出优化方案与证据（写入上述文件），不要改动项目其他文件。'
                % _GATE_RULE},
    'dispatch_verify': {
        'label': '验证宏', 'role': '', 'enabled': True,
        'task': '【先取证，再成稿】把验证证据完整写入 outputs_villager/verify-{tid}.md，'
                '没有该文件=本单判败（%s）。然后执行：【i托管·验证单】请用真实工具独立复核任务「{title}」'
                '的真实完成情况（原审批：进度{progress}分/审核{review}分；理由：{reason}）。'
                '把验证证据（命令输出/diff/文件清单）写入上述文件。' % _GATE_RULE},
    'redo': {
        'label': '重做宏', 'role': '', 'enabled': True,
        'task': '【先取证，再成稿】把重做结果与证据完整写入 outputs_villager/redo-{tid}.md，'
                '没有该文件=本单判败（%s）。然后执行：【i托管·重做单】任务「{title}」质量不达标'
                '（进度{progress}分/审核{review}分，有分数低于60需重做）。问题：{reason}。'
                '请从头核查需求并真实完成，把完成结果、证据（命令输出/diff）写入上述文件。' % _GATE_RULE},
}


def _load_macros():
    """宏命令库：优先用户文件 trustee_macros.json；缺字段用默认宏补齐。"""
    lib = {}
    try:
        if os.path.exists(TRUSTEE_MACRO_JSON):
            with open(TRUSTEE_MACRO_JSON, 'r', encoding='utf-8') as f:
                d = json.load(f)
            if isinstance(d, dict):
                lib = {k: v for k, v in d.items()
                       if isinstance(v, dict) and k in _DEFAULT_MACROS}
    except Exception as e:
        _brief('trustee_macros.json 读取失败，宏命令回退内置默认: %s' % e, 'warn')
    out = {}
    for k, base in _DEFAULT_MACROS.items():
        m = dict(base)
        u = lib.get(k) or {}
        if u:
            for f in ('label', 'role', 'task'):
                if isinstance(u.get(f), str) and u.get(f):
                    m[f] = u[f]
            if 'enabled' in u:
                m['enabled'] = bool(u.get('enabled'))
        out[k] = m
    return out


def write_default_macros():
    """首次使用时把默认宏落盘成用户可编辑文件（已存在则不动用户文件）。"""
    if os.path.exists(TRUSTEE_MACRO_JSON):
        return
    try:
        os.makedirs(os.path.dirname(TRUSTEE_MACRO_JSON), exist_ok=True)
        with open(TRUSTEE_MACRO_JSON, 'w', encoding='utf-8') as f:
            json.dump(_DEFAULT_MACROS, f, ensure_ascii=False, indent=1)
    except Exception:
        pass  # 落盘失败不拦主流程（内存宏仍可用）


def _team_today_count():
    td = _state.get('team_daily') or {}
    if td.get('date') != _today():
        return 0
    return int(td.get('count') or 0)


def _brief(line, level='info'):
    """写一行托管简报（最新在头部，上限 60 行）。纯内存操作，不落盘不回调 _save。"""
    _state['brief'].insert(0, {'ts': time.time(), 'level': level, 'line': line})
    del _state['brief'][60:]


# 「非终态在途任务」谓词（代码师#4：统一口径，消重复）
def _is_pending(st):
    return st not in ('done', 'failed', 'cancelled')


# 状态/裁决词中文化（用户要求：面板内不出现英文状态词）
_ZH = {'waiting': '排队中', 'running': '进行中', 'streaming': '输出中',
       'tool_running': '工具执行中', 'waiting_user': '等待用户',
       'queued': '排队中', 'done': '已完成', 'failed': '失败',
       'cancelled': '已取消', 'stale': '已停（转人工）',
       'approve': '通过', 'reject': '驳回', 'abstain': '证据不足→转人工'}


def _zh(w):
    return _ZH.get(str(w or ''), str(w or ''))


# 任务标题速查缓存（tid -> 标题短句），让面板显示人话标题而不是 turn_id
_title_cache = {}


def _turn_title(tid, box_id='', state=''):
    """取任务标题：优先对话池内存里的用户提问（chat_pool._TITLES），
    其次取证 JSONL 正文首行；再失败显示 turn_id。缓存防重复查库。"""
    k = str(tid)
    if k in _title_cache:
        return _title_cache[k]
    title = ''
    try:
        import chat_pool
        title = str(chat_pool._TITLES.get(k, '') or '').strip()
    except Exception:
        pass
    if not title:
        try:
            import trustee_evidence
            body = trustee_evidence.load(tid) or ''
            for ln in body.splitlines():
                ln = ln.strip()
                if ln:
                    title = ln
                    break
        except Exception:
            pass
    title = title.replace('\n', ' ')[:40]
    if not title:
        title = k[:24]  # 实在取不到就显示编号
    if len(_title_cache) > 400:
        _title_cache.clear()
    _title_cache[k] = title
    return title


def _check_pool():
    """条款A：池开关前置检查。返回 (pool_enabled, slots)；异常时 slots=None。"""
    import chat_pool  # 延迟导入（代码师#6：规避 routes 包循环依赖，模块缓存无性能损耗）
    cfg = chat_pool.cfg()
    pe = bool(cfg.get('enabled'))
    if _state['pool_enabled'] is not False and not pe:
        _brief('池开关已关闭（cfg.enabled=false）→ 降级只读模式，托管仅对账 seen 集合', 'warn')
    _state['pool_enabled'] = pe
    snap = chat_pool.status_snapshot()
    # 代码师第3轮锐点：显式判 None 才降级。原 `or []` 会把"快照缺字段"归一化成
    # 空列表，schema 自检（L153）形同虚设——真 schema 异常被当成"池空"静默对账。
    slots = snap.get('slots')
    if slots is None:
        slots = snap.get('slot_list')
    return pe, slots  # 缺字段时为 None，由 _poll_once 走熔断分支


def _reconcile_turns(slots):
    """条款 #6：turn_id 集合差对账。P0 只读不裁决。"""
    now = time.time()
    seen = _state['seen_turns']
    cur = set()
    # P2.1 审批预算：每轮巡查最多 3 次真 LLM 收口审批（每次最长 60-90s，串行）。
    # 不设限时，重启首轮几十个补扫 done 僵尸会串行真调 LLM 卡死一整轮巡查；
    # 超预算的留 reviewed=False，后续轮次继续审（每任务最终都会审到）。
    review_budget = 3
    for s in slots:
        t = s.get('turn') or {}
        tid = t.get('turn_id') or ''
        if not tid:
            continue
        cur.add(tid)
        if tid not in seen:
            seen[tid] = {'box_id': s.get('box_id') or s.get('id') or '',
                         'state': t.get('state'), 'first_seen': now,
                         'main': _is_main_tid(tid)}  # P1.6：主对话/派生子对话标记
            title = _turn_title(tid, seen[tid].get('box_id'), t.get('state'))
            seen[tid]['title'] = title
            if seen[tid]['main']:
                _brief('新任务出现: %s（%s）状态=%s' % (title, tid[:18],
                                                       _zh(t.get('state'))))
                # P1.5 钩子补丁：主对话任务首见时抄送重派凭据（防 mark_done 清登记后无凭据）。
                # 只抄主对话（派生轮红线5本就不派，不抄防囤积）；已有自留凭据不覆盖。
                try:
                    import pool_resume as _pr
                    with _pr._LOCK:
                        _rd = _pr._load()
                    _ent = _rd.get(str(tid))
                    if _ent:
                        import trustee_evidence as _ev
                        if not _ev.load_req(tid):
                            _ev.save_req(tid, _ent)
                except Exception:
                    pass  # 钩子失败不影响巡查主流程
            # 派生子对话只登记不进简报（用户要求：面板只关心主对话）
        else:
            if seen[tid].get('state') != t.get('state'):
                _brief('任务状态变化: %s %s→%s' % (seen[tid].get('title') or tid[:18],
                                                   _zh(seen[tid].get('state')),
                                                   _zh(t.get('state'))))
                # P2 收口审批主触发（原缺陷修复：只有离开快照后的 db 补扫路径才审批，
                # 任务在池内直接 done 会被无限搁置——最后一个完成的任务永远等不到审批）
                if t.get('state') == 'done' and not seen[tid].get('reviewed'):
                    if review_budget > 0:
                        review_budget -= 1
                        seen[tid]['reviewed'] = True
                        _llm_review_dryrun(tid, seen[tid])
                    # 超预算：本轮不审不改标记，下轮再审
                elif _is_pending(t.get('state')):
                    # 重派/续跑使任务回到在途：清已审标记，完成时复审新结果
                    seen[tid]['reviewed'] = False
            seen[tid]['state'] = t.get('state')
        seen[tid]['last_seen'] = now
    # 消失的 turn（done 后槽位被覆盖属正常；#6 对账：先 db 补扫定性，再告警）
    # 安全师#2：warn 只对同一 tid 提示一次（_warned_gone 集合），防每轮刷屏；
    # turn 重新出现（提交重试）时清除标记允许再次告警。
    # R6 实现「真 db 补扫」：查 app_logs 中 pool-turn-done 记录（detail 含 turn_id 尾 12 位），
    # 能定性终态的就地收敛 seen[state]，定性不了的才 warn（留待 pool_resume 重投）。
    # P2.1 首轮对账合并告警：重启后 _warned_gone 清零，几十个历史僵尸会一次性涌进本分支，
    # 逐条 warn 刷屏（运行时实测）；>5 条合并成一行摘要。
    gone_pending = [tid for tid in (set(seen.keys()) - cur)
                    if _is_pending(seen[tid].get('state'))]
    gone_unresolved = []
    stale_count = 0
    stale_sample = ''
    for tid in gone_pending:
        final = _db_rescan_turn(tid)
        if final:
            seen[tid]['state'] = final
            seen[tid]['last_seen'] = now
            _brief('补扫定性: %s → %s' % (seen[tid].get('title') or tid[:18],
                                          _zh(final)))
            if final == 'done' and not seen[tid].get('reviewed'):
                if review_budget > 0:
                    review_budget -= 1
                    seen[tid]['reviewed'] = True
                    _llm_review_dryrun(tid, seen[tid])
                # 超预算：留待后续轮次（reviewed 仍 False）
            continue
        gone_unresolved.append(tid)
        # P2.1 僵尸收敛（对全部在途僵尸生效，不再被 rd_dead/redispatched 台账挡住——
        # 原判死任务会永远挂「进行中」，面板在途列表清不掉）
        if now - seen[tid].get('last_seen', 0) > 86400:
            seen[tid]['state'] = 'stale'
            stale_count += 1
            if not stale_sample:
                stale_sample = seen[tid].get('title') or tid[:18]
            continue
        # P1.7 僵尸回收：离开快照 30 分钟~24h → 自动重派一次（复用 _auto_redispatch
        # 全红线；rd_dead 判死台账/已重派台账内的不再重试）
        if (tid in _load_redispatched() or tid in _load_rd_dead()):
            continue
        if now - seen[tid].get('last_seen', 0) > _ZOMBIE_TIMEOUT_SEC:
            with _lock:
                cur_batch = _state.get('_rd_batch', 0)
            if cur_batch >= _MAX_REDISPATCH_PER_POLL:
                pass  # 本轮限流已满，下轮再试
            else:
                title = seen[tid].get('title') or str(tid)[:18]
                if _auto_redispatch(tid, seen[tid],
                                    '在途超时 %d 分钟无心跳（僵尸回收）'
                                    % (int(_ZOMBIE_TIMEOUT_SEC / 60))):
                    with _lock:
                        _state['_rd_batch'] = _state.get('_rd_batch', 0) + 1
    # 告警合并落简报（每 tid 仍只提示一次）
    fresh_gone = [t for t in gone_unresolved if t not in _warned_gone]
    if fresh_gone:
        for tid in fresh_gone:
            _warned_gone.add(tid)
        if len(fresh_gone) > 5:
            _brief('%d 个任务离开快照且未完成（对账合并告警，留待断点续跑/人工；示例: %s）'
                   % (len(fresh_gone), seen[fresh_gone[0]].get('title') or fresh_gone[0][:18]),
                   'warn')
        else:
            for tid in fresh_gone:
                _brief('任务离开快照且未完成: %s（无完结记录，留待断点续跑/人工）'
                       % (seen[tid].get('title') or tid[:18]), 'warn')
    if stale_count:
        if stale_count > 5:
            _brief('僵尸收敛 %d 个：离开快照超 24h 无进展 → 已停·转人工（示例: %s）'
                   % (stale_count, stale_sample), 'warn')
        else:
            for tid in gone_pending:
                if seen.get(tid, {}).get('state') == 'stale':
                    _brief('僵尸收敛: %s 离开快照超 24h 无进展 → 已停·转人工'
                           % (seen[tid].get('title') or tid[:18]), 'warn')
    for tid in (cur & _warned_gone):
        _warned_gone.discard(tid)
    # 清理：终态（含 stale 已停转人工）且超过 24h 的 seen 记录移除
    for tid in [k for k, v in seen.items()
                if (not _is_pending(v.get('state')) or v.get('state') == 'stale')
                and now - v.get('last_seen', 0) > 86400]:
        del seen[tid]


def _db_rescan_turn(tid):
    """真 db 补扫（R6 锐点落地）：查 app_logs 中 pool-turn-done 记录给消失 turn 定性终态。
    detail 格式见 chat_pool._finish_turn：'Turn {turn_id[-12:]} {state} | ...'。
    返回终态字符串（done/failed/cancelled）或 None（无记录=真漏检）。"""
    try:
        from db import get_db  # 统一入口：自动按 TABLE_DB_MAP 分库路由（app_logs 实际所在库）
        tail = str(tid)[-12:]
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT detail FROM app_logs WHERE action='pool-turn-done' "
                "AND detail LIKE ? ORDER BY id DESC LIMIT 1",
                ('%Turn ' + tail + ' %',)).fetchone()
        finally:
            conn.close()
        if row:
            d = str(row[0] or '')
            for st in ('done', 'failed', 'cancelled'):
                if (' ' + st + ' ') in d:
                    return st
            return 'done'  # 有完结记录但状态词异常，保守按 done（完结即不再是漏检）
    except Exception as e:
        _brief('db补扫异常（不影响巡查主流程）: %s' % e, 'warn')
    return None


def _gather_turn_evidence(tid, limit=1600):
    """P1.5 内容源（2026-11-16 修复）：旧逻辑按尾12位对账 agent_turns.turn_no，
    但 turn_no 实为秒级时间戳、尾12位是随机段，永远查空 → 审批包空卷 → abstain。
    新逻辑：优先按完整 turn_id 读 trustee_evidence JSONL 落盘正文，
    取不到再回退旧 agent_turns 对账；app_logs 命令级证据逻辑不变。"""
    tail = str(tid)[-12:]
    body = ''
    # 新路径：JSONL 持久化正文（按完整 turn_id 精确匹配）
    try:
        import trustee_evidence
        body = (trustee_evidence.load(tid) or '')[:limit]
    except Exception:
        pass
    # 回退：旧 agent_turns 对账（保留兼容，防 JSONL 缺失）
    if not body:
        try:
            from db import get_db
            conn = get_db()
            try:
                rows = conn.execute(
                    "SELECT role, content FROM agent_turns "
                    "WHERE substr(CAST(turn_no AS TEXT), -12) = ? "
                    "ORDER BY id ASC", (tail,)).fetchall()
            finally:
                conn.close()
            parts = []
            for r in (rows or []):
                c = str(r[1] or '').strip()
                if c:
                    parts.append('[%s] %s' % (r[0], c))
            body = '\n'.join(parts)[:limit]
        except Exception as e:
            _brief('审批包正文取证异常: %s' % e, 'warn')
    logs = ''
    try:
        from db import get_db
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT detail FROM app_logs WHERE action='pool-turn-done' "
                "AND detail LIKE ? ORDER BY id DESC LIMIT 1",
                ('%Turn ' + tail + ' %',)).fetchone()
        finally:
            conn.close()
        if row:
            logs = str(row[0])[:300]
    except Exception:
        pass
    return body, logs


def _is_noise_turn(seen_entry):
    """P2.3 噪音轮识别：系统提醒轮不是任务（2026-11-22 生产实锤：两条「系统提醒·不回复此条」
    轮被当任务审批打了 10-50 低分 → 白派 2 张重做单烧掉每日派团额度）。"""
    title = str(seen_entry.get('title') or '')
    return ('系统提醒·不回复此条' in title) or title.startswith('（系统提醒')


def _llm_review_dryrun(tid, seen_entry):
    """P2 收口审批（决策权落地）：turn 到达 done 终态时组装收口审批包走 LLM 审批，
    审批员输出 verdict + 双分数（工程进度/审核）+ 处置裁决建议；代码层按铁律门槛执行：
    进度≥95 且 审核>90 → 收口；否则按分数带派团队成员（宏命令）或转人工。失败静默转 abstain。"""
    try:
        # P2.3 噪音轮不审批不派团（白烧 LLM+派团额度）
        if _is_noise_turn(seen_entry):
            seen_entry['reviewed'] = True
            _brief('跳过审批（系统提醒轮非任务）: %s'
                   % (seen_entry.get('title') or str(tid)[:18]))
            return
        import trustee_llm_review as _rv
        body, logs = _gather_turn_evidence(tid)
        if body:
            report = ('turn_id=%s box=%s\n【收口正文】\n%s' % (str(tid)[:24], seen_entry.get('box_id') or '?', body))
            if logs:
                report += '\n【命令级证据(pool-turn-done)】\n%s' % logs
        else:
            # 无正文时如实声明空卷（LLM 应 abstain），不再伪造摘要
            report = ('turn_id=%s box=%s\n该任务已被对话池确认完成（pool done），'
                      '但 agent_turns 无正文记录（可能为纯工具型 turn），请如实 abstain。'
                      % (str(tid)[:24], seen_entry.get('box_id') or '?'))
        res = _rv.review_report(report, timeout=60)
        if not isinstance(res, dict):  # 兼容旧元组返回（防混版本 import 缓存）
            res = {'verdict': res[0] if isinstance(res, tuple) else 'abstain',
                   'reason': res[1] if isinstance(res, tuple) else '',
                   'progress': None, 'review': None, 'decision': ''}
        # 分数留档：面板在途列表直接显示双分数（对照铁律门槛）
        with _lock:
            seen_entry['progress'] = res.get('progress')
            seen_entry['review'] = res.get('review')
            seen_entry['verdict'] = res.get('verdict')
        _brief('收口审批: %s → %s（进度%s/审核%s）| %s'
               % (seen_entry.get('title') or str(tid)[:18], _zh(res.get('verdict')),
                  res.get('progress') if res.get('progress') is not None else '?',
                  res.get('review') if res.get('review') is not None else '?',
                  str(res.get('reason') or '')[:120]))
        _execute_decision(res, tid, seen_entry)
    except Exception as e:
        _brief('收口审批通道异常转人工: %s' % e, 'warn')


_TRUSTEE_JSON2 = TRUSTEE_JSON  # 别名（可读性）；重派登记持久化进 trustee.json 的 redispatched 字段
_MAX_REDISPATCH_PER_POLL = 2    # 红线4：每轮巡查最多自动重派数
_ZOMBIE_TIMEOUT_SEC = 1800     # P1.7：在途任务离开池快照超过 30 分钟视为僵尸，触发自动重派


def _load_redispatched():
    return set(_state.get('redispatched') or [])


def _load_rd_dead():
    return set(_state.get('rd_dead') or [])


def _mark_rd_dead(tid, why):
    """P2.1 重派判死登记：无凭据/池拒/派生轮等终局性失败后登记，防每轮巡查重试刷屏。
    （原缺陷实锤：失败不登记 → 同一僵尸 tid 每 60s 重试一次，简报被「无重派凭据」刷屏。）"""
    dead = _load_rd_dead()
    if str(tid) in dead:
        return
    dead.add(str(tid))
    _state['rd_dead'] = list(dead)


def _score_band(res, cfg=None):
    """P2 铁律门槛裁决（代码层执行，LLM 分数为输入）：
    返回 (decision, worst_score)。abstain/无分 → escalate_human。
    进度≥95 且 审核>90 → adopt；任一<60 → redo；其余 → dispatch_optimize。"""
    cfg = cfg or _state.get('cfg') or {}
    pp = int(cfg.get('progress_pass', TRUSTEE_PROGRESS_PASS))
    rp = int(cfg.get('review_pass', TRUSTEE_REVIEW_PASS))
    progress, review = res.get('progress'), res.get('review')
    if progress is None or review is None:
        return 'escalate_human', None
    worst = min(progress, review)
    if progress >= pp and review > rp:
        return 'adopt', worst
    if worst < 60:
        return 'redo', worst
    return 'dispatch_optimize', worst


_DECISION_ZH = {'adopt': '收口采纳', 'dispatch_verify': '派验证师复核',
                'dispatch_optimize': '派优化师返工', 'redo': '换队重做',
                'escalate_human': '转人工'}


def _team_dispatch(dec, tid, seen_entry, res, reason):
    """P2.2 自动派团队成员（结合宏命令）：按裁决从宏命令库取 role/task 模板，
    展开占位符后调小镇派单（_town_assign_impl，真引擎+真工具+交付物硬校验+审单闸）。
    全红线通过才派；返回 True=已派出，False=未派出（原因写简报）。"""
    title = seen_entry.get('title') or str(tid)[:18]
    try:
        cfg = _state.get('cfg') or {}
        if not cfg.get('team_enabled', True):
            _brief('派团队跳过（team_enabled=false）: %s，转人工' % title, 'warn')
            return False
        macros = _load_macros()
        macro = macros.get(dec) or macros.get('dispatch_optimize')
        if not macro or macro.get('enabled') is False:
            _brief('宏命令「%s」已禁用，%s 转人工' % (dec, title), 'warn')
            return False
        # 红线：每日上限（花钱类操作设上限，策划案红线）
        cap = int(cfg.get('team_daily_cap', TRUSTEE_TEAM_DAILY_CAP))
        used = _team_today_count()
        if used >= cap:
            _brief('派团队跳过（今日已派 %d/%d 达上限）: %s，转人工' % (used, cap, title), 'warn')
            return False
        # 红线：同 tid 只派一次团队单（防返工循环烧钱）
        already = [j for j in (_state.get('team_jobs') or []) if j.get('tid') == str(tid)]
        if already:
            _brief('派团队跳过（该任务已派过团队单 %s，防循环烧钱）: %s，转人工'
                   % (already[0].get('job_id'), title), 'warn')
            return False
        # 红线5（与池重派同源）：AI 派生轮不派团（生产实锤：派生轮被审批后白派优化单）
        if str(tid) not in _load_redispatched() and not _is_user_initiated_tid(tid):
            _brief('派团队跳过（AI 派生轮）: %s，转人工' % title, 'warn')
            return False
        # 噪音轮（系统提醒）不该走到这里，双保险再拦一次
        if _is_noise_turn(seen_entry):
            _brief('派团队跳过（系统提醒轮非任务）: %s' % title, 'warn')
            return False
        task = (macro.get('task') or '').format(
            title=title, tid=str(tid)[:24],
            progress=res.get('progress') if res.get('progress') is not None else '?',
            review=res.get('review') if res.get('review') is not None else '?',
            progress_pass=int(cfg.get('progress_pass', TRUSTEE_PROGRESS_PASS)),
            review_pass=int(cfg.get('review_pass', TRUSTEE_REVIEW_PASS)),
            reason=str(reason or '')[:150])[:500]
        role = str(macro.get('role') or '')
        import sys as _sys
        _srv = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if _srv not in _sys.path:
            _sys.path.insert(0, _srv)
        from routes import domain_town as _town
        r = _town._town_assign_impl(role, task,
                                    meta={'tid': str(tid)[:24], 'source': 'trustee'})
        if not (isinstance(r, dict) and r.get('ok')):
            err = (r or {}).get('err') if isinstance(r, dict) else 'unknown'
            _brief('派团队成员失败（%s）: %s，转人工' % (err, title), 'warn')
            return False
        job_id = r.get('job_id') or ''
        _state['team_jobs'].insert(0, {
            'ts': time.time(), 'job_id': job_id, 'role': r.get('role') or role or '(自动选)',
            'decision': dec, 'tid': str(tid)[:24], 'title': title[:60],
            'progress': res.get('progress'), 'review': res.get('review'),
            'reason': str(reason or '')[:120]})
        del _state['team_jobs'][40:]
        td = _state.get('team_daily') or {}
        if td.get('date') != _today():
            _state['team_daily'] = {'date': _today(), 'count': 1}
        else:
            td['count'] = int(td.get('count') or 0) + 1
        _brief('👷 派团队成员[%s]: %s → %s（%s｜进度%s/审核%s｜今日 %d/%d）工单 %s'
               % (_DECISION_ZH.get(dec, dec), r.get('role') or role or '自动选人',
                  title, _zh(res.get('verdict')),
                  res.get('progress') if res.get('progress') is not None else '?',
                  res.get('review') if res.get('review') is not None else '?',
                  _team_today_count(), cap, job_id), 'warn')
        return True
    except Exception as e:
        _brief('派团队成员异常转人工: %s' % e, 'error')
        return False


def _recheck_team_output(ent, j):
    """P2.5 团队单产出复审（2026-11-23 第3轮，闭环第三道意见）：
    工单 done 后从 task 文本提取产出文件（outputs_villager/xxx.md）读正文喂 LLM 审批员
    独立复审，verdict/双分数回写 team_jobs.recheck 并简报。
    纪律：复审结论只简报不自动重派（reviewer村民+托管复审已是两道独立 LLM 意见，
    再自动派单=自激励烧钱循环）；单次失败只简报不重试（下轮 settled 已跳过）。"""
    try:
        import re as _re2
        import trustee_llm_review as _rv
        task = str(j.get('task') or '')
        m = _re2.search(r'outputs_villager/[\w.\-]+\.md', task)
        if not m:
            return False
        _root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        fpath = os.path.join(_root, m.group(0).replace('/', os.sep))
        if not os.path.isfile(fpath):
            _brief('团队单产出复审跳过（产出文件不存在）: %s' % m.group(0), 'warn')
            return False
        with open(fpath, 'r', encoding='utf-8', errors='replace') as f:
            body = f.read(2000)
        report = ('turn_id=%s job=%s\n【团队单产出独立复审】以下为村民交付的产出文件 %s 全文，'
                  '请独立评估其真实性与完成度。\n%s' % (ent.get('tid'), j.get('job_id'),
                                                       m.group(0), body))
        res = _rv.review_report(report, timeout=60)
        if not isinstance(res, dict):
            res = {'verdict': 'abstain', 'reason': '', 'progress': None, 'review': None}
        ent['recheck'] = {'verdict': res.get('verdict'),
                          'progress': res.get('progress'), 'review': res.get('review')}
        _brief('🔍 团队单产出复审: %s → %s（进度%s/审核%s）| %s'
               % (ent.get('title') or j.get('job_id'), _zh(res.get('verdict')),
                  res.get('progress') if res.get('progress') is not None else '?',
                  res.get('review') if res.get('review') is not None else '?',
                  str(res.get('reason') or '')[:100]))
        return True
    except Exception as e:
        _brief('团队单产出复审异常: %s' % e, 'warn')
        return False


def _reconcile_team_jobs():
    """P2.4 工单回查闭环（2026-11-23）：派团队单不再是"派完就忘"——每轮巡查对账
    town_jobs.json 工单台账（只读，小镇侧自会标记死亡）：终态回写 settled + 简报；
    failed/dead → 转人工；复活改道（revived_as）跟随新 job_id 继续观察；
    非终态超 30 分钟无心跳视同死亡；早于持久化的历史单一次性结清防刷屏。"""
    try:
        from routes import domain_town as _town
        jobs = _town._town_jobs_snapshot()
    except Exception as e:
        _brief('工单回查跳过（小镇工单台账不可读）: %s' % e, 'warn')
        return
    by_id = {j.get('job_id'): j for j in jobs if isinstance(j, dict)}
    revived_as = {j.get('revived_from'): j.get('job_id') for j in jobs
                  if isinstance(j, dict) and j.get('revived_from')}
    unknown = 0
    now = time.time()
    # P2.5 复审预算：每轮巡查至多 1 次真 LLM 产出复审（60s 级串行，防卡死一轮巡查）；
    # 未轮到的下轮继续（settled 条目只触发一次复审，最终都会审到）
    recheck_budget = 1
    recheck_on = bool((_state.get('cfg') or {}).get('team_recheck', True))
    for ent in (_state.get('team_jobs') or []):
        if ent.get('settled'):
            continue
        jid = str(ent.get('job_id') or '')
        title = ent.get('title') or jid[:18]
        j = by_id.get(jid)
        # 复活改道跟随：旧单 dead 且有 revived_as → 改盯新单，不结案不误报
        if isinstance(j, dict) and j.get('state') == 'dead' and revived_as.get(jid):
            new_id = str(revived_as[jid])
            _brief('🔁 工单重启复活改道: %s %s → %s（继续观察）' % (title, jid[:18], new_id[:18]))
            ent['job_id'] = new_id
            ent['revived'] = True
            j = by_id.get(new_id)
            jid = new_id
        if not isinstance(j, dict):
            ent['settled'] = True
            ent['final'] = 'unknown'
            unknown += 1
            continue
        st = j.get('state')
        if st in ('done', 'failed', 'dead'):
            ent['settled'] = True
            ent['final'] = st
            ent['final_review'] = str(j.get('review_state') or '')
            if st == 'done':
                _brief('✅ 工单回查完成: %s（%s，审单=%s）'
                       % (title, jid[:18], ent['final_review'] or '无'))
                if recheck_on and recheck_budget > 0:
                    recheck_budget -= 1
                    _recheck_team_output(ent, j)
            else:
                _brief('⚠️ 工单回查%s→转人工: %s（%s）%s'
                       % ('死亡' if st == 'dead' else '失败', title, jid[:18],
                          str(j.get('result') or '')[:80]), 'warn')
            continue
        if now - float(j.get('updated_at') or 0) > float(
                (_state.get('cfg') or {}).get('stale_job_sec', 1800)):
            # 非终态超时无心跳：视同死亡（阈值 cfg.stale_job_sec 可调，默认 30 分钟；
            # 兜底复活扫描未跑/台账丢失场景。纯 LLM 长生成的罕见卡住也会在此收敛）
            ent['settled'] = True
            ent['final'] = 'stale'
            _brief('⚠️ 工单回查超时无心跳→转人工: %s（%s 停在 %s）' % (title, jid[:18], st), 'warn')
    if unknown:
        _brief('工单回查: %d 张历史单无台账记录（早于持久化），已结清' % unknown)


def _execute_decision(res, tid, seen_entry):
    """P2 收口裁决执行（决策层=LLM 分数+裁决建议，代码层=门槛执行+安全带）：
    adopt→收口简报；dispatch_verify/dispatch_optimize/redo→宏命令派团队成员；
    escalate_human→只简报。"""
    cfg = _state.get('cfg') or {}
    dec, worst = _score_band(res, cfg)
    llm_dec = str(res.get('decision') or '')
    # LLM 裁决建议可在同分数带内细化（optimize↔verify），但不可越铁律门槛
    if (dec in ('dispatch_optimize',) and llm_dec == 'dispatch_verify') or \
       (dec == 'dispatch_verify'):
        dec = 'dispatch_verify'
    # 护栏：LLM 明示 reject（声称与实测不符）时不得收口，即使分数带达标 → 降级派验证师实查
    if dec == 'adopt' and res.get('verdict') == 'reject':
        dec = 'dispatch_verify'
    title = seen_entry.get('title') or str(tid)[:18]
    scores_txt = '进度%s/审核%s' % (
        res.get('progress') if res.get('progress') is not None else '?',
        res.get('review') if res.get('review') is not None else '?')
    if dec == 'adopt':
        _brief('✅ 收口审批通过: %s（%s｜%s）→ 标记完成'
               % (title, scores_txt, _zh(res.get('verdict'))))
        return True
    if dec == 'escalate_human':
        _brief('收口审批(%s): %s（%s｜%s）→ 转人工'
               % (_zh(res.get('verdict')), title, scores_txt,
                  str(res.get('reason') or '')[:100]), 'warn')
        return False
    sent = _team_dispatch(dec, tid, seen_entry, res, res.get('reason'))
    if not sent:
        _brief('%s 最终未成行: %s → 转人工（具体原因见上一条简报）'
               % (_DECISION_ZH.get(dec, dec), title), 'warn')
    return sent


def _is_user_initiated_tid(tid):
    """红线5：AI 派生轮不自动重派（护栏同 pool_resume._is_user_initiated）。
    从 resume 登记读原 body，messages 末尾角色为 tool/assistant 的轮=派生轮。"""
    try:
        import pool_resume
        with pool_resume._LOCK:
            d = pool_resume._load()
        e = d.get(str(tid)) or {}
        msgs = ((e.get('body') or {}).get('_body') or {}).get('messages')
        if not isinstance(msgs, list) or not msgs:
            return True  # 识别不出保守按用户发起
        return msgs[-1].get('role') == 'user'
    except Exception:
        return False  # 读不到登记→无凭据，按派生轮处理（不派）


def _is_main_tid(tid):
    """P1.6 面板过滤：主对话判定（与红线5同源，但语义相反且缺登记时保守按主对话）。
    pool_resume 登记里 messages 末尾为 user 的轮=用户发起的主对话任务；
    末尾为 tool/assistant 的轮=AI 派生子对话。登记缺失时按主对话处理
    （只影响面板展示，不影响 _auto_redispatch 的派生轮红线判定）。"""
    try:
        import pool_resume
        with pool_resume._LOCK:
            d = pool_resume._load()
        e = d.get(str(tid)) or {}
        msgs = ((e.get('body') or {}).get('_body') or {}).get('messages')
        if isinstance(msgs, list) and msgs:
            return msgs[-1].get('role') == 'user'
    except Exception:
        pass
    return True  # 识别不出→保守按主对话展示


def _auto_redispatch(tid, seen_entry, reason):
    """P1.5 自动重派（裁决权落地，reject 专属）。
    复用 pool_resume._recover_one：从登记快照取原 body，同 turn_id 幂等重投+注入继续提示。
    全部红线通过才派；返回 True=已派出。"""
    try:
        # 红线2：池开+托管开+未熔断（熔断/关闭态由调用方保证，这里再查池）
        import chat_pool
        if not chat_pool.cfg().get('enabled'):
            _brief('自动重派跳过（池已关）: %s' % (seen_entry.get('title') or str(tid)[:18]), 'warn')
            return False
        # 红线3：同 tid 只派一次
        rd = _load_redispatched()
        if str(tid) in rd:
            return False
        # 红线5：AI 派生轮不派
        if not _is_user_initiated_tid(tid):
            _brief('自动重派跳过（AI 派生轮，防对话凭空变多）: %s'
                   % (seen_entry.get('title') or str(tid)[:18]), 'warn')
            _mark_rd_dead(tid, '派生轮')
            return False
        # 红线6：登记里必须有原 body 凭据（钩子补丁：登记已清时回退托管自留抄送快照）
        import pool_resume
        with pool_resume._LOCK:
            d = pool_resume._load()
        entry = d.get(str(tid))
        if not entry:
            try:
                import trustee_evidence as _ev
                entry = _ev.load_req(tid)
                if entry:
                    _brief('重派凭据回退：resume 登记已清，使用托管自留抄送快照: %s'
                           % (seen_entry.get('title') or str(tid)[:18]))
            except Exception:
                pass
        if not entry:
            # P2.1：终局性失败判死登记（防每轮巡查重试刷屏——运行时实测简报被本条刷屏）
            _brief('自动重派跳过（无重派凭据=登记与自留抄送均缺失）: %s，转人工'
                   % (seen_entry.get('title') or str(tid)[:18]), 'warn')
            _mark_rd_dead(tid, '无凭据')
            return False
        ok = pool_resume._recover_one(entry)
        if ok:
            rd.add(str(tid))
            _state['redispatched'] = list(rd)
            _save()  # 红线3 持久化：重启后同 tid 不再二次重派
            _brief('🔁 自动重派: %s（审批=驳回：%s）。已同 id 重投池内续跑'
                   % (seen_entry.get('title') or str(tid)[:18], reason), 'warn')
            return True
        _brief('自动重派失败（池拒绝入队）: %s，转人工' % (seen_entry.get('title') or str(tid)[:18]), 'warn')
        _mark_rd_dead(tid, '池拒绝')
        return False
    except Exception as e:
        _brief('自动重派异常转人工: %s' % e, 'error')
        return False


def _note_failure(e):
    """熔断计数（条款 #7）：连败 3 次置 fused，唯一解除=手动关→开。"""
    _state['fuse_count'] += 1
    _brief('巡查异常: %s（熔断计数 %d/%d）' % (e, _state['fuse_count'], TRUSTEE_FUSE_LIMIT),
           'error')
    if _state['fuse_count'] >= TRUSTEE_FUSE_LIMIT:
        _state['fused'] = True
        _brief('连续失败 %d 次 → 熔断转人工。唯一解除：手动关→开 i托管开关（条款 #7）' %
               TRUSTEE_FUSE_LIMIT, 'error')


def _poll_once():
    """单轮巡查（代码师#2 拆分）：_check_pool → _reconcile_turns → 异常走 _note_failure。"""
    try:
        _, slots = _check_pool()
        # 读态自检（进化师①）：schema 异常时只计数不瞎判
        # 代码师第2轮#1：schema 异常也必须走熔断达限判断（复用 _note_failure 置 fused），
        # 原实现只加计数永不熔断，绕过条款#7
        if not isinstance(slots, list):
            _note_failure('池快照 schema 异常（slots=%r 非列表）' % type(slots).__name__)
        else:
            _state['_rd_batch'] = 0  # P1.5 红线4：每轮巡查重置限流计数
            # 仅在快照合法时对账（第2轮修复：此前 schema 异常时 reconcile(None) 再抛一次
            # → 外层 except 再 _note_failure → 一轮坏巡查熔断计数 +2，熔断比设计快一倍）
            _reconcile_turns(slots)
        # P2.4 工单回查先行（不依赖池健康：池坏也能看见团队单死活）；
        # 自带 try 防御，异常不进熔断计数（回查故障不该停摆整个托管巡查）
        try:
            _reconcile_team_jobs()
        except Exception as _tje:
            _brief('工单回查异常: %s' % _tje, 'warn')
        _state['last_poll_at'] = time.time()
        _state['poll_count'] += 1
    except Exception as e:
        _note_failure(e)


def _loop():
    # P1挂账②：静默期与巡查间隔改 Event.wait——可被 _stop_event.set() 立即中断，
    # 线程退出不再最长卡 300+60s（原 time.sleep 不可中断，代码师挂账项）
    if _stop_event.wait(TRUSTEE_START_SILENT):  # 条款D 启动静默期：防重启瞬间"池空"误判
        return
    while True:
        # 修复（代码师#1/验证师实锤）：绝不在锁内 sleep。
        # 锁内只做状态标志拷贝；巡查/落盘/睡眠全部在锁外执行，
        # 保证熔断态下 GET status / POST config 接口随时可抢到锁（条款 #7 解除路径可达）。
        with _lock:
            enabled = _state['enabled']
            fused = _state['fused']
        if not enabled:
            return  # 条款 #8：关=线程退出，停新巡查（重开时由 config 接口重新拉起）
        if fused:
            _save()
        else:
            _poll_once()
            _save()
        if _stop_event.wait(TRUSTEE_POLL_SEC):
            return  # P1挂账②：被 set 中断=立即退出线程


def _ensure_thread():
    global _thread
    if _thread and _thread.is_alive():
        return
    _thread = threading.Thread(target=_loop, daemon=True, name='itrustee')
    _thread.start()


class MixinTrustee(MixinBase):

    def _handle_trustee_status(self):
        # 【兜底自愈 2026-11-21】实测发现：服务重启后 _load() 恢复 enabled=True 并
        # _ensure_thread()，但线程可能未真正巡查（poll_count 长期为 0）。此处每次
        # status 查询时幂等兜底拉起（线程活着则直接 return，零开销），保证
        # 「开关开=巡查在跑」这个用户可见承诺成立。
        if _state['enabled'] and not _state.get('fused'):
            _ensure_thread()
        cfg = dict(_state.get('cfg') or {})
        with _lock:
            st = dict(_state)
            st.pop('seen_turns', None)
            st.pop('team_jobs', None)  # 面板只看 team_jobs_recent（压响应体积）
            # 代码师R2竞态修复：线程侧写 seen_turns 不持 _lock，接口侧遍历前必须拷贝快照
            seen_snap = dict(_state['seen_turns'])
            st['seen_count'] = len(seen_snap)
            st['redispatch_count'] = len(_state.get('redispatched') or [])  # P1.5 面板展示
            st['team_jobs_recent'] = list(_state.get('team_jobs') or [])[:8]
            st['team_today'] = _team_today_count()
            st['team_daily_cap'] = cfg.get('team_daily_cap')
            st['rd_dead_count'] = len(_state.get('rd_dead') or [])
            st['seen_recent'] = [
                {'turn_id': k[:24], 'box_id': v.get('box_id'), 'state': v.get('state'),
                 'last_seen': v.get('last_seen'), 'title': v.get('title') or k[:24],
                 'progress': v.get('progress'), 'review': v.get('review'),
                 'verdict': v.get('verdict')}
                for k, v in list(sorted(seen_snap.items(),
                                        key=lambda kv: -(kv[1].get('last_seen') or 0)))
                # P1.6 面板过滤：只显示「工作中的主对话」（在途 + 非派生子对话）
                # P2.1 追加：stale（已停·转人工）不再进在途列表（简报已留痕）
                if _is_pending(v.get('state')) and v.get('state') != 'stale' and v.get('main', True)
            ]
        st['cfg'] = cfg
        st['progress_pass'] = cfg.get('progress_pass')
        st['review_pass'] = cfg.get('review_pass')
        st['team_enabled'] = cfg.get('team_enabled')
        st['macros'] = [{'key': k, 'label': (v.get('label') or k), 'role': (v.get('role') or ''),
                         'enabled': v.get('enabled') is not False}
                        for k, v in _load_macros().items()]
        self._send_json({'ok': True, **st})

    def _handle_trustee_config(self):
        try:
            body = self._read_body()
        except Exception:
            body = {}
        enabled = body.get('enabled')
        # P2.3 门槛/派团配置：可选字段，合法才落库（trustee.json cfg 节持久化）
        with _lock:
            cfg = _state.setdefault('cfg', {})
            for k, lo, hi in (('progress_pass', 0, 100), ('review_pass', 0, 100),
                              ('team_daily_cap', 0, 100), ('stale_job_sec', 300, 86400)):
                v = body.get(k)
                if isinstance(v, int) and lo <= v <= hi:
                    cfg[k] = v
            if 'team_enabled' in body:
                cfg['team_enabled'] = bool(body.get('team_enabled'))
            if 'team_recheck' in body:  # P2.5 团队单产出复审开关
                cfg['team_recheck'] = bool(body.get('team_recheck'))
            if isinstance(enabled, bool):
                prev = _state['enabled']
                _state['enabled'] = enabled
                if enabled and not prev:
                    # 唯一解除路径（条款 #7）：关→开 重置熔断；清 stale；拉起守护线程
                    _state['fused'] = False
                    _state['fuse_count'] = 0
                    _state['stale_items'] = []
                    _state['started_at'] = time.time()
                    write_default_macros()  # P2.2 首开把宏命令库落盘成用户可编辑文件
                    _brief('i托管开启：AI 全自动托管（巡查→LLM双分数审批→铁律门槛→宏命令派团队）')
                    _stop_event.clear()
                    _ensure_thread()
                elif not enabled and prev:
                    # 条款 #8：关闭=停新巡查+在途标 stale+留交接说明
                    # 代码师R2竞态修复：同上，遍历前拷贝快照
                    seen_snap2 = dict(_state['seen_turns'])
                    pending = [t for t, v in seen_snap2.items()
                               if _is_pending(v.get('state'))]  # 代码师#4：统一谓词
                    _state['stale_items'] = pending
                    _brief('i托管关闭：人类接手。停止新巡查；在途 %d 项标记 stale 不执行；'
                           '已派子对话请人工跟进（交接）' % len(pending), 'warn')
                    _stop_event.set()  # P1挂账②：立即唤醒睡眠中的守护线程使其退出（原最长卡 60s）
        # 锁外落盘：_save 不可持 _lock 调用（线程侧锁外调用它，防持锁重入/长临界区）
        _save()
        self._send_json({'ok': True, 'enabled': _state['enabled'], 'fused': _state['fused'],
                         'cfg': dict(_state.get('cfg') or {})})


# 模块加载时恢复上次开关状态：开过则自动续跑（后台常驻原则）。
# 【代码师#5 副作用注释】import 本模块会触发 _load() 读盘并可能拉起守护线程，属设计行为，勿删。
_load()
write_default_macros()  # P2.2 宏命令库落盘（已存在用户文件则不动）
if _state['enabled']:
    _ensure_thread()
