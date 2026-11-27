# -*- coding: utf-8 -*-
"""
GET /api/briefing —— 每日开工简报（渐进式长期依赖·阶段1，策划案 v2）
一次返回：未完成超长计划列表 + 最近项目记录 + 最近一次 git commit 摘要。
全部只读、逐项容错，任何一段失败不影响其余字段。
响应：{ok, briefing: {date, plans: [...], recent_records: [...], last_commit}}
"""
import os
import re
import subprocess

# 仪表盘统计短 TTL 缓存（审核员#1 建议）：高频打开/刷新时避免反复全量 os.walk。
# 60s 内复用上次聚合结果；里程碑永久去重，60s 延迟可接受。
_STATS_TTL = 60.0
_stats_cache = {'ts': 0.0, 'data': None}


def _base_dir(self):
    """项目根目录：mixin_briefing.py 在 server/routes/ 下，向上两级到 server，
    再向上一级到项目根（private/记忆、.git 都在根下）。"""
    try:
        server_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        return os.path.dirname(server_dir) or '.'
    except Exception:
        return '.'


def _server_dir():
    """server 目录（state 文件落在 server/data，与 /api/user/brief 口径统一）。"""
    try:
        return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    except Exception:
        return '.'


def _scan_plans(base):
    """扫描两处超长计划目录，返回未完成计划 [{id,title,progress,total}]"""
    out = []
    roots = [
        os.path.join(base, 'private', '记忆', '超长计划'),
        os.path.join(base, 'private', '记忆', '全局', '超长计划'),
    ]
    for root in roots:
        try:
            names = sorted(os.listdir(root))
        except Exception:
            continue
        for f in names:
            if not f.endswith('.md'):
                continue
            pid = f[:-3]
            try:
                fp = os.path.join(root, f)
                with open(fp, 'r', encoding='utf-8', errors='ignore') as fh:
                    text = fh.read(20000)
                total = len(re.findall(r'-\s*\[[ x]\]', text))
                done = len(re.findall(r'-\s*\[x\]', text, re.IGNORECASE))
                if total == 0:
                    continue
                title = ''
                m = re.search(r'^#\s*(.+)$', text, re.MULTILINE)
                if m:
                    title = m.group(1).strip()[:40]
                if done < total:
                    out.append({'id': pid, 'title': title, 'done': done, 'total': total,
                                'mtime': int(os.path.getmtime(fp))})
            except Exception:
                continue
    out.sort(key=lambda x: -x.get('mtime', 0))
    return out[:5]


def _recent_records(base):
    """最近修改的项目记录名（不含内容），最多5条"""
    names = []
    for root, _dirs, files in os.walk(os.path.join(base, 'private', '记忆')):
        if '超长计划' in root:
            continue
        for f in files:
            if f.endswith('.md'):
                try:
                    names.append((os.path.getmtime(os.path.join(root, f)), f[:-3]))
                except Exception:
                    continue
    names.sort(reverse=True)
    return [n for _t, n in names[:5]]


def _last_commit(base):
    try:
        r = subprocess.run(['git', 'log', '--oneline', '-1'],
                           cwd=base, capture_output=True, text=True, timeout=5,
                           encoding='utf-8', errors='ignore',
                           creationflags=0x08000000)  # CREATE_NO_WINDOW 防闪 cmd 窗
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    except Exception:
        pass
    return ''


def _visit_state(base):
    """server 端活跃时间戳：读取上次访问算 daysAway，并写回本次访问。
    与 /api/user/brief 共用 server/data/user_brief_state.json，口径统一。
    首次访问返回 days_away=-1；任何异常返回 None（前端会静默跳过召回措辞）。
    项目禁用 localStorage，故时间戳落 server 端文件。"""
    import json
    import time
    fpath = os.path.join(_server_dir(), 'data', 'user_brief_state.json')
    now_ms = int(time.time() * 1000)
    state = {'lastVisit': 0, 'visitCount': 0}
    try:
        if os.path.isfile(fpath):
            with open(fpath, 'r', encoding='utf-8') as f:
                state = json.load(f)
    except Exception:
        state = {'lastVisit': 0, 'visitCount': 0}
    last = int(state.get('lastVisit') or 0)
    cnt = int(state.get('visitCount') or 0) + 1
    days_away = max(0, int((now_ms - last) / 86400000)) if last else -1
    try:
        d = os.path.dirname(fpath)
        if not os.path.isdir(d):
            os.makedirs(d, exist_ok=True)
        state['lastVisit'] = now_ms
        state['visitCount'] = cnt
        if not state.get('firstVisit'):
            state['firstVisit'] = now_ms
        with open(fpath, 'w', encoding='utf-8') as f:
            json.dump(state, f)
    except Exception:
        pass
    return days_away, cnt


def _load_state():
    """读取 server/data/user_brief_state.json（与 _visit_state 同文件，口径统一）。"""
    import json
    fpath = os.path.join(_server_dir(), 'data', 'user_brief_state.json')
    state = {'lastVisit': 0, 'visitCount': 0, 'firstVisit': 0, 'milestones': []}
    try:
        if os.path.isfile(fpath):
            with open(fpath, 'r', encoding='utf-8') as f:
                state = json.load(f)
    except Exception:
        pass
    return fpath, state


def _compute_dashboard_stats(base):
    """记忆可视化仪表盘聚合（阶段2）：实时遍历聚合元数据（不全量读内容），零新表。
    返回：记忆总数/本周新增/进行中计划/已完步骤/相伴天数。"""
    import time
    now = time.time()
    mem_root = os.path.join(base, 'private', '记忆')
    total = 0
    week = 0
    for root, _dirs, files in os.walk(mem_root):
        for f in files:
            if f.endswith('.md'):
                total += 1
                try:
                    if now - os.path.getmtime(os.path.join(root, f)) < 7 * 86400:
                        week += 1
                except Exception:
                    pass
    plans = _scan_plans(base)
    steps_done = sum(p['done'] for p in plans)
    steps_total = sum(p['total'] for p in plans)
    days_together = 0
    try:
        _fp, st = _load_state()
        first = int(st.get('firstVisit') or 0)
        if first:
            days_together = int((now * 1000 - first) / 86400000) + 1
    except Exception:
        pass
    return {
        'memoryTotal': total,
        'memoryWeek': week,
        'plansActive': len(plans),
        'stepsDone': steps_done,
        'stepsTotal': steps_total,
        'daysTogether': days_together,
    }


def _dashboard_stats(base):
    """仪表盘聚合入口（带 60s 短 TTL 缓存）：高频打开/刷新时复用上次聚合，
    避免反复全量 os.walk。里程碑永久去重、相伴天数基于 firstVisit 单独重算，
    不受此缓存影响。"""
    import time
    now = time.time()
    c = _stats_cache
    if c['data'] is not None and (now - c['ts']) < _STATS_TTL:
        return c['data']
    data = _compute_dashboard_stats(base)
    c['data'] = data
    c['ts'] = now
    return data


def _check_milestone(base, stats):
    """里程碑轻庆祝（阶段3）：检测正资产成就，去重落盘，仅首次触发返回一条。
    无惩罚、可关、措辞为积累回响（非损失厌恶）。"""
    import time
    fpath, state = _load_state()
    ms = state.get('milestones') or []
    now_ms = int(time.time() * 1000)
    if not state.get('firstVisit'):
        state['firstVisit'] = state.get('lastVisit') or now_ms
    # 相伴天数基于已落盘 firstVisit 重算（保证首日打开即触发"启程"）
    dt = int((now_ms - int(state.get('firstVisit') or now_ms)) / 86400000) + 1
    if dt < 1:
        dt = 1
    fired = []

    def try_fire(key, cond, title, msg):
        if cond and key not in ms:
            ms.append(key)
            fired.append({'key': key, 'title': title, 'msg': msg})

    try_fire('day1', dt >= 1, '启程', '这是我们共同成长的第一天')
    try_fire('day3', dt >= 3, '相伴 3 天', '你的积累正在被系统记住')
    try_fire('day7', dt >= 7, '相伴 1 周', '记忆库让 AI 更懂你')
    try_fire('mem100', stats['memoryTotal'] >= 100, '记忆破百',
             '已沉淀 %d 条项目记忆' % stats['memoryTotal'])
    try_fire('mem500', stats['memoryTotal'] >= 500, '记忆破 500', '你的知识资产已成体系')
    try_fire('plan_done', stats['stepsDone'] > 0, '首个进展',
             '已完成 %d 个计划步骤' % stats['stepsDone'])
    state['milestones'] = ms
    try:
        d = os.path.dirname(fpath)
        if not os.path.isdir(d):
            os.makedirs(d, exist_ok=True)
        with open(fpath, 'w', encoding='utf-8') as f:
            import json as _json
            _json.dump(state, f)
    except Exception:
        pass
    return fired[0] if fired else None


def handle_route(self):
    """Mixin 入口：GET /api/briefing"""
    try:
        base = _base_dir(self)
        import datetime
        # 温和召回：server 端时间戳（缺数据则 None，前端静默跳过）
        days_away = None
        visit_count = 0
        try:
            vs = _visit_state(base)
            if vs:
                days_away, visit_count = vs
        except Exception:
            days_away = None
        stats = _dashboard_stats(base)
        try:
            milestone = _check_milestone(base, stats)
        except Exception:
            milestone = None
        briefing = {
            'date': datetime.date.today().isoformat(),
            'daysAway': days_away,
            'visitCount': visit_count,
            'plans': _scan_plans(base),
            'recent_records': _recent_records(base),
            'last_commit': _last_commit(base),
            'stats': stats,
            'milestone': milestone,
        }
        self._send_json({'ok': True, 'briefing': briefing})
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
