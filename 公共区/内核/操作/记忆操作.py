"""记忆操作 — 让AI主动管理记忆（对标MemGPT agent自编辑记忆）

AI可主动保存重要信息、搜索历史记忆、遗忘过时记忆。
所有操作统一走记忆模块（记忆/主程序.py），避免双路径写入导致数据丢失。
"""
import json
from pathlib import Path
from datetime import datetime
from .基类 import 操作结果, 操作基类


def _获取记忆模块():
    """通过操作注册中心获取记忆模块实例"""
    from 操作注册中心 import 操作注册中心类
    注册中心 = 操作注册中心类._实例引用
    if 注册中心 and hasattr(注册中心, '_模块注册'):
        return 注册中心._模块注册.get("记忆")
    return None


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

        记忆模块 = _获取记忆模块()
        if 记忆模块:
            # 统一走记忆模块的 _记住() 方法
            名称 = 内容[:20].replace("\n", " ").strip() + "..."
            结果 = 记忆模块.运行({
                "操作": "记住",
                "name": 名称,
                "description": 内容[:80],
                "content": 内容,
                "memory_type": "reference",
                "tags": 标签
            })
            if 结果.get("成功"):
                return 操作结果.成功(
                    f"✅ 已保存记忆\n内容: {内容[:100]}\n标签: {', '.join(标签) if 标签 else '无'}"
                )
            else:
                return 操作结果.失败(结果.get("错误", "保存失败"))
        else:
            # fallback：记忆模块未加载时直接写文件
            return self._fallback保存(内容, 标签)

    def _fallback保存(self, 内容: str, 标签: list) -> 操作结果:
        """记忆模块未加载时的fallback：直接写JSON文件"""
        from 操作注册中心 import 操作注册中心类
        注册中心 = 操作注册中心类._实例引用
        配置加载器 = getattr(注册中心, '_配置加载器', None) if 注册中心 else None
        if 配置加载器:
            项目根 = Path(配置加载器.项目根目录)
        else:
            项目根 = Path(__file__).parent.parent.parent.parent
        路径 = 项目根 / "隐私区" / "我的记忆" / "记忆库.json"
        try:
            with open(路径, "r", encoding="utf-8") as f:
                数据 = json.load(f)
            if "事件列表" not in 数据:
                数据["事件列表"] = {}
            if "事件计数" not in 数据:
                数据["事件计数"] = 0
        except Exception:
            数据 = {"事件列表": {}, "事件计数": 0}

        事件ID = f"事件_{数据['事件计数'] + 1:03d}"
        数据["事件计数"] += 1
        数据["事件列表"][事件ID] = {
            "内容": 内容,
            "标签": 标签,
            "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "来源": "AI主动保存(fallback)"
        }
        路径.parent.mkdir(parents=True, exist_ok=True)
        with open(路径, "w", encoding="utf-8") as f:
            json.dump(数据, f, ensure_ascii=False, indent=2)
        return 操作结果.成功(
            f"✅ 已保存记忆(fallback) [{事件ID}]\n内容: {内容[:100]}\n标签: {', '.join(标签) if 标签 else '无'}"
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

        记忆模块 = _获取记忆模块()
        if 记忆模块:
            # 统一走记忆模块的搜索
            结果 = 记忆模块.运行({
                "操作": "搜索记忆",
                "关键词": 关键词
            })
            if 结果.get("成功"):
                匹配结果 = 结果.get("结果", [])
                if not 匹配结果:
                    # 同时搜索记忆条目
                    列表结果 = 记忆模块.运行({"操作": "列出记忆"})
                    条目列表 = 列表结果.get("数据", []) if 列表结果.get("成功") else []
                    匹配条目 = [
                        e for e in 条目列表
                        if 关键词.lower() in e.get("name", "").lower()
                        or 关键词.lower() in e.get("描述", "").lower()
                    ]
                    if not 匹配条目:
                        return 操作结果.成功(f"未找到与「{关键词}」相关的记忆。")
                    匹配结果 = 匹配条目

                结果文本 = f"找到{len(匹配结果)}条相关记忆：\n"
                for m in 匹配结果[:10]:
                    标题 = m.get("标题", m.get("name", ""))
                    摘要 = m.get("摘要", m.get("描述", ""))
                    结果文本 += f"\n📌 {标题}\n   {摘要[:200]}\n"
                return 操作结果.成功(结果文本)
            else:
                return 操作结果.失败(结果.get("错误", "搜索失败"))
        else:
            return self._fallback搜索(关键词)

    def _fallback搜索(self, 关键词: str) -> 操作结果:
        """记忆模块未加载时的fallback"""
        from 操作注册中心 import 操作注册中心类
        注册中心 = 操作注册中心类._实例引用
        配置加载器 = getattr(注册中心, '_配置加载器', None) if 注册中心 else None
        if 配置加载器:
            项目根 = Path(配置加载器.项目根目录)
        else:
            项目根 = Path(__file__).parent.parent.parent.parent
        路径 = 项目根 / "隐私区" / "我的记忆" / "记忆库.json"
        try:
            with open(路径, "r", encoding="utf-8") as f:
                数据 = json.load(f)
        except Exception:
            return 操作结果.成功(f"未找到与「{关键词}」相关的记忆。")

        事件列表 = 数据.get("事件列表", {})
        匹配结果 = []
        for 事件ID, 事件 in 事件列表.items():
            内容 = 事件.get("内容", "")
            标签 = 事件.get("标签", [])
            if 关键词.lower() in 内容.lower() or any(关键词.lower() in t.lower() for t in 标签):
                匹配结果.append({"ID": 事件ID, **事件})

        if not 匹配结果:
            return 操作结果.成功(f"未找到与「{关键词}」相关的记忆。")

        结果文本 = f"找到{len(匹配结果)}条相关记忆：\n"
        for m in 匹配结果[-10:]:
            结果文本 += f"\n📌 [{m['ID']}] {m.get('时间', '')}\n   内容: {m.get('内容', '')[:200]}\n"
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

        记忆模块 = _获取记忆模块()
        if 记忆模块:
            # 先搜索匹配的记忆条目
            搜索结果 = 记忆模块.运行({"操作": "搜索记忆", "关键词": 关键词})
            删除数 = 0
            已删名称 = []
            if 搜索结果.get("成功"):
                for 条目 in 搜索结果.get("结果", []):
                    名称 = 条目.get("标题", 条目.get("编号", ""))
                    if 名称 and 名称 != "旧记忆":
                        删除结果 = 记忆模块.运行({"操作": "删除记忆", "name": 名称})
                        if 删除结果.get("成功"):
                            删除数 += 1
                            已删名称.append(名称)

            # 同时搜索记忆条目列表（通过列出记忆+关键词过滤）
            列表结果 = 记忆模块.运行({"操作": "列出记忆"})
            if 列表结果.get("成功"):
                for 条目 in 列表结果.get("数据", []):
                    名称 = 条目.get("name", "")
                    描述 = 条目.get("描述", "")
                    if 关键词.lower() in 名称.lower() or 关键词.lower() in 描述.lower():
                        删除结果 = 记忆模块.运行({"操作": "删除记忆", "name": 名称})
                        if 删除结果.get("成功"):
                            删除数 += 1
                            已删名称.append(名称)

            if 删除数 == 0:
                return 操作结果.成功(f"未找到包含「{关键词}」的记忆，无需遗忘。")
            return 操作结果.成功(
                f"✅ 已遗忘{删除数}条记忆\n删除的记忆: {', '.join(已删名称)}"
            )
        else:
            return self._fallback遗忘(关键词)

    def _fallback遗忘(self, 关键词: str) -> 操作结果:
        """记忆模块未加载时的fallback"""
        from 操作注册中心 import 操作注册中心类
        注册中心 = 操作注册中心类._实例引用
        配置加载器 = getattr(注册中心, '_配置加载器', None) if 注册中心 else None
        if 配置加载器:
            项目根 = Path(配置加载器.项目根目录)
        else:
            项目根 = Path(__file__).parent.parent.parent.parent
        路径 = 项目根 / "隐私区" / "我的记忆" / "记忆库.json"
        try:
            with open(路径, "r", encoding="utf-8") as f:
                数据 = json.load(f)
        except Exception:
            return 操作结果.成功(f"未找到包含「{关键词}」的记忆，无需遗忘。")

        事件列表 = 数据.get("事件列表", {})
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

        with open(路径, "w", encoding="utf-8") as f:
            json.dump(数据, f, ensure_ascii=False, indent=2)
        return 操作结果.成功(
            f"✅ 已遗忘{len(删除列表)}条记忆\n删除的记忆ID: {', '.join(删除列表)}"
        )
