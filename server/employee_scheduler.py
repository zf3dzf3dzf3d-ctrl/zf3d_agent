#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
员工定时器调度器（employee_scheduler）
策划案《员工体系-定时器自动干活》P1+P2 实现：
- P1 数据层：private/记忆/员工定时器.json（绑定表：员工name + box_id + task_prompt + schedule + enabled + last_run）
- P2 调度器：daemon 线程，到点把 task_prompt 以 monitor_queue 消息投进员工专属窗（chat_id=box_id）
  —— 复用 /api/monitor/poll 既有消费链路（mixin_static.py:476 按 $.chat_id 过滤），无需 ctx。

锁审计（2026-10-30，遵守排查纪律第4条）：
- _json_lock：模块内私有文件锁，仅本模块读写 timers json 时短暂持有（毫秒级），无重入路径。
- _db_lock（来自 config，全局共享）：仅在 _inject_to_queue 内 with 持有做单条 INSERT+commit，
  不嵌套获取其他锁、不在持锁期间做文件 IO（json 回写在锁外进行）→ 无持锁重入死锁风险。
  调用方（_tick_loop 线程）本身不持有 _db_lock。
"""
import os
import json
import time
import threading
import traceback
from datetime import datetime

import sqlite3

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TIMERS_PATH = os.path.join(BASE, 'private', '记忆', '员工定时器.json')

_json_lock = threading.Lock()
_started = False

# 最小触发间隔（秒），防雪崩：全部任务最短 interval 下限
MIN_INTERVAL_SECONDS = 60


def _now_ms():
    return int(time.time() * 1000)


def _log_injection(timer, inject_len):
    """注入日志（策划案 v3 验收：零操作注入可查）。append-only jsonl。"""
    try:
        log_path = os.path.join(BASE, 'private', '记忆', '员工知识注入日志.jsonl')
        rec = json.dumps({
            'ts': _now_ms(),
            'employee': timer.get('name', ''),
            'inject_len': inject_len,
            'task': str(timer.get('task_prompt') or '')[:100]
        }, ensure_ascii=False)
        with _json_lock:
            with open(log_path, 'a', encoding='utf-8') as f:
                f.write(rec + '\n')
    except Exception:
        traceback.print_exc()


def load_timers():
    """读绑定表（不带锁的裸读，供外部只读查看）"""
    try:
        with open(TIMERS_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data.get('timers', []) if isinstance(data, dict) else data
    except FileNotFoundError:
        return []
    except Exception:
        traceback.print_exc()
        return []


def save_timers(timers):
    """写绑定表（持 _json_lock，原子替换写）"""
    os.makedirs(os.path.dirname(TIMERS_PATH), exist_ok=True)
    with _json_lock:
        tmp = TIMERS_PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump({'timers': timers}, f, ensure_ascii=False, indent=2)
        os.replace(tmp, TIMERS_PATH)


def add_timer(name, box_id, task_prompt, schedule, enabled=True):
    """新增定时任务。schedule: {'type':'daily','time':'HH:MM'} 或 {'type':'interval','seconds':N}"""
    timers = load_timers()
    tid = 'et_%d' % _now_ms()
    timers.append({
        'id': tid,
        'name': name,           # 员工名（team.json 事实主键）
        'box_id': box_id,       # 投递目标窗 chat_id
        'task_prompt': task_prompt,
        'schedule': schedule,
        'enabled': bool(enabled),
        'last_run': None,
        'last_status': None,
        'created_at': _now_ms(),
    })
    save_timers(timers)
    return tid


def remove_timer(timer_id):
    timers = [t for t in load_timers() if t.get('id') != timer_id]
    save_timers(timers)
    return True


def set_enabled(timer_id, enabled):
    timers = load_timers()
    hit = False
    for t in timers:
        if t.get('id') == timer_id:
            t['enabled'] = bool(enabled)
            hit = True
    if hit:
        save_timers(timers)
    return hit


# ---------- cron（最小实现：daily HH:MM 与 interval 秒） ----------

def _next_due(timer, now):
    """返回该任务下次应触发的 epoch 秒；不合法返回 None"""
    sch = timer.get('schedule') or {}
    stype = sch.get('type')
    if stype == 'daily':
        hh, mm = str(sch.get('time', '09:00')).split(':')[:2]
        d = datetime.now().replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
        due = d.timestamp()
        if due <= now:
            due += 86400
        return due
    if stype == 'interval':
        sec = int(sch.get('seconds', 0))
        if sec < MIN_INTERVAL_SECONDS:
            sec = MIN_INTERVAL_SECONDS
        last = timer.get('last_run')
        base = (last / 1000.0) if last else now
        return base + sec
    return None


def _is_due(timer, now, _next_cache={}):
    """判断是否到点。用 schedule+last_run 推算，错过窗口（重启）则立即补跑一次。"""
    sch = timer.get('schedule') or {}
    stype = sch.get('type')
    if stype == 'daily':
        want = str(sch.get('time', ''))
        cur = datetime.now().strftime('%H:%M')
        last = timer.get('last_run')
        today = datetime.now().strftime('%Y-%m-%d')
        if cur == want and (not last or datetime.fromtimestamp(last / 1000.0).strftime('%Y-%m-%d') != today):
            return True
        return False
    if stype == 'interval':
        sec = max(int(sch.get('seconds', 0)), MIN_INTERVAL_SECONDS)
        last = timer.get('last_run')
        return (not last) or (now - last / 1000.0 >= sec)
    return False


# ---------- 投窗（复用 monitor_queue，锁内短临界区） ----------

def _inject_to_queue(timer):
    """到点触发：向 monitor_queue 插一条消息，员工窗轮询后自动执行。
    锁审计：仅持有 config._db_lock 做单条 INSERT，锁内无 IO/无嵌套锁。
    （2026-10-31 v3 追加：知识检索/注入日志均在持 _db_lock 之前完成；
    _log_injection 内部短持 _json_lock 时调用方未持 _db_lock → 无持锁重入。）"""
    from config import DB_PATH, _db_lock
    now = _now_ms()
    # 策划案 v3 P1：知识自动检索注入（auto_cap=false 或空命中 → 旧行为）
    inject_len = 0
    try:
        from butler_knowledge import build_inject_message
        from butler_store import get_auto_cap
        timer2 = dict(timer)
        timer2['auto_cap'] = bool(timer2.get('auto_cap', True)) and get_auto_cap(timer2.get('name', ''))
        final_prompt, inject_len = build_inject_message(timer2)
        if inject_len > 0:
            _log_injection(timer2, inject_len)
    except Exception:
        traceback.print_exc()
        final_prompt = str(timer.get('task_prompt') or '')
        inject_len = 0
    msg = '【定时任务·员工%s】%s' % (timer.get('name', ''), final_prompt)
    data = json.dumps({
        'chat_id': timer.get('box_id', ''),
        'message': msg,
        'timestamp': now,
        'status': 'pending'
    }, ensure_ascii=False)
    # 锁审计实测（2026-10-30）：服务器繁忙时 SQLite 文件锁可能被长事务占用，
    # 单次 busy_timeout 不够 → 加重试（3 次 × 3s），失败不抛出到调度线程
    conn = None
    for attempt in range(3):
        try:
            conn = sqlite3.connect(DB_PATH, timeout=10)
            conn.execute('PRAGMA busy_timeout=10000')
            with _db_lock:
                conn.execute(
                    'INSERT INTO app_data (category, key, value, created_at, updated_at) '
                    'VALUES (?, ?, ?, ?, ?)',
                    ('monitor_queue', 'emp_timer_%s_%d' % (timer.get('id'), now), data, now, now))
                conn.commit()
            conn.close()
            return True
        except sqlite3.OperationalError as e:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass
                conn = None
            if attempt == 2:
                raise
            time.sleep(3)


def ensure_employee_window(timer):
    """P3：确保员工专属窗存在。box_id 为空或 sessions 表无此会话时，自动创建【员工】<name> 窗并回写 box_id。
    返回可用 box_id（失败返回原值）。"""
    from config import DB_PATH, _db_lock
    name = str(timer.get('name') or '员工')
    box_id = str(timer.get('box_id') or '').strip()
    exists = False
    conn = None
    try:
        conn = sqlite3.connect(DB_PATH, timeout=10)
        conn.execute('PRAGMA busy_timeout=10000')
        if box_id:
            cur = conn.execute('SELECT 1 FROM sessions WHERE id = ?', (box_id,))
            exists = cur.fetchone() is not None
        if not exists:
            # 创建员工专属窗：名称【员工】<name>，幂等（同名窗已存在则直接复用）
            with _db_lock:
                cur = conn.execute("SELECT id FROM sessions WHERE name = ?", ('【员工】' + name,))
                row = cur.fetchone()
                if row:
                    box_id = row[0]
                else:
                    box_id = 'emp_%s_%d' % (name, _now_ms())
                    now_ms = _now_ms()
                    conn.execute('INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
                                 (box_id, '【员工】' + name, now_ms, now_ms))
                    conn.commit()
    except Exception:
        traceback.print_exc()
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass
    if box_id and box_id != timer.get('box_id'):
        timer['box_id'] = box_id  # 同步内存对象（调度循环里 _inject 直接用 dict）
        timers = load_timers()
        for t in timers:
            if t.get('id') == timer.get('id'):
                t['box_id'] = box_id
        save_timers(timers)
    return box_id


def _mark_run(timer_id, ok, note=''):
    """回写 last_run（锁外文件 IO，持 _json_lock）"""
    timers = load_timers()
    for t in timers:
        if t.get('id') == timer_id:
            t['last_run'] = _now_ms()
            t['last_status'] = 'ok' if ok else ('fail: ' + str(note)[:200])
    save_timers(timers)


# ---------- 主循环 ----------

def _tick_loop():
    while True:
        try:
            now = time.time()
            for t in load_timers():
                if not t.get('enabled'):
                    continue
                if _is_due(t, now):
                    try:
                        t['box_id'] = ensure_employee_window(t)  # P3：无窗自动建
                        _inject_to_queue(t)
                        _mark_run(t['id'], True)
                        print('[员工定时器] 已触发 %s -> 窗 %s' % (t.get('name'), t.get('box_id')))
                    except Exception as e:
                        _mark_run(t['id'], False, e)
                        traceback.print_exc()
                time.sleep(0.2)  # 任务间微小间隔，防同刻批量插入
        except Exception:
            traceback.print_exc()
        time.sleep(20)  # 扫描周期 20s（daily 精度到分钟足够）


def start():
    """启动调度线程（幂等）。由 db.init_db() 末尾调用。"""
    global _started
    if _started:
        return
    _started = True
    th = threading.Thread(target=_tick_loop, daemon=True, name='employee_scheduler')
    th.start()
    n = len([t for t in load_timers() if t.get('enabled')])
    print('[员工定时器] 调度器已启动，启用任务数: %d' % n)


if __name__ == '__main__':
    # 手动测试：python employee_scheduler.py --test
    start()
    time.sleep(60)
