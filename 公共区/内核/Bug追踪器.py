"""
Bug追踪器 — 代码级Bug的SQLite持久化追踪

自进化引擎发现Bug时写入，修复后标记已解决。
AI和开发者均可通过操作或直接调用来查询当前所有Bug。

数据存储: 通过存储引擎统一持久化到 隐私区/我的数据/智能体.db 的 Bug库 表
"""
import threading
from pathlib import Path


class Bug追踪器类:
    _实例引用 = None  # 全局单例引用

    def __init__(self, 项目根目录: Path):
        self.项目根目录 = 项目根目录
        self._锁 = threading.Lock()

        try:
            from 存储引擎 import 获取存储引擎
            db路径 = str(项目根目录 / "隐私区" / "我的数据" / "智能体.db")
            self.存储引擎 = 获取存储引擎(db路径)
        except Exception:
            self.存储引擎 = None

        Bug追踪器类._实例引用 = self

    def 记录Bug(self, 文件路径: str, 问题描述: str, 行号: int = 0,
                严重程度: str = "中", 发现来源: str = "AI检查", 修复代码: str = "") -> dict:
        """记录一条代码Bug

        参数:
            文件路径: 相对于项目根目录的路径，如 "公共区/内核/系统托盘.py"
            问题描述: Bug的具体描述
            行号: 行号（0表示不指定）
            严重程度: 高/中/低
            发现来源: 谁发现的，如"自进化引擎"、"AI检查"、"人工"
            修复代码: 建议的修复代码
        """
        with self._锁:
            if not self.存储引擎:
                return {"成功": False, "错误": "存储引擎未初始化"}
            bug_id = self.存储引擎.插入Bug(
                文件路径=文件路径, 问题描述=问题描述, 行号=行号,
                严重程度=严重程度, 发现来源=发现来源, 修复代码=修复代码
            )
            print(f"  [Bug追踪器] 已记录 Bug#{bug_id}: {文件路径}:{行号} — {问题描述[:80]}")
            return {"成功": True, "BugID": bug_id}

    def 解决Bug(self, bug_id: int, 修复说明: str = "", 修复代码: str = "") -> dict:
        """标记Bug为已解决

        参数:
            bug_id: Bug记录ID
            修复说明: 怎么修的
            修复代码: 实际修复代码
        """
        with self._锁:
            if not self.存储引擎:
                return {"成功": False, "错误": "存储引擎未初始化"}
            成功 = self.存储引擎.解决Bug(bug_id, 修复说明, 修复代码)
            if 成功:
                print(f"  [Bug追踪器] Bug#{bug_id} 已标记为已解决: {修复说明[:80]}")
                return {"成功": True}
            return {"成功": False, "错误": f"Bug#{bug_id}不存在或已解决"}

    def 查询Bug(self, 未解决Only: bool = True, 文件路径: str = None) -> dict:
        """查询Bug列表

        参数:
            未解决Only: True=只看未解决, False=看全部
            文件路径: 按文件路径过滤（模糊匹配）
        """
        with self._锁:
            if not self.存储引擎:
                return {"成功": False, "错误": "存储引擎未初始化", "Bug列表": []}
            bug列表 = self.存储引擎.查询Bug(未解决Only=未解决Only, 文件路径=文件路径)
            统计 = self.存储引擎.Bug统计()
            return {
                "成功": True,
                "Bug列表": bug列表,
                "统计": 统计
            }

    def 搜索Bug(self, 关键词: str) -> dict:
        """全文搜索Bug"""
        with self._锁:
            if not self.存储引擎:
                return {"成功": False, "错误": "存储引擎未初始化", "结果": []}
            结果 = self.存储引擎.搜索Bug(关键词)
            return {"成功": True, "结果": 结果}

    def 统计(self) -> dict:
        """获取Bug统计"""
        with self._锁:
            if not self.存储引擎:
                return {"总数": 0, "未解决": 0, "已解决": 0}
            return self.存储引擎.Bug统计()

    def 删除Bug(self, bug_id: int) -> dict:
        """删除一条Bug记录"""
        with self._锁:
            if not self.存储引擎:
                return {"成功": False, "错误": "存储引擎未初始化"}
            成功 = self.存储引擎.删除Bug(bug_id)
            if 成功:
                return {"成功": True}
            return {"成功": False, "错误": f"Bug#{bug_id}不存在"}

    def 格式化Bug列表(self, 未解决Only: bool = True) -> str:
        """格式化Bug列表为可读文本，一句话查看所有Bug"""
        结果 = self.查询Bug(未解决Only=未解决Only)
        if not 结果.get("成功"):
            return "❌ 无法查询Bug库"
        bug列表 = 结果.get("Bug列表", [])
        统计 = 结果.get("统计", {})
        if not bug列表:
            return f"✅ 无未解决Bug（总计{统计.get('总数',0)}条，已解决{统计.get('已解决',0)}条）"

        行 = []
        行.append(f"📋 Bug列表 — 未解决{统计.get('未解决',0)}条 / 总计{统计.get('总数',0)}条 / 已解决{统计.get('已解决',0)}条")
        行.append("=" * 60)
        for bug in bug列表:
            严重图标 = {"高": "🔴", "中": "🟡", "低": "🟢"}.get(bug.get("严重程度", "中"), "🟡")
            状态图标 = "❌" if bug.get("状态") == "未解决" else "✅"
            行号 = f":{bug['行号']}" if bug.get("行号") else ""
            行.append(f"{状态图标} #{bug['id']} {严重图标} {bug['文件路径']}{行号}")
            行.append(f"    {bug['问题描述']}")
            if bug.get("发现来源"):
                行.append(f"    来源: {bug['发现来源']} | 发现: {bug.get('发现时间','')}")
            if bug.get("修复说明"):
                行.append(f"    修复: {bug['修复说明'][:100]} | 修复时间: {bug.get('修复时间','')}")
            行.append("")

        return "\n".join(行)
