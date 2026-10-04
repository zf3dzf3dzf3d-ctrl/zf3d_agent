# -*- coding: utf-8 -*-
"""后端冒烟测试：批量 import server 核心模块，验证无语法/依赖错误。

用法（项目根目录）：
    python\python.exe server\tests\smoke_test.py
"""
import importlib
import os
import sys
import traceback

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SERVER_DIR = os.path.join(ROOT, 'server')
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

# 包式引擎模块（engines.* 均为 Python 包，可直接 import）
MODULES = [
    'engines.common.material_pack_prefixes',
    'engines.common.mega_task.index',
    'engines.deepseek_direct.engine',
    'engines.hermes_style.engine',
    'engines.codex_style.engine',
    'engines.pi_style.engine',
    'engines.openclaw_style.engine',
    'engines.claude_code_style.engine',
]

# 脚本式顶层模块（无包结构，按文件路径编译校验语法）
SCRIPTS = [
    'routes/api_dispatch_get.py',
    'routes/api_dispatch_post.py',
    'routes/api_dispatch_post_extra.py',
    'routes/mixin_base.py',
    'routes/mixin_core.py',
    'routes/mixin_docs.py',
    'memory_core.py',
    'security.py',
    'db.py',
    'config.py',
    'server.py',
    'mode_loader.py',
]


def check_scripts():
    import py_compile
    failed = []
    for rel in SCRIPTS:
        path = os.path.join(SERVER_DIR, rel.replace('/', os.sep))
        try:
            py_compile.compile(path, doraise=True)
            print(f'[PASS] {rel}')
        except Exception:
            failed.append((rel, traceback.format_exc(limit=3)))
            print(f'[FAIL] {rel}')
    return failed


def main():
    failed = []
    for mod in MODULES:
        try:
            importlib.import_module(mod)
            print(f'[PASS] {mod}')
        except Exception:
            failed.append((mod, traceback.format_exc(limit=3)))
            print(f'[FAIL] {mod}')
    failed += check_scripts()
    total = len(MODULES) + len(SCRIPTS)
    print('-' * 50)
    print(f'PASS {total - len(failed)} / {total}, FAIL {len(failed)}')
    for mod, tb in failed:
        print(f'\n--- {mod} ---\n{tb}')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
