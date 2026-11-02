# -*- coding: utf-8 -*-
"""策划案 v3 验收单测（临时，验收后删除）"""
import sys, time, json, os
sys.path.insert(0, r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\server')

T0 = time.time()
import butler_knowledge as bk
import butler_skill_policy as sp

ok = fail = 0
def check(name, cond, extra=''):
    global ok, fail
    if cond: ok += 1; print('[PASS]', name, extra)
    else: fail += 1; print('[FAIL]', name, extra)

# 验收1：零操作注入可查（真实知识库检索）
r = bk.search_knowledge('员工定时器 monitor_queue 死锁 排查')
check('A1 命中检索非空', len(r) > 0, 'len=%d 耗时=%.2fs' % (len(r), time.time()-T0))
check('A1 来源标注', '[来源:' in r)
check('A1 双副本去重', r.count('[来源:') == len(set(x.split(']')[0] for x in r.split('[来源:')[1:])))

# 验收2：persona 推断生效
tools = ['writing:polish_text', 'coding:diff_preview', 'browse:net', 'send_email', 'read_file']
allowed = sp.infer_allowed_tools('游戏小编，负责文案与写作', tools)
check('A2 文案persona获得writing', 'writing:polish_text' in allowed, str(allowed))
check('A2 文案persona被裁coding', 'coding:diff_preview' not in allowed)
check('A2 非词典persona保守', '游戏主播小姐姐' and len(sp.infer_allowed_tools('游戏主播小姐姐', tools)) >= 1)

# 验收3：敏感工具恒拒
a3 = True
for t in ('send_email', 'schedule', 'monitor'):
    for p in ('文案小编', '开发工程师', '', None):
        b, why = sp.check(p, t)
        if b: a3 = False; print('  泄漏:', t, repr(p))
check('A3 硬黑名单恒拒', a3)

# 验收4：老员工行为不变（auto_cap 回退）
msg, n = bk.build_inject_message({'task_prompt': '写日报', 'auto_cap': False})
check('A4 auto_cap=false 回退', msg == '写日报' and n == 0)

# 验收5：空命中不报错
r = bk.search_knowledge('zzzqqqxxx 无关词')
check('A5 空命中返回空串', r == '')
msg, n = bk.build_inject_message({'task_prompt': 'zzzqqqxxx'})
check('A5 空命中不注入', n == 0)
b, why = sp.check('文案', 'send_email')
check('A5 check 返回元组', b is False and '黑名单' in why)

# 缓存性能
t1 = time.time(); bk._iter_md_files(); t2 = time.time()
bk._iter_md_files(); t3 = time.time()
check('A6 缓存生效 <50ms', (t3-t2)*1000 < 50, 'cold=%.0fms warm=%.1fms' % ((t2-t1)*1000, (t3-t2)*1000))

# 集成点：employee_scheduler 语法可导入（不 start）
import employee_scheduler
check('A7 scheduler 可导入', hasattr(employee_scheduler, '_log_injection'))

print('\n===== 结果: PASS=%d FAIL=%d 总耗时=%.2fs =====' % (ok, fail, time.time()-T0))
sys.exit(1 if fail else 0)
