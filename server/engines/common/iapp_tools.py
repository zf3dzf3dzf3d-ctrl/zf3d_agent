# -*- coding: utf-8 -*-
"""iapp_tools: 把 /api/iapp/dispatch 暴露为 AI 可直接调用的工具 iapp_control（策划案 P1 可发现性载体）。

- iapp_control: 操作 i视频/i漫画/i图片/i音乐/i新闻 桌面应用的统一入口。
  GET 查询类直接传 app/op/params；POST 写操作（如漫画下载）的确认不取自模型参数：
  【2026-11-23 统一确认原语】confirmed 不再暴露给模型（模型自填 confirmed=true 属伪确认），
  写操作统一走 syscall 人工审批闸（工具名 `iapp:<app>.<op>`，dangerous，fail-closed）：
  未批准返回 need_confirm + 审批码推送（approve_hook.notify_pending，无 bot 配置静默降级），
  人工回复「同意 工具名 审批码」或本机 syscall.approve 后放行。
- description 即可发现性载体：极简模式新对话零上下文也能凭 description 找到此入口。
- 白名单真源在 server/routes/mixin_iapp.py _IAPP_ROUTES；本文件只封装调用，不复制业务。
- 写操作由 dispatch 层协议级闸门识别（缺 confirmed 返回 need_confirm 引导 JSON），
  本层把该 need_confirm 转接 syscall 人工闸。
- 临时兼容：环境变量 ZF_DEVICE_CONFIRM_LEGACY=1 时保留旧「模型自填 confirmed=true」
  行为（仅迁移期，计划移除）。
"""
import json
import os
import urllib.request
import urllib.parse

_SCHEMA = [
    {
        'type': 'function',
        'function': {
            'name': 'iapp_control',
            'description': (
                '操作朱峰智能体内置桌面应用的统一入口（i视频/i漫画/i图片/i音乐/i新闻）。'
                '用法：app=应用名(comics/ivideo/iimage/music/news)，op=操作名，params=查询参数对象。'
                '常用：comics.sources 列漫画源；comics.list{src} 列漫画；comics.chapters{id,src} 列章节；'
                'comics.pages{id,src,ch} 取页；comics.download_status 看下载进度；ivideo.search{wd} 搜影视；'
                'ivideo.detail{site,id} 看详情；iimage.search{wd,page} 搜图；music.search{kw} 搜歌；'
                'news.list 看新闻。写操作示例：comics.download_add 加下载队列，'
                '传 body={"mangaId":"...","chapterId":"...","pages":[1,2]} 即可——写操作无需也不接受'
                '任何确认参数，系统会走人工审批闸：若返回 need_confirm，把返回消息里的人工批准方式'
                '转告用户，待用户批准后重试同一调用即可自动放行。'
                '首次调用可不传 op，返回全部可用操作帮助。'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'app': {'type': 'string', 'description': '应用名: comics/ivideo/iimage/music/news'},
                    'op': {'type': 'string', 'description': '操作名，不传返回帮助'},
                    'params': {'type': 'object', 'description': '查询参数（GET），如 {"wd":"海贼王"}'},
                    'body': {'type': 'object', 'description': 'POST JSON body（写操作），支持数组字段'},
                },
                'required': ['app'],
            },
        },
    },
]


_SCHEMA.append({
    'type': 'function',
    'function': {
        'name': 'iapp_activity',
        'description': (
            '查询用户最近在用什么 iApp（感知层，只读）。'
            '返回最近活动列表：哪个App(i音乐/i视频/i漫画等)+动作(open/play/search)+标题+距今时间。'
            '当用户问「我刚才在干嘛」「继续看/听」或想主动推荐内容时，先调此工具感知上下文。'
            '参数 limit：返回条数，默认20。'
        ),
        'parameters': {
            'type': 'object',
            'properties': {
                'limit': {'type': 'integer', 'description': '返回最近N条，默认20，最大100'},
            },
        },
    },
})


_SCHEMA.append({
    'type': 'function',
    'function': {
        'name': 'iapp_open',
        'description': (
            '在用户屏幕上打开一个 iApp 桌面窗口（UI 级操控，写操作）。'
            'app 可选：music(i音乐)/tv(i视频)/manga(i漫画)/calc(计算器)/notes(记事本)/game(i游戏)/home(i家电)。'
            '典型场景：用户说「放首歌」「看个电影」「帮我开漫画」，先用 iapp_control 搜到内容（如 music.search），'
            '再调 iapp_open 打开对应窗口（前端会自动弹出）。这是屏幕级写操作，走 syscall 人工审批闸：'
            '若返回 need_confirm，把返回消息里的人工批准方式（手机回复「同意 工具名 审批码」或'
            '本机 syscall.approve）转告用户，待批准后重试同一调用即可自动放行。'
        ),
        'parameters': {
            'type': 'object',
            'properties': {
                'app': {'type': 'string', 'description': '应用名: music/tv/manga/calc/notes/game/home'},
            },
            'required': ['app'],
        },
    },
})


def get_schemas():
    return _SCHEMA


# ---------------- 统一确认原语（2026-11-23 收口模型自填伪确认） ----------------

def _legacy_confirm():
    """临时兼容：ZF_DEVICE_CONFIRM_LEGACY=1 时保留旧「模型自填 confirmed」语义。"""
    try:
        return os.environ.get('ZF_DEVICE_CONFIRM_LEGACY', '') == '1'
    except Exception:
        return False


def _sys_gate(tool):
    """syscall 人工审批闸：登记 dangerous + check_permission（fail-closed）。
    返回 (ok, reason)；闸不可用时也拒绝，不给伪确认留旁路。"""
    try:
        from engines.common.syscall import gate
        return gate(tool, 'common:iapp_tools', 'iApp 写操作(人工审批闸,dangerous)')
    except Exception as e:
        return False, 'SYSCALL_UNAVAILABLE: 人工审批闸不可用(%s)，fail-closed 拒绝' % e


def _push_pending(tool, reason):
    """审批推手机（无 bot 配置/任何失败静默降级，不影响 need_confirm 返回）。"""
    try:
        from bot_gateway.approve_hook import notify_pending
        notify_pending(tool, reason)
    except Exception:
        pass


def _how_to_approve(tool):
    """写进 need_confirm 返回消息的人工批准指引（bot 回复格式 / 本机 API）。"""
    return ('人工批准方式：已配置 IM 审批推送（data/bot_tokens.json 的 approve_push）时，'
            '审批码已推送到手机，回复「同意 %s <审批码>」（码见推送，10分钟内有效，批准后'
            '1小时内免重复确认）；未配置推送时，在服务器本机以 Python 调 '
            "engines.common.syscall.approve('%s') 完成批准，然后重试。" % (tool, tool))


def _need_confirm_payload(tool, base_error, reason):
    """构造 need_confirm 引导 JSON（含人工批准方式），审批码推送失败静默。"""
    _push_pending(tool, reason)
    return {'ok': False, 'need_confirm': True, 'tool': tool,
            'error': '%s 需人工审批后执行：%s（拦截原因: %s）'
                     % (tool, base_error, reason),
            'how_to_approve': _how_to_approve(tool)}


def execute(name, args, ctx):
    if name == 'iapp_open':
        try:
            port = os.environ.get('ZF_PORT') or '8620'
            try:
                from config import PORT as _port
                port = str(_port)
            except Exception:
                pass
            app = str((args or {}).get('app') or '')
            if _legacy_confirm():
                # 【临时兼容】旧语义：confirmed 取自模型参数（迁移期，计划移除）
                confirmed = bool((args or {}).get('confirmed'))
            else:
                # 【统一确认原语】开窗为屏幕级写操作：先过 syscall 人工闸（iapp:open:<app>），
                # 批准后才置 confirmed=true —— 绝不取自模型参数
                tool = 'iapp:open:%s' % (app or 'unknown')
                ok, reason = _sys_gate(tool)
                if not ok:
                    return False, json.dumps(_need_confirm_payload(
                        tool, '开窗会打扰用户屏幕', reason), ensure_ascii=False)
                confirmed = True
            body = json.dumps({'app': app,
                               'confirmed': bool(confirmed)},
                              ensure_ascii=False).encode('utf-8')
            req = urllib.request.Request('http://127.0.0.1:%s/api/iapp/cmd' % port, data=body,
                                         headers={'Content-Type': 'application/json'}, method='POST')
            with urllib.request.urlopen(req, timeout=10) as r:
                body = r.read().decode('utf-8', 'replace')
            try:
                return True, json.dumps(json.loads(body), ensure_ascii=False)
            except Exception:
                return True, body[:4000]
        except urllib.error.HTTPError as e:
            try:
                detail = e.read().decode('utf-8', 'replace')
            except Exception:
                detail = ''
            return False, 'iapp_open 被拒绝(HTTP %s): %s' % (e.code, detail[:500])
        except Exception as e:
            return False, 'iapp_open 失败: %s' % e
    if name == 'iapp_activity':
        try:
            port = os.environ.get('ZF_PORT') or '8620'
            try:
                from config import PORT as _port
                port = str(_port)
            except Exception:
                pass
            limit = int((args or {}).get('limit') or 20)
            url = 'http://127.0.0.1:%s/api/iapp/activity?limit=%d' % (port, limit)
            with urllib.request.urlopen(url, timeout=10) as r:
                body = r.read().decode('utf-8', 'replace')
            try:
                return True, json.dumps(json.loads(body), ensure_ascii=False)
            except Exception:
                return True, body[:4000]
        except Exception as e:
            return False, 'iapp_activity 失败: %s' % e
    if name != 'iapp_control':
        return False, 'unknown iapp tool: %s' % name
    try:
        port = os.environ.get('ZF_PORT') or '8620'
        try:
            from config import PORT as _port  # server 进程内直接取真源
            port = str(_port)
        except Exception:
            pass
        legacy = _legacy_confirm()
        qs = {'app': str(args.get('app') or '')}
        if args.get('op'):
            qs['op'] = str(args.get('op'))
        if legacy and args.get('confirmed'):
            # 【临时兼容】旧语义：confirmed 取自模型参数（迁移期，计划移除）
            qs['confirmed'] = 'true'
        for k, v in (args.get('params') or {}).items():
            qs[k] = str(v)

        def _dispatch(qs_):
            url = 'http://127.0.0.1:%s/api/iapp/dispatch?%s' % (port, urllib.parse.urlencode(qs_))
            data = None
            if args.get('body') is not None:
                data = json.dumps(args['body'], ensure_ascii=False).encode('utf-8')
            req = urllib.request.Request(url, data=data,
                                         headers={'Content-Type': 'application/json'},
                                         method='POST' if data is not None else 'GET')
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read().decode('utf-8', 'replace')

        body = _dispatch(qs)
        # 【统一确认原语】新语义下 confirmed 不取自模型参数：dispatch 协议闸返回
        # need_confirm 时转入 syscall 人工审批闸（工具名 iapp:<app>.<op>），
        # 人工批准后带 confirmed=true 重发一次；未批准返回 need_confirm + 审批码推送。
        try:
            resp = json.loads(body)
        except Exception:
            resp = None
        if not legacy and isinstance(resp, dict) and resp.get('need_confirm'):
            tool = 'iapp:%s.%s' % (str(args.get('app') or 'unknown'),
                                   str(args.get('op') or 'unknown'))
            ok, reason = _sys_gate(tool)
            if not ok:
                return True, json.dumps(_need_confirm_payload(
                    tool, str(resp.get('error') or '写操作'), reason), ensure_ascii=False)
            qs['confirmed'] = 'true'      # 人工闸放行后才置，绝不取自模型参数
            body = _dispatch(qs)
        try:
            return True, json.dumps(json.loads(body), ensure_ascii=False)
        except Exception:
            return True, body[:4000]
    except Exception as e:
        return False, 'iapp_control 失败: %s' % e
