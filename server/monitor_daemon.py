# -*- coding: utf-8 -*-
"""
monitor_daemon — 队列消费哨兵（B方案·后台为脑前台为眼）2026-11-25
职责（严格最小化）：
  1. 心跳哨兵：前端 _monitorPoll 每轮 tick 时写 monitor_heartbeat 哨兵（daemon 不碰队列）。
  2. 心跳断供（前端全部离场）才由 daemon 开无头页接管全量消费——无头页跑真实前端
     （App._monitorPoll 原样执行），不重写 AI 循环；前端回场后 daemon 退出接管、回到眼模式。
  3. 账本：接管/退出/错误写 app_logs(category='monitor_daemon')，可观测。
锁审计（铁律4）：本模块不新建任何 lock/acquire/Condition；DB 访问全部经 cfg._db_lock
  （ThreadPool 线程本地连接，见 db.get_db）。与 mixin_static._handle_monitor_poll 无新竞争：
  daemon 只读写哨兵键 + 前端离场时才消费，前端在线期 daemon 零队列操作。
启动点：db.init_db() 末尾 monitor_daemon.start()（同 employee_scheduler 模板）。
"""
import json
import time
import threading
import traceback

import config as cfg
import db as db_mod
from util_log import get_logger

log = get_logger('monitor_daemon')

_started = False
_taking_over = False          # 是否处于接管态
_takeover_thread = None       # 无头页驱动线程
_last_takeover_end = 0        # 退出接管的时刻（防抖：退出后至少冷静 30s）

HEARTBEAT_KEY = 'monitor_heartbeat'
HEARTBEAT_CATEGORY = 'monitor_state'
HEARTBEAT_STALE_MS = 35000    # 前端 tick 4s×10 容忍；超时视为前端全离场
COOLDOWN_MS = 30000           # 退出接管后的冷静期
CHECK_INTERVAL = 4.0          # 哨兵扫描周期（秒）
MAX_TAKEOVER_MS = 3600000     # 单次接管硬上限 1h（防无头页僵死长期占位）

# 内存心跳哨兵：由 mixin_static._handle_monitor_poll 每次被前端真实 poll 时 touch。
# 语义：真 poll = 真消费力（document.hidden/窗口全关的页不会 poll，天然停跳）。
# server 刚启动时为 0 → 保守按「前端存活」处理，不接管。
_LAST_POLL_TS = 0


def touch():
    """mixin_static poll handler 调用：记录最近一次真实前端 poll 时刻。"""
    global _LAST_POLL_TS
    _LAST_POLL_TS = _now_ms()

def _db_exec(sql, params=(), write=False):
    """DB 访问统一走 cfg._db_lock（与 mixin_static.poll 同一把锁，锁审计通过）。"""
    conn = None
    try:
        with cfg._db_lock:
            conn = db_mod.get_db()
            try:
                conn.execute("PRAGMA busy_timeout=3000")
            except Exception:
                pass
            cur = conn.cursor()
            cur.execute(sql, params)
            rows = cur.fetchall() if not write else None
            if write:
                conn.commit()
            return rows
    except Exception as e:
        log.info('[daemon-db] %s' % e)
        return [] if not write else False
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def _now_ms():
    return int(time.time() * 1000)


_BOOT_TS = _now_ms()          # server 启动时刻
BOOT_GRACE_MS = 90000         # 启动宽限：90s 内没见过任何 poll 也视为「前端可能在路上」


def _heartbeat_alive():
    """前端存活 = 最近 35s 内有过真实 poll（由 mixin_static touch；无头页 poll 带 daemon=1 不计）。
    启动宽限期内（没见过 poll 但刚启动）按存活处理；宽限期后 ts=0 = 前端从未上线 → 离场。
    异常一律按存活——故障偏向保守不接管。"""
    try:
        if _LAST_POLL_TS == 0:
            return (_now_ms() - _BOOT_TS) < BOOT_GRACE_MS
        return (_now_ms() - _LAST_POLL_TS) < HEARTBEAT_STALE_MS
    except Exception:
        return True


def _queue_backlog():
    """队列积压量（前端离场时评估是否值得接管）。"""
    rows = _db_exec(
        "SELECT COUNT(*) AS n FROM app_data WHERE category='monitor_queue'")
    if rows is False or not rows:
        return 0
    try:
        return int(rows[0]['n'])
    except Exception:
        return 0


def _log_event(action, detail=''):
    """账本：接管/退出/错误写 app_logs，画布日志页可见。"""
    try:
        _db_exec(
            "INSERT INTO app_logs (ts, level, box_id, action, detail) "
            "VALUES (?, 'info', 'monitor_daemon', ?, ?)",
            (_now_ms(), action, detail[:500]), write=True)
    except Exception:
        pass


def _build_fetch_rewrite_js():
    """无头页 init 脚本：给所有 poll 请求追加 daemon=1 标记——
    mixin_static 见此标记不 touch 心跳，避免无头页自己把自己「救活」造成接管抖动。"""
    return r"""
(function () {
  if (window.__daemonFetchRewired) return;
  window.__daemonFetchRewired = true;
  var _of = window.fetch;
  window.fetch = function (input, init) {
    try {
      var u = typeof input === 'string' ? input : (input && input.url) || '';
      if (u.indexOf('/api/monitor/poll') !== -1) {
        var sep = u.indexOf('?') === -1 ? '?' : '&';
        input = u + sep + 'daemon=1';
      }
    } catch (e) {}
    return _of.call(this, input, init);
  };
})()
"""


def _build_injection_js():
    """无头页注入脚本：把工作台前端原样拉起 + 哨兵点名（防正式页被误接管）。"""
    return r"""
(function () {
  if (window.__daemonTakeover) return 'already';
  window.__daemonTakeover = true;
  try { localStorage.setItem('zf_monitor_sentinel', '1'); } catch (e) {}
  try { localStorage.setItem('zf_monitor_pid', 'DAEMON-' + Date.now()); } catch (e2) {}
  if (window.App && App.startMonitorPoll) {
    try { App.startMonitorPoll(); return 'started'; } catch (e3) {}
  }
  return 'injected';
})()
"""


def _takeover_loop():
    """无头页驱动：daemon 线程内起 playwright 打开工作台（跑真实前端消费）。"""
    global _taking_over, _last_takeover_end
    try:
        from playwright.sync_api import sync_playwright   # 缺依赖时在 try 内抛，不致半死态
    except Exception as e:
        log.info('[daemon] playwright 不可用，放弃接管并自释放: %s' % e)
        _log_event('takeover_aborted', 'playwright import failed')
        _taking_over = False          # 释放标记，避免 _taking_over=True 卡死永不重试的半死态
        _last_takeover_end = _now_ms()   # 进冷静期，30s 后下轮 tick 可重试
        return
    url = 'http://127.0.0.1:%s/index.html' % cfg.PORT
    boot_ts = _now_ms()
    while _taking_over:
        pw = None
        try:
            pw = sync_playwright().start()
            browser = pw.chromium.launch(headless=True)
            ctx = browser.new_context(viewport={'width': 1280, 'height': 800})
            ctx.add_init_script(_build_fetch_rewrite_js())
            page = ctx.new_page()
            page.goto(url, wait_until='domcontentloaded', timeout=30000)
            page.wait_for_timeout(8000)   # 等前端初始化
            page.evaluate(_build_injection_js())
            log.info('[daemon] 无头页已接管消费')
            _log_event('takeover_page_up', 'headless consuming')
            # 看护循环：页活着就一直守；超 MAX_TAKEOVER_MS 强制自释放防僵尸占位
            while _taking_over:
                if _now_ms() - boot_ts > MAX_TAKEOVER_MS:
                    _log_event('takeover_timeout', 'max duration, self-release')
                    _taking_over = False
                    break
                try:
                    alive = page.evaluate("!!window.__daemonTakeover")
                except Exception:
                    alive = False
                if not alive:
                    break
                time.sleep(5)
        except Exception as e:
            log.info('[daemon] 无头页异常 10s 后重试: %s' % e)
            time.sleep(10)
        finally:
            try:
                if pw:
                    pw.stop()
            except Exception:
                pass
        if _taking_over:
            log.info('[daemon] 无头页断线，重建中…')
            time.sleep(3)


def _maybe_takeover():
    """接管判定：心跳断供 + 有积压 + 非冷静期。"""
    global _taking_over, _takeover_thread, _last_takeover_end
    if _taking_over:
        return
    t = _takeover_thread
    if t is not None:
        if t.is_alive():
            return
        _takeover_thread = None   # 死线程引用清理（异常路径自愈），下轮 tick 允许重试
    if _now_ms() - _last_takeover_end < COOLDOWN_MS:
        return
    if not _queue_backlog():
        return
    _taking_over = True
    _log_event('takeover_start', 'backlog=%s' % _queue_backlog())
    _takeover_thread = threading.Thread(
        target=_takeover_loop, name='monitor-headless', daemon=True)
    _takeover_thread.start()


def _release_takeover():
    """前端回场：撤无头页（守护线程自带 playwright 清理）。"""
    global _taking_over, _takeover_thread, _last_takeover_end
    if not _taking_over:
        return
    _taking_over = False
    t = _takeover_thread
    _takeover_thread = None
    _last_takeover_end = _now_ms()
    _log_event('takeover_end', 'front-end heartbeat resumed')
    if t:
        t.join(timeout=20)   # 给 playwright stop 留时间
    log.info('[daemon] 前端回场，接管结束')


def _tick():
    if _heartbeat_alive():
        _release_takeover()
    else:
        _maybe_takeover()


def start():
    """启动哨兵线程（daemon=True，不挡 server 退出）。幂等。"""
    global _started
    if _started:
        return
    _started = True
    t = threading.Thread(target=_loop, name='monitor-sentinel', daemon=True)
    t.start()
    log.info('[daemon] 队列消费哨兵已启动（心跳断供接管模式）')


def _loop():
    while True:
        try:
            _tick()
        except Exception as e:
            log.info('[daemon] tick 异常: %s' % e)
            traceback.print_exc()
        time.sleep(CHECK_INTERVAL)
