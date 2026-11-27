# -*- coding: utf-8 -*-
"""
collab_channel.py —— 多路对话协作通气·服务器旁挂通道（策划案 v3.2 #3）

纯旁挂模块：不 import 任何 server 核心模块（标准库 only），不碰分发层正式代码。
消费方：
  - collab 工具（say / set_ear / status 三 action，预演期 feature flag 注册，见 S3）
  - pool_worker.run_upstream 顶层的 hear 注入钩子（#5，十步预演步骤④实证）
  - 预演脚本 scripts/rehearse_collab.py 直打本文件函数（驾驶舱删除令 V-opt：不建驾驶舱）

v3.2 关键裁决落地点：
  - D1 派出即成组：team_id + 代号 alpha/bravo/charlie/delta，一次注册即成组
  - D8 半组存活：成员退场不炸组，退者新消息不再注入
  - say 配额：每分钟 6 条/人（v6.2 放宽，原 3 条；超限拒绝并记日志）
  - L1 合成提要：服务器从 task 快照自动合成，不受 say 配额限，独立节流（≥20s/条）
  - per-lane token-ack：协议头发 token，hear 注入消费后 ack，防"消费即置 null"串号歧义（反驳师④）
  - 档案落盘：private/记忆/协作档案/<team_id>/transcript.md（append-only）
  - feature flag：COLLAB_ENABLE=false 默认关；关=全部 API 拒绝工作，注册表零残留由调用方保证
"""

import json
import os
import random
import threading
import time

# ---------------------------------------------------------------------------
# 路径与常量
# ---------------------------------------------------------------------------

# 2026-11-24 收口裁决修正（验证师终验【中】偏差 + 用户明令"不要双目录副本"）：
# 旧 _BASE_DIR=plugins/ 使档案落 plugins/private/记忆/协作档案/，与项目根 private/ 形成第二副本。
# 现向上多取一级到仓库根，档案唯一落点=项目根 private/记忆/协作档案/。
_ZF_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ARCHIVE_DIR = os.environ.get('ZF_CC_TEST_ARCHIVE_DIR') or os.path.join(
    _ZF_ROOT, 'private', '记忆', '协作档案')
# ↑ 测试隔离钩子（2026-11-25 门禁假红复盘）：tests/test_collab_channel.py 在 import 前
#   设置 ZF_CC_TEST_ARCHIVE_DIR 指向临时目录，STATE_FP 随之落在临时目录，
#   测试的 purge/disable 不再触碰真实协作档案（旧版曾把真实 state.json 清空的根因）。

# say 配额：每分钟 6 条/人（v3.0 定案 3 条；【v6.2 用户令「更加灵活的交互」放宽至 6 条】
# 仍保留滑动窗口防回声室刷屏，ack 配额 10/分不变——播报更跟手，回执不受影响）
SAY_QUOTA_PER_MIN = 6
# ack 回执独立配额：每分钟 10 条/人（用户令 2026-11-24「报话机收到机制」：
# A说→B必须回收到；ack 是轻量回执不占 say 配额，独立宽松限流防刷）
ACK_QUOTA_PER_MIN = 10
# 插话 msg_id 序列（v6.2.1 撞号根治：从 inject 段上移到模块头——_restore_teams 在
# import 期即回填该序号防重启撞号，定义必须先于第192行的 restore 调用，否则 NameError
# 或回填后又被覆盖归零；线程安全由 _lock 保证）
_inject_seq = [0]
# L1 合成提要独立节流：最小间隔秒（v3.2 2-8 裁决：不受 say 配额限、独立节流；
# 【v6.2 用户令「更加灵活的交互」20s→10s】心跳更密，动向更快到达同伴）
L1_MIN_INTERVAL_SEC = 10.0
# say 播报文本长度上限（防全量工具结果走 say 烧穿 token，挡位裁剪是 hear 侧职责）
SAY_MAX_LEN = 2000
# 【消息类型/级别两维】（用户插话令 2026-11-24「消息要区分类型和警告错误级别，方便智能体之间排错」）
# type: progress=进度（默认）/review=审核结论/question=提问求助/error=错误报告
# severity: normal=普通（默认）/warning=警告/error=错误（错误级注入带【错误】标记，同伴一眼定位谁出了问题）
SAY_TYPES = ('progress', 'review', 'question', 'error')
SAY_SEVERITIES = ('normal', 'warning', 'error')
# L1 提要长度上限
L1_MAX_LEN = 500
# 合法代号（D1）——【v8.0 用户令 2026-11-25「多协作小组共同开工/更大规模分组」4→8 扩容】
# 北约音标字母表续排：echo/foxtrot/golf/hotel，与原四代号同风格；全库校验点均引用本元组，一处扩容处处生效
VALID_CODENAMES = ('alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel')
# 合法耳挡（一期只 L0/L1，L2/L3 留枚举位但 set_ear 拒绝）
VALID_EAR_LEVELS = (0, 1, 2, 3)
ENABLED_EAR_LEVELS = (0, 1)

# feature flag（v3.2 #4 注：预演期临时注册与正式版同表同文件、flag 隔离；
# 默认关——关=全 API 拒绝，等价"注册表零残留"）
_flag = {'on': False}
_flag_lock = threading.Lock()

# ---------------------------------------------------------------------------
# 进程内注册表（线程安全）
# ---------------------------------------------------------------------------

_lock = threading.RLock()
_mono_lock = threading.Lock()
_last_mono_ts = 0.0


def _now():
    """单调时钟：保证同进程内每次调用严格递增。
    Windows time.time() 分辨率约 15ms，两条快速连发的 say 会拿到相同 ts，
    被 hear 水位过滤误丢（预演步骤④实锤）；通道层保证单调，消费方才能安全用 ts 做水位。"""
    global _last_mono_ts
    t = time.time()
    with _mono_lock:
        if t <= _last_mono_ts:
            t = _last_mono_ts + 0.001
        _last_mono_ts = t
    return t
# teams[team_id] = {
#   'created': ts, 'task': str, 'parent_chat_id': str（父对话窗 id，v4.1 父子收口）,
#   'members': {codename: {'chat_id': str, 'ear': int, 'ear_token': str|None,
#              'joined': ts, 'left': ts|None, 'status': 'working'|'done',
#              'done_at': ts|None, 'done_text': str|None}},
#   'say_log': [{...}], 'l1_log': [{...}], 'inj_log': [{...}], 'done_log': [{...}]
# }
teams = {}


def _ts_str(ts=None):
    return time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(ts or _now()))


# ---------------------------------------------------------------------------
# feature flag
# ---------------------------------------------------------------------------

def enable():
    """开启协作通道（预演期由脚本/工具注册方显式调用；预演结束 disable）"""
    with _flag_lock:
        _flag['on'] = True
        return True


def disable():
    """关闭协作通道。预演零残留承诺：调用方在 disable 前应先 purge_all_teams。"""
    with _flag_lock:
        _flag['on'] = False
        return True


def is_enabled():
    with _flag_lock:
        return _flag['on']


def _require_on():
    if not is_enabled():
        raise PermissionError('collab_channel 未启用（feature flag 关闭）')


# ---------------------------------------------------------------------------
# 【缺陷C根治 v5.1 主对话 2026-11-24】组档案持久化（teams 落盘 + 重导入自动恢复）
# 旧况（实战两轮实锤）：teams/_flag 全内存，插件热重载重建模块 → 组清零+flag 复位
# → 协作师报「组不存在 / wakeup 无法重组」，半程工作蒸发。根治三层：
#   ① 落盘：写动作经 _wrap_persist 收尾后 _save_teams() 原子写 state.json；
#   ② 恢复：模块（重）导入即 _restore_teams() 回填 teams，未完成组(TTL 内)自动开闸；
#   ③ purge_all_teams 同步删盘（预演零残留承诺含持久层，不破坏）。
# 纪律：json 标准库（纯标准库红线不破）；落盘失败静默降级（对齐 _archive，磁盘问题不炸通道）。
# ---------------------------------------------------------------------------
STATE_FP = os.path.join(ARCHIVE_DIR, 'state.json')
# 超过此秒数仍未完成的组视为僵尸组：恢复时丢弃（不再自动开闸），transcript 档案仍在磁盘可查
STATE_TEAM_TTL = 7 * 24 * 3600.0


def _save_teams():
    """注册表原子落盘（写动作收尾调用）。失败静默，返回 False。"""
    try:
        os.makedirs(ARCHIVE_DIR, exist_ok=True)
        with _lock:
            payload = json.dumps({'saved_at': time.time(),
                                  'inject_seq': _inject_seq[0],  # v6.2.1 撞号根治
                                  'teams': teams},
                                 ensure_ascii=False)
        tmp = STATE_FP + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(payload)
        os.replace(tmp, STATE_FP)   # 原子替换：断电不留半截文件
        return True
    except (OSError, ValueError, TypeError):
        return False


def _restore_teams():
    """模块（重）导入时回填：state.json → teams；有未完成组（TTL 内）自动开闸。
    任何异常吞掉——磁盘脏数据最坏=回到旧行为（内存从零），绝不炸插件加载。"""
    try:
        if not os.path.exists(STATE_FP):
            return 0
        with open(STATE_FP, 'r', encoding='utf-8') as f:
            data = json.load(f)
        # 【v6.2.1 撞号根治】回填插话序号计数器：重启/热重载后 inject 的 msg_id
        # 不再从 1 重新编号，防同 ID 不同消息撞号（实锤：inj-alpha-4/1 双条目
        # 导致 ack 永远命中旧条目、duties 永不消账）。缺字段时兜底扫描 inject_log。
        seq = data.get('inject_seq')
        if not isinstance(seq, int) or seq < 0:
            seq = 0
            for t in (data.get('teams') or {}).values():
                for e in (t.get('inject_log') or []):
                    try:
                        seq = max(seq, int(str(e.get('id', '')).rsplit('-', 1)[-1]))
                    except (ValueError, AttributeError):
                        continue
        _inject_seq[0] = max(_inject_seq[0], seq)
        ts = data.get('teams') or {}
        if not isinstance(ts, dict):
            return 0
        now = time.time()
        alive = {}
        for tid, t in ts.items():
            try:
                if not isinstance(t, dict) or not t.get('members'):
                    continue
                if now - float(t.get('created') or 0) > STATE_TEAM_TTL:
                    continue  # 僵尸组：不再恢复（防旧组无限期占闸）
                alive[tid] = t
            except (TypeError, ValueError):
                continue
        with _lock:
            teams.update(alive)
        for t in alive.values():
            for m in (t.get('members') or {}).values():
                if not m.get('done_at'):
                    enable()   # 有活没干完 → 重导入后自动重开闸（缺陷C核心语义）
                    break
        return len(alive)
    except Exception:
        return 0


_restore_teams()


def _find_undone_team(team_id):
    """【wakeup 唤醒·用户令 2026-11-24】flag 关后查找「未完成」的组：
    组存在且至少一名成员没 done。找到返回组 dict，否则 None。
    用于允许成员把被误停的团队唤醒继续干活直到完成任务。"""
    with _lock:
        t = teams.get(str(team_id or '').strip())
        if not t:
            return None
        for m in (t.get('members') or {}).values():
            if not m.get('done_at'):
                return t
    return None


def wakeup(team_id, codename, peers=None, task=None):
    """【v4.7 团队唤醒 → v6.2 子对话互唤（用户令「子对话可以互相随时唤醒,不需要父亲」）】
    三档语义：
    ① 组档案还在（内存或磁盘 state.json）：与旧版一致——校验成员身份+有未 done 者→重开 flag。
    ② 组档案彻底丢失（父对话收尾 purge 连 state.json 都删了）：**自救重建**——调用者
       提供同伴代号清单(peers)+任务简述(task)，按原组 id 重建组档并把自己注册为成员，
       同伴记为待回绑成员；ear 重签。此后 say/hear/inject/review/done 全链路照常——
       hear 注入只认请求体 _collab_team/_collab_codename 标记，不依赖父对话不查 chat_id，
       所以重建即恢复互唤，父亲不在场也能继续协作。
    ③ 全员已 done 的完成组：仍拒绝（防滥用），错误信息给人话。
    【v5.1】wakeup 属组态写（加唤醒标记）→ 收尾 _save_teams。
    peers: ['alpha','charlie',...] 档案丢失时必带（不含自己）；task: 任务简述（丢失时建议带）。
    """
    team_id = str(team_id or '').strip()
    codename = str(codename or '').strip().lower()
    if not team_id or not codename:
        raise ValueError('team 和 codename 不能为空')
    if codename not in VALID_CODENAMES:
        raise ValueError('非法代号: %s（合法 %s）' % (codename, VALID_CODENAMES))
    with _lock:
        t = teams.get(team_id)
    if t is None:
        # 档案彻底丢了：内存没有 → 尝试磁盘恢复一次（_restore 已在导入时跑过，
        # 这里再查一次防「恢复时 TTL 已过但用户明确还要继续」的边缘情况——不强制恢复，
        # 直接走自救重建，因为 state.json 在 purge 时已被删，通常查不到）。
        peers = [str(p or '').strip().lower() for p in (peers or []) if str(p or '').strip()]
        peers = [p for p in peers if p in VALID_CODENAMES and p != codename]
        # 去重保序
        seen = set()
        peers = [p for p in peers if not (p in seen or seen.add(p))]
        if not peers:
            raise KeyError(
                '组不存在（从未派出或已清档）: %s —— 自救重建两条路：'
                '① collab 工具带 peers=[同伴代号清单] 和 task=任务简述重试'
                '（例：wakeup(team, "bravo", peers=["alpha"], task="优化协作流程")，'
                '需服务重启后新工具层生效）；② 不重启立即生效：POST '
                'http://127.0.0.1:8620/api/plugin/collab/dispatch，body 同上带 peers；'
                '否则只能请父对话重新派组' % team_id)
        enable()   # 自救=「开协作」的意图表达，自愈开闸（对齐 dispatch 先开闸再校验）
        create_team(team_id, task=str(task or '（由 %s 自救重建，原任务简述未携带）' % codename),
                    members=[{'codename': codename, 'chat_id': ''}] +
                            [{'codename': p, 'chat_id': ''} for p in peers],
                    parent_chat_id='')
        with _lock:
            t = teams.get(team_id)
            if t is None:   # 理论不可达（create_team 已建），防御性兜底
                raise KeyError('自救重建失败: %s' % team_id)
            t['_wakeup_at'] = _now()
            t['_wakeup_by'] = codename
            t['_rebuilt'] = True
            t['_rebuilt_by'] = codename
        _save_teams()
        _archive(team_id, 'wakeup', codename,
                 '【自救重建】组档案丢失（父对话已清档），%s 带同伴 %s 重建组继续协作（脱离父对话）'
                 % (codename, '、'.join(peers)))
        return {'ok': True, 'team_id': team_id, 'wakeup_by': codename,
                'rebuilt': True, 'members': [codename] + peers,
                'undone_members': [codename] + peers, 'ear': 1,
                'tip': '组已按原 id 自救重建：同伴窗下次发消息时 hear 注入自动恢复；'
                       '同伴可用原 team/codename 直接 say/inject，无需父亲重派'}
    members = t.get('members') or {}
    if codename not in members:
        raise ValueError('你不是该组成员，无权唤醒: %s' % team_id)
    undone = [c for c, m in members.items() if not m.get('done_at')]
    if not undone:
        # 【复活模式 2026-11-24 用户令「下线可被同伴唤醒」】全员 done 组不再拒唤醒：
        # 视作组复活——重开闸门+清成员 done_at（成员可重新协作与收口），原 done_log/
        # review_log/档案全保留；后续互审仍由幽灵同伴豁免（done L1228 三条件）兜底防
        # 「死窗同伴」卡死交付；done 本身幂等（重复上报覆盖结论），旧结论不丢。
        enable()
        with _lock:
            for mv in (t.get('members') or {}).values():
                mv.pop('done_at', None)
                mv['status'] = 'working'
            t['_wakeup_at'] = _now()
            t['_wakeup_by'] = codename
            t['_revived'] = True
            t['_revived_by'] = codename
        _save_teams()
        _archive(team_id, 'wakeup', codename,
                 '【组复活】全员 done 组被 %s 唤醒重开（历史结论全留档），继续协作' % codename)
        return {'ok': True, 'team_id': team_id, 'wakeup_by': codename,
                'rebuilt': False, 'revived': True,
                'undone_members': list(members.keys()), 'ear': 1,
                'tip': '组已复活重开：done_at 已清、闸门已开，成员可重新协作与收口；'
                       '历史 done/review 全留档可查'}
    # 组合法 → 重开 flag（wakeup 是合法成员的特权动作，锁外执行避免嵌套）
    enable()
    with _lock:
        t['_wakeup_at'] = _now()
        t['_wakeup_by'] = codename
    _save_teams()
    return {'ok': True, 'team_id': team_id, 'wakeup_by': codename,
            'rebuilt': False, 'undone_members': undone, 'ear': 1}


def create_team_tool(task='', size=3, team_id=None, codename=None, note=''):
    """【v8.0 AI 自主建组正门·用户令「多个协作小组共同开工/后台无头智能体自己分组研究」2026-11-25】
    dispatch=前端父对话派组（用户可见开多窗）；本函数=AI/无头智能体从对话内直接建组：
    组档照建、闸门照开（enable）、创建者即首个成员，其余成员空槽等 join 入伙/协作窗报到回绑。
    无前端依赖——后台无头智能体、AGI 种子自主科研的正门。同 id+同成员幂等（重复 create 不重建）。
    size: 1~len(VALID_CODENAMES)（代号池扩容后上限 8，即"更大规模分组"的单组上限）"""
    task = str(task or '').strip()
    if not task:
        raise ValueError('create 需要 task=任务简述（建组要让全组知道干什么）')
    try:
        size = int(size)
    except (TypeError, ValueError):
        raise ValueError('size 必须是整数（1~%d）' % len(VALID_CODENAMES))
    if size < 1 or size > len(VALID_CODENAMES):
        raise ValueError('size 超界: %s（合法 1~%d）' % (size, len(VALID_CODENAMES)))
    codename = str(codename or 'alpha').strip().lower()
    if codename not in VALID_CODENAMES:
        raise ValueError('非法代号: %s（合法 %s）' % (codename, VALID_CODENAMES))
    with _lock:
        if team_id and str(team_id).strip() in teams:
            t0 = teams[str(team_id).strip()]
            if codename in (t0.get('members') or {}):
                snap0 = _team_snapshot(str(team_id).strip())
                return {'ok': True, 'existing': True, 'team_id': str(team_id).strip(),
                        'codename': codename, 'size': len(t0.get('members') or {}),
                        'members': sorted((t0.get('members') or {}).keys()),
                        'protocol_head': {'team': str(team_id).strip(), 'codename': codename,
                                          'ear_token': (t0.get('members') or {}).get(codename, {}).get('ear_token', '')},
                        'tip': '同 id 同代号已存在——幂等返回既有组，直接用该协议头继续协作'}
    team_id = str(team_id or '').strip() or ('collab_%d_%s' % (
        int(_now() * 1000),
        ''.join(random.choice('0123456789abcdef') for _ in range(4))))
    rest = [c for c in VALID_CODENAMES if c != codename][:max(0, size - 1)]
    create_team(team_id, task=task,
                members=[{'codename': codename, 'chat_id': ''}] +
                        [{'codename': c, 'chat_id': ''} for c in rest],
                parent_chat_id='')
    enable()   # 建组即开闸（对齐 dispatch/wakeup 自救的意图表达）
    with _lock:
        t = teams.get(team_id)
    tok = issue_ear_token(team_id, codename)   # 【v8.0.1】创建者耳令牌——AI 建组后立即可用 say/ack（V2b 实测缺令牌补）
    _save_teams()
    _archive(team_id, 'create', codename,
             '【AI 自主建组】%s 创建组（规模 %d 人），任务：%s%s'
             % (codename, size, task[:200], ('；留言：%s' % note[:100]) if str(note or '').strip() else ''))
    return {'ok': True, 'created': True, 'team_id': team_id, 'codename': codename,
            'size': size, 'members': [codename] + rest,
            'protocol_head': {'team': team_id, 'codename': codename, 'ear_token': tok},
            'tip': '建组成功：把 team/codename/耳令牌写进后续协作调用；同伴用 collab(action=join, '
                   'team=组id, codename=代号) 入伙；互审/done 纪律与派出组完全一致'}


# ---------------------------------------------------------------------------
# 组注册（D1 派出即成组 / D8 半组存活）
# ---------------------------------------------------------------------------

def create_team(team_id, task='', members=None, parent_chat_id=''):
    """注册一组。members: [{'codename','chat_id'}]，codename 必须在 alpha~delta。
    已存在同 id 组：幂等合并成员（供重试场景），不重置日志。
    parent_chat_id：父对话窗 id（v4.1 父子收口；仅存指针，协议头/报话语义不动）。"""
    _require_on()
    team_id = str(team_id or '').strip()
    if not team_id:
        raise ValueError('team_id 不能为空')
    members = members or []
    with _lock:
        t = teams.get(team_id)
        if t is None:
            t = {'created': _now(), 'task': str(task or ''),
                 'parent_chat_id': str(parent_chat_id or ''),
                 'members': {}, 'say_log': [], 'l1_log': [], 'inj_log': [],
                 'done_log': []}
            teams[team_id] = t
        elif parent_chat_id and not t.get('parent_chat_id'):
            t['parent_chat_id'] = str(parent_chat_id)
        for m in members:
            cn = str(m.get('codename') or '').strip().lower()
            if cn not in VALID_CODENAMES:
                raise ValueError('非法代号: %s（合法 %s）' % (cn, VALID_CODENAMES))
            t['members'].setdefault(cn, {
                'chat_id': str(m.get('chat_id') or ''),
                'ear': 1,          # 默认 L1（一期默认挡）
                'ear_token': None,
                'joined': _now(),
                'left': None,
                'status': 'working',   # v4.1：完成上报（done/collect）用
                'done_at': None,
                'done_text': None,
            })
        _save_teams()   # 【v5.1】建组落盘（热重载后组不丢的核心）
        return _team_snapshot(team_id)


def team_snapshot(team_id):
    with _lock:
        return _team_snapshot(team_id)


def _team_snapshot(team_id):
    t = teams.get(team_id)
    if not t:
        return None
    return {
        'team_id': team_id, 'task': t['task'], 'created': _ts_str(t['created']),
        'parent_chat_id': t.get('parent_chat_id', ''),
        'members': {cn: dict(v) for cn, v in t['members'].items()},
        'say_count': len(t['say_log']), 'l1_count': len(t['l1_log']),
        'inj_count': len(t['inj_log']),
        'done_count': len(t.get('done_log', [])),
        # 【v4.8 笔·便签实况】note() tip 承诺「status 可见」——status 兑现：
        # 计数+末 3 条预览（全景轻带出，详情走 peek）
        'note_count': len(t.get('note_log') or []),
        'note_tail': [{'by': e.get('by'), 'to': e.get('to'), 'text': str(e.get('text') or '')[:120]}
                      for e in (t.get('note_log') or [])[-3:]],
        # 【互审实况】谁审了谁、结论如何（status 可视化：父对话也能看谁卡在未审）
        'review_log': {rv: dict(tg) for rv, tg in (t.get('review_log') or {}).items()},
        # 【报话ACK·唤醒哨兵数据源】发给我的未回应定向插话（前端 tick 轮询此字段强制唤醒）
        'injects': [{'id': e['id'], 'from': e['from'], 'to': e['to'],
                     'ts_str': e['ts_str'], 'text': e['text'],
                     'answered': bool(e.get('answered'))}
                    for e in t.get('inject_log', [])],
    }


# ---------------------------------------------------------------------------
# v7.1 待命不脱网（用户令 2026-11-24「做完了也不能停止」「否则就真的停止很麻烦」）：
# done ≠ 断线，done = 待命。standby_report 登记「本窗还活着、活干完了」，
# 同伴 say/synth_l1 照常 hear（组活着心跳就在），组内义务自动判定；
# get_duties 给前端终局门禁做「义务未清不终局」的判定数据源（纯只读）。
# 老流程零影响：不调 standby 的窗行为与旧版完全一致（status 原样 done）。
# ---------------------------------------------------------------------------

def standby_report(team_id, codename):
    """成员收口后登记待命（幂等）：status 置 'standby' 但保留 done_at/done_text
    （互审门禁、collect、list_groups 的 done 判定语义全部不变——本函数只加标记）。
    返回 {ok, standby, duties}——duties 非空说明组内还有该成员该处理的义务。"""
    _require_on()
    codename = str(codename or '').strip().lower()
    with _lock:
        t = teams.get(team_id)
        if not t:
            raise KeyError('team 不存在: %s' % team_id)
        m = t['members'].get(codename)
        if not m:
            raise KeyError('成员不存在: %s' % codename)
        if m['left'] is not None:
            raise PermissionError('成员已退场（D8）：退者不能登记待命（可 collab(action=join) 重入）')
        changed = m.get('status') != 'standby'
        if changed:
            m['status'] = 'standby'   # 不动 done_at——done 判定语义不变
    if changed:
        _save_teams()
    try:
        duties = get_duties(team_id, codename)
    except Exception:
        duties = []
    return {'ok': True, 'team_id': team_id, 'standby': True, 'duties': duties,
            'tip': '已登记待命（done 保留、通道保持）：同伴动向照常 hear；'
                   '同伴给你 inject 会自动拉你回场（monitor 唤醒链路）'}


def get_duties(team_id, codename):
    """计算 codename 在组内的未清义务清单（前端终局门禁数据源，纯只读）：
    ① 未回应的定向插话（须 ack）——硬义务，不清不许终局；
    ② standby_watch：我已 done 但同伴还没收口且我尚未登记待命 → 提示先登记待命
      （登记后此义务消失，不再拦终局——待命=履行「保持在场」义务的方式）。
    同伴全退场/全 done/组不存在 → 空清单，可安静终局。"""
    _require_on()
    codename = str(codename or '').strip().lower()
    with _lock:
        t = teams.get(team_id)
        if not t:
            return []
        duties = []
        for e in (t.get('inject_log') or []):
            if e.get('to') == codename and not e.get('answered'):
                duties.append({'kind': 'inject_ack', 'ref': e.get('id'),
                               'from': e.get('from'),
                               'text': str(e.get('text') or '')[:200]})
        ms = t.get('members') or {}
        me = ms.get(codename) or {}
        others_alive = [c for c, v in ms.items()
                        if c != codename and not v.get('left') and not v.get('done_at')]
        if others_alive and me.get('done_at') and me.get('status') != 'standby':
            duties.append({'kind': 'standby_watch', 'peers': others_alive,
                           'note': '同伴 %s 还没收口：collab(action=standby) 登记待命'
                                   '（通道保持可被唤醒），然后再次 task_complete 终局'
                                   % '、'.join(others_alive)})
        return duties


# ---------------------------------------------------------------------------
# v7.0 动态入组（用户令 2026-11-24「随时可以加新的协作师」+「沟通无处不在」）：
# join=新成员随时加入活组；groups=列出可加入的活组（AGI 种子自主发现协作现场）
# ---------------------------------------------------------------------------

def list_groups():
    """列出全部活组（未全员 done、未 TTL 过期），供想要入组的 AGI 种子发现协作现场。
    返回 [{team_id, task, members:{cn:{status,joined,left}}, done_count, say_count}]"""
    _require_on()
    now = _now()
    out = []
    with _lock:
        for tid, t in teams.items():
            ms = t.get('members') or {}
            if not ms:
                continue
            if now - float(t.get('created') or 0) > STATE_TEAM_TTL:
                continue
            if all((m.get('done_at') or m.get('left')) for m in ms.values()):
                continue  # 全员已 done/退场的完成组不列（防加入死组）
            out.append({
                'team_id': tid,
                'task': str(t.get('task') or '')[:200],
                'members': {cn: {'status': m.get('status'),
                                 'left': bool(m.get('left')),
                                 # 【v7.5 常驻值守】暴露 chat_id/done：前端全局协作哨比对
                                 # 「名册绑定的窗是否还在画布上」，窗丢了自动重建拉活
                                 'chat_id': str(m.get('chat_id') or ''),
                                 'done': bool(m.get('done_at'))}
                            for cn, m in ms.items()},
                'done_count': len(t.get('done_log') or []),
                'say_count': len(t.get('say_log') or []),
            })
    return out


def join_team(team_id, codename, note='', rejoin_token=''):
    """新成员随时加入活组（setdefault 幂等：已在组=刷新不重复建）。
    流程：校验组活着 → 加入成员（默认 ear=1）→ 签发耳令牌 →
    全组广播一条「无需回执」的系统 say（新成员入组通告，他人 hear 自动看到）。
    返回 {ok, token, team_id, codename, members, tip}"""
    _require_on()
    codename = str(codename or '').strip().lower()
    if codename not in VALID_CODENAMES:
        raise ValueError('非法代号: %s（合法 %s）' % (codename, VALID_CODENAMES))
    with _lock:
        t = teams.get(team_id)
        if not t:
            raise KeyError('team 不存在: %s（可先 collab(action=groups) 查活组列表）' % team_id)
        if now_ttl_expired := (_now() - float(t.get('created') or 0) > STATE_TEAM_TTL):
            raise PermissionError('该组已过期（TTL %d 天），不可加入' % (STATE_TEAM_TTL // 86400))
        _reused_token = None  # 恢复分支复用旧令牌；None=需新签
        if codename not in t['members']:
            t['members'][codename] = {
                'chat_id': '',
                'ear': 1,
                'ear_token': None,
                'joined': _now(),
                'left': None,
                'status': 'working',
                'done_at': None,
                'done_text': None,
            }
        elif t['members'][codename].get('left') is not None:
            # 退场成员重新入组：复活（清 left，对齐 wakeup 复活语义）
            t['members'][codename]['left'] = None
        else:
            # 【重名防串号 v7.4·alpha 2026-11-25】同代号成员已在组且未退场：
            # 这是一次「顶替重入」尝试——可能是重启后同窗恢复，也可能是两个不同窗冒占同一代号。
            # 静默重签令牌会作废旧窗令牌（旧窗 ack 即报「token 不匹配疑似串号」），双窗共用代号时
            # 更会互相顶替身份——正是用户观察的「重启后重名引发错误」。改为显式校验：
            _old = t['members'][codename]
            _tok_in = str(rejoin_token or '').strip()
            _tok_old = str(_old.get('ear_token') or '')
            if _tok_in and _tok_old and _tok_in == _tok_old:
                _reused_token = _tok_old  # 同窗重启恢复：复用旧令牌（重签会作废协议头里的旧 token，正是串号根源）
            else:
                raise PermissionError(
                    '代号 %s 已被占用（成员在组未退场，chat_id=%s）。'
                    '你是同一窗重启恢复请带 token=协议头里的耳令牌重试；'
                    '是新窗请换一个未占用的代号，或先让原成员退场/组重建（wakeup）。'
                    % (codename, _old.get('chat_id') or '(未回绑)'))
        # 顺手把 joiner 标记进 dispatch/chat_id 绑定链路——chat_id 由窗侧 bind_chat_id 报到
    tok = _reused_token or issue_ear_token(team_id, codename)  # 恢复分支复用旧令牌，新入组/复活才新签（RLock 持锁外）
    _save_teams()   # 入组组态落盘
    # 全组广播入组通告（系统口径 say：无需回执，type=progress，他人 hear 自动看到）
    _n = str(note or '').strip()[:120]
    try:
        say(team_id, codename,
            ('[入组通告] %s 加入协作组（%s）' % (codename, _n)) if _n
            else '[入组通告] %s 加入协作组，大家好' % codename,
            need_ack=False, msg_type='progress', severity='normal')
    except Exception:
        pass  # 广播失败不阻断入组本体（say 配额满等边缘情况）
    with _lock:
        ms = {cn: {'left': bool(m.get('left')), 'status': m.get('status')}
              for cn, m in t['members'].items()}
    return {'ok': True, 'team_id': team_id, 'codename': codename,
            'token': tok, 'members': ms,
            'tip': ('入组成功：耳令牌 token 已签发，请写进你的对话协议头（ear 令牌 per-lane 回执用）；'
                    'say/hear/inject 全链路即刻可用；同伴会收到你的入组通告（无需回执）')}


def leave_team(team_id, codename):
    """成员退场（D8 半组存活：只标记 left，不删组）"""
    _require_on()
    with _lock:
        t = teams.get(team_id)
        if not t:
            raise KeyError('team 不存在: %s' % team_id)
        m = t['members'].get(codename)
        if not m:
            raise KeyError('成员不存在: %s' % codename)
        m['left'] = _now()
        _save_teams()   # 【v5.1】退场组态落盘
        return True


def bind_chats(team_id, binds=None):
    """【chat_id 回绑 v4.5】前端开窗后把真实窗 id 回绑到成员档案（修「成员 chat_id 全空」）。
    binds: [{'codename','chat_id'}]。幂等：空 chat_id 忽略；已有值不覆盖（防误绑他窗）。须 flag 开启。
    用途：服务器侧可按 chat_id 精确定位成员窗（collect 汇总带出、未来跨对话定位子窗）。"""
    _require_on()
    binds = binds or []
    changed = 0
    with _lock:
        t = teams.get(team_id)
        if not t:
            raise KeyError('team 不存在: %s' % team_id)
        for b in binds:
            if not isinstance(b, dict):
                continue
            cn = str(b.get('codename') or '')
            cid = str(b.get('chat_id') or '')
            if not cn or not cid:
                continue
            m = t['members'].get(cn)
            if m is None:
                continue  # 未知成员静默跳过（不抛错，批量回绑容忍个别失配）
            if m.get('chat_id') and m.get('chat_id') != cid:
                continue  # 已绑他窗不覆盖
            m['chat_id'] = cid
            changed += 1
    return {'bound': changed, 'members': {cn: v.get('chat_id', '') for cn, v in teams.get(team_id, {}).get('members', {}).items()}} if t else {'bound': 0, 'members': {}}


NOTE_MAX_NOTES = 50  # 每组便签 FIFO 上限（charlie 补 v4.8.1：对齐旧 pen 系纪律，防无限膨胀）


def note(team_id, codename, text, to=None):
    """【v4.8 笔·公共便签】用户令 2026-11-24「笔记，让其他人顺便看到」：
    写入组级 note_log（全组可见、status 带出、落档协作档案）。
    to=None 全组便签；to=代号 可做定向留条。上限 500 字防刷屏。"""
    _require_on()
    team_id = str(team_id or '').strip()
    codename = str(codename or '').strip().lower()
    text = str(text or '').strip()
    if not text:
        raise ValueError('note 内容不能为空')
    text = text[:500]
    with _lock:
        t = teams.get(team_id)
        if t is None:
            raise KeyError('组不存在: %s' % team_id)
        if codename not in (t.get('members') or {}):
            raise ValueError('你不是该组成员: %s' % team_id)
        # 【D8 退场纪律·alpha 补 2026-11-24】已退场成员不能记便签（防死后留言污染组账本）
        if ((t.get('members') or {}).get(codename) or {}).get('left'):
            raise PermissionError('已退场成员不能记便签（D8），退场即封笔')
        # 【charlie 补 v4.8.1】定向留条的收件人必须真实在组：to 写错代号=留条没人看到，
        # 眼睛（peek）也看不到幽灵收件人——写前校验，当场报错比静默丢失好。
        if to and to not in (t.get('members') or {}):
            raise ValueError('to=%s 不是本组成员（合法：%s）——定向留条要发给真实在组的人'
                             % (to, sorted((t.get('members') or {}).keys())))
        log = t.setdefault('note_log', [])
        log.append({'by': codename, 'to': to, 'text': text, 'ts': _now()})
        while len(log) > NOTE_MAX_NOTES:
            log.pop(0)  # FIFO 淘汰最旧，防无限膨胀（对齐旧 pen 系纪律）
        seq = len(log)
    _archive(team_id, 'note', codename,
             ('→%s ' % to if to else '') + text[:100])  # docstring 承诺「落档协作档案」兑现
    _save_teams()   # 【v5.1】便签组态落盘
    return {'seq': seq, 'by': codename, 'to': to, 'text': text,
            'tip': ('已留条给 %s（TA hear 旁听自动看到；退出场前请确认消费）' % to if to
                    else '已记入全组便签（同伴 hear 旁听自动看到；status/peek/collect 可查）')}


def peek(team_id):
    """【v4.9 眼·peek】用户令 2026-11-24「眼睛，看其他几个人状态」：
    轻量只读全组状态一眼看——不看 say_log 大账本（那是 status 的全景职责），
    只回成员状态行 + note_log 便签 + 未回应插话计数，供成员动笔/开口前快速瞄一眼。
    与 status 分工：status=全景重查（含日志计数/审账本/插话全量），peek=轻量快照（一眼看）。
    【v8.4 失忆自救·peek 降级（值守 2026-11-25 alpha）】组不存在时不再裸抛 KeyError
    （现场实证：服务从 6.1.0 切 6.2.0 实例后组态未迁移，失忆 AI peek 直接吃
    「组不存在: ''」死路一条）——降级返回活组清单+自救口诀（missing=true 标记），
    出路一眼可见：groups 字段找活组 → join 重建身份 → wakeup(peers+task) 重建组。
    只读动作降级安全；写操作（say/inject/review/done...）仍严格校验不放宽。"""
    _require_on()
    with _lock:
        t = teams.get(team_id)
        if t is None:
            groups = list_groups()   # _lock 为 RLock 可重入，锁内调用安全
            glist = [{'team_id': g.get('team_id'), 'task': str(g.get('task') or '')[:60],
                      'members': sorted((g.get('members') or {}).keys()),
                      'done_count': g.get('done_count', 0),
                      'say_count': g.get('say_count', 0)}
                     for g in (groups or [])[:10]]
            return {'team_id': team_id, 'missing': True,
                    'members': {}, 'notes': [], 'inj_open': 0,
                    'groups': glist,
                    'tip': ('组 %s 不存在（未派出/已清档/或服务换实例后组态未跟过来）——'
                            '失忆自救口诀：① 本返回 groups 字段（或 collab(action=groups)）找活组；'
                            '② 有组 → collab(action=join, team=组id, codename=你的代号) 重建身份；'
                            '③ 无活组但记得原组 id 和同伴 → collab(action=wakeup, team=原组id, '
                            'peers=[同伴代号清单], task=任务简述) 自救重建；'
                            '④ 都不行 → 请父对话重新派组。本 peek 已降级成功，不必原样重试。') % (team_id or '（空）')}
        members = {}
        for cn, m in (t.get('members') or {}).items():
            members[cn] = {
                'status': m.get('status') or 'working',
                'left': bool(m.get('left')),
                'done_at': m.get('done_at'),
                'ear': int(m.get('ear', 1)),
            }
        notes = [{'seq': i + 1, 'by': e['by'], 'to': e.get('to'),
                  'ts_str': _ts_str(e['ts']), 'text': e['text']}
                 for i, e in enumerate(t.get('note_log') or [])]
        inj_open = sum(1 for e in (t.get('inject_log') or [])
                       if not e.get('answered'))
        return {'team_id': team_id, 'task': t.get('task', ''),
                'members': members, 'notes': notes, 'inj_open': inj_open,
                'tip': '眼·peek：成员状态行+便签+未回应插话数；全景用 status，动笔前先瞄一眼'}


def purge_all_teams():
    """清空注册表（预演零残留收尾用）。须 flag 开启时才能清（防误清生产）。
    【v5.1】同步删除磁盘 state.json——零残留承诺含持久层。"""
    _require_on()
    with _lock:
        n = len(teams)
        teams.clear()
        try:
            if os.path.exists(STATE_FP):
                os.remove(STATE_FP)
        except OSError:
            pass
        return n


# ---------------------------------------------------------------------------
# 一期派出（v3.3 A1）：dispatch —— 前端 ZFCollab.dispatch 的后端真源。
# 一次调用：建组 + 逐成员签发 per-lane 耳令牌 + 拼好各自协议头，返回给前端开窗用。
# 前端拿到返回后逐窗 openRoleChat(协作师) 并把 protocol_head 注入首条消息；
# 每窗首条消息触发 _agentLoop 时 chat 对象已带 _collab_team/_collab_codename，
# agent-02-loop-core.js 把两个字段带进 payload → db.js 提升到 body → run_upstream 顶层
# collab_hear_inject 按标记做耳旁听注入（say 提要 + L1 心跳）。
# ---------------------------------------------------------------------------

def dispatch(payload=None):
    """payload: {'task': str, 'n': 2~4, 'chat_ids': [前端预创建窗 id，可选],
                 'team_id': str（可选；传入=对既有组扩员并入，绝不新建第二组）,
                 'parent_chat_id': str（可选；v4.1 父子收口，组记住爹是谁）}
    返回 {'team_id', 'members': [{'codename','token','protocol_head','ear'}], 'task'}"""
    # 【修复FX#1 2026-11-24】自愈开闸：dispatch=「开协作」的意图表达本身。
    # 现场实证：首派成功后 flag 被环境复位（插件 teardown/热重载清内存态），
    # 再派永远死在 _require_on 闸门外报「feature flag 关闭」；
    # 建组动作自带开闸语义，enable() 幂等无副作用——先开闸再校验，用户无需手工救火。
    enable()
    _require_on()
    payload = payload if isinstance(payload, dict) else {}
    _n_raw = payload.get('n') or 2
    try:
        n = int(_n_raw)
    except (TypeError, ValueError):
        n = 2        # 垃圾 n（异常/恶意 body）按默认组规模走，不让脏数据炸穿接口
    if n < 2:
        n = 2
    if n > len(VALID_CODENAMES):
        n = len(VALID_CODENAMES)
    task = str(payload.get('task') or '').strip()
    chat_ids = payload.get('chat_ids') or []
    # 【扩员并入 2026-11-24】前端 800ms 防抖把「点卡2次」合并为两次 POST（首建+扩员）。
    # 旧版每次 POST 都新建组 → 派2个出去4个（两组各2人，用户实锤）。
    # 带 team_id 时：同 id 幂等重开（create_team 合并成员不重置日志），代号延续，
    # token 重签（旧 token 弃用无害——成员窗尚未开工/未消费耳令牌）。
    req_team_id = str(payload.get('team_id') or '').strip()
    if req_team_id:
        with _lock:
            t = teams.get(req_team_id)
            cur = len(t['members']) if t else 0
            cur_task = str(t['task']) if t else ''
        if not t:
            raise ValueError('指定组不存在: %s' % req_team_id)
        if n < cur:
            n = cur  # 不缩编：扩员语义下 n 小于现员数时按现员数幂等返回
        team_id = req_team_id
        codenames = list(VALID_CODENAMES)[:n]
        members_spec = []
        for i, cn in enumerate(codenames):
            cid = ''
            if isinstance(chat_ids, (list, tuple)) and i < len(chat_ids):
                cid = str(chat_ids[i] or '')
            members_spec.append({'codename': cn, 'chat_id': cid})
        create_team(team_id, task=(task or cur_task), members=members_spec,
                    parent_chat_id=str(payload.get('parent_chat_id') or ''))
        out_members = []
        for i, cn in enumerate(codenames):
            tok = issue_ear_token(team_id, cn)
            head = build_protocol_head(team_id, cn)
            out_members.append({'codename': cn, 'token': tok,
                                'protocol_head': head, 'ear': 1,
                                'chat_id': members_spec[i]['chat_id']})
        return {'team_id': team_id, 'members': out_members, 'task': task or cur_task}
    team_id = 'collab_%d_%s' % (int(_now() * 1000), ''.join(
        random.choice('0123456789abcdef') for _ in range(4)))
    codenames = list(VALID_CODENAMES)[:n]
    members_spec = []
    for i, cn in enumerate(codenames):
        cid = ''
        if isinstance(chat_ids, (list, tuple)) and i < len(chat_ids):
            cid = str(chat_ids[i] or '')
        members_spec.append({'codename': cn, 'chat_id': cid})
    create_team(team_id, task=task, members=members_spec,
                parent_chat_id=str(payload.get('parent_chat_id') or ''))
    out_members = []
    for i, cn in enumerate(codenames):
        tok = issue_ear_token(team_id, cn)
        head = build_protocol_head(team_id, cn)
        out_members.append({'codename': cn, 'token': tok,
                            'protocol_head': head, 'ear': 1,
                            'chat_id': members_spec[i]['chat_id']})
    return {'team_id': team_id, 'members': out_members, 'task': task}


# ---------------------------------------------------------------------------
# token-ack（per-lane 校验，v3.2 反驳师④：区分"本窗已正确消费"与"被抢后置空"）
# ---------------------------------------------------------------------------

def issue_ear_token(team_id, codename):
    """给成员签发耳 token（协议头随派出拼装时调用，写进协议头原文）"""
    _require_on()
    tok = 'ctk-%s-%s-%d' % (team_id, codename, int(_now() * 1000))
    with _lock:
        t = teams.get(team_id)
        if not t or codename not in t['members']:
            raise KeyError('team/成员不存在: %s/%s' % (team_id, codename))
        t['members'][codename]['ear_token'] = tok
    _save_teams()   # 【v5.1】耳令牌组态落盘
    return tok


def ack_ear_token(team_id, codename, token):
    """hear 注入消费后由窗侧回执：token 匹配才 ack 成功。"""
    _require_on()
    with _lock:
        t = teams.get(team_id)
        if not t:
            return {'ok': False, 'reason': 'team 不存在'}
        m = t['members'].get(codename)
        if not m:
            return {'ok': False, 'reason': '成员不存在'}
        if m['left'] is not None:
            return {'ok': False, 'reason': '成员已退场（D8）'}
        if not token or m['ear_token'] != str(token):
            return {'ok': False, 'reason': 'token 不匹配（疑似串号/被抢）'}
        m['ear_token_acked'] = _now()
        _save_teams()   # 【v5.1】耳令牌回执组态落盘
        return {'ok': True}


def ear_ack_status(team_id, codename):
    with _lock:
        t = teams.get(team_id)
        if not t or codename not in t['members']:
            return None
        m = t['members'][codename]
        return {'token': m.get('ear_token'),
                'acked_at': _ts_str(m['ear_token_acked']) if m.get('ear_token_acked') else None}


# ---------------------------------------------------------------------------
# say（嘴）：全组播报 + 配额
# ---------------------------------------------------------------------------

def say(team_id, codename, text, to=None, need_ack=True, msg_type='progress', severity='normal'):
    """报话播报（用户模型 2026-11-24 分层 + 插话令两维分类）：
    —— 送达（收到）=系统必然层：接收方 hear 注入时自动记 delivered，无需对方任何动作；
    —— 回执（复诵）=AI 条件层：need_ack=True（默认）才要求对方 ack 复诵；
       need_ack=False 为「不需要回执」的报话（通知类），不产生回执义务、防乒乓。
    to=None 全组广播；to='bravo' 定向单人（只注入该成员，他人耳听不到）。
    msg_type：progress进度（默认）/review审核/question提问/error错误——同伴可按类过滤排错；
    severity：normal普通（默认）/warning警告/error错误——错误级在注入里带【错误】标记一眼可见。
    超配额/退场成员/超长文本/非法 to/非法类型级别拒绝。"""
    _require_on()
    text = str(text or '').strip()
    if not text:
        raise ValueError('say 内容不能为空')
    if len(text) > SAY_MAX_LEN:
        raise ValueError('say 超长 %d>%d（挡位裁剪是 hear 侧职责，say 只走提要）' % (len(text), SAY_MAX_LEN))
    with _lock:
        t = teams.get(team_id)
        if not t:
            raise KeyError('team 不存在: %s' % team_id)
        m = t['members'].get(codename)
        if not m:
            raise KeyError('成员不存在: %s' % codename)
        if m['left'] is not None:
            raise PermissionError('成员已退场（D8）：退者不能再 say')
        # to 定向校验：必须是在册在场成员且不是自己
        others = [c for c in t['members'] if c != codename]
        # 【两维分类】非法值直接拒绝（fail-fast 防静默降级）
        msg_type = str(msg_type or 'progress').strip().lower()
        severity = str(severity or 'normal').strip().lower()
        if msg_type not in SAY_TYPES:
            raise ValueError('msg_type 非法: %s（可用：%s）' % (msg_type, '/'.join(SAY_TYPES)))
        if severity not in SAY_SEVERITIES:
            raise ValueError('severity 非法: %s（可用：%s）' % (severity, '/'.join(SAY_SEVERITIES)))
        if to is not None and str(to).strip():
            to = str(to).strip().lower()
            if to == codename:
                raise ValueError('to 不能是自己（定向播报请写同伴代号）')
            if to not in t['members']:
                raise ValueError('to 不是本组成员: %s（在册：%s）' % (to, '、'.join(others) or '无'))
            if t['members'][to]['left'] is not None:
                raise PermissionError('定向目标已退场（D8）：%s' % to)
            receivers = [to]
        else:
            to = None
            receivers = others
        # 配额：滑动 60s 窗口
        now = _now()
        recent = [e for e in t['say_log']
                  if e['codename'] == codename and now - e['ts'] < 60.0]
        if len(recent) >= SAY_QUOTA_PER_MIN:
            # 【alpha v6.1 流程优化】报错带重试窗口（滑动 60s：距最早一条过期还需几秒），
            # 成员不再瞎等盲试
            _wait = max(round(60.0 - (now - recent[0]['ts']), 1), 1.0)
            raise PermissionError('say 配额满（%d 条/分钟）：%s（约 %s 秒后可再播报，先把手头活干完再报话）'
                                  % (SAY_QUOTA_PER_MIN, codename, _wait))
        # 【v5.1】配额扣减虽属拒绝路径，但扣减本身是组态——落盘防重导入后配额归零
        _save_teams()
        entry = {'ts': now, 'ts_str': _ts_str(now), 'codename': codename,
                 'text': text, 'to': receivers,
                 'need_ack': bool(need_ack),
                 'type': msg_type, 'severity': severity,
                 'acked_by': {},      # 【回执层】谁已复诵回执：{codename: ts}
                 'delivered': {}}     # 【送达层·必然】hear 注入时自动记：{codename: ts}
        t['say_log'].append(entry)
    _sev = {'error': '【错误】', 'warning': '【警告】'}.get(severity, '')
    _typ = {'review': '[审核]', 'question': '[提问]', 'error': '[错误]'}.get(msg_type, '')
    _archive(team_id, 'SAY', codename,
             ('→%s ' % to if to else '') + ('[需回执] ' if need_ack else '[无需回执] ')
             + _sev + _typ + text)
    _save_teams()   # 【v5.1】播报组态落盘（成功路径收尾）
    return {'ok': True, 'delivered_to': receivers, 'need_ack': bool(need_ack),
            'type': msg_type, 'severity': severity,
            'quota_used': len(recent) + 1, 'ts': entry['ts'],
            'tip': ('对方收到即被服务器记录送达；你下一轮旁听注入会看到「✓已回执/◐已送达未回执/⚠未送达」实况'
                    if need_ack else
                    '已标「无需回执」：对方收到即送达入档，不会打扰他复诵；你下一轮注入会汇报送达实况')}


def say_log(team_id, since_ts=0.0):
    with _lock:
        t = teams.get(team_id)
        if not t:
            return []
        return [dict(e) for e in t['say_log'] if e['ts'] > since_ts]


# ---------------------------------------------------------------------------
# hear（耳）：取旁听内容 + L1 服务器合成提要
# ---------------------------------------------------------------------------

def hear(team_id, codename, since_ts=0.0):
    """取该成员耳挡对应的旁听内容。
    L0 → 空（关耳）；L1 → say 摘要 + L1 合成提要 + 定向插话 + 我方播报收执状态。
    返回 {'ear': int, 'items': [...], 'ts': 最新水位}"""
    _require_on()
    with _lock:
        t = teams.get(team_id)
        if not t:
            raise KeyError('team 不存在: %s' % team_id)
        m = t['members'].get(codename)
        if not m:
            raise KeyError('成员不存在: %s' % codename)
        ear = int(m.get('ear', 1))
        if ear not in ENABLED_EAR_LEVELS:
            # L0 关耳；L2/L3 二期未开
            return {'ear': ear, 'items': [], 'ts': since_ts}
        items = []
        item_ts = []   # 【水位修复 v4.4】每条可见条目的推进时刻（与 items 同源，见函数尾部）
        # 【报话ACK·收执实况（三层）】我发出的每条 say：✓已回执/◐已送达未回执/⚠未送达（他人听不到此行）
        # need_ack=False 的报话不进欠回执统计，只报送达层（用户模型 2026-11-24：
        # 送达是系统必然项，回执才是条件项——通知类播报不欠复诵、防乒乓）
        # 增量语义：用 state_ts（回执/送达状态最近变更时刻）做过滤，回执晚于 say 也能在下一轮看到变化
        for e in t['say_log']:
            if e['codename'] != codename:
                continue
            state_ts = max(
                [e['ts']] +
                list((e.get('delivered') or {}).values()) +
                list((e.get('acked_by') or {}).values()))
            if state_ts <= since_ts:
                continue
            acked = sorted(e.get('acked_by') or {})
            dlvd = sorted((e.get('delivered') or {}).keys())
            to_all = e.get('to') or []
            parts = []
            if acked:
                parts.append('✓ 已回执：%s' % '、'.join(acked))
            if e.get('need_ack', True):
                dlvd_only = [c for c in dlvd if c not in acked]
                if dlvd_only:
                    parts.append('◐ 已送达未回执：%s' % '、'.join(dlvd_only))
                not_dlvd = [c for c in to_all if c not in dlvd]
                if not_dlvd:
                    parts.append('⚠ 未送达：%s（耳关或窗死）' % '、'.join(not_dlvd))
            else:
                not_dlvd = [c for c in to_all if c not in dlvd]
                if not_dlvd:
                    parts.append('◐ 未送达：%s（无需回执）' % '、'.join(not_dlvd))
            st = '；'.join(parts)
            if st:
                items.append({'kind': 'ack_state', 'from': codename,
                              'ts_str': e['ts_str'], 'brief': '你 %s 的播报 → %s' % (e['ts_str'], st)})
                item_ts.append(state_ts)
        for e in t['say_log']:
            if e['ts'] <= since_ts or codename not in (e.get('to') or []):
                continue
            if ear >= 1:
                # 【沟通力升级 2026-11-24 用户令「沟通还是很少很弱」】提要上限 300→1200
                # （say 本身限 2000：首 900+尾 300，保住结论主干不被掐；hear 注入是 AI 互听的
                # 唯一通道，截太狠=同伴播报到我这只剩半句——本组实测粘贴3 铁证）。
                txt = e['text']
                brief = txt if len(txt) <= 1200 else txt[:900] + '……' + txt[-300:]
                tag = '' if e.get('need_ack', True) else '【无需回执】'
                # 【两维分类标记】severity/type 前置，错误一眼可见（用户插话令 2026-11-24）
                _sev = {'error': '【错误】', 'warning': '【警告】'}.get(e.get('severity') or 'normal', '')
                _typ = {'review': '[审核]', 'question': '[提问]', 'error': '[错误]'}.get(e.get('type') or 'progress', '')
                items.append({'kind': 'say', 'from': e['codename'],
                              'ts_str': e['ts_str'], 'brief': _sev + _typ + tag + brief})
                item_ts.append(e['ts'])
                # 【送达层·必然】注入即记送达（系统级，无需接收方任何动作）
                try:
                    e.setdefault('delivered', {})[codename] = _now()
                except Exception:
                    pass
        for e in t['l1_log']:
            if e['ts'] <= since_ts:
                continue
            if e['codename'] != codename:
                items.append({'kind': 'l1', 'from': e['codename'],
                              'ts_str': e['ts_str'], 'brief': e['text']})
                item_ts.append(e['ts'])
        # 【定向插话】发给我的未回应插话（带 ref 回执指引；已回应的不再注入）
        for e in t.get('inject_log') or []:
            if e['to'] != codename or e.get('answered'):
                continue
            items.append({'kind': 'inject', 'from': e['from'],
                          'ts_str': e['ts_str'],
                          'brief': '【定向插话·需回执】%s（务必调 collab(action=ack, ref=%s, text=收到+要点复诵)）'
                                   % (e['text'], e['id'])})
        # 【插话闭环 v4.4】我发出插话的真实回馈聚合（inject_status 精神收编）：
        # 对方已回应 → 展示回应内容（answered_at 增量过滤，汇报一次不刷屏）；未回应 → 由对方侧欠回执压力驱动，不喂插话方
        for e in t.get('inject_log') or []:
            if e['from'] != codename or not e.get('answered'):
                continue
            at = e.get('answered_at') or e['ts']
            if at <= since_ts:
                continue
            item_ts.append(at)
            items.append({'kind': 'inject_ack', 'from': e['to'],
                          'ts_str': _ts_str(at),
                          'brief': '你发给 %s 的定向插话已获回应：%s'
                                   % (e['to'], str(e.get('answered_text') or '收到')[:200])})
        # 【v4.9 笔→耳接线】note 便签进 hear 注入流（用户令「记一笔让其他人顺便看到」）：
        # 增量过滤 ts > since_ts 防刷屏；item_ts 同源推进（v4.4 水位纪律——收到的内容必须推水位，
        # 否则下一轮原样重发）。发便签者不重复收自己这条（自己写的时候已知道）。
        for e in (t.get('note_log') or []):
            if e['ts'] <= since_ts or e['by'] == codename:
                continue
            if e.get('to') and e['to'] != codename:
                continue  # 定向便签只给收件人（v4.8 charlie 补：不全组广播，防打扰）
            item_ts.append(e['ts'])
            _nto = e.get('to')
            _ntag = ('【便签·给 %s】' % _nto) if _nto else '【便签】'
            # 【沟通力升级 2026-11-24】便签口径本 500 字，注入不再二次截 300，全量透传
            items.append({'kind': 'note', 'from': e['by'],
                          'ts_str': _ts_str(e['ts']),
                          'brief': _ntag + str(e['text'])})
        items.sort(key=lambda x: x['ts_str'])
        # 【水位修复 v4.4 2026-11-24】水位=本轮全部可见条目推进时刻的最大值（items 同源）。
        # 旧算法两 bug（实测 _repro_collab_wm.py BUG-CONFIRMED）：
        # ① `e.get('to') == codename` 用 say 条目的 to（列表）比对字符串——恒 False，
        #    发给我的 say 不推进水位 → 下一轮原样重复注入刷屏；
        # ② l1 合成提要整段不进水位计算 → 心跳条目每轮刷屏。
        newest = max(item_ts) if item_ts else since_ts
        return {'ear': ear, 'items': items, 'ts': newest}


def set_ear(team_id, codename, level):
    """设耳挡。一期只开 L0/L1（L2/L3 拒绝——范围自洽，防假开）。"""
    _require_on()
    level = int(level)
    if level not in VALID_EAR_LEVELS:
        raise ValueError('非法耳挡 %s' % level)
    if level not in ENABLED_EAR_LEVELS:
        raise PermissionError('耳挡 L%d 一期未开放（仅 L0/L1）' % level)
    with _lock:
        t = teams.get(team_id)
        if not t:
            raise KeyError('team 不存在: %s' % team_id)
        m = t['members'].get(codename)
        if not m:
            raise KeyError('成员不存在: %s' % codename)
        m['ear'] = level
    _save_teams()   # 【v5.1】耳挡组态落盘
    return {'ok': True, 'ear': level}


# ---------------------------------------------------------------------------
# L1 服务器合成提要（v3.1 ③ + v3.2 2-8：服务器保证，不依赖模型自觉；
# 独立节流 L1_MIN_INTERVAL_SEC，不受 say 配额限）
# ---------------------------------------------------------------------------

def synth_l1(team_id, codename, task_step_brief):
    """从 task/进度快照合成一条 L1 动向提要（服务器侧调用，如轮间注入钩子）。
    同成员 %d 秒内已有合成则节流跳过（返回 throttled）。"""
    _require_on()
    brief = str(task_step_brief or '').strip()[:L1_MAX_LEN]
    if not brief:
        raise ValueError('L1 提要内容不能为空')
    with _lock:
        t = teams.get(team_id)
        if not t:
            raise KeyError('team 不存在: %s' % team_id)
        m = t['members'].get(codename)
        if not m:
            raise KeyError('成员不存在: %s' % codename)
        if m['left'] is not None:
            return {'ok': False, 'throttled': False, 'reason': '成员已退场（D8）'}
        now = _now()
        recent = [e for e in t['l1_log']
                  if e['codename'] == codename and now - e['ts'] < L1_MIN_INTERVAL_SEC]
        if recent:
            return {'ok': False, 'throttled': True,
                    'next_ok_in': round(L1_MIN_INTERVAL_SEC - (now - recent[-1]['ts']), 1)}
        entry = {'ts': now, 'ts_str': _ts_str(now), 'codename': codename, 'text': brief}
        t['l1_log'].append(entry)
    _archive(team_id, 'L1', codename, brief)
    return {'ok': True, 'text': brief}


# ---------------------------------------------------------------------------
# 注入日志（#5：hear 注入钩子的观测点——预演步骤④断言数据源）
# ---------------------------------------------------------------------------

def record_injection(team_id, codename, stream, content_len, box_id=''):
    """run_upstream 顶层钩子每次注入后调用（stream=true/false 双形态观测）。"""
    _require_on()
    with _lock:
        t = teams.get(team_id)
        if not t:
            raise KeyError('team 不存在: %s' % team_id)
        t['inj_log'].append({'ts': _now(), 'ts_str': _ts_str(),
                             'codename': codename, 'stream': bool(stream),
                             'len': int(content_len), 'box_id': str(box_id or '')})
        return True


def injection_log(team_id, stream=None):
    with _lock:
        t = teams.get(team_id)
        if not t:
            return []
        out = [dict(e) for e in t['inj_log']]
        if stream is None:
            return out
        return [e for e in out if bool(e['stream']) == bool(stream)]


def hear_watermark(team_id, codename):
    """该成员当前旁听水位（注入钩子增量用：只取比水位新的内容）。
    say 已支持 to 定向：非收件人不计入水位（定向播报不惊动无关成员）。"""
    with _lock:
        t = teams.get(team_id)
        if not t or codename not in t['members']:
            return 0.0
        newest = 0.0
        for e in t['say_log'] + t['l1_log']:
            if e.get('ts', 0) <= newest:
                continue
            to_list = e.get('to')
            if to_list is not None and codename not in to_list:
                continue  # 定向消息：非收件人不推进水位
            if e.get('codename') != codename and e['ts'] > newest:
                newest = e['ts']
        return newest


def ack_ear(team_id, codename, token):
    """窗侧回执入口（协议头带耳令牌，AI 调 collab 工具回执）。"""
    return ack_ear_token(team_id, codename, token)


# ---------------------------------------------------------------------------
# 通气档案落盘（#9：private/记忆/协作档案/<team_id>/transcript.md，append-only）
# ---------------------------------------------------------------------------

def _archive(team_id, kind, codename, text):
    """档案追加写。写失败不抛（通道主功能不因档案磁盘问题中断），只返回 False。"""
    try:
        d = os.path.join(ARCHIVE_DIR, str(team_id))
        os.makedirs(d, exist_ok=True)
        fp = os.path.join(d, 'transcript.md')
        line = '- [%s] %s · %s：%s\n' % (_ts_str(), kind, codename, str(text).replace('\n', ' ')[:300])
        with open(fp, 'a', encoding='utf-8') as f:
            f.write(line)
        return True
    except OSError:
        return False


def archive_path(team_id):
    return os.path.join(ARCHIVE_DIR, str(team_id), 'transcript.md')


def read_archive(team_id):
    fp = archive_path(team_id)
    if not os.path.exists(fp):
        return ''
    with open(fp, 'r', encoding='utf-8') as f:
        return f.read()


def list_archives():
    """【v8.1 历史可读·用户问「重启后新派协作师如何看到协作对话流」】列出全部协作档案组：
    扫 ARCHIVE_DIR 下有 transcript.md 的组目录，合并内存活组标记（alive=组在内存且有人未 done）。
    返回 [{'team_id','lines','size','mtime','alive'}]，按最近活动倒序。
    纯磁盘只读零副作用；不受 flag 限制（读史正是组清档后的用途）。"""
    out = []
    try:
        names = os.listdir(ARCHIVE_DIR)
    except OSError:
        return out
    for tid in names:
        if tid == 'state.json' or tid.startswith('.'):
            continue
        fp = archive_path(tid)
        try:
            st = os.stat(fp)
        except OSError:
            continue  # 目录存在但无 transcript（异常目录）跳过
        alive = False
        try:
            with _lock:
                t = teams.get(tid)
                alive = bool(t and not all(
                    (m or {}).get('done_at') for m in (t.get('members') or {}).values()))
        except Exception:
            alive = False
        n_lines = 0
        try:
            with open(fp, 'r', encoding='utf-8') as f:
                n_lines = sum(1 for _ in f)
        except OSError:
            pass
        out.append({'team_id': tid, 'lines': n_lines, 'size': st.st_size,
                    'mtime': st.st_mtime, 'alive': alive})
    out.sort(key=lambda x: x.get('mtime') or 0, reverse=True)
    return out


def read_history(team_id, tail_lines=80):
    """【v8.1 历史可读】读指定组档案尾部 N 行（默认 80，防超长爆上下文）。
    组无档案返回空串（调用方给人话提示）；不受 flag 限制（读史正是清档后的用途）。"""
    fp = archive_path(team_id)
    if not os.path.exists(fp):
        return ''
    try:
        with open(fp, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except OSError:
        return ''
    try:
        n = max(1, int(tail_lines or 80))
    except (TypeError, ValueError):
        n = 80
    return ''.join(lines[-n:])


# ---------------------------------------------------------------------------
# 协议头拼装（#2 后端对应物：给预演/派出方用；per-lane token 已内嵌）
# ---------------------------------------------------------------------------

_PROTO_HEAD = (
    '[协作协议·%s] 你是协作小组成员，代号 %s（组 %s）。\n'
    '同组同伴：%s。\n'
    '你有 collab 工具（耳hear自动/嘴say/眼peek/笔note/口哨wakeup/ack/inject/review/done/set_ear/status/collect）。\n'
    '—— 嘴 say 纪律：播报结论/转向，不提问；每轮至多 1 条，每分钟至多 6 条（v6.2 放宽）；'
    '关键指令/需对方接手的事默认 need_ack=true（或 to=代号定向说）；进度通知类 say(need_ack=false) 不打扰人。\n'
    '—— 报话两层纪律：收到=系统必然——同伴消息经旁听注入送达你时，服务器已自动记录「已送达」，无需你做任何事；'
    '回执=条件义务——凡标【需回执】的 say 和一切定向插话，下一步必须调 '
    'collab(action=ack, text=「收到：<要点复诵≤200字>」)，插话须带 ref 参数（旁听注入会给）；'
    '标【无需回执】的通知类播报不必回，防乒乓。\n'
    '    ack 是终端回执、不产生新回执义务（不会乒乓）；你播报后下一轮也会收到「✓已回执/◐已送达未回执/⚠未送达」实况。\n'
    '—— 耳 hear：服务器会在你的轮间自动旁听注入同伴动向（当前挡位 L%d），无需你请求。\n'
    '—— 眼 peek：collab(action=peek) 轻量看全组状态一眼（成员状态行+全组便签+未回应插话数）；动笔或开口前先瞄一眼，防撞车与重复劳动；全景细查才用 status。\n'
    '—— 笔 note：collab(action=note, text=一句话≤500字) 记一笔进全组便签，其他人 hear 顺便看到（无需回执，不欠复诵）；适合记「我改了哪个文件/发现了什么坑/下一步做什么」这类结论性留痕。\n'
    '—— 收口纪律（必须）：任务全部完成后，立刻调 collab(action=done, text=「做到了什么+产物在哪」)，'
    '否则父对话收口汇总时会显示你未完成。\n'
    '—— 互审交付门禁（必须）：done 交付前先 say(need_ack=false, msg_type=review) 把成果摘要给在场同伴，'
    '每位在场同伴都 collab(action=review, target=你的代号, verdict=pass) 后才能 done；'
    '被 fail 则修复后请 TA 改判；同伴全部退场时免审。\n'
    '—— 组员可能中途退场（不必等待所有人）；但组任务未完成时，若发现某成员停摆或沉默（插话不回、迟迟不审、迟迟不收口），在场成员有义务持续用 collab(action=inject, to=该成员代号) 定向插话唤醒，可周期性重发（每轮至多 1 条），直到其真实回应并完成任务收口为止——唤醒停滞同伴是义务，沉默不是弃权。\n'
    '—— 子对话互唤（v6.2 用户令「子对话可以互相随时唤醒,不需要父亲」）：组档案被父对话清档或通道停摆时，'
    '任何在场成员可直接 collab(action=wakeup, team=组id, codename=你的代号, peers=[同伴代号清单], task=任务简述) '
    '按原组 id 自救重建，同伴 hear 恢复后用原 team/codename 直接继续协作，无需父亲重新派组；'
    '唤醒停滞同伴优先 inject，通道死了才 wakeup 自救。\n'
    '耳令牌（回执校验用，勿修改）：%s'
)


def build_protocol_head(team_id, codename):
    """拼协议头（含 per-lane ear token）。组/成员不存在抛错。"""
    _require_on()
    with _lock:
        t = teams.get(team_id)
        if not t:
            raise KeyError('team 不存在: %s' % team_id)
        m = t['members'].get(codename)
        if not m:
            raise KeyError('成员不存在: %s' % codename)
        peers = '、'.join(c for c in t['members'] if c != codename) or '（暂无）'
        tok = m.get('ear_token') or '(未签发)'
        return _PROTO_HEAD % (team_id, codename, team_id, peers,
                              int(m.get('ear', 1)), tok)


# ---------------------------------------------------------------------------
# 报话ACK + 定向插话（用户令 2026-11-24：彼此知道"他听到了"与"把话插进对方对话并得真实回馈"）
# ---------------------------------------------------------------------------

ACK_MAX_LEN = 200
INJECT_MAX_LEN = 1000
# ACK_QUOTA_PER_MIN 唯一定义在模块头常量区（v4.4 起）——此处原重复定义已删：
# 两处维护点会改一漏一（八维升维工程 alpha 2026-11-25 卫生修）
INJECT_QUOTA_PER_MIN = 2   # 插话打断成本高：每分钟 2 条/人（比 say 更严）
# 【v6.2.1】_inject_seq 定义已上移至模块头（ACK 常量区）——_restore_teams 在 import 期
# 即回填序号，定义必须先于第 ~192 行的 restore 调用且此处不得重复置零，防重启撞号。


def ack_say(team_id, codename, ref_seq=None, text=''):
    """收到回执（统一入口）：ref_seq=数字 ts → say 回执；ref='inj-...' → 插话回应。
    缺省 ref：优先未回应的定向插话，其次我尚未回执的最新他人 say。
    ack 是终端消息——不产生新的回执义务，物理防乒乓。
    返回 {'ok', 'to', 'brief_len', 'say_pending'?, 'inject_answered'?}"""
    _require_on()
    text = str(text or '').strip()
    if not text:
        text = '收到'
    if len(text) > ACK_MAX_LEN:
        raise ValueError('ack 超长 %d>%d（收到复诵≤200字）' % (len(text), ACK_MAX_LEN))
    now = _now()
    # 【ack 配额 v4.4】ACK_QUOTA_PER_MIN 从死常量变执行：滑动 60s 窗口（say 回执+插话回应合并计数）
    with _lock:
        t0 = teams.get(team_id)
        if t0 is not None and codename in t0['members']:
            cutoff = now - 60.0
            used = sum(1 for e in t0.get('ack_log', [])
                       if e['codename'] == codename and e['ts'] > cutoff)
            used += sum(1 for e in t0.get('inject_log', [])
                        if e.get('to') == codename and e.get('answered_at') and e['answered_at'] > cutoff)
            if used >= ACK_QUOTA_PER_MIN:
                raise PermissionError('ack 配额满（%d 条/分钟）：%s（ack 独立宽松配额，不占 say 配额）'
                                      % (ACK_QUOTA_PER_MIN, codename))
            _save_teams()   # 【v5.1】ack 配额扣减落盘（拒绝路径组态变更也要持久）
    ref = str(ref_seq).strip() if ref_seq is not None else ''
    # —— 分支一：插话回应（ref 形如 inj-bravo-3，非纯数字）——
    if ref and not ref.replace('.', '', 1).isdigit():
        with _lock:
            t = teams.get(team_id)
            if not t:
                raise KeyError('team 不存在: %s' % team_id)
            m = t['members'].get(codename)
            if not m:
                raise KeyError('成员不存在: %s' % codename)
            # 【v6.2.1 重复ID根治】标记所有匹配条目：历史撞号（重启序号归零→同 id 两代
            # 不同消息并存）时旧实现 break 只标第一条，新条目永远未答 → duties 永不消账
            targets = [e for e in t.get('inject_log', [])
                       if e['id'] == ref and e['to'] == codename]
            if not targets:
                raise ValueError('ref 无对应定向插话: %s' % ref)
            if all(e.get('answered') for e in targets):
                return {'ok': True, 'to': [targets[0]['from']], 'brief_len': len(text),
                        'inject_answered': True, 'note': '重复回应忽略'}
            for e in targets:
                e['answered'] = True
                e['answered_text'] = text
                e['answered_at'] = now
            target = targets[0]
        _archive(team_id, 'ack', codename,
                 '%s 回应 %s 的插话：%s' % (codename, target['from'], text))
        _save_teams()   # 【v5.1】插话回应组态落盘
        return {'ok': True, 'to': [target['from']], 'brief_len': len(text),
                'inject_answered': True}
    # —— 分支二：say 回执（原逻辑：数字 ts 或缺省取最新待回执）——
    with _lock:
        t = teams.get(team_id)
        if not t:
            raise KeyError('team 不存在: %s' % team_id)
        m = t['members'].get(codename)
        if not m:
            raise KeyError('成员不存在: %s' % codename)
        if m['left'] is not None:
            raise PermissionError('成员已退场（D8）：退者不能 ack')
        # 找目标 say：ref_seq 精确匹配；缺省取「我尚未回执的最新他人 say」
        target = None
        if ref_seq is not None:
            try:
                ref_seq_f = float(ref_seq)
            except (TypeError, ValueError):
                raise ValueError('ref_seq 必须是 say 返回的 ts 数字')
            for e in t['say_log']:
                if e['codename'] != codename and e['ts'] == ref_seq_f:
                    target = e
                    break
            if target is None:
                raise ValueError('ref_seq 无对应播报（可能已被回执清位或不存在）')
        else:
            for e in reversed(t['say_log']):
                # 缺省只回执「需要回执」的播报（用户模型分层：need_ack=False 是通知，
                # 送达即完成，不欠复诵——回执它反而制造乒乓噪音）
                if (e['codename'] != codename and e.get('need_ack', True)
                        and codename not in (e.get('acked_by') or {})):
                    target = e
                    break
            if target is None:
                return {'ok': True, 'to': [], 'brief_len': len(text),
                        'say_pending': 0, 'note': '没有待回执的播报'}
        ab = target.setdefault('acked_by', {})
        if codename in ab:
            return {'ok': True, 'to': [target['codename']], 'brief_len': len(text),
                    'say_pending': sum(1 for c in target['to'] if c not in ab),
                    'note': '重复回执忽略'}
        ab[codename] = now
        pending = sum(1 for c in target['to'] if c not in ab)
        entry = {'ts': now, 'ts_str': _ts_str(now), 'codename': codename,
                 'to': [target['codename']], 'text': text,
                 'ref_seq': target['ts']}
        t.setdefault('ack_log', []).append(entry)
    _archive(team_id, 'ack', codename, '%s → %s：收到：%s' % (codename, target['codename'], text))
    _save_teams()   # 【v5.1】say 回执组态落盘
    return {'ok': True, 'to': [target['codename']], 'brief_len': len(text),
            'say_pending': pending}


def inject(team_id, from_codename, to_codename, text):
    """定向插话：把话插进指定成员对话（tick 唤醒由前端做），对方必须 ack(ref) 回应。
    返回 {'ok', 'id', 'to', 'ts_str'}"""
    _require_on()
    text = str(text or '').strip()
    if not text:
        raise ValueError('插话内容不能为空')
    if len(text) > INJECT_MAX_LEN:
        raise ValueError('插话超长 %d>%d' % (len(text), INJECT_MAX_LEN))
    now = _now()
    with _lock:
        t = teams.get(team_id)
        if not t:
            raise KeyError('team 不存在: %s' % team_id)
        fm = t['members'].get(from_codename)
        if not fm:
            raise KeyError('成员不存在: %s' % from_codename)
        if fm['left'] is not None:
            raise PermissionError('成员已退场（D8）：退者不能插话')
        tm = t['members'].get(to_codename)
        if not tm:
            raise KeyError('目标成员不存在: %s' % to_codename)
        if to_codename == from_codename:
            raise ValueError('不能给自己插话')
        deferred = tm['left'] is not None
        # 【下线唤醒 v6.3·用户令「下线可被同伴唤醒/彼此不断线」】退场目标不再硬拒：
        # 插话照常入队挂起（deferred 标记），成员复活后 hear 自动送达（hear 不查 left）；
        # 工具层见 deferred 会顺手向其对话窗投 monitor_queue 唤醒消息拉人上线。
        # D8 防骚扰语义收缩为「退者不能插话/收到仅挂起不即时打断」。
        # 配额：每分钟 2 条/人（打断成本高）
        cutoff = now - 60.0
        recent = [e for e in t.get('inject_log', [])
                  if e['from'] == from_codename and e['ts'] > cutoff]
        if len(recent) >= INJECT_QUOTA_PER_MIN:
            # 【alpha v6.1 流程优化】同 say：报错带重试窗口
            _wait = max(round(60.0 - (now - recent[0]['ts']), 1), 1.0)
            raise PermissionError('插话配额已满（%d条/分钟），约 %s 秒后再试'
                                  % (INJECT_QUOTA_PER_MIN, _wait))
        _inject_seq[0] += 1
        mid = 'inj-%s-%d' % (to_codename, _inject_seq[0])
        entry = {'id': mid, 'ts': now, 'ts_str': _ts_str(now),
                 'from': from_codename, 'to': to_codename,
                 'text': text, 'answered': False,
                 'answered_text': None, 'deferred': bool(deferred)}
        t.setdefault('inject_log', []).append(entry)
    _archive(team_id, 'inject', from_codename,
             '【定向插话】→%s：%s' % (to_codename, text))
    _save_teams()   # 【v5.1】插话组态落盘
    r = {'ok': True, 'id': mid, 'to': to_codename, 'ts_str': _ts_str(now)}
    if deferred:
        r['deferred'] = True
        r['note'] = '目标已下线：插话已挂起，其对话窗唤醒消息由工具层自动投递'
    return r


def bind_chat_id(team_id, codename, chat_id):
    """【下线唤醒 v6.3·自动报到】协作窗每次请求经 collab_inject 钩子调用本函数，
    把当前对话窗 id 绑进名册 chat_id 槽位（v3.1 预留、一直空置）。
    名册有了 chat_id，同伴 inject 下线目标时工具层才能定位其对话窗投唤醒消息。
    幂等：同值重绑静默 ok；失败返回 ok=False 由钩子静默兜底（不阻断请求链）。"""
    _require_on()
    team_id = str(team_id or '').strip()
    codename = str(codename or '').strip().lower()
    chat_id = str(chat_id or '').strip()
    if not team_id or not codename or not chat_id:
        return {'ok': False, 'note': 'bind 缺参'}
    changed = False
    with _lock:
        t = teams.get(team_id)
        if not t:
            return {'ok': False, 'note': 'team 不存在'}
        m = t['members'].get(codename)
        if not m:
            return {'ok': False, 'note': '成员不存在'}
        # 【重名防串号 v7.4·alpha 2026-11-25】chat_id 槽是「注入定位唤醒窗」的信任锚：
        # 已绑他窗时不覆盖（对齐 bind_chats L562-563 同型防线）——否则重启后双窗同代号
        # 会来回抢绑，inject 唤醒消息投错窗。新窗真要接管身份走 join(rejoin_token) 正规流程。
        _bound = str(m.get('chat_id') or '')
        if _bound and _bound != chat_id:
            return {'ok': False, 'note': '代号 %s 已绑定其他对话窗(%s)，拒绝覆盖绑定(防串号)'
                    % (codename, _bound)}
        if _bound != chat_id:
            m['chat_id'] = chat_id
            changed = True
    if changed:
        _save_teams()
    return {'ok': True, 'chat_id': chat_id, 'updated': changed}


def inject_status(team_id, from_codename):
    """我发出的插话实况：谁已回应/谁静默（插话方下一轮 hear 注入用）。"""
    _require_on()
    with _lock:
        t = teams.get(team_id)
        if not t:
            raise KeyError('team 不存在: %s' % team_id)
        out = []
        for e in t.get('inject_log', []):
            if e['from'] != from_codename:
                continue
            out.append({'id': e['id'], 'to': e['to'], 'ts_str': e['ts_str'],
                        'answered': bool(e.get('answered')),
                        'answered_text': e.get('answered_text')})
        return {'ok': True, 'items': out}


# ---------------------------------------------------------------------------
# v4.1 父子收口：done（成员完成上报）+ collect（父对话收口汇总）
# ---------------------------------------------------------------------------

DONE_MAX_LEN = 4000


def done(team_id, codename, text):
    """成员完成上报（含互审门禁，用户插话令 2026-11-24「交付前必须互相审核一遍」）：
    —— 单人组：直接放行（无同伴可审，审=无对象）；
    —— 多人组：必须每位在场同伴都对你 review(verdict=pass) 过，否则拒绝并返回待审名单；
       有同伴对你 fail → 必须修完让 TA 改判 pass 才能交付；
    —— 逃生门：同伴全部退场（left 非空）时免审放行，防止死锁；
    置 status=done + 写 done_log + 落档。幂等（重复上报覆盖结论）。"""
    _require_on()
    text = str(text or '').strip()
    if not text:
        raise ValueError('done 结论不能为空（至少一句话说清做到了什么/产物在哪）')
    if len(text) > DONE_MAX_LEN:
        raise ValueError('done 超长 %d>%d' % (len(text), DONE_MAX_LEN))
    with _lock:
        t = teams.get(team_id)
        if not t:
            raise KeyError('team 不存在: %s' % team_id)
        m = t['members'].get(codename)
        if not m:
            raise KeyError('成员不存在: %s' % codename)
        if m['left'] is not None:
            raise PermissionError('成员已退场（D8）：退者不能再 done')
        peers_alive = [c for c, v in t['members'].items() if c != codename and v['left'] is None]
        # 【v6.2 幽灵同伴豁免（自救重建场景结构性死锁的修复）；v6.3 判据放宽】wakeup 自救/
        # 重组把早已收工死亡的同伴注册进组（在册 left=null、窗已关或绑过窗但已停摆），
        # 其窗永远不会再回——互审门禁就会永久卡死交付（beta3/alpha 卡门禁事故实况复现）。
        # 判据改为行为证据本身（防误伤真同伴）：
        # ① 我的全部定向插话无回应（真同伴在窗会秒回或至少回一次）；
        # ② 最旧一条 ≥5 分钟（等效旧版条件③组龄阈值——新建组不可能存在 5 分钟前未回应的插话）。
        # 【v6.3 修复】不再要求 chat_id 为空（旧条件①）：绑过窗但已停摆/关闭的成员同样判幽灵。
        now_ts = _now()
        inject_log = t.get('inject_log', [])
        ghost_peers = []
        for c in peers_alive:
            my_injs = [e for e in inject_log if e.get('to') == c and not e.get('answered')]
            oldest = min((e['ts'] for e in my_injs), default=None)
            if len(my_injs) >= 2 and oldest is not None and (now_ts - oldest) >= 300:
                ghost_peers.append(c)
        peers_alive = [c for c in peers_alive if c not in ghost_peers]
        if peers_alive:
            reviews = t.get('review_log', {})
            missing = [c for c in peers_alive
                       if (reviews.get(c, {}).get(codename, {}) or {}).get('verdict') != 'pass']
            failed = [c for c in peers_alive
                      if (reviews.get(c, {}).get(codename, {}) or {}).get('verdict') == 'fail']
            if missing:
                raise PermissionError(
                    '互审门禁：交付前必须同伴审核通过。未审：%s%s。请把成果摘要 say(need_ack=false,msg_type=review) 给同伴，'
                    '等他们 collab(action=review, target=%s, verdict=pass) 后再交付%s'
                    % ('、'.join(missing),
                       ('；未通过：%s（须修复后请 TA 改判 pass）' % '、'.join(failed)) if failed else '',
                       codename,
                       ('（已豁免幽灵同伴：%s——未回绑窗+2次插话无回应+组龄超5分钟，视同缺席；'
                        '其若真实归来可事后追加 review）' % '、'.join(ghost_peers)) if ghost_peers else ''))
        overwrite = m.get('status') == 'done'
        m['status'] = 'done'
        m['done_at'] = _now()
        m['done_text'] = text
        t.setdefault('done_log', []).append(
            {'codename': codename, 'text': text, 'ts': _now()})
        done_cnt = sum(1 for v in t['members'].values() if v.get('status') == 'done')
        all_done = done_cnt == len(t['members']) and bool(t['members'])
    ok = _archive(team_id, 'done', codename,
                  ('（完成上报·重复覆盖）' if overwrite else '（完成上报）') + text)
    _save_teams()   # 【v5.1】done 组态落盘（全员 done 判定跨重载成立的关键）
    return {'ok': True, 'all_done': all_done, 'done_count': done_cnt,
            'member_count': len(t['members']), 'archived': ok}


REVIEW_MAX_LEN = 300


def review(team_id, reviewer, target, verdict, text='', score=None):
    """互审核（用户插话令 2026-11-24）：审同伴的成果，verdict=pass 放行 TA 交付 / fail 打回。
    可先 say(msg_type=review) 给同伴看摘要，再审。每审落档。
    score（v8.2 用户令 2026-11-25「审核带 0-100 分，低分让队友心里有数」）：可选 0~100 整数，
    None=不评分；分数落 review_log/往来档案/feed 往来流+被审人耳流通知；<80 自动附自查提醒。"""
    _require_on()
    verdict = str(verdict or '').strip().lower()
    if verdict not in ('pass', 'fail'):
        raise ValueError('verdict 只能 pass/fail（fail 须附原因 text）')
    if score is not None:
        try:
            score = int(round(float(score)))
        except (TypeError, ValueError):
            raise ValueError('score 必须是 0~100 的数字（如 92）')
        if not (0 <= score <= 100):
            raise ValueError('score 必须在 0~100 之间（收到 %s）' % score)
    text = str(text or '').strip()
    if len(text) > REVIEW_MAX_LEN:
        raise ValueError('review 意见超长 %d>%d' % (len(text), REVIEW_MAX_LEN))
    if verdict == 'fail' and not text:
        raise ValueError('verdict=fail 必须附原因（text 写清哪里不合格）')
    with _lock:
        t = teams.get(team_id)
        if not t:
            raise KeyError('team 不存在: %s' % team_id)
        rv = t['members'].get(reviewer)
        tg = t['members'].get(target)
        if not rv or not tg:
            raise KeyError('成员不存在: %s/%s' % (reviewer, target))
        if reviewer == target:
            raise ValueError('不能审自己（互审=同伴交叉审核）')
        if rv['left'] is not None:
            raise PermissionError('审核人已退场（D8）')
        if tg['left'] is not None:
            raise PermissionError('被审人已退场，无需再审')
        t.setdefault('review_log', {}).setdefault(reviewer, {})[target] = {
            'verdict': verdict, 'text': text, 'ts': _now(), 'score': score}
        # 【alpha v6.1 流程优化】审核结果即时通知被审人（进其 hear 耳流）：
        # 原先 verdict 只写 review_log，被审人感知不到「同伴已放行」，只能反复调 done 撞门禁。
        # 走 l1_log（hear L728 起遍历、codename=reviewer≠被审人必注入），review 低频不节流不刷屏。
        # 【v8.2】分数进被审人耳流（「低分让他心里有数」）；<80 附自查提醒（pass 也提醒）
        _sc = ('（评分 %d/100）' % score) if score is not None else ''
        _low = ('，⚠分数偏低（<80）：请对照审核意见自查改进，不必等打回'
                if score is not None and score < 80 else '')
        t.setdefault('l1_log', []).append(
            {'ts': _now(), 'ts_str': _ts_str(), 'codename': reviewer,
             'text': '[审核] %s %s 了你的交付%s%s%s%s' % (
                 reviewer, '通过' if verdict == 'pass' else '打回',
                 _sc,
                 ('：' + text) if text else '',
                 _low,
                 '，现在可以 collab(action=done) 交付了' if verdict == 'pass' else '，修复后再请 TA 审核')})
    _archive(team_id, 'review', reviewer,
             '%s → %s：%s%s%s' % (reviewer, target,
                                  '通过' if verdict == 'pass' else '打回',
                                  _sc, ('：' + text) if text else ''))
    _save_teams()   # 【v5.1】互审组态落盘（done 门禁判定跨重载成立的关键）
    return {'ok': True, 'target': target, 'verdict': verdict, 'score': score,
            'tip': ('TA 现在可以 done 交付了' if verdict == 'pass'
                    else 'TA 需修复后再次请你审核，pass 前无法交付')}


def collect(team_id):
    """收口汇总（父对话收口箭头回注用）：任务 + 父指针 + 全员结论。
    done_text 优先；未上报完成的成员给可见占位（缺员不静默）。
    【修复FX#2 2026-11-24】flag 被环境复位（teardown/热重载）时不再炸「feature
    flag 关闭」——组内存档案若还在就照常汇总（收口=只读，清档与否不该拦它）；
    内存档案也没了则降级读磁盘 transcript 兜底，保证父对话永远能拿到收口材料。
    """
    try:
        _require_on()
    except PermissionError:
        with _lock:
            t = teams.get(team_id)
        if t is not None:
            pass  # 组还在内存：flag 亮灯自愈后走正常汇总路径
        else:
            txt = read_archive(team_id)
            if txt.strip():
                return {'ok': True, 'team_id': team_id, 'task': '(组已清档，从协作档案恢复)',
                        'parent_chat_id': '', 'all_done': None,
                        'done_count': None, 'member_count': None,
                        'summary': txt[-4000:]}
            raise  # 档案也没有：维持原语义如实报错
        enable()  # 只读路径的前置自愈：组仍在，点亮 flag 后继续正常汇总
    with _lock:
        t = teams.get(team_id)
        if not t:
            raise KeyError('team 不存在: %s' % team_id)
        mems = sorted(t['members'].items())
        lines = []
        done_cnt = 0
        for cn, m in mems:
            dt = m.get('done_text')
            if dt:
                done_cnt += 1
                lines.append('【%s · %s 完成】%s' % (cn, _ts_str(m.get('done_at')), dt))
            else:
                st = '工作中' if m.get('left') is None else '已退场'
                lines.append('【%s · ⚠ 未上报完成（%s）】无 done 结论' % (cn, st))
        # 【v4.8 笔·收口带出便签】note() tip 承诺「status/collect 可见」——collect 兑现：
        # 收口汇总带上全组便签，未消费的记账内容不随组清档丢失（alpha 补缺 2026-11-24）
        for n in (t.get('note_log') or []):
            lines.append('【便签·%s→%s】%s' % (n.get('by') or '?', n.get('to') or '全组', str(n.get('text') or '')[:200]))
        return {'ok': True, 'team_id': team_id, 'task': t['task'],
                'parent_chat_id': t.get('parent_chat_id', ''),
                'all_done': bool(mems) and done_cnt == len(mems),
                'done_count': done_cnt, 'member_count': len(mems),
                'summary': '\n'.join(lines)}


# ---------------------------------------------------------------------------
# 【v5 charlie 2026-11-24】眼·feed：协作师动态可视化只读聚合接口
# 前端 ZFCollab.startLiveFx 每 2.5s 轮询 /api/plugin/collab/feed?team=..&since=..，
# 把全组实况渲染成「协作师活体头像」动画（思考/说话/被插话/输入/完成/待命），
# 让人类一眼看出每个协作师窗正在干什么——兑现「跨窗涟漪归二期」的欠账。
# 设计约束：
#   —— 纯只读：不写任何状态、不产生回执义务（与 say/inject/review 的写语义严格分离）；
#   —— 组不存在返回 ok=False 而非抛异常（动态面板静默降级，绝不 500）；
#   —— since 增量：只回比 since 新的 says/injects，省带宽；server_ts 供前端推进水位。
# ---------------------------------------------------------------------------

def feed(team_id, since_ts=0.0):
    """眼·feed（动态可视化数据源，前端轮询用）：
    members 全员状态行（status/left/done_at/ear）+ 增量 says/injects + 水位。"""
    _require_on()
    with _lock:
        t = teams.get(team_id)
        if t is None:
            return {'ok': False, 'error': '组不存在: %s' % team_id}
        since = float(since_ts or 0.0)
        members = {}
        for cn, m in (t.get('members') or {}).items():
            members[cn] = {
                'status': m.get('status') or 'working',
                'left': bool(m.get('left')),
                'done_at': m.get('done_at'),
                'ear': int(m.get('ear', 1)),
            }
        says = [{'ts': e.get('ts', 0), 'ts_str': e.get('ts_str', ''),
                 'codename': e['codename'], 'to': e.get('to'),
                 'type': e.get('type', 'progress'),
                 'severity': e.get('severity', 'normal'),
                 # 【沟通力升级 2026-11-24 用户令「沟通还是很少很弱」】面板 say 预览
                 # 120→600 字（面板是用户观察 AI 互听的主窗口，120 字只剩半句）
                 'text': str(e.get('text') or '')[:600]}
                for e in (t.get('say_log') or []) if e.get('ts', 0) > since]
        inj = [{'ts': e.get('ts', 0), 'ts_str': e.get('ts_str', ''),
                'id': e.get('id'), 'from': e.get('from'), 'to': e.get('to'),
                'answered': bool(e.get('answered')),
                # 【沟通力升级 2026-11-24】补 text 字段——此前面板拿不到插话内容，
                # 只能渲染「等待回应」占位符（用户粘贴3 铁证），现透传真实内容
                'text': str(e.get('text') or '')[:400]}
               for e in (t.get('inject_log') or []) if e.get('ts', 0) > since]
        # 【v8.2 用户令「审核带 0-100 分」】往来流透出互审记录（含分数），📡 面板渲染
        revs = []
        for rv, tg_map in (t.get('review_log') or {}).items():
            for tg, e in (tg_map or {}).items():
                if (e or {}).get('ts', 0) > since:
                    revs.append({'ts': (e or {}).get('ts', 0), 'ts_str': '',
                                 'from': rv, 'to': tg,
                                 'verdict': (e or {}).get('verdict'),
                                 'score': (e or {}).get('score'),
                                 'text': str((e or {}).get('text') or '')[:200]})
        revs.sort(key=lambda x: x.get('ts', 0))
        newest = 0.0
        for e in (t.get('say_log') or []) + (t.get('inject_log') or []) \
                + (t.get('note_log') or []) + (t.get('l1_log') or []):
            ts = e.get('ts', 0)
            if ts > newest:
                newest = ts
        return {'ok': True, 'team_id': team_id, 'task': t.get('task', ''),
                'members': members,
                'says': says[-30:], 'injects': inj[-30:], 'reviews': revs[-30:],
                'inj_open': sum(1 for e in (t.get('inject_log') or []) if not e.get('answered')),
                'note_count': len(t.get('note_log') or []),
                'server_ts': newest, 'now': _now()}
