# -*- coding: utf-8 -*-
"""明文显钥的二次验证路由（2026-11-24）。

POST /api/models/reveal-key          {tail, password?}   用尾号换回完整密钥（需通过二次验证）
POST /api/models/reveal-key/setup    {}                  在电脑上弹出原生窗口，设置 / 修改查看密码

为什么：此前 GET /api/models/reveal-key?tail=xxxx 凭 4 位尾号即返回解密后的完整密钥，而本机
回环请求免 token——智能体自己执行的任何 shell 命令都能把全部密钥取走。规则见
server/util_key_reveal.py 的模块说明：首设走原生窗口、查看要密码、错 5 次锁 5 分钟、成功留审计。
"""
import re

from routes.dispatcher import route_post
from util_log import get_logger

log = get_logger('key_reveal')

_TAIL_RE = re.compile(r'^[A-Za-z0-9_\-]{1,12}$')


@route_post('/api/models/reveal-key')
def _h_reveal_key(self, path, parsed):
    """POST /api/models/reveal-key  {tail, password?}

    返回：
      200 {ok, key}                      验证通过（带了有效会话 Cookie，或密码正确）
      403 {ok:False, need_password}       需要输入查看密码
      403 {ok:False, need_setup, dialog}  尚未设置查看密码；已在电脑上弹出设置窗口
      403 {ok:False, err: wrong_password | locked, fails | retryAfter}
      404 未找到匹配的密钥
    密码只走 POST 体，不进 URL、不进日志。"""
    import util_key_reveal as kr
    try:
        body = self._read_body() or {}
    except (ValueError, UnicodeDecodeError):
        body = {}
    if not isinstance(body, dict):
        body = {}
    tail = str(body.get('tail') or '').strip()
    if not _TAIL_RE.match(tail):
        self._send_json({'ok': False, 'err': '缺少或非法的 tail'}, 400)
        return
    ip = self.client_address[0] if self.client_address else ''
    cookie = None
    if not kr.check_token(self.headers.get('Cookie') or ''):
        pw = str(body.get('password') or '')
        if not pw:
            if not kr.is_configured():
                dialog = kr.start_dialog()
                self._send_json({'ok': False, 'need_setup': True,
                                 'err': '首次查看明文密钥，需先在电脑上设置“查看密钥密码”'
                                        '（已弹出设置窗口；若没有看到，请在电脑前操作）',
                                 'dialog': dialog}, 403)
            else:
                self._send_json({'ok': False, 'need_password': True,
                                 'err': '查看明文密钥需要输入“查看密钥密码”'}, 403)
            return
        res, token = kr.verify(pw, ip)
        if not token:
            self._send_json(res, 403)
            return
        cookie = kr.cookie_header(token)
    from model_config import find_key_by_tail
    real = find_key_by_tail(tail)
    if not real:
        self._send_json({'ok': False, 'err': '未找到匹配的真实密钥'}, 404)
        return
    kr.log_event('reveal', 'tail=%s ip=%s' % (tail, ip))
    self._send_json({'ok': True, 'key': real}, 200,
                    extra_headers=[('Set-Cookie', cookie)] if cookie else None)


@route_post('/api/models/reveal-key/setup')
def _h_reveal_key_setup(self, path, parsed):
    """POST /api/models/reveal-key/setup  在电脑上弹出原生窗口。

    密码的设置与修改只在原生窗口里完成，不经过这个接口——它只负责“把窗口叫出来”。
    所以这个接口被谁调用都无所谓：没有人在电脑前，窗口 3 分钟后自动关闭，什么都不会发生。"""
    import util_key_reveal as kr
    res = kr.start_dialog()
    self._send_json(res if res.get('ok') else dict(res, ok=False), 200 if res.get('ok') else 500)
