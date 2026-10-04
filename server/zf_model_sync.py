#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
朱峰官方模型同步器（网站 = 权威来源，本地被动获取）
- 从朱峰网站 api/agent_api.asp?a=zf_models_get 拉取官方模型配置
- 覆盖本地 public/config/models.json：官方模型强制置顶、强制权威字段
- 网站删除的官方模型本地同步删除；用户自有模型不受影响
- 网站不可达时保留本地现状（缓存兜底），不影响使用
"""
import json
import os
import sys
import urllib.request
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_FILE = os.path.join(BASE, "server", "zf_sync_site.txt")
MODELS_FILE = os.path.join(BASE, "public", "config", "models.json")
# 【两文件分离】朱峰官方模型单独存放，不再混入本地 models.json
ZF_MODELS_FILE = os.path.join(BASE, "public", "config", "models_zf.json")
CACHE_FILE = os.path.join(BASE, "server", "zf_models_cache.json")

def _site():
    try:
        with open(SITE_FILE, "r", encoding="utf-8") as f:
            s = f.read().strip()
            if s:
                return s.rstrip("/")
    except OSError:
        pass
    return "https://www.zf3d.com"

def _api_key():
    """与 zf3d_heartbeat 同源认证：数据库 zf3d/heartbeat_api_key > private/heartbeat_key.json"""
    try:
        from server import config as _cfg  # noqa
    except Exception:
        _cfg = None
    try:
        import sqlite3
        db = os.path.join(BASE, 'private', 'app.db')
        if os.path.exists(db):
            con = sqlite3.connect(db)
            row = con.execute("SELECT value FROM config WHERE category='zf3d' AND key='heartbeat_api_key'").fetchone()
            con.close()
            if row and row[0]:
                return row[0]
    except Exception:
        pass
    try:
        with open(os.path.join(BASE, 'private', 'heartbeat_key.json'), 'r', encoding='utf-8') as f:
            return json.load(f).get('api_key', '')
    except OSError:
        return ''

def _port_open(host, port, timeout=0.3):
    import socket
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def _heal_local_gateway(url):
    """【根治·本机网关端口自愈】网站下发的 127.0.0.1 端口不可信：
    ai_proxy 历史上从 8527 迁移到 8787，网站旧配置写死 8527 时，每次同步
    都会把 models.json 改回无人监听的端口 → 前端 WinError 10061 连接拒绝。
    这里探测本机实际监听端口并改写；下次端口再迁移也自动跟随，无需改配置。"""
    import re
    if not url:
        return url
    m = re.match(r"^(https?://)(127\.0\.0\.1|localhost):(\d+)(/.*)$", url)
    if not m:
        return url
    scheme, host, port, rest = m.groups()
    try:
        port_n = int(port)
    except ValueError:
        return url
    # 【8527 保留】8527 现为主服务 server.py 监听端口，不处理对话接口；
    # 下发 8527 一律视为旧网关地址，强制改写为实际 AI 网关端口。
    if port_n in (8527,):
        for cand in (8509,):
            if _port_open(host, cand):
                return "%s%s:%d%s" % (scheme, host, cand, rest)
        return "%s%s:%d%s" % (scheme, host, 8509, rest)
    if _port_open(host, port_n):
        return url
    for cand in (8509,):
        if cand != port_n and _port_open(host, cand):
            return "%s%s:%d%s" % (scheme, host, cand, rest)
    return url


def _heal_cfg(cfg):
    """写入缓存前，对所有模型的 apiUrl 做本机网关端口自愈（根治 8527 回魂）"""
    try:
        models = cfg.get("models") if isinstance(cfg, dict) else None
        if isinstance(models, list):
            for m in models:
                if isinstance(m, dict) and m.get("apiUrl"):
                    m["apiUrl"] = _heal_local_gateway(m["apiUrl"])
    except Exception:
        pass
    return cfg


def fetch_site_config(timeout=8):
    """拉取网站官方模型配置，成功则写缓存并返回 dict；失败返回 None"""
    key = _api_key()
    url = _site() + "/api/agent_api.asp?a=zf_models_get"
    if key:
        url += "&key=" + urllib.parse.quote(key)
    req = urllib.request.Request(url, headers={"User-Agent": "zf-agent-sync"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            if raw[:2] in (b'\xff\xfe', b'\xfe\xff'):
                raw = raw.decode('utf-16').encode('utf-8')
            elif raw[:3] == b'\xef\xbb\xbf':
                raw = raw[3:]
            data = json.loads(raw.decode("utf-8", "replace"))
        if data.get("success") and isinstance(data.get("config"), dict):
            cfg = _heal_cfg(data["config"])
            with open(CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
            return cfg
    except Exception:
        pass
    # agent_api 需要 key，无 key/失败时回退拉公开权威配置（无需 key）
    try:
        url2 = _site() + "/api/zf_models_config.json"
        req2 = urllib.request.Request(url2, headers={"User-Agent": "zf-agent-sync"})
        with urllib.request.urlopen(req2, timeout=timeout) as r:
            raw = r.read()
            if raw[:3] == b'\xef\xbb\xbf':
                raw = raw[3:]
            data = json.loads(raw.decode("utf-8", "replace"))
        if isinstance(data, dict) and isinstance(data.get("models"), list) and data["models"]:
            data = _heal_cfg(data)
            with open(CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return data
    except Exception:
        pass
    # 网站不可达 → 用缓存兜底
    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except OSError:
        return None

def sync():
    cfg = fetch_site_config()
    if not cfg:
        return {"ok": False, "msg": "网站不可达且无缓存，跳过同步（本地配置未动）"}
    site_models = [m for m in cfg.get("models", []) if m.get("enabled", True)]
    if not site_models:
        return {"ok": False, "msg": "网站配置为空，跳过同步（安全保护）"}

    try:
        with open(MODELS_FILE, "r", encoding="utf-8") as f:
            local = json.load(f)
    except Exception:
        local = {"models": []}
    models = local.get("models", [])

    # 【自愈保护】补齐每条模型的必要字段，防止"再次消失"：
    # modelType 缺失 → 设置面板按分类过滤时被隐藏；visible 缺失 → 部分视图默认不显示。
    # 网站官方模型 id 集合
    site_ids = {m.get("id") or m.get("name") for m in site_models}
    # 1) 删除官方中转条目（见上方根治说明）

    # 【根治】只删除"真正的官方中转条目"（带 zfLine/zfManaged 标记）。
    # 之前还按 id/name 匹配 site_ids 连坐删除——本地用户自建直连条目若与官方撞 id
    # （如小米 mimo-language 直连版 vs 官方中转版），每次启动都会被误删（小米本地版消失根因）。
    # 【用户默认优先】同步前先记住本地各类型的默认模型 id（用户在设置面板手动选择过）。
    # 官方下发的 default 标记只能在"该类型还没有任何默认"时生效，
    # 否则每次同步/启动都会把用户选择的默认模型覆盖回官网默认（用户选 B 又变回 A 的根因）。
    def _dtype(m):
        t = str(m.get("modelType") or "").lower()
        if t in ("", "chat", "text"):
            return "language"
        if t in ("vision", "image_input"):
            return "vision"
        return t or ("vision" if m.get("visionInput") else "language")

    local_defaults = {}  # type -> id（本地用户已设置的默认）
    for _m in models:
        if isinstance(_m, dict) and _m.get("isDefault"):
            local_defaults.setdefault(_dtype(_m), _m.get("id"))

    models = [m for m in models
              if not (m.get("zfLine") or m.get("zfManaged")
                      or m.get("name") == "朱峰模型")]

    # 2) 网站官方模型 → 本地条目（强制权威字段，置顶）
    synced = []
    local_ids = {m.get("id") for m in models}
    for i, m in enumerate(site_models):
        mid = m.get("id") or ("zf-" + str(i))
        # 官方条目 id 与本地用户自建直连条目撞名时，官方条目让位加 -zf 后缀，两者共存
        if mid in local_ids:
            mid = mid + "-zf"
        # 模型ID选项：优先 modelIds[].id（含 tiers 强度档位），兜底 model 字段
        id_opts, levels_map = [], {}
        for mi in (m.get("modelIds") or []):
            oid = (mi.get("id") if isinstance(mi, dict) else str(mi)) or ""
            if not oid:
                continue
            id_opts.append(oid)
            tiers = mi.get("tiers") if isinstance(mi, dict) else None
            if isinstance(tiers, list) and tiers:
                levels_map[oid] = [str(t.get("value") if isinstance(t, dict) else t) for t in tiers]
        fallback_model = m.get("model", "")
        if not id_opts and fallback_model:
            id_opts = [fallback_model]
        # 【修复】relay_param 只在 keyRef=server 分支赋值，下面判断用户默认是否指向本条目时
        # 会用到它；keyRef=user（本地直连）分支若未初始化会 UnboundLocalError → /api/models/refresh 500。
        relay_param = ""
        # keyRef=server：官方服务器中转线路（密钥永不下发到本地）
        # 强制改写为中转接口并带 ?model=<官方模型id>，服务器按此取真实 key 转发上游。
        # 注意：不信任下发 apiUrl（防止线上旧配置把上游直连地址下发到本地）
        # 【401 兜底】官方下发条目缺 keyRef 时也视为 server（旧版后台不写 keyRef）：
        is_server = m.get("keyRef", "server") == "server"
        if is_server:
            # 【实测结论】朱峰 relay 只认真实模型 ID（如 glm-5.3-flash，HTTP 200），
            # 不认后台条目编号 zf-N（返回 model not configured）。
            # 故 relay 参数必须用第一个真实模型 ID，绝不能用条目编号。
            relay_param = (id_opts[0] if id_opts else (fallback_model or mid))
            relay_url = "https://www.zf3d.com/api/zf_models_relay.asp?model=" + urllib.parse.quote(relay_param)
        else:
            # 【根治】本机网关地址端口自愈：不信任下发的 127.0.0.1 端口，按实际监听端口改写
            relay_url = _heal_local_gateway(m.get("apiUrl", ""))
        entry = {
            # 【官方/本地区分】官方中转条目统一显示名加「·官方」后缀，
            # 避免与用户本地直连同名模型（如小米 mimo 本地直连版）显示名完全相同，
            # 导致设置面板/创建框/模型选择器分不清选的是哪条线路（串台根因）。
            "name": (m.get("name") or mid) + "·官方",
            "id": mid,
            "modelId": fallback_model or (id_opts[0] if id_opts else ""),
            "modelIdOptions": id_opts,
            "reasoningEffort": m.get("reasoningEffort", "disable"),
            "reasoningLevels": levels_map,
            "baseUrl": relay_url,
            "endpoint": relay_url,
            "provider": "zhufeng",
            "zfLine": True,
            "zfManaged": True,
            "zfPinned": True,
            "isOfficial": True,
            "enabled": True,
            "modelType": (m.get("category") or "language").lower(),  # 分类：语言/识图/绘图/视频/3D/音频，权威来源为网站后台
            "abilities": m.get("abilities", ["chat"]),
            "keyRef": m.get("keyRef", "user"),
            "noKeyRequired": m.get("keyRef", "user") == "user",
        }
        if m.get("default"):
            # 【用户默认优先】该类型本地已有用户设置的默认（未被本次清理删掉）则不覆盖；
            # 官方默认只在类型从未设置过默认时作为初始值写入。
            # 【默认转移】若该类型用户选的默认恰好是被清理重建的官方条目本身（如 zf-glm-flash），
            # 必须把 isDefault 转移到新条目上，否则该类型会没有任何默认。
            _ld = local_defaults.get(_dtype(entry))
            if _ld and _ld not in (mid, relay_param):
                pass  # 用户默认仍存在，尊重用户选择
            else:
                entry["isDefault"] = True
        synced.append(entry)

    def _normalize(m):
        if not isinstance(m, dict):
            return
        ab = m.get("abilities") or []
        t = str(m.get("modelType") or "").lower()
        if t in ("", "chat", "text"):
            m["modelType"] = "language"
        elif t in ("vision", "image_input"):
            m["modelType"] = "types_vision"
            m["visionInput"] = True
            if "vision" not in ab:
                ab = ab + ["vision"]
                m["abilities"] = ab
        elif t in ("audio", "tts", "asr", "speech"):
            m["modelType"] = "speech"
        if not m.get("modelType"):
            m["modelType"] = "language"
        if "visible" not in m:
            m["visible"] = True

    # 自愈：本地条目保证 modelType/visible（否则会被设置面板按分类过滤隐藏）
    for m in models:
        _normalize(m)
        # 【端口自愈 2/2】本地非官方条目若带 127.0.0.1 旧端口（如 8527），写盘前按实际监听端口改写，
        # 否则下次同步会把 models.json 的 baseUrl/endpoint 改回无人监听的端口（连不上根因）。
        for _k in ("baseUrl", "endpoint"):
            if isinstance(m.get(_k), str):
                m[_k] = _heal_local_gateway(m[_k])

    models = synced + models
    # 【两文件分离】官方中转条目只写入 models_zf.json，不混入本地 models.json
    zf_entries = [m for m in synced]
    for m in zf_entries:
        _normalize(m)
    local["models"] = models
    with open(MODELS_FILE, "w", encoding="utf-8") as f:
        json.dump(local, f, ensure_ascii=False, indent=2)
    # 同步官方条目到独立文件：合并 site_models 顺序（保留历史非官方直连条目——它们属于本地文件，不在此处理）
    try:
        zf_data = {"models": zf_entries, "version": 3}
        with open(ZF_MODELS_FILE, "w", encoding="utf-8") as f:
            json.dump(zf_data, f, ensure_ascii=False, indent=2)
    except Exception as _e:
        print("zf models file write failed:", _e)
    return {"ok": True, "msg": "已同步 %d 个官方模型" % len(synced), "count": len(synced)}

if __name__ == "__main__":
    r = sync()
    print(r["msg"])
