"""记忆操作 — 让AI主动管理记忆（对标MemGPT agent自编辑记忆）

AI可主动保存重要信息、搜索历史记忆、遗忘过时记忆。
"""
import json
from pathlib import Path
from datetime import datetime
from .基类 import 操作结果, 操作基类


def _获取记忆库路径():
    """获取记忆库JSON文件路径"""
    from 操作注册中心 import 操作注册中心类
    注册中心 = 操作注册中心类._实例引用
    配置加载器 = getattr(注册中心, '_配置加载器', None) if 注册中心 else None
    if 配置加载器:
        项目根 = Path(配置加载器.项目根目录)
    else:
        # fallback: 从当前文件推断
        项目根 = Path(__file__).parent.parent.parent.parent
    return 项目根 / "隐私区" / "我的记忆" / "记忆库.json"


def _读取记忆库():
    """读取记忆库JSON"""
    路径 = _获取记忆库路径()
    try:
        with open(路径, "r", encoding="utf-8") as f:
            数据 = json.load(f)
        if "事件列表" not in 数据:
            数据["事件列表"] = {}
        if "事件计数" not in 数据:
            数据["事件计数"] = 0
        return 数据
    except Exception:
        return {"事件列表": {}, "事件计数": 0}


def _写入记忆库(数据):
    """写入记忆库JSON"""
    路径 = _获取记忆库路径()
    路径.parent.mkdir(parents=True, exist_ok=True)
    with open(路径, "w", encoding="utf-8") as f:
        json.dump(数据, f, ensure_ascii=False, indent=2)


class 保存记忆(操作基类):
    名称 = "保存记忆"
    描述 = "将重要信息保存到记忆库，供未来对话使用。用于记住用户偏好、项目信息、重要决策等。"
    参数结构 = {
        "内容": {"类型": "字符串", "必填": True, "说明": "要记住的信息内容"},
        "标签": {"类型": "字符串", "必填": False, "说明": "分类标签，逗号分隔（如：项目,偏好,决策）"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        内容 = 参数.get("内容", "").strip()
        标签文本 = 参数.get("标签", "").strip()
        if not 内容:
            return 操作结果.失败("内容为空")

        标签 = [s.strip() for s in 标签文本.split(",") if s.strip()] if 标签文本 else []

        记忆库 = _读取记忆库()
        事件ID = f"事件_{记忆库['事件计数'] + 1:03d}"
        记忆库["事件计数"] += 1
        记忆库["事件列表"][事件ID] = {
            "内容": 内容,
            "标签": 标签,
            "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "来源": "AI主动保存"
        }
        _写入记忆库(记忆库)

        return 操作结果.成功(
            f"✅ 已保存记忆 [{事件ID}]\n内容: {内容[:100]}\n标签: {', '.join(标签) if 标签 else '无'}"
        )


class 搜索记忆(操作基类):
    名称 = "搜索记忆"
    描述 = "搜索记忆库中的历史记忆，查找之前保存的信息。当需要回忆之前的对话内容或决策时使用。"
    参数结构 = {
        "关键词": {"类型": "字符串", "必填": True, "说明": "搜索关键词"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        关键词 = 参数.get("关键词", "").strip()
        if not 关键词:
            return 操作结果.失败("关键词为空")

        记忆库 = _读取记忆库()
        事件列表 = 记忆库.get("事件列表", {})
        匹配结果 = []

        for 事件ID, 事件 in 事件列表.items():
            内容 = 事件.get("内容", "")
            标签 = 事件.get("标签", [])
            时间 = 事件.get("时间", "")
            来源 = 事件.get("来源", "")

            # 匹配内容或标签
            if 关键词.lower() in 内容.lower() or any(关键词.lower() in t.lower() for t in 标签):
                匹配结果.append({
                    "ID": 事件ID,
                    "内容": 内容[:200],
                    "标签": 标签,
                    "时间": 时间,
                    "来源": 来源
                })

        if not 匹配结果:
            return 操作结果.成功(f"未找到与「{关键词}」相关的记忆。")

        # 最多返回10条
        匹配结果 = 匹配结果[-10:]
        结果文本 = f"找到{len(匹配结果)}条相关记忆：\n"
        for m in 匹配结果:
            结果文本 += f"\n📌 [{m['ID']}] {m['时间']}\n"
            结果文本 += f"   内容: {m['内容']}\n"
            if m["标签"]:
                结果文本 += f"   标签: {', '.join(m['标签'])}\n"
            结果文本 += f"   来源: {m['来源']}\n"

        return 操作结果.成功(结果文本)


class 遗忘记忆(操作基类):
    名称 = "遗忘记忆"
    描述 = "删除过时或错误的记忆条目。当发现之前记住的信息不再准确时使用。"
    参数结构 = {
        "关键词": {"类型": "字符串", "必填": True, "说明": "要遗忘的记忆关键词（匹配包含此关键词的记忆）"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        关键词 = 参数.get("关键词", "").strip()
        if not 关键词:
            return 操作结果.失败("关键词为空")

        记忆库 = _读取记忆库()
        事件列表 = 记忆库.get("事件列表", {})
        删除列表 = []

        for 事件ID in list(事件列表.keys()):
            事件 = 事件列表[事件ID]
            内容 = 事件.get("内容", "")
            标签 = 事件.get("标签", [])
            if 关键词.lower() in 内容.lower() or any(关键词.lower() in t.lower() for t in 标签):
                删除列表.append(事件ID)
                del 事件列表[事件ID]

        if not 删除列表:
            return 操作结果.成功(f"未找到包含「{关键词}」的记忆，无需遗忘。")

        _写入记忆库(记忆库)
        return 操作结果.成功(
            f"✅ 已遗忘{len(删除列表)}条记忆\n"
            f"删除的记忆ID: {', '.join(删除列表)}"
        )
