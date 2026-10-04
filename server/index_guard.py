#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
首页守护器 v2（index.html 编码守护）
------------------------------------
目的：彻底防止 public/index.html 反复被外部进程以错误编码（GBK 等）写坏。

原理：
1. 启动时若 index.html 损坏（UTF-8 不可解码 / 含私有区乱码字符 / 中文 title 丢失），
   自动从 public/_clean_index/index.html.clean 恢复；无干净基准则把当前完好版本
   固化为基准。
2. 后台线程每 10 秒校验一次。文件完好但内容与基准不同 => 视为正常更新，
   自动刷新基准（保证正常编辑不被回滚）。
3. 检测到损坏 => 立即用基准覆盖恢复，并把损坏版留档到
   public/_clean_index/mojibake-<时间戳>.bak 供事后追查是谁写坏的。

只做编码健康校验，不做内容 diff 比较，不会误伤正常的功能编辑。
"""

import os
import shutil
import threading
import time

_CHECK_INTERVAL = 10  # 秒

_GUARD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', '_clean_index')
_BASELINE = os.path.join(_GUARD_DIR, 'index.html.clean')


def _index_path():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(root, 'public', 'index.html')


def is_healthy(data):
    """判断 index.html 字节内容是否编码健康（UTF-8 可解码、无私有区乱码、title 完好）"""
    if not data:
        return False
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        return False
    for ch in text:
        cp = ord(ch)
        if 0xE000 <= cp <= 0xF8FF:  # Unicode 私有区：GBK 误写乱码的典型特征
            return False
    if '<title>' not in text or '</title>' not in text:
        return False
    return True


def _load_baseline():
    if os.path.exists(_BASELINE):
        with open(_BASELINE, 'rb') as f:
            return f.read()
    return None


def _save_baseline(data):
    os.makedirs(_GUARD_DIR, exist_ok=True)
    tmp = _BASELINE + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    shutil.move(tmp, _BASELINE)


def _recover(bad_data):
    """从基准恢复，并留档损坏版本"""
    baseline = _load_baseline()
    if not baseline or not is_healthy(baseline):
        return False
    path = _index_path()
    if os.path.exists(path):
        ts = time.strftime('%Y%m%d_%H%M%S')
        try:
            with open(os.path.join(_GUARD_DIR, 'mojibake-%s.bak' % ts), 'wb') as f:
                f.write(bad_data)
        except Exception:
            pass
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(baseline)
    shutil.move(tmp, path)
    return True


def check_once():
    """单次校验。返回 'ok' / 'recovered' / 'baseline-updated' / 'no-baseline'"""
    path = _index_path()
    try:
        with open(path, 'rb') as f:
            data = f.read()
    except FileNotFoundError:
        return 'missing'
    if is_healthy(data):
        baseline = _load_baseline()
        if baseline is None:
            _save_baseline(data)
            return 'baseline-created'
        if data != baseline:
            # 完好但内容变了 => 正常编辑，刷新基准
            _save_baseline(data)
            return 'baseline-updated'
        return 'ok'
    else:
        if _recover(data):
            return 'recovered'
        # 无可用基准且当前已损坏：不能盲目覆盖，先固化报告
        return 'no-baseline'


def _loop():
    while True:
        try:
            r = check_once()
            if r == 'recovered':
                print('[IndexGuard] 检测到 index.html 编码损坏，已自动从干净基准恢复，损坏版留档于 public/_clean_index/', flush=True)
            elif r == 'no-baseline':
                print('[IndexGuard] 警告：index.html 已损坏且无干净基准可恢复！请手动处理。', flush=True)
        except Exception as e:
            print('[IndexGuard] 校验异常:', type(e).__name__, e, flush=True)
        time.sleep(_CHECK_INTERVAL)


def start_guard():
    """启动守护线程（幂等）。启动时先做一次立即校验。"""
    try:
        r = check_once()
        print('[IndexGuard] 启动校验:', r, flush=True)
        t = threading.Thread(target=_loop, name='index-guard', daemon=True)
        t.start()
        return t
    except Exception as e:
        print('[IndexGuard] 启动失败(不影响服务器):', type(e).__name__, e, flush=True)
        return None
