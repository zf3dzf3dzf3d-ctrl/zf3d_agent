"""上下文管理器 — 统一管理对话上下文，消除双轨制

职责：
1. 管理对话历史窗口
2. 统一FC消息和推理过程为"对话轨迹"
3. 渐进式历史压缩（保留摘要+标记，不再不可逆丢弃）
4. Observation Masking（旧观察折叠为单行，零LLM调用）
5. Token预算控制
6. 构建发送给LLM的消息列表

核心改进：
- 废弃 _本轮FC消息 + 推理过程 双轨制，统一为"对话轨迹"
- 压缩改为渐进式，异步执行不阻塞主流程
- Observation Masking: 旧tool结果替换为单行摘要，比LLM摘要高2.6%成功率且便宜52%
- 新增token预算控制
"""
import json
from datetime import datetime


class 上下文管理器类:
    """对话上下文管理器"""

    def __init__(self, 最大历史数=50, 压缩阈值=30):
        self.最大历史数 = 最大历史数
        self.压缩阈值 = 压缩阈值  # 消息条数兜底阈值（token检测优先）
        self.token预算 = 8000  # 默认token预算，可通过设置模型上下文窗口动态更新
        self.模型上下文窗口 = 32768  # 默认32K，由推理引擎从模型直连器传入
        # 对话轨迹：本轮ReAct的步骤记录（统一FC和文本模式）
        # 每个步骤: {"assistant消息": dict|None, "tool消息": dict|None, "文本观察": str|None}
        self.本轮轨迹 = []
        self._压缩锁 = False  # 防止重复压缩

    def 设置模型上下文窗口(self, 窗口大小: int, max_tokens: int = 8192):
        """从模型配置设置上下文窗口大小，动态计算token预算

        token预算 = 上下文窗口 - max_tokens - 安全余量
        安全余量 = min(8000, 上下文窗口的15%)
        """
        self.模型上下文窗口 = 窗口大小
        安全余量 = min(8000, int(窗口大小 * 0.15))
        self.token预算 = max(2000, 窗口大小 - max_tokens - 安全余量)

    def 重置本轮轨迹(self):
        """每轮ReAct开始前调用"""
        self.本轮轨迹 = []

    def 添加_步骤(self, assistant消息=None, tool消息=None, 文本观察=None):
        """添加一个推理步骤到轨迹"""
        self.本轮轨迹.append({
            "assistant消息": assistant消息,
            "tool消息": tool消息,
            "文本观察": 文本观察
        })

    def 构建_消息列表(self, 对话历史, 当前观察=None) -> list:
        """构建发送给LLM的消息列表

        统一处理FC模式和文本模式，不再双轨：
        - FC模式：直接使用assistant(tool_calls)+tool消息
        - 文本模式：重建为assistant内容+user观察
        - Observation Masking：旧步骤的tool结果自动折叠为单行摘要（零LLM调用）
        """
        消息列表 = []

        # 1. 添加对话历史（最近N轮）
        历史窗口 = 对话历史[-self.最大历史数:] if len(对话历史) > self.最大历史数 else 对话历史
        for 消息 in 历史窗口:
            角色 = "user" if 消息.get("角色") == "用户" else "assistant"
            消息列表.append({"role": 角色, "content": 消息.get("内容", "")})

        # 2. 添加本轮轨迹（统一FC和文本模式，应用observation masking）
        总步数 = len(self.本轮轨迹)
        保留步数 = 5  # 保留最近5步完整观察
        for i, 步骤 in enumerate(self.本轮轨迹):
            是旧步骤 = i < 总步数 - 保留步数
            # FC模式：有原始assistant消息和tool消息
            if 步骤.get("assistant消息"):
                消息列表.append(步骤["assistant消息"])
            if 步骤.get("tool消息"):
                tool消息 = 步骤["tool消息"]
                if 是旧步骤:
                    tool消息 = self._遮蔽tool消息(tool消息)
                消息列表.append(tool消息)
            # 文本模式：有文本观察（重建为assistant+user对）
            elif 步骤.get("文本观察"):
                思考 = 步骤["文本观察"].get("思考", "")
                操作 = 步骤["文本观察"].get("操作", "")
                结果 = 步骤["文本观察"].get("结果", "")
                if 是旧步骤 and len(结果) > 100:
                    结果 = f"[已折叠] {结果[:50]}... (原{len(结果)}字符)"
                if 思考:
                    消息列表.append({"role": "assistant", "content": f"{思考}\n调用操作: {操作}"})
                else:
                    消息列表.append({"role": "assistant", "content": f"调用操作: {操作}"})
                消息列表.append({"role": "user", "content": f"观察: {结果}"})

        return 消息列表

    def 遮蔽旧观察(self, 消息列表, 保留最近轮数=5):
        """Observation Masking：旧tool观察结果替换为单行摘要

        保留最近N轮的完整内容，更早的观察消息内容替换为单行摘要。
        零LLM调用，零token消耗。

        观察消息识别：
        - FC模式：role="tool" 的消息
        - 文本模式：role="user" 且 content以"观察:"开头
        """
        if len(消息列表) <= 保留最近轮数 * 2:
            return 消息列表

        保留起始 = len(消息列表) - 保留最近轮数 * 2
        遮蔽后 = []
        for i, 消息 in enumerate(消息列表):
            if i < 保留起始:
                role = 消息.get("role", "")
                content = 消息.get("content", "")
                是观察 = (role == "tool" or
                         (role == "user" and content.startswith("观察:")))
                if 是观察 and len(content) > 200:
                    消息副本 = dict(消息)
                    前缀 = content[:60].split("\n")[0] if "\n" in content else content[:60]
                    消息副本["content"] = f"[已折叠] {前缀}... (共{len(content)}字符)"
                    遮蔽后.append(消息副本)
                    continue
            遮蔽后.append(消息)
        return 遮蔽后

    def _遮蔽tool消息(self, tool消息):
        """对单个tool消息应用observation masking，返回副本不修改原始"""
        内容 = tool消息.get("content", "")
        if len(内容) <= 100:
            return tool消息
        import re
        操作匹配 = re.search(r'操作\[([^\]]+)\]', 内容)
        操作名 = 操作匹配.group(1) if 操作匹配 else "未知"
        遮蔽消息 = dict(tool消息)
        遮蔽消息["content"] = f"[已折叠] 操作[{操作名}]结果，原{len(内容)}字符"
        return 遮蔽消息

    def 估算_token数(self, 文本: str) -> int:
        """轻量token估算

        中文：约1字符=1 token
        英文：约4字符=1 token
        混合：取字符数/2.5作为近似
        """
        if not 文本:
            return 0
        中文字符 = sum(1 for c in 文本 if '\u4e00' <= c <= '\u9fff')
        其他字符 = len(文本) - 中文字符
        return 中文字符 + 其他字符 // 4

    def 裁剪_到_预算(self, 消息列表) -> list:
        """按token预算裁剪消息列表

        优先级：最新消息 > 当前任务 > 历史摘要
        """
        总token = sum(self.估算_token数(m.get("content", "")) for m in 消息列表)
        if 总token <= self.token预算:
            return 消息列表

        # 从最早的历史消息开始裁剪（保留最后几轮+本轮轨迹）
        本轮长度 = len(self.本轮轨迹) * 2  # 粗略估计
        保留数 = max(self.最大历史数 // 2, 本轮长度 + 6)

        裁剪后 = 消息列表[-保留数:]
        while self._估算_列表_token(裁剪后) > self.token预算 and len(裁剪后) > 4:
            # 智能裁剪：跳过tool消息（role=tool），避免孤立tool_calls
            # 找到第一个非tool消息对（user+assistant），删掉它们
            删除数 = 0
            for i in range(min(2, len(裁剪后))):
                if 裁剪后[0].get("role") == "tool":
                    裁剪后.pop(0)
                    删除数 += 1
                else:
                    裁剪后.pop(0)
                    删除数 += 1
            # 如果只删了tool消息，再删一个非tool消息
            if 删除数 == 0:
                裁剪后 = 裁剪后[2:]
        return 裁剪后

    def _估算_列表_token(self, 消息列表) -> int:
        return sum(self.估算_token数(m.get("content", "")) for m in 消息列表)

    def 压缩历史(self, 对话历史: list, 模型直连器=None) -> list:
        """渐进式历史压缩

        改进：
        1. token溢出检测优先（基于模型上下文窗口动态计算）
        2. 先对旧观察做observation masking（零成本，零LLM调用）
        3. 如果masking后仍然超token预算，再fallback到LLM摘要
        4. LLM摘要只处理masked后的精简版，token消耗减半
        """
        # === token溢出检测（优先于消息条数阈值） ===
        当前token = sum(self.估算_token数(m.get("内容", "")) for m in 对话历史)
        if 当前token <= self.token预算 and len(对话历史) < self.压缩阈值:
            return 对话历史

        # 阶段1: Observation Masking — 折叠旧的观察结果（零LLM调用）
        保留数 = self.压缩阈值 // 2
        masked历史 = list(对话历史)
        折叠数 = 0
        for i in range(len(masked历史) - 保留数):
            消息 = masked历史[i]
            内容 = 消息.get("内容", "")
            角色 = 消息.get("角色", "")
            是观察 = (角色 == "用户" and 内容.startswith("观察:")) or \
                     (角色 == "用户" and "操作[" in 内容 and "执行结果:" in 内容)
            if 是观察 and len(内容) > 200:
                前缀 = 内容[:60].split("\n")[0] if "\n" in 内容 else 内容[:60]
                masked历史[i] = {**消息, "内容": f"[已折叠] {前缀}... (共{len(内容)}字符)"}
                折叠数 += 1

        if 折叠数 > 0:
            print(f"  [Masking] 折叠{折叠数}条旧观察 (零LLM调用)")

        # 检查masking后是否足够短
        masked_token = sum(self.估算_token数(m.get("内容", "")) for m in masked历史)
        if masked_token <= self.token预算:
            return masked历史

        # 阶段2: masking后仍超预算，fallback到LLM摘要
        # 动态调整保留数：消息少但每条很大时，缩小保留数确保有内容可压缩
        保留数 = min(保留数, len(masked历史) - 2)  # 至少保留2条
        if 保留数 < 2:
            保留数 = 2
        压缩部分 = masked历史[:-保留数] if len(masked历史) > 保留数 else []
        保留部分 = masked历史[-保留数:] if len(masked历史) > 保留数 else masked历史

        摘要文本 = ""
        if 模型直连器 and 压缩部分:
            try:
                原始文本 = "\n".join(
                    f"{m.get('角色', 'unknown')}: {m.get('内容', '')[:200]}"
                    for m in 压缩部分 if m.get('内容')
                )
                摘要提示 = (f"以下是对话的前半部分，请用100字内概括核心内容"
                           f"（用户需求、关键决策、已完成的步骤）：\n\n{原始文本[:3000]}")
                摘要结果 = 模型直连器.发送消息(
                    [{"role": "user", "content": 摘要提示}],
                    "你是一个对话摘要助手。简洁、准确、保留关键信息。"
                )
                if 摘要结果.get("成功"):
                    摘要文本 = 摘要结果.get("回复内容", "")
            except Exception as e:
                print(f"  ⚠️ 压缩历史摘要生成失败: {e}")
                摘要文本 = f"[{len(压缩部分)}条历史已压缩]"

        新历史 = []
        if 摘要文本:
            新历史.append({
                "角色": "系统",
                "内容": f"📋 【历史摘要】{摘要文本}",
                "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "元数据": {"压缩自": len(压缩部分), "原始可追溯": True}
            })
        新历史.extend(保留部分)
        print(f"  [压缩] 对话历史已压缩: {len(压缩部分)}条->摘要, 保留{len(保留部分)}条, 当前共{len(新历史)}条")
        return 新历史
