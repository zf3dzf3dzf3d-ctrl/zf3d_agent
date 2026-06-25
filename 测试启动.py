"""启动测试脚本"""
import sys
import os

# 设置路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '公共区', '内核'))

from 配置加载器 import 配置加载器类
from 模型直连器 import 模型直连器类
from 操作注册中心 import 操作注册中心类
from pathlib import Path

项目根目录 = Path(__file__).parent

print("=" * 50)
print("  朱峰社区智能体 - 启动测试")
print("=" * 50)

# 1. 加载配置
print("\n📋 加载配置...")
loader = 配置加载器类(项目根目录)
config = loader.加载全部配置()
print(f"   已加载 {len(config)} 个配置文件")

# 2. 测试模型直连器
print("\n🤖 测试模型直连器...")
模型配置 = config.get("模型规则", {})
密钥配置 = config.get("密钥", {})
print(f"   接口地址: {模型配置.get('接口地址', '')}")
print(f"   模型: {密钥配置.get('密钥列表', {}).get('LLM_MODEL', '')}")

直连器 = 模型直连器类(模型配置, 密钥配置)
结果 = 直连器.发送消息([{"role": "user", "content": "用5个字打招呼"}])
成功 = 结果.get("成功", False)
print(f"   连接: {'✅ 成功' if 成功 else '❌ 失败'}")
if 成功:
    print(f"   回复: {结果.get('回复内容', '')[:100]}")
else:
    print(f"   错误: {结果.get('错误', '')}")

# 3. 测试操作注册中心
print("\n⚡ 测试操作注册中心...")
中心 = 操作注册中心类()
中心.注册内置操作()
操作数 = len(中心.列出所有操作())
print(f"   已注册: {操作数}个操作")

时间结果 = 中心.执行("获取时间", {})
print(f"   获取时间: {时间结果}")

计算结果 = 中心.执行("数学计算", {"表达式": "2+3*4"})
print(f"   数学计算: {计算结果}")

# 4. 测试模块加载
print("\n📦 测试模块加载...")
import importlib.util

模块目录 = 项目根目录 / "公共区" / "模块"
for 模块名 in ["对话", "记忆", "任务"]:
    入口文件 = 模块目录 / 模块名 / "主程序.py"
    if 入口文件.exists():
        try:
            规格 = importlib.util.spec_from_file_location(模块名, 入口文件)
            模块 = importlib.util.module_from_spec(规格)
            规格.loader.exec_module(模块)
            主类名 = 模块名 + "模块"
            if hasattr(模块, 主类名):
                实例 = getattr(模块, 主类名)()
                print(f"   ✅ {模块名}: 加载成功")
            else:
                print(f"   ⚠️ {模块名}: 未找到{主类名}")
        except Exception as e:
            print(f"   ❌ {模块名}: {e}")
    else:
        print(f"   ❌ {模块名}: 入口文件不存在")

print("\n" + "=" * 50)
print("  测试完成！")
print("=" * 50)
