#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""append_worklog_md - 追加写入项目工作日志（MD格式）。

由前端在「保存git」成功后调用：先由大模型总结本步工作，再把总结追加到项目日志。
日志查找规则：项目根目录下查找已有的 MD 日志文件（按优先级），
找不到则自动创建一个新的。始终追加写入，不替换原内容。

接收 body:
  { path?: 项目路径（默认 ctx.project_dir）, summary: 日志正文（Markdown）,
    step?: 步骤号, commit?: commit hash }
"""
import os
import time

TOOL_NAME = 'append_worklog_md'

# 已有日志文件的候选名（按优先级）
CANDIDATE_LOGS = [
    '工作日志.md',
    '工作日志.MD',
    'WORKLOG.md',
    'worklog.md',
    '日志.md',
    'CHANGELOG.md',
]
# 新建日志的默认文件名
DEFAULT_LOG = '工作日志.md'
LOG_DIR = os.path.join('private', 'agent_steps')


def _find_existing_log(project_dir):
    """按优先级在项目根目录（及 private/agent_steps）查找已有 MD 日志。"""
    for name in CANDIDATE_LOGS:
        p = os.path.join(project_dir, name)
        if os.path.isfile(p):
            return p
    # private/agent_steps 目录下也找一下
    d = os.path.join(project_dir, LOG_DIR)
    if os.path.isdir(d):
        for fn in sorted(os.listdir(d)):
            if fn.lower().endswith('.md'):
                return os.path.join(d, fn)
    return None


def handle(body, ctx):
    """处理追加工作日志请求：找到或创建日志文件，追加写入。"""
    try:
        path = body.get('path', '') or ctx.project_dir
        summary = body.get('summary', '')
        step = body.get('step', '')
        commit = body.get('commit', '')

        if not path or not os.path.isdir(path):
            ctx.send_error('项目路径不存在: ' + str(path))
            return
        if not summary or not summary.strip():
            ctx.send_error('日志内容为空，跳过写入')
            return

        log_path = _find_existing_log(path)
        created = False
        if not log_path:
            log_path = os.path.join(path, DEFAULT_LOG)
            created = True

        # 组装追加块（带分隔线，避免与已有内容混在一起）
        now = time.strftime('%Y-%m-%d %H:%M:%S')
        block = '\n\n---\n\n'
        if created:
            # 新文件时写文件头
            header = '# 项目工作日志\n\n> 自动生成：每次「保存git」后由大模型总结本步工作追加于此。\n'
            block = header + '\n---\n\n'
        if step:
            block += '**步骤 ' + str(step) + '**'
            if commit:
                block += '（commit: ' + str(commit) + '）'
            block += ' · ' + now + '\n\n'
        else:
            block += now + '\n\n'
        block += summary.strip() + '\n'

        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        with open(log_path, 'a', encoding='utf-8') as f:
            f.write(block)

        ctx.send_json({
            'ok': True,
            'created': created,
            'log_file': log_path
        })
    except Exception as e:
        ctx.send_error(str(e))
