# -*- coding: utf-8 -*-
"""
🔑 密码大师：跨版本浏览器 profile / 密码库迁移（browser_profile_import.py）
=========================================================================
目的：升级到新版本后，把并排老版本目录的浏览器用户数据（登录态 Cookie、
Login Data 密码库、Local State 加密密钥、历史记录等）导入当前版本，升级不丢号。

设计原则（照搬记忆大师的成熟模式）：
- 保守导入：永不覆盖、永不删除。目标已有同名文件 → 老文件改名为「名-来自老目录名」保留
- 路径白名单：来源目录必须形如「朱峰/智能体」版本目录，防任意路径写
- 双 git 快照：对操作日志做导入前/导入后快照（profile 大文件本身不进 git）
- 文件级迁移：不解密、不展示任何明文密码
- 四 API：
    POST /api/browser/profile/import/candidates  自动探测老版本 profile 库
    POST /api/browser/profile/import/scan        差异预览（新增/重名改名/跳过）
    POST /api/browser/profile/import/run         执行导入 + 双快照
    POST /api/browser/profile/import/auto        一键自动收集全部老版本
"""

import os
import shutil

# Chromium profile 目录（老/新两种布局都认）
PROFILE_CANDIDATES = [
    os.path.join('server', 'data', 'browser_profile'),          # 5.7.0 新位置
    os.path.join('server', 'browser_plugin', 'browser_profile'),  # 5.5.x/5.6.0 老位置
]
# private/浏览器数据/profiles/（wb_c_* 会话目录）也认
LEGACY_PRIVATE_PROFILES = os.path.join('private', '浏览器数据', 'profiles')

# 关键文件/子树（相对 profile 根；目录用前缀匹配整树迁移）
KEY_FILES = {
    'Local State':          '加密密钥（必须，否则密码解不开）',
    os.path.join('Default', 'Login Data'):  '密码库',
    os.path.join('Default', 'Cookies'):     '登录态 Cookie（老版 Chromium 布局）',
    os.path.join('Default', 'Network', 'Cookies'):  '登录态 Cookie（新版 Chromium 布局，2020+ 默认位置，漏了它=登录态丢）',
    os.path.join('Default', 'Network', 'Trust Tokens'):  '反欺诈令牌（新版，与 Cookie 同目录）',
    os.path.join('Default', 'History'):     '浏览历史',
    os.path.join('Default', 'Web Data'):    '表单/自动填充',
    os.path.join('Default', 'Favicons'):    '网站图标',
}
KEY_DIR_PREFIXES = ['Default\\Sessions', 'Default/Session Storage', 'Default/Local Storage', 'Default\\Network', 'Default/Network']


def _project_root():
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _profile_dir(root):
    """返回该版本根下的浏览器 profile 目录（找得到就返回第一个存在的）"""
    for rel in PROFILE_CANDIDATES:
        p = os.path.join(root, rel)
        if os.path.isdir(p):
            return p
    return None


def _legacy_profiles_dir(root):
    return os.path.join(root, LEGACY_PRIVATE_PROFILES)


def _iter_profile_units(root):
    """枚举某版本根下的全部「profile 单元」：返回 [(unit_key, unit_path)]
    - 新布局：browser_profile 根本身是一个单元（key='主 profile'）
    - 老布局：private/浏览器数据/profiles/ 下每个含 Local State 的子目录是一个单元（key=子目录名）"""
    units = []
    prof = _profile_dir(root)
    if prof and _has_profile_data(prof):
        units.append(('主 profile', prof))
    legacy = _legacy_profiles_dir(root)
    if os.path.isdir(legacy):
        try:
            for name in sorted(os.listdir(legacy)):
                sub = os.path.join(legacy, name)
                if os.path.isdir(sub) and _has_profile_data(sub):
                    units.append((name, sub))
        except Exception:
            pass
    return units


def _is_source_safe(path):
    real = os.path.realpath(path)
    name = os.path.basename(real)
    if '朱峰' not in name and '智能体' not in name:
        return False
    if real == os.path.realpath(_project_root()):
        return False
    return (_profile_dir(real) is not None) or os.path.isdir(_legacy_profiles_dir(real))


def _has_profile_data(prof):
    """profile 目录里是否有关键数据（Local State 或 Default/ 下关键文件）"""
    if not os.path.isdir(prof):
        return False
    if os.path.isfile(os.path.join(prof, 'Local State')):
        return True
    dflt = os.path.join(prof, 'Default')
    return os.path.isdir(dflt) and any(
        os.path.isfile(os.path.join(dflt, os.path.basename(k)))
        for k in list(KEY_FILES) + KEY_DIR_PREFIXES)


def _collect_key_files(prof):
    """列出 profile 内的关键文件相对路径清单（含大小）"""
    out = []
    for f, _desc in KEY_FILES.items():
        p = os.path.join(prof, f)
        if os.path.isfile(p):
            out.append({'rel': f.replace('\\', '/'), 'size': os.path.getsize(p)})
    for pref in KEY_DIR_PREFIXES:
        d = os.path.join(prof, pref)
        if os.path.isdir(d):
            for dirpath, _dirs, files in os.walk(d):
                for fn in files:
                    fp = os.path.join(dirpath, fn)
                    rel = os.path.relpath(fp, prof)
                    out.append({'rel': rel.replace('\\', '/'), 'size': os.path.getsize(fp)})
    return out


def _probe_dir(cand_root, out, seen_units):
    for unit_key, unit_path in _iter_profile_units(cand_root):
        rp = os.path.realpath(unit_path)
        if rp in seen_units:
            continue
        seen_units.add(rp)
        files = _collect_key_files(unit_path)
        if not files:
            continue
        out.append({
            'dir': cand_root,
            'name': os.path.basename(cand_root.rstrip('\\/')) + ('' if unit_key == '主 profile' else ' · ' + unit_key),
            'profile_path': unit_path,
            'count': len(files),
            'total_mb': round(sum(f['size'] for f in files) / 1048576, 1),
            'mtime': int(os.path.getmtime(unit_path)),
        })


def _search_roots():
    root = _project_root()
    roots = [os.path.dirname(root)]
    import string
    for letter in string.ascii_uppercase:
        drv = letter + ':\\'
        if os.path.isdir(drv):
            roots.append(drv)
    roots += [os.path.expanduser('~'), os.path.expanduser('~\\Desktop')]
    seen, uniq, seen_units = set(), [], set()
    for r in roots:
        rr = os.path.realpath(r)
        if rr not in seen and os.path.isdir(rr):
            seen.add(rr)
            uniq.append(rr)
    return uniq


def list_candidates():
    """自动探测含浏览器 profile 的候选版本目录（全盘智能扫描，深度≤3）"""
    root = _project_root()
    cur_real = os.path.realpath(root)
    cur_ver = os.path.basename(root)
    out, seen, seen_units = [], set(), set()
    try:
        for base in _search_roots():
            try:
                names = sorted(os.listdir(base))
            except Exception:
                continue
            for name in names:
                cand = os.path.join(base, name)
                try:
                    if not os.path.isdir(cand):
                        continue
                    real = os.path.realpath(cand)
                    if real in seen or real == cur_real:
                        continue
                    seen.add(real)
                    if name in ('Windows', 'Program Files', 'Program Files (x86)', '$Recycle.Bin',
                                'System Volume Information', 'node_modules', '.git', '_垃圾箱'):
                        continue
                    if ('朱峰' in name or '智能体' in name):
                        _probe_dir(cand, out, seen_units)
                        try:
                            for sub in sorted(os.listdir(cand)):
                                sub_p = os.path.join(cand, sub)
                                if os.path.isdir(sub_p) and not sub.startswith(('.', '$')) \
                                        and sub not in ('node_modules', '_垃圾箱'):
                                    _probe_dir(sub_p, out, seen_units)
                        except Exception:
                            pass
                        continue
                    if ('朱峰' in base or '智能体' in base) and not name.startswith(('.', '$')):
                        _probe_dir(cand, out, seen_units)
                except Exception:
                    continue
    except Exception as e:
        return {'ok': False, 'err': str(e)}
        out.sort(key=lambda x: -x['mtime'])
    # 同版本多单元按名字稳定排序（老版本在前），避免列表抖动
    out.sort(key=lambda x: (x['name'], -x['mtime']))
    return {'ok': True, 'current': cur_ver, 'candidates': out, 'scan_mode': '全盘智能扫描'}


def scan_import(src_root, profile_path=None):
    """差异预览：关键文件粒度的新增 / 重名改名 两类（永不覆盖）
    src_root: 老版本根目录；profile_path: 可选，直接指定 profile 单元目录（来自 candidates）"""
    try:
        if profile_path:
            src_prof = profile_path
            if not (os.path.realpath(src_prof).startswith(os.path.realpath(src_root)) and _has_profile_data(src_prof)):
                return {'ok': False, 'err': 'profile_path 非法'}
        else:
            units = _iter_profile_units(src_root)
            if not units:
                return {'ok': False, 'err': '该目录下未发现浏览器 profile 数据'}
            src_prof = units[0][1]
        if not _is_source_safe(src_root):
            return {'ok': False, 'err': '路径不在允许范围（仅限含浏览器 profile 的版本目录）'}
        dst_prof = _profile_dir(_project_root())
        if not dst_prof:
            dst_prof = os.path.join(_project_root(), PROFILE_CANDIDATES[0])
        os.makedirs(dst_prof, exist_ok=True)
        files = _collect_key_files(src_prof)
        tag = os.path.basename(src_root.rstrip('\\/'))
        add, rename = [], []
        existing = set()
        for item in files:
            rel = item['rel']
            dst_path = os.path.join(dst_prof, rel.replace('/', os.sep))
            if os.path.exists(dst_path):
                base, ext = os.path.splitext(rel)
                nf = f'{base}-来自{tag}{ext}'
                i = 1
                while os.path.exists(os.path.join(dst_prof, nf.replace('/', os.sep))):
                    nf = f'{base}-来自{tag}-{i}{ext}'
                    i += 1
                rename.append({'file': rel, 'as': nf, 'size': item['size']})
            else:
                add.append({'file': rel, 'size': item['size']})
            existing.add(rel)
        return {'ok': True, 'src': src_root, 'src_profile': src_prof,
                'dst_profile': dst_prof, 'add': add, 'rename': rename, 'skip': []}
    except Exception as e:
        return {'ok': False, 'err': str(e)}


def _snap(reason):
    """对操作日志做 git 快照（profile 大文件不进 git），失败不阻断导入"""
    try:
        from memory_autosave import commit_now
        commit_now(os.path.join(_project_root(), 'private', '记忆'), reason=reason)
    except Exception:
        pass


def run_import(src_root, profile_path=None):
    """执行保守导入 + 前后各一次快照。返回导入明细。"""
    pre = scan_import(src_root, profile_path=profile_path)
    if not pre.get('ok'):
        return pre
    try:
        src_prof = pre['src_profile']
        dst_prof = pre['dst_profile']
        _snap('密码大师：导入前快照')
        moved_add, moved_rename = [], []
        for item in pre['add']:
            rel = item['file']
            dst_path = os.path.join(dst_prof, rel.replace('/', os.sep))
            os.makedirs(os.path.dirname(dst_path), exist_ok=True)
            shutil.copy2(os.path.join(src_prof, rel.replace('/', os.sep)), dst_path)
            moved_add.append(rel)
        for it in pre['rename']:
            dst_path = os.path.join(dst_prof, it['as'].replace('/', os.sep))
            os.makedirs(os.path.dirname(dst_path), exist_ok=True)
            shutil.copy2(os.path.join(src_prof, it['file'].replace('/', os.sep)), dst_path)
            moved_rename.append({'file': it['file'], 'as': it['as']})
        # 快照导入操作日志（写一条记忆记录，profile 本体不进 git）
        try:
            log = (f'# 🔑 密码大师导入记录\n- 时间源：{src_root}\n- 新增 {len(moved_add)} 个关键文件，'
                   f'重名保留 {len(moved_rename)} 个\n- 明细新增：{", ".join(moved_add[:50])}\n')
            with open(os.path.join(_project_root(), 'private', '记忆', '密码大师-导入记录.md'),
                      'a', encoding='utf-8') as f:
                f.write(log + '\n')
        except Exception:
            pass
        _snap('密码大师：导入完成快照')
        return {'ok': True, 'src': src_root, 'added': len(moved_add), 'renamed': len(moved_rename),
                'detail_add': moved_add[:100], 'detail_rename': moved_rename[:100],
                'hint': '如需密码在新版本生效，请重启软件或关闭浏览器会话后重新打开'}
    except Exception as e:
        return {'ok': False, 'err': str(e)}


def auto_collect():
    """⚡ 一键自动收集：全盘扫描所有老版本 profile → 一次性保守导入"""
    cands = list_candidates()
    if not cands.get('ok'):
        return cands
    if not cands['candidates']:
        return {'ok': False, 'err': '全盘扫描未发现任何含浏览器密码库/登录态的老版本目录'}
    _snap('密码大师：自动收集·导入前快照')
    results, total_add, total_rename = [], 0, 0
    for c in cands['candidates']:
        pre = scan_import(c['dir'])
        if not pre.get('ok'):
            results.append({'dir': c['dir'], 'name': c['name'], 'ok': False, 'err': pre.get('err')})
            continue
        r = run_import(c['dir'])
        if r.get('ok'):
            total_add += r['added']
            total_rename += r['renamed']
        results.append({'dir': c['dir'], 'name': c['name'], 'ok': r.get('ok'),
                        'added': r.get('added', 0), 'renamed': r.get('renamed', 0),
                        'err': r.get('err')})
    _snap('密码大师：自动收集·导入完成快照')
    return {'ok': True, 'results': results, 'total_add': total_add, 'total_rename': total_rename}


# ============================================================
# 🛡 钉住保底：关键库成对备援 + 密码库健康自检（2026-10 新增）
# 病灶：Login Data 的密码由「来源版本 Local State 的密钥」加密，
#       单独拷 Login Data 过来 = 密钥对不上 = Chromium 显示密码库为空。
# 对策：把「Local State + Login Data + Cookies(新旧双布局)」作为一组，
#       定期快照到 private/浏览器数据/备援/，损坏可整组回滚。
# ============================================================
PAIR_GROUP = [
    'Local State',
    os.path.join('Default', 'Login Data'),
    os.path.join('Default', 'Cookies'),
    os.path.join('Default', 'Network', 'Cookies'),
]
RESERVE_DIR = os.path.join('private', '浏览器数据', '备援')


def _reserve_dir():
    return os.path.join(_project_root(), RESERVE_DIR)


def reserve_backup():
    """把主 profile 的关键库成组快照到备援目录（带时间戳，保留最近 10 份）"""
    import time
    root = _project_root()
    prof = _profile_dir(root)
    if not prof:
        return {'ok': False, 'err': '未找到主 profile 目录'}
    ts = time.strftime('%Y%m%d-%H%M%S')
    dst = os.path.join(_reserve_dir(), ts)
    os.makedirs(dst, exist_ok=True)
    backed = []
    for rel in PAIR_GROUP:
        src = os.path.join(prof, rel.replace('/', os.sep))
        if os.path.isfile(src):
            d = os.path.join(dst, rel.replace('/', os.sep))
            os.makedirs(os.path.dirname(d), exist_ok=True)
            shutil.copy2(src, d)
            backed.append(rel)
    # 只留最近 10 份
    rd = _reserve_dir()
    snaps = sorted(os.listdir(rd))
    for old in snaps[:-10]:
        shutil.rmtree(os.path.join(rd, old), ignore_errors=True)
    return {'ok': True, 'ts': ts, 'backed': backed, 'dir': dst}


def reserve_restore(ts=None):
    """从备援回滚关键库（默认最新一份）。先自动备份当前坏档到 备援/坏档-<ts>/"""
    import time
    rd = _reserve_dir()
    if not os.path.isdir(rd):
        return {'ok': False, 'err': '尚无备援'}
    snaps = sorted(os.listdir(rd))
    snaps = [s for s in snaps if not s.startswith('坏档-')]
    if not snaps:
        return {'ok': False, 'err': '尚无备援'}
    pick = ts if ts in snaps else snaps[-1]
    src = os.path.join(rd, pick)
    prof = _profile_dir(_project_root())
    if not prof:
        return {'ok': False, 'err': '未找到主 profile 目录'}
    # 先保护现场
    bad = os.path.join(rd, f'坏档-{time.strftime("%Y%m%d-%H%M%S")}')
    os.makedirs(bad, exist_ok=True)
    for rel in PAIR_GROUP:
        cur = os.path.join(prof, rel.replace('/', os.sep))
        if os.path.isfile(cur):
            d = os.path.join(bad, rel.replace('/', os.sep))
            os.makedirs(os.path.dirname(d), exist_ok=True)
            shutil.copy2(cur, d)
    restored = []
    for rel in PAIR_GROUP:
        s = os.path.join(src, rel.replace('/', os.sep))
        if os.path.isfile(s):
            d = os.path.join(prof, rel.replace('/', os.sep))
            os.makedirs(os.path.dirname(d), exist_ok=True)
            shutil.copy2(s, d)
            restored.append(rel)
    return {'ok': True, 'from': pick, 'restored': restored, 'bad_saved': bad,
            'hint': '重启软件或重开浏览器会话后生效'}


def check_login_data_health():
    """密码库健康自检：Login Data 的 logins 表是否 ≥1 条（间接验证密钥是否配套）"""
    prof = _profile_dir(_project_root())
    if not prof:
        return {'ok': False, 'err': '未找到主 profile 目录'}
    ld = os.path.join(prof, 'Default', 'Login Data')
    if not os.path.isfile(ld):
        return {'ok': False, 'err': 'Login Data 不存在', 'fix': '运行 reserve_restore 回滚或重跑密码大师导入'}
    try:
        import sqlite3, tempfile, shutil as sh
        tmp = tempfile.mktemp(suffix='.db')
        sh.copy2(ld, tmp)  # Login Data 常被占用，先拷贝再读
        conn = sqlite3.connect(tmp)
        n = conn.execute('SELECT COUNT(*) FROM logins').fetchone()[0]
        conn.close()
        os.remove(tmp)
        return {'ok': n > 0, 'passwords': n,
                'fix': ('' if n else '密码库为空：密钥与 Login Data 不配套，运行 reserve_restore() 整组回滚')} \
            if n else {'ok': False, 'passwords': 0, 'fix': '密码库为空：密钥与 Login Data 不配套，运行 reserve_restore() 整组回滚'}
    except Exception as e:
        return {'ok': False, 'err': str(e)}
