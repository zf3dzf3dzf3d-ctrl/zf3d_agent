# -*- coding: utf-8 -*-
"""mixin_iappevent.py —— iApp 活动事件感知层（v1.0 2026-11-11）
POST /api/iapp/event    -> 前端埋点上报 {app, action, title}
GET  /api/iapp/activity -> AI/前端查询最近活动 ?limit=N
存储：server/data/iapp_events.json（上限200条滚动，.bak 备份，线程锁）
隐私红线：只存「App名 + 动作 + 标题」，不存播放进度/内容正文。
"""
import json
import os
import threading
import time

_iappe_lock = threading.Lock()
MAX_EVENTS = 200


class MixinIappEvent:

    def _iappe_store(self):
        here = os.path.dirname(os.path.abspath(__file__))
        data_dir = os.path.normpath(os.path.join(here, '..', 'data'))
        os.makedirs(data_dir, exist_ok=True)
        return os.path.join(data_dir, 'iapp_events.json')

    def _iappe_load(self):
        try:
            with open(self._iappe_store(), 'r', encoding='utf-8') as f:
                d = json.load(f)
                return d if isinstance(d, list) else []
        except Exception:
            return []

    def _iappe_save(self, events):
        path = self._iappe_store()
        try:
            if os.path.isfile(path):
                with open(path, 'r', encoding='utf-8') as f:
                    old = f.read()
                with open(path + '.bak', 'w', encoding='utf-8') as f:
                    f.write(old)
        except Exception:
            pass
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(events, f, ensure_ascii=False)

    def iappe_add(self, app, action, title=''):
        app = str(app or '?')[:32]
        action = str(action or '?')[:32]
        title = str(title or '')[:200]
        with _iappe_lock:
            events = self._iappe_load()
            events.append({'t': time.time(), 'app': app, 'action': action, 'title': title})
            if len(events) > MAX_EVENTS:
                events = events[-MAX_EVENTS:]
            self._iappe_save(events)

    def _iappe_recent(self, limit=20):
        with _iappe_lock:
            events = self._iappe_load()
        try:
            limit = max(1, min(int(limit), 100))
        except Exception:
            limit = 20
        now = time.time()
        out = []
        for e in events[-limit:]:
            age = now - e.get('t', 0)
            if age < 60:
                ago = '%d秒前' % int(age)
            elif age < 3600:
                ago = '%d分钟前' % int(age // 60)
            elif age < 86400:
                ago = '%d小时前' % int(age // 3600)
            else:
                ago = '%d天前' % int(age // 86400)
            out.append({'time': ago, 'app': e.get('app'), 'action': e.get('action'), 'title': e.get('title')})
        return out

    def _handle_iapp_event(self, qs=None, body=None):
        q = qs or {}
        b = body or {}
        def _q1(key):
            v = q.get(key, '')
            return v[0] if isinstance(v, list) else v
        app = b.get('app') or _q1('app') or ''
        action = b.get('action') or _q1('action') or ''
        title = b.get('title') or _q1('title') or ''
        self.iappe_add(app, action, title)
        self._send_json({'ok': True})

    def _handle_iapp_activity(self, qs=None):
        q = qs or {}
        raw = q.get('limit', ['20'])
        raw = raw[0] if isinstance(raw, list) else raw
        self._send_json({'ok': True, 'events': self._iappe_recent(raw)})

    def _handle_iapp_event_get(self, qs):
        self._handle_iapp_event(qs=qs)

    # ================= UI 级开窗指令队列（v1.1 2026-11-11） =================
    # POST /api/iapp/cmd   -> AI 下达开窗指令 {app: music|tv|manga|...}
    #   （屏幕级写操作；v1.3 2026-11-23 统一确认原语：确认不取自请求自填值，
    #   必须过 syscall 人工审批闸，工具名 iapp:open:<app> 与 iapp_tools.iapp_open 共享）
    # GET  /api/iapp/cmds  -> 前端轮询拉取未过期指令（TTL 10 秒，取后即删）
    _IAPP_OPEN_MAP = {
        'music': 'openMusic', 'tv': 'openTv', 'manga': 'openManga',
        'comics': 'openManga', 'video': 'openTv', 'ivideo': 'openTv',
        'calc': 'openCalc', 'notes': 'openNotes', 'game': 'openGame', 'home': 'openHome',
        # 【v1.2 2026-11-12 通用化】覆盖全部 i程序：AI 一条指令即可开任意窗口+带搜索词
        'novel': 'openNovel', 'xiaoshuo': 'openNovel',
        'news': 'openNews', 'xinwen': 'openNews',
        'ivideo2': 'openVideo', 'shipin': 'openVideo',
        'image': 'openImage', 'picture': 'openImage', 'tupian': 'openImage',
        'hardware': 'openHardware', 'yingjian': 'openHardware',
    }
    CMD_TTL = 10  # 秒

    def _iappcmd_path(self):
        here = os.path.dirname(os.path.abspath(__file__))
        return os.path.join(self._iappe_store(), '..', 'iapp_cmds.json')

    def _iappcmd_load(self):
        try:
            with open(os.path.normpath(self._iappcmd_path()), 'r', encoding='utf-8') as f:
                d = json.load(f)
                return d if isinstance(d, list) else []
        except Exception:
            return []

    def _iappcmd_save(self, cmds):
        try:
            with open(os.path.normpath(self._iappcmd_path()), 'w', encoding='utf-8') as f:
                json.dump(cmds, f, ensure_ascii=False)
        except Exception:
            pass

    def _handle_iapp_cmd_post(self, qs=None, body=None):
        b = body or {}
        app = str(b.get('app') or '').strip().lower()
        confirmed = b.get('confirmed') is True
        if app not in self._IAPP_OPEN_MAP:
            self._send_json({'ok': False, 'error': 'unknown app, allowed: ' + ','.join(sorted(self._IAPP_OPEN_MAP.keys()))}, 400)
            return
        # 【v1.3 2026-11-23 统一确认原语】confirmed 不再"请求自填即放行"：
        # 即使带 confirmed=true 也必须过 syscall 人工审批闸（工具名 iapp:open:<app>，
        # 与 AI 工具链 iapp_tools.iapp_open 共享同一审批记录，1 小时内免重复确认）。
        # 未批准返回与 iapp_tools 同构的 need_confirm JSON（含审批码推送）；
        # 人工批准后直连重试同样放行。闸不可用 fail-closed 拒绝。
        # 直连面说明（侦查 2026-11-23）：本端点无前端 UI 直连调用方（public/js 仅
        # zf-app-dock.js GET /api/iapp/cmds 消费），故服务端收口不损本地信任边界。
        tool = 'iapp:open:%s' % app
        try:
            from engines.common.iapp_tools import _sys_gate, _need_confirm_payload
            if not confirmed:
                self._send_json({'ok': False, 'need_confirm': True, 'tool': tool,
                                 'error': '开窗为屏幕级写操作，不接受调用方自填确认：由 syscall 人工审批闸统一收口，批准后带 confirmed=true 重试放行'}, 403)
                return
            ok, reason = _sys_gate(tool)
            if not ok:
                self._send_json(_need_confirm_payload(tool, '开窗会打扰用户屏幕', reason), 403)
                return
        except Exception as e:
            self._send_json({'ok': False, 'need_confirm': True, 'tool': tool,
                             'error': '开窗需人工审批：审批闸不可用(%s)，fail-closed 拒绝' % e}, 403)
            return
        with _iappe_lock:
            cmds = self._iappcmd_load()
            now = time.time()
            cmds = [c for c in cmds if now - c.get('t', 0) < self.CMD_TTL]
            cmds.append({'t': now, 'app': app, 'fn': self._IAPP_OPEN_MAP[app], 'kw': str(b.get('kw') or '')})
            self._iappcmd_save(cmds)
        # 顺手记入感知流：AI 开了什么窗，AI 自己也该"知道"
        self.iappe_add('ai', 'open-' + app, str(b.get('title') or '')[:200])
        self._send_json({'ok': True, 'app': app, 'fn': self._IAPP_OPEN_MAP[app], 'ttl': self.CMD_TTL})

    def _handle_iapp_cmds_get(self, qs=None):
        with _iappe_lock:
            cmds = self._iappcmd_load()
            now = time.time()
            fresh = [c for c in cmds if now - c.get('t', 0) < self.CMD_TTL]
            self._iappcmd_save([])  # 取后即清（单工作台假设，与现有轮询一致）
        self._send_json({'ok': True, 'cmds': fresh})
