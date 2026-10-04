# -*- coding: utf-8 -*-
"""最终修复：渐变 id 唯一化。后缀直接取 MAP key 的原始 JS 源码文本（如 \\ud83d\\udcc1 或字面 emoji），
不做 unicode_escape 解码（该解码会损坏非 BMP 字符导致后缀撞车）。"""
import io, re, os, collections

path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'js', 'icons.js')
src = io.open(path, encoding='utf-8').read()

pair_re = re.compile(r'("(?:[^"\\]|\\.)*"\s*:\s*")(<svg.*?</svg>)(")', re.S)
id_re = re.compile(r'id=\\"([^"\\]+)\\"')

def make_uniq(m):
    key_raw, svg, tail = m.group(1), m.group(2), m.group(3)
    # key_raw 形如 "\ud83d\udcc1" 或 "💡"（含首尾引号）→ 只保留 [A-Za-z0-9]
    suffix = ''.join(c for c in key_raw if c.isalnum())
    if not suffix:
        suffix = 'X%d' % (abs(hash(key_raw)) % 100000)
    ids = set(id_re.findall(svg))
    for i in ids:
        new = '%s_%s' % (i, suffix)
        svg = svg.replace('id=\\"%s\\"' % i, 'id=\\"%s\\"' % new)
        svg = svg.replace('url(#%s)' % i, 'url(#%s)' % new)
        svg = svg.replace('href=\\"#%s\\"' % i, 'href=\\"#%s\\"' % new)
    return key_raw + svg + tail

# 已带后缀的 id 先还原，避免重复追加（幂等）
src = re.sub(r'(id=\\"[A-Za-z]+)_([A-Za-z0-9]+)\\"', r'id=\\"\1\\"', src)
src = re.sub(r'url\(#([A-Za-z]+)_[A-Za-z0-9]+\)', r'url(#\1)', src)

new_src, n = pair_re.subn(make_uniq, src)
io.open(path, 'w', encoding='utf-8', newline='\n').write(new_src)

ids = id_re.findall(new_src)
dups = [k for k, c in collections.Counter(ids).items() if c > 1]
print('pairs=%d ids=%d dups=%d %s' % (n, len(ids), len(dups), dups[:5]))
