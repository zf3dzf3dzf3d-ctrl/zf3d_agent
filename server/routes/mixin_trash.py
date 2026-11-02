#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Mixin: 删除缓冲垃圾箱 API（GET 列表 / POST 恢复·强制删除·清空）

路由：
  GET  /api/trash/list            垃圾箱条目列表
  POST /api/trash/op  action=restore     按 id 恢复到原路径
                      action=purge       按 id 强制彻底删除（真删）
                      action=purge_all   清空整个垃圾箱（真删）
                      action=cleanup     手动触发过期清理（30天策略）
"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinTrash(MixinBase):

    def _handle_trash_list(self, parsed):
        try:
            from trash import list_items, trash_path, TRASH_RETENTION_DAYS
            items = list_items(include_restored=False)
            # 补充前端展示字段
            now = int(time.time() * 1000)
            for it in items:
                it['days_left'] = max(0, (it.get('expires_at', now) - now) // 86400000)
            self._send_json({
                'ok': True,
                'items': items,
                'trash_dir': trash_path(),
                'retention_days': TRASH_RETENTION_DAYS,
            }, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_trash_op(self):
        try:
            body = self._read_body()
        except Exception:
            body = {}
        action = (body.get('action') or '').strip()
        try:
            import trash as trash_mod
            from trash import restore as trash_restore, purge as trash_purge, \
                auto_cleanup as trash_auto_cleanup, list_items, trash_path, TRASH_RETENTION_DAYS

            if action == 'restore':
                item_id = int(body.get('id') or 0)
                res = trash_restore(item_id)
                self._send_json({'ok': True, **res}, 200)
                return

            if action == 'purge':
                item_id = int(body.get('id') or 0)
                res = trash_purge(item_id)
                self._send_json({'ok': True, **res}, 200)
                return

            if action == 'purge_all':
                items = list_items(include_restored=False)
                n, errs = 0, []
                for it in items:
                    try:
                        trash_purge(it['id'])
                        n += 1
                    except Exception as e:
                        errs.append('id=%s: %s' % (it['id'], e))
                self._send_json({'ok': True, 'purged': n, 'errors': errs}, 200)
                return

            if action == 'cleanup':
                res = trash_auto_cleanup()
                self._send_json({'ok': True, **res}, 200)
                return

            self._send_json({'ok': False, 'error': '未知 action: ' + action}, 400)
        except KeyError as e:
            self._send_json({'ok': False, 'error': str(e)}, 404)
        except FileNotFoundError as e:
            self._send_json({'ok': False, 'error': str(e)}, 410)
        except ValueError as e:
            self._send_json({'ok': False, 'error': '参数错误: ' + str(e)}, 400)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)
