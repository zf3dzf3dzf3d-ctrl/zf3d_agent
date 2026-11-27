#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
i聊天·云互联桥（cloud_bridge）—— 让两个远程朱峰智能体无限实例端对端聊天。

架构（协议先行）:
  本机广场(WS ws_plaza) ⇄ CloudBridge ⇄ 云中继(zf3d.com/api/agent_chat.asp) ⇄ CloudBridge ⇄ 对方广场
  - 两台机器各自出站 HTTPS 轮询（3s 量级），无需公网 IP/端口映射，NAT 后可用；
  - 云端只做「在线名册 + 按设备信箱暂存」，拉取不删（24h TTL），离线上线可补拉未读；
  - 入站消息注入本机广场广播 cloud_msg（名字带🌐），出站走 WS 新消息 cloud_say。

身份与鉴权（与 zf3d 心跳/论坛同源，零新配置）:
  - machine_id: private/anon_id.txt（心跳匿名 ID，同一文件同一身份）
  - key: 数据库 config zf3d/heartbeat_api_key → private/heartbeat_key.json api_key
  - 兜底: 论坛配置.json 的 agent_id+token（6.0.0 未配置回落同机 5.8.0 安装）
  - 可覆盖: private/互联配置.json {enable,url,key,agent_id,token,machine,name,poll_interval}
  - 游标: private/互联状态.json {"cursor": n}（重启不重放旧消息）

安全（沿用广场既有约束）:
  - 文本上限 500 字（云端硬限）；轮询失败指数退避至 30s，不打死云端；
  - 云桥只读本地配置文件，不落盘任何聊天内容；失败不阻塞本机广场。
"""
import os
import sys
import json
import random
import socket
import threading
import urllib.request
import urllib.parse

from util_log import get_logger

log = get_logger('cloud_bridge')
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))            # server/
sys.path.insert(0, os.path.dirname(os.path.dirname(_HERE)))  # 项目根

_PROJECT = os.path.dirname(os.path.dirname(_HERE))
_CFG_PATH = os.path.join(_PROJECT, 'private', '互联配置.json')
_STATE_PATH = os.path.join(_PROJECT, 'private', '互联状态.json')
_FORUM_CFG = os.path.join(_PROJECT, 'private', '论坛配置.json')
def _find_legacy_forum_cfg():
    """兜底：探测同盘兄弟版本目录的论坛配置（原硬编码 5.8.0，现动态发现任意旧版）。"""
    try:
        _parent = os.path.dirname(_PROJECT)
        for _name in sorted(os.listdir(_parent), reverse=True):
            _p = os.path.join(_parent, _name, 'private', '论坛配置.json')
            if os.path.isfile(_p) and _name != os.path.basename(_PROJECT):
                return _p
    except Exception:
        pass
    return ''
_FORUM_CFG_FALLBACK = _find_legacy_forum_cfg()
_ANON_ID_PATH = os.path.join(_PROJECT, 'private', 'anon_id.txt')
_HB_KEY_JSON = os.path.join(_PROJECT, 'private', 'heartbeat_key.json')

DEFAULT_URL = 'https://www.zf3d.com/api/agent_chat.asp'
POLL_INTERVAL = 3.0        # 秒；轮询周期（消息时延 ≈ 一个周期）
POLL_JITTER = 0.4          # ±抖动，防多实例同步踩点
BACKOFF_MAX = 30.0         # 连续失败退避上限
MAX_TEXT = 500             # 与云端硬限一致
HTTP_TIMEOUT = 10


def _log(msg):
    log.info('[云互联] %s' % msg)


# 官方中继域（提取自 DEFAULT_URL）；配置 url 必须 https 且主机落在白名单域内
_ALLOWED_HOST_SUFFIX = 'zf3d.com'


def _sanitize_url(url):
    """【安全加固】url 收敛：非 https 或主机不在白名单域（zf3d.com 及子域）时
    告警并回落 DEFAULT_URL，防止配置被改成把鉴权材料 POST 到任意主机。"""
    url = str(url or '').strip()
    ok = False
    try:
        p = urllib.parse.urlsplit(url)
        host = (p.hostname or '').lower()
        ok = (p.scheme == 'https'
              and (host == _ALLOWED_HOST_SUFFIX
                   or host.endswith('.' + _ALLOWED_HOST_SUFFIX)))
    except Exception:
        ok = False
    if not ok:
        _log('配置 url 不合规（需 https + %s 域），回落默认: %s' % (_ALLOWED_HOST_SUFFIX, url))
        return DEFAULT_URL
    return url


def _read_json(path, default=None):
    try:
        with open(path, 'r', encoding='utf-8-sig') as f:
            v = json.load(f)
        return v if isinstance(v, dict) else default
    except Exception:
        return default


def _machine_id():
    """与 zf3d_heartbeat 同一匿名 ID（同文件），无则此处补生成。"""
    try:
        v = ''
        if os.path.exists(_ANON_ID_PATH):
            with open(_ANON_ID_PATH, 'r', encoding='utf-8') as f:
                v = f.read().strip()
        if v:
            return v
        import uuid
        v = uuid.uuid4().hex[:16]
        os.makedirs(os.path.dirname(_ANON_ID_PATH), exist_ok=True)
        with open(_ANON_ID_PATH, 'w', encoding='utf-8') as f:
            f.write(v)
        return v
    except Exception:
        import uuid
        return uuid.uuid4().hex[:16]


def _db_api_key():
    """网站登录下发的 agent_api_key（与心跳/远程命令同源）。惰性读库，失败返回空。"""
    try:
        p = os.path.dirname(_HERE)
        if p not in sys.path:
            sys.path.insert(0, p)
        from zf3d_heartbeat import _get_config_value
        return (_get_config_value('zf3d', 'heartbeat_api_key', '') or '').strip()
    except Exception:
        pass
    k = _read_json(_HB_KEY_JSON) or {}
    return (k.get('api_key') or '').strip()


def _forum_auth():
    """论坛配置兜底鉴权 {agent_id, token}（6.0.0 未配置回落同机 5.8.0）。"""
    for p in (_FORUM_CFG, _FORUM_CFG_FALLBACK):
        c = _read_json(p)
        if c and c.get('agent_id') and c.get('token'):
            return {'agent_id': str(c['agent_id']), 'token': str(c['token'])}
    return {}


def _device_name():
    """远端展示名：互联配置 name > 主机名-anon后4位。"""
    cfg = _read_json(_CFG_PATH) or {}
    n = str(cfg.get('name') or '').strip()[:32]
    if n:
        return n
    try:
        host = socket.gethostname()[:24] or 'ZF'
    except Exception:
        host = 'ZF'
    return '%s-%s' % (host, _machine_id()[-4:])


class CloudBridge:
    """云桥：轮询线程 + 出站 send。挂到 PlazaServer 上做双向注入。"""

    def __init__(self, server, cfg_override=None):
        self.server = server                     # PlazaServer，用于注入广播
        self.cfg_override = cfg_override or {}
        self.machine = ''
        self.name = ''
        self.url = DEFAULT_URL
        self.auth = {}                           # {'key':..} 或 {'agent_id':..,'token':..}
        self.poll_interval = POLL_INTERVAL
        self.cursor = 0
        self.enabled = False
        self.state = 'off'                       # off / on / err
        self.state_err = ''
        self.users = []                          # [{'machine','name'}]
        self._stop = threading.Event()
        self._thread = None
        self._send_lock = threading.Lock()
        self._last_users_sig = ''
        self._load_state()

    # ---------- 配置 ----------
    def _resolve(self):
        ov = self.cfg_override
        cfg = _read_json(_CFG_PATH) or {}
        get = lambda k, d: ov.get(k, cfg.get(k, d))
        self.enabled = bool(get('enable', True))
        # 【安全加固】url 强制 https + 白名单域，不合规配置告警并回落 DEFAULT_URL
        self.url = _sanitize_url(get('url', DEFAULT_URL))
        try:
            self.poll_interval = max(1.0, float(get('poll_interval', POLL_INTERVAL)))
        except Exception:
            self.poll_interval = POLL_INTERVAL
        self.machine = str(get('machine', '')).strip() or _machine_id()
        self.name = str(get('name', '')).strip() or _device_name()
        key = str(get('key', '')).strip() or _db_api_key()
        if key:
            self.auth = {'key': key}
        else:
            fa = _forum_auth()
            fa.update({k: str(get(k, fa.get(k, ''))) for k in ('agent_id', 'token')})
            self.auth = fa if fa.get('agent_id') and fa.get('token') else {}
        return self.enabled and bool(self.auth)

    def _load_state(self):
        st = _read_json(_STATE_PATH) or {}
        try:
            self.cursor = int(st.get('cursor') or 0)
        except Exception:
            self.cursor = 0

    def _save_cursor(self):
        try:
            os.makedirs(os.path.dirname(_STATE_PATH), exist_ok=True)
            with open(_STATE_PATH, 'w', encoding='utf-8') as f:
                json.dump({'cursor': self.cursor}, f, ensure_ascii=False)
        except Exception:
            pass

    # ---------- HTTP ----------
    def _post(self, action, extra):
        params = {'a': action}
        params.update(self.auth)
        params.update(extra)
        params['machine_id'] = self.machine      # 云端参数名固定 machine_id
        if self.name:
            params.setdefault('from_name', self.name)
        data = urllib.parse.urlencode(params).encode('utf-8')
        req = urllib.request.Request(self.url, data=data, method='POST')
        req.add_header('Content-Type', 'application/x-www-form-urlencoded')
        req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=HTTP_TIMEOUT) as resp:
            return json.loads(resp.read().decode('utf-8', errors='replace'))

    # ---------- 状态广播 ----------
    def _set_state(self, st, err=''):
        if self.state == st and self.state_err == err:
            return
        self.state = st
        self.state_err = err
        self._inject({'t': 'cloud_status', 'state': st, 'err': err,
                      'machine': self.machine, 'name': self.name})
        _log('状态 → %s%s' % (st, ('（%s）' % err) if err else ''))

    def _inject(self, obj):
        """把云端事件广播给本机广场所有客户端（复用广场广播通道，含锁）。"""
        try:
            self.server._broadcast(obj)
        except Exception:
            pass

    # ---------- 轮询循环 ----------
    def _loop(self):
        interval = self.poll_interval
        while not self._stop.is_set():
            if not self._resolve():              # 每轮重读配置（用户可随时改/加凭据）
                self._set_state('off', '未配置凭据（key 或论坛 token）')
                self._stop.wait(60)
                continue
            try:
                r = self._post('poll', {'since': self.cursor, 'from_name': self.name})
                if not r.get('success'):
                    raise RuntimeError(str(r.get('message') or 'poll failed'))
                interval = self.poll_interval    # 成功即重置退避
                self._set_state('on')
                self._consume(r.get('data') or {})
            except Exception as e:
                s = str(e)
                if getattr(e, 'code', 0) == 404 or 'HTTP Error 404' in s:
                    # 云端未部署/路径错：不打退避，保持常态轮询，状态 off（部署后无缝转 on）
                    interval = self.poll_interval
                    self._set_state('off', '云端未部署（404）：' + self.url)
                else:
                    interval = min(interval * 1.7, BACKOFF_MAX)
                    self._set_state('err', s[:120])
            self._stop.wait(interval + random.uniform(-POLL_JITTER, POLL_JITTER))

    def _consume(self, data):
        msgs = data.get('msgs') or []
        if 'cursor' in data:
            try:
                cur = int(data['cursor'])
                # 双向跟随服务端游标：前进=新消息；后退=云端换中继/清表（id 重排），
                # 若只进不退，本地游标大于服务端时将永久漏收 → 必须跟着回退重收
                if cur != self.cursor:
                    self.cursor = cur
                    self._save_cursor()
            except Exception:
                pass
        for m in msgs:
            room = 'hall' if m.get('room') == 'hall' else 'direct'
            self._inject({'t': 'cloud_msg',
                          'from_machine': str(m.get('from') or ''),
                          'from_name': str(m.get('name') or m.get('from') or '远端'),
                          'room': room,
                          'to_machine': str(m.get('to') or ''),
                          'text': str(m.get('text') or ''),
                          'ts': int(m.get('ts') or 0)})
        users = data.get('users') or []
        sig = json.dumps(users, ensure_ascii=False, sort_keys=True)
        if sig != self._last_users_sig:
            self._last_users_sig = sig
            self.users = [{'machine': str(u.get('machine') or ''),
                           'name': str(u.get('name') or '')} for u in users]
            self._inject({'t': 'cloud_presence', 'users': self.users,
                          'me': self.machine})

    # ---------- 出站 ----------
    def send(self, to_machine, text):
        """发到云中继；to_machine='' 即互联大厅。返回 (ok, err)。"""
        text = str(text or '')[:MAX_TEXT]
        if not text:
            return False, '空消息'
        if self.state != 'on':
            return False, '云互联未连接'
        with self._send_lock:
            try:
                r = self._post('say', {'to': to_machine or '', 'text': text})
                if r.get('success'):
                    return True, ''
                return False, str(r.get('message') or 'say failed')
            except Exception as e:
                return False, str(e)[:120]

    # ---------- 生命周期 ----------
    def start(self):
        if self._thread and self._thread.is_alive():
            return
        try:
            self._resolve()                       # 先解析一次，日志带身份
        except Exception:
            pass
        self._thread = threading.Thread(target=self._loop, daemon=True,
                                        name='plaza-cloud-bridge')
        self._thread.start()
        _log('云桥线程已启动（machine=%s name=%s url=%s）' %
             (self.machine, self.name, self.url))

    def stop(self):
        self._stop.set()

    def presence(self):
        return [{'machine': u['machine'], 'name': u['name']}
                for u in self.users if u['machine'] != self.machine]


_instance = None
_instance_lock = threading.Lock()


def attach_cloud_bridge(server, cfg_override=None):
    """供 ws_plaza.start_plaza_ws 调用：创建并启动云桥（失败不影响广场）。"""
    global _instance
    with _instance_lock:
        if _instance is None:
            _instance = CloudBridge(server, cfg_override)
        else:
            _instance.server = server             # 热重启广场时换绑
        _instance.start()
        return _instance


def get_bridge():
    return _instance


if __name__ == '__main__':
    # 独立自检：只打印解析到的身份与鉴权材料（不发任何请求）
    b = CloudBridge(None)
    ok = b._resolve()
    log.info('enabled=%s url=%s machine=%s name=%s auth=%s' %
          (ok, b.url, b.machine, b.name,
           'key:%s…' % b.auth.get('key', '')[:6] if 'key' in b.auth else b.auth))
