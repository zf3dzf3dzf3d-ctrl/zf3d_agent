import sys, os, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
root = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0'
sys.path.insert(0, root)
sys.path.insert(1, os.path.join(root, 'server'))
os.chdir(os.path.join(root, 'server'))
from tools import get_handler
for name in ['image_gen', 'video_gen', 'send_email', 'net', 'ppt_gen', 'model3d_gen']:
    try:
        h = get_handler(name)
        print(f'{name} -> {"OK" if h else "None"} {type(h).__name__ if h else ""}')
    except Exception as e:
        print(f'{name} -> FAIL: {type(e).__name__}: {str(e)[:120]}')
