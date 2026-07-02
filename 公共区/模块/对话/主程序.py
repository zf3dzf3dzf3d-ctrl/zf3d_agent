"""对话模块 — 入口协调器 + 多对话管理

架构升级后的对话模块：
- 意图解析器：分析用户意图（闲聊/任务/批量/查看/框选）
- 上下文管理器：统一对话上下文（消除FC双轨制）+ token预算
- 提示词构建器：系统提示词构建 + 记忆单轮缓存
- 推理引擎：状态机驱动的ReAct循环
- 反思评估器：任务反思 + 错误分类恢复

本文件职责：
1. 初始化各子模块
2. 多对话管理（新建/切换/删除/重命名）
3. 检查点续跑
4. 推理流代理
5. 框选快捷路径
6. 计划模式执行
"""
import sys
import json
import threading
from pathlib import Path
from datetime import datetime

内核目录 = Path(__file__).parent.parent.parent / "内核"
sys.path.insert(0, str(内核目录))
对话目录 = Path(__file__).parent
sys.path.insert(0, str(对话目录))

from 配置加载器 import 全局事件中心
from 意图解析器 import 意图解析器类
from 上下文管理器 import 上下文管理器类
from 提示词构建器 import 提示词构建器类
from 推理引擎 import 推理引擎类
from 反思评估器 import 反思评估器类
from 经验师 import 经验师类


def text_only(消息: str) -> str:
    """从可能包含环境前缀的消息中提取纯用户文本"""
    if "用户: " in 消息:
        return 消息.split("用户: ", 1)[-1].strip()
    if "用户指令: " in 消息:
        return 消息.split("用户指令: ", 1)[-1].strip()
    return 消息.strip()


class 对话模块:
    """对话模块入口 - 协调各子模块"""

    def __init__(self):
        self.配置 = {}
        self.对话历史 = []
        self._新对话标志 = False
        self.模型直连器 = None
        self.操作注册中心 = None
        self.模块注册 = None
        self.技能加载器 = None
        self.知识库 = None
        self.工作模式 = "商量"
        self.最大步数 = 99
        self.最大历史数 = 50
        self.基础系统提示词 = ""
        self.推理日志 = []
        self.文件上下文 = ""
        self.当前计划 = None
        self._本轮FC消息 = []  # 兼容旧代码
        self.推理流 = []
        self.推理流索引 = 0
        self._锁 = threading.Lock()
        self._推理流锁 = threading.Lock()
        self._取消标志 = False
        self.检查点 = None
        self.检查点路径 = None
        # 子模块
        self.意图解析器 = 意图解析器类()
        self.上下文管理器 = 上下文管理器类()
        self.提示词构建器 = 提示词构建器类()
        self.推理引擎 = 推理引擎类()
        self.反思评估器 = 反思评估器类()
        self.经验师 = 经验师类()

    def 初始化(self, 配置: dict):
        """初始化对话模块"""
        self.配置 = 配置
        self.模型直连器 = 配置.get("模型直连器")
        self.操作注册中心 = 配置.get("操作注册中心")
        self.模块注册 = 配置.get("模块注册", {})
        self.技能加载器 = 配置.get("技能加载器")
        self.知识库 = 配置.get("知识库")
        if self.操作注册中心:
            self.操作注册中心.设置进度回调(self._推入推理流)
            self.操作注册中心.设置取消检查(lambda: self._取消标志)
        self.最大步数 = 配置.get("最大推理步数", 99)
        self.最大历史数 = 配置.get("最大历史数", 50)
        self.基础系统提示词 = 配置.get("系统提示词",
            "你是朱峰社区智能体(ZF3D Agent)，一个功能强大的AI助手。你可以通过执行操作来帮助用户完成任务。")
        # 同步配置到子模块
        self.推理引擎.最大步数 = self.最大步数
        self.上下文管理器.最大历史数 = self.最大历史数
        self.上下文管理器.压缩阈值 = 配置.get("压缩阈值", 30)
        # 检查点目录
        项目根 = Path(self.配置.get("项目根目录", "."))
        self.检查点目录 = 项目根 / "隐私区" / "我的日志" / "检查点"
        self.检查点目录.mkdir(parents=True, exist_ok=True)
        # 经验师初始化
        self.经验师.初始化(self.模型直连器, str(项目根))
        # 多对话管理
        try:
            self._初始化对话管理()
            print(f"  ✅ 对话管理初始化完成，当前对话: {self.当前对话ID}")
        except Exception as e:
            print(f"  ⚠️ 对话管理初始化失败: {e}")
            import traceback; traceback.print_exc()
            self.对话列表 = []
            self.当前对话ID = None
            self.永久记忆 = []

    def 运行(self, 输入数据: dict) -> dict:
        """执行对话（主流程）"""
        用户消息 = 输入数据.get("消息", "")
        if not 用户消息:
            return {"成功": False, "错误": "消息为空"}

        with self._锁:
            # 发布事件
            全局事件中心.发布("收到消息", {"角色": "用户", "内容": 用户消息})
            self.对话历史.append({"角色": "用户", "内容": 用户消息,
                                   "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
            if len(self.对话历史) == 1 and self.当前对话ID:
                self.自动命名对话(self.当前对话ID, text_only(用户消息))
            self._保存当前对话()

            try:
                推理结果 = self._执行对话(用户消息)
            except Exception as e:
                import traceback
                错误堆栈 = traceback.format_exc()
                错误信息 = f"❌ 系统异常: {type(e).__name__}: {str(e)}"
                print(f"\n{'='*60}\n❌ 对话异常完整堆栈:\n{错误堆栈}\n{'='*60}")
                self.对话历史.append({"角色": "助手", "内容": 错误信息,
                                       "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
                用户消息时间 = self.对话历史[-2].get("时间", "") if len(self.对话历史) >= 2 else ""
                助手回复时间 = self.对话历史[-1].get("时间", "")
                self.推理日志.append({
                    "用户消息": 用户消息[:5000], "用户消息时间": 用户消息时间,
                    "助手回复": 错误信息[:200], "助手回复时间": 助手回复时间,
                    "步数": 0, "推理过程": [], "错误": True,
                    "错误类型": type(e).__name__, "错误信息": str(e)[:500],
                    "错误堆栈": 错误堆栈[:3000]
                })
                try:
                    from 运行诊断器 import 运行诊断器类
                    if 运行诊断器类._实例引用:
                        运行诊断器类._实例引用.记录错误("对话.运行", 异常对象=e)
                except Exception:
                    pass
                self._保存当前对话()
                self._新对话标志 = False
                return {"成功": False, "错误": 错误信息, "回复": 错误信息}

            # 反思（仅复杂任务触发，简单任务跳过省token）
            if self.配置.get("任务反思", True) and 推理结果.get("步数", 0) > 4:
                反思内容 = self.反思评估器.评估(用户消息, 推理结果, self.模型直连器)
                if 反思内容:
                    self.对话历史.append({"角色": "系统", "内容": f"💡 【任务反思】{反思内容}",
                                           "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
                # 生成经验卡片并存入SQLite（异步，不阻塞用户回复）
                if hasattr(self, '存储引擎') and self.存储引擎:
                    def _异步保存经验():
                        try:
                            经验卡片 = self.反思评估器.生成经验卡片(用户消息, 推理结果, self.模型直连器)
                            if 经验卡片:
                                self.存储引擎.插入任务经验(经验卡片)
                            self.经验师.沉淀经验(用户消息, 推理结果)
                        except Exception:
                            pass
                    import threading as _t
                    _t.Thread(target=_异步保存经验, daemon=True).start()

            全局事件中心.发布("收到消息", {"角色": "助手", "内容": 推理结果.get("回复", "")})

            # 安全检查：确保推理引擎的助手回复已追加到对话历史
            if 推理结果.get("回复") and (not self.对话历史 or self.对话历史[-1].get("角色") != "助手"):
                self.对话历史.append({"角色": "助手", "内容": 推理结果["回复"],
                                       "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})

            # 保存推理日志
            用户消息时间 = self.对话历史[-2].get("时间", "") if len(self.对话历史) >= 2 else ""
            助手回复时间 = self.对话历史[-1].get("时间", "") if self.对话历史 else ""
            self.推理日志.append({
                "用户消息": 用户消息[:5000], "用户消息时间": 用户消息时间,
                "助手回复": 推理结果.get("回复", "")[:5000], "助手回复时间": 助手回复时间,
                "步数": 推理结果.get("步数", 0),
                "推理过程": 推理结果.get("完整推理过程", 推理结果.get("推理过程", [])),
                "llm调用记录": 推理结果.get("llm调用记录", []),
                "成功": 推理结果.get("成功", True), "错误": 推理结果.get("错误", "")
            })
            self._保存当前对话()
            self._新对话标志 = False
            return 推理结果

    def _执行对话(self, 用户消息: str) -> dict:
        """核心对话流程：意图分析 → 快捷路径/推理引擎 → 结果"""
        # 1. 意图解析
        意图 = self.意图解析器.解析(用户消息, self.文件上下文, self.模型直连器)

        # 2. 闲聊直接回复（不进ReAct循环，省token+加速）
        if 意图["类型"] == "闲聊" and not self.当前计划:
            # 确认回复（如"可以""好的"）不走闲聊路径，走ReAct以保持上下文和工具能力
            if not self._是确认回复(用户消息):
                闲聊结果 = self._直接回复(用户消息)
                if 闲聊结果 is not None:
                    return 闲聊结果
            # _直接回复返回None=AI输出了操作调用，回退到ReAct
            意图 = {"类型": "单步任务", "批量数": 0, "操作类型": None, "闲聊置信度": 0.0}

        # 3. 框选快捷路径
        if 意图["类型"] == "框选编辑":
            框选结果 = self._处理框选文本快捷(用户消息)
            if 框选结果:
                return 框选结果

        # 4. 规划模式
        if self.工作模式 == "规划":
            return self._执行规划模式(用户消息)

        # 5. 设置推理引擎回调
        self.推理引擎.设置回调(
            推理流回调=self._推入推理流,
            取消检查=lambda: self._取消标志,
            检查点回调=self._保存检查点
        )

        # 6. 执行推理引擎
        配置 = {**self.配置,
                "系统提示词": self.基础系统提示词,
                "工作模式": self.工作模式,
                "模块注册": self.模块注册,
                "新对话标志": self._新对话标志,
                "对话ID": self.当前对话ID}
        return self.推理引擎.执行(
            用户消息=用户消息, 意图=意图, 对话历史=self.对话历史,
            上下文管理器=self.上下文管理器, 提示词构建器=self.提示词构建器,
            模型直连器=self.模型直连器, 操作注册中心=self.操作注册中心,
            文件上下文=self.文件上下文, 永久记忆=getattr(self, '永久记忆', []),
            配置=配置
        )

    def _是确认回复(self, 用户消息: str) -> bool:
        """检测用户消息是否是对上一轮助手提问的确认回复（如"可以""好的"）"""
        确认词 = ['可以', '好的', '行', '嗯', '对', '是', '没问题', '好', '确认', '同意', '没错']
        纯文本 = text_only(用户消息).strip()
        if len(纯文本) > 10:
            return False
        if not any(纯文本 == 词 or 纯文本.startswith(词) for 词 in 确认词):
            return False
        # 检查上一轮助手消息是否在请求确认
        for 消息 in reversed(self.对话历史[:-1]):
            if 消息.get("角色") == "助手":
                内容 = 消息.get("内容", "")
                确认标志 = ['？', '?', '吗', '要不要', '是否', '可以吗', '好不好', '行不行']
                return any(标志 in 内容 for 标志 in 确认标志)
            if 消息.get("角色") == "用户":
                break
        return False

    def _直接回复(self, 用户消息: str) -> dict:
        """闲聊直接回复（单次LLM调用，不进ReAct循环）"""
        系统提示词 = self.提示词构建器.构建(
            基础提示词=self.基础系统提示词, 工作模式=self.工作模式,
            文件上下文=self.文件上下文, 模型直连器=self.模型直连器,
            操作注册中心=self.操作注册中心, 模块注册=self.模块注册,
            永久记忆=getattr(self, '永久记忆', []),
            配置={**self.配置, "当前消息": 用户消息, "新对话标志": self._新对话标志},
            fc已降级=True  # 闲聊不需要工具
        )
        # 构建带历史的消息列表（闲聊也需要上下文，否则短回复如"可以"会丢失语境）
        消息列表 = []
        for 消息 in self.对话历史[-self.最大历史数:]:
            if 消息.get("角色") == "系统":
                continue
            角色 = "user" if 消息.get("角色") == "用户" else "assistant"
            消息列表.append({"role": 角色, "content": 消息.get("内容", "")})

        # 流式回调：闲聊也支持流式输出
        def _流式回调(片段):
            self._推入推理流("流式回复", {"内容": 片段})

        if hasattr(self.模型直连器, '发送消息流式'):
            结果 = self.模型直连器.发送消息流式(消息列表, 系统提示词, 流式回调=_流式回调)
        else:
            结果 = self.模型直连器.发送消息(消息列表, 系统提示词)
        if 结果.get("成功"):
            回复 = 结果["回复内容"]
            # 检测AI是否在闲聊模式下输出了JSON操作调用（说明需要工具）
            if self._包含操作调用(回复):
                return None  # 返回None触发回退到ReAct
            self.对话历史.append({"角色": "助手", "内容": 回复,
                                   "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
            return {"成功": True, "回复": 回复, "推理过程": [],
                    "完整推理过程": [], "llm调用记录": [], "步数": 0}
        return {"成功": False, "错误": self.反思评估器.友好化错误(结果.get('错误', ''))}

    def _包含操作调用(self, 文本: str) -> bool:
        """检测文本是否包含JSON格式的操作调用"""
        if '"操作"' not in 文本 and '"action"' not in 文本.lower():
            return False
        # 检查是否包含JSON代码块或内联JSON
        import re
        # ```json ... ``` 代码块
        匹配 = re.search(r'```(?:json)?\s*\n?(.*?)\n?\s*```', 文本, re.DOTALL)
        if 匹配:
            import json
            try:
                数据 = json.loads(匹配.group(1).strip())
                if isinstance(数据, dict) and "操作" in 数据:
                    return True
            except (json.JSONDecodeError, TypeError):
                pass
        # 内联JSON { ... }
        start = 文本.find('{')
        if start != -1:
            end = 文本.rfind('}')
            if end > start:
                try:
                    数据 = json.loads(文本[start:end + 1])
                    if isinstance(数据, dict) and "操作" in 数据:
                        return True
                except (json.JSONDecodeError, TypeError):
                    pass
        return False

    def _执行规划模式(self, 用户消息: str) -> dict:
        """规划模式：生成结构化计划"""
        系统提示词 = self.提示词构建器.构建(
            基础提示词=self.基础系统提示词, 工作模式="规划",
            文件上下文=self.文件上下文, 模型直连器=self.模型直连器,
            操作注册中心=self.操作注册中心, 模块注册=self.模块注册,
            永久记忆=getattr(self, '永久记忆', []),
            配置={**self.配置, "当前消息": 用户消息, "新对话标志": self._新对话标志},
            fc已降级=True
        )
        # 构建带历史的消息列表
        消息列表 = []
        for 消息 in self.对话历史[-self.最大历史数:]:
            if 消息.get("角色") == "系统":
                continue
            角色 = "user" if 消息.get("角色") == "用户" else "assistant"
            消息列表.append({"role": 角色, "content": 消息.get("内容", "")})

        # 流式回调：规划模式也支持流式输出
        def _流式回调2(片段):
            self._推入推理流("流式回复", {"内容": 片段})

        if hasattr(self.模型直连器, '发送消息流式'):
            结果 = self.模型直连器.发送消息流式(消息列表, 系统提示词, 流式回调=_流式回调2)
        else:
            结果 = self.模型直连器.发送消息(消息列表, 系统提示词)
        if 结果.get("成功"):
            回复 = 结果["回复内容"]
            self.对话历史.append({"角色": "助手", "内容": 回复,
                                   "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
            计划 = None
            try:
                import re
                json匹配 = re.search(r'\{[\s\S]*"计划"[\s\S]*\}', 回复)
                if json匹配:
                    计划 = json.loads(json匹配.group())
                    self.当前计划 = 计划
            except:
                pass
            self._保存当前对话()
            return {"成功": True, "回复": 回复, "推理过程": [],
                    "完整推理过程": [], "llm调用记录": [], "步数": 0,
                    "计划模式": True, "计划": 计划}
        return {"成功": False, "错误": self.反思评估器.友好化错误(结果.get('错误', ''))}

    def _处理框选文本快捷(self, 用户消息: str) -> dict:
        """框选文本快捷路径：只问LLM新文本，然后直接替换"""
        框选原文 = ""
        框选文件路径 = ""
        框选文件名 = ""
        for 消息 in reversed(self.对话历史):
            if 消息.get("角色") == "用户" and "选中了以下文本" in 消息.get("内容", ""):
                内容 = 消息["内容"]
                标记 = 内容.split("---")
                if len(标记) >= 3:
                    框选原文 = 标记[1].strip()
                for 行 in 内容.split("\n"):
                    if 行.startswith("文件路径:"):
                        框选文件路径 = 行.replace("文件路径:", "").strip()
                    if 行.startswith("[用户在文件"):
                        框选文件名 = 行.split("「")[1].split("」")[0] if "「" in 行 else ""
                break
        if not 框选原文 or not 框选文件路径:
            return None
        后缀 = Path(框选文件名).suffix.lower() if 框选文件名 else ""
        是word = 后缀 == ".docx"
        是excel = 后缀 in (".xlsx", ".xls")
        if 是word:
            操作名 = "替换Word文本"
        elif 是excel:
            操作名 = "替换Excel文本"
        else:
            操作名 = "替换文本"
        # 验证框选文本存在
        if not 是word and not 是excel:
            try:
                文件结果 = self.操作注册中心.执行("读取文件", {"路径": 框选文件路径})
                if 文件结果.get("成功"):
                    文件内容 = 文件结果.get("data", 文件结果.get("数据", ""))
                    # 规范化换行符后再比较，避免\r\n vs \n导致匹配失败
                    文件内容_norm = 文件内容.replace("\r\n", "\n").replace("\r", "\n")
                    框选_norm = 框选原文.replace("\r\n", "\n").replace("\r", "\n")
                    if 框选_norm not in 文件内容_norm and 框选_norm.strip() not in 文件内容_norm:
                        return {"成功": True,
                                "回复": f"⚠️ 选中「{框选原文[:30]}...」在文件中未找到。请先Ctrl+S保存文件再操作。"}
            except:
                pass
        原始指令 = 用户消息
        for 行 in 用户消息.split("\n"):
            if 行.startswith("用户指令:"):
                原始指令 = 行.replace("用户指令:", "").strip()
                break
        精简提示 = f"""将下面选中的文本根据用户指令改写或扩展，只输出最终结果。

选中原文:
{框选原文}

用户指令: {原始指令}

【规则】
- 只输出最终文本本身，不要解释，不要选项，不要代码块，不要引号包裹
- 删除类指令直接输出空
- 增加内容类指令：在原文基础上追加新内容
- 改写类指令：输出改写后的完整文本"""
        消息列表 = [
            {"role": "system", "content": "你是一个文本改写工具。只输出改写结果，绝对不要解释。"},
            {"role": "user", "content": 精简提示}
        ]
        结果 = self.模型直连器.发送消息(消息列表)
        if not 结果["成功"]:
            return None
        新文本 = 结果["回复内容"].strip()
        if 新文本.startswith("```"):
            行列表 = 新文本.split("\n")
            新文本 = "\n".join(行列表[1:-1] if 行列表[-1].strip() == "```" else 行列表[1:]).strip()
        if len(新文本) >= 2 and 新文本[0] in ('"', "'") and 新文本[-1] == 新文本[0]:
            新文本 = 新文本[1:-1]
        if 新文本 == 框选原文:
            return None
        执行结果 = self.操作注册中心.执行(操作名, {
            "路径": 框选文件路径, "旧文本": 框选原文, "新文本": 新文本
        })
        操作成功 = 执行结果.get("成功", 执行结果.get("success", False))
        推理过程 = [{
            "步骤": 1, "类型": "操作", "操作": 操作名,
            "参数": {"路径": 框选文件路径, "旧文本": 框选原文, "新文本": 新文本},
            "思考": f"用户选中「{框选原文[:30]}...」，指令: {用户消息}",
            "结果": 执行结果.get("data", 执行结果.get("数据", "")) if 操作成功 else 执行结果.get("error", 执行结果.get("错误", "")),
            "成功": 操作成功
        }]
        if 操作成功:
            最终回复 = f"✅ 已替换" if 新文本 else f"✅ 已删除"
        else:
            最终回复 = f"❌ 替换失败"
        self.对话历史.append({"角色": "助手", "内容": 最终回复,
                               "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
        return {"成功": True, "回复": 最终回复, "推理过程": 推理过程,
                "完整推理过程": 推理过程, "llm调用记录": [], "步数": 1}

    def 执行已批准计划(self) -> dict:
        """执行已批准的计划"""
        if not self.当前计划:
            return {"成功": False, "错误": "无已批准的计划"}
        if not self.操作注册中心:
            return {"成功": False, "错误": "操作注册中心未就绪"}
        计划步骤 = self.当前计划.get("计划", [])
        if not 计划步骤:
            return {"成功": False, "错误": "计划为空"}
        执行结果列表 = []
        失败数 = 0
        for i, 步骤 in enumerate(计划步骤):
            步骤说明 = 步骤.get("说明", f"步骤{i+1}")
            预计操作 = 步骤.get("预计操作", "")
            提示 = f"执行计划第{i+1}步: {步骤说明}\n预计操作: {预计操作}\n请确定具体的操作和参数。输出JSON格式。"
            消息列表 = []
            for 消息 in self.对话历史[-10:]:
                角色 = "user" if 消息.get("角色") == "用户" else "assistant"
                消息列表.append({"role": 角色, "content": 消息.get("内容", "")})
            消息列表.append({"role": "user", "content": 提示})
            系统提示词 = self.提示词构建器.构建(
                基础提示词=self.基础系统提示词, 工作模式=self.工作模式,
                文件上下文=self.文件上下文, 模型直连器=self.模型直连器,
                操作注册中心=self.操作注册中心, 模块注册=self.模块注册,
                永久记忆=getattr(self, '永久记忆', []),
                配置={**self.配置, "当前消息": 提示, "新对话标志": False},
                fc已降级=True
            )
            结果 = self.模型直连器.发送消息(消息列表, 系统提示词)
            if not 结果.get("成功"):
                执行结果列表.append({"步骤": i+1, "说明": 步骤说明, "结果": f"LLM调用失败: {结果.get('错误', '')}"})
                失败数 += 1
                continue
            回复 = 结果.get("回复内容", "")
            解析结果 = self.推理引擎._解析LLM输出(回复)
            if 解析结果["类型"] != "操作调用":
                执行结果列表.append({"步骤": i+1, "说明": 步骤说明, "结果": f"跳过({回复[:200]})"})
                continue
            操作名 = 解析结果["操作名"]
            操作参数 = 解析结果["参数"]
            执行结果 = self.操作注册中心.执行(操作名, 操作参数)
            步骤结果 = {"步骤": i+1, "说明": 步骤说明, "操作": 操作名, "参数": 操作参数,
                       "成功": 执行结果.get("成功", False),
                       "结果": 执行结果.get("data", 执行结果.get("数据", "")) if 执行结果.get("成功", False) else 执行结果.get("error", 执行结果.get("错误", ""))}
            执行结果列表.append(步骤结果)
            if not 执行结果.get("成功", False):
                失败数 += 1
            self.对话历史.append({"角色": "助手", "内容": f"执行步骤{i+1}: {步骤说明}\n操作: {操作名}",
                                   "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
            self.对话历史.append({"角色": "用户", "内容": f"观察: {步骤结果['结果'][:500]}",
                                   "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
        汇总 = f"计划执行完成: {len(计划步骤)}步, 成功{len(计划步骤)-失败数}, 失败{失败数}"
        self.当前计划 = None
        self.工作模式 = "商量"
        self._保存当前对话()
        return {"成功": 失败数 == 0, "回复": 汇总, "执行结果": 执行结果列表,
                "推理过程": [{"步骤": r["步骤"], "类型": "操作", "操作": r.get("操作", ""), "结果": r.get("结果", "")[:300]} for r in 执行结果列表],
                "完整推理过程": [{"步骤": r["步骤"], "类型": "操作", "操作": r.get("操作", ""), "参数": r.get("参数", {}), "结果": r.get("结果", ""), "成功": r.get("成功", False)} for r in 执行结果列表],
                "llm调用记录": [], "步数": len(计划步骤)}

    def 获取状态(self) -> dict:
        return {"工作模式": self.工作模式, "历史消息数": len(self.对话历史),
                "最大步数": self.最大步数, "模型已连接": self.模型直连器 is not None,
                "当前对话ID": self.当前对话ID, "对话数量": len(self.对话列表),
                "有计划": self.当前计划 is not None, "已取消": self._取消标志}

    def 取消(self):
        self._取消标志 = True
        self._重置推理流()
        self._保存当前对话()

    def 停止(self):
        self.对话历史.clear()
        self.推理日志.clear()

    def 获取历史(self) -> list:
        with self._锁:
            return list(self.对话历史)

    def 清空历史(self):
        with self._锁:
            self.对话历史.clear()

    def 设置工作模式(self, 模式: str):
        if 模式 in ("商量", "执行", "无人值守", "规划", "只读"):
            self.工作模式 = 模式
            return True
        return False

    # ============ 多对话管理（SQLite存储） ============
    def _初始化对话管理(self):
        self.对话存储目录 = self.配置.get("项目根目录", ".")
        self.永久记忆 = []
        self.对话列表 = []
        self.当前对话ID = None
        # 注入存储引擎
        from 存储引擎 import 获取存储引擎
        db路径 = str(Path(self.对话存储目录) / "隐私区" / "我的数据" / "智能体.db")
        self.存储引擎 = 获取存储引擎(db路径)
        self._轮次计数 = 0
        # 从SQLite加载对话索引
        self._加载对话索引()
        # 如果SQLite没有对话但JSON目录有旧文件，自动迁移
        if not self.对话列表:
            对话目录 = Path(self.对话存储目录) / "隐私区" / "对话记录"
            if 对话目录.exists():
                json文件 = list(对话目录.glob("*.json"))
                json文件 = [f for f in json文件 if not f.name.startswith("_") and f.stat().st_size > 100]
                if json文件:
                    print(f"  📦 检测到{len(json文件)}个旧JSON对话，开始迁移到SQLite...")
                    结果 = self.存储引擎.迁移对话记录(str(对话目录))
                    print(f"  ✅ 迁移完成: {结果}")
                    self._加载对话索引()
        self._加载永久记忆()
        if not self.对话列表:
            self.新建对话()
        else:
            # 自动切换到最近的对话
            self.当前对话ID = self.对话列表[0]["id"]
            self.对话历史, self.推理日志 = self._加载对话(self.当前对话ID)

    def _对话文件路径(self, 对话ID):
        return Path(self.对话存储目录) / "隐私区" / "对话记录" / f"{对话ID}.json"

    def _索引文件路径(self):
        return Path(self.对话存储目录) / "隐私区" / "对话记录" / "_索引.json"

    def _永久记忆路径(self):
        return Path(self.对话存储目录) / "隐私区" / "对话记录" / "_永久记忆.json"

    def _加载对话索引(self):
        """从SQLite加载对话索引"""
        try:
            self.对话列表 = self.存储引擎.查询对话索引()
        except Exception:
            self.对话列表 = []

    def _保存对话索引(self):
        """对话索引已由SQLite自动维护，此方法保留兼容但无需操作"""
        pass

    def _加载永久记忆(self):
        try:
            from 存储引擎 import 获取存储引擎
            引擎 = 获取存储引擎()
            if 引擎 is None:
                self.永久记忆 = []
            else:
                数据 = 引擎.读取KV_JSON("永久记忆", 默认值=[])
                self.永久记忆 = 数据 if isinstance(数据, list) else []
        except Exception:
            self.永久记忆 = []

    def _保存永久记忆(self):
        try:
            from 存储引擎 import 获取存储引擎
            引擎 = 获取存储引擎()
            if 引擎 is not None:
                引擎.写入KV_JSON("永久记忆", self.永久记忆)
        except Exception as e:
            print(f"  ⚠️ 保存永久记忆失败: {e}")

    def _保存当前对话(self):
        """增量保存：只保存未保存的新消息和新推理日志 → SQLite"""
        if not self.当前对话ID or not self.存储引擎:
            return
        # 保存所有未保存的消息（增量INSERT）
        已保存 = getattr(self, '_已保存消息数', 0)
        新消息数 = len(self.对话历史) - 已保存
        if 新消息数 > 0:
            for i in range(已保存, len(self.对话历史)):
                msg = self.对话历史[i]
                self.存储引擎.插入对话消息(
                    self.当前对话ID,
                    msg.get("角色", ""),
                    msg.get("内容", ""),
                    msg.get("时间", "")
                )
            self._已保存消息数 = len(self.对话历史)
        # 保存未保存的推理日志（增量INSERT）
        已保存日志 = getattr(self, '_已保存日志数', 0)
        新日志数 = len(self.推理日志) - 已保存日志
        if 新日志数 > 0:
            for i in range(已保存日志, len(self.推理日志)):
                self._轮次计数 += 1
                log = self.推理日志[i]
                self.存储引擎.插入推理日志(self.当前对话ID, self._轮次计数, {
                    "用户消息": log.get("用户消息", ""),
                    "助手回复": log.get("助手回复", ""),
                    "步数": log.get("步数", 0),
                    "成功": log.get("成功", True),
                    "推理过程": log.get("推理过程", []),
                    "llm调用记录": log.get("llm调用记录", [])
                })
            self._已保存日志数 = len(self.推理日志)
        # 更新对话索引（仅当有新消息时）
        if 新消息数 > 0 or 新日志数 > 0:
            self.存储引擎.更新对话索引(
                self.当前对话ID,
                消息数=len(self.对话历史),
                更新时间=datetime.now().isoformat()
            )
            # 同步内存中的对话列表（不查SQLite，直接更新）
            for d in self.对话列表:
                if d["id"] == self.当前对话ID:
                    d["消息数"] = len(self.对话历史)
                    d["更新时间"] = datetime.now().isoformat()
                    break

    def _加载对话(self, 对话ID):
        """从SQLite加载对话历史和推理日志"""
        if not self.存储引擎:
            return [], []
        try:
            历史 = self.存储引擎.查询对话消息(对话ID)
            # 过滤掉系统消息（不注入对话上下文）
            对话历史 = [{"角色": m["角色"], "内容": m["内容"], "时间": m["时间"]}
                       for m in 历史 if m["角色"] in ("用户", "助手", "系统")]
            推理日志 = self.存储引擎.查询推理日志(对话ID)
            # 恢复计数器（标记所有已加载的数据为已保存）
            self._已保存消息数 = len(对话历史)
            self._已保存日志数 = len(推理日志)
            self._轮次计数 = len(推理日志)
            return 对话历史, 推理日志
        except Exception:
            self._已保存消息数 = 0
            self._已保存日志数 = 0
            self._轮次计数 = 0
            return [], []

    def 新建对话(self):
        self._取消标志 = True
        if self.当前对话ID:
            self._保存当前对话()
            self._清除检查点()
        self._取消标志 = False
        self.推理流 = []
        self.推理流索引 = 0
        self._本轮FC消息 = []
        对话ID = datetime.now().strftime("%Y%m%d_%H%M%S")
        now = datetime.now().isoformat()
        对话信息 = {"id": 对话ID, "标题": "新对话", "创建时间": now, "更新时间": now}
        # 写入SQLite对话索引
        if hasattr(self, '存储引擎') and self.存储引擎:
            self.存储引擎.插入对话索引(对话ID, "新对话", now, now)
        self.对话列表.insert(0, 对话信息)
        self.当前对话ID = 对话ID
        self.对话历史 = []
        self.推理日志 = []
        self._轮次计数 = 0
        self._已保存消息数 = 0
        self._已保存日志数 = 0
        self._新对话标志 = True
        全局事件中心.发布("话题切换", {"标题": f"对话_{对话ID}"})
        return 对话信息

    def 切换对话(self, 对话ID):
        if 对话ID == self.当前对话ID:
            return {"成功": True}
        self._取消标志 = True
        if self.当前对话ID:
            self._保存当前对话()
            self._清除检查点()
        self._取消标志 = False
        self.推理流 = []
        self.推理流索引 = 0
        self._本轮FC消息 = []
        目标 = next((d for d in self.对话列表 if d["id"] == 对话ID), None)
        if not 目标:
            return {"成功": False, "错误": "对话不存在"}
        self.当前对话ID = 对话ID
        self.对话历史, self.推理日志 = self._加载对话(对话ID)
        目标["更新时间"] = datetime.now().isoformat()
        if hasattr(self, '存储引擎') and self.存储引擎:
            self.存储引擎.更新对话索引(对话ID, 更新时间=datetime.now().isoformat())
        self._加载对话索引()
        全局事件中心.发布("话题切换", {"标题": f"对话_{对话ID}"})
        return {"成功": True}

    def 删除对话(self, 对话ID):
        if 对话ID not in [d["id"] for d in self.对话列表]:
            return {"成功": False, "错误": "对话不存在"}
        # 从SQLite删除所有相关数据
        if hasattr(self, '存储引擎') and self.存储引擎:
            self.存储引擎.删除对话(对话ID)
            self.存储引擎.删除推理日志(对话ID)
            self.存储引擎.删除对话索引(对话ID)
            self.存储引擎.删除操作结果(对话ID)
        # 删除旧JSON文件（如果存在）
        文件路径 = self._对话文件路径(对话ID)
        if 文件路径.exists():
            文件路径.unlink()
        self.对话列表 = [d for d in self.对话列表 if d["id"] != 对话ID]
        if 对话ID == self.当前对话ID:
            if self.对话列表:
                self.切换对话(self.对话列表[0]["id"])
            else:
                self.新建对话()
        return {"成功": True}

    def 重命名对话(self, 对话ID, 新标题):
        for d in self.对话列表:
            if d["id"] == 对话ID:
                d["标题"] = 新标题
                d["更新时间"] = datetime.now().isoformat()
                if hasattr(self, '存储引擎') and self.存储引擎:
                    self.存储引擎.更新对话索引(对话ID, 标题=新标题, 更新时间=d["更新时间"])
                return {"成功": True}
        return {"成功": False, "错误": "对话不存在"}

    def 自动命名对话(self, 对话ID, 首条消息):
        for d in self.对话列表:
            if d["id"] == 对话ID and d["标题"] == "新对话":
                标题 = 首条消息[:20].replace("\n", " ").strip()
                if 标题:
                    d["标题"] = 标题 + ("..." if len(首条消息) > 20 else "")
                    d["更新时间"] = datetime.now().isoformat()
                    if hasattr(self, '存储引擎') and self.存储引擎:
                        self.存储引擎.更新对话索引(对话ID, 标题=d["标题"], 更新时间=d["更新时间"])

    def 添加永久记忆(self, 内容):
        self.永久记忆.append({"内容": 内容, "时间": datetime.now().isoformat()})
        self._保存永久记忆()

    def 获取对话列表(self):
        return self.对话列表

    def 获取对话消息(self, 对话ID):
        if not 对话ID:
            return {"成功": False, "错误": "未指定对话ID"}
        目标 = next((d for d in self.对话列表 if d["id"] == 对话ID), None)
        if not 目标:
            return {"成功": False, "错误": "对话不存在"}
        历史, 推理日志 = self._加载对话(对话ID)
        return {"成功": True, "历史": 历史, "推理日志": 推理日志}

    # ============ 推理流 ============
    def _推入推理流(self, 类型, 内容):
        with self._推理流锁:
            self.推理流.append({"类型": 类型, "内容": 内容,
                                 "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})

    def _重置推理流(self):
        with self._推理流锁:
            self.推理流 = []
            self.推理流索引 = 0

    def 获取推理流(self, 上次索引=0):
        with self._推理流锁:
            新记录 = self.推理流[上次索引:]
            return {"成功": True, "记录": 新记录, "当前索引": len(self.推理流)}

    # ============ 检查点 ============
    def _检查点文件(self, 对话ID=None):
        return self.检查点目录 / f"checkpoint_{对话ID or self.当前对话ID}.json"

    def _保存检查点(self, 步数, 当前观察, 推理过程):
        if not self.当前对话ID:
            return
        self.检查点 = {
            "步数": 步数, "当前观察": 当前观察,
            "推理过程": 推理过程[-50:],
            "对话历史": self.对话历史[-100:],
            "用户消息": getattr(self, '_当前用户消息', ''),
            "时间": datetime.now().isoformat()
        }
        try:
            from 存储引擎 import 获取存储引擎
            引擎 = 获取存储引擎()
            if 引擎 is not None:
                引擎.写入KV_JSON(f"检查点_{self.当前对话ID}", self.检查点)
        except Exception as e:
            print(f"  ⚠️ 保存检查点失败: {e}")

    def _加载检查点(self):
        if not self.当前对话ID:
            return {"有检查点": False}
        try:
            from 存储引擎 import 获取存储引擎
            引擎 = 获取存储引擎()
            if 引擎 is None:
                return {"有检查点": False}
            数据 = 引擎.读取KV_JSON(f"检查点_{self.当前对话ID}", 默认值=None)
            if 数据 is None:
                return {"有检查点": False}
            return {"有检查点": True, "检查点": 数据}
        except Exception:
            return {"有检查点": False}

    def _清除检查点(self):
        if not self.当前对话ID:
            return
        try:
            from 存储引擎 import 获取存储引擎
            引擎 = 获取存储引擎()
            if 引擎 is not None:
                引擎.删除KV(f"检查点_{self.当前对话ID}")
        except Exception:
            pass
        self.检查点 = None

    def 续跑检查点(self):
        if not self.当前对话ID:
            return {"成功": False, "错误": "无当前对话"}
        检查点信息 = self._加载检查点()
        if not 检查点信息["有检查点"]:
            return {"成功": False, "错误": "没有可续跑的检查点"}
        检查点 = 检查点信息["检查点"]
        self.对话历史 = 检查点.get("对话历史", [])
        用户消息 = 检查点.get("用户消息", "")
        print(f"  🔄 从检查点续跑: 第{检查点['步数']}步")
        # 设置推理引擎回调
        self.推理引擎.设置回调(
            推理流回调=self._推入推理流,
            取消检查=lambda: self._取消标志,
            检查点回调=self._保存检查点
        )
        意图 = self.意图解析器.解析(用户消息, self.文件上下文, self.模型直连器)
        配置 = {**self.配置, "系统提示词": self.基础系统提示词,
                "工作模式": self.工作模式, "模块注册": self.模块注册,
                "新对话标志": False}
        结果 = self.推理引擎.执行(
            用户消息=用户消息, 意图=意图, 对话历史=self.对话历史,
            上下文管理器=self.上下文管理器, 提示词构建器=self.提示词构建器,
            模型直连器=self.模型直连器, 操作注册中心=self.操作注册中心,
            文件上下文=self.文件上下文, 永久记忆=getattr(self, '永久记忆', []),
            配置=配置
        )
        return {"成功": True, "结果": 结果}

    def 有检查点(self):
        return self._加载检查点()["有检查点"]
