# -*- coding: utf-8 -*-
# 拆分分段模块：由原 engine.py 按行段【无改动】切分，由同名门面加载合并。
# ================== 内置动作（全部走注册表，可被覆盖/扩展） ==================
import time as _time_mod  # touch_human/human_status 用（门面合并后本段与 seg1 共享命名空间）

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
        pass


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
        pass
    # 杀 Chromium 树（不等 worker——它可能已死锁）
    try:
        s._kill_chromium_tree()
    except Exception:
        pass
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
                except Exception: pass
        except Exception:
            pass
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
    """把凭据表中该域的登录态恢复到当前会话，然后刷新页面生效。"""
    s = engine
    sn = params.get('session') or 'default'
    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        from browser_plugin.credentials import credentials_restore
        r = credentials_restore(ctx, page, session=sn)
        if r.get('ok'):
            try:
                page.reload(timeout=30000)
            except Exception:
                pass
        return r
    return _act_run(s, params, _do)


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
            pass

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
        page.goto(_norm_url(url), timeout=s.config['goto_timeout'], wait_until='domcontentloaded')
        _wait_idle(page, min(int(s.config['networkidle_wait']), 3000))  # 上限压到 3s，SPA 由快照前的渲染等待兜底
        s._tabs_archive()   # 导航后存档标签页（重启后可恢复）
        # 导航成功后自动截图，供画布节点 /api/browser?action=shot 展示
        try:
            s.screenshot_path(page)
        except Exception:
            pass
        r = {'ok': True, 'url': page.url, 'title': page.title()}
        if _want_snapshot(params):
            # 导航结果直接附带 ref 快照，省掉单独一次 content 调用
            r['snapshot'] = _snap(page) or '(快照不可用)'
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
        ref = params.get('ref') or ''
        text = params.get('text')
        if ref:
            # ref 来自最近一次快照注入的 data-zfref，同页面内解析保证原子性；
            # 失效（页面跳转/DOM 重建）时提示重新 snapshot
            loc = '[data-zfref="%s"]' % ref
            try:
                page.locator(loc).first.click(timeout=8000)
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
        try:
            try:
                page.locator(loc).first.click(timeout=5000)
            except Exception:
                pass  # 点击聚焦失败不阻断，fill 本身也会定位
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
                pass
            try:
                page.locator(target).first.press(params.get('key') or 'Enter', timeout=5000)
                return {'ok': True, 'focused': True}
            except Exception:
                pass
        else:
            # 无目标：对当前焦点元素按（聚焦 body 兜底）
            try:
                page.evaluate("document.activeElement && document.activeElement !== document.body ? document.activeElement : null")
            except Exception:
                pass
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
                pass
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
            pass
        # 2) 先释放残留修饰键（Ctrl/Shift 卡住时滚轮会变成缩放/横向滚动 → 页面爆卡）
        for _mk in ('Control', 'Shift', 'Alt', 'Meta'):
            try:
                page.keyboard.up(_mk)
            except Exception:
                pass
        # 3) 滚动并给页面一点渲染时间，避免截图流立刻抓到未渲染帧（白屏闪烁/卡顿感）
        page.mouse.wheel(0, params.get('deltaY', 0))
        try:
            page.wait_for_timeout(80)
        except Exception:
            pass
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
            pass
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
            pass
        # 标签跟随：URL 变了才回读一次标题（缓存），供前端标题栏立即同步
        title = ''
        try:
            if url and url != getattr(s, '_poll_url', None):
                s._poll_url = url
                s.last_title = s.active.title()
            title = getattr(s, 'last_title', '') or ''
        except Exception:
            pass
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
    return (c.innerText || c.textContent || '').replace(/[\\t ]+/g, ' ')
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
        max_tabs = int(s.config.get('max_tabs', 30))
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


