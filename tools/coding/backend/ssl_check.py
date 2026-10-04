#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ssl_check - HTTPS 证书信息：颁发者/有效期/剩余天数（监控自有域名证书过期）"""

import socket
import ssl
import datetime

TOOL_NAME = 'ssl_check'


def handle(body, ctx):
    host = (body.get('host') or '').strip().replace('https://', '').replace('http://', '').rstrip('/')
    if not host:
        ctx.send_json({'ok': False, 'error': 'host required'})
        return
    try:
        port = int(body.get('port') or 443)
    except Exception:
        port = 443
    try:
        cctx = ssl.create_default_context()
        with socket.create_connection((host, port), timeout=10) as sock:
            with cctx.wrap_socket(sock, server_hostname=host) as ssock:
                cert = ssock.getpeercert()
        not_after = cert.get('notAfter')
        expire = datetime.datetime.strptime(not_after, '%b %d %H:%M:%S %Y %Z') if not_after else None
        days_left = (expire - datetime.datetime.utcnow()).days if expire else None
        ctx.send_json({'ok': True, 'host': host, 'issuer': dict(x[0] for x in cert.get('issuer', ())),
                       'subject': dict(x[0] for x in cert.get('subject', ())),
                       'not_before': cert.get('notBefore'), 'not_after': not_after,
                       'days_left': days_left})
    except ssl.SSLCertVerificationError as e:
        ctx.send_json({'ok': False, 'host': host, 'error': '证书校验失败: ' + str(e)})
    except Exception as e:
        ctx.send_json({'ok': False, 'host': host, 'error': str(e)})
