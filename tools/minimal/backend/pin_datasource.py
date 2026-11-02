# -*- coding: utf-8 -*-
"""pin_datasource - 数据中心：AI 一句话把外站数值钉成终身数据卡片。
复用 server/datasource_pins.py 抓取内核（登录态 Playwright + 快照自愈）。
字段白名单校验在内核 _validate 中完成；本工具只做参数透传与 op 分发。
"""
import sys, os

_SERVER_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                            '..', '..', '..', 'server'))
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)

import datasource_pins  # noqa: E402
from tools.coding.backend.base import ToolContext  # noqa: E402

TOOL_NAME = 'pin_datasource'


def handle(body, ctx):
    try:
        op = str(body.get('op') or 'list')
        project = str(body.get('project') or 'default')
        pin_id = body.get('id')

        if op == 'list':
            pins = datasource_pins.list_pins(project)
            ctx.send_json({'ok': True, 'op': op, 'project': project,
                           'count': len(pins), 'pins': pins})
        elif op == 'add':
            pin = datasource_pins.add_pin({
                'title': body.get('title'),
                'url': body.get('url'),
                'selector': body.get('selector'),
                'attr': body.get('attr') or 'text',
                'project': project,
            })
            ctx.send_json({'ok': True, 'op': op, 'pin': pin,
                           'hint': '已钉取。可再调 op=refresh 立即抓一次值。'})
        elif op == 'refresh':
            if not pin_id:
                return ctx.send_json({'ok': False, 'error': 'refresh 需要参数 id'})
            result = datasource_pins.refresh_pin(project, str(pin_id))
            ctx.send_json({'ok': True, 'op': op, 'result': result})
        elif op == 'delete':
            if not pin_id:
                return ctx.send_json({'ok': False, 'error': 'delete 需要参数 id'})
            datasource_pins.delete_pin(project, str(pin_id))
            ctx.send_json({'ok': True, 'op': op, 'id': pin_id})
        else:
            ctx.send_json({'ok': False,
                           'error': f'未知 op: {op}（可用 list/add/refresh/delete）'})
    except Exception as e:
        ctx.send_json({'ok': False, 'error': str(e)})
