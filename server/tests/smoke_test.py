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


# ===== 业务断言（P3，2026-10-12；2026-11-23 改真断言）=====
def check_route_registry():
    """断言：routes/ 路由注册表真实在位——统计 @route_get/@route_post 装饰器总数 > 100。
    （旧版「文件≥500字符」是假断言，空壳文件也能过；现按装饰器实数把关。）
    返回 (failed, attempted) 供 PASS 算术用。"""
    import re
    import glob
    failed = []
    route_dir = os.path.join(SERVER_DIR, 'routes')
    n_get = n_post = 0
    for f in sorted(glob.glob(os.path.join(route_dir, '*.py'))):  # 含 dispatcher.py
        try:
            src = open(f, encoding='utf-8', errors='ignore').read()
        except Exception:
            continue
        n_get += len(re.findall(r'@route_get\b', src))
        n_post += len(re.findall(r'@route_post\b', src))
    total_routes = n_get + n_post
    rel = os.path.relpath(route_dir, ROOT)
    try:
        if total_routes <= 100:
            raise AssertionError(f'{rel} @route_get/@route_post 装饰器总数仅 {total_routes}'
                                 f'（get={n_get} post={n_post}），路由注册表疑似损坏')
        print(f'[PASS] 断言 {rel} 路由注册表在位: @route_get x{n_get} + @route_post x{n_post}'
              f' = {total_routes} > 100')
    except AssertionError as e:
        failed.append((str(e), ''))
        print(f'[FAIL] 断言 {e}')
    return failed, 1


def check_no_secrets():
    """断言：敏感文件中无明文密钥回归模式（P0 回归测试）。
    旧目标 tools/trigger_deploy.py 已不存在（空转）；改扫一组真实存在的敏感文件，
    读得到才扫、不存在打印 SKIP 并不计入 total。返回 (failed, attempted)。"""
    import re
    failed = []
    attempted = 0
    bad_patterns = [
        (re.compile(r"secret\s*=\s*'[0-9a-f]{64}'"), '硬编码 64 位十六进制 secret 回归'),
        (re.compile(r'pass:zf123456'), '_sign_*.bat 明文密码回归'),
    ]
    targets = [
        os.path.join(ROOT, 'private', 'api_keys.json'),
        os.path.join(ROOT, 'private', 'port.json'),
        os.path.join(SERVER_DIR, 'security.py'),
    ]
    mobile = os.path.join(ROOT, 'mobile-app')
    if os.path.isdir(mobile):
        targets += [os.path.join(mobile, f) for f in os.listdir(mobile)
                    if f.startswith('_sign_') and f.endswith('.bat')]
    for t in targets:
        if not os.path.isfile(t):
            print(f'[SKIP] 无密钥断言 {os.path.relpath(t, ROOT)}（文件不存在）')
            continue
        attempted += 1
        try:
            src = open(t, encoding='utf-8', errors='ignore').read()
            for pat, msg in bad_patterns:
                if pat.search(src):
                    raise AssertionError(f'{os.path.relpath(t, ROOT)}: {msg}')
            print(f'[PASS] 断言 无密钥 {os.path.relpath(t, ROOT)}')
        except AssertionError as e:
            failed.append((str(e), ''))
            print(f'[FAIL] 断言 {e}')
    return failed, attempted


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
    reg_failed, reg_total = check_route_registry()
    sec_failed, sec_total = check_no_secrets()
    failed += reg_failed + sec_failed
    total = len(MODULES) + len(SCRIPTS) + reg_total + sec_total  # 业务断言计入分母，算术不再错账
    print('-' * 50)
    print(f'PASS {total - len(failed)} / {total}, FAIL {len(failed)}')
    for mod, tb in failed:
        print(f'\n--- {mod} ---\n{tb}')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
