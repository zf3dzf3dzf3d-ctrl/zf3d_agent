# -*- coding: utf-8 -*-
"""从 index.html 的 settingsPanel-comparison 面板生成 Markdown 对比文档"""
import io, re, os
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = io.open(os.path.join(ROOT, 'public', 'index.html'), encoding='utf-8').read()

start = HTML.find('id="settingsPanel-comparison"')
end = HTML.find('<div class="settings-panel"', start)
seg = HTML[start:end]

# ---------- 解析 HTML 表格 ----------
class TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables = []   # list of {head:[], rows:[[]]}
        self.table = None
        self.row = None
        self.cell = None
        self.in_head = False

    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            self.table = {'head': [], 'rows': []}
        elif tag == 'thead':
            self.in_head = True
        elif tag == 'tr' and self.table is not None:
            self.row = []
        elif tag in ('td', 'th') and self.row is not None:
            self.cell = []

    def handle_endtag(self, tag):
        if tag == 'thead':
            self.in_head = False
        elif tag == 'tr' and self.row is not None and self.table is not None:
            if self.in_head:
                self.table['head'] = self.row
            else:
                self.table['rows'].append(self.row)
            self.row = None
        elif tag in ('td', 'th') and self.cell is not None:
            self.row.append(''.join(self.cell).strip())
            self.cell = None
        elif tag == 'table' and self.table is not None:
            self.tables.append(self.table)
            self.table = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

p = TableParser()
p.feed(seg)
tables = p.tables

def md_cell(s):
    s = re.sub(r'\s+', ' ', s).replace('|', '\\|').replace('<br>', ' ').replace('&amp;', '&')
    return s.strip()

# ---------- 提取结构 ----------
# seg 中顺序：说明段 p，pkSelector 按钮，6 个 pkTable（每个含 pk-vs-head + 1 张表），
# 独有功能表（无 pk-vs-head）
def get_texts(cls):
    out = []
    for m in re.finditer(r'<div class="%s"[^>]*>(.*?)</div>' % cls, seg, re.S):
        inner = m.group(1)
        inner = re.sub(r'<[^>]+>', '', inner)
        out.append(re.sub(r'\s+', ' ', inner).strip())
    return out

notes = re.findall(r'<p class="comparison-note"[^>]*>(.*?)</p>', seg, re.S)
note = re.sub(r'<[^>]+>', '', notes[0]).strip() if notes else ''

pk_blocks = re.findall(r'<div class="pk-vs-head">(.*?)</div>', seg, re.S)
pk_heads = []
for b in pk_blocks:
    txt = re.sub(r'<[^>]+>', ' ', b)
    txt = re.sub(r'\s+', ' ', txt).strip()
    txt = re.sub(r'^🆚\s*朱峰社区智能体无限\s*vs\s*', '', txt)
    pk_heads.append(txt)

# 按钮标签
btns = re.findall(r'<button class="pk-btn"[^>]*data-pk="([^"]+)"[^>]*>(.*?)</button>', seg, re.S)
btn_labels = []
for k, b in btns:
    label = re.sub(r'<[^>]+>', '', b).strip()
    btn_labels.append((k, label))

lines = []
lines.append('# 独有功能与平台对比（朱峰社区智能体无限）')
lines.append('')
lines.append('> ' + md_cell(note))
lines.append('')

# 独有功能表：跳过 pkTable 内的表（含 pk-detail-table），只收面板级表格
pk_tables = [t for t in tables if True]
# 通过原始 seg 区分：pkTable 内的表在 'pk-detail-table' 之后出现
pk_table_ids = [m.start() for m in re.finditer(r'id="pkTable-', seg)]
solo_ranges = []
end0 = seg.find('pk-selector')
solo_tables = []
for t in tables:
    # 找不到所属 pkTable 的表 = 面板级表（独有功能 / Gitee 对比）
    pass
# 简化：HTMLParser 无位置，改为按 class 过滤解析：重新只解析非 pkTable 部分
seg_solo = re.sub(r'<div class="pk-table"[^>]*>.*?</div>\s*</div>', '', seg, flags=re.S)
p2 = TableParser(); p2.feed(seg_solo)
solo_tables = p2.tables

lines.append('## 📋 朱峰社区智能体无限 独有功能一览')
lines.append('')
lines.append('### 独有能力对比')
lines.append('')
for t in solo_tables:
    head = t['head']
    if '独有能力' not in ' '.join(head):
        lines.append('### 代码托管平台（Gitee vs GitHub）辅助对比')
        lines.append('')
    head = t['head']
    lines.append('| ' + ' | '.join(md_cell(c) for c in head) + ' |')
    lines.append('|' + '|'.join(['---'] * len(head)) + '|')
    for row in t['rows']:
        lines.append('| ' + ' | '.join(md_cell(c) for c in row) + ' |')
    lines.append('')

lines.append('## 🆚 可选择 PK：与主流平台逐项对比')
lines.append('')
lines.append('在设置面板中可点击对手按钮，切换查看对应的详细对比。以下按平台逐一展开。')
lines.append('')

for i, headtxt in enumerate(pk_heads):
    key, label = btn_labels[i] if i < len(btn_labels) else (str(i), headtxt)
    lines.append('### %d. 朱峰社区智能体无限 vs %s' % (i + 1, label))
    lines.append('')
    # headtxt 形如 "🆚 朱峰社区智能体无限 vs ⌨️ Codex OpenAI 官方代码代理..."
    sub = headtxt
    lines.append('*对手简介：' + md_cell(sub) + '*')
    lines.append('')
    t = pk_tables[i]
    head = t['head']
    lines.append('| ' + ' | '.join(md_cell(c) for c in head) + ' |')
    lines.append('|' + '|'.join(['---'] * len(head)) + '|')
    for row in t['rows']:
        lines.append('| ' + ' | '.join(md_cell(c) for c in row) + ' |')
    lines.append('')

lines.append('---')
lines.append('')
lines.append('*本文档由设置面板「独有功能与对比」内容对齐生成，随面板更新而更新（生成脚本：`server/gen_comparison_md.py`）。*')

out = os.path.join(ROOT, 'docs')
if not os.path.isdir(out):
    os.makedirs(out)
path = os.path.join(out, '独有功能与平台对比.md')
io.open(path, 'w', encoding='utf-8').write('\n'.join(lines))
print('written:', path, os.path.getsize(path))
print('tables:', len(tables), 'pk_heads:', len(pk_heads), 'btns:', btn_labels)
