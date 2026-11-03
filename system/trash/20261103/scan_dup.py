import re
files = [
 'server/brain/main_brain_seg1.py','server/brain/main_brain_seg2.py','server/brain/main_brain_seg3.py',
 'server/dispatch_swarm_seg1.py','server/dispatch_swarm_seg2.py',
 'server/screen_recorder_seg1.py','server/screen_recorder_seg2.py','server/screen_recorder_seg3.py',
]
for f in files:
    t = open(f, encoding='utf-8', errors='replace').read()
    names = re.findall(r'^(?:class|def)\s+([\w\u4e00-\u9fff]+)', t, re.M)
    print(f, '->', names[:25])
    print()
