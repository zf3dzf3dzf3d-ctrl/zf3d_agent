# -*- coding: utf-8 -*-
"""collab-watchdog 离线单元测试（快照注入隔离，不写真库不碰真实组）。

用法：python\python.exe plugins\collab-watchdog\test_watchdog.py
覆盖：①沉默超阈→只救未 done 成员 ②冷却期内不重投 ③有新活动不扰 ④TTL 过期组不救
⑤点卯模式活跃组也投 ⑥点卯与巡检共用冷却 ⑦点卯 TTL 过期不救 ⑧点卯零活动组也投
⑨组活跃但成员单侧沉默→成员级救援 ⑩成员沉默未超成员级阈值不扰 ⑪成员级共用冷却
"""
import os
import time
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('zfplugin_collab_watchdog_test',
                                              os.path.join(HERE, 'main.py'))
wd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wd)

TID = 'collab_9999_wdtest'
NOW = time.time()


def _mk_snap(last_ts):
    """构造隔离快照：sleepy=未done沉默者, finished=已完成者。"""
    return {TID: {
        'created': last_ts - 3600, 'task': 'wd-test',
        'members': {
            'sleepy':   {'chat_id': 'box_fake_1', 'ear': 1, 'joined': last_ts - 3600,
                         'left': None, 'status': 'working', 'done_at': None},
            'finished': {'chat_id': 'box_fake_2', 'ear': 1, 'joined': last_ts - 3600,
                         'left': None, 'status': 'done', 'done_at': last_ts - 3500},
        },
        'say_log': [{'ts': last_ts}], 'inj_log': [], 'l1_log': [{'ts': last_ts}],
    }}


captured = []


def _fake_nudge(ctx, ccc, t, cn, chat, silent, boot=False, member=False):
    captured.append((t, cn, chat, int(silent), bool(boot)))
    return True


wd._nudge = _fake_nudge
wd._archive_warn = lambda ccc, t, cn, txt: None


class _StubCtx:
    class _L:
        def info(self, *a, **k): pass
        def error(self, *a, **k): pass
    log = _L()


# ① 沉默超阈（20 分钟前最后活动 > 阈值 10 分钟）→ 只救未 done 的 sleepy
wd._tick(_StubCtx(), _mk_snap(NOW - 1200))
assert captured == [(TID, 'sleepy', 'box_fake_1', 1200, False)], 'T1 fail: %r' % captured
print('TEST1 PASS: 只投未 done 成员 sleepy, silent=%ds' % captured[0][3])

# ② 冷却期内重跑 → 不重投
wd._tick(_StubCtx(), _mk_snap(NOW - 1200))
assert len(captured) == 1, 'T2 fail: %r' % captured
print('TEST2 PASS: 冷却防轰炸生效')

# ③ 组有新活动（log 刷到当前）→ 不投
wd._last_nudge.clear()
captured.clear()
wd._tick(_StubCtx(), _mk_snap(time.time()))
assert captured == [], 'T3 fail: %r' % captured
print('TEST3 PASS: 活跃组不受扰')

# ④ TTL 过期组 → 不投
snap4 = _mk_snap(time.time() - 7200)
snap4[TID]['created'] = time.time() - 8 * 24 * 3600
wd._tick(_StubCtx(), snap4)
assert captured == [], 'T4 fail: %r' % captured
print('TEST4 PASS: TTL 过期组不救')

# ⑤ 启动点卯（boot=True）：活跃组（刚刷过活动）也投——重启场景沉默时长无从判定
wd._last_nudge.clear()
captured.clear()
wd._tick(_StubCtx(), _mk_snap(time.time()), boot=True)
assert captured == [(TID, 'sleepy', 'box_fake_1', 0, True)], 'T5 fail: %r' % captured
print('TEST5 PASS: 点卯模式活跃组也投（只投未 done）')

# ⑥ 点卯后冷却表生效：立即常规巡检不重投（共用冷却防轰炸）
wd._tick(_StubCtx(), _mk_snap(NOW - 1200))
assert len(captured) == 1, 'T6 fail: %r' % captured
print('TEST6 PASS: 点卯与沉默巡检共用冷却表')

# ⑦ 点卯模式 TTL 过期组仍不救
wd._last_nudge.clear()
captured.clear()
snap7 = _mk_snap(time.time())
snap7[TID]['created'] = time.time() - 8 * 24 * 3600
wd._tick(_StubCtx(), snap7, boot=True)
assert captured == [], 'T7 fail: %r' % captured
print('TEST7 PASS: 点卯模式 TTL 过期组不救')

# ⑧ 点卯模式对从无活动记录的组也救（刚建组未活动，成员窗同样可能断线）
wd._last_nudge.clear()
captured.clear()
snap8 = _mk_snap(time.time())
snap8[TID]['say_log'] = []
snap8[TID]['l1_log'] = []
wd._tick(_StubCtx(), snap8, boot=True)
assert captured == [(TID, 'sleepy', 'box_fake_1', 0, True)], 'T8 fail: %r' % captured
print('TEST8 PASS: 点卯模式零活动组也投')

# ⑨ 组整体活跃（A 心跳新掩盖组级判定），B 单侧沉默 30 分钟 → 成员级救援只投 B
#    （v6.3 修复③核心场景：A 挂 review_wait 等 B 出票，B 死了组级判定永不触发）
wd._last_nudge.clear()
captured.clear()
now9 = time.time()
snap9 = {TID: {
    'created': now9 - 7200, 'task': 'wd-member-test',
    'members': {
        'waiter': {'chat_id': 'box_a', 'ear': 1, 'joined': now9 - 7200,
                   'left': None, 'status': 'working', 'done_at': None},
        'worker': {'chat_id': 'box_b', 'ear': 1, 'joined': now9 - 7200,
                   'left': None, 'status': 'working', 'done_at': None},
    },
    'say_log': [{'ts': now9, 'codename': 'waiter'}],
    'inj_log': [],
    'l1_log': [{'ts': now9, 'codename': 'waiter'},
               {'ts': now9 - 1800, 'codename': 'worker'}],
}}
wd._tick(_StubCtx(), snap9)
assert captured == [(TID, 'worker', 'box_b', 1800, False)], 'T9 fail: %r' % captured
print('TEST9 PASS: 组活跃但成员单侧沉默 → 成员级救援只投 worker')

# ⑩ 成员沉默 10 分钟 < 成员级阈值 15 分钟 → 不投（不误伤慢任务成员）
wd._last_nudge.clear()
captured.clear()
now10 = time.time()
snap10 = {TID: {
    'created': now10 - 7200, 'task': 'wd-member-test',
    'members': {
        'waiter': {'chat_id': 'box_a', 'ear': 1, 'joined': now10 - 7200,
                   'left': None, 'status': 'working', 'done_at': None},
        'worker': {'chat_id': 'box_b', 'ear': 1, 'joined': now10 - 7200,
                   'left': None, 'status': 'working', 'done_at': None},
    },
    'say_log': [{'ts': now10, 'codename': 'waiter'}],
    'inj_log': [],
    'l1_log': [{'ts': now10, 'codename': 'waiter'},
               {'ts': now10 - 600, 'codename': 'worker'}],
}}
wd._tick(_StubCtx(), snap10)
assert captured == [], 'T10 fail: %r' % captured
print('TEST10 PASS: 成员沉默未超阈值不扰')

# ⑪ 成员级救援共用冷却表：紧接⑨重跑同快照 → 冷却期内不重投
wd._tick(_StubCtx(), snap9)
assert len(captured) == 1, 'T11 fail: %r' % captured
print('TEST11 PASS: 成员级救援共用冷却表防轰炸')

print('ALL 11 TESTS PASS')
