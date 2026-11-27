# -*- coding: utf-8 -*-
"""蜂群 token 记账（A2，策划案 v3）——防御式旁挂模块。

原则（反驳师修正后口径）：
- 只新增，不改主逻辑：_chat / worker 只需在成功拿到响应后调用 record_usage()，
  任何异常都被吞掉，绝不影响蜂群主流程。
- 【批次真源声明】批次级汇总(sum_batch)只认 dispatch_swarm_tasks.py worker 传入的
  batch/task 记录（全量真源）；dispatch_swarm_infra.py `_chat` 处无批次上下文，
  只记 model 用作调试旁证——后续会话禁止以 infra 记录做批次合计，会静默丢账。
- 【运行级验证欠账】本模块仅编译级+模块自测级验证；真实蜂群流水线的 usage 捕获率
  未测（盲区：流式响应 usage、中转/代理剥字段、非 OpenAI 兼容端点结构）。
  派真实任务后须核对 jsonl 非零占比，usage_missing>50% 视为记账无效。
数据落：server/logs/swarm_token_usage.jsonl（追加写，一行一次调用）。
"""
import json
import os
import threading
import time

_LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         'logs', 'swarm_token_usage.jsonl')
_LOCK = threading.Lock()


def extract_usage(resp_json):
    """防御式提取 usage dict；缺失/异常返回 None（调用方记 0）。"""
    try:
        u = (resp_json or {}).get('usage')
        if isinstance(u, dict):
            return {k: int(u.get(k) or 0)
                    for k in ('prompt_tokens', 'completion_tokens', 'total_tokens')}
    except Exception:
        pass
    return None


def record_usage(batch_id='', task_id='', model='', usage=None, note=''):
    """追加一条记账；任何异常静默吞掉，绝不抛出。usage=None 时记 0 占位行。"""
    try:
        row = {
            'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
            'batch': str(batch_id or ''),
            'task': str(task_id or ''),
            'model': str(model or ''),
            'prompt_tokens': (usage or {}).get('prompt_tokens', 0),
            'completion_tokens': (usage or {}).get('completion_tokens', 0),
            'total_tokens': (usage or {}).get('total_tokens', 0),
            'usage_missing': usage is None,
            'note': str(note or '')[:100],
        }
        with _LOCK:
            with open(_LOG_PATH, 'a', encoding='utf-8') as f:
                f.write(json.dumps(row, ensure_ascii=False) + '\n')
    except Exception:
        pass  # 记账失败绝不影响主流程


def sum_batch(batch_id):
    """按批次合计 total_tokens（供面板/汇总用）；无记录返回 None。"""
    try:
        total = 0
        found = False
        with open(_LOG_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                try:
                    row = json.loads(line)
                except Exception:
                    continue
                if row.get('batch') == str(batch_id):
                    found = True
                    total += int(row.get('total_tokens') or 0)
        return total if found else None
    except Exception:
        return None
