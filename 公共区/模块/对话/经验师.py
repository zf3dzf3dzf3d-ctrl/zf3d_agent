"""经验师 — 任务成功后自动提炼可复用经验文档

职责：
1. 任务成功完成后，从推理过程提炼可复用的操作策略
2. 生成 frontmatter + Markdown 格式的经验文件，存入 隐私区/我的经验/
3. 冗余检测：相似经验合并更新，避免重复
4. 任务开始前召回匹配经验，注入系统提示词

设计原则：
- 经验是"参考指南"不是"可执行脚本"，不需要注册为操作
- LLM调用最小化：冗余检测先走标签/关键词匹配，只在合并时才调LLM
- 门槛检查：只有成功且步数≥3的任务才值得沉淀
"""
import re
import json
from pathlib import Path
from datetime import datetime


class 经验师类:
    """经验师：自动经验提炼 + 冗余控制 + 召回注入"""

    # 任务类型常量
    类型列表 = ["文件操作", "生图", "代码", "搜索", "系统", "网络", "其他"]

    def __init__(self):
        self.经验目录 = None
        self.索引路径 = None
        self.索引 = {"版本": "1.0", "经验列表": [], "标签索引": {}}
        self.模型直连器 = None

    def 初始化(self, 模型直连器, 项目根目录):
        """初始化经验目录和索引"""
        self.模型直连器 = 模型直连器
        self.经验目录 = Path(项目根目录) / "隐私区" / "我的经验"
        self.经验目录.mkdir(parents=True, exist_ok=True)
        self.索引路径 = self.经验目录 / "_索引.json"
        self._加载索引()
        print(f"  ✅ 经验师就绪（已管理 {len(self.索引['经验列表'])} 条经验）")

    def _加载索引(self):
        """从磁盘加载经验索引"""
        if self.索引路径 and self.索引路径.exists():
            try:
                with open(self.索引路径, "r", encoding="utf-8") as f:
                    self.索引 = json.load(f)
                # 补全字段
                self.索引.setdefault("经验列表", [])
                self.索引.setdefault("标签索引", {})
            except Exception:
                self.索引 = {"版本": "1.0", "经验列表": [], "标签索引": {}}

    def _保存索引(self):
        """保存经验索引到磁盘"""
        if not self.索引路径:
            return
        try:
            with open(self.索引路径, "w", encoding="utf-8") as f:
                json.dump(self.索引, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"  ⚠️ 经验索引保存失败: {e}")

    def 沉淀经验(self, 用户消息: str, 推理结果: dict) -> dict:
        """任务成功后调用：提炼经验→冗余检测→保存/更新

        返回 {"操作": "新建"/"合并"/"跳过", "名称": ...}
        """
        # 1. 门槛检查
        if not 推理结果.get("成功", False):
            return {"操作": "跳过", "原因": "任务未成功"}
        步数 = 推理结果.get("步数", 0)
        if 步数 < 3:
            return {"操作": "跳过", "原因": f"步数太少({步数}<3)"}
        if not self.模型直连器:
            return {"操作": "跳过", "原因": "模型直连器未就绪"}

        # 2. 提取推理过程
        推理过程 = 推理结果.get("推理过程", 推理结果.get("完整推理过程", []))
        操作步骤 = [
            s for s in 推理过程
            if s.get("类型") == "操作" and s.get("成功", True)
        ]
        if len(操作步骤) < 2:
            return {"操作": "跳过", "原因": "有效操作步骤太少"}

        # 3. LLM提炼经验
        经验内容 = self._LLM提炼经验(用户消息, 推理过程, 操作步骤, 推理结果)
        if not 经验内容:
            return {"操作": "跳过", "原因": "LLM提炼失败"}

        # 4. 冗余检测（优先级链：合并 > 追加 > 新建）
        匹配结果 = self._搜索相似经验(经验内容.get("name", ""), 经验内容.get("tags", []))
        if 匹配结果:
            最高得分 = 匹配结果[0][1]
            最佳名 = 匹配结果[0][0]
            if 最高得分 >= 7:
                # 高相似 → 合并更新已有经验
                结果 = self._合并更新经验(最佳名, 经验内容)
                print(f"  📝 经验已合并更新: {最佳名} (相似度={最高得分})")
                return {"操作": "合并", "名称": 最佳名}
            elif 最高得分 >= 4:
                # 中相似 → 在已有经验中追加补充说明
                结果 = self._追加到已有经验(最佳名, 经验内容)
                print(f"  📝 经验已追加补充: {最佳名} (相似度={最高得分})")
                return {"操作": "追加", "名称": 最佳名}
        # 低相似或无匹配 → 创建新经验
        名称 = self._保存新经验(经验内容)
        if 名称:
            print(f"  📝 经验已保存: {名称}")
            return {"操作": "新建", "名称": 名称}
        return {"操作": "跳过", "原因": "保存失败"}

    def _LLM提炼经验(self, 用户消息: str, 推理过程: list, 操作步骤: list, 推理结果: dict) -> dict:
        """调用LLM从任务执行过程提炼可复用经验

        返回经验字典，失败返回None
        """
        try:
            # 构建操作步骤摘要
            步骤摘要 = "\n".join(
                f"步{s.get('步骤', '?')}: {s.get('操作', '回复')} -> "
                f"{'OK' if s.get('成功', True) else 'FAIL'} {s.get('结果', '')[:100]}"
                for s in 操作步骤
            )[:1500]

            成功 = 推理结果.get("成功", True)
            步数 = 推理结果.get("步数", 0)

            经验提示 = (
                f"任务: {用户消息[:300]}\n"
                f"成功: {'是' if 成功 else '否'}\n"
                f"总步数: {步数}\n\n"
                f"执行过程:\n{步骤摘要}\n\n"
                f"请提炼可复用的操作经验，输出JSON：\n"
                f'{{"name": "经验名称(简短,用于文件名和搜索)", '
                f'"description": "一句话描述这个经验解决什么问题", '
                f'"type": "文件操作|生图|代码|搜索|系统|网络|其他", '
                f'"tags": ["关键词1", "关键词2"], '
                f'"适用场景": "什么情况下适用此经验", '
                f'"操作步骤": "具体步骤(编号列表)", '
                f'"关键参数": "需要注意的参数说明", '
                f'"注意事项": "操作时的注意点", '
                f'"避免的坑": "容易犯的错误"}}'
            )

            结果 = self.模型直连器.发送消息(
                [{"role": "user", "content": 经验提示}],
                "你是经验提炼专家。从任务执行过程中提炼可复用的操作经验文档。只输出JSON，不要解释。"
            )
            if 结果.get("成功"):
                回复 = 结果.get("回复内容", "")
                json匹配 = re.search(r'\{[\s\S]*\}', 回复)
                if json匹配:
                    经验 = json.loads(json匹配.group())
                    # 补全字段
                    默认值 = {
                        "name": "", "description": "", "type": "其他",
                        "tags": [], "适用场景": "", "操作步骤": "",
                        "关键参数": "", "注意事项": "", "避免的坑": ""
                    }
                    for k, v in 默认值.items():
                        if k not in 经验 or not 经验[k]:
                            经验[k] = v
                    # 确保tags是列表
                    if isinstance(经验["tags"], str):
                        经验["tags"] = [t.strip() for t in 经验["tags"].split(",")]
                    return 经验
        except Exception as e:
            print(f"  ⚠️ 经验提炼失败: {e}")
        return None

    def _搜索相似经验(self, 名称: str, 标签: list) -> list:
        """通过标签+关键词匹配搜索相似经验，返回 [(名称, 得分), ...] 按得分降序"""
        if not self.索引["经验列表"]:
            return []

        得分表 = {}
        名称词 = set(re.split(r'[-_\s,，。]', 名称.lower()))
        名称词.discard("")
        标签集 = set(t.lower() for t in (标签 or []))

        for 条目 in self.索引["经验列表"]:
            得分 = 0
            已有名 = 条目.get("name", "")
            已有标签 = set(t.lower() for t in 条目.get("tags", []))
            已有描述 = 条目.get("description", "").lower()

            # 1. 标签匹配（权重3）
            if 标签集 and 已有标签:
                重叠 = 标签集 & 已有标签
                得分 += len(重叠) * 3

            # 2. 名称/描述关键词匹配（权重2）
            if 名称词:
                已有名小写 = 已有名.lower()
                for 词 in 名称词:
                    if 词 in 已有名小写:
                        得分 += 2
                    if 词 in 已有描述:
                        得分 += 2

            # 3. 标签Jaccard相似度（权重2，解决标签集合重叠但不完全匹配）
            if 标签集 and 已有标签:
                并集 = 标签集 | 已有标签
                交集 = 标签集 & 已有标签
                if 并集:
                    得分 += int((len(交集) / len(并集)) * 4)

            # 得分≥3认为有相似度
            if 得分 >= 3:
                得分表[已有名] = 得分

        if 得分表:
            return sorted(得分表.items(), key=lambda x: x[1], reverse=True)
        return []

    def _追加到已有经验(self, 已有经验名: str, 新经验: dict):
        """在已有经验文档中追加补充说明段落"""
        文件名 = self._名称转文件名(已有经验名) + ".md"
        文件路径 = self.经验目录 / 文件名

        追加内容 = (
            f"\n\n---\n\n## 补充（{datetime.now().strftime('%Y-%m-%d %H:%M')}）\n\n"
            f"**适用场景**: {新经验.get('适用场景', '')}\n\n"
            f"**操作步骤**:\n{新经验.get('操作步骤', '')}\n\n"
            f"**注意事项**: {新经验.get('注意事项', '')}\n\n"
            f"**避免的坑**: {新经验.get('避免的坑', '')}\n"
        )
        try:
            with open(文件路径, "a", encoding="utf-8") as f:
                f.write(追加内容)
            self._更新索引条目(已有经验名, 新经验, 合并操作=True)
            return 已有经验名
        except Exception as e:
            print(f"  ⚠️ 经验追加失败: {e}")
            return None

    def _合并更新经验(self, 已有经验名: str, 新经验: dict):
        """合并更新已有经验文档"""
        文件名 = self._名称转文件名(已有经验名) + ".md"
        文件路径 = self.经验目录 / 文件名

        # 读取已有经验
        已有内容 = ""
        if 文件路径.exists():
            with open(文件路径, "r", encoding="utf-8") as f:
                已有内容 = f.read()

        # 用LLM合并
        if self.模型直连器 and 已有内容:
            try:
                合并提示 = (
                    f"已有经验文档:\n{已有内容[:2000]}\n\n"
                    f"新经验信息:\n{json.dumps(新经验, ensure_ascii=False, indent=2)[:2000]}\n\n"
                    f"请合并为一份完整的经验文档。保留原有结构，补充新发现的方法和注意事项。"
                    f"输出合并后的完整Markdown文档（含frontmatter）。"
                )
                结果 = self.模型直连器.发送消息(
                    [{"role": "user", "content": 合并提示}],
                    "你是文档合并专家。合并两份经验文档，去重补充，保持结构完整。只输出合并后的文档。"
                )
                if 结果.get("成功"):
                    合并内容 = 结果.get("回复内容", "")
                    if 合并内容 and len(合并内容) > 50:
                        # 写入文件
                        with open(文件路径, "w", encoding="utf-8") as f:
                            f.write(合并内容)
                        # 更新索引
                        self._更新索引条目(已有经验名, 新经验, 合并操作=True)
                        return 已有经验名
            except Exception as e:
                print(f"  ⚠️ 经验合并失败: {e}")

        # LLM合并失败时，简单追加新经验内容
        追加内容 = (
            f"\n\n---\n\n## 补充（{datetime.now().strftime('%Y-%m-%d %H:%M')}）\n\n"
            f"**适用场景**: {新经验.get('适用场景', '')}\n\n"
            f"**操作步骤**:\n{新经验.get('操作步骤', '')}\n\n"
            f"**注意事项**: {新经验.get('注意事项', '')}\n\n"
            f"**避免的坑**: {新经验.get('避免的坑', '')}\n"
        )
        with open(文件路径, "a", encoding="utf-8") as f:
            f.write(追加内容)
        self._更新索引条目(已有经验名, 新经验, 合并操作=True)
        return 已有经验名

    def _保存新经验(self, 经验内容: dict) -> str:
        """保存新经验文档+更新索引

        返回经验名称，失败返回None
        """
        名称 = 经验内容.get("name", "").strip()
        if not 名称:
            return None

        文件名 = self._名称转文件名(名称) + ".md"
        文件路径 = self.经验目录 / 文件名

        # 检查文件名冲突
        if 文件路径.exists():
            # 加时间戳后缀
            时间戳 = datetime.now().strftime("%H%M%S")
            文件名 = self._名称转文件名(名称) + f"_{时间戳}.md"
            文件路径 = self.经验目录 / 文件名

        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        标签 = 经验内容.get("tags", [])

        # 构建 frontmatter
        frontmatter = (
            f"---\n"
            f"name: {名称}\n"
            f"description: {经验内容.get('description', '无描述')}\n"
            f"type: {经验内容.get('type', '其他')}\n"
            f"tags: [{', '.join(标签)}]\n"
            f"created: {now}\n"
            f"updated: {now}\n"
            f"use_count: 0\n"
            f"task_source: \"{经验内容.get('task_source', '')[:200]}\"\n"
            f"---\n\n"
        )

        # 构建正文
        正文 = f"# {名称}\n\n"
        正文 += f"## 适用场景\n{经验内容.get('适用场景', '')}\n\n"
        正文 += f"## 操作步骤\n{经验内容.get('操作步骤', '')}\n\n"
        正文 += f"## 关键参数\n{经验内容.get('关键参数', '')}\n\n"
        正文 += f"## 注意事项\n{经验内容.get('注意事项', '')}\n\n"
        正文 += f"## 避免的坑\n{经验内容.get('避免的坑', '')}\n"

        # 写入文件
        try:
            with open(文件路径, "w", encoding="utf-8") as f:
                f.write(frontmatter + 正文)
        except Exception as e:
            print(f"  ⚠️ 经验文件写入失败: {e}")
            return None

        # 更新索引
        self._添加索引条目(文件名, 名称, 经验内容.get("description", ""), 经验内容.get("type", "其他"), 标签)
        self._保存索引()
        return 名称

    def _更新索引条目(self, 名称: str, 新经验: dict, 合并操作: bool = False):
        """更新已有经验的索引条目"""
        for 条目 in self.索引["经验列表"]:
            if 条目.get("name") == 名称:
                # 更新时间
                条目["updated"] = datetime.now().strftime("%Y-%m-%d %H:%M")
                条目["use_count"] = 条目.get("use_count", 0) + 1
                # 标签取并集
                旧标签 = set(条目.get("tags", []))
                新标签 = set(新经验.get("tags", []))
                合并标签 = list(旧标签 | 新标签)
                条目["tags"] = 合并标签
                # 更新标签索引
                for 标签 in 新标签 - 旧标签:
                    self.索引["标签索引"].setdefault(标签, []).append(名称)
                break
        self._保存索引()

    def _添加索引条目(self, 文件名: str, 名称: str, 描述: str, 类型: str, 标签: list):
        """添加新经验到索引"""
        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        条目 = {
            "文件名": 文件名,
            "name": 名称,
            "description": 描述,
            "type": 类型,
            "tags": 标签,
            "created": now,
            "updated": now,
            "use_count": 0
        }
        self.索引["经验列表"].append(条目)
        # 更新标签索引
        for 标签 in 标签:
            if 标签 not in self.索引["标签索引"]:
                self.索引["标签索引"][标签] = []
            if 名称 not in self.索引["标签索引"][标签]:
                self.索引["标签索引"][标签].append(名称)

    def 召回经验(self, 用户消息: str, limit: int = 3) -> str:
        """任务开始前调用：搜索匹配的经验返回注入文本

        返回格式化的经验文本，无匹配返回空字符串
        """
        if not self.索引["经验列表"] or not 用户消息 or len(用户消息) < 3:
            return ""

        # 提取用户消息关键词
        消息词 = set(re.split(r'[-_\s,，。、！？\.!?]', 用户消息.lower()))
        消息词.discard("")

        得分表 = {}
        for 条目 in self.索引["经验列表"]:
            得分 = 0
            名称 = 条目.get("name", "")
            描述 = 条目.get("description", "")
            标签 = set(t.lower() for t in 条目.get("tags", []))
            类型 = 条目.get("type", "")

            # 标签匹配（权重3）
            for 词 in 消息词:
                if 词 in 标签:
                    得分 += 3

            # 名称/描述关键词匹配（权重2）
            名称小写 = 名称.lower()
            描述小写 = 描述.lower()
            for 词 in 消息词:
                if len(词) > 1:  # 单字不匹配
                    if 词 in 名称小写:
                        得分 += 2
                    if 词 in 描述小写:
                        得分 += 2

            # 反向包含：名称或描述是用户消息的子串（权重2，解决中文无空格分词问题）
            消息小写 = 用户消息.lower()
            if 名称 and 名称小写 in 消息小写:
                得分 += 2
            if 描述 and len(描述) > 2 and 描述小写 in 消息小写:
                得分 += 1

            # 类型匹配（权重1）
            for 词 in 消息词:
                if 词 == 类型.lower():
                    得分 += 1

            if 得分 > 0:
                得分表[名称] = 得分

        if not 得分表:
            return ""

        # 取得分最高的N条，use_count高的优先
        排序结果 = sorted(得分表.keys(),
                          key=lambda x: (得分表[x], self._获取use_count(x)),
                          reverse=True)[:limit]

        # 读取经验文档内容
        经验文本 = []
        for i, 名称 in enumerate(排序结果, 1):
            文件名 = self._名称转文件名(名称) + ".md"
            文件路径 = self.经验目录 / 文件名
            if 文件路径.exists():
                try:
                    with open(文件路径, "r", encoding="utf-8") as f:
                        内容 = f.read()
                    # 提取正文（去掉frontmatter）
                    正文匹配 = re.search(r'^---\s*\n.*?\n---\s*\n(.*)', 内容, re.DOTALL)
                    正文 = 正文匹配.group(1).strip() if 正文匹配 else 内容
                    经验文本.append(f"### 经验{i}: {名称}\n\n{正文[:2000]}")
                except Exception:
                    pass

        if not 经验文本:
            return ""

        return "\n\n---\n\n".join(经验文本)

    def _名称转文件名(self, name: str) -> str:
        """将经验名称转为合法文件名"""
        文件名 = name.strip().lower()
        文件名 = re.sub(r'[\\/:*?"<>|]', '-', 文件名)
        文件名 = re.sub(r'\s+', '-', 文件名)
        文件名 = re.sub(r'-+', '-', 文件名)
        文件名 = 文件名.strip('-')
        return 文件名 or "unnamed"

    def _获取use_count(self, 名称: str) -> int:
        """从索引获取经验的使用次数"""
        for 条目 in self.索引["经验列表"]:
            if 条目.get("name") == 名称:
                return 条目.get("use_count", 0)
        return 0

    def 列出经验(self) -> list:
        """列出所有经验摘要"""
        return [
            {
                "name": e.get("name", ""),
                "description": e.get("description", ""),
                "type": e.get("type", ""),
                "tags": e.get("tags", []),
                "created": e.get("created", ""),
                "updated": e.get("updated", ""),
                "use_count": e.get("use_count", 0)
            }
            for e in self.索引.get("经验列表", [])
        ]

    def 删除经验(self, 名称: str) -> bool:
        """删除指定经验"""
        文件名 = self._名称转文件名(名称) + ".md"
        文件路径 = self.经验目录 / 文件名
        已删除 = False
        if 文件路径.exists():
            文件路径.unlink()
            已删除 = True
        # 从索引中移除
        原长度 = len(self.索引["经验列表"])
        self.索引["经验列表"] = [
            e for e in self.索引["经验列表"]
            if e.get("name") != 名称
        ]
        # 清理标签索引
        for 标签 in list(self.索引["标签索引"].keys()):
            self.索引["标签索引"][标签] = [
                n for n in self.索引["标签索引"][标签] if n != 名称
            ]
            if not self.索引["标签索引"][标签]:
                del self.索引["标签索引"][标签]
        if len(self.索引["经验列表"]) < 原长度:
            已删除 = True
        if 已删除:
            self._保存索引()
        return 已删除
