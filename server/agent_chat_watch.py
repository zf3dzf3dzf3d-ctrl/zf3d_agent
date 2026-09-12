#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
对话断流监控 - agent_chat_watch.py
由定时任务每 5 分钟调用一次，判断对话是否"断开"，断开则只重启后台服务器。

判定规则（满足其一即重启后台）：
  1. /api/health 不通或超时         → 服务器死亡/假死，立即重启
  2. 全部对话静默超过 --silence 秒  → 所有对话都不发送消息了，重启
     （默认 600 秒：正常长请求/代理超时约 330 秒，10 分钟全静默必为卡死）
  3. 最近 --stall-window 秒内 assistant 消息全部是"网络异常/已停止"类
     错误、且无任何工具调用与实质回复，且上一次检查（约 5 分钟前）也是如此
     → 持续错误循环、断开，重启

重启方式：调用项目自带的 restart_server.py --auto（自带互斥锁、60 秒限流、
死亡复活不受限流）。只杀后台 server.py 进程并重新拉起，前台浏览器页面
不动——前端自带断线重连与自动重试，后台就绪后对话即可继续正常发送。

用法:
    python agent_chat_watch.py                 # 检查并按需重启
    python agent_chat_watch.py --silence 600   # 自定义全静默阈值（秒）
    python agent_chat_watch.py --dry-run       # 只判断不重启
输出: 过程写 agent_chat_watch.log，最后一行以 RESULT: 开头供定时任务汇报。
"""
import os
import sys
import time
import json
import sqlite3
import argparse
import subprocess
import urllib.request

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_DIR = os.path.join(BASE_DIR, 'server')
DB_PATH = os.path.join(BASE_DIR, 'private', 'db', 'zf3d_canvas.db')
PORT_JSON = os.path.join(BASE_DIR, 'private', 'port.json')
RESTART_SCRIPT = os.path.join(SERVER_DIR, 'restart_server.py')
LOG_FILE = os.path.join(SERVER_DIR, 'agent_chat_watch.log')
STALL_FLAG = os.path.join(SERVER_DIR, '.chat_stall_flag')
STALL_FLAG_TTL = 15 * 60  # 上次"纯错误"标记的有效期（约 3 个检查周期）

# 这些关键词出现在 assistant 消息里视为"停滞/报错"而非实质进展
STALL_PATTERNS = ('网络异常', '请求超时', '已自动停止', '自动重试', '对话已停止')


def log(msg):
    line = '[%s] %s' % (time.strftime('%Y-%m-%d %H:%M:%S'), msg)
    print(line)
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass


def get_port():
    try:
        with open(PORT_JSON, 'r', encoding='utf-8-sig') as f:
            return int(json.load(f).get('api_port', 8505))
    except Exception:
        return 8505


def health_ok(port, timeout=5):
    try:
        with urllib.request.urlopen(
                'http://127.0.0.1:%d/api/health' % port, timeout=timeout) as r:
            data = json.loads(r.read().decode('utf-8'))
            return bool(data.get('ok')), data
    except Exception as e:
        return False, str(e)


def gate_active_count(port, timeout=5):
    """v4.5.1 查询闸门活跃票据数（运行中+排队中）。查询失败返回 -1（未知，不阻断判断）。"""
    try:
        with urllib.request.urlopen(
                'http://127.0.0.1:%d/api/gate/active' % port, timeout=timeout) as r:
            data = json.loads(r.read().decode('utf-8'))
        # v5.2.1 修复：顶层 active 是票据列表，改用 running + queue_len 计数
        return int(data.get('running') or 0) + int(data.get('queue_len') or 0)
    except Exception:
        return -1


def db_rows(sql, args=()):
    conn = sqlite3.connect('file:%s?mode=ro' % DB_PATH.replace('\\', '/'),
                           uri=True, timeout=3)
    try:
        conn.row_factory = sqlite3.Row
        return conn.execute(sql, args).fetchall()
    finally:
        conn.close()


def do_restart(reason, dry_run):
    log('❗ 判定断开，准备重启后台: %s' % reason)
    if dry_run:
        log('[dry-run] 跳过实际重启')
        return True
    try:
        r = subprocess.run(
            [sys.executable, RESTART_SCRIPT, '--auto'],
            cwd=SERVER_DIR, capture_output=True, timeout=240)
        tail = (r.stdout or b'').decode('utf-8', 'replace').strip().splitlines()[-6:]
        for ln in tail:
            log('  [restart] %s' % ln)
    except Exception as e:
        log('调用 restart_server.py 失败: %s' % e)
    # 无论脚本输出如何，以健康检查为准
    for _ in range(15):
        time.sleep(4)
        ok, info = health_ok(get_port())
        if ok:
            log('✅ 后台已重启并就绪')
            return True
    log('⚠️ 重启后健康检查仍未就绪')
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--silence', type=int, default=600,
                    help='全部对话无任何消息多少秒后判定停止(默认600)')
    ap.add_argument('--stall-window', type=int, default=360,
                    help='错误循环检测窗口秒数(默认360)')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    port = get_port()
    now_ms = int(time.time() * 1000)

    # ---- 规则1: 健康检查 ----
    ok, info = health_ok(port)
    if not ok:
        good = do_restart('服务器无响应: %s' % info, args.dry_run)
        print('RESULT: %s' % ('已重启后台(原因:服务器无响应)' if good
                              else '重启后仍未就绪，需人工介入'))
        return 0 if good else 3
    log('健康检查 OK: %s' % json.dumps(info, ensure_ascii=False))

    # ---- 读取最近消息 ----
    try:
        last = db_rows('SELECT MAX(created_at) m FROM chat_history')[0]['m']
    except Exception as e:
        log('数据库读取失败，本次跳过判断(不重启): %s' % e)
        print('RESULT: 数据库不可读，跳过本次判断(服务本身健康)')
        return 2
    if last is None:
        print('RESULT: 数据库暂无任何消息，跳过判断(服务本身健康)')
        return 0
    silence_sec = (now_ms - last) / 1000.0

    # ---- 规则2: 全部对话静默 ----
    if silence_sec > args.silence:
        # v4.5.1 修复误判：消息可能堵在闸门排队还没写入 chat_history，数据库看起来
        # 是"静默"，实际任务在排队/运行中。此时不重启，避免中断正在排队的任务。
        gate_n = gate_active_count(port)
        if gate_n > 0:
            log('⏸️ 全库静默 %.0f 秒，但闸门有 %d 张活跃票据(排队/运行中)，'
                '判定为排队未落库，跳过重启' % (silence_sec, gate_n))
            print('RESULT: 跳过重启 — 库面静默%.0f秒但闸门活跃票据%d张(排队/运行中)'
                  % (silence_sec, gate_n))
            return 0
        good = do_restart('所有对话已静默 %.0f 秒(阈值 %d 秒)'
                          % (silence_sec, args.silence), args.dry_run)
        try:
            os.remove(STALL_FLAG)
        except OSError:
            pass
        print('RESULT: %s' % ('已重启后台(原因:所有对话静默%.0f秒)' % silence_sec
                              if good else '重启后仍未就绪，需人工介入'))
        return 0 if good else 3

    # ---- 规则3: 持续错误循环(断开) ----
    try:
        rows = db_rows(
            'SELECT role, content FROM chat_history WHERE created_at > ?',
            (now_ms - args.stall_window * 1000,))
    except Exception as e:
        log('窗口消息读取失败，跳过规则3: %s' % e)
        rows = []
    stall_msgs, meaningful, tool_rows = [], 0, 0
    for r in rows:
        role, content = r['role'], (r['content'] or '')
        if role in ('tool_call', 'tool'):
            tool_rows += 1
        elif role == 'error':
            stall_msgs.append(content[:60])
        elif role == 'assistant':
            if any(p in content for p in STALL_PATTERNS):
                stall_msgs.append(content[:60])
            else:
                meaningful += 1
    stall_only = len(stall_msgs) >= 2 and meaningful == 0 and tool_rows == 0

    if stall_only:
        prev = False
        try:
            if time.time() - os.path.getmtime(STALL_FLAG) < STALL_FLAG_TTL:
                prev = True
        except OSError:
            pass
        if prev:
            good = do_restart('连续两次检查均为纯错误循环(%d条停滞消息/0实质进展/0工具调用)，判定断开'
                              % len(stall_msgs), args.dry_run)
            try:
                os.remove(STALL_FLAG)
            except OSError:
                pass
            print('RESULT: %s' % ('已重启后台(原因:对话持续报错无进展)' if good
                                  else '重启后仍未就绪，需人工介入'))
            return 0 if good else 3
        with open(STALL_FLAG, 'w', encoding='utf-8') as f:
            f.write(str(time.time()))
        log('⚠️ 本轮为纯错误循环(%d条)，已标记；若下轮(约5分钟后)仍如此则重启后台'
            % len(stall_msgs))
        print('RESULT: 对话出现持续报错无进展(已标记一次，下轮确认)')
        return 0

    # ---- 一切正常 ----
    try:
        if os.path.exists(STALL_FLAG):
            os.remove(STALL_FLAG)
    except OSError:
        pass
    log('✅ 对话活跃: 全库最后消息 %.0f 秒前; 最近 %d 秒窗口: 实质回复%d条/工具调用%d条/停滞报错%d条'
        % (silence_sec, args.stall_window, meaningful, tool_rows, len(stall_msgs)))
    print('RESULT: 正常 — 服务健康，对话持续发送中(最后消息%.0f秒前，窗口内实质回复%d/工具%d)'
          % (silence_sec, meaningful, tool_rows))
    return 0


if __name__ == '__main__':
    sys.exit(main())

