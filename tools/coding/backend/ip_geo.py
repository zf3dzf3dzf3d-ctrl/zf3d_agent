#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ip_geo - IP 归属地查询（公网 IP 地理/ISP 信息，ip-api 免费接口）"""

import json
import urllib.request

TOOL_NAME = 'ip_geo'


def handle(body, ctx):
    ip = (body.get('ip') or '').strip()
    url = 'http://ip-api.com/json/' + (ip or '') + '?lang=zh-CN'
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'ip_geo/1.0'}), timeout=10) as resp:
            data = json.loads(resp.read(4096).decode('utf-8', 'replace'))
        if data.get('status') != 'success':
            ctx.send_json({'ok': False, 'error': data.get('message', '查询失败'), 'ip': ip})
            return
        ctx.send_json({'ok': True, 'query_ip': data.get('query'),
                       'country': data.get('country'), 'region': data.get('regionName'),
                       'city': data.get('city'), 'isp': data.get('isp'),
                       'org': data.get('org'), 'as': data.get('as'),
                       'lat': data.get('lat'), 'lon': data.get('lon'),
                       'timezone': data.get('timezone')})
    except Exception as e:
        ctx.send_json({'ok': False, 'ip': ip, 'error': str(e)})
