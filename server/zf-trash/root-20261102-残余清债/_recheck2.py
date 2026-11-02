# 独立复扫脚本（红队第2轮修正后的复核，模式与上轮不同）
import os
root = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\server'
dst = os.path.join(root, 'zf-trash', 'root-20261102-残余清债')
keys = ['diag', 'probe', 'tmp', 'debug', '_z', 'h3', 'succ']
remain = [f for f in os.listdir(root) if os.path.isfile(os.path.join(root, f))
          and any(k in f.lower() for k in keys)]
print('suspicious remain:', remain)
files = [f for f in os.listdir(dst) if os.path.isfile(os.path.join(dst, f))]
print('trash dir file count:', len(files))
print('sample:', files[:8])
