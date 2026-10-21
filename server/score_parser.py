# -*- coding: utf-8 -*-
"""
AI 自评分 + 接棒者 解析器（接力机制 v1.0）
在 chat_pool._finish_turn 流结束后，从聚合正文中解析自评块与接棒建议，
返回结构化 score/successors，并由调用方随消息事件下发前端。
解析失败静默降级（返回 None），不影响原回答展示。

约定格式（由 prompt 指令约束，容错匹配）：
【自评】准确度 8/10 | 完整度 7/10 | 置信度 85%
【接棒】审核师|2|复核代码正确性   （角色|数量|任务，数量1-3）
角色候选：策划师 / 审核师 / 自定义（自定义时第三段即任务描述）
"""
import re, json, os, time

_SCORE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           'data', 'self_scores.jsonl')

_RE_SCORE = re.compile(
    r'【自评】[^\n]*?准确度\s*(\d+)\s*/\s*10[^\n]*?完整度\s*(\d+)\s*/\s*10[^\n]*?置信度\s*(\d+)\s*%')
_RE_SUC = re.compile(r'【接棒】\s*([^\n|]+)\s*\|\s*([1-3])\s*\|\s*([^\n]+)')
_RE_REC = re.compile(
    r'【推荐接棒】\s*([^\n|]{1,20})\s*\|\s*([^\n|]{1,80})\s*\|\s*([^\n]{1,300})')

_VALID_ROLES = ('策划师', '审核师')


def parse(text):
    """从聚合正文解析自评+接棒。返回 dict 或 None（无块/解析失败）。"""
    if not text:
        return None
    out = {}
    m = _RE_SCORE.search(text)
    if m:
        clamp = lambda v, hi: max(0, min(hi, int(v)))
        out['score'] = {'accuracy': clamp(m.group(1), 10),
                        'completeness': clamp(m.group(2), 10),
                        'confidence': clamp(m.group(3), 100)}
    m2 = _RE_SUC.search(text)
    if m2:
        role = m2.group(1).strip()
        task = m2.group(3).strip()
        if role in ('无', '-') or task in ('无', '-'):
            pass  # 「无需接棒」占位，不生成接棒建议
        else:
            if role not in _VALID_ROLES:
                role = '自定义'
            out['successor'] = {'role': role, 'count': int(m2.group(2)),
                                'task': task[:500],
                                'custom': role not in _VALID_ROLES}
    # 【推荐接棒】多角色推荐（≤3条，每行：角色|理由|预写指令），供前端角色卡
    recs = []
    for m3 in _RE_REC.finditer(text):
        r, why, instr = m3.group(1).strip(), m3.group(2).strip(), m3.group(3).strip()
        if r and r not in ('无', '-'):
            recs.append({'role': r[:20], 'why': why[:80], 'task': instr[:300]})
        if len(recs) >= 3:
            break
    if recs:
        out['recommendations'] = recs
    return out or None


def strip_blocks(text):
    """从正文中剥离原始标记行（防前端重复展示）。返回清理后的正文。"""
    if not text:
        return text
    return re.sub(r'【(?:自评|接棒|推荐接棒)】[^\n]*\n?', '', text).rstrip()


def record(box_id, model, parsed):
    """评分入库（jsonl 追加，趋势分析用）。失败静默。"""
    try:
        os.makedirs(os.path.dirname(_SCORE_PATH), exist_ok=True)
        with open(_SCORE_PATH, 'a', encoding='utf-8') as f:
            f.write(json.dumps({'ts': time.time(), 'box_id': box_id,
                                'model': model, **(parsed or {})},
                               ensure_ascii=False) + '\n')
    except Exception:
        pass


def inject_instruction(messages):
    """【已停用 2026-10-17】用户反馈自评/接棒几乎没用，要求移除。
    改为空操作：不再向 messages 注入输出格式指令，AI 不再输出【自评】【接棒】。
    parse/strip_blocks 保留（兼容历史消息清洗）。"""
    return messages
