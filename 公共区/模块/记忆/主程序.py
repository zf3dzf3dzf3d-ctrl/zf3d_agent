"""记忆模块 v2 - 事件制记忆+单文件存储+索引+自动召回+交叉引用
每条记忆独立文件(frontmatter格式)，MEMORY.md索引，[[链接]]交叉引用
基于当前上下文的自动召回
"""
import json
import re
import os
import threading
from pathlib import Path
from datetime import datetime

from 配置加载器 import 全局事件中心


class 记忆模块:
    def __init__(self):
        self.配置 = {}
        self.模型直连器 = None
        self.记忆存储目录 = None  # 条目文件存储目录
        self.索引文件路径 = None  # MEMORY.md 路径
        self.索引数据路径 = None  # _索引.json (元数据索引)
        self.记忆库 = {}  # 旧格式兼容
        self.用户画像 = {}
        self.摘要索引 = {}
        self.事件计数 = 0
        self.摘要计数 = 0
        self._摘要锁 = threading.Lock()  # 摘要生成线程安全锁

    def 初始化(self, 配置: dict):
        """初始化记忆模块"""
        self.配置 = 配置
        self.模型直连器 = 配置.get("模型直连器")
        项目根目录 = Path(配置.get("项目根目录", "."))

        # 记忆存储目录（单文件条目）
        self.记忆存储目录 = 项目根目录 / "隐私区" / "我的记忆" / "条目"
        self.记忆存储目录.mkdir(parents=True, exist_ok=True)

        # 索引文件
        self.索引文件路径 = 项目根目录 / "隐私区" / "我的记忆" / "MEMORY.md"
        self.索引数据路径 = 项目根目录 / "隐私区" / "我的记忆" / "_索引.json"

        # 旧格式路径（兼容）
        self.记忆库路径 = 项目根目录 / "隐私区" / "我的记忆" / "记忆库.json"
        self.用户画像路径 = 项目根目录 / "隐私区" / "我的记忆" / "用户画像.json"
        self.摘要索引路径 = 项目根目录 / "隐私区" / "我的记忆" / "摘要索引.json"

        # 加载已有数据
        self.记忆库 = self._读取JSON(self.记忆库路径)
        self.用户画像 = self._读取JSON(self.用户画像路径)
        self.摘要索引 = self._读取JSON(self.摘要索引路径)
        self.索引数据 = self._读取JSON(self.索引数据路径)

        if "条目" not in self.索引数据:
            self.索引数据["条目"] = {}
        if "标签索引" not in self.索引数据:
            self.索引数据["标签索引"] = {}

        # 计算事件编号起点
        已有事件 = self.记忆库.get("事件列表", {})
        if 已有事件:
            编号列表 = [int(k.replace("事件_", "")) for k in 已有事件.keys() if k.startswith("事件_")]
            self.事件计数 = max(编号列表) if 编号列表 else 0

        # 计算摘要编号起点
        索引列表 = self.摘要索引.get("索引", [])
        if 索引列表:
            编号列表 = [int(s.get("编号", "摘要_000").replace("摘要_", "")) for s in 索引列表 if s.get("编号")]
            self.摘要计数 = max(编号列表) if 编号列表 else 0

        全局事件中心.订阅("收到消息", self._处理消息)
        全局事件中心.订阅("话题切换", self._处理话题切换)
        全局事件中心.订阅("需生成摘要", self._生成摘要)

    def 运行(self, 输入数据: dict) -> dict:
        """执行记忆操作"""
        操作 = 输入数据.get("操作", "")

        if 操作 == "添加对话":
            return self._添加对话(输入数据.get("角色", ""), 输入数据.get("内容", ""))
        elif 操作 == "新建事件":
            return self._新建事件(输入数据.get("标题", ""))
        elif 操作 == "获取当前事件":
            return self._获取当前事件()
        elif 操作 == "获取记忆注入":
            return self._获取记忆注入(输入数据.get("当前消息", ""), 输入数据.get("新对话", False),
                                      轻量=输入数据.get("轻量", False))
        elif 操作 == "归档当前事件":
            return self._归档当前事件()
        elif 操作 == "更新用户画像":
            return self._更新用户画像(输入数据.get("信息", ""))
        elif 操作 == "搜索记忆":
            return self._搜索记忆(输入数据.get("关键词", ""))
        elif 操作 == "记住":
            # 手动添加一条记忆
            return self._记住(
                name=输入数据.get("name", ""),
                description=输入数据.get("description", ""),
                content=输入数据.get("content", ""),
                memory_type=输入数据.get("memory_type", "reference"),
                tags=输入数据.get("tags", [])
            )
        elif 操作 == "列出记忆":
            return self._列出记忆(输入数据.get("标签过滤", ""))
        elif 操作 == "删除记忆":
            return self._删除记忆(输入数据.get("name", ""))
        else:
            return {"成功": False, "错误": f"未知操作: {操作}"}

    def 停止(self):
        """停止记忆模块，保存所有数据"""
        self._保存记忆库()
        self._保存用户画像()
        self._保存摘要索引()
        self._保存索引数据()

    # ============ v2 单文件记忆系统 ============

    def _记住(self, name: str, description: str, content: str,
              memory_type: str = "reference", tags: list = None) -> dict:
        """保存一条记忆为独立文件（frontmatter格式）

        参数:
            name: 记忆名称（用作文件名）
            description: 一句话描述
            content: 记忆正文内容
            memory_type: 类型(user/feedback/project/reference)
            tags: 标签列表
        """
        if not name:
            return {"成功": False, "错误": "记忆名称不能为空"}

        # 生成合法文件名
        文件名 = self._名称转文件名(name) + ".md"
        文件路径 = self.记忆存储目录 / 文件名

        # 构建 frontmatter
        now = datetime.now().isoformat()
        标签 = tags or []
        frontmatter = f"""---
name: {name}
description: {description or '无描述'}
metadata:
  type: {memory_type}
  created: {now}
  updated: {now}
tags: [{', '.join(标签)}]
---

{content}
"""
        try:
            with open(文件路径, "w", encoding="utf-8") as f:
                f.write(frontmatter)

            # 更新索引
            self.索引数据.setdefault("条目", {})[name] = {
                "文件名": 文件名,
                "描述": description,
                "类型": memory_type,
                "标签": 标签,
                "创建时间": now,
                "更新时间": now
            }
            # 更新标签索引
            for tag in 标签:
                self.索引数据.setdefault("标签索引", {}).setdefault(tag, []).append(name)

            self._保存索引数据()
            self._更新MEMORY索引()

            # 同步插入向量索引（用于语义搜索）
            try:
                from 存储引擎 import 获取存储引擎
                引擎 = 获取存储引擎()
                向量文本 = f"{name} {description} {content[:500]}"
                引擎.插入记忆向量(name, 向量文本)
            except Exception:
                pass  # 向量索引失败不影响记忆保存

            return {"成功": True, "数据": f"已记住: {name}"}
        except Exception as e:
            return {"成功": False, "错误": f"保存记忆失败: {e}"}

    def _列出记忆(self, 标签过滤: str = "") -> dict:
        """列出所有记忆条目（从索引读取，不读文件内容）"""
        条目 = self.索引数据.get("条目", {})
        结果 = []
        for name, info in 条目.items():
            if 标签过滤:
                标签列表 = info.get("标签", [])
                if 标签过滤 not in 标签列表:
                    continue
            结果.append({
                "name": name,
                "描述": info.get("描述", ""),
                "类型": info.get("类型", ""),
                "标签": info.get("标签", []),
                "创建时间": info.get("创建时间", "")
            })
        return {"成功": True, "数据": 结果}

    def _删除记忆(self, name: str) -> dict:
        """删除一条记忆"""
        条目 = self.索引数据.get("条目", {})
        if name not in 条目:
            return {"成功": False, "错误": f"未找到记忆: {name}"}

        文件名 = 条目[name]["文件名"]
        文件路径 = self.记忆存储目录 / 文件名

        # 删除文件
        if 文件路径.exists():
            文件路径.unlink()

        # 从标签索引移除
        for tag in 条目[name].get("标签", []):
            tag_list = self.索引数据.get("标签索引", {}).get(tag, [])
            if name in tag_list:
                tag_list.remove(name)

        # 从条目索引移除
        del self.索引数据["条目"][name]

        # 同步删除向量索引
        try:
            from 存储引擎 import 获取存储引擎
            引擎 = 获取存储引擎()
            引擎.删除记忆向量(name)
        except Exception:
            pass

        self._保存索引数据()
        self._更新MEMORY索引()

        return {"成功": True, "数据": f"已删除记忆: {name}"}

    def _自动召回记忆(self, 当前消息: str, 最大数: int = 5) -> list:
        """基于当前消息自动召回相关记忆 v2.1

        支持：
        1. 标签匹配（快速）
        2. 关键词匹配（中等）
        3. LLM语义匹配（精准，当关键词匹配不足时触发）
        """
        if not 当前消息:
            return []

        相关 = []
        条目 = self.索引数据.get("条目", {})

        # 提取消息中的关键词
        消息词集 = set()
        for 词 in re.split(r'[\s,，。！？、；：""''（）()【】\[\]\{\}]+', 当前消息):
            词 = 词.strip()
            if len(词) >= 2:
                消息词集.add(词.lower())

        for name, info in 条目.items():
            分数 = 0

            # 1. 标签匹配（权重3）
            for tag in info.get("标签", []):
                if tag.lower() in 当前消息.lower():
                    分数 += 3

            # 2. 描述关键词匹配（权重2）
            描述 = info.get("描述", "")
            for 词 in 消息词集:
                if 词 in 描述 or 描述.find(词) >= 0:
                    分数 += 2
                if 词 in name or name.find(词) >= 0:
                    分数 += 2

            # 3. 记忆文件内容关键词匹配（权重1）
            文件名 = info.get("文件名", "")
            if 文件名:
                文件路径 = self.记忆存储目录 / 文件名
                if 文件路径.exists():
                    try:
                        with open(文件路径, "r", encoding="utf-8") as f:
                            内容 = f.read()
                        for 词 in 消息词集:
                            if 内容.find(词) >= 0:
                                分数 += 1
                    except Exception:
                        pass

            if 分数 > 0:
                相关.append({
                    "name": name,
                    "描述": info.get("描述", ""),
                    "类型": info.get("类型", ""),
                    "分数": 分数,
                    "标签": info.get("标签", [])
                })

        # 按相关度排序
        相关.sort(key=lambda x: x["分数"], reverse=True)
        结果 = 相关[:最大数]

        # 4. 向量语义搜索：当关键词结果不足2条时，用TF-IDF向量搜索补充
        if len(结果) < 2 and len(当前消息) > 5 and len(条目) > 2:
            try:
                from 存储引擎 import 获取存储引擎
                引擎 = 获取存储引擎()
                向量结果 = 引擎.搜索记忆向量(当前消息, 最大数)
                已有名称 = {r["name"] for r in 结果}
                for item in 向量结果:
                    name = item["名称"]
                    if name in 条目 and name not in 已有名称:
                        结果.append({
                            "name": name,
                            "描述": 条目[name].get("描述", ""),
                            "类型": 条目[name].get("类型", ""),
                            "分数": round(item["相似度"] * 10, 1),
                            "标签": 条目[name].get("标签", []),
                            "来源": "向量搜索"
                        })
                        已有名称.add(name)
                        if len(结果) >= 最大数:
                            break
            except Exception as e:
                print(f"  ⚠️ 向量记忆搜索失败: {e}")

        return 结果[:最大数]

    def _更新MEMORY索引(self):
        """更新 MEMORY.md 索引文件"""
        条目 = self.索引数据.get("条目", {})
        行列表 = []
        for name, info in sorted(条目.items()):
            描述 = info.get("描述", "")
            行列表.append(f'- [{name}](条目/{info["文件名"]}) — {描述}')
        content = "# 记忆索引\n\n" + "\n".join(行列表) + "\n" if 行列表 else "# 记忆索引\n\n_暂无记忆条目_\n"
        try:
            with open(self.索引文件路径, "w", encoding="utf-8") as f:
                f.write(content)
        except Exception:
            pass

    def _名称转文件名(self, name: str) -> str:
        """将记忆名称转为合法文件名"""
        文件名 = name.strip().lower()
        文件名 = re.sub(r'[\\/:*?"<>|]', '-', 文件名)
        文件名 = re.sub(r'\s+', '-', 文件名)
        文件名 = re.sub(r'-+', '-', 文件名)
        文件名 = 文件名.strip('-')
        return 文件名 or "unnamed"

    # ============ 兼容旧接口 ============

    def _新建事件(self, 标题: str = "") -> dict:
        """创建新事件"""
        当前事件编号 = self.记忆库.get("当前事件")
        if 当前事件编号:
            self._归档当前事件()

        self.事件计数 += 1
        事件编号 = f"事件_{self.事件计数:03d}"
        现在 = datetime.now().isoformat()

        self.记忆库.setdefault("事件列表", {})[事件编号] = {
            "事件标题": 标题,
            "创建时间": 现在,
            "最后活跃": 现在,
            "状态": "进行中",
            "标签": [],
            "参与者": ["用户", "助手"],
            "原始对话": [],
            "摘要": None,
            "冗余标记": {"重复消息索引": [], "冗余原因": ""}
        }
        self.记忆库["当前事件"] = 事件编号
        self.记忆库["最后更新"] = 现在
        self._保存记忆库()

        return {"成功": True, "事件编号": 事件编号}

    def _添加对话(self, 角色: str, 内容: str) -> dict:
        """添加对话到当前事件"""
        当前事件编号 = self.记忆库.get("当前事件")
        if not 当前事件编号:
            self._新建事件()

        当前事件编号 = self.记忆库["当前事件"]
        事件 = self.记忆库["事件列表"].get(当前事件编号, {})
        事件.setdefault("原始对话", []).append({
            "角色": 角色,
            "内容": 内容,
            "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })
        事件["最后活跃"] = datetime.now().isoformat()

        # 检查是否触发摘要
        对话轮数 = len(事件["原始对话"])
        触发轮数 = self.配置.get("摘要触发轮数", 20)
        if self.配置.get("自动摘要", True) and 对话轮数 >= 触发轮数 and 对话轮数 % 触发轮数 == 0:
            全局事件中心.发布("需生成摘要", {"事件编号": 当前事件编号})

        self._保存记忆库()
        return {"成功": True}

    def _归档当前事件(self) -> dict:
        """归档当前事件"""
        当前事件编号 = self.记忆库.get("当前事件")
        if not 当前事件编号:
            return {"成功": False, "错误": "无当前事件"}

        事件 = self.记忆库["事件列表"].get(当前事件编号, {})
        事件["状态"] = "已归档"
        self.记忆库["当前事件"] = None
        self._保存记忆库()

        # 触发摘要生成
        全局事件中心.发布("需生成摘要", {"事件编号": 当前事件编号})

        return {"成功": True, "事件编号": 当前事件编号}

    def _生成摘要(self, 数据: dict):
        """生成事件摘要（异步执行，不阻塞对话）"""
        线程 = threading.Thread(target=self._生成摘要_同步, args=(数据,), daemon=True)
        线程.start()

    def _生成摘要_同步(self, 数据: dict):
        """生成事件摘要（实际执行，后台线程调用）"""
        事件编号 = 数据.get("事件编号", "")
        if not 事件编号:
            return

        事件 = self.记忆库.get("事件列表", {}).get(事件编号, {})
        原始对话 = 事件.get("原始对话", [])

        if not 原始对话 or not self.模型直连器:
            return

        # 构建摘要请求
        对话文本 = "\n".join([f"{d['角色']}: {d['内容'][:200]}" for d in 原始对话[-30:]])
        摘要提示词 = f"""请对以下对话生成摘要，返回JSON格式：
{{
  "核心内容": "一句话概括",
  "关键决策": ["决策1", "决策2"],
  "用户意图": "用户想要什么",
  "关键词": ["词1", "词2"]
}}

对话内容：
{对话文本}"""

        try:
            结果 = self.模型直连器.发送消息(
                [{"role": "user", "content": 摘要提示词}],
                "你是摘要专家，输出纯JSON，不要markdown代码块。"
            )
            if 结果["成功"]:
                回复 = 结果["回复内容"]
                json匹配 = re.search(r'\{[\s\S]*\}', 回复)
                if json匹配:
                    摘要数据 = json.loads(json匹配.group())
                else:
                    摘要数据 = {"核心内容": 回复[:200]}

                # 写入结果时加锁
                with self._摘要锁:
                    事件["摘要"] = 摘要数据
                    事件["标签"] = 摘要数据.get("关键词", [])

                    # 更新摘要索引
                    self.摘要计数 += 1
                    self.摘要索引.setdefault("索引", []).append({
                        "编号": f"摘要_{self.摘要计数:03d}",
                        "事件编号": 事件编号,
                        "标题": 事件.get("事件标题", ""),
                        "核心内容": 摘要数据.get("核心内容", ""),
                        "关键词": 摘要数据.get("关键词", []),
                        "时间": datetime.now().isoformat()
                    })

                    self._保存记忆库()
                    self._保存摘要索引()

                # 自动保存为独立记忆文件
                if 摘要数据.get("核心内容"):
                    self._记住(
                        name=f"对话摘要_{事件编号}",
                        description=摘要数据.get("核心内容", "")[:80],
                        content=json.dumps(摘要数据, ensure_ascii=False, indent=2),
                        memory_type="reference",
                        tags=摘要数据.get("关键词", [])
                    )

                # 更新用户画像
                self._自动更新用户画像(摘要数据)

        except Exception as e:
            print(f"   ⚠️ 摘要生成失败: {e}")

    def _自动更新用户画像(self, 摘要数据: dict):
        """根据摘要自动更新用户画像"""
        if not isinstance(self.用户画像, dict):
            self.用户画像 = {}

        self.用户画像.setdefault("交互统计", {})
        self.用户画像["交互统计"]["总对话轮数"] = self.用户画像["交互统计"].get("总对话轮数", 0) + 1

        关键词列表 = 摘要数据.get("关键词", [])
        self.用户画像.setdefault("兴趣关键词", {})
        for 词 in 关键词列表:
            self.用户画像["兴趣关键词"][词] = self.用户画像["兴趣关键词"].get(词, 0) + 1

        意图 = 摘要数据.get("用户意图", "")
        if 意图:
            self.用户画像.setdefault("最近意图", [])
            self.用户画像["最近意图"].append(意图)
            self.用户画像["最近意图"] = self.用户画像["最近意图"][-10:]

        self._保存用户画像()

    def _更新用户画像(self, 信息: dict) -> dict:
        """手动更新用户画像"""
        if not isinstance(self.用户画像, dict):
            self.用户画像 = {}
        for 键, 值 in 信息.items():
            self.用户画像[键] = 值
        self._保存用户画像()
        return {"成功": True}

    # ============ 搜索与注入 ============

    def _搜索记忆(self, 关键词: str) -> dict:
        """搜索相关记忆（新旧格式同时搜索）"""
        结果列表 = []

        # 1. 旧格式事件搜索
        事件列表 = self.记忆库.get("事件列表", {})
        for 编号, 事件 in 事件列表.items():
            摘要 = 事件.get("摘要")
            if not 摘要:
                continue
            标签 = 事件.get("标签", [])
            核心内容 = 摘要.get("核心内容", "") if isinstance(摘要, dict) else str(摘要)
            if 关键词 in 核心内容 or 关键词 in " ".join(标签):
                结果列表.append({
                    "编号": 编号,
                    "标题": 事件.get("事件标题", ""),
                    "摘要": 核心内容,
                    "状态": 事件.get("状态", "")
                })

        # 2. 新格式记忆搜索
        条目 = self.索引数据.get("条目", {})
        for name, info in 条目.items():
            描述 = info.get("描述", "")
            if 关键词 in name or 关键词 in 描述:
                结果列表.append({
                    "编号": name,
                    "标题": name,
                    "摘要": 描述,
                    "状态": "记忆条目"
                })

        return {"成功": True, "结果": 结果列表}

    def _获取当前事件(self) -> dict:
        """获取当前事件"""
        当前事件编号 = self.记忆库.get("当前事件")
        if not 当前事件编号:
            return {"成功": True, "事件": None}
        事件 = self.记忆库["事件列表"].get(当前事件编号, {})
        return {"成功": True, "事件编号": 当前事件编号, "事件": 事件}

    def _获取记忆注入(self, 当前消息: str = "", 新对话: bool = False, 轻量: bool = False) -> dict:
        """按优先级获取记忆注入内容（v2：增加自动召回）
        新对话=True时只保留用户画像，跳过旧事件摘要和召回，确保新对话干净
        轻量=True时跳过自动召回记忆（避免LLM调用），只返回用户画像+近期摘要"""
        注入 = {
            "用户画像": self.用户画像 if self.用户画像 else None,
            "相关事件摘要": [] if 新对话 else self._查找相关事件(当前消息),
            "当前事件原始": None,
            "近期事件摘要": [] if 新对话 else self._获取近期摘要(5),
            "自动召回记忆": [] if (新对话 or 轻量) else self._自动召回记忆(当前消息, 最大数=5)
        }

        # 获取当前事件原始对话
        当前事件编号 = self.记忆库.get("当前事件")
        if 当前事件编号:
            事件 = self.记忆库["事件列表"].get(当前事件编号, {})
            注入["当前事件原始"] = 事件.get("原始对话", [])

        return {"成功": True, "注入内容": 注入}

    def _查找相关事件(self, 消息: str) -> list:
        """查找与当前消息相关的历史事件摘要"""
        相关 = []
        事件列表 = self.记忆库.get("事件列表", {})
        for 编号, 事件 in 事件列表.items():
            摘要 = 事件.get("摘要")
            if 摘要 and 事件.get("状态") == "已归档":
                标签 = 事件.get("标签", [])
                摘要文本 = 摘要.get("核心内容", "") if isinstance(摘要, dict) else str(摘要)
                if any(词 in 摘要文本 or 词 in 消息 for 词 in 标签 if 词):
                    相关.append({
                        "编号": 编号,
                        "标题": 事件.get("事件标题", ""),
                        "摘要": 摘要文本
                    })
        return 相关[:3]

    def _获取近期摘要(self, 数量: int) -> list:
        """获取最近N个事件的摘要"""
        近期 = []
        索引列表 = self.摘要索引.get("索引", [])
        for 条目 in reversed(索引列表[-数量:]):
            近期.append(条目.get("核心内容", ""))
        return 近期

    def _处理消息(self, 数据: dict):
        """处理收到消息事件"""
        角色 = 数据.get("角色", "用户")
        内容 = 数据.get("内容", "")
        if 内容:
            self._添加对话(角色, 内容)

    def _处理话题切换(self, 数据: dict):
        """处理话题切换事件"""
        新标题 = 数据.get("标题", "")
        self._新建事件(新标题)

    # ============ 读写 ============

    def _读取JSON(self, 路径: Path) -> dict:
        if 路径.exists():
            try:
                with open(路径, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _保存记忆库(self):
        if self.记忆库路径:
            self.记忆库路径.parent.mkdir(parents=True, exist_ok=True)
            with open(self.记忆库路径, "w", encoding="utf-8") as f:
                json.dump(self.记忆库, f, ensure_ascii=False, indent=2)

    def _保存用户画像(self):
        if self.用户画像路径:
            self.用户画像路径.parent.mkdir(parents=True, exist_ok=True)
            with open(self.用户画像路径, "w", encoding="utf-8") as f:
                json.dump(self.用户画像, f, ensure_ascii=False, indent=2)

    def _保存摘要索引(self):
        if self.摘要索引路径:
            self.摘要索引路径.parent.mkdir(parents=True, exist_ok=True)
            with open(self.摘要索引路径, "w", encoding="utf-8") as f:
                json.dump(self.摘要索引, f, ensure_ascii=False, indent=2)

    def _保存索引数据(self):
        if self.索引数据路径:
            self.索引数据路径.parent.mkdir(parents=True, exist_ok=True)
            with open(self.索引数据路径, "w", encoding="utf-8") as f:
                json.dump(self.索引数据, f, ensure_ascii=False, indent=2)
