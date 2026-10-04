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
