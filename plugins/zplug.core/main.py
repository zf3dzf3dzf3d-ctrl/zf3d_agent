# -*- coding: utf-8 -*-
"""zplug.core：.zplug 插件共享包（S6.5）。

导出：把 plugins/<id>/ 打包为 zip + manifest 摘要 sha256 签名（.zplug = zip）。
导入四道闸：
  1. 大小闸：包 ≤ 10MB
  2. 结构闸：zip 内必须有 manifest.json 且 spec==1；拒绝对外路径(..、绝对路径、盘符)
  3. 能力闸：manifest.capabilities 必须是已知能力白名单子集
  4. 签名闸：zip 末尾附加 JSON 行 {"sha256": ...}（由本模块 export 写入），导入校验一致
导入目标固定 plugins/<id>/（id 从 manifest 读，拒非法字符），不自动 enable。
"""
import hashlib
import io
import json
import os
import re
import zipfile

MAX_ZPLUG_BYTES = 10 * 1024 * 1024
KNOWN_CAPS = {"tool.register", "log.write", "plugin.manage", "net.fetch",
              "ui.mount", "event.listen", "store.write"}
_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def _sign_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _read_signed_footer(raw: bytes):
    """zplug = zip 字节 + b"\\n" + 签名JSON 行。返回 (zip_bytes, sig_dict|None)。"""
    idx = raw.rfind(b"\n{")
    if idx <= 0:
        return raw, None
    zip_part, footer = raw[:idx], raw[idx + 1:]
    try:
        return zip_part, json.loads(footer.decode("utf-8", "ignore"))
    except Exception:
        return raw, None


def export_zplug(plugins_root: str, plugin_id: str, out_dir: str):
    src = os.path.join(plugins_root, plugin_id)
    mf_path = os.path.join(src, "manifest.json")
    if not os.path.isfile(mf_path):
        return {"ok": False, "error": "plugin not found: %s" % plugin_id}
    with open(mf_path, "rb") as f:
        mf_bytes = f.read()
    try:
        json.loads(mf_bytes.decode("utf-8"))
    except Exception as e:
        return {"ok": False, "error": "bad manifest: %s" % e}

    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, plugin_id + ".zplug")
    zip_bytes = b""
    with zipfile.ZipFile(out_path + ".tmp", "w", zipfile.ZIP_DEFLATED) as z:
        for root, _dirs, files in os.walk(src):
            for fn in files:
                if fn.endswith(".bak") or ".bak." in fn:
                    continue
                full = os.path.join(root, fn)
                arc = os.path.relpath(full, src).replace("\\", "/")
                z.write(full, arc)
    with open(out_path + ".tmp", "rb") as f:
        zip_bytes = f.read()
    os.remove(out_path + ".tmp")
    sig = {"sha256": _sign_bytes(zip_bytes), "manifest_sha256": _sign_bytes(mf_bytes),
           "plugin": plugin_id, "format": "zplug@1"}
    with open(out_path, "wb") as f:
        f.write(zip_bytes + b"\n" + json.dumps(sig, ensure_ascii=False).encode("utf-8"))
    return {"ok": True, "path": out_path, "size": os.path.getsize(out_path), "sig": sig}


def import_zplug(plugins_root: str, zplug_path: str, _max_bytes=MAX_ZPLUG_BYTES):
    # 闸1：大小
    if not os.path.isfile(zplug_path):
        return {"ok": False, "error": "file not found"}
    if os.path.getsize(zplug_path) > _max_bytes:
        return {"ok": False, "error": "gate1 size: > %d bytes" % _max_bytes}
    with open(zplug_path, "rb") as f:
        raw = f.read()
    zip_part, sig = _read_signed_footer(raw)
    # 闸4：签名
    if not sig or sig.get("format") != "zplug@1" or sig.get("sha256") != _sign_bytes(zip_part):
        return {"ok": False, "error": "gate4 signature: missing or mismatch"}
    try:
        z = zipfile.ZipFile(io.BytesIO(zip_part))
    except Exception as e:
        return {"ok": False, "error": "gate2 zip: %s" % e}
    names = z.namelist()
    # 闸2：结构+对外路径
    if "manifest.json" not in names:
        return {"ok": False, "error": "gate2 structure: no manifest.json"}
    for n in names:
        nn = n.replace("\\", "/")
        if nn.startswith("/") or ".." in nn.split("/") or (len(nn) > 1 and nn[1] == ":"):
            return {"ok": False, "error": "gate2 traversal: %s" % n}
    try:
        mf = json.loads(z.read("manifest.json").decode("utf-8"))
    except Exception as e:
        return {"ok": False, "error": "gate2 manifest: %s" % e}
    if mf.get("spec") != 1:
        return {"ok": False, "error": "gate2 spec: unsupported spec %r" % mf.get("spec")}
    pid = str(mf.get("id", ""))
    if not _ID_RE.match(pid):
        return {"ok": False, "error": "gate2 id: illegal %r" % pid}
    # 闸3：能力白名单
    caps = mf.get("capabilities", [])
    unknown = [c for c in caps if c not in KNOWN_CAPS]
    if unknown:
        return {"ok": False, "error": "gate3 caps: unknown %s" % unknown}
    dest = os.path.join(plugins_root, pid)
    # 中危加固（安全师第4轮）：目标插件若已启用（server/data/plugin_states.json enabled 列表），拒绝覆盖
    state_path = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(plugins_root)),
                                               "server", "data", "plugin_states.json"))
    try:
        with open(state_path, "rb") as f:
            states = json.loads(f.read().decode("utf-8", "ignore"))
        if pid in (states.get("enabled") or []):
            return {"ok": False,
                    "error": "gate5 overwrite: plugin '%s' is ENABLED; disable it before import" % pid,
                    "plugin": pid}
    except FileNotFoundError:
        pass  # 无状态文件则跳过此闸
    except Exception:
        pass
    os.makedirs(dest, exist_ok=True)
    for n in names:
        tgt = os.path.join(dest, *n.split("/"))
        if n.endswith("/"):
            os.makedirs(tgt, exist_ok=True)
            continue
        os.makedirs(os.path.dirname(tgt), exist_ok=True)
        with open(tgt, "wb") as f:
            f.write(z.read(n))
    z.close()
    return {"ok": True, "plugin": pid, "installed_to": dest,
            "note": "installed but NOT enabled; enable via plugin-manager"}


def setup(ctx):
    # 安全闸（安全师第4轮高危修复）：工具面与 HTTP 端点同闸——
    #   plugins_root 必须在项目根 plugins/ 内；out_dir 必须在 exports/uploads 内；
    #   zplug_path 必须在 exports/uploads 内；用 commonpath 防前缀绕过（如 F:\x\y 前缀伪造）
    _base = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    _PLUGINS_DIR = os.path.join(_base, "plugins")
    _ALLOWED_DIRS = [os.path.join(_PLUGINS_DIR, "exports"), os.path.join(_PLUGINS_DIR, "uploads")]

    def _under(path: str, root: str) -> bool:
        try:
            return os.path.commonpath([os.path.abspath(path), os.path.abspath(root)]) == os.path.abspath(root)
        except Exception:
            return False

    def _gate_root(p_root):
        if not p_root or not _under(p_root, _PLUGINS_DIR):
            return {"ok": False, "error": "GUARD: plugins_root must be under project plugins/"}
        return None

    def _gate_out(out_dir):
        if not out_dir or not any(_under(out_dir, a) for a in _ALLOWED_DIRS):
            return {"ok": False, "error": "GUARD: out_dir must be under plugins/exports or plugins/uploads"}
        return None

    def _gate_path(zpath):
        if not zpath or not any(_under(zpath, a) for a in _ALLOWED_DIRS):
            return {"ok": False, "error": "GUARD: zplug_path must be under plugins/exports or plugins/uploads"}
        return None

    ctx.tool.register({"name": "zplug_export", "description": "导出 .zplug 共享包",
                       "exec": lambda p: (_gate_root(p.get("plugins_root", "")) or
                                          _gate_out(p.get("out_dir", "")) or
                                          export_zplug(
                           p.get("plugins_root", ""), p.get("plugin_id", ""), p.get("out_dir", "")))})
    ctx.tool.register({"name": "zplug_import", "description": "导入 .zplug 共享包(四道闸)",
                       "exec": lambda p: (_gate_root(p.get("plugins_root", "")) or
                                          _gate_path(p.get("zplug_path", "")) or
                                          import_zplug(
                           p.get("plugins_root", ""), p.get("zplug_path", "")))})
    ctx.log.info("zplug.core ready")

    from routes.dispatcher import route_post

    def _json(h, obj, code=200):
        out = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        h.send_response(code)
        h.send_header("Content-Type", "application/json; charset=utf-8")
        h.send_header("Content-Length", str(len(out)))
        h.end_headers()
        h.wfile.write(out)

    def _body(h):
        try:
            ln = int(h.headers.get("Content-Length", 0) or 0)
            if ln:
                # 【连接黑洞防御 2026-11-25】入口 _drain_body 已读走 body，二次裸读 rfile.read 永久阻塞；走缓存口径
                return json.loads(h._cached_body(ln).decode("utf-8", "ignore"))
        except Exception:
            pass
        return {}

    def _guard(fn):
        def wrapped(h, path, query):
            if not ctx.verify_admin_token(h):
                return _json(h, {"ok": False, "error": "need X-Plugin-Token"}, 403)
            return fn(h, path, query)
        return wrapped

    root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

    def _export(h, p, q):
        b = _body(h)
        _json(h, export_zplug(root, str(b.get("plugin_id", "")), str(b.get("out_dir") or os.path.join(root, "exports"))))

    def _import(h, p, q):
        b = _body(h)
        path = str(b.get("zplug_path", ""))
        # 端点侧只允许从 exports/ 或 uploads/ 取包，防任意读
        allowed = [os.path.join(root, "exports"), os.path.join(root, "uploads")]
        if not any(os.path.abspath(path).startswith(os.path.abspath(a)) for a in allowed):
            return _json(h, {"ok": False, "error": "path must be under exports/ or uploads/"}, 400)
        _json(h, import_zplug(root, path))

    route_post("/api/plugin-manager/zplug-export")(_guard(_export))
    route_post("/api/plugin-manager/zplug-import")(_guard(_import))


def teardown(ctx):
    ctx.log.info("zplug.core teardown")
