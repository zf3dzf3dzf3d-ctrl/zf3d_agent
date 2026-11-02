# -*- coding: utf-8 -*-
"""
growth_engine.py —— 智能体养成系统（成长可视化）数据层
- 单例模式 + threading 锁，JSON 原子写（tmp + os.replace）
- add_exp(event, meta) 统一入口，内置每日封顶（防刷）
- 等级段：幼蜂/工蜂/雄蜂/蜂后/蜂王（纯仪式感，不影响任何功能可用性）
"""
import json, os, threading, time

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
_DATA_FILE = os.path.join(_DATA_DIR, 'user_growth.json')
_LOCK = threading.Lock()

# 每日经验封顶（防刷：纯聊天不计分由埋点侧保证，这里再加总量闸门）
# [2026-10 强化A1] 质量信号（审核通过/纠错）单列独立额度，避免被高频 task_complete
# 撑满日额后静默拒掉——这正是历史上 task_review_pass=0 的暗闸根因之一。
DAILY_CAP = 600
QUALITY_EVENTS = ('task_review_pass', 'user_correction')
QUALITY_DAILY_CAP = 300

# 等级曲线：level n 所需累计经验 = 100 * n * (n+1) / 2（Lv1=0，Lv2=100，Lv3=300…）
TIERS = [(0, '幼蜂'), (10, '工蜂'), (20, '雄蜂'), (30, '蜂后'), (50, '蜂王')]

# 事件经验表（纯聊天无事件=不计分）
EVENT_EXP = {
    'task_complete': 20,   # 任务完成（基础，apiCalls 多时由埋点侧加权）
    'task_review_pass': 50,  # 蜂群审核通过
    'user_correction': 30,   # 用户纠错被采纳
}


def _default_state():
    return {
        'exp': 0,
        'events': {},          # {event: count}
        'daily': {},           # {'YYYY-MM-DD': exp_gained_today}
        'history': [],         # 最近 200 条事件 [{t, event, exp, note}]
        'created_at': int(time.time()),
    }


def _load():
    try:
        with open(_DATA_FILE, 'r', encoding='utf-8') as f:
            st = json.load(f)
        base = _default_state()
        base.update(st)
        return base
    except Exception:
        return _default_state()


def _save(state):
    os.makedirs(_DATA_DIR, exist_ok=True)
    tmp = _DATA_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    os.replace(tmp, _DATA_FILE)  # 原子替换


def level_of(exp):
    """由累计经验算等级：Lv1 起，每级需求递增 100。"""
    lv = 1
    while 100 * lv * (lv + 1) // 2 <= exp:
        lv += 1
    return lv


def level_progress(exp):
    lv = level_of(exp)
    cur_floor = 100 * (lv - 1) * lv // 2
    cur_ceil = 100 * lv * (lv + 1) // 2
    return {
        'level': lv,
        'exp': exp,
        'level_floor': cur_floor,
        'level_ceil': cur_ceil,
        'exp_in_level': exp - cur_floor,
        'exp_need': cur_ceil - cur_floor,
        'pct': int((exp - cur_floor) / max(1, cur_ceil - cur_floor) * 100),
    }


def tier_of(level):
    name = TIERS[0][1]
    for min_lv, n in TIERS:
        if level >= min_lv:
            name = n
    return name


def add_exp(event, amount=None, note=''):
    """统一经验入口。返回 dict：{ok, leveled_up, state}。任何异常都不抛出（埋点零侵入）。"""
    try:
        exp = amount if amount is not None else EVENT_EXP.get(event, 0)
        if exp <= 0:
            return {'ok': False, 'reason': 'no-exp'}
        with _LOCK:
            st = _load()
            today = time.strftime('%Y-%m-%d')
            is_quality = event in QUALITY_EVENTS
            if is_quality:
                # 质量信号走独立额度（daily_quality），不被高频 task_complete 挤掉
                dq = st.setdefault('daily_quality', {})
                gained = dq.get(today, 0)
                cap = QUALITY_DAILY_CAP
                bucket, bucket_key = dq, 'daily_quality'
            else:
                gained = st['daily'].get(today, 0)
                cap = DAILY_CAP
                bucket, bucket_key = st['daily'], 'daily'
            if gained >= cap:
                return {'ok': False, 'reason': 'daily-cap' + ('-quality' if is_quality else '')}
            exp = min(exp, cap - gained)
            old_lv = level_of(st['exp'])
            st['exp'] += exp
            st['events'][event] = st['events'].get(event, 0) + 1
            bucket[today] = gained + exp
            # 两个额度桶都只留最近 30 天
            for _b in (st.get('daily', {}), st.get('daily_quality', {})):
                if len(_b) > 30:
                    for k in sorted(_b)[:-30]:
                        _b.pop(k, None)
            st['history'].append({'t': int(time.time()), 'event': event, 'exp': exp, 'note': str(note)[:80]})
            st['history'] = st['history'][-200:]
            _save(st)
            new_lv = level_of(st['exp'])
            return {'ok': True, 'leveled_up': new_lv > old_lv, 'level': new_lv, 'exp': st['exp']}
    except Exception as e:
        try:
            print('[growth_engine] add_exp err:', e)
        except Exception:
            pass
        return {'ok': False, 'reason': str(e)}


def badges_of(st, level):
    """徽章墙：全部基于真实行为统计，纯仪式感。返回 [{id, name, icon, desc, got, cur, goal}]（cur=当前进度(封顶goal)，goal=目标值，got=是否达成）"""
    ev = st.get('events', {})
    done = ev.get('task_complete', 0)
    fail = ev.get('task_fail', 0)
    rate = done / max(1, done + fail)
    rev = ev.get('task_review_pass', 0)
    corr = ev.get('user_correction', 0)
    ci_total = (st.get('checkin', {}) or {}).get('total', 0)
    defs = [
        # (id, 名称, 图标, 说明, 是否达成, 当前进度, 目标)
        ('first_task', '初出茅庐', '🐣', '完成第一个任务', done >= 1, min(done, 1), 1),
        ('ten_tasks', '小试牛刀', '🌱', '累计完成 10 个任务', done >= 10, min(done, 10), 10),
        ('fifty', '身经百战', '⚔️', '累计完成 50 个任务', done >= 50, min(done, 50), 50),
        ('hundred', '百战老兵', '💯', '累计完成 100 个任务', done >= 100, min(done, 100), 100),
        ('thousand', '千锤百炼', '🔥', '累计完成 1000 个任务', done >= 1000, min(done, 1000), 1000),
        ('sharpshooter', '弹无虚发', '🎯', '≥50 任务且成功率 ≥95%', done >= 50 and rate >= 0.95, min(done, 50), 50),
        ('converge', '收口大师', '🤝', '蜂群收口通过 1 次', rev >= 1, min(rev, 1), 1),
        ('review5', '蜂群共鸣', '🐝', '蜂群审核通过 5 次', rev >= 5, min(rev, 5), 5),
        ('commander', '蜂群指挥官', '🛡️', '蜂群审核通过 10 次', rev >= 10, min(rev, 10), 10),
        ('review50', '蜂群统帅', '🏰', '蜂群审核通过 50 次', rev >= 50, min(rev, 50), 50),
        ('fixer', '火眼金睛', '👁️', '用户纠错被采纳 3 次', corr >= 3, min(corr, 3), 3),
        ('fixer10', '明察秋毫', '🔍', '用户纠错被采纳 10 次', corr >= 10, min(corr, 10), 10),
        ('checkin7', '七日之约', '📅', '累计签到 7 天', ci_total >= 7, min(ci_total, 7), 7),
        ('checkin30', '月度恒心', '🌙', '累计签到 30 天', ci_total >= 30, min(ci_total, 30), 30),
        ('lv10', '崭露头角', '⭐', '等级达到 Lv.10', level >= 10, min(level, 10), 10),
        ('lv20', '精锐之路', '🌟', '等级达到 Lv.20', level >= 20, min(level, 20), 20),
        ('queen', '登基蜂后', '👑', '等级达到 Lv.30', level >= 30, min(level, 30), 30),
        ('lv50', '蜂王加冕', '👑✨', '等级达到 Lv.50', level >= 50, min(level, 50), 50),
    ]
    return [{'id': i, 'name': n, 'icon': ic, 'desc': d, 'got': bool(g), 'cur': c, 'goal': gl}
            for i, n, ic, d, g, c, gl in defs]


def summary():
    """给 API 用的成长总览。"""
    try:
        with _LOCK:
            st = _load()
        p = level_progress(st['exp'])
        total_events = sum(st['events'].values())
        # 成功率：task_complete vs task_fail
        ok_n = st['events'].get('task_complete', 0)
        fail_n = st['events'].get('task_fail', 0)
        return {
            'ok': True,
            'level': p['level'],
            'tier': tier_of(p['level']),
            'exp': st['exp'],
            'pct': p['pct'],
            'exp_in_level': p['exp_in_level'],
            'exp_need': p['exp_need'],
            'task_done': ok_n,
            'task_fail': fail_n,
            'success_rate': int(ok_n / max(1, ok_n + fail_n) * 100),
            'total_events': total_events,
            'badges': badges_of(st, p['level']),
            'created_at': st['created_at'],
        }
    except Exception as e:
        return {'ok': False, 'err': str(e)}


# ============ P3：技能树 / 签到 / 周挑战 ============

SKILL_TREE = [
    {'id': 'chat',    'name': '对话之心', 'icon': '💬', 'desc': '累计 10 次事件', 'need': lambda ev, lv: sum(ev.values()) >= 10},
    {'id': 'task',    'name': '执行之翼', 'icon': '⚙️', 'desc': '完成 10 个任务', 'need': lambda ev, lv: ev.get('task_complete', 0) >= 10},
    {'id': 'review',  'name': '蜂群共鸣', 'icon': '🐝', 'desc': '蜂群审核通过 5 次', 'need': lambda ev, lv: ev.get('task_review_pass', 0) >= 5},
    {'id': 'faithful','name': '忠实伙伴', 'icon': '🤝', 'desc': '累计获得 5000 经验', 'need': lambda ev, lv: lv['exp'] >= 5000},
    {'id': 'elite',   'name': '精锐战士', 'icon': '⚔️', 'desc': '等级达到 Lv.20', 'need': lambda ev, lv: lv['level'] >= 20},
    {'id': 'perfect', 'name': '完美主义', 'icon': '✨', 'desc': '≥30 任务且成功率 ≥95%', 'need': lambda ev, lv: ev.get('task_complete', 0) >= 30 and ev.get('task_complete', 0) / max(1, ev.get('task_complete', 0) + ev.get('task_fail', 0)) >= 0.95},
]

CHECKIN_EXP = 30


def checkin_status(st):
    today = time.strftime('%Y-%m-%d')
    ci = st.setdefault('checkin', {'last': '', 'streak': 0, 'total': 0})
    return {'checked': ci.get('last') == today, 'streak': ci.get('streak', 0), 'total': ci.get('total', 0)}


def checkin():
    try:
        with _LOCK:
            st = _load()
            today = time.strftime('%Y-%m-%d')
            ci = st.setdefault('checkin', {'last': '', 'streak': 0, 'total': 0})
            if ci.get('last') == today:
                r = {'ok': False, 'reason': 'already'}
                r.update(checkin_status(st))
                return r
            yesterday = time.strftime('%Y-%m-%d', time.localtime(time.time() - 86400))
            ci['streak'] = ci.get('streak', 0) + 1 if ci.get('last') == yesterday else 1
            ci['last'] = today
            ci['total'] = ci.get('total', 0) + 1
            exp = min(CHECKIN_EXP * ci['streak'], 90)
            old_lv = level_of(st['exp'])
            st['exp'] += exp
            st['events']['checkin'] = st['events'].get('checkin', 0) + 1
            st['daily'][today] = st['daily'].get(today, 0) + exp
            st['history'].append({'t': int(time.time()), 'event': 'checkin', 'exp': exp, 'note': '第%d天连续签到' % ci['streak']})
            st['history'] = st['history'][-200:]
            _save(st)
            new_lv = level_of(st['exp'])
            return {'ok': True, 'exp_gained': exp, 'leveled_up': new_lv > old_lv, 'level': new_lv,
                    'streak': ci['streak'], 'total': ci['total']}
    except Exception as e:
        return {'ok': False, 'reason': str(e)}


def skills_of(st, p):
    ev = st.get('events', {})
    got_set = set(st.get('skills_granted', []))
    return [{'id': sk['id'], 'name': sk['name'], 'icon': sk['icon'], 'desc': sk['desc'],
             'meets': bool(sk['need'](ev, p)), 'got': sk['id'] in got_set} for sk in SKILL_TREE]


def sync_skills():
    try:
        with _LOCK:
            st = _load()
            p = level_progress(st['exp'])
            ev = st.get('events', {})
            granted = set(st.get('skills_granted', []))
            new = []
            for sk in SKILL_TREE:
                if sk['id'] not in granted and sk['need'](ev, p):
                    granted.add(sk['id'])
                    new.append({'id': sk['id'], 'name': sk['name'], 'icon': sk['icon']})
            if new:
                st['skills_granted'] = sorted(granted)
                _save(st)
            return {'ok': True, 'new': new, 'skills': skills_of(st, p)}
    except Exception as e:
        return {'ok': False, 'reason': str(e)}


def weekly_challenge():
    try:
        with _LOCK:
            st = _load()
        week_ago = time.time() - 7 * 86400
        recent = [h for h in st.get('history', []) if h.get('t', 0) >= week_ago]
        done = sum(1 for h in recent if h['event'] == 'task_complete')
        review = sum(1 for h in recent if h['event'] == 'task_review_pass')
        exp7 = sum(h.get('exp', 0) for h in recent)
        goals = [
            {'id': 'w_task', 'name': '本周完成 10 个任务', 'icon': '📋', 'cur': done, 'goal': 10, 'got': done >= 10},
            {'id': 'w_review', 'name': '本周蜂群审核通过 3 次', 'icon': '🐝', 'cur': review, 'goal': 3, 'got': review >= 3},
            {'id': 'w_exp', 'name': '本周累计获得 300 经验', 'icon': '⚡', 'cur': exp7, 'goal': 300, 'got': exp7 >= 300},
        ]
        return {'ok': True, 'goals': goals, 'done_all': all(g['got'] for g in goals)}
    except Exception as e:
        return {'ok': False, 'reason': str(e)}


def growth_full():
    try:
        with _LOCK:
            st = _load()
        p = level_progress(st['exp'])
        base = summary()
        base['skills'] = skills_of(st, p)
        base['checkin'] = checkin_status(st)
        base['weekly'] = weekly_challenge()
        return base
    except Exception as e:
        return {'ok': False, 'err': str(e)}
