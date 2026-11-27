# -*- coding: utf-8 -*-
"""doctor.py — 朱峰智能体环境体检（零依赖，仅标准库，任何电脑/任何 cwd 直接跑）

用法：
    py server/doctor.py            # 全量体检
    py server/doctor.py --quick    # 只查硬性项（目录/原子写/关键文件）

查什么（每一项都对应一次真实翻车）：
  1. 解释器       —— Microsoft Store 假 python（命令行 python 报 exit 49 实锤）
  2. 中文路径     —— private/记忆/… 全中文目录，控制台/文件系统编码不对则全站故障
  3. 原子写       —— 状态文件靠 tmp+os.replace，Windows 上 replace 被占用句柄会失败
  4. 关键目录     —— server/data、private/记忆、outputs_villager 缺失/不可写
  5. 关键文件     —— port.json / models.json / api_keys.json / trustee_macros.json 可解析
  6. 状态文件     —— town_jobs.json / trustee.json schema 与损坏检测
  7. cwd 无关     —— 从任意 cwd 跑本脚本即天然验证（路径全部 __file__ 推导）
  8. 服务在线     —— /api/health + /api/town/jobs-active 探活（可选，服务没起只 WARN）

退出码：0=无 FAIL；1=有 FAIL（可接 CI/启动器闸门）。
"""
import json
import os
import sys

from util_log import get_logger

log = get_logger('doctor')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)          # 项目根
DATA = os.path.join(HERE, 'data')

RESULTS = []


def check(name, fn, critical=True, quick=False):
    if quick and not critical:
        return
    try:
        ok, msg = fn()
    except Exception as e:
        ok, msg = False, '体检项自身异常: %s' % e
    RESULTS.append((ok, critical, name, msg))
    tag = 'OK  ' if ok else ('FAIL' if critical else 'WARN')
    log.info('[%s] %s — %s' % (tag, name, msg))


def _t01_interpreter():
    v = sys.version_info
    exe = sys.executable or ''
    if v < (3, 8):
        return False, 'Python %s 过旧（需 ≥3.8）' % sys.version.split()[0]
    if 'windowsapps' in exe.lower():
        return False, ('正在用 Microsoft Store 假 python（%s）——命令行 python 是占位符，'
                       '请用 py 启动器或项目自带 python/python.exe' % exe)
    return True, '%s @ %s' % (sys.version.split()[0], exe)


def _t02_chinese_paths():
    probe_dir = os.path.join(DATA, '体检探针目录')
    os.makedirs(probe_dir, exist_ok=True)
    probe = os.path.join(probe_dir, '记忆探针.md')
    try:
        with open(probe, 'w', encoding='utf-8') as f:
            f.write('中文内容测试')
        with open(probe, 'r', encoding='utf-8') as f:
            assert f.read() == '中文内容测试'
        return True, '中文目录/文件读写正常'
    finally:
        try:
            os.remove(probe)
            os.rmdir(probe_dir)
        except OSError:
            pass


def _t03_atomic_write():
    # 内嵌发行版（python/._pth）不会把脚本目录自动加进 sys.path，须显式补，否则 import engines 恒炸
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    from engines.common import steady_store  # 复用生产同款实现（script dir=server/ 已在 sys.path）
    st = steady_store.JobStore(os.path.join(DATA, '.doctor_probe.json'))
    try:
        assert st.update('probe', 'claimed', task='doctor')
        assert st.update('probe', 'done', result='ok')
        assert not os.path.exists(st.path + '.tmp')
        assert st.snapshot()[0]['state'] == 'done'
        return True, 'tmp+os.replace 原子写往返正常'
    finally:
        try:
            os.remove(st.path)
        except OSError:
            pass


def _t04_dirs():
    items = [('server/data', DATA),
             ('private/记忆', os.path.join(ROOT, 'private', '记忆')),
             ('private/记忆/小镇', os.path.join(ROOT, 'private', '记忆', '小镇')),
             ('outputs_villager', os.path.join(ROOT, 'outputs_villager'))]
    bad = []
    for name, p in items:
        if not os.path.isdir(p):
            bad.append('%s 缺失' % name)
        else:
            try:
                t = os.path.join(p, '.doctor_write_probe')
                with open(t, 'w') as f:
                    f.write('x')
                os.remove(t)
            except OSError as e:
                bad.append('%s 不可写(%s)' % (name, e))
    return (not bad), ('全部存在且可写' if not bad else '；'.join(bad))


def _t05_key_files():
    items = [('private/port.json', os.path.join(ROOT, 'private', 'port.json')),
             ('public/config/models.json', os.path.join(ROOT, 'public', 'config', 'models.json')),
             ('private/api_keys.json', os.path.join(ROOT, 'private', 'api_keys.json')),
             ('server/data/trustee_macros.json', os.path.join(DATA, 'trustee_macros.json'))]
    bad, good = [], []
    for name, p in items:
        if not os.path.isfile(p):
            bad.append('%s 缺失' % name)
            continue
        try:
            with open(p, 'r', encoding='utf-8-sig') as f:
                json.load(f)
            good.append(name)
        except Exception as e:
            bad.append('%s JSON 损坏(%s)' % (name, e))
    return (not bad), ('可解析: %s' % '、'.join(good) if not bad else '；'.join(bad))


def _t06_state_files():
    msgs = []
    ok = True
    tj = os.path.join(DATA, 'town_jobs.json')
    if os.path.isfile(tj):
        try:
            with open(tj, 'r', encoding='utf-8') as f:
                d = json.load(f)
            jobs = d.get('jobs')
            if not isinstance(jobs, list):
                ok, m = False, 'town_jobs.json schema 异常（jobs 非列表）'
            else:
                n_open = sum(1 for j in jobs if j.get('state') not in ('done', 'failed', 'dead'))
                msgs.append('town_jobs.json %d 条(在途%d)' % (len(jobs), n_open))
        except Exception as e:
            ok, msgs = False, ['town_jobs.json 损坏: %s（下次重启会重建，历史丢失）' % e]
    else:
        msgs.append('town_jobs.json 尚不存在（首单派发后生成）')
    st = os.path.join(DATA, 'trustee.json')
    if os.path.isfile(st):
        try:
            with open(st, 'r', encoding='utf-8') as f:
                json.load(f)
            msgs.append('trustee.json 可解析')
        except Exception as e:
            ok = False
            msgs.append('trustee.json 损坏: %s' % e)
    return ok, '；'.join(msgs)


def _t07_server_online():
    import urllib.request
    port = 8620  # 兜底默认与 6.2.0 端口段一致；真源 private/port.json 的 api_port
    try:
        with open(os.path.join(ROOT, 'private', 'port.json'), 'r', encoding='utf-8-sig') as f:
            port = int(json.load(f).get('api_port', 8620))
    except Exception:
        pass
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d/api/health' % port, timeout=3) as r:
            health = (r.status == 200)
    except Exception:
        return True, '服务未在线（port %d）——启动后用系统浏览器访问，非体检失败' % port
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d/api/town/jobs-active' % port, timeout=3) as r:
            d = json.loads(r.read().decode('utf-8'))
        return True, '服务在线(port %d)，在途工单=%s' % (port, d.get('n'))
    except Exception as e:
        return True, '服务在线但小镇工单探测不可用(%s)——服务是旧版本，重启后生效' % e


def _t08_console_encoding():
    enc = getattr(sys.stdout, 'encoding', '') or ''
    if enc.lower() in ('utf-8', 'utf8'):
        return True, 'stdout=%s' % enc
    return True, ('stdout=%s——控制台打中文可能乱码（不影响落盘）；建议 PYTHONIOENCODING=utf-8 运行'
                  % enc)


def main():
    quick = '--quick' in sys.argv
    log.info('=== 朱峰智能体环境体检（root=%s）===' % ROOT)
    check('Python 解释器', _t01_interpreter, critical=True, quick=quick)
    check('中文路径读写', _t02_chinese_paths, critical=True, quick=quick)
    check('原子写(tmp+replace)', _t03_atomic_write, critical=True, quick=quick)
    check('关键目录', _t04_dirs, critical=True, quick=quick)
    check('关键配置文件', _t05_key_files, critical=False, quick=quick)
    check('状态文件', _t06_state_files, critical=False, quick=quick)
    check('服务在线探测', _t07_server_online, critical=False, quick=quick)
    check('控制台编码', _t08_console_encoding, critical=False, quick=quick)
    fails = [r for r in RESULTS if not r[0] and r[1]]
    warns = [r for r in RESULTS if not r[0] and not r[1]]
    log.warning('=== 结果: %d 项, FAIL %d, WARN %d ===' % (len(RESULTS), len(fails), len(warns)))
    for _, crit, name, msg in fails:
        log.info('  [FAIL] %s — %s' % (name, msg))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
