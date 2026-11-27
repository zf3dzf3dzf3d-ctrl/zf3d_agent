#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""schedule - Run shell commands at a controlled interval."""

import json
import os
import subprocess
import threading
import time


TOOL_NAME = 'schedule'
MAX_ACTIVE_TASKS = 10
MIN_INTERVAL_SECONDS = 0.5
MAX_INTERVAL_SECONDS = 86400
DEFAULT_COMMAND_TIMEOUT = 300
MAX_COMMAND_TIMEOUT = 3600
# 【W3 持久化 2026-10-30】任务定义落盘 server/data/schedules.json，重启后回载。
# 【auto_start 2026-11-25 bravo 修复死机缺口】带 auto_start=true 的任务重启后自动续跑；
#   手动 stop 视为用户意图，清除 auto_start（重启后不再复活）。
PERSIST_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))), 'server', 'data', 'schedules.json')
_PERSIST_FIELDS = ('name', 'code', 'interval', 'command_timeout', 'max_times',
                   'stop_on_success', 'stop_on_output', 'times_executed',
                   'last_exit_code', 'last_executed_at', 'started_at', 'auto_start')

# 【2026-11-25 bravo 修复】任务命令统一在项目根目录执行：
# server 进程重启后 cwd 可能漂移（01:15 重启后漂离项目根，相对路径命令全部
# "系统找不到指定的路径" exit 1）。显式锚定 cwd=项目根，任务命令写相对路径即稳。
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
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
    """模块加载时回载历史任务定义。

    【2026-11-25 bravo 修复】原版重启后全部 running=False（persisted, not auto-started），
    导致昨晚建立的「永不停止」基础设施（evolution_heartbeat / watchdog_keeper 等）
    重启即瘫痪、看门狗心跳停摆（用户体感死机）。现补 auto_start 标记：
    带标记的任务重启后自动拉起（跳过首轮 sleep 立即跑一次，恢复心跳不过夜）；
    手动 stop 清除标记（用户意图优先，不会"杀不死"）。
    """
    try:
        with open(PERSIST_PATH, 'r', encoding='utf-8') as f:
            snapshot = json.load(f)
        to_autostart = []
        for item in snapshot or []:
            name = item.get('name')
            if not name or name in _tasks:
                continue
            auto_start = bool(item.get('auto_start', False))
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
                'auto_start': auto_start,
                'stop_reason': 'server restarted (persisted, not auto-started)',
                'stop_event': threading.Event(), 'process': None, 'thread': None,
            }
            if auto_start:
                to_autostart.append(name)
        for name in to_autostart:
            task = _tasks.get(name)
            if task is None:
                continue
            running_count = sum(1 for t in _tasks.values() if t.get('running'))
            if running_count >= MAX_ACTIVE_TASKS:
                task['stop_reason'] = 'server restarted (auto_start deferred: task limit)'
                continue
            task['running'] = True
            task['started_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
            task['stop_reason'] = ''
            task['stop_event'] = threading.Event()
            task['gen'] = int(task.get('gen', 0)) + 1  # 【2026-11-25 alpha】代数：每次(重)启动+1，旧线程凭过期代数自杀，防新旧互杀
            thread = threading.Thread(target=_run_loop, args=(name, task['gen']), daemon=True)
            task['thread'] = thread
            try:
                thread.start()  # _run_loop 首轮立即执行（无 sleep 前置），心跳即时恢复
            except Exception:
                # 【2026-11-25 charlie 补】thread.start() 失败禁止留下 running=True 假活：
                # 05:11 重启实证：start 抛异常被本函数外层 except 吞掉，
                # evolution_watchdog_keeper 声明假活（标记在、零执行）10 分钟无人发现。
                # 回滚 running 标记保证「状态=线程」一致；auto_start 保留，下次重启再试。
                task['running'] = False
                task['stop_reason'] = 'auto_start 失败：thread.start() 异常（标记已回滚，不假活）'
                task['gen'] = max(0, int(task.get('gen', 1)) - 1)
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
            cwd=PROJECT_ROOT,
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


def _run_loop(name, gen=0):
    while True:
        with _tasks_lock:
            task = _tasks.get(name)
            if task is None or not task['running']:
                return
            # 【2026-11-25 alpha】代数校验：本线程代数≠任务当前代数=被新一代顶替，自杀退出。
            # 防御两类假活并存：①重启窗口期旧线程醒来发现任务被重建；②手动 start 覆盖时
            # 旧线程还在 sleep(interval)，stop_event.set() 后旧线程若仍卡执行中，靠 gen 失配退出。
            if int(task.get('gen', 0)) != gen:
                task['stop_reason'] = '代数失配退出(gen=%s≠%s，被新一代顶替)' % (gen, task.get('gen'))
                return
            code = task['code']
            command_timeout = task['command_timeout']
            stop_event = task['stop_event']

        output, exit_code, stop_reason = _run_command(
            name, code, command_timeout, stop_event
        )

        with _tasks_lock:
            task = _tasks.get(name)
            if task is None or int(task.get('gen', 0)) != gen:
                # 【2026-11-25 alpha】代数失配=本线程已被 restart/stop 顶替：禁止触碰新一代
                # 任务状态。实测 bug：restart 后旧线程曾把 running=False/'manual stop' 写回
                # 新一代任务并存盘，造成「线程活着但磁盘假死」的持久化污染。
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
                if task is not None and int(task.get('gen', 0)) == gen:
                    task['running'] = False
                    task['stop_reason'] = 'manual stop'
                # 【2026-11-25 alpha】gen 失配（被新一代顶替）时静默退出，
                # 不污染新一代任务状态（同上，实测 restart 污染 bug 的另一半）
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
                    # 【2026-11-25 charlie 补】假活检测：标记 running=True 但线程不存在/已死
                    # （重启初期 thread.start() 失败留下的残迹，实证 05:11 keeper 假活 10 分钟）。
                    # 回收假活标记放行重启，代替误导性的「已在运行中」拒绝。
                    t_alive = existing.get('thread')
                    if t_alive is None or not t_alive.is_alive():
                        existing['running'] = False
                        existing['stop_reason'] = '检测到假活(running标记在但线程已死)，已自动回收并重启'
                    else:
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
                    'auto_start': bool(body.get('auto_start', False)),
                    'times_executed': 0, 'last_output': '', 'last_exit_code': None,
                    'last_executed_at': '', 'started_at': time.strftime('%Y-%m-%d %H:%M:%S'),
                    'stop_reason': '', 'stop_event': stop_event, 'process': None,
                }
                # 【2026-11-25 alpha】手动 start 覆盖旧任务前，先给旧线程升代数引爆
                # （旧 _run_loop 醒来发现 gen 不匹配即自杀，防新旧线程并存互踩 last_output/times）
                old = existing  # existing 在上方假活检测分支里可能已被回收标记，但线程对象仍要引爆
                if old is not None:
                    old['gen'] = int(old.get('gen', 0)) + 1000  # 远超新代数，旧线程醒来即退
                    ev_old = old.get('stop_event')
                    if ev_old is not None:
                        ev_old.set()  # 唤醒 sleep 中的旧线程让它尽快看到新代数
                task['gen'] = 1
                thread = threading.Thread(target=_run_loop, args=(name, 1), daemon=True)
                task['thread'] = thread
                _tasks[name] = task
                thread.start()
                _save_tasks_locked()
            ctx.send_json({'ok': True, 'message': '任务 ' + name + ' 已启动', **_task_summary(task)})
            return

        if action == 'restart':
            # 【2026-11-25 alpha】restart = 假活克星：先停后启，复用磁盘上的持久化配置。
            # 针对 07:55 实锤的「autostart 线程创建成功却卡死不执行」假活——该状态下
            # running=True 且线程 is_alive()，手动 start 被「已在运行中」拒绝（08:06 实撞），
            # 唯一出路是完整 stop(保留 auto_start) + start(按磁盘配置重建线程)。
            # 与手动 stop 的语义差：restart 不清 auto_start（用户意图是修不是杀）。
            if not name:
                ctx.send_error('缺少 name 参数')
                return
            with _tasks_lock:
                task = _tasks.get(name)
                if task is None:
                    ctx.send_error('任务 ' + name + ' 不存在（restart 需已有持久化配置）')
                    return
                task['gen'] = int(task.get('gen', 0)) + 1      # 升代数引爆旧线程
                ev = task.get('stop_event')
                if ev is not None:
                    ev.set()                                     # 唤醒 sleep 中的旧线程
                task['running'] = False                          # 让旧线程醒来即退（gen 已失配）
                task['stop_reason'] = 'restart: 旧线程已引爆'
                process = task.get('process')
                saved = {
                    'code': task['code'], 'interval': task['interval'],
                    'command_timeout': task['command_timeout'],
                    'max_times': task['max_times'],
                    'stop_on_success': task['stop_on_success'],
                    'stop_on_output': task['stop_on_output'],
                    'auto_start': bool(task.get('auto_start', False)),
                }
                _save_tasks_locked()
            _stop_process(process)  # 锁外杀子进程，防持锁阻塞
            # ── start 段：复用 saved 配置重建线程（与 start 分支同构，gen 续增防撞号）──
            with _tasks_lock:
                task = _tasks.get(name)
                if task is None:
                    ctx.send_error('任务 ' + name + ' 在 restart 中途丢失')
                    return
                if sum(1 for t in _tasks.values() if t['running']) >= MAX_ACTIVE_TASKS:
                    ctx.send_error(f'运行中的任务已达到上限 ({MAX_ACTIVE_TASKS})')
                    return
                task.update(saved)
                task['running'] = True
                task['started_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
                task['stop_reason'] = ''
                task['stop_event'] = threading.Event()
                task['gen'] = int(task.get('gen', 0)) + 1
                thread = threading.Thread(target=_run_loop, args=(name, task['gen']), daemon=True)
                task['thread'] = thread
                try:
                    thread.start()
                    _save_tasks_locked()
                except Exception:
                    task['running'] = False
                    task['stop_reason'] = 'restart 失败：thread.start() 异常（标记已回滚）'
                    task['gen'] = max(0, int(task.get('gen', 1)) - 1)
            ctx.send_json({'ok': True, 'message': '任务 ' + name + ' 已重启（代数=%s）' % task.get('gen'),
                           **_task_summary(task)})
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
                # 手动 stop 视为用户意图：清除 auto_start，重启后不再复活
                task['auto_start'] = False
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
