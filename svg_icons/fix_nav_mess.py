# -*- coding: utf-8 -*-
"""一次性修复：删除 icons.js 里旧注入脚本留下的损坏 gNav 条目（含 `{,` 开头），
输出诊断信息。"""
import io, re, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

P = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\icons.js'
s = io.open(P, encoding='utf-8').read()

print('has `MAP = {,` :', 'var MAP = {,' in s)
print('gNav_L count   :', s.count('gNav_L'))

# 值内的引号是 \" (JS 转义)。条目形如 "KEY":"<svg ...>...</svg>"（内部引号均为 \"）
# 用非贪婪：从 ,"KEY":"<svg 到第一个 "</svg>\"" 结束
pat = re.compile(r',"(?:◀|▶|⬆|⟳|─|✕|🔴|🎥)":"<svg class=\\"zf-svg\\".*?</svg>"', re.S)
s2, n = pat.subn('', s)
print('removed entries:', n)
s2 = s2.replace('var MAP = {,', 'var MAP = {')
io.open(P, 'w', encoding='utf-8').write(s2)
print('done, MAP,{, fixed:', 'var MAP = {,' not in s2, '| gNav_L left:', s2.count('gNav_L'))
