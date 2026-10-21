# -*- coding: utf-8 -*-
# 拆分分段模块：由原 screen_recorder.py 按行段【无改动】切分，由同名门面加载合并。
# ==================== 依赖注入：转码 Mixin 模块需要的模块级名字 ====================
# screen_recorder_transcode.py 中直接引用 _录屏状态/_写日志/_ffmpeg/录屏器，
# 若不注入，后台转码线程会因 NameError 静默死亡，导致 转码完成 永不置位、
# 前端等待超时且只能拿到无音频的 MKV。
import sys as _sys_transcode
import screen_recorder_transcode as _transcode_mod

_transcode_mod._录屏状态 = _录屏状态
_transcode_mod._写日志 = _写日志
_transcode_mod._ffmpeg = _ffmpeg
_transcode_mod.录屏器 = 录屏器
_sys_transcode.modules["screen_recorder_transcode"] = _transcode_mod
