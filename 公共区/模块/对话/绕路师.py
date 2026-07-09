"""绕路师 — 记录失败教训，下次自动绕路

与经验师互补：
- 经验师：任务成功后提炼经验（什么方法有效）
- 绕路师：任务失败后记录教训（什么方法无效、怎么绕路）

聊得越多越聪明：
- 每次失败都记录到SQLite绕路库（FTS5全文搜索）
- 任务开始前搜索匹配的避坑记录，注入提示词
- 相同失败模式累计出现次数，高频问题可触发自动修复
"""
import re
import json
from datetime import datetime


class 绕路师类:
    """绕路师：失败教训记录 + 召回注入 + 自动修复检测"""

    def __init__(self):
        self.模型直连器 = None
        self.存储引擎 = None

    def 初始化(self, 模型直连器, 项目根目录):
        """初始化绕路师"""
        self.模型直连器 = 模型直连器
        try:
            from 存储引擎 import 获取存储引擎
            self.存储引擎 = 获取存储引擎()
        except Exception as e:
            print(f"   ⚠️ 绕路师初始化失败: {e}")

    def 记录失败(self, 用户消息: str, 推理结果: dict):
        """任务失败时调用：分析失败模式 → LLM提炼绕路方案 → 存入绕路库"""
        # 1. 门槛检查：步数>5且失败
        步数 = 推理结果.get("步数", 0)
        if 步数 < 5:
            return
        if 推理结果.get("成功", True):
            return
        if not self.模型直连器 or not self.存储引擎:
            return

        # 2. 提取失败的操作序列
        推理过程 = 推理结果.get("推理过程", 推理结果.get("完整推理过程", []))
        失败操作 = self._分析失败操作(推理过程)
        if not 失败操作:
            return

        # 3. 提取关键词（用户消息中的核心词）
        关键词 = self._提取关键词(用户消息)

        # 4. LLM提炼失败原因和绕路方案
        绕路信息 = self._LLM提炼绕路(用户消息, 失败操作, 推理过程, 推理结果)
        if not 绕路信息:
            # LLM不可用时用简单规则
            绕路信息 = {
                "失败原因": "操作反复失败，可能参数不匹配或方法不当",
                "绕路方案": f"避免重复使用{失败操作[0]['操作']}，尝试替代方法"
            }

        # 5. 存入绕路库
        for 失败 in 失败操作:
            self.存储引擎.记录绕路(
                触发关键词=关键词,
                失败操作=失败["操作"],
                失败原因=绕路信息.get("失败原因", ""),
                绕路方案=绕路信息.get("绕路方案", "")
            )

        print(f"  🛡️ 绕路师已记录失败教训: {关键词} → {失败操作[0]['操作']}")

        # 高频失败自动记录Bug（出现次数≥3时写入Bug库，方便开发者定位修复）
        self._自动记录高频Bug()

    def 召回绕路(self, 用户消息: str) -> str:
        """任务开始前调用：搜索匹配的避坑记录，返回注入文本"""
        if not self.存储引擎 or not 用户消息 or len(用户消息) < 3:
            return ""

        记录列表 = []
        # 策略1：用提取的关键词搜索
        关键词 = self._提取关键词(用户消息)
        记录列表 = self.存储引擎.搜索绕路(关键词, limit=3)
        # 策略2：用消息中的每个关键词逐个搜索
        if not 记录列表:
            分词 = re.split(r'[\s,，。、！？\.\/]', 用户消息.lower())
            for 词 in 分词:
                if len(词) > 2:
                    记录列表 = self.存储引擎.搜索绕路(词, limit=3)
                    if 记录列表:
                        break
        # 策略3：取所有绕路记录（按出现次数排序），用子串匹配
        if not 记录列表 and self.存储引擎:
            try:
                rows = self.存储引擎._查询(
                    "SELECT 触发关键词, 失败操作, 失败原因, 绕路方案, 出现次数 FROM 绕路记录 "
                    "ORDER BY 出现次数 DESC, id DESC LIMIT 20"
                )
                消息小写 = 用户消息.lower()
                for r in rows:
                    触发 = str(r[0]).lower()
                    操作 = str(r[1]).lower()
                    # 用户消息包含触发关键词或操作名
                    if (触发 and 触发 in 消息小写) or (操作 and 操作 in 消息小写):
                        记录列表 = [{
                            "触发关键词": r[0], "失败操作": r[1], "失败原因": r[2],
                            "绕路方案": r[3], "出现次数": r[4]
                        }]
                        break
                    # 触发关键词包含用户消息中的词
                    for 词 in 分词:
                        if len(词) > 2 and 词 in 触发:
                            记录列表 = [{
                                "触发关键词": r[0], "失败操作": r[1], "失败原因": r[2],
                                "绕路方案": r[3], "出现次数": r[4]
                            }]
                            break
                    if 记录列表:
                        break
            except Exception:
                pass
        if not 记录列表:
            return ""

        行 = []
        for i, 记录 in enumerate(记录列表, 1):
            次数 = 记录.get("出现次数", 1)
            频次标记 = f" (已命中{次数}次)" if 次数 > 1 else ""
            行.append(
                f"  {i}. ❌ 不要用「{记录.get('失败操作', '?')}」{频次标记}\n"
                f"     原因: {记录.get('失败原因', '未知')[:120]}\n"
                f"     ✅ 绕路: {记录.get('绕路方案', '尝试替代方法')[:120]}"
            )

        return "\n".join(行)

    def _分析失败操作(self, 推理过程: list) -> list:
        """从推理过程中提取反复失败的操作"""
        操作统计 = {}  # 操作名 → {失败次数, 最近结果}
        for 步 in 推理过程:
            if 步.get("类型") != "操作":
                continue
            操作名 = 步.get("操作", "")
            成功 = 步.get("成功", True)
            if 操作名 not in 操作统计:
                操作统计[操作名] = {"总次数": 0, "失败次数": 0, "最近结果": ""}
            操作统计[操作名]["总次数"] += 1
            if not 成功:
                操作统计[操作名]["失败次数"] += 1
                操作统计[操作名]["最近结果"] = str(步.get("结果", ""))[:200]

        # 失败次数≥2的操作
        失败列表 = []
        for 操作名, 统计 in 操作统计.items():
            if 统计["失败次数"] >= 2:
                失败列表.append({"操作": 操作名, "失败次数": 统计["失败次数"], "结果": 统计["最近结果"]})

        # 按失败次数降序
        失败列表.sort(key=lambda x: x["失败次数"], reverse=True)
        return 失败列表

    def _提取关键词(self, 消息: str) -> str:
        """从用户消息提取核心关键词"""
        # 去掉常见前缀
        清理 = re.sub(r'📂.*?\n', '', 消息)
        清理 = re.sub(r'用户:\s*', '', 清理)
        # 取前20个字符作为关键词
        关键词 = 清理.strip()[:20]
        return 关键词 if 关键词 else "未知任务"

    def _LLM提炼绕路(self, 用户消息: str, 失败操作: list, 推理过程: list, 推理结果: dict) -> dict:
        """调用LLM分析失败原因并生成绕路方案"""
        if not self.模型直连器:
            return None
        try:
            步骤摘要 = "\n".join(
                f"  {s.get('操作', '?')}: {'✅' if s.get('成功') else '❌'} {str(s.get('结果', ''))[:100]}"
                for s in 推理过程 if s.get("类型") == "操作"
            )[:1000]

            失败操作摘要 = ", ".join(f"{f['操作']}(失败{f['失败次数']}次)" for f in 失败操作)

            提示 = (
                f"任务: {用户消息[:200]}\n"
                f"失败的操作: {失败操作摘要}\n\n"
                f"执行过程:\n{步骤摘要}\n\n"
                f"请分析失败原因并给出绕路方案，输出JSON：\n"
                f'{{"失败原因": "一句话说明为什么失败", '
                f'"绕路方案": "下次遇到同样情况应该怎么做（具体操作建议）"}}'
            )

            结果 = self.模型直连器.发送消息(
                [{"role": "user", "content": 提示}],
                "你是失败分析专家。分析任务失败原因并给出绕路方案。只输出JSON。"
            )
            if 结果.get("成功"):
                回复 = 结果.get("回复内容", "")
                json匹配 = re.search(r'\{[\s\S]*\}', 回复)
                if json匹配:
                    return json.loads(json匹配.group())
        except Exception as e:
            print(f"  ⚠️ 绕路师LLM分析失败: {e}")
        return None

    def 检测高频问题(self) -> list:
        """检测出现次数≥3的高频失败模式，可用于自动修复"""
        if not self.存储引擎:
            return []
        try:
            rows = self.存储引擎._查询(
                "SELECT 触发关键词, 失败操作, 失败原因, 绕路方案, 出现次数 FROM 绕路记录 "
                "WHERE 出现次数 >= 3 ORDER BY 出现次数 DESC LIMIT 10"
            )
            return [{
                "触发关键词": r[0], "失败操作": r[1], "失败原因": r[2],
                "绕路方案": r[3], "出现次数": r[4]
            } for r in rows]
        except Exception:
            return []

    def _自动记录高频Bug(self):
        """高频失败模式（出现次数刚好达到3次）自动写入Bug库，方便开发者定位修复"""
        if not self.存储引擎:
            return
        try:
            # 查找出现次数刚好等于3的记录（=3时触发一次，避免重复写入）
            rows = self.存储引擎._查询(
                "SELECT id, 触发关键词, 失败操作, 失败原因, 绕路方案, 出现次数 FROM 绕路记录 "
                "WHERE 出现次数 = 3"
            )
            if not rows:
                return
            from Bug追踪器 import Bug追踪器类
            追踪器 = Bug追踪器类._实例引用
            if not 追踪器:
                return
            for r in rows:
                记录id = r[0]
                失败操作 = r[2]
                失败原因 = r[3] or "未知原因"
                绕路方案 = r[4] or "无方案"
                # 推断文件路径：从失败操作名推断
                文件路径 = self._推断文件路径(失败操作)
                问题描述 = f"[绕路师自动记录] 操作「{失败操作}」反复失败3次。原因: {失败原因}。绕路方案: {绕路方案}"
                追踪器.记录Bug(
                    文件路径=文件路径,
                    行号=0,
                    问题描述=问题描述,
                    严重程度="中",
                    发现来源="绕路师"
                )
                print(f"  🐛 绕路师自动记录Bug: {失败操作} (3次失败)")
        except Exception:
            pass

    @staticmethod
    def _推断文件路径(操作名: str) -> str:
        """从操作名推断可能的源文件路径"""
        if 操作名.startswith("MCP_"):
            return "公共区/内核/MCP客户端.py"
        if "Blender" in 操作名:
            return "公共区/内核/操作/Blender.py"
        if "Houdini" in 操作名:
            return "公共区/插件/Houdini插件.py"
        if "ComfyUI" in 操作名:
            return "公共区/内核/操作/ComfyUI操作.py"
        if "连接" in 操作名 or "MCP" in 操作名:
            return "公共区/内核/操作/MCP操作.py"
        if "运行命令" in 操作名:
            return "公共区/内核/操作/系统.py"
        if "query_scene" in 操作名 or "execute_maxscript" in 操作名:
            return "公共区/内核/MCP客户端.py"
        return "未知文件"
