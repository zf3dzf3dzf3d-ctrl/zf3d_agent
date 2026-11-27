# -*- coding: utf-8 -*-
"""孤儿 wb_* 浏览器 profile 清理脚本（dry-run 先行）。

用法：
  python cleanup_orphan_profiles.py            # dry-run，仅列出将被清理的目录
  python cleanup_orphan_profiles.py --apply    # 实际删除

规则：server/browser_plugin/data/profiles 下名字以 wb_ 开头、
mtime 超过 30 天的目录（跨进程检查正在运行的 Chromium 锁：单实例锁文件
存在且被占用则视为活跃，跳过不删）。default / 非 wb_ 开头的目录一律不动。
"""
import os, sys, time, shutil

from util_log import get_logger

log = get_logger('cleanup_orphan_profiles')
BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    'data', 'profiles')
MAX_AGE_DAYS = 30

def _is_locked(p):
    """Chromium 运行中会在 profile 内持有单实例锁文件（Windows 为 lockfile），
    尝试独占打开：成功说明没有进程占用（可删），失败说明浏览器仍在用。"""
    for lock in ('lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'):
        lp = os.path.join(p, lock)
        if os.path.exists(lp):
            try:
                with open(lp, 'a+b'):
                    return False
            except OSError:
                return True
    return False

def main():
    apply = '--apply' in sys.argv
    if not os.path.isdir(BASE):
        log.info('%s %s', 'profiles 目录不存在:', BASE)
        return
    now = time.time()
    removed, kept = [], 0
    for name in sorted(os.listdir(BASE)):
        p = os.path.join(BASE, name)
        if not os.path.isdir(p):
            continue
        if not name.startswith('wb_'):
            kept += 1
            continue  # 只清理 wb_* 孤儿；default 等永不动
        age = now - os.path.getmtime(p)
        if age < MAX_AGE_DAYS * 86400:
            kept += 1
            continue
        if _is_locked(p):
            kept += 1
            log.info('%s %s', '[跳过·活跃]', p)
            continue
        removed.append(p)
        if apply:
            shutil.rmtree(p, ignore_errors=True)
            log.info('%s %s', '[已删除]', p)
        else:
            log.info('%s %s', '[将删除]', p)
    log.info('----')
    log.info('%s %s', '模式:', 'APPLY(实删)' if apply else 'DRY-RUN(仅列出)')
    log.info('命中孤儿 wb_* 目录: %d 个，保留: %d 个' % (len(removed), kept))
    if removed and not apply:
        log.info('确认无误后执行: python cleanup_orphan_profiles.py --apply')

if __name__ == '__main__':
    main()
