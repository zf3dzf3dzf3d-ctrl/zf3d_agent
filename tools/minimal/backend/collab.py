#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
collab - 协作通气工具（v3.2 三 action + v4.1 父子收口：done / collect）

隔离方案（v3.2 裁决）：预演期临时注册与正式版同表同文件（tools/__init__.py
扫描本目录自动注册，get_handler 重扫免重启生效）；隔离靠 server/collab_channel.py
的 feature flag——flag 关闭时本工具 handle 一律拒绝工作（ok=false），
等价"注册表零残留"。转正后由前端 categories.js 启用数组收编 + flag 常开。

consumes: server/collab_channel.py（纯旁挂，标准库 only）
"""
import json  # v6.3 下线唤醒：_wake_member 投 monitor_queue 的 data 序列化
import os
import sys
import time  # v6.3 下线唤醒：_wake_member L127 时间戳（缺它 NameError: name 'time' is not defined——alpha 2026-11-25 实测发现，bravo 修）

# server/ 与 plugins/route.collab 都不在默认 sys.path（工具后端跑在项目根包里），手动补
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))))
for _p in (os.path.join(_ROOT, 'server'),
           os.path.join(_ROOT, 'plugins', 'route.collab')):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import collab_channel as cc  # noqa: E402


def _fresh_cc():
    """【v4.7 热同步】collab_channel.py 源文件 mtime 变了就自动 reload——
    免「工具层热生效、通道层缓存旧版」的不对称（charlie 2026-11-24 wakeup 实测发现：
    collab.py 新分支已生效而 cc.wakeup 报 no attribute，根因即本模块缓存）。
    【bravo 修 2026-11-24】unbound 局部坑真修：旧写法 `cc = importlib.reload(cc)` 让函数内
    出现对 cc 的赋值 → cc 被编译为局部变量 → mtime 未变不走 reload 分支时 return cc
    直接 UnboundLocalError（首次调用能过、第二次起全组协作工具瘫痪）。
    改用 global 声明 + reload 原地生效不接收返回值（importlib.reload 本就地更新模块）。"""
    global cc
    try:
        p = os.path.join(_ROOT, 'plugins', 'route.collab', 'collab_channel.py')
        m = os.path.getmtime(p)
        if m != getattr(_fresh_cc, '_m', 0):
            import importlib
            importlib.reload(cc)
            _fresh_cc._m = m
    except Exception:
        pass
    return cc


TOOL_NAME = 'collab'

TOOL_SCHEMA = {
    'name': 'collab',
    'description': ('多路协作报话（旧称通气；👥协作师小组专用：组内多个 AI 窗互相播报进展、互不同步卡死）。'
                    '只有当你被派出为「协作师」成员时才可用——此时你的对话协议头里写了 team（组名）和 codename（本窗代号），'
                    '普通单窗对话没有小组上下文，调用无意义。十七个 action（多出 collect=拉全组done账本汇总；ack_ear=耳令牌per-lane回执；'
                    'wakeup=组停未完成时唤醒重组继续干到完成/组被清档时带 peers+task 自救重建；note=笔·全组便签；peek=眼·轻量瞄全组一眼；'
                    'duties=查本人未清义务（未回应插话/待审/待收口，任意时刻可查）；standby=收口后登记待命不脱网（同伴 inject 经 monitor 拉回场）；'
                    '【v8.0 AI 自主建组】create=任意对话内直接建组（见下）；'
                    '【v7.0 动态入组·用户令「随时可加新协作师/沟通无处不在」】groups=列出全部活组（AGI 种子自主发现协作现场），'
                    'join=随时加入活组（自动发耳令牌+全组广播入组通告；任何人/任意窗可用，不必等父对话派出）：'
                    'collab(action=groups) → collab(action=join, team=组id, codename=新代号) 两步入伙；'
                    '【v8.0 AI 自主建组·用户令「多个协作小组共同开工」】create=任意对话内直接建组（task 必填，size=1~8 可选，'
                    '返回协议头后同伴 join 入伙），父对话派组(dispatch)之外的正门；'
                    '【v8.1 历史可读】history=读协作档案（往来长期落盘 private/记忆/协作档案/<team_id>/transcript.md，'
                    '组清档/重启后仍在）：team 空=列出全部有档案的组（新协作师上手第一入口），'
                    'team=组id=读该组往来尾部 limit 行（默认80，范围10~400）；'
                    'say=报话播报（≤2000字，只播结论不提问；每轮至多1条，每分钟至多6条）——'
                    'to=代号可定向单人；need_ack=false 为通知类不要求对方回执（默认 true 需回执）；'
                    'msg_type=消息类型（progress进度/review审核/question提问/error错误），'
                    'severity=级别（normal普通/warning警告/error错误），错误与审核结论会被显著标记方便同伴排错；'
                    '② ack=收到回执（要点复诵；标【需回执】的 say 和定向插话必须回，插话带 ref）；'
                    '③ inject=定向插话（配合 to，强制唤醒对方并等真实回馈）；'
                    '④ review=互审核（配合 target=被审同伴代号、verdict=pass/fail、fail 必附原因 text、可选 score=0~100 分低分自动提醒被审人）——'
                    '交付前同伴必须互审通过（插话令）；'
                    '⑤ done=完成上报：干完活（且同伴审过）后调用，text 写清「做到了什么+产物在哪」；'
                    '⑥ set_ear=调整旁听挡位（0 关耳/1 提要默认）；'
                    '⑦ status=查看小组现状（成员/挡位/回执实况/互审状态）。'
                    '纪律：say 只写「我做到了什么/我要转向什么」，让同伴无需读你全文就能接上进度；'
                    'team/codename 必须原样抄自协议头，不要自己编造。'),
    'parameters': {
        'type': 'object',
        'properties': {
            'action': {'type': 'string', 'enum': ['say', 'ack', 'inject', 'review', 'done', 'set_ear', 'status', 'collect', 'ack_ear', 'wakeup', 'note', 'peek', 'groups', 'join', 'duties', 'standby', 'create', 'history'],
                       'description': 'say=报话播报；ack=收到回执；inject=定向插话（配合 to）；review=互审核（配合 target+verdict）；done=完成上报（须同伴审过）；set_ear=调整旁听挡位（配合 level）；status=查看小组现状；collect=拉全组done账本汇总（收口用）；ack_ear=耳令牌per-lane回执；wakeup=团队被停但活没干完时成员唤醒重组继续干到完成（用户令 2026-11-24）；组档案被父对话清档时可带 peers+task 自救重建原组、脱离父对话互唤（v6.2 用户令「子对话可以互相随时唤醒,不需要父亲」）；note=笔·记一笔进全组便签让其他人顺便看到（hear 自动注入+status 可查）；peek=眼·轻量看全组状态一眼（成员状态行+便签+未回应插话数，动笔前先瞄一眼）；groups=列出全部活组（AGI 种子自主发现协作现场的第一入口，team/codename 可空）；join=随时加入活组/自主扩员/身份重建（自动签发耳令牌+全组广播入组通告）——五件套：耳听hear/嘴说say/眼看peek/笔记note/口哨wakeup+双器官groups/join'},
            'team': {'type': 'string', 'description': '组 id——原样抄自你对话开头的协作协议头（如 collab_1795487345210_df3d），不要自己编造；groups 动作可空'},
            'codename': {'type': 'string', 'description': '本窗在组内的代号——原样抄自协议头（北约音标八字池 alpha/bravo/charlie/delta/echo/foxtrot/golf/hotel 之一，v8.0 扩容），身份标识，填错等于替别人发言；groups 动作可空；create 动作可指定创建者代号'},
            'text': {'type': 'string', 'description': 'say 的内容：结论/转向提要（≤2000字，不提问）。例：「bravo 已完成登录接口改造，conftest 夹具在 tests/conftest.py L45，charlie 前端联调可直接用」'},
            'to': {'type': 'string', 'description': '定向同伴代号（say/inject/note 用）：say(to=bravo)=只有 bravo 听到；inject(to=bravo)=插话进 bravo 对话并强制唤醒；note(to=bravo)=定向留条，只有 bravo 会在 hear 旁听里看到'},
            'need_ack': {'type': 'boolean', 'description': 'say 是否需要同伴回执（默认 true）：false=通知类播报，对方收到即送达记录、不必回「收到」，防乒乓'},
            'msg_type': {'type': 'string', 'enum': ['progress', 'review', 'question', 'error'],
                         'description': 'say 消息类型（默认 progress）：progress=进度；review=审核结论；question=提问求助；error=错误报告——同伴按类过滤排错'},
            'severity': {'type': 'string', 'enum': ['normal', 'warning', 'error'],
                         'description': 'say 级别（默认 normal）：warning=警告；error=错误（注入带【错误】标记，同伴一眼定位谁出了问题）'},
            'ref': {'type': 'string', 'description': 'ack 的引用目标：收到定向插话时原样回传插话里的 ref（如 inj-bravo-3）；普通 say 回执可省略'},
            'peers': {'type': 'array', 'items': {'type': 'string'}, 'description': '（wakeup 自救重建用）同伴代号清单，如 ["alpha","charlie"]，不含自己——组档案被父对话清档后，带此参数+task 可脱离父对话按原组 id 重建组继续互唤'},
            'task': {'type': 'string', 'description': '（wakeup 自救重建用）任务简述——重建组时登记任务目标，同伴 hear 恢复后知道继续干什么'},
            'target': {'type': 'string', 'description': 'review 的被审同伴代号（alpha/bravo/charlie/delta 之一）'},
            'verdict': {'type': 'string', 'enum': ['pass', 'fail'],
                        'description': 'review 结论：pass=通过（放行 TA 交付）；fail=打回（必须附 text 原因）'},
            'score': {'type': 'integer',
                      'description': '（review 用，可选）0~100 评分：让被审人心里有数；分数落往来流/被审人耳流/档案，<80 分被审人自动收「请自查改进」提醒；不带=不评分'},
            'level': {'type': 'integer', 'description': 'set_ear 的目标挡位：0=关耳（不再收组内消息）；1=提要（默认，只收 say 摘要）'},
            'token': {'type': 'string', 'description': 'ack_ear 用：协议头「耳令牌」原样回传（per-lane 回执校验，勿修改）'},
            'note': {'type': 'string', 'description': '（join 入组留言用）≤120字，随入组通告全组广播，可空；全组便签另用 action=note 配 text'},
            'size': {'type': 'integer', 'description': '（create 建组用）组规模 1~8，默认 3——除创建者外其余为空槽，同伴随时 collab(action=join, team=组id, codename=新代号) 入伙'},
            'limit': {'type': 'integer', 'description': '（history 用）读档案尾部行数，默认 80，范围 10~400'},
        },
        'required': ['action'],
        # v4.7 枚举提示（描述头部同步，防 schema 与实现漂移；v7.0 alpha 2026-11-24 对齐 14 动作全集）
        '_actions_doc': 'say/ack/inject/review/done/set_ear/status/collect/ack_ear/wakeup/note/peek/groups/join/duties/standby/create/history（wakeup=团队被停但活没干完时成员唤醒重组继续干到完成；note=笔·全组便签；peek=眼·轻量看全组一眼；groups=列出全部活组（失忆自查入口，team/codename 可空）；join=随时加入活组/扩员/身份重建；duties=查本人未清义务；standby=收口后登记待命；create=任意对话内直接建组【v8.0】；history=读组往来档案/列全部档案组【v8.1】；review 可带 score=0~100 评分【v8.2：分数进往来流+被审人耳流，<80 自动附自查提醒】——五件套耳说看记哨+双器官groups/join+义务/待命/建组三扩展',
    },
}


def _wake_member(ctx, team, from_codename, to_codename, task_text=''):
    """【下线唤醒 v6.3】向目标成员对话窗投 monitor_queue 唤醒消息（复用员工定时器投窗链路：
    INSERT app_data(category='monitor_queue', key=chat_id)，前端轮询消费后把消息发进对话触发新一轮）。
    chat_id 来自名册（协作窗每次请求经 collab_inject 钩子自动报到绑定 / 派组时登记）；
    找不到时给人话指引。ctx 为工具运行时（db_lock/get_db 同 monitor.py 用法）。
    返回 {'ok', 'to', 'chat_id', 'queued'}"""
    snap = cc.team_snapshot(team)
    if not snap:
        raise KeyError('team 不存在: %s' % team)
    members = snap.get('members') or {}
    tm = members.get(to_codename)
    if not tm:
        raise KeyError('成员不存在: %s（组内成员：%s）'
                       % (to_codename, '、'.join(members.keys()) or '空'))
    chat_id = str(tm.get('chat_id') or '').strip()
    if not chat_id:
        raise ValueError(
            '成员 %s 的对话窗 id 未知（名册 chat_id 空槽）——他上线过一次后会自动报到绑定；'
            '此刻可让父对话或他本人发一次 collab 请求即完成绑定' % to_codename)
    msg = ('【协作唤醒·%s→%s】组 %s 同伴唤醒你上线。%s '
           '（你下线期间有挂起的协作消息：对话恢复后协作耳会自动注入，请先 collab(status) 查看）'
           % (from_codename, to_codename, team,
              str(task_text or '').strip()[:300]))
    now = int(time.time() * 1000)
    data = json.dumps({'chat_id': chat_id, 'message': msg,
                       'timestamp': now, 'status': 'pending'}, ensure_ascii=False)
    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            cur = conn.cursor()
            cur.execute(
                'INSERT INTO app_data (category, key, value, created_at, updated_at) '
                'VALUES (?, ?, ?, ?, ?)',
                # 【v7.5 key 升级】collab_wake_(team)_(codename)_(ts)：team/codename 编进 key，
                # 前端/服务端无需解析消息正文即可识别「该拉起谁」——目标窗被关闭时自动重建协作窗
                # （用户令 2026-11-25「尽可能不要让系统停止一个对话，长期留存」）。旧短 key 不再产出。
                ('monitor_queue', 'collab_wake_%s_%s_%d' % (team, to_codename, now), data, now, now))
            conn.commit()
        finally:
            conn.close()
    return {'ok': True, 'to': to_codename, 'chat_id': chat_id, 'queued': True,
            'hint': '唤醒消息已入队；若目标对话窗当前已关闭，前端常驻值守会按此身份自动重建协作窗并注入本消息拉活（v7.5）'}


def handle(body, ctx):
    """flag 门禁首行：关闭即拒绝（隔离承诺 v3.2 #4）。
    例外：wakeup（v4.7 团队唤醒）——flag 关但组未完成时成员可重启通道，在分支内单独处理。"""
    try:
        cc = _fresh_cc()  # v4.7 热同步：源文件变了自动 reload（unbound 局部坑已修：统一在 try 首行赋值）
        action = str(body.get('action') or '').strip().lower()
        team = str(body.get('team') or '').strip()
        codename = str(body.get('codename') or '').strip().lower()

        if action == 'wakeup':
            # 【用户令 2026-11-24】团队停了没干完活，允许成员唤醒他直到完成任务：
            # 校验组存在/是成员/有未 done 者由通道层拒绝并给人话；合法则重开 flag。
            # 【v6.2 子对话互唤·用户令「子对话可以互相随时唤醒,不需要父亲」】
            # 组档案被父对话清档时，成员可带 peers=同伴代号清单+task=任务简述 自救重建原组：
            # hear 注入只认 _collab_team/_collab_codename 标记不查父对话，重建即恢复互唤。
            # 【v6.3 下线唤醒·用户令「下线可被同伴唤醒」】新增 to=成员代号：只拉活该成员的
            # 对话窗（向其 monitor_queue 投唤醒消息），不动组 flag，也不要求自己是成员。
            to_target = str(body.get('to') or '').strip().lower()
            if to_target:
                try:
                    r = _wake_member(ctx, team, codename, to_target,
                                     str(body.get('task') or ''))
                except (PermissionError, KeyError, ValueError) as e:
                    return ctx.send_json({'ok': False, 'error': str(e)})
                return ctx.send_json({'ok': True, 'action': 'wakeup', 'mode': 'wake_chat', **r})
            try:
                peers = body.get('peers') or []
                if isinstance(peers, str):
                    peers = [p.strip() for p in peers.replace('，', ',').split(',') if p.strip()]
                r = _fresh_cc().wakeup(team, codename,
                                       peers=list(peers) if isinstance(peers, (list, tuple)) else [],
                                       task=str(body.get('task') or '').strip() or None)
                return ctx.send_json({'ok': True, 'action': 'wakeup', **r})
            except PermissionError as e:
                return ctx.send_json({'ok': False, 'error': str(e)})
            except (KeyError, ValueError) as e:
                return ctx.send_json({'ok': False, 'error': str(e)})

        # 【v4.8 笔·note】用户令 2026-11-24「笔记，让其他人顺便看到」：公共便签一条龙——
        # 写进组级 note_log 全组可见（status/collect 带出），口令：动笔前先看眼 status。
        if action == 'note':
            text = str(body.get('text') or '').strip()
            if not text:
                return ctx.send_json({'ok': False, 'error': 'note 需要 text（要记的内容）'})
            try:
                r = cc.note(team, codename, text,
                            to=str(body.get('to') or '').strip() or None)
                return ctx.send_json({'ok': True, 'action': 'note', **r})
            except (KeyError, ValueError) as e:
                return ctx.send_json({'ok': False, 'error': str(e)})

        # 【v8.0 建组正门·bravo 2026-11-25】AI/无头智能体从对话内直接建组（dispatch=前端派组，
        # create=对话内自建；同 wakeup/note 同级的闸门外例外——建组那一刻组还不存在，闸门无从谈起）。
        # task 必填（建组要让全组知道干什么）；team/codename 可空：team 空自动生成组 id，
        # codename 空默认 alpha。同 id+同代号幂等返回既有组协议头，不重建。
        if action == 'create':
            try:
                r = cc.create_team_tool(
                    task=str(body.get('task') or ''),
                    size=body.get('size') or 3,
                    team_id=str(body.get('team') or '').strip() or None,
                    codename=str(body.get('codename') or '').strip() or None,
                    note=str(body.get('note') or ''))
                return ctx.send_json({'ok': True, 'action': 'create', **r})
            except (KeyError, ValueError) as e:
                return ctx.send_json({'ok': False, 'error': str(e)})

        # 【v8.1 历史可读·bravo 2026-11-25】用户问「重启后新派三个协作师如何看到协作对话流，
        # 是长期的还是分组的」——诊断结论：往来长期归档于 private/记忆/协作档案/<team_id>/
        # transcript.md（append-only，组清档仍留存），但 collab 工具此前无读档入口，
        # 新协作师/换代 AI 永远查不到旧组历史。现开闸门外豁免分支（读史正是 flag 关、
        # 组清档后的主要用途，与 wakeup/note/create 同级豁免）：
        #   team 给了 → 读该组档案尾部（limit 行，默认 80，钳 10~400 防爆上下文）；
        #   team 空   → 列出全部档案组（谁有历史、是否还活着）——新协作师上手第一入口。
        if action == 'history':
            lim = body.get('limit')
            try:
                lim = int(lim) if lim is not None else 80
            except (TypeError, ValueError):
                lim = 80
            lim = max(10, min(lim, 400))
            if team:
                txt = cc.read_history(team, tail_lines=lim)
                if not txt:
                    return ctx.send_json({'ok': False,
                                          'error': '组 %s 无档案（team_id 拼错或该组从未产生往来）' % team})
                return ctx.send_json({'ok': True, 'action': 'history', 'team_id': team,
                                      'lines': txt.count('\n'), 'tail': txt,
                                      'archive_path': cc.archive_path(team)})
            return ctx.send_json({'ok': True, 'action': 'history', 'mode': 'list',
                                  'count': len(cc.list_archives()),
                                  'archives': cc.list_archives(),
                                  'tip': 'collab(action=history, team=组id, limit=行数) 读该组往来档案（默认尾部80行）'})

        cc = _fresh_cc()  # v4.7 热同步：源文件变了自动 reload，两层改动的对称生效
        if not cc.is_enabled():

            return ctx.send_json({'ok': False,
                                  'error': 'collab 未启用（feature flag 关闭）——协作通道未开工或已收尾；若团队还没干完活，成员可用 collab(action=wakeup, team=组id, codename=你的代号) 唤醒重组继续'})

        action = str(body.get('action') or '').strip().lower()
        team = str(body.get('team') or '').strip()
        codename = str(body.get('codename') or '').strip().lower()

        if action == 'say':
            text = str(body.get('text') or '').strip()
            # 分层报话（用户模型 2026-11-24）+ 两维分类（插话令）：
            # to=定向单人；need_ack=false 通知类不欠回执；msg_type/severity 助排错
            na = body.get('need_ack')
            need_ack = True if na is None else bool(na)
            r = cc.say(team, codename, text,
                       to=str(body.get('to') or '').strip() or None,
                       need_ack=need_ack,
                       msg_type=str(body.get('msg_type') or 'progress'),
                       severity=str(body.get('severity') or 'normal'))  # 配额/退场/超长/非法值由通道拒绝
            return ctx.send_json({'ok': True, 'action': 'say', **r})
        if action == 'ack':
            # 【报话ACK】收到回执：ref 缺省=最新待回执 say/插话；带复诵更佳
            r = cc.ack_say(team, codename, ref_seq=body.get('ref'),
                           text=str(body.get('text') or ''))
            return ctx.send_json({'ok': True, 'action': 'ack', **r})
        if action == 'inject':
            # 【定向插话】把话插进指定同伴对话并等真实回馈
            r = cc.inject(team, codename,
                          str(body.get('to') or '').strip().lower(),
                          str(body.get('text') or ''))
            # 【下线唤醒 v6.3·用户令「下线可被同伴唤醒」】目标退场时插话已挂起（通道层放行），
            # 这里顺手向其对话窗投一条 monitor_queue 消息拉人上线——复活后 hear 自动送达挂起的插话。
            if r.get('deferred'):
                try:
                    wk = _wake_member(ctx, team, codename, r['to'],
                                      str(body.get('text') or ''))
                    r['wake'] = wk
                except Exception as _we:
                    r['wake'] = {'ok': False, 'error': str(_we)}
            return ctx.send_json({'ok': True, 'action': 'inject', **r})
        if action == 'done':
            # 【互审交付门禁】完成上报：多人组须同伴全 review pass 才放行（单人组/全退场直通）
            r = cc.done(team, codename, str(body.get('text') or ''))
            return ctx.send_json({'ok': True, 'action': 'done', **r})
        if action == 'review':
            # 【互审】审同伴成果：verdict=pass 放行 TA 交付 / fail 打回（须附原因）；
            # score（v8.2 用户令）可选 0~100 分：落往来流+被审人耳流，<80 被审人自动收自查提醒
            r = cc.review(team, codename,
                          str(body.get('target') or '').strip().lower(),
                          str(body.get('verdict') or '').strip().lower(),
                          str(body.get('text') or ''),
                          body.get('score'))
            return ctx.send_json({'ok': True, 'action': 'review', **r})
        if action == 'collect':
            # 【M1 收口】父对话/收口箭头拉取全员结论汇总
            snap = cc.collect(team)
            return ctx.send_json({'ok': True, 'action': 'collect', **snap})
        if action == 'set_ear':
            # 【v4.6 修 falsy 陷阱】合法挡位 0（关耳）是 falsy，`level or 1` 会静默变 1——
            # 关耳功能实际失效（charlie 2026-11-24 实测实锤：set_ear(0) 返回 ear:1）。
            # 改显式判 None 缺省：body 带 level（含 0）按原值用，未带才默认 1。
            _lv = body.get('level')
            r = cc.set_ear(team, codename, int(1 if _lv is None else _lv))
            return ctx.send_json({'ok': True, 'action': 'set_ear', **r})
        if action == 'status':
            snap = cc.team_snapshot(team)
            if not snap:
                return ctx.send_json({'ok': False, 'error': 'team 不存在: %s' % team})
            return ctx.send_json({'ok': True, 'action': 'status', 'team': snap})
        if action == 'peek':
            # 【v4.9 眼·peek】轻量只读全组状态一眼看（成员状态行+便签+未回应插话数）；
            # 全景重查用 status——眼与全景分立，防 AI 一遇小事就拉全量大账本
            try:
                r = cc.peek(team)
                return ctx.send_json({'ok': True, 'action': 'peek', **r})
            except KeyError as e:
                return ctx.send_json({'ok': False, 'error': str(e)})
        if action == 'ack_ear':
            # per-lane 回执（v3.2 反驳师④）：协议头里的耳令牌原样回传，区分"正确消费"与"被抢置空"
            r = cc.ack_ear(team, codename, str(body.get('token') or ''))
            return ctx.send_json({'ok': r.get('ok') is True, 'action': 'ack_ear', **r})
        if action == 'groups':
            # 【v7.0 动态入组·用户令「随时可以加新的协作师」】列出全部活组：AGI 种子/任意窗
            # 发现协作现场的第一入口——先 groups 找到组 id，再 join(team, 新代号) 入伙
            try:
                return ctx.send_json({'ok': True, 'action': 'groups',
                                      'groups': cc.list_groups(),
                                      'tip': '挑一个未完成组 → collab(action=join, team=组id, codename=新代号) 即刻入伙'})
            except (PermissionError, KeyError, ValueError) as e:
                return ctx.send_json({'ok': False, 'error': str(e)})
        if action == 'join':
            # 【v7.0 动态入组】新成员随时加入活组：自动发耳令牌+全组广播入组通告。
            # group 门禁前置豁免——组在但 flag 关（全员 done 已收尾）时：先复活动组再入。
            try:
                if not cc.is_enabled():
                    cc.enable()  # join 视为明确的协作意图：复活通道（对齐 wakeup 复活语义）
                r = cc.join_team(team, codename, note=str(body.get('note') or ''),
                                 rejoin_token=str(body.get('token') or ''))
                return ctx.send_json({'ok': True, 'action': 'join', **r})
            except (PermissionError, KeyError, ValueError) as e:
                return ctx.send_json({'ok': False, 'error': str(e)})

        if action == 'duties':
            # 【v7.2.1 bravo】义务清单独立只读入口（免重启·工具层直达通道层 get_duties）：
            # 不必等 standby 才看义务——任意时刻可查「我有哪些未清义务」（未回应插话/待命提醒）
            try:
                duties = cc.get_duties(team, codename)
                return ctx.send_json({'ok': True, 'action': 'duties',
                                      'team_id': team, 'codename': codename, 'duties': duties})
            except (PermissionError, KeyError, ValueError) as e:
                return ctx.send_json({'ok': False, 'error': str(e)})

        if action == 'standby':
            # 【v7.1 待命不脱网·用户令「做完了也不能停止」「否则就真的停止很麻烦」】
            # done 后登记待命：done 保留、通道保持，同伴 say/插话照常 hear；
            # 同伴 inject 未回绑窗时挂起并投 monitor 队列 → 前端拉本窗回场处理。
            # 返回组内未清义务清单（有插话义务应先 ack 再待命）。
            try:
                r = cc.standby_report(team, codename)
                return ctx.send_json({'ok': True, 'action': 'standby', **r})
            except (PermissionError, KeyError, ValueError) as e:
                return ctx.send_json({'ok': False, 'error': str(e)})

        return ctx.send_json({'ok': False,
                              'error': ('不支持的 action: %s（可用 say/ack/inject/review/done/collect/set_ear/status/peek/note/ack_ear/wakeup/groups/join/duties/standby/create）'
                                        '【感官进化提示 bravo 2026-11-24】若此 action 在你对话开头的工具定义快照里不存在但上面清单里有，'
                                        '说明通道在你对话开始后长出了新器官（工具热更新不回写历史对话的 schema 快照）——'
                                        '分发层按字符串路由不做枚举校验，直接重试本 action 即可，不必退回旧动作空转') % (action or '空')})
    except PermissionError as e:
        return ctx.send_json({'ok': False, 'error': str(e)})
    except (KeyError, ValueError) as e:
        return ctx.send_json({'ok': False, 'error': str(e)})
    except (PermissionError, KeyError, ValueError, TypeError) as e:
        # 失败模式枚举同 collab 通道（flag/校验/脏字段类型）；此外的异常交给宿主顶层
        return ctx.send_json({'ok': False, 'error': 'collab 内部错误: %s' % e})
