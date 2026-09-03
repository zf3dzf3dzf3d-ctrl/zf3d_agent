#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
config_agent/backend/write_models.py
插件工具：整体写回 public/config/models.json（自动备份 .bak）
仅限模型配置管家插件使用（manifest.fileAccess 白名单内）。

约定接口：
    run(args: dict) -> dict
args:
    models: 必填，完整的模型条目数组（整体覆盖）
返回:
    {ok, count, backup}
安全：
    - 写前校验是数组
    - 写前自动备份原文件为 .bak（带时间戳）
"""

import os
import json
import time

_MODELS_PATH = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', '..', '..',
    'public', 'config', 'models.json'
))


def run(args):
    args = args or {}
    models = args.get('models')
    if not isinstance(models, list):
        return {'ok': False, 'error': 'models 必须是数组'}
    if not os.path.isfile(_MODELS_PATH):
        return {'ok': False, 'error': 'models.json 不存在，拒绝创建'}

    # 写前备份
    backup_path = None
    try:
        backup_path = _MODELS_PATH + '.bak.' + time.strftime('%Y%m%d_%H%M%S')
        with open(_MODELS_PATH, 'r', encoding='utf-8') as f:
            old = f.read()
        with open(backup_path, 'w', encoding='utf-8') as f:
            f.write(old)
    except OSError:
        backup_path = None  # 备份失败不阻断，但记录

    try:
        tmp = _MODELS_PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(models, f, ensure_ascii=False, indent=2)
        os.replace(tmp, _MODELS_PATH)
    except (OSError, TypeError) as e:
        return {'ok': False, 'error': '写入 models.json 失败: %s' % e}

    return {'ok': True, 'count': len(models), 'backup': backup_path}


if __name__ == '__main__':
    print(json.dumps({'ok': True, 'hint': '本工具需传 models 数组，供插件执行器调用'}))
