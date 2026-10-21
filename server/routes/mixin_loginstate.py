# -*- coding: utf-8 -*-
"""Mixin: 登录态管理路由（跨工作台共享登录态 + IE缓存档案模式）
⚠️ 敏感链路：修改本文件前必读 private/记忆/约定-登录态系统改动需强审.md（保持蜂群强审+三项实测验收）
GET  /api/loginstate/list            凭据表列表（全部工作台）
GET  /api/loginstate/profiles        档案(zip)列表
GET  /api/loginstate/vault_list      密码库站点列表（供面板联动）
POST /api/loginstate/delete           {key}
POST /api/loginstate/restore          {key, session}  把该条恢复到指定工作台
POST /api/loginstate/profile_save     {name}
POST /api/loginstate/profile_restore  {name}
POST /api/loginstate/profile_delete   {name}
"""
import json


class MixinLoginState:
    def _handle_loginstate_get(self, path, parsed):
        sub = path.rsplit('/', 1)[-1]
        if sub == 'list':
            try:
                from browser_plugin.credentials import credentials_list
                self._send_json({'ok': True, 'items': credentials_list()})
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            return
        if sub == 'profiles':
            try:
                from browser_plugin.login_state import profile_list
                self._send_json({'ok': True, 'items': profile_list()})
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            return
        if sub == 'vault_list':
            try:
                import vault
                self._send_json({'ok': True, 'items': vault.list_items()})
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            return
        self._send_json({'ok': False, 'err': 'unknown loginstate get: %s' % path}, 404)

    def _handle_loginstate_post(self, body):
        action = body.get('action', '')
        try:
            if action == 'delete':
                from browser_plugin.credentials import credentials_delete
                self._send_json(credentials_delete(body.get('key', '')))
                return
            if action == 'restore':
                # 借用恢复：把历史登录态恢复到指定工作台（默认 default）
                from browser_plugin.browser_control_tools import _get_session_page
                from browser_plugin.credentials import credentials_restore
                session = body.get('session') or 'default'
                ctx, page = _get_session_page(session)
                self._send_json(credentials_restore(
                    ctx, page, session=session, from_key=body.get('key')))
                return
            if action == 'profile_save':
                from browser_plugin.login_state import profile_save
                self._send_json(profile_save(body.get('name') or 'default'))
                return
            if action == 'profile_restore':
                from browser_plugin.login_state import profile_restore
                self._send_json(profile_restore(body.get('name') or ''))
                return
            if action == 'profile_delete':
                from browser_plugin.login_state import profile_delete
                self._send_json(profile_delete(body.get('name') or ''))
                return
            self._send_json({'ok': False, 'err': 'unknown loginstate action'}, 400)
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 500)
