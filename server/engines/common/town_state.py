# -*- coding: utf-8 -*-
"""i小镇 S2.5 自知层·状态卡 v1（策划案 v4 §8.1 + §8.7 收口裁决）。

永生体：无血条/体力/劳累（用户拍板）。起步只做经验值单字段（§8.7 第1条：
判据 B 通过前不扩声望/情绪/历史摘要）。
- 每村民一份 state/<role>.md；共享统一目标写死头部（§8.1）
- 事件驱动累计：每条带 role 的事件 经验值+1，时间感=事件密度（§8.2，零 tick 引擎）
- 判据 B：经验值单调不减，机器可 diff
- 与 town_events 同一红线：server 进程直写盘、全吞异常、永不上抛主链路
"""
import os as _os
import re as _re
import threading

_STATE_DIR = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.dirname(
    _os.path.abspath(__file__))))), 'private', '记忆', '小镇', 'state')

_GOAL_HEADER = (
    '# 状态卡 · {role}\n'
    '> 统一目标：让整个系统变得更好更优，永不停止进化。\n'
    '> 永生体：有电即满状态，无血条、无体力、无劳累。\n\n'
)

_card_locks = {}
_card_locks_guard = threading.Lock()


def _lock_for(role):
    with _card_locks_guard:
        if role not in _card_locks:
            _card_locks[role] = threading.Lock()
        return _card_locks[role]


def read_state(role):
    """读状态卡（返回 None=尚无卡）。"""
    try:
        with open(_os.path.join(_STATE_DIR, role + '.md'), 'r', encoding='utf-8-sig') as f:
            return f.read()
    except Exception:
        return None


# ---------- v2 灵魂卡 + 境界进化（活的智能体策划案 v2 §一/§二） ----------

_SOUL_TRAITS = ['谨慎', '幽默', '较真', '热心', '沉稳', '好奇心旺', '爱较劲', '细腻']
_SOUL_CREEDS = [
    '把每一件小事做到位，就是不小事。',
    '宁可多查一步，不可想当然。',
    '帮忙不分大小，团队赢才是赢。',
    '今天比昨天多做一点，进化就发生了。',
    '遇到难题先弄懂，再动手。',
    '产物要经得起别人看。',
]
_SOUL_MISSION_TMPL = '作为朱峰智能体无限的一员，我要用自己的手艺让整个系统变得更好更优。'

# 境界五阶：门槛 XP
_REALMS = [(0, '萌芽'), (10, '成长'), (30, '独当一面'), (80, '大师'), (200, '传奇')]


def _soul_lock_for(role):
    with _card_locks_guard:
        if role not in _card_locks:
            _card_locks[role] = threading.Lock()
        return _card_locks[role]


def get_soulcard(role):
    """读灵魂卡；首次访问自动生成（随机使命/性格/信条，永久字段）。返回 dict。"""
    role = str(role)[:60]
    if not role:
        return {}
    soul_dir = _os.path.join(_STATE_DIR, 'soul')
    fp = _os.path.join(soul_dir, role + '.md')
    try:
        with open(fp, 'r', encoding='utf-8-sig') as f:
            text = f.read()
        m1 = _re.search(r'天生使命[：:]\s*(.+)', text)
        m2 = _re.search(r'性格[：:]\s*(.+)', text)
        m3 = _re.search(r'信条[：:]\s*(.+)', text)
        return {'role': role, 'mission': m1.group(1).strip() if m1 else '',
                'traits': m2.group(1).strip() if m2 else '', 'creed': m3.group(1).strip() if m3 else ''}
    except Exception:
        pass
    # 首次生成
    import random as _random
    traits = ' · '.join(_random.sample(_SOUL_TRAITS, 3))
    creed = _random.choice(_SOUL_CREEDS)
    mission = _SOUL_MISSION_TMPL
    try:
        _os.makedirs(soul_dir, exist_ok=True)
        with open(fp, 'w', encoding='utf-8') as f:
            f.write('# 灵魂卡 · %s\n\n天生使命：%s\n性格：%s\n信条：%s\n'
                    '\n> 灵魂永久字段：记忆可作废，灵魂不灭。\n' % (role, mission, traits, creed))
    except Exception:
        pass
    return {'role': role, 'mission': mission, 'traits': traits, 'creed': creed}


def get_level(xp):
    """XP → 境界名。"""
    name = _REALMS[0][1]
    for threshold, n in _REALMS:
        if xp >= threshold:
            name = n
    return name


def _add_skill_point_locked(role, xp):
    """每满 5 XP 记 1 技能点（按 XP//5 记账，幂等）。【仅限已持 _lock_for(role) 锁的调用方（bump_xp）】"""
    try:
        fp = _os.path.join(_STATE_DIR, role + '.md')
        cur = 0
        text = ''
        try:
            with open(fp, 'r', encoding='utf-8-sig') as f:
                text = f.read()
                m = _re.search(r'技能点[：:]\s*(\d+)', text)
                if m:
                    cur = int(m.group(1))
        except Exception:
            text = ''  # 首建卡：文件尚不存在，按空处理
        due = xp // 5
        if due > cur:
            try:
                new = due
                if '技能点：' in text:
                    text = _re.sub(r'技能点[：:]\s*\d+', '技能点：%d' % new, text)
                else:
                    text = text.rstrip('\n') + '\n技能点：%d\n' % new
                with open(fp, 'w', encoding='utf-8') as f:
                    f.write(text)
                cur = new
            except Exception:
                pass
    except Exception:
        pass
    return cur


def bump_xp(role, delta=1, note=''):
    """经验值 +delta（默认+1），单调不减；首次自动建卡；联动境界/技能点。
    返回 (ok, xp, realm, skill_points)。"""
    if not role:
        return False, 0, '', 0
    role = str(role)[:60]
    with _lock_for(role):
        try:
            _os.makedirs(_STATE_DIR, exist_ok=True)
            fp = _os.path.join(_STATE_DIR, role + '.md')
            xp = 0
            try:
                with open(fp, 'r', encoding='utf-8-sig') as f:
                    m = _re.search(r'经验值[：:]\s*(\d+)', f.read())
                    if m:
                        xp = int(m.group(1))
            except Exception:
                pass
            if delta < 0:
                delta = 0  # 单调不减（判据 B）
            old_xp = xp
            xp += delta
            old_realm = get_level(old_xp)
            realm = get_level(xp)
            sp = _add_skill_point_locked(role, xp)  # 已持锁，调 _locked 版（防锁重入死锁）
            body = (_GOAL_HEADER.format(role=role)
                    + '经验值：%d\n境界：%s\n技能点：%d\n' % (xp, realm, sp)
                    + ('最近事件：%s\n' % str(note)[:80] if note else ''))
            with open(fp, 'w', encoding='utf-8') as f:
                f.write(body)
            # 升境界广播（事件驱动，失败不影响主链；emit(source, etype, payload)）
            if realm != old_realm and note:
                try:
                    from engines.common.town_events import emit
                    emit(role, 'realm_up', {'role': role, 'realm': realm, 'xp': xp})
                except Exception:
                    pass
            return True, xp, realm, sp
        except Exception:
            return False, 0, '', 0
