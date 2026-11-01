# -*- coding: utf-8 -*-
"""区域4 工具区巡检（E4，v2.3）：三检查 + 白名单 + journal 追加
检查项：
  1. 跨分类重复罗列（白名单内为合法，v2.0+ 口径：E1 移除版落地前五件套双罗列=合法状态）
  2. 幽灵工具（分类罗列但 defs 文件中无定义）
  3. defs 目录 .bak 残留
用法：python 盘点工具区.py [--check]   # --check 时仅输出 PASS/FAIL，供 schedule 日跑
journal: server/scripts/区域2审计/区域4巡检-journal.md
"""
import json, re, io, sys, os, glob, datetime
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
ROOT = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0'
SRC = os.path.join(ROOT, 'public', 'js', 'tools-defs-categories.js')
DEFS_DIR = os.path.join(ROOT, 'public', 'js')
JOURNAL = os.path.join(ROOT, 'server', 'scripts', '区域2审计', '区域4巡检-journal.md')
CHECK = '--check' in sys.argv

# 白名单：跨分类重复罗列合法项（v2.3 口径：E1 移除版落地后本表应清空并删除白名单）
WHITELIST = {
    # v2.3 口径：跨分类双罗列在 E1 移除版落地前为合法状态（运行时 seen{} 仅单分类内去重）
    'image_gen', 'monitor', 'set_camera', 'video_gen', 'video_edit',
    'task_complete', 'switch_tool_category', 'ask_user', 'read_file', 'write_file',
    'read_lines', 'replace_text', 'run_code', 'tree_dir', 'find_files',
    'search_in_files', 'file_info', 'project_record', 'long_plan', 'plan_batch',
    'task_list', 'get_tool_result', 'browser_control', 'move_file',
}

src = open(SRC, encoding='utf-8').read()
blocks = re.findall(r'"([\u4e00-\u9fa5]+)":\s*\{(.*?)\n    \}', src, re.S)
all_tools, dups, ghosts = {}, [], []
report = []
for cat, body in blocks:
    m = re.search(r'"tools":\s*\[(.*?)\]', body, re.S)
    tools = re.findall(r'"([a-z_0-9]+)"', m.group(1)) if m else []
    report.append(f"{cat}: {len(tools)} 个, includes={'有' if 'includes' in body else '无'}")
    for t in tools:
        if t in all_tools:
            dups.append((t, all_tools[t], cat))
        else:
            all_tools[t] = cat

# 检查2：幽灵工具——罗列了但工具定义文件中无定义
# v2.4 修复（反驳师实锤 generate_description 误报）：定义散落在多个 tools-*.js 且存在
# 双引号 "name": "x" 与单引号 name: 'x'、未加引号键 x: { 三种风格，必须全扫+全风格匹配
def_files = [f for f in glob.glob(os.path.join(DEFS_DIR, 'tools-*.js'))
             if not os.path.basename(f).startswith('tools-defs-categories')]
def_src = ''.join(open(f, encoding='utf-8').read() for f in def_files)
for t in all_tools:
    defined = (re.search(r'name["\']?\s*:\s*["\']%s["\']' % re.escape(t), def_src)
               or re.search(r'^\s*["\']?%s["\']?\s*:\s*\{' % re.escape(t), def_src, re.M))
    if not defined:
        ghosts.append(t)

# 检查3：defs 目录 .bak 残留
baks = glob.glob(os.path.join(DEFS_DIR, 'tools-*.bak'))

# v2.6：E2 已为 video_status/mobile_control 补 definition 块（tools-defs-media.js），暂挂解除，幽灵告警恢复
IGNORE_GHOSTS = set()

illegal = [d for d in dups if d[0] not in WHITELIST]
ghosts = [g for g in ghosts if g not in IGNORE_GHOSTS]
fails = []
if illegal: fails.append(f'跨分类重复罗列(白名单外) {len(illegal)} 项: {illegal}')
if ghosts: fails.append(f'幽灵工具 {len(ghosts)}: {ghosts}')
if baks: fails.append(f'.bak 残留 {len(baks)}: {[os.path.basename(b) for b in baks]}')

now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
summary = f'[{now}] 分类{len(blocks)} 唯一工具{len(all_tools)} 重复{len(dups)}(白名单外{len(illegal)}) 幽灵{len(ghosts)} bak{len(baks)} → ' + ('PASS' if not fails else 'FAIL')
print(summary)
print('\n'.join(report))
for f in fails: print('⚠', f)

if not CHECK:
    line = summary + ('\n  ⚠ ' + '\n  ⚠ '.join(fails) if fails else '') + '\n'
    with open(JOURNAL, 'a', encoding='utf-8') as jf:
        jf.write(line + '\n')
    print('journal 已追加:', JOURNAL)
sys.exit(0 if not fails else 1)
