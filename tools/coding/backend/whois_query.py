#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""whois_query - 域名 WHOIS 注册信息查询（自有域名管理用）"""

import socket
import re

TOOL_NAME = 'whois_query'

# 常见 TLD 的 whois 服务器
_WHOIS_SERVERS = {
    'com': 'whois.verisign-grs.com', 'net': 'whois.verisign-grs.com',
    'org': 'whois.pir.org', 'cn': 'whois.cnnic.cn',
    'io': 'whois.nic.io', 'dev': 'whois.nic.google', 'app': 'whois.nic.google',
    'info': 'whois.afilias.net', 'me': 'whois.nic.me', 'cc': 'whois.nic.cc',
    'top': 'whois.nic.top', 'xyz': 'whois.nic.xyz', 'vip': 'whois.nic.vip',
}


def handle(body, ctx):
    domain = (body.get('domain') or '').strip().lower()
    if not domain or '/' in domain:
        ctx.send_json({'ok': False, 'error': 'domain required（如 example.com）'})
        return
    tld = domain.rsplit('.', 1)[-1]
    server = _WHOIS_SERVERS.get(tld) or 'whois.' + tld + '.nic'
    try:
        with socket.create_connection((server, 43), timeout=8) as s:
            s.sendall((domain + '\r\n').encode())
            chunks = []
            while True:
                d = s.recv(4096)
                if not d:
                    break
                chunks.append(d)
        text = b''.join(chunks).decode('utf-8', 'replace')
        # com/net 二级跳转
        if 'whois server:' in text.lower() and 'verisign' in server:
            m = re.search(r'whois server:\s*(\S+)', text, re.I)
            if m and m.group(1) != server:
                server2 = m.group(1)
                with socket.create_connection((server2, 43), timeout=8) as s:
                    s.sendall((domain + '\r\n').encode())
                    chunks = []
                    while True:
                        d = s.recv(4096)
                        if not d:
                            break
                        chunks.append(d)
                text = b''.join(chunks).decode('utf-8', 'replace')
        if not text.strip():
            ctx.send_json({'ok': False, 'error': 'WHOIS 服务器无返回，可能是未知 TLD: ' + tld})
            return
        # 提取关键字段
        keys = {}
        for line in text.splitlines():
            m = re.match(r'\s*([\w /%-]+?):\s*(.+)', line)
            if m:
                k = m.group(1).strip().lower()
                if k in ('registrar', 'registrar url', 'creation date', 'registry expiry date',
                         'domain name', 'name server', 'registrant organization',
                         'registrar abuse contact email', 'updated date', 'status',
                         'domain status', 'dnssec'):
                    keys.setdefault(k, []).append(m.group(2).strip())
        ctx.send_json({'ok': True, 'domain': domain, 'whois_server': server,
                       'summary': keys, 'raw': text[:3000]})
    except Exception as e:
        ctx.send_json({'ok': False, 'domain': domain, 'error': str(e)})
