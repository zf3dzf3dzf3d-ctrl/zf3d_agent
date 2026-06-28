"""
定时任务调度器 — Cron式定时执行操作
支持：一次性任务、周期任务、持久化存储
"""
import json
import time
import threading
from datetime import datetime, timedelta
from pathlib import Path


class 定时任务调度器:
    """定时任务调度器，在后台线程中运行"""

    def __init__(self, 操作注册中心=None, 项目根目录=None):
        self.操作注册中心 = 操作注册中心
        self.项目根目录 = Path(项目根目录) if 项目根目录 else Path(".")
        self.任务文件路径 = self.项目根目录 / "隐私区" / "我的配置" / "定时任务.json"
        self.任务列表 = []  # [{id, 名称, cron, 操作, 参数, 启用, 最后触发, 创建时间, 类型:once/repeat}]
        self.运行中 = False
        self.线程 = None
        self._加载任务()

    def 启动(self):
        """启动调度器"""
        if self.运行中:
            return
        self.运行中 = True
        self.线程 = threading.Thread(target=self._调度循环, daemon=True)
        self.线程.start()
        print(f"  ✅ 定时任务调度器已启动 ({len(self.任务列表)}个任务)")

    def 停止(self):
        """停止调度器"""
        self.运行中 = False

    def 添加任务(self, 名称: str, cron: str, 操作: str, 参数: dict = None,
                类型: str = "once") -> dict:
        """添加定时任务

        cron格式: "秒 分 时 日 月 周" (6字段, 同cron)
        或 "N秒/N分/N时" (间隔模式)

        参数:
            名称: 任务名称
            cron: 定时表达式
            操作: 要执行的操作名
            参数: 操作参数字典
            类型: once(一次性)/repeat(重复)
        """
        任务ID = f"task_{int(time.time())}_{len(self.任务列表)}"
        任务 = {
            "id": 任务ID,
            "名称": 名称,
            "cron": cron,
            "操作": 操作,
            "参数": 参数 or {},
            "类型": 类型,
            "启用": True,
            "最后触发": None,
            "创建时间": datetime.now().isoformat(),
            "触发次数": 0
        }
        self.任务列表.append(任务)
        self._保存任务()
        return {"成功": True, "id": 任务ID, "任务": 任务}

    def 移除任务(self, 任务ID: str) -> bool:
        """移除定时任务"""
        for i, t in enumerate(self.任务列表):
            if t["id"] == 任务ID:
                self.任务列表.pop(i)
                self._保存任务()
                return True
        return False

    def 列出任务(self) -> list:
        """列出所有任务"""
        return self.任务列表

    def 执行一次(self, 操作: str, 参数: dict = None) -> dict:
        """立即执行一次操作（不保存为任务）"""
        if not self.操作注册中心:
            return {"成功": False, "错误": "操作注册中心未就绪"}
        try:
            结果 = self.操作注册中心.执行(操作, 参数 or {})
            return {"成功": True, "结果": 结果}
        except Exception as e:
            return {"成功": False, "错误": str(e)}

    def _调度循环(self):
        """调度主循环（每秒检查一次）"""
        while self.运行中:
            try:
                now = datetime.now()
                for 任务 in list(self.任务列表):
                    try:
                        if not 任务.get("启用", True):
                            continue
                        if self._应触发(任务, now):
                            self._触发任务(任务)
                    except Exception as e:
                        print(f"⚠️ 定时任务执行异常: {任务.get('名称','?')} - {e}")
                        if hasattr(self, '运行诊断器') and self.运行诊断器:
                            self.运行诊断器.记录错误("定时任务._调度循环", e)
            except Exception as e:
                print(f"⚠️ 调度器异常: {e}")
                if hasattr(self, '运行诊断器') and self.运行诊断器:
                    self.运行诊断器.记录错误("定时任务._调度循环", e)
            time.sleep(1)

    def _应触发(self, 任务: dict, now: datetime) -> bool:
        """检查任务是否应在本秒触发"""
        cron = 任务.get("cron", "")
        最后触发 = 任务.get("最后触发")
        类型 = 任务.get("类型", "once")

        # 间隔模式: "N秒/N分/N时"
        if cron.endswith("秒"):
            try:
                间隔 = int(cron.replace("秒", ""))
                if 最后触发:
                    下次 = datetime.fromisoformat(最后触发) + timedelta(seconds=间隔)
                else:
                    下次 = now
                return now >= 下次
            except (ValueError, TypeError):
                return False

        if cron.endswith("分"):
            try:
                间隔 = int(cron.replace("分", "")) * 60
                if 最后触发:
                    下次 = datetime.fromisoformat(最后触发) + timedelta(seconds=间隔)
                else:
                    下次 = now
                return now >= 下次
            except (ValueError, TypeError):
                return False

        if cron.endswith("时"):
            try:
                间隔 = int(cron.replace("时", "")) * 3600
                if 最后触发:
                    下次 = datetime.fromisoformat(最后触发) + timedelta(seconds=间隔)
                else:
                    下次 = now
                return now >= 下次
            except (ValueError, TypeError):
                return False

        # 标准cron 6字段: 秒 分 时 日 月 周 (简化: 只支持精确时间)
        # 格式: "0 30 9 * * *" = 每天9:30
        try:
            字段 = cron.strip().split()
            if len(字段) == 6:
                sec, minute, hour, day, month, week = 字段
                if sec != "*" and now.second != int(sec): return False
                if minute != "*" and now.minute != int(minute): return False
                if hour != "*" and now.hour != int(hour): return False
                if day != "*" and now.day != int(day): return False
                if month != "*" and now.month != int(month): return False
                if week != "*" and now.weekday() != int(week): return False
                # 一次性任务只在指定时间触发一次
                if 类型 == "once" and 最后触发:
                    return False
                return True
        except Exception:
            pass
        return False

    def _触发任务(self, 任务: dict):
        """触发一个定时任务"""
        print(f"  ⏰ 触发定时任务: {任务['名称']}")
        任务["最后触发"] = datetime.now().isoformat()
        任务["触发次数"] = 任务.get("触发次数", 0) + 1
        self._保存任务()

        # 支持剧本类型任务
        if 任务.get("类型") == "剧本":
            try:
                from 剧本管理器 import 获取剧本管理器
                剧本管理器 = 获取剧本管理器(self.操作注册中心, str(self.项目根目录))
                结果 = 剧本管理器.回放by名称(任务.get("剧本名称", ""))
                print(f"  ✅ 剧本任务完成 [{任务['名称']}]: {结果.get('成功', False)}")
            except Exception as e:
                print(f"  ❌ 剧本任务失败 [{任务['名称']}]: {e}")
            return

        if self.操作注册中心:
            try:
                结果 = self.操作注册中心.执行(任务["操作"], 任务["参数"])
                print(f"  ✅ 定时任务完成 [{任务['名称']}]: {结果.get('成功', False)}")
            except Exception as e:
                print(f"  ❌ 定时任务失败 [{任务['名称']}]: {e}")

    def _加载任务(self):
        """从JSON加载任务列表"""
        if self.任务文件路径.exists():
            try:
                with open(self.任务文件路径, "r", encoding="utf-8") as f:
                    数据 = json.load(f)
                self.任务列表 = 数据.get("任务列表", [])
            except Exception:
                self.任务列表 = []
        else:
            self.任务列表 = []

    def _保存任务(self):
        """保存任务列表到JSON"""
        self.任务文件路径.parent.mkdir(parents=True, exist_ok=True)
        with open(self.任务文件路径, "w", encoding="utf-8") as f:
            json.dump({"任务列表": self.任务列表}, f, ensure_ascii=False, indent=2)


class 代码影响分析器:
    """分析代码变更的影响范围（跨文件引用追踪）

    通过解析Python文件的import语句，构建依赖关系图，
    当某个文件修改时，找出所有可能受影响的文件。
    """

    def __init__(self, 项目根目录: str = "."):
        self.项目根目录 = Path(项目根目录)
        self.依赖图 = {}  # 模块路径 -> [依赖该模块的文件列表]
        self.已缓存 = False

    def 构建依赖图(self) -> dict:
        """扫描所有Python文件，构建依赖关系图"""
        self.依赖图 = {}
        py文件列表 = list(self.项目根目录.rglob("*.py"))

        for 文件路径 in py文件列表:
            if "__pycache__" in str(文件路径) or ".git" in str(文件路径):
                continue
            try:
                with open(文件路径, "r", encoding="utf-8", errors="ignore") as f:
                    内容 = f.read()
                导入列表 = self._提取导入(内容)
                for 导入 in 导入列表:
                    if 导入 not in self.依赖图:
                        self.依赖图[导入] = []
                    self.依赖图[导入].append(文件路径)
            except Exception:
                continue

        self.已缓存 = True
        return self.依赖图

    def 分析影响(self, 修改文件路径: str) -> dict:
        """分析指定文件修改后会影响哪些文件

        返回:
            {
                "修改文件": "xxx.py",
                "直接依赖者": ["file1.py", "file2.py"],
                "间接影响": ["file3.py"],
                "导入链": {受影响的: [中间文件列表]}
            }
        """
        if not self.已缓存:
            self.构建依赖图()

        修改路径 = Path(修改文件路径)
        影响文件 = set()
        导入链 = {}

        # 将修改文件路径转为模块名（去掉.py，替换/为.）
        try:
            相对路径 = 修改路径.relative_to(self.项目根目录)
        except ValueError:
            相对路径 = 修改路径
        模块名 = str(相对路径.with_suffix("")).replace("\\", ".").replace("/", ".")

        # BFS搜索所有依赖此模块的文件
        已访问 = {模块名}
        队列 = [模块名]

        while 队列:
            当前模块 = 队列.pop(0)
            依赖者 = self.依赖图.get(当前模块, [])
            for 文件 in 依赖者:
                if 文件 not in 影响文件:
                    影响文件.add(文件)
                    导入链[文件] = 导入链.get(文件, []) + [当前模块]
                    # 这个文件的模块名也可能被其他文件依赖
                    try:
                        文件相对 = 文件.relative_to(self.项目根目录)
                        文件模块 = str(文件相对.with_suffix("")).replace("\\", ".").replace("/", ".")
                        if 文件模块 not in 已访问:
                            已访问.add(文件模块)
                            队列.append(文件模块)
                    except Exception:
                        pass

        直接依赖 = [str(f) for f in 影响文件 if self._直接导入(模块名, f)]
        间接依赖 = [str(f) for f in 影响文件 if not self._直接导入(模块名, f)]

        return {
            "修改文件": 修改文件路径,
            "模块名": 模块名,
            "直接依赖者": 直接依赖,
            "间接影响": 间接依赖,
            "受影响总数": len(影响文件),
            "导入链": {str(k): v for k, v in 导入链.items()}
        }

    def _提取导入(self, 代码: str) -> list:
        """从Python代码中提取所有导入的模块名"""
        导入列表 = []
        import re
        # import X, import X.Y
        for m in re.finditer(r'^\s*import\s+(\S+)', 代码, re.MULTILINE):
            模块 = m.group(1).split(" as ")[0].strip()
            # 只取顶级模块或第一级子模块
            导入列表.append(模块.split(".")[0])
        # from X import Y
        for m in re.finditer(r'^\s*from\s+(\S+)\s+import', 代码, re.MULTILINE):
            模块 = m.group(1).strip()
            导入列表.append(模块.split(".")[0])
        return [i for i in 导入列表 if i and not i.startswith("_")]

    def _直接导入(self, 目标模块: str, 文件路径: Path) -> bool:
        """检查文件是否直接导入了目标模块"""
        try:
            with open(文件路径, "r", encoding="utf-8", errors="ignore") as f:
                内容 = f.read()
            导入列表 = self._提取导入(内容)
            return 目标模块 in 导入列表 or 目标模块.split(".")[0] in 导入列表
        except Exception:
            return False
