"""
运行诊断器 v1.0 — 运行时异常自动捕获 + SQLite持久化 + 监控规则引擎
系统运行出错时自动写入SQLite诊断库, AI可读取分析, 也可写入监控规则让系统按规则检查

数据存储:
  通过SQLite存储引擎统一持久化 — 错误/警告记录 + AI写入的监控规则
"""
import time
import threading
import traceback
from pathlib import Path
from datetime import datetime


class 运行诊断器类:
    _实例引用 = None  # 全局单例引用

    def __init__(self, 项目根目录: Path):
        self.项目根目录 = 项目根目录
        self._锁 = threading.Lock()
        self._规则锁 = threading.Lock()
        self._错误计数 = 0
        self._警告计数 = 0
        self._最大记录数 = 200  # 超过自动清理旧的

        # 接入SQLite存储引擎
        try:
            from 存储引擎 import 获取存储引擎
            db路径 = str(项目根目录 / "隐私区" / "我的数据" / "智能体.db")
            self.存储引擎 = 获取存储引擎(db路径)
        except Exception:
            self.存储引擎 = None

        # 确保目录存在
        (项目根目录 / "隐私区" / "我的日志").mkdir(parents=True, exist_ok=True)
        (项目根目录 / "隐私区" / "我的配置").mkdir(parents=True, exist_ok=True)
        运行诊断器类._实例引用 = self

    # ========== 异常捕获 ==========

    def 记录错误(self, 来源: str, 异常对象: Exception = None, 异常类型: str = "", 异常信息: str = "", 堆栈: str = ""):
        """记录一条运行时错误"""
        if 异常对象:
            异常类型 = 异常类型 or type(异常对象).__name__
            异常信息 = 异常信息 or str(异常对象)
            堆栈 = 堆栈 or "".join(traceback.format_exception(type(异常对象), 异常对象, 异常对象.__traceback__))

        记录 = {
            "id": f"err_{int(time.time() * 1000)}",
            "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "级别": "错误",
            "来源": 来源,
            "异常类型": 异常类型,
            "异常信息": 异常信息[:1000],
            "堆栈": 堆栈[:3000] if 堆栈 else "",
            "已解决": False,
            "解决说明": ""
        }

        with self._锁:
            if self.存储引擎:
                self.存储引擎.插入诊断记录(记录)
            self._错误计数 += 1

        # 检查监控规则
        self._检查规则触发(记录)
        print(f"  [诊断器] 错误已记录: {来源} — {异常类型}: {异常信息[:80]}")
        return 记录["id"]

    def 记录警告(self, 来源: str, 信息: str):
        """记录一条运行时警告"""
        记录 = {
            "id": f"warn_{int(time.time() * 1000)}",
            "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "级别": "警告",
            "来源": 来源,
            "信息": 信息[:500],
            "已解决": False
        }

        with self._锁:
            if self.存储引擎:
                self.存储引擎.插入诊断记录(记录)
            self._警告计数 += 1

        self._检查规则触发(记录)
        return 记录["id"]

    # ========== AI查询接口 ==========

    def 查询错误(self, 未解决Only: bool = False, 最近数: int = 20) -> dict:
        """查询运行错误记录"""
        with self._锁:
            if self.存储引擎:
                错误列表 = self.存储引擎.查询诊断记录(级别="错误", 未解决Only=未解决Only, 最近数=最近数)
                警告列表 = self.存储引擎.查询诊断记录(级别="警告", 未解决Only=未解决Only, 最近数=最近数)
                统计 = self.存储引擎.诊断统计()
            else:
                错误列表 = []
                警告列表 = []
                统计 = {"总错误": 0, "总警告": 0}
            return {
                "成功": True,
                "错误列表": 错误列表,
                "警告列表": 警告列表,
                "统计": 统计,
                "本次运行": {"错误": self._错误计数, "警告": self._警告计数}
            }

    def 解决错误(self, 错误ID: str = "", 解决说明: str = "") -> dict:
        """标记错误为已解决"""
        with self._锁:
            if self.存储引擎:
                if 错误ID:
                    标记数 = self.存储引擎.解决诊断记录(记录ID=错误ID, 解决说明=解决说明)
                else:
                    标记数 = self.存储引擎.解决诊断记录(全部未解决=True, 解决说明=解决说明)
            else:
                标记数 = 0
            return {"成功": True, "已标记": 标记数}

    def 清除已解决(self) -> dict:
        """清除所有已解决的记录"""
        with self._锁:
            if self.存储引擎:
                结果 = self.存储引擎.清除已解决诊断()
                清除数 = 结果.get("清除数", 0)
            else:
                清除数 = 0
            return {"成功": True, "清除错误": 清除数, "清除警告": 0}

    # ========== 监控规则引擎 ==========

    def 添加规则(self, 名称: str, 目标模块: str = "", 目标函数: str = "", 异常类型: str = "", 关键字: str = "", 动作: str = "记录") -> dict:
        """添加一条监控规则"""
        规则 = {
            "id": f"rule_{int(time.time() * 1000)}",
            "名称": 名称,
            "目标模块": 目标模块,
            "目标函数": 目标函数,
            "异常类型": 异常类型,
            "关键字": 关键字,
            "动作": 动作,
            "启用": True,
            "创建者": "AI",
            "创建时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "触发次数": 0,
            "最后触发": ""
        }
        with self._规则锁:
            if self.存储引擎:
                self.存储引擎.插入监控规则(规则)
        return {"成功": True, "规则ID": 规则["id"]}

    def 删除规则(self, 规则ID: str) -> dict:
        """删除一条监控规则"""
        with self._规则锁:
            if self.存储引擎:
                if self.存储引擎.删除监控规则(规则ID):
                    return {"成功": True}
                return {"成功": False, "错误": "规则不存在"}
            return {"成功": False, "错误": "规则不存在"}

    def 查询规则(self) -> dict:
        """查询所有监控规则"""
        with self._规则锁:
            if self.存储引擎:
                规则列表 = self.存储引擎.查询监控规则()
            else:
                规则列表 = []
            return {"成功": True, "规则列表": 规则列表}

    def _检查规则触发(self, 记录: dict):
        """当有错误/警告产生时，检查是否匹配监控规则"""
        try:
            with self._规则锁:
                if not self.存储引擎:
                    return
                规则列表 = self.存储引擎.查询监控规则()
                for 规则 in 规则列表:
                    if not 规则.get("启用", True):
                        continue
                    命中 = True
                    if 规则.get("目标模块") and 规则["目标模块"] not in 记录.get("来源", ""):
                        命中 = False
                    if 规则.get("目标函数") and 命中 and 规则["目标函数"] not in 记录.get("来源", ""):
                        命中 = False
                    if 规则.get("异常类型") and 命中 and 规则["异常类型"] != 记录.get("异常类型", ""):
                        命中 = False
                    if 规则.get("关键字") and 命中:
                        信息 = 记录.get("异常信息", "") or 记录.get("信息", "")
                        if 规则["关键字"] not in 信息:
                            命中 = False
                    if 命中:
                        self.存储引擎.更新规则触发(规则["id"], datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        except Exception:
            pass

    # ========== 便捷方法 ==========

    def 捕获异常(self, 来源: str):
        """上下文管理器用法: with 诊断器.捕获异常('模块.函数'): ..."""
        return _异常捕获上下文(self, 来源)

    def 包装函数(self, 来源: str, 函数):
        """装饰器: 包装函数自动捕获异常"""
        def 包装(*args, **kwargs):
            try:
                return 函数(*args, **kwargs)
            except Exception as e:
                self.记录错误(来源, e)
                raise
        return 包装


class _异常捕获上下文:
    """上下文管理器: with 诊断器.捕获异常('来源'): ..."""
    def __init__(self, 诊断器, 来源):
        self.诊断器 = 诊断器
        self.来源 = 来源

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            self.诊断器.记录错误(self.来源, exc_val)
            # 不吞异常, 继续抛出
            return False
        return False
