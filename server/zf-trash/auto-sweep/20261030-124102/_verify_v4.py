import os, glob, io, sys
out_lines = []
base = r'private\记忆'
v3 = os.path.join(base, '策划案-智能体进化建议-v3定稿.md')
v2 = os.path.join(base, '策划案-智能体进化建议-v2-评分增强版.md')
out_lines.append('v3 exists: %s size: %s' % (os.path.exists(v3), os.path.getsize(v3) if os.path.exists(v3) else '-'))
out_lines.append('v2 exists: %s size: %s' % (os.path.exists(v2), os.path.getsize(v2) if os.path.exists(v2) else '-'))
if os.path.exists(v2):
    head = open(v2, encoding='utf-8', errors='ignore').read(400)
    out_lines.append('v2 废弃指引指向v3: %s' % ('废弃' in head and 'v3' in head))
hits = set(glob.glob(os.path.join(base, '**', '*进化建议*.md'), recursive=True) + glob.glob(os.path.join(base, '**', '*调查版*.md'), recursive=True))
out_lines.append('candidates: %d' % len(hits))
nopoint = []
for f in hits:
    if os.path.abspath(f) == os.path.abspath(v3):
        continue
    try:
        h = open(f, encoding='utf-8', errors='ignore').read(500)
    except Exception:
        continue
    if not ('v3定稿' in h or ('v3' in h and '废弃' in h)):
        nopoint.append(f)
out_lines.append('无v3指向档数: %d' % len(nopoint))
for f in nopoint[:15]:
    out_lines.append(' - %s' % f)
with io.open('_v4_final_check.txt', 'w', encoding='utf-8') as fh:
    fh.write('\n'.join(out_lines))
print('DONE lines=%d' % len(out_lines))
