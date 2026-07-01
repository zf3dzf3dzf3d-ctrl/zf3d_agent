"""
导出操作 — 对话记录导出为Markdown/HTML
AI自动写配置 — 根据用户描述生成工具声明JSON
"""
import json
from pathlib import Path
from datetime import datetime
from .基类 import 操作结果, 操作基类


class 导出对话(操作基类):
    名称 = "导出对话"
    描述 = "将指定对话记录导出为Markdown或HTML文件"
    参数结构 = {
        "对话ID": {"类型": "字符串", "必填": False, "说明": "对话ID（留空导出当前对话）"},
        "格式": {"类型": "字符串", "必填": False, "说明": "导出格式：markdown或html（默认markdown）"},
        "包含推理": {"类型": "布尔", "必填": False, "说明": "是否包含推理过程（默认否）"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        格式 = 参数.get("格式", "markdown").lower()
        包含推理 = 参数.get("包含推理", False)
        对话ID = 参数.get("对话ID", "")

        # 获取对话历史
        对话历史 = self._获取对话历史(对话ID)
        if not 对话历史:
            return 操作结果.失败("未找到对话记录")

        if 格式 == "html":
            内容 = self._导出HTML(对话历史, 包含推理)
            后缀 = ".html"
        else:
            内容 = self._导出Markdown(对话历史, 包含推理)
            后缀 = ".md"

        # 保存到文件
        导出目录 = Path("隐私区") / "我的数据" / "导出"
        导出目录.mkdir(parents=True, exist_ok=True)
        时间戳 = datetime.now().strftime("%Y%m%d_%H%M%S")
        文件名 = f"对话导出_{时间戳}{后缀}"
        文件路径 = 导出目录 / 文件名
        with open(文件路径, "w", encoding="utf-8") as f:
            f.write(内容)

        return 操作结果.成功(
            f"已导出到 {文件路径}",
            元数据={"文件路径": str(文件路径), "消息数": len(对话历史)}
        )

    def _获取对话历史(self, 对话ID: str) -> list:
        """从对话记录文件获取历史"""
        记录目录 = Path("隐私区") / "对话记录"
        if 对话ID:
            文件路径 = 记录目录 / f"{对话ID}.json"
            if 文件路径.exists():
                with open(文件路径, "r", encoding="utf-8") as f:
                    数据 = json.load(f)
                return 数据.get("历史", [])
        else:
            # 取最新的对话
            文件列表 = sorted(记录目录.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True)
            for 文件 in 文件列表:
                if 文件.name.startswith("_"):
                    continue
                with open(文件, "r", encoding="utf-8") as f:
                    数据 = json.load(f)
                return 数据.get("历史", [])
        return []

    def _导出Markdown(self, 历史: list, 包含推理: bool) -> str:
        lines = ["# 对话记录\n"]
        lines.append(f"> 导出时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        lines.append("---\n")

        for msg in 历史:
            角色 = msg.get("角色", "")
            内容 = msg.get("内容", "")
            时间 = msg.get("时间", "")

            if 角色 in ("user", "用户"):
                lines.append(f"## 🧑 用户\n")
                if 时间:
                    lines.append(f"*{时间}*\n")
                lines.append(f"{内容}\n")
            elif 角色 in ("assistant", "助手"):
                lines.append(f"## 🤖 助手\n")
                if 时间:
                    lines.append(f"*{时间}*\n")
                lines.append(f"{内容}\n")

            if 包含推理 and msg.get("推理过程"):
                lines.append(f"<details><summary>📝 推理过程</summary>\n\n")
                lines.append("```\n")
                lines.append(str(msg["推理过程"]))
                lines.append("\n```\n")
                lines.append("</details>\n")

            lines.append("---\n")

        return "\n".join(lines)

    def _导出HTML(self, 历史: list, 包含推理: bool) -> str:
        html = ["<!DOCTYPE html><html><head><meta charset='utf-8'>"]
        html.append("<style>body{font-family:sans-serif;max-width:800px;margin:auto;padding:20px;}")
        html.append(".user{background:#e3f2fd;padding:10px;border-radius:8px;margin:10px 0;}")
        html.append(".assistant{background:#f1f8e9;padding:10px;border-radius:8px;margin:10px 0;}")
        html.append(".time{color:#999;font-size:12px;}.reasoning{background:#fff9c4;padding:10px;margin:5px 0;border-radius:4px;}")
        html.append("</style></head><body><h1>对话记录</h1>")
        html.append(f"<p>导出时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p><hr>")

        for msg in 历史:
            角色 = msg.get("角色", "")
            内容 = msg.get("内容", "").replace("\n", "<br>")
            时间 = msg.get("时间", "")

            if 角色 in ("user", "用户"):
                html.append(f"<div class='user'><strong>🧑 用户</strong>")
                if 时间:
                    html.append(f" <span class='time'>{时间}</span>")
                html.append(f"<br>{内容}</div>")
            elif 角色 in ("assistant", "助手"):
                html.append(f"<div class='assistant'><strong>🤖 助手</strong>")
                if 时间:
                    html.append(f" <span class='time'>{时间}</span>")
                html.append(f"<br>{内容}</div>")

            if 包含推理 and msg.get("推理过程"):
                推理 = str(msg["推理过程"]).replace("\n", "<br>")
                html.append(f"<div class='reasoning'><details><summary>推理过程</summary>{推理}</details></div>")

        html.append("</body></html>")
        return "\n".join(html)


class 创建工具(操作基类):
    名称 = "创建工具"
    描述 = "根据用户描述自动生成工具声明JSON并热加载（AI自动写配置）"
    参数结构 = {
        "描述": {"类型": "字符串", "必填": True, "说明": "工具功能描述（如'查物流信息的API'）"},
        "示例": {"类型": "字符串", "必填": False, "说明": "期望的输入输出示例（可选）"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        描述 = 参数.get("描述", "")
        示例 = 参数.get("示例", "")
        if not 描述:
            return 操作结果.失败("工具描述为空")

        if not self.模型直连器:
            return 操作结果.失败("模型直连器未初始化")

        # 构建提示词
        提示词 = f"""请根据以下描述生成一个工具声明JSON对象，用于动态工具加载器。

描述：{描述}
示例：{示例 or '无'}

工具声明格式（严格遵守，只输出JSON，不要其他文字）：
{{
  "名称": "工具中文名（2-6字）",
  "描述": "工具用途说明",
  "类型": "http",
  "配置": {{
    "URL": "API地址（含${{参数名}}占位）",
    "方法": "GET",
    "请求头": {{}},
    "响应处理": {{"提取方法": "JSON解析", "输出字段": []}}
  }},
  "参数": [
    {{"名称": "参数中文名", "类型": "字符串", "必填": true, "说明": "参数说明"}}
  ],
  "参数映射": {{"参数中文名": "参数中文名"}}
}}

如果需要执行Python脚本而非HTTP请求，类型改为"python"，配置中用"脚本"字段代替URL。
只输出JSON，不要markdown代码块标记，不要解释文字。"""

        # 调用LLM生成
        消息 = [{"role": "user", "content": 提示词}]
        结果 = self.模型直连器.发送消息(消息, temperature=0.3)
        文本 = 结果.get("回复", "")

        # 提取JSON
        声明JSON = self._提取JSON(文本)
        if not 声明JSON:
            return 操作结果.失败(f"LLM生成的内容无法解析为JSON:\n{文本[:500]}")

        # 验证
        验证 = self._验证工具声明(声明JSON)
        if not 验证["有效"]:
            return 操作结果.失败(f"生成的工具声明无效: {验证['错误']}\n{json.dumps(声明JSON, ensure_ascii=False, indent=2)}")

        # 写入工具声明.json
        工具声明路径 = Path("公共区") / "配置" / "工具声明.json"
        with open(工具声明路径, "r", encoding="utf-8") as f:
            工具声明 = json.load(f)
        工具声明["工具列表"].append(声明JSON)
        with open(工具声明路径, "w", encoding="utf-8") as f:
            json.dump(工具声明, f, ensure_ascii=False, indent=2)

        # 热加载
        try:
            from 动态工具加载器 import 动态工具加载器类
            加载器 = 动态工具加载器类()
            加载器.从字典加载([声明JSON], 注册目标=操作注册中心._实例引用)
        except Exception:
            pass

        return 操作结果.成功(
            f"已创建工具 [{声明JSON['名称']}] 并热加载",
            元数据={"工具声明": 声明JSON}
        )

    def _提取JSON(self, 文本: str) -> dict:
        """从LLM输出中提取JSON"""
        import re
        # 尝试直接解析
        try:
            return json.loads(文本)
        except json.JSONDecodeError:
            pass
        # 尝试提取代码块中的JSON
        匹配 = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', 文本, re.DOTALL)
        if 匹配:
            try:
                return json.loads(匹配.group(1))
            except json.JSONDecodeError:
                pass
        # 尝试提取第一个{...}块
        匹配 = re.search(r'\{[^{}]*\}', 文本, re.DOTALL)
        if 匹配:
            try:
                return json.loads(匹配.group(0))
            except json.JSONDecodeError:
                pass
        return None

    def _验证工具声明(self, 声明: dict) -> dict:
        """验证工具声明结构"""
        if not 声明.get("名称"):
            return {"有效": False, "错误": "缺少名称"}
        if 声明.get("类型") not in ("http", "python", "command"):
            return {"有效": False, "错误": "类型必须是http/python/command"}
        if 声明.get("类型") == "http" and not 声明.get("配置", {}).get("URL"):
            return {"有效": False, "错误": "http类型工具必须有URL配置"}
        if 声明.get("类型") == "python" and not 声明.get("配置", {}).get("脚本"):
            return {"有效": False, "错误": "python类型工具必须有脚本配置"}
        if not 声明.get("参数"):
            声明["参数"] = []
        if not 声明.get("参数映射"):
            声明["参数映射"] = {}
        return {"有效": True}


class 导出训练数据(操作基类):
    """将对话记录导出为ShareGPT格式JSONL，可用于模型微调"""
    名称 = "导出训练数据"
    描述 = "将对话记录导出为ShareGPT格式JSONL训练数据"
    参数结构 = {
        "对话ID": {"类型": "字符串", "必填": False, "说明": "指定对话ID（留空导出全部）"},
        "仅成功": {"类型": "布尔", "必填": False, "说明": "仅导出成功完成的对话（默认是）"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        对话ID = 参数.get("对话ID", "")
        仅成功 = 参数.get("仅成功", True)

        对话列表 = self._获取对话列表(对话ID)
        if not 对话列表:
            return 操作结果.失败("未找到对话记录")

        导出目录 = Path("隐私区") / "我的数据"
        导出目录.mkdir(parents=True, exist_ok=True)
        时间戳 = datetime.now().strftime("%Y%m%d_%H%M%S")
        文件路径 = 导出目录 / f"训练数据_{时间戳}.jsonl"

        导出数 = 0
        with open(文件路径, "w", encoding="utf-8") as f:
            for 对话 in 对话列表:
                历史 = 对话.get("历史", [])
                成功 = 对话.get("成功", True)
                if 仅成功 and not 成功:
                    continue
                if len(历史) < 2:
                    continue

                # 转换为ShareGPT格式
                conversations = []
                for msg in 历史:
                    角色 = msg.get("角色", "")
                    内容 = msg.get("内容", "")
                    if 角色 in ("user", "用户"):
                        conversations.append({"from": "human", "value": 内容})
                    elif 角色 in ("assistant", "助手"):
                        conversations.append({"from": "gpt", "value": 内容})

                if len(conversations) >= 2:
                    条目 = {
                        "conversations": conversations,
                        "timestamp": 对话.get("时间", ""),
                        "source": "zf3d_agent"
                    }
                    f.write(json.dumps(条目, ensure_ascii=False) + "\n")
                    导出数 += 1

        return 操作结果.成功(
            f"已导出 {导出数} 条训练数据到 {文件路径}",
            元数据={"文件路径": str(文件路径), "条目数": 导出数}
        )

    def _获取对话列表(self, 对话ID: str) -> list:
        """从对话记录目录获取对话列表"""
        记录目录 = Path("隐私区") / "对话记录"
        结果 = []
        if 对话ID:
            文件路径 = 记录目录 / f"{对话ID}.json"
            if 文件路径.exists():
                with open(文件路径, "r", encoding="utf-8") as f:
                    结果.append(json.load(f))
        else:
            if 记录目录.exists():
                for 文件 in sorted(记录目录.glob("*.json")):
                    if 文件.name.startswith("_"):
                        continue
                    try:
                        with open(文件, "r", encoding="utf-8") as f:
                            结果.append(json.load(f))
                    except Exception:
                        pass
        return 结果
