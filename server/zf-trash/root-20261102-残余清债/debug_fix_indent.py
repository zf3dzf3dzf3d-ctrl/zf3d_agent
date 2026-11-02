# -*- coding: utf-8 -*-
"""临时修复脚本：把 _handle_fs_thumb 整体恢复类级别缩进（dedent 4 格）"""
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\server\routes\mixin_project_fs.py'
with open(p, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# 定位函数定义行
start = None
for i, ln in enumerate(lines):
    if ln.strip().startswith('def _handle_fs_thumb(self, parsed):'):
        start = i
        break
assert start is not None, 'def not found'
# 结束行：下一个类级别 def/装饰器/空行后的同级 def _handle_fs_text
end = None
for j in range(start + 1, len(lines)):
    s = lines[j].rstrip('\n')
    if s.strip().startswith('def _handle_fs_text('):
        end = j
        break
assert end is not None, 'end not found'

changed = 0
for i in range(start, end):
    if lines[i].strip():
        assert lines[i].startswith('    '), ('no-indent', i + 1, lines[i])
        lines[i] = lines[i][4:]
        changed += 1

with open(p, 'w', encoding='utf-8', newline='') as f:
    f.writelines(lines)
print('DEDENT_OK lines=%d start=%d end=%d' % (changed, start + 1, end + 1))
