# -*- coding: utf-8 -*-
"""文件系统哨兵：定期比对运行环境（C盘安装目录）关键 .py 的哈希。
默认只报警不还原（防误杀正常开发）；人工确认后可显式 restore。
零依赖，随安装包分发。
CLI:
  python fs_sentinel.py           # 检查并报告
  python fs_sentinel.py restore   # 显式从开发目录还原所有差异文件
  python fs_sentinel.py refresh   # 同步确认完成后重建基线
"""
import os, json, hashlib, sys

_DIR = os.path.dirname(os.path.abspath(__file__))
# 运行环境根 = server 的上级目录；开发目录可由环境变量指定
RUNTIME_ROOT = os.path.normpath(os.path.join(_DIR, '..'))
DEV_ROOT = os.environ.get('ZF_DEV_ROOT', '')

EXCLUDE_DIRS = {'__pycache__', '.git', 'node_modules', 'browser_profile', 'data', 'logs', 'temp', 'backup', 'db'}
STATE_NAME = 'sentinel_baseline.json'

def _iter_server_files(root_server):
    """遍历 server 目录下全部 .py，yield (relpath(相对server, 用/), abspath)"""
    for dp, _, fns in os.walk(root_server):
        rel_dir = os.path.relpath(dp, root_server)
        if any(part in EXCLUDE_DIRS for part in rel_dir.split(os.sep)):
            continue
        for fn in fns:
            if fn.endswith('.py'):
                p = os.path.join(dp, fn)
                yield os.path.relpath(p, root_server).replace('\\', '/'), p

def _hash(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()

def build_baseline():
    """扫描运行环境 server 目录全部 .py，返回 {relpath: hash}"""
    return {rel: _hash(p) for rel, p in _iter_server_files(os.path.join(RUNTIME_ROOT, 'server'))}

def _state_path():
    # 基线存 server/ 之外（system/ 优先），防止"改代码"与"改基线"同一动作完成
    for cand in (os.environ.get('ZF_STATE_DIR'),
                 os.path.join(RUNTIME_ROOT, 'system'),
                 os.path.join(RUNTIME_ROOT, '..', 'private')):
        if cand and os.path.isdir(cand):
            return os.path.join(cand, STATE_NAME)
    return os.path.join(RUNTIME_ROOT, STATE_NAME)

def _legacy_state_path():
    # 旧版基线位置（server/ 内），仅用于迁移读取
    return os.path.join(RUNTIME_ROOT, 'server', STATE_NAME)

META_KEY = '__meta__'

def load_baseline():
    p = _state_path()
    if not os.path.isfile(p):
        legacy = _legacy_state_path()
        if os.path.isfile(legacy):
            p = legacy  # 迁移期：读旧位置，save_baseline 会写入新位置
        else:
            return None
    try:
        with open(p, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

def save_baseline(base):
    import time
    base = dict(base)
    base[META_KEY] = {'refreshed_at': time.strftime('%Y-%m-%d %H:%M:%S'), 'mtime': time.time()}
    with open(_state_path(), 'w', encoding='utf-8') as f:
        json.dump(base, f, ensure_ascii=False, indent=1)

def last_refresh_age_hours():
    """距上次 refresh 的小时数；未知返回 -1。"""
    b = load_baseline()
    if not isinstance(b, dict):
        return -1
    m = b.get(META_KEY, {})
    mt = m.get('mtime')
    if not mt:
        return -1
    import time
    return (time.time() - mt) / 3600.0

def check(restore=False):
    """返回 (changed:[{file, action}], baseline)。
    action: modified=运行环境被改；deleted=运行环境文件丢失；
            restored=已还原(仅显式 restore)；new_in_dev=开发目录新增未同步；baseline_created=首次建基线。
    默认 restore=False：只报告，不动运行环境文件（防误杀正常开发）。"""
    base = load_baseline()
    if base is None:
        base = build_baseline()
        try:
            save_baseline(base)
        except Exception:
            pass
        return [{'file': '*', 'action': 'baseline_created'}], base
    changed = []
    rt_server = os.path.join(RUNTIME_ROOT, 'server')
    for rel, h in base.items():
        if rel == META_KEY:
            continue
        p = os.path.join(rt_server, rel.replace('/', os.sep))
        if not os.path.isfile(p):
            changed.append({'file': rel, 'action': 'deleted'})
            if restore:
                _restore_one(rel)
                changed.append({'file': rel, 'action': 'restored'})
            continue
        try:
            cur = _hash(p)
        except OSError:
            continue
        if cur != h:
            changed.append({'file': rel, 'action': 'modified'})
            if restore:
                _restore_one(rel)
                changed.append({'file': rel, 'action': 'restored'})
    if DEV_ROOT and os.path.isdir(os.path.join(DEV_ROOT, 'server')):
        dev_server = os.path.join(DEV_ROOT, 'server')
        for rel, _p in _iter_server_files(dev_server):
            if rel not in base:
                changed.append({'file': rel, 'action': 'new_in_dev'})
    return changed, base

def _copy(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(src, 'rb') as f, open(dst, 'wb') as g:
        g.write(f.read())

def _restore_one(rel):
    """从开发目录还原单个文件到运行环境。"""
    if not DEV_ROOT:
        return False
    src = os.path.join(DEV_ROOT, 'server', rel.replace('/', os.sep))
    if not os.path.isfile(src):
        return False
    _copy(src, os.path.join(RUNTIME_ROOT, 'server', rel.replace('/', os.sep)))
    return True

def restore_all():
    """显式还原：把运行环境与开发目录有差异的文件全部从开发目录覆盖。"""
    if not DEV_ROOT:
        return [], '未设置 ZF_DEV_ROOT，无法还原'
    changed, _b = check(restore=False)
    done = []
    for c in changed:
        if c['action'] in ('modified', 'deleted') and _restore_one(c['file']):
            done.append(c['file'])
    return done, None

def health():
    """哨兵自身健康状态：基线是否存在/可读/文件数。"""
    b = load_baseline()
    if b is None:
        return {'ok': False, 'reason': 'baseline_missing', 'files': 0}
    if not isinstance(b, dict) or not b:
        return {'ok': False, 'reason': 'baseline_empty_or_corrupt', 'files': 0}
    return {'ok': True, 'reason': '', 'files': len([k for k in b if k != META_KEY])}

def refresh():
    """外部确认同步完成后重建基线"""
    base = build_baseline()
    save_baseline(base)
    return base

if __name__ == '__main__':
    if sys.platform == 'win32':
        try:
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'check'
    if cmd == 'refresh':
        age = last_refresh_age_hours()
        n = len(refresh()); h = health()
        print('baseline refreshed: %d files | health: %s' % (n, 'OK' if h['ok'] else h['reason']))
        if age >= 0:
            print('上次 refresh 距今 %.1f 小时' % age)
            if age > 48:
                print('[提示] 超过 48h 未重建基线，流程可能已退化，请检查 _dev_sync 是否正常执行')
    elif cmd == 'restore':
        done, err = restore_all()
        if err:
            print('RESTORE FAILED:', err)
        else:
            print('restored %d file(s):' % len(done))
            for f in done:
                print('  -', f)
            refresh()
            print('baseline refreshed after restore')
    else:
        h = health()
        if not h['ok']:
            print('[SENTINEL] 自身异常: 基线%s，请运行 refresh 重建' % h['reason'])
        ch, _ = check()
        for c in ch:
            print('[SENTINEL]', c['action'], c['file'])
        if ch and any(c['action'] in ('modified', 'deleted') for c in ch):
            print('确认是误报/已同步？请运行: python server/fs_sentinel.py refresh')
            print('确认是被篡改？请运行: python server/fs_sentinel.py restore （需设置 ZF_DEV_ROOT）')
        print('clean' if not ch else ('%d issue(s)' % len(ch)))
