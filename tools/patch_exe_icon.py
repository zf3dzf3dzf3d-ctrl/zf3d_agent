#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
patch_exe_icon.py — 把 PE 可执行文件的图标资源整体覆写为 public/logo.ico（朱峰标志）
================================================================================
背景（2026-11-22 任务管理器图标修复）：
  python/python.exe 与 python/pythonw.exe 是 python.exe 打品牌资源的副本，历经
  _icon_fix1~4 多轮尝试后图标仍是 Python 蛇标（仅 朱峰智能体无限.exe 成功）。
  现场资源树混乱：存在字符串命名的 RT_ICON（'1001'~'1006'）、名为 '#1' 的
  字符串 RT_GROUP_ICON，以及数字 id 1..12 的多语言残留，loader 选中了仍指向
  旧 Python 位图的组。
关键教训（本工具的实现约束）：
  UpdateResource 的**删除**操作会污染更新会话——删过之后同一会话内所有写入
  报 err=1359（ERROR_INTERNAL_ERROR），EndUpdateResource 也失败。因此本工具
  **不做任何删除，全部改为覆写**：枚举现有 RT_ICON / RT_GROUP_ICON 的每个
  (名称, 语言) 条目，逐条用 logo.ico 的位图/组数据原位覆盖。这样无论 loader
  选中哪个组（数字还是字符串命名）、哪个语言，读到的都是朱峰图标。
自验（全部通过才交换上岗）：
  1) 资源树里每个图标位图字节 ∈ logo.ico 位图集合，每个组数据 == 新组数据；
  2) PrivateExtractIconsW 能按 16/32/48 提取新图标；
  3) 副本作为解释器真实跑一遍（sys.exit(123) 校验退出码）。
交换方式：
  打补丁在副本上进行；运行中的 exe 文件不能覆写但允许改名，故用
  「改名 .zficon_busy → 换入副本 → 旧文件存为 .iconbak_zf」，无需停止进程；
  旧进程继续用旧映像跑，新启动的进程即带新图标。
用法：
  python tools/patch_exe_icon.py python/python.exe python/pythonw.exe
"""
import ctypes
import os
import shutil
import struct
import subprocess
import sys
from ctypes import wintypes as wt

k32 = ctypes.windll.kernel32
k32.BeginUpdateResourceW.restype = wt.HANDLE
k32.BeginUpdateResourceW.argtypes = [wt.LPCWSTR, wt.BOOL]
k32.UpdateResourceW.restype = wt.BOOL
k32.UpdateResourceW.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p, wt.WORD,
                                ctypes.c_void_p, wt.DWORD]
k32.EndUpdateResourceW.restype = wt.BOOL
k32.EndUpdateResourceW.argtypes = [wt.HANDLE, wt.BOOL]
u32 = ctypes.windll.user32
u32.PrivateExtractIconsW.argtypes = [wt.LPCWSTR, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                     ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(wt.UINT),
                                     wt.UINT, ctypes.POINTER(wt.UINT)]

RT_ICON = 3
RT_GROUP_ICON = 14

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO_PATH = os.path.join(ROOT, 'public', 'logo.ico')


def pe_rsrc(path):
    """返回 (文件字节, .rsrc 节 RVA, 文件偏移, 节大小)。非 PE 或无 .rsrc 抛异常。"""
    d = open(path, 'rb').read()
    e = struct.unpack_from('<I', d, 0x3C)[0]
    if d[e:e + 4] != b'PE\x00\x00':
        raise RuntimeError('%s: 不是 PE 文件' % path)
    coff = e + 4
    nsec = struct.unpack_from('<H', d, coff + 2)[0]
    optsz = struct.unpack_from('<H', d, coff + 16)[0]
    so = coff + 20 + optsz
    for i in range(nsec):
        s = d[so + 40 * i:so + 40 * i + 40]
        name = s[:8].rstrip(b'\x00').decode(errors='replace')
        _vsz, va, rsz, rp = struct.unpack_from('<IIII', s, 8)
        if name == '.rsrc':
            return d, va, rp, rsz
    raise RuntimeError('%s: 无 .rsrc 节' % path)


def rsrc_entries(path, rtype):
    """枚举 rtype 类型下全部 (名称或id, 语言, 数据字节) 条目。
    偏移约定（实测 Windows UpdateResource 产物）：
      目录子表偏移与叶子 OffsetToData 都是相对 .rsrc 节开头的偏移；
      数据实体里的 OffsetToData 字段才是 RVA。名称/ID 与语言都存在条目的
      Name 字段（字符串名带高位标志）。"""
    d, va, rp, rsz = pe_rsrc(path)

    def rva2off(rva):
        return rva - va + rp

    def leaf_off(dr):
        return rva2off(dr) if dr >= va else rp + dr

    blob = d[rp:rp + rsz]

    def name_of(nr):
        if nr & 0x80000000:
            so_ = nr & 0x7FFFFFFF
            ln = struct.unpack_from('<H', blob, so_)[0]
            return blob[so_ + 2:so_ + 2 + ln * 2].decode('utf-16le')
        return nr

    acc = []

    def walk(off, lvl, cur):
        _, _, _, _, nnamed, nid = struct.unpack_from('<IIHHHH', blob, off)
        for j in range(nnamed + nid):
            nr, dr = struct.unpack_from('<II', blob, off + 16 + 8 * j)
            if lvl == 0:
                if (nr & 0x80000000) == 0 and nr != rtype:
                    continue
                walk(dr & 0x7FFFFFFF, 1, None)
            elif lvl == 1:
                walk(dr & 0x7FFFFFFF, 2, name_of(nr))
            else:
                data_rva, size, _cp, _rv = struct.unpack_from('<IIII', d, leaf_off(dr))
                off0 = rva2off(data_rva)
                acc.append((cur, name_of(nr), d[off0:off0 + size]))
    walk(0, 0, None)
    return acc


def load_logo():
    """解析 ICO → [(宽, 高, 色板数, 位面, 位深, 位图blob)]"""
    logo = open(LOGO_PATH, 'rb').read()
    cnt = struct.unpack_from('<H', logo, 4)[0]
    entries = []
    for i in range(cnt):
        w, h, c, _r, pl, bp, size, off = struct.unpack_from('<BBBBHHII', logo, 6 + 16 * i)
        entries.append((w or 256, h or 256, c, pl, bp, logo[off:off + size]))
    return entries


def build_group(entries):
    """GRPICONENTRY 目录：数字 id 1..N 指向各尺寸位图"""
    grp = struct.pack('<HHH', 0, 1, len(entries))
    for i, (w, hh, c, pl, bp, blob) in enumerate(entries, 1):
        grp += struct.pack('<BBBBHHIH', w & 0xFF, hh & 0xFF, c, 0, pl, bp, len(blob), i)
    return grp


def res_arg(name_or_id):
    """UpdateResource 的 lpName/lpType 参数：数字用 MAKEINTRESOURCE，字符串用 UTF-16"""
    if isinstance(name_or_id, str):
        return ctypes.create_unicode_buffer(name_or_id)
    return ctypes.c_void_p(name_or_id)


def patch_copy(src, dst):
    """src 的副本写到 dst，图标资源整体覆写为 logo.ico。返回 (ok, msg)。"""
    shutil.copyfile(src, dst)
    entries = load_logo()
    grp = build_group(entries)
    grp_bytes = grp
    logo_blobs = set(e[5] for e in entries)

    icons = rsrc_entries(dst, RT_ICON)
    groups = rsrc_entries(dst, RT_GROUP_ICON)
    print('  现有 RT_ICON %d 条 / RT_GROUP_ICON %d 条，全部覆写为 logo 数据' %
          (len(icons), len(groups)))
    if not groups:
        # 文件里没有任何组图标（异常状态）：按常规数字 id 写入
        groups = [(1, 1033, b''), (1, 0, b'')]
    if not icons:
        icons = [(i, lg, b'') for i in range(1, len(entries) + 1) for lg in (0, 1033)]

    h = k32.BeginUpdateResourceW(dst, False)
    if not h:
        return False, 'BeginUpdateResource 失败 err=%d' % k32.GetLastError()
    ok = True
    # 覆写全部图标位图：数字 id i → 第 i 个尺寸；命名条目 → 第 1 个尺寸
    for name_or_id, lang, _old in icons:
        if isinstance(name_or_id, int) and 1 <= name_or_id <= len(entries):
            blob = entries[name_or_id - 1][5]
        else:
            blob = entries[0][5]
        r = k32.UpdateResourceW(h, ctypes.c_void_p(RT_ICON), res_arg(name_or_id),
                                lang, blob, len(blob))
        if not r:
            print('  RT_ICON %r lang=%d 覆写失败 err=%d' % (name_or_id, lang, k32.GetLastError()))
            ok = False
    # 覆写全部组图标：无论数字还是字符串命名，统一写入新组数据
    for name_or_id, lang, _old in groups:
        r = k32.UpdateResourceW(h, ctypes.c_void_p(RT_GROUP_ICON), res_arg(name_or_id),
                                lang, grp_bytes, len(grp_bytes))
        if not r:
            print('  RT_GROUP_ICON %r lang=%d 覆写失败 err=%d' % (name_or_id, lang, k32.GetLastError()))
            ok = False
    if not k32.EndUpdateResourceW(h, False):
        return False, 'EndUpdateResource 失败 err=%d' % k32.GetLastError()
    return ok, '覆写 %d 图标 + %d 组' % (len(icons), len(groups))


def verify(path):
    """自验：树内数据全部是 logo 的、可提取新图标、能当解释器跑。返回 (ok, msg)。"""
    entries = load_logo()
    grp = build_group(entries)
    logo_blobs = set(e[5] for e in entries)
    bad = []
    for name_or_id, lang, data in rsrc_entries(path, RT_ICON):
        if data not in logo_blobs:
            bad.append(('ICON', name_or_id, lang))
    for name_or_id, lang, data in rsrc_entries(path, RT_GROUP_ICON):
        if data != grp:
            bad.append(('GROUP', name_or_id, lang))
    if bad:
        return False, '仍有非 logo 数据条目: %r' % bad
    for sz in (16, 32, 48):
        hi = (ctypes.c_void_p * 1)()
        ni, pi = wt.UINT(0), wt.UINT(0)
        r = u32.PrivateExtractIconsW(path, 0, sz, sz, hi, ctypes.byref(ni), 1, ctypes.byref(pi))
        if not (r and ni.value):
            return False, '%dx%d 图标提取失败' % (sz, sz)
    rc = subprocess.run([path, '-c', 'import sys; sys.exit(123)'],
                        timeout=60).returncode
    if rc != 123:
        return False, '解释器试跑退出码 %d（期望 123）' % rc
    return True, 'OK'


def patch_file(path):
    print('[patch] %s' % path)
    tmp = path + '.zficon_tmp'
    if os.path.exists(tmp):
        os.remove(tmp)
    ok, msg = patch_copy(path, tmp)
    if not ok:
        print('  [FAIL] %s（未交换）' % msg)
        return False
    vok, vmsg = verify(tmp)
    if not vok:
        print('  [FAIL] 自验不过: %s（未交换）' % vmsg)
        return False
    bak = path + '.iconbak_zf'
    if os.path.exists(bak):
        try:
            os.remove(bak)
        except OSError:
            bak = path + '.iconbak_zf2'
    busy = path + '.zficon_busy'
    if os.path.exists(busy):
        os.remove(busy)
    os.rename(path, busy)      # 运行中的 exe 也允许改名
    os.rename(tmp, path)
    os.rename(busy, bak)
    print('  [done] %s（%s；旧文件备份为 %s）' % (path, msg, bak))
    return True


def main(argv):
    if not os.path.exists(LOGO_PATH):
        raise SystemExit('缺少 %s' % LOGO_PATH)
    if not argv:
        print(__doc__)
        return 2
    for p in argv:
        patch_file(os.path.abspath(p))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
