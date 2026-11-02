#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""memory_map - 记忆系统导航图：描述全部 7 套记忆机制各自的作用与适用场景。

用途：AI（和人类）在使用任何记忆工具前先跑一次本脚本（或读本文件），
即可知道「该往哪写、该从哪读」，避免写错地方。

每套记忆一行结论：
  1. table_memory(memory_core) - 通用结构化表格记忆：键值/记录型数据，
     如用户偏好、配置快照。适合「机器要精确读回的结构化小数据」。
  2. long_term_memory - 条目式长期记忆：跨会话的事实条目（带时间/标签）。
     适合「关于用户/项目的长期事实」，如"用户喜欢简洁回答"。
  3. project_record - Markdown 记忆库 + 自动索引：private/记忆/ 下的
     人可读文档。适合「中等长度的项目知识、经验教训、方案说明」。
  4. _memory_tools / append_worklog_md - 自动工作日志：任务完成时追加
     private/记忆/工作日志/YYYY-MM.md，满 20 条可提炼总结，每日 zip 快照。
     适合「流水账」，不要往这里写结论。
  5. git_save / git_save_step - git 双快照：任务前后各一次快照，逐文件
     差分 ±行数，机械回答"这次到底改了什么"。适合自验收，不是知识库。
  6. main_brain - 主脑观察者记忆：60 秒一轮零侵入采集运行状态，总结落盘
     private/brain/，绝不写入用户对话上下文。适合系统级健康记忆。
  7. 浏览器记忆 browser profile - 持久化 Playwright 登录态与浏览痕迹，
     server/data/browser_profile/。适合网页操作类会话状态。

写入决策规则（AI 照做即可）：
  - 一句话长期事实          -> long_term_memory
  - 结构化键值/表格数据     -> table_memory
  - 项目知识/经验/方案      -> project_record
  - 任务流水账              -> 自动工作日志（_memory_tools，无需手动）
  - "改了什么"的自证        -> git_save + self_check，不是记忆
  - 系统运行健康状态        -> main_brain 自动采集，不要手动写
  - 网站登录态/浏览痕迹     -> 浏览器 profile 自动持久化，不要手动写
"""

TOOL_NAME = 'memory_map'

MEMORY_MAP = [
    {'name': 'table_memory (memory_core)', 'file': 'tools/coding/backend/table_memory.py',
     'kind': '结构化表格记忆', 'use': '键值/记录型小数据，需精确读回', 'write': 'AI 按需调用'},
    {'name': 'long_term_memory', 'file': 'tools/coding/backend/long_term_memory.py',
     'kind': '条目式长期记忆', 'use': '跨会话的长期事实（用户偏好、项目约束）', 'write': 'AI 按需调用'},
    {'name': 'project_record', 'file': 'tools/coding/backend/project_record.py',
     'kind': 'Markdown 记忆库', 'use': 'private/记忆/ 下的人可读项目知识与经验', 'write': 'AI 按需调用'},
    {'name': '_memory_tools (工作日志)', 'file': 'tools/coding/backend/_memory_tools.py',
     'kind': '自动工作日志', 'use': '任务流水账 → 提炼总结 → 每日 zip；只追加', 'write': '系统自动'},
    {'name': 'git_save / self_check', 'file': 'tools/coding/backend/git_save.py + self_check.py',
     'kind': 'git 双快照自验收', 'use': '机械证明一次对话改了什么（±行数差分）', 'write': '系统自动'},
    {'name': 'main_brain', 'file': 'server/brain/main_brain.py',
     'kind': '主脑观察者记忆', 'use': '系统健康状态采集与总结，独立落盘 private/brain/', 'write': '系统自动，绝不污染用户上下文'},
    {'name': '浏览器记忆', 'file': 'server/data/browser_profile/',
     'kind': '持久化浏览器 profile', 'use': '网页登录态与浏览痕迹跨重启保留', 'write': '浏览器工具自动'},
]


def handle(body, ctx=None):
    """工具入口：返回全部 7 套记忆的导航说明。body 可含 {'detail': name} 查单套。"""
    detail = (body or {}).get('detail')
    if detail:
        for m in MEMORY_MAP:
            if detail.lower() in m['name'].lower():
                return {'ok': True, 'memory': m}
        return {'ok': False, 'error': 'no such memory: %s' % detail}
    lines = ['记忆系统导航（7 套，写入前先看这张表）：']
    for i, m in enumerate(MEMORY_MAP, 1):
        lines.append('%d. %s [%s] - %s（%s）' % (i, m['name'], m['kind'], m['use'], m['write']))
    lines.append('')
    lines.append('写入决策：长期事实→long_term_memory；结构化数据→table_memory；')
    lines.append('项目知识→project_record；流水账→自动工作日志；自验收→git_save。')
    return {'ok': True, 'guide': '\n'.join(lines), 'map': MEMORY_MAP}


if __name__ == '__main__':
    import json
    print(json.dumps(handle({}), ensure_ascii=False, indent=1))
