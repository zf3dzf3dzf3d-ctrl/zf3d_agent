import re

p = r'F:\朱峰社区智能体无限_新版本\新版本生产\朱峰社区智能体无限_5.0.0\public\index.html'
html = open(p, encoding='utf-8').read()
lines = html.split('\n')

# Track div nesting depth starting from line 428 (index 427) which is settingsOverlay
depth = 0
checkpoints = set([428, 430, 470, 500, 700, 900, 950, 1000, 1010, 1015, 1018, 1020, 1022, 1025, 1028, 1029, 1030, 1031, 1046, 1047, 1048, 1049, 1050, 1051, 1066, 1067, 1068, 1069, 1070, 1073])
out = []
for i, line in enumerate(lines, start=1):
    if 428 <= i <= 1073:
        opens = len(re.findall(r'<div\b', line))
        closes = len(re.findall(r'</div>', line))
        depth += opens - closes
        if i in checkpoints:
            out.append('line %d: depth=%d | %s' % (i, depth, line.strip()[:70]))
print('\n'.join(out))
print('depth after settingsOverlay block (line 1073):', depth)
