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
        self.config = cfg
        data_dir = cfg.get('data_dir') or os.path.join(_PLUGIN_DIR, 'data')
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
        self._q = queue.Queue()
        self._thread = None
        self._killed = False   # 会话被强制重建标记

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

    def run(self, fn):
        """在浏览器专属线程执行 fn()，返回结果 dict。

        带超时保护 + 不持锁等待：
        * _thread_lock 只保护线程创建检查，等待结果期间不持任何锁，
          这样 worker 线程内部（close/console 日志回调等）拿 _lock 不会被
          调用方堵死——之前 run() 全程持 _lock 等待，worker 又要拿同一把
          锁写日志，形成跨线程死锁，会话永久瘫痪。
        * worker 卡死（超时未完成）后标记 _stuck，后续任务不再投递到
          死队列，而是直接报错引导 kill_session，杜绝"排队等永远不动的队列"。
        """
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
            # 会话曾被强制重建：杀掉残留 Chromium，避免 profile 被锁导致新实例起不来
            self._kill_chromium_tree()
            self._killed = False
        self._pw = sync_playwright().start()
        args = ['--disable-blink-features=AutomationControlled'] if self.config.get('anti_automation') else []
        self._ctx = self._pw.chromium.launch_persistent_context(
            self.profile_dir,
            headless=bool(self.config.get('headless', True)),
            viewport=self.config.get('viewport') or {'width': 1280, 'height': 800},
            args=args,
        )
        self.active = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
        for p in self._ctx.pages:
            self._attach_devtools(p)
        try:
            self._ctx.on('page', self._attach_devtools)
        except Exception:
            pass
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

    def console_dump(self, level=None, limit=200, clear=False):
        with self._lock:
            if clear:
                logs, self.console_logs = list(self.console_logs), []
            else:
                logs = list(self.console_logs)
        if level:
            logs = [x for x in logs if x['level'] == level]
        return logs[-int(limit):]

    def close(self):
        def _do():
            with self._lock:
                if self._ctx:
                    try:
                        self._ctx.close()
                    except Exception:
                        pass
                self._ctx = None
                self.active = None
            return {'ok': True, 'closed': True}
        return self.run(_do)

    def status_inline(self):
        """直接读状态（不排队）。必须在 worker 线程内调用（动作里用）。"""
        info = {'ok': True, 'session': self.name, 'running': self._ctx is not None,
                'url': None, 'title': None, 'profile': self.profile_dir,
                'tabs': [], 'active': 0}
        if self._ctx is not None:
            try:
                info['tabs'] = [{'index': i, 'url': p.url, 'title': p.title()}
                                for i, p in enumerate(self._ctx.pages) if not p.is_closed()]
            except Exception:
                pass
            if self.active and not self.active.is_closed():
                info['url'] = self.active.url
                info['title'] = self.active.title()
        if self.last_error:
            info['last_error'] = self.last_error
        return info

    def status(self):
        def _do():
            info = {'ok': True, 'session': self.name, 'running': self._ctx is not None,
                    'url': None, 'title': None, 'profile': self.profile_dir,
                    'tabs': [], 'active': 0}
            if self._ctx is not None:
                try:
                    info['tabs'] = [{'index': i, 'url': p.url, 'title': p.title()}
                                    for i, p in enumerate(self._ctx.pages) if not p.is_closed()]
                except Exception:
                    pass
                if self.active and not self.active.is_closed():
                    info['url'] = self.active.url
                    info['title'] = self.active.title()
            if self.last_error:
                info['last_error'] = self.last_error
            return info
        return self.run(_do)

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
                return fn(self, params)
            except Exception as e:
                self.last_error = '%s: %s' % (type(e).__name__, e)
                return {'ok': False, 'error': self.last_error}
        return self.run(_do)


# ================== 内置动作（全部走注册表，可被覆盖/扩展） ==================

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


def _norm_url(u):
    return u if urllib.parse.urlparse(u).scheme else 'https://' + u


def _wait_idle(page, ms):
    try:
        page.wait_for_load_state('networkidle', timeout=ms)
    except Exception:
        pass


def _page_title(page):
    try:
        return page.title()
    except Exception:
        return ''


# ---- session 管理 ----
def get_session(name='default', config=None):
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
    # 杀 Chromium 树（不等 worker——它可能已死锁）
    try:
        s._kill_chromium_tree()
    except Exception:
        pass
    # 丢弃旧线程：新建同目录会话对象替换，登录态 profile 原样保留
    fresh = BrowserSession(name, s.config)
    fresh._killed = True   # 让它首次 _ensure 时再补一次杀树
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
                pass
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
            pass
        return {'ok': True, 'width': w, 'height': h}
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
        page.goto(_norm_url(url), timeout=s.config['goto_timeout'], wait_until='domcontentloaded')
        _wait_idle(page, s.config['networkidle_wait'])
        # 导航成功后自动截图，供画布节点 /api/browser?action=shot 展示
        try:
            s.screenshot_path(page)
        except Exception:
            pass
        return {'ok': True, 'url': page.url, 'title': page.title()}
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
            pass
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
            pass
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
            pass
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
        text = params.get('text')
        if text:
            page.get_by_text(text, exact=bool(params.get('exact'))).first.click(timeout=15000)
        elif sel:
            page.click(sel, timeout=15000)
        else:
            return {'ok': False, 'error': '需要 selector 或 text 或 x/y'}
        page.wait_for_load_state('domcontentloaded', timeout=15000)
        return {'ok': True, 'url': page.url}
    return _act_run(s, params, _do)


@register('fill')
def _act_fill(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        sel = params.get('selector') or ''
        if not sel:
            return {'ok': False, 'error': '需要 selector'}
        page.fill(sel, params.get('value', ''), timeout=15000)
        return {'ok': True}
    return _act_run(s, params, _do)


@register('press')
def _act_press(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        page.keyboard.press(params.get('key') or 'Enter')
        return {'ok': True}
    return _act_run(s, params, _do)


@register('key')
def _act_key(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        k = params.get('key') or ''
        if len(k) == 1:
            page.keyboard.type(k)
        elif k:
            page.keyboard.press(k)
        return {'ok': True}
    return _act_run(s, params, _do)


@register('wheel')
def _act_wheel(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        page.mouse.wheel(0, params.get('deltaY', 0))
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


@register('content')
def _act_content(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        return {'ok': True, 'url': page.url, 'title': page.title(),
                'html': page.content()[:300000]}
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


@register('tabs')
def _act_tabs(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        return {'ok': True, 'active': 0,
                'tabs': [{'index': i, 'url': p.url, 'title': p.title()}
                         for i, p in enumerate(ctx.pages)]}
    return _act_run(s, params, _do)


@register('newtab')
def _act_newtab(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        max_tabs = int(s.config.get('max_tabs', 30))
        if len(ctx.pages) >= max_tabs:
            return {'ok': False, 'error': '标签页已达上限 %d 个，请先关闭部分标签（closetab）' % max_tabs}
        p2 = ctx.new_page()
        s.active = p2
        u = params.get('url')
        if u:
            p2.goto(_norm_url(u), timeout=s.config['goto_timeout'], wait_until='domcontentloaded')
        return {'ok': True, 'index': len(ctx.pages) - 1, 'url': p2.url}
    return _act_run(s, params, _do)


@register('switchtab')
def _act_switchtab(engine, params):
    s = engine
    def _do():
        ctx, page = s._ensure()
        idx = int(params.get('index', 0))
        if 0 <= idx < len(ctx.pages):
            s.active = ctx.pages[idx]
            return {'ok': True, 'index': idx, 'url': s.active.url, 'title': s.active.title()}
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
            return {'ok': True, 'closed': idx, 'tabs': len(ctx.pages)}
        return {'ok': False, 'error': 'tab 不存在'}
    return _act_run(s, params, _do)


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
