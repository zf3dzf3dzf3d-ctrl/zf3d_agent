"""
高级操作模块 - 子代理/并行执行/Pipeline/Barrier/LoopUntilDry/后台执行
"""
import json
import time
import re as re_mod
import threading
import concurrent.futures
from pathlib import Path
from .基类 import 操作结果, 操作基类


# ============ 后台任务系统 ============

class _后台任务管理器:
    """后台任务管理（内存级）"""
    _实例 = None

    def __new__(cls):
        if cls._实例 is None:
            cls._实例 = super().__new__(cls)
            cls._实例._tasks = {}
            cls._实例._next_id = 1
        return cls._实例

    def 提交(self, func, args=()):
        task_id = f"bg_{self._next_id}"
        self._next_id += 1
        self._tasks[task_id] = {"status": "running", "result": None, "error": None}

        def wrapper():
            try:
                result = func(*args)
                self._tasks[task_id]["status"] = "completed"
                self._tasks[task_id]["result"] = result
            except Exception as e:
                self._tasks[task_id]["status"] = "failed"
                self._tasks[task_id]["error"] = str(e)

        t = threading.Thread(target=wrapper, daemon=True)
        t.start()
        return task_id

    def 获取(self, task_id):
        return self._tasks.get(task_id)


class 后台执行(操作基类):
    名称 = "后台执行"
    描述 = "在后台线程中执行一个操作，立即返回task_id，不阻塞当前流程。适合长时间运行的操作(测试/构建/搜索)"
    参数结构 = {
        "操作名": {"类型": "字符串", "必填": True, "说明": "要后台执行的操作名称"},
        "参数": {"类型": "字符串", "必填": False, "说明": "操作参数(JSON对象)"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        操作名 = 参数.get("操作名", "")
        操作参数字符串 = 参数.get("参数", "{}")
        try:
            操作参数 = json.loads(操作参数字符串) if isinstance(操作参数字符串, str) else 操作参数字符串
        except:
            操作参数 = {}

        from 操作注册中心 import 操作注册中心类
        注册中心 = 操作注册中心类._实例引用
        if not 注册中心:
            return 操作结果.失败("操作注册中心未就绪")

        管理器 = _后台任务管理器()

        def _执行操作():
            结果 = 注册中心.执行(操作名, 操作参数)
            return 结果.get("数据", "") if 结果.get("成功") else f"失败: {结果.get('错误', '')}"

        task_id = 管理器.提交(_执行操作)
        return 操作结果.成功(
            f"后台任务已提交: {task_id}\n操作: {操作名}\n参数: {json.dumps(操作参数, ensure_ascii=False)[:200]}\n"
            f"使用「获取后台结果」操作(task_id={task_id})查询结果。"
        )


class 获取后台结果(操作基类):
    名称 = "获取后台结果"
    描述 = "查询后台任务的执行状态和结果"
    参数结构 = {
        "task_id": {"类型": "字符串", "必填": True, "说明": "后台任务ID"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        管理器 = _后台任务管理器()
        task_id = 参数.get("task_id", "")
        task = 管理器.获取(task_id)
        if not task:
            return 操作结果.失败(f"任务 {task_id} 不存在")
        状态 = task["status"]
        if 状态 == "running":
            return 操作结果.成功(f"⏳ 任务 {task_id} 仍在运行中...")
        elif 状态 == "completed":
            return 操作结果.成功(f"✅ 任务 {task_id} 已完成:\n{task.get('result', '')}")
        else:
            return 操作结果.失败(f"❌ 任务 {task_id} 失败:\n{task.get('error', '未知错误')}")


# ============ 子代理系统 ============

class 子代理(操作基类):
    名称 = "子代理"
    描述 = "启动一个子代理执行独立任务。explore=只读搜索(搜索代码/Glob/读取文件/符号搜索)，general=通用(所有操作)，plan=只规划不执行"
    参数结构 = {
        "任务描述": {"类型": "字符串", "必填": True, "说明": "子代理要完成的任务"},
        "类型": {"类型": "字符串", "必填": False, "说明": "explore=只读搜索 / general=通用 / plan=只规划，默认general"},
        "超时秒数": {"类型": "整数", "必填": False, "说明": "子代理超时时间，默认120秒"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        任务描述 = 参数.get("任务描述", "")
        类型 = 参数.get("类型", "general")
        超时 = 参数.get("超时秒数", 120)
        if not 任务描述:
            return 操作结果.失败("任务描述为空")

        if not self.模型直连器:
            return 操作结果.失败("模型直连器未注入，无法启动子代理")

        from 操作注册中心 import 操作注册中心类
        注册中心 = 操作注册中心类._实例引用
        if not 注册中心:
            return 操作结果.失败("操作注册中心未就绪")

        explore只读操作 = {"搜索代码", "Glob搜索", "读取文件", "列出目录", "符号搜索", "获取时间", "系统信息"}

        类型提示 = {
            "explore": "你是一个只读探索子代理。只能使用搜索代码、Glob搜索、读取文件、列出目录、符号搜索等只读操作。不要修改任何文件。完成任务后给出总结。",
            "general": "你是一个通用子代理。可以使用所有可用操作来完成任务。完成任务后给出总结。",
            "plan": "你是一个规划子代理。分析任务，生成一个结构化的执行计划，不执行任何操作。输出JSON格式的计划。"
        }

        系统提示 = 类型提示.get(类型, 类型提示["general"])
        if 类型 != "plan":
            操作说明 = 注册中心.获取操作说明()
            if 类型 == "explore":
                过滤说明 = []
                for 行 in 操作说明.split("\n\n"):
                    for 名 in explore只读操作:
                        if f"### {名}" in 行:
                            过滤说明.append(行)
                            break
                操作说明 = "\n\n".join(过滤说明)
            系统提示 += f"\n\n## 可用操作\n{操作说明}"
            系统提示 += "\n\n## 回复格式\n使用JSON格式调用操作:\n```json\n{\"思考\": \"分析\", \"操作\": \"操作名称\", \"参数\": {}}\n```\n任务完成后直接输出文字总结。"
        else:
            系统提示 += '\n\n输出格式:\n```json\n{"计划": [{"步骤": 1, "说明": "做什么", "预计操作": "操作名"}], "预计步数": N}\n```'

        def _运行子代理():
            return self._子代理ReAct循环(任务描述, 系统提示, 注册中心, 类型, explore只读操作)

        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(_运行子代理)
                结果 = future.result(timeout=超时)
            return 操作结果.成功(f"🤖 子代理({类型})结果:\n{结果}")
        except concurrent.futures.TimeoutError:
            return 操作结果.失败(f"子代理超时({超时}秒)")
        except Exception as e:
            return 操作结果.失败(f"子代理执行异常: {e}")

    def _子代理ReAct循环(self, 任务描述, 系统提示, 注册中心, 类型, 允许操作集):
        """子代理的mini ReAct循环"""
        消息历史 = [{"role": "user", "content": 任务描述}]
        最大步数 = 15
        最终回复 = ""

        for 步数 in range(1, 最大步数 + 1):
            结果 = self.模型直连器.发送消息(消息历史, 系统提示)
            if not 结果.get("成功"):
                return f"子代理LLM调用失败(步骤{步数}): {结果.get('错误', '')}"

            回复 = 结果.get("回复内容", "")
            工具调用 = 结果.get("工具调用", [])

            if 工具调用:
                for 调用 in 工具调用:
                    英文名 = 调用.get("名称", "")
                    英文参数 = 调用.get("参数", {})
                    操作名, 操作参数 = 注册中心.解析工具调用(英文名, 英文参数)

                    if 类型 == "explore" and 操作名 not in 允许操作集:
                        观察 = f"❌ explore模式禁止使用「{操作名}」，只允许只读操作"
                        消息历史.append({"role": "assistant", "content": f"尝试调用{操作名}"})
                        消息历史.append({"role": "user", "content": f"观察: {观察}"})
                        continue

                    执行结果 = 注册中心.执行(操作名, 操作参数)
                    观察 = 执行结果.get("数据", "") if 执行结果.get("成功") else f"失败: {执行结果.get('错误', '')}"
                    消息历史.append({"role": "assistant", "content": f"调用{操作名}"})
                    消息历史.append({"role": "user", "content": f"观察: {观察[:2000]}"})
                continue

            json块 = None
            匹配 = re_mod.search(r'```(?:json)?\s*\n?(.*?)\n?\s*```', 回复, re_mod.DOTALL)
            if 匹配:
                json块 = 匹配.group(1).strip()
            else:
                start = 回复.find('{')
                if start != -1:
                    end = 回复.rfind('}')
                    if end > start:
                        json块 = 回复[start:end + 1]

            if json块:
                try:
                    数据 = json.loads(json块)
                    if isinstance(数据, dict) and "操作" in 数据:
                        操作名 = 数据["操作"]
                        操作参数 = 数据.get("参数", {})

                        if 类型 == "explore" and 操作名 not in 允许操作集:
                            观察 = f"❌ explore模式禁止使用「{操作名}」"
                            消息历史.append({"role": "assistant", "content": 回复})
                            消息历史.append({"role": "user", "content": f"观察: {观察}"})
                            continue

                        执行结果 = 注册中心.执行(操作名, 操作参数)
                        观察 = 执行结果.get("数据", "") if 执行结果.get("成功") else f"失败: {执行结果.get('错误', '')}"
                        消息历史.append({"role": "assistant", "content": 回复})
                        消息历史.append({"role": "user", "content": f"观察: {观察[:2000]}"})
                        continue
                except (json.JSONDecodeError, TypeError):
                    pass

            最终回复 = 回复
            break
        else:
            最终回复 = f"子代理达到最大步数({最大步数})。最后回复: {回复[:500]}"

        return 最终回复


class 并行执行(操作基类):
    名称 = "并行执行"
    描述 = "同时启动多个子代理执行独立任务，等待全部完成后返回所有结果"
    参数结构 = {
        "任务列表": {"类型": "字符串", "必填": True, "说明": "JSON数组，每项含任务描述和类型，如: [{\"任务描述\":\"搜索A\",\"类型\":\"explore\"}]"},
        "最大并发数": {"类型": "整数", "必填": False, "说明": "最大并发子代理数，默认3"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        任务列表字符串 = 参数.get("任务列表", "")
        最大并发 = 参数.get("最大并发数", 3)
        try:
            任务列表 = json.loads(任务列表字符串) if isinstance(任务列表字符串, str) else 任务列表字符串
        except:
            return 操作结果.失败("任务列表JSON解析失败")
        if not isinstance(任务列表, list) or not 任务列表:
            return 操作结果.失败("任务列表必须是非空数组")

        if not self.模型直连器:
            return 操作结果.失败("模型直连器未注入，无法启动子代理")

        from 操作注册中心 import 操作注册中心类
        注册中心 = 操作注册中心类._实例引用
        if not 注册中心:
            return 操作结果.失败("操作注册中心未就绪")

        explore只读操作 = {"搜索代码", "Glob搜索", "读取文件", "列出目录", "符号搜索", "获取时间", "系统信息"}
        类型提示 = {
            "explore": "你是一个只读探索子代理。只能使用只读操作。",
            "general": "你是一个通用子代理。可以使用所有可用操作。",
            "plan": "你是一个规划子代理。分析任务，生成执行计划，不执行操作。"
        }

        def _运行单个(任务项):
            任务描述 = 任务项.get("任务描述", "")
            类型 = 任务项.get("类型", "general")
            超时 = 任务项.get("超时秒数", 120)
            系统提示 = 类型提示.get(类型, 类型提示["general"])
            if 类型 != "plan":
                操作说明 = 注册中心.获取操作说明()
                系统提示 += f"\n\n## 可用操作\n{操作说明}"
                系统提示 += "\n\n## 回复格式\n使用JSON格式调用操作:\n```json\n{\"思考\": \"分析\", \"操作\": \"操作名称\", \"参数\": {}}\n```\n任务完成后直接输出文字总结。"

            子代理实例 = 子代理()
            子代理实例.模型直连器 = self.模型直连器
            子代理实例.文件管理器 = self.文件管理器
            try:
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                    future = ex.submit(子代理实例._子代理ReAct循环, 任务描述, 系统提示, 注册中心, 类型, explore只读操作)
                    return future.result(timeout=超时)
            except concurrent.futures.TimeoutError:
                return f"超时({超时}秒)"
            except Exception as e:
                return f"异常: {e}"

        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=最大并发) as executor:
                futures = {executor.submit(_运行单个, t): i for i, t in enumerate(任务列表)}
                结果列表 = [None] * len(任务列表)
                for future in concurrent.futures.as_completed(futures):
                    idx = futures[future]
                    结果列表[idx] = future.result()

            汇总 = f"并行执行完成 ({len(任务列表)}个任务):\n"
            for i, (任务项, 结果) in enumerate(zip(任务列表, 结果列表)):
                汇总 += f"\n--- 任务{i+1}: {任务项.get('任务描述', '')[:60]} ---\n{结果}\n"
            return 操作结果.成功(汇总)
        except Exception as e:
            return 操作结果.失败(f"并行执行失败: {e}")


# ============ 高级编排模式 ============

class Pipeline(操作基类):
    """流水线编排: 多个任务依次通过多个处理阶段"""
    名称 = "Pipeline"
    描述 = "流水线编排：多个任务依次通过多个处理阶段。适用于分步骤处理多个独立任务"
    参数结构 = {
        "任务列表": {"类型": "字符串", "必填": True, "说明": "JSON数组，每项含任务描述和类型，如: [{\"任务描述\":\"分析A\",\"类型\":\"general\"}]"},
        "阶段列表": {"类型": "字符串", "必填": True, "说明": "JSON数组，每项含阶段名称和专用指令，如: [{\"名称\":\"搜索\",\"指令\":\"只搜文件\"}, {\"名称\":\"分析\",\"指令\":\"分析结果\"}]"},
        "最大并发数": {"类型": "整数", "必填": False, "说明": "每阶段最大并发数，默认3"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        任务列表字符串 = 参数.get("任务列表", "")
        阶段列表字符串 = 参数.get("阶段列表", "")
        最大并发 = 参数.get("最大并发数", 3)
        try:
            任务列表 = json.loads(任务列表字符串) if isinstance(任务列表字符串, str) else 任务列表字符串
            阶段列表 = json.loads(阶段列表字符串) if isinstance(阶段列表字符串, str) else 阶段列表字符串
        except:
            return 操作结果.失败("JSON解析失败")
        if not 任务列表 or not 阶段列表:
            return 操作结果.失败("任务列表和阶段列表不能为空")
        if not self.模型直连器:
            return 操作结果.失败("模型直连器未注入")
        from 操作注册中心 import 操作注册中心类
        注册中心 = 操作注册中心类._实例引用
        if not 注册中心:
            return 操作结果.失败("操作注册中心未就绪")
        import concurrent.futures
        explore只读操作 = {"搜索代码", "Glob搜索", "读取文件", "列出目录", "符号搜索", "获取时间", "系统信息"}
        类型提示 = {"explore": "只能使用只读操作。", "general": "可以使用所有可用操作。", "plan": "不执行操作，只生成计划。"}
        def _运行阶段(任务描述, 阶段, 上一阶段结果=""):
            阶段名 = 阶段.get("名称", "")
            指令 = 阶段.get("指令", "")
            类型 = 阶段.get("类型", "general")
            系统提示 = 类型提示.get(类型, 类型提示["general"])
            系统提示 += f"\n当前阶段: {阶段名}"
            if 指令: 系统提示 += f"\n阶段指令: {指令}"
            if 上一阶段结果: 系统提示 += f"\n上一阶段结果:\n{上一阶段结果}"
            操作说明 = 注册中心.获取操作说明()
            系统提示 += f"\n\n可用操作:\n{操作说明}"
            子代理实例 = 子代理()
            子代理实例.模型直连器 = self.模型直连器
            子代理实例.文件管理器 = self.文件管理器
            return 子代理实例._子代理ReAct循环(任务描述, 系统提示, 注册中心, 类型, explore只读操作)
        try:
            最终结果 = []
            for idx, 任务项 in enumerate(任务列表):
                任务描述 = 任务项.get("任务描述", "")
                上一阶段结果 = ""
                for 阶段 in 阶段列表:
                    上一阶段结果 = _运行阶段(任务描述, 阶段, 上一阶段结果)
                最终结果.append(f"任务{idx+1}: {任务描述[:40]}\n结果: {上一阶段结果[:300]}")
            汇总 = f"Pipeline完成 ({len(任务列表)}个任务, {len(阶段列表)}个阶段):\n" + "\n---\n".join(最终结果)
            return 操作结果.成功(汇总, 元数据={"操作类型":"Pipeline","任务数":len(任务列表),"阶段数":len(阶段列表)})
        except Exception as e:
            return 操作结果.失败(f"Pipeline执行失败: {e}")


class Barrier(操作基类):
    """同步屏障: 等待多个任务全部完成后汇总结果"""
    名称 = "Barrier"
    描述 = "同步屏障：同时启动多个子代理，等待全部完成后汇总所有结果。适用于需要全部结果才能进行下一步的场景"
    参数结构 = {
        "任务列表": {"类型": "字符串", "必填": True, "说明": "JSON数组，每项含任务描述和类型，如: [{\"任务描述\":\"搜索漏洞\",\"类型\":\"explore\"}]"},
        "最大并发数": {"类型": "整数", "必填": False, "说明": "最大并发数，默认5"}
    }
    def 执行(self, 参数: dict) -> 操作结果:
        任务列表字符串 = 参数.get("任务列表", "")
        最大并发 = 参数.get("最大并发数", 5)
        try:
            任务列表 = json.loads(任务列表字符串) if isinstance(任务列表字符串, str) else 任务列表字符串
        except:
            return 操作结果.失败("任务列表JSON解析失败")
        if not self.模型直连器:
            return 操作结果.失败("模型直连器未注入")
        from 操作注册中心 import 操作注册中心类
        注册中心 = 操作注册中心类._实例引用
        if not 注册中心:
            return 操作结果.失败("操作注册中心未就绪")
        import concurrent.futures
        explore只读操作 = {"搜索代码", "Glob搜索", "读取文件", "列出目录", "符号搜索", "获取时间", "系统信息"}
        类型提示 = {"explore":"只能使用只读操作。","general":"可以使用所有可用操作。","plan":"不执行操作，只生成计划。"}
        def _运行单个(任务项):
            任务描述 = 任务项.get("任务描述", "")
            类型 = 任务项.get("类型", "general")
            超时 = 任务项.get("超时秒数", 120)
            系统提示 = 类型提示.get(类型, 类型提示["general"])
            系统提示 += f"\n\n可用操作:\n{注册中心.获取操作说明()}"
            子代理实例 = 子代理()
            子代理实例.模型直连器 = self.模型直连器
            子代理实例.文件管理器 = self.文件管理器
            try:
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                    future = ex.submit(子代理实例._子代理ReAct循环, 任务描述, 系统提示, 注册中心, 类型, explore只读操作)
                    return future.result(timeout=超时)
            except concurrent.futures.TimeoutError:
                return f"[超时] 任务执行超过{超时}秒"
            except Exception as e:
                return f"[异常] {e}"
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=最大并发) as executor:
                futures = {executor.submit(_运行单个, t): i for i, t in enumerate(任务列表)}
                结果列表 = [None] * len(任务列表)
                for future in concurrent.futures.as_completed(futures):
                    idx = futures[future]
                    结果列表[idx] = future.result()
            成功数 = sum(1 for r in 结果列表 if r and not r.startswith("["))
            汇总 = f"Barrier完成: {成功数}/{len(任务列表)} 任务成功\n\n"
            for i, (任务项, 结果) in enumerate(zip(任务列表, 结果列表)):
                状态 = "✅" if 结果 and not 结果.startswith("[") else "❌"
                汇总 += f"{状态} 任务{i+1}: {任务项.get('任务描述','')[:60]}\n{结果[:300]}\n\n"
            return 操作结果.成功(汇总, 元数据={"操作类型":"Barrier","任务数":len(任务列表),"成功数":成功数})
        except Exception as e:
            return 操作结果.失败(f"Barrier执行失败: {e}")


class LoopUntilDry(操作基类):
    """循环直到收敛: 重复执行任务直到连续N轮无新结果"""
    名称 = "LoopUntilDry"
    描述 = "循环直到收敛：重复执行任务直到连续N轮无新结果。适用于反复搜索/迭代优化的场景"
    参数结构 = {
        "目标": {"类型": "字符串", "必填": True, "说明": "任务目标描述"},
        "最大轮数": {"类型": "整数", "必填": False, "说明": "最大循环轮数，默认10"},
        "连续干燥轮数": {"类型": "整数", "必填": False, "说明": "连续几轮无新结果则停止，默认3"},
        "类型": {"类型": "字符串", "必填": False, "说明": "子代理类型，explore/general/plan，默认explore"},
        "已发现结果": {"类型": "字符串", "必填": False, "说明": "已发现的结果列表(JSON数组字符串)，避免重复发现"}
    }
    def 执行(self, 参数: dict) -> 操作结果:
        目标 = 参数.get("目标", "")
        最大轮数 = 参数.get("最大轮数", 10)
        连续干燥 = 参数.get("连续干燥轮数", 3)
        类型 = 参数.get("类型", "explore")
        已发现字符串 = 参数.get("已发现结果", "")
        if not 目标:
            return 操作结果.失败("目标为空")
        if not self.模型直连器:
            return 操作结果.失败("模型直连器未注入")
        from 操作注册中心 import 操作注册中心类
        注册中心 = 操作注册中心类._实例引用
        if not 注册中心:
            return 操作结果.失败("操作注册中心未就绪")
        import concurrent.futures
        已发现集合 = set()
        if 已发现字符串:
            try:
                已发现列表 = json.loads(已发现字符串) if isinstance(已发现字符串, str) else 已发现字符串
                已发现集合 = set(已发现列表)
            except: pass
        explore只读操作 = {"搜索代码", "Glob搜索", "读取文件", "列出目录", "符号搜索", "获取时间", "系统信息"}
        类型提示 = {"explore":"只能使用只读操作。","general":"可以使用所有可用操作。","plan":"不执行操作，只生成计划。"}
        dry轮数 = 0
        全部结果 = []
        推理过程 = []
        for 轮 in range(1, 最大轮数+1):
            系统提示 = 类型提示.get(类型, 类型提示["explore"])
            系统提示 += f"\n第{轮}轮探索，目标: {目标}"
            if 已发现集合:
                系统提示 += f"\n已发现（不要重复）:\n" + "\n".join(f"- {r}" for r in 已发现集合)
            if not 类型.startswith("plan"):
                系统提示 += f"\n\n可用操作:\n{注册中心.获取操作说明()}"
            系统提示 += "\n\n如果找不到新结果，直接输出「本轮无新发现」。"
            子代理实例 = 子代理()
            子代理实例.模型直连器 = self.模型直连器
            子代理实例.文件管理器 = self.文件管理器
            try:
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                    future = ex.submit(子代理实例._子代理ReAct循环, f"第{轮}轮: {目标}", 系统提示, 注册中心, 类型, explore只读操作)
                    本轮结果 = future.result(timeout=120)
            except concurrent.futures.TimeoutError:
                本轮结果 = "[超时]"
            except Exception as e:
                本轮结果 = f"[异常: {e}]"
            无新关键词 = ["无新发现","未找到","没有新的","找不到新","nothing new","no new","未发现新","本轮无新"]
            本轮干燥 = any(词 in 本轮结果 for 词 in 无新关键词)
            推理过程.append({"轮次":轮,"干燥":本轮干燥})
            if not 本轮干燥:
                dry轮数 = 0
                全部结果.append(f"=== 第{轮}轮 ===\n{本轮结果[:500]}")
            else:
                dry轮数 += 1
                if dry轮数 >= 连续干燥:
                    break
        汇总 = f"LoopUntilDry完成: 共{len(推理过程)}轮"
        if 全部结果:
            汇总 += f", 发现{len(全部结果)}轮"
        汇总 += "\n\n" + "\n\n".join(全部结果) if 全部结果 else "\n\n(无新发现)"
        return 操作结果.成功(汇总, 元数据={"操作类型":"LoopUntilDry","总轮数":len(推理过程),"发现轮数":len(全部结果)})
