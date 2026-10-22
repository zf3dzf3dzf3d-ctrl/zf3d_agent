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
    os.path.join('Default', 'Cookies'):     '登录态 Cookie',
    os.path.join('Default', 'History'):     '浏览历史',
    os.path.join('Default', 'Web Data'):    '表单/自动填充',
    os.path.join('Default', 'Favicons'):    '网站图标',
}
KEY_DIR_PREFIXES = ['Default\\Sessions', 'Default/Session Storage', 'Default/Local Storage']


def _project_root():
    return os.path.dirname(os.path.abspath(__file__)) and os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _profile_dir(root):
    """返回该版本根下的浏览器 profile 目录（找得到就返回第一个存在的）"""
    for rel in PROFILE_CANDIDATES:
        p = os.path.join(root, rel)
        if os.path.isdir(p):
            return p
    return None


def _is_source_safe(path):
    real = os.path.realpath(path)
    name = os.path.basename(real)
    if '朱峰' not in name and '智能体' not in name:
        return False
    if real == os.path.realpath(_project_root()):
        return False
    return _profile_dir(real) is not None


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


def _probe_dir(cand_root, out):
    prof = _profile_dir(cand_root)
    if not prof or not _has_profile_data(prof):
        return
    files = _collect_key_files(prof)
    out.append({
        'dir': cand_root,
        'name': os.path.basename(cand_root.rstrip('\\/')),
        'profile_path': prof,
        'count': len(files),
        'total_mb': round(sum(f['size'] for f in files) / 1048576, 1),
        'mtime': int(os.path.getmtime(prof)),
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
    seen, uniq = set(), []
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
    out, seen = [], set()
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
                        _probe_dir(cand, out)
                        try:
                            for sub in sorted(os.listdir(cand)):
                                sub_p = os.path.join(cand, sub)
                                if os.path.isdir(sub_p) and not sub.startswith(('.', '$')) \
                                        and sub not in ('node_modules', '_垃圾箱'):
                                    _probe_dir(sub_p, out)
                        except Exception:
                            pass
                        continue
                    if ('朱峰' in base or '智能体' in base) and not name.startswith(('.', '$')):
                        _probe_dir(cand, out)
                except Exception:
                    continue
    except Exception as e:
        return {'ok': False, 'err': str(e)}
    out.sort(key=lambda x: -x['mtime'])
    return {'ok': True, 'current': cur_ver, 'candidates': out, 'scan_mode': '全盘智能扫描'}


def scan_import(src_root):
    """差异预览：关键文件粒度的新增 / 重名改名 两类（永不覆盖）"""
    try:
        if not _is_source_safe(src_root):
            return {'ok': False, 'err': '路径不在允许范围（仅限含浏览器 profile 的版本目录）'}
        src_prof = _profile_dir(src_root)
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


def run_import(src_root):
    """执行保守导入 + 前后各一次快照。返回导入明细。"""
    pre = scan_import(src_root)
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
