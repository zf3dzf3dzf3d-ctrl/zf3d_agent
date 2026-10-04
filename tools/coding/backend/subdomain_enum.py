#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""subdomain_enum - 子域名枚举（基于证书透明日志 crt.sh，公开数据，仅用于自有/授权资产盘点）"""

import json
import urllib.request

TOOL_NAME = 'subdomain_enum'

_UA = {'User-Agent': 'subdomain_enum/1.0'}


def handle(body, ctx):
    domain = (body.get('domain') or '').strip().lower()
    if not domain or '/' in domain:
        ctx.send_json({'ok': False, 'error': 'domain required (e.g. example.com)'})
        return
    url = 'https://crt.sh/?q=%25.' + domain + '&output=json'
    try:
        req = urllib.request.Request(url, headers=_UA)
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode('utf-8', 'ignore'))
    except Exception as e:
        ctx.send_json({'ok': False, 'domain': domain, 'error': 'crt.sh 查询失败: ' + str(e) + '（该站点偶发超载，可稍后重试）'})
        return
    subs = set()
    for item in data:
        for key in ('name_value', 'common_name'):
            v = (item.get(key) or '')
            for name in v.split('\n'):
                name = name.strip().lower().lstrip('*.')
                if name.endswith('.' + domain) and name != domain:
                    subs.add(name)
    ctx.send_json({'ok': True, 'domain': domain, 'count': len(subs),
                   'subdomains': sorted(subs)[:200],
                   'note': '数据来源：crt.sh 证书透明日志（历史签发记录，不代表当前全部存活）'})
