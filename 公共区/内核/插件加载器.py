"""插件热加载器 — 扫描 公共区/插件/ 目录自动加载 .py 插件

用法：
    加载器 = 插件加载器类()
    加载器.扫描加载("公共区/插件", 操作注册中心)

插件文件格式（示例）：
    from 操作.基类 import 操作基类, 操作结果

    class 今日运势(操作基类):
        名称 = "今日运势"
        描述 = "获取今日运势"
        参数结构 = {}

        def 执行(self, 参数):
            return 操作结果(成功=True, 结果="今日运势: 大吉")
"""
import os
import sys
import importlib.util
from pathlib import Path


class 插件加载器类:
    """扫描插件目录，自动加载 .py 文件中的操作类"""

    def __init__(self):
        self.已加载插件 = {}  # 文件名 → [操作实例]

    def 扫描加载(self, 插件目录: str, 注册目标=None) -> list:
        """扫描目录下所有 .py 文件，import 并注册操作

        参数:
            插件目录: 插件目录路径
            注册目标: 操作注册中心实例

        返回: 已加载的操作实例列表
        """
        目录 = Path(插件目录)
        if not 目录.exists():
            print(f"   ℹ️ 插件目录不存在: {插件目录}")
            return []

        全部实例 = []

        for py文件 in sorted(目录.glob("*.py")):
            if py文件.name.startswith("_"):
                continue
            try:
                实例列表 = self._加载文件(py文件, 注册目标)
                if 实例列表:
                    self.已加载插件[py文件.name] = 实例列表
                    全部实例.extend(实例列表)
                    名称列表 = [i.名称 for i in 实例列表]
                    print(f"   🔌 插件 [{py文件.name}] 加载 {len(实例列表)} 个操作: {', '.join(名称列表)}")
            except Exception as e:
                print(f"   ❌ 插件 [{py文件.name}] 加载失败: {e}")

        if 全部实例:
            print(f"   ✅ 插件热加载完成: 共 {len(全部实例)} 个操作")
        else:
            print(f"   ℹ️ 插件目录无可用插件: {插件目录}")

        return 全部实例

    def _加载文件(self, 文件路径: Path, 注册目标=None) -> list:
        """加载单个 .py 插件文件"""
        # 确保内核目录在 sys.path 中（操作基类依赖）
        内核目录 = Path(__file__).parent
        if str(内核目录) not in sys.path:
            sys.path.insert(0, str(内核目录))

        # 用 importlib 动态加载模块
        模块名 = f"_插件_{文件路径.stem}"
        spec = importlib.util.spec_from_file_location(模块名, 文件路径)
        if not spec or not spec.loader:
            return []

        模块 = importlib.util.module_from_spec(spec)
        sys.modules[模块名] = 模块
        spec.loader.exec_module(模块)

        # 查找模块中所有 操作基类 子类
        from 操作.基类 import 操作基类
        实例列表 = []
        for 属性名 in dir(模块):
            属性 = getattr(模块, 属性名)
            if (isinstance(属性, type)
                    and issubclass(属性, 操作基类)
                    and 属性 is not 操作基类
                    and not 属性名.startswith("_")):
                try:
                    实例 = 属性()
                    实例列表.append(实例)
                    if 注册目标:
                        注册目标.注册(实例)
                except Exception as e:
                    print(f"   ⚠️ 插件操作 [{属性名}] 实例化失败: {e}")

        return 实例列表
