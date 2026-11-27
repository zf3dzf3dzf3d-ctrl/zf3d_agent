# -*- coding: utf-8 -*-
"""数据源钉板（P0 抓取内核）：把外站页面上的某个数值「钉」成终身数据卡片。
- 存储：private/db/datasource_pins.json  {项目id: [pin...]}
- pin schema: {id,title,url,selector,attr,project,value,updated_at,error,created}
  attr 取值: text(默认) / html / 任意属性名(如 href/content)
- 抓取：Playwright 复用 private/浏览器数据/profiles/default 登录态（登录一次终身有效）。
  主浏览器占用 profile 时回退临时 context（无登录态）并在结果标注 degraded。
- 失败留快照：private/db/pin_snapshots/<pinid>.html 供 AI 自愈重配选择器。
- 不承诺：每日登录/验证码站（会话失效即报 error，由用户手动重登）。
"""
import os, json, time, threading

# ================= 自动同步（2026-10-27 新增）=================
# 后台守护线程：定时刷新所有项目的钉板数据，保证工作台「数据」标签始终同步。
# - 间隔可通过环境变量 ZF_PIN_SYNC_INTERVAL 秒调整（默认 300 秒 = 5 分钟）
# - 每轮把所有 pin 逐个 refresh_pin；单钉失败不影响其他钉（error 已写回该钉）
# - 刷新通过调用方线程执行，extract 自带单站并发锁，与手动刷新互斥安全
_SYNC_INTERVAL = max(60, int(os.environ.get('ZF_PIN_SYNC_INTERVAL') or 300))
_sync_started = False
_sync_guard = threading.Lock()


def _sync_all_projects():
    """扫描全部项目，逐钉刷新。返回 {成功数, 失败数}。"""
    ok_n = fail_n = 0
    with _LOCK:
        projects = list(_load().keys())
    for key in projects:
        with _LOCK:
            ids = [p.get('id') for p in _load().get(key, []) if p.get('id')]
        for pid in ids:
            try:
                refresh_pin(key, pid)
                ok_n += 1
            except Exception:
                fail_n += 1  # error 已由 refresh_pin 写回该钉
    return {'ok': ok_n, 'fail': fail_n}


def _sync_loop():
    while True:
        time.sleep(_SYNC_INTERVAL)
        try:
            _sync_all_projects()
        except Exception:
            pass  # 守护循环绝不退出


def ensure_auto_sync():
    """进程内幂等启动自动同步线程（server 启动或首次 API 调用时挂）。"""
    global _sync_started
    with _sync_guard:
        if _sync_started:
            return False
        _sync_started = True
    t = threading.Thread(target=_sync_loop, name='pin-autosync', daemon=True)
    t.start()
    return True
# ================= 自动同步结束 =================

_LOCK = threading.Lock()
_SITE_LOCKS = {}
_SITE_LOCKS_GUARD = threading.Lock()
_DB = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    '..', 'private', 'db', 'datasource_pins.json'))
_SNAP_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                          '..', 'private', 'db', 'pin_snapshots'))
_MAX_PINS = 100
_TIMEOUT_MS = 20000  # 单次抓取硬超时 20s


def _load():
    if not os.path.isfile(_DB):
        return {}
    try:
        with open(_DB, 'r', encoding='utf-8') as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _save(d):
    os.makedirs(os.path.dirname(_DB), exist_ok=True)
    tmp = _DB + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, _DB)


def _site_lock(url):
    from urllib.parse import urlparse
    host = (urlparse(url).netloc or 'default').lower()
    with _SITE_LOCKS_GUARD:
        if host not in _SITE_LOCKS:
            _SITE_LOCKS[host] = threading.Lock()
        return _SITE_LOCKS[host]


def _validate(p):
    if not isinstance(p, dict):
        raise ValueError('pin 必须是对象')
    title = str(p.get('title') or '').strip()[:60]
    if not title:
        raise ValueError('title 必填')
    url = str(p.get('url') or '').strip()
    if not (url.startswith('http://') or url.startswith('https://')):
        raise ValueError('url 必须以 http(s):// 开头')
    if len(url) > 1024:
        raise ValueError('url 过长')
    selector = str(p.get('selector') or '').strip()[:500]
    if not selector:
        raise ValueError('selector 必填（CSS 选择器）')
    attr = str(p.get('attr') or 'text').strip()[:30]
    return {'title': title, 'url': url, 'selector': selector, 'attr': attr,
            'project': str(p.get('project') or 'default')}


def migrate_default_to(project_id):
    """把历史上误存到 'default' 的钉迁移到指定项目（幂等，返回迁移条数）。
    背景：钉创建时若未带 project 会落 'default'，而工作台按项目过滤导致看不见。"""
    key = str(project_id or 'default')
    if key == 'default':
        return 0
    with _LOCK:
        d = _load()
        moved = d.pop('default', [])
        if not moved:
            return 0
        exist_ids = {p.get('id') for p in d.get(key, [])}
        for p in moved:
            p['project'] = key
        d.setdefault(key, [])
        d[key] += [p for p in moved if p.get('id') not in exist_ids]
        _save(d)
        return len(moved)


def _pos_key(project_id):
    return '__pos:' + str(project_id or 'default')


def save_positions(project_id, positions):
    """持久化钉卡拖拽位置（随服务端存盘，浏览器重启/换端不丢）"""
    key = str(project_id or 'default')
    if not isinstance(positions, dict):
        raise ValueError('positions 需为 {pin_id: {x,y}}')
    clean = {}
    for k, v in positions.items():
        try:
            clean[str(k)] = {'x': float(v.get('x', 0)), 'y': float(v.get('y', 0))}
        except Exception:
            continue
    with _LOCK:
        d = _load()
        d[_pos_key(key)] = clean
        _save(d)
    return clean


def get_positions(project_id):
    with _LOCK:
        return dict(_load().get(_pos_key(project_id), {}))


def list_pins(project_id):
    key = str(project_id or 'default')
    with _LOCK:
        d = _load()
        pins = d.get(key, [])
        if not pins:
            # 回退：当前项目无钉时，返回其他项目的钉（标注真实归属），避免工作台恒显"暂无"
            for k, arr in d.items():
                if k != key and arr:
                    out = []
                    for p in arr:
                        q = dict(p)
                        q['project'] = k
                        q['_from_other_project'] = True
                        out.append(q)
                    return out
        return pins


def add_pin(pin):
    p = _validate(pin)
    key = p['project']
    with _LOCK:
        d = _load()
        lst = d.get(key, [])
        if len(lst) >= _MAX_PINS:
            raise ValueError('钉板已满（%d 个）' % _MAX_PINS)
        p['id'] = 'pin_%d' % int(time.time() * 1000)
        p['created'] = time.strftime('%Y-%m-%d %H:%M:%S')
        p['value'] = None
        p['updated_at'] = None
        p['error'] = None
        lst.append(p)
        d[key] = lst
        _save(d)
    return p


def update_pin(project_id, pin_id, patch):
    key = str(project_id or 'default')
    with _LOCK:
        d = _load()
        for p in d.get(key, []):
            if p.get('id') == pin_id:
                merged = dict(p)
                merged.update({k: patch[k] for k in ('title', 'url', 'selector', 'attr')
                               if k in patch})
                merged = _validate(merged)
                merged['id'] = pin_id
                merged['project'] = key
                p.update(merged)
                _save(d)
                return p
    raise ValueError('钉不存在: %s' % pin_id)


def delete_pin(project_id, pin_id):
    key = str(project_id or 'default')
    with _LOCK:
        d = _load()
        lst = d.get(key, [])
        n = len(lst)
        lst = [p for p in lst if p.get('id') != pin_id]
        if len(lst) == n:
            raise ValueError('钉不存在: %s' % pin_id)
        d[key] = lst
        _save(d)
    # 顺带清快照
    try:
        snap = os.path.join(_SNAP_DIR, pin_id + '.html')
        if os.path.isfile(snap):
            os.remove(snap)
    except Exception:
        pass
    return True


def extract(url, selector, attr='text'):
    """同步抓取（调用方路由线程内执行，单站并发=1）。返回 {value, degraded, title}"""
    lock = _site_lock(url)
    acquired = lock.acquire(timeout=25)
    if not acquired:
        raise RuntimeError('该站点上一次抓取尚未结束（单站并发=1），请稍后再试')
    degraded = False
    pw = None
    ctx = None
    # 根治：系统 TEMP 无写权限导致 Playwright EPERM mkdtemp 静默失败 →
    # 进程内把 TEMP/TMP 指到项目内 temp 目录（2026-10-27 实测有效）
    _srv = os.path.dirname(os.path.abspath(__file__))
    _ptemp = os.path.join(_srv, 'temp', 'pw_tmp')
    try:
        os.makedirs(_ptemp, exist_ok=True)
        os.environ['TEMP'] = _ptemp
        os.environ['TMP'] = _ptemp
    except Exception:
        pass
    try:
        from playwright.sync_api import sync_playwright
        cfg = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                          'browser_engine_config.json'),
                              encoding='utf-8-sig')) if os.path.isfile(
            os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         'browser_engine_config.json')) else {}
        profile = cfg.get('profile_dir') or os.path.normpath(
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                         'private', '浏览器数据', 'profiles', 'default'))  # 2026-10-30: 与引擎 data_dir 链一致；旧 data/browser_profile 已归档
        pw = sync_playwright().start()
        # Playwright artifacts 落项目内 temp，规避系统 Temp 权限问题（EPERM mkdtemp）
        _art = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'temp',
                            'pw_artifacts_pins')
        os.makedirs(_art, exist_ok=True)
        os.environ['PLAYWRIGHT_BROWSERS_PATH'] = os.environ.get(
            'PLAYWRIGHT_BROWSERS_PATH', '')
        args = ['--disable-blink-features=AutomationControlled', '--no-first-run',
                '--no-default-browser-check']
        try:
            # 登录态优先；profile 被主浏览器占用会抛错 → 回退临时 context
            ctx = pw.chromium.launch_persistent_context(
                profile, headless=True, args=args,
                ignore_default_args=['--enable-automation'],
                artifacts_dir=_art)
        except Exception:
            degraded = True
            ctx = pw.chromium.launch_persistent_context(
                None, headless=True, args=args, artifacts_dir=_art)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        # 通用站点登录态注入（2026-10-28）：从 private/db/site_tokens/<域名>.json
        # 读取该站完整 cookie 数组并注入当前 context——保证 profile 被占用回退到
        # 临时 context 时，已登录过的站点无需用户重新登录。
        try:
            from urllib.parse import urlparse as _up
            _dom = _up(url).hostname or ''
            if _dom:
                _tok2 = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                      '..', 'private', 'db', 'site_tokens',
                                                      _dom + '.json'))
                if os.path.isfile(_tok2):
                    _cookies = json.load(open(_tok2, encoding='utf-8'))
                    if _cookies:
                        ctx.add_cookies(_cookies)
        except Exception:
            pass
        # bigmodel.cn 登录态注入：登录 token 不落盘，从 private/db/bigmodel_token.txt 读取注入
        if 'bigmodel.cn' in url:
            try:
                _tok_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                         '..', 'private', 'db', 'bigmodel_token.txt')
                if os.path.exists(_tok_path):
                    _tok = open(_tok_path, encoding='utf-8').read().strip()
                    if _tok:
                        ctx.add_cookies([{'name': 'bigmodel_token_production', 'value': _tok,
                                          'domain': '.bigmodel.cn', 'path': '/',
                                          'expires': 2147483647}])
            except Exception:
                pass
        page.goto(url, timeout=_TIMEOUT_MS, wait_until='domcontentloaded')
        # 登录态保鲜：走共享 profile 成功时，把该站最新 cookie 回写 site_tokens 库
        if not degraded:
            try:
                from urllib.parse import urlparse as _up2
                _dom2 = _up2(url).hostname or ''
                if _dom2:
                    _tok_dir2 = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                              '..', 'private', 'db', 'site_tokens'))
                    _ck = ctx.cookies(url)
                    if _ck:
                        os.makedirs(_tok_dir2, exist_ok=True)
                        json.dump(_ck, open(os.path.join(_tok_dir2, _dom2 + '.json'),
                                            'w', encoding='utf-8'), ensure_ascii=False)
            except Exception:
                pass
        # 登录失效检测：被重定向到登录页 → 明确报"需登录"，并提示用户重登
        final_url = (page.url or '').lower()
        if '/login' in final_url and '/login' not in url.lower():
                _save_snapshot('adhoc', page)
                raise PermissionError('登录已失效：页面被重定向到登录页（%s）。请提醒用户打开该网站手动登录一次，登录后重试刷新即可。' % page.url)
        try:
            page.wait_for_selector(selector, timeout=_TIMEOUT_MS, state='attached')
        except Exception:
            _save_snapshot('adhoc', page)
            raise ValueError('选择器未找到: %s（已留页面快照供排查）' % selector)
        el = page.query_selector(selector)
        if el is None:
            raise ValueError('选择器未命中元素: %s' % selector)
        if attr == 'text':
            value = (el.inner_text() or '').strip()
        elif attr == 'html':
            value = (el.inner_html() or '').strip()[:2000]
        else:
            value = el.get_attribute(attr)
            value = '' if value is None else str(value).strip()
        if value == '':
            _save_snapshot('adhoc', page)
            raise ValueError('取到空值，选择器可能不对（已留快照）')
        return {'value': value[:500], 'degraded': degraded,
                'page_title': (page.title() or '')[:100]}
    finally:
        for closer in (lambda: ctx and ctx.close(), lambda: pw and pw.stop()):
            try:
                closer()
            except Exception:
                pass
        if acquired:
            lock.release()


def _save_snapshot(pin_id, page):
    try:
        os.makedirs(_SNAP_DIR, exist_ok=True)
        path = os.path.join(_SNAP_DIR, '%s.html' % pin_id)
        with open(path, 'w', encoding='utf-8', errors='replace') as f:
            f.write(page.content()[:500000])
    except Exception:
        pass


def refresh_pin(project_id, pin_id):
    """抓取并把值写回 pin；失败把 error 写回并留快照。线程内同步执行。"""
    key = str(project_id or 'default')
    with _LOCK:
        pin = None
        for p in _load().get(key, []):
            if p.get('id') == pin_id:
                pin = dict(p)
                break
    if not pin:
        raise ValueError('钉不存在: %s' % pin_id)
    try:
        r = extract(pin['url'], pin['selector'], pin.get('attr') or 'text')
        with _LOCK:
            d = _load()
            for p in d.get(key, []):
                if p.get('id') == pin_id:
                    p['value'] = r['value']
                    p['updated_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
                    p['error'] = None
                    p['degraded'] = r['degraded']
                    # 历史记录：数值类才记录，环形保留最近 30 条，供前端画迷你趋势图
                    try:
                        v = float(str(r['value']).replace(',', ''))
                        hist = p.setdefault('history', [])
                        if not hist or hist[-1].get('v') != v:
                            hist.append({'t': p['updated_at'], 'v': v})
                            del hist[:-30]
                    except (TypeError, ValueError):
                        pass
                    _save(d)
                    return p
        raise ValueError('钉不存在: %s' % pin_id)
    except Exception as e:
        with _LOCK:
            d = _load()
            for p in d.get(key, []):
                if p.get('id') == pin_id:
                    p['error'] = str(e)[:300]
                    p['updated_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
                    _save(d)
                    break
        raise
