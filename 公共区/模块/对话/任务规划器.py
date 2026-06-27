"""任务规划器 — Plan-and-Execute + 动态重规划

职责：
1. 用LLM生成结构化执行计划（planner角色）
2. 执行中根据新信息动态重规划
3. 判断何时需要触发重规划

对标：
- Devin的Interactive Planning
- 微软Magentic模式的前置阶段
- Claude Code的adaptive planning
"""
import json
from datetime import datetime


class 任务规划器类:
    """Plan-and-Execute规划器"""

    def __init__(self):
        self.最大步骤数 = 10
        self.最大重规划次数 = 2

    def 生成计划(self, 用户消息: str, 对话历史: list, 模型直连器,
                操作注册中心, 提示词构建器=None) -> dict:
        """用LLM生成结构化执行计划

        返回:
            {
                "步骤列表": [
                    {"序号": 1, "说明": "...", "预计操作": "...", "依赖": []},
                    ...
                ],
                "成功标准": "任务完成的具体判定条件",
                "可回退": True
            }
        """
        if not 模型直连器:
            return None

        # 构建操作列表摘要
        操作说明 = ""
        if 操作注册中心:
            操作说明 = 操作注册中心.获取操作说明()[:3000]

        # 构建对话上下文摘要
        上下文文本 = "\n".join(
            f"{m.get('角色', '?')}: {m.get('内容', '')[:100]}"
            for m in 对话历史[-6:] if m.get("内容")
        )[:1000]

        规划提示 = (
            f"用户需求: {用户消息[:500]}\n\n"
            f"对话上下文:\n{上下文文本}\n\n"
            f"可用操作:\n{操作说明}\n\n"
            f"请将任务分解为3-{self.最大步骤数}个可执行步骤。"
            f"每步标注预计使用的操作名称和步骤间的依赖关系。"
            f"定义明确的成功标准。"
        )

        系统提示 = (
            "你是任务规划器。分析用户需求，生成结构化执行计划。\n\n"
            "要求：\n"
            "1. 将任务分解为3-10个可执行步骤\n"
            "2. 每个步骤标注预计使用的操作名称\n"
            "3. 标注步骤间的依赖关系（依赖前面哪些步骤）\n"
            "4. 定义明确的成功标准\n"
            "5. 标注是否支持中途重规划\n\n"
            "输出JSON格式：\n"
            '```json\n'
            '{\n'
            '  "步骤列表": [\n'
            '    {"序号": 1, "说明": "做什么", "预计操作": "操作名", "依赖": []}\n'
            '  ],\n'
            '  "成功标准": "任务完成的具体判定条件",\n'
            '  "可回退": true\n'
            '}\n'
            '```'
        )

        结果 = 模型直连器.发送消息(
            [{"role": "user", "content": 规划提示}],
            系统提示
        )

        if not 结果.get("成功"):
            return None

        回复 = 结果.get("回复内容", "")
        计划 = self._解析计划(回复)
        if 计划:
            print(f"  📋 规划完成: {len(计划.get('步骤列表', []))}步, "
                  f"成功标准: {计划.get('成功标准', 'N/A')[:50]}")
        return 计划

    def 重规划(self, 原计划: dict, 已完成步骤: list, 失败步骤: dict,
              最新观察: str, 用户消息: str, 模型直连器) -> dict:
        """动态重规划：根据执行中的新信息更新计划

        传入：原计划 + 已完成的步骤 + 失败的步骤 + 最新观察
        返回：更新后的计划（可能新增/删除/重排步骤）
        """
        if not 模型直连器:
            return None

        原步骤 = 原计划.get("步骤列表", [])
        完成摘要 = "\n".join(
            f"  步骤{s.get('序号', '?')}: {s.get('说明', '')} → ✅ {s.get('结果', '')[:100]}"
            for s in 已完成步骤
        )[:1000]

        失败摘要 = ""
        if 失败步骤:
            失败摘要 = (
                f"\n失败的步骤:\n"
                f"  步骤{失败步骤.get('序号', '?')}: {失败步骤.get('说明', '')}\n"
                f"  操作: {失败步骤.get('操作', '')}\n"
                f"  错误: {失败步骤.get('结果', '')[:200]}"
            )

        剩余步骤 = [s for s in 原步骤 if s.get("序号", 0) > len(已完成步骤)]
        剩余摘要 = "\n".join(
            f"  步骤{s.get('序号', '?')}: {s.get('说明', '')} (预计: {s.get('预计操作', '')})"
            for s in 剩余步骤
        )[:500]

        重规划提示 = (
            f"用户需求: {用户消息[:300]}\n\n"
            f"原计划:\n{json.dumps(原步骤, ensure_ascii=False, indent=2)[:2000]}\n\n"
            f"已完成的步骤:\n{完成摘要}\n"
            f"{失败摘要}\n"
            f"最新观察: {最新观察[:300]}\n\n"
            f"剩余步骤:\n{剩余摘要}\n\n"
            f"由于执行中遇到新情况，请更新计划：\n"
            f"1. 保留已完成的步骤\n"
            f"2. 根据失败原因和最新观察调整剩余步骤\n"
            f"3. 可以新增、删除或重排步骤\n"
            f"4. 输出完整更新后的计划（包含已完成和未完成的步骤）"
        )

        结果 = 模型直连器.发送消息(
            [{"role": "user", "content": 重规划提示}],
            "你是任务规划器。根据执行中的新信息更新计划。保持已完成步骤不变，调整剩余步骤。输出JSON格式。"
        )

        if not 结果.get("成功"):
            return None

        回复 = 结果.get("回复内容", "")
        新计划 = self._解析计划(回复)
        if 新计划:
            print(f"  🔄 重规划完成: {len(新计划.get('步骤列表', []))}步")
        return 新计划

    def 检查是否需要重规划(self, 当前步骤: dict, 执行结果: dict, 计划: dict) -> bool:
        """判断是否需要触发重规划

        触发条件：
        1. 步骤执行失败
        2. 执行结果与预期不符（结果中包含关键错误信号）
        3. 执行结果中发现了新的子任务线索
        """
        if not 执行结果.get("成功", False):
            return True

        结果文本 = 执行结果.get("数据", "") or 执行结果.get("错误", "")
        if not 结果文本:
            return False

        结果小写 = 结果文本.lower()

        # 关键错误信号
        错误信号 = [
            "不存在", "未找到", "no such file", "not found",
            "权限拒绝", "permission denied", "access denied",
            "无法访问", "无法连接", "connection refused",
            "格式错误", "invalid", "格式不正确",
            "已存在", "already exists",
        ]
        if any(信号 in 结果文本 or 信号 in 结果小写 for 信号 in 错误信号):
            return True

        # 发现新子任务线索
        新任务信号 = ["发现", "还需要", "另外需要", "此外", "另外", "还需要先"]
        if any(信号 in 结果文本 for 信号 in 新任务信号):
            # 只在结果较长时触发（短结果可能是正常回复）
            if len(结果文本) > 200:
                return True

        return False

    def _解析计划(self, 文本: str) -> dict:
        """从LLM输出中解析计划JSON"""
        import re

        # 策略1: ```json ... ``` 代码块
        匹配 = re.search(r'```(?:json)?\s*\n?(.*?)\n?\s*```', 文本, re.DOTALL)
        if 匹配:
            结果 = self._尝试解析计划JSON(匹配.group(1).strip())
            if 结果:
                return 结果

        # 策略2: 直接解析整段
        结果 = self._尝试解析计划JSON(文本.strip())
        if 结果:
            return 结果

        # 策略3: 第一个{ 到最后一个}
        start = 文本.find('{')
        if start != -1:
            end = 文本.rfind('}')
            if end > start:
                结果 = self._尝试解析计划JSON(文本[start:end + 1])
                if 结果:
                    return 结果

        return None

    def _尝试解析计划JSON(self, json字符串: str) -> dict:
        """尝试解析JSON为计划"""
        try:
            数据 = json.loads(json字符串)
            if isinstance(数据, dict) and "步骤列表" in 数据:
                步骤列表 = 数据["步骤列表"]
                if isinstance(步骤列表, list) and len(步骤列表) > 0:
                    # 补全字段
                    for i, 步骤 in enumerate(步骤列表):
                        if "序号" not in 步骤:
                            步骤["序号"] = i + 1
                        if "说明" not in 步骤:
                            步骤["说明"] = f"步骤{i+1}"
                        if "预计操作" not in 步骤:
                            步骤["预计操作"] = ""
                        if "依赖" not in 步骤:
                            步骤["依赖"] = []
                        步骤["状态"] = "待执行"
                    if "成功标准" not in 数据:
                        数据["成功标准"] = "所有步骤执行成功"
                    if "可回退" not in 数据:
                        数据["可回退"] = True
                    return 数据
        except (json.JSONDecodeError, TypeError):
            pass
        return None

    def 构建执行提示(self, 计划: dict, 当前步骤序号: int) -> str:
        """构建executor提示词：告诉AI当前执行计划的哪一步"""
        步骤列表 = 计划.get("步骤列表", [])
        当前步骤 = next((s for s in 步骤列表 if s.get("序号") == 当前步骤序号), {})

        计划摘要 = "\n".join(
            f"  {'✅' if s.get('状态') == '完成' else '⏳' if s.get('序号') == 当前步骤序号 else '⬜'} "
            f"步骤{s.get('序号')}: {s.get('说明', '')} (预计: {s.get('预计操作', '')})"
            for s in 步骤列表
        )

        return (
            f"\n\n## 当前执行计划\n\n{计划摘要}\n\n"
            f"## 当前执行: 第{当前步骤序号}步\n"
            f"说明: {当前步骤.get('说明', '')}\n"
            f"预计操作: {当前步骤.get('预计操作', '')}\n\n"
            f"请根据计划执行当前步骤。如果发现当前步骤无法执行或前提已变，"
            f"在回复中说明原因，系统会自动触发重规划。"
        )


class 任务账本:
    """动态任务账本（对标微软Magentic模式）

    一个动态任务列表，AI可以中途增删改步骤。
    与Plan-and-Execute的区别：计划是静态的，账本是动态的。

    状态：待执行 → 进行中 → 完成/失败/跳过
    """

    待执行 = "待执行"
    进行中 = "进行中"
    完成 = "完成"
    失败 = "失败"
    跳过 = "跳过"

    def __init__(self):
        self.任务列表 = []
        self._下一个ID = 1
        self.最大任务数 = 20

    def 从计划初始化(self, 计划: dict):
        """从Plan-and-Execute的计划初始化账本"""
        self.任务列表 = []
        self._下一个ID = 1
        for 步骤 in 计划.get("步骤列表", []):
            self.任务列表.append({
                "id": self._下一个ID,
                "说明": 步骤.get("说明", ""),
                "预计操作": 步骤.get("预计操作", ""),
                "状态": self.待执行 if 步骤.get("状态") != "完成" else self.完成,
                "结果": 步骤.get("结果", ""),
                "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            })
            self._下一个ID += 1

    def 添加任务(self, 说明: str, 预计操作: str = "", 优先级: int = 0) -> int:
        """中途添加新发现的子任务"""
        if len(self.任务列表) >= self.最大任务数:
            return -1
        task_id = self._下一个ID
        self._下一个ID += 1
        self.任务列表.append({
            "id": task_id,
            "说明": 说明,
            "预计操作": 预计操作,
            "状态": self.待执行,
            "结果": "",
            "优先级": 优先级,
            "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })
        return task_id

    def 完成任务(self, task_id: int, 结果: str = ""):
        """标记任务完成"""
        for t in self.任务列表:
            if t["id"] == task_id:
                t["状态"] = self.完成
                t["结果"] = 结果[:200]
                return True
        return False

    def 失败任务(self, task_id: int, 错误: str = ""):
        """标记任务失败"""
        for t in self.任务列表:
            if t["id"] == task_id:
                t["状态"] = self.失败
                t["结果"] = 错误[:200]
                return True
        return False

    def 删除任务(self, task_id: int, 原因: str = ""):
        """删除不再需要的任务"""
        self.任务列表 = [t for t in self.任务列表 if t["id"] != task_id]
        return True

    def 获取待执行(self) -> dict:
        """获取下一个待执行的任务"""
        for t in self.任务列表:
            if t["状态"] == self.待执行:
                t["状态"] = self.进行中
                return t
        return None

    def 获取状态摘要(self) -> str:
        """返回账本状态摘要，注入到LLM上下文"""
        if not self.任务列表:
            return ""
        完成数 = sum(1 for t in self.任务列表 if t["状态"] == self.完成)
        失败数 = sum(1 for t in self.任务列表 if t["状态"] == self.失败)
        待执行数 = sum(1 for t in self.任务列表 if t["状态"] == self.待执行)
        进行中数 = sum(1 for t in self.任务列表 if t["状态"] == self.进行中)
        跳过数 = sum(1 for t in self.任务列表 if t["状态"] == self.跳过)
        总数 = len(self.任务列表)

        摘要 = f"📋 任务账本: ✅完成{完成数} ❌失败{失败数} ⏳待执行{待执行数} 🔄进行中{进行中数}"
        if 跳过数:
            摘要 += f" ⏭跳过{跳过数}"
        摘要 += f" / 共{总数}个任务\n"
        for t in self.任务列表:
            图标 = {"待执行": "⬜", "进行中": "🔄", "完成": "✅",
                    "失败": "❌", "跳过": "⏭"}.get(t["状态"], "?")
            摘要 += f"  {图标} [{t['id']}] {t['说明'][:50]}"
            if t["结果"]:
                摘要 += f" → {t['结果'][:50]}"
            摘要 += "\n"
        return 摘要

    def 是否全部完成(self) -> bool:
        """检查所有任务是否已处理（完成/失败/跳过）"""
        return all(t["状态"] in (self.完成, self.失败, self.跳过) for t in self.任务列表)

    def 是否有失败(self) -> bool:
        """检查是否有失败的任务"""
        return any(t["状态"] == self.失败 for t in self.任务列表)
