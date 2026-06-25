"""
启动器 - 系统启动入口+模块调度
读取配置 → 加载模块 → 启动服务
"""
import sys
import os
import json

# Windows控制台默认GBK编码，emoji字符会崩溃，强制UTF-8输出
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import importlib.util
from pathlib import Path

# 将内核目录加入搜索路径
内核目录 = Path(__file__).parent
sys.path.insert(0, str(内核目录))

from 配置加载器 import 配置加载器类, 全局事件中心, 全局命令中心
from 模型直连器 import 模型直连器类
from 文件管理器 import 文件管理器类
from 网页服务 import 网页服务类
from 操作注册中心 import 操作注册中心类
from 动态工具加载器 import 动态工具加载器类
from 定时任务与影响分析 import 定时任务调度器
from 运行诊断器 import 运行诊断器类
from 操作注册中心 import 操作注册中心类
from 动态工具加载器 import 动态工具加载器类
from 定时任务与影响分析 import 定时任务调度器


class 启动器类:
    def __init__(self):
        self.项目根目录 = Path(__file__).parent.parent.parent  # 内核/公共区/项目根
        self.配置加载器 = None
        self.模型直连器 = None
        self.文件管理器 = None
        self.网页服务 = None
        self.操作注册中心 = None
        self.运行诊断器 = None
        self.模块注册 = {}
        self.运行中 = False

    def 启动(self):
        """启动系统"""
        print("=" * 50)
        print("  朱峰社区智能体 (ZF3D Agent) v2.0")
        print("=" * 50)

        # 1. 加载配置
        print("📋 加载配置...")
        self.配置加载器 = 配置加载器类(self.项目根目录)
        配置 = self.配置加载器.加载全部配置()
        print(f"   已加载 {len(配置)} 个配置文件")

        # 启动配置热重载
        self.配置加载器.启动热重载()
        print("   ✅ 配置热重载已启动")

        # 2. 初始化模型直连器
        print("🤖 初始化模型直连器...")
        模型配置 = 配置.get("模型规则", {})
        密钥配置 = 配置.get("密钥", {})
        self.模型直连器 = 模型直连器类(模型配置, 密钥配置)
        连通结果 = self.模型直连器.验证连通性()
        if 连通结果["连通"]:
            print("   ✅ 模型接口连通")
        else:
            print(f"   ⚠️ 模型接口未连通: {连通结果['原因']}")
            print("   （请配置 ./隐私区/我的配置/密钥.json 和 ./公共区/配置/模型规则.json）")

        # 3. 初始化文件管理器
        print("🔒 初始化文件管理器...")
        权限配置 = 配置.get("文件权限", {})
        self.文件管理器 = 文件管理器类(权限配置, self.项目根目录)
        print("   ✅ 文件权限校验就绪")

        # 3b. 初始化运行诊断器
        print("🔬 初始化运行诊断器...")
        self.运行诊断器 = 运行诊断器类(self.项目根目录)
        print("   ✅ 运行诊断器就绪（错误自动记录+监控规则引擎）")

        # 4. 初始化操作注册中心
        print("⚡ 初始化操作注册中心...")
        self.操作注册中心 = 操作注册中心类()
        self.操作注册中心.注册内置操作()
        self.操作注册中心.设置文件管理器(self.文件管理器)
        self.操作注册中心.设置模型直连器(self.模型直连器)
        self.操作注册中心.设置配置加载器(self.配置加载器)
        操作数 = len(self.操作注册中心.列出所有操作())
        print(f"   ✅ 已注册 {操作数} 个操作")

        # 4b. 加载声明式动态工具
        print("🔧 加载声明式动态工具...")
        工具声明路径 = self.项目根目录 / "公共区" / "配置" / "工具声明.json"
        self.动态工具加载器 = 动态工具加载器类()
        动态工具数 = len(self.动态工具加载器.从文件加载(str(工具声明路径), 注册目标=self.操作注册中心))
        操作数 = len(self.操作注册中心.列出所有操作())
        print(f"   ✅ 共注册 {操作数} 个操作（内置+动态）")

        # 4c. 热加载插件
        print("🔌 扫描插件目录...")
        from 插件加载器 import 插件加载器类
        插件目录 = self.项目根目录 / "公共区" / "插件"
        self.插件加载器 = 插件加载器类()
        self.插件加载器.扫描加载(str(插件目录), 注册目标=self.操作注册中心)
        操作数 = len(self.操作注册中心.列出所有操作())
        print(f"   ✅ 共注册 {操作数} 个操作（内置+动态+插件）")

        # 4d. 加载技能
        print("🎓 加载技能...")
        from 技能加载器 import 技能加载器类
        技能目录 = self.项目根目录 / "公共区" / "技能"
        self.技能加载器 = 技能加载器类()
        self.技能加载器.扫描加载(str(技能目录), 注册目标=self.操作注册中心)
        技能数 = len(self.技能加载器.列出技能())
        操作数 = len(self.操作注册中心.列出所有操作())
        print(f"   ✅ 共注册 {操作数} 个操作（内置+动态+插件+技能脚本）")

        # 4e. 连接MCP服务
        print("🔗 连接MCP服务...")
        from MCP客户端 import MCP管理器类
        self.MCP管理器 = MCP管理器类()
        MCP配置路径 = self.项目根目录 / "公共区" / "配置" / "MCP服务.json"
        self.MCP管理器.从配置加载(str(MCP配置路径), 注册目标=self.操作注册中心)
        操作数 = len(self.操作注册中心.列出所有操作())
        print(f"   ✅ 共注册 {操作数} 个操作（内置+动态+插件+技能+MCP）")

        # 4f. 初始化知识库
        print("📚 初始化知识库...")
        import sys as _sys
        _知识库父目录 = str(self.项目根目录 / "公共区" / "模块" / "记忆")
        if _知识库父目录 not in _sys.path:
            _sys.path.insert(0, _知识库父目录)
        from 操作.知识库操作 import 设置知识库实例
        from 知识库 import 知识库模块
        知识库配置路径 = self.项目根目录 / "公共区" / "配置" / "知识库配置.json"
        try:
            with open(知识库配置路径, "r", encoding="utf-8") as f:
                知识库配置 = json.load(f)
        except Exception:
            知识库配置 = {}
        知识库配置["项目根目录"] = str(self.项目根目录)
        self.知识库 = 知识库模块()
        self.知识库.初始化(知识库配置)
        设置知识库实例(self.知识库)
        文档数 = len(self.知识库.列出文档())
        print(f"   ✅ 知识库就绪（已导入 {文档数} 个文档）")

        # 4g. 初始化剧本管理器
        print("🎬 初始化剧本管理器...")
        from 剧本管理器 import 获取剧本管理器
        from 操作.剧本操作 import 设置剧本管理器
        self.剧本管理器 = 获取剧本管理器(self.操作注册中心, str(self.项目根目录))
        设置剧本管理器(self.剧本管理器)
        剧本数 = len(self.剧本管理器.列出剧本())
        print(f"   ✅ 剧本管理器就绪（已保存 {剧本数} 个剧本）")

        # 4h. 初始化系统托盘（仅Windows）
        if sys.platform == 'win32':
            print("📌 初始化系统托盘...")
            try:
                from 系统托盘 import 系统托盘 as 系统托盘类
                self.系统托盘 = 系统托盘类(self)
                self.系统托盘.启动("朱峰社区智能体 v2.1 运行中")
                print("   ✅ 系统托盘已创建")
            except Exception as e:
                print(f"   ⚠️ 系统托盘初始化失败: {e}")

        # 5. 加载模块
        print("📦 加载模块...")
        模块配置 = 配置.get("模块配置", {})
        已启用列表 = 模块配置.get("已启用", [])
        for 模块名 in 已启用列表:
            结果 = self._加载模块(模块名, 模块配置.get("配置", {}).get(模块名, {}))
            if 结果:
                print(f"   ✅ 模块 [{模块名}] 已加载")
            else:
                print(f"   ❌ 模块 [{模块名}] 加载失败")

        # 5b. 启动定时任务调度器
        print("⏰ 启动定时任务调度器...")
        self.定时任务调度器 = 定时任务调度器(
            操作注册中心=self.操作注册中心,
            项目根目录=str(self.项目根目录)
        )
        self.定时任务调度器.启动()

        # 6. 注册全局命令
        print("⚡ 注册全局命令...")
        全局命令中心.注册命令("重载配置", self._命令_重载配置)
        全局命令中心.注册命令("开关模块", self._命令_开关模块)
        全局命令中心.注册命令("退出", self._命令_退出)
        print("   ✅ 已注册 3 个全局命令")

        # 7. 启动Web服务
        系统配置 = 配置.get("系统配置", {})
        端口 = 系统配置.get("网页端口", 8765)
        界面目录 = self.项目根目录 / "公共区" / "界面"

        print(f"🌐 启动Web服务 (端口 {端口})...")
        self.网页服务 = 网页服务类(端口, 界面目录)
        self.运行中 = True

        # 发布系统启动事件
        全局事件中心.发布("系统启动", {})

        print("=" * 50)
        print(f"  ✅ 系统已启动！")
        print(f"  🌐 打开浏览器: http://localhost:{端口}")
        print("=" * 50)

        # 自动打开浏览器
        try:
            import webbrowser
            webbrowser.open(f"http://localhost:{端口}")
        except Exception:
            pass

        try:
            self.网页服务.启动(
                文件管理器=self.文件管理器,
                配置加载器=self.配置加载器,
                模型直连器=self.模型直连器,
                模块注册=self.模块注册,
                操作注册中心=self.操作注册中心,
                启动器实例=self,
                运行诊断器=self.运行诊断器
            )
        except KeyboardInterrupt:
            self.停止()

    def 自检(self) -> dict:
        """系统健康自检：检查所有核心组件状态"""
        检查结果 = {"状态": "正常", "项": [], "警告": []}

        # 1. 配置加载
        if self.配置加载器:
            配置数 = len(self.配置加载器.配置缓存)
            检查结果["项"].append({"名称": "配置加载器", "状态": "✅", "详情": f"已加载{配置数}个配置文件"})

        # 2. 模型连通性
        if self.模型直连器:
            连通 = self.模型直连器.验证连通性()
            if 连通["连通"]:
                检查结果["项"].append({"名称": "模型接口", "状态": "✅", "详情": "配置就绪"})
            else:
                检查结果["项"].append({"名称": "模型接口", "状态": "⚠️", "详情": 连通["原因"]})
                检查结果["警告"].append("模型接口未配置，对话功能不可用")

        # 3. 文件管理器
        if self.文件管理器:
            检查结果["项"].append({"名称": "文件管理器", "状态": "✅", "详情": f"已授权{len(self.文件管理器.授权目录)}个目录"})

        # 4. 操作注册中心
        if self.操作注册中心:
            操作数 = len(self.操作注册中心.列出所有操作())
            检查结果["项"].append({"名称": "操作注册中心", "状态": "✅", "详情": f"已注册{操作数}个操作"})

        # 5. 模块状态
        if self.模块注册:
            for 模块名, 模块 in self.模块注册.items():
                模块状态 = getattr(模块, '获取状态', None)
                if 模块状态:
                    try:
                        状态 = 模块状态()
                        检查结果["项"].append({"名称": f"模块:{模块名}", "状态": "✅", "详情": f"消息数:{状态.get('历史消息数','N/A')} 步数:{状态.get('最大步数','N/A')}"})
                    except:
                        检查结果["项"].append({"名称": f"模块:{模块名}", "状态": "⚠️", "详情": "状态获取失败"})
                else:
                    检查结果["项"].append({"名称": f"模块:{模块名}", "状态": "✅", "详情": "已加载"})

        # 6. 隐私区完整性
        隐私检查项 = [
            self.项目根目录 / "隐私区" / "我的配置" / "密钥.json",
            self.项目根目录 / "隐私区" / "我的记忆",
        ]
        for 路径 in 隐私检查项:
            if 路径.exists():
                标签 = "密钥文件" if "密钥" in str(路径) else "记忆目录"
                检查结果["项"].append({"名称": f"隐私:{标签}", "状态": "✅", "详情": "存在"})

        # 总体状态
        if 检查结果["警告"]:
            检查结果["状态"] = "⚠️ 有警告"
        return 检查结果

    def 停止(self):
        """停止系统"""
        print("\n🛑 系统关闭中...")
        self.运行中 = False
        for 模块名, 模块实例 in self.模块注册.items():
            try:
                模块实例.停止()
            except Exception:
                pass
        if hasattr(self, 'MCP管理器'):
            self.MCP管理器.断开全部()
        if hasattr(self, '系统托盘'):
            self.系统托盘.停止()
        if self.网页服务:
            self.网页服务.停止()
        全局事件中心.发布("系统关闭", {})
        print("✅ 系统已安全关闭")

    def _加载模块(self, 模块名: str, 模块参数: dict) -> bool:
        """加载指定模块"""
        模块目录 = self.项目根目录 / "公共区" / "模块" / 模块名
        声明文件 = 模块目录 / "模块声明.json"
        入口文件 = 模块目录 / "主程序.py"

        if not 入口文件.exists():
            print(f"   ❌ 模块入口文件不存在: {入口文件}")
            return False

        try:
            # 动态导入模块
            规格 = importlib.util.spec_from_file_location(模块名, 入口文件)
            模块 = importlib.util.module_from_spec(规格)
            规格.loader.exec_module(模块)

            # 实例化（约定：主类名=模块名+模块）
            主类名 = 模块名 + "模块"
            if hasattr(模块, 主类名):
                实例 = getattr(模块, 主类名)()
            elif hasattr(模块, "主模块"):
                实例 = 模块.主模块()
            else:
                # 取第一个类
                for 属性名 in dir(模块):
                    属性 = getattr(模块, 属性名)
                    if isinstance(属性, type):
                        实例 = 属性()
                        break
                else:
                    return False

            # 初始化 — 注入核心依赖
            完整参数 = {
                **模块参数,
                "项目根目录": str(self.项目根目录),
                "模型直连器": self.模型直连器,
                "操作注册中心": self.操作注册中心,
                "模块注册": self.模块注册,
                "技能加载器": getattr(self, "技能加载器", None),
                "知识库": getattr(self, "知识库", None)
            }
            实例.初始化(完整参数)
            self.模块注册[模块名] = 实例
            全局事件中心.发布("模块加载", {"模块名": 模块名})
            return True
        except Exception as e:
            print(f"   ❌ 模块加载异常: {str(e)}")
            import traceback
            traceback.print_exc()
            return False

    def _命令_重载配置(self, 参数: dict = None):
        """全局命令：重载配置"""
        self.配置加载器.重载配置()
        return {"成功": True, "消息": "配置已重载"}

    def _命令_开关模块(self, 参数: dict = None):
        """全局命令：开关模块"""
        参数 = 参数 or {}
        模块名 = 参数.get("模块名", "")
        状态 = 参数.get("状态", "")
        if 状态 == "禁用" and 模块名 in self.模块注册:
            self.模块注册[模块名].停止()
            del self.模块注册[模块名]
            return {"成功": True, "消息": f"模块 {模块名} 已禁用"}
        elif 状态 == "启用":
            模块配置 = self.配置加载器.获取配置("模块配置")
            self._加载模块(模块名, 模块配置.get("配置", {}).get(模块名, {}))
            return {"成功": True, "消息": f"模块 {模块名} 已启用"}
        return {"成功": False, "消息": "参数不完整"}

    def _命令_退出(self, 参数: dict = None):
        """全局命令：退出"""
        self.停止()
        return {"成功": True}


if __name__ == "__main__":
    启动器 = 启动器类()
    启动器.启动()
