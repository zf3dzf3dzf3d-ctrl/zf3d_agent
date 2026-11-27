# -*- coding: utf-8 -*-
"""广场二期验收测试：/api/plaza/upload + img 透传 + _safe_img 白名单。
不依赖主服务：直接调 plaza.upload.handle_plaza_upload（mock handler）
和 ws_plaza 的 _safe_img。退出码非 0 即失败。
"""
import base64
import os
import sys

from util_log import get_logger

log = get_logger('test_plaza_upload')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import importlib
up = importlib.import_module('plaza.upload')
ws_mod = importlib.import_module('plaza.ws_plaza')

PASS = 0
FAIL = 0

def check(name, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
        log.info('%s %s', 'PASS |', name)
    else:
        FAIL += 1
        log.info('%s %s', 'FAIL |', name)

PNG_1PX = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')

class MockHandler:
    def __init__(self, body):
        self._body = body
        self.resp = None
        self.code = None
    def _read_json(self):
        return self._body
    def _send_json(self, obj, code=200):
        self.resp = obj
        self.code = code

def call(body):
    h = MockHandler(body)
    up.handle_plaza_upload(h)
    return h

# 1 合法 PNG 上传
h = call({'data': base64.b64encode(PNG_1PX).decode(), 'name': 'a.png'})
check('合法 PNG 上传 ok + url 白名单前缀', h.resp and h.resp.get('ok') and (h.resp.get('url') or '').startswith('/uploads/plaza/') and h.resp['url'].endswith('.png'))
# 落盘实存
p = os.path.join(up.PUBLIC_DIR, (h.resp or {}).get('url', '').lstrip('/').replace('/', os.sep))
check('落盘文件真实存在', os.path.isfile(p))

# 2 非图片内容拒（415）
h = call({'data': base64.b64encode(b'not an image at all').decode(), 'name': 'x.png'})
check('非图片内容拒 415', h.code == 415)

# 3 base64 非法字符拒（400）
h = call({'data': '!!!not-base64!!!', 'name': 'x.png'})
check('非法 base64 拒 400', h.code == 400)

# 4 超大小拒（413）
h = call({'data': 'A' * (up.MAX_B64_CHARS + 100), 'name': 'big.png'})
check('超 5MB 拒 413', h.code == 413)

# 5 空 data 拒（400）
h = call({'data': '', 'name': 'a.png'})
check('空 data 拒 400', h.code == 400)

# 6 name 字段含路径穿越字符：不影响落盘（随机文件名，name 不参与路径）
h = call({'data': base64.b64encode(PNG_1PX).decode(), 'name': '..\\..\\evil.png'})
ok6 = h.resp and h.resp.get('ok') and '..' not in h.resp['url']
check('name 路径穿越无效（随机文件名）', ok6)

# 7 GIF 魔数识别
gif = b'GIF89a' + b'\x00' * 20
h = call({'data': base64.b64encode(gif).decode(), 'name': 'g.gif'})
check('GIF 魔数识别为 .gif', h.resp and h.resp.get('ok') and h.resp['url'].endswith('.gif'))

# 8 RIFF 但非 WEBP 拒
riff = b'RIFF' + b'\x00' * 8
h = call({'data': base64.b64encode(riff).decode(), 'name': 'r.webp'})
check('RIFF 非 WEBP 拒 415', h.code == 415)

# 9 _safe_img 白名单
obj = ws_mod.PlasmaServer if hasattr(ws_mod, 'PlasmaServer') else None
cls = None
for n in dir(ws_mod):
    v = getattr(ws_mod, n)
    if isinstance(v, type) and hasattr(v, '_safe_img'):
        cls = v
        break
check('ws _safe_img 放行合法路径', cls._safe_img(None, '/uploads/plaza/1730000000_abc123def456.png') is not None)
check('ws _safe_img 拒 javascript:', cls._safe_img(None, 'javascript:alert(1)') is None)
check('ws _safe_img 拒 data:', cls._safe_img(None, 'data:image/png;base64,AAAA') is None)
check('ws _safe_img 拒外部绝对URL', cls._safe_img(None, 'https://evil.com/a.png') is None)
check('ws _safe_img 拒 .. 穿越', cls._safe_img(None, '/uploads/plaza/../secret.png') is None)

# 10 trace/Origin 由入口统一生效（结构性断言：do_POST 内有 _check_origin 调用）
src = open('routes/api_dispatch_post.py', encoding='utf-8').read()
check('do_POST 入口存在 _check_origin（Origin 校验统一生效）', '_check_origin' in src)
check('upload 路由已接入 do_POST', '/api/plaza/upload' in src)

# 清理测试落盘
import glob
for f in glob.glob(os.path.join(up.PUBLIC_DIR, 'uploads', 'plaza', '*')):
    try:
        if os.path.getsize(f) <= 1024:
            os.remove(f)
    except OSError:
        pass

log.info('==== %d/%d PASS ====' % (PASS, PASS + FAIL))
sys.exit(0 if FAIL == 0 else 1)
