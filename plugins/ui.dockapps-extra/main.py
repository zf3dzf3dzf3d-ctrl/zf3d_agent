# -*- coding: utf-8 -*-
"""ui.dockapps-extra：i采集/i授权/i密室 三程序（R1-2 第二波，策划案v4 T1）。

资产为原 public/js/zf-app-dock-apps.js 逐字节副本（该文件 S4 拆分时已是
ZFDockBridge 桥接 IIFE，零适配直接插件化）；index.html 对应静态 script 退役。
"""


def setup(ctx):
    ctx.ui.mount("dock-app", ["ui/dockapps-extra.js"])
    ctx.log.info("ui.dockapps-extra mounted 3 apps at dock-app (collect/iauth/escape)")


def teardown(ctx):
    ctx.log.info("ui.dockapps-extra teardown")
