# -*- coding: utf-8 -*-
"""collab-watchdog：协作断线自愈监视器（自我完善课题·方向3+方向1）。

【课题出处】AGI种子/重启断组织第4次复发-自我完善课题-20261125-alpha
根治方向3原文：现有一个现成探针——/api/plugin/collab/duties 只读。可加服务端周期巡检：
组内成员全部沉默超过 N 分钟且窗存在 → 自动向窗投自救指令（有人值班，没人就门铃）。
根治方向1原文：服务端主导重启恢复——服务端重启完成时按组档案直接向成员宿主窗投
「失忆自救指令」，前端恢复链退化为兜底（前端断线不再等于组织断线）。

【设计（bravo，2026-11-25）】
daemon 线程巡检 collab_channel.teams 注册表（走它自己的 _lock，不绕锁）：
- 启动即点卯（方向1）：服务重启完成 DELAY 秒后，对 TTL 内所有含未 done 成员的组
  全量投一轮自救指令（幂等，已复岗窗可忽略；跳过沉默判定——重启场景沉默时长
  无从判定，所有未 done 成员都算掉线候选）
- 周期沉默巡检（方向3兜底）：组级全员沉默 > SILENT_SEC 且含未 done 成员 → 投自救指令
- 「沉默」判定：成员最后活动时间 = max(done_at, say_log/inj_log/l1_log 中该成员最后活动 ts)
  * 断线窗的特征：l1 心跳停了（每轮请求自动合成）→ 最后活动时间不再前进
  * standby/done 成员不算需要救（他们是「活干完了待命」，不算断线）……
    ——修正：standby 窗如果 l1 停跳说明窗被关/浏览器断，同样投自救指令拉回场（无害：幂等）
- 自救指令：向沉默成员的 chat_id 投 monitor_queue 消息（复用现有投窗链路，窗轮询消费），
  内容 = 失忆自救三步（groups→join→复岗）+ 组上下文
- 防轰炸：每 (team_id, codename) 投后进冷却（默认 30 分钟），点卯与巡检共用冷却表
- 全组沉默且全员 chat_id 为空（派组时未回绑）→ 记 archive 便签告警，不投（没地址可投）

【锁审计（纪律五.4）】
- 本文件不引入新锁；巡检读 cc.teams 时短持 collab_channel._lock（只读快照，锁内无 IO）
- 投窗写 DB 时持 config._db_lock，此时不持有 collab_channel._lock（先拷快照再投，无嵌套锁）
- 复用 employee_scheduler 同款「3 次×3s 重试」口径

【不碰面承诺】独立插件目录，不改 collab_channel/main.py/schedule 任何一行（alpha 方向1改动面隔离）。
"""

import json
import os
import sys
import threading
import time

# ---------------------------------------------------------------------------
# 配置（可用环境变量覆盖）
# ---------------------------------------------------------------------------
SILENT_SEC = float(os.environ.get('COLLAB_WATCHDOG_SILENT_SEC', 600))    # 沉默阈值，默认 10 分钟
# 【v6.3 修复③】成员级沉默阈值：组级判定盲区补丁——等待方（review_wait 挂起窗）每轮请求
# 合成 l1 心跳，组级 last_any 持续前进，「全员沉默」永不触发，被审窗死了也没人救
# （投票卡死、done 无限挂起的根因）。成员级口径：l1/say 中该 codename 尾部 ts 超阈值
# 即单侧沉默，直接投自救拉回场。
MEMBER_SILENT_SEC = float(os.environ.get('COLLAB_WATCHDOG_MEMBER_SILENT_SEC', 900))  # 默认 15 分钟
COOLDOWN_SEC = float(os.environ.get('COLLAB_WATCHDOG_COOLDOWN_SEC', 1800))  # 同一成员重投冷却，默认 30 分钟
INTERVAL_SEC = float(os.environ.get('COLLAB_WATCHDOG_INTERVAL_SEC', 60))    # 巡检间隔，默认 1 分钟
STATE_TEAM_TTL = 7 * 24 * 3600.0   # 与 collab_channel.STATE_TEAM_TTL 对齐
# 【方向1·启动即点卯】服务重启完成 = 全体未 done 成员客观经历一次断线风险，
# 不等沉默阈值，启动后 DELAY 秒对 TTL 内活组全量投一轮自救指令（幂等，
# 已复岗窗可忽略；共用冷却表，之后 30min 内沉默巡检不会重投）。
BOOT_REVIVE = os.environ.get('COLLAB_WATCHDOG_BOOT_REVIVE', '1') not in ('0', 'false', 'no')
BOOT_REVIVE_DELAY_SEC = float(os.environ.get('COLLAB_WATCHDOG_BOOT_REVIVE_DELAY_SEC', 20))

_started = False
_wd_lock = threading.Lock()   # 只保护 _started 幂等与冷却表 _last_nudge
_last_nudge = {}              # {(team_id, codename): last_nudge_ts}


def setup(ctx):
    global _started
    with _wd_lock:
        if _started:
            ctx.log.info('[collab-watchdog] already started, skip')
            return
        _started = True
    t = threading.Thread(target=_loop, args=(ctx,), daemon=True, name='collab-watchdog')
    t.start()
    ctx.log.info('[collab-watchdog] thread started (boot_revive=%s delay=%ss silent>=%ss cooldown=%ss interval=%ss)'
                 % (BOOT_REVIVE, BOOT_REVIVE_DELAY_SEC, SILENT_SEC, COOLDOWN_SEC, INTERVAL_SEC))


def teardown(ctx):
    # daemon 线程随进程退出；_started 幂等锁防插件重载双线程
    ctx.log.info('[collab-watchdog] teardown (daemon thread left running; idempotent guard keeps single loop)')


# ---------------------------------------------------------------------------
# 巡检主循环
# ---------------------------------------------------------------------------

def _loop(ctx):
    # 服务端主导重启恢复（课题方向1）：启动即点卯一轮，先睡 DELAY 给
    # DB/teams 恢复留缓冲（_restore_teams 在模块导入时已同步完成，这里只是稳态缓冲）；
    # 点卯失败不阻断常规巡检。关闭 BOOT_REVIVE 时维持旧节奏（先睡一个间隔再开工）。
    if BOOT_REVIVE:
        time.sleep(BOOT_REVIVE_DELAY_SEC)
        try:
            _tick(ctx, boot=True)
        except Exception as e:
            try:
                ctx.log.error('[collab-watchdog] boot revive error: %s' % e)
            except Exception:
                pass
    else:
        time.sleep(INTERVAL_SEC)
    while True:
        try:
            _tick(ctx)
        except Exception as e:
            try:
                ctx.log.error('[collab-watchdog] tick error: %s' % e)
            except Exception:
                pass
        time.sleep(INTERVAL_SEC)


def _tick(ctx, teams_snap=None, boot=False):
    """单次巡检：只读快照 → 判定 → 锁外投窗。
    teams_snap=None 传入时 cc 保持 None：后续 _nudge/_archive_warn 对 cc 的
    全部引用均在 try/except 内，None 即安全跳过（测试路径不碰真通道）。
    boot=True：启动即点卯模式——跳过沉默判定，TTL 内含未 done 成员的组全量投
    （重启场景沉默时长无从判定，所有未 done 成员都算掉线候选）。
    """
    cc = None
    now = time.time()
    if teams_snap is None:
        # collab_channel 在 plugins/route.collab/（其 main.py 已把该目录插进 sys.path）；
        # 正常情况 import 直接命中 sys.modules 缓存（route.collab 已启用=已导入），
        # 此处防御性补路径一次；仍失败则本 tick 跳过（通道未运行=无需巡检）
        _rc_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'route.collab')
        if os.path.isdir(_rc_dir) and _rc_dir not in sys.path:
            sys.path.insert(0, _rc_dir)
        import collab_channel as cc
        if not cc.is_enabled():
            return
        teams_snap = {}
        with cc._lock:   # 锁审计：短持只读快照，锁内无 IO、无函数调用
            for tid, t in cc.teams.items():
                teams_snap[tid] = {
                    'created': t.get('created'),
                    'task': t.get('task'),
                    'members': {cn: dict(m) for cn, m in (t.get('members') or {}).items()},
                    'say_log': list(t.get('say_log') or []),
                    'inj_log': list(t.get('inj_log') or []),
                    'l1_log': list(t.get('l1_log') or []),
                }

    for tid, t in teams_snap.items():
        # TTL 过期组不救（与通道恢复口径一致：僵尸组丢弃）
        if now - float(t.get('created') or 0) > STATE_TEAM_TTL:
            continue
        ms = t.get('members') or {}
        if not ms:
            continue
        alive_members = {cn: m for cn, m in ms.items()
                         if not m.get('left') and not m.get('done_at')}
        if not alive_members:
            continue   # 全员 done/退场 = 完成组，不需要救

        # 【v6.3 修复③】成员级救援（组级判定的盲区补丁）：组整体活着但某成员单侧沉默
        # 超阈值 → 单独拉回场。典型场景：A 挂 review_wait 等 B 出票，A 的 l1 心跳
        # 掩盖组级沉默判定，B 死了没人救 → 投票卡死。boot 点卯模式全量投，跳过成员级。
        if not boot:
            try:
                _member_rescue(ctx, cc, tid, t, alive_members, now)
            except Exception:
                pass

        # 组级最后活动 = 各日志尾部 ts 的最大值（say/inj/l1 覆盖所有协作活动）
        # 注：note_log/review_log/done_log 不入判定——它们只在成员活跃时产生，
        # 日志尾部时间戳一定早于或等于真实断线时间，不影响「全员沉默」的方向性判定
        # 时间基准（实查 2026-11-25 collab_channel._now() L75-85）：本质是 time.time()
        # （单调=wall clock+同进程严格递增偏移），与本线程 time.time() 同钟，可直接相减；
        # 日志条目时间字段名实查为 'ts'（say_log L851 / l1_log L1053 / inj_log L1069）
        logs = [t.get('say_log'), t.get('inj_log'), t.get('l1_log')]
        last_any = 0.0
        for lg in logs:
            for e in (lg or []):
                v = e.get('ts')
                if isinstance(v, (int, float)) and v > last_any:
                    last_any = v
        if last_any <= 0 and not boot:
            continue   # 组从无任何活动记录（边缘：刚建组未活动）→ 常规巡检不动；点卯模式仍救
        silent_for = (now - last_any) if last_any > 0 else 0.0   # 点卯模式零活动组：沉默时长未知记 0

        if not boot and silent_for < SILENT_SEC:
            continue   # 组还活着（有人说话/有心跳/有插话）→ 常规巡检不救

        # 组级沉默超阈值（或启动点卯）→ 逐个未 done 成员投自救指令（冷却防轰炸）
        for cn, m in alive_members.items():
            key = (tid, cn)
            ln = _last_nudge.get(key, 0)
            if now - ln < COOLDOWN_SEC:
                continue
            chat_id = str(m.get('chat_id') or '').strip()
            if not chat_id:
                _archive_warn(cc, tid, cn, 'chat_id 为空（派组未回绑），无法投窗，请人工处理')
                _last_nudge[key] = now
                continue
            _nudge(ctx, cc, tid, cn, chat_id, silent_for, boot=boot)
            _last_nudge[(tid, cn)] = now


# ---------------------------------------------------------------------------
# 成员级沉默救援（v6.3 修复③）：组活≠每个成员都活
# ---------------------------------------------------------------------------

def _member_rescue(ctx, cc, team_id, t, alive_members, now):
    """组级「全员沉默」判定的盲区补丁。
    场景：A 挂 review_wait 等 B 出票，A 每轮请求合成 l1 心跳 → 组级 last_any 持续前进
    → 组级判定永不触发；B 窗被停/断线后无人拉回 → 投票卡死、done 无限挂起。
    口径：成员最后活动 = say_log/l1_log 中该成员 codename 尾部 ts（l1 每轮请求自动合成，
    是「窗在跑」的唯一真实信号；inj_log 只有 from/to 无 codename 且收到注入≠活着，不计入）。
    沉默超 MEMBER_SILENT_SEC 且未 done → _nudge(member=True) 投自救，与组级共用冷却表。
    锁审计：t 为调用方 _tick 已取好的锁外快照（本函数不碰 cc._lock）；冷却表短持 _wd_lock；
    投窗在 _nudge 内部持 _db_lock，与组级同口径无嵌套锁。"""
    last_by_member = {}
    for lg in (t.get('say_log'), t.get('l1_log')):
        for e in (lg or []):
            cn = e.get('codename')
            v = e.get('ts')
            if cn and isinstance(v, (int, float)) and v > last_by_member.get(cn, 0.0):
                last_by_member[cn] = v
    for cn, m in alive_members.items():
        last_m = last_by_member.get(cn, 0.0)
        if last_m <= 0:
            continue   # 从无本员活动记录（刚入组未说话/未心跳）→ 不误伤，交组级与点卯兜底
        silent_m = now - last_m
        if silent_m < MEMBER_SILENT_SEC:
            continue
        key = (team_id, cn)
        try:
            with _wd_lock:
                ln = _last_nudge.get(key, 0)
            if now - ln < COOLDOWN_SEC:
                continue
            chat_id = str(m.get('chat_id') or '').strip()
            if not chat_id:
                continue
            _nudge(ctx, cc, team_id, cn, chat_id, silent_m, member=True)
            with _wd_lock:
                _last_nudge[key] = now
        except Exception:
            pass


# ---------------------------------------------------------------------------
# 投窗（复用 monitor_queue 链路，口径对齐 employee_scheduler._inject_to_queue）
# ---------------------------------------------------------------------------

def _nudge(ctx, cc, team_id, codename, chat_id, silent_for, boot=False, member=False):
    now_ms = int(time.time() * 1000)
    task_brief = ''
    try:
        with cc._lock:
            t = cc.teams.get(team_id)
            task_brief = str((t or {}).get('task') or '')[:120]
    except Exception:
        pass
    if boot:
        msg = (
            '【collab-watchdog 重启恢复·点卯】服务端刚重启完成，组 %s 在册、你未 done（task: %s）。'
            '若你已复岗且 hear 正常请忽略本条；否则执行失忆自救三步复岗：'
            '① collab(action=groups) 列活组 → ② 认出自己的组 → '
            '③ collab(action=join, team=%s, codename=%s) 重签耳令牌回归，继续任务收口。'
            '若组档案已丢失则 wakeup 自救重建（带 peers+task）。'
            % (team_id, task_brief or '（无）', team_id, codename)
        )
    elif member:
        # 【v6.3 修复③】成员级救援文案：组还活着、只有你掉线（常见于 review_wait 等待方
        # 心跳掩盖被审方死亡）——点名同伴在等，加速回归
        msg = (
            '【collab-watchdog 成员级救援】组 %s 整体仍活跃，但你已沉默 %d 分钟（task: %s）'
            '——疑似你单侧断线/对话被停，同伴可能还在等你（如审核投票）。'
            '执行失忆自救三步复岗：'
            '① collab(action=groups) 列活组 → ② 认出自己的组 → '
            '③ collab(action=join, team=%s, codename=%s) 重签耳令牌回归，继续任务收口。'
            '若组档案已丢失则 wakeup 自救重建（带 peers+task）。'
            % (team_id, int(silent_for // 60), task_brief or '（无）', team_id, codename)
        )
    else:
        msg = (
            '【collab-watchdog 断线自愈】组 %s 已全员沉默 %d 分钟（task: %s）。'
            '你可能因重启/断线掉线了。执行失忆自救三步复岗：'
            '① collab(action=groups) 列活组 → ② 认出自己的组 → '
            '③ collab(action=join, team=%s, codename=%s) 重签耳令牌回归，继续任务收口。'
            '若组档案已丢失则 wakeup 自救重建（带 peers+task）。'
            % (team_id, int(silent_for // 60), task_brief or '（无）', team_id, codename)
        )
    data = json.dumps({
        'chat_id': chat_id,
        'message': msg,
        'timestamp': now_ms,
        'status': 'pending',
    }, ensure_ascii=False)

    from db import get_db
    from config import _db_lock
    import sqlite3
    conn = None
    for attempt in range(3):
        try:
            conn = get_db()
            with _db_lock:   # 锁审计：持 _db_lock 时未持有 cc._lock（task_brief 已在锁外取出）
                conn.execute(
                    'INSERT INTO app_data (category, key, value, created_at, updated_at) '
                    'VALUES (?, ?, ?, ?, ?)',
                    ('monitor_queue', 'collab_watchdog_%s_%s_%d' % (team_id, codename, now_ms),
                     data, now_ms, now_ms))
                conn.commit()
            _kind = ('成员级沉默 %d 分钟（组仍活跃，疑似单侧断线/被停）' if member
                     else '全员沉默 %d 分钟')
            _archive_warn(cc, team_id, codename,
                          (_kind % int(silent_for // 60)) + ' → 已向 %s 投自救指令' % chat_id)
            try:
                ctx.log.info('[collab-watchdog] nudged %s@%s (silent %ds) via %s'
                             % (codename, team_id, int(silent_for), chat_id))
            except Exception:
                pass
            return True
        except sqlite3.OperationalError:
            if conn is not None:
                try:
                    conn.rollback()
                except Exception:
                    pass
                conn = None
            if attempt == 2:
                try:
                    ctx.log.error('[collab-watchdog] nudge DB write failed after 3 retries: %s@%s'
                                  % (codename, team_id))
                except Exception:
                    pass
                return False
            time.sleep(3)


def _archive_warn(cc, team_id, codename, text):
    """落协作档案便签（append-only，失败静默——对齐通道纪律：磁盘问题不炸主功能）。"""
    try:
        cc._archive(team_id, 'watchdog', codename, '[watchdog] %s' % text)
    except Exception:
        pass
