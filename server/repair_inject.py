#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
修复请求自动注入模块 - repair_inject
当本版本收到其他版本写来的 private/repair_request.json（对端断网自救失败、
请求本版本智能体帮助修复）时，自动把该请求作为一条 system 消息注入到
下一次 AI 对话请求中，实现"备用版本自动接单修复"的全自动闭环。

流程：
  1. 对端版本的 backup_version.escalate() 把 repair_request.json 写到本版本 private/
  2. 本版本代理模块（mixin_proxy / mixin_proxy_stream）在每次 AI 请求前调用
     inject_into_payload()，若存在未消费的修复请求，注入一条 system 消息
  3. 注入后立即标记 consumed（改名 repair_request.done.json），防止重复注入
  4. 智能体看到消息后按 how_to_help 步骤修复对端，完成后可调
     POST /api/backup/repair_ack 回传结果
"""
import os
import json
import time

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REQ_NAME = 'repair_request.json'
DONE_NAME = 'repair_request.done.json'


def _req_path(base_dir=None):
    return os.path.join(base_dir or BASE_DIR, 'private', REQ_NAME)


def _done_path(base_dir=None):
    return os.path.join(base_dir or BASE_DIR, 'private', DONE_NAME)


def read_pending(base_dir=None):
    """读取未消费的修复请求，返回 dict 或 None。"""
    p = _req_path(base_dir)
    if not os.path.isfile(p):
        return None
    try:
        with open(p, 'r', encoding='utf-8-sig') as f:
            return json.load(f)
    except Exception:
        return None


def mark_consumed(base_dir=None):
    """把修复请求标记为已注入（改名 .done.json），防止重复注入。"""
    p = _req_path(base_dir)
    if not os.path.isfile(p):
        return False
    try:
        d = _done_path(base_dir)
        if os.path.isfile(d):
            try:
                os.remove(d)
            except Exception:
                pass
        try:
            with open(p, 'r', encoding='utf-8-sig') as f:
                data = json.load(f)
            data['consumed_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
            with open(d, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.remove(p)
        except Exception:
            os.replace(p, d)
        return True
    except Exception:
        return False


def build_injection_message(req):
    """根据修复请求构造注入到对话的 system 消息文本。"""
    if not isinstance(req, dict):
        return None
    from_v = req.get('from_version', '未知版本')
    from_dir = req.get('from_dir', '')
    from_port = req.get('from_port', '')
    reason = req.get('reason', '')
    how = req.get('how_to_help', '')
    logs = req.get('recent_logs', '')
    if isinstance(logs, list):
        logs = '\n'.join(str(x) for x in logs)
    return (
        '【⚠️ 自动派发的修复任务 - 来自备用版本拉起机制】\n'
        '版本 %s（目录: %s，端口: %s）的后台服务出现故障且自动重启未能恢复，'
        '已自动拉起本版本作为备用后台接管服务。现在请你作为值班智能体，'
        '立即着手修复对端版本。\n\n'
        '故障原因: %s\n\n'
        '修复步骤:\n%s\n\n'
        '对端最近日志:\n%s\n\n'
        '要求: 请按上述步骤诊断并修复对端版本（可使用文件读写和命令工具），'
        '修复完成并通过 health 检查后，调用 POST http://127.0.0.1:%s/api/backup/repair_ack '
        '回传结果（body: {"by":"备用版本智能体","result":"成功/失败","details":"说明"}）。'
        '本条消息为系统自动注入，处理前请优先完成该修复任务。'
    ) % (from_v, from_dir, from_port, reason or '未提供（详见日志）',
         how or '见对端 repair_request.json', str(logs or '')[-2000:], from_port)


def inject_into_payload(payload, base_dir=None):
    """检查是否有未消费的修复请求，若有则注入 system 消息并标记消费。
    返回 True 表示已注入。"""
    req = read_pending(base_dir)
    if not req:
        return False
    try:
        msgs = (payload or {}).get('messages')
        if not isinstance(msgs, list):
            return False
        text = build_injection_message(req)
        if not text:
            return False
        msgs.append({'role': 'system', 'content': text})
        mark_consumed(base_dir)
        try:
            print('[RepairInject] ✅ 已把对端修复请求注入到本次 AI 对话 (来自: %s)'
                  % req.get('from_version', '?'))
        except Exception:
            pass
        return True
    except Exception as e:
        try:
            print('[RepairInject] 注入失败: %s' % e)
        except Exception:
            pass
        return False
