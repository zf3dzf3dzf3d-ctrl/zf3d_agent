#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
path_policy - 统一的临时文件/备份目录策略（5.1.2+）

规范（详见 docs/文件位置规范.md）：
  临时文件  -> system/temp/
  运行日志  -> system/logs/
  写前备份  -> system/backup/<折叠路径>/<name>.<tag>.<ts>.bak

各引擎工具 / 路由在写临时文件或备份时，统一 import 本模块，
不要自己拼根目录路径，更不要往项目根目录落文件。
"""
import os
import re
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMP_DIR = os.path.join(ROOT, 'system', 'temp')
REJECT_DIR = os.path.join(TEMP_DIR, 'rejected')
LOG_DIR = os.path.join(ROOT, 'system', 'logs')
BACKUP_DIR = os.path.join(ROOT, 'system', 'backup')

_ILLEGAL = re.compile(r'[<>:"|?*\x00-\x1f]')


def temp_path(name, subdir=''):
    """返回 system/temp/ 下的一个路径（自动建目录）。name 若含非法字符会被清洗。"""
    safe = _ILLEGAL.sub('_', str(name)).strip().strip('.') or 'unnamed'
    d = os.path.join(TEMP_DIR, *[_ILLEGAL.sub('_', p) for p in str(subdir).split('\\/') if p]) if subdir else TEMP_DIR
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, safe)


def log_path(name):
    """返回 system/logs/ 下的日志文件路径。"""
    os.makedirs(LOG_DIR, exist_ok=True)
    return os.path.join(LOG_DIR, _ILLEGAL.sub('_', str(name)))


def backup_path(full_path, tag='write', keep=5):
    """把 full_path 备份到 system/backup/<折叠相对路径>/ 下，返回备份文件路径。
    文件不存在时返回 None；超出 keep 份数自动删除最旧的。永不抛错。"""
    try:
        if not os.path.isfile(full_path):
            return None
        rel = os.path.relpath(full_path, ROOT)
        rel = _ILLEGAL.sub('_', rel).replace('\\', '__')
        d = os.path.join(BACKUP_DIR, rel)
        os.makedirs(d, exist_ok=True)
        ts = time.strftime('%Y%m%d_%H%M%S')
        bak = os.path.join(d, '%s.%s.%s.bak' % (os.path.basename(full_path), tag, ts))
        import shutil
        shutil.copy2(full_path, bak)
        baks = sorted(f for f in os.listdir(d) if f.startswith(os.path.basename(full_path) + '.'))
        for f in baks[:-keep]:
            try:
                os.remove(os.path.join(d, f))
            except OSError:
                pass
        return bak
    except Exception:
        return None


def sanitize_write_path(full_path):
    """写入前的最后一道守卫。
    若目标文件名明显畸形（空、纯符号、以括号/大括号结尾等），
    改写到 system/temp/rejected/ 并返回 (修正后路径, 警告信息)；
    正常路径原样返回 (full_path, '')。永不抛错。"""
    try:
        base = os.path.basename(str(full_path))
        if not base or base.strip('.') == '' or _ILLEGAL.search(base) \
                or base.rstrip().endswith((')', '}', ']', ',')) or base.startswith('$'):
            os.makedirs(REJECT_DIR, exist_ok=True)
            fixed = os.path.join(
                REJECT_DIR,
                'rejected_%s_%s' % (time.strftime('%Y%m%d_%H%M%S'),
                                    _ILLEGAL.sub('_', base or 'unnamed')[:60] or 'unnamed'))
            return fixed, '[path_policy] 非法文件名 %r 已兜底改写到 system/temp/rejected/' % base
        return full_path, ''
    except Exception:
        return full_path, ''


if __name__ == '__main__':
    print('TEMP_DIR  =', TEMP_DIR)
    print('LOG_DIR   =', LOG_DIR)
    print('BACKUP_DIR=', BACKUP_DIR)
    p, w = sanitize_write_path(os.path.join(ROOT, '12)'))
    print('sanitize "12)" ->', p, w)
