# -*- coding: utf-8 -*-
"""Mixin: 配置读写（自动拆分自 handler_routes.py）。
原单文件过大，已按功能拆分为子 Mixin（同目录 mixin_settings_*.py），
本文件仅做组合，对外类名 MixinSettings 保持不变。"""
from routes._shared import *
from routes.mixin_base import MixinBase
from routes.mixin_settings_brain import MixinSettingsBrain
from routes.mixin_settings_dream import MixinSettingsDream
from routes.mixin_settings_protocol import MixinSettingsProtocol
from routes.mixin_settings_updater import MixinSettingsUpdater
from routes.mixin_settings_health import MixinSettingsHealth
from routes.mixin_settings_user import MixinSettingsUser
from routes.mixin_settings_worklog import MixinSettingsWorklog


class MixinSettings(MixinSettingsBrain,
                    MixinSettingsDream,
                    MixinSettingsProtocol,
                    MixinSettingsUpdater,
                    MixinSettingsHealth,
                    MixinSettingsUser,
                    MixinSettingsWorklog):
    pass
