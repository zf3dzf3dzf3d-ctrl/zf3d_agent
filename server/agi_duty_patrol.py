# -*- coding: utf-8 -*-
"""
AGI 值班巡检 agi_duty_patrol —— 内生主动性种子（愿景1：没人说话时也活着）
由 schedule 定时任务 agi_duty_patrol 周期执行（建议 600s）。

体检项：
  1) 工作台服务端口活性（读 private/port.txt，默认 8600）
  2) 工作盘剩余空间（<5GB 告警）
  3) private 目录可写性
  4) server/logs 最新日志新鲜度（仅记录）

产出：
  - 正常/异常均留痕 private/agi_duty_log.jsonl（>300KB 自动轮转保留 300 行）
  - 异常追加 private/agi_duty_alert.md（AI 值班时优先读此文件）
退出码恒 0，异常只体现在 stdout 与告警文件，不干扰调度器。
"""
import json, os, time, shutil, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRIV = os.path.join(ROOT, 'private')
LOGF = os.path.join(PRIV, 'agi_duty_log.jsonl')
ALERTF = os.path.join(PRIV, 'agi_duty_alert.md')
now = time.time()
ts = time.strftime('%Y-%m-%d %H:%M:%S')
report = {'ts': ts, 'anomalies': []}


def read_port():
    try:
        with open(os.path.join(PRIV, 'port.txt'), encoding='utf-8') as f:
            return int(f.read().strip().split()[0])
    except Exception:
        return 8600


# 1) 服务端口活性
p = read_port()
report['port'] = p
try:
    with urllib.request.urlopen('http://127.0.0.1:%d/' % p, timeout=6) as r:
        report['server_ok'] = (r.status == 200)
except Exception as e:
    report['server_ok'] = False
    report['server_err'] = repr(e)[:160]
if not report['server_ok']:
    report['anomalies'].append('server_down port=%d %s' % (p, report.get('server_err', '')))

# 2) 磁盘空间
try:
    du = shutil.disk_usage(ROOT)
    free_gb = round(du.free / 2 ** 30, 1)
    report['disk_free_gb'] = free_gb
    if free_gb < 5:
        report['anomalies'].append('disk_low free=%.1fGB' % free_gb)
except Exception as e:
    report['anomalies'].append('disk_check_fail %s' % repr(e)[:80])

# 3) private 可写性
try:
    probe = os.path.join(PRIV, '.duty_probe')
    with open(probe, 'w', encoding='utf-8') as f:
        f.write(ts)
    os.remove(probe)
    report['private_writable'] = True
except Exception as e:
    report['private_writable'] = False
    report['anomalies'].append('private_not_writable %s' % repr(e)[:80])

# 4) 日志新鲜度（记录用）
try:
    logdir = os.path.join(ROOT, 'server', 'logs')
    if os.path.isdir(logdir):
        newest = max((os.path.getmtime(os.path.join(logdir, f)) for f in os.listdir(logdir)), default=0)
        report['log_age_min'] = round((now - newest) / 60, 1)
except Exception:
    pass

# jsonl 留痕 + 轮转
try:
    if os.path.exists(LOGF) and os.path.getsize(LOGF) > 300 * 1024:
        with open(LOGF, encoding='utf-8') as f:
            lines = f.readlines()
        with open(LOGF, 'w', encoding='utf-8') as f:
            f.writelines(lines[-300:])
    with open(LOGF, 'a', encoding='utf-8') as f:
        f.write(json.dumps(report, ensure_ascii=False) + '\n')
except Exception:
    pass

# 异常告警文件（值班 AI 优先读）
try:
    if report['anomalies']:
        with open(ALERTF, 'a', encoding='utf-8') as f:
            f.write('- [' + ts + '] ' + '; '.join(report['anomalies']) + '\n')
except Exception:
    pass

print('DUTY %s anomalies=%d %s' % (ts, len(report['anomalies']), '; '.join(report['anomalies']) or 'all-clear'))
