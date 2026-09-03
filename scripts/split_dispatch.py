# -*- coding: utf-8 -*-
"""mixin_dispatch.py 拆分：do_GET / do_POST / do_DELETE → 各自独立文件（方法体未改动）"""
import re

SRC = 'server/routes/mixin_dispatch.py'
lines = open(SRC, encoding='utf-8').read().splitlines(keepends=True)

def find(pat, start=1):
    for i in range(start-1, len(lines)):
        if re.match(pat, lines[i]):
            return i+1
    return None

# 行号（1-based）：
#   7 class / 8-16 _handle_ext / 17-300 do_GET / 301-761 do_POST（366、389 为 do_POST 内嵌类）/ 762-end do_DELETE
get_start = find(r'    def do_GET')
post_start = find(r'    def do_POST')
del_start = find(r'    def do_DELETE')

header = lines[:get_start-1]      # coding/docstring/imports/class 行/_handle_ext
class_header = header + ['\n']

get_body  = lines[get_start-1:post_start-1]
post_body = lines[post_start-1:del_start-1]
del_body  = lines[del_start-1:]

HDR = lambda name, desc: (
    '# -*- coding: utf-8 -*-\n'
    f'"""Mixin: {desc}（自动拆分自 mixin_dispatch.py，方法体未改动）"""\n'
    'from routes._shared import *\n'
    'from routes.mixin_base import MixinBase\n'
    '\n'
    f'\nclass Mixin{name}(MixinBase):\n'
)

open('server/routes/api_dispatch_get.py', 'w', encoding='utf-8').write(HDR('DispatchGet', 'GET 分发') + ''.join(get_body))
open('server/routes/api_dispatch_post.py', 'w', encoding='utf-8').write(HDR('DispatchPost', 'POST 分发') + ''.join(post_body))
open('server/routes/api_dispatch_delete.py', 'w', encoding='utf-8').write(HDR('DispatchDelete', 'DELETE 分发') + ''.join(del_body))
print('written', len(get_body), len(post_body), len(del_body))
