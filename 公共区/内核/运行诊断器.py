"""
运行诊断器 v1.0 — 运行时异常自动捕获 + JSON持久化 + 监控规则引擎
系统运行出错时自动写入诊断JSON, AI可读取分析, 也可写入监控规则让系统按规则检查

两个核心文件:
  隐私区/我的日志/运行诊断.json  — 错误/警告记录
  隐私区/我的配置/监控规则.json  — AI写入的监控规则
"""
import json
import time
import threading
import traceback
from pathlib import Path
from datetime import datetime


class 运行诊断器类:
    _实例引用 = None  # 全局单例引用

    def __init__(self, 项目根目录: Path):
        self.项目根目录 = 项目根目录
        self.诊断文件路径 = 项目根目录 / "隐私区" / "我的日志" / "运行诊断.json"
        self.规则文件路径 = 项目根目录 / "隐私区" / "我的配置" / "监控规则.json"
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

        # 确保目录存在（兼容旧文件）
        self.诊断文件路径.parent.mkdir(parents=True, exist_ok=True)
        self.规则文件路径.parent.mkdir(parents=True, exist_ok=True)
        运行诊断器类._实例引用 = self

    def _初始化文件(self):
        """兼容旧JSON文件（仅首次迁移用）"""
        if not self.诊断文件路径.exists():
            with open(self.诊断文件路径, "w", encoding="utf-8") as f:
                json.dump({"错误列表": [], "警告列表": [], "统计": {"总错误": 0, "总警告": 0}}, f, ensure_ascii=False, indent=2)
        if not self.规则文件路径.exists():
            with open(self.规则文件路径, "w", encoding="utf-8") as f:
                json.dump({"规则列表": []}, f, ensure_ascii=False, indent=2)

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
                # SQLite增量插入（不全量读写）
                self.存储引擎.插入诊断记录(记录)
                self._错误计数 += 1
            else:
                # fallback到JSON
                数据 = self._读取诊断()
                数据["错误列表"].append(记录)
                未解决 = [e for e in 数据["错误列表"] if not e["已解决"]]
                已解决 = [e for e in 数据["错误列表"] if e["已解决"]]
                if len(未解决) > self._最大记录数:
                    未解决 = 未解决[-self._最大记录数:]
                if len(已解决) > self._最大记录数 // 2:
                    已解决 = 已解决[-(self._最大记录数 // 2):]
                数据["错误列表"] = 未解决 + 已解决
                数据["统计"]["总错误"] = (数据["统计"].get("总错误", 0) + 1)
                self._写入诊断(数据)
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
            else:
                数据 = self._读取诊断()
                数据["警告列表"].append(记录)
                if len(数据["警告列表"]) > self._最大记录数:
                    数据["警告列表"] = 数据["警告列表"][-self._最大记录数:]
                数据["统计"]["总警告"] = (数据["统计"].get("总警告", 0) + 1)
                self._写入诊断(数据)
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
                return {
                    "成功": True,
                    "错误列表": 错误列表,
                    "警告列表": 警告列表,
                    "统计": 统计,
                    "本次运行": {"错误": self._错误计数, "警告": self._警告计数}
                }
            # fallback到JSON
            数据 = self._读取诊断()
            错误列表 = 数据.get("错误列表", [])
            警告列表 = 数据.get("警告列表", [])

            if 未解决Only:
                错误列表 = [e for e in 错误列表 if not e.get("已解决")]
                警告列表 = [w for w in 警告列表 if not w.get("已解决")]

            # 按时间倒序
            错误列表 = sorted(错误列表, key=lambda x: x.get("时间", ""), reverse=True)[:最近数]
            警告列表 = sorted(警告列表, key=lambda x: x.get("时间", ""), reverse=True)[:最近数]

            return {
                "成功": True,
                "错误列表": 错误列表,
                "警告列表": 警告列表,
                "统计": 数据.get("统计", {}),
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
                return {"成功": True, "已标记": 标记数}
            # fallback到JSON
            数据 = self._读取诊断()
            标记数 = 0
            for 错误 in 数据["错误列表"]:
                if 错误ID and 错误.get("id") == 错误ID:
                    错误["已解决"] = True
                    错误["解决说明"] = 解决说明
                    标记数 += 1
                elif not 错误ID and not 错误.get("已解决"):
                    错误["已解决"] = True
                    错误["解决说明"] = 解决说明 or "AI批量标记已解决"
                    标记数 += 1
            for 警告 in 数据["警告列表"]:
                if 错误ID and 警告.get("id") == 错误ID:
                    警告["已解决"] = True
                    标记数 += 1
                elif not 错误ID and not 警告.get("已解决"):
                    警告["已解决"] = True
                    标记数 += 1
            self._写入诊断(数据)
            return {"成功": True, "已标记": 标记数}

    def 清除已解决(self) -> dict:
        """清除所有已解决的记录"""
        with self._锁:
            if self.存储引擎:
                结果 = self.存储引擎.清除已解决诊断()
                return {"成功": True, "清除错误": 结果.get("清除数", 0), "清除警告": 0}
            # fallback到JSON
            数据 = self._读取诊断()
            错误前 = len(数据["错误列表"])
            警告前 = len(数据["警告列表"])
            数据["错误列表"] = [e for e in 数据["错误列表"] if not e.get("已解决")]
            数据["警告列表"] = [w for w in 数据["警告列表"] if not w.get("已解决")]
            self._写入诊断(数据)
            return {"成功": True, "清除错误": 错误前 - len(数据["错误列表"]), "清除警告": 警告前 - len(数据["警告列表"])}

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
            else:
                规则列表 = self._读取规则()
                规则列表["规则列表"].append(规则)
                self._写入规则(规则列表)
        return {"成功": True, "规则ID": 规则["id"]}

    def 删除规则(self, 规则ID: str) -> dict:
        """删除一条监控规则"""
        with self._规则锁:
            if self.存储引擎:
                if self.存储引擎.删除监控规则(规则ID):
                    return {"成功": True}
                return {"成功": False, "错误": "规则不存在"}
            规则列表 = self._读取规则()
            原数 = len(规则列表["规则列表"])
            规则列表["规则列表"] = [r for r in 规则列表["规则列表"] if r.get("id") != 规则ID]
            self._写入规则(规则列表)
            if len(规则列表["规则列表"]) < 原数:
                return {"成功": True}
            return {"成功": False, "错误": "规则不存在"}

    def 查询规则(self) -> dict:
        """查询所有监控规则"""
        with self._规则锁:
            if self.存储引擎:
                return {"成功": True, "规则列表": self.存储引擎.查询监控规则()}
            规则列表 = self._读取规则()
            return {"成功": True, "规则列表": 规则列表["规则列表"]}

    def _检查规则触发(self, 记录: dict):
        """当有错误/警告产生时，检查是否匹配监控规则"""
        try:
            with self._规则锁:
                if self.存储引擎:
                    规则列表 = self.存储引擎.查询监控规则()
                else:
                    规则列表 = self._读取规则().get("规则列表", [])
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
                    if 命中 and self.存储引擎:
                        self.存储引擎.更新规则触发(规则["id"], datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
                    elif 命中:
                        规则["触发次数"] = 规则.get("触发次数", 0) + 1
                        规则["最后触发"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                if not self.存储引擎:
                    self._写入规则({"规则列表": 规则列表})
        except Exception:
            pass

    # ========== 文件读写 ==========

    def _读取诊断(self) -> dict:
        try:
            with open(self.诊断文件路径, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {"错误列表": [], "警告列表": [], "统计": {"总错误": 0, "总警告": 0}}

    def _写入诊断(self, 数据: dict):
        with open(self.诊断文件路径, "w", encoding="utf-8") as f:
            json.dump(数据, f, ensure_ascii=False, indent=2)

    def _读取规则(self) -> dict:
        try:
            with open(self.规则文件路径, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {"规则列表": []}

    def _写入规则(self, 数据: dict):
        with open(self.规则文件路径, "w", encoding="utf-8") as f:
            json.dump(数据, f, ensure_ascii=False, indent=2)

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
