# -*- coding: utf-8 -*-
"""conn_pool：按上游域名分组的 HTTPS 长连接复用（池系统 v1.0）。

设计要点（见 docs/池系统设计方案-2026-09-09.md §3.2）：
- 纯标准库 http.client，直连上游（不走系统代理——urllib 默认走系统代理，
  http.client 永远直连；本机直连已实测可用。若某环境必须走代理，
  把 private/chat_pool.json 的 conn_pool.enabled 改为 false 即回退 urllib 路径）。
- "重生式常驻"：供应商一般 30~60 秒掐空闲连接；归还/借出报错即弃旧建新，
  追求"秒级可用"而不是永不断线。
- 借出 → 用完归还（读到 EOF 视为健康可复用；中途关闭一律丢弃重建）。
- 全部带超时；空闲超时自动清理；每域名连接数上限可配。
"""
import ssl
import time
import threading
import http.client
from urllib.parse import urlparse

# 每域名空闲连接列表：hostname -> [(conn, last_used), ...]
_HOSTS = {}
_LOCK = threading.Lock()

# 池命中统计（观测复用率，供 snapshot/状态面板读取）
_STATS = {'hit': 0, 'miss': 0, 'expired_idle': 0, 'expired_life': 0,
          'discarded': 0, 'rejected_full': 0}
# 分窗统计：每个窗口独立计数，窗口到期自动归零重开（观测"最近"复用率，
# 避免 _STATS 长期只增看不出近期趋势）。_WIN_START 为窗口起点时间戳。
_WIN_SEC = 300.0
_WIN_STATS = dict(_STATS)
_WIN_START = time.time()


def _bump(k):
    """计数 +1：同时更新累计值与当前窗口值（均在 _LOCK 持有区内调用）。"""
    _STATS[k] += 1
    now = time.time()
    global _WIN_START
    if now - _WIN_START >= _WIN_SEC:  # 窗口到期：归零重开
        for key in _WIN_STATS:
            _WIN_STATS[key] = 0
        _WIN_START = now
    _WIN_STATS[k] += 1
# 连接最长寿命（秒）：供应商可能对超长存活的连接静默半关，
# 借出时超龄一律弃旧建新（宁可多一次握手，不赌一条老连接）
_MAX_CONN_LIFE = 300.0

# 由 chat_pool 在配置热加载时同步（单一配置源，避免双配置漂移）
_PER_HOST = 3
_IDLE_SEC = 60


def apply_cfg(cfg):
    """chat_pool 每次热加载配置时调用，同步 conn_pool 段。"""
    global _PER_HOST, _IDLE_SEC
    if not isinstance(cfg, dict):
        return
    try:
        _PER_HOST = max(1, int(cfg.get('per_host', 3)))
    except Exception:
        pass
    try:
        _IDLE_SEC = max(5, float(cfg.get('idle_sec', 60)))
    except Exception:
        pass


def _new_conn(scheme, host, port, timeout, context):
    """新建一条上游连接（http:// 用 HTTPConnection，其余 HTTPSConnection）。"""
    if scheme == 'http':
        return http.client.HTTPConnection(host, port, timeout=timeout)
    return http.client.HTTPSConnection(host, port, timeout=timeout, context=context)


def acquire(scheme, host, port, timeout, context=None):
    """借一条连接：优先取空闲复用（省 TCP+TLS 握手），没有就新建。

    两道弃旧判定：
    - 空闲超时（_IDLE_SEC）：闲置太久，对端大概率已掐；
    - 寿命超限（_MAX_CONN_LIFE）：连接存活过久可能被静默半关，
      与"刚归还"的空闲时间无关，一律重建。
    """
    key = '%s://%s:%d' % (scheme, host, port)
    now = time.time()
    with _LOCK:
        lst = _HOSTS.get(key)
        while lst:
            conn, ts = lst.pop()
            idle_ok = (now - ts) <= _IDLE_SEC
            born = getattr(conn, '_pool_born', None)
            life_ok = True if born is None else (now - born) <= _MAX_CONN_LIFE
            if not idle_ok:
                _bump('expired_idle')
                _safe_close(conn)
                continue
            if not life_ok:
                _bump('expired_life')
                _safe_close(conn)
                continue
            _bump('hit')
            return conn
        _bump('miss')
    conn = _new_conn(scheme, host, port, timeout, context)
    try:
        conn._pool_born = time.time()
    except Exception:
        pass
    return conn


def release(conn, healthy=True):
    """归还连接；不健康（中途关闭/报错）直接丢弃关闭。"""
    if conn is None:
        return
    if not healthy:
        _safe_close(conn)
        return
    key = '%s://%s:%d' % (getattr(conn, '_schema_key_scheme', ''),
                          conn.host, conn.port)
    with _LOCK:
        lst = _HOSTS.setdefault(key, [])
        if len(lst) >= _PER_HOST:
            _bump('rejected_full')
            _safe_close(conn)
            return
        lst.append((conn, time.time()))


def discard(conn):
    """丢弃连接（不归还）"""
    try:
        _bump('discarded')
    except Exception:
        pass
    _safe_close(conn)


def _safe_close(conn):
    try:
        conn.close()
    except Exception:
        pass


def tag_scheme(conn, scheme):
    """记录连接的协议（http/https），归还时用作分组键。"""
    try:
        conn._schema_key_scheme = scheme
    except Exception:
        pass


def cleanup_idle():
    """清理超过空闲时长的连接（由 chat_pool 的清理线程定期调用）。"""
    now = time.time()
    with _LOCK:
        for key in list(_HOSTS.keys()):
            lst = _HOSTS.get(key) or []
            keep = [(c, ts) for (c, ts) in lst if now - ts <= _IDLE_SEC]
            dead = [(c, ts) for (c, ts) in lst if now - ts > _IDLE_SEC]
            if dead:
                for c, _ts in dead:
                    _safe_close(c)
            if keep:
                _HOSTS[key] = keep
            else:
                _HOSTS.pop(key, None)
    return True


def snapshot():
    """只读快照（面板/状态接口用，返回可 JSON 序列化的 dict）。"""
    now = time.time()
    out = {}
    with _LOCK:
        for key, lst in _HOSTS.items():
            out[key] = {'idle': len(lst),
                        'oldest_age': round(now - lst[-1][1], 1) if lst else 0}
        out['_stats'] = dict(_STATS)
        hit = _STATS['hit']; miss = _STATS['miss']; total = hit + miss
        out['_stats']['hit_rate'] = round(hit * 100.0 / total, 1) if total else 0.0
        # 分窗统计：最近一个窗口（_WIN_SEC 秒内）的计数与命中率
        win = dict(_WIN_STATS)
        wt = win['hit'] + win['miss']
        win['hit_rate'] = round(win['hit'] * 100.0 / wt, 1) if wt else 0.0
        win['window_sec'] = round(min(_WIN_SEC, time.time() - _WIN_START), 1)
        out['_stats_window'] = win
    return out


def reset_stats():
    """清零累计统计与窗口统计（如面板"重置观测"按钮用）。需持 _LOCK。"""
    with _LOCK:
        for k in _STATS:
            _STATS[k] = 0
        for k in _WIN_STATS:
            _WIN_STATS[k] = 0
        global _WIN_START
        _WIN_START = time.time()
def open_pooled(target_url, method, data, headers, timeout, context=None):
    """向 target_url 发送一次性请求，返回 http.client 响应对象。

    返回值带 _pool_conn 属性：读完后由调用方调 release_pooled(resp, healthy)。
    复用到被供应商掐掉的旧连接时，请求阶段会报 RemoteDisconnected/OSError ——
    本函数自动弃旧建新重试一次（只重试一次，防放大重发）。
    重定向（301/302/303/307/308）：手动跟随，最多 3 跳。
    """
    p = urlparse(target_url)
    scheme = p.scheme or 'https'
    host = p.hostname
    port = p.port or (80 if scheme == 'http' else 443)
    if not host:
        raise ValueError('invalid target url')
    path_query = (p.path or '/') + (('?' + p.query) if p.query else '')

    # http.client 自管 Host/Content-Length，显式 Host 头会重复 → 剥离
    hdrs = {k: v for k, v in (headers or {}).items()
            if k.lower() != 'host'}

    last_exc = None
    for attempt in (1, 2):
        conn = acquire(scheme, host, port, timeout, context)
        tag_scheme(conn, scheme)
        try:
            conn.request(method, path_query, body=data, headers=hdrs)
            resp = conn.getresponse()
            # 手动跟随重定向（urllib 会自动跟，http.client 不会）
            hops = 0
            while resp.status in (301, 302, 303, 307, 308) and hops < 3:
                loc = resp.getheader('Location') or ''
                if not loc:
                    break
                hops += 1
                try:
                    resp.close()
                except Exception:
                    pass
                discard(conn)
                p2 = urlparse(loc if '://' in loc
                               else (scheme + '://' + host + (':' + str(port) if port not in (80, 443) else '') + loc))
                scheme = p2.scheme or scheme
                host = p2.hostname or host
                port = p2.port or (80 if scheme == 'http' else 443)
                path_query = (p2.path or '/') + (('?' + p2.query) if p2.query else '')
                conn = acquire(scheme, host, port, timeout, context)
                tag_scheme(conn, scheme)
                conn.request(method, path_query, body=data, headers=hdrs)
                resp = conn.getresponse()
            resp._pool_conn = conn
            resp._pool_eof = False
            return resp
        except Exception as e:
            # 请求阶段失败：可能是复用了被对端掐掉的连接 → 弃旧建新重试一次
            discard(conn)
            last_exc = e
            if attempt == 1 and _is_stale_conn_error(e):
                continue
            raise
    raise last_exc


def release_pooled(resp, healthy=True):
    """读完后归还连接（healthy=False 或未读到 EOF 时丢弃重建）。

    EOF 判定靠 resp._pool_eof 标记：pool_worker 在 read()/read1() 返回空
    （自然读到流尾）时置 True —— 只有读到 EOF 的连接才允许复用。
    """
    conn = getattr(resp, '_pool_conn', None)
    if conn is None:
        return
    resp._pool_conn = None
    try:
        if healthy and getattr(resp, '_pool_eof', False):
            release(conn, True)
        else:
            discard(conn)
    except Exception:
        _safe_close(conn)


def _is_stale_conn_error(exc):
    """请求阶段报这类错，大概率是复用了被对端掐掉的死连接，重建重试安全。"""
    # URLError 会把底层 ConnectionResetError(10054) 等包在 reason 里，拆开判断
    seen = 0
    while isinstance(exc, BaseException) and seen < 3:
        if isinstance(exc, (http.client.RemoteDisconnected, ConnectionResetError,
                            BrokenPipeError, ssl.SSLError)):
            return True
        # http.client 有时把死连接报成 OSError(10054/10053) 等
        if isinstance(exc, OSError):
            return True
        # 拆 URLError / http.client 包裹层
        reason = getattr(exc, 'reason', None)
        if reason is None or not isinstance(reason, BaseException):
            break
        exc = reason
        seen += 1
    return False
