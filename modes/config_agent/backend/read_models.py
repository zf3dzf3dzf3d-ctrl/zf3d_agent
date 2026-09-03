#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
config_agent/backend/read_models.py
插件工具：读取 public/config/models.json（整体返回或按 name 筛选）
仅限模型配置管家插件使用（manifest.fileAccess 白名单内）。

约定接口（被通用工具执行器调用）：
    run(args: dict) -> dict
args:
    name: 可选，按模型 name 精确/模糊筛选
返回:
    {ok, models: [...], count}
"""

import os
import json

_MODELS_PATH = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', '..', '..',
    'public', 'config', 'models.json'
))


def run(args):
    args = args or {}
    name_filter = str(args.get('name') or '').strip()
    try:
        with open(_MODELS_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        return {'ok': False, 'error': '读取 models.json 失败: %s' % e}

    models = data if isinstance(data, list) else data.get('models', [])
    if name_filter:
        models = [m for m in models
                  if name_filter.lower() in str(m.get('name', '')).lower()
                  or name_filter.lower() in str(m.get('displayName', '')).lower()]
    return {'ok': True, 'count': len(models), 'models': models}


if __name__ == '__main__':
    import sys
    print(json.dumps(run({'name': sys.argv[1] if len(sys.argv) > 1 else ''}),
                     ensure_ascii=False, indent=2))
