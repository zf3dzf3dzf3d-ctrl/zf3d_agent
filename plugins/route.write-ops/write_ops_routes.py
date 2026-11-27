# -*- coding: utf-8 -*-
"""写/触发类端点的 POST 注册（2026-11-23 GET写操作迁POST 安全整改）。

背景：这些端点原先只注册了 GET——GET 写操作可被浏览器预取/<img>跨站触发
（无 Origin 头直穿 _check_origin），与历史免token缺陷叠加曾构成整站攻击面。
本轮将 GET 注册删除、逻辑原样迁到 POST；GET 侧在 domain_legacy_get.py 留有
迁移注释。前端调用方已同步改为 POST（app-backup/app-undo/app-zf3d/
chatbox-00/zf-app-escape）。

不含 /api/iapp/dispatch：其"GET 读 + POST 写(confirmed=true)"为文档化协议
（mixin_iapp.py usage 字段），AI 工具链 server/engines/common/iapp_tools.py
依赖 GET 读通道，保持不动。
"""
from routes.dispatcher import route_post
from urllib.parse import parse_qs


@route_post('/api/models/refresh')
def _h_api_models_refresh_post(self, path, parsed):
    """触发一次大模型配置与官网同步（原 GET 逻辑原样迁入）。"""
    try:
        import zf_model_sync
        r = zf_model_sync.sync()
        self._send_json(r)
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_post('/api/workspace/open-folder')
def _h_api_workspace_open_folder_post(self, path, parsed):
    self._handle_workspace_open_folder()
    return


@route_post('/api/backup/open-folder')
def _h_api_backup_open_folder_post(self, path, parsed):
    self._handle_backup_open_folder()
    return


@route_post('/api/tv/refresh')
def _h_api_tv_refresh_post(self, path, parsed):
    self._handle_tv_refresh()
    return


@route_post('/api/escape/new')
def _h_api_escape_new_post(self, path, parsed):
    """开新局：difficulty 走 JSON body，query 参数兼容保留（body 优先）。"""
    try:
        body = self._read_body() or {}
    except Exception:
        body = {}
    qs = parse_qs(parsed.query)
    if isinstance(body, dict):
        for k, v in body.items():
            qs[k] = [str(v)]
    self._handle_escape_new(qs)
    return
