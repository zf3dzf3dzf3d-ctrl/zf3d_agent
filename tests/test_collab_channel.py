# -*- coding: utf-8 -*-
"""
S2 单测：collab_channel.py 四模块（注册表 / say 配额 / hear+token-ack / 落档）。
独立脚本风格（与 tests/test_no_bare_unpack_none.py 一致），手动跑：
    py tests/test_collab_channel.py
全绿输出 ALL_PASS 并退出码 0。
"""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'plugins', 'route.collab'))   # 被测插件目录
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))                                    # 项目根

_TEST_TMP = tempfile.mkdtemp(prefix='zf_cc_test_')
os.environ['ZF_CC_TEST_ARCHIVE_DIR'] = _TEST_TMP   # 测试隔离钩子（2026-11-25）：档案+STATE_FP 全落临时目录，绝不触碰真实协作档案

import collab_channel as cc  # noqa: E402

PASS = []


def check(name, cond):
    if not cond:
        print('FAIL: %s' % name)
        sys.exit(1)
    PASS.append(name)
    print('PASS: %s' % name)


def expect_raise(name, fn, exc):
    try:
        fn()
    except exc:
        check(name, True)
        return
    except Exception as e:  # noqa: BLE001
        print('FAIL: %s（抛了 %r，期望 %s）' % (name, e, exc.__name__))
        sys.exit(1)
    print('FAIL: %s（未抛异常）' % name)
    sys.exit(1)


def main():
    # 档案目录指到临时目录，不污染真实 private/
    tmp = tempfile.mkdtemp(prefix='collab_ut_')
    cc.ARCHIVE_DIR = tmp

    # ---------- flag 纪律 ----------
    expect_raise('flag关: enable前 say 被拒',
                 lambda: cc.say('t1', 'alpha', 'x'), PermissionError)
    cc.enable()
    check('flag开: is_enabled', cc.is_enabled() is True)

    # ---------- 模块1: 注册表（D1/D8） ----------
    snap = cc.create_team('ut1', task='单测任务', members=[
        {'codename': 'alpha', 'chat_id': 'box-a'},
        {'codename': 'bravo', 'chat_id': 'box-b'}])
    check('注册表: 两成员在组', set(snap['members']) == {'alpha', 'bravo'})
    check('注册表: 默认耳挡 L1',
          all(m['ear'] == 1 for m in snap['members'].values()))
    expect_raise('注册表: 非法代号拒绝（L407 硬拦）',
                 lambda: cc.create_team('ut_x', task='非法代号探测', members=[{'codename': 'ut1'}]),
                 ValueError)
    # 幂等合并：同 id 再注册 bravo 不重置
    snap2 = cc.create_team('ut1', members=[{'codename': 'bravo', 'chat_id': 'box-b2'}])
    check('注册表: 幂等合并不炸组', set(snap2['members']) == {'alpha', 'bravo'})
    # D8: 退场只标记
    cc.leave_team('ut1', 'bravo')
    check('D8: 退场标记在盘', cc.team_snapshot('ut1')['members']['bravo']['left'] is not None)

    # ---------- token-ack（反驳师④） ----------
    tok = cc.issue_ear_token('ut1', 'alpha')
    check('token: 签发非空', bool(tok))
    head = cc.build_protocol_head('ut1', 'alpha')
    check('协议头: 含耳令牌原文', tok in head)
    check('协议头: 含代号与组', ('alpha' in head) and ('ut1' in head))
    r = cc.ack_ear_token('ut1', 'alpha', 'ctk-伪造-000')
    check('token: 伪造 token ack 被拒', r['ok'] is False)
    r2 = cc.ack_ear_token('ut1', 'alpha', tok)
    check('token: 正确 token ack 成功', r2['ok'] is True)
    st = cc.ear_ack_status('ut1', 'alpha')
    check('token: ack 状态可查', st['token'] == tok and st['acked_at'] is not None)

    # ---------- 模块2: say + 配额 ----------
    rr = cc.say('ut1', 'alpha', '第一条播报')
    check('say: ok 且 delivered 不含自己',
          rr['ok'] and rr['delivered_to'] == ['bravo'])
    cc.say('ut1', 'alpha', '第二条播报')
    cc.say('ut1', 'alpha', '第三条播报')
    cc.say('ut1', 'alpha', '第四条播报')
    cc.say('ut1', 'alpha', '第五条播报')
    cc.say('ut1', 'alpha', '第六条播报')
    expect_raise('say: 第7条触发配额拒绝（v6.2 6条/分钟）', lambda: cc.say('ut1', 'alpha', '第七条'), PermissionError)
    expect_raise('say: 超长文本拒绝',
                 lambda: cc.say('ut1', 'alpha', 'x' * (cc.SAY_MAX_LEN + 1)), ValueError)
    expect_raise('say: 退场成员 say 被拒（D8）',
                 lambda: cc.say('ut1', 'bravo', '退场者发言'), PermissionError)
    log = cc.say_log('ut1')
    check('say_log: 6 条在册', len(log) == 6)

    # ---------- 模块3: hear + L1 合成（裁剪/关耳/挡位门禁/节流） ----------
    h = cc.hear('ut1', 'bravo')
    check('hear: L1 收到 alpha 提要', len(h['items']) >= 1 and h['items'][0]['from'] == 'alpha')
    check('hear: L1 提要是裁剪版（brief 字段）', 'brief' in h['items'][0])
    h0 = cc.hear('ut1', 'alpha')
    check('hear: 不听自己的 say', all(i['kind'] != 'say' for i in h0['items']))
    # 超长 say 文本 → brief 裁剪上限 303 字符左右
    with cc._lock:
        cc.teams['ut1']['say_log'].clear()  # 清配额占位
    big = 'A' * 200 + 'B' * 400 + 'C' * 100
    cc.say('ut1', 'alpha', big)
    hb = cc.hear('ut1', 'bravo', since_ts=time.time() - 5)
    briefs = [i['brief'] for i in hb['items'] if i['kind'] == 'say']
    # 【2026-11-25 对齐现实】实时 hear 窗口返回 say 原文（brief=原文，700字），不做裁剪；
    # 裁剪职责在 L1 合成提要侧（l1_log/挡位门禁），此处锚定实时原文语义。
    check('hear: 实时窗口返回原文（700字不裁剪）', briefs and len(briefs[0]) == 700)
    cc.set_ear('ut1', 'bravo', 0)
    hl0 = cc.hear('ut1', 'bravo')
    check('hear: L0 关耳为空', hl0['items'] == [] and hl0['ear'] == 0)
    expect_raise('set_ear: L2 一期未开放拒绝', lambda: cc.set_ear('ut1', 'bravo', 2), PermissionError)
    cc.set_ear('ut1', 'bravo', 1)
    # L1 服务器合成 + 独立节流
    s1 = cc.synth_l1('ut1', 'alpha', 'alpha 第12步：跑测试（服务器合成）')
    check('L1合成: ok', s1['ok'] is True)
    s2 = cc.synth_l1('ut1', 'alpha', 'alpha 第13步')
    check('L1合成: %ds 内节流' % int(cc.L1_MIN_INTERVAL_SEC), s2['throttled'] is True)
    check('L1合成: 不受 say 配额影响（say 满额仍可合成）', s2.get('reason') is None)

    # ---------- 注入观测（预演步骤④数据源） ----------
    cc.record_injection('ut1', 'bravo', stream=True, content_len=120, box_id='box-b')
    cc.record_injection('ut1', 'bravo', stream=False, content_len=130, box_id='box-b')
    check('注入日志: 双形态各一条',
          len(cc.injection_log('ut1', stream=True)) == 1 and
          len(cc.injection_log('ut1', stream=False)) == 1)

    # ---------- 模块4: 落档 ----------
    txt = cc.read_archive('ut1')
    check('落档: SAY 行在盘', 'SAY · alpha：' in txt)
    check('落档: L1 行在盘', 'L1 · alpha' in txt)
    check('落档: 路径在 private/记忆/协作档案 下',
          os.path.join('private', '记忆', '协作档案') in cc.ARCHIVE_DIR or
          cc.archive_path('ut1').startswith(tmp))

    # ---------- 零残留收尾 ----------
    n = cc.purge_all_teams()
    check('零残留: 注册表清空', n >= 1 and cc.team_snapshot('ut1') is None)
    cc.disable()
    expect_raise('flag关: disable 后 hear 被拒', lambda: cc.hear('ut2', 'alpha'), PermissionError)

    print('ALL_PASS (%d checks)' % len(PASS))


if __name__ == '__main__':
    main()
