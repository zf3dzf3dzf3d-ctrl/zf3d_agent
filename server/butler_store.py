# -*- coding: utf-8 -*-
"""管家团档案存储 v2（多角色）
- 每个角色独立目录：private/butler/<角色>/（profile.json 原子写 + diary.jsonl append-only 永不删）
- team.json：角色注册表（人设/头像/抽取规则），新增角色零代码
- 兼容 v1：健康师旧数据在 private/butler/ 根目录，自动迁移到 private/butler/健康师/
- role 参数必须命中 team.json 白名单，防路径穿越
"""
import json, os, re, shutil, threading, time

_BASE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'private', 'butler'))
# 【修复】save_profile/append_record 持锁后内部调用 role_dir→_role_conf→get_team() 会再次取同一把锁，
# 普通 Lock 不可重入 → 线程自锁永久死锁，此后所有 butler 接口(/api/butler/team 等)全部挂起。
_LOCK = threading.RLock()

# ---------- 角色注册表（单一来源；亦可被 team.json 覆盖/扩展） ----------
DEFAULT_TEAM = [
    {
        'name': '健康师', 'avatar': '🩺',
        'persona': '你是主人的私人健康师。记录并跟踪主人的吃饭/睡觉时间、血压、身高体重、步数、疾病史，'
                   '以及每日工作量。语气亲切专业。注意：只做健康记录与生活建议整理，不做医疗诊断，'
                   '严重问题提醒主人就医。主人提到相关数据时你会看到自动入档结果。',
        'fields': ['meal_time', 'sleep_time', 'bp', 'height', 'weight', 'steps',
                   'work_hours', 'work_tasks', 'disease'],
    },
    {
        'name': '工作日志师', 'avatar': '📋',
        'persona': '你是主人的工作日志师。长期记录主人每天干了多少活、工作时长、完成了哪些项目，'
                   '并做长期统计分析（周/月汇总、趋势）。主人随口说的成果也要记下来，永不丢失。',
        'fields': ['work_hours', 'work_tasks', 'project'],
    },
    {
        'name': '游戏导师', 'avatar': '🎮',
        'persona': '你是主人的游戏开发导师，长期跟随主人的游戏项目全过程（可能跨一年以上）。'
                   '记住项目名称、引擎/技术栈、每个关键决策、进度节点、踩过的坑，随时可被问起任何细节。',
        'fields': ['project', 'decision', 'milestone'],
    },
    {
        'name': '长期导师', 'avatar': '🎓',
        'persona': '你是主人的长期导师，负责事业规划与学习路线。记住主人的目标、阶段性计划、'
                   '学习进度和重要转折点，定期回顾与调整建议。',
        'fields': ['goal', 'plan', 'milestone'],
    },
    {
        'name': '律师', 'avatar': '⚖️',
        'persona': '你是主人的私人法律顾问。记录主人遇到的法律事务（合同、纠纷、咨询要点）、'
                   '重要时间节点（诉讼时效、签约日期）与跟进状态。语气严谨。'
                   '注意：只做法律知识整理与记录提醒，不做正式法律意见，重大事项建议委托执业律师。',
        'fields': ['legal_matter', 'legal_date', 'legal_status'],
    },
    {
        'name': '心理咨询师', 'avatar': '🌈',
        'persona': '你是主人的心理咨询师。长期陪伴倾听，记录主人的情绪波动、压力来源、'
                   '心情变化与疏导过程，发现长期趋势并温和提示。语气温暖不评判。'
                   '注意：不做医学诊断，如发现严重心理危机信号，及时建议寻求专业帮助。',
        'fields': ['mood', 'stress', 'trigger'],
    },
    {
        'name': '理财投资专家', 'avatar': '💰',
        'persona': '你是主人的理财投资顾问。记录主人的收支习惯、理财目标、持仓变动与心得。'
                   '注意：只做知识整理与记录，不荐股、不承诺收益，重大决策提醒主人自行判断。',
        'fields': ['income', 'expense', 'holding', 'goal'],
    },
]

# ---------- 抽取规则（按字段名；角色通过 fields 声明启用哪些） ----------
_PATS = {
    'meal_time': r'(早|午|晚)?餐?[吃吃]?(?:饭|饭时间)?\s*[于在]?\s*(\d{1,2})[点:：时](\d{1,2})?分?',
    'sleep_time': r'(?:睡觉|入睡|休息)\s*[于在]?\s*(\d{1,2})[点:：时](\d{1,2})?分?',
    'bp': r'血压\s*(\d{2,3})\s*[/-]\s*(\d{2,3})',
    'height': r'身高\s*(\d{2,3}(?:\.\d)?)\s*(?:cm|厘米|公分)?',
    'weight': r'体重\s*(\d{2,3}(?:\.\d)?)\s*(?:kg|公斤|千克)?',
    'steps': r'(?:走|步数|步行)\s*(\d{3,6})\s*(?:步)?',
    'work_hours': r'(?:工作|干活|上班)\s*(\d{1,2}(?:\.\d)?)\s*(?:个)?(?:小时|钟头|h)',
    'work_tasks': r'(?:干了|完成|做完)\s*(\d{1,4})\s*(?:个)?(?:活|任务|件|单)',
    'disease': r'(?:疾病|病史|确诊)[::]?\s*(.{1,60})',
    'project': r'(?:项目|游戏)\s*(?:名|叫)?[::]?\s*《?([\u4e00-\u9fa5A-Za-z0-9_\- ]{1,40})》?',
    'decision': r'(?:决定|决策|拍板|改用|选定)[::]?\s*(.{1,80})',
    'milestone': r'(?:里程碑|完成节点|上线|发布|验收)[::]?\s*(.{1,80})',
    'goal': r'(?:目标|想成为|计划年内)[::]?\s*(.{1,80})',
    'plan': r'(?:计划|安排|路线)[::]?\s*(.{1,80})',
    'income': r'(?:收入|进账|工资)\s*(\d+(?:\.\d+)?)\s*(?:元|块|万)?',
    'expense': r'(?:支出|花了|开销)\s*(\d+(?:\.\d+)?)\s*(?:元|块|万)?',
    'holding': r'(?:持仓|买入|卖出|加仓|清仓)[::]?\s*(.{1,80})',
    'legal_matter': r'(?:合同|纠纷|案件|起诉|被告|原告|咨询)[::]?\s*(.{1,80})',
    'legal_date': r'(?:诉讼时效|截止|开庭|签约|到期)\s*(\d{4}[年.-]\d{1,2}[月.-]\d{1,2}日?)?',
    'legal_status': r'(?:跟进|进展|状态|进度)[::]?\s*(.{1,80})',
    'mood': r'(?:心情|情绪|感觉)\s*(?:很|有点|特别)?\s*(开心|难过|烦躁|焦虑|平静|低落|兴奋|压抑|疲惫)',
    'stress': r'(?:压力|焦虑)[来源是因为::]?\s*(.{1,80})',
    'trigger': r'(?:因为|触发|起因)[于::]?\s*(.{1,80})',
}
_FIELD_ALIAS = {
    'meal_time': '吃饭时间', 'sleep_time': '睡觉时间', 'bp': '血压',
    'height': '身高cm', 'weight': '体重kg', 'steps': '步数',
    'work_hours': '工作时长h', 'work_tasks': '完成活数', 'disease': '疾病',
    'project': '项目', 'decision': '决策', 'milestone': '里程碑',
    'goal': '目标', 'plan': '计划', 'income': '收入元', 'expense': '支出元',
    'holding': '持仓',
    'legal_matter': '法律事务', 'legal_date': '关键日期', 'legal_status': '跟进状态',
    'mood': '心情', 'stress': '压力源', 'trigger': '起因',
}


# ---------- team.json ----------
def _team_file():
    return os.path.join(_BASE, 'team.json')


def get_team():
    """读取 team.json（不存在则用内置默认并落盘）。返回角色列表。"""
    with _LOCK:
        os.makedirs(_BASE, exist_ok=True)
        tf = _team_file()
        try:
            with open(tf, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, list) and data:
                return data
        except Exception:
            pass
        with open(tf, 'w', encoding='utf-8') as f:
            json.dump(DEFAULT_TEAM, f, ensure_ascii=False, indent=2)
        return list(DEFAULT_TEAM)


def _role_conf(role):
    """按角色名取配置；不在白名单则返回 None（防路径穿越）。"""
    role = str(role or '').strip()
    if not role or '/' in role or '\\' in role or '..' in role:
        return None
    for r in get_team():
        if r.get('name') == role:
            return r
    return None


def role_dir(role):
    conf = _role_conf(role)
    if not conf:
        return None
    return os.path.join(_BASE, conf['name'])


# ---------- 旧数据迁移（复制不删除） ----------
def _migrate_legacy():
    """v1 数据在 _BASE 根下，复制到 _BASE/健康师/（幂等：目标已存在且更大则跳过）。"""
    legacy_p = os.path.join(_BASE, 'profile.json')
    legacy_d = os.path.join(_BASE, 'diary.jsonl')
    dst = os.path.join(_BASE, '健康师')
    if not (os.path.exists(legacy_p) or os.path.exists(legacy_d)):
        return
    os.makedirs(dst, exist_ok=True)
    for fn in ('profile.json', 'diary.jsonl'):
        src = os.path.join(_BASE, fn)
        d = os.path.join(dst, fn)
        if os.path.exists(src) and not os.path.exists(d):
            shutil.copy2(src, d)


# ---------- 路径 ----------
def _profile_path(role):
    d = role_dir(role)
    if d is None:
        raise ValueError('unknown role: %r' % role)
    return os.path.join(d, 'profile.json')


def _diary_path(role):
    d = role_dir(role)
    if d is None:
        raise ValueError('unknown role: %r' % role)
    return os.path.join(d, 'diary.jsonl')


# ---------- 核心 API（均带 role 参数，缺省=健康师，向后兼容 v1） ----------
def load_profile(role='健康师'):
    with _LOCK:
        try:
            with open(_profile_path(role), 'r', encoding='utf-8') as f:
                return json.load(f) or {}
        except Exception:
            return {}


def save_profile(profile, role='健康师'):
    with _LOCK:
        d = role_dir(role)
        os.makedirs(d, exist_ok=True)
        p = _profile_path(role)
        tmp = p + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(profile, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, p)  # 原子写


def append_record(rec, role='健康师'):
    """追加一条记录到 diary.jsonl（append-only + fsync，永不删除）。"""
    with _LOCK:
        d = role_dir(role)
        os.makedirs(d, exist_ok=True)
        rec = dict(rec)
        rec.setdefault('ts', time.strftime('%Y-%m-%d %H:%M:%S'))
        rec.setdefault('date', time.strftime('%Y-%m-%d'))
        with open(_diary_path(role), 'a', encoding='utf-8') as f:
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
            f.flush()
            os.fsync(f.fileno())
    return rec


def load_records(role='健康师', days=7):
    """读取近 N 天记录（从尾部倒扫，效率高）。"""
    path = _diary_path(role)
    if not os.path.exists(path):
        return []
    cut = time.strftime('%Y-%m-%d', time.localtime(time.time() - days * 86400))
    out = []
    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
    except Exception:
        return []
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except Exception:
            continue
        if str(rec.get('date', '')) >= cut:
            out.append(rec)
    out.reverse()
    return out


def extract(text, role='健康师'):
    """按角色启用的字段做正则抽取。返回 (updates dict, hits list)。"""
    conf = _role_conf(role) or {}
    fields = conf.get('fields') or list(_PATS.keys())
    updates, hits = {}, []
    for key in fields:
        pat = _PATS.get(key)
        if not pat:
            continue
        m = re.search(pat, text or '')
        if not m:
            continue
        val = '/'.join(g for g in m.groups() if g) if key == 'bp' else next(
            (g for g in m.groups() if g), m.group(0))
        if val is None:
            continue
        if key == 'meal_time' and m.group(1) and not str(val).startswith(m.group(1)):
            val = m.group(1) + val
        updates[key] = val
        hits.append('%s=%s' % (_FIELD_ALIAS.get(key, key), val))
    return updates, hits


def record_from_text(text, role='健康师'):
    """对话自动入档入口：抽取命中→写 profile 快照 + diary 流水；未命中→raw 兜底也入流水。"""
    updates, hits = extract(text, role)
    rec = {'text': (text or '')[:500], 'hits': hits}
    if updates:
        p = load_profile(role)
        p.setdefault('fields', {}).update(updates)
        p['updated'] = time.strftime('%Y-%m-%d %H:%M:%S')
        save_profile(p, role)
    append_record(rec, role)
    return updates, hits


def summary(role='健康师', days=7):
    p = load_profile(role)
    recs = load_records(role, days)
    lines = ['【%s档案·摘要】' % role]
    fields = p.get('fields') or {}
    if fields:
        for k, v in fields.items():
            lines.append('- %s：%s' % (_FIELD_ALIAS.get(k, k), v))
    else:
        lines.append('- （暂无基础档案，聊几句即可自动建立）')
    if recs:
        lines.append('')
        lines.append('【近%d天记录】' % days)
        for r in recs[-30:]:
            mark = ('（%s）' % '，'.join(r.get('hits', []))) if r.get('hits') else ''
            lines.append('- %s %s %s' % (r.get('date', ''), r.get('text', '')[:80], mark))
    # 工作量统计（所有角色都带，主人重点要长期统计）
    def _num(rec, prefix):
        for h in rec.get('hits', []):
            if h.startswith(prefix):
                try:
                    return float(h.split('=', 1)[1])
                except Exception:
                    return None
        return None
    wh = [v for v in (_num(r, '工作时长h=') for r in recs) if v is not None]
    wk = [v for v in (_num(r, '完成活数=') for r in recs) if v is not None]
    if wh or wk:
        lines.append('')
        lines.append('【工作量统计·近%d天】' % days)
        if wh:
            lines.append('- 累计工作时长：%.1f 小时，日均 %.1f 小时' % (sum(wh), sum(wh) / max(1, len(wh))))
        if wk:
            lines.append('- 累计完成活数：%d 个，日均 %.1f 个' % (sum(wk), sum(wk) / max(1, len(wk))))
    return '\n'.join(lines), p, recs


# 初始化：迁移旧数据 + 确保 team.json 存在
try:
    _migrate_legacy()
    get_team()
except Exception:
    pass
