# -*- coding: utf-8 -*-
"""
双副本机械防线（课题17 收口）：check_public_sync.py
三件套检测：
  1) public/js 与 server/public/js 同名文件 hash 比对（若副本目录仍存在）
  2) public/index.html 引用的本地 js/css 文件存在性检查
  3) 缓存号 ?v= 与目标文件 hash 联动检测（内容变了号没升 → FAIL）
用法：python scripts/check_public_sync.py   （退出码 0=通过，1=失败）
"""
import os, sys, hashlib, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public')
SRV_PUB = os.path.join(ROOT, 'server', 'public')


def _md5(p):
    with open(p, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()


def check_mirror():
    """同名文件 hash 比对（副本存在才查）"""
    fails = []
    if not os.path.isdir(SRV_PUB):
        return fails
    for sub in ('js', 'css'):
        d1, d2 = os.path.join(PUB, sub), os.path.join(SRV_PUB, sub)
        if not os.path.isdir(d2):
            continue
        for f in os.listdir(d1):
            p1, p2 = os.path.join(d1, f), os.path.join(d2, f)
            if f.endswith('.js') and os.path.isfile(p1):
                if not os.path.isfile(p2):
                    fails.append(f'[镜像缺失] server/public/{sub}/{f} 不存在（根版已有）')
                elif _md5(p1) != _md5(p2):
                    fails.append(f'[镜像漂移] {sub}/{f} 双副本 hash 不一致')
    return fails


def check_refs_and_cachever():
    """index.html 引用存在性 + ?v 缓存号联动"""
    fails = []
    idx = os.path.join(PUB, 'index.html')
    if not os.path.isfile(idx):
        return ['[致命] public/index.html 不存在']
    text = open(idx, encoding='utf-8', errors='ignore').read()
    # 去掉 HTML 注释，避免误报
    text_nc = re.sub(r'<!--.*?-->', '', text, flags=re.S)
    for m in re.finditer(r'(?:src|href)=["\'](/?(?:js|css)/[^"\']+)["\']', text_nc):
        rel = m.group(1).split('?')[0].lstrip('/')
        p = os.path.join(PUB, rel.replace('/', os.sep))
        if not os.path.isfile(p):
            fails.append(f'[引用悬空] index.html 引用 {rel} 不存在')
    # 缓存号联动：引用形如 xxx.js?v=N 的，目标文件 md5 前8位应等于 N（若采用 hash 版本号约定）
    for m in re.finditer(r'(js/[\w\-./]+\.js)\?v=([0-9a-f]{6,10})', text):
        p = os.path.join(PUB, m.group(1).replace('/', os.sep))
        if os.path.isfile(p) and _md5(p)[:len(m.group(2))] != m.group(2):
            fails.append(f'[缓存号过期] {m.group(1)}?v={m.group(2)} 与文件 hash 不符')
    return fails


if __name__ == '__main__':
    all_fails = check_mirror() + check_refs_and_cachever()
    if all_fails:
        print('[check_public_sync] FAIL')
        for x in all_fails:
            print('  -', x)
        sys.exit(1)
    print('[check_public_sync] PASS（镜像一致/引用完整/缓存号联动正常）')
