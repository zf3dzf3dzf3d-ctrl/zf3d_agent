# -*- coding: utf-8 -*-
"""
浏览器插件引擎 —— 单文件真源（20261123 exec 拆分还原）

原 970+ 行曾按行段拆为 engine_seg1..seg5 五段、由门面 exec 拼接
（门面 docstring 写 3 段、_SEGMENTS 实为 5 段 —— 拆分管理失控的实证）。
20261123 按策划案 Phase 0.2 按原加载顺序拼回本文件，语义零变化；
auto_relogin.py 对 engine_seg2 的越界 import 已同步改为从本模块导入。
分段原文件归档于 archive/exec拆分还原备份-20261123/。
"""

# -*- coding: utf-8 -*-
# 拆分分段模块：由原 engine.py 按行段【无改动】切分，由同名门面加载合并。
# -*- coding: utf-8 -*-
"""BrowserEngine —— 独立、可插拔的浏览器内核插件。

特点：
  * 零业务依赖：不 import 任何 mixin/server 模块，拷走整个 browser_plugin/ 目录即可在任意项目用
  * 动作注册表：所有动作通过 register(name, fn) 注册，外部可随时扩展/覆盖
  * 多会话：每个 session 有独立 profile 目录，隔离登录态
  * 单线程 worker：Playwright 必须在同一线程使用，引擎内部处理
  * 配置外置：config.json 可调 headless / 视口 / 标签上限 / profile 路径
"""
import logging  # 【20261123 门禁F821抓漏】蜂群print→logging迁移补 import
import os
import json
import time
import base64
import threading
import queue
import urllib.parse

from util_log import get_logger

log = get_logger('engine')
_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))

# --- 浏览器可执行文件定位（便携包关键修复） ---
# 浏览器装在随包的 python/browsers/ 下，若环境变量没设，Playwright 会去
# C:\\Users\\...\\ms-playwright 找不到可执行文件而报错。此处显式探测并设置，
# 保证拷走整个项目包也能直接工作。
if not os.environ.get('PLAYWRIGHT_BROWSERS_PATH'):
    _candidates = [
        os.path.join(os.path.dirname(os.path.dirname(_PLUGIN_DIR)),
                     'python', 'browsers'),                # server/browser_plugin -> 项目根/python/browsers
        os.path.join(_PLUGIN_DIR, '..', '..', 'python', 'browsers'),
        os.path.join(os.path.dirname(_PLUGIN_DIR), 'python', 'browsers'),
        os.path.join(os.path.dirname(_PLUGIN_DIR), 'browsers'),
    ]
    for _c in _candidates:
        if os.path.isdir(_c) and any(
                n.startswith('chromium') for n in os.listdir(_c)):
            os.environ['PLAYWRIGHT_BROWSERS_PATH'] = _c
            break

_DEFAULT_CONFIG = {
    'headless': False,   # 2026-10-12 用户要求：浏览器有头显示，AI 操作可实时看见（可用 browser_plugin/config.json 的 headless 覆盖）
    'viewport': {'width': 1280, 'height': 800},
    'max_tabs': 100,
    'data_dir': None,          # None = 插件目录下 data/
    'goto_timeout': 45000,
    'networkidle_wait': 1500,
    'anti_automation': True,
    'action_timeout': 90,      # 单个动作最长等待秒数，超时返回错误而不是永久挂起
}

_ACTIONS = {}          # name -> fn(engine, ctx, page, params) -> dict
_sessions = {}         # name -> BrowserSession
_sessions_lock = threading.RLock()

# --- 空闲自动关闭：会话超过 idle_close_seconds 秒无任何操作则自动关闭，防止 Chromium 后台吃 CPU ---
# S2(v1.3.2)：支持 browser_plugin/config.json 的 idle_close_seconds 覆盖（默认300不变）。
# 注意：server 进程常驻期间内存标记可达；若未来引擎拆独立进程/重启策略变更，须重评落盘标记。
_IDLE_CLOSE_SECONDS = 300


def _idle_close_seconds():
    try:
        cfg_path = os.path.join(_PLUGIN_DIR, 'config.json')
        if os.path.exists(cfg_path):
            v = json.load(open(cfg_path, encoding='utf-8-sig')).get('idle_close_seconds')
            if isinstance(v, (int, float)) and v > 0:
                return v
    except Exception:
        logging.debug("swallow", exc_info=True)
    return _IDLE_CLOSE_SECONDS
_reaper_started = False


def _touch_session(s):
    """记录会话最近使用时间"""
    try:
        s.last_used = time.time()
    except Exception:
        logging.debug("swallow", exc_info=True)


def _start_reaper():
    """启动空闲会话回收守护线程（进程内只启动一次）"""
    global _reaper_started
    with _sessions_lock:
        if _reaper_started:
            return
        _reaper_started = True

    def _reap_loop():
        while True:
            time.sleep(30)
            now = time.time()
            try:
                stale = []
                _ics = _idle_close_seconds()
                with _sessions_lock:
                    for name, s in list(_sessions.items()):
                        idle_for = now - getattr(s, 'last_used', now)
                        if idle_for > _ics:
                            stale.append(name)
                for name in stale:
                    # 只关浏览器上下文（profile 保留，登录态不丢），
                    # 会话对象留在 _sessions 里，下次 get_session 直接复用
                    with _sessions_lock:
                        s = _sessions.get(name)
                    if s is None:
                        continue
                    # 二次确认：取锁后仍是空闲且无排队任务才关
                    if now - getattr(s, 'last_used', now) <= _ics:
                        continue
                    if getattr(s, '_q', None) and not s._q.empty():
                        continue
                    try:
                        s.close()
                        # S2(v1.3.2) 回收标记挂 session 对象（一次性读取）：
                        # 下一次 dispatch 返回体携带 session_recycled:true 提醒 AI 会话曾被空闲回收
                        try:
                            s.recycled_at = now
                        except Exception:
                            logging.debug("swallow", exc_info=True)
                        log.info('[browser] 空闲会话已自动关闭: %s (空闲>%ds)'
                              % (name, _ics))
                    except Exception as e:
                        log.error('[browser] 空闲会话关闭失败 %s: %s' % (name, e))
            except Exception as e:
                log.error('[browser] 空闲回收线程异常: %s' % e)

    t = threading.Thread(target=_reap_loop, name='browser-idle-reaper', daemon=True)
    t.start()


class BrowserSession:
    """一个独立会话 = 一个持久化 Chromium 上下文（独立登录态）。"""

    def __init__(self, name='default', config=None):
        self.name = name
        cfg = dict(_DEFAULT_CONFIG)
        cfg_path = os.path.join(_PLUGIN_DIR, 'config.json')
        if os.path.exists(cfg_path):
            try:
                cfg.update(json.load(open(cfg_path, encoding='utf-8-sig')) or {})
            except Exception:
                logging.debug("swallow", exc_info=True)
        if config:
            cfg.update(config)
        self.last_used = time.time()  # 空闲回收依据
        self.config = cfg
        data_dir = cfg.get('data_dir') or os.path.join(_PLUGIN_DIR, 'data')
        # 相对路径锚定项目根（server 的上一级），避免随进程 CWD 漂移；跨机器部署不再依赖绝对盘符
        if not os.path.isabs(data_dir):
            data_dir = os.path.normpath(os.path.join(_PLUGIN_DIR, '..', '..', data_dir))
        self.profile_dir = os.path.join(data_dir, 'profiles', name)
        self.shot_dir = os.path.join(data_dir, 'shots', name)
        os.makedirs(self.profile_dir, exist_ok=True)
        os.makedirs(self.shot_dir, exist_ok=True)
        self._lock = threading.RLock()       # 仅保护页面/console_logs 等内部状态
        self._thread_lock = threading.Lock()  # 仅保护 worker 线程的创建检查
        self._stuck = False   # worker 卡死标记：卡死后不再往队列投新任务
        self._pw = None
        self._ctx = None
        self.active = None      # active Page
        self.last_error = None
        self.console_logs = []   # 页面 console / 错误日志（F12 面板数据源）
        self.net_logs = []       # 网络响应环形缓冲（net_dump 数据源）
        self.download_logs = []  # 下载记录（download_list 数据源）
        self._dl_dir = None      # 懒初始化下载目录
        self._q = queue.Queue()
        self._thread = None
        self._killed = False   # 会话被强制重建标记
        self._cdp_connected = False  # CDP 接管用户浏览器模式标记
        # ---- last_url 存档：会话被空闲回收/重建后，status 仍能报出"上次页面"，
        # 供工作台面板与 AI 恢复导航（否则回收后只剩 about:blank，页面"丢失"）----
        self.last_url = None
        self.last_title = None
        # ---- 标签页会话存档：服务重启/会话回收后，恢复全部标签页 URL 与活动标签 ----
        self._tabs_file = os.path.join(data_dir, 'sessions', 'tabs_%s.json' % name)
        # ---- 人机协作互斥：人最后操作时间戳（epoch ms），0=人当前没在操作 ----
        # 人每次点击/滚轮/按键由前端 touch_human 刷新；10s 静默视为放手。
        self.human_active_ts = 0
        self.human_note = ''      # 人最近操作提示（AI 可读）
        # AI 操作中提示：AI 执行非只读动作时刷新；3s 静默视为收手（前端显示遮罩横幅）
        self.ai_active_ts = 0
        self.ai_busy = False     # AI 动作执行中标志（含 wait 等长动作，防横幅中途消失）
        HUMAN_SILENT_MS = 10000

    def human_active(self):
        """人是否正在操作（10 秒内有 touch）。供 AI 动作前 try-check，绝不阻塞。"""
        return (time.time() * 1000 - self.human_active_ts) < 10000

    def ai_active(self):
        """AI 是否正在操作：忙碌标志（动作执行中，含 wait 等长动作）或 3 秒内刚结束。"""
        if getattr(self, 'ai_busy', False):
            return True
        return (time.time() * 1000 - self.ai_active_ts) < 3000

    # ---------- worker 线程 ----------
    def _worker(self):
        while True:
            item = self._q.get()
            if item is None:
                break
            fn, box = item
            try:
                box['result'] = fn()
            except Exception as e:
                box['result'] = {'ok': False, 'error': '%s: %s' % (type(e).__name__, e)}
            box['done'] = True
            try:
                box['event'].set()
            except Exception:
                logging.debug("swallow", exc_info=True)
            self._q.task_done()

    def run(self, fn, touch=True):
        """投递到会话专属线程执行 fn()，返回结果 dict。

        投递即刷新空闲计时；后续由后台线程执行。
        带超时保护 + 不持锁等待：
        * _thread_lock 只保护线程创建检查，等待结果期间不持任何锁，
          这样 worker 线程内部（close/console 日志回调等）拿 _lock 不会被
          调用方堵死——之前 run() 全程持 _lock 等待，worker 又要拿同一把
          锁写日志，形成跨线程死锁，会话永久瘫痪。
        * worker 卡死（超时未完成）后标记 _stuck，后续任务不再投递到
          死队列，而是直接报错引导 kill_session，杜绝"排队等永远不动的队列"。

        touch=True（默认）：刷新空闲计时。前端 600ms 高频轮询 status 这类
        只读操作必须传 touch=False，否则空闲计时被无限刷新，空闲回收线程
        永远不关浏览器 → 无头 Chromium 常驻后台持续吃 CPU（风扇狂转元凶）。
        """
        if touch:
            _touch_session(self)
        with self._thread_lock:
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._worker, daemon=True,
                                                name='browser-%s' % self.name)
                self._thread.start()
        if self._stuck:
            return {'ok': False, 'stuck': True,
                    'error': '浏览器线程已卡死（历史动作超时未完成），请先执行 kill_session 重建会话'}
        box = {'done': False, 'event': threading.Event()}
        self._q.put((fn, box))
        timeout = float(self.config.get('action_timeout') or 90)
        deadline = time.time() + timeout
        while not box['done'] and time.time() < deadline:
            box['event'].wait(0.2)
        if not box['done']:
            self._stuck = True
            self.last_error = '动作超过 %ss 未完成，浏览器线程疑似卡死（可用 action=kill_session 强制重建）' % int(timeout)
            return {'ok': False, 'timeout': True, 'error': self.last_error}
        return box.get('result', {'ok': False, 'error': 'no result'})

    # ---------- 生命周期 ----------
    def _ensure(self):
        """惰性启动（必须在 worker 线程调用）。返回 (ctx, page)。"""
        if self._ctx is not None:
            try:
                if self.active and not self.active.is_closed():
                    return self._ctx, self.active
                self.active = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
                return self._ctx, self.active
            except Exception:
                # 【泄漏修复】ctx 已坏时必须把旧 playwright 驱动一并停掉，
                # 否则残留 driver 子进程/管道句柄反复累积（pythonw 句柄 3000+ 的元凶）
                try:
                    if self._pw:
                        self._pw.stop()
                except Exception:
                    logging.debug("swallow", exc_info=True)
                self._pw = None
                self._ctx = None
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as e:
            raise RuntimeError('playwright 未安装: %s' % e)
        if self._killed:
            # 会话曾被强制重建：杀掉残留 Chromium，避免 profile 被锁导致新实例起不来。
            # CDP 接管模式下跳过：那可能杀到用户自己的浏览器！
            if not self._cdp_connected:
                self._kill_chromium_tree()
            self._killed = False
        # ---- CDP 优先：接管用户已打开的浏览器（实时联动），失败则回退自起模式 ----
        _cdp = (self.config.get('cdp_endpoint') or '').strip()
        if _cdp and not self._cdp_connected:
            try:
                import urllib.request as _ur
                _ver = _ur.urlopen(_cdp.rstrip('/') + '/json/version', timeout=2).read()
                self._pw = sync_playwright().start()
                _browser = self._pw.chromium.connect_over_cdp(_cdp, timeout=8000)
                self._ctx = _browser.contexts[0] if _browser.contexts else _browser.new_context()
                self._cdp_connected = True
                log.info('[browser] 已通过 CDP 接管用户浏览器: %s' % _cdp)
                self.active = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
                for p in self._ctx.pages:
                    self._attach_devtools(p)
                try:
                    self._ctx.on('page', self._attach_devtools)
                except Exception:
                    logging.debug("swallow", exc_info=True)
                return self._ctx, self.active
            except Exception as _e:
                # CDP 连不上（浏览器没带调试端口启动）：静默回退自起模式，零破坏
                log.error('[browser] CDP 连接失败(%s)，回退自起浏览器' % _e)
                try:
                    if self._pw:
                        self._pw.stop()
                except Exception:
                    logging.debug("swallow", exc_info=True)
                self._pw = None
        # 【泄漏修复】进入自起模式前，先回收上一次未释放的 playwright 驱动
        if self._pw is not None:
            try:
                self._pw.stop()
            except Exception:
                logging.debug("swallow", exc_info=True)
            self._pw = None
        self._pw = sync_playwright().start()
        _stealth = bool(self.config.get('anti_automation', True))
        args = [
            '--disable-blink-features=AutomationControlled',
            # 【H-11 修复】移除 --disable-features=IsolateOrigins,site-per-process：
            # 站点隔离恢复默认开启，防 Spectre 类跨站数据泄漏；反自动化检测特征不受影响。
            '--no-first-run', '--no-default-browser-check',
        ] if _stealth else []
        _launch_kw = dict(
            headless=bool(self.config.get('headless', True)),
            viewport=self.config.get('viewport') or {'width': 1280, 'height': 800},
            args=args,
            ignore_default_args=['--enable-automation'] if _stealth else None,
            accept_downloads=True,
        )
        # 优先用本机安装的谷歌 Chrome 正式版内核（channel='chrome'，渲染/兼容性最好），
        # 没装 Chrome 或启动失败则自动回退随包 Chromium，保证开箱能用。
        _channel = (self.config.get('channel') or 'chrome').strip()
        _exe = (self.config.get('executable_path') or '').strip()
        try:
            if _exe:
                self._ctx = self._pw.chromium.launch_persistent_context(
                    self.profile_dir, executable_path=_exe, **_launch_kw)
            elif _channel and _channel != 'chromium':
                self._ctx = self._pw.chromium.launch_persistent_context(
                    self.profile_dir, channel=_channel, **_launch_kw)
            else:
                raise RuntimeError('channel=chromium：使用随包内核')
        except Exception:
            self._ctx = self._pw.chromium.launch_persistent_context(
                self.profile_dir, **_launch_kw)
        self.active = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
        for p in self._ctx.pages:
            self._attach_devtools(p)
        try:
            self._ctx.on('page', self._attach_devtools)
        except Exception:
            logging.debug("swallow", exc_info=True)
        # 启动后恢复上次标签页（服务重启/回收后原样还原）；CDP 接管模式下不动用户的标签页
        if not self._cdp_connected:
            self._tabs_restore(self._ctx)
        for p in self._ctx.pages:
            self._attach_devtools(p)
        return self._ctx, self.active

    def _kill_chromium_tree(self):
        """杀掉使用本会话 profile 目录的 Chromium 进程（PowerShell 按命令行匹配）。"""
        try:
            import subprocess
            frag = self.profile_dir.replace('\\', '\\\\')
            if os.name == "nt":
                # Playwright 无头模式实际进程名是 chrome-headless-shell.exe（新版），
                # 只匹配 chrome.exe 会漏杀僵尸进程，导致 profile 被锁、新实例起不来
                cmd = ("Get-CimInstance Win32_Process | "
                       "Where-Object { ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'chrome-headless-shell.exe' "
                       "-or $_.Name -eq 'headless_shell.exe' -or $_.Name -eq 'msedge.exe') "
                       "-and $_.CommandLine -like '*%s*' } | "
                       "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }") % frag
                subprocess.run(['powershell', '-NoProfile', '-Command', cmd],
                               capture_output=True, timeout=20, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            else:
                # macOS/Linux：pkill 按命令行匹配 profile 目录
                subprocess.run(['pkill', '-f', self.profile_dir],
                               capture_output=True, timeout=20, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        except Exception:
            logging.debug("swallow", exc_info=True)

    def _attach_devtools(self, page):
        """给页面挂 console / 页面错误 / 网络失败 监听（幂等）。"""
        if getattr(page, '_devtools_attached', False):
            return
        try:
            page._devtools_attached = True

            # ---- 反检测 stealth 注入（每个新页面自动生效，幂等） ----
            if bool(self.config.get('anti_automation', True)):
                try:
                    page.add_init_script("""
() => {
  try {
    Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
    Object.defineProperty(navigator, 'languages', {get: () => ['zh-CN', 'zh', 'en']});
    Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
    window.chrome = window.chrome || {runtime: {}};
    const orig = navigator.permissions && navigator.permissions.query;
    if (orig) {
      navigator.permissions.query = (p) => (p && p.name === 'notifications'
        ? Promise.resolve({state: Notification.permission}) : orig(p));
    }
  } catch (e) {}
}""")
                except Exception:
                    logging.debug("swallow", exc_info=True)

            # ---- 网络响应捕获（滚动环形缓冲，供 net_dump 查询） ----
            try:
                page.on('response', self._on_response)
            except Exception:
                logging.debug("swallow", exc_info=True)
            # ---- 下载捕获 ----
            try:
                page.on('download', self._on_download)
            except Exception:
                logging.debug("swallow", exc_info=True)
            # ---- 弹窗/新页面并入标签管理 ----
            try:
                page.on('popup', lambda p: self._on_popup(p))
            except Exception:
                logging.debug("swallow", exc_info=True)

            def _fmt_val(v):
                try:
                    return v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)[:2000]
                except Exception:
                    return str(v)

            def _push(level, text):
                with self._lock:
                    self.console_logs.append({
                        't': time.strftime('%H:%M:%S'),
                        'level': level,
                        'text': text[:4000],
                    })
                    if len(self.console_logs) > 500:
                        del self.console_logs[:len(self.console_logs) - 500]

            page.on('console', lambda m: _push(
                m.type if m.type in ('error', 'warning', 'info', 'debug') else 'log',
                '[%s] %s' % (m.type, ' '.join(_fmt_val(a) for a in m.args))))
            page.on('pageerror', lambda e: _push('error', '[pageerror] %s' % e))
            page.on('requestfailed', lambda r: _push(
                'error', '[requestfailed] %s %s -> %s' % (r.method, r.url, r.failure)))
        except Exception:
            logging.debug("swallow", exc_info=True)

    def _on_response(self, resp):
        """网络响应回调：滚动环形缓冲，供 net_dump 查询（静默失败）。"""
        try:
            _ct = ''
            try:
                _ct = (resp.headers or {}).get('content-type', '')
            except Exception:
                logging.debug("swallow", exc_info=True)
            with self._lock:
                self.net_logs.append({
                    't': time.strftime('%H:%M:%S'),
                    'url': resp.url[:500],
                    'status': resp.status,
                    'method': resp.request.method if resp.request else '',
                    'type': _ct.split(';')[0][:60],
                })
                if len(self.net_logs) > 300:
                    del self.net_logs[:len(self.net_logs) - 300]
        except Exception:
            logging.debug("swallow", exc_info=True)

    def _on_download(self, dl):
        """下载回调：保存到下载目录并记录（静默失败）。"""
        try:
            if self._dl_dir is None:
                cfg = self.config
                data_dir = cfg.get('data_dir') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
                if not os.path.isabs(data_dir):
                    data_dir = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', data_dir))
                self._dl_dir = os.path.join(data_dir, 'downloads', self.name)
                os.makedirs(self._dl_dir, exist_ok=True)
            _name = dl.suggested_filename or ('download_%s' % time.strftime('%H%M%S'))
            _path = os.path.join(self._dl_dir, '%s_%s' % (time.strftime('%H%M%S'), _name))

            def _save_and_log(_dl=dl, _path=_path):
                try:
                    _dl.save_as(_path)  # 阻塞保存放后台线程，避免拖慢 Playwright 事件分发
                except Exception as _e:
                    log.error('[browser] 下载保存异常: %s' % _e)
                    return
                try:
                    with self._lock:
                        self.download_logs.append({
                            't': time.strftime('%H:%M:%S'),
                            'url': (_dl.url or '')[:500],
                            'path': _path,
                        })
                        if len(self.download_logs) > 100:
                            del self.download_logs[:len(self.download_logs) - 100]
                    self._cleanup_downloads()
                except Exception as _e:
                    log.error('[browser] 下载记录异常: %s' % _e)

            threading.Thread(target=_save_and_log, daemon=True).start()
        except Exception as _e:
            log.error('[browser] 下载处理异常: %s' % _e)

    def _cleanup_downloads(self, max_total_mb=500, max_age_days=7):
        """磁盘滚动清理：下载目录总量超 max_total_mb 或文件超 max_age_days 时，按时间从旧到新删。"""
        try:
            if not self._dl_dir or not os.path.isdir(self._dl_dir):
                return
            now = time.time()
            files = []
            for fn in os.listdir(self._dl_dir):
                fp = os.path.join(self._dl_dir, fn)
                try:
                    st = os.stat(fp)
                    files.append((st.st_mtime, st.st_size, fp))
                except OSError:
                    logging.debug("swallow", exc_info=True)
            total = sum(s for _, s, _ in files)
            files.sort()  # 旧的在前
            for mtime, size, fp in files:
                if total <= max_total_mb * 1024 * 1024 and now - mtime <= max_age_days * 86400:
                    break
                try:
                    os.remove(fp)
                    total -= size
                except OSError:
                    logging.debug("swallow", exc_info=True)
        except Exception:
            logging.debug("swallow", exc_info=True)

    def _on_popup(self, page):
        """弹窗/新页面并入标签跟踪（复用 devtools 挂载）。"""
        try:
            self._attach_devtools(page)
        except Exception:
            logging.debug("swallow", exc_info=True)

    def net_dump(self, keyword=None, limit=50, body_index=None, max_body=8000, max_body_timeout_sec=8):
        """查询最近网络响应列表；body_index 指定时返回该条响应体（仅 JSON/文本）。
        max_body=返回体最大字符数（硬上限 2MB）；max_body_timeout_sec=读取超时秒（防挂起）。"""
        max_body = min(int(max_body), 2 * 1024 * 1024)
        with self._lock:
            logs = list(self.net_logs)
        if keyword:
            logs = [x for x in logs if keyword.lower() in x['url'].lower()
                    or keyword.lower() in x.get('type', '')]
        logs = logs[-int(limit):]
        if body_index is None:
            return {'list': logs}
        # body_index 为负数时从末尾数（-1=最新一条）
        try:
            target = logs[int(body_index)] if int(body_index) >= 0 else \
                (list(self.net_logs)[int(body_index)] if list(self.net_logs) else None)
        except Exception:
            target = None
        if not target:
            return {'error': 'index 不存在'}
        _body = None
        try:
            # 找到对应 response 对象比较费劲，改用 active 页面 fetch 同 URL 读取（带凭证）
            # 防挂起：JS 侧 Promise.race 强超时（默认8s），防拖死任务链
            _timeout_ms = int(max_body_timeout_sec * 1000)
            _body = self.active.evaluate(
                """async ([u, tms]) => {
                  const ctl = new AbortController();
                  const timer = setTimeout(() => ctl.abort(), tms);
                  try {
                    const r = await fetch(u, {credentials:'include', signal: ctl.signal});
                    return await r.text();
                  } finally { clearTimeout(timer); }
                }""", [target['url'], _timeout_ms])
        except Exception as e:
            return {'error': '读取响应体失败: %s' % e, 'meta': target}
        return {'meta': target, 'body': (_body or '')[:int(max_body)]}

    def download_list(self, limit=20):
        with self._lock:
            logs = list(self.download_logs)
        return {'list': logs[-int(limit):], 'dir': self._dl_dir}

    def upload_file(self, ref=None, selector=None, path=None):
        """向 file input 上传本地文件。"""
        if not path or not os.path.exists(path):
            return {'error': '文件不存在: %s' % path}
        page = self.active
        if page is None:
            return {'error': '无活动页面'}
        loc = None
        if ref:
            loc = self._ref_selector(ref) if hasattr(self, '_ref_selector') else None
        if loc is None:
            loc = selector or 'input[type=file]'
        page.set_input_files(loc, path)
        return {'ok': True, 'path': path, 'selector': str(loc)}

    def console_dump(self, level=None, limit=200, clear=False):
        with self._lock:
            if clear:
                logs, self.console_logs = list(self.console_logs), []
            else:
                logs = list(self.console_logs)
        if level:
            logs = [x for x in logs if x['level'] == level]
        return logs[-int(limit):]

    def _tabs_archive(self):
        """存档当前全部标签页 URL 与活动索引（worker 线程内调用，静默失败）。"""
        try:
            if self._ctx is None:
                return
            tabs = [{'url': p.url} for p in self._ctx.pages
                    if not p.is_closed() and p.url and p.url != 'about:blank']
            if not tabs:
                # 全部标签已关闭：写入空存档，防止旧存档让已关标签"复活"
                os.makedirs(os.path.dirname(self._tabs_file), exist_ok=True)
                with open(self._tabs_file, 'w', encoding='utf-8') as f:
                    json.dump({'tabs': [], 'active': 0}, f)
                return
            try:
                ai = list(self._ctx.pages).index(self.active) if self.active else 0
            except ValueError:
                ai = 0
            os.makedirs(os.path.dirname(self._tabs_file), exist_ok=True)
            with open(self._tabs_file, 'w', encoding='utf-8') as f:
                json.dump({'tabs': tabs, 'active': max(0, min(ai, len(tabs) - 1))},
                          f, ensure_ascii=False)
        except Exception:
            logging.debug("swallow", exc_info=True)

    def _tabs_restore(self, ctx):
        """浏览器启动后从存档恢复标签页（worker 线程内调用，静默失败）。"""
        try:
            if not os.path.exists(self._tabs_file):
                return
            d = json.load(open(self._tabs_file, encoding='utf-8'))
            urls = [t.get('url') for t in (d.get('tabs') or []) if t.get('url')]
            if not urls:
                return
            gt = self.config.get('goto_timeout') or 30000
            pages = [p for p in ctx.pages if not p.is_closed()] or [ctx.new_page()]
            p0 = pages[0]
            try:
                p0.goto(urls[0], timeout=gt, wait_until='domcontentloaded')
            except Exception:
                logging.debug("swallow", exc_info=True)
            made = [p0]
            for u in urls[1:]:
                p = ctx.new_page()
                try:
                    p.goto(u, timeout=gt, wait_until='domcontentloaded')
                except Exception:
                    logging.debug("swallow", exc_info=True)
                made.append(p)
            ai = max(0, min(int(d.get('active') or 0), len(made) - 1))
            self.active = made[ai]
        except Exception:
            logging.debug("swallow", exc_info=True)

    def close(self):
        def _do():
            with self._lock:
                # 回收前存档当前页：空闲回收会把上下文关掉，url 随之丢失，
                # 存档后 status 仍可报出"上次页面"供前端/AI 恢复
                try:
                    if self.active and not self.active.is_closed():
                        u = self.active.url
                        if u and u != 'about:blank':
                            self.last_url = u
                            try:
                                self.last_title = self.active.title()
                            except Exception:
                                logging.debug("swallow", exc_info=True)
                except Exception:
                    logging.debug("swallow", exc_info=True)
                # 关闭前存档全部标签页（重启后原样恢复）；
                # CDP 接管模式跳过：那是用户真实浏览器的标签，不属于本会话，不存档不恢复
                if not self._cdp_connected:
                    self._tabs_archive()
                if self._ctx:
                    try:
                        if self._cdp_connected:
                            # CDP 模式：绝不能 ctx.close()（会关掉用户真实标签页），
                            # 只停 playwright 驱动断开连接，用户浏览器进程不受影响
                            pass
                        else:
                            self._ctx.close()
                    except Exception:
                        logging.debug("swallow", exc_info=True)
                if self._pw:
                    try:
                        self._pw.stop()  # CDP 断连 / 自起模式回收驱动，防止泄漏进程
                    except Exception:
                        logging.debug("swallow", exc_info=True)
                self._pw = None
                self._cdp_connected = False
                self._ctx = None
                self.active = None
            return {'ok': True, 'closed': True}
        return self.run(_do, touch=False)  # 高频轮询不刷新空闲计时，允许空闲回收

    def status_inline(self):
        """直接读状态（不排队）。必须在 worker 线程内调用（动作里用）。"""
        info = {'ok': True, 'session': self.name, 'running': self._ctx is not None,
                'cdp_mode': self._cdp_connected,
                'url': None, 'title': None, 'profile': self.profile_dir,
                'tabs': [], 'active': 0}
        if self._ctx is not None:
            # tabs 不逐页调 title()（慢页面会阻塞，status 被 600ms 高频轮询），
            # 只回 url；title 由低频的 tabs 动作提供
            try:
                info['tabs'] = [{'index': i, 'url': p.url, 'title': ''}
                                for i, p in enumerate(self._ctx.pages) if not p.is_closed()]
            except Exception:
                logging.debug("swallow", exc_info=True)
            if self.active and not self.active.is_closed():
                info['url'] = self.active.url
                try:
                    info['active'] = self._ctx.pages.index(self.active)  # 真实活动索引（此前硬编码 0，切标签后恢复错位）
                except Exception:
                    info['active'] = 0
                try:
                    info['title'] = self.active.title()
                except Exception:
                    logging.debug("swallow", exc_info=True)
            # 运行中持续刷新存档（会话被回收/重建后仍能报出"上次页面"）
            if info['url'] and info['url'] != 'about:blank':
                self.last_url, self.last_title = info['url'], info.get('title')
        if not info['url'] and self.last_url:
            info['url'], info['title'] = self.last_url, self.last_title
            info['url_archived'] = True   # 前端据此外部导航恢复（会话已回收，需 goto）
        if self.last_error:
            info['last_error'] = self.last_error
        info['ai_active'] = self.ai_active()
        return info

    def status(self):
        def _do():
            info = {'ok': True, 'session': self.name, 'running': self._ctx is not None,
                    'url': None, 'title': None, 'profile': self.profile_dir,
                    'tabs': [], 'active': 0}
            if self._ctx is not None:
                # 同 status_inline：不逐页取 title（防慢页面阻塞高频轮询），只回 url
                try:
                    info['tabs'] = [{'index': i, 'url': p.url, 'title': ''}
                                    for i, p in enumerate(self._ctx.pages) if not p.is_closed()]
                except Exception:
                    logging.debug("swallow", exc_info=True)
                if self.active and not self.active.is_closed():
                    info['url'] = self.active.url
                    try:
                        info['title'] = self.active.title()
                    except Exception:
                        logging.debug("swallow", exc_info=True)
                    try:
                        info['active'] = self._ctx.pages.index(self.active)  # 真实活动索引
                    except Exception:
                        info['active'] = 0
                # 运行中持续刷新存档（同 status_inline）
                if info['url'] and info['url'] != 'about:blank':
                    self.last_url, self.last_title = info['url'], info.get('title')
            if not info['url'] and self.last_url:
                info['url'], info['title'] = self.last_url, self.last_title
                info['url_archived'] = True   # 会话已回收，前端据此 goto 恢复
            if self.last_error:
                info['last_error'] = self.last_error
            # 人机状态透传：前端据此显示/隐藏「AI 操作中」横幅（人工占用时优先让人操作）
            info['ai_active'] = self.ai_active()
            info['human_active'] = self.human_active()
            return info
        return self.run(_do, touch=False)  # 高频轮询不刷新空闲计时

    def _pick_page(self, index):
        """按 index 取页，index 无效则用当前活动页（worker 线程内调用）。"""
        if index is not None and 0 <= index < len(self._ctx.pages):
            page = self._ctx.pages[index]
        else:
            page = self.active if (self.active and not self.active.is_closed()) else \
                (self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page())
        self.active = page
        return page

    def screenshot_path(self, page, full=False):
        p = os.path.join(self.shot_dir, 'latest.png')
        page.screenshot(path=p, full_page=bool(full))
        return p

    def screenshot_jpeg_path(self, page, quality=80):
        """JPEG 帧输出：体积约为 PNG 的 1/5，轮询推帧用。"""
        p = os.path.join(self.shot_dir, 'latest.jpg')
        page.screenshot(path=p, type='jpeg', quality=int(quality), full_page=False)
        return p

    # ---------- CDP screencast 实时推流 ----------
    def stream_start(self, quality=60):
        """启动 CDP Page.startScreencast：画面变化时 Chromium 主动推帧（base64）
        存入 _stream_frames 队列，由 stream_pump 在 worker 线程内落盘。"""
        ctx, page = self._ensure()
        self.stream_stop()
        self._stream_frames = []
        cdp = ctx.new_cdp_session(page)
        self._stream_cdp = cdp

        def _on_frame(params):
            sid = params.get('sessionId')
            data = params.get('data')
            try:
                cdp.send('Page.screencastFrameAck', {'sessionId': sid})
            except Exception:
                logging.debug("swallow", exc_info=True)
            if data:
                self._stream_frames.append(data)
                if len(self._stream_frames) > 3:
                    self._stream_frames.pop(0)

        cdp.on('Page.screencastFrame', _on_frame)
        cdp.send('Page.startScreencast', {
            'format': 'jpeg', 'quality': int(quality),
            'maxWidth': 1280, 'maxHeight': 800, 'everyNthFrame': 1,
        })
        self._stream_on = True
        return {'ok': True, 'streaming': True}

    def stream_pump(self):
        """worker 线程内调用：驱动事件分发并落盘最新帧到 stream.jpg。"""
        if not getattr(self, '_stream_on', False):
            return self.stream_sig()
        try:
            self.active.evaluate('1')
        except Exception:
            logging.debug("swallow", exc_info=True)
        frames = self._stream_frames
        if frames:
            import base64 as _b64
            data = frames[-1]
            self._stream_frames = []
            try:
                open(os.path.join(self.shot_dir, 'stream.jpg'), 'wb').write(_b64.b64decode(data))
            except Exception:
                logging.debug("swallow", exc_info=True)
        return self.stream_sig()

    def stream_sig(self):
        p = os.path.join(self.shot_dir, 'stream.jpg')
        try:
            st = os.stat(p)
            return 'S%d_%d' % (int(st.st_mtime), st.st_size)
        except OSError:
            return ''

    def stream_stop(self):
        try:
            if getattr(self, '_stream_cdp', None):
                self._stream_cdp.send('Page.stopScreencast')
                try:
                    self._stream_cdp.detach()
                except Exception:
                    logging.debug("swallow", exc_info=True)
        except Exception:
            logging.debug("swallow", exc_info=True)
        self._stream_cdp = None
        self._stream_on = False
        self._stream_frames = []
        return {'ok': True, 'streaming': False}

    def stream_follow_active(self, quality=60):
        """推流若开着，则切到当前活动页重启（newtab/switchtab/closetab 后调用）。"""
        # 标签页结构变化后及时存档（重启后可恢复）；
        # CDP 接管模式跳过：那是用户真实浏览器的标签，不属于本会话，不存档
        if not self._cdp_connected:
            self._tabs_archive()
        if getattr(self, '_stream_on', False):
            try:
                self.stream_stop()
            except Exception:
                logging.debug("swallow", exc_info=True)
            try:
                return self.stream_start(quality)
            except Exception:
                logging.debug("swallow", exc_info=True)
        return {'ok': True, 'streaming': False}

    def frame_sig(self):
        """当前帧签名（latest.jpg 的 mtime+size），前端轮询对比，变了才拉图。"""
        p = os.path.join(self.shot_dir, 'latest.jpg')
        try:
            st = os.stat(p)
            return '%d_%d' % (int(st.st_mtime), st.st_size)
        except OSError:
            return ''

    def screenshot_data(self, path):
        b64 = base64.b64encode(open(path, 'rb').read()).decode()
        return 'data:image/png;base64,' + b64

    def dispatch(self, action, params):
        """执行一个已注册动作（自动投到 worker 线程）。

        例外：kill_session 等恢复性动作不排队——worker 死锁时排队动作永远
        得不到执行，恢复动作必须由 HTTP 线程直接执行才能解锁。
        """
        if action == 'kill_session':
            fn = _ACTIONS.get('kill_session')
            if fn is not None:
                try:
                    return fn(self, params)
                except Exception as e:
                    return {'ok': False, 'error': '%s: %s' % (type(e).__name__, e)}
        def _do():
            try:
                fn = _ACTIONS.get(action)
                if fn is None:
                    return {'ok': False, 'error': '未知 action: %s' % action}
                # [20261126 安全收口A1] 敏感动作前置检查：凭据提交类(login)/上传(upload)
                # 过 browser_guard.check_action（kill_switch/敏感扫描），异常 fail-open。
                _guard_act = {'credentials_save': 'login', 'credentials_restore': 'login',
                              'auto_relogin': 'login', 'upload_file': 'upload'}.get(action)
                if _guard_act:
                    try:
                        import browser_guard as _bg
                        _cur = ''
                        try:
                            _cur = self._pick_page(params.get('index')).url
                        except Exception:
                            logging.debug("swallow", exc_info=True)
                        ga = _bg.check_action(_cur, _guard_act, actor='browser_plugin')
                        if ga.get('decision') == 'block':
                            return {'ok': False, 'blocked_by': 'browser_guard',
                                    'error': '敏感动作被安全闸门拦截: %s' % ga.get('reason', '')}
                        # 【M1.3】能力策略 browser：用户规则 deny 即拒（目标=当前页 URL+动作）
                        from util_policy import get_default_engine as _pol_gde
                        _pol_d = _pol_gde().decide('browser', (_cur or '') + '#' + _guard_act)
                        if _pol_d.action == 'deny':
                            return {'ok': False, 'blocked_by': 'policy',
                                    'error': '浏览器操作被用户策略拒绝（目标 %s）'
                                             % ((_cur or '')[:60])}
                    except Exception:
                        logging.debug("swallow", exc_info=True)
                # 人机协作互斥：人正在操作（10s 内有 touch）时，AI 的页面操作收到
                # 非阻塞建议提示；touch_human/status/shot 等只读动作放行。
                if self.human_active() and action not in (
                        'touch_human', 'human_status', 'status', 'screenshot',
                        'shot_jpeg', 'stream_poll', 'framesig', 'console',
                        'tabs', 'content', 'snapshot', 'viewsource'):
                    return {'ok': False,
                            'human_active': True,
                            'error': '用户正在操作浏览器节点，AI 已让行（10 秒无操作自动归还），请稍后重试'}
                # AI 操作中标记：非只读动作刷新时间戳，前端轮询 status 据此显示
                # 「AI 操作中」横幅并屏蔽人工交互（3s 静默自动消失）。
                if action not in readonly_actions:
                    self.ai_active_ts = time.time() * 1000
                    self.ai_busy = True
                try:
                    return fn(self, params)
                finally:
                    self.ai_busy = False
            except Exception as e:
                self.last_error = '%s: %s' % (type(e).__name__, e)
                return {'ok': False, 'error': self.last_error}
        # 只读/轮询类动作不算"活跃"：不刷新 last_used，空闲回收线程仍可
        # 正常关闭闲置会话（否则前端 600ms 轮询会让浏览器永不回收）。
        readonly_actions = (
            'touch_human', 'human_status', 'status', 'screenshot',
            'shot_jpeg', 'stream_poll', 'framesig', 'console',
            'tabs', 'content', 'snapshot', 'viewsource')
        r = self.run(_do, touch=action not in readonly_actions)
        # S2(v1.3.2) 会话回收可感知：空闲回收只发生在两次调用之间，AI 无法从日志感知。
        # 在返回体带一次性标记 session_recycled:true（读即清零，与返回构建同事务防重试丢失），
        # AI 看到该字段应知道"页面状态可能已重置"，而非误判网页故障。冷启动不误报
        # （recycled_at 仅由空闲回收线程设置）。server 常驻期间内存标记可达；若进程模型
        # 变更（引擎拆独立进程/重启策略改变），须重评改为落盘标记。
        try:
            ra = getattr(self, 'recycled_at', None)
            if ra is not None and isinstance(r, dict):
                del self.recycled_at
                r.setdefault('session_recycled', True)
                r.setdefault('session_recycled_note',
                             '该会话空闲超时被自动回收过（浏览器上下文已重开，登录态保留）；'
                             '如当前页面与预期不符请重新 open/goto')
        except Exception:
            logging.debug("swallow", exc_info=True)
        # ---- 自愈：worker 线程被残留 asyncio 事件循环污染或卡死时自动重建 ----
        # Playwright sync API 要求所在线程没有正在运行的 loop；若线程曾启动
        # 过未关闭的 loop，sync_playwright().start() 会永远抛
        # "Sync API inside the asyncio loop"。kill_session 会用全新线程替换
        # 会话对象，因此检测到该错误/卡死时自动重建并重试一次，无需人工干预。
        if isinstance(r, dict) and not r.get('ok'):
            err = str(r.get('error') or '')
            need_heal = ('Sync API inside the asyncio loop' in err
                         or r.get('stuck') or r.get('timeout'))
            if need_heal:
                try:
                    heal = kill_session(self.name)
                except Exception as he:
                    return {'ok': False, 'error': err,
                            'heal_failed': '%s: %s' % (type(he).__name__, he)}
                # kill_session 已把 _sessions[name] 换成全新会话（新线程），
                # 从注册表拿新会话重试同一动作
                try:
                    fresh = get_session(self.name)
                except Exception:
                    fresh = None
                if fresh is not None and fresh is not self:
                    retry = fresh.dispatch(action, params)
                    if isinstance(retry, dict):
                        retry.setdefault('auto_healed', True)
                        retry.setdefault('heal_note',
                                         '检测到线程污染/卡死，已自动重建会话并重试')
                    return retry
                return {'ok': False, 'error': err, 'healed': heal}
        return r


# -*- coding: utf-8 -*-
# 拆分分段模块：由原 engine.py 按行段【无改动】切分，由同名门面加载合并。
# ================== 内置动作（全部走注册表，可被覆盖/扩展） ==================
import time as _time_mod  # touch_human/human_status 用（门面合并后本段与 seg1 共享命名空间）
import os as _os_mod
import glob as _glob_mod

def register(name, fn=None, override=False):
    """注册动作。fn(engine, params) -> dict。装饰器或函数式两种用法。

    内置同名动作默认不可覆盖（override=True 才行），防止误扩展。
    """
    def deco(f):
        if name in _ACTIONS and not override:
            raise ValueError('action %r 已存在，如需覆盖传 override=True' % name)
        _ACTIONS[name] = f
        return f
    if fn is not None:
        return deco(fn)
    return deco


def list_actions():
    return sorted(_ACTIONS.keys())


def unregister(name):
    return _ACTIONS.pop(name, None) is not None


def dispatch(action, params=None):
    """顶层便捷入口：按 params['session'] 选会话并执行动作。"""
    params = dict(params or {})
    return get_session(params.pop('session', None) or 'default').dispatch(action, params)


# --- 轻量 accessibility 快照：给可见交互元素注入 data-zfref，返回文本清单 ---
# ref 是注入到当前 DOM 的属性选择器，click/fill 在同一页面内解析，天然保证快照→操作原子性；
# 页面跳转后 DOM 重建 ref 失效，模型重新 snapshot 即可。
_SNAP_JS = r"""
() => {
  const out = [];
  let n = 0;
  const sels = 'a[href],button,input,select,textarea,[role=button],[role=link],[role=tab],[role=checkbox],[role=textbox],[role=combobox],[onclick]';
  document.querySelectorAll(sels).forEach(el => {
    if (n >= 150) return;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.display === 'none') return;
    const label = (el.innerText || el.value || el.getAttribute('aria-label') ||
                   el.getAttribute('name') || el.placeholder || el.getAttribute('title') || el.alt || '')
                  .trim().slice(0, 60).replace(/\s+/g, ' ');
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    let role = el.getAttribute('role');
    if (!role) {
      if (tag === 'a') role = 'link';
      else if (tag === 'button' || (tag === 'input' && ['button','submit'].includes(type))) role = 'button';
      else if (tag === 'input' || tag === 'textarea') role = 'textbox' + (type ? ':' + type : '');
      else if (tag === 'select') role = 'combobox';
      else role = tag;
    }
    const ref = 'e' + (++n);
    el.setAttribute('data-zfref', ref);
    out.push('- ' + role + ' "' + (label || '(无文字)') + '" [ref=' + ref + ']');
  });
  return out.join('\n') || '(页面无可交互元素)';
}
"""


def _snap(page):
    """生成 ref 快照，失败时静默降级为空"""
    try:
        return page.evaluate(_SNAP_JS)
    except Exception:
        return None


def _want_snapshot(params):
    return str(params.get('snapshot', 'true')).lower() not in ('0', 'false', 'no')


def _norm_url(u):
    return u if urllib.parse.urlparse(u).scheme else 'https://' + u


def _wait_idle(page, ms):
    try:
        page.wait_for_load_state('networkidle', timeout=ms)
    except Exception:
        logging.debug("swallow", exc_info=True)


def _page_title(page):
    try:
        return page.title()
    except Exception:
        return ''


# ---- session 管理 ----
def get_session(name='default', config=None):
    _start_reaper()  # 确保空闲回收线程已启动
    # 会话隔离：wb_* 会话名原样保留，每个对话框用独立 Chromium 实例 + 独立
    # profile（登录态/标签页/截图互相零影响）。仅对空名回退 default。
    if not name:
        name = 'default'
    with _sessions_lock:
        s = _sessions.get(name)
        if s is None:
            s = BrowserSession(name, config)
            _sessions[name] = s
        return s


def close_session(name):
    with _sessions_lock:
        s = _sessions.pop(name, None)
    if s:
        return s.close()
    return {'ok': False, 'error': '会话不存在: %s' % name}


def list_sessions():
    with _sessions_lock:
        return [{'name': k, 'profile': v.profile_dir} for k, v in _sessions.items()]


def kill_session(name='default'):
    """强制重建会话：废弃旧 worker/Chromium（进程可能仍卡死，直接标记+杀树），
    保留 profile（登录态不丢），下次任何动作时惰性重启全新浏览器。"""
    with _sessions_lock:
        s = _sessions.get(name)
    if not s:
        return {'ok': True, 'killed': False, 'error': '会话不存在'}
    s._killed = True
    # 重建前尽力存档标签页（worker 可能死锁，仅读属性不排队，失败不影响重建）
    try:
        s._tabs_archive()
    except Exception:
        logging.debug("swallow", exc_info=True)
    # 杀 Chromium 树（不等 worker——它可能已死锁）
    try:
        s._kill_chromium_tree()
    except Exception:
        logging.debug("swallow", exc_info=True)
    # 丢弃旧线程：新建同目录会话对象替换，登录态 profile 原样保留
    fresh = BrowserSession(name, s.config)
    fresh._killed = True   # 让它首次 _ensure 时再补一次杀树
    # 继承"上次页面"存档：重建后 status 仍能报出回收前的页面，前端可恢复导航
    fresh.last_url = getattr(s, 'last_url', None)
    fresh.last_title = getattr(s, 'last_title', None)
    with _sessions_lock:
        _sessions[name] = fresh
    return {'ok': True, 'killed': True, 'session': name,
            'note': '会话已重建，登录态(profile)保留，下次操作自动重启浏览器',
            'cleaned': s._killed}


# ---- 内置动作实现（fn(engine_unused, params)，用 params['session'] 选会话） ----
def _run_in(session_name, config, fn):
    return get_session(session_name, config).run(fn)


def _act_run(s, params, fn):
    """在正确的会话上执行 fn，且绝不自我死锁。

    dispatch() 已把外层任务投到 worker 线程执行。若此处再对同一会话调
    s.run()，会把内层任务排回同一队列——worker 正忙于外层，自己等自己，
    永久死锁（表现为动作 90s 超时、页面永远"正在加载"）。
    修正：同会话时直接同步调用 fn()（本就在 worker 线程，Playwright
    单线程约束天然满足）；只有跨会话才经目标会话的 run() 排队。
    """
    sn = params.get('session')
    if (sn and sn != s.name) or params.get('config'):
        return _run_in(sn or s.name, params.get('config'), fn)
    return fn()


@register('status')
def _act_status(engine, params):
    sn = params.get('session') or 'default'
    s = get_session(sn)
    # status 是轻量动作：同会话时本就在 worker 线程内，直接读状态；
    # 经 status() 会再排一次队造成自我死锁（同 goto 的教训）
    if s is engine or (engine and sn == engine.name):
        return s.status_inline()
    return s.status()


@register('kill_session')
def _act_kill_session(engine, params):
    return kill_session(params.get('session') or 'default')


@register('touch_human')
def _act_touch_human(engine, params):
    """人机协作：前端在人点击/滚轮/按键时调用，刷新"人正在操作"时间戳。
    轻量动作，直接改内存时间戳，不入 worker 队列（不与页面操作抢锁）。"""
    sn = params.get('session') or 'default'
    s = engine if (engine and sn == engine.name) else get_session(sn)
    s.human_active_ts = _time_mod.time() * 1000
    note = (params.get('note') or '').strip()
    if note:
        s.human_note = note[:200]
    return {'ok': True}


@register('human_status')
def _act_human_status(engine, params):
    """AI 侧查询：人是否在操作（10 秒内静默视为放手）。非阻塞，只是建议。"""
    sn = params.get('session') or 'default'
    s = engine if (engine and sn == engine.name) else get_session(sn)
    note = s.human_note
    active = s.human_active()
    if not active and note:
        s.human_note = ''   # 人放手后消息只读一次
    return {'ok': True, 'human_active': active, 'note': note if active else ''}


@register('viewsource')
def _act_viewsource(engine, params):
    """源代码：mode=raw 服务器原始 HTML（CDP），mode=dom 渲染后 DOM。"""
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        mode = params.get('mode') or 'raw'
        if mode == 'dom':
            return {'ok': True, 'html': page.content()}
        try:
            cdp = ctx.new_cdp_session(page)
            try:
                # 取主框架文档的原始响应体（服务器返回的原始 HTML，未经 DOM 序列化）
                tree = cdp.send('Page.getFrameTree')
                fid = tree['frameTree']['frame']['id']
                r = cdp.send('Page.getResourceContent',
                             {'frameId': fid, 'url': page.url})
                content = r.get('content', '')
                base64_encoded = r.get('base64Encoded', False)
                if base64_encoded:
                    import base64 as _b64
                    content = _b64.b64decode(content).decode('utf-8',
                                                             errors='replace')
                if content:
                    return {'ok': True, 'html': content}
            finally:
                try: cdp.detach()
                except Exception: logging.debug("swallow", exc_info=True)
        except Exception:
            logging.debug("swallow", exc_info=True)
        return {'ok': True, 'html': page.content()}
    return _act_run(s, params, _do)


@register('credentials_save')
def _act_credentials_save(engine, params):
    """把当前页所在域的登录态（cookies+localStorage）存入凭据表。"""
    s = engine
    sn = params.get('session') or 'default'
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        from browser_plugin.credentials import credentials_save
        return credentials_save(ctx, page, session=sn,
                                note=params.get('note', ''))
    return _act_run(s, params, _do)


@register('credentials_restore')
def _act_credentials_restore(engine, params):
    """把凭据表中该域的登录态恢复到当前会话，然后刷新页面生效。
    from_key: 可指定借用其他工作台的登录态（形如 wb2:zf3d.com）。"""
    s = engine
    sn = params.get('session') or 'default'
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        from browser_plugin.credentials import credentials_restore
        r = credentials_restore(ctx, page, session=sn,
                                from_key=params.get('from_key'))
        if r.get('ok'):
            try:
                page.reload(timeout=30000)
            except Exception:
                logging.debug("swallow", exc_info=True)
        return r
    return _act_run(s, params, _do)


@register('credentials_query')
def _act_credentials_query(engine, params):
    """B1: 查询某域名的全部历史登录态（含其他工作台，供打开网站前提示/借用）。"""
    from browser_plugin.credentials import credentials_query
    domain = params.get('domain') or ''
    if not domain:
        return {'ok': False, 'error': '需要 domain 参数'}
    return {'ok': True, 'domain': domain,
            'entries': credentials_query(domain, exclude_session=params.get('session'))}


# ---- B3: IE缓存模式（profile 整档 zip 存取） ----
@register('profile_mode_save')
def _act_profile_mode_save(engine, params):
    """把当前浏览器 profile 整体打包为登录态档案（含缓存/IndexedDB，比快照更彻底）。"""
    from browser_plugin.login_state import profile_save
    return profile_save(params.get('name') or 'default')

@register('profile_mode_restore')
def _act_profile_mode_restore(engine, params):
    """还原登录态档案到 profile（建议先 close 浏览器会话再还原）。"""
    from browser_plugin.login_state import profile_restore
    return profile_restore(params.get('name') or '')

@register('profile_mode_list')
def _act_profile_mode_list(engine, params):
    from browser_plugin.login_state import profile_list
    return {'ok': True, 'states': profile_list()}

@register('profile_mode_delete')
def _act_profile_mode_delete(engine, params):
    from browser_plugin.login_state import profile_delete
    name = params.get('name') or ''
    if not name:
        return {'ok': False, 'error': '需要 name 参数'}
    return profile_delete(name)


# ---- C2: 登录态失效自动重登（联动密码库 vault） ----
@register('auto_relogin')
def _act_auto_relogin(engine, params):
    """当前页疑似登录页时，从密码库取该站账号自动填表登录。
    domain 不传则自动取当前页域名。成功后建议 credentials_save 保存新登录态。"""
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        domain = params.get('domain')
        if not domain:
            from browser_plugin.credentials import _domain_of
            domain = _domain_of(page.url)
        if not domain:
            return {'ok': False, 'error': '无法确定域名，请传 domain 参数'}
        from browser_plugin.auto_relogin import auto_relogin
        return auto_relogin(page, domain, username=params.get('username'))
    return _act_run(s, params, _do)


# ---- C1: 登录失效检测（goto 后判断是否落在登录页） ----
_LOGIN_URL_HINTS = ('login', 'signin', 'sign-in', 'auth', 'passport', 'sso.',
                    'account.versionslogin')

def _detect_login_page(page):
    """检测当前页是否疑似登录页。返回 {'login_required': bool, 'hint': str}"""
    try:
        url = (page.url or '').lower()
        if any(h in url for h in _LOGIN_URL_HINTS):
            return {'login_required': True,
                    'hint': '当前 URL 疑似登录页，登录态可能已失效。可尝试：'
                            '1) credentials_restore 恢复其他登录态；'
                            '2) 用密码簿账号密码重新登录后 credentials_save 保存新登录态。'}
        title = (page.title() or '').lower()
        if any(k in title for k in ('登录', 'log in', 'sign in', '登陆')):
            return {'login_required': True,
                    'hint': '页面标题疑似登录页，登录态可能已失效。可尝试恢复历史登录态或用密码簿重登。'}
    except Exception:
        logging.debug("swallow", exc_info=True)
    return {'login_required': False}


@register('credentials_list')
def _act_credentials_list(engine, params):
    from browser_plugin.credentials import credentials_list
    return {'ok': True, 'entries': credentials_list()}


@register('credentials_delete')
def _act_credentials_delete(engine, params):
    from browser_plugin.credentials import credentials_delete
    key = params.get('key') or ''
    if not key:
        return {'ok': False, 'error': '需要 key（形如 default:zf3d.com）'}
    return credentials_delete(key)


# ---- 服务退出钩子：保证所有活跃会话 context.close()，profile 完整落盘 ----
import atexit as _atexit

def _shutdown_all_sessions():
    for name, s in list(_sessions.items()):
        try:
            if s._ctx:
                s._ctx.close()
                s._ctx = None
        except Exception:
            logging.debug("swallow", exc_info=True)

_atexit.register(_shutdown_all_sessions)


@register('close')
def _act_close(engine, params):
    s = engine
    sn = params.get('session') or 'default'
    if params.get('close_session'):
        return close_session(sn)
    s = _sessions.get(sn)
    if not s:
        return {'ok': True, 'closed': False}
    # 只关浏览器上下文，保留会话对象（同会话直接执行，不再排队）
    def _do(s=s):
        if s._ctx:
            try:
                s._ctx.close()
            except Exception:
                logging.debug("swallow", exc_info=True)
        s._ctx = None
        s.active = None
        return {'ok': True, 'closed': True}
    if s is engine or (engine and sn == engine.name):
        return _do()
    return s.run(_do)


@register('resize')
def _act_resize(engine, params):
    """把视口调整到画布浏览器节点显示区的真实像素尺寸，截图即所见比例。"""
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        w = max(320, min(int(params.get('width') or 0), 3840))
        h = max(240, min(int(params.get('height') or 0), 2160))
        page.set_viewport_size({'width': w, 'height': h})
        try:
            s.screenshot_path(page)   # 立即按新视口出图，避免旧比例残影
        except Exception:
            logging.debug("swallow", exc_info=True)
        return {'ok': True, 'width': w, 'height': h}
    return _act_run(s, params, _do)


@register('snapshot')
def _act_snapshot(engine, params):
    """轻量 accessibility 快照：返回可交互元素清单（带 ref），click/fill 可直接用 ref 定位。
    也可传 selector 只快照某个区域。"""
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        snap = _snap(page)
        return {'ok': True, 'url': page.url, 'title': page.title(),
                'snapshot': snap if snap is not None else '(快照失败，可用 content 兜底)'}
    return _act_run(s, params, _do)


@register('goto')
def _act_goto(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        url = (params.get('url') or '').strip()
        if not url:
            return {'ok': False, 'error': '缺少 url'}
        # [20261126 安全收口A1] 出域闸门接线：导航前过 browser_guard 域名分级
        # （kill_switch/黑名单/高危TLD 一律 block；caution/unknown 放行留痕）。
        # 闸门异常不阻塞导航（fail-open，防闸门 bug 瘫痪正常使用）。
        try:
            import browser_guard
            g = browser_guard.check_navigation(url)
            if g.get('decision') == 'block':
                return {'ok': False, 'blocked_by': 'browser_guard',
                        'error': '导航被安全闸门拦截: %s' % g.get('reason', '')}
            # 【M1.3】能力策略 browser：用户规则 deny 即拒（目标=导航 URL）
            from util_policy import get_default_engine as _pol_gde
            _pol_d = _pol_gde().decide('browser', url)
            if _pol_d.action == 'deny':
                return {'ok': False, 'blocked_by': 'policy',
                        'error': '导航被用户策略拒绝（%s）' % url[:60]}
        except Exception:
            logging.debug("swallow", exc_info=True)
        # [20261114 共享登录态] 导航前自动注入该域已保存的最新 cookie（跨会话/跨重启记住登录）
        try:
            from browser_plugin.credentials import credentials_auto_inject
            inj = credentials_auto_inject(ctx, url)
            if inj.get('ok'):
                _inj_note = True   # 注入后需 reload 一次让 cookie 生效（见下方二次导航）
        except Exception:
            logging.debug("swallow", exc_info=True)
        page.goto(_norm_url(url), timeout=s.config['goto_timeout'], wait_until='domcontentloaded')
        # [20261126 安全收口A1] 导航落地后过提示注入扫描（页面内容含"忽略之前指令/外传密钥"类话术告警）
        try:
            import browser_guard
            browser_guard.scan_injection(page.content()[:20000])
        except Exception:
            logging.debug("swallow", exc_info=True)
        # 【M1.5】不可信内容标记：从落地页面提取 URL 域名登记（策略判定时命中即升级 ask）
        try:
            import util_untrusted as _uu
            _uu.mark_from_text(page.content()[:20000], source='browser_page')
        except Exception:
            logging.debug("swallow", exc_info=True)
        # [20261114 共享登录态] 注入过 cookie 时重载一次页面，让服务端按登录态渲染
        try:
            if locals().get('_inj_note'):
                page.reload(timeout=s.config['goto_timeout'], wait_until='domcontentloaded')
        except Exception:
            logging.debug("swallow", exc_info=True)
        # [20261114 共享登录态] 导航后静默回写该域最新 cookie 到共享库（登录保鲜，跨会话复用）
        try:
            from browser_plugin.credentials import credentials_autosave
            credentials_autosave(ctx, page)
        except Exception:
            logging.debug("swallow", exc_info=True)
        _wait_idle(page, min(int(s.config['networkidle_wait']), 1500))  # 上限压到 1.5s，SPA 由快照前的渲染等待兜底
        s._tabs_archive()   # 导航后存档标签页（重启后可恢复）
        # 导航成功后自动截图，供画布节点 /api/browser?action=shot 展示
        try:
            s.screenshot_path(page)
        except Exception:
            logging.debug("swallow", exc_info=True)
        r = {'ok': True, 'url': page.url, 'title': page.title()}
        if _want_snapshot(params):
            # 导航结果直接附带 ref 快照，省掉单独一次 content 调用
            r['snapshot'] = _snap(page) or '(快照不可用)'
        # B2: 附带该域历史登录态（其他工作台存的），供 AI 提示一键借用
        try:
            from browser_plugin.credentials import credentials_query
            from urllib.parse import urlparse
            dom = urlparse(page.url).hostname or ''
            if dom:
                r['cred_history'] = credentials_query(dom)
        except Exception:
            logging.debug("swallow", exc_info=True)
        # C1: 检测是否落在登录页（登录态失效）
        try:
            r.update(_detect_login_page(page))
        except Exception:
            logging.debug("swallow", exc_info=True)
        return r
    return _act_run(s, params, _do)


@register('back')
def _act_back(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        page.go_back(timeout=30000, wait_until='domcontentloaded')
        _wait_idle(page, 2000)
        page = s._pick_page(params.get('index'))   # 导航后重新取，确保拿到当前页
        try:
            s.screenshot_path(page)   # 等页面稳定后再截图，避免截到加载中的旧画面
        except Exception:
            logging.debug("swallow", exc_info=True)
        return {'ok': True, 'url': page.url, 'title': _page_title(page)}
    return _act_run(s, params, _do)


@register('forward')
def _act_forward(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        page.go_forward(timeout=30000, wait_until='domcontentloaded')
        _wait_idle(page, 2000)
        page = s._pick_page(params.get('index'))
        try:
            s.screenshot_path(page)
        except Exception:
            logging.debug("swallow", exc_info=True)
        return {'ok': True, 'url': page.url, 'title': _page_title(page)}
    return _act_run(s, params, _do)


@register('reload')
def _act_reload(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        page.reload(timeout=s.config['goto_timeout'], wait_until='domcontentloaded')
        try:
            s.screenshot_path(page)
        except Exception:
            logging.debug("swallow", exc_info=True)
        return {'ok': True, 'url': page.url, 'title': page.title()}
    return _act_run(s, params, _do)


@register('click')
def _act_click(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        if 'x' in params and 'y' in params:
            btn = {'right': 'right', 'middle': 'middle'}.get(params.get('button'), 'left')
            for _ in range(int(params.get('clickCount', 1))):
                page.mouse.click(params['x'], params['y'], button=btn)
            return {'ok': True, 'url': page.url}
        sel = params.get('selector') or ''
        ref = params.get('ref') or ''
        text = params.get('text')
        # frame 穿透：极验等验证码嵌在 iframe 里
        _t = page.frame_locator(params['frame']) if params.get('frame') else page
        if ref:
            # ref 来自最近一次快照注入的 data-zfref，同页面内解析保证原子性；
            # 失效（页面跳转/DOM 重建）时提示重新 snapshot
            loc = '[data-zfref="%s"]' % ref
            try:
                _t.locator(loc).first.click(timeout=8000)
            except Exception:
                return {'ok': False, 'error': 'ref %s 已失效（页面已跳转或 DOM 变化），请重新 snapshot 后再操作' % ref}
        elif text:
            page.get_by_text(text, exact=bool(params.get('exact'))).first.click(timeout=15000)
        elif sel:
            page.click(sel, timeout=15000)
        else:
            return {'ok': False, 'error': '需要 ref 或 selector 或 text 或 x/y'}
        page.wait_for_load_state('domcontentloaded', timeout=15000)
        r = {'ok': True, 'url': page.url}
        if _want_snapshot(params):
            r['snapshot'] = _snap(page) or '(快照不可用)'  # 点击后立刻给新快照，下一步可直接接力
        return r
    return _act_run(s, params, _do)


@register('fill')
def _act_fill(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        sel = params.get('selector') or ''
        ref = params.get('ref') or ''
        if not (sel or ref):
            return {'ok': False, 'error': '需要 ref 或 selector'}
        loc = '[data-zfref="%s"]' % ref if ref else sel
        _t = page.frame_locator(params['frame']) if params.get('frame') else page
        try:
            try:
                page.locator(loc).first.click(timeout=5000)
            except Exception:
                logging.debug("swallow", exc_info=True)  # 点击聚焦失败不阻断，fill 本身也会定位
            page.fill(loc, params.get('value', ''), timeout=15000)
        except Exception:
            if ref:
                return {'ok': False, 'error': 'ref %s 已失效（页面已跳转或 DOM 变化），请重新 snapshot 后再操作' % ref}
            raise
        return {'ok': True}
    return _act_run(s, params, _do)


@register('press')
def _act_press(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        # 优先对最近操作目标（记录在 params 里，前端传 target ref/selector）或当前焦点元素按 Enter
        ref = params.get('ref') or ''
        sel = params.get('selector') or ''
        target = None
        if ref:
            target = '[data-zfref="%s"]' % ref
        elif sel:
            target = sel
        if target:
            try:
                page.locator(target).first.click(timeout=5000)
            except Exception:
                logging.debug("swallow", exc_info=True)
            try:
                page.locator(target).first.press(params.get('key') or 'Enter', timeout=5000)
                return {'ok': True, 'focused': True}
            except Exception:
                logging.debug("swallow", exc_info=True)
        else:
            # 无目标：对当前焦点元素按（聚焦 body 兜底）
            try:
                page.evaluate("document.activeElement && document.activeElement !== document.body ? document.activeElement : null")
            except Exception:
                logging.debug("swallow", exc_info=True)
        page.keyboard.press(params.get('key') or 'Enter')
        return {'ok': True}
    return _act_run(s, params, _do)


@register('key')
def _act_key(engine, params):
    """按键/文本输入：text=整段文本（含中文，逐字打进当前焦点元素）；
    key=单字符（type）或 Playwright 键名（Enter/Backspace/Control+a…）。"""
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        t = params.get('text')
        if t:
            # 整段输入（含中文/粘贴文本）：直接 type 到当前焦点元素
            try:
                delay = max(0, min(120, int(params.get('delay') or 12)))
            except Exception:
                delay = 12
            page.keyboard.type(str(t), delay=delay)
            return {'ok': True}
        k = params.get('key') or ''
        if len(k) == 1:
            page.keyboard.type(k)
        elif k:
            page.keyboard.press(k)
        # 防锁键保险：释放可能卡住的修饰键（press 内部 down+up，但异常中断可能残留 down 状态）
        for _mk in ('Control', 'Shift', 'Alt', 'Meta'):
            try:
                page.keyboard.up(_mk)
            except Exception:
                logging.debug("swallow", exc_info=True)
        return {'ok': True}
    return _act_run(s, params, _do)


@register('wheel')
def _act_wheel(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        # 修复滚轮"失效/爆卡"：
        # 1) 先把鼠标移到目标坐标 —— mouse.wheel 只在当前鼠标位置滚动，
        #    不 move 的话滚轮作用在上次点击的旧位置，可能落在不可滚动区域 → 看起来"失效"。
        try:
            _x = params.get('x'); _y = params.get('y')
            if _x is not None and _y is not None:
                page.mouse.move(max(0, float(_x)), max(0, float(_y)))
        except Exception:
            logging.debug("swallow", exc_info=True)
        # 2) 先释放残留修饰键（Ctrl/Shift 卡住时滚轮会变成缩放/横向滚动 → 页面爆卡）
        for _mk in ('Control', 'Shift', 'Alt', 'Meta'):
            try:
                page.keyboard.up(_mk)
            except Exception:
                logging.debug("swallow", exc_info=True)
        # 3) 滚动并给页面一点渲染时间，避免截图流立刻抓到未渲染帧（白屏闪烁/卡顿感）
        page.mouse.wheel(0, params.get('deltaY', 0))
        try:
            page.wait_for_timeout(80)
        except Exception:
            logging.debug("swallow", exc_info=True)
        return {'ok': True}
    return _act_run(s, params, _do)


@register('scrollinfo')
def _act_scrollinfo(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        try:
            info = page.evaluate("() => ({sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, sy: window.scrollY || document.documentElement.scrollTop || 0})")
        except Exception:
            info = {'sh': 0, 'ch': 0, 'sy': 0}
        info['ok'] = True
        return info
    return _act_run(s, params, _do)


@register('scrollto')
def _act_scrollto(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        try:
            _y = max(0, float(params.get('y', 0)))
            page.evaluate("(y) => { window.scrollTo(0, y); }", _y)
            page.wait_for_timeout(80)
        except Exception:
            logging.debug("swallow", exc_info=True)
        return {'ok': True}
    return _act_run(s, params, _do)


@register('screenshot')
def _act_screenshot(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        p = s.screenshot_path(page, bool(params.get('full')))
        return {'ok': True, 'data': s.screenshot_data(p),
                'url': page.url, 'title': page.title(), 'ts': int(time.time())}
    return _act_run(s, params, _do)


@register('shot_jpeg')
def _act_shot_jpeg(engine, params):
    """轻量 JPEG 帧：给前端轮询推帧用（体积小、快）。"""
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        p = s.screenshot_jpeg_path(page, params.get('quality') or 80)
        return {'ok': True, 'path': p, 'sig': s.frame_sig(), 'url': page.url}
    return _act_run(s, params, _do)


@register('stream_start')
def _act_stream_start(engine, params):
    """启动 CDP screencast：Chromium 画面变化时主动推帧（worker 线程内）。"""
    s = engine
    def _do():
        return s.stream_start(params.get('quality') or 60)
    return _act_run(s, params, _do)


@register('stream_stop')
def _act_stream_stop(engine, params):
    s = engine
    def _do():
        return s.stream_stop()
    return _act_run(s, params, _do)


@register('stream_poll')
def _act_stream_poll(engine, params):
    """画布节点实时流轮询：驱动一次 pump（落盘最新帧），返回流帧签名。
    前端高频轮询本动作，签名变了才拉 /api/browser?action=shot&src=stream 图。"""
    s = engine
    def _do():
        sig = s.stream_pump()
        # 自愈：推流掉了（服务重启/会话回收/newtab 后未重启）且没有其他节点在推流时，自动重启
        streaming = bool(getattr(s, '_stream_on', False))
        if not streaming:
            try:
                r = s.stream_start(60)
                streaming = bool(r.get('streaming'))
                if streaming:
                    s.stream_pump()  # 立即落一帧，避免前端继续拉旧图
                    sig = s.stream_sig()
            except Exception as e:
                import logging
                _sid = getattr(s, 'sid', None) or getattr(s, 'name', None) or id(s)
                logging.getLogger(__name__).warning('stream 自愈重启失败(会话=%s): %s', _sid, e)
        url = ''
        try:
            url = s.active.url
        except Exception:
            logging.debug("swallow", exc_info=True)
        # 标签跟随：URL 变了才回读一次标题（缓存），供前端标题栏立即同步
        title = ''
        try:
            if url and url != getattr(s, '_poll_url', None):
                s._poll_url = url
                s.last_title = s.active.title()
            title = getattr(s, 'last_title', '') or ''
        except Exception:
            logging.debug("swallow", exc_info=True)
        return {'ok': True, 'sig': sig, 'url': url, 'title': title,
                'streaming': bool(getattr(s, '_stream_on', False)),
                'human_active': s.human_active(), 'human_note': (s.human_note if s.human_active() else ''),
                'ai_active': s.ai_active()}
    return _act_run(s, params, _do)


_ZF_EXTRACT_JS = r"""
() => {
  // Readability 风格正文提取（无外部依赖，纯内置 JS）
  const CAND = 'article,main,[role=main],[role=article],.article,#article,.content,#content,.post,.entry,#main';
  const BAD  = 'script,style,noscript,template,nav,header,footer,aside,form,iframe,svg,canvas,video,audio,select,button,[aria-hidden=true],.ad,.ads,.advert,.banner,.sidebar,.comment,.comments,.footer,.header,.nav,.menu,.breadcrumb,.pagination,.share,.social,.related,.recommend,.popup,.modal,.cookie';
  const RM = el => { el.querySelectorAll(BAD).forEach(n => n.remove()); };
  const txtOf = el => {
    const c = el.cloneNode(true); RM(c);
    return (c.textContent || '').replace(/[\\t ]+/g, ' ')
      .replace(/\\n{3,}/g, '\\n\\n').trim();
  };
  const doc = txtOf(document.body);
  // 候选容器打分：文本量 + 段落密度 + 标题/标签加分
  let best = null, bestScore = 0;
  document.querySelectorAll(CAND).forEach(el => {
    if (!el || el === document.body) return;
    const r = el.getBoundingClientRect();
    if (r.width < 200 || r.height < 200) return;
    const t = txtOf(el);
    if (t.length < 200) return;
    const paras = el.querySelectorAll('p,li,pre,blockquote,h1,h2,h3,h4').length;
    const linkTxt = [...el.querySelectorAll('a')].reduce((s, a) => s + (a.innerText || '').length, 0);
    const len = t.length;
    let score = len + paras * 80 - linkTxt * 0.6;
    if (/^(article|main)$/i.test(el.tagName)) score *= 1.3;
    if (el.querySelector('h1,h2')) score *= 1.15;
    if (score > bestScore) { bestScore = score; best = el; }
  });
  const title = document.title || '';
  let text, container = 'body';
  if (best && bestScore > doc.length * 0.5) {
    text = txtOf(best); container = (best.tagName || '').toLowerCase() +
      (best.id ? '#' + best.id : '') + (best.className && typeof best.className === 'string' ? '.' + best.className.trim().split(/\\s+/).slice(0, 3).join('.') : '');
  } else { text = doc; }
  if (text.length < 150 && doc.length >= text.length) { text = doc; container = 'body'; }
  // 可交互元素清单（给模型看的 ref 索引）
  const acts = [];
  document.querySelectorAll('a[href],button,input,select,textarea,[role=button],[onclick],[data-zfref]').forEach((el, i) => {
    if (acts.length >= 150) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const vis = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    if (!vis) return;
    const ref = el.getAttribute('data-zfref') || ('e' + i);
    const label = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') ||
      el.getAttribute('title') || (el.tagName === 'A' ? el.getAttribute('href') : '') || '').trim().slice(0, 60);
    acts.push({ ref, tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '', label, href: el.tagName === 'A' ? (el.getAttribute('href') || '').slice(0, 200) : '' });
  });
  return { title, container, chars: text.length, bodyChars: doc.length,
           links: document.querySelectorAll('a[href]').length, text, actions: acts };
}
"""

@register('content')
def _act_content(engine, params):
    """页面内容读取：mode=auto（默认）智能提取正文+可交互清单；mode=raw 兼容旧整页 HTML。"""
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        mode = (params.get('mode') or 'auto').lower()
        info = {'ok': True, 'url': page.url, 'title': page.title(), 'mode': mode}
        if mode == 'raw':
            info['html'] = page.content()[:300000]
            return info
        try:
            r = page.evaluate(_ZF_EXTRACT_JS)
            r['text'] = (r.get('text') or '')[:60000]
            info['container'] = r.get('container')
            info['stats'] = {'chars': r.get('chars'), 'bodyChars': r.get('bodyChars'),
                             'links': r.get('links'), 'actions': len(r.get('actions') or [])}
            info['text'] = r.get('text')
            info['actions'] = (r.get('actions') or [])[:150]
        except Exception as e:
            # 提取失败自动回落 raw，保证不丢内容
            info['mode'] = 'raw(fallback)'
            info['fallback_reason'] = str(e)[:200]
            info['html'] = page.content()[:300000]
        return info
    return _act_run(s, params, _do)


@register('evaluate')
def _act_evaluate(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        return {'ok': True, 'result': page.evaluate(params.get('expr') or '1')}
    return _act_run(s, params, _do)


@register('console')
def _act_console(engine, params):
    s = engine
    """读取页面控制台/错误日志（类似 F12 Console）。
    参数: level=error 只看错误; limit=N 条数; clear=true 读取后清空。"""
    def _do():
        ctx, page = s._ensure()
        logs = s.console_dump(level=params.get('level'),
                              limit=params.get('limit', 200),
                              clear=str(params.get('clear', '')).lower() in ('1', 'true', 'yes'))
        return {'ok': True, 'url': page.url, 'count': len(logs), 'logs': logs}
    return _act_run(s, params, _do)


@register('net_dump')
def _act_net_dump(engine, params):
    s = engine
    """读取最近网络响应（类似 F12 Network）。
    参数: keyword 按 URL/类型过滤; limit 条数; body_index=-1 时同时返回该条响应体(仅JSON/文本)。"""
    def _do():
        ctx, page = s._ensure()
        r = s.net_dump(keyword=params.get('keyword'),
                       limit=params.get('limit', 50),
                       body_index=params.get('body_index'))
        r['ok'] = 'error' not in r
        return r
    return _act_run(s, params, _do)


@register('net_wait')
def _act_net_wait(engine, params):
    s = engine
    """等待网络响应出现（用于提交后等结果接口）。
    参数: keyword=URL 关键词(必填); timeout=最长等待秒(默认30); poll=轮询间隔秒(默认0.5)。
    命中后可直接带 body=true 同时返回响应体。"""
    def _do():
        import time as _t
        ctx, page = s._ensure()
        kw = params.get('keyword')
        if not kw:
            return {'ok': False, 'error': '需要 keyword 参数（URL 关键词）'}
        timeout = float(params.get('timeout', 30) or 30)
        # 语义：先查历史缓冲（前一步触发的请求往往已完成），未命中再等待新响应
        deadline = _t.time() + timeout
        poll = max(0.2, float(params.get('poll', 0.5) or 0.5))
        want_body = str(params.get('body', '')).lower() in ('1', 'true', 'yes')
        fresh_only = str(params.get('fresh', '')).lower() in ('1', 'true', 'yes')
        with s._lock:
            start_count = 0 if not fresh_only else len(s.net_logs)
        hit = None
        while _t.time() < deadline:
            with s._lock:
                cand = list(s.net_logs)[start_count:]
            for x in cand:
                if kw.lower() in x['url'].lower() or kw.lower() in x.get('type', ''):
                    hit = x
                    break
            if hit:
                break
            _t.sleep(poll)
        if not hit:
            return {'ok': False, 'error': '等待超时(%ss)：未出现 URL 含 %r 的响应' % (int(timeout), kw)}
        r = {'ok': True, 'meta': hit}
        if want_body:
            # 按 hit 的完整 URL 精确过滤（URL 唯一），body_index=0 取过滤后唯一一条，避免 -1 拿错请求的 body
            body_r = s.net_dump(keyword=hit['url'], limit=1, body_index=0,
                                max_body=params.get('max_body', 100000))
            if 'body' in body_r:
                r['body'] = body_r['body']
        return r
    return _act_run(s, params, _do)


@register('record_video')
def _act_record_video(engine, params):
    s = engine
    """录像当前页面操作过程（独立 context 录制，结束落盘 webm）。
    参数: action=start 开启录制(可选 url 先导航) / stop 结束并落盘。
    注意：同步 API 下视频只在 context 关闭时写盘，故 stop 通过关闭录制 context 落盘；
    录制 context 与主浏览 context 共享 storage_state（登录态），但标签独立。"""
    def _do():
        act = (params.get('action') or 'start').lower()
        if act == 'start':
            if getattr(s, '_rec_ctx', None):
                return {'ok': False, 'error': '已在录制中，先 action=stop'}
            ctx, page = s._ensure()
            rec_dir = os.path.join(os.path.dirname(s.profile_dir), '..', 'recordings')
            rec_dir = os.path.normpath(rec_dir)
            os.makedirs(rec_dir, exist_ok=True)
            try:
                state = ctx.storage_state()
            except Exception:
                state = None
            kw = dict(record_video_dir=rec_dir,
                      record_video_size={'width': 1280, 'height': 720},
                      viewport={'width': 1280, 'height': 720})
            if state:
                kw['storage_state'] = state
            s._rec_ctx = ctx.browser.new_context(**kw)
            url = params.get('url')
            p = s._rec_ctx.new_page()
            if url:
                p.goto(url, timeout=60000)
            return {'ok': True, 'started': True, 'note': '录制中，结束请再调 record_video 且 action=stop'}
        if act == 'stop':
            rc = getattr(s, '_rec_ctx', None)
            if not rc:
                return {'ok': False, 'error': '当前没有进行中的录制'}
            path = None
            pages = list(rc.pages)
            try:
                rc.close()  # 视频在 context 关闭时才最终落盘，path 必须在 close 之后取
                for p in pages:
                    try:
                        path = p.video.path()
                    except Exception:
                        logging.debug("swallow", exc_info=True)
            finally:
                s._rec_ctx = None
            # 磁盘上限：保留最新 20 个录像
            try:
                vids = sorted(_glob_mod.glob(os.path.join(os.path.dirname(s.profile_dir), '..', 'recordings', '*.webm')),
                              key=_os_mod.path.getmtime)
                for f in vids[:-20]:
                    os.remove(f)
            except Exception:
                logging.debug("swallow", exc_info=True)
            return {'ok': True, 'video': path, 'dir': os.path.normpath(os.path.join(os.path.dirname(s.profile_dir), '..', 'recordings'))}
        return {'ok': False, 'error': 'action 仅支持 start/stop'}
    return _act_run(s, params, _do)


@register('download_list')
def _act_download_list(engine, params):
    s = engine
    """查看已捕获的文件下载记录与保存目录。参数: limit 条数。"""
    def _do():
        ctx, page = s._ensure()
        r = s.download_list(limit=params.get('limit', 20))
        r['ok'] = True
        return r
    return _act_run(s, params, _do)


@register('upload_file')
def _act_upload_file(engine, params):
    s = engine
    """向页面 file input 上传本地文件。
    参数: path=本地文件绝对路径(必填); selector=目标 input 选择器(可选, 默认 input[type=file])。"""
    def _do():
        ctx, page = s._ensure()
        return s.upload_file(selector=params.get('selector'), path=params.get('path'))
    return _act_run(s, params, _do)


@register('tabs')
def _act_tabs(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        try:
            ai = ctx.pages.index(s.active) if s.active in ctx.pages else 0
        except Exception:
            ai = 0
        return {'ok': True, 'active': ai,
                'tabs': [{'index': i, 'url': p.url, 'title': p.title()}
                         for i, p in enumerate(ctx.pages)]}
    return _act_run(s, params, _do)


@register('newtab')
def _act_newtab(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        max_tabs = int(s.config.get('max_tabs', 100))
        if len(ctx.pages) >= max_tabs:
            return {'ok': False, 'error': '标签页已达上限 %d 个，请先关闭部分标签（closetab）' % max_tabs}
        p2 = ctx.new_page()
        s.active = p2
        u = params.get('url')
        if u:
            p2.goto(_norm_url(u), timeout=s.config['goto_timeout'], wait_until='domcontentloaded')
        s.stream_follow_active()
        return {'ok': True, 'index': len(ctx.pages) - 1, 'url': p2.url}
    return _act_run(s, params, _do)


@register('newtabs')
def _act_newtabs(engine, params):
    """批量开标签：urls 数组逐个新开标签页并加载，每个 url 独立过安全闸门，单个失败不影响其余。"""
    s = engine
    def _do():
        ctx, page = s._ensure()
        urls = params.get('urls') or []
        if isinstance(urls, str):
            urls = [u.strip() for u in urls.replace(',', '\n').split('\n') if u.strip()]
        urls = [str(u) for u in urls if str(u).strip()][:30]  # 单次最多 30 个，防误传
        if not urls:
            return {'ok': False, 'error': '缺少 urls 数组'}
        max_tabs = int(s.config.get('max_tabs', 100))
        results = []
        for u in urls:
            if len(ctx.pages) >= max_tabs:
                results.append({'url': u, 'ok': False, 'error': '已达标签上限 %d，剩余未开' % max_tabs})
                continue
            # 与 goto 同级的安全闸门（block 即跳过该 url，不中断批次）
            try:
                import browser_guard
                g = browser_guard.check_navigation(u)
                if g.get('decision') == 'block':
                    results.append({'url': u, 'ok': False, 'blocked_by': 'browser_guard',
                                    'error': '导航被安全闸门拦截: %s' % g.get('reason', '')})
                    continue
            except Exception:
                logging.debug("swallow", exc_info=True)
            try:
                p2 = ctx.new_page()
                p2.goto(_norm_url(u), timeout=s.config['goto_timeout'], wait_until='domcontentloaded')
                # 提示注入扫描（同 goto 收口策略）
                try:
                    import browser_guard
                    browser_guard.scan_injection(p2.content()[:20000])
                except Exception:
                    logging.debug("swallow", exc_info=True)
                try:
                    _t = p2.title()
                except Exception:
                    _t = ''
                results.append({'url': p2.url, 'ok': True, 'index': ctx.pages.index(p2), 'title': _t})
            except Exception as e:
                results.append({'url': u, 'ok': False, 'error': str(e)[:200]})
        # 批量结束后统一存档+推流跟随，避免每开一个就触发一次
        s.stream_follow_active()
        s._tabs_archive()
        n_ok = sum(1 for r in results if r.get('ok'))
        return {'ok': n_ok > 0, 'opened': n_ok, 'total': len(urls), 'results': results}
    return _act_run(s, params, _do)


@register('switchtab')
def _act_switchtab(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        idx = int(params.get('index', 0))
        if 0 <= idx < len(ctx.pages):
            s.active = ctx.pages[idx]
            s.stream_follow_active()
            # chrome-error://chromewebdata 等特殊页上调 title() 会抛异常/阻塞 → 切标签超慢+误报错
            try:
                _t = s.active.title()
            except Exception:
                _t = ''
            try:
                _u = s.active.url
            except Exception:
                _u = ''
            return {'ok': True, 'index': idx, 'url': _u, 'title': _t}
        return {'ok': False, 'error': 'tab 不存在'}
    return _act_run(s, params, _do)


@register('closetab')
def _act_closetab(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        idx = int(params.get('index', 0))
        if 0 <= idx < len(ctx.pages):
            pg = ctx.pages[idx]
            pg.close()
            if s.active is pg:
                s.active = ctx.pages[0] if ctx.pages else None
            s.stream_follow_active()
            return {'ok': True, 'closed': idx, 'tabs': len(ctx.pages)}
        return {'ok': False, 'error': 'tab 不存在'}
    return _act_run(s, params, _do)


# -*- coding: utf-8 -*-
# 拆分分段模块：由原 engine.py 按行段【无改动】切分，由同名门面加载合并。
# ================== 设置（主页 / 轮询间隔等）==================
_SETTINGS_FILE = os.path.join(_PLUGIN_DIR, 'data', 'settings.json')
_DEFAULT_SETTINGS = {'homepage': 'https://www.zf3d.com'}


def _load_settings():
    try:
        with open(_SETTINGS_FILE, encoding='utf-8-sig') as f:
            s = json.load(f) or {}
    except Exception:
        s = {}
    out = dict(_DEFAULT_SETTINGS)
    out.update(s)
    return out


def _save_settings(d):
    os.makedirs(os.path.dirname(_SETTINGS_FILE), exist_ok=True)
    tmp = _SETTINGS_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, _SETTINGS_FILE)


@register('settings_get')
def _act_settings_get(engine, params):
    return {'ok': True, 'settings': _load_settings()}


@register('settings_set')
def _act_settings_set(engine, params):
    cur = _load_settings()
    for k, v in (params.get('settings') or {}).items():
        if k in _DEFAULT_SETTINGS:
            cur[k] = v
    _save_settings(cur)
    return {'ok': True, 'settings': cur}


# ================== 书签（收藏栏）==================
# 存储文件：插件目录 data/bookmarks.json，随插件目录走（免依赖分发自带）
_BOOKMARKS_FILE = os.path.join(_PLUGIN_DIR, 'data', 'bookmarks.json')


def _load_bookmarks():
    try:
        with open(_BOOKMARKS_FILE, encoding='utf-8-sig') as f:
            return json.load(f) or []
    except Exception:
        return []


def _save_bookmarks(items):
    os.makedirs(os.path.dirname(_BOOKMARKS_FILE), exist_ok=True)
    tmp = _BOOKMARKS_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(items, f, ensure_ascii=False, indent=1)
    os.replace(tmp, _BOOKMARKS_FILE)


def _walk_chrome_folder(node, folder, out):
    """递归展平 Chrome/Edge Bookmarks JSON 的文件夹树。"""
    for child in node.get('children', []) or []:
        t = child.get('type')
        if t == 'url':
            out.append({'title': child.get('name') or child.get('url', ''),
                        'url': child.get('url', ''), 'folder': folder})
        elif t == 'folder':
            sub = (folder + ' / ' + child.get('name', '')) if folder else child.get('name', '')
            _walk_chrome_folder(child, sub, out)


@register('bookmarks_list')
def _act_bookmarks_list(engine, params):
    s = engine
    return {'ok': True, 'bookmarks': _load_bookmarks()}


@register('bookmarks_add')
def _act_bookmarks_add(engine, params):
    s = engine
    url = (params.get('url') or '').strip()
    if not url:
        return {'ok': False, 'error': '缺少 url'}
    items = _load_bookmarks()
    if any(b.get('url') == url for b in items):
        return {'ok': True, 'duplicate': True, 'bookmarks': items}
    items.append({'title': params.get('title') or url, 'url': url})
    _save_bookmarks(items)
    return {'ok': True, 'bookmarks': items}


@register('bookmarks_del')
def _act_bookmarks_del(engine, params):
    s = engine
    url = (params.get('url') or '').strip()
    items = _load_bookmarks()
    n = len(items)
    items = [b for b in items if b.get('url') != url]
    if len(items) == n:
        return {'ok': False, 'error': '书签不存在'}
    _save_bookmarks(items)
    return {'ok': True, 'bookmarks': items}


@register('bookmarks_import_chrome')
def _act_bookmarks_import_chrome(engine, params):
    s = engine
    """从本机 Chrome / Edge / Brave 的收藏文件导入全部书签。

    params:
      browser: chrome / edge / brave（默认自动按 chrome→edge→brave 顺序找）
      profile: 浏览器 profile 名，默认 Default
      replace: true 则清空现有书签后导入（默认合并去重）
    """
    browser = (params.get('browser') or '').lower()
    profile = params.get('profile') or 'Default'
    local = os.environ.get('LOCALAPPDATA') or os.path.expanduser('~\\AppData\\Local')
    candidates = []
    if browser:
        candidates.append(os.path.join(local, browser, 'User Data', profile, 'Bookmarks'))
    else:
        for b in ('Google\\Chrome', 'Microsoft\\Edge', 'BraveSoftware\\Brave-Browser'):
            candidates.append(os.path.join(local, b, 'User Data', profile, 'Bookmarks'))

    src = next((p for p in candidates if os.path.exists(p)), None)
    if not src:
        tried = '; '.join(candidates)
        return {'ok': False, 'error': '未找到浏览器收藏文件，尝试过: ' + tried}

    try:
        with open(src, encoding='utf-8-sig') as f:
            data = json.load(f)
    except PermissionError:
        return {'ok': False, 'error': '收藏文件被浏览器占用（浏览器正在运行）。请关闭浏览器后重试，或复制 Bookmarks 文件后指定路径。'}
    except Exception as e:
        return {'ok': False, 'error': '读取收藏文件失败: %s' % e}

    roots = data.get('roots', {})
    out = []
    for key in ('bookmark_bar', 'other', 'synced'):
        node = roots.get(key)
        if node:
            fname = {'bookmark_bar': '收藏栏', 'other': '其他收藏', 'synced': '移动设备'}.get(key, key)
            _walk_chrome_folder(node, fname, out)

    if not out:
        return {'ok': False, 'error': '收藏文件中没有书签: ' + src}

    items = [] if params.get('replace') else _load_bookmarks()
    have = {b.get('url') for b in items}
    added = 0
    for b in out:
        if b['url'] not in have:
            items.append(b)
            have.add(b['url'])
            added += 1
    _save_bookmarks(items)
    return {'ok': True, 'source': src, 'found': len(out), 'added': added,
            'total': len(items), 'bookmarks': items}


# -*- coding: utf-8 -*-
# 拆分分段模块：网站档案扩展（map_site / archive_site）——由门面 engine.py 合并加载。
# 功能：
#   map_site    抓取当前页面同域全部链接（去重归一化，默认限 500 条）
#   archive_site 一键 map + 落档 public/项目记录/网站档案/<域名>.md，追加合并，自动登记 _索引.md
#                 mode=diff 时与已有档案对比，报告新增/失效链接
import os
import re
import json
import time
import urllib.parse

_ARCHIVE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'public', '项目记录', '网站档案')

_LINK_JS = r"""
() => {
  const out = new Map();
  const base = location.origin;
  document.querySelectorAll('a[href]').forEach(a => {
    try {
      const u = new URL(a.href, location.href);
      if (u.origin !== base) return;
      u.hash = '';
      const href = u.href;
      if (!href || href === location.origin + '/') return;
      const label = (a.innerText || a.title || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (!out.has(href) || (label && !out.get(href))) out.set(href, label);
    } catch (e) {}
  });
  return Array.from(out, ([href, label]) => ({href, label}));
}
"""


def _domain_of(url):
    try:
        return urllib.parse.urlparse(url).netloc or 'unknown'
    except Exception:
        return 'unknown'


def _safe_name(domain):
    return re.sub(r'[\\/:*?"<>|]', '_', domain) or 'unknown'


@register('map_site')
def _act_map_site(engine, params):
    """抓取当前页面同域全部链接。params: session, index, limit"""
    sn = params.get('session') or 'default'
    s = get_session(sn)
    limit = max(1, min(int(params.get('limit') or 500), 2000))

    def _do():
        page = s._pick_page(params.get('index'))
        entry = page.url
        try:
            title = page.title()
        except Exception:
            title = ''
        links = page.evaluate(_LINK_JS) or []
        seen = set()
        out = []
        for it in links:
            href = it.get('href')
            if not href or href in seen:
                continue
            seen.add(href)
            out.append({'href': href, 'label': it.get('label') or ''})
            if len(out) >= limit:
                break
        return {'ok': True, 'entry_url': entry, 'title': title,
                'count': len(out), 'links': out}
    r = _run_in(sn, None, _do)
    try:
        _site_mem_touch(_domain_of(r.get('entry_url') or ''), 'map_site',
                        r.get('entry_url') or '', r.get('title') or '',
                        r.get('count') or 0)
    except Exception:
        logging.debug("swallow", exc_info=True)
    return r


# ---------- 站点知识记忆钩子（private/记忆/站点/<域名>.md，隐私区） ----------
# 写入时机绑定在代码路径里（不靠提示词）：archive_site/map_site 调用即自动记录访问。

_SITE_MEM_DIR = os.path.normpath(os.path.join(
    _PLUGIN_DIR, '..', '..', 'private', '记忆', '站点'))


def _site_mem_touch(domain, action, entry, title='', count=0):
    """AI 调 map_site/archive_site 时自动登记一次访问（追加合并，幂等轻量）"""
    try:
        if not domain:
            return
        os.makedirs(_SITE_MEM_DIR, exist_ok=True)
        safe = _safe_name(domain)
        fp = os.path.join(_SITE_MEM_DIR, safe + '.md')
        # 硬校验：落盘路径必须在项目 private 隐私区内，防止相对层级写错导致跨目录误写
        _priv = os.path.normpath(os.path.join(_PLUGIN_DIR, '..', '..', 'private'))
        if not os.path.abspath(fp).startswith(os.path.abspath(_priv) + os.sep):
            raise ValueError('site memory path escapes private dir: %r' % fp)
        now = time.strftime('%Y-%m-%d %H:%M')
        if not os.path.isfile(fp):
            with open(fp, 'w', encoding='utf-8') as f:
                f.write('# 站点记忆：%s\n'
                        '<!-- 密码靠浏览器 profile，此处严禁写密码 -->\n\n' % domain)
        with open(fp, 'a', encoding='utf-8') as f:
            f.write('## 访问记录\n- [%s] %s（%s%s）\n' % (
                now, action, entry,
                (' · ' + str(title)) if title else '',
            ))
    except Exception:
        logging.debug("swallow", exc_info=True)


@register('archive_site')
def _act_archive_site(engine, params):
    """一键抓链接并落档。params: session, title, note, limit, mode('write'|'diff')"""
    sn = params.get('session') or 'default'
    s = get_session(sn)
    limit = max(1, min(int(params.get('limit') or 500), 2000))
    mode = params.get('mode') or 'write'

    def _do():
        page = s._pick_page(params.get('index'))
        entry = page.url
        try:
            title = page.title()
        except Exception:
            title = ''
        links = page.evaluate(_LINK_JS) or []
        seen = set()
        fresh = []
        for it in links:
            href = it.get('href')
            if not href or href in seen:
                continue
            seen.add(href)
            fresh.append({'href': href, 'label': it.get('label') or ''})
            if len(fresh) >= limit:
                break

        domain = _safe_name(_domain_of(entry))
        os.makedirs(_ARCHIVE_DIR, exist_ok=True)
        path = os.path.join(_ARCHIVE_DIR, domain + '.md')
        idx_path = os.path.join(_ARCHIVE_DIR, '_索引.md')

        old_hrefs = set()
        if os.path.isfile(path):
            try:
                with open(path, encoding='utf-8') as f:
                    for line in f:
                        m = re.match(r'^- \[(.*?)\]\((.*?)\)', line.strip())
                        if m:
                            old_hrefs.add(m.group(2))
            except Exception:
                logging.debug("swallow", exc_info=True)

        if mode == 'diff':
            new_links = [l for l in fresh if l['href'] not in old_hrefs]
            gone = sorted(old_hrefs - seen)
            return {'ok': True, 'mode': 'diff', 'domain': domain,
                    'archive': path, 'old_count': len(old_hrefs),
                    'fresh_count': len(fresh),
                    'new': [l['href'] for l in new_links],
                    'gone': gone}

        # write 模式：追加合并
        merged = dict(old_hrefs)
        added = []
        now = time.strftime('%Y-%m-%d %H:%M')
        lines = []
        if not os.path.isfile(path):
            lines.append('# 网站档案：' + (params.get('title') or title or domain))
            lines.append('')
            lines.append('- 入口URL: ' + entry)
            lines.append('- 首次建档: ' + now)
            lines.append('')
        lines.append('## 抓取记录 ' + now)
        if params.get('note'):
            lines.append('> ' + str(params['note']))
        lines.append('')
        for l in fresh:
            star = '' if l['href'] in merged else ' 🆕'
            if l['href'] not in merged:
                added.append(l['href'])
            merged.add(l['href'])
            lines.append('- [%s](%s)%s' % (l['label'] or l['href'], l['href'], star))
        lines.append('')
        with open(path, 'a', encoding='utf-8') as f:
            f.write('\n'.join(lines) + '\n')

        # 登记索引
        idx_line = '- [%s](%s) · %d 链接 · 更新 %s\n' % (
            domain, entry, len(merged), now)
        idx_exists = os.path.isfile(idx_path)
        idx_content = ''
        if idx_exists:
            with open(idx_path, encoding='utf-8') as f:
                idx_content = f.read()
        if ('(' + entry + ')') not in idx_content:
            if not idx_exists:
                idx_content = '# 网站档案索引\n\n'
            idx_content += idx_line
            with open(idx_path, 'w', encoding='utf-8') as f:
                f.write(idx_content)

        return {'ok': True, 'mode': 'write', 'domain': domain,
                'archive': path, 'index': idx_path,
                'fresh_count': len(fresh), 'total': len(merged),
                'added': len(added), 'entry_url': entry}
    r = _run_in(sn, None, _do)
    try:
        if r.get('mode') == 'write':
            _site_mem_touch(_domain_of(r.get('entry_url') or ''),
                            'archive_site', r.get('entry_url') or '',
                            params.get('note') or '')
    except Exception:
        logging.debug("swallow", exc_info=True)
    return r


# -*- coding: utf-8 -*-
"""
engine_seg5 —— 验证码/滑块能力增强（只增不删）：
  1) ocr 动作：ddddocr 识图验证码（selector 元素截图或 path 文件）；滑块缺口偏移（bg+target 双图 slide_match）
  2) shot_element：元素级截图（selector/ref/frame），可带 ocr=True 直接返回识别文本
  3) drag：Playwright 原生 mouse 真实拖拽（加速-过冲-回拉轨迹，trusted 事件）
  4) solve_captcha：组合动作（滑块/文字码自动识别处理）
所有 selector 类动作统一支持 frame 参数穿透 iframe。
"""
import os
import time
import random

_OCR = None
_OCR_ERR = ''


def _get_ocr():
    """ddddocr 懒加载单例；失败时抛出带原因的异常。"""
    global _OCR, _OCR_ERR
    if _OCR is None:
        try:
            import ddddocr
            _OCR = ddddocr.DdddOcr(show_ad=False)
        except Exception as e:
            _OCR_ERR = str(e)
            raise RuntimeError('ddddocr 不可用: %s（可降级用 screenshot+AI 看图识别）' % _OCR_ERR)
    return _OCR


def _tgt(page, params):
    """统一取操作目标：frame 参数存在时返回 frame_locator（.locator() 兼容），否则 page。"""
    fr = params.get('frame')
    if fr:
        return page.frame_locator(fr)
    return page


def _loc(t, params):
    """根据 ref/selector 在目标（page 或 frame_locator）上取 locator。"""
    ref = params.get('ref') or ''
    sel = params.get('selector') or ''
    if ref:
        return t.locator('[data-zfref="%s"]' % ref).first
    if sel:
        return t.locator(sel).first
    return None


def _elem_png_b64(el):
    """元素截图 → (b64, path)"""
    p = os.path.join(os.environ.get('TEMP', '.'), 'zf_shot_%d.png' % int(time.time() * 1000))
    el.screenshot(path=p, timeout=15000)
    with open(p, 'rb') as f:
        import base64
        return base64.b64encode(f.read()).decode('ascii'), p


@register('ocr')
def _act_ocr(engine, params):
    """识图验证码：selector/ref（页面内元素）或 path（本地图片）。
    滑块：bg=背景图selector + target=滑块图selector → 返回缺口 x 偏移 offset。"""
    s = engine

    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        t = _tgt(page, params)
        bg = params.get('bg')
        tg = params.get('target')
        ocr = _get_ocr()
        # 滑块缺口模式：两张图 slide_match
        if bg and tg:
            b1, _ = _elem_png_b64(_loc(t, {'selector': bg}))
            b2, _ = _elem_png_b64(_loc(t, {'selector': tg}))
            import base64 as _b
            r = ocr.slide_match(_b.b64decode(b2), _b.b64decode(b1), simple_target=True)
            off = int(r['target'][0])
            return {'ok': True, 'mode': 'slide', 'offset_x': off, 'detail': r.get('target')}
        # 文字码模式
        el = _loc(t, params)
        if el is not None:
            b64, _p = _elem_png_b64(el)
        elif params.get('path'):
            with open(params['path'], 'rb') as f:
                raw = f.read()
            import base64 as _b
            b64 = _b.b64encode(raw).decode('ascii')
        else:
            return {'ok': False, 'error': '需要 selector/ref（验证码元素）或 path（图片文件）'}
        import base64 as _b
        text = ocr.classification(_b.b64decode(b64))
        return {'ok': True, 'mode': 'text', 'text': text}
    return _act_run(s, params, _do)


@register('shot_element')
def _act_shot_element(engine, params):
    """元素级截图：只截验证码等小元素，体积小识别准；ocr=True 时顺带返回识别文本。"""
    s = engine

    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        t = _tgt(page, params)
        el = _loc(t, params)
        if el is None:
            return {'ok': False, 'error': '需要 ref 或 selector'}
        try:
            el.wait_for(state='visible', timeout=8000)
        except Exception:
            logging.debug("swallow", exc_info=True)
        b64, p = _elem_png_b64(el)
        r = {'ok': True, 'data': b64, 'path': p, 'url': page.url, 'ts': int(time.time())}
        if params.get('ocr'):
            try:
                import base64 as _b
                r['text'] = _get_ocr().classification(_b.b64decode(b64))
            except Exception as e:
                r['ocr_error'] = str(e)
        return r
    return _act_run(s, params, _do)


@register('drag')
def _act_drag(engine, params):
    """真实鼠标拖拽（trusted 事件）：selector/ref 定位滑块，distance=水平拖动像素，
    或 target_selector/target_x 指定终点；轨迹带缓动+2~6px 过冲回拉，模拟人手。"""
    s = engine

    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        t = _tgt(page, params)
        el = _loc(t, params)
        if el is None:
            return {'ok': False, 'error': '需要 ref 或 selector 定位拖拽起点'}
        try:
            el.wait_for(state='visible', timeout=8000)
        except Exception:
            logging.debug("swallow", exc_info=True)
        box = el.bounding_box()
        if not box:
            return {'ok': False, 'error': '目标不可见或无 bounding_box'}
        sx = box['x'] + box['width'] / 2
        sy = box['y'] + box['height'] / 2
        # 终点计算
        if params.get('target_selector'):
            tb = t.locator(params['target_selector']).first.bounding_box()
            dx = tb['x'] + tb['width'] / 2 - sx
        elif params.get('target_x') is not None:
            dx = float(params['target_x']) - sx
        else:
            dx = float(params.get('distance') or 0)
        if not dx:
            return {'ok': False, 'error': '需要 distance 或 target_selector/target_x'}
        m = page.mouse
        m.move(sx, sy)
        m.down()
        # 缓动轨迹：先快后慢 + 抖动 + 过冲回拉
        total = int(abs(dx))
        direction = 1 if dx > 0 else -1
        steps = max(12, min(45, total // 6 or 12))
        moved = 0.0
        overshoot = min(6.0, max(2.0, total * 0.02))
        for i in range(1, steps + 1):
            # ease-out：前段快后段慢
            ratio = 1 - (1 - i / steps) ** 2
            jitter = random.uniform(-1.5, 1.5)
            moved = dx * ratio + jitter
            m.move(sx + moved, sy + random.uniform(-1.2, 1.2))
            page.wait_for_timeout(random.randint(8, 24))
        # 过冲再回拉
        m.move(sx + moved + direction * overshoot, sy)
        page.wait_for_timeout(random.randint(40, 90))
        m.move(sx + dx, sy)
        page.wait_for_timeout(random.randint(60, 140))
        m.up()
        return {'ok': True, 'from_x': sx, 'moved': dx, 'url': page.url}
    return _act_run(s, params, _do)


@register('solve_captcha')
def _act_solve_captcha(engine, params):
    """组合动作：
    mode=slide（默认）：bg=背景图selector, target=滑块图selector, handle=滑块手柄selector
      → ddddocr slide_match 算缺口 → drag 真实拖过
    mode=text：img=验证码图selector, input=输入框selector, submit=提交按钮selector(可选)
      → 识别 → 填入 →（可选提交）
    """
    s = engine

    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        t = _tgt(page, params)
        mode = params.get('mode') or 'slide'
        if mode == 'slide':
            bg, tg = params.get('bg'), params.get('target')
            handle = params.get('handle')
            if not (bg and tg and handle):
                return {'ok': False, 'error': '滑块模式需要 bg/target/handle 三个 selector'}
            r = _act_ocr(engine, dict(params, bg=bg, target=tg))
            if not r.get('ok'):
                return r
            off = r['offset_x']
            d = _act_drag(engine, {'distance': off, 'selector': handle, 'frame': params.get('frame')})
            d['offset_x'] = off
            return d
        elif mode == 'text':
            img = params.get('img')
            inp = params.get('input')
            if not (img and inp):
                return {'ok': False, 'error': '文字码模式需要 img/input 两个 selector'}
            el = _loc(t, {'selector': img})
            b64, _p = _elem_png_b64(el)
            import base64 as _b
            text = _get_ocr().classification(_b.b64decode(b64))
            t.locator(inp).first.fill(text)
            r = {'ok': True, 'mode': 'text', 'text': text}
            if params.get('submit'):
                t.locator(params['submit']).first.click(timeout=8000)
                page.wait_for_load_state('domcontentloaded', timeout=15000)
                r['url'] = page.url
            return r
        return {'ok': False, 'error': '未知 mode: %s' % mode}
    return _act_run(s, params, _do)
