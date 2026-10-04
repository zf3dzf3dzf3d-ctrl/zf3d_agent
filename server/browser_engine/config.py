# -*- coding: utf-8 -*-
"""浏览器引擎配置：默认值 + JSON 覆盖（server/browser_engine_config.json）。

所有字段均可被 JSON 覆盖，改配置文件即生效（重启或调 reload_config）。
"""
import os
import json

_SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(_SERVER_DIR, 'browser_engine_config.json')

DEFAULT_CONFIG = {
    'profile_dir': os.path.join(_SERVER_DIR, 'data', 'browser_profile'),
    'shot_dir': os.path.join(_SERVER_DIR, 'data', 'browser_shots'),
    'headless': True,
    'viewport': {'width': 1280, 'height': 800},
    'max_tabs': 30,               # 标签页上限，防内存耗尽
    'goto_timeout_ms': 45000,
    'networkidle_timeout_ms': 8000,
    'click_timeout_ms': 15000,
    'content_max_chars': 300000,
    'stealth_args': ['--disable-blink-features=AutomationControlled'],
    'user_agent': None,           # None = Chromium 默认；可覆盖伪装 UA
    'locale': 'zh-CN',
    'extra_args': [],
}


class BrowserConfig(dict):
    """dict 子类：支持属性访问，未设置的字段回落默认值。"""

    def __init__(self, overrides=None):
        super().__init__(DEFAULT_CONFIG)
        self.update(overrides or {})
        self.reload_file()

    def __getattr__(self, k):
        try:
            return self[k]
        except KeyError:
            raise AttributeError(k)

    def reload_file(self):
        """从 JSON 配置文件合并覆盖项（文件不存在则忽略）。"""
        if os.path.exists(CONFIG_PATH):
            try:
                with open(CONFIG_PATH, 'r', encoding='utf-8-sig') as f:
                    self.update(json.load(f))
            except Exception:
                pass
        return self

    def save(self):
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(self, f, ensure_ascii=False, indent=2)
        return self
