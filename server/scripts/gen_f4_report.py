# -*- coding: utf-8 -*-
"""F4 git 历史泄漏专项报告生成器（只报告，不改写历史）"""
import json, subprocess, os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
ROOT = r''
os.chdir(ROOT)

d = json.load(open('private/隐私台账.json', encoding='utf-8'))
tracked = [i for i in d['items'] if i.get('git_tracked')]
rows = []
for i in tracked:
    r = subprocess.run(['git', 'log', '--all', '--follow', '--format=%h %ad',
                        '--date=short', '--', i['path']], capture_output=True, text=True)
    ls = [l for l in r.stdout.strip().splitlines() if l]
    rows.append((i.get('risk') or 'low', i.get('app') or '-', i['path'], ls[-1] if ls else '?'))

order = {'high': 0, 'mid': 1, 'medium': 1, 'low': 2}
rows.sort(key=lambda x: (order.get(x[0], 3), x[3]))

lines = [
    '# F4 git 历史泄漏专项报告', '',
    '生成: 2026-11-12｜i隐私 F4 专项｜只报告，不改写历史（重写需用户拍板）', '',
    '前置事实: `git remote -v` 为空（无远端），泄漏风险限本机与本机 git 历史。', '',
    '| 风险 | 归属 | 路径 | 首次入库 |', '|---|---|---|---|',
]
for r in rows:
    lines.append('| %s | %s | %s | %s |' % r)
lines += [
    '', '## 结论与建议', '',
    '1. 高危历史项（如 novel_token.txt）彻底抹除需 git filter-repo 重写历史，具破坏性，须先整库备份并由用户拍板，本报告不动手。',
    '2. 低风险路线：.gitignore 已覆盖 + git 无远端，不外传即不泄漏，可维持现状。',
    '3. 台账 git_tracked 巡检已常态化，新被追踪的隐私文件将告警。', '',
]
out = os.path.join('private', 'report-F4-git-history-20261112.md')
with open(out, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('written', out, len(rows), 'rows; high:',
      sum(1 for r in rows if r[0] == 'high'), 'mid:',
      sum(1 for r in rows if r[0].startswith('m')), 'low:',
      sum(1 for r in rows if r[0] == 'low'))
