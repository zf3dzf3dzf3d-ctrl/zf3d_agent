#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""入口：pythonw server/bot_gateway/__main__.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bot_gateway import config as gw_config
from bot_gateway import start_all

if __name__ == "__main__":
    gw_config.ensure_template()
    print("[bot_gateway] 启动中…（Ctrl+C 退出）")
    start_all(block=True)
