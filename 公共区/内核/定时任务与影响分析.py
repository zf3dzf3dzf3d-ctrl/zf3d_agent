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
        self._连续触发定时器 = {}  # 任务id -> threading.Timer（成功后延迟重新触发）
        self.运行中 = False
        self.线程 = None
        self.网页端口 = 8765  # 本地Web服务端口（工作流任务调用）
        self.通知队列 = []  # 工作流任务通知 [{任务名, 状态, 时间, 消息}]
        self.执行中 = set()  # 正在执行的任务ID，防止重复触发
        self._前端在线 = False  # 前端是否在线（轮询通知时设为True）
        self._最后前端访问 = None  # 最后一次前端访问时间
        self._加载任务()

    def 启动(self):
        """启动调度器"""
        if self.运行中:
            return
        self.运行中 = True
        self.线程 = threading.Thread(target=self._调度循环, daemon=True)
        self.线程.start()

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

    # ============ 工作流定时任务 CRUD ============

    def 添加工作流任务(self, 名称: str, 工作流文件: str, 类型: str = "每日",
                       























































































































































































                       时间: str = "08:00", 星期: list = None, 间隔分钟: int = 0,
                       通知: bool = True, 日期: str = "", 成功后延迟秒数: int = 0) -> dict:
        """添加工作流定时任务"""
        任务ID = f"wftask_{int(time.time())}_{len(self.任务列表)}"
        任务 = {
            "id": 任务ID,
            "名称": 名称,
            "工作流文件": 工作流文件,
            "类型": "工作流",
            "调度类型": 类型,
            "时间": 时间,
            "星期": 星期 or [],
            "间隔分钟": 间隔分钟,
            "日期": 日期,
            "启用": True,
            "执行后通知": 通知,
            "成功后延迟秒数": 成功后延迟秒数,
            "上次执行": "",
            "下次执行": "",
            "最后触发": None,
            "触发次数": 0,
            "创建时间": datetime.now().isoformat()
        }
        self.任务列表.append(任务)
        self._保存任务()
        return {"成功": True, "任务": 任务}

    def 更新工作流任务(self, 任务ID: str, 更新dict: dict) -> dict:
        """更新工作流任务"""
        for t in self.任务列表:
            if t["id"] == 任务ID:
                t.update(更新dict)
                self._保存任务()
                return {"成功": True, "任务": t}
        return {"成功": False, "错误": "任务不存在"}

    def 删除工作流任务(self, 任务ID: str) -> dict:
        """删除工作流任务"""
        for i, t in enumerate(self.任务列表):
            if t["id"] == 任务ID:
                self.任务列表.pop(i)
                self._保存任务()
                return {"成功": True}
        return {"成功": False, "错误": "任务不存在"}

    def 获取工作流任务列表(self) -> list:
        """获取所有工作流定时任务"""
        return [t for t in self.任务列表 if t.get("类型") == "工作流"]

    def 获取工作流通知(self) -> list:
        """弹出工作流任务通知队列"""
        self._最后前端访问 = datetime.now()
        self._前端在线 = True
        通知 = list(self.通知队列)
        self.通知队列.clear()
        return 通知

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
            # 检查前端是否在线（30秒内有访问才算在线）
            if self._最后前端访问:
                self._前端在线 = (now - self._最后前端访问).total_seconds() < 30
            time.sleep(1)

    def _应触发(self, 任务: dict, now: datetime) -> bool:
        """检查任务是否应在本秒触发"""
        cron = 任务.get("cron", "")
        最后触发 = 任务.get("最后触发")
        类型 = 任务.get("类型", "once")

        # 工作流调度类型：每日/每周/间隔/仅一次（前端传入的时间格式）
        调度类型 = 任务.get("调度类型", "")
        if 调度类型:
            return self._应触发工作流(任务, now, 调度类型, 最后触发)

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

        # 工作流类型任务：通过HTTP调用工作流执行引擎
        if 任务.get("类型") == "工作流":
            任务ID = 任务.get("id", "")
            if 任务ID in self.执行中:
                return  # 已在执行，跳过
            self.执行中.add(任务ID)
            _执行成功 = False
            try:
                _执行成功 = self._执行工作流任务(任务)
            except Exception as e:
                print(f"  ❌ 工作流任务失败 [{任务['名称']}]: {e}")
            finally:
                self.执行中.discard(任务ID)
            # 成功后延迟连续执行
            _延迟秒数 = 任务.get("成功后延迟秒数", 0)
            if _执行成功 and _延迟秒数 and _延迟秒数 > 0 and 任务.get("启用", True):
                print(f"  🔄 [{任务['名称']}] 成功，{_延迟秒数}秒后自动再次执行")
                _旧定时器 = self._连续触发定时器.pop(任务ID, None)
                if _旧定时器:
                    _旧定时器.cancel()
                def _延迟触发():
                    if not 任务.get("启用", True):
                        return
                    self._连续触发定时器.pop(任务ID, None)
                    self._触发任务(任务)
                _定时器 = threading.Timer(_延迟秒数, _延迟触发)
                _定时器.daemon = True
                self._连续触发定时器[任务ID] = _定时器
                _定时器.start()
            return

        if self.操作注册中心:
            try:
                结果 = self.操作注册中心.执行(任务["操作"], 任务["参数"])
                print(f"  ✅ 定时任务完成 [{任务['名称']}]: {结果.get('成功', False)}")
            except Exception as e:
                print(f"  ❌ 定时任务失败 [{任务['名称']}]: {e}")

    def _加载任务(self):
        """从存储引擎加载任务列表"""
        try:
            from 存储引擎 import 获取存储引擎
            引擎 = 获取存储引擎()
            if 引擎:
                数据 = 引擎.读取KV_JSON("定时任务列表", {"任务列表": []})
                self.任务列表 = 数据.get("任务列表", [])
            else:
                self.任务列表 = []
        except Exception:
            self.任务列表 = []

    def _保存任务(self):
        """保存任务列表到存储引擎"""
        try:
            from 存储引擎 import 获取存储引擎
            引擎 = 获取存储引擎()
            if 引擎:
                引擎.写入KV_JSON("定时任务列表", {"任务列表": self.任务列表})
        except Exception:
            pass

    def _应触发工作流(self, 任务: dict, now: datetime, 调度类型: str, 最后触发: str) -> bool:
        """检查工作流任务是否应触发（支持每日/每周/间隔/仅一次/每月）"""
        # 前端未在线时不触发工作流（防止启动时立即执行导致失败）
        if not self._前端在线:
            return False
        if 调度类型 == "仅一次":
            # 只触发一次，已触发过则不再触发
            if 最后触发:
                return False
            日期 = 任务.get("日期", "")
            目标时间 = 任务.get("时间", "")
            if not 目标时间:
                return False
            try:
                if 日期:
                    # 格式 "YYYY-MM-DD HH:MM"
                    目标 = datetime.strptime(日期 + " " + 目标时间, "%Y-%m-%d %H:%M")
                else:
                    目标 = datetime.strptime(目标时间, "%Y-%m-%d %H:%M")
                return now >= 目标
            except ValueError:
                return False

        if 调度类型 == "每月":
            日期 = 任务.get("日期", "")
            目标时间 = 任务.get("时间", "08:00")
            try:
                时, 分 = 目标时间.split(":")
                时, 分 = int(时), int(分)
                if now.hour == 时 and now.minute == 分:
                    # 每月同一天触发
                    目标日 = int(日期.split("-")[2]) if 日期 else now.day
                    if now.day == 目标日:
                        if 最后触发:
                            上次 = datetime.fromisoformat(最后触发)
                            if (now - 上次).total_seconds() < 60:
                                return False
                        return True
            except (ValueError, TypeError):
                return False
            return False

        if 调度类型 == "每日":
            目标时间 = 任务.get("时间", "08:00")
            try:
                时, 分 = 目标时间.split(":")
                时, 分 = int(时), int(分)
                # 检查当前时间是否匹配（精确到分钟）
                if now.hour == 时 and now.minute == 分:
                    # 同一分钟不重复触发
                    if 最后触发:
                        上次 = datetime.fromisoformat(最后触发)
                        if (now - 上次).total_seconds() < 60:
                            return False
                    return True
            except (ValueError, TypeError):
                return False
            return False

        if 调度类型 == "每周":
            目标时间 = 任务.get("时间", "08:00")
            星期列表 = 任务.get("星期", [1])
            try:
                时, 分 = 目标时间.split(":")
                时, 分 = int(时), int(分)
                if now.hour == 时 and now.minute == 分:
                    if now.weekday() + 1 in 星期列表:
                        if 最后触发:
                            上次 = datetime.fromisoformat(最后触发)
                            if (now - 上次).total_seconds() < 60:
                                return False
                        return True
            except (ValueError, TypeError):
                return False
            return False

        if 调度类型 == "间隔":
            间隔分钟 = 任务.get("间隔分钟", 30)
            if not 最后触发:
                # 前端在线后首次立即触发
                return True
            # 正在执行中的任务不重复触发
            if 任务.get("id") in self.执行中:
                return False
            try:
                上次 = datetime.fromisoformat(最后触发)
                return (now - 上次).total_seconds() >= 间隔分钟 * 60
            except (ValueError, TypeError):
                return True

        return False

    def _执行工作流任务(self, 任务: dict):
        """执行工作流定时任务：读取节点图文件，通过HTTP调用执行引擎"""
        工作流文件 = 任务.get("工作流文件", "")
        if not 工作流文件:
            print(f"  ❌ 工作流任务无文件名 [{任务['名称']}]")
            return

        # 读取节点图JSON文件（支持子目录）
        节点图根 = self.项目根目录 / "节点图"
        节点图路径 = 节点图根 / f"{工作流文件}.json"
        if not 节点图路径.exists():
            # 搜索子目录
            for f in 节点图根.rglob(f"{工作流文件}.json"):
                节点图路径 = f
                break
        if not 节点图路径.exists():
            print(f"  ❌ 工作流文件不存在: {工作流文件} [{任务['名称']}]")
            return

        try:
            with open(节点图路径, "r", encoding="utf-8") as f:
                图数据 = json.loads(f.read())
        except Exception as e:
            print(f"  ❌ 读取工作流文件失败: {e} [{任务['名称']}]")
            return

        节点列表 = 图数据.get("nodes", [])
        连接列表 = 图数据.get("conns", [])
        if not 节点列表:
            print(f"  ❌ 工作流无节点 [{任务['名称']}]")
            return

        # 展平config.员工名到顶层（与前端JS逻辑一致，防止后端用节点名当员工名）
        for n in 节点列表:
            if not n.get("员工名"):
                cfg = n.get("config", {})
                n["员工名"] = cfg.get("员工名", "") or n.get("name", "")

        # 通过HTTP POST调用 /api/employee-workflow（本地回环，零网络延迟）
        # 不传当前文件夹，让后端用默认保存目录（隐私区/我的数据/AI生成图片/）
        



















































































































































































































































































































































































































































        请求体 = json.dumps({
            "节点": 节点列表,
            "连接": 连接列表,
            "当前文件夹": "",
            "source": "timer"
        }, ensure_ascii=False).encode("utf-8")

        try:
            import http.client as _http
            conn = _http.HTTPConnection("127.0.0.1", self.网页端口 or 8765, timeout=300)
            conn.request("POST", "/api/employee-workflow", body=请求体,
                        headers={"Content-Type": "application/json"})
            响应 = conn.getresponse()
            # 读取SSE流（不推送给前端，只消费直到完成）
            完成结果 = None
            while True:
                行 = 响应.readline()
                if not 行:
                    break
                行 = 行.decode("utf-8", errors="replace").strip()
                if 行.startswith("data: "):
                    try:
                        事件 = json.loads(行[6:])
                        if 事件.get("类型") == "完成":
                            完成结果 = 事件.get("结果", {})
                            break
                        # 检测弹窗提醒节点 — 立即弹桌面通知
                        if 事件.get("类型") == "节点完成" and 事件.get("alert"):
                            alert内容 = 事件.get("alert内容") or 事件.get("输出") or "提醒时间到了"
                            self._桌面通知(任务["名称"], alert内容)
                    except Exception:
                        continue
            conn.close()
            成功 = 完成结果.get("成功", False) if 完成结果 else False
            print(f"  {'✅' if 成功 else '⚠️'} 工作流任务完成 [{任务['名称']}]: {成功}")
            通知消息 = f"工作流执行{'成功' if 成功 else '失败'}"
            self.通知队列.append({
                "任务名": 任务["名称"], "状态": "完成" if 成功 else "失败",
                "时间": datetime.now().strftime("%H:%M"),
                "消息": 通知消息
            })
            # 仅工作流失败时弹桌面通知，成功时alert节点已弹过，不重复
            if not 成功:
                self._桌面通知(任务["名称"], 通知消息)
            return 成功
        except Exception as e:
            print(f"  ❌ 工作流执行失败 [{任务['名称']}]: {e}")
            self.通知队列.append({
                "任务名": 任务["名称"], "状态": "失败",
                "时间": datetime.now().strftime("%H:%M"),
                "消息": str(e)[:100]
            })
            self._桌面通知(任务["名称"], f"执行失败: {str(e)[:80]}")
            return False

    def _桌面通知(self, 标题: str, 内容: str):
        """前端在线时只推通知队列（前端弹中间弹窗），离线时弹Windows MessageBox"""
        # 先把通知加入队列（前端在线时会取走并弹窗）
        # 通知队列已在调用处添加，这里不重复
        # 如果前端不在线，弹Windows MessageBox
        if not self._前端在线:
            try:
                import ctypes
                import threading
                def _弹窗():
                    ctypes.windll.user32.MessageBoxW(0, 内容, "⏰ " + 标题, 0x00000030 | 0x00040000 | 0x00010000 | 0x00020000)
                threading.Thread(target=_弹窗, daemon=True).start()
            except Exception:
                pass
        # 更新托盘tooltip
        try:
            from ctypes import wintypes
            hwnd = ctypes.windll.user32.FindWindowW("ZF3D_Agent_Tray", "智能体托盘")
            if hwnd:
                NIM_MODIFY = 0x00000001
                NOTIFYICONDATAW = type("NOTIFYICONDATAW", (ctypes.Structure,), {
                    "_fields_": [
                        ("cbSize", wintypes.DWORD), ("hWnd", wintypes.HWND), ("uID", wintypes.UINT),
                        ("uFlags", wintypes.UINT), ("uCallbackMessage", wintypes.UINT),
                        ("hIcon", wintypes.HICON), ("szTip", wintypes.WCHAR * 128),
                        ("dwState", wintypes.DWORD), ("dwStateMask", wintypes.DWORD),
                        ("szInfo", wintypes.WCHAR * 256), ("uVersion", wintypes.UINT),
                        ("szInfoTitle", wintypes.WCHAR * 64), ("dwInfoFlags", wintypes.DWORD),
                    ]
                })
                nid2 = NOTIFYICONDATAW()
                nid2.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
                nid2.hWnd = hwnd
                nid2.uID = 1
                nid2.uFlags = 0x00000004
                nid2.szTip = ("⏰ " + 标题 + ": " + 内容)[:127]
                ctypes.windll.user32.Shell_NotifyIconW(NIM_MODIFY, ctypes.byref(nid2))
        except Exception:
            pass


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
