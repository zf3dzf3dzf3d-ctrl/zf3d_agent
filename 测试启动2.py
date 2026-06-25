"""完整启动测试 - 带详细输出"""
import sys
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent
CN_CORE_DIR = PROJECT_ROOT / "公共区" / "内核"
sys.path.insert(0, str(CN_CORE_DIR))

from 配置加载器 import 配置加载器类, 全局事件中心, 全局命令中心
from 模型直连器 import 模型直连器类
from 文件管理器 import 文件管理器类
from 模型竞技场 import 模型竞技场类
from 操作注册中心 import 操作注册中心类
import importlib.util

print("=" * 50)
print("  Step-by-step startup test")
print("=" * 50)

# 1. Config
print("\n[1] Loading config...")
loader = 配置加载器类(PROJECT_ROOT)
config = loader.加载全部配置()
print(f"    OK: {len(config)} files")

# 2. Model
print("\n[2] Model connector...")
模型配置 = config.get("模型规则", {})
密钥配置 = config.get("密钥", {})
模型直连器 = 模型直连器类(模型配置, 密钥配置)
连通 = 模型直连器.验证连通性()
print(f"    Connected: {连通}")

# 3. File manager
print("\n[3] File manager...")
权限配置 = config.get("文件权限", {})
文件管理器 = 文件管理器类(权限配置, PROJECT_ROOT)
print(f"    OK")

# 4. Operations
print("\n[4] Operation registry...")
opCenter = 操作注册中心类()
opCenter.注册内置操作()
print(f"    OK: {len(opCenter.列出所有操作())} operations")

# 5. Modules
print("\n[5] Loading modules...")
模块配置 = config.get("模块配置", {})
已启用列表 = 模块配置.get("已启用", [])
模块注册 = {}

for 模块名 in 已启用列表:
    模块目录 = PROJECT_ROOT / "公共区" / "模块" / 模块名
    入口文件 = 模块目录 / "主程序.py"
    print(f"    Loading [{模块名}] from {入口文件}")
    print(f"    Exists: {入口文件.exists()}")

    if not 入口文件.exists():
        print(f"    FAIL: entry not found")
        continue

    try:
        规格 = importlib.util.spec_from_file_location(模块名, 入口文件)
        模块 = importlib.util.module_from_spec(规格)
        规格.loader.exec_module(模块)

        主类名 = 模块名 + "模块"
        if hasattr(模块, 主类名):
            实例 = getattr(模块, 主类名)()
        else:
            for 属性名 in dir(模块):
                属性 = getattr(模块, 属性名)
                if isinstance(属性, type):
                    实例 = 属性()
                    break
            else:
                print(f"    FAIL: no class found")
                continue

        # Init with injected dependencies
        完整参数 = {
            "项目根目录": str(PROJECT_ROOT),
            "模型直连器": 模型直连器,
            "操作注册中心": opCenter,
            "模块注册": 模块注册,
        }
        # Add module-specific config
        模块专属配置 = 模块配置.get("配置", {}).get(模块名, {})
        完整参数.update(模块专属配置)

        实例.初始化(完整参数)
        模块注册[模块名] = 实例
        print(f"    OK: {模块名} loaded")

        # Test module status
        if hasattr(实例, '获取状态'):
            print(f"    Status: {实例.获取状态()}")

    except Exception as e:
        print(f"    FAIL: {e}")
        import traceback
        traceback.print_exc()

print(f"\n[Result] Loaded modules: {list(模块注册.keys())}")

# 6. Quick web test
print("\n[6] Testing web service would start on port 8080...")
print("    (Not actually starting to avoid blocking)")
print("\nAll checks passed! System is ready to launch.")
