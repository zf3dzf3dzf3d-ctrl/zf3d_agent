"""
剧本管理器 — 操作录制+回放+变量传递+定时执行
扩展定时任务骨架，实现"录制操作步骤→保存为JSON剧本→一键回放/定时执行"

剧本格式（JSON）:
{
  "名称": "示例剧本",
  "创建时间": "2026-06-24 10:00:00",
  "步骤": [
    {"序号": 1, "操作": "网络搜索", "参数": {"查询": "AI新闻"}, "等待完成": true},
    {"序号": 2, "操作": "写入文件", "参数": {"路径": "./result.txt", "内容": "${步骤1.结果}"}, "等待完成": true}
  ]
}
"""
import json
import threading
from pathlib import Path
from datetime import datetime


class 剧本管理器:
    """操作录制与回放管理器"""

    def __init__(self, 操作注册中心=None, 项目根目录="."):
        self.操作注册中心 = 操作注册中心
        self.项目根目录 = Path(项目根目录)
        self.剧本目录 = self.项目根目录 / "隐私区" / "我的剧本"
        self.剧本目录.mkdir(parents=True, exist_ok=True)
        self._录制中 = False
        self._当前剧本 = None
        self._录制锁 = threading.Lock()
        self._回放锁 = threading.Lock()
        # 存储引擎（可选，用于持久化）
        self.存储引擎 = None
        try:
            from 存储引擎 import 获取存储引擎
            self.存储引擎 = 获取存储引擎(str(self.项目根目录 / "隐私区" / "我的数据" / "智能体.db"))
        except Exception:
            pass

    def 设置操作注册中心(self, 注册中心):
        """注入操作注册中心"""
        self.操作注册中心 = 注册中心

    # ==================== 录制 ====================

    def 开始录制(self, 名称: str = "") -> dict:
        """开始录制操作步骤"""
        with self._录制锁:
            if self._录制中:
                return {"成功": False, "错误": "已在录制中，请先停止当前录制"}
            self._录制中 = True
            self._当前剧本 = {
                "名称": 名称 or f"剧本_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
                "创建时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "步骤": []
            }
            # 注册操作执行回调
            if self.操作注册中心:
                self._原执行 = getattr(self.操作注册中心, '执行', None)
                # 不替换执行方法，而是通过统计历史捕获
            return {"成功": True, "名称": self._当前剧本["名称"]}

    def 记录操作(self, 操作名: str, 参数: dict, 结果: dict):
        """记录一次操作执行（供外部调用）"""
        if not self._录制中 or not self._当前剧本:
            return
        with self._录制锁:
            步骤 = {
                "序号": len(self._当前剧本["步骤"]) + 1,
                "操作": 操作名,
                "参数": self._序列化(参数),
                "等待完成": True
            }
            self._当前剧本["步骤"].append(步骤)

    def 停止录制(self) -> dict:
        """停止录制并返回剧本"""
        with self._录制锁:
            self._录制中 = False
            if not self._当前剧本:
                return {"成功": False, "错误": "没有正在录制的剧本"}
            剧本 = self._当前剧本
            self._当前剧本 = None
            # 自动保存
            self.保存剧本(剧本)
            return {"成功": True, "剧本": 剧本, "步数": len(剧本["步骤"])}

    @property
    def 正在录制(self) -> bool:
        return self._录制中

    # ==================== 回放 ====================

    def 回放(self, 剧本: dict, 变量: dict = None, 进度回调=None) -> dict:
        """逐步执行剧本，支持变量传递

        参数:
            剧本: 剧本字典
            变量: 外部传入的变量（覆盖剧本默认值）
            进度回调: 回调函数(当前步, 总步数, 步骤信息)
        """
        if not self.操作注册中心:
            return {"成功": False, "错误": "操作注册中心未初始化"}

        步骤列表 = 剧本.get("步骤", [])
        if not 步骤列表:
            return {"成功": False, "错误": "剧本没有步骤"}

        上下文 = 变量 or {}
        执行结果 = []

        with self._回放锁:
            for 步骤 in 步骤列表:
                序号 = 步骤.get("序号", 0)
                操作名 = 步骤.get("操作", "")
                参数 = 步骤.get("参数", {})

                # 模板变量替换
                参数 = self._替换变量(参数, 上下文)

                # 进度回调
                if 进度回调:
                    进度回调(序号, len(步骤列表), 步骤)

                # 执行操作
                结果 = self.操作注册中心.执行(操作名, 参数)
                执行结果.append({
                    "序号": 序号,
                    "操作": 操作名,
                    "成功": 结果.get("成功", False),
                    "结果": self._截断(结果.get("数据", ""), 500)
                })

                # 存入上下文供后续步骤引用
                上下文[f"步骤{序号}"] = {
                    "结果": 结果.get("数据", ""),
                    "成功": 结果.get("成功", False)
                }

                # 失败处理
                if not 结果.get("成功", False):
                    return {
                        "成功": False,
                        "错误": f"步骤{序号}执行失败: {结果.get('错误', '')}",
                        "已完成步骤": 序号 - 1,
                        "执行结果": 执行结果
                    }

        return {"成功": True, "执行结果": 执行结果, "总步数": len(步骤列表)}

    # ==================== 持久化 ====================

    def 保存剧本(self, 剧本: dict) -> dict:
        """保存剧本到SQLite"""
        名称 = 剧本.get("名称", "未命名")
        内容 = json.dumps(剧本, ensure_ascii=False, indent=2)
        if self.存储引擎:
            self.存储引擎.保存剧本(名称, 内容)
        return {"成功": True, "名称": 名称}

    def 加载剧本(self, 名称: str) -> dict:
        """从SQLite加载剧本"""
        if self.存储引擎:
            结果 = self.存储引擎.加载剧本(名称)
            if 结果:
                try:
                    return {"成功": True, "剧本": json.loads(结果)}
                except Exception:
                    pass
        return {"成功": False, "错误": f"剧本不存在: {名称}"}

    def 列出剧本(self) -> list:
        """列出所有已保存的剧本"""
        if self.存储引擎:
            结果 = self.存储引擎.列出剧本()
            if 结果:
                return 结果
        return []

    def 删除剧本(self, 名称: str) -> dict:
        """删除剧本"""
        if self.存储引擎:
            self.存储引擎.删除剧本(名称)
        return {"成功": True, "名称": 名称}

    def 回放by名称(self, 名称: str, 变量: dict = None, 进度回调=None) -> dict:
        """按名称加载并回放剧本"""
        加载结果 = self.加载剧本(名称)
        if not 加载结果.get("成功"):
            return 加载结果
        return self.回放(加载结果["剧本"], 变量, 进度回调)

    # ==================== 内部工具 ====================

    def _替换变量(self, obj, 上下文: dict):
        """递归替换 ${变量名} 和 ${变量名.子键} 占位符"""
        if isinstance(obj, str):
            for 键, 值 in 上下文.items():
                # 先处理嵌套: ${键.子键}
                if isinstance(值, dict):
                    for 子键, 子值 in 值.items():
                        子占位符 = f"${{{键}.{子键}}}"
                        obj = obj.replace(子占位符, str(子值)[:500])
                # 再处理普通: ${键}
                占位符 = f"${{{键}}}"
                obj = obj.replace(占位符, str(值)[:500])
            return obj
        elif isinstance(obj, dict):
            return {k: self._替换变量(v, 上下文) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._替换变量(v, 上下文) for v in obj]
        return obj

    def _序列化(self, obj):
        """将参数序列化为可JSON存储的格式"""
        try:
            json.dumps(obj, ensure_ascii=False)
            return obj
        except (TypeError, ValueError):
            return str(obj)

    def _截断(self, 文本: str, 最大长度: int) -> str:
        """截断文本"""
        if not isinstance(文本, str):
            文本 = str(文本)
        return 文本[:最大长度] + "..." if len(文本) > 最大长度 else 文本


# 全局单例
_剧本管理器实例 = None


def 获取剧本管理器(操作注册中心=None, 项目根目录=".") -> 剧本管理器:
    """获取全局剧本管理器实例"""
    global _剧本管理器实例
    if _剧本管理器实例 is None:
        _剧本管理器实例 = 剧本管理器(操作注册中心, 项目根目录)
    elif 操作注册中心:
        _剧本管理器实例.设置操作注册中心(操作注册中心)
    return _剧本管理器实例
