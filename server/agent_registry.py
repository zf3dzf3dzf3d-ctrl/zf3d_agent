# -*- coding: utf-8 -*-
"""
agent_registry.py — 智能体互见与发现机制 · 阶段0 统一契约底座（2026-10-13）

【定位】三层（L1 进程内 / L2 本机多实例 / L3 跨软件）共用一套
「AgentCard 契约 + 分文件注册表 + discover 查询 + 判活」，只是数据源作用域不同。
本模块只做**纯标准库、零外部依赖、不碰 server.py 启动 import 链**的最小底座，
routes 通过「函数内延迟 import」挂载，热更新即可生效。

【关键设计（采纳蜂群策划师#2 的工程要点）】
1. 登记用「分文件」 private/agents/<id>.json，规避多实例并发写竞态；
   不用合并写单一 registry.json。
2. 原子写用 os.replace，避免半截 JSON。
3. 陈旧条目不靠删除清理，用 ts 新鲜度（TTL）判活 + 端口实测应答为权威存活信号。
4. host 虽在 port.json 配为 0.0.0.0（对外可被局域网发现），但发现接口只读、
   且调用入口（阶段1 之后的 send_to_agent）必须过 zf_identity.verify_identity，
   「发现 ≠ 授权」。本模块只负责「被看见」，不负责「被调用」。

【AgentCard 契约（对齐 A2A /.well-known/agent.json 语义，便于 L3 复用）】
{
  "id":          实例唯一标识（box_id/chat_id/hostname+pid 等）,
  "name":        人类可读名,
  "kind":        类型: agent | mcp-server | service,
  "version":     软件版本,
  "role":        角色/标签（可选）,
  "host":        监听地址,
  "ports":       {"api":8555,"ws":8556,...},
  "endpoints":   {"agent_info":"/agent-info","discover":"/api/agents"},
  "capabilities":[...],            # 对外声明的能力（粗粒度，供检索/展示）
  "status":      "alive|unknown",
  "pid":         进程号,
  "ts":          最近心跳毫秒,
  "protocol":    "zf-http|a2a|mcp",
  "zf_idt":      可选：HMAC 签名的自述身份票（仅本进程可信自述时签发）
}
"""
import os
import io
import json
import time
import glob
import socket
import threading

_BASE = os.path.dirname(os.path.abspath(__file__))
# 真实 private 目录在项目根（config.BASE_DIR = 项目根；server 是其子目录）。
# 优先复用 config 导出的路径常量，保证与运行进程读同一个 port.json；回退自身推导。
try:
    from config import BASE_DIR as _ROOT, PRIVATE_DIR as _PRIVATE
    _PORT_JSON = os.path.join(_PRIVATE, 'port.json')
except Exception:
    _ROOT = os.path.dirname(_BASE)
    _PRIVATE = os.path.join(_ROOT, 'private')
    _PORT_JSON = os.path.join(_PRIVATE, 'port.json')
_AGENTS_DIR = os.path.join(_PRIVATE, 'agents')

# 心跳新鲜度阈值（秒）。超过则视为陈旧（不删除，仅在判活时降权）。
AGENT_TTL_SEC = int(os.environ.get('ZF_AGENT_TTL', '90'))
# 端口实测连接超时（秒）
_PROBE_TIMEOUT = float(os.environ.get('ZF_PROBE_TO', '0.6'))

_write_lock = threading.Lock()

# 端口配置进程内缓存（port.json 极少变，5s TTL 足够）
_port_cache = {'v': None, 't': 0.0}


# ============================ 配置读取 ============================
def load_port_cfg():
    """读取 private/port.json 的端口/主机；失败返回保守默认（仅本机）。"""
    now = time.time()
    with _write_lock:
        if _port_cache['v'] and now - _port_cache['t'] < 5:
            return dict(_port_cache['v'])
    cfg = {'host': '127.0.0.1', 'api_port': 8555, 'ws_port': 8556}
    try:
        with io.open(_PORT_JSON, 'r', encoding='utf-8-sig') as f:
            data = json.load(f) or {}
        cfg['host'] = data.get('host') or '127.0.0.1'
        cfg['api_port'] = int(data.get('api_port') or 8555)
        cfg['ws_port'] = int(data.get('ws_port') or 8556)
        if isinstance(data.get('tts_stream'), dict):
            cfg['tts_port'] = int(data['tts_stream'].get('port') or 0) or None
        if data.get('remote_ws_port'):
            cfg['remote_ws_port'] = int(data['remote_ws_port'])
        if data.get('ai_proxy_port'):
            cfg['ai_proxy_port'] = int(data['ai_proxy_port'])
    except Exception:
        pass
    with _write_lock:
        _port_cache['v'] = dict(cfg)
        _port_cache['t'] = now
    return cfg


# ============================ 自述票（可选） ============================
def _sign_self_card(card):
    """尽力用 zf_identity 给本进程自述卡签名；失败则不带票（不影响主流程）。"""
    try:
        import zf_identity as _zid
        uid = card.get('id')
        # 复用现有 HMAC 票机制：把 agent id 当 uid 签一张自述票。
        # 仅作为「本进程可信自述」凭证，跨机/跨软件层（L3）才强制校验。
        return _zid.sign_identity(uid) if hasattr(_zid, 'sign_identity') else None
    except Exception:
        return None


# ============================ 判活 ============================
def probe_alive(host, port, timeout=_PROBE_TIMEOUT):
    """TCP 连接实测：能连上即视为该端口存活（权威存活信号）。"""
    if not port:
        return False
    # 0.0.0.0 不能作连接目标，统一用 127.0.0.1 探本机
    probe_host = '127.0.0.1' if host in ('0.0.0.0', '::', '') else host
    try:
        s = socket.create_connection((probe_host, int(port)), timeout=timeout)
        s.close()
        return True
    except Exception:
        return False


# ============================ 登记（心跳） ============================
def _safe_id(agent_id):
    """id 净化成合法文件名，防路径穿越。"""
    keep = []
    for ch in str(agent_id):
        if ch.isalnum() or ch in ('-', '_', '.'):
            keep.append(ch)
        else:
            keep.append('_')
    name = ''.join(keep).strip('._') or 'agent'
    return name[:120]


def register_self(overview=False, capabilities=None, role=None):
    """本实例向注册表写自己的 AgentCard（心跳）。返回写入路径或 None。"""
    cfg = load_port_cfg()
    hostname = socket.gethostname()
    agent_id = os.environ.get('ZF_AGENT_ID') or ('%s-%d' % (hostname, os.getpid()))
    try:
        from config import VERSION as _ver
    except Exception:
        _ver = 'unknown'
    card = {
        'id': agent_id,
        'name': os.environ.get('ZF_AGENT_NAME') or ('朱峰智能体 @%s' % hostname),
        'kind': 'agent',
        'version': _ver,
        'role': role or '',
        'host': cfg.get('host'),
        'ports': {
            'api': cfg.get('api_port'),
            'ws': cfg.get('ws_port'),
        },
        'endpoints': {'agent_info': '/agent-info', 'discover': '/api/agents'},
        'capabilities': capabilities or [
            'chat', 'tools', 'discover_agents',
        ],
        'status': 'alive',
        'pid': os.getpid(),
        'ts': int(time.time() * 1000),
        'protocol': 'zf-http',
    }
    if overview:
        ticket = _sign_self_card(card)
        if ticket:
            card['zf_idt'] = ticket
    return write_agent_card(card)


def write_agent_card(card):
    """原子写单个 AgentCard 到 private/agents/<id>.json。"""
    if not card or not card.get('id'):
        return None
    try:
        os.makedirs(_AGENTS_DIR, exist_ok=True)
        path = os.path.join(_AGENTS_DIR, _safe_id(card['id']) + '.json')
        tmp = path + '.tmp'
        payload = json.dumps(card, ensure_ascii=False, indent=2)
        with _write_lock:
            with io.open(tmp, 'w', encoding='utf-8') as f:
                f.write(payload)
            if os.path.exists(path):
                try:
                    os.replace(tmp, path)  # 原子替换
                except Exception:
                    os.remove(tmp)
            else:
                os.replace(tmp, path)
        return path
    except Exception:
        return None


# ============================ 查询（发现） ============================
def _read_card(path):
    try:
        with io.open(path, 'r', encoding='utf-8-sig') as f:
            return json.load(f)
    except Exception:
        return None


def list_agents(scope='local', mark_alive=True):
    """
    枚举注册表内的 AgentCard。
    scope=local：本机（进程内+多实例分文件）。stage0 仅实现 local。
    mark_alive：对每个候选做端口实测，覆盖 status（alive/dead），并据 ts 判新鲜。
    返回 {'ok':True,'agents':[card...],'count':n,'scope':scope}
    """
    if scope != 'local':
        # L2 跨实例聚合 / L3 跨软件在后续批次实现；此处优雅降级为 local 行为
        pass
    cards = []
    try:
        paths = glob.glob(os.path.join(_AGENTS_DIR, '*.json'))
    except Exception:
        paths = []
    now_ms = int(time.time() * 1000)
    for p in paths:
        c = _read_card(p)
        if not c:
            continue
        ts = int(c.get('ts') or 0)
        fresh = (now_ms - ts) <= AGENT_TTL_SEC * 1000
        if mark_alive:
            api_port = (c.get('ports') or {}).get('api')
            alive = probe_alive(c.get('host'), api_port)
            # 端口实测为权威：连得上=alive；连不上但 ts 新=stale；都失败=dead
            c['status'] = 'alive' if alive else ('stale' if fresh else 'dead')
            c['_fresh'] = fresh
            c['_port_ok'] = alive
        else:
            c['_fresh'] = fresh
            c['status'] = 'alive' if fresh else 'stale'
        cards.append(c)
    # 在线的排前
    cards.sort(key=lambda x: (0 if x.get('status') == 'alive' else 1,
                              -(int(x.get('ts') or 0))))
    return {'ok': True, 'agents': cards, 'count': len(cards),
            'scope': 'local', 'ttl_sec': AGENT_TTL_SEC}


def self_card():
    """返回本进程当前应当对外暴露的 AgentCard（实时判活），供 /agent-info 用。"""
    return register_self(overview=False)


def get_self_card_public():
    """给 /.well-known/agent.json 与 /agent-info 用的精简自述（不落盘，实时构造）。"""
    cfg = load_port_cfg()
    try:
        from config import VERSION as _ver
    except Exception:
        _ver = 'unknown'
    api_ok = probe_alive(cfg.get('host'), cfg.get('api_port'))
    return {
        'id': os.environ.get('ZF_AGENT_ID') or ('%s-%d' % (socket.gethostname(), os.getpid())),
        'name': os.environ.get('ZF_AGENT_NAME') or '朱峰智能体无限',
        'kind': 'agent',
        'version': _ver,
        'protocol': 'zf-http',
        'supported_protocols': ['zf-http', 'a2a', 'mcp'],
        'host': cfg.get('host'),
        'ports': {'api': cfg.get('api_port'), 'ws': cfg.get('ws_port')},
        'endpoints': {'agent_info': '/agent-info', 'discover': '/api/agents',
                      'well_known': '/.well-known/agent.json'},
        'capabilities': ['chat', 'tools', 'discover_agents'],
        'status': 'alive' if api_ok else 'unknown',
        'pid': os.getpid(),
        'ts': int(time.time() * 1000),
    }


# ============================ 清理（陈旧文件，可选） ============================
def prune_stale(max_age_sec=None):
    """删除超过 max_age_sec 的陈旧登记文件（默认 TTL*10）。返回删除数。"""
    if max_age_sec is None:
        max_age_sec = AGENT_TTL_SEC * 10
    now_ms = int(time.time() * 1000)
    removed = 0
    try:
        for p in glob.glob(os.path.join(_AGENTS_DIR, '*.json')):
            c = _read_card(p)
            ts = int((c or {}).get('ts') or 0)
            if ts and (now_ms - ts) > max_age_sec * 1000:
                try:
                    os.remove(p)
                    removed += 1
                except Exception:
                    pass
    except Exception:
        pass
    return removed


if __name__ == '__main__':
    p = register_self()
    print('registered ->', p)
    print(json.dumps(list_agents(), ensure_ascii=False, indent=2))
