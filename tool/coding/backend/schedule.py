#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""schedule - Run shell commands at a controlled interval."""

import subprocess
import threading
import time

from tool.coding.backend.base import ToolContext

TOOL_NAME = 'schedule'
MAX_ACTIVE_TASKS = 10
MIN_INTERVAL_SECONDS = 0.5
MAX_INTERVAL_SECONDS = 86400
DEFAULT_COMMAND_TIMEOUT = 300
MAX_COMMAND_TIMEOUT = 3600
_tasks = {}
_tasks_lock = threading.Lock()


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
