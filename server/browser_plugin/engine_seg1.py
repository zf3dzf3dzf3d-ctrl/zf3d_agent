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
import os
import json
import time
import base64
import threading
import queue
import urllib.parse

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
    'headless': True,
    'viewport': {'width': 1280, 'height': 800},
    'max_tabs': 30,
    'data_dir': None,          # None = 插件目录下 data/
    'goto_timeout': 45000,
    'networkidle_wait': 8000,
    'anti_automation': True,
    'action_timeout': 90,      # 单个动作最长等待秒数，超时返回错误而不是永久挂起
}

_ACTIONS = {}          # name -> fn(engine, ctx, page, params) -> dict
_sessions = {}         # name -> BrowserSession
_sessions_lock = threading.RLock()

# --- 空闲自动关闭：会话超过 idle_close_seconds 秒无任何操作则自动关闭，防止 Chromium 后台吃 CPU ---
_IDLE_CLOSE_SECONDS = 300
_reaper_started = False


def _touch_session(s):
    """记录会话最近使用时间"""
    try:
        s.last_used = time.time()
    except Exception:
        pass


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
                with _sessions_lock:
                    for name, s in list(_sessions.items()):
                        idle_for = now - getattr(s, 'last_used', now)
                        if idle_for > _IDLE_CLOSE_SECONDS:
                            stale.append(name)
                for name in stale:
                    # 只关浏览器上下文（profile 保留，登录态不丢），
                    # 会话对象留在 _sessions 里，下次 get_session 直接复用
                    with _sessions_lock:
                        s = _sessions.get(name)
                    if s is None:
                        continue
                    # 二次确认：取锁后仍是空闲且无排队任务才关
                    if now - getattr(s, 'last_used', now) <= _IDLE_CLOSE_SECONDS:
                        continue
                    if getattr(s, '_q', None) and not s._q.empty():
                        continue
                    try:
                        s.close()
                        print('[browser] 空闲会话已自动关闭: %s (空闲>%ds)'
                              % (name, _IDLE_CLOSE_SECONDS), flush=True)
                    except Exception as e:
                        print('[browser] 空闲会话关闭失败 %s: %s' % (name, e), flush=True)
            except Exception as e:
                print('[browser] 空闲回收线程异常: %s' % e, flush=True)

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
                pass
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
                pass
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
                print('[browser] 已通过 CDP 接管用户浏览器: %s' % _cdp)
                self.active = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
                for p in self._ctx.pages:
                    self._attach_devtools(p)
                try:
                    self._ctx.on('page', self._attach_devtools)
                except Exception:
                    pass
                return self._ctx, self.active
            except Exception as _e:
                # CDP 连不上（浏览器没带调试端口启动）：静默回退自起模式，零破坏
                print('[browser] CDP 连接失败(%s)，回退自起浏览器' % _e)
                try:
                    if self._pw:
                        self._pw.stop()
                except Exception:
                    pass
                self._pw = None
        self._pw = sync_playwright().start()
        _stealth = bool(self.config.get('anti_automation', True))
        args = [
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
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
            pass
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
                               capture_output=True, timeout=20)
            else:
                # macOS/Linux：pkill 按命令行匹配 profile 目录
                subprocess.run(['pkill', '-f', self.profile_dir],
                               capture_output=True, timeout=20)
        except Exception:
            pass

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
                    pass

            # ---- 网络响应捕获（滚动环形缓冲，供 net_dump 查询） ----
            try:
                page.on('response', self._on_response)
            except Exception:
                pass
            # ---- 下载捕获 ----
            try:
                page.on('download', self._on_download)
            except Exception:
                pass
            # ---- 弹窗/新页面并入标签管理 ----
            try:
                page.on('popup', lambda p: self._on_popup(p))
            except Exception:
                pass

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
            pass

    def _on_response(self, resp):
        """网络响应回调：滚动环形缓冲，供 net_dump 查询（静默失败）。"""
        try:
            _ct = ''
            try:
                _ct = (resp.headers or {}).get('content-type', '')
            except Exception:
                pass
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
            pass

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
                    print('[browser] 下载保存异常: %s' % _e)
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
                    print('[browser] 下载记录异常: %s' % _e)

            threading.Thread(target=_save_and_log, daemon=True).start()
        except Exception as _e:
            print('[browser] 下载处理异常: %s' % _e)

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
                    pass
            total = sum(s for _, s, _ in files)
            files.sort()  # 旧的在前
            for mtime, size, fp in files:
                if total <= max_total_mb * 1024 * 1024 and now - mtime <= max_age_days * 86400:
                    break
                try:
                    os.remove(fp)
                    total -= size
                except OSError:
                    pass
        except Exception:
            pass

    def _on_popup(self, page):
        """弹窗/新页面并入标签跟踪（复用 devtools 挂载）。"""
        try:
            self._attach_devtools(page)
        except Exception:
            pass

    def net_dump(self, keyword=None, limit=50, body_index=None, max_body=8000):
        """查询最近网络响应列表；body_index 指定时返回该条响应体（仅 JSON/文本）。"""
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
            _body = self.active.evaluate(
                """async (u) => { const r = await fetch(u, {credentials:'include'});
                return await r.text(); }""", target['url'])
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
            pass

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
                pass
            made = [p0]
            for u in urls[1:]:
                p = ctx.new_page()
                try:
                    p.goto(u, timeout=gt, wait_until='domcontentloaded')
                except Exception:
                    pass
                made.append(p)
            ai = max(0, min(int(d.get('active') or 0), len(made) - 1))
            self.active = made[ai]
        except Exception:
            pass

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
                                pass
                except Exception:
                    pass
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
                        pass
                if self._pw:
                    try:
                        self._pw.stop()  # CDP 断连 / 自起模式回收驱动，防止泄漏进程
                    except Exception:
                        pass
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
                pass
            if self.active and not self.active.is_closed():
                info['url'] = self.active.url
                try:
                    info['active'] = self._ctx.pages.index(self.active)  # 真实活动索引（此前硬编码 0，切标签后恢复错位）
                except Exception:
                    info['active'] = 0
                try:
                    info['title'] = self.active.title()
                except Exception:
                    pass
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
                    pass
                if self.active and not self.active.is_closed():
                    info['url'] = self.active.url
                    try:
                        info['title'] = self.active.title()
                    except Exception:
                        pass
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
                pass
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
            pass
        frames = self._stream_frames
        if frames:
            import base64 as _b64
            data = frames[-1]
            self._stream_frames = []
            try:
                open(os.path.join(self.shot_dir, 'stream.jpg'), 'wb').write(_b64.b64decode(data))
            except Exception:
                pass
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
                    pass
        except Exception:
            pass
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
                pass
            try:
                return self.stream_start(quality)
            except Exception:
                pass
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


