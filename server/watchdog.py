#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
对话消息守护脚本 - watchdog
功能：
  1. 检测服务器 (127.0.0.1:8766) 是否存活，挂了自动重启
  2. 检测对话窗口状态，记录日志
  3. 崩溃后自动收集上下文，通过 API 向对话窗口发送分析请求，让大模型分析原因
  4. 服务器重启后自动备份日志

用法: python watchdog.py
由 schedule 定时调用
"""
import os
import sys
import json
import time
import subprocess
import urllib.request
import urllib.error
import sqlite3
import platform
import traceback

# ===== 配置 =====
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_DIR = os.path.join(BASE_DIR, 'server')
DB_PATH = os.path.join(BASE_DIR, 'private', 'db', 'zf3d_canvas.db')
def _get_port():
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import config
        return int(config.PORT)
    except Exception:
        pass
    # 兜底：直接读 private/port.json
    try:
        pj = os.path.join(BASE_DIR, 'private', 'port.json')
        with open(pj, 'r', encoding='utf-8-sig') as f:
            return int(json.load(f).get('api_port'))
    except Exception:
        return 8505

PORT = _get_port()
SERVER_URL = 'http://127.0.0.1:%d' % PORT
LOG_FILE = os.path.join(BASE_DIR, 'server', '.watchdog.log')
PID_FILE = os.path.join(BASE_DIR, 'server', '.server.pid')
CRASH_FLAG = os.path.join(BASE_DIR, 'server', '.crash_report.json')

# 崩溃通知发到哪个对话窗口（优先读环境变量 WATCHDOG_NOTIFY_SESSION，默认 cb132）
NOTIFY_SESSION = os.environ.get('WATCHDOG_NOTIFY_SESSION', 'cb132')

# v4.5.1 忙时免打扰：闸门有活跃票据（排队/运行）时不注入通知，避免插队打扰正常任务
def gate_busy(timeout=3):
    """查询 /api/gate/active，返回 (是否忙碌, 活跃票据数)。查询失败按不忙处理。"""
    try:
        req = urllib.request.Request(SERVER_URL + '/api/gate/active', method='GET')
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        # v5.2.1 修复：/api/gate/active 的顶层 active 是票据列表（chat_gate.active_snapshot 'active': out），
        # 不能 int()；忙碌数 = running + queue_len
        n = int(data.get('running') or 0) + int(data.get('queue_len') or 0)
        return n > 0, n
    except Exception as e:
        log('[WATCHDOG] 查询闸门状态失败(按空闲处理): %s' % e)
        return False, 0

# v5.2 工具停滞检测阈值（秒）：running 超过该时长视为工具长期停滞
STALL_SECONDS = int(os.environ.get('WATCHDOG_STALL_SECONDS', '1800'))  # 默认 30 分钟
STALL_SEEN_FILE = os.path.join(BASE_DIR, 'server', '.watchdog_stall_seen.json')

MAX_LOG_SIZE = 512 * 1024  # 日志文件最大 512KB，超过自动轮转

def log(msg):
    """写日志（自动轮转）"""
    ts = time.strftime('%Y-%m-%d %H:%M:%S')
    line = f'[{ts}] {msg}'
    print(line)
    try:
        # 日志轮转
        if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) > MAX_LOG_SIZE:
            old = LOG_FILE + '.old'
            if os.path.exists(old):
                os.remove(old)
            os.rename(LOG_FILE, old)
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass

def read_recent_logs(n=30):
    """读取最近的 watchdog 日志"""
    try:
        if not os.path.exists(LOG_FILE):
            return '(无日志文件)'
        with open(LOG_FILE, 'r', encoding='utf-8-sig') as f:
            lines = f.readlines()
        return ''.join(lines[-n:]) if lines else '(空日志)'
    except Exception as e:
        return f'(读取日志失败: {e})'

def read_recent_chat_errors(n=10):
    """从数据库读取最近的错误/异常消息"""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        # 查最近的消息，看有没有 error/exception 关键词
        cur.execute(
            'SELECT session_id, role, content, created_at '
            'FROM chat_history ORDER BY created_at DESC LIMIT ?'
        , (n,))
        rows = cur.fetchall()
        conn.close()
        result = []
        for r in rows:
            content = r['content'] or ''
            ts = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(r['created_at']))
            # 截取前200字符
            snippet = content[:200] + ('...' if len(content) > 200 else '')
            result.append(f"  [{ts}] {r['session_id']}/{r['role']}: {snippet}")
        return '\n'.join(result) if result else '(无最近消息)'
    except Exception as e:
        return f'(读取数据库失败: {e})'

def collect_crash_context(error_info):
    """收集崩溃时的上下文信息"""
    ctx = {
        'crash_time': time.strftime('%Y-%m-%d %H:%M:%S'),
        'error': error_info,
        'platform': platform.platform(),
        'python': sys.version.split()[0],
        'recent_logs': read_recent_logs(30),
        'recent_chat': read_recent_chat_errors(15),
        'stdout_tail': tail_file(STDOUT_LOG),
    }
    return ctx

def save_crash_report(ctx):
    """保存崩溃报告到文件"""
    try:
        with open(CRASH_FLAG, 'w', encoding='utf-8') as f:
            json.dump(ctx, f, ensure_ascii=False, indent=2)
        log(f'[WATCHDOG] 💾 崩溃报告已保存: {CRASH_FLAG}')
    except Exception as e:
        log(f'[WATCHDOG] 保存崩溃报告失败: {e}')

def notify_ai(crash_ctx):
    """通过 API 向对话窗口发送崩溃分析请求，让大模型分析原因"""
    # 构造分析请求消息
    msg = (
        "🔔 【服务器崩溃自动报告】\n\n"
        "watchdog 检测到服务器异常并已自动重启，请分析可能的崩溃原因：\n\n"
        f"⏰ 崩溃时间: {crash_ctx['crash_time']}\n"
        f"❌ 错误信息: {crash_ctx['error']}\n"
        f"💻 系统环境: {crash_ctx['platform']}, Python {crash_ctx['python']}\n\n"
        "📋 最近 watchdog 日志:\n"
        f"```\n{crash_ctx['recent_logs']}\n```\n\n"
        "📋 最近对话消息:\n"
        f"```\n{crash_ctx['recent_chat']}\n```\n\n"
        "📋 崩溃前 server_stdout.log 尾部:\n"
        f"```\n{crash_ctx.get('stdout_tail', '(无)')}\n```\n\n"
        "请根据以上信息分析：\n"
        "1. 服务器崩溃的可能原因\n"
        "2. 是否是内存/端口/文件锁等问题\n"
        "3. 建议的预防措施"
    )

    # v4.5.1 忙时免打扰：闸门有活跃票据时不打扰，报告保留到下轮巡检再试
    busy, n_active = gate_busy()
    if busy:
        log('[WATCHDOG] 🔕 闸门繁忙(活跃票据 %d 张)，暂不注入崩溃通知，'
            '报告保留待下轮巡检' % n_active)
        return False

    try:
        data = json.dumps({
            'role': 'user',
            'content': msg,
            'modelId': '',
            'source': 'watchdog'   # 标记来源，便于前端/闸门识别守卫消息
        }, ensure_ascii=False).encode('utf-8')

        req = urllib.request.Request(
            f'{SERVER_URL}/api/db/chat/{NOTIFY_SESSION}',
            data=data,
            method='POST'
        )
        req.add_header('Content-Type', 'application/json; charset=utf-8')

        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            if result.get('ok'):
                log(f'[WATCHDOG] 🤖 已向 {NOTIFY_SESSION} 发送崩溃分析请求，消息ID={result.get("id")}')
                return True
            else:
                log(f'[WATCHDOG] ⚠️ 发送分析请求返回异常: {result}')
                return False
    except Exception as e:
        log(f'[WATCHDOG] ⚠️ 发送崩溃分析请求失败: {e}')
        return False

def tail_file(path, max_bytes=8000, max_lines=40):
    """读取文件尾部若干行（抓取崩溃前的 stdout traceback）"""
    try:
        if not os.path.exists(path):
            return '(文件不存在: %s)' % path
        size = os.path.getsize(path)
        with open(path, 'rb') as f:
            if size > max_bytes:
                f.seek(size - max_bytes)
            data = f.read()
        text = data.decode('utf-8', errors='replace')
        lines = text.strip().splitlines()
        return '\n'.join(lines[-max_lines:])
    except Exception as e:
        return '(读取失败: %s)' % e

STDOUT_LOG = os.path.join(SERVER_DIR, 'server_stdout.log')

def check_server():
    """检查服务器健康状态"""
    try:
        req = urllib.request.Request(f'{SERVER_URL}/api/health', method='GET')
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return True, data
    except urllib.error.HTTPError as e:
        return False, {'error': '健康检查返回 HTTP %d' % e.code}
    except urllib.error.URLError as e:
        reason = getattr(e, 'reason', None)
        if reason and '10061' in str(reason):
            return False, {'error': '端口无监听，服务器进程已退出 (WinError 10061)'}
        return False, {'error': '服务器无响应 (URLError: %s)' % reason}
    except Exception as e:
        return False, {'error': str(e)}

def get_chat_windows():
    """从数据库获取所有对话窗口及消息数"""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            'SELECT session_id, COUNT(*) as msg_count, '
            'MAX(created_at) as last_time '
            'FROM chat_history GROUP BY session_id ORDER BY last_time DESC'
        )
        rows = cur.fetchall()
        conn.close()
        return [{
            'id': r['session_id'],
            'messages': r['msg_count'],
            'last_time': r['last_time']
        } for r in rows]
    except Exception as e:
        log(f'[WATCHDOG] 读取数据库失败: {e}')
        return []

def start_server():
    """启动服务器"""
    log('[WATCHDOG] 正在重启服务器...')
    try:
        # 用 subprocess 启动，不阻塞
        # v4.5.2 增强：stdout/stderr 落到 server_stdout.log（追加），崩溃 traceback 可回溯
        out_log = open(STDOUT_LOG, 'ab')
        proc = subprocess.Popen(
            [sys.executable, 'server.py'],
            cwd=SERVER_DIR,
            stdout=out_log,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
        )
        # 记录 PID
        with open(PID_FILE, 'w', encoding='utf-8') as f:
            f.write(str(proc.pid))
        log(f'[WATCHDOG] 服务器已启动，PID={proc.pid}')
        
        # 等待服务器就绪
        for i in range(10):
            time.sleep(2)
            ok, _ = check_server()
            if ok:
                log(f'[WATCHDOG] 服务器已就绪（等待 {i*2+2} 秒）')
                return True
        log('[WATCHDOG] ⚠️ 服务器启动超时，可能仍有问题')
        return False
    except Exception as e:
        log(f'[WATCHDOG] ❌ 启动服务器失败: {e}')
        traceback.print_exc()
        return False

def _load_stall_seen():
    """读取已通知过的停滞票据记录（去重，防止每轮巡检重复注入）"""
    try:
        with open(STALL_SEEN_FILE, 'r', encoding='utf-8-sig') as f:
            return json.load(f)
    except Exception:
        return {}

def _save_stall_seen(seen):
    try:
        with open(STALL_SEEN_FILE, 'w', encoding='utf-8') as f:
            json.dump(seen, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

# v5.2 工具停滞检测（用户定规矩）：
#   只有「真正在运行（闸门 state=running）但工具长期停滞」的票据才允许守卫开启；
#   用户主动停止的对话，票据已从闸门消失，天然不会被检测到，守卫无权开启。
def check_tool_stall(timeout=5):
    """检查闸门中是否有 running 超过 STALL_SECONDS 的停滞票据。
    返回 (是否发现停滞, 停滞票据列表)。查询失败按未发现处理。"""
    try:
        req = urllib.request.Request(SERVER_URL + '/api/gate/active', method='GET')
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        log('[WATCHDOG] 查询闸门活跃票据失败(按无停滞处理): %s' % e)
        return False, []
    now = time.time()
    stalled = []
    for t in (data.get('active') or []):
        if t.get('state') != 'running':
            continue
        run_now = t.get('run_now')
        if run_now is None and t.get('started'):
            run_now = now - float(t['started'])
        if run_now is not None and float(run_now) >= STALL_SECONDS:
            stalled.append(t)
    return bool(stalled), stalled

def notify_stall(stalled):
    """向对话窗口注入工具停滞提醒（每张票据只通知一次，用 seen 记录去重）"""
    seen = _load_stall_seen()
    fresh = [t for t in stalled if str(t.get('ticket')) not in seen]
    if not fresh:
        return False
    lines = []
    for t in fresh:
        run = t.get('run_now') or 0
        lines.append("- 票据 %s（车道 %s, 模型 %s）已运行 %.0f 秒（%.1f 分钟）无进展"
                     % (t.get('ticket'), t.get('lane'), t.get('provider'), run, run / 60.0))
        seen[str(t.get('ticket'))] = time.strftime('%Y-%m-%d %H:%M:%S')
    msg = (
        "🐕 【小狗守卫·工具停滞提醒】\n\n"
        "检测到以下任务「真实运行中」但长期无工具进展，可能卡死，请检查处理：\n"
        + "\n".join(lines) +
        "\n\n说明：本提醒只针对闸门中 state=running 的真实任务；"
        "用户主动停止的对话不会被守卫开启。\n"
        "建议：确认票据是否真的卡死（可查 /api/gate/active 或面板），"
        "必要时对该票据做重启/放弃处理，不要盲目重开已停止的对话。"
    )
    try:
        data = json.dumps({
            'role': 'user',
            'content': msg,
            'modelId': '',
            'source': 'watchdog'
        }, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(
            f'{SERVER_URL}/api/db/chat/{NOTIFY_SESSION}',
            data=data, method='POST')
        req.add_header('Content-Type', 'application/json; charset=utf-8')
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode('utf-8'))
        if result.get('ok'):
            _save_stall_seen(seen)
            log('[WATCHDOG] 🐕 已注入工具停滞提醒 %d 条（票据: %s）'
                % (len(fresh), ','.join(str(t.get('ticket')) for t in fresh)))
            return True
        return False
    except Exception as e:
        log('[WATCHDOG] ⚠️ 注入停滞提醒失败: %s' % e)
        return False


def main():
    log('--- watchdog 开始巡检 ---')
    
    # 1. 检查服务器
    ok, info = check_server()
    if ok:
        log(f'[WATCHDOG] ✅ 服务器正常: {info}')
        # v5.2 工具停滞检测：闸门中真实 running 但超时的票据才提醒（去重）
        try:
            _stalled_flag, _stalled_list = check_tool_stall()
            if _stalled_flag:
                notify_stall(_stalled_list)
        except Exception as _e:
            log('[WATCHDOG] 工具停滞检测异常: %s' % _e)
        
        # 服务器正常时，检查是否有未处理的崩溃报告
        if os.path.exists(CRASH_FLAG):
            try:
                with open(CRASH_FLAG, 'r', encoding='utf-8-sig') as f:
                    crash_ctx = json.load(f)
                log('[WATCHDOG] 📨 发现有未处理的崩溃报告，正在通知大模型分析...')
                if notify_ai(crash_ctx):
                    # 分析请求发送成功，删除崩溃报告
                    os.remove(CRASH_FLAG)
                    log('[WATCHDOG] ✅ 崩溃分析请求已发送，崩溃报告已清除')
                else:
                    log('[WATCHDOG] ⚠️ 崩溃分析请求发送失败，下次重试')
            except Exception as e:
                log(f'[WATCHDOG] 处理崩溃报告失败: {e}')
                # 报告损坏，删除
                try:
                    os.remove(CRASH_FLAG)
                except Exception:
                    pass
    else:
        error_msg = info.get('error', '未知')
        log(f'[WATCHDOG] ❌ 服务器异常: {error_msg}')
        
        # 收集崩溃上下文并保存
        crash_ctx = collect_crash_context(error_msg)
        save_crash_report(crash_ctx)
        
        # 重启服务器
        if start_server():
            # 重启成功后，尝试立即通知大模型分析
            log('[WATCHDOG] 🤖 尝试通知大模型分析崩溃原因...')
            notify_ai(crash_ctx)
            # 如果通知成功，删除崩溃报告；否则保留供下次重试
            # （notify_ai 内部会记录结果，这里不删除，让下次巡检确认）
            # 检查是否发送成功（通过日志无法确认，保留文件让下次巡检验证）
            pass
        else:
            log('[WATCHDOG] ❌ 服务器重启失败，崩溃报告已保存等待下次重试')
    
    # 2. 检查对话窗口
    windows = get_chat_windows()
    if windows:
        summary = ', '.join([f"{w['id']}({w['messages']}条)" for w in windows])
        log(f'[WATCHDOG] 📋 对话窗口: {summary}')
    else:
        log('[WATCHDOG] 📋 无对话窗口或数据库不可用')
    
    log('--- watchdog 巡检完成 ---\n')

if __name__ == '__main__':
    main()

