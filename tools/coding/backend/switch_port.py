#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""switch_port - 切换服务端口"""
import os
import json
import subprocess
import sys
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'switch_port'


def handle(body, ctx):
    status_only = body.get('status', False)

    try:
        from config import PORT_JSON_PATH, LEGACY_PORT_PATH, PORT, WS_PORT, HOST
    except Exception:
        PORT_JSON_PATH = os.path.join(ctx.base_dir, 'private', 'port.json')
        LEGACY_PORT_PATH = os.path.join(ctx.base_dir, 'private', 'port.txt')
        PORT = 8500
        WS_PORT = 8502
        HOST = '0.0.0.0'

    if status_only:
        ctx.send_json({
            'ok': True,
            'current_port': PORT,
            'ws_port': WS_PORT,
            'host': HOST,
            'port_json': PORT_JSON_PATH
        })
        return

    new_port = body.get('port')
    if not new_port:
        ctx.send_json({'ok': False, 'error': '缺少 port 参数'})
        return

    try:
        new_port = int(new_port)
    except (TypeError, ValueError):
        ctx.send_json({'ok': False, 'error': 'port 必须是整数'})
        return

    if new_port < 1024 or new_port > 65535:
        ctx.send_json({'ok': False, 'error': '端口必须在 1024-65535 范围内'})
        return

    new_ws_port = new_port + 1

    port_data = {'api_port': new_port, 'ws_port': new_ws_port, 'host': HOST}
    try:
        with open(PORT_JSON_PATH, 'w', encoding='utf-8') as f:
            json.dump(port_data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        ctx.send_json({'ok': False, 'error': '写入 port.json 失败: ' + str(e)})
        return

    try:
        with open(LEGACY_PORT_PATH, 'w', encoding='utf-8') as f:
            f.write(str(new_port))
    except Exception:
        pass

    do_start = body.get('start', True)
    open_browser = body.get('open_browser', False)

    start_msg = ''
    if do_start:
        try:
            server_py = os.path.join(ctx.base_dir, 'server', 'server.py')
            subprocess.Popen(
                [sys.executable, server_py],
                cwd=os.path.join(ctx.base_dir, 'server'),
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if hasattr(subprocess, 'CREATE_NEW_PROCESS_GROUP') else 0,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            start_msg = '新服务已启动'

            if open_browser:
                import webbrowser
                webbrowser.open('http://127.0.0.1:%d' % new_port)
        except Exception as e:
            start_msg = '新服务启动失败: ' + str(e)

    ctx.send_json({
        'ok': True,
        'old_port': PORT,
        'new_port': new_port,
        'ws_port': new_ws_port,
        'message': '端口已从 %d 切换到 %d%s' % (PORT, new_port, ('，' + start_msg) if start_msg else '')
    })
