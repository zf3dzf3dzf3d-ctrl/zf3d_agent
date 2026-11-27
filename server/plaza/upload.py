# -*- coding: utf-8 -*-
"""广场图片上传端点 /api/plaza/upload（二期）。

设计决策（二期收口裁决采纳项）：
- JSON+base64 而非 multipart：彻底绕开 multipart 解析边界风险；
  图片限 5MB，base64 膨胀后 ~6.8MB JSON，可接受。
- 安全三件套与本端点同批落地（安全师第4轮提醒）：
  1) Origin 校验：复用入口统一 _check_origin()（handler_base.py L80，do_POST L287 已生效）；
  2) trace 缺省：本端点不写 trace 日志（无敏感面）；
  3) 落盘白名单：只写 public/uploads/plaza/，文件名全随机 UUID（用户输入不落盘）→
     路径穿越从根上不可能；类型/大小双校验 + 魔数 sniff。
- 广场 WS 的 Origin 校验在 ws_plaza.py 已有（一期），trace 缺省一期已改。
"""
import base64
import os
import re
import time
import uuid

# 与 ws_plaza 同源的公开目录定位
PUBLIC_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public'))

# 白名单魔数（真实图片格式 sniff，不信 Content-Type）
_MAGIC = [
    (b'\x89PNG\r\n\x1a\n', 'png'),
    (b'\xff\xd8\xff', 'jpg'),
    (b'GIF87a', 'gif'),
    (b'GIF89a', 'gif'),
    (b'RIFF', 'webp'),   # RIFF....WEBP
]

# 大小上限：原图 5MB
MAX_RAW_BYTES = 5 * 1024 * 1024
# base64 膨胀 4/3，再加 JSON 包裹余量
MAX_B64_CHARS = int(MAX_RAW_BYTES * 4 / 3) + 4096

_ALLOWED_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}


def _sniff(raw: bytes):
    """魔数嗅探真实图片类型，返回扩展名；不认识就 None。"""
    for magic, ext in _MAGIC:
        if raw.startswith(magic):
            if ext == 'webp':
                # RIFF....WEBP：确认偏移 8 处是 WEBP
                if len(raw) >= 12 and raw[8:12] == b'WEBP':
                    return ext
                return None
            return ext
    return None


def handle_plaza_upload(handler):
    """处理 POST /api/plaza/upload。handler 为 DBHandler 实例。

    前置保证：do_POST 入口已完成 _drain_body / _check_origin / token 校验。
    """
    try:
        body = handler._read_json() or {}
    except Exception:
        handler._send_json({'ok': False, 'error': 'invalid JSON body'}, 400)
        return

    data_b64 = body.get('data') or ''
    name = str(body.get('name') or 'image')

    if not isinstance(data_b64, str) or not data_b64:
        handler._send_json({'ok': False, 'error': 'data(base64) required'}, 400)
        return
    if len(data_b64) > MAX_B64_CHARS:
        handler._send_json({'ok': False, 'error': '图片超过 5MB 限制'}, 413)
        return
    # base64 严格字符校验：拒 Data URL 前缀、空白、非法字符
    if not re.fullmatch(r'[A-Za-z0-9+/]+={0,2}', data_b64):
        data_b64 = data_b64.split(',')[-1] if data_b64.startswith('data:') else data_b64
        if not re.fullmatch(r'[A-Za-z0-9+/]+={0,2}', data_b64):
            handler._send_json({'ok': False, 'error': 'data 必须是纯 base64'}, 400)
            return

    try:
        raw = base64.b64decode(data_b64, validate=True)
    except Exception:
        handler._send_json({'ok': False, 'error': 'base64 解码失败'}, 400)
        return

    if len(raw) > MAX_RAW_BYTES:
        handler._send_json({'ok': False, 'error': '图片超过 5MB 限制'}, 413)
        return

    ext = _sniff(raw)
    if not ext:
        handler._send_json({'ok': False, 'error': '仅支持 PNG/JPG/GIF/WebP 图片'}, 415)
        return

    # 落盘白名单目录 + 全随机文件名（用户输入不参与文件名 → 路径穿越不可能）
    d = os.path.join(PUBLIC_DIR, 'uploads', 'plaza')
    os.makedirs(d, exist_ok=True)
    fname = '%d_%s.%s' % (int(time.time()), uuid.uuid4().hex[:12], ext)
    dest = os.path.join(d, fname)
    # 双保险：确认最终路径仍在白名单目录内
    if not os.path.abspath(dest).startswith(os.path.abspath(d) + os.sep):
        handler._send_json({'ok': False, 'error': 'path check failed'}, 500)
        return
    try:
        with open(dest, 'wb') as f:
            f.write(raw)
    except Exception as e:
        handler._send_json({'ok': False, 'error': '写盘失败: %s' % str(e)[:160]}, 500)
        return

    url = '/uploads/plaza/' + fname
    handler._send_json({'ok': True, 'url': url, 'size': len(raw)})
    return
