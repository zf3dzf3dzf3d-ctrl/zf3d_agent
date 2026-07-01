"""
进化引擎 — 三智能体自动进化系统

测试员 → 开发者 → 审查员，三线程共享消息队列，自动循环。
在工作引擎目录(./隐私区/我的工作引擎/)中修改代码，通过检测后标记"待合并"。
合并由人工确认（走现有 /api/engine-merge）。

安全红线：
- 只在工作引擎目录修改
- 禁止修改启动器.py和文件权限.json
- 单次最多修改5个文件
- 连续失败3次暂停，需人工恢复
"""
import json
import time
import shutil
import random
import threading
import queue
import py_compile
import re
import subprocess
from pathlib import Path
from datetime import datetime


class 进化引擎类:
    """三智能体自动进化引擎"""

    def __init__(self, 模型直连器, 项目根目录, 配置):
        self.模型直连器 = 模型直连器
        self.项目根目录 = Path(项目根目录)
        self.配置 = 配置

        self.主引擎目录 = self.项目根目录 / "公共区"
        self.工作引擎目录 = self.项目根目录 / "隐私区" / "我的工作引擎" / "公共区"
        self.进化记录目录 = self.项目根目录 / "隐私区" / "我的工作引擎" / "进化记录"

        self.禁止修改 = set(配置.get("禁止修改范围", [
            "公共区/内核/启动器.py",
            "公共区/配置/文件权限.json"
        ]))
        self.允许修改范围 = 配置.get("允许修改范围", [
            "公共区/模块/*/主程序.py",
            "公共区/配置/*.json"
        ])
        self.单次最大修改 = 配置.get("单次最大修改文件数", 5)
        self.最大连续失败 = 配置.get("最大连续失败次数", 3)
        self.间隔分钟 = 配置.get("定时间隔分钟", 5)

        三智能体 = 配置.get("三智能体", {})
        self.测试员提示词 = 三智能体.get("测试员提示词", (
            "你是代码测试员。分析Python代码，找出bug、性能问题、逻辑错误、安全隐患。\n"
            "输出JSON格式：\n"
            '{"问题列表": [{"文件": "相对路径", "行号": 0, "问题描述": "...", "严重程度": "高/中/低", "建议修复": "..."}]}\n'
            "如果没有问题，返回空列表。只输出JSON，不加其他文字。"
        ))
        self.开发者提示词 = 三智能体.get("开发者提示词", (
            "你是开发者。根据测试员报告的问题修改代码。\n"
            "输出JSON格式：\n"
            '{"修改列表": [{"文件": "相对路径", "完整代码": "修改后的完整文件内容", "修改说明": "..."}]}\n'
            "只输出JSON，不加其他文字。代码中的引号用转义。"
        ))
        self.审查员提示词 = 三智能体.get("审查员提示词", (
            "你是代码审查员。审查开发者的修改是否正确解决了问题，是否引入新问题。\n"
            "输出JSON格式：\n"
            '{"通过": true/false, "审查意见": "...", "风险等级": "低/中/高"}\n'
            "只输出JSON，不加其他文字。"
        ))

        self._运行 = False
        self._暂停 = False
        self._连续失败 = 0
        self._轮次 = 0
        self._发现问题数 = 0
        self._修复数 = 0
        self._通过数 = 0
        self._失败数 = 0
        self._日志 = []
        self._待合并 = []
        self._开发者队列 = queue.Queue()
        self._审查员队列 = queue.Queue()
        self._日志锁 = threading.Lock()
        self._状态锁 = threading.Lock()
        self._文件打回次数 = {}  # {文件路径: 打回次数}
        self._最大打回次数 = 3
        self._目标 = ""
        self._对话测试模式 = False
        self._沙箱目录 = None
        self._导师已介入 = False  # 当前轮次导师是否已介入
        self._排错员已介入 = False  # 当前轮次排错员是否已介入
        self._错误历史 = []     # 记录失败原因供导师/排错员分析
        self._介入级别 = 0      # 当前介入级别：0=开发者 1=导师 2=排错员
        self._跳过文件 = set()  # 放弃过的文件，本轮不再选中

    def 设置对话测试模式(self, 启用: bool):
        """开启/关闭对话测试模式"""
        self._对话测试模式 = 启用
        if 启用:
            self._沙箱目录 = self.项目根目录 / "隐私区" / "我的工作引擎" / "测试沙箱"
            self._沙箱目录.mkdir(parents=True, exist_ok=True)
            self._日志记录("系统", "对话测试模式已开启，文件操作锁定到测试沙箱")

    def _生成随机对话(self):
        """让LLM生成一个随机用户消息用于测试"""
        场景提示 = (
            "生成一个用户消息，用于测试AI助手的对话能力。"
            "要求：1.随机选择一个场景（文件操作/搜索/代码/系统信息/翻译/闲聊等）"
            "2.消息要具体、自然，像真实用户会说的话 3.只输出用户消息本身，不加解释\n"
            "随机场景参考：读文件、搜索代码、查时间、算数学、翻译文本、问天气、写文件、"
            "创建文件夹、搜索网页、分析图片、Git操作、问系统信息"
        )
        回复 = self._调用LLM("你是测试用户生成器", 场景提示)
        消息 = 回复.strip() if 回复 else "帮我读取当前目录下的文件列表"
        # 限制长度
        return 消息[:200]

    def _执行对话测试(self):
        """生成随机对话并执行ReAct循环，捕获运行时错误"""
        用户消息 = self._生成随机对话()
        self._日志记录("测试员", f"对话测试: {用户消息[:60]}")

        错误列表 = []
        try:
            # 临时锁定文件管理器的授权目录为沙箱
            from 文件管理器 import 文件管理器类
            原始授权 = None
            文件管理器实例 = None
            try:
                from 操作注册中心 import 操作注册中心类
                注册中心 = 操作注册中心类._实例引用
                if 注册中心 and 注册中心._文件管理器:
                    文件管理器实例 = 注册中心._文件管理器
                    原始授权 = 文件管理器实例.授权目录
                    # 锁定到沙箱目录，只允许读写测试沙箱
                    文件管理器实例.授权目录 = [
                        {"路径": str(self._沙箱目录), "权限": ["读", "写", "创建", "删除"],
                         "授权类型": "永久", "授权时间": datetime.now().isoformat(), "说明": "测试沙箱"}
                    ]
            except Exception:
                pass

            try:
                # 尝试调用推理引擎执行完整ReAct循环
                import sys as _sys
                内核路径 = str(self.主引擎目录 / "内核")
                if 内核路径 not in _sys.path:
                    _sys.path.insert(0, 内核路径)
                from 模块.对话.推理引擎 import 推理引擎类
                from 模块.对话.上下文管理器 import 上下文管理器类
                from 模块.对话.提示词构建器 import 提示词构建器类

                推理引擎 = 推理引擎类()
                推理引擎.最大步数 = 10  # 限制步数避免跑太久
                上下文 = 上下文管理器类()
                提示词 = 提示词构建器类()

                # 获取操作注册中心
                from 操作注册中心 import 操作注册中心类
                操作注册 = 操作注册中心类._实例引用

                if 操作注册 and self.模型直连器:
                    推理结果 = 推理引擎.执行(
                        用户消息=用户消息,
                        意图={"类型": "任务"},
                        对话历史=[],
                        上下文管理器=上下文,
                        提示词构建器=提示词,
                        模型直连器=self.模型直连器,
                        操作注册中心=操作注册,
                        配置={"工作模式": "商量", "对话ID": "进化测试"}
                    )
                    if not 推理结果.get("成功", True):
                        错误 = 推理结果.get("错误", "")
                        if 错误:
                            错误列表.append({
                                "文件": "公共区/模块/对话/推理引擎.py",
                                "错误": f"ReAct执行错误: {错误[:200]}"
                            })
                    # 检查推理过程中是否有操作失败
                    for 步骤 in 推理结果.get("推理过程", []):
                        if 步骤.get("类型") == "操作" and not 步骤.get("成功", True):
                            错误列表.append({
                                "文件": "公共区/内核/操作注册中心.py",
                                "错误": f"操作[{步骤.get('操作', '')}]失败: {步骤.get('结果', '')[:200]}"
                            })
                    回复 = 推理结果.get("回复", "")[:80]
                    self._日志记录("测试员", f"对话回复: {回复}")
                else:
                    # 降级：直接调用模型直连器
                    结果 = self.模型直连器.发送消息(
                        消息列表=[{"role": "user", "content": 用户消息}],
                        系统提示词="你是AI助手，简洁回答用户问题。"
                    )
                    if not 结果.get("成功"):
                        错误列表.append({
                            "文件": "公共区/内核/模型直连器.py",
                            "错误": f"对话失败: {结果.get('错误', '')[:200]}"
                        })
                    else:
                        self._日志记录("测试员", f"对话回复: {结果.get('回复内容', '')[:80]}")
            except Exception as e:
                错误列表.append({
                    "文件": "公共区/内核/进化引擎.py",
                    "错误": f"对话测试异常: {str(e)[:200]}"
                })
            finally:
                # 恢复文件管理器原始授权
                if 文件管理器实例 and 原始授权 is not None:
                    文件管理器实例.授权目录 = 原始授权
        except Exception as e:
            错误列表.append({
                "文件": "公共区/内核/进化引擎.py",
                "错误": f"测试框架异常: {str(e)[:200]}"
            })
        return 错误列表

    def 设置目标(self, 目标):
        self._目标 = 目标
        self._日志记录("系统", f"进化目标已设置: {目标}")

    def 启动(self):
        if not self._git可用():
            self._日志记录("系统", "❌ 系统未安装git，进化引擎无法启动")
            return
        self._运行 = True
        self._暂停 = False
        if not self.工作引擎目录.exists() or not any(self.工作引擎目录.rglob("*.py")):
            self._日志记录("系统", "首次启动，同步主引擎→工作引擎")
            self._同步工作引擎()
        self._git清理锁()
        self.进化记录目录.mkdir(parents=True, exist_ok=True)
        self._日志记录("系统", "进化引擎已启动")
        self._测试员线程 = threading.Thread(target=self._测试员循环, daemon=True, name="测试员")
        self._开发者线程 = threading.Thread(target=self._开发者循环, daemon=True, name="开发者")
        self._审查员线程 = threading.Thread(target=self._审查员循环, daemon=True, name="审查员")
        self._测试员线程.start()
        self._开发者线程.start()
        self._审查员线程.start()

    def 停止(self):
        self._运行 = False
        self._开发者队列.put(None)
        self._审查员队列.put(None)
        self._日志记录("系统", "进化引擎已停止")

    def 暂停(self):
        self._暂停 = True
        self._日志记录("系统", "进化引擎已暂停")

    def 恢复(self):
        self._暂停 = False
        self._重置连续失败()
        self._日志记录("系统", "进化引擎已恢复")

    def _增加连续失败(self):
        with self._状态锁:
            self._连续失败 += 1
            return self._连续失败

    def _重置连续失败(self):
        with self._状态锁:
            self._连续失败 = 0

    def _读取连续失败(self):
        with self._状态锁:
            return self._连续失败

    def _添加待合并(self, 记录):
        with self._状态锁:
            self._待合并.append(记录)
            # 超过50条时删除最旧的，防止内存泄漏
            if len(self._待合并) > 50:
                self._待合并 = self._待合并[-50:]

    def 获取状态(self):
        with self._状态锁:
            连续失败 = self._连续失败
            待合并 = list(self._待合并)
        return {
            "运行中": self._运行,
            "暂停": self._暂停,
            "目标": self._目标,
            "轮次": self._轮次,
            "发现问题数": self._发现问题数,
            "修复数": self._修复数,
            "通过数": self._通过数,
            "失败数": self._失败数,
            "连续失败": 连续失败,
            "待合并数": len(待合并),
            "待合并列表": [{"文件": m["文件"], "审查意见": m["审查意见"], "时间": m["时间"]} for m in 待合并],
            "日志": self._日志[-30:],
        }

    # ============ 测试员 ============

    def _测试员循环(self):
        间隔秒 = self.间隔分钟 * 60
        while self._运行:
            if self._暂停:
                time.sleep(5)
                continue
            if self._读取连续失败() >= self.最大连续失败:
                self._日志记录("系统", f"连续失败{self._读取连续失败()}次，重置计数继续运行")
                self._重置连续失败()

            self._轮次 += 1
            self._日志记录("测试员", f"第{self._轮次}轮开始")
            # 每轮重置导师/排错员标志
            self._导师已介入 = False
            self._排错员已介入 = False
            self._介入级别 = 0
            self._错误历史 = []  # 清空错误历史
            self._跳过文件.clear()  # 新轮次清空跳过列表

            # 对话测试模式：生成随机对话→执行→捕获错误
            if self._对话测试模式:
                try:
                    错误列表 = self._执行对话测试()
                    if 错误列表:
                        self._发现问题数 += len(错误列表)
                        self._日志记录("测试员", f"对话测试发现{len(错误列表)}个运行时错误")
                        # 找到对应的源文件交给开发者修
                        for 错误 in 错误列表:
                            文件 = 错误.get("文件", "")
                            if 文件:
                                代码 = self._读取文件(self._转绝对路径(文件))
                                self._开发者队列.put({
                                    "type": "问题报告",
                                    "轮次": self._轮次, "文件": 文件, "代码": 代码,
                                    "问题列表": [{"文件": 文件, "行号": 0,
                                                  "问题描述": 错误.get("错误", ""),
                                                  "严重程度": "高",
                                                  "建议修复": "修复运行时错误"}],
                                    "时间": datetime.now().strftime("%H:%M:%S")
                                })
                    else:
                        self._日志记录("测试员", "对话测试通过，无运行时错误")
                except Exception as e:
                    self._日志记录("测试员", f"对话测试异常: {e}")
                    self._增加连续失败()
                time.sleep(间隔秒)
                continue

            # 代码审查模式：随机选文件→静态分析
            文件路径 = self._随机选文件()
            if not 文件路径:
                self._日志记录("测试员", "没有可分析的文件")
                time.sleep(间隔秒)
                continue

            try:
                代码 = self._读取文件(文件路径)
                相对路径 = self._转相对路径(文件路径)
                self._日志记录("测试员", f"分析: {相对路径}")

                目标提示 = f"\n进化目标: {self._目标}\n" if self._目标 else ""
                回复 = self._调用LLM(self.测试员提示词,
                    f"文件: {相对路径}\n{目标提示}\n代码:\n{self._截断代码(代码)}")
                结果 = self._提取JSON(回复)

                if 结果 and 结果.get("问题列表"):
                    问题数 = len(结果["问题列表"])
                    self._发现问题数 += 问题数
                    self._日志记录("测试员", f"发现{问题数}个问题")
                    self._开发者队列.put({
                        "type": "问题报告",
                        "轮次": self._轮次, "文件": 相对路径, "代码": 代码,
                        "问题列表": 结果["问题列表"],
                        "时间": datetime.now().strftime("%H:%M:%S")
                    })
                else:
                    self._日志记录("测试员", f"{相对路径} 未发现问题")
            except Exception as e:
                self._日志记录("测试员", f"异常: {e}")

            time.sleep(间隔秒)

    # ============ 开发者 ============

    def _开发者循环(self):
        while self._运行:
            if self._暂停:
                time.sleep(2)
                continue
            try:
                消息 = self._开发者队列.get(timeout=5)
                if 消息 is None:
                    continue
            except queue.Empty:
                continue

            if 消息["type"] == "问题报告":
                self._处理问题报告(消息)
            elif 消息["type"] == "审查打回":
                self._处理打回(消息)

    def _处理问题报告(self, 消息):
        if self._暂停:
            return
        文件 = 消息["文件"]
        代码 = 消息["代码"]
        问题列表 = 消息["问题列表"]
        self._日志记录("开发者", f"收到{len(问题列表)}个问题")

        if self._文件被禁止(文件):
            self._日志记录("开发者", f"{文件} 禁止修改")
            return

        问题文本 = json.dumps(问题列表, ensure_ascii=False, indent=2)
        目标提示 = f"\n进化目标: {self._目标}\n" if self._目标 else ""
        导师建议 = 消息.get("导师建议", "")
        导师提示 = f"\n导师建议: {导师建议}\n" if 导师建议 else ""
        回复 = self._调用LLM(self.开发者提示词,
            f"文件: {文件}\n{目标提示}{导师提示}\n当前代码:\n{self._截断代码(代码)}\n\n问题列表:\n{问题文本}")

        修改结果 = self._提取JSON(回复)
        if not 修改结果 or not 修改结果.get("修改列表"):
            self._增加连续失败()
            失败原因 = "LLM未返回有效方案"
            self._错误历史.append({"文件": 文件, "原因": 失败原因, "代码": 代码[:2000]})
            self._日志记录("开发者", f"{失败原因}，连续失败{self._读取连续失败()}")
            self._尝试升级介入(消息, 文件, 代码, 问题列表)
            return

        修改列表 = 修改结果["修改列表"][:self.单次最大修改]
        修改详情, 备份代码, 已提交 = self._执行修改_查找替换(修改列表, 文件, 代码)

        if 修改详情:
            self._修复数 += len(修改详情)
            self._审查员队列.put({
                "type": "修复提交",
                "轮次": 消息.get("轮次", 0), "文件": 文件,
                "问题列表": 问题列表, "修改详情": 修改详情,
                "备份代码": 备份代码, "已提交": 已提交,
                "时间": datetime.now().strftime("%H:%M:%S")
            })
            self._日志记录("开发者", f"修复完成({len(修改详情)}处)，提交审查")
        else:
            self._增加连续失败()
            失败原因 = "修复未通过自检(语法错误)"
            self._错误历史.append({"文件": 文件, "原因": 失败原因, "代码": 代码[:2000]})
            self._日志记录("开发者", f"{失败原因}，连续失败{self._读取连续失败()}")
            self._尝试升级介入(消息, 文件, 代码, 问题列表)

    def _尝试升级介入(self, 消息, 文件, 代码, 问题列表):
        """AI动态决策：每次失败后让AI判断该升级还是继续尝试"""
        失败次数 = self._读取连续失败()

        # 每次失败后都让AI决策下一步
        决策 = self._动态决策升级(文件, 失败次数)

        动作 = 决策.get("动作", "继续")
        原因 = 决策.get("原因", "")

        if 动作 == "导师介入" and not self._导师已介入:
            self._导师已介入 = True
            self._介入级别 = 1
            self._日志记录("导师", f"介入(第{失败次数}次失败)：{原因[:80]}")
            导师建议 = 决策.get("新思路", "")
            if 导师建议:
                self._日志记录("导师", f"建议: {导师建议[:100]}")
                消息["导师建议"] = 导师建议
                self._开发者队列.put(消息)
            return

        if 动作 == "排错员接管" and not self._排错员已介入:
            self._排错员已介入 = True
            self._介入级别 = 2
            self._日志记录("排错员", f"接管(第{失败次数}次失败)：{原因[:80]}")
            排错方案 = self._排错员修复(文件, 代码, 问题列表)
            if 排错方案 and 排错方案.get("修改列表"):
                修改列表 = 排错方案["修改列表"][:self.单次最大修改]
                修改详情, 备份代码, 已提交 = self._执行修改_查找替换(修改列表, 文件, 代码)
                if 修改详情:
                    self._修复数 += len(修改详情)
                    self._审查员队列.put({
                        "type": "修复提交",
                        "轮次": 消息.get("轮次", 0), "文件": 文件,
                        "问题列表": 问题列表, "修改详情": 修改详情,
                        "备份代码": 备份代码, "已提交": 已提交,
                        "时间": datetime.now().strftime("%H:%M:%S")
                    })
                    self._日志记录("排错员", "修复成功，提交审查")
                    return
            self._日志记录("排错员", "修复失败，放弃此文件，重置计数")
            self._导师已介入 = False
            self._排错员已介入 = False
            self._介入级别 = 0
            self._重置连续失败()
            return

        if 动作 == "放弃":
            self._日志记录("系统", f"AI决策放弃此文件(第{失败次数}次失败)：{原因[:80]}")
            self._跳过文件.add(文件)
            self._日志记录("系统", f"已加入跳过列表，本轮不再分析 {文件}")
            self._导师已介入 = False
            self._排错员已介入 = False
            self._介入级别 = 0
            self._重置连续失败()
            return

        # 动作="继续" — 让开发者再试一次
        self._日志记录("开发者", f"继续尝试(第{失败次数}次失败)：{原因[:80]}")

    def _动态决策升级(self, 文件, 失败次数):
        """让AI根据失败历史动态决策下一步动作"""
        错误摘要 = "\n".join([f"- 第{i+1}次: {e['原因']}" for i, e in enumerate(self._错误历史[-8:])])
        提示 = (
            f"进化引擎在修复文件 [{文件}] 时已连续失败{失败次数}次。\n\n"
            f"失败历史:\n{错误摘要}\n\n"
            f"请决策下一步动作。可选：\n"
            f'- "继续" — 开发者再试一次（问题不复杂，只是运气不好）\n'
            f'- "导师介入" — 需要换思路重新分析（之前的方法方向错了）\n'
            f'- "排错员接管" — 直接给出修复方案（开发者搞不定，需要高手出马）\n'
            f'- "放弃" — 跳过此文件（问题无法修复或不值得修）\n\n'
            f'输出JSON: {{"动作": "继续/导师介入/排错员接管/放弃", "原因": "...", "新思路": "如果是导师介入，给出新思路"}}'
        )
        回复 = self._调用LLM(
            "你是进化引擎调度器。根据失败历史动态决策下一步动作。只输出JSON。",
            提示
        )
        结果 = self._提取JSON(回复)
        if 结果 and 结果.get("动作") in ("继续", "导师介入", "排错员接管", "放弃"):
            return 结果
        # AI决策失败时的兜底逻辑
        if 失败次数 >= 3 and not self._导师已介入:
            return {"动作": "导师介入", "原因": "AI决策失败，默认3次后导师介入"}
        if 失败次数 >= 6 and not self._排错员已介入:
            return {"动作": "排错员接管", "原因": "AI决策失败，默认6次后排错员接管"}
        if 失败次数 >= 8:
            return {"动作": "放弃", "原因": "失败次数过多，放弃此文件"}
        return {"动作": "继续", "原因": "继续尝试"}

    def _排错员修复(self, 文件, 代码, 问题列表):
        """排错员：直接给出修复方案，收拾战场"""
        错误摘要 = "\n".join([f"- {e['原因']}" for e in self._错误历史[-5:]])
        提示 = (
            f"开发者连续修复失败{self._读取连续失败()}次，导师也已介入但未解决。"
            f"你是最后的排错员，请直接给出修复方案。\n\n"
            f"文件: {文件}\n"
            f"问题列表: {json.dumps(问题列表, ensure_ascii=False)[:1000]}\n"
            f"失败历史:\n{错误摘要}\n\n"
            f"代码:\n{self._截断代码(代码)}\n\n"
            f"用查找-替换方式修复：\n"
            f'{{"修改列表": [{{"文件": "{文件}", "查找": "原始代码片段", "替换为": "新代码片段", "修改说明": "..."}}]}}\n'
            f"只输出JSON。如果无法修复，返回空修改列表。"
        )
        回复 = self._调用LLM(
            "你是排错员。开发者修复代码连续失败，你需要直接给出修复方案。用查找替换方式，只输出JSON。",
            提示
        )
        return self._提取JSON(回复)

    def _处理打回(self, 消息):
        if self._暂停:
            return
        self._日志记录("开发者", f"审查打回: {消息.get('审查意见', '')}")
        文件 = 消息.get("文件", "")
        问题列表 = 消息.get("问题列表", [])
        审查意见 = 消息.get("审查意见", "")

        # 根据上次修改是否成功commit选择撤销方式
        # 已提交: git reset --hard HEAD~1 撤销整个commit（恢复原始代码）
        # 未提交: git reset --hard HEAD + git clean -fd 撤销工作区改动
        已提交 = 消息.get("已提交", False)
        git成功 = False
        if 已提交:
            git成功 = self._git撤销上次提交()
        else:
            self._git回滚未提交()
            git成功 = True
        完整路径 = self._转绝对路径(文件)
        原始代码 = ""
        if git成功:
            原始代码 = self._读取文件(完整路径)
        if not 原始代码:
            # git撤销失败时的兜底：从进化记录恢复
            原始代码 = self._从记录恢复原始代码(文件)
        if not 原始代码:
            原始代码 = self._读取文件(self.主引擎目录.parent / 文件)
            if 原始代码:
                self._日志记录("开发者", f"从主引擎恢复原始代码: {文件}")

        回复 = self._调用LLM(self.开发者提示词,
            f"文件: {文件}\n当前代码（原始未修改版本）:\n{self._截断代码(原始代码)}\n\n问题列表:\n{json.dumps(问题列表, ensure_ascii=False)}\n\n"
            f"审查员打回意见: {审查意见}\n请基于原始代码重新修复，不要基于之前的失败版本。")

        修改结果 = self._提取JSON(回复)
        if 修改结果 and 修改结果.get("修改列表"):
            修改列表 = 修改结果["修改列表"][:self.单次最大修改]
            修改详情, 备份代码, 已提交 = self._执行修改(修改列表, 文件)
            if 修改详情:
                self._审查员队列.put({
                    "type": "修复提交",
                    "轮次": 消息.get("轮次", 0), "文件": 文件,
                    "问题列表": 问题列表, "修改详情": 修改详情,
                    "备份代码": 备份代码, "已提交": 已提交,
                    "重试": True, "时间": datetime.now().strftime("%H:%M:%S")
                })
                self._日志记录("开发者", "重新修复完成")
            else:
                self._增加连续失败()
        else:
            self._增加连续失败()
            self._日志记录("开发者", "重新修复失败")

    def _执行修改_查找替换(self, 修改列表, 默认文件, 原始代码):
        """用查找-替换片段方式修改代码（不需要输出完整文件）"""
        修改详情 = []
        备份代码 = {}
        当前代码 = 原始代码

        for 修改 in 修改列表:
            修改文件 = 修改.get("文件", 默认文件)
            查找片段 = 修改.get("查找", "")
            替换为 = 修改.get("替换为", "")
            说明 = 修改.get("修改说明", "")

            if not 查找片段 or not 替换为:
                continue
            if self._文件被禁止(修改文件):
                continue

            # 在当前代码中查找片段
            if 查找片段 not in 当前代码:
                self._日志记录("开发者", f"查找片段未命中: {修改文件}")
                continue

            # 执行替换
            新代码 = 当前代码.replace(查找片段, 替换为, 1)

            # 写入文件并验证
            完整路径 = self.工作引擎目录.parent / 修改文件
            try:
                完整路径.parent.mkdir(parents=True, exist_ok=True)
                if 完整路径.exists():
                    备份代码[修改文件] = 完整路径.read_text(encoding="utf-8")
                # 写临时文件验证语法
                临时路径 = 完整路径.with_suffix(".tmp")
                临时路径.write_text(新代码, encoding="utf-8")
                if 修改文件.endswith(".py"):
                    py_compile.compile(str(临时路径), doraise=True)
                elif 修改文件.endswith(".json"):
                    json.loads(新代码)
                # 验证通过，替换正式文件
                if 完整路径.exists():
                    完整路径.unlink()
                临时路径.rename(完整路径)
                当前代码 = 新代码
                修改详情.append({"文件": 修改文件, "说明": 说明, "代码": 新代码[:5000]})
                self._日志记录("开发者", f"已替换 {修改文件}: {说明}")
            except py_compile.PyCompileError as e:
                self._日志记录("开发者", f"Python语法错误 {修改文件}: {e}")
                临时路径.unlink(missing_ok=True)
                self._git回滚未提交()
                return [], {}, False
            except json.JSONDecodeError as e:
                self._日志记录("开发者", f"JSON格式错误 {修改文件}: {e}")
                临时路径.unlink(missing_ok=True)
                self._git回滚未提交()
                return [], {}, False
            except Exception as e:
                self._日志记录("开发者", f"替换失败 {修改文件}: {e}")
                临时路径.unlink(missing_ok=True)
                return [], {}, False

        if 修改详情:
            # git提交
            已提交 = self._git提交(f"进化: {默认文件}")
            return 修改详情, 备份代码, 已提交
        return [], {}, False

    def _执行修改(self, 修改列表, 默认文件):
        """执行修改 + 语法检查，返回(修改详情, 备份代码, 已提交)
        
        改动前不操作git；py_compile失败时用 git reset 撤销；
        全部成功后用 git commit 提交，返回是否成功创建了commit。
        """
        修改详情 = []
        备份代码 = {}
        for 修改 in 修改列表:
            修改文件 = 修改.get("文件", 默认文件)
            新代码 = 修改.get("完整代码", "")
            说明 = 修改.get("修改说明", "")
            if self._文件被禁止(修改文件):
                continue
            if not 新代码.strip():
                self._日志记录("开发者", f"跳过空代码: {修改文件}")
                continue
            完整路径 = self.工作引擎目录.parent / 修改文件
            try:
                完整路径.parent.mkdir(parents=True, exist_ok=True)
                # 备份原始代码（改之前保存，供进化记录使用）
                if 完整路径.exists():
                    原始内容 = 完整路径.read_text(encoding="utf-8")
                    备份代码[修改文件] = 原始内容
                # 写临时文件
                临时路径 = 完整路径.with_suffix(".tmp")
                临时路径.write_text(新代码, encoding="utf-8")
                # 语法检查
                if 修改文件.endswith(".py"):
                    py_compile.compile(str(临时路径), doraise=True)
                elif 修改文件.endswith(".json"):
                    json.loads(新代码)  # JSON格式校验
                # Windows下rename目标存在会报错，先删原文件
                if 完整路径.exists():
                    完整路径.unlink()
                临时路径.rename(完整路径)
                修改详情.append({"文件": 修改文件, "说明": 说明, "代码": self._截断代码(新代码, 5000)})
                self._日志记录("开发者", f"已修改 {修改文件}: {说明}")
            except py_compile.PyCompileError as e:
                self._日志记录("开发者", f"Python语法错误 {修改文件}: {e}")
                临时文件 = Path(临时路径)
                if 临时文件.exists():
                    临时文件.unlink(missing_ok=True)
                # git撤销所有未提交的改动
                self._git回滚未提交()
                self._日志记录("开发者", f"git已回滚 {修改文件}")
                return [], {}, False
            except json.JSONDecodeError as e:
                self._日志记录("开发者", f"JSON格式错误 {修改文件}: {e}")
                临时文件 = Path(临时路径)
                if 临时文件.exists():
                    临时文件.unlink(missing_ok=True)
                self._git回滚未提交()
                return [], {}, False
            except Exception as e:
                self._日志记录("开发者", f"修改失败 {修改文件}: {e}")
                临时文件 = Path(临时路径)
                if 临时文件.exists():
                    临时文件.unlink(missing_ok=True)
                self._git回滚未提交()
                return [], {}, False
        # 全部成功，提交到git
        已提交 = False
        if 修改详情:
            轮次 = self._轮次
            文件摘要 = 修改详情[0]["文件"] if len(修改详情) == 1 else f"{len(修改详情)}个文件"
            已提交 = self._git提交(f"[进化] 轮次{轮次} {文件摘要} {修改详情[0].get('说明', '')[:50]}")
        return 修改详情, 备份代码, 已提交

    # ============ 审查员 ============

    def _审查员循环(self):
        while self._运行:
            if self._暂停:
                time.sleep(2)
                continue
            try:
                消息 = self._审查员队列.get(timeout=5)
                if 消息 is None:
                    continue
            except queue.Empty:
                continue
            if 消息["type"] == "修复提交":
                self._审查修改(消息)

    def _审查修改(self, 消息):
        文件 = 消息["文件"]
        问题列表 = 消息["问题列表"]
        修改详情 = 消息["修改详情"]
        self._日志记录("审查员", f"审查 {文件}（{len(修改详情)}处）")

        完整路径 = self.工作引擎目录.parent / 文件
        新代码 = self._读取文件(完整路径)
        if not 新代码:
            self._失败数 += 1
            self._增加连续失败()
            return

        if 文件.endswith(".py"):
            临时 = 完整路径.with_suffix(".review.tmp")
            try:
                临时.write_text(新代码, encoding="utf-8")
                py_compile.compile(str(临时), doraise=True)
            except Exception as e:
                self._日志记录("审查员", f"语法失败: {e}")
                self._失败数 += 1
                self._增加连续失败()
                return
            finally:
                临时.unlink(missing_ok=True)

        回复 = self._调用LLM(self.审查员提示词,
            f"文件: {文件}\n修改后代码:\n{self._截断代码(新代码, 6000)}\n\n"
            f"原始问题:\n{json.dumps(问题列表, ensure_ascii=False)}\n\n"
            f"修改说明:\n{json.dumps(修改详情, ensure_ascii=False)}")

        审查结果 = self._提取JSON(回复)
        if 审查结果 and 审查结果.get("通过"):
            self._通过数 += 1
            self._重置连续失败()
            with self._状态锁:
                self._文件打回次数.pop(文件, None)
            时间戳 = datetime.now().strftime("%Y%m%d_%H%M%S")
            记录 = {
                "文件": 文件, "修改详情": 修改详情,
                "审查意见": 审查结果.get("审查意见", ""),
                "风险": 审查结果.get("风险等级", "低"),
                "轮次": 消息.get("轮次", 0),
                "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "备份代码": 消息.get("备份代码", {})
            }
            self._添加待合并(记录)
            self._保存进化记录(记录, 时间戳)
            self._git打标签(f"进化_{时间戳}_{记录['文件'].replace('/', '_').replace('.', '_')}")
            self._日志记录("审查员", f"✅ 通过: {审查结果.get('审查意见', '')}")
        else:
            self._失败数 += 1
            self._增加连续失败()
            意见 = 审查结果.get("审查意见", "未通过") if 审查结果 else "LLM返回无效"
            # 记录同一文件的打回次数
            with self._状态锁:
                打回次数 = self._文件打回次数.get(文件, 0) + 1
                self._文件打回次数[文件] = 打回次数
            if 打回次数 >= self._最大打回次数:
                self._日志记录("审查员", f"❌ {文件} 打回{打回次数}次，放弃此文件")
                with self._状态锁:
                    self._文件打回次数.pop(文件, None)
                return
            self._日志记录("审查员", f"❌ 打回({打回次数}/{self._最大打回次数}): {意见}")
            self._开发者队列.put({
                "type": "审查打回",
                "轮次": 消息.get("轮次", 0), "文件": 文件,
                "问题列表": 问题列表, "审查意见": 意见,
                "已提交": 消息.get("已提交", False),
                "时间": datetime.now().strftime("%H:%M:%S")
            })

    def _保存进化记录(self, 记录, 时间戳):
        """保存进化记录到磁盘"""
        记录目录 = self.进化记录目录 / f"{时间戳}_{记录['文件'].replace('/', '_')}"
        记录目录.mkdir(parents=True, exist_ok=True)
        with open(记录目录 / "修改清单.json", "w", encoding="utf-8") as f:
            json.dump(记录, f, ensure_ascii=False, indent=2)
        for 文件名, 代码 in 记录.get("备份代码", {}).items():
            原始路径 = 记录目录 / "原始代码" / 文件名.replace("/", "_")
            原始路径.parent.mkdir(parents=True, exist_ok=True)
            原始路径.write_text(代码, encoding="utf-8")
        新代码 = self._读取文件(self.工作引擎目录.parent / 记录["文件"])
        修改后路径 = 记录目录 / "修改后代码" / 记录["文件"].replace("/", "_")
        修改后路径.parent.mkdir(parents=True, exist_ok=True)
        修改后路径.write_text(新代码, encoding="utf-8")
        # 清理旧记录，防止磁盘无限增长
        self._清理旧进化记录()

    def _清理旧进化记录(self):
        """保留最近100条进化记录，删除更旧的"""
        try:
            if not self.进化记录目录.exists():
                return
            记录列表 = sorted(self.进化记录目录.iterdir())
            if len(记录列表) <= 100:
                return
            for 旧记录 in 记录列表[:-100]:
                shutil.rmtree(str(旧记录), ignore_errors=True)
        except Exception:
            pass

    # ============ 工具方法 ============

    def _同步工作引擎(self):
        """复制主引擎代码到工作引擎目录（已有则先备份再覆盖）"""
        if self.工作引擎目录.exists() and any(self.工作引擎目录.rglob("*.py")):
            # 旧的工作引擎有文件，先备份
            备份目录 = self.工作引擎目录.parent / f"公共区_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            shutil.copytree(str(self.工作引擎目录), str(备份目录),
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".git", "*.log"))
            self._日志记录("系统", f"旧工作引擎已备份到: {备份目录.name}")
            # 只保留最近3个备份
            旧备份 = sorted(self.工作引擎目录.parent.glob("公共区_backup_*"))
            for 旧 in 旧备份[:-3]:
                shutil.rmtree(str(旧))
        # 先拷到临时目录，成功后再替换，避免拷贝中断导致工作引擎丢失
        临时目录 = self.工作引擎目录.parent / "公共区_sync_tmp"
        if 临时目录.exists():
            shutil.rmtree(str(临时目录))
        shutil.copytree(str(self.主引擎目录), str(临时目录),
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".git", "*.log"))
        if self.工作引擎目录.exists():
            shutil.rmtree(str(self.工作引擎目录))
        临时目录.rename(self.工作引擎目录)
        # 初始化git版本管理
        self._初始化工作引擎git()

    def _随机选文件(self):
        候选文件 = []
        for f in self.工作引擎目录.rglob("*"):
            if not f.is_file():
                continue
            if f.suffix not in (".py", ".json"):
                continue
            相对 = self._转相对路径(f)
            if 相对 in self._跳过文件:
                continue
            if not self._文件被禁止(相对) and self._文件在允许范围(相对):
                候选文件.append(f)
        if not 候选文件 and self._跳过文件:
            # 所有文件都被跳过→清空跳过列表重来
            self._跳过文件.clear()
            self._日志记录("系统", "所有文件已分析完，清空跳过列表重新开始")
            return self._随机选文件()
        return random.choice(候选文件) if 候选文件 else None

    def _文件被禁止(self, 相对路径):
        import fnmatch
        for 禁止 in self.禁止修改:
            if fnmatch.fnmatch(相对路径, 禁止):
                return True
        return False

    def _文件在允许范围(self, 相对路径):
        import fnmatch
        for 模式 in self.允许修改范围:
            if fnmatch.fnmatch(相对路径, 模式):
                return True
        return False

    def _读取文件(self, 路径):
        try:
            return Path(路径).read_text(encoding="utf-8")
        except Exception:
            return ""

    def _截断代码(self, 代码, 最大字符=8000):
        """按行截断代码，避免截断在行中间丢失上下文"""
        if len(代码) <= 最大字符:
            return 代码
        行列表 = 代码.split('\n')
        结果 = []
        总长 = 0
        for 行 in 行列表:
            if 总长 + len(行) + 1 > 最大字符:
                结果.append(f"... [已截断，共{len(行列表)}行，省略{len(行列表) - len(结果)}行] ...")
                break
            结果.append(行)
            总长 += len(行) + 1
        return '\n'.join(结果)

    # ============ Git 版本管理 ============

    def _git可用(self):
        """检测系统是否安装git"""
        try:
            subprocess.run(["git", "--version"], capture_output=True, timeout=5)
            return True
        except Exception:
            return False

    def _初始化工作引擎git(self):
        """在工作引擎目录初始化git仓库（仅首次同步后调用）"""
        工作目录 = str(self.工作引擎目录)
        try:
            subprocess.run(["git", "init"], cwd=工作目录, capture_output=True, timeout=10)
            subprocess.run(["git", "config", "user.name", "进化引擎"], cwd=工作目录, capture_output=True, timeout=5)
            subprocess.run(["git", "config", "user.email", "evolution@local"], cwd=工作目录, capture_output=True, timeout=5)
            # 写 .gitignore
            gitignore = self.工作引擎目录 / ".gitignore"
            gitignore.write_text(
                "__pycache__/\n*.pyc\n*.log\n*.bak\n*.tmp\n*.review.tmp\n",
                encoding="utf-8"
            )
            # 首次提交
            subprocess.run(["git", "add", "-A"], cwd=工作目录, capture_output=True, timeout=10)
            subprocess.run(
                ["git", "commit", "-m", "[进化] 同步主引擎代码（初始版本）"],
                cwd=工作目录, capture_output=True, timeout=10
            )
            self._日志记录("系统", "工作引擎git仓库已初始化")
        except Exception as e:
            self._日志记录("系统", f"git初始化失败: {e}")

    def _git提交(self, 说明):
        """提交工作引擎当前改动，返回是否成功创建了新commit"""
        工作目录 = str(self.工作引擎目录)
        try:
            subprocess.run(["git", "add", "-A"], cwd=工作目录, capture_output=True, timeout=10)
            结果 = subprocess.run(
                ["git", "commit", "-m", 说明],
                cwd=工作目录, capture_output=True, timeout=10
            )
            if 结果.returncode == 0:
                return True
            # nothing to commit 不算错误，但也没创建commit
            输出 = 结果.stderr.decode("utf-8", errors="replace")
            if "nothing to commit" in 输出:
                return False
            self._日志记录("系统", f"git提交异常: {输出[:100]}")
            return False
        except Exception as e:
            self._日志记录("系统", f"git提交失败: {e}")
            return False

    def _git回滚未提交(self):
        """撤销所有未提交的改动（py_compile失败时调用）
        
        git reset --hard HEAD 恢复暂存区和工作区到上次commit
        git clean -fd 删除未跟踪的文件和目录（如LLM新建的文件）
        """
        工作目录 = str(self.工作引擎目录)
        try:
            subprocess.run(
                ["git", "reset", "--hard", "HEAD"],
                cwd=工作目录, capture_output=True, timeout=10
            )
            subprocess.run(
                ["git", "clean", "-fd"],
                cwd=工作目录, capture_output=True, timeout=10
            )
            self._日志记录("系统", "git已撤销未提交的改动（含未跟踪文件）")
        except Exception as e:
            self._日志记录("系统", f"git撤销失败: {e}")

    def _git撤销上次提交(self):
        """撤销最近一次commit（审查打回时调用）
        
        git reset --hard HEAD~1 彻底回退到上次提交之前的状态。
        无论打回多少次，每次都回退到「原始代码」的commit，
        而不是上一个失败的修复版本。
        """
        工作目录 = str(self.工作引擎目录)
        try:
            结果 = subprocess.run(
                ["git", "reset", "--hard", "HEAD~1"],
                cwd=工作目录, capture_output=True, timeout=10
            )
            if 结果.returncode != 0:
                输出 = 结果.stderr.decode("utf-8", errors="replace")
                self._日志记录("系统", f"git撤销上次提交失败: {输出[:100]}")
                return False
            self._日志记录("系统", "git已撤销上次提交（回退到原始代码）")
            return True
        except Exception as e:
            self._日志记录("系统", f"git撤销上次提交异常: {e}")
            return False

    def _git打标签(self, 标签名):
        """在当前commit打标签（审查通过或合并时调用）"""
        工作目录 = str(self.工作引擎目录)
        try:
            subprocess.run(
                ["git", "tag", 标签名],
                cwd=工作目录, capture_output=True, timeout=5
            )
        except Exception:
            pass

    def _git清理锁(self):
        """删除可能残留的 git index.lock（启动时调用）"""
        锁文件 = self.工作引擎目录 / ".git" / "index.lock"
        if 锁文件.exists():
            try:
                锁文件.unlink()
                self._日志记录("系统", "已清理残留的git锁文件")
            except Exception:
                pass

    def _转相对路径(self, 绝对路径):
        try:
            return str(Path(绝对路径).relative_to(self.工作引擎目录.parent)).replace("\\", "/")
        except Exception:
            return str(绝对路径)

    def _转绝对路径(self, 相对路径):
        return self.工作引擎目录.parent / 相对路径

    def _从记录恢复原始代码(self, 文件):
        """从进化记录目录恢复原始代码"""
        try:
            for 记录目录 in sorted(self.进化记录目录.iterdir(), reverse=True):
                if 文件.replace("/", "_") in 记录目录.name:
                    原始目录 = 记录目录 / "原始代码"
                    if 原始目录.exists():
                        for f in 原始目录.iterdir():
                            return f.read_text(encoding="utf-8")
        except Exception:
            pass
        return ""

    def _调用LLM(self, 系统提示词, 用户内容):
        结果 = self.模型直连器.发送消息(
            消息列表=[{"role": "user", "content": 用户内容}],
            系统提示词=系统提示词
        )
        if 结果.get("成功"):
            return 结果.get("回复内容", "")
        self._日志记录("系统", f"LLM调用失败: {结果.get('错误', '')[:80]}")
        return ""

    def _提取JSON(self, 文本):
        if not 文本:
            return None
        try:
            return json.loads(文本)
        except Exception:
            pass
        匹配 = re.search(r'\{[\s\S]*\}', 文本)
        if 匹配:
            try:
                return json.loads(匹配.group())
            except Exception:
                pass
        return None

    def _日志记录(self, 发送者, 内容):
        条目 = {
            "时间": datetime.now().strftime("%H:%M:%S"),
            "发送者": 发送者,
            "内容": 内容[:200]
        }
        with self._日志锁:
            self._日志.append(条目)
            if len(self._日志) > 100:
                self._日志 = self._日志[-100:]
        print(f"  🧬 [{条目['时间']}] {发送者}: {内容[:120]}")
