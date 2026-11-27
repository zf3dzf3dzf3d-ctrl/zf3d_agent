#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
patch_exe_no_console.py — 把 PE 可执行文件的子系统从 CONSOLE 改为 GUI（去黑框）
=============================================================================
背景（2026-11-22 启动空黑框修复）：
  python/朱峰智能体无限.exe 是 python.exe 打品牌资源的副本（OriginalFilename
  = python.exe，InternalName = Python Console），python/pythonw.exe 又是
  python.exe 的字节级副本——三者全是 CONSOLE 子系统。托盘/主界面以它们启动时，
  Windows 必然分配一个控制台：表现为启动时弹出一个空的黑色窗口（标题栏 +
  cmd 小图标），并伴随托盘进程全程存活。vbs/CREATE_NO_WINDOW 只能藏住部分
  路径，治标不治本。
修复原理：
  PE OptionalHeader.Subsystem 字段 3(IMAGE_SUBSYSTEM_WINDOWS_CONSOLE) →
  2(IMAGE_SUBSYSTEM_WINDOWS_GUI)，只改 2 字节，等长写回。GUI 子系统进程
  启动时不分配控制台，其余行为完全一致；CPython 在无控制台时 sys.stdout/
  stderr 为 None，print(file=sys.stderr) 是静默空操作（内置 print 对 None
  文件直接返回），启动链已核对无直接 sys.stdout.write/flush 调用。
用法：
  python tools/patch_exe_no_console.py python/pythonw.exe python/朱峰智能体无限.exe
注意：进程运行中的 exe 文件被锁，需先停止对应进程再打补丁。
"""
import os
import shutil
import struct
import sys

from util_log import get_logger

log = get_logger('patch_exe_no_console')
SUBSOLE = 3   # IMAGE_SUBSYSTEM_WINDOWS_CONSOLE
SUBGUI = 2    # IMAGE_SUBSYSTEM_WINDOWS_GUI


def patch_file(path):
    """把 path 的 PE 子系统改为 GUI。已是 GUI 时原样返回。"""
    with open(path, 'rb') as f:
        data = bytearray(f.read(0x400))
    e_lfanew = struct.unpack_from('<I', data, 0x3C)[0]
    if data[e_lfanew:e_lfanew + 4] != b'PE\x00\x00':
        raise SystemExit('%s: 不是 PE 文件' % path)
    opt = e_lfanew + 24                       # OptionalHeader 偏移
    sub_off = opt + 68                        # OptionalHeader.Subsystem
    magic = struct.unpack_from('<H', data, opt)[0]
    if magic not in (0x10B, 0x20B):
        raise SystemExit('%s: 未知 OptionalHeader magic 0x%X' % (path, magic))
    cur = struct.unpack_from('<H', data, sub_off)[0]
    size = os.path.getsize(path)
    if cur == SUBGUI:
        log.info('[skip] %s 已是 GUI 子系统（%d 字节）' % (path, size))
        return
    if cur != SUBSOLE:
        raise SystemExit('%s: 子系统=%d，非 CONSOLE，拒绝修改' % (path, cur))
    # 全文件读入改写：只改 Subsystem 两个字节，等长写回
    with open(path, 'rb') as f:
        full = bytearray(f.read())
    struct.pack_into('<H', full, sub_off, SUBGUI)
    bak = path + '.bak.console'
    if not os.path.exists(bak):
        shutil.copy2(path, bak)
        log.info('[bak ] %s -> %s' % (path, bak))
    with open(path, 'r+b') as f:
        f.write(full)
    # 回读验证
    with open(path, 'rb') as f:
        chk = struct.unpack_from('<H', bytearray(f.read(0x400)), sub_off)[0]
    log.info('[done] %s: 子系统 %d -> %d（校验 %d，%d 字节）'
          % (path, cur, SUBGUI, chk, os.path.getsize(path)))
    if chk != SUBGUI:
        raise SystemExit('%s: 回读校验失败！' % path)


def main(argv):
    if not argv:
        log.info(__doc__)
        return 2
    for p in argv:
        patch_file(p)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
