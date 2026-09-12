# -*- coding: utf-8 -*-
import sys, shutil, os
sys.path.insert(0, r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2_发布版\server\brain')
base = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2_发布版'
import main_brain as mb
cfg = mb._load_model_cfg(base)
print('cfg:', {k: (v[:8] + '...' if k == 'key' and v else v) for k, v in cfg.items()} if cfg else None)
out = mb._call_llm(base, [{'role': 'user', 'content': '回复ok'}], max_tokens=10)
print('LLM reply:', out)
for f in ['_test_llm.py', '_test_keys.py', '_fix_brain.py']:
    fp = os.path.join(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2_发布版\server\brain', f)
    if os.path.isfile(fp):
        os.remove(fp)
print('cleaned')
