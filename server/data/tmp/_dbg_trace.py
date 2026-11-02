import json
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\server\data\traces\trace-20261102.jsonl'
import os
if not os.path.exists(p):
    print('no file, dir:')
    print(os.listdir(os.path.dirname(p)))
else:
    for i, line in enumerate(open(p, encoding='utf-8', errors='replace')):
        if 'run_code' in line and ('运行失败' in line or 'exit_code": 1' in line):
            d = json.loads(line)
            # 只打印结构和 code 片段
            keys = list(d.keys())
            print(i, keys)
            s = json.dumps(d, ensure_ascii=False)
            j = s.find('code')
            print('  ...', s[max(0,j-50):j+150].replace('\n',' ')[:200])
            if i > 40: break
