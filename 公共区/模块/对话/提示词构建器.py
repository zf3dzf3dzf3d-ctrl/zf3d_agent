"""提示词构建器 — 构建系统提示词，管理缓存和记忆注入

职责：
1. 构建完整系统提示词（身份+环境+项目上下文+操作列表+记忆+时间）
2. 三级缓存（基础身份/环境/操作列表）
3. 记忆召回单轮缓存（消除每步重复LLM调用）
4. 项目上下文检测（独立可复用）

核心改进：
- 记忆召回结果在单轮ReAct内缓存，不每步重复调LLM
- 项目上下文检测独立化，不再耦合在对话模块里
- 三级缓存粒度更细
"""
import sys
import json
from pathlib import Path
from datetime import datetime


class 提示词构建器类:
    """系统提示词构建器"""

    def __init__(self):
        self._缓存 = {}          # 提示词缓存
        self._记忆缓存 = None     # 单轮ReAct内记忆缓存
        self._记忆缓存键 = None   # 记忆缓存的key（用户消息）

    def 构建(self, 基础提示词: str, 工作模式: str, 文件上下文: str,
             模型直连器, 操作注册中心, 模块注册, 永久记忆: list,
             配置: dict, fc已降级: bool = False) -> str:
        """构建完整系统提示词

        参数:
            基础提示词: 基础身份提示词
            工作模式: 商量/执行/无人值守/规划
            文件上下文: 前端注入的文件/编辑器上下文
            模型直连器: LLM直连器实例
            操作注册中心: 操作注册中心实例
            模块注册: 模块注册表
            永久记忆: 永久记忆列表
            配置: 模块配置
            fc已降级: 是否已降级到文本模式
        """
        # 闲聊精简模式：fc已降级=True 时跳过工具列表/技能/联网提示/知识库/记忆LLM调用
        闲聊模式 = fc已降级 and 工作模式 == "商量"

        # 缓存键: 基于变化频率低的因素 + 版本号
        缓存键 = f"v9_{fc已降级}_{工作模式}_{hash(文件上下文)}"

        # 检查缓存
        if 缓存键 in self._缓存:
            缓存数据 = self._缓存[缓存键]
            部分 = [缓存数据["基础部分"]]
            # 动态部分: 记忆注入（闲聊模式跳过LLM调用，只取用户画像+近期摘要）
            if 闲聊模式:
                记忆内容 = self._获取记忆注入轻量(
                    模块注册, 配置.get("当前消息", ""), 配置.get("新对话标志", False))
            else:
                记忆内容 = self._获取记忆注入(
                    模块注册, 配置.get("当前消息", ""), 配置.get("新对话标志", False))
            if 记忆内容:
                部分.append(f"\n\n## 记忆上下文\n\n{记忆内容}")
            部分.append(缓存数据["尾部部分"])
            部分.append(f"\n\n当前时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            if 永久记忆:
                记忆摘要 = [f"  - {m['内容']}" for m in 永久记忆[-20:]]
                部分.append(f"\n\n## 永久记忆（跨对话保留）\n" + "\n".join(记忆摘要))
            # 知识库召回（闲聊模式跳过）
            if not 闲聊模式:
                知识库 = 配置.get("知识库")
                if 知识库:
                    当前消息 = 配置.get("当前消息", "")
                    if 当前消息 and len(当前消息) > 3:
                        知识结果 = 知识库.召回文本(当前消息)
                        if 知识结果:
                            部分.append(f"\n\n## 知识库参考\n\n以下是与当前对话相关的知识库内容：\n\n{知识结果}")
            if 文件上下文:
                部分.append(文件上下文)
            return "".join(部分)

        # 首次构建
        基础部分列表 = []

        # 1. 基础身份
        基础部分列表.append(基础提示词)

        # 2. 运行环境
        基础部分列表.append(self._构建_环境信息())

        # 3. 项目上下文
        try:
            项目根 = Path(配置.get("项目根目录", "."))
            项目上下文 = self._获取项目上下文(项目根)
            if 项目上下文:
                基础部分列表.append(f"\n\n## 项目上下文\n\n{项目上下文}")
        except Exception:
            pass

        # 4. 工作模式说明
        有框选 = 文件上下文 and "框选" in 文件上下文
        if 有框选:
            是word框选 = "替换Word文本" in 文件上下文
            是excel框选 = "替换Excel文本" in 文件上下文
            if 是word框选:
                基础部分列表.append("\n\n工作模式: 当前有Word文档框选文本，直接执行替换Word文本操作，不需要确认！")
            elif 是excel框选:
                基础部分列表.append("\n\n工作模式: 当前有Excel文档框选文本，直接执行替换Excel文本操作，不需要确认！")
            else:
                基础部分列表.append("\n\n工作模式: 当前有框选文本，直接执行替换文本操作，不需要确认！")
        else:
            模式说明 = {
                "商量": "当前是商量模式：用户要求执行任务时自主执行操作，连续执行直到完成。用户要求删除文件时直接执行删除，不要停下来要求确认！但用户只是在闲聊或提问时，直接文字回复，不要调用工具。任务完成后立即停止，不要做额外操作。",
                "执行": "当前是执行模式：直接执行操作，不需要确认，连续执行直到完成。",
                "无人值守": "当前是无人值守模式：自动循环执行任务，失败自动重试，不需要任何确认。",
                "规划": "当前是规划模式：不要直接执行操作！先分析任务，生成一个结构化的执行计划。"
            }
            基础部分列表.append(f"\n\n工作模式: {模式说明.get(工作模式, '')}")

        # 5. ReAct指令
        fc配置 = 模型直连器.配置.get("function_calling", {}) if 模型直连器 else {}
        fc启用 = fc配置.get("启用", False) and not fc已降级
        基础部分列表.append(self._构建_react指令(fc启用))

        # 6. 可用操作列表（闲聊模式跳过，省~15K字符）
        if 操作注册中心 and not 闲聊模式:
            操作说明 = 操作注册中心.获取操作说明()
            基础部分列表.append(f"\n\n## 可用操作\n\n{操作说明}")

        # 6b. 技能指令注入（闲聊模式跳过）
        if not 闲聊模式:
            技能加载器 = 配置.get("技能加载器")
            if 技能加载器:
                # 技能摘要（始终注入，让LLM知道有哪些技能可用）
                技能摘要 = 技能加载器.获取技能摘要()
                if 技能摘要:
                    基础部分列表.append(f"\n\n## 已加载技能\n\n{技能摘要}")
                # 匹配到的技能注入完整指令体
                当前消息 = 配置.get("当前消息", "")
                if 当前消息:
                    技能指令 = 技能加载器.获取技能指令(当前消息)
                    if 技能指令:
                        基础部分列表.append(f"\n\n## 技能指令（当前对话触发）\n\n{技能指令}")

        # 联网搜索能力提示（闲聊模式跳过）
        if not 闲聊模式:
            基础部分列表.append(
                "\n\n## 联网能力提示\n"
                "当你不确定某个信息、用户问你不了解的内容、或需要最新信息时，"
                "使用「网络搜索」操作搜索互联网，再用「网页抓取」读取具体页面内容。\n"
                "示例流程：网络搜索(关键词) → 选择最相关的URL → 网页抓取(URL) → 提取信息回答用户"
            )

        # 缓存不变部分
        基础部分 = "".join(基础部分列表)
        self._缓存[缓存键] = {
            "基础部分": 基础部分,
            "尾部部分": ""
        }

        # 7. 动态部分: 记忆注入（闲聊模式跳过LLM调用）
        部分 = [基础部分]
        if 闲聊模式:
            记忆内容 = self._获取记忆注入轻量(
                模块注册, 配置.get("当前消息", ""), 配置.get("新对话标志", False))
        else:
            记忆内容 = self._获取记忆注入(
                模块注册, 配置.get("当前消息", ""), 配置.get("新对话标志", False))
        if 记忆内容:
            部分.append(f"\n\n## 记忆上下文\n\n{记忆内容}")

        # 8. 当前时间
        部分.append(f"\n\n当前时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

        # 9. 永久记忆
        if 永久记忆:
            记忆摘要 = [f"  - {m['内容']}" for m in 永久记忆[-20:]]
            部分.append(f"\n\n## 永久记忆（跨对话保留）\n" + "\n".join(记忆摘要))

            # 9.5 用户习惯参数（从永久记忆中正则提取，零LLM调用）
            习惯 = self._构建_用户习惯(永久记忆)
            if 习惯:
                部分.append(习惯)

        # 9b. 知识库召回（闲聊模式跳过）
        if not 闲聊模式:
            知识库 = 配置.get("知识库")
            if 知识库:
                当前消息 = 配置.get("当前消息", "")
                if 当前消息 and len(当前消息) > 3:
                    知识结果 = 知识库.召回文本(当前消息)
                    if 知识结果:
                        部分.append(f"\n\n## 知识库参考\n\n以下是与当前对话相关的知识库内容：\n\n{知识结果}")

        # 10. 文件上下文
        if 文件上下文:
            部分.append(文件上下文)

        return "".join(部分)

    def 刷新记忆缓存(self):
        """新消息到来时刷新记忆缓存"""
        self._记忆缓存 = None
        self._记忆缓存键 = None

    def _构建_用户习惯(self, 永久记忆: list) -> str:
        """从永久记忆中正则提取用户常用参数，供工具调用时自动填充"""
        import re
        习惯 = []
        # 合并所有记忆文本
        全文 = "\n".join(m.get('内容', '') for m in 永久记忆[-30:])

        # 提取常用路径（盘符路径）
        路径集合 = set(re.findall(r'[A-Za-z]:[/\\][^\s<>"\']+', 全文))
        # 过滤掉太短或明显不是目录的
        目录路径 = [p for p in 路径集合 if len(p) > 5 and not p.endswith(('.py', '.js', '.json', '.txt', '.md', '.html', '.css', '.png', '.jpg'))]
        if 目录路径:
            # 取出现频率最高的路径
            from collections import Counter
            最常用 = Counter(目录路径).most_common(3)
            for 路径, _ in 最常用:
                习惯.append(f"- 默认保存目录: {路径}")

        # 提取常用工作流名称
        工作流 = re.findall(r'(?:工作流|workflow)[：:\s]*([^\s,，。]+)', 全文, re.I)
        if 工作流:
            from collections import Counter
            最常用 = Counter(工作流).most_common(2)
            for 名称, _ in 最常用:
                习惯.append(f"- 默认生图工作流: {名称}")

        # 提取常用图片尺寸
        尺寸 = re.findall(r'(\d{3,4}\s*[x×*]\s*\d{3,4})', 全文)
        if 尺寸:
            from collections import Counter
            最常用 = Counter(s.replace(' ', '') for s in 尺寸).most_common(1)
            if 最常用:
                习惯.append(f"- 默认图片尺寸: {最常用[0][0]}")

        # 提取常用模型名
        模型名 = re.findall(r'(?:模型|model)[：:\s]*(deepseek[\w-]*|qwen[\w-]*|gpt-[\w-]+|claude[\w-]*)', 全文, re.I)
        if 模型名:
            from collections import Counter
            最常用 = Counter(m.lower() for m in 模型名).most_common(1)
            if 最常用:
                习惯.append(f"- 偏好模型: {最常用[0][0]}")

        if 习惯:
            return f"\n\n## 用户习惯参数（调用工具时自动填充，用户未指定时使用）\n" + "\n".join(习惯[:5])
        return ""

    def _获取记忆注入(self, 模块注册, 当前消息, 新对话标志) -> str:
        """获取记忆注入（单轮ReAct内缓存）

        改进：同一用户消息在整轮ReAct内只召回一次记忆，不每步重复调LLM
        """
        if not 模块注册 or "记忆" not in 模块注册:
            return ""

        # 单轮缓存：同一用户消息复用记忆召回结果
        缓存键 = 当前消息[:100] if 当前消息 else ""
        if self._记忆缓存键 == 缓存键 and self._记忆缓存 is not None:
            return self._记忆缓存

        try:
            记忆模块 = 模块注册["记忆"]
            结果 = 记忆模块.运行({
                "操作": "获取记忆注入",
                "当前消息": 当前消息,
                "新对话": 新对话标志
            })
            if 结果.get("成功"):
                注入 = 结果["注入内容"]
                部分 = []
                if 注入.get("用户画像") and 注入["用户画像"]:
                    部分.append(f"【用户画像】\n{json.dumps(注入['用户画像'], ensure_ascii=False)}")
                if 注入.get("相关事件摘要"):
                    事件 = [f"  - {e['标题']}: {e.get('摘要', '')}" for e in 注入["相关事件摘要"]]
                    部分.append("【其他对话的相关记忆（非当前对话历史，仅供参考，不要混入当前对话）】\n" + "\n".join(事件))
                if 注入.get("近期事件摘要"):
                    摘要 = [f"  - {s}" for s in 注入["近期事件摘要"]]
                    部分.append("【近期其他对话摘要（非当前对话历史，仅供参考，不要混入当前对话）】\n" + "\n".join(摘要))
                if 注入.get("自动召回记忆"):
                    召回行 = []
                    for m in 注入["自动召回记忆"]:
                        标签 = f" ({', '.join(m['标签'])})" if m.get("标签") else ""
                        召回行.append(f"  - [[{m['name']}]] — {m['描述']}{标签}")
                    部分.append("【跨对话记忆召回（非当前对话历史，仅供参考）】\n" + "\n".join(召回行))
                记忆文本 = "\n\n".join(部分)
                # 缓存结果
                self._记忆缓存 = 记忆文本
                self._记忆缓存键 = 缓存键
                return 记忆文本
        except Exception as e:
            print(f"  ⚠️ 记忆注入失败: {e}")
        return ""

    def _获取记忆注入轻量(self, 模块注册, 当前消息, 新对话标志) -> str:
        """轻量记忆注入：只取用户画像+近期摘要，不触发LLM语义匹配"""
        if not 模块注册 or "记忆" not in 模块注册:
            return ""
        try:
            记忆模块 = 模块注册["记忆"]
            结果 = 记忆模块.运行({
                "操作": "获取记忆注入",
                "当前消息": 当前消息,
                "新对话": 新对话标志,
                "轻量": True
            })
            if 结果.get("成功"):
                注入 = 结果["注入内容"]
                部分 = []
                if 注入.get("用户画像") and 注入["用户画像"]:
                    部分.append(f"【用户画像】\n{json.dumps(注入['用户画像'], ensure_ascii=False)}")
                if 注入.get("近期事件摘要"):
                    摘要 = [f"  - {s}" for s in 注入["近期事件摘要"]]
                    部分.append("【近期其他对话摘要（非当前对话历史，仅供参考）】\n" + "\n".join(摘要))
                return "\n\n".join(部分)
        except Exception:
            pass
        return ""

    def _构建_环境信息(self) -> str:
        """运行环境信息"""
        平台名 = {"win32": "Windows", "linux": "Linux", "darwin": "macOS"}.get(sys.platform, sys.platform)
        if sys.platform == "win32":
            return f"""
## 运行环境
操作系统: Windows
注意:
- 运行命令操作中的命令必须与Windows兼容（用mkdir而非mkdir -p，路径用反斜杠）
- Windows上Python命令是 `py` 而非 `python`，如 `py -c "print(1)"`
- 读取文件内容应优先使用「读取文件」操作而非运行命令，因为读取文件操作自带编码检测
- 命令失败后(如exit 9009=命令未找到)，不要重复同一命令，换用其他操作或修正命令"""
        return f"\n\n## 运行环境\n操作系统: {平台名}\n命令必须与{平台名}兼容。"

    def _构建_react指令(self, fc启用: bool) -> str:
        """构建ReAct指令"""
        if fc启用:
            return """
## 回复格式

你可以通过function calling调用工具来完成任务。系统会自动执行工具并返回结果。

**重要：如果用户只是在闲聊、提问、讨论，不需要执行任何工具，直接输出文字回复即可。**

你可以连续调用多个工具（每次调用后系统返回结果，你再决定下一步）。

当你认为任务已完成，直接输出文字总结即可（不再调用工具）。**任务完成后必须停止，不要继续调用工具做额外操作。**

**严禁输出"调用操作: XXX"这样的文字！** 你必须直接通过function calling（tool_calls）调用工具。

## 关键规则
1. **判断意图**：先判断用户是想聊天还是想执行任务。闲聊/提问→直接文字回复，不调工具。执行任务→调用工具。
2. **任务完成即停**：任务完成后输出总结并停止，绝不继续调工具。
3. **精简执行**：能一步完成不要拆多步。
4. **批量操作**：用户说"生成N张图"时，连续调用N次（每次不同种子），全部完成后输出总结。
5. **失败后换策略**：如果一个操作失败了，不要重复同样的操作。换一种方法。
6. **读取文件优先**：需要看文件内容时，优先用「读取文件」操作(自带编码检测)，不要用运行命令cat/type。
7. **严禁绕过专用操作**：用户提到comfyui、工作流、模型、生图 → 必须用ComfyUI操作。用户要下载文件 → 必须用「多线程下载」。
8. **浏览器操作**：用户要查看网页内容、发帖、分析网站时：
   - 先用「打开网页」打开URL，再用「读取页面结构」或「读取页面内容」获取页面信息
   - 用「分析网页」做深度分析（列表/表格/表单/内容结构）
   - 用「读取页面元素」提取特定元素（链接/图片/按钮/输入框）
   - 操作页面：用「点击网页元素」(需元素角色+名称)和「填写网页表单」(需元素角色+名称+值)
   - 需要登录的网站：先让用户手动登录，再用「保存浏览器会话」保存登录态，下次用「加载浏览器会话」恢复
   - 典型流程：打开网页 → 读取页面结构 → AI决定下一步操作 → 点击/填写 → 读取结果
"""
        else:
            return """
## 回复格式

你需要根据用户需求决定是直接回复还是执行操作。

### 直接回复
如果只需文字回复（闲聊、解释、分析等），直接输出文字即可。

### 执行操作
如果需要执行操作来完成任务，请使用以下JSON格式：

```json
{
  "思考": "分析用户需求，决定要做什么",
  "操作": "操作名称",
  "参数": {"参数名": "参数值"}
}
```

可用操作列表见下方。你可以连续执行多个操作。当你认为任务已完成，直接输出文字总结即可。
"""

    def _获取项目上下文(self, 项目根: Path) -> str:
        """自动获取项目上下文（CLAUDE.md + 自动检测项目类型）"""
        部分 = []

        # 1. 读取 CLAUDE.md
        claude路径 = 项目根 / "CLAUDE.md"
        if claude路径.exists():
            try:
                with open(claude路径, "r", encoding="utf-8") as f:
                    内容 = f.read().strip()
                if 内容:
                    部分.append(内容)
            except Exception:
                pass

        # 2. 自动检测项目类型
        检测信息 = []
        配置文件检测 = [
            ("package.json", "Node.js/npm项目"), ("pyproject.toml", "Python项目(PEP 621)"),
            ("setup.py", "Python项目(setup.py)"), ("requirements.txt", "Python项目"),
            ("Cargo.toml", "Rust项目"), ("go.mod", "Go项目"),
            ("pom.xml", "Maven项目"), ("build.gradle", "Gradle项目"),
            ("Makefile", "Make项目"), ("CMakeLists.txt", "CMake项目"),
        ]
        for 文件名, 描述 in 配置文件检测:
            if (项目根 / 文件名).exists():
                检测信息.append(描述)
                break

        # 3. 检测开发工具
        if (项目根 / ".git").exists():
            检测信息.append("Git版本控制已初始化")
        if (项目根 / ".venv").exists() or (项目根 / "venv").exists():
            检测信息.append("Python虚拟环境已创建")
        if (项目根 / "node_modules").exists():
            检测信息.append("Node.js依赖已安装")
        if (项目根 / ".env").exists():
            检测信息.append("环境变量文件(.env)已配置")

        if 检测信息:
            部分.append("### 项目检测\n" + "\n".join(f"- {i}" for i in 检测信息))

        # 4. 列出最近修改的文件
        try:
            所有py = sorted(项目根.rglob("*.py"), key=lambda p: p.stat().st_mtime, reverse=True)
            最近文件 = []
            for f in 所有py[:10]:
                if "__pycache__" not in str(f) and ".git" not in str(f):
                    相对 = f.relative_to(项目根)
                    最近文件.append(f"- {相对} (修改于{datetime.fromtimestamp(f.stat().st_mtime).strftime('%m-%d %H:%M')})")
            if 最近文件:
                部分.append("### 最近修改\n" + "\n".join(最近文件[:8]))
        except Exception:
            pass

        return "\n\n".join(部分)
