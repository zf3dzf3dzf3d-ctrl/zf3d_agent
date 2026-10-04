# -*- coding: utf-8 -*-
"""一次性修复 v3：处理 `var if (...)` 残留 + `⬆":null` 键。"""
import io
P = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\icons.js'
s = io.open(P, encoding='utf-8').read()

# 1) 修复 "var if (...)" 残留 → 提到 var 行之前
bad_var = 'var if (MAP["⬆"] === null) MAP["⬆"] = MAP["⬆️"];\n  KEYS = Object.keys(MAP)'
if bad_var in s:
    s = s.replace(bad_var, 'MAP["⬆"] === null && (MAP["⬆"] = MAP["⬆️"]);\n  var KEYS = Object.keys(MAP)', 1)
    print('fixed var-if')
else:
    print('var-if not found (checking)')

# 2) 如果 ⬆ 还是 null 占位且没有别名赋值行，补一行
if '"⬆":null' in s and 'MAP["⬆"] === null' not in s:
    anchor = 'KEYS = Object.keys(MAP)'
    s = s.replace(anchor, 'MAP["⬆"] === null && (MAP["⬆"] = MAP["⬆️"]);\n  KEYS = Object.keys(MAP)', 1)
    print('added alias line')

io.open(P, 'w', encoding='utf-8').write(s)
print('done')
