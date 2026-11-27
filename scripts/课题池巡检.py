# -*- coding: utf-8 -*-
"""课题池巡检 - 检查课题池完整性（收口裁决 P0 修复版）
背景：原脚本为 12 字节空壳（仅 # MARKER-1），退出码 0 无输出，曾被两轮调查误判"巡检链健康"。
验收硬项（进化师建议1采纳版）：输出必须含可解析汇总行 `topics=N pending=M issues=K`，
静默退出 0 或空壳即 FAIL。用票数统计代替读原文，避免编码问题。
用法：python scripts/课题池巡检.py
"""
import sys, os, re

POOL_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         'private', '记忆', '全局', '进化', '课题池.md')

def main():
    issues = []
    topics = pending = 0
    if not os.path.isfile(POOL_FILE):
        issues.append('课题池真源文件不存在: %s' % POOL_FILE)
    else:
        try:
            text = open(POOL_FILE, encoding='utf-8').read()
        except UnicodeDecodeError:
            issues.append('课题池编码异常(非UTF-8)')
            text = ''
        # 课题条目 = 以「- 课题：」开头的行（append-only 格式）
        for line in text.splitlines():
            s = line.strip()
            if s.startswith('- 课题：') or s.startswith('**课题：'):
                topics += 1
                if re.search(r'状态：[^｜]*?(待处理|待办|待排期|置顶待)', s):
                    pending += 1
        # 交叉校验（第4轮铁律）：宽松口径「课题：」出现次数；差值=销案/规则段等非条目行，仅 INFO
        alt = text.count('课题：')
        if alt < topics:
            issues.append('交叉校验FAIL: 宽松口径%d < 严格口径%d，解析有漏' % (alt, topics))
        else:
            print('交叉校验INFO: 宽松口径%d >= 严格口径%d（差值为销案/规则引用行，正常）' % (alt, topics))
    # 双 public 同步检查（收口裁决⑥采纳）：根 public/ 与 server/public/ 同名 JS/HTML 必须字节一致
    # 【2026-11-23】server/public 已随双副本政策退役（有意删除）→ 本段检查退役跳过，不再计 issues；
    # 若未来副本目录重建，原有比对逻辑自动恢复生效。
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    pub_root = os.path.join(base, 'public')
    pub_srv = os.path.join(base, 'server', 'public')
    synced = mismatched = 0
    srv_only = []  # 对称盲区检查(第5轮采纳): 仅 server/public 独有 = 根侧漏同步
    if not os.path.isdir(pub_srv):
        print('双public: server/public 已随双副本政策退役，同步检查跳过（真源回归单本: %s）' % pub_root)
    elif not os.path.isdir(pub_root):
        issues.append('双public目录缺失: %s' % pub_root)
    else:
        for root, dirs, files in os.walk(pub_root):
            dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', '项目记录')]
            for f in files:
                if not f.endswith(('.js', '.html', '.css')):
                    continue
                p1 = os.path.join(root, f)
                rel = os.path.relpath(p1, pub_root)
                p2 = os.path.join(pub_srv, rel)
                if not os.path.isfile(p2):
                    continue  # 仅单侧存在的文件不告警（server 端特有目录如 项目记录）
                try:
                    if open(p1, 'rb').read() != open(p2, 'rb').read():
                        issues.append('双public不同步(含?v=时人工判方向): %s' % rel)
                        mismatched += 1
                    else:
                        synced += 1
                except OSError as e:
                    issues.append('双public读取失败: %s (%s)' % (rel, e))
        # 对称检查：server/public 独有的 js/html/css（根侧漏同步=盲区）
        for root2, dirs2, files2 in os.walk(pub_srv):
            dirs2[:] = [d for d in dirs2 if d not in ('node_modules', '.git', '项目记录')]
            for f2 in files2:
                if not f2.endswith(('.js', '.html', '.css')):
                    continue
                p2o = os.path.join(root2, f2)
                rel2 = os.path.relpath(p2o, pub_srv)
                if not os.path.isfile(os.path.join(pub_root, rel2)):
                    srv_only.append(rel2)
        # 缓存号防误伤检测（第6轮采纳推进师/优化师）：
        # 历史9146abc证明"根->server单向覆盖"曾回滚server侧v4.1修复(97c4b68事故)。
        # 差异文件含 ?v=N 缓存号时，不判方向，只输出需人工判定告警。
        if srv_only:
            for rel2 in srv_only:
                print('双public盲区WARN: server独有(根侧无) %s' % rel2)
        print('双public默认真源: %s (存在?v=差异时以人工判定为准, 勿机械覆盖)' % pub_root)
        print('双public同步: 已核对%d个文件, 不一致%d个' % (synced + mismatched, mismatched))
        print('双public对称: server独有%d个' % len(srv_only))
    if not topics:
        issues.append('课题池解析到 0 条课题（可能格式变更或文件为空）')
    # 汇总行（硬性验收：静默=FAIL）
    print('== 课题池巡检 ==')
    print('topics=%d pending=%d issues=%d' % (topics, pending, len(issues)))
    for i in issues:
        print('[问题] ' + i)
    ok = (len(issues) == 0)
    print('判定: ' + ('PASS' if ok else 'FAIL'))
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main()
