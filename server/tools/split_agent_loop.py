# -*- coding: utf-8 -*-
"""S3 机械拆分：把 run_agent_loop 内 L611-848 工具管线装配块抽为模块级 _build_tool_pipeline()。
纯搬家：块内代码逐行 dedent 4 空格，零逻辑改动。"""
import io

from util_log import get_logger

log = get_logger('split_agent_loop')
PATH = r''

lines = io.open(PATH, encoding='utf-8').read().splitlines(keepends=False)
# 1-indexed 校验锚点，防止行号漂移误切
assert lines[535].startswith('def run_agent_loop'), lines[535]
assert '蜂群工具内核级注入' in lines[610], lines[610]
assert lines[847].strip() == '_mcp_exec_wrap = _iapp_exec_wrap', lines[847]

block = lines[610:848]  # L611..848
ded = []
for ln in block:
    if ln.startswith('    '):
        ded.append(ln[4:])
    else:
        ded.append(ln)

new_fn = (
    ['def _build_tool_pipeline(messages, hooks, tool_schemas):',
     '    """S3 拆分自 run_agent_loop（纯搬家）：蜂群/MCP/sys_*/iApp 四层 schema 注入 + 执行包装链。',
     '    返回最终执行器 _mcp_exec_wrap（最外层包装，含全部拦截）。"""']
    + ded
    + ['    return _mcp_exec_wrap', '']
)

call_site = [
    '    # ===== 工具管线装配（S3 拆分至 _build_tool_pipeline，纯搬家零逻辑改动）=====',
    '    _mcp_exec_wrap = _build_tool_pipeline(messages, hooks, tool_schemas)',
]

out = lines[:610] + call_site + lines[848:]
# 插入新函数到 run_agent_loop 定义之前（找模块级插入点：原 L536 def 之前，即 out 中 def run_agent_loop 的位置）
idx = next(i for i, l in enumerate(out) if l.startswith('def run_agent_loop'))
out = out[:idx] + new_fn + out[idx:]

io.open(PATH, 'w', encoding='utf-8', newline='\n').write('\n'.join(out) + '\n')
log.info('%s %s', 'SPLIT_OK, new total lines =', len(out))
