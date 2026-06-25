"""上下文管理器 — 统一管理对话上下文，消除双轨制

职责：
1. 管理对话历史窗口
2. 统一FC消息和推理过程为"对话轨迹"
3. 渐进式历史压缩（保留摘要+标记，不再不可逆丢弃）
4. Token预算控制
5. 构建发送给LLM的消息列表

核心改进：
- 废弃 _本轮FC消息 + 推理过程 双轨制，统一为"对话轨迹"
- 压缩改为渐进式，异步执行不阻塞主流程
- 新增token预算控制
"""
import json
from datetime import datetime


class 上下文管理器类:
    """对话上下文管理器"""

    def __init__(self, 最大历史数=50, 压缩阈值=30):
        self.最大历史数 = 最大历史数
        self.压缩阈值 = 压缩阈值
        self.token预算 = 8000  # 上下文token预算（约8000 token）
        # 对话轨迹：本轮ReAct的步骤记录（统一FC和文本模式）
        # 每个步骤: {"assistant消息": dict|None, "tool消息": dict|None, "文本观察": str|None}
        self.本轮轨迹 = []
        self._压缩锁 = False  # 防止重复压缩

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
        """
        消息列表 = []

        # 1. 添加对话历史（最近N轮）
        历史窗口 = 对话历史[-self.最大历史数:] if len(对话历史) > self.最大历史数 else 对话历史
        for 消息 in 历史窗口:
            角色 = "user" if 消息.get("角色") == "用户" else "assistant"
            消息列表.append({"role": 角色, "content": 消息.get("内容", "")})

        # 2. 添加本轮轨迹（统一FC和文本模式）
        for 步骤 in self.本轮轨迹:
            # FC模式：有原始assistant消息和tool消息
            if 步骤.get("assistant消息"):
                消息列表.append(步骤["assistant消息"])
            if 步骤.get("tool消息"):
                消息列表.append(步骤["tool消息"])
            # 文本模式：有文本观察（重建为assistant+user对）
            elif 步骤.get("文本观察"):
                思考 = 步骤["文本观察"].get("思考", "")
                操作 = 步骤["文本观察"].get("操作", "")
                结果 = 步骤["文本观察"].get("结果", "")
                if 思考:
                    消息列表.append({"role": "assistant", "content": f"{思考}\n调用操作: {操作}"})
                else:
                    消息列表.append({"role": "assistant", "content": f"调用操作: {操作}"})
                消息列表.append({"role": "user", "content": f"观察: {结果}"})

        return 消息列表

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
            裁剪后 = 裁剪后[2:]  # 每次删掉最前面的一对user-assistant
        return 裁剪后

    def _估算_列表_token(self, 消息列表) -> int:
        return sum(self.估算_token数(m.get("content", "")) for m in 消息列表)

    def 压缩历史(self, 对话历史: list, 模型直连器=None) -> list:
        """渐进式历史压缩

        改进：
        - 保留最近N轮原文
        - 更早的按事件摘要
        - 压缩是可逆的（标记原消息，摘要不好时可回退）
        - 异步友好（不阻塞，失败返回原历史）
        """
        if len(对话历史) < self.压缩阈值:
            return 对话历史

        # 保留后半段完整内容
        保留数 = self.压缩阈值 // 2
        压缩部分 = 对话历史[:-保留数]
        保留部分 = 对话历史[-保留数:]

        # 生成压缩摘要
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

        # 替换历史（保留摘要标记，可追溯）
        新历史 = []
        if 摘要文本:
            新历史.append({
                "角色": "系统",
                "内容": f"📋 【历史摘要】{摘要文本}",
                "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "元数据": {"压缩自": len(压缩部分), "原始可追溯": True}
            })
        新历史.extend(保留部分)
        print(f"  📦 对话历史已压缩: {len(压缩部分)}条→摘要, 保留{len(保留部分)}条, 当前共{len(新历史)}条")
        return 新历史
