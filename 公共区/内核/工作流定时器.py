"""
工作流定时任务管理器 — 定时执行保存的工作流
支持：每日/每周/间隔/仅一次
"""
import json
import time
import threading
from datetime import datetime, timedelta
from pathlib import Path


class 工作流定时管理器:
    """工作流定时任务管理，后台线程每60秒检查"""

    _实例 = None

    def __init__(self, 项目根目录=None):
        self.项目根目录 = Path(项目根目录) if 项目根目录 else Path(".")
        self.任务文件 = self.项目根目录 / "隐私区" / "我的配置" / "工作流定时任务.json"
        self.任务列表 = []
        self.通知队列 = []  # [{任务名, 状态, 时间, 消息}]
        self.执行中 = set()  # 正在执行的任务ID
        self.运行中 = False
        self.线程 = None
        self._加载()

    def _加载(self):
        try:
            if self.任务文件.exists():
                self.任务列表 = json.loads(self.任务文件.read_text(encoding="utf-8"))
        except Exception:
            self.任务列表 = []

    def _保存(self):
        try:
            self.任务文件.parent.mkdir(parents=True, exist_ok=True)
            self.任务文件.write_text(json.dumps(self.任务列表, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass

    def 启动(self):
        if self.运行中:
            return
        self.运行中 = True
        self.线程 = threading.Thread(target=self._循环, daemon=True)
        self.线程.start()
        print(f"  ✅ 工作流定时任务管理器已启动 ({len(self.任务列表)}个任务)")

    def 停止(self):
        self.运行中 = False

    def _循环(self):
        while self.运行中:
            try:
                now = datetime.now()
                for task in self.任务列表:
                    if not task.get("启用", True):
                        continue
                    tid = task.get("id", "")
                    if tid in self.执行中:
                        continue
                    下次 = task.get("下次执行", "")
                    if not 下次:
                        下次 = self._计算下次(task)
                        task["下次执行"] = 下次
                        self._保存()
                    if 下次 and now.strftime("%Y-%m-%d %H:%M") >= 下次:
                        self._执行任务(task)
            except Exception as e:
                print(f"  [WF定时] 检查异常: {e}")
            time.sleep(60)

    def _计算下次(self, task):
        now = datetime.now()
        t类型 = task.get("类型", "每日")
        if t类型 == "每日":
            t = task.get("时间", "08:00")
            明天 = now + timedelta(days=1)
            return f"{明天.strftime('%Y-%m-%d')} {t}"
        elif t类型 == "每周":
            t = task.get("时间", "08:00")
            星期 = task.get("星期", [1])
            for i in range(1, 8):
                候选 = now + timedelta(days=i)
                if 候选.weekday() + 1 in 星期:
                    return f"{候选.strftime('%Y-%m-%d')} {t}"
            return ""
        elif t类型 == "间隔":
            间隔 = task.get("间隔分钟", 30)
            下次 = now + timedelta(minutes=间隔)
            return 下次.strftime("%Y-%m-%d %H:%M")
        elif t类型 == "仅一次":
            return task.get("时间", "")
        return ""

    def _执行任务(self, task):
        tid = task.get("id", "")
        名称 = task.get("名称", "")
        工作流文件 = task.get("工作流文件", "")
        self.执行中.add(tid)
        print(f"  [WF定时] 执行任务: {名称} ({工作流文件})")

        def _后台执行():
            try:
                # 读取工作流
                wf路径 = self.项目根目录 / "节点图" / f"{工作流文件}.json"
                if not wf路径.exists():
                    self.通知队列.append({"任务名": 名称, "状态": "失败", "时间": datetime.now().strftime("%H:%M"), "消息": f"工作流文件不存在: {工作流文件}"})
                    return
                wf数据 = json.loads(wf路径.read_text(encoding="utf-8"))
                节点列表 = wf数据.get("nodes", [])
                连接列表 = wf数据.get("conns", [])
                if not 节点列表:
                    self.通知队列.append({"任务名": 名称, "状态": "失败", "时间": datetime.now().strftime("%H:%M"), "消息": "工作流无节点"})
                    return

                # 调用工作流执行引擎
                from 网页服务 import 网页请求处理器
                handler = 网页请求处理器.__new__(网页请求处理器)
                # 构建节点映射
                节点映射 = {n["id"]: n for n in 节点列表}
                出边 = {n["id"]: [] for n in 节点列表}
                入边 = {n["id"]: [] for n in 节点列表}
                for c in 连接列表:
                    if c["from"] in 出边:
                        出边[c["from"]].append(c["to"])
                    if c["to"] in 入边:
                        入边[c["to"]].append(c["from"])

                节点输出 = {}
                # 拓扑排序
                层级 = {}
                for n in 节点列表:
                    nid = n["id"]
                    if nid not in 入边 or not 入边[nid]:
                        层级[nid] = 0
                    else:
                        层级[nid] = max(层级.get(uid, 0) + 1 for uid in 入边[nid])
                排序节点 = sorted(节点列表, key=lambda n: 层级.get(n["id"], 0))

                # 简化执行：只执行text/prompt/comfyui节点（零token节点）
                import time as _t
                for node in 排序节点:
                    nid = node["id"]
                    ntype = node.get("type", "")
                    config = node.get("config", {})
                    if ntype in ("prompt", "文本输入"):
                        节点输出[nid] = config.get("提示词") or config.get("prompt") or ""
                    elif ntype in ("text", "文本"):
                        指令 = config.get("指令") or ""
                        上游 = " ".join(节点输出.get(uid, "") for uid in 入边.get(nid, []))
                        节点输出[nid] = (上游 + 指令) if 上游 and 指令 else (指令 or 上游)
                    elif ntype in ("employee", "员工"):
                        # 需要LLM，跳过定时执行
                        节点输出[nid] = "[定时任务不支持LLM节点]"
                    elif ntype in ("comfyui", "生图"):
                        节点输出[nid] = "[定时任务不支持ComfyUI节点]"
                    elif ntype in ("print", "打印"):
                        节点输出[nid] = " ".join(节点输出.get(uid, "") for uid in 入边.get(nid, []))

                # 更新任务状态
                task["上次执行"] = datetime.now().strftime("%Y-%m-%d %H:%M")
                task["执行次数"] = task.get("执行次数", 0) + 1
                if task.get("类型") == "仅一次":
                    task["启用"] = False
                else:
                    task["下次执行"] = self._计算下次(task)
                self._保存()

                self.通知队列.append({"任务名": 名称, "状态": "完成", "时间": datetime.now().strftime("%H:%M"), "消息": f"工作流已执行({len(排序节点)}个节点)"})
                print(f"  [WF定时] 任务完成: {名称}")

            except Exception as e:
                self.通知队列.append({"任务名": 名称, "状态": "失败", "时间": datetime.now().strftime("%H:%M"), "消息": str(e)})
                print(f"  [WF定时] 任务失败: {名称} - {e}")
            finally:
                self.执行中.discard(tid)

        threading.Thread(target=_后台执行, daemon=True).start()

    def 添加任务(self, 名称, 工作流文件, 类型="每日", 时间="08:00", 星期=None, 间隔分钟=0, 通知=True):
        tid = f"wftask_{int(time.time())}_{len(self.任务列表)}"
        task = {
            "id": tid,
            "名称": 名称,
            "工作流文件": 工作流文件,
            "类型": 类型,
            "时间": 时间,
            "星期": 星期 or [],
            "间隔分钟": 间隔分钟,
            "启用": True,
            "执行后通知": 通知,
            "上次执行": "",
            "下次执行": "",
            "执行次数": 0
        }
        task["下次执行"] = self._计算下次(task)
        self.任务列表.append(task)
        self._保存()
        return task

    def 更新任务(self, tid, 更新dict):
        for t in self.任务列表:
            if t["id"] == tid:
                t.update(更新dict)
                if "类型" in 更新dict or "时间" in 更新dict or "间隔分钟" in 更新dict:
                    t["下次执行"] = self._计算下次(t)
                self._保存()
                return t
        return None

    def 删除任务(self, tid):
        self.任务列表 = [t for t in self.任务列表 if t["id"] != tid]
        self._保存()

    def 获取通知(self):
        n = list(self.通知队列)
        self.通知队列.clear()
        return n

    @classmethod
    def 获取实例(cls):
        if cls._实例 is None:
            cls._实例 = cls()
        return cls._实例
