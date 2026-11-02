# -*- coding: utf-8 -*-
"""验证师 prompt v2 整改（蜂群反驳项 R1/R2/R4/触发分级闭环）"""
import json, sys, shutil

P = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\private\roles_db.json'
NEW_PROMPT = (
    '你是一名「验证师」，多角色小组的最后一道关口。你不在乎过程，只看结果：'
    '前序角色给出的最终产出，是否真正解决了用户的原始问题、符合用户预期。\n\n'
    '工作方法：\n'
    '1. 标尺获取：优先从派发消息/上下文中找用户的原始问题；找不到必须回溯读取本对话或'
    '用 project_record read 自取；仍取不到则声明降级⚠️，只做结果自洽性检查，禁止凭空猜测用户预期。\n'
    '2. 列预期清单，拿最终结果逐条对照：✅ 符合 / ❌ 不符合 / ⚠️ 部分符合，每条给对照依据。\n'
    '3. 验证方式二选一并显式声明：A) 工具备权时→实测查证(运行/打开/读文件)；'
    'B) 无法实测→仅文本比对，结论必须标注⚠️未实测，禁止冒充实测。'
    '禁止评价中间过程谁好谁差（那是审核员的事），但为核实最终结果所做的实测不算评过程。\n'
    '4. 终验结论二值：可交付 / 不可交付。不可交付时列明缺什么、建议退回给谁补，不得含糊。\n'
    '5. 触发分级：复杂/多步/跨文件任务必验；单文件小改动或闲聊只出一句⚠️简验，'
    '不许对简单任务硬写长报告（防橡皮图章）。\n'
    '6. 【落盘规范】终验结论必须用 project_record(action=write, name="验证/主题名") 存入「验证」分区，'
    '格式对齐「审核」分区惯例。写后读回确认，防覆写丢失。\n\n'
    '你的唯一标尺是用户的原始问题预期。语气直接，结论明确，不含糊。'
)
KEYS = ['标尺获取', '仅文本比对，结论必须标注', '触发分级', '不可交付时列明缺什么', '验证/主题名']

with open(P, encoding='utf-8') as f:
    d = json.load(f)
roles = d.get('roles') or d.get('data', {}).get('roles')
if roles is None:
    print('KEY_ERROR: top keys =', list(d.keys())[:10]); sys.exit(1)
tgt = [x for x in roles if x.get('id') == 'r1793051038878']
if not tgt:
    print('NOT_FOUND'); sys.exit(1)
tgt[0]['prompt'] = NEW_PROMPT
tgt[0]['updated_at'] = '2026-10-27'

bak = P + '.bak.promptv2'
shutil.copyfile(P, bak)
tmp = P + '.tmp'
with open(tmp, 'w', encoding='utf-8') as f:
    json.dump(d, f, ensure_ascii=False, indent=2)
import os
os.replace(tmp, P)

with open(P, encoding='utf-8') as f:
    d2 = json.load(f)
r2 = [x for x in (d2.get('roles')) if x['id'] == 'r1793051038878'][0]
out = 'VERIFY id=%s order=%s prompt_len=%d CLAUSES_OK=%s' % (
    r2['id'], r2['order'], len(r2['prompt']), all(k in r2['prompt'] for k in KEYS))
orders = sorted(x['order'] for x in d2['roles'] if x.get('group') == 'g1790260194938')
out += ' ORDERS=%s BAK_EXISTS=%s' % (orders, os.path.exists(bak))
with open(os.path.join(os.path.dirname(__file__), 'verify_prompt_v2_result.txt'), 'w', encoding='utf-8') as f:
    f.write(out)
print('DONE')
