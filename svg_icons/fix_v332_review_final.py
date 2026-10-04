# -*- coding: utf-8 -*-
"""v33.2 审核采纳收尾：
1. chatbox-crew.js 删除第 231-238 行重复的 extractMdPath 旧版定义（保留 70 行唯一实现）
2. crew_board.py 相对路径解析统一以 project_root 为唯一基准（去 cwd 回退）
"""
import io

P_JS = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\chatbox-crew.js'
P_PY = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\server\engines\common\crew_board.py'

# ---- 1) JS 去重 ----
lines = io.open(P_JS, encoding='utf-8').read().splitlines(True)
# 定位旧版函数块（从注释头之后）：找 '  function extractMdPath(task) {'
start = None
for i, l in enumerate(lines):
    if l.strip().startswith('function extractMdPath(task) {'):
        start = i
        break
assert start is not None, 'old extractMdPath not found'
# 函数体到配对闭括号 '  }'
end = None
for j in range(start + 1, len(lines)):
    if lines[j].rstrip() == '  }':
        end = j
        break
assert end is not None
new_block = [
    "  /* 【v33.2 审核采纳·合并去重】extractMdPath 全文件仅保留唯一实现（文件前部，含【策划案路径：】显式标记\n",
    "     优先 + .markdown 支持 + 统一返回 ''）。此前此处曾有一份重复同名声明靠函数提升「碰巧行为兼容」，\n",
    "     已删除，防止将来只改其中一份静默失效。 */\n",
]
lines[start:end + 1] = new_block
io.open(P_JS, 'w', encoding='utf-8', newline='').write(''.join(lines))
print('JS dedup OK, extractMdPath count =',
      sum(1 for l in lines if 'function extractMdPath' in l))

# ---- 2) Python 路径基准统一 ----
t = io.open(P_PY, encoding='utf-8').read()
old = (
    "    if not os.path.isabs(_md):\n"
    "        _root = str(body.get('project_root') or '').strip()\n"
    "        _cand = os.path.join(_root, _md) if _root else _md\n"
    "        _md = _cand if os.path.isfile(_cand) else _md\n"
)
new = (
    "    # 【v33.2 审核采纳·基准统一】相对路径一律以 project_root 为唯一解析基准（与前端 /api/fs/text 一致），\n"
    "    # 不再回退按服务进程 cwd 解析——避免 cwd 恰为项目根时命中意外同名文件、或前后端解析基准不一致。\n"
    "    if not os.path.isabs(_md):\n"
    "        _root = str(body.get('project_root') or '').strip()\n"
    "        _md = os.path.join(_root, _md) if _root else _md\n"
)
assert old in t, 'PY old block not found'
io.open(P_PY, 'w', encoding='utf-8', newline='').write(t.replace(old, new, 1))
print('PY baseline unified OK')
