#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
butler_skill_policy - 员工 persona 技能自动推断（策划案 v3 P2 规则层）
保守裁剪：默认全量继承，只裁两类：
1) 硬黑名单：系统级/外发工具，任何 persona 一律拒绝（安全边界，覆盖反驳④）；
2) persona 关键词裁剪：persona 文本命中领域词典反义时裁掉整类（如"文案"裁编程类）。
不改动 agent_loop 内核工具表——本轮只交付规则函数+单测（裁决：内核拦截随 P3 评审）。
"""

# 硬黑名单：员工永不继承（系统级/外发/不可逆）
HARD_BLOCK = {'send_email', 'schedule', 'monitor', 'update_checker'}

# 工具分类 → 授予该类所需的 persona 词典（命中任意词即放行该类）
CATEGORY_KEYWORDS = {
    'writing': ['文案', '写作', '编辑', '小编', '作者', '内容', '文章', '导师', '改写', '润色'],
    'coding': ['开发', '程序', '代码', '工程师', '程序员', '编程', '脚本', '测试'],
    'browse': ['调研', '浏览', '网页', '搜索', '抓取', '信息'],
    'ops': ['运维', '管理', '助理', '秘书', '助理师', '运营'],
}

# 不在任何词典中的基础工具：全员可用（读/写/搜索/任务管理/收尾）
UNIVERSAL = {'task_complete', 'switch_tool_category', 'ask_user', 'task_list',
             'read_file', 'read_lines', 'write_file', 'replace_text', 'move_file',
             'run_code', 'tree_dir', 'find_files', 'search_in_files', 'file_info',
             'project_record', 'long_plan', 'plan_batch', 'get_tool_result'}


def infer_allowed_tools(persona, candidate_tools):
    """根据 persona 文本推断员工允许使用的工具集合。
    persona: str；candidate_tools: iterable[str]（含分类前缀如 'writing:polish_text' 或裸名）
    返回 sorted list。
    """
    persona = str(persona or '')
    allowed = []
    for t in candidate_tools:
        name = t.split(':', 1)[-1] if ':' in t else t
        if name in HARD_BLOCK:
            continue  # 硬黑名单：恒拒
        if name in UNIVERSAL:
            allowed.append(t)
            continue
        # 分类工具：persona 命中对应词典才放行
        cat = t.split(':', 1)[0] if ':' in t else None
        kws = CATEGORY_KEYWORDS.get(cat)
        if kws is None:
            # 无分类信息，保守放行（默认多给）
            allowed.append(t)
        elif any(k in persona for k in kws):
            allowed.append(t)
        # 未命中 → 裁掉（保守裁剪）
    return sorted(allowed)


def check(persona, tool_name):
    """单点查询：该 persona 是否允许用 tool_name。返回 (bool, reason)。"""
    if tool_name in HARD_BLOCK:
        return False, '硬黑名单（系统级工具，员工不可用）'
    if tool_name in UNIVERSAL:
        return True, '基础工具，全员可用'
    for cat, kws in CATEGORY_KEYWORDS.items():
        if any(tool_name.startswith(cat + ':') for _ in [0]) or tool_name in _cat_tools_hint(cat):
            if any(k in str(persona or '') for k in kws):
                return True, 'persona 命中 %s 词典' % cat
            return False, 'persona 未命中 %s 词典，保守裁剪' % cat
    return True, '未分类，保守放行'


def _cat_tools_hint(cat):
    # 分类工具名单由 tools-defs-categories.js 维护；规则层仅按前缀判断，
    # 此处返回空集合避免硬编码漂移。
    return set()
