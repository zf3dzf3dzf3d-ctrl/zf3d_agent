#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""schedule - Run shell commands at a controlled interval."""

import json
import os
import subprocess
import threading
import time

from tools.coding.backend.base import ToolContext

TOOL_NAME = 'schedule'
MAX_ACTIVE_TASKS = 10
MIN_INTERVAL_SECONDS = 0.5
MAX_INTERVAL_SECONDS = 86400
DEFAULT_COMMAND_TIMEOUT = 300
MAX_COMMAND_TIMEOUT = 3600
# 【W3 持久化 2026-10-30】任务定义落盘 server/data/schedules.json，重启后回载（不自动续跑，需手动 start）
PERSIST_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))), 'server', 'data', 'schedules.json')
_PERSIST_FIELDS = ('name', 'code', 'interval', 'command_timeout', 'max_times',
                   'stop_on_success', 'stop_on_output', 'times_executed',
                   'last_exit_code', 'last_executed_at', 'started_at')
_tasks = {}
_tasks_lock = threading.Lock()


def _save_tasks_locked():
    """必须在已持有 _tasks_lock 时调用。全量快照写 json（tmp+rename 原子替换）。"""
    try:
        os.makedirs(os.path.dirname(PERSIST_PATH), exist_ok=True)
        snapshot = [{k: task.get(k) for k in _PERSIST_FIELDS} for task in _tasks.values()]
        tmp = PERSIST_PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(snapshot, f, ensure_ascii=False, indent=1)
        os.replace(tmp, PERSIST_PATH)
    except Exception:
        pass  # 持久化失败不影响主流程


def _load_tasks():
    """模块加载时回载历史任务定义。线程无法跨重启存活，故 running=False，需手动 start 续跑。"""
    try:
        with open(PERSIST_PATH, 'r', encoding='utf-8') as f:
            snapshot = json.load(f)
        for item in snapshot or []:
            name = item.get('name')
            if not name or name in _tasks:
                continue
            _tasks[name] = {
                'name': name, 'code': item.get('code', ''),
                'interval': float(item.get('interval', 60)),
                'command_timeout': float(item.get('command_timeout', DEFAULT_COMMAND_TIMEOUT)),
                'max_times': int(item.get('max_times', 0)),
                'stop_on_success': bool(item.get('stop_on_success', False)),
                'stop_on_output': item.get('stop_on_output', ''),
                'running': False,
                'times_executed': int(item.get('times_executed', 0)),
                'last_output': '', 'last_exit_code': item.get('last_exit_code'),
                'last_executed_at': item.get('last_executed_at', ''),
                'started_at': item.get('started_at', ''),
                'stop_reason': 'server restarted (persisted, not auto-started)',
                'stop_event': threading.Event(), 'process': None, 'thread': None,
            }
    except FileNotFoundError:
        pass
    except Exception:
        pass  # 损坏文件不阻塞工具加载


_load_tasks()


def _stop_process(process):
    if process is None or process.poll() is not None:
        return
    try:
        process.terminate()
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        process.kill()
    except OSError:
        pass


def _run_command(name, code, command_timeout, stop_event):
    process = None
    try:
        process = subprocess.Popen(
            code,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding='gbk',
            errors='replace',
            creationflags=getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0),
        )
        with _tasks_lock:
            task = _tasks.get(name)
            if task is not None:
                task['process'] = process

        deadline = time.monotonic() + command_timeout
        while process.poll() is None:
            if stop_event.wait(0.2):
                _stop_process(process)
                return '', None, 'manual stop'
            if time.monotonic() >= deadline:
                _stop_process(process)
                return '', None, f'command timeout ({command_timeout}s)'

        output = (process.stdout.read() if process.stdout else '').strip()
        return output, process.returncode, ''
    except Exception as exc:
        return str(exc), -1, ''
    finally:
        with _tasks_lock:
            task = _tasks.get(name)
            if task is not None and task.get('process') is process:
                task['process'] = None


def _run_loop(name):
    while True:
        with _tasks_lock:
            task = _tasks.get(name)
            if task is None or not task['running']:
                return
            code = task['code']
            command_timeout = task['command_timeout']
            stop_event = task['stop_event']

        output, exit_code, stop_reason = _run_command(
            name, code, command_timeout, stop_event
        )

        with _tasks_lock:
            task = _tasks.get(name)
            if task is None:
                return
            task['times_executed'] += 1
            task['last_output'] = output
            task['last_exit_code'] = exit_code
            task['last_executed_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
            _save_tasks_locked()  # 每次执行后持久化，防止重启丢运行痕迹
            if stop_reason:
                task['running'] = False
                task['stop_reason'] = stop_reason
                return
            if task['stop_on_success'] and exit_code == 0:
                task['running'] = False
                task['stop_reason'] = 'success (exit code 0)'
                return
            if task['stop_on_output'] and task['stop_on_output'] in output:
                task['running'] = False
                task['stop_reason'] = 'output matched: ' + task['stop_on_output']
                return
            if task['max_times'] > 0 and task['times_executed'] >= task['max_times']:
                task['running'] = False
                task['stop_reason'] = f"max_times reached ({task['max_times']})"
                return
            interval = task['interval']

        if stop_event.wait(interval):
            with _tasks_lock:
                task = _tasks.get(name)
                if task is not None:
                    task['running'] = False
                    task['stop_reason'] = 'manual stop'
            return


def _task_summary(task, include_output=False):
    result = {
        'name': task['name'],
        'running': task['running'],
        'code': task['code'],
        'interval': task['interval'],
        'command_timeout': task['command_timeout'],
        'max_times': task['max_times'],
        'stop_on_success': task['stop_on_success'],
        'stop_on_output': task['stop_on_output'],
        'times_executed': task['times_executed'],
        'last_exit_code': task['last_exit_code'],
        'last_executed_at': task['last_executed_at'],
        'started_at': task['started_at'],
        'stop_reason': task['stop_reason'],
    }
    if include_output:
        result['last_output'] = task['last_output']
    return result


def handle(body, ctx):
    try:
        action = body.get('action', '')
        name = body.get('name', '').strip()

        if action == 'start':
            code = body.get('code', '')
            interval = float(body.get('interval', 60))
            max_times = int(body.get('max_times', 0))
            command_timeout = float(body.get('command_timeout', DEFAULT_COMMAND_TIMEOUT))
            if not name:
                ctx.send_error('缺少 name 参数')
                return
            if not code:
                ctx.send_error('缺少 code 参数')
                return
            if not MIN_INTERVAL_SECONDS <= interval <= MAX_INTERVAL_SECONDS:
                ctx.send_error(f'interval 必须在 {MIN_INTERVAL_SECONDS} 到 {MAX_INTERVAL_SECONDS} 秒之间')
                return
            if max_times < 0:
                ctx.send_error('max_times 不能小于 0')
                return
            if not 1 <= command_timeout <= MAX_COMMAND_TIMEOUT:
                ctx.send_error(f'command_timeout 必须在 1 到 {MAX_COMMAND_TIMEOUT} 秒之间')
                return

            with _tasks_lock:
                existing = _tasks.get(name)
                if existing and existing['running']:
                    ctx.send_error('任务 ' + name + ' 已在运行中')
                    return
                if sum(1 for task in _tasks.values() if task['running']) >= MAX_ACTIVE_TASKS:
                    ctx.send_error(f'运行中的任务已达到上限 ({MAX_ACTIVE_TASKS})')
                    return
                stop_event = threading.Event()
                task = {
                    'name': name, 'code': code, 'interval': interval,
                    'command_timeout': command_timeout, 'max_times': max_times,
                    'stop_on_success': bool(body.get('stop_on_success', False)),
                    'stop_on_output': body.get('stop_on_output', ''), 'running': True,
                    'times_executed': 0, 'last_output': '', 'last_exit_code': None,
                    'last_executed_at': '', 'started_at': time.strftime('%Y-%m-%d %H:%M:%S'),
                    'stop_reason': '', 'stop_event': stop_event, 'process': None,
                }
                thread = threading.Thread(target=_run_loop, args=(name,), daemon=True)
                task['thread'] = thread
                _tasks[name] = task
                thread.start()
                _save_tasks_locked()
            ctx.send_json({'ok': True, 'message': '任务 ' + name + ' 已启动', **_task_summary(task)})
            return

        if action == 'stop':
            if not name:
                ctx.send_error('缺少 name 参数')
                return
            with _tasks_lock:
                task = _tasks.get(name)
                if task is None:
                    ctx.send_error('任务 ' + name + ' 不存在')
                    return
                task['running'] = False
                task['stop_reason'] = 'manual stop'
                task['stop_event'].set()
                process = task.get('process')
                _save_tasks_locked()
            _stop_process(process)
            ctx.send_json({'ok': True, 'message': '任务 ' + name + ' 已停止', 'name': name})
            return

        if action == 'list':
            with _tasks_lock:
                tasks = [_task_summary(task) for task in _tasks.values()]
            ctx.send_json({'ok': True, 'tasks': tasks, 'max_active_tasks': MAX_ACTIVE_TASKS})
            return

        if action == 'status':
            if not name:
                ctx.send_error('缺少 name 参数')
                return
            with _tasks_lock:
                task = _tasks.get(name)
                if task is None:
                    ctx.send_error('任务 ' + name + ' 不存在')
                    return
                result = _task_summary(task, include_output=True)
            ctx.send_json({'ok': True, **result})
            return

        ctx.send_error('未知操作: ' + str(action))
    except (TypeError, ValueError) as exc:
        ctx.send_error('参数格式无效: ' + str(exc))
    except Exception as exc:
        ctx.send_error(str(exc))
