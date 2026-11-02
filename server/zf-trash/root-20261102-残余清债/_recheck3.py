# 区域1第2轮残余补清（只动确认为垃圾的11项，保留 _base_zf3d_commands.py 与 _zf_gate_status.json）
import os, shutil
root = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\server'
dst = os.path.join(root, 'zf-trash', 'root-20261102-残余清债')
os.makedirs(dst, exist_ok=True)
targets = [
    'fix_zfbtn.py', 'h3_ui2api.py', 'rb_bilingual_tmp.md', 'succ_scan.py',
    '_debug_nodes.py', '_system_tmp_inspect.py', '_zf_cnt.py',
    '_zf_diag2.py', '_zf_diag_scan.py', '_zf_dump.py', '_ztmp_codely.py',
]
moved, skipped = [], []
for f in targets:
    src = os.path.join(root, f)
    if os.path.isfile(src):
        shutil.move(src, os.path.join(dst, f)); moved.append(f)
    else:
        skipped.append(f)
print('moved:', moved)
print('skipped(not found):', skipped)

# 独立复扫（第3种口径：全目录列举+垃圾特征词）
keys = ['diag', 'probe', 'debug', '_ztmp', '_zf_d', 'succ_probe', 'tmp_']
remain = [f for f in os.listdir(root) if os.path.isfile(os.path.join(root, f))
          and any(k in f.lower() for k in keys)]
print('final suspicious remain:', remain)
print('trash total files:', len(os.listdir(dst)))
