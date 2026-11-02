# -*- coding: utf-8 -*-
"""生成峰控文件桥访问密钥：写入 private\fk_key.txt 并打印。

生成后 fk 接口（files/changes/download/thumb/upload）强制校验
X-FK-Key 请求头，需把打印的 key 配到手机端（峰控 App 文件 Tab）。
删除 private\fk_key.txt 即关闭鉴权，恢复局域网放行。
"""
import os
import secrets

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(BASE, 'private', 'fk_key.txt')
if os.path.exists(p):
    with open(p, 'r', encoding='utf-8') as f:
        k = (f.read() or '').strip()
    print('已存在 key（未覆盖）：', k)
else:
    k = secrets.token_hex(16)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(k)
    print('已生成 key：', k)
print('文件位置:', p)
print('开启后手机端请求需携带请求头  X-FK-Key: <上面key>；删除该文件即关闭鉴权。')
