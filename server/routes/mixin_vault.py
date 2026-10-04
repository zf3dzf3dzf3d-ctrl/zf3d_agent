# -*- coding: utf-8 -*-
"""Mixin: 密码库（/api/vault/*）—— 网站账号密码加密存储，AI 自动登录取号。"""
import json

import vault


class MixinVault:
    # ===== GET /api/vault/list | /api/vault/get?site=&username= =====
    def _handle_vault_get(self, path, parsed):
        from urllib.parse import parse_qs
        if path == '/api/vault/list':
            try:
                self._send_json({'ok': True, 'items': vault.list_items(),
                                 'encrypted': vault.has_cryptography()})
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            return
        if path == '/api/vault/get':
            qs = parse_qs(parsed.query or '')
            r = vault.get_item((qs.get('site') or [''])[0],
                               (qs.get('username') or [''])[0] or None)
            self._send_json(r, 200 if r.get('ok') else 404)
            return
        self._send_json({'ok': False, 'err': 'unknown vault path'}, 404)

    # ===== POST /api/vault/save | /api/vault/delete =====
    def _handle_vault_post(self, body):
        try:
            data = body if isinstance(body, dict) else json.loads(body or b'{}')
        except Exception:
            data = {}
        action = data.get('action')
        if action == 'save':
            r = vault.save_item(data.get('site'), data.get('username'),
                                data.get('password'), data.get('note', ''))
            self._send_json(r, 200 if r.get('ok') else 400)
            return
        if action == 'delete':
            r = vault.delete_item(data.get('site'), data.get('username'))
            self._send_json(r)
            return
        self._send_json({'ok': False, 'err': 'unknown vault action'}, 400)
