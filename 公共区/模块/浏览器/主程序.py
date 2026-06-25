"""浏览器模块 — 入口协调器

架构：
- 浏览器引擎：Playwright封装，页面操作原语
- 页面分析器：内容提取和结构化分析
- 会话管理器：Cookie/localStorage持久化

浏览器操作（工具）在 内核/操作/浏览器操作.py 中注册，
通过操作注册中心供ReAct引擎调用。
本模块负责浏览器引擎的全局生命周期管理。
"""
import os
import json
import sys
from pathlib import Path

# 确保模块内文件可被导入
_模块目录 = str(Path(__file__).parent)
if _模块目录 not in sys.path:
    sys.path.insert(0, _模块目录)

_项目根 = str(Path(__file__).parent.parent.parent)


class 浏览器模块:
    """浏览器模块入口 — 管理浏览器引擎生命周期

    浏览器操作（工具）通过操作注册中心共享全局引擎实例。
    本模块在系统启动时初始化，在系统关闭时清理。
    """

    def __init__(self):
        self.引擎 = None
        self.分析器 = None
        self.会话管理 = None
        self._配置 = None

    def 初始化(self, 配置: dict):
        """加载浏览器配置，预创建分析器（引擎惰性初始化）"""
        self._配置 = 配置
        # 分析器和会话管理器可以预创建，引擎在首次工具调用时才启动
        try:
            from 页面分析器 import 页面分析器类
            self.分析器 = 页面分析器类()
        except Exception:
            self.分析器 = None

        try:
            from 会话管理器 import 会话管理器类
            会话目录 = 配置.get("会话目录", "隐私区/浏览器会话")
            if not os.path.isabs(会话目录):
                会话目录 = os.path.join(_项目根, 会话目录)
            self.会话管理 = 会话管理器类(会话目录)
        except Exception:
            self.会话管理 = None

    def 运行(self, 输入数据: dict) -> dict:
        """浏览器模块被动等待工具调用，不需要主动运行"""
        return {"成功": True, "数据": "浏览器模块已就绪"}

    def 停止(self):
        """关闭浏览器，保存所有会话"""
        # 引擎可能在操作类中创建，这里尝试清理
        try:
            import sys
            模块 = sys.modules.get("操作.浏览器操作")
            if 模块 and hasattr(模块, "_浏览器引擎") and 模块._浏览器引擎:
                模块._浏览器引擎.关闭()
                模块._浏览器引擎 = None
        except Exception:
            pass
