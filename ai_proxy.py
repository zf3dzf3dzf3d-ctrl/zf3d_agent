# -*- coding: utf-8 -*-
"""
朱峰社区 AI Token 代理网关 ai_proxy.py
会员令牌 -> 站方代理 -> 上游大模型。上游 key 永不出站。
启动: python ai_proxy.py  (默认端口 8787)
依赖: pip install flask requests
"""
import os, sys, time, json, sqlite3, hashlib, secrets, threading
from flask import Flask, request, jsonify, g
import requests as http

# ---------- 令 5.4.5 的 zf_identity / zf_channel_config 可导入（HMAC 身份票依赖） ----------
_SERVER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'server')
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)

# ---------- 识图/生图/视频 独立通道与费率（唯一配置点 zf_channel_config.py） ----------
try:
    import zf_channel_config as ZFC
except Exception:
    ZFC = None

# 四级兜底：1) 环境变量 2) 程序根目录 private\zf3d.db（可写时） 3) %LOCALAPPDATA%（Program Files 无写权限时） 4) 站方服务器路径
def _resolve_db_path():
    def _writable(d):
        try:
            os.makedirs(d, exist_ok=True)
            probe = os.path.join(d, '.db_probe')
            with open(probe, 'w') as f:
                f.write('1')
            os.remove(probe)
            return True
        except Exception:
            return False

    env = os.environ.get('AI_DB')
    if env:
        return env
    try:
        root = os.path.dirname(os.path.abspath(__file__))
        local = os.path.join(root, 'private', 'zf3d.db')
        # 已存在则直接用（老数据优先）；不存在时须目录可写（Program Files 里非管理员不可写）
        if os.path.isfile(local) or _writable(os.path.dirname(local)):
            return local
    except Exception:
        pass
    try:
        lad = os.path.join(os.environ.get('LOCALAPPDATA') or os.path.expanduser('~'), '朱峰智能体无限', 'private')
        return os.path.join(lad, 'zf3d.db')
    except Exception:
        pass
    return r'E:\work\web\private\zf3d.db'

DB_PATH = _resolve_db_path()
# 主站库（充值余额唯一来源：users.token_balance）

# ---------- api_token 加密存储（安全加固：库里不再存明文） ----------
# 使用 Windows DPAPI（CurrentUser）加密；认证仍走 token_hash（sha256），此处仅用于
# /internal/get_token 的「幂等取回明文」。跨机器迁移会导致解密失败，届时走 reset_token 重发。
def _dpapi_protect(plain: str) -> str:
    try:
        import ctypes
        from ctypes import wintypes
        class _DATA_BLOB(ctypes.Structure):
            _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_char))]
        buf = plain.encode('utf-8')
        din = _DATA_BLOB(len(buf), ctypes.cast(ctypes.create_string_buffer(buf), ctypes.POINTER(ctypes.c_char)))
        dout = _DATA_BLOB()
        if not ctypes.windll.crypt32.CryptProtectData(ctypes.byref(din), None, None, None, None, 0, ctypes.byref(dout)):
            raise OSError('CryptProtectData failed')
        import base64
        out = 'dpapi:' + base64.b64encode(ctypes.string_at(dout.pbData, dout.cbData)).decode('ascii')
        ctypes.windll.kernel32.LocalFree(dout.pbData)
        return out
    except Exception:
        return plain  # 非 Windows 等环境降级存明文（与旧行为一致）

def _dpapi_unwrap(stored: str) -> str:
    if not stored or not stored.startswith('dpapi:'):
        return stored or ''
    try:
        import ctypes, base64
        from ctypes import wintypes
        class _DATA_BLOB(ctypes.Structure):
            _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_char))]
        raw = base64.b64decode(stored.split(':', 1)[1])
        din = _DATA_BLOB(len(raw), ctypes.cast(ctypes.create_string_buffer(raw), ctypes.POINTER(ctypes.c_char)))
        dout = _DATA_BLOB()
        if not ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(din), None, None, None, None, 0, ctypes.byref(dout)):
            raise OSError('CryptUnprotectData failed')
        out = ctypes.string_at(dout.pbData, dout.cbData).decode('utf-8')
        ctypes.windll.kernel32.LocalFree(dout.pbData)
        return out
    except Exception:
        return ''  # 解密失败（跨机器/换用户）→ 调用方走重发流程
MAIN_DB = os.environ.get('AI_MAIN_DB', r'E:\work\web\private\zf3d.db')

def _init_ai_tables(conn):
    """确保 AI 相关表存在（首次运行/新库自动建表，避免 OperationalError 导致统计全空）"""
    conn.executescript('''
CREATE TABLE IF NOT EXISTS ai_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  balance REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS ai_pricing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,
  price_in REAL NOT NULL DEFAULT 0,
  price_out REAL NOT NULL DEFAULT 0,
  multiplier REAL NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  balance_after REAL NOT NULL DEFAULT 0,
  source_ip TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_time ON ai_usage(user_id, created_at);
''')
    # 老库迁移：缺列则补（CREATE TABLE IF NOT EXISTS 不会给已存在的表加列）
    # 【重要】api_token/token_created_at 必须保留：get_token 接口（794/817/1234 行）依赖这两列
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(ai_accounts)")}
        for _col, _ddl in (('updated_at', 'TEXT'),
                           ('api_token', 'TEXT'),
                           ('token_created_at', 'TEXT')):
            if _col not in cols:
                conn.execute(f"ALTER TABLE ai_accounts ADD COLUMN {_col} {_ddl}")
                cols.add(_col)
        # 老库 user_id 无 UNIQUE 约束 → ON CONFLICT(user_id) 会报错，补唯一索引（先清重复）
        try:
            conn.execute('''DELETE FROM ai_accounts WHERE id NOT IN
                            (SELECT MIN(id) FROM ai_accounts GROUP BY user_id)''')
            conn.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_accounts_user ON ai_accounts(user_id)')
        except Exception as _e:
            print(f'[ai_proxy] migrate unique(user_id): {_e}')
    except Exception as e:
        print(f'[ai_proxy] migrate ai_accounts: {e}')
    conn.commit()

def main_db():
    conn = sqlite3.connect(MAIN_DB, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


# 上游渠道配置：key 只存在于服务端此文件/环境变量，绝不发给会员
# 【2026-XX 改造】废除多渠道自动降级：智谱对话线路只保留一条上游（zhipu-sub），
# 请求失败直接把上游错误返回，不再自动换渠道重试。
# 模型清单/默认模型/排序/启用与否，唯一事实源 = api/zf_models_config.json（admin_zf_models.asp 维护），
# 本文件只负责「转发选中的那条线路」。
def _env(name):
    return os.environ.get(name, '')

# 本地密钥文件（可选，优先级低于环境变量）：C:\work\web\ai_keys.json
# 格式：{"ZHIPU_SUB_API_KEY":"...","ZHIPU_API_KEY":"...","ARK_API_KEY":"...","ARK_MODEL_ID":"..."}
_KEY_PATHS = [
    r'E:\work\web\ai_keys.json',  # 服务器唯一 key 存放点（2026-09-26 改造）
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ai_keys.json'),
]
_KEY_FILE = next((p for p in _KEY_PATHS if os.path.exists(p)), _KEY_PATHS[0])
try:
    _KEYS = json.load(open(_KEY_FILE, encoding='utf-8')) if os.path.exists(_KEY_FILE) else {}
except Exception:
    _KEYS = {}
def _key(name):
    v = os.environ.get(name, '')
    if v:
        return v
    return _KEYS.get(name, '')

# 单一上游：智谱订阅（Code Plan）线路，地址+Key 由 ai_keys.json / 环境变量提供
CHANNELS = {
    'zhipu-sub': {
        'url': 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
        'key': _key('ZHIPU_SUB_API_KEY'),
        'model': 'glm-5.3-flash',
    },
    # 【2026-09-30 恢复】朱峰大模型线路（zf-glm-flash）：走官方网关 zf_models_relay，
    # 鉴权用本机 zf3d_commands 已有的 heartbeat key + X-ZF-User，不新增/下载任何 key。
    'zf-relay': {
        'url': 'https://www.zf3d.com/api/zf_models_relay.asp',
        'key': '',   # 延迟加载：见 _zf_relay_auth()，启动时不读登录态
        'model': 'glm-5.3-flash',
        'zf_relay': True,
    },
    # 【2026-10-02 新增】小米MiMo线路：与 zf-relay 同样走官网 zf_models_relay 中转（key存官网服务端），
    # 用户免key；本机仅用已有 heartbeat 登录态鉴权，不新增/下载任何 key。
    'mimo-sub': {
        'url': 'https://www.zf3d.com/api/zf_models_relay.asp',
        'key': '',   # 延迟加载：同 zf-relay 的 _zf_relay_auth()
        'model': 'mimo-v2.6-flash',
        'zf_relay': True,
    },
}

# 模型别名 -> 唯一渠道（不再有降级链）。模型开放性以 zf_models_config.json / ai_pricing 表为准
UPSTREAMS = {
    'zhipu-glm-5.3-flash': ['zhipu-sub'],
    'glm5.3-flash': ['zhipu-sub'],   # alias
    'glm-5.3-flash': ['zhipu-sub'],  # alias（带连字符写法）
    'zf-glm-flash': ['zf-relay'],    # 【2026-09-30 恢复】朱峰大模型默认线路
    'mimo-v2.6-flash': ['mimo-sub'],  # 【2026-10-02】小米mimo线路：走服务器中转，用户免key
}

_zf_relay_cache = {'t': 0, 'key': '', 'uid': ''}

def _zf_relay_auth():
    """延迟获取朱峰网关鉴权（heartbeat key + uid），缓存 10 分钟。
    只读本机 zf3d_commands 已保存的登录态，不做任何下载/新申请。"""
    import time as _t
    now = _t.time()
    if now - _zf_relay_cache['t'] < 600 and _zf_relay_cache['key']:
        return _zf_relay_cache['key'], _zf_relay_cache['uid']
    import sys as _sys, os as _os
    _srv = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'server')
    if _srv not in _sys.path:
        _sys.path.insert(0, _srv)
    from zf3d_commands import _get_api_key
    key = _get_api_key() or ''
    uid = ''
    try:
        from zf3d_heartbeat import _get_login_status
        st = _get_login_status()
        uid = str((st[2] if len(st) > 2 else '') or '')
        if not uid.isdigit():
            uid = ''
    except Exception:
        pass
    _zf_relay_cache.update(t=now, key=key, uid=uid)
    return key, uid

# 兼容旧字段：返回唯一渠道（不做「找第一个有 key 的」选择）
def _default_channel(model):
    chs = UPSTREAMS.get(model)
    return chs[0] if chs else None


# ========== 【2026-10 稳定性改造】多线路赛道池 ==========
# 设计：每个模型可配多条上游线路（UPSTREAMS[model] 列表），
# 1) 健康优先：熔断中的线路自动跳过，冷却到期自动恢复半开探测；
# 2) 失败换道：当前线路连接失败/5xx 时自动切下一条，用户无感；
# 3) 负载分摊：默认轮询（round-robin），让多条线路共同承担流量；
# 4) 每用户并发池：防止单用户打满上游导致所有人排队。
_channel_state = {}   # name -> {'fail': int, 'open_until': ts}
_rr_counter = {'n': 0}
_user_sema = {}       # uid -> threading.Semaphore
_sema_lock = threading.Lock()

FUSE_THRESHOLD = 3      # 连续失败 N 次 -> 熔断
FUSE_COOLDOWN = 30      # 熔断冷却秒数
PER_USER_CONCURRENCY = 3  # 单用户对上游的最大并发

def _user_sem(uid):
    sem = _user_sema.get(uid)
    if sem is None:
        with _sema_lock:
            sem = _user_sema.get(uid)
            if sem is None:
                sem = threading.Semaphore(PER_USER_CONCURRENCY)
                _user_sema[uid] = sem
    return sem

def _channel_healthy(name):
    st = _channel_state.get(name)
    return not (st and st['open_until'] > time.time())

def _mark_fail(name):
    st = _channel_state.setdefault(name, {'fail': 0, 'open_until': 0})
    st['fail'] += 1
    if st['fail'] >= FUSE_THRESHOLD:
        st['open_until'] = time.time() + FUSE_COOLDOWN
        st['fail'] = 0
        print(f'[ai_proxy] 线路 {name} 连续失败，熔断 {FUSE_COOLDOWN}s')

def _mark_ok(name):
    _channel_state[name] = {'fail': 0, 'open_until': 0}

def pick_channel(model):
    """按 UPSTREAMS[model] 顺序取健康线路；全部熔断则返回冷却剩余最短的那条兜底。
    健康线路之间轮询分摊（赛道分流通车）。"""
    chs = UPSTREAMS.get(model) or []
    healthy = [c for c in chs if _channel_healthy(c)]
    if not healthy:
        # 全熔断：选最快恢复的线路硬试一次（半开探测）
        return min(chs, key=lambda c: _channel_state.get(c, {}).get('open_until', 0)) if chs else None
    if len(healthy) > 1:
        _rr_counter['n'] += 1
        return healthy[_rr_counter['n'] % len(healthy)]
    return healthy[0]
# ========= 赛道池 END =========

app = Flask(__name__)
_db_lock = threading.Lock()

def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn

# 启动时确保 AI 表存在
try:
    _c = db(); _init_ai_tables(_c); _c.close()
except Exception as _e:
    print('[ai_proxy] init tables warn:', _e)

def get_pricing(conn, model):
    r = conn.execute('SELECT * FROM ai_pricing WHERE model=? AND enabled=1', (model,)).fetchone()
    return r

def auth_token(token, ip):
    """校验会员令牌 -> 返回 user_id 或 None。令牌只存哈希，防拖库。"""
    if not token or not token.startswith('zfai_'):
        return None
    h = hashlib.sha256(token.encode()).hexdigest()
    with _db_lock:
        conn = db()
        try:
            row = conn.execute(
                "SELECT a.user_id, a.balance, a.status FROM ai_accounts a WHERE a.token_hash=?",
                (h,)).fetchone()
            if not row or row['status'] != 'active':
                return None
            return dict(row)
        finally:
            conn.close()

def calc_cost(conn, model, pt, ct):
    p = get_pricing(conn, model)
    if not p:
        return None
    # 价格按 每百万token 计价（元）；multiplier 为站点倍率
    cost = (pt * p['price_in'] + ct * p['price_out']) / 1_000_000.0 * p['multiplier']
    return round(max(cost, 0.0001), 6)



def _charge(user, model, cost, pt, ct, ip):
    """按次扣费：生图/视频/识图等定额计费，不走 token 公式"""
    mconn = main_db()
    with _db_lock:
        try:
            mconn.execute('BEGIN')
            mconn.execute('UPDATE users SET token_balance = token_balance - ? WHERE user_id=?', (cost, user['user_id']))
            bal = mconn.execute('SELECT token_balance FROM users WHERE user_id=?', (user['user_id'],)).fetchone()['token_balance']
            mconn.execute('COMMIT')
        except Exception:
            mconn.execute('ROLLBACK')
            mconn.close()
            raise
        mconn.close()
        conn = db()
        try:
            conn.execute('INSERT INTO ai_usage(user_id,model,prompt_tokens,completion_tokens,cost,balance_after,source_ip) VALUES(?,?,?,?,?,?,?)',
                         (user['user_id'], model, pt, ct, cost, bal, ip))
            conn.commit()
        finally:
            conn.close()
    return bal


def _trusted_ip():
    """仅当请求来自本机回环（可信代理）时才采纳 X-Real-IP，否则用 remote_addr，防外网伪造。"""
    ra = request.remote_addr or ''
    if ra in ('127.0.0.1', '::1', 'localhost'):
        return (request.headers.get('X-Real-IP') or ra).strip()
    return ra

def _require_user():
    token = request.headers.get('Authorization', '').replace('Bearer ', '').strip()
    ip = _trusted_ip()
    user = auth_token(token, ip)
    if not user:
        return None, None, (jsonify({'error': {'message': '令牌无效或已停用', 'type': 'auth_error'}}), 401)
    mb = main_db()
    try:
        bal = mb.execute('SELECT token_balance FROM users WHERE user_id=?', (user['user_id'],)).fetchone()
    finally:
        mb.close()
    # 主站库无该用户（如本地 uid=1 测试账号）时，回落到 ai_accounts.balance 判断
    if bal is None:
        if (user.get('balance') or 0) <= 0:
            return None, None, (jsonify({'error': {'message': '积分不足，请充值', 'type': 'insufficient_balance'}}), 402)
    elif (bal['token_balance'] or 0) <= 0:
        return None, None, (jsonify({'error': {'message': '积分不足，请充值', 'type': 'insufficient_balance'}}), 402)
    return user, ip, None

# ---------- 开放接口（给智能体/第三方软件调用，兼容 OpenAI 格式） ----------

# 健康探活：返回版本标记，供 server.py 识别 8787 端口上的进程
# 是否为本项目 ai_proxy（区分旧版本/陌生进程抢占端口的情况）
ZF_PROXY_HEALTH = {'ok': True, 'service': 'zf-ai-proxy', 'ver': 3}

@app.route('/health')
@app.route('/v1/health')
def _health():
    return jsonify(ZF_PROXY_HEALTH)

@app.route('/v1/models')
def list_models():
    return jsonify({'object': 'list', 'data': [
        {'id': m, 'object': 'model', 'owned_by': 'zf-community'}
        for m in UPSTREAMS if get_pricing(db(), m)]})

@app.route('/v1/chat/completions', methods=['POST'])
def chat():
    t0 = time.time()
    token = request.headers.get('Authorization', '').replace('Bearer ', '').strip()
    ip = _trusted_ip()
    user = auth_token(token, ip) if token else None
    # 【身份票模式】无 Bearer 时兜底验 Cookie 里的 HMAC 身份票（zf_idt）
    if not user:
        try:
            import zf_identity as _zfi
            _tk = request.cookies.get('zf_idt', '')
            if _tk:
                _res = _zfi.verify_identity(_tk)
                _uid = _res[0] if isinstance(_res, tuple) else _res
                if _uid:
                    user = {'user_id': int(_uid), 'username': f'zf_idt_{_uid}', 'balance': 1}
        except Exception:
            pass
    if not user:
        return jsonify({'error': {'message': '令牌无效或已停用', 'type': 'auth_error'}}), 401

    body = request.get_json(silent=True) or {}
    model = body.get('model', '')
    if model not in UPSTREAMS:
        return jsonify({'error': {'message': '未知模型', 'type': 'invalid_request'}}), 400

    conn = db()
    pricing = get_pricing(conn, model)
    conn.close()
    if not pricing:
        return jsonify({'error': {'message': '模型未开放', 'type': 'invalid_request'}}), 400

    # 风控：余额为 0 拒绝。余额唯一来源=主站库 users.token_balance（见 _get_balance_uid
    # 的口径）；主站库无该用户记录时才回落 ai_accounts.balance。
    # 【bugfix】旧代码直接用 auth 带出的 ai_accounts.balance——该字段已废弃不记账
    # （如 uid 69503 主站余额 97 却被旧逻辑按 ai_accounts 的 -1587 误拒 → 402 余额不足）。
    try:
        _ubal, _ustat = _get_balance_uid(user.get('user_id'))
    except Exception:
        _ubal = None
    if _ubal is None:
        _ubal = user.get('balance') or 0
    if _ubal <= 0:
        return jsonify({'error': {'message': '积分不足，请充值', 'type': 'insufficient_balance'}}), 402
    if len(request.get_data()) > 512 * 1024:
        return jsonify({'error': {'message': '请求过大', 'type': 'invalid_request'}}), 413

    payload = dict(body)
    stream = bool(body.get('stream'))

    # 【赛道池】多线路健康分摊 + 失败自动换道 + 熔断冷却（2026-10 改造）
    import copy as _copy
    tried = []
    resp = None
    last_err = ''
    ch_names = list(UPSTREAMS.get(model) or [])
    # 健康线路排前，熔断线路排后（仅在全熔断时兜底硬试）
    ordered = [c for c in ch_names if _channel_healthy(c)] + [c for c in ch_names if not _channel_healthy(c)]
    _sem = _user_sem(user.get('user_id'))
    for ch_name in ordered:
        ch = CHANNELS.get(ch_name)
        if not ch:
            continue
        if ch.get('zf_relay') and not ch.get('key'):
            _rk, _ru = _zf_relay_auth()
            if _rk:
                ch = dict(ch, key=_rk)
        if not ch.get('key'):
            tried.append(f'{ch_name}:key未配置')
            continue
        p_body = _copy.deepcopy(payload)
        p_body['model'] = ch['model']
        if stream:
            p_body.setdefault('stream_options', {'include_usage': True})
        headers = {'Authorization': f"Bearer {ch['key']}", 'Content-Type': 'application/json'}
        # 【2026-10-02 修复】zf-relay 线路官网网关只认 X-ZF-Key + X-ZF-User 头，
        # 只发 Authorization 会被判 unauthorized [diag] no-key | loginUid=0 -> 401。
        if ch.get('zf_relay'):
            headers['X-ZF-Key'] = ch['key']
            try:
                _rk2, _ru2 = _zf_relay_auth()
                if _ru2:
                    headers['X-ZF-User'] = str(_ru2)
            except Exception:
                pass
        acquired = _sem.acquire(timeout=20)
        try:
            try:
                if stream:
                    resp = http.post(ch['url'], json=p_body, headers=headers, stream=True, timeout=300)
                else:
                    resp = http.post(ch['url'], json=p_body, headers=headers, timeout=180)
            except Exception as e:
                last_err = f'{ch_name}: {e}'
                tried.append(last_err)
                _mark_fail(ch_name)
                resp = None
                continue
            # 5xx/429 视为线路异常 -> 熔断计数并换道；4xx 直接透传给用户
            if resp.status_code in (429, 500, 502, 503, 504):
                last_err = f'{ch_name}: HTTP {resp.status_code}'
                tried.append(last_err)
                _mark_fail(ch_name)
                resp = None
                continue
            _mark_ok(ch_name)
            break
        finally:
            if acquired:
                _sem.release()
    if resp is None:
        return jsonify({'error': {'message': f'AI 服务网关异常，所有线路暂不可用（{"; ".join(tried) or last_err}），请稍后重试', 'type': 'upstream_error'}}), 502
    if resp.status_code != 200:
        return app.response_class(resp.content, resp.status_code, {'Content-Type': 'application/json'})
    if stream:
        return _proxy_stream(user, model, resp, ip, t0)

    data = resp.json()
    usage = data.get('usage') or {}
    pt, ct = usage.get('prompt_tokens', 0), usage.get('completion_tokens', 0)

    conn = db()
    cost = calc_cost(conn, model, pt, ct) or 0
    with _db_lock:
        try:
            conn.execute('BEGIN')
            conn.execute("UPDATE ai_accounts SET balance=balance-?, updated_at=datetime('now','localtime') WHERE user_id=?",
                         (cost, user['user_id']))
            bal = conn.execute('SELECT balance FROM ai_accounts WHERE user_id=?', (user['user_id'],)).fetchone()['balance']
            conn.execute('INSERT INTO ai_usage(user_id,model,prompt_tokens,completion_tokens,cost,balance_after,source_ip) VALUES(?,?,?,?,?,?,?)',
                         (user['user_id'], model, pt, ct, cost, bal, ip))
            conn.execute('COMMIT')
        except Exception:
            conn.execute('ROLLBACK')
            raise
        finally:
            conn.close()
    return jsonify(data)

def _proxy_stream(user, model, resp, ip, t0):
    """流式转发（resp 已由主流程建立），同时统计 usage（OpenAI 格式 stream_options.include_usage）"""
    import queue as _q

    def gen():
        pt = ct = 0
        try:
            for line in resp.iter_lines():
                if not line:
                    continue
                line = line.decode('utf-8', 'ignore')
                if line.startswith('data: '):
                    chunk = line[6:]
                    if chunk.strip() == '[DONE]':
                        yield 'data: [DONE]\n\n'
                        break
                    try:
                        d = json.loads(chunk)
                        u = d.get('usage')
                        if u:
                            pt, ct = u.get('prompt_tokens', 0), u.get('completion_tokens', 0)
                    except Exception:
                        pass
                yield (line + '\n\n').encode('utf-8')
        finally:
            conn = db()
            cost = calc_cost(conn, model, pt, ct) or 0
            with _db_lock:
                try:
                    conn.execute('BEGIN')
                    conn.execute("UPDATE ai_accounts SET balance=balance-?, updated_at=datetime('now','localtime') WHERE user_id=?",
                                 (cost, user['user_id']))
                    bal = conn.execute('SELECT balance FROM ai_accounts WHERE user_id=?', (user['user_id'],)).fetchone()['balance']
                    conn.execute('INSERT INTO ai_usage(user_id,model,prompt_tokens,completion_tokens,cost,balance_after,source_ip) VALUES(?,?,?,?,?,?,?)',
                                 (user['user_id'], model, pt, ct, cost, bal, ip))
                    conn.execute('COMMIT')
                except Exception:
                    conn.execute('ROLLBACK')
                finally:
                    conn.close()

    return app.response_class(gen(), 200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no'})


# ---------- 生图（火山方舟 Seedream，按张计费） ----------

@app.route('/v1/images/generations', methods=['POST'])
def image_gen():
    if not ZFC:
        return jsonify({'error': {'message': '生图通道未配置', 'type': 'invalid_request'}}), 400
    user, ip, err = _require_user()
    if err: return err
    body = request.get_json(silent=True) or {}
    n = max(1, min(int(body.get('n', 1) or 1), 4))   # 单次最多4张，防滥用
    ch = ZFC.CHANNELS['imagegen']
    api_key = ch.get('apiKey') or _key('ARK_API_KEY')
    if not api_key:
        return jsonify({'error': {'message': '生图渠道 key 未配置', 'type': 'upstream_error'}}), 502
    model_id = ch.get('modelId') or ch.get('model_fallback') or body.get('model', '')
    p_body = dict(body)
    p_body['model'] = model_id
    p_body['n'] = n
    try:
        resp = http.post(ch['baseUrl'].rstrip('/') + ch['createUrl'], json=p_body,
                         headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}, timeout=300)
    except Exception as e:
        return jsonify({'error': {'message': f'生图渠道连接失败: {e}', 'type': 'upstream_error'}}), 502
    if resp.status_code != 200:
        return app.response_class(resp.content, resp.status_code, {'Content-Type': 'application/json'})
    # 成功后按张扣费
    rate = ZFC.calc_cost('imagegen', n)[0]
    cost = round(rate * n, 6)
    bal = _charge(user, 'zf-imagegen', cost, 0, 0, ip)
    data = resp.json()
    data['zf_billing'] = {'type': 'imagegen', 'count': n, 'unit_rate': rate, 'cost': cost, 'balance_after': bal}
    return jsonify(data)


# ---------- 视频（火山方舟 Seedance，异步任务，按秒计费） ----------

@app.route('/v1/videos/generations', methods=['POST'])
def video_create():
    if not ZFC:
        return jsonify({'error': {'message': '视频通道未配置', 'type': 'invalid_request'}}), 400
    user, ip, err = _require_user()
    if err: return err
    ch = ZFC.CHANNELS['video']
    api_key = ch.get('apiKey') or _key('ARK_API_KEY')
    if not api_key:
        return jsonify({'error': {'message': '视频渠道 key 未配置', 'type': 'upstream_error'}}), 502
    body = request.get_json(silent=True) or {}
    model_id = ch.get('modelId') or ch.get('model_fallback') or body.get('model', '')
    p_body = dict(body)
    p_body['model'] = model_id
    try:
        resp = http.post(ch['baseUrl'].rstrip('/') + ch['createUrl'], json=p_body,
                         headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}, timeout=120)
    except Exception as e:
        return jsonify({'error': {'message': f'视频渠道连接失败: {e}', 'type': 'upstream_error'}}), 502
    return app.response_class(resp.content, resp.status_code, {'Content-Type': 'application/json'})


@app.route('/v1/videos/generations/<task_id>', methods=['GET'])
def video_query(task_id):
    if not ZFC:
        return jsonify({'error': {'message': '视频通道未配置', 'type': 'invalid_request'}}), 400
    user, ip, err = _require_user()
    if err: return err
    ch = ZFC.CHANNELS['video']
    api_key = ch.get('apiKey') or _key('ARK_API_KEY')
    try:
        resp = http.get(ch['baseUrl'].rstrip('/') + ch['queryUrl'].replace('{task_id}', task_id),
                        headers={'Authorization': f'Bearer {api_key}'}, timeout=60)
    except Exception as e:
        return jsonify({'error': {'message': f'视频渠道连接失败: {e}', 'type': 'upstream_error'}}), 502
    if resp.status_code == 200:
        data = resp.json()
        status = (data.get('status') or '').lower()
        if status == 'succeeded' and not data.get('zf_charged'):
            dur = 5
            try:
                c = str(data.get('content') or {})
                import re as _re
                m = _re.search(r'(\d+)s', c)
                if m: dur = int(m.group(1))
            except Exception:
                pass
            dur = min(max(dur, 1), ch.get('max_duration_seconds', 10))
            rate = ZFC.calc_cost('video', dur)[0]
            cost = round(rate * dur, 6)
            bal = _charge(user, 'zf-video', cost, 0, 0, ip)
            data['zf_billing'] = {'type': 'video', 'seconds': dur, 'unit_rate': rate, 'cost': cost, 'balance_after': bal}
            data['zf_charged'] = True
        return jsonify(data)
    return app.response_class(resp.content, resp.status_code, {'Content-Type': 'application/json'})

# ---------- 管理端点（仅本机调用，用于网站 asp 后台联动） ----------

@app.route('/internal/issue_identity', methods=['POST'])
def _issue_identity():
    """[2026-09-21 安全加固] 用本地用户库校验后签发身份票（Cookie zf_idt）。
    浏览器登录态经本地服务核验，返回的票带 HMAC-SHA256 签名和过期时间，
    下游 zf_proxy_billing.identify_user 只认这张票，不再信客户端自报 ID。"""
    if request.remote_addr not in ('127.0.0.1', '::1'):
        return jsonify({'error': 'forbidden'}), 403
    try:
        import zf_identity as _zfi
    except Exception:
        _zfi = None
    if _zfi is None:
        return jsonify({'error': 'zf_identity missing'}), 500
    if not _zfi.internal_auth_ok(request.headers):
        _zfi.audit('internal_unauth', path=request.path, ip=request.remote_addr or '')
        return jsonify({'error': 'forbidden: missing X-ZF-Internal'}), 403
    data = request.get_json(silent=True) or {}
    try:
        uid = int(data.get('user_id') or 0)
    except Exception:
        uid = 0
    if uid <= 0:
        return jsonify({'error': 'user_id required'}), 400
    # 本地库必须存在该会员，否则拒签（防止随便填 ID）
    try:
        import sqlite3
        conn = sqlite3.connect(DB_PATH, timeout=10)
        try:
            try:
                row = conn.execute('SELECT id FROM users WHERE id=? LIMIT 1', (uid,)).fetchone()
            except Exception:
                row = None
            if not row:
                try:
                    row = conn.execute('SELECT user_id FROM users WHERE user_id=? LIMIT 1', (uid,)).fetchone()
                except Exception:
                    row = None
        finally:
            conn.close()
        if not row:
            _zfi.audit('issue_identity_reject', uid=uid, reason='user_not_in_local_db')
            return jsonify({'error': 'unknown user'}), 404
    except Exception as e:
        return jsonify({'error': 'db check failed: %s' % e}), 500
    ticket = _zfi.sign_identity(uid)
    if not ticket:
        return jsonify({'error': 'sign failed'}), 500
    _zfi.audit('issue_identity', uid=uid)
    resp = jsonify({'ok': True, 'user_id': uid, 'expires_in': _zfi._TICKET_TTL})
    resp.set_cookie('zf_idt', ticket, max_age=_zfi._TICKET_TTL, httponly=True, samesite='Lax', path='/')
    return resp


@app.route('/issue_ticket', methods=['GET'])
def issue_ticket_public():
    """[过渡方案 2026-09-26] 浏览器直接向 8787 取身份票（免重启 9210）：
    读 9210 本地库 zf3d.login_data 校验登录态，登录则本地签 HMAC 票并 Set-Cookie。
    仅允许本机来源；密钥与 9210 共用同一 zf_identity。"""
    if request.remote_addr not in ('127.0.0.1', '::1'):
        return jsonify({'error': 'forbidden'}), 403
    try:
        import zf_identity as _zfi
    except Exception:
        return jsonify({'ok': False, 'error': 'zf_identity missing'}), 500
    try:
        import sqlite3 as _sq
        dbp = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           'private', 'db', 'zf3d_canvas.db')
        conn = _sq.connect(dbp, timeout=10)
        try:
            row = conn.execute("SELECT value FROM app_data WHERE category='zf3d' AND key='login_data'").fetchone()
        finally:
            conn.close()
        login = json.loads(row[0]) if row and row[0] else None
    except Exception as e:
        return jsonify({'ok': False, 'error': 'db_error'}), 500
    if not login or not login.get('success'):
        return jsonify({'ok': False, 'error': 'not_login'}), 401
    uid = login.get('user_id') or (login.get('data') or {}).get('user_id')
    try:
        uid = int(uid or 0)
    except Exception:
        uid = 0
    if uid <= 0:
        return jsonify({'ok': False, 'error': 'not_login'}), 401
    ticket = _zfi.sign_identity(uid)
    if not ticket:
        return jsonify({'ok': False, 'error': 'sign failed'}), 500
    _zfi.audit('issue_identity', uid=uid, via='gw_public_ticket')
    resp = jsonify({'ok': True, 'user_id': uid, 'expires_in': _zfi._TICKET_TTL})
    resp.set_cookie('zf_idt', ticket, max_age=_zfi._TICKET_TTL, httponly=True, samesite='Lax', path='/')
    return resp


@app.route('/internal/issue_token', methods=['POST'])
def issue_token():
    if request.remote_addr not in ('127.0.0.1', '::1'):
        return jsonify({'error': 'forbidden'}), 403
    try:
        import zf_identity as _zfi
    except Exception:
        _zfi = None
    if _zfi is not None and not _zfi.internal_auth_ok(request.headers):
        _zfi.audit('internal_unauth', path=request.path, ip=request.remote_addr or '')
        return jsonify({'error': 'forbidden: missing X-ZF-Internal'}), 403
    d = request.get_json(force=True)
    uid = int(d['user_id'])
    token = 'zfai_' + secrets.token_urlsafe(32)
    h = hashlib.sha256(token.encode()).hexdigest()
    conn = db()
    with _db_lock:
        conn.execute('''INSERT INTO ai_accounts(user_id,api_token,token_hash,token_created_at)
                        VALUES(?,?,?,datetime('now','localtime'))
                        ON CONFLICT(user_id) DO UPDATE SET api_token=excluded.api_token,
                        token_hash=excluded.token_hash,token_created_at=excluded.token_created_at,status='active' ''',
                     (uid, _dpapi_protect(token), h))  # 安全加固：api_token 存 DPAPI 密文，不存明文
        conn.commit(); conn.close()
    return jsonify({'token': token})  # 明文只返回这一次，由页面展示给会员

@app.route('/internal/get_token', methods=['POST'])
def get_token():
    """幂等取令牌：已有则直接返回明文，没有才新发。供网站登录即用免粘贴。"""
    if request.remote_addr not in ('127.0.0.1', '::1'):
        return jsonify({'error': 'forbidden'}), 403
    try:
        import zf_identity as _zfi
    except Exception:
        _zfi = None
    if _zfi is not None and not _zfi.internal_auth_ok(request.headers):
        _zfi.audit('internal_unauth', path=request.path, ip=request.remote_addr or '')
        return jsonify({'error': 'forbidden: missing X-ZF-Internal'}), 403
    d = request.get_json(force=True)
    uid = int(d['user_id'])
    conn = db()
    acc = conn.execute('SELECT api_token,status FROM ai_accounts WHERE user_id=?', (uid,)).fetchone()
    if acc and acc['status'] == 'active' and acc['api_token']:
        conn.close()
        plain = _dpapi_unwrap(acc['api_token'])
        if plain:
            return jsonify({'token': plain})  # 解密成功 → 幂等返回
        # 解密失败（跨机器迁移）→ 走重发，旧哈希随之失效
        return issue_token()
    conn.close()
    return issue_token()

@app.route('/internal/stats', methods=['POST'])
def stats():
    """用量统计：余额、累计/今日调用与消费、近30天每日用量（供 aitoken.asp 图表）。"""
    if request.remote_addr not in ('127.0.0.1', '::1'):
        return jsonify({'error': 'forbidden'}), 403
    try:
        import zf_identity as _zfi
    except Exception:
        _zfi = None
    if _zfi is not None and not _zfi.internal_auth_ok(request.headers):
        _zfi.audit('internal_unauth', path=request.path, ip=request.remote_addr or '')
        return jsonify({'error': 'forbidden: missing X-ZF-Internal'}), 403
    d = request.get_json(force=True, silent=True) or {}
    try:
        uid = int(d.get('user_id', 0))
    except Exception:
        uid = 0
    diag = ''
    try:
        conn = db()
    except Exception as e:
        return jsonify({'balance': 0, 'total': {'calls': 0, 'cost': 0.0},
                        'today': {'calls': 0, 'cost': 0.0}, 'daily': [], 'models': [],
                        'usage': [], 'diag': 'db-open:' + type(e).__name__})
    if uid <= 0:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'balance': 0, 'total': {'calls': 0, 'cost': 0.0},
                        'today': {'calls': 0, 'cost': 0.0}, 'daily': [], 'models': [],
                        'usage': [], 'diag': 'bad-uid'})
    balance = 0
    try:
        mc = main_db()
        try:
            macc = mc.execute('SELECT token_balance FROM users WHERE user_id=?', (uid,)).fetchone()
            balance = round(macc['token_balance'], 2) if macc and macc['token_balance'] is not None else 0
        finally:
            mc.close()
    except Exception as e:
        balance = 0
        diag = 'maindb:' + type(e).__name__
    total = {'calls': 0, 'cost': 0.0}
    today = {'calls': 0, 'cost': 0.0}
    daily = []
    try:
        r = conn.execute('SELECT COUNT(*) c, ROUND(SUM(cost),2) s FROM ai_usage WHERE user_id=?', (uid,)).fetchone()
        total = {'calls': r['c'], 'cost': r['s'] or 0}
        r = conn.execute("SELECT COUNT(*) c, ROUND(SUM(cost),2) s FROM ai_usage WHERE user_id=? AND date(created_at)=date('now','localtime')", (uid,)).fetchone()
        today = {'calls': r['c'], 'cost': r['s'] or 0}
        rows = conn.execute("""SELECT date(created_at) day, COUNT(*) calls, ROUND(SUM(cost),2) cost,
                               SUM(prompt_tokens) pt, SUM(completion_tokens) ct
                               FROM ai_usage WHERE user_id=? AND created_at >= datetime('now','localtime','-29 days')
                               GROUP BY date(created_at) ORDER BY day""", (uid,)).fetchall()
        dmap = {x['day']: dict(x) for x in rows}
        from datetime import date as _date, timedelta as _td
        base = _date.today()
        for i in range(29, -1, -1):
            day = (base - _td(days=i)).isoformat()
            x = dmap.get(day)
            daily.append({'day': day[5:], 'calls': x['calls'] if x else 0,
                          'cost': x['cost'] if x else 0,
                          'tokens': ((x['pt'] or 0) + (x['ct'] or 0)) if x else 0})
    except sqlite3.OperationalError:
        pass
    usage = []
    try:
        usage = conn.execute('SELECT created_at,model,prompt_tokens,completion_tokens,cost,balance_after FROM ai_usage WHERE user_id=? ORDER BY id DESC LIMIT 100', (uid,)).fetchall()
    except sqlite3.OperationalError:
        usage = []
    models = []
    try:
        models = conn.execute("""SELECT model, COUNT(*) calls, ROUND(SUM(cost),2) cost,
                               SUM(prompt_tokens) pt, SUM(completion_tokens) ct
                               FROM ai_usage WHERE user_id=? AND created_at >= datetime('now','localtime','-30 days')
                               GROUP BY model ORDER BY cost DESC""", (uid,)).fetchall()
        models = [dict(m) for m in models]
    except Exception:
        pass
    try:
        conn.close()
    except Exception:
        pass
    hourly = []
    try:
        hrs = conn.execute("SELECT substr(created_at,12,2) h, COUNT(*) c, ROUND(SUM(cost),2) s FROM ai_usage WHERE user_id=? AND date(created_at)=date('now','localtime') GROUP BY h", (uid,)).fetchall()
        hmap = {int(x['h']): x for x in hrs}
        hourly = [{'h': i, 'calls': (hmap[i]['c'] if i in hmap else 0), 'cost': ((hmap[i]['s'] or 0) if i in hmap else 0)} for i in range(24)]
    except Exception:
        pass
    return jsonify({'balance': balance, 'total': total, 'today': today, 'daily': daily, 'hourly': hourly, 'models': models, 'usage': [dict(r) for r in usage], 'diag': diag or None})

@app.route('/internal/recharge', methods=['POST'])
def recharge():
    if request.remote_addr not in ('127.0.0.1', '::1'):
        return jsonify({'error': 'forbidden'}), 403
    try:
        import zf_identity as _zfi
    except Exception:
        _zfi = None
    if _zfi is not None and not _zfi.internal_auth_ok(request.headers):
        _zfi.audit('internal_unauth', path=request.path, ip=request.remote_addr or '')
        return jsonify({'error': 'forbidden: missing X-ZF-Internal'}), 403
    d = request.get_json(force=True)
    uid, credits = int(d['user_id']), float(d['credits'])
    conn = db()
    with _db_lock:
        conn.execute('UPDATE ai_accounts SET balance=balance+?, updated_at=datetime(\'now\',\'localtime\') WHERE user_id=?', (credits, uid))
        conn.commit(); conn.close()
    return jsonify({'ok': True})

def _internal_auth():
    if request.remote_addr not in ('127.0.0.1', '::1'):
        return False
    try:
        import zf_identity as _zfi
    except Exception:
        return True
    if _zfi is not None and not _zfi.internal_auth_ok(request.headers):
        _zfi.audit('internal_unauth', path=request.path, ip=request.remote_addr or '')
        return False
    return True

def _get_balance_uid(uid):
    """余额唯一来源：主站库 users.token_balance；主站库无此用户时回落 ai_accounts.balance"""
    try:
        mc = main_db()
        try:
            r = mc.execute('SELECT token_balance FROM users WHERE user_id=?', (uid,)).fetchone()
            if r is not None:
                return round(r['token_balance'] or 0, 2), 'active'
        finally:
            mc.close()
    except Exception:
        pass
    conn = db()
    try:
        r = conn.execute('SELECT balance, status FROM ai_accounts WHERE user_id=?', (uid,)).fetchone()
        if r is None:
            return None, None
        return round(r['balance'] or 0, 2), r['status']
    finally:
        conn.close()

@app.route('/internal/me', methods=['POST'])
def internal_me():
    """按 user_id 查余额/状态（zf_billing.get_balance 与 /api/zf3d/ai-balance 用）"""
    if not _internal_auth():
        return jsonify({'error': 'forbidden'}), 403
    d = request.get_json(force=True, silent=True) or {}
    try:
        uid = int(d.get('user_id', 0))
    except Exception:
        uid = 0
    if uid <= 0:
        return jsonify({'balance': 0, 'status': 'none'})
    balance, status = _get_balance_uid(uid)
    usage = []
    if balance is not None:
        try:
            conn = db()
            try:
                usage = conn.execute('SELECT created_at,model,prompt_tokens,completion_tokens,cost,balance_after FROM ai_usage WHERE user_id=? ORDER BY id DESC LIMIT 20', (uid,)).fetchall()
                usage = [dict(r) for r in usage]
            finally:
                conn.close()
        except sqlite3.OperationalError:
            pass
    return jsonify({'balance': balance or 0, 'status': status or 'none', 'usage': usage})

@app.route('/internal/deduct', methods=['POST'])
def internal_deduct():
    """条件扣费：余额足够才扣（原子），不足返回 insufficient（zf_billing.charge 用）"""
    if not _internal_auth():
        return jsonify({'error': 'forbidden'}), 403
    d = request.get_json(force=True, silent=True) or {}
    try:
        uid = int(d.get('user_id', 0))
        cost = round(float(d.get('cost', 0)), 4)
    except Exception:
        return jsonify({'ok': False, 'error': 'bad_request'}), 400
    if uid <= 0 or cost < 0:
        return jsonify({'ok': False, 'error': 'bad_request'}), 400
    # 优先主站库 users.token_balance 条件扣减；主站库无此用户时回落 ai_accounts
    mconn = main_db()
    try:
        with _db_lock:
            mconn.execute('BEGIN')
            r = mconn.execute('SELECT token_balance FROM users WHERE user_id=?', (uid,)).fetchone()
            if r is not None:
                if float(r['token_balance'] or 0) < cost:
                    mconn.execute('ROLLBACK')
                    return jsonify({'ok': False, 'error': 'insufficient', 'balance': float(r['token_balance'] or 0)}), 402
                mconn.execute('UPDATE users SET token_balance = token_balance - ? WHERE user_id=?', (cost, uid))
                bal = mconn.execute('SELECT token_balance FROM users WHERE user_id=?', (uid,)).fetchone()['token_balance']
                mconn.execute('COMMIT')
                return jsonify({'ok': True, 'balance': round(bal, 2)})
            mconn.execute('ROLLBACK')
    finally:
        mconn.close()
    conn = db()
    try:
        with _db_lock:
            conn.execute('BEGIN')
            a = conn.execute('SELECT balance, status FROM ai_accounts WHERE user_id=?', (uid,)).fetchone()
            if not a or a['status'] != 'active':
                conn.execute('ROLLBACK')
                return jsonify({'ok': False, 'error': 'account_not_found_or_disabled'}), 404
            if float(a['balance']) < cost:
                conn.execute('ROLLBACK')
                return jsonify({'ok': False, 'error': 'insufficient', 'balance': float(a['balance'])}), 402
            conn.execute('UPDATE ai_accounts SET balance=balance-?, updated_at=datetime(\'now\',\'localtime\') WHERE user_id=?', (cost, uid))
            bal = conn.execute('SELECT balance FROM ai_accounts WHERE user_id=?', (uid,)).fetchone()['balance']
            conn.execute('COMMIT')
        return jsonify({'ok': True, 'balance': round(bal, 2)})
    finally:
        conn.close()

# ==================== 管理员面板（改余额/Token，带审计） ====================
import secrets as _secrets

_ADMIN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'private', 'billing')
_ADMIN_PW_FILE = os.path.join(_ADMIN_DIR, 'admin_password.txt')
_ADMIN_LOG = os.path.join(_ADMIN_DIR, 'admin_audit.log')


def _admin_password():
    """首次访问自动生成管理密码并落盘（私盘 private/ 下，不进 git）。"""
    os.makedirs(_ADMIN_DIR, exist_ok=True)
    if not os.path.exists(_ADMIN_PW_FILE):
        pw = _secrets.token_urlsafe(12)
        with open(_ADMIN_PW_FILE, 'w', encoding='utf-8') as f:
            f.write(pw)
    with open(_ADMIN_PW_FILE, encoding='utf-8') as f:
        return f.read().strip()


def _admin_auth():
    """管理接口鉴权：仅本机 + X-ZF-Admin 密码头。"""
    if request.remote_addr not in ('127.0.0.1', '::1'):
        return False
    return request.headers.get('X-ZF-Admin', '') == _admin_password()


def _admin_audit(action, **fields):
    """追加式审计日志：谁在何时做了什么资金操作，永不覆盖。"""
    try:
        os.makedirs(_ADMIN_DIR, exist_ok=True)
        e = {'ts': time.strftime('%Y-%m-%d %H:%M:%S'), 'action': action, 'ip': request.remote_addr or ''}
        e.update(fields)
        with open(_ADMIN_LOG, 'a', encoding='utf-8') as f:
            f.write(json.dumps(e, ensure_ascii=False) + '\n')
    except Exception:
        pass


@app.route('/admin', methods=['GET'])
def admin_page():
    if request.remote_addr not in ('127.0.0.1', '::1'):
        return 'forbidden', 403
    return _ADMIN_HTML


@app.route('/admin/login', methods=['POST'])
def admin_login():
    """校验密码，返回 OK（密码本身由页面存 sessionStorage，每次请求带头）。"""
    if request.remote_addr not in ('127.0.0.1', '::1'):
        return jsonify({'ok': False, 'error': 'forbidden'}), 403
    d = request.get_json(force=True, silent=True) or {}
    if d.get('password', '') == _admin_password():
        _admin_audit('login')
        return jsonify({'ok': True})
    _admin_audit('login_fail')
    return jsonify({'ok': False, 'error': 'wrong_password'}), 401


@app.route('/admin/users', methods=['POST'])
def admin_users():
    """列出用户余额：主站 users.token_balance，合并 ai_accounts.status。"""
    if not _admin_auth():
        return jsonify({'error': 'forbidden'}), 403
    out = []
    try:
        mc = main_db()
        try:
            rows = mc.execute(
                "SELECT user_id, username, token_balance FROM users WHERE token_balance IS NOT NULL ORDER BY user_id").fetchall()
            for r in rows:
                out.append({'user_id': r['user_id'], 'username': r['username'] or '',
                            'balance': round(r['token_balance'] or 0, 2), 'status': 'active'})
        finally:
            mc.close()
    except Exception as e:
        pass
    try:
        conn = db()
        try:
            accts = {r['user_id']: r for r in conn.execute(
                'SELECT user_id, balance, status FROM ai_accounts').fetchall()}
        finally:
            conn.close()
    except Exception:
        accts = {}
    seen = {u['user_id'] for u in out}
    for uid, r in accts.items():
        if uid in seen:
            for u in out:
                if u['user_id'] == uid:
                    u['status'] = r['status']
        else:
            out.append({'user_id': uid, 'username': '', 'balance': round(r['balance'] or 0, 2), 'status': r['status']})
    return jsonify({'ok': True, 'users': out})


@app.route('/admin/adjust', methods=['POST'])
def admin_adjust():
    """管理员改余额：amount 可正可负；必须带 reason；写审计流水。"""
    if not _admin_auth():
        return jsonify({'error': 'forbidden'}), 403
    d = request.get_json(force=True, silent=True) or {}
    mode = str(d.get('mode', 'add')).strip()  # add=增减 / set=直接设定
    try:
        uid = int(d.get('user_id', 0))
        amount = round(float(d.get('amount', 0)), 2)
        reason = str(d.get('reason', '')).strip()[:200]
    except Exception:
        return jsonify({'ok': False, 'error': 'bad_request'}), 400
    # [fix] set 模式允许 amount=0（清零操作）；add 模式仍拒绝 0
    if uid <= 0 or not reason:
        return jsonify({'ok': False, 'error': '需要 user_id、reason'}), 400
    if mode == 'add' and amount == 0:
        return jsonify({'ok': False, 'error': 'add 模式 amount 不能为 0（清零请用 set 模式）'}), 400
    if amount < 0:
        return jsonify({'ok': False, 'error': 'amount 不能为负'}), 400
    if mode not in ('add', 'set'):
        return jsonify({'ok': False, 'error': 'mode 仅支持 add/set'}), 400

    # 1) 主站库 users.token_balance（余额唯一来源）
    updated_main = False
    new_bal = None
    try:
        mc = main_db()
        try:
            with _db_lock:
                r = mc.execute('SELECT token_balance FROM users WHERE user_id=?', (uid,)).fetchone()
                if r is not None:
                    old_bal = round(r['token_balance'] or 0, 2)
                    new_bal = round(amount, 2) if mode == 'set' else round(old_bal + amount, 2)
                    if new_bal < 0:
                        return jsonify({'ok': False, 'error': f'余额不足，调整后为负({new_bal})'}), 400
                    mc.execute('UPDATE users SET token_balance=? WHERE user_id=?', (new_bal, uid))
                    mc.commit()
                    updated_main = True
        finally:
            mc.close()
    except Exception as e:
        _admin_audit('adjust_error', user_id=uid, amount=amount, error=str(e))
        return jsonify({'ok': False, 'error': str(e)}), 500

    # 2) 主站库无此用户 → 回落改 ai_accounts.balance
    if not updated_main:
        conn = db()
        try:
            with _db_lock:
                r = conn.execute('SELECT balance FROM ai_accounts WHERE user_id=?', (uid,)).fetchone()
                if r is None:
                    return jsonify({'ok': False, 'error': '用户不存在（主站库与 ai_accounts 均无）'}), 404
                old_bal = round(r['balance'] or 0, 2)
                new_bal = round(amount, 2) if mode == 'set' else round(old_bal + amount, 2)
                if new_bal < 0:
                    return jsonify({'ok': False, 'error': f'余额不足，调整后为负({new_bal})'}), 400
                conn.execute("UPDATE ai_accounts SET balance=?, updated_at=datetime('now','localtime') WHERE user_id=?",
                             (new_bal, uid))
                conn.commit()
        finally:
            conn.close()

    _admin_audit('adjust', user_id=uid, amount=amount, reason=reason,
                 balance_after=new_bal, target='users.token_balance' if updated_main else 'ai_accounts.balance')
    return jsonify({'ok': True, 'user_id': uid, 'amount': amount, 'balance_after': new_bal})


@app.route('/admin/reset_token', methods=['POST'])
def admin_reset_token():
    """管理员重置用户 API Token：作废旧令牌并签发新令牌（明文仅本次返回）。"""
    if not _admin_auth():
        return jsonify({'error': 'forbidden'}), 403
    d = request.get_json(force=True, silent=True) or {}
    try:
        uid = int(d.get('user_id', 0))
        reason = str(d.get('reason', '')).strip()[:200]
    except Exception:
        return jsonify({'ok': False, 'error': 'bad_request'}), 400
    if uid <= 0 or not reason:
        return jsonify({'ok': False, 'error': '需要 user_id、reason'}), 400

    # 旧 token 哈希（用于审计比对，不落明文）
    old_hash = None
    conn = db()
    try:
        token = 'zfai_' + secrets.token_urlsafe(32)
        h = hashlib.sha256(token.encode()).hexdigest()
        with _db_lock:
            r = conn.execute('SELECT token_hash FROM ai_accounts WHERE user_id=?', (uid,)).fetchone()
            old_hash = r['token_hash'][:12] + '…' if r and r['token_hash'] else None
            conn.execute('''INSERT INTO ai_accounts(user_id,api_token,token_hash,token_created_at)
                            VALUES(?,?,?,datetime('now','localtime'))
                            ON CONFLICT(user_id) DO UPDATE SET api_token=excluded.api_token,
                            token_hash=excluded.token_hash,token_created_at=excluded.token_created_at,status='active' ''',
                         (uid, _dpapi_protect(token), h))  # 安全加固：api_token 存 DPAPI 密文
            conn.commit()
    finally:
        conn.close()
    _admin_audit('reset_token', user_id=uid, reason=reason, old_hash_prefix=old_hash)
    return jsonify({'ok': True, 'user_id': uid, 'token': token})


@app.route('/admin/pricing', methods=['GET', 'POST'])
def admin_pricing():
    """模型费率管理：GET 列出全部，POST 修改单个模型或全局倍率。
    POST 参数：
      model='*'        → global_multiplier 对所有启用模型统一设置（整体费率）
      model='xxx'      → 修改单模型 price_in/price_out/multiplier/enabled
    全部写审计。"""
    if not _admin_auth():
        return jsonify({'error': 'forbidden'}), 403
    conn = db()
    try:
        if request.method == 'GET':
            rows = conn.execute('SELECT * FROM ai_pricing ORDER BY model').fetchall()
            return jsonify({'ok': True, 'pricing': [dict(r) for r in rows]})
        d = request.get_json(force=True, silent=True) or {}
        reason = str(d.get('reason', '')).strip()[:200]
        if not reason:
            return jsonify({'ok': False, 'error': 'reason 必填（写入审计）'}), 400
        model = str(d.get('model', '')).strip()
        if not model:
            return jsonify({'ok': False, 'error': 'model 必填（"*" 表示全部模型）'}), 400
        with _db_lock:
            if model == '*':
                gm = d.get('global_multiplier')
                if gm is None:
                    return jsonify({'ok': False, 'error': 'global_multiplier 必填'}), 400
                gm = max(0.0, float(gm))
                conn.execute('UPDATE ai_pricing SET multiplier=? WHERE enabled=1', (round(gm, 4),))
                conn.commit()
                _admin_audit('pricing_global', multiplier=round(gm, 4), reason=reason)
                return jsonify({'ok': True, 'changed': 'all enabled models', 'multiplier': round(gm, 4)})
            row = conn.execute('SELECT * FROM ai_pricing WHERE model=?', (model,)).fetchone()
            if row is None:
                return jsonify({'ok': False, 'error': f'模型不存在: {model}'}), 404
            old = dict(row)
            sets, vals = [], []
            for k, cast in (('price_in', float), ('price_out', float), ('multiplier', float)):
                if k in d:
                    v = max(0.0, cast(d[k]))
                    sets.append(f'{k}=?'); vals.append(round(v, 6))
            if 'enabled' in d:
                sets.append('enabled=?'); vals.append(1 if d['enabled'] else 0)
            if not sets:
                return jsonify({'ok': False, 'error': '无可修改字段'}), 400
            vals.append(model)
            conn.execute(f'UPDATE ai_pricing SET {", ".join(sets)} WHERE model=?', vals)
            conn.commit()
            _admin_audit('pricing_model', model=model, old=old, new=d, reason=reason)
            return jsonify({'ok': True, 'model': model})
    finally:
        conn.close()


# ---------- 邮箱验证奖励（注册/绑定邮箱赠送 token，多重防刷） ----------

_BONUS_TABLE = '''CREATE TABLE IF NOT EXISTS ai_email_bonus_log(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    email_norm TEXT NOT NULL,
    ip TEXT DEFAULT '',
    bonus REAL NOT NULL,
    granted_at TEXT DEFAULT (datetime('now','localtime')))'''

_BONUS_AMOUNT = 1.0          # 每次赠送金额（元），可按需调整
_BONUS_EMAIL_DOMAIN_MIN = 2  # 同一邮箱域名最多奖励账号数（防 xx1@ qq.com xx2@qq.com 批量注册）


def _norm_email(e):
    """归一化邮箱：小写 + gmail dots/plus 规整（防同箱多号）。"""
    e = (e or '').strip().lower()
    if '@' not in e:
        return e
    local, domain = e.rsplit('@', 1)
    if domain in ('gmail.com', 'googlemail.com'):
        local = local.split('+')[0].replace('.', '')
        domain = 'gmail.com'
    return local + '@' + domain


@app.route('/bonus/status', methods=['GET'])
def bonus_status():
    """前端查询：当前用户是否可领邮箱奖励。需登录态（X-ZF-User 由主站签发或 token）。
    安全加固：加内部签名校验，防止局域网设备凭 uid 探测用户存在性/邮箱。"""
    if not _internal_auth():
        return jsonify({'ok': False, 'error': 'forbidden: missing X-ZF-Internal'}), 403
    uid = request.headers.get('X-ZF-User', '') or request.args.get('uid', '')
    try:
        uid = int(uid)
    except Exception:
        uid = 0
    if uid <= 0:
        return jsonify({'ok': False, 'error': '请先登录'}), 401
    mc = main_db()
    try:
        r = mc.execute('SELECT email FROM users WHERE user_id=?', (uid,)).fetchone()
        if r is None:
            return jsonify({'ok': False, 'error': '用户不存在'}), 404
        email = (r['email'] or '').strip()
        claimed = _bonus_claimed_count(uid)
        if not email:
            return jsonify({'ok': True, 'eligible': False,
                            'msg': '绑定邮箱后可领取 %.2f 元 AI 余额' % _BONUS_AMOUNT, 'claimed': claimed})
        return jsonify({'ok': True, 'eligible': claimed == 0, 'email': email,
                        'bonus': _BONUS_AMOUNT, 'claimed': claimed,
                        'msg': ('验证邮箱可领 %.2f 元 AI 余额' if claimed == 0 else '奖励已领取') % _BONUS_AMOUNT})
    finally:
        mc.close()


def _bonus_claimed_count(uid):
    conn = db()
    try:
        conn.execute(_BONUS_TABLE)
        n = conn.execute('SELECT COUNT(*) FROM ai_email_bonus_log WHERE user_id=?', (uid,)).fetchone()[0]
        return n
    finally:
        conn.close()


@app.route('/bonus/claim', methods=['POST'])
def bonus_claim():
    """领取邮箱验证奖励。防刷五重校验：
    ①每账号仅一次 ②每邮箱(归一化)仅一次 ③每 IP 24h 限 3 次
    ④同一邮箱域名仅前 N 个账号 ⑤别名邮箱(+/.变体)按归一化去重"""
    data = request.get_json(force=True, silent=True) or {}
    # 安全加固：仅接受本机主站后端（带内部签名）代发的领取请求，
    # 防止客户端伪造 user_id 冒领他人奖励
    if not _internal_auth():
        _admin_audit('bonus_claim_unauth', ip=request.remote_addr or '')
        return jsonify({'ok': False, 'error': 'forbidden: missing X-ZF-Internal'}), 403
    try:
        uid = int(data.get('user_id') or 0)
    except Exception:
        uid = 0
    # 仅信任来自本机/可信代理请求中的 X-Real-IP（_internal_auth 已保证 remote_addr 为本机）
    ip = (request.headers.get('X-Real-IP') or request.remote_addr or '').strip()
    if uid <= 0:
        return jsonify({'ok': False, 'error': '请先登录'}), 401
    mc = main_db()
    try:
        r = mc.execute('SELECT email, token_balance FROM users WHERE user_id=?', (uid,)).fetchone()
    finally:
        mc.close()
    if r is None:
        return jsonify({'ok': False, 'error': '用户不存在'}), 404
    email = (r['email'] or '').strip()
    if not email or '@' not in email:
        return jsonify({'ok': False, 'error': '请先绑定并验证邮箱后再领取'}), 400
    email_norm = _norm_email(email)
    domain = email_norm.rsplit('@', 1)[1]

    conn = db()
    try:
        conn.execute(_BONUS_TABLE)
        with _db_lock:
            # ① 每账号一次
            if conn.execute('SELECT 1 FROM ai_email_bonus_log WHERE user_id=?', (uid,)).fetchone():
                return jsonify({'ok': False, 'error': '该账号已领取过奖励'}), 400
            # ② 归一化邮箱全局唯一
            if conn.execute('SELECT 1 FROM ai_email_bonus_log WHERE email_norm=?', (email_norm,)).fetchone():
                return jsonify({'ok': False, 'error': '该邮箱已领取过奖励'}), 400
            # ③ IP 24h 限 3 次
            if conn.execute("SELECT COUNT(*) FROM ai_email_bonus_log WHERE ip=? AND granted_at>datetime('now','localtime','-24 hours')", (ip,)).fetchone()[0] >= 3:
                return jsonify({'ok': False, 'error': '该网络今日领取次数已达上限'}), 429
            # ④ 同域名限量（一次性邮箱/批量注册高发域）
            dom_count = conn.execute("SELECT COUNT(*) FROM ai_email_bonus_log WHERE substr(email_norm, instr(email_norm,'@')+1)=?", (domain,)).fetchone()[0]
            if dom_count >= _BONUS_EMAIL_DOMAIN_MIN:
                return jsonify({'ok': False, 'error': '该邮箱域奖励名额已满'}), 400
            # 发放：主站余额 +1，记录流水
            amount = _BONUS_AMOUNT
            mc2 = main_db()
            try:
                with _db_lock:
                    mc2.execute('UPDATE users SET token_balance=round(token_balance,2)+? WHERE user_id=?', (amount, uid))
                    mc2.commit()
            finally:
                mc2.close()
            conn.execute('INSERT INTO ai_email_bonus_log(user_id,email,email_norm,ip,bonus) VALUES(?,?,?,?,?)',
                         (uid, email, email_norm, ip, amount))
            conn.commit()
        _admin_audit('email_bonus', user_id=uid, email=email, ip=ip, amount=amount)
        return jsonify({'ok': True, 'bonus': amount, 'msg': '奖励 %.2f 元已到账' % amount})
    finally:
        conn.close()


@app.route('/admin/bonus', methods=['POST'])
def admin_bonus_config():
    """管理员调整奖励金额与领取规则（写审计）。参数：amount, domain_limit(可选)"""
    if not _admin_auth():
        return jsonify({'error': 'forbidden'}), 403
    global _BONUS_AMOUNT
    d = request.get_json(force=True, silent=True) or {}
    reason = str(d.get('reason', '')).strip()
    if not reason:
        return jsonify({'ok': False, 'error': 'reason 必填'}), 400
    if 'amount' in d:
        _BONUS_AMOUNT = max(0.0, float(d['amount']))
    if 'domain_limit' in d:
        globals()['_BONUS_EMAIL_DOMAIN_MIN'] = max(1, int(d['domain_limit']))
    _admin_audit('bonus_config', amount=_BONUS_AMOUNT, reason=reason)
    return jsonify({'ok': True, 'amount': _BONUS_AMOUNT})


@app.route('/admin/audit', methods=['POST'])
def admin_audit_view():
    """查看审计流水（最近 limit 条）。"""
    if not _admin_auth():
        return jsonify({'error': 'forbidden'}), 403
    d = request.get_json(force=True, silent=True) or {}
    limit = max(1, min(int(d.get('limit', 50)), 500))
    out = []
    try:
        with open(_ADMIN_LOG, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        out.append(json.loads(line))
                    except Exception:
                        pass
    except FileNotFoundError:
        pass
    return jsonify({'ok': True, 'logs': out[-limit:][::-1]})


_ADMIN_HTML = '''<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>朱峰社区 · 管理员面板</title>
<style>
body{font-family:"Microsoft YaHei",sans-serif;background:#f4f5f7;margin:0;padding:24px}
h1{font-size:20px}
#login{max-width:320px;margin:80px auto;background:#fff;padding:24px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1)}
table{border-collapse:collapse;width:100%;background:#fff;border-radius:8px;overflow:hidden}
th,td{padding:8px 12px;border-bottom:1px solid #eee;text-align:left;font-size:14px}
th{background:#2c3e50;color:#fff}
button{cursor:pointer}
.btn-adj{background:#2980b9;color:#fff;border:0;border-radius:4px;padding:4px 10px}
#bar{margin:12px 0;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
input,select{padding:6px;border:1px solid #ccc;border-radius:4px}
#msg{color:#c0392b}
dialog{border:0;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,.3);padding:20px;min-width:340px}
</style></head><body>
<div id="login"><h3>管理员登录</h3>
<input type="password" id="pw" placeholder="管理密码" style="width:100%"><br><br>
<button onclick="login()">进入</button> <span id="msg"></span>
<p style="font-size:12px;color:#888">首次运行密码在 server/private/billing/admin_password.txt</p></div>
<div id="main" style="display:none">
<h1>朱峰社区 · 余额管理</h1>
<div id="bar">
 <input id="q" placeholder="搜索 user_id / 用户名">
 <button onclick="load()">刷新</button>
 <button onclick="showAudit()">审计流水</button>
 <span id="msg"></span></div>
<table id="tb"><thead><tr><th>user_id</th><th>用户名</th><th>余额(元)</th><th>状态</th><th>操作</th></tr></thead><tbody></tbody></table>
</div>
<dialog id="dlg"><h3 id="dlg_t">调整余额</h3>
<p id="dlg_u"></p>
操作方式：<select id="adj_mode" style="padding:4px"><option value="add">增减（正充负扣）</option><option value="set">直接设定余额为</option></select>
金额(元)：<input id="amt" type="number" step="0.01" style="width:120px"><br><br>
原因(必填)：<input id="rsn" style="width:100%"><br><br>
<button onclick="doAdj()">确认</button> <button onclick="dlg.close()">取消</button>
<p id="dlg_msg" style="color:#c0392b"></p></dialog>
<dialog id="adlg"><h3>审计流水（最近50条）</h3><div id="alog" style="max-height:400px;overflow:auto;font-size:12px;white-space:pre-wrap"></div>
<button onclick="adlg.close()">关闭</button></dialog>
<script>
const PW=sessionStorage.zfAdminPw||'';
async function api(path,body){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-ZF-Admin':PW},body:JSON.stringify(body||{})});if(r.status===403||r.status===401){sessionStorage.removeItem('zfAdminPw');location.reload();throw 0}return r.json()}
async function login(){const pw=document.getElementById('pw').value;const r=await fetch('/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});const j=await r.json();if(j.ok){sessionStorage.zfAdminPw=pw;location.reload()}else{document.getElementById('msg').textContent='密码错误'}}
if(PW){document.getElementById('login').style.display='none';document.getElementById('main').style.display='';load()}
async function load(){const j=await api('/admin/users');const q=(document.getElementById('q').value||'').toLowerCase();const tb=document.querySelector('#tb tbody');tb.innerHTML='';(j.users||[]).filter(u=>!q||String(u.user_id).includes(q)||u.username.toLowerCase().includes(q)).forEach(u=>{const tr=document.createElement('tr');tr.innerHTML=`<td>${u.user_id}</td><td>${u.username||'-'}</td><td>${u.balance}</td><td>${u.status}</td><td><button class="btn-adj" onclick='openDlg(${JSON.stringify(u)})'>调整</button> <button class="btn-adj" style="background:#c0392b" onclick='doResetToken(${JSON.stringify(u)})'>重置Token</button></td>`;tb.appendChild(tr)})}
function openDlg(u){document.getElementById('dlg_u').textContent=`用户 ${u.user_id}（${u.username||'-'}）当前余额 ${u.balance} 元`;document.getElementById('amt').value='';document.getElementById('rsn').value='';document.getElementById('dlg_msg').textContent='';window._uid=u.user_id;dlg.showModal()}
async function doAdj(){const amount=parseFloat(document.getElementById('amt').value);const reason=document.getElementById('rsn').value.trim();const mode=document.getElementById('adj_mode').value;if(!amount||!reason){document.getElementById('dlg_msg').textContent='金额与原因必填';return}if(!confirm(`确认${mode==='set'?'设定余额为':'调整用户'} ${window._uid} ${mode==='set'?'=':(amount>0?'+':'')}${amount} 元？`))return;const j=await api('/admin/adjust',{user_id:window._uid,amount,reason,mode});if(j.ok){dlg.close();load()}else{document.getElementById('dlg_msg').textContent=j.error||'失败'}}
async function doResetToken(u){const reason=prompt('重置 Token 原因（必填，将写入审计）：');if(!reason)return;if(!confirm(`确认重置用户 ${u.user_id} 的 API Token？旧令牌立即失效！`))return;const j=await api('/admin/reset_token',{user_id:u.user_id,reason});if(j.ok){prompt('新 Token（明文仅显示这一次，请复制转交用户）：',j.token)}else{alert(j.error||'失败')}}
async function showAudit(){const j=await api('/admin/audit',{limit:50});document.getElementById('alog').textContent=(j.logs||[]).map(l=>JSON.stringify(l)).join('\\n');adlg.showModal()}
</script></body></html>'''

def _proxy_port():
    """代理端口：优先 AI_PROXY_PORT 环境变量，其次 private/port.json 的 ai_proxy_port 字段，默认 8787。
    【多版本共存·端口段约定】朱峰智能体按版本号分端口段：
    5.4.x = 8550-8554，5.5.x = 8555-8559，5.6.x = 8560-8564 ...
    （每 0.1 小版本预留 5 个端口，同大版本下的小版本可复用同一段）
    ai_proxy_port 建议用每段最后一个：5.4.x=8554、5.5.x=8559，
    避免 5.4.5 与 5.5.0 的代理互相抢占端口、冲击对方后台。"""
    try:
        _p = int(os.environ.get('AI_PROXY_PORT', '0'))
        if _p > 0:
            return _p
    except Exception:
        pass
    try:
        _pj = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           'private', 'port.json')
        with open(_pj, 'r', encoding='utf-8-sig') as _f:
            _v = json.load(_f).get('ai_proxy_port')
        if isinstance(_v, int) and _v > 0:
            return _v
    except Exception:
        pass
    return 8509  # 兜底默认=本版本端口段末（5.5.x=8505-8509，唯一事实来源是 private/port.json）；升级 5.6.x 时改此处为 8564

PROXY_PORT = _proxy_port()

if __name__ == '__main__':
    host = os.environ.get('AI_PROXY_HOST', '127.0.0.1')  # 安全加固：默认仅本机，需局域网访问时设 AI_PROXY_HOST=0.0.0.0
    print('[ai_proxy] 启动成功，监听 %s:%s（单一上游线路：zhipu-sub，降级链已废除）' % (host, PROXY_PORT))
    if host not in ('127.0.0.1', 'localhost'):
        print('[ai_proxy] ⚠️ 安全警告：当前监听 %s，局域网设备可访问本代理！如非必要请改回 127.0.0.1' % host, flush=True)
    try:
        from waitress import serve
        serve(app, host=host, port=PROXY_PORT, threads=8)
    except ImportError:
        app.run(host=host, port=PROXY_PORT, threaded=True)
