# -*- coding: utf-8 -*-
"""把 routes/api_dispatch_post.py(1034行) 按行段无改动切成 3 个分段，
并把原文件改写为 exec 合并门面（语义零变化）。"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'server', 'routes', 'api_dispatch_post.py')

lines = open(SRC, encoding='utf-8').read().splitlines(keepends=True)
n = len(lines)
assert n == 1034, n

# 段边界（1基，含头不含尾）：
# 1-172    imports + 4 个 _handle_* 方法（独立方法，未来可独立演进）
# 173-620  do_POST 前半（垃圾箱/图片/主脑/升级/画布/存档/蜂群/组件/LLM配置）
# 621-1034 do_POST 后半（用户设置系列/备份/画布媒体/录音录像/保存/转换）
SEGS = {
    '_post_handlers': (1, 173),
    '_post_core_a':   (173, 621),
    '_post_core_b':   (621, n + 1),
}
HDR = ('# -*- coding: utf-8 -*-\n'
       '# api_dispatch_post 拆分分段模块：由原文件按行段【无改动】切分，\n'
       '# 由 api_dispatch_post.py 门面加载后合并进同一命名空间。\n')
for name, (a, b) in SEGS.items():
    body = ''.join(lines[a - 1:b - 1])
    with open(os.path.join(ROOT, 'server', 'routes', name + '.py'), 'w', encoding='utf-8') as f:
        f.write(HDR + body)
    print(name, b - a, 'lines')

FACADE = '''# -*- coding: utf-8 -*-
"""
POST 路由分发 Mixin —— 门面模块（原 1034 行已按职责拆分）

分段模块（按顺序 exec 合并进同一命名空间，语义零变化）：
  _post_handlers  独立 _handle_* 方法（蜂群/游戏存档/引擎报错/性能日志）
  _post_core_a    do_POST 前半（垃圾箱/图片/主脑/升级/画布/存档/蜂群/组件/LLM）
  _post_core_b    do_POST 后半（用户设置系列/备份/画布媒体/录音录像/保存/转换）
"""
import os

_SELF = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'api_dispatch_post.py')
_NS = {'__name__': 'routes.api_dispatch_post', '__file__': _SELF}
_SEGMENTS = ('_post_handlers', '_post_core_a', '_post_core_b')
for _seg in _SEGMENTS:
    _p = os.path.join(os.path.dirname(os.path.abspath(__file__)), _seg + '.py')
    with open(_p, 'r', encoding='utf-8') as _f:
        exec(compile(_f.read(), _p, 'exec'), _NS)
for _k, _v in _NS.items():
    if not _k.startswith('__'):
        globals()[_k] = _v
'''
with open(SRC, 'w', encoding='utf-8') as f:
    f.write(FACADE)
print('facade written')
