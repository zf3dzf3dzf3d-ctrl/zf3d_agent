# -*- coding: utf-8 -*-
"""tool.file-tools v1.0.0 — S1-7 工具迁移第1批。

迁移 file_info（文件/目录元信息）+ fs_hash（哈希/UUID 生成器），
纯读操作、边界清晰，双轨：内核注册后调用方优先走插件。
"""


def setup(ctx):
    import os
    import hashlib
    import uuid as _uuid
    import datetime as _dt

    _ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    def _resolve(p):
        """解析路径并强制锁定在项目根 _ROOT 内（安全补丁：防越界读，2026-11-08 蜂群裁决）。"""
        if not p or not isinstance(p, str):
            return None
        p = p.strip().strip('"')
        if not os.path.isabs(p):
            p = os.path.join(_ROOT, p)
        rp = os.path.normpath(p)
        # 白名单：normpath 后必须仍在项目根内（跨盘符/.. 跳出直接拒绝）
        try:
            if os.path.commonpath([rp, _ROOT]) != _ROOT:
                return None
        except ValueError:  # 不同盘符等无法比较 → 视为越界
            return None
        return rp

    # ---- 工具1：file_info 文件/目录元信息 ----
    def _file_info(params):
        p = _resolve((params or {}).get("path"))
        if not p:
            return {"ok": False, "error": "缺少 path 参数"}
        if not os.path.exists(p):
            return {"ok": False, "error": "不存在: %s" % p}
        st = os.stat(p)
        is_dir = os.path.isdir(p)
        out = {
            "ok": True,
            "path": p,
            "is_dir": is_dir,
            "size": st.st_size if not is_dir else None,
            "mtime": _dt.datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
        }
        if is_dir:
            try:
                out["entries"] = len(os.listdir(p))
            except OSError as e:
                out["entries"] = "err:%s" % e
        else:
            with open(p, "rb") as f:
                out["head"] = f.read(512).decode("utf-8", "ignore")
        return out
    ctx.tool.register({
        "name": "file_info",
        "desc": "文件/目录元信息（大小/时间/条目数/文本头）",
        "category": "文件",
        "exec": _file_info,
    })

    # ---- 工具2：fs_hash 哈希/UUID ----
    def _hash_gen(params):
        p = params or {}
        algo = str(p.get("algo", "sha256")).lower()
        if algo not in ("md5", "sha1", "sha256"):
            return {"ok": False, "error": "不支持算法: %s" % algo}
        h = hashlib.new(algo)
        if p.get("text") is not None:
            h.update(str(p["text"]).encode("utf-8"))
        else:
            fp = _resolve(p.get("path"))
            if not fp or not os.path.isfile(fp):
                return {"ok": False, "error": "缺少 text 或有效 path"}
            with open(fp, "rb") as f:
                for chunk in iter(lambda: f.read(65536), b""):
                    h.update(chunk)
        return {"ok": True, "algo": algo, "digest": h.hexdigest()}
    ctx.tool.register({
        "name": "fs_hash",
        "desc": "文本/文件哈希（md5/sha1/sha256）",
        "category": "文件",
        "exec": _hash_gen,
    })

    def _uuid4(params):
        return {"ok": True, "uuid": str(_uuid.uuid4())}
    ctx.tool.register({
        "name": "uuid_gen",
        "desc": "生成 UUIDv4",
        "category": "文件",
        "exec": _uuid4,
    })
