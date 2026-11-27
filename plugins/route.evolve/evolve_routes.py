# -*- coding: utf-8 -*-
"""i进化·肉鸽三抽域路由（策划案：策划案-i进化肉鸽三抽-v1.md）。

玩法：AI 是发牌员——每轮发 3 张变异卡；用户是策划——三选一沉淀为技能；
技能列表即用户定制出的完整策划；顶部输入框为用户自由意志（影响下轮发卡）。

端点：
  POST /api/evolve/draw    → AI 生成 3 张卡（JSON schema 校验，不合格重试1次）
  POST /api/evolve/keep    → 沉淀选中卡进技能列表（app_data 持久化）
  GET  /api/evolve/skills  → 读技能列表
  POST /api/evolve/skill_op→ 删除/加权技能（v1 全都要）
  POST /api/evolve/summary → AI 把技能列表汇总成策划案 md（落盘 策划案/）

数据存 db.py app_data 表 category='evolve3'：
  key='skills' → {'skills':[...], 'round':N}
"""
import os
import json
import re
import time
import traceback
from routes.dispatcher import route_get, route_post

from db import get_db as _get_db

CATEGORY = 'evolve3'
SKILL_MAX = 20
_SUMMARY_DIR = 'data/evolve3_summary'

_RARITY = ('普通', '稀有', '史诗')
_CARD_SCHEMA_KEYS = ('name', 'rarity', 'effect', 'reason')


def _load(key):
    conn = _get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT value FROM app_data WHERE category=? AND key=?", (CATEGORY, key))
        row = cur.fetchone()
        return json.loads(row[0]) if row else None
    finally:
        conn.close()


def _save(key, obj):
    conn = _get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM app_data WHERE category=? AND key=?", (CATEGORY, key))
        if cur.fetchone():
            cur.execute("UPDATE app_data SET value=? WHERE category=? AND key=?",
                        (json.dumps(obj, ensure_ascii=False), CATEGORY, key))
        else:
            cur.execute("INSERT INTO app_data(category, key, value) VALUES(?,?,?)",
                        (CATEGORY, key, json.dumps(obj, ensure_ascii=False)))
        conn.commit()
    finally:
        conn.close()


def _call_llm(prompt, budget=800):
    """同步调一次 LLM：复用 supervisor._llm_judge 同源线路（model_config 默认模型，
    relay 走本地 relay-proxy，直连走 Bearer）。返回纯文本，失败抛异常。"""
    import urllib.request as _u
    import json as _j
    import model_config as _mc
    m = _mc.get_default_model() or {}
    url = str(m.get('endpoint') or m.get('baseUrl') or '').strip()
    key = str(m.get('key') or '')
    model = str(m.get('modelId') or m.get('id') or m.get('model') or m.get('name') or '')
    if not url:
        raise RuntimeError('无默认模型配置')
    base = url
    is_relay = 'zf_models_relay' in base
    headers = {'Content-Type': 'application/json'}
    payload = {'model': model, 'stream': False, 'max_tokens': 1400,
               'messages': [{'role': 'user', 'content': prompt}]}
    if is_relay:
        try:
            # 本文件在 server/routes/，项目根 private 在上两级（与 supervisor.py 的 ../private 同一真源）
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'private', 'port.json'),
                      'r', encoding='utf-8-sig') as _pf:
                _api_port = _j.load(_pf).get('api_port') or 8620
        except Exception:
            _api_port = 8620
        relay_body = _j.dumps({'model': model, 'payload': payload}, ensure_ascii=True).encode('utf-8')
        req = _u.Request('http://127.0.0.1:%d/api/zf3d/relay-proxy' % _api_port,
                         data=relay_body, method='POST')
        req.add_header('Content-Type', 'application/json')
    else:
        if key:
            headers['Authorization'] = 'Bearer ' + key
        body = _j.dumps(payload, ensure_ascii=True).encode('utf-8')
        req = _u.Request(base, data=body, method='POST')
        for _hk, _hv in headers.items():
            req.add_header(_hk, _hv)
    opener = _u.build_opener(_u.ProxyHandler({}))
    with opener.open(req, timeout=90) as resp:
        data = _j.loads(resp.read().decode('utf-8', errors='replace'))
    txt = str(((data.get('choices') or [{}])[0].get('message') or {}).get('content') or '')
    if not txt.strip():
        raise RuntimeError('LLM 返回空')
    return txt


def _parse_cards(text):
    """从 LLM 输出提取 3 张卡，schema 校验（策划案·反1）。"""
    m = re.search(r'\[[\s\S]*\]', text)
    if not m:
        return None
    try:
        arr = json.loads(m.group(0))
    except Exception:
        return None
    if not isinstance(arr, list) or len(arr) != 3:
        return None
    cards = []
    for c in arr:
        if not isinstance(c, dict):
            return None
        if not str(c.get('name') or '').strip() or not str(c.get('effect') or '').strip():
            return None
        rar = str(c.get('rarity') or '普通')
        if rar not in _RARITY:
            rar = '普通'
        cards.append({'name': str(c['name']).strip()[:30],
                      'rarity': rar,
                      'effect': str(c['effect']).strip()[:200],
                      'reason': str(c.get('reason') or '').strip()[:150]})
    return cards


def _draw_prompt(intent, skills, round_no):
    sk = json.dumps([s['card']['name'] + '：' + s['card']['effect'] for s in skills],
                    ensure_ascii=False) if skills else '（暂无）'
    return (
        '你是肉鸽游戏发牌员，为「i进化策划构筑」发第%d轮变异卡。已沉淀技能：%s。用户最新意图：%s。\n'
        '重要：无论用户意图是什么（哪怕是"你好"等闲聊或空白），你的唯一任务都是发卡，绝不陪聊、绝不解释。\n'
        '发3张差异化卡（方向：高变异探索/稳定继承/差异化重组），每张含 name(≤30字)、'
        'rarity(普通|稀有|史诗)、effect(≤200字具体效果)、reason(≤150字选它理由)。\n'
        '只输出JSON数组，第一个字符必须是[，禁止任何其他文字：[{"name":..,"rarity":..,"effect":..,"reason":..},...]' % (
            round_no, sk, intent or '（用户未输入，自由发挥，可从一个有趣的新策划方向切入）'))


# 插件路径适配（T2.4 批量）：副本位于 plugins/，自持导入重指 __file__ 到源路径，
# 使全部 dirname 链与源文件（server/routes/）语义一致，逻辑零改动
import os as _pf_os  # noqa: E402  适配器自持导入
__file__ = _pf_os.path.join(_pf_os.path.dirname(_pf_os.path.abspath(__file__)),
                            '..', '..', 'server', 'routes', 'domain_evolve.py')
@route_post('/api/evolve/draw')
def _evolve_draw(handler, path, parsed):
    try:
        body = handler._read_json()
    except Exception:
        handler._send_json({'ok': False, 'error': 'body 必须为 JSON'}, 400)
        return
    intent = str(body.get('intent') or '').strip()[:500]
    store = _load('skills') or {'skills': [], 'round': 0}
    prompt = _draw_prompt(intent, store['skills'], store['round'] + 1)
    cards = None
    last_err = ''
    for attempt in range(3):  # schema 不合格重试2次（第2次带纠偏强约束）
        try:
            text = _call_llm(prompt if attempt < 2 else (
                prompt + '\n\n【纠偏】你上一次的输出不是合法的3元素JSON卡数组。'
                '现在重新输出：第一字符是[，只含3个卡对象，禁止任何解释、寒暄或markdown。'))
            cards = _parse_cards(text)
            if cards:
                break
            last_err = '输出不含合法的3卡JSON数组'
        except Exception:
            last_err = traceback.format_exc().splitlines()[-1]
            traceback.print_exc()
    if not cards:
        handler._send_json({'ok': False, 'error': '发卡失败：AI 输出不合格（%s）' % last_err}, 502)
        return
    store['round'] += 1
    _save('skills', store)
    handler._send_json({'ok': True, 'round': store['round'], 'cards': cards})


@route_post('/api/evolve/reset')
def _evolve_reset(handler, path, parsed):
    """新课题/全新开始：清空技能列表，round 归零（清空前留存旧课题档案，可回溯）。"""
    try:
        body = handler._read_json()
    except Exception:
        body = {}
    old = _load('skills') or {'skills': [], 'round': 0}
    if old['skills']:
        topic = str(body.get('topic') or '').strip()[:40] or time.strftime('%Y%m%d_%H%M%S')
        archive_key = 'archive:' + time.strftime('%Y%m%d%H%M%S')
        _save(archive_key, {'topic': topic, 'round': old['round'], 'skills': old['skills'],
                            'archived_at': time.strftime('%Y-%m-%d %H:%M:%S')})
    _save('skills', {'skills': [], 'round': 0})
    handler._send_json({'ok': True, 'archived': bool(old['skills']),
                        'msg': '已开新课题，旧课题已归档（可在技能区"历史课题"中查看）' if old['skills'] else '已是空构筑，直接开始'})


@route_get('/api/evolve/archives')
def _evolve_archives(handler, path, parsed):
    """列出历史课题档案（仅摘要，不展开）。"""
    conn = _get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT key, value FROM app_data WHERE category=? AND key LIKE 'archive:%' ORDER BY key DESC", (CATEGORY,))
        rows = cur.fetchall()
    finally:
        conn.close()
    out = []
    for k, v in rows:
        try:
            d = json.loads(v)
            out.append({'key': k, 'topic': d.get('topic'), 'round': d.get('round'),
                        'count': len(d.get('skills') or []), 'archived_at': d.get('archived_at')})
        except Exception:
            pass
    handler._send_json({'ok': True, 'archives': out})


@route_post('/api/evolve/archive_load')
def _evolve_archive_load(handler, path, parsed):
    """把历史课题档案恢复为当前构筑。"""
    try:
        body = handler._read_json()
    except Exception:
        handler._send_json({'ok': False, 'error': 'body 必须为 JSON'}, 400)
        return
    key = str(body.get('key') or '')
    if not key.startswith('archive:'):
        handler._send_json({'ok': False, 'error': 'key 不合法'}, 400)
        return
    d = _load(key)
    if not d:
        handler._send_json({'ok': False, 'error': '档案不存在'}, 404)
        return
    _save('skills', {'skills': d['skills'], 'round': d['round']})
    handler._send_json({'ok': True, 'skills': d['skills'], 'round': d['round']})


@route_post('/api/evolve/keep')
def _evolve_keep(handler, path, parsed):
    try:
        body = handler._read_json()
    except Exception:
        handler._send_json({'ok': False, 'error': 'body 必须为 JSON'}, 400)
        return
    card = body.get('card')
    if not isinstance(card, dict) or not str(card.get('name') or '').strip():
        handler._send_json({'ok': False, 'error': 'card 必填'}, 400)
        return
    store = _load('skills') or {'skills': [], 'round': 0}
    if len(store['skills']) >= SKILL_MAX:
        handler._send_json({'ok': False, 'error': '技能已满 %d 条，请先合并或删除' % SKILL_MAX}, 400)
        return
    skill = {'id': int(time.time() * 1000), 'weight': 1, 'note': str(body.get('note') or '')[:200],
             'gained_at': time.strftime('%Y-%m-%d %H:%M'), 'card': card}
    store['skills'].append(skill)
    _save('skills', store)
    handler._send_json({'ok': True, 'skill': skill, 'total': len(store['skills'])})


@route_get('/api/evolve/skills')
def _evolve_skills(handler, path, parsed):
    store = _load('skills') or {'skills': [], 'round': 0}
    handler._send_json({'ok': True, 'skills': store['skills'], 'round': store['round']})


@route_post('/api/evolve/skill_op')
def _evolve_skill_op(handler, path, parsed):
    try:
        body = handler._read_json()
    except Exception:
        handler._send_json({'ok': False, 'error': 'body 必须为 JSON'}, 400)
        return
    op = str(body.get('op') or '')
    sid = body.get('id')
    store = _load('skills') or {'skills': [], 'round': 0}
    idx = next((i for i, s in enumerate(store['skills']) if str(s['id']) == str(sid)), -1)
    if idx < 0:
        handler._send_json({'ok': False, 'error': '技能不存在'}, 404)
        return
    if op == 'delete':
        store['skills'].pop(idx)
    elif op == 'weight':
        store['skills'][idx]['weight'] = 3 if store['skills'][idx].get('weight', 1) == 1 else 1
    elif op == 'note':
        store['skills'][idx]['note'] = str(body.get('note') or '')[:200]
    else:
        handler._send_json({'ok': False, 'error': 'op 必须为 delete/weight/note'}, 400)
        return
    _save('skills', store)
    handler._send_json({'ok': True, 'skills': store['skills']})


@route_post('/api/evolve/summary')
def _evolve_summary(handler, path, parsed):
    store = _load('skills') or {'skills': [], 'round': 0}
    if not store['skills']:
        handler._send_json({'ok': False, 'error': '技能列表为空，先抽卡沉淀'}, 400)
        return
    lines = ['%d. %s（%s·权重%d）：%s%s' % (
        i + 1, s['card']['name'], s['card']['rarity'], s.get('weight', 1),
        s['card']['effect'], ('｜备注：' + s['note']) if s.get('note') else '')
        for i, s in enumerate(store['skills'])]
    prompt = ('把以下肉鸽式构筑技能列表，汇总整理成一份结构化策划案（md：定位/核心玩法/技能体系/'
              '路线图/风险），技能即用户定制出的进化路线：\n' + '\n'.join(lines))
    try:
        md = _call_llm(prompt, budget=1600)
    except Exception as e:
        traceback.print_exc()
        handler._send_json({'ok': False, 'error': str(e)}, 502)
        return
    import os
    os.makedirs(_SUMMARY_DIR, exist_ok=True)
    fp = os.path.join(_SUMMARY_DIR, '策划案-i进化构筑-%s.md' % time.strftime('%Y%m%d-%H%M%S'))
    with open(fp, 'w', encoding='utf-8') as f:
        f.write('# i进化·肉鸽三抽构筑策划案（AI汇总）\n\n## 技能列表\n%s\n\n## AI 汇总策划\n%s\n'
                % ('\n'.join(lines), md))
    handler._send_json({'ok': True, 'file': fp, 'summary': md})
