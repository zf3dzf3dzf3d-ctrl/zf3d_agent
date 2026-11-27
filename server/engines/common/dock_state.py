# -*- coding: utf-8 -*-
"""dock_state.py — i桌面图标状态真源（server 落盘，2026-11-16）

用户拖拽 i桌面 图标排序/隐藏后，前端把
  { appOrder:[], hiddenApps:[], panelOrder:[] }
POST 上来落盘 server/data/dock_state.json；
前端启动时 GET /api/dock/state 回填 localStorage，防清缓存/换端口后丢失。
"""
import json
import os
import threading
import time

from util_log import get_logger

log = get_logger('dock_state')
_LOCK = threading.Lock()
_STATE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                           'data', 'dock_state.json')


def _load_default_state():
    """发布默认排序（2026-11-26 用户拍板存档）：engines/common/dock_state.default.json，
    用户 server/data/dock_state.json 不存在/为空时回退使用，让新装机用户直接得到当前调好的布局。"""
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               'dock_state.default.json'), 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def dock_state_get(_body=None):
    """GET /api/dock/state → {ok, state:{appOrder, hiddenApps, panelOrder}}"""
    try:
        with _LOCK:
            with open(_STATE_FILE, 'r', encoding='utf-8') as f:
                st = json.load(f)
    except Exception:
        st = _load_default_state()
    if not (st.get('appOrder') or st.get('panelOrder') or st.get('desktopApps')):
        st = _load_default_state()
    st = {'appOrder': st.get('appOrder') or [],
          'hiddenApps': st.get('hiddenApps') or [],
          'panelOrder': st.get('panelOrder') or [],
          'desktopApps': st.get('desktopApps') or [],
          'panelGeom': st.get('panelGeom') or None}
    return {'ok': True, 'state': st}


def dock_state_save(body):
    """POST /api/dock/state  body={appOrder:[], hiddenApps:[], panelOrder:[], panelGeom:{x,y,w,h}?}"""
    if not isinstance(body, dict):
        return {'ok': False, 'error': 'body 必须为 JSON 对象'}
    try:
        with _LOCK:
            try:
                with open(_STATE_FILE, 'r', encoding='utf-8') as f:
                    old = json.load(f)
            except Exception:
                old = {}
    except Exception:
        old = {}
    # 增量合并：未传的字段保留旧值（panelGeom 与图标顺序分属不同保存时机，互不覆盖）
    st = {'appOrder': body.get('appOrder') if body.get('appOrder') is not None else old.get('appOrder') or [],
          'hiddenApps': body.get('hiddenApps') if body.get('hiddenApps') is not None else old.get('hiddenApps') or [],
          'panelOrder': body.get('panelOrder') if body.get('panelOrder') is not None else old.get('panelOrder') or [],
          'desktopApps': body.get('desktopApps') if body.get('desktopApps') is not None else old.get('desktopApps') or [],
          'updated_at': time.time()}
    pg = body.get('panelGeom')
    if pg is not None:
        if not isinstance(pg, dict):
            return {'ok': False, 'error': 'panelGeom 必须为 JSON 对象'}
        st['panelGeom'] = pg
    elif old.get('panelGeom') is not None:
        st['panelGeom'] = old['panelGeom']
    os.makedirs(os.path.dirname(_STATE_FILE), exist_ok=True)
    tmp = _STATE_FILE + '.tmp'
    try:
        with _LOCK:
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(st, f, ensure_ascii=False)
            os.replace(tmp, _STATE_FILE)  # 原子改名防半截
    except Exception as e:
        return {'ok': False, 'error': 'i桌面状态落盘失败: %r' % e}
    return {'ok': True}


def _selftest():
    st = {'appOrder': ['a', 'b'], 'hiddenApps': ['c'], 'panelOrder': ['d']}
    assert dock_state_save(st)['ok'] is True
    back = dock_state_get()['state']
    assert back['appOrder'] == ['a', 'b'] and back['hiddenApps'] == ['c'] and back['panelOrder'] == ['d']
    log.info('dock_state selftest OK')


if __name__ == '__main__':
    _selftest()
