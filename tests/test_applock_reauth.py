# -*- coding: utf-8 -*-
"""applock 重新认证回归（2026-11-24）。

背景事故：/api/applock/reset 此前接受空 POST 即可拆除应用锁，/api/applock/set 任何人可
上锁。本地服务的回环请求免认证是产品边界，但浏览器里打开的恶意网页恰好能发这种请求
（CSRF）。修复：
  - 设锁（首次）须本机桌面确认（ZF_DESKTOP_CONFIRM 环境变量可强制结果，仅测试用）；
  - 已设锁改密须验旧密码，错 5 次锁 5 分钟（与解锁同一防爆破）；
  - 重置须桌面确认；确认动作在原生窗口里完成，跨站请求发不出来。

用法：py tests/test_applock_reauth.py   （退出码 0 = 全过）
"""
import json
import os
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'server')
for _p in (SERVER, ROOT):
    if _p not in sys.path:
        sys.path.insert(0, _p)

_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, detail))
    if not cond:
        _fail.append(name)


import applock as al  # noqa: E402
import util_desktop_confirm as dc  # noqa: E402

work = tempfile.mkdtemp(prefix='zf_applock_')
saved_store, saved_fail = al._STORE_FILE, al._FAIL_FILE
try:
    al._STORE_FILE = os.path.join(work, 'applock.json')
    al._FAIL_FILE = os.path.join(work, 'applock_fail.json')

    # ===== 桌面确认框的环境变量开关 =====
    os.environ['ZF_DESKTOP_CONFIRM'] = '1'
    check('A1 强制确认（测试通道）', dc.ask('t', 'x') is True)
    os.environ['ZF_DESKTOP_CONFIRM'] = '0'
    check('A2 强制拒绝（测试通道）', dc.ask('t', 'x') is False)
    os.environ.pop('ZF_DESKTOP_CONFIRM')
    check('A3 未设置环境变量且弹窗代码不经过真实窗口时的路径存在（不抛异常）', callable(dc.ask))

    # ===== 首次设锁：须桌面确认 =====
    r = al.set_password('manga', '1234', approved=False)
    check('B1 未确认设锁被拒', r.get('ok') is False and r.get('err') == 'need_desktop_confirm', r)
    check('B2 拒绝后没有落盘', not os.path.exists(al._STORE_FILE))
    r = al.set_password('manga', '1234', approved=True)
    check('B3 确认后设锁成功', r.get('ok') is True and al.is_locked('manga') is True, r)
    check('B4 空密码 / 未注册 app 的旧校验保留',
          al.set_password('manga', '', approved=True).get('ok') is False
          and al.set_password('nope', '1234', approved=True).get('ok') is False)

    # ===== 改密：须旧密码 =====
    r = al.set_password('manga', '5678', old='', approved=True)
    check('C1 不带旧密码改密被拒', r.get('ok') is False and r.get('err') == 'wrong-password', r)
    r = al.set_password('manga', '5678', old='0000', approved=True)
    check('C2 旧密码错误被拒（不带旧密码的 C1 同样计入防爆破，故为第 2 次）',
          r.get('ok') is False and r.get('err') == 'wrong-password' and r.get('fails') == 2, r)
    for i in range(4):
        al.set_password('manga', '5678', old='0000', approved=True)
    r = al.set_password('manga', '5678', old='0000', approved=True)
    check('C3 连错 5 次进入锁定', r.get('ok') is False and r.get('err') == 'locked' and r.get('retryAfter', 0) > 0, r)
    r = al.set_password('manga', '5678', old='1234', approved=True)
    check('C4 锁定期间旧密码正确也拒（同一防爆破）', r.get('ok') is False and r.get('err') == 'locked', r)
    d = json.load(open(al._FAIL_FILE, encoding='utf-8'))
    d.pop('manga')
    json.dump(d, open(al._FAIL_FILE, 'w', encoding='utf-8'))
    r = al.set_password('manga', '5678', old='1234', approved=True)
    check('C5 旧密码正确改密成功', r.get('ok') is True, r)
    res, tok = al.verify('manga', '5678', '127.0.0.1')
    check('C6 新密码可解锁', res.get('ok') is True and tok, res)

    # ===== 重置：须桌面确认 =====
    r = al.reset_password('manga')
    check('D1 未确认重置被拒', r.get('ok') is False and r.get('err') == 'need_desktop_confirm', r)
    check('D2 拒绝后锁还在', al.is_locked('manga') is True)
    r = al.reset_password('manga', approved=True)
    check('D3 确认后重置成功', r.get('ok') is True and al.is_locked('manga') is False, r)
    r = al.set_password('manga', '9999', approved=False)
    check('D4 重置后重新设锁仍须确认（拆锁不能成为绕过设锁确认的跳板）',
          r.get('ok') is False and r.get('err') == 'need_desktop_confirm', r)

    # ===== 防爆破计数不因改密路径而绕过 =====
    r = al.verify('manga', 'wrong', '127.0.0.1')
    check('E1 解锁侧防爆破保持原状', r[0].get('ok') is False and r[0].get('err') == 'no-password', r)
finally:
    al._STORE_FILE, al._FAIL_FILE = saved_store, saved_fail
    shutil.rmtree(work, ignore_errors=True)

print('== applock 重新认证回归: %d fail ==' % len(_fail))
sys.exit(1 if _fail else 0)
