# -*- coding: utf-8 -*-
"""mixin_share.py — 共享空间路由（/api/share/*），对接 zf_share.py 与 zf3d.com api_share.asp"""
from routes._shared import *
from routes.mixin_base import MixinBase
import logging

try:
    import zf_share
except Exception:
    zf_share = None
    logging.warning('[mixin_share] zf_share.py 加载失败')


class ShareRoutesMixin(MixinBase):
    """朱峰社区共享空间：项目上传/列表/下载/网址索引。"""

    def _read_json_body(self):
        """读取 JSON 请求体（基类无此方法时的安全实现）"""
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except Exception:
            length = 0
        if length <= 0 or length > 10 * 1024 * 1024:
            return {}
        try:
            raw = self.rfile.read(length)
            return json.loads(raw.decode('utf-8', 'replace'))
        except Exception:
            return {}

    def _share_send(self, data):
        self._send_json(data)

    def _share_fail(self, msg, code=400):
        self._send_json({'ok': False, 'msg': msg}, code=code)

    def route_share(self):
        """入口：path 以 /api/share 开头时调用。返回 True 表示已处理。"""
        if zf_share is None:
            self._share_fail('共享空间模块未加载', 500)
            return True
        path = self.path.split('?')[0]
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        a = (qs.get('a') or [''])[0]

        if path == '/api/share/config':
            if self.command == 'POST':
                body = self._read_json_body()
                cfg = zf_share.save_cfg(body or {})
                return self._share_send({'ok': True, 'data': cfg})
            return self._share_send({'ok': True, 'data': zf_share.load_cfg()})

        if a == 'list':
            try:
                vis = (qs.get('visibility') or ['public'])[0]
                page = int((qs.get('page') or ['1'])[0])
                return self._share_send(zf_share.list_projects(vis, page))
            except Exception as e:
                return self._share_fail('列表获取失败: %s' % e, 502)

        if a == 'detail':
            try:
                return self._share_send(zf_share.project_detail(int((qs.get('id') or ['0'])[0])))
            except Exception as e:
                return self._share_fail('详情获取失败: %s' % e, 502)

        if a == 'upload' and self.command == 'POST':
            body = self._read_json_body()
            local = body.get('path') or ''
            title = body.get('title') or ''
            if not local or not title:
                return self._share_fail('缺少 path 或 title')
            if not os.path.isabs(local):
                local = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), local)
            if not os.path.isfile(local):
                return self._share_fail('文件不存在: %s' % local)
            try:
                res = zf_share.upload_project(
                    local, title,
                    body.get('visibility') or 'public',
                    body.get('desc') or '')
                return self._share_send(res)
            except Exception as e:
                return self._share_fail('上传失败: %s' % e, 502)

        if a == 'download':
            try:
                pid = int((qs.get('id') or ['0'])[0])
                res = zf_share.download_project(pid)
                return self._share_send({'ok': True, 'data': res})
            except Exception as e:
                return self._share_fail('下载失败: %s' % e, 502)

        if a == 'index_publish' and self.command == 'POST':
            body = self._read_json_body()
            try:
                res = zf_share.publish_url_index(
                    body.get('url') or '', body.get('title') or '',
                    body.get('summary') or '', consent=bool(body.get('consent')))
                return self._share_send(res)
            except Exception as e:
                return self._share_fail('发布失败: %s' % e, 502)

        return self._share_fail('未知共享空间操作: %s' % (a or path))
