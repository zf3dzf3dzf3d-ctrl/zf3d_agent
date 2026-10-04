#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dns_query - 域名 DNS 解析查询"""

import socket

TOOL_NAME = 'dns_query'


def handle(body, ctx):
    domain = (body.get('domain') or '').strip()
    rtype = (body.get('type') or 'A').upper()
    if not domain:
        ctx.send_json({'ok': False, 'error': 'domain required'})
        return
    try:
        if rtype in ('A', 'AAAA'):
            family = socket.AF_INET6 if rtype == 'AAAA' else socket.AF_INET
            infos = socket.getaddrinfo(domain, None, family)
            addrs = sorted({i[4][0] for i in infos})
            ctx.send_json({'ok': True, 'domain': domain, 'type': rtype, 'records': addrs})
        elif rtype == 'CNAME':
            try:
                infos = socket.getaddrinfo(domain, None, 0, socket.SOCK_STREAM, 0, socket.AI_CANONNAME)
                records = sorted({i[3] for i in infos if i[3]})
            except Exception:
                records = []
            ctx.send_json({'ok': True, 'domain': domain, 'type': 'CNAME', 'records': records})
        elif rtype == 'MX':
            import subprocess, os
            cmd = ['nslookup', '-type=mx', domain]
            if os.name != 'nt':
                cmd = ['nslookup', '-type=mx', domain]
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            ctx.send_json({'ok': True, 'domain': domain, 'type': 'MX', 'output': (r.stdout or r.stderr)[-2000:]})
        elif rtype in ('TXT', 'NS'):
            r = subprocess.run(['nslookup', '-type=' + rtype.lower(), domain],
                               capture_output=True, text=True, timeout=15)
            ctx.send_json({'ok': True, 'domain': domain, 'type': rtype, 'output': (r.stdout or r.stderr)[-2000:]})
        else:
            ctx.send_json({'ok': False, 'error': 'unsupported type: ' + rtype + ' (use A/AAAA/CNAME/MX/TXT/NS)'})
    except Exception as e:
        ctx.send_json({'ok': False, 'error': str(e)})
