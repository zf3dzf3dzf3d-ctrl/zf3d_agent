# -*- coding: utf-8 -*-
"""工作台面板数据层（P0）：项目级「团队+情报」面板小组件存取。
- 存储：private/db/workbench_panel.json  {项目id: [组件...]}
- 组件 schema: {id,title,type(url),url,pos,size,created}
- 一期只放开 url 型（iframe src），html 直塞待消毒管线验证后再开。
- 团队页不在此存（只读复用 butler_store.get_team()），避免双写。
"""
import os, json, time, threading

_LOCK = threading.Lock()
_DB = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    '..', 'private', 'db', 'workbench_panel.json'))
_ALLOWED_TYPES = ('url',)
_MAX_WIDGETS = 50


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


def _validate(w):
    if not isinstance(w, dict):
        raise ValueError('widget 必须是对象')
    title = str(w.get('title') or '').strip()[:60]
    if not title:
        raise ValueError('title 必填')
    wtype = str(w.get('type') or 'url').strip().lower()
    if wtype not in _ALLOWED_TYPES:
        raise ValueError('type 仅支持: %s（html 直塞暂未放开）' % '/'.join(_ALLOWED_TYPES))
    url = str(w.get('url') or '').strip()
    if not (url.startswith('http://') or url.startswith('https://')):
        raise ValueError('url 必须以 http:// 或 https:// 开头')
    if len(url) > 1024:
        raise ValueError('url 过长')
    return {'title': title, 'type': wtype, 'url': url,
            'size': str(w.get('size') or 'normal'),
            'pos': int(w.get('pos') or 0)}


def list_widgets(project_id):
    key = str(project_id or 'default')
    with _LOCK:
        return _load().get(key, [])


def add_widget(project_id, widget):
    key = str(project_id or 'default')
    w = _validate(widget)
    with _LOCK:
        d = _load()
        lst = d.get(key, [])
        if len(lst) >= _MAX_WIDGETS:
            raise ValueError('组件数已达上限 %d' % _MAX_WIDGETS)
        w['id'] = 'w_%d' % int(time.time() * 1000)
        w['created'] = time.strftime('%Y-%m-%d %H:%M:%S')
        lst.append(w)
        d[key] = lst
        _save(d)
    return w


def update_widget(project_id, widget_id, patch):
    key = str(project_id or 'default')
    with _LOCK:
        d = _load()
        lst = d.get(key, [])
        for i, w in enumerate(lst):
            if w.get('id') == widget_id:
                if 'title' in patch:
                    w['title'] = str(patch['title']).strip()[:60] or w['title']
                if 'url' in patch:
                    u = str(patch['url']).strip()
                    if not (u.startswith('http://') or u.startswith('https://')):
                        raise ValueError('url 必须以 http(s):// 开头')
                    w['url'] = u[:1024]
                if 'size' in patch:
                    w['size'] = str(patch['size'])
                if 'pos' in patch:
                    w['pos'] = int(patch['pos'] or 0)
                lst[i] = w
                d[key] = lst
                _save(d)
                return w
    raise ValueError('组件不存在: %s' % widget_id)


def delete_widget(project_id, widget_id):
    key = str(project_id or 'default')
    with _LOCK:
        d = _load()
        lst = d.get(key, [])
        n = len(lst)
        lst = [w for w in lst if w.get('id') != widget_id]
        if len(lst) == n:
            raise ValueError('组件不存在: %s' % widget_id)
        d[key] = lst
        _save(d)
    return True
