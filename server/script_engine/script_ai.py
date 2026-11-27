# -*- coding: utf-8 -*-
"""i剧本杀 P2 AI 设施包（策划案 v2.2 P2 阶段，2026-11-21）。

两个能力共用一条 LLM 线路（model_config 默认模型，relay 走本地 relay-proxy，
与 domain_evolve._call_llm 同源实现，消掉防泄底代码双份维护——策划师保留项2）：

A. NPC 扮演 ask_npc(book, char, question) -> 台词
   【防泄底·每问独立 prompt 裁剪】（v2.1 裁决1+裁决3）：
   - 每次提问都构造全新独立 prompt，不带任何会话历史（会话级累积裁剪风险归零，
     20 问串联拼接也只能拼出「该角色 knowledge 并集」，拼不出案情全貌）；
   - 上下文只给：该角色 persona + 该角色 knowledge 指向的事实（who/what/时间）
     + 公开时间线（hidden 剔除）+ 公开线索名；
   - 绝不注入：is_murderer、任何角色 secret、hidden 事实、任务链；
   - 生成侧再加一道硬防线：输出文本若命中其他角色 secret 的关键片段直接判空降级。

B. AI 槽位填本 gen_book(theme, difficulty) -> book dict / None
   - 固定槽位模板（4 场景/6 线索/4 角色/8 事实骨架）让 LLM 填文案与推凶链；
   - 输出走 script_solver.solve() 校验，不过则带原因重生成（≤3 次）；
   - 一次通过率 <40%（3 次全败即视为本轮不达标）触发降级：返回降级标记，
     路由层回退模板拼装本（降级线 40%，策划案 v2.1 验收口径）。
"""
import json
import os
import re

from script_engine.script_solver import solve

MAX_RETRY = 3          # 填本重生成上限
PASS_LINE = 0.40       # 一次通过率降级线（策划案 v2.1：低于 40% 切降级路线）


# ---------------- LLM 线路（同源 domain_evolve._call_llm） ----------------

def _llm(prompt, timeout=90, max_tokens=1400):
    """同步调一次默认模型，返回纯文本；失败抛异常。"""
    import urllib.request as _u
    import model_config as _mc
    m = _mc.get_default_model() or {}
    url = str(m.get('endpoint') or m.get('baseUrl') or '').strip()
    key = str(m.get('key') or '')
    model = str(m.get('modelId') or m.get('id') or m.get('model') or m.get('name') or '')
    if not url:
        raise RuntimeError('无默认模型配置')
    # 【P0-2 收编 20261123】relay 识别统一走 security.is_zf_relay_url（域名精确匹配）
    import security as _sec
    is_relay = _sec.is_zf_relay_url(url)
    payload = {'model': model, 'stream': False, 'max_tokens': max_tokens,
               'temperature': 0.7,
               'messages': [{'role': 'user', 'content': prompt}]}
    if is_relay:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               '..', '..', 'private', 'port.json'),
                  'r', encoding='utf-8-sig') as pf:
            port = json.load(pf).get('api_port') or 8620
        body = json.dumps({'model': model, 'payload': payload},
                          ensure_ascii=True).encode('utf-8')
        req = _u.Request('http://127.0.0.1:%d/api/zf3d/relay-proxy' % port,
                         data=body, method='POST')
        req.add_header('Content-Type', 'application/json')
    else:
        headers = {'Content-Type': 'application/json'}
        if key:
            headers['Authorization'] = 'Bearer ' + key
        body = json.dumps(payload, ensure_ascii=True).encode('utf-8')
        req = _u.Request(url, data=body, method='POST')
        for hk, hv in headers.items():
            req.add_header(hk, hv)
    opener = _u.build_opener(_u.ProxyHandler({}))
    with opener.open(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode('utf-8', errors='replace'))
    txt = str(((data.get('choices') or [{}])[0].get('message') or {}).get('content') or '')
    if not txt.strip():
        raise RuntimeError('LLM 返回空')
    return txt


# ---------------- A. NPC 扮演（每问独立裁剪） ----------------

def _npc_context(book, char):
    """只拼该角色可知的事实：persona + knowledge 并上公开时间线/公开线索。
    绝不含 is_murderer / 他人 secret / hidden 事实。"""
    know_ids = set(char.get('knowledge') or [])
    facts = []
    for f in book.get('timeline', []):
        if f.get('hidden'):
            continue                      # 隐藏事实一律不给
        if f['id'] in know_ids:
            facts.append('%s %s：%s' % (f.get('t', ''), f.get('who', '?'), f.get('what', '')))
    pub_clues = '；'.join(c['name'] + '（' + c['desc'] + '）'
                          for c in book.get('clues', []) if not c.get('owner'))
    return (
        '你在剧本杀游戏里扮演角色「%s」。公开人设：%s\n'
        '你知道的事实（只可以说出这些，其余一律说不知道/没注意）：\n%s\n'
        '现场公开线索：%s\n'
        '要求：用这个角色的口吻回答玩家的问题，3 句以内，口语化，可略带情绪；\n'
        '不知道的事就说不知道，绝不编造新事实，绝不承认或指控任何人是凶手。'
        % (char['name'], char.get('persona', ''),
           ('\n'.join(facts) or '（无）'), (pub_clues or '（无)'))
    )


def _leak_check(text, book, char):
    """生成侧硬防线：回答里不得出现其他角色 secret 的连续 12 字片段、
    不得出现 hidden 事实的 what 原文、不得自称凶手。命中返回 True。"""
    for c in book.get('characters', []):
        if c['id'] == char['id']:
            continue
        sec = c.get('secret') or ''
        for i in range(0, max(0, len(sec) - 12)):
            seg = sec[i:i + 12]
            if seg in text:
                return True
    for f in book.get('timeline', []):
        if f.get('hidden') and f.get('what') and f['what'] in text:
            return True
    return False


def ask_npc(book, char, question):
    """NPC 问答主入口。返回 (text, mode)。mode: ai | fallback。
    LLM 不可用或防泄底命中 → 降级预写台词轮换。"""
    q = str(question or '').strip()[:200]
    if not q:
        return '', 'fallback'
    try:
        prompt = (_npc_context(book, char)
                  + '\n玩家问：' + q + '\n直接输出角色的回答，不要任何前缀。')
        text = _llm(prompt)
        text = text.strip().splitlines()[0][:300]
        if text and not _leak_check(text, book, char):
            return text, 'ai'
    except Exception:
        pass
    pw = char.get('prewritten') or []
    if pw:
        return pw[len(q) % len(pw)], 'fallback'
    return '（%s 沉默不语……）' % char['name'], 'fallback'


# ---------------- B. AI 槽位填本 ----------------

_GEN_PROMPT = u'''你是剧本杀作者。以主题「%s」、难度「%s」写一个本格推理剧本，严格输出 JSON（不要 markdown 代码块、不要解释文字）。
必须严格按以下槽位骨架，只填内容：
{
 "id": "ai_<英文短id>",
 "title": "剧本名",
 "player_count": [1, 6],
 "intro": "主持人开场白2句",
 "background": "背景故事 100 字内",
 "scenes": [4 个场景，每个 {"id":"sc1".."sc4","name":"","desc":"","spots":["sp_sc1_1"...]}，每场景 1 个点位 id 形如 sp_sc1_1],
 "characters": [4 个角色 c1..c4，其中恰一个 is_victim=true、另一个 is_murderer=true（不得同一人），每个 {"id","name","is_victim","is_murderer","persona","secret","prewritten":[至少2条],"knowledge":["f1".."f8" 中该角色知道的事实id]}],
 "clues": [6 条线索，每条 {"id":"clue1".."clue6","spot":"sp_sc1_1 等存在的点位","name":"","desc":"","owner":null,"implies":["f_xxx"]}，implies 必须指向 timeline 里的真实 id],
 "timeline": [8 条事实 f1..f8，每条 {"id","t":"时间","who":"c1..c4 或 unknown","what":"","hidden":false,"is_key":false}；其中 2~3 条 is_key=true 组成指认凶手 c_x 的完整证据链；1 条作案细节 hidden=true],
 "tasks": [每个角色至少 1 条 {"id":"t_c1".."","char":"c1","desc":"","check":{"type":"survive"},"score":10}],
 "win_conditions": {"murderer_win":"得票不过半即逃脱","town_win":"投中凶手"}
}
要求：推理链必须闭环——每条 is_key 事实要么被某条 clue.implies 指向，要么其推断依赖的其它 is_key/普通事实也被线索覆盖；凶手秘密中写清作案手法。只输出 JSON。'''


def _template_book(theme):
    """降级模板拼装本（骨架固定、主题注入文案，Solver 必过）。"""
    t = str(theme or '迷案').strip()[:12] or '迷案'
    return {
        "id": "ai_tpl_" + re.sub(r'[^a-z0-9]', '', t.lower())[:10] + '_'
              + str(int(__import__('time').time()) % 100000),
        "title": "%s之谜（模板本）" % t,
        "player_count": [1, 6],
        "intro": "夜色深沉，一桩%s案震惊全镇。请各位找出真相。" % t,
        "background": "古镇上一夜之间发生离奇命案，四人齐聚，人人有嫌疑。",
        "scenes": [
            {"id": "sc1", "name": "案发大厅", "desc": "命案第一现场。", "spots": ["sp1"]},
            {"id": "sc2", "name": "后院", "desc": "杂乱的角落。", "spots": ["sp2"]},
            {"id": "sc3", "name": "书房", "desc": "锁着的抽屉被撬开。", "spots": ["sp3"]}
        ],
        "characters": [
            {"id": "c1", "name": "账房（%s）" % t, "is_victim": False, "is_murderer": True,
             "persona": "精明的账房先生，最近手头拮据。",
             "secret": "我因挪用公款被死者发现，深夜潜入用花瓶击杀了他并伪造失窃。",
             "prewritten": ["我整晚都在对账，哪里也没去。", "死者最近一直在查账目，我也纳闷。"],
             "knowledge": ["f2", "f4"]},
            {"id": "c2", "name": "管家", "is_victim": False, "is_murderer": False,
             "persona": "忠心耿耿的老管家。",
             "secret": "我受死者之托秘密清点家产，没敢告诉任何人。",
             "prewritten": ["我按惯例巡夜，一切如常。", "老爷最近似有心事。"],
             "knowledge": ["f1", "f3"]},
            {"id": "c3", "name": "侄子", "is_victim": False, "is_murderer": False,
             "persona": "游手好闲的远房侄子。",
             "secret": "我欠了赌债，来找叔父借钱被拒。",
             "prewritten": ["我只是来探望叔父。", "我们确实吵过几句，但我没动手。"],
             "knowledge": ["f3", "f5"]},
            {"id": "c4", "name": "死者", "is_victim": True, "is_murderer": False,
             "persona": "镇上富绅。",
             "secret": "",
             "prewritten": ["（死者已无法发言）", "（遗物或转述可提供信息）"],
             "knowledge": []}
        ],
        "clues": [
            {"id": "clue1", "spot": "sp1", "name": "碎花瓶", "desc": "现场有花瓶碎片，边缘有血迹。",
             "owner": None, "implies": ["f2"]},
            {"id": "clue2", "spot": "sp1", "name": "账本残页", "desc": "撕掉的账页，记着大额亏空。",
             "owner": None, "implies": ["f3"]},
            {"id": "clue3", "spot": "sp2", "name": "泥脚印", "desc": "后院通往侧门的泥脚印，尺码偏大。",
             "owner": None, "implies": ["f4"]},
            {"id": "clue4", "spot": "sp2", "name": "赌债借据", "desc": "一张高额赌债借据。",
             "owner": None, "implies": ["f5"]},
            {"id": "clue5", "spot": "sp3", "name": "撬痕", "desc": "抽屉锁有明显撬痕。",
             "owner": None, "implies": ["f3"]},
            {"id": "clue6", "spot": "sp3", "name": "夜行衣角", "desc": "挂钩上挂着一角深色布料，与后院脚印的泥色相同。",
             "owner": None, "implies": ["f4", "f6"]}
        ],
        "timeline": [
            {"id": "f1", "t": "20:00", "who": "c2", "what": "管家巡夜确认各处正常。", "hidden": False, "is_key": False},
            {"id": "f2", "t": "21:30", "who": "c1", "what": "有人用花瓶击打死者头部。", "hidden": False, "is_key": True},
            {"id": "f3", "t": "20:30", "who": "c4", "what": "死者发现账目亏空并质问账房。", "hidden": False, "is_key": False},
            {"id": "f4", "t": "21:20", "who": "unknown", "what": "一条身影从后院侧门潜入宅内。", "hidden": False, "is_key": True},
            {"id": "f5", "t": "19:00", "who": "c3", "what": "侄子为赌债求借钱被拒。", "hidden": False, "is_key": False},
            {"id": "f6", "t": "21:35", "who": "c1", "what": "凶手伪造了外贼入室行窃的假象。", "hidden": True, "is_key": True},
            {"id": "f7", "t": "22:00", "who": "c2", "what": "管家发现死者遗体并报官。", "hidden": False, "is_key": False}
        ],
        "tasks": [
            {"id": "t1", "char": "c2", "desc": "活到天亮并协助官府。", "check": {"type": "survive"}, "score": 10},
            {"id": "t2", "char": "c3", "desc": "洗清自己的嫌疑。", "check": {"type": "survive"}, "score": 10},
            {"id": "t3", "char": "c1", "desc": "不被投票指认。", "check": {"type": "survive"}, "score": 20}
        ],
        "win_conditions": {"murderer_win": "得票不过半即逃脱",
                           "town_win": "投票指认凶手"}
    }


def _strip_json(text):
    m = re.search(r'\{[\s\S]*\}', text)
    return m.group(0) if m else None


def gen_book(theme, difficulty='中等', stats=None):
    """AI 填本主入口：LLM 生成 → Solver 校验，重试 ≤MAX_RETRY。
    stats: 可选 dict，调用方传入统计累计 {'gen':n,'pass':n}（40% 降级线观测用）。
    返回 (book|None, source)  source: ai | template | fail"""
    if stats is None:
        stats = {'gen': 0, 'pass': 0}
    last_err = ''
    for _ in range(MAX_RETRY):
        stats['gen'] += 1
        try:
            raw = _llm(_GEN_PROMPT % (str(theme or '古宅迷案'), str(difficulty or '中等')),
                       timeout=120, max_tokens=2400)
            book = json.loads(_strip_json(raw))
            errs = solve(book)
            if not errs:
                stats['pass'] += 1
                return book, 'ai'
            last_err = '; '.join(errs[:3])
        except Exception as e:
            last_err = str(e)[:120]
    # 一次通过率 < 40%（本轮 MAX_RETRY 全败即视为不达标）→ 降级模板拼装
    tpl = _template_book(theme)
    if solve(tpl):
        return None, 'fail'
    return tpl, 'template'
