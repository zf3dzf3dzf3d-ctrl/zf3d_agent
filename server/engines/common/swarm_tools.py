# -*- coding: utf-8 -*-
"""蜂群工具：把现有 dispatch_swarm 暴露为智能体可调用的工具（复用，不重复造轮子）。

工具：
- swarm_dispatch: 一次并发派发 N 个子任务（每批上限 20），立即返回 batch_id
- swarm_collect:  等待并收集某批次结果
"""
import json

_SWARM_SCHEMA = [
    {
        'type': 'function',
        'function': {
            'name': 'swarm_dispatch',
            'description': '蜂群并发派发：把 N 个独立子任务同时派给后台 LLM 并发执行（上限20个/批），立即返回 batch_id。适合多文件并行分析、多方案同时生成等场景。可传 allowed_tools 限制子任务可用的工具白名单（如继承对话框当前配置的工具集）。',
            'parameters': {
                'type': 'object',
                'properties': {
                    'tasks': {
                        'type': 'array',
                        'items': {'type': 'object', 'properties': {
                            'goal': {'type': 'string', 'description': '子任务目标（必须明确、自包含）'},
                            'context': {'type': 'string', 'description': '子任务上下文（可选）'},
                        }, 'required': ['goal']},
                        'description': '子任务列表',
                    },
                    'model': {'type': 'string', 'description': '模型名（可选，默认用默认模型）'},
                    'context': {'type': 'string', 'description': '所有子任务共享的上下文（可选）'},
                    'allowed_tools': {
                        'type': 'array',
                        'items': {'type': 'string'},
                        'description': '工具白名单（可选）：只让子任务使用这些工具，如 ["read_file","run_code","search_in_files"]。不传则子任务可用全量工具。',
                    },
                },
                'required': ['tasks'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'swarm_status',
            'description': '查看蜂群批次每个小弟的实时状态，返回 JSON 进度 + mermaid 流程图文本。把 mermaid 代码块直接输出到对话中即可渲染为状态图。',
            'parameters': {
                'type': 'object',
                'properties': {
                    'batch_id': {'type': 'string', 'description': 'swarm_dispatch 返回的批次 ID'},
                },
                'required': ['batch_id'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'swarm_collect',
            'description': '收集蜂群批次结果（非阻塞优先）：默认 wait_sec=0 立即返回当前进度+已完成小弟的产出，不阻塞主脑。小弟全部完成时系统会自动发[蜂群来信]提醒，收到后再调本工具取全量产出即可。',
            'parameters': {
                'type': 'object',
                'properties': {
                    'batch_id': {'type': 'string', 'description': 'swarm_dispatch 返回的批次 ID'},
                    'wait_sec': {'type': 'integer', 'description': '最长等待秒数，默认0=立即返回不等待；仅确需同步等待时才传>0（上限600）'},
                },
                'required': ['batch_id'],
            },
        },
    },
]


def get_schemas():
    return _SWARM_SCHEMA


def execute(name, args, ctx):
    import sys, os
    base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if base not in sys.path:
        sys.path.insert(0, base)
    import dispatch_swarm as swarm
    if name == 'swarm_dispatch':
        try:
            batch_id = swarm.submit(args.get('tasks') or [],
                                    model_name=args.get('model') or None,
                                    shared_context=str(args.get('context') or ''),
                                    allowed_tools=(args.get('allowed_tools') if isinstance(args.get('allowed_tools'), list) else None))
            return True, json.dumps({'ok': True, 'batch_id': batch_id,
                                     'hint': '用 swarm_collect(batch_id) 收集结果'}, ensure_ascii=False)
        except Exception as e:
            return False, 'swarm_dispatch 失败: %s' % e
    if name == 'swarm_status':
        try:
            bid = str(args.get('batch_id') or '')
            st = swarm.status(bid)
            if not st:
                return False, '批次不存在: %s' % bid
            mm = swarm.mermaid(bid)
            return True, json.dumps({'progress': st, 'mermaid': mm},
                                    ensure_ascii=False)
        except Exception as e:
            return False, 'swarm_status 失败: %s' % e
    if name == 'swarm_collect':
        try:
            res = swarm.collect(str(args.get('batch_id') or ''),
                                wait_sec=int(args.get('wait_sec') or 0))
            return True, json.dumps(res, ensure_ascii=False)
        except Exception as e:
            return False, 'swarm_collect 失败: %s' % e
    return False, 'unknown swarm tool: %s' % name
