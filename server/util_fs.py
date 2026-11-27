# -*- coding: utf-8 -*-
"""
util_fs.py — 文件原子写公共工具（工程化整改 P1-5 · 20261123）
背景：`tmp = path + '.tmp'; json.dump; os.replace` 样板全仓 63 处各自手写，
收口为本模块；存量点位随改随换（首批已接：comics_download / butler_store /
工作日志存储），其余按"改到哪个文件顺手换"推进，不做运动式替换。
"""
import json
import os


def atomic_write_text(path, text, fsync=False):
    """文本原子写：写 .tmp 后 os.replace；失败清理 tmp 并抛出原异常。"""
    tmp = path + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(text)
            if fsync:
                f.flush()
                os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def atomic_write_json(path, obj, indent=None, ensure_ascii=False, fsync=False):
    """JSON 原子写。默认 ensure_ascii=False（与多数存量点位一致，中文可读）。"""
    atomic_write_text(path, json.dumps(obj, ensure_ascii=ensure_ascii, indent=indent),
                      fsync=fsync)
