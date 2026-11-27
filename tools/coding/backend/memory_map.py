#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""memory_map - 记忆系统导航图：描述全部 7 套记忆机制各自的作用与适用场景。

用途：AI（和人类）在使用任何记忆工具前先跑一次本脚本（或读本文件），
即可知道「该往哪写、该从哪读」，避免写错地方。

每套记忆一行结论：
  1. table_memory(memory_core) - 通用结构化表格记忆：键值/记录型数据，
     如用户偏好、配置快照。适合「机器要精确读回的结构化小数据」。
  2. long_term_memory - 条目式长期记忆：跨会话的事实条目（带时间/标签）。
     适合「关于用户/项目的长期事实」，如"用户喜欢简洁回答"。
  3. project_record - Markdown 记忆库 + 自动索引：private/记忆/ 下的
     人可读文档。适合「中等长度的项目知识、经验教训、方案说明」。
  4. _memory_tools / append_worklog_md - 自动工作日志：任务完成时追加
     private/记忆/工作日志/YYYY-MM.md，满 20 条可提炼总结，每日 zip 快照。
     适合「流水账」，不要往这里写结论。
  5. git_save / git_save_step - git 双快照：任务前后各一次快照，逐文件
     差分 ±行数，机械回答"这次到底改了什么"。适合自验收，不是知识库。
  6. main_brain - 主脑观察者记忆：60 秒一轮零侵入采集运行状态，总结落盘
     private/brain/，绝不写入用户对话上下文。适合系统级健康记忆。
  7. 浏览器记忆 browser profile - 持久化 Playwright 登录态与浏览痕迹，
     server/data/browser_profile/。适合网页操作类会话状态。

写入决策规则（AI 照做即可）：
  - 一句话长期事实          -> long_term_memory
  - 结构化键值/表格数据     -> table_memory
  - 项目知识/经验/方案      -> project_record
  - 任务流水账              -> 自动工作日志（_memory_tools，无需手动）
  - "改了什么"的自证        -> git_save + self_check，不是记忆
  - 系统运行健康状态        -> main_brain 自动采集，不要手动写
  - 网站登录态/浏览痕迹     -> 浏览器 profile 自动持久化，不要手动写
"""
import os
import time

from util_log import get_logger

log = get_logger('memory_map')

TOOL_NAME = 'memory_map'

MEMORY_MAP = [
    {'name': 'table_memory (memory_core)', 'file': 'tools/coding/backend/table_memory.py',
     'kind': '结构化表格记忆', 'use': '键值/记录型小数据，需精确读回', 'write': 'AI 按需调用'},
    {'name': 'long_term_memory', 'file': 'tools/coding/backend/long_term_memory.py',
     'kind': '条目式长期记忆', 'use': '跨会话的长期事实（用户偏好、项目约束）', 'write': 'AI 按需调用'},
    {'name': 'project_record', 'file': 'tools/coding/backend/project_record.py',
     'kind': 'Markdown 记忆库', 'use': 'private/记忆/ 下的人可读项目知识与经验', 'write': 'AI 按需调用'},
    {'name': '_memory_tools (工作日志)', 'file': 'tools/coding/backend/_memory_tools.py',
     'kind': '自动工作日志', 'use': '任务流水账 → 提炼总结 → 每日 zip；只追加', 'write': '系统自动'},
    {'name': 'git_save / self_check', 'file': 'tools/coding/backend/git_save.py + self_check.py',
     'kind': 'git 双快照自验收', 'use': '机械证明一次对话改了什么（±行数差分）', 'write': '系统自动'},
    {'name': 'main_brain', 'file': 'server/brain/main_brain.py',
     'kind': '主脑观察者记忆', 'use': '系统健康状态采集与总结，独立落盘 private/brain/', 'write': '系统自动，绝不污染用户上下文'},
    {'name': '浏览器记忆', 'file': 'server/data/browser_profile/',
     'kind': '持久化浏览器 profile', 'use': '网页登录态与浏览痕迹跨重启保留', 'write': '浏览器工具自动'},
]


def _self_check(ctx=None):
    """元认知体检：统计各记忆库健康度，输出容量/活跃度/告警（AGI 化改造③，2026-11-24）。

    纯只读，不改任何数据。ctx 为 None 时（命令行自测）用项目根目录推导。
    告警规则（初版，写死阈值，后续可配置化）：
      - long_term_memory 0 条但 project_record 记录 > 50 → 只记流水账不存结论的习惯病
      - 工作日志月文件数 > 60 → 流水账膨胀
      - 某库统计异常（读不到/炸了）→ 如实标注 fail，不静默
    """
    # memory_map.py 位于 <根>/tools/coding/backend/，需 4 层 dirname 回项目根
    base = getattr(ctx, 'base_dir', None) or os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    rep = {'ok': True, 'libraries': {}, 'alerts': []}

    # 1) long_term_memory（SQLite app_data 表）
    lt_count = None
    lt_strengths = []  # 生命体征缓存（③×①②闭环，续班3：让巩固/衰减在体检里可见）
    lt_accs = []
    try:
        # 实测确认（2026-11-24）：long_term_memory 的 app_data 表在 private/db/zf3d_apps.db
        db_fp = os.path.join(base, 'private', 'db', 'zf3d_apps.db')
        if not os.path.exists(db_fp):
            # 兜底：其他常见位置
            for rel in (os.path.join('server', 'data', 'app_data.db'), os.path.join('data', 'zf3d_apps.db')):
                p2 = os.path.join(base, rel)
                if os.path.exists(p2):
                    db_fp = p2
                    break
        if os.path.exists(db_fp):
            import sqlite3
            conn = sqlite3.connect(db_fp)
            try:
                cur = conn.execute("SELECT COUNT(*) FROM app_data WHERE category='long_term_memory'")
                lt_count = cur.fetchone()[0]
                cur = conn.execute(
                    "SELECT MAX(updated_at) FROM app_data WHERE category='long_term_memory'")
                lt_last = cur.fetchone()[0]
                # 生命体征（AGI化①②产出，2026-11-24 续班3）：解析 value JSON 的 strength/access_count
                import json as _lt_json
                for (v,) in conn.execute(
                        "SELECT value FROM app_data WHERE category='long_term_memory' LIMIT 500").fetchall():
                    try:
                        _j = _lt_json.loads(v or '{}')
                        lt_strengths.append(float(_j.get('strength', 1.0) or 1.0))
                        lt_accs.append(int(_j.get('access_count', 0) or 0))
                    except Exception:
                        pass
            finally:
                conn.close()
            rep['libraries']['long_term_memory'] = {
                'count': lt_count,
                'last_write': time.strftime('%Y-%m-%d %H:%M', time.localtime(lt_last / 1000)) if lt_last else '（从未写入）',
                'avg_strength': round(sum(lt_strengths) / len(lt_strengths), 2) if lt_strengths else None,
                'reinforced': len([s for s in lt_strengths if s >= 1.05]),
                'never_accessed': len([a for a in lt_accs if a == 0])}
        else:
            rep['libraries']['long_term_memory'] = {'count': None, 'note': 'DB 文件未找到，跳过'}
    except Exception as e:
        rep['libraries']['long_term_memory'] = {'count': None, 'fail': str(e)[:120]}
        rep['alerts'].append('long_term_memory 统计失败: %s' % str(e)[:80])

    # 2) project_record（记忆目录文件统计）
    rec_dir = os.path.join(base, 'private', '记忆')
    rec_count = 0
    rec_cats = {}
    rec_recent7 = 0
    try:
        if os.path.isdir(rec_dir):
            now = time.time()
            for root, dirs, files in os.walk(rec_dir):
                dirs[:] = [d for d in dirs if not d.startswith('.')]
                for f in files:
                    if not f.endswith('.md') or f == '索引.md':
                        continue
                    fp = os.path.join(root, f)
                    rel = os.path.relpath(fp, rec_dir).replace('\\', '/')
                    cat = rel.split('/')[0] if '/' in rel else '（根目录）'
                    rec_cats[cat] = rec_cats.get(cat, 0) + 1
                    rec_count += 1
                    try:
                        if now - os.stat(fp).st_mtime < 7 * 86400:
                            rec_recent7 += 1
                    except Exception:
                        pass
        rep['libraries']['project_record'] = {
            'count': rec_count, 'recent_7d': rec_recent7, 'top_categories': sorted(rec_cats.items(), key=lambda x: -x[1])[:8]}
    except Exception as e:
        rep['libraries']['project_record'] = {'count': None, 'fail': str(e)[:120]}
        rep['alerts'].append('project_record 统计失败: %s' % str(e)[:80])

    # 3) 双库重叠度（bravo 意见③，2026-11-24）：长期记忆标题 vs 项目记录文件名的关键词重叠
    #    判定「同一事实既存结构化条目又散落文档」的双写浪费，指导写入决策。
    overlap_data = {'checked': False}
    try:
        if lt_count and rec_count:
            import sqlite3
            conn = sqlite3.connect(db_fp)
            try:
                cur = conn.execute(
                    "SELECT key, value FROM app_data WHERE category='long_term_memory' LIMIT 200")
                lt_rows = cur.fetchall()
            finally:
                conn.close()
            lt_titles = []
            for k, v in lt_rows:
                t = k or ''
                try:
                    import json as _json
                    j = _json.loads(v or '{}')
                    t = t or str(j.get('title') or '')
                except Exception:
                    pass
                if t:
                    lt_titles.append(t.lower())
            # 项目记录标题集合（沿用 walk 缓存的 cat 计数不足以取标题，轻量重扫文件名）
            rec_names = []
            for root, dirs, files in os.walk(rec_dir):
                dirs[:] = [d for d in dirs if not d.startswith('.')]
                for f in files:
                    if f.endswith('.md') and f != '索引.md':
                        rec_names.append(f[:-3].lower())
            hit_pairs = []
            for t in lt_titles:
                for n in rec_names:
                    # 4 字以上公共子串即算疑似重叠（简易无分词口径，宁报勿漏）
                    if len(t) >= 4 and len(n) >= 4 and (t in n or n in t):
                        hit_pairs.append((t[:30], n[:30]))
                        break
            overlap_data = {'checked': True, 'long_term': len(lt_titles), 'project_record': len(rec_names),
                            'suspected_pairs': [list(p) for p in hit_pairs[:5]], 'suspected_count': len(hit_pairs)}
            if hit_pairs:
                rep['alerts'].append('双库重叠：疑似 %d 组「长期记忆↔项目记录」双写（示例：%s ↔ %s）——同一事实建议只留一处，另一处改指针' % (
                    len(hit_pairs), hit_pairs[0][0], hit_pairs[0][1]))
    except Exception as e:
        overlap_data = {'checked': False, 'fail': str(e)[:120]}
    rep['libraries']['overlap'] = overlap_data

    # 4) 告警规则（初版写死阈值）
    if lt_count == 0 and rec_count > 50:
        rep['alerts'].append('习惯病预警：长期记忆 0 条但项目记录 %d 条——只往文档库记流水账，从不沉淀跨会话结论条目；建议把高价值结论用 long_term_memory save 存成结构化记忆' % rec_count)
    if rec_recent7 >= 20 and lt_count == 0:
        rep['alerts'].append('活跃失衡：7 天内新增项目记录 %d 条但长期记忆 0 条——记忆在长，但"越用越牢"的结构化巩固为零' % rec_recent7)
    # 记忆老化预警（③×①②闭环，2026-11-24 续班3）：大量条目存而不用 = 假记忆（只预警不删，遵守永不删除红线）
    _never = len([a for a in lt_accs if a == 0])
    if lt_count and len(lt_accs) >= 5 and _never / len(lt_accs) > 0.8:
        rep['alerts'].append('记忆老化：长期记忆 %d 条中 %d 条从未被检索巩固（access_count=0）——存了不用等于没存，写新记忆前先 search 翻旧账防重复' % (lt_count, _never))

    _avg_s = ('均强 %.2f' % (sum(lt_strengths) / len(lt_strengths))) if lt_strengths else '均强 N/A'
    rep['summary'] = ('记忆体检：长期记忆 %s 条（%s，巩固过 %d 条）；项目记录 %d 条（7 天新增 %d）；双库重叠 %s；告警 %d 条' %
                      (lt_count if lt_count is not None else 'N/A', _avg_s,
                       len([s for s in lt_strengths if s >= 1.05]),
                       rec_count, rec_recent7,
                       ('%d 组' % overlap_data['suspected_count']) if overlap_data.get('checked') else '未检', len(rep['alerts'])))
    return rep


def handle(body, ctx=None):
    """工具入口：默认返回全部 7 套记忆的导航说明；action=self_check 时返回记忆体检报告。
    body 可含 {'detail': name} 查单套，{'action':'self_check'} 触发元认知体检。"""
    body = body or {}
    if body.get('action') == 'self_check':
        rep = _self_check(ctx)
        lines = [rep['summary']]
        for name, info in rep['libraries'].items():
            lines.append('- %s: %s' % (name, {k: v for k, v in info.items() if k != 'note'} if isinstance(info, dict) else info))
        for a in rep['alerts']:
            lines.append('⚠ %s' % a)
        return {'ok': True, 'report': '\n'.join(lines), 'detail': rep}
    detail = (body or {}).get('detail')
    if detail:
        for m in MEMORY_MAP:
            if detail.lower() in m['name'].lower():
                return {'ok': True, 'memory': m}
        return {'ok': False, 'error': 'no such memory: %s' % detail}
    lines = ['记忆系统导航（7 套，写入前先看这张表）：']
    for i, m in enumerate(MEMORY_MAP, 1):
        lines.append('%d. %s [%s] - %s（%s）' % (i, m['name'], m['kind'], m['use'], m['write']))
    lines.append('')
    lines.append('写入决策：长期事实→long_term_memory；结构化数据→table_memory；')
    lines.append('项目知识→project_record；流水账→自动工作日志；自验收→git_save。')
    return {'ok': True, 'guide': '\n'.join(lines), 'map': MEMORY_MAP}


if __name__ == '__main__':
    import json
    log.info(json.dumps(handle({}), ensure_ascii=False, indent=1))
