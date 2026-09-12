# -*- coding: utf-8 -*-
"""复位 chat_gate 配置（测试后清理用）：gap 回 2.0，保留 enabled，清空测试规则"""
import io
import json

p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2_发布版\server\private\chat_gate.json'
cfg = {'enabled': True, 'gap': 2.0, 'updated': '2026-09-09 09:48:30', 'box_rules': {}}
with io.open(p, 'w', encoding='utf-8') as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
print('reset OK -> gap=2.0')
