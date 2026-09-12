# -*- coding: utf-8 -*-
import io, re, json, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
BASE = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2\public\js'

def js2json(text):
    return re.sub(r'([\[{,]\s*)([A-Za-z_$][\w$]*)\s*:', r'\1"\2":', text)

dev = open(BASE + r'\tools-defs-dev.js', encoding='utf-8').read()
i = dev.index('categories:')
seg = dev[dev.index('{'):i].strip().rstrip(',')
try:
    d = json.loads(js2json(seg))
    print('dev 合法, 工具数:', len(d['tools']), '| 含 table_memory:', 'table_memory' in d['tools'])
except json.JSONDecodeError as e:
    # 兼容注释中的转义片段干扰：去掉 // 注释再试
    seg2 = re.sub(r'^\s*//.*$', '', seg, flags=re.M)
    d = json.loads(js2json(seg2.strip().rstrip(',')))
    print('dev 合法(去注释), 工具数:', len(d['tools']), '| 含 table_memory:', 'table_memory' in d['tools'])

cat = open(BASE + r'\tools-defs-categories.js', encoding='utf-8').read()
cat_seg = cat[cat.index('{'):cat.rindex('});')]
d2 = json.loads(js2json(cat_seg))
tools = d2['categories']['编程']['tools']
print('编程分类工具数:', len(tools), '| 含 table_memory:', 'table_memory' in tools)

sys.path.insert(0, r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2')
sys.path.insert(0, r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2\tools')
from tools import list_tools
print('后端注册表含 table_memory:', 'table_memory' in list_tools())
