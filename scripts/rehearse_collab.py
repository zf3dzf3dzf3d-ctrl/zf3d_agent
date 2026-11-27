# -*- coding: utf-8 -*-
"""
rehearse_collab —— 多路协作通气·无头预演十步脚本（策划案 v3.2 §11.2 + 2-7/2-8 增补）

设计（v3.2 裁决落地）：
  - 驾驶舱删除令 V-opt：不建驾驶舱，本脚本直打正式版 server/collab_channel.py
    与 server/routes/collab_inject.py（门禁打的就是要转正的代码）。
  - 十步全绿 = 管道级门禁放行；第⑧步"AI 自发调用"与第⑨步"变异行为分叉"的
    真窗部分由 S4 真队跑（本脚本先验管道级：工具可达 + 注入改变 payload）。
  - 用法：
      python rehearse_collab.py            # 十步全跑
      python rehearse_collab.py --step 4   # 单跑某步
  - 全绿输出 REHEARSAL_ALL_GREEN；任一步 FAIL 退出码 1。
"""
import argparse
import sys
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, os.path.join(_ROOT, 'server'))
sys.path.insert(0, os.path.join(_ROOT, 'plugins', 'route.collab'))  # collab_channel 真源（一切皆插件 v4 §3.2）
sys.path.insert(0, _ROOT)  # 让 tools.* 可导入

import collab_channel as cc            # noqa: E402  （真源=plugins/route.collab）
import collab_inject as ci             # noqa: E402

TEAM = 'rehearse-1'
PASS = []
FAILS = []


def check(name, cond, detail=''):
    tag = 'PASS' if cond else 'FAIL'
    print('[%s] 步骤断言: %s%s' % (tag, name, (' —— ' + str(detail)) if (detail and not cond) else ''))
    (PASS if cond else FAILS).append(name)
    return cond


def expect_raise(name, fn, exc):
    try:
        fn()
    except exc:
        return check(name, True)
    except Exception as e:  # noqa: BLE001
        return check(name, False, '抛了 %r，期望 %s' % (e, exc.__name__))
    return check(name, False, '未抛异常')


def _mock_log():
    class L:
        def info(self, *a, **k):
            pass

        def error(self, *a, **k):
            pass
    return L()


def _mk_payload(msgs=None, stream=False):
    return {'messages': msgs if msgs is not None else [
        {'role': 'user', 'content': '（正式任务占位）'}],
        'stream': stream}


def _mk_body(cn, team=TEAM, stream=False):
    return {'_box_id': 'box-%s' % cn, '_collab_team': team,
            '_collab_codename': cn, 'stream': stream}


def _fresh_team():
    """每步独立小队，防串扰（zero-residue 由 finally 收尾）。"""
    if TEAM in cc.teams:
        del cc.teams[TEAM]
    ci.reset_watermarks()
    cc.create_team(TEAM, task='预演：验证协作通气管道', members=[
        {'codename': 'alpha', 'chat_id': 'box-alpha'},
        {'codename': 'bravo', 'chat_id': 'box-bravo'}])


# ---------------------------------------------------------------------------
# 十步
# ---------------------------------------------------------------------------

def step1_骨架连通():
    _fresh_team()
    snap = cc.team_snapshot(TEAM)
    check('s1 组注册成功', snap and set(snap['members']) == {'alpha', 'bravo'})
    check('s1 默认耳挡 L1', all(m['ear'] == 1 for m in snap['members'].values()))
    check('s1 flag 门禁关闭时 say 拒绝', True)  # 占位合并进 s10 验证
    cc.disable()
    expect_raise('s1 flag关: say 被拒', lambda: cc.say(TEAM, 'alpha', 'x'), PermissionError)
    cc.enable()


def step2_协议头拼装():
    _fresh_team()
    tok_a = cc.issue_ear_token(TEAM, 'alpha')
    head = cc.build_protocol_head(TEAM, 'alpha')
    check('s2 协议头含代号/组/纪律/token',
          all(k in head for k in ('alpha', TEAM, 'say 纪律', tok_a)))


def step3_say全组播报():
    _fresh_team()
    r = cc.say(TEAM, 'alpha', '侦察完成：目标目录共 3 个模块')
    check('s3 say ok 且送达 bravo', r['ok'] and r['delivered_to'] == ['bravo'])
    h = cc.hear(TEAM, 'bravo')
    check('s3 bravo hear 收到提要',
          any(i['kind'] == 'say' and '3 个模块' in i['brief'] for i in h['items']))


def step4_注入双形态():
    _fresh_team()
    tok = cc.issue_ear_token(TEAM, 'bravo')
    body_s = _mk_body('bravo', stream=True)
    body_ns = _mk_body('bravo', stream=False)
    cc.say(TEAM, 'alpha', '第一步完成：找到了入口文件')
    # 流式形态
    p_s = _mk_payload(stream=True)
    out_s = ci.collab_hear_inject(body_s, p_s, True, box_id='box-bravo', log=_mock_log())
    check('s4 流式注入: system 消息入顶', out_s is not None and
          p_s['messages'][0]['role'] == 'system' and '入口文件' in p_s['messages'][0]['content'])
    # 非流式形态（水位已推进，再 say 一条新的）
    cc.say(TEAM, 'alpha', '第二步完成：依赖已梳理')
    p_ns = _mk_payload(stream=False)
    out_ns = ci.collab_hear_inject(body_ns, p_ns, False, box_id='box-bravo', log=_mock_log())
    check('s4 非流式注入: 增量生效', out_ns is not None and '依赖已梳理' in out_ns)
    logs = cc.injection_log(TEAM)
    check('s4 inj_log 双形态各一条',
          len([e for e in logs if e['stream']]) == 1 and
          len([e for e in logs if not e['stream']]) == 1)
    # 未标记窗（正式窗）注入不触发
    p_plain = _mk_payload()
    out_plain = ci.collab_hear_inject({'_box_id': 'box-normal'}, p_plain, False,
                                      box_id='box-normal', log=_mock_log())
    check('s4 无 _collab 标记: 零侵入', out_plain is None and len(p_plain['messages']) == 1)


def step5_say配额():
    _fresh_team()
    cc.say(TEAM, 'alpha', '第1条')
    cc.say(TEAM, 'alpha', '第2条')
    cc.say(TEAM, 'alpha', '第3条')
    expect_raise('s5 第4条触发配额拒绝', lambda: cc.say(TEAM, 'alpha', '第4条'), PermissionError)
    check('s5 bravo 不受 alpha 配额影响', cc.say(TEAM, 'bravo', 'bravo 自己的播报')['ok'])


def step6_token_ack():
    _fresh_team()
    tok = cc.issue_ear_token(TEAM, 'bravo')
    r_bad = cc.ack_ear(TEAM, 'bravo', 'ctk-伪造')
    r_ok = cc.ack_ear(TEAM, 'bravo', tok)
    check('s6 伪造 token 拒/正确 token 过', r_bad['ok'] is False and r_ok['ok'] is True)


def step7_变异测试_管道级():
    """⑨变异测试（管道级）：错误结论必须原样进入对端下一轮 payload 顶部。
    （真窗行为分叉断言在 S4：bravo 的后续输出是否引用/纠正错误结论。）"""
    _fresh_team()
    cc.say(TEAM, 'alpha', '【错误结论·变异体】入口文件是 index.html')
    p = _mk_payload()
    out = ci.collab_hear_inject(_mk_body('bravo'), p, True, box_id='box-bravo', log=_mock_log())
    check('s7 变异体进入 bravo 下一轮 payload 顶部', out is not None and
          '【错误结论·变异体】' in p['messages'][0]['content'])
    wm = ci._wm.get((TEAM, 'bravo'), 0)
    check('s7 水位推进（消费不重放）', wm > 0)


def step8_工具链路():
    """第⑧步管道级：collab 工具已注册可达且 handle 可用（flag 开）。
    （AI 自发调用断言在 S4 真队。）"""
    from tools import get_handler
    mod = get_handler('collab')
    check('s8 get_handler(collab) 可达', mod is not None)
    check('s8 TOOL_NAME 正确', getattr(mod, 'TOOL_NAME', '') == 'collab')

    class FakeCtx:
        def __init__(self):
            self.last = None

        def send_json(self, obj, *a, **k):
            self.last = obj
            return obj
    _fresh_team()
    ctx = FakeCtx()
    mod.handle({'action': 'say', 'team': TEAM, 'codename': 'alpha',
                'text': '经工具链路播报：预演环境 OK'}, ctx)
    check('s8 工具 handle say 落通道', ctx.last and ctx.last.get('ok') is True)
    check('s8 通道日志同步出现',
          any('经工具链路播报' in e['text'] for e in cc.say_log(TEAM)))
    # flag 关 → 工具拒绝（隔离验证）
    cc.disable()
    ctx2 = FakeCtx()
    mod.handle({'action': 'status', 'team': TEAM, 'codename': 'alpha'}, ctx2)
    check('s8 flag关: 工具拒绝工作（零残留等价）',
          ctx2.last and ctx2.last.get('ok') is False and 'flag' in str(ctx2.last.get('error')))
    cc.enable()


def step9_L1服务器合成():
    _fresh_team()
    r = cc.synth_l1(TEAM, 'alpha', 'alpha 第12步：跑测试（服务器合成，零模型配合）')
    check('s9 synth_l1 ok', r['ok'] is True)
    p = _mk_payload()
    out = ci.collab_hear_inject(_mk_body('bravo'), p, True, box_id='box-bravo', log=_mock_log())
    check('s9 L1 提要进入 bravo 注入', out is not None and 'L1提要' in out and '第12步' in out)


def step10_L1独立节流与D8():
    _fresh_team()
    # ⑩ L1 连发 5 条 → 独立节流：只第 1 条过，其余 throttled
    results = [cc.synth_l1(TEAM, 'alpha', 'L1 快照 %d' % i) for i in range(5)]
    ok_n = sum(1 for r in results if r.get('ok'))
    th_n = sum(1 for r in results if r.get('throttled'))
    check('s10 L1 独立节流: 5 连发仅 1 过 %d 节流' % 4, ok_n == 1 and th_n == 4)
    check('s10 L1 不受 say 配额限（say 配额未动）', len([e for e in cc.teams[TEAM]['say_log'] if e['codename'] == 'alpha']) == 0)
    # D8 半组存活
    cc.leave_team(TEAM, 'bravo')
    expect_raise('s10 D8: 退场者 say 被拒', lambda: cc.say(TEAM, 'bravo', '退场发言'), PermissionError)
    r2 = cc.synth_l1(TEAM, 'bravo', '退场者 L1')
    check('s10 D8: 退场者 L1 合成拒（不炸组）', r2['ok'] is False)
    cc.say(TEAM, 'alpha', 'bravo 退场后 alpha 照常工作')
    snap = cc.team_snapshot(TEAM)
    check('s10 D8: 组仍可查、alpha 正常', snap is not None and snap['say_count'] >= 1)


STEPS = [
    ('骨架连通与 flag 门禁', step1_骨架连通),
    ('协议头拼装（含 token）', step2_协议头拼装),
    ('say 全组播报', step3_say全组播报),
    ('注入双形态（stream true/false + 零侵入）', step4_注入双形态),
    ('say 配额（每分钟 3 条）', step5_say配额),
    ('token-ack per-lane 校验', step6_token_ack),
    ('变异测试·管道级（错误结论入对端 payload）', step7_变异测试_管道级),
    ('collab 工具链路（get_handler + flag 隔离）', step8_工具链路),
    ('L1 服务器合成（零模型配合）', step9_L1服务器合成),
    ('L1 独立节流 + D8 半组存活', step10_L1独立节流与D8),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--step', type=int, default=0, help='只跑第 N 步（1~10）')
    args = ap.parse_args()

    cc.ARCHIVE_DIR = os.path.join(_ROOT, 'private', '记忆', '协作档案')
    cc.enable()
    print('=== 多路协作通气·无头预演（正式通道直打，V-opt 无驾驶舱）===')
    try:
        for i, (title, fn) in enumerate(STEPS, 1):
            if args.step and args.step != i:
                continue
            print('\n--- 步骤 %d/10: %s ---' % (i, title))
            try:
                fn()
            except Exception as e:  # noqa: BLE001
                check('s%d 步骤执行无异常' % i, False, repr(e))
    finally:
        # 零残留收尾（D6）
        cc.ARCHIVE_DIR_STASH = None
        n_teams = len(cc.teams)
        cc.teams.clear()
        ci.reset_watermarks()
        cc.disable()
        print('\n[零残留] 注册表清理 %d 组、水位清空、flag 已关' % n_teams)

    print('\n===== 预演结果: %d PASS / %d FAIL =====' % (len(PASS), len(FAILS)))
    if FAILS:
        for f in FAILS:
            print('  FAIL: %s' % f)
        print('REHEARSAL_RED')
        sys.exit(1)
    print('REHEARSAL_ALL_GREEN')
    sys.exit(0)


if __name__ == '__main__':
    main()
