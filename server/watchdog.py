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
        import config
        return int(config.PORT)
    except Exception:
        return 8766

PORT = _get_port()
SERVER_URL = 'http://127.0.0.1:%d' % PORT
LOG_FILE = os.path.join(BASE_DIR, 'server', '.watchdog.log')
PID_FILE = os.path.join(BASE_DIR, 'server', '.server.pid')
CRASH_FLAG = os.path.join(BASE_DIR, 'server', '.crash_report.json')

# 崩溃通知发到哪个对话窗口（优先读环境变量 WATCHDOG_NOTIFY_SESSION，默认 cb132）
NOTIFY_SESSION = os.environ.get('WATCHDOG_NOTIFY_SESSION', 'cb132')

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
        with open(LOG_FILE, 'r', encoding='utf-8') as f:
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
        "请根据以上信息分析：\n"
        "1. 服务器崩溃的可能原因\n"
        "2. 是否是内存/端口/文件锁等问题\n"
        "3. 建议的预防措施"
    )

    try:
        data = json.dumps({
            'role': 'user',
            'content': msg,
            'modelId': ''
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

def check_server():
    """检查服务器健康状态"""
    try:
        req = urllib.request.Request(f'{SERVER_URL}/api/health', method='GET')
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return True, data
    except urllib.error.URLError:
        return False, {'error': '服务器无响应 (URLError)'}
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
        proc = subprocess.Popen(
            [sys.executable, 'server.py'],
            cwd=SERVER_DIR,
            creationflags=subprocess.CREATE_NEW_CONSOLE if sys.platform == 'win32' else 0
        )
        # 记录 PID
        with open(PID_FILE, 'w') as f:
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

def main():
    log('--- watchdog 开始巡检 ---')
    
    # 1. 检查服务器
    ok, info = check_server()
    if ok:
        log(f'[WATCHDOG] ✅ 服务器正常: {info}')
        
        # 服务器正常时，检查是否有未处理的崩溃报告
        if os.path.exists(CRASH_FLAG):
            try:
                with open(CRASH_FLAG, 'r', encoding='utf-8') as f:
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
