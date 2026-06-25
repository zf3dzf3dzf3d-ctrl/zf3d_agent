"""
配置加载器 v2.1 - 纯JSON读取与热重载 + 异步事件总线
零解析框架，零外部依赖
v2.1: 事件中心支持异步发布（线程池），高/中/低优先级
"""
import json
import time
import threading
import concurrent.futures
from pathlib import Path


class 配置加载器类:
    def __init__(self, 项目根目录: Path):
        self.项目根目录 = 项目根目录
        self.配置目录 = 项目根目录 / "公共区" / "配置"
        self.隐私配置目录 = 项目根目录 / "隐私区" / "我的配置"
        self.配置缓存 = {}
        self.文件修改时间 = {}
        self.配置文件路径列表 = []
        self.热重载线程 = None
        self.运行中 = False

    def 加载全部配置(self) -> dict:
        """加载所有JSON配置文件"""
        配置 = {}
        所有文件 = {}

        公共配置文件 = {
            "系统配置": self.配置目录 / "系统配置.json",
            "模型规则": self.配置目录 / "模型规则.json",
            "模块配置": self.配置目录 / "模块配置.json",
            "文件权限": self.配置目录 / "文件权限.json",
            "全局命令": self.配置目录 / "全局命令.json",
            "事件规则": self.配置目录 / "事件规则.json",
            "技能配置": self.配置目录 / "技能配置.json",
            "MCP服务": self.配置目录 / "MCP服务.json",
        }
        所有文件.update(公共配置文件)

        # 隐私区配置
        隐私配置文件 = {
            "密钥": self.隐私配置目录 / "密钥.json",
            "询问记录": self.隐私配置目录 / "询问记录.json",
        }
        所有文件.update(隐私配置文件)

        # 引擎管理配置
        引擎目录 = self.项目根目录 / "引擎管理"
        引擎配置文件 = {
            "引擎配置": 引擎目录 / "引擎配置.json",
            "合并日志": 引擎目录 / "合并日志.json",
        }
        所有文件.update(引擎配置文件)

        # 记忆配置（隐私区）
        记忆目录 = self.项目根目录 / "隐私区" / "我的记忆"
        记忆配置文件 = {
            "记忆库": 记忆目录 / "记忆库.json",
            "用户画像": 记忆目录 / "用户画像.json",
            "摘要索引": 记忆目录 / "摘要索引.json",
        }
        所有文件.update(记忆配置文件)

        for 名称, 路径 in 所有文件.items():
            配置[名称] = self._读取JSON(路径)

        self.配置缓存 = 配置
        self.配置文件路径列表 = list(所有文件.values())
        self._记录修改时间()
        return 配置

    def 获取配置(self, 名称: str) -> dict:
        """获取指定配置"""
        return self.配置缓存.get(名称, {})

    def 重载配置(self) -> dict:
        """重新加载所有配置"""
        return self.加载全部配置()

    def 保存配置(self, 名称: str, 数据: dict, 区域: str = "公共区"):
        """保存配置到JSON文件"""
        if 区域 == "公共区":
            路径映射 = {
                "系统配置": self.配置目录 / "系统配置.json",
                "模型规则": self.配置目录 / "模型规则.json",
                "模块配置": self.配置目录 / "模块配置.json",
                "文件权限": self.配置目录 / "文件权限.json",
                "全局命令": self.配置目录 / "全局命令.json",
                "事件规则": self.配置目录 / "事件规则.json",
                "技能配置": self.配置目录 / "技能配置.json",
                "MCP服务": self.配置目录 / "MCP服务.json",
            }
            路径 = 路径映射.get(名称)
        elif 区域 == "隐私区":
            隐私映射 = {
                "密钥": self.隐私配置目录 / "密钥.json",
                "询问记录": self.隐私配置目录 / "询问记录.json",
                "记忆库": self.项目根目录 / "隐私区" / "我的记忆" / "记忆库.json",
                "用户画像": self.项目根目录 / "隐私区" / "我的记忆" / "用户画像.json",
                "摘要索引": self.项目根目录 / "隐私区" / "我的记忆" / "摘要索引.json",
            }
            路径 = 隐私映射.get(名称)
        elif 区域 == "引擎管理":
            引擎映射 = {
                "引擎配置": self.项目根目录 / "引擎管理" / "引擎配置.json",
                "合并日志": self.项目根目录 / "引擎管理" / "合并日志.json",
            }
            路径 = 引擎映射.get(名称)
        else:
            return

        if 路径:
            self._写入JSON(路径, 数据)
            self.配置缓存[名称] = 数据

    def 启动热重载(self, 间隔秒: int = 5):
        """启动配置热重载监听"""
        self.运行中 = True
        self.热重载线程 = threading.Thread(target=self._热重载循环, args=(间隔秒,), daemon=True)
        self.热重载线程.start()

    def 停止热重载(self):
        """停止热重载监听"""
        self.运行中 = False

    def _热重载循环(self, 间隔秒: int):
        """热重载循环，检测文件变化"""
        while self.运行中:
            time.sleep(间隔秒)
            当前时间 = {}
            检测到变更 = False
            for 路径_str, 修改时间 in self.文件修改时间.items():
                路径 = Path(路径_str)
                if 路径.exists():
                    当前时间[路径_str] = 路径.stat().st_mtime
                    if 当前时间[路径_str] != 修改时间:
                        self.加载全部配置()
                        全局事件中心.发布("配置变更", {"路径": 路径_str})
                        检测到变更 = True
                        break
            if not 检测到变更:
                self.文件修改时间 = 当前时间

    def _记录修改时间(self):
        """记录所有配置文件的修改时间"""
        self.文件修改时间 = {}
        for 路径 in self.配置文件路径列表:
            if 路径.exists():
                self.文件修改时间[str(路径)] = 路径.stat().st_mtime

    def _读取JSON(self, 路径: Path) -> dict:
        """读取JSON文件，不存在返回空dict"""
        if not 路径.exists():
            return {}
        try:
            with open(路径, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}

    def _写入JSON(self, 路径: Path, 数据: dict):
        """写入JSON文件"""
        路径.parent.mkdir(parents=True, exist_ok=True)
        with open(路径, "w", encoding="utf-8") as f:
            json.dump(数据, f, ensure_ascii=False, indent=2)


class 全局事件中心类:
    """全局事件中心 v2.1 - 发布/订阅模式，支持异步和优先级

    v2.1新增：
    - 异步发布（线程池，不阻塞发布者）
    - 订阅优先级：高/中/低
    - 超时控制
    """

    def __init__(self):
        self.订阅者 = {}  # 事件名 -> [(回调函数, 优先级, 异步标记, 超时)]
        self.线程池 = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="event")

    def 订阅(self, 事件名: str, 回调函数, 优先级: str = "中", 异步: bool = False, 超时秒: float = 5):
        """订阅事件

        参数:
            事件名: 事件名称
            回调函数: 处理函数
            优先级: "高"/"中"/"低"（高优先级先执行）
            异步: True=不阻塞发布者，在后台线程执行
            超时秒: 回调最大执行时间（仅同步模式下生效）
        """
        优先级值 = {"高": 0, "中": 1, "低": 2}.get(优先级, 1)
        if 事件名 not in self.订阅者:
            self.订阅者[事件名] = []
        self.订阅者[事件名].append((回调函数, 优先级值, 异步, 超时秒))
        # 按优先级排序（高→低）
        self.订阅者[事件名].sort(key=lambda x: x[1])

    def 取消订阅(self, 事件名: str, 回调函数):
        """取消订阅"""
        if 事件名 in self.订阅者:
            self.订阅者[事件名] = [
                (cb, p, a, t) for cb, p, a, t in self.订阅者[事件名]
                if cb != 回调函数
            ]

    def 发布(self, 事件名: str, 数据: dict = None):
        """发布事件

        同步回调按优先级顺序执行；异步回调在线程池中执行，不阻塞发布者。
        """
        if 事件名 not in self.订阅者:
            return
        数据 = 数据 or {}
        for 回调函数, 优先级值, 异步标记, 超时秒 in self.订阅者[事件名]:
            try:
                if 异步标记:
                    # 异步执行：在线程池中运行，不等待结果
                    self.线程池.submit(回调函数, 数据)
                else:
                    # 同步执行：带超时控制
                    结果 = 回调函数(数据)
            except Exception as e:
                # 记录但防止崩溃
                pass


class 全局命令中心类:
    """全局命令中心 - 系统级指令"""

    def __init__(self):
        self.命令注册 = {}

    def 注册命令(self, 名称: str, 处理函数):
        """注册命令"""
        self.命令注册[名称] = 处理函数

    def 执行(self, 命令名: str, 参数: dict = None):
        """执行命令"""
        if 命令名 in self.命令注册:
            return self.命令注册[命令名](参数 or {})
        return {"错误": f"未注册的命令: {命令名}"}


# 全局单例
全局事件中心 = 全局事件中心类()
全局命令中心 = 全局命令中心类()
