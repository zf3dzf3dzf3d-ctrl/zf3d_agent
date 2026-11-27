# -*- coding: utf-8 -*-
"""ext.bundle：/api/ext/* 注册面插件化（T7，策划案v4）。

镜像 MixinExt._handle_ext 的转发语义（POST 先 _read_body，异常吞并 500），
经 ctx.route 前缀面板注册；dispatcher 注册表优先于 if 链，插件 disable 即
自动回落原生链路（双轨可回退）。实现体（extensions/ 五模块）迁收归 T8。
"""
import traceback


def _ext(handler, method, path):
    try:
        body = {}
        if method == 'POST':
            try:
                body = handler._read_body()
            except Exception:
                body = {}
        from extensions import dispatch as _ext_dispatch
        _ext_dispatch(handler, method, path, body)
    except Exception:
        traceback.print_exc()  # 内部日志：完整异常留在服务端控制台
        try:
            # 【20261123 修复FH#6】对外固定文案，不回传 str(e)（防内部路径/细节外泄）
            handler._send_json({'ok': False, 'error': 'ext dispatch internal error'}, 500)
        except Exception:
            pass


def setup(ctx):
    ctx.route.get_prefix('/api/ext/')(lambda h, p, q: _ext(h, 'GET', p))
    ctx.route.post_prefix('/api/ext/')(lambda h, p, q: _ext(h, 'POST', p))
    ctx.log.info("ext.bundle: /api/ext/* prefix routes registered (fallback to if-chain on disable)")


def teardown(ctx):
    ctx.log.info("ext.bundle teardown: prefix routes unregistered, if-chain resumes")
