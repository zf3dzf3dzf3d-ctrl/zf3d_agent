# -*- coding: utf-8 -*-
"""
工具使用周报脚本（策划案阶段0产物）
用法: python scripts/tool_usage_report.py [--days 16] [--top 20]
数据源: server/private/logs/fps-guard-*.jsonl（slowest_tools 内的 fetch 记录）
输出: 控制台 TopN/失败率/耗时 + server/private/logs/tool_usage_report.json
口径说明:
  - 动态URL归一化: /api/db/chat/cbXXX -> /api/db/chat/cb*
  - 长轮询接口(monitor/poll, heartbeat等)单独归类, 其 ms 不参与普通均值排名
  - FAIL = slowest_tools 里 what 以 "(FAIL)" 结尾(前端fetch被abort/非200)
"""
import json, glob, collections, argparse, os, re, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG_DIR = os.path.join(ROOT, 'private', 'logs')
LONG_POLL = {'/api/monitor/poll GET', '/api/zf3d/status GET', '/api/heartbeat GET',
             '/api/chat-mode-rules GET', '/api/loop-mode-config GET', '/api/update-status GET'}

def norm(what):
    what = what.replace('fetch:', '')
    what = re.sub(r'/cb\w+', '/cb*', what)
    return what

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=int, default=16)
    ap.add_argument('--top', type=int, default=20)
    args = ap.parse_args()
    ok = collections.Counter(); fail = collections.Counter()
    ms_sum = collections.Counter(); ms_max = {}
    cutoff = datetime.date.today() - datetime.timedelta(days=args.days)
    for fp in glob.glob(os.path.join(LOG_DIR, 'fps-guard-*.jsonl')):
        m = re.search(r'fps-guard-(\d{8})\.jsonl', fp)
        if not m or datetime.datetime.strptime(m.group(1), '%Y%m%d').date() < cutoff:
            continue
        for line in open(fp, encoding='utf-8', errors='ignore'):
            try: rec = json.loads(line)
            except Exception: continue
            for t in rec.get('slowest_tools') or []:
                w = t.get('what', '')
                is_fail = w.endswith('(FAIL)')
                key = norm(w.replace(' (FAIL)', ''))
                if is_fail: fail[key] += 1
                else:
                    ok[key] += 1
                    ms = t.get('ms') or 0
                    ms_sum[key] += ms
                    ms_max[key] = max(ms_max.get(key, 0), ms)
    rows = []
    for k in set(ok) | set(fail):
        total = ok[k] + fail[k]
        avg = ms_sum[k] // ok[k] if ok[k] else None
        rows.append({'tool': k, 'total': total, 'ok': ok[k], 'fail': fail[k],
                     'fail_rate': round(fail[k]/total, 3) if total else 0,
                     'avg_ms': avg, 'max_ms': ms_max.get(k),
                     'long_poll': k in LONG_POLL})
    rows.sort(key=lambda r: -r['total'])
    print('%-38s %6s %6s %7s %9s %9s %s' % ('tool', 'total', 'fail', 'fail%', 'avg_ms', 'max_ms', 'long_poll'))
    for r in rows[:args.top]:
        print('%-38s %6d %6d %7.1f%% %9s %9s %s' % (
            r['tool'], r['total'], r['fail'], r['fail_rate']*100,
            r['avg_ms'] if r['avg_ms'] is not None else '-',
            r['max_ms'] if r['max_ms'] is not None else '-',
            'YES' if r['long_poll'] else ''))
    out = {'generated': datetime.datetime.now().isoformat(), 'days': args.days, 'rows': rows}
    with open(os.path.join(LOG_DIR, 'tool_usage_report.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print('\n[OK] 完整报告: server/private/logs/tool_usage_report.json (%d 个工具)' % len(rows))

if __name__ == '__main__':
    main()
