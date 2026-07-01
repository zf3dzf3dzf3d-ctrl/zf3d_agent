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
        self._索引锁 = threading.Lock()  # 索引数据读写锁（异步写入时保护）
        self.存储引擎 = None  # SQLite存储引擎（用于读取历史对话）
        # 异步写入队列
        import queue as _queue
        self._写入队列 = _queue.Queue()
        self._写入线程 = None
        self._写入停止 = False

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

        # 加载已有数据（优先SQLite KV，fallback到JSON文件）
        if self.存储引擎:
            self.记忆库 = self.存储引擎.读取KV_JSON("记忆库", {"事件列表": {}, "事件计数": 0})
            self.用户画像 = self.存储引擎.读取KV_JSON("用户画像", {})
            self.摘要索引 = self.存储引擎.读取KV_JSON("摘要索引", {"索引": []})
            self.索引数据 = self.存储引擎.读取KV_JSON("记忆索引数据", {"条目": {}, "标签索引": {}})
        else:
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

        # 注入SQLite存储引擎，用于读取历史对话归纳
        try:
            from 存储引擎 import 获取存储引擎
            db路径 = str(项目根目录 / "隐私区" / "我的数据" / "智能体.db")
            self.存储引擎 = 获取存储引擎(db路径)
            # 后台归纳没有摘要的旧对话
            threading.Thread(target=self._归纳历史对话, daemon=True).start()
            # 启动后60秒执行经验提炼（不阻塞启动）
            threading.Timer(60, self._提炼用户模式).start()
            # 每6小时定期提炼+衰减+合并
            def _定期维护():
                while True:
                    import time as _time
                    _time.sleep(6 * 3600)
                    self._提炼用户模式()
                    self._衰减旧记忆()
                    self._合并相似摘要()
            threading.Thread(target=_定期维护, daemon=True).start()
        except Exception as e:
            print(f"  ⚠️ 记忆模块存储引擎注入失败: {e}")

        # 启动异步写入线程
        self._写入线程 = threading.Thread(target=self._写入循环, daemon=True)
        self._写入线程.start()

    def _写入循环(self):
        """后台写入线程：从队列取任务执行磁盘写入，不阻塞对话"""
        while not self._写入停止:
            try:
                任务 = self._写入队列.get(timeout=1.0)
                if 任务 is None:
                    break
                任务类型, 数据 = 任务
                try:
                    if 任务类型 == "记忆库":
                        self._写入记忆库到磁盘(数据)
                    elif 任务类型 == "用户画像":
                        self._写入用户画像到磁盘(数据)
                    elif 任务类型 == "摘要索引":
                        self._写入摘要索引到磁盘(数据)
                    elif 任务类型 == "索引数据":
                        self._写入索引数据到磁盘(数据)
                except Exception as e:
                    print(f"  ⚠️ 记忆异步写入失败: {e}")
            except Exception:
                pass

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
        """停止记忆模块，排空写入队列后保存所有数据"""
        # 先把当前内存数据入队
        self._保存记忆库()
        self._保存用户画像()
        self._保存摘要索引()
        self._保存索引数据()
        # 发送停止信号（线程处理完队列后退出）
        self._写入队列.put(None)
        self._写入停止 = True
        if self._写入线程 and self._写入线程.is_alive():
            self._写入线程.join(timeout=5)

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

            # 更新索引（加锁防止与异步写入冲突）
            with self._索引锁:
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

    # ============ SQLite历史对话归纳 ============

    def _归纳历史对话(self):
        """扫描SQLite中所有对话，对没有摘要的旧对话生成摘要"""
        if not self.存储引擎 or not self.模型直连器:
            return
        try:
            对话列表 = self.存储引擎.查询对话索引()
            if not 对话列表:
                return
            # 找出还没在摘要索引中的对话
            已归纳IDs = set()
            for 条目 in self.摘要索引.get("索引", []):
                事件编号 = 条目.get("事件编号", "")
                if 事件编号.startswith("对话_"):
                    已归纳IDs.add(事件编号.replace("对话_", ""))
            需归纳 = [d for d in 对话列表 if d["id"] not in 已归纳IDs and d.get("消息数", 0) >= 2]
            if not 需归纳:
                return
            print(f"  🧠 记忆模块：发现{len(需归纳)}个未归纳的旧对话，开始后台归纳...")
            已归纳数 = 0
            for d in 需归纳:
                try:
                    self._归纳单个对话(d["id"], d.get("标题", d["id"]))
                    已归纳数 += 1
                except Exception:
                    continue
            if 已归纳数:
                print(f"  ✅ 记忆模块：已归纳{已归纳数}个旧对话")
        except Exception as e:
            print(f"  ⚠️ 历史对话归纳失败: {e}")

    def _归纳单个对话(self, 对话ID: str, 标题: str):
        """对单个SQLite对话生成摘要并存入摘要索引"""
        消息列表 = self.存储引擎.查询对话消息(对话ID)
        if not 消息列表 or len(消息列表) < 2:
            return
        # 只取用户和助手的消息，构建摘要请求
        对话文本 = "\n".join([
            f"{m['角色']}: {m['内容'][:200]}"
            for m in 消息列表[-30:]
            if m["角色"] in ("用户", "助手")
        ])
        if not 对话文本 or len(对话文本) < 50:
            return
        摘要提示词 = f"""请对以下对话生成摘要，返回JSON格式：
{{
  "标题": "5-15字简短标题",
  "简介": "30-60字概括对话内容和结果",
  "核心内容": "一句话概括",
  "关键决策": ["决策1", "决策2"],
  "用户意图": "用户想要什么",
  "关键词": ["词1", "词2"],
  "项目": "涉及的项目或主题名称（如无具体项目则填'日常对话'）",
  "权重": 1到5的整数, 1=闲聊简单问答, 2=一般操作, 3=完成具体任务, 4=重要项目, 5=核心项目用户强烈关注
}}

对话内容：
{对话文本}"""
        结果 = self.模型直连器.发送消息(
            [{"role": "user", "content": 摘要提示词}],
            "你是摘要专家，输出纯JSON，不要markdown代码块。"
        )
        if not 结果.get("成功"):
            return
        回复 = 结果.get("回复内容", "")
        json匹配 = re.search(r'\{[\s\S]*\}', 回复)
        if json匹配:
            摘要数据 = json.loads(json匹配.group())
        else:
            摘要数据 = {"核心内容": 回复[:200], "关键词": [], "权重": 3}
        # 规范化权重
        权重 = 摘要数据.get("权重", 3)
        try:
            权重 = max(1, min(5, int(权重)))
        except (ValueError, TypeError):
            权重 = 3
        # 写入摘要索引
        with self._摘要锁:
            self.摘要计数 += 1
            编号 = f"对话_{对话ID}"
            self.摘要索引.setdefault("索引", []).append({
                "编号": f"摘要_{self.摘要计数:03d}",
                "事件编号": 编号,
                "标题": 摘要数据.get("标题", 标题),
                "简介": 摘要数据.get("简介", ""),
                "核心内容": 摘要数据.get("核心内容", ""),
                "关键词": 摘要数据.get("关键词", []),
                "用户意图": 摘要数据.get("用户意图", ""),
                "项目": 摘要数据.get("项目", "日常对话"),
                "权重": 权重,
                "来源": "SQLite归纳"
            })
            self._保存摘要索引()
            # 同时存入记忆向量表（供语义搜索）
            try:
                self.存储引擎.插入记忆向量(编号, 摘要数据.get("核心内容", ""))
            except Exception:
                pass

    def _提炼用户模式(self):
        """后台提炼用户模式（sleep-time learning）

        扫描最近N个对话摘要+经验卡片，用LLM提炼：
        - 常用路径/参数
        - 行为模式（先做什么后做什么）
        - 反馈纠正（用户纠正过AI什么）
        - 偏好（输出格式/文件位置等）

        提炼结果写入用户画像的"学习到的偏好"字段
        """
        if not self.存储引擎 or not self.模型直连器:
            return
        try:
            # 获取最近20个对话摘要
            摘要列表 = self.摘要索引.get("索引", [])[-20:]
            摘要文本 = "\n".join(
                f"- {s.get('标题', '')}: {s.get('简介', s.get('核心内容', ''))[:80]}"
                for s in 摘要列表 if s.get("标题") or s.get("核心内容")
            )[:2000]
            if len(摘要文本) < 50:
                return  # 数据太少，不提炼

            # 获取最近10个经验卡片
            经验列表 = self.存储引擎.查询最近经验(limit=10)
            经验文本 = "\n".join(
                f"- [{e.get('任务类型', '?')}] {e.get('任务描述', '')[:60]} "
                f"有效:{e.get('有效方法', '')[:40]} 建议:{e.get('下次建议', '')[:40]}"
                for e in 经验列表
            )[:1500]

            提炼提示 = (
                f"你是用户行为分析器。从以下对话历史和经验中，提炼用户的可复用模式。\n\n"
                f"对话摘要（最近20个）：\n{摘要文本}\n\n"
                f"任务经验（最近10个）：\n{经验文本}\n\n"
                f"请提炼出以下JSON格式（只输出JSON）：\n"
                f'{{\n'
                f'  "常用路径": ["路径1", "路径2"],\n'
                f'  "常用参数": {{"图片尺寸": "512x512", "模型": "deepseek"}},\n'
                f'  "行为模式": ["模式1", "模式2"],\n'
                f'  "反馈纠正": ["纠正1", "纠正2"],\n'
                f'  "输出偏好": ["偏好1", "偏好2"]\n'
                f'}}\n'
            )

            结果 = self.模型直连器.发送消息(
                [{"role": "user", "content": 提炼提示}],
                "你是用户行为分析器。只输出JSON，不要解释。"
            )
            if 结果.get("成功"):
                回复 = 结果.get("回复内容", "")
                json匹配 = re.search(r'\{[\s\S]*\}', 回复)
                if json匹配:
                    模式 = json.loads(json匹配.group())
                    # 写入用户画像
                    if not isinstance(self.用户画像, dict):
                        self.用户画像 = {}
                    self.用户画像["学习到的偏好"] = 模式
                    self.用户画像.setdefault("交互统计", {})
                    self.用户画像["交互统计"]["最后提炼时间"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    self._保存用户画像()
                    print(f"  [提炼] 用户模式已更新: {len(模式)}类偏好")
        except Exception as e:
            print(f"  [提炼] 用户模式提炼失败: {e}")

    def _衰减旧记忆(self):
        """降低长期未访问记忆的权重

        规则：
        - 30天未访问：权重降1级
        - 60天未访问：权重降2级
        - 90天未访问：权重最低为1（不删除，但不再主动召回）
        """
        try:
            摘要列表 = self.摘要索引.get("索引", [])
            if not 摘要列表:
                return
            当前时间 = datetime.now()
            衰减数 = 0
            for 条目 in 摘要列表:
                权重 = 条目.get("权重", 3)
                if 权重 <= 1:
                    continue
                # 检查最后访问时间
                最后访问 = 条目.get("最后访问", "") or 条目.get("时间", "")
                if not 最后访问:
                    continue
                try:
                    访问时间 = datetime.fromisoformat(最后访问.replace("Z", ""))
                except (ValueError, TypeError):
                    continue
                天数 = (当前时间 - 访问时间).days
                if 天数 >= 90:
                    新权重 = max(1, 权重 - 2)
                elif 天数 >= 60:
                    新权重 = max(1, 权重 - 2)
                elif 天数 >= 30:
                    新权重 = max(1, 权重 - 1)
                else:
                    continue
                if 新权重 < 权重:
                    条目["权重"] = 新权重
                    条目["衰减标记"] = True
                    衰减数 += 1
            if 衰减数 > 0:
                self._保存摘要索引()
                print(f"  [衰减] {衰减数}条记忆权重已降低")
        except Exception as e:
            print(f"  [衰减] 记忆衰减失败: {e}")

    def _合并相似摘要(self):
        """合并关键词重叠度高的相似摘要，减少冗余

        策略：
        - 找出关键词重叠度>60%的摘要对
        - 用LLM合并为一个更精炼的条目
        - 删除旧的，保留合并后的
        """
        if not self.模型直连器:
            return
        try:
            摘要列表 = self.摘要索引.get("索引", [])
            if len(摘要列表) < 5:
                return  # 太少不合并
            合并数 = 0
            i = 0
            while i < len(摘要列表) - 1:
                当前 = 摘要列表[i]
                下一 = 摘要列表[i + 1]
                当前词 = set(当前.get("关键词", []))
                下一词 = set(下一.get("关键词", []))
                if not 当前词 or not 下一词:
                    i += 1
                    continue
                重叠 = 当前词 & 下一词
                重叠度 = len(重叠) / max(len(当前词 | 下一词), 1)
                if 重叠度 > 0.6:
                    # 用LLM合并
                    合并提示 = (
                        f"合并以下两个相似的对话摘要为一个：\n"
                        f"摘要1: {当前.get('标题', '')} - {当前.get('简介', '')[:100]}\n"
                        f"摘要2: {下一.get('标题', '')} - {下一.get('简介', '')[:100]}\n\n"
                        f"输出合并后的摘要（JSON）：\n"
                        f'{{"标题": "...", "简介": "...", "关键词": ["词1"]}}'
                    )
                    结果 = self.模型直连器.发送消息(
                        [{"role": "user", "content": 合并提示}],
                        "你是摘要合并器。只输出JSON。"
                    )
                    if 结果.get("成功"):
                        回复 = 结果.get("回复内容", "")
                        json匹配 = re.search(r'\{[\s\S]*\}', 回复)
                        if json匹配:
                            合并 = json.loads(json匹配.group())
                            当前["标题"] = 合并.get("标题", 当前.get("标题", ""))
                            当前["简介"] = 合并.get("简介", "")
                            当前["关键词"] = list(当前词 | 下一词)
                            摘要列表.pop(i + 1)
                            合并数 += 1
                            continue
                i += 1
            if 合并数 > 0:
                self._保存摘要索引()
                print(f"  [合并] {合并数}条相似记忆已合并")
        except Exception as e:
            print(f"  [合并] 相似摘要合并失败: {e}")

    def _查找相关事件(self, 消息: str) -> list:
        """查找与当前消息相关的历史事件摘要（同时搜索记忆库+SQLite归纳摘要）
        返回分层结构：项目分组 + 标题/简介/权重/关键词"""
        相关 = []
        # 1. 搜索记忆库中的旧事件摘要
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
                        "简介": 摘要文本,
                        "项目": "旧记忆",
                        "权重": 3,
                        "关键词": 标签
                    })
        # 2. 搜索SQLite归纳的对话摘要
        for 条目 in self.摘要索引.get("索引", []):
            if 条目.get("来源") != "SQLite归纳":
                continue
            核心内容 = 条目.get("核心内容", "")
            关键词列表 = 条目.get("关键词", [])
            if any(词 in 消息 or 词 in 核心内容 for 词 in 关键词列表 if 词) or 消息[:4] in 核心内容:
                相关.append({
                    "编号": 条目.get("事件编号", ""),
                    "标题": 条目.get("标题", ""),
                    "简介": 条目.get("简介", 核心内容),
                    "项目": 条目.get("项目", "日常对话"),
                    "权重": 条目.get("权重", 3),
                    "关键词": 关键词列表
                })
        # 按权重降序排列
        相关.sort(key=lambda x: x.get("权重", 3), reverse=True)
        return 相关[:5]

    def _获取近期摘要(self, 数量: int) -> list:
        """获取最近N个事件的摘要（同时含记忆库+SQLite归纳）
        返回带标题/简介/权重/项目的分层结构"""
        近期 = []
        索引列表 = self.摘要索引.get("索引", [])
        for 条目 in reversed(索引列表[-数量:]):
            近期.append({
                "标题": 条目.get("标题", ""),
                "简介": 条目.get("简介", 条目.get("核心内容", "")),
                "项目": 条目.get("项目", "日常对话"),
                "权重": 条目.get("权重", 3)
            })
        return 近期

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
        self._写入队列.put(("记忆库", dict(self.记忆库)))

    def _保存用户画像(self):
        self._写入队列.put(("用户画像", dict(self.用户画像)))

    def _保存摘要索引(self):
        self._写入队列.put(("摘要索引", dict(self.摘要索引)))

    def _保存索引数据(self):
        self._写入队列.put(("索引数据", dict(self.索引数据)))

    # ========== 实际磁盘写入（由后台线程调用） ==========

    def _写入记忆库到磁盘(self, 数据):
        if self.存储引擎:
            self.存储引擎.写入KV_JSON("记忆库", 数据)
        elif self.记忆库路径:
            self.记忆库路径.parent.mkdir(parents=True, exist_ok=True)
            with open(self.记忆库路径, "w", encoding="utf-8") as f:
                json.dump(数据, f, ensure_ascii=False, indent=2)

    def _写入用户画像到磁盘(self, 数据):
        if self.存储引擎:
            self.存储引擎.写入KV_JSON("用户画像", 数据)
        elif self.用户画像路径:
            self.用户画像路径.parent.mkdir(parents=True, exist_ok=True)
            with open(self.用户画像路径, "w", encoding="utf-8") as f:
                json.dump(数据, f, ensure_ascii=False, indent=2)

    def _写入摘要索引到磁盘(self, 数据):
        if self.存储引擎:
            self.存储引擎.写入KV_JSON("摘要索引", 数据)
        elif self.摘要索引路径:
            self.摘要索引路径.parent.mkdir(parents=True, exist_ok=True)
            with open(self.摘要索引路径, "w", encoding="utf-8") as f:
                json.dump(数据, f, ensure_ascii=False, indent=2)

    def _写入索引数据到磁盘(self, 数据):
        if self.存储引擎:
            with self._索引锁:
                self.存储引擎.写入KV_JSON("记忆索引数据", 数据)
        elif self.索引数据路径:
            self.索引数据路径.parent.mkdir(parents=True, exist_ok=True)
            with self._索引锁:
                with open(self.索引数据路径, "w", encoding="utf-8") as f:
                    json.dump(数据, f, ensure_ascii=False, indent=2)
