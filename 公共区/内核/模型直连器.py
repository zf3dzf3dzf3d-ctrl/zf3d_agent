"""
模型直连器 v2.1 - 纯HTTP直连大模型
不依赖openai/anthropic等SDK，用户自定义请求格式
v2.1新增: 指数退避重试 + LLM响应缓存
"""
import json
import urllib.request
import urllib.error
import os
import time
import hashlib
import base64
import platform
import threading
from pathlib import Path


def _机器码() -> str:
    """生成基于机器信息的密钥（零依赖，hashlib+platform）"""
    信息 = platform.node() + platform.machine() + os.environ.get("USERNAME", "") + os.environ.get("USER", "")
    return hashlib.md5(信息.encode()).hexdigest()


def _xor加密(明文: str, 密钥: str) -> str:
    """XOR加密+base64编码"""
    密钥bytes = 密钥.encode()
    明文bytes = 明文.encode()
    加密bytes = bytes(明文bytes[i] ^ 密钥bytes[i % len(密钥bytes)] for i in range(len(明文bytes)))
    return base64.b64encode(加密bytes).decode()


def _xor解密(密文: str, 密钥: str) -> str:
    """base64解码+XOR解密"""
    try:
        加密bytes = base64.b64decode(密文)
        密钥bytes = 密钥.encode()
        明文bytes = bytes(加密bytes[i] ^ 密钥bytes[i % len(密钥bytes)] for i in range(len(加密bytes)))
        return 明文bytes.decode()
    except Exception:
        return ""


def 加密密钥配置(配置: dict) -> dict:
    """加密密钥配置（用于写入磁盘）"""
    if not 配置 or not 配置.get("密钥列表"):
        return 配置
    机器 = _机器码()
    加密后 = {"加密": True, "密钥列表": {}}
    for 模型名, 密钥字典 in 配置.get("密钥列表", {}).items():
        加密后["密钥列表"][模型名] = {}
        for 键, 值 in 密钥字典.items():
            if isinstance(值, str) and 值:
                加密后["密钥列表"][模型名][键] = _xor加密(值, 机器)
            else:
                加密后["密钥列表"][模型名][键] = 值
    if "读取规则" in 配置:
        加密后["读取规则"] = 配置["读取规则"]
    return 加密后


def 解密密钥配置(配置: dict) -> dict:
    """解密密钥配置（从磁盘读取后调用）"""
    if not 配置:
        return 配置
    if not 配置.get("加密", False):
        return 配置  # 明文存储，无需解密
    机器 = _机器码()
    解密后 = {"加密": False, "密钥列表": {}}
    for 模型名, 密钥字典 in 配置.get("密钥列表", {}).items():
        解密后["密钥列表"][模型名] = {}
        for 键, 值 in 密钥字典.items():
            if isinstance(值, str) and 值:
                明文 = _xor解密(值, 机器)
                解密后["密钥列表"][模型名][键] = 明文 if 明文 else 值
            else:
                解密后["密钥列表"][模型名][键] = 值
    if "读取规则" in 配置:
        解密后["读取规则"] = 配置["读取规则"]
    return 解密后


def 自动迁移密钥(密钥路径, 配置: dict) -> dict:
    """如果密钥.json未加密，自动加密并保存"""
    if not 配置:
        return 配置
    if 配置.get("加密", False):
        # 已加密，解密后返回明文供内存使用
        return 解密密钥配置(配置)
    # 明文→加密→写盘
    加密后 = 加密密钥配置(配置)
    try:
        with open(密钥路径, "w", encoding="utf-8") as f:
            json.dump(加密后, f, ensure_ascii=False, indent=2)
    except Exception:
        pass
    return 配置  # 返回明文供内存使用


class 模型直连器类:
    _全部调用统计 = {"总调用次数": 0, "总提示tokens": 0, "总生成tokens": 0, "总耗时毫秒": 0, "调用历史": []}
    _响应缓存 = {}  # v2.1: 缓存键 -> {"时间戳": float, "响应": dict}
    _缓存统计 = {"命中": 0, "未命中": 0}
    _缓存锁 = threading.Lock()  # 缓存线程安全锁
    _统计锁 = threading.Lock()  # 统计线程安全锁
    _日志锁 = threading.Lock()  # LLM调用日志线程安全锁
    _LLM日志路径 = None  # 延迟初始化

    def __init__(self, 配置: dict, 密钥配置: dict = None):
        self.配置 = 配置
        # 自动解密/迁移密钥
        密钥路径 = Path(__file__).parent.parent.parent / "隐私区" / "我的配置" / "密钥.json"
        self.密钥配置 = 自动迁移密钥(密钥路径, 密钥配置 or {})
        self.模型配置列表 = 配置.get("模型配置列表", [])
        self.当前模型名 = 配置.get("当前模型", "")
        # 初始化LLM调用日志路径
        项目根 = Path(__file__).parent.parent.parent
        日志目录 = 项目根 / "隐私区" / "我的日志"
        日志目录.mkdir(parents=True, exist_ok=True)
        模型直连器类._LLM日志路径 = 日志目录 / "LLM调用日志.jsonl"
        # 如果有模型配置列表，用当前模型的配置初始化；否则用顶层配置
        self._应用模型配置(self.当前模型名 or (self.模型配置列表[0]["名称"] if self.模型配置列表 else ""))
        # 全局配置（所有模型共享）
        重试配置 = 配置.get("重试", {})
        self.重试最大次数 = 重试配置.get("最大次数", 3)
        self.重试基础延迟 = 重试配置.get("基础延迟秒", 1)
        self.重试最大延迟 = 重试配置.get("最大延迟秒", 30)
        缓存配置 = 配置.get("缓存", {})
        self.缓存启用 = 缓存配置.get("启用", True)
        self.缓存最大条目 = 缓存配置.get("最大条目", 200)
        self.缓存TTL秒 = 缓存配置.get("TTL秒", 300)
        self.规则 = 配置.get("规则", {})
        self.超时秒数 = self.规则.get("超时秒数", 30)

    def _应用模型配置(self, 模型名: str):
        """从模型配置列表中加载指定模型的配置"""
        # 默认从顶层配置读取
        self.接口地址 = self.配置.get("接口地址", "")
        self.请求方法 = self.配置.get("请求方法", "POST")
        self.请求头模板 = self.配置.get("请求头", {})
        self.请求模板 = self.配置.get("请求模板", {})
        self.响应路径 = self.配置.get("响应路径", "$.choices[0].message.content")
        self.环境变量 = self.配置.get("环境变量", {})
        # 从模型配置列表中覆盖
        已匹配 = False
        for m in self.模型配置列表:
            if m.get("名称") == 模型名:
                self.接口地址 = m.get("接口地址", self.接口地址)
                self.请求方法 = m.get("请求方法", self.请求方法)
                self.请求头模板 = m.get("请求头", self.请求头模板)
                self.请求模板 = m.get("请求模板", self.请求模板)
                self.响应路径 = m.get("响应路径", self.响应路径)
                self.环境变量 = m.get("环境变量", self.环境变量)
                self.当前模型名 = 模型名
                已匹配 = True
                break
        # 兜底：未匹配到模型名时，用第一个有接口地址的模型
        if not 已匹配 and self.模型配置列表:
            for m in self.模型配置列表:
                if m.get("接口地址"):
                    self.接口地址 = m.get("接口地址", self.接口地址)
                    self.请求方法 = m.get("请求方法", self.请求方法)
                    self.请求头模板 = m.get("请求头", self.请求头模板)
                    self.请求模板 = m.get("请求模板", self.请求模板)
                    self.响应路径 = m.get("响应路径", self.响应路径)
                    self.环境变量 = m.get("环境变量", self.环境变量)
                    self.当前模型名 = m.get("名称", "")
                    break

    def 切换模型(self, 模型名: str) -> dict:
        """切换当前使用的模型"""
        # 校验模型是否存在
        存在 = any(m.get("名称") == 模型名 for m in self.模型配置列表)
        if not 存在 and self.模型配置列表:
            return {"成功": False, "错误": f"模型 '{模型名}' 不存在"}
        self._应用模型配置(模型名)
        # 清空缓存（不同模型的缓存不通用）
        self.清空缓存()
        return {"成功": True, "当前模型": 模型名}

    def 获取模型列表(self) -> list:
        """返回所有可用模型名称列表"""
        return [{"名称": m.get("名称", ""), "当前": m.get("名称") == self.当前模型名} for m in self.模型配置列表]

    def 获取模型配置详情(self, 模型名: str = None) -> dict:
        """返回指定模型的配置详情（密钥掩码，模型名不掩码）"""
        目标名 = 模型名 or self.当前模型名
        for m in self.模型配置列表:
            if m.get("名称") == 目标名:
                配置 = dict(m)
                环境变量 = 配置.get("环境变量", {})
                密钥列表 = self.密钥配置.get("密钥列表", {})
                模型密钥 = 密钥列表.get(目标名, {})
                配置["已配置密钥"] = {}
                for 变量名 in 环境变量:
                    实际值 = 模型密钥.get(变量名, "")
                    if 实际值:
                        # 模型名称不是机密，不掩码；仅掩码含"密钥"或"key"的变量
                        if "密钥" in 变量名 or "key" in 变量名.lower():
                            配置["已配置密钥"][变量名] = 实际值[:4] + "****" + 实际值[-4:] if len(实际值) > 8 else "****"
                        else:
                            配置["已配置密钥"][变量名] = 实际值
                    else:
                        配置["已配置密钥"][变量名] = ""
                return 配置
        return {}

    def 保存模型密钥(self, 模型名: str, 密钥字典: dict) -> dict:
        """保存指定模型的密钥到密钥配置（按模型名分组存储）"""
        if not self.密钥配置:
            self.密钥配置 = {"密钥列表": {}, "读取规则": {}}
        密钥列表 = self.密钥配置.setdefault("密钥列表", {})
        模型密钥 = 密钥列表.setdefault(模型名, {})
        for 键, 值 in 密钥字典.items():
            if 值:
                模型密钥[键] = 值
        return {"成功": True}

    @classmethod
    def 获取Token统计(cls) -> dict:
        """获取全局Token使用统计"""
        return cls._全部调用统计

    @classmethod
    def 重置统计(cls):
        """重置统计"""
        cls._全部调用统计 = {"总调用次数": 0, "总提示tokens": 0, "总生成tokens": 0, "总耗时毫秒": 0, "调用历史": []}

    @classmethod
    def 获取缓存统计(cls) -> dict:
        """获取缓存命中统计"""
        cls._清理过期缓存()
        总 = cls._缓存统计["命中"] + cls._缓存统计["未命中"]
        命中率 = round(cls._缓存统计["命中"] / 总 * 100, 1) if 总 > 0 else 0
        return {
            "命中": cls._缓存统计["命中"],
            "未命中": cls._缓存统计["未命中"],
            "命中率": f"{命中率}%",
            "当前缓存数": len(cls._响应缓存),
            "最大条目": cls._缓存最大条目 if hasattr(cls, '_缓存最大条目') else 200
        }

    @classmethod
    def 清空缓存(cls):
        """清空所有缓存"""
        cls._响应缓存.clear()
        cls._缓存统计 = {"命中": 0, "未命中": 0}

    @classmethod
    def _清理过期缓存(cls):
        """清理过期的缓存条目（自动维护）"""
        现在 = time.time()
        过期键 = [k for k, v in cls._响应缓存.items()
                  if 现在 - v["时间戳"] > getattr(cls, '_缓存TTL秒', 300)]
        for k in 过期键:
            del cls._响应缓存[k]

    def _生成缓存键(self, 消息列表: list, 系统提示词: str, 工具列表: list) -> str:
        """生成缓存键：基于请求内容的hash"""
        素材 = json.dumps([
            系统提示词,
            消息列表,
            工具列表,
            self.接口地址,
            self.请求模板.get("model", ""),
            self.请求模板.get("temperature", 0.7),
            self.请求模板.get("max_tokens", 4096)
        ], sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(素材.encode("utf-8")).hexdigest()

    def 发送消息流式(self, 消息列表: list, 系统提示词: str = None, 工具列表: list = None, 工具选择: str = None, 流式回调=None) -> dict:
        """流式发送消息到大模型，逐token回调，返回完整响应

        参数同 发送消息()，额外:
            流式回调: function(内容片段: str) — 每收到一个token回调一次
        """
        if not self.接口地址:
            return {"错误": "未配置模型接口地址"}

        请求头 = self._构建请求头()
        完整消息 = []
        if 系统提示词:
            完整消息.append({"role": "system", "content": 系统提示词})
        for 消息 in 消息列表:
            if isinstance(消息.get("content"), list):
                完整消息.append(消息)
            else:
                完整消息.append(消息)

        请求体 = self._构建请求体(完整消息)
        if 工具列表:
            请求体["tools"] = 工具列表
            请求体["tool_choice"] = 工具选择 or "auto"
        请求体["stream"] = True  # 启用流式

        开始时间 = time.time()
        try:
            请求数据 = json.dumps(请求体, ensure_ascii=False).encode("utf-8")
            请求 = urllib.request.Request(
                self.接口地址, data=请求数据, headers=请求头, method=self.请求方法
            )
            响应 = urllib.request.urlopen(请求, timeout=self.超时秒数)

            累积内容 = []
            工具调用列表 = []
            原始块列表 = []

            for 行 in 响应:
                行 = 行.decode("utf-8", errors="replace").strip()
                if not 行 or not 行.startswith("data:"):
                    continue
                数据 = 行[5:].strip()
                if 数据 == "[DONE]":
                    break
                try:
                    块 = json.loads(数据)
                    原始块列表.append(块)
                    # 提取内容delta
                    choices = 块.get("choices", [])
                    if choices:
                        delta = choices[0].get("delta", {})
                        内容片段 = delta.get("content", "")
                        if 内容片段:
                            累积内容.append(内容片段)
                            if 流式回调:
                                流式回调(内容片段)
                        # 提取工具调用delta
                        tool_calls = delta.get("tool_calls", [])
                        for tc in tool_calls:
                            idx = tc.get("index", 0)
                            while len(工具调用列表) <= idx:
                                工具调用列表.append({"id": "", "名称": "", "参数": ""})
                            if tc.get("id"):
                                工具调用列表[idx]["id"] = tc["id"]
                            func = tc.get("function", {})
                            if func.get("name"):
                                工具调用列表[idx]["名称"] = func["name"]
                            if func.get("arguments"):
                                工具调用列表[idx]["参数"] += func["arguments"]
                except json.JSONDecodeError:
                    continue

            耗时毫秒 = int((time.time() - 开始时间) * 1000)
            回复内容 = "".join(累积内容)

            # 解析工具调用参数
            工具调用结果 = []
            for tc in 工具调用列表:
                if tc["名称"]:
                    try:
                        参数 = json.loads(tc["参数"]) if tc["参数"] else {}
                    except json.JSONDecodeError:
                        参数 = {}
                    工具调用结果.append({"id": tc["id"], "名称": tc["名称"], "参数": 参数})

            # Token统计（从最后一个块的usage取）
            try:
                最后块 = 原始块列表[-1] if 原始块列表 else {}
                usage = 最后块.get("usage", {}) or {}
                提示tokens = usage.get("prompt_tokens", 0) or usage.get("input_tokens", 0)
                生成tokens = usage.get("completion_tokens", 0) or usage.get("output_tokens", 0)
                with self._统计锁:
                    self._全部调用统计["总调用次数"] += 1
                    self._全部调用统计["总提示tokens"] += 提示tokens
                    self._全部调用统计["总生成tokens"] += 生成tokens
                    self._全部调用统计["总耗时毫秒"] += 耗时毫秒
                    self._全部调用统计["调用历史"].append({
                        "时间": time.strftime("%H:%M:%S"),
                        "模型": self.请求模板.get("model", "未知"),
                        "提示tokens": 提示tokens, "生成tokens": 生成tokens,
                        "耗时毫秒": 耗时毫秒, "流式": True
                    })
                    if len(self._全部调用统计["调用历史"]) > 100:
                        self._全部调用统计["调用历史"] = self._全部调用统计["调用历史"][-100:]
            except Exception:
                pass

            # 重建assistant消息（与发送消息()格式一致，供推理引擎提取tool_calls）
            助手消息 = {"role": "assistant", "content": 回复内容}
            if 工具调用结果:
                助手消息["tool_calls"] = [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": tc["名称"],
                            "arguments": json.dumps(tc["参数"], ensure_ascii=False) if tc["参数"] else "{}"
                        }
                    }
                    for tc in 工具调用结果
                ]

            返回结果 = {
                "成功": True,
                "回复内容": 回复内容,
                "工具调用": 工具调用结果,
                "原始请求": {"url": self.接口地址, "headers": 请求头, "body": 请求体},
                "原始响应": {"choices": [{"message": 助手消息, "finish_reason": "tool_calls" if 工具调用结果 else "stop"}], "chunks": len(原始块列表)},
                "响应状态": 200,
                "耗时毫秒": 耗时毫秒,
                "流式": True
            }
            self._记录LLM调用日志(返回结果, 系统提示词, 消息列表)
            return 返回结果

        except urllib.error.HTTPError as e:
            错误详情 = ""
            try:
                错误详情 = e.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            错误结果 = {
                "成功": False,
                "错误": f"HTTP {e.code}: {错误详情[:500]}" if 错误详情 else f"HTTP错误: {e.code}",
                "原始请求": {"url": self.接口地址, "headers": 请求头, "body": 请求体},
                "原始响应": 错误详情,
                "耗时毫秒": int((time.time() - 开始时间) * 1000)
            }
            self._记录LLM调用日志(错误结果, 系统提示词, 消息列表)
            return 错误结果
        except Exception as e:
            错误结果 = {
                "成功": False,
                "错误": f"流式请求失败: {str(e)}",
                "原始请求": {"url": self.接口地址, "headers": 请求头, "body": 请求体},
                "原始响应": None,
                "耗时毫秒": int((time.time() - 开始时间) * 1000)
            }
            self._记录LLM调用日志(错误结果, 系统提示词, 消息列表)
            return 错误结果

    def 发送消息(self, 消息列表: list, 系统提示词: str = None, 工具列表: list = None, 工具选择: str = None) -> dict:
        """发送消息到大模型，返回完整响应（全透明）
        
        参数:
            消息列表: 对话消息列表，content可为字符串或list(multimodal)
            系统提示词: 系统提示词
            工具列表: OpenAI function calling格式的工具定义列表
            工具选择: "auto"|"none"|{"type":"function","function":{"name":"xxx"}}
        """
        if not self.接口地址:
            return {"错误": "未配置模型接口地址", "原始请求": None, "原始响应": None}

        # v2.1: 缓存检查
        if self.缓存启用:
            缓存键 = self._生成缓存键(消息列表, 系统提示词, 工具列表)
            with self._缓存锁:
                缓存条目 = self._响应缓存.get(缓存键)
                if 缓存条目 and (time.time() - 缓存条目["时间戳"]) < self.缓存TTL秒:
                    self._缓存统计["命中"] += 1
                    # 从缓存返回，标记来源
                    缓存响应 = dict(缓存条目["响应"])
                    缓存响应["来自缓存"] = True
                    return 缓存响应
                self._缓存统计["未命中"] += 1

                # 清理过期缓存（每20次调用清理一次）
                if (self._缓存统计["命中"] + self._缓存统计["未命中"]) % 20 == 0:
                    self._清理过期缓存()
        else:
            缓存键 = None

        # 构建请求头
        请求头 = self._构建请求头()

        # 构建消息（支持multimodal: content为list时直接传递）
        完整消息 = []
        if 系统提示词:
            完整消息.append({"role": "system", "content": 系统提示词})
        for 消息 in 消息列表:
            # 如果content是list(multimodal)，直接传递；否则正常处理
            if isinstance(消息.get("content"), list):
                完整消息.append(消息)
            else:
                完整消息.append(消息)

        # 构建请求体
        请求体 = self._构建请求体(完整消息)

        # 注入function calling参数
        if 工具列表:
            请求体["tools"] = 工具列表
            请求体["tool_choice"] = 工具选择 or "auto"

        # 记录开始时间
        开始时间 = time.time()

        # v2.1: 重试循环（指数退避）
        最大重试 = self.重试最大次数
        最后错误 = None
        for 尝试次数 in range(最大重试 + 1):
            try:
                请求数据 = json.dumps(请求体, ensure_ascii=False).encode("utf-8")
                请求 = urllib.request.Request(
                    self.接口地址,
                    data=请求数据,
                    headers=请求头,
                    method=self.请求方法
                )
                响应 = urllib.request.urlopen(请求, timeout=self.超时秒数)
                响应数据 = 响应.read().decode("utf-8")
                响应JSON = json.loads(响应数据)
                耗时毫秒 = int((time.time() - 开始时间) * 1000)

                # Token使用统计
                try:
                    usage = 响应JSON.get("usage", {})
                    提示tokens = usage.get("prompt_tokens", 0) or usage.get("input_tokens", 0)
                    生成tokens = usage.get("completion_tokens", 0) or usage.get("output_tokens", 0)
                    with self._统计锁:
                        self._全部调用统计["总调用次数"] += 1
                        self._全部调用统计["总提示tokens"] += 提示tokens
                        self._全部调用统计["总生成tokens"] += 生成tokens
                        self._全部调用统计["总耗时毫秒"] += 耗时毫秒
                        self._全部调用统计["调用历史"].append({
                            "时间": time.strftime("%H:%M:%S"),
                            "模型": self.请求模板.get("model", "未知"),
                            "提示tokens": 提示tokens, "生成tokens": 生成tokens,
                            "耗时毫秒": 耗时毫秒
                        })
                        # 保留最近100条历史
                        if len(self._全部调用统计["调用历史"]) > 100:
                            self._全部调用统计["调用历史"] = self._全部调用统计["调用历史"][-100:]
                except Exception:
                    pass

                # 提取回复内容
                回复内容 = self._提取回复(响应JSON)
                # 提取工具调用（function calling）
                工具调用列表 = self._提取工具调用(响应JSON)

                # 构建返回结果
                返回结果 = {
                    "成功": True,
                    "回复内容": 回复内容,
                    "工具调用": 工具调用列表,
                    "原始请求": {"url": self.接口地址, "headers": 请求头, "body": 请求体},
                    "原始响应": 响应JSON,
                    "响应状态": 响应.status,
                    "耗时毫秒": 耗时毫秒
                }

                # v2.1: 存入缓存（不缓存工具调用响应，只缓存纯文本响应）
                if self.缓存启用 and 缓存键 and not 工具调用列表:
                    with self._缓存锁:
                        # 控制缓存大小
                        if len(self._响应缓存) >= self.缓存最大条目:
                            # 删除最旧的条目
                            最旧键 = min(self._响应缓存.keys(),
                                       key=lambda k: self._响应缓存[k]["时间戳"])
                            del self._响应缓存[最旧键]
                        self._响应缓存[缓存键] = {
                            "时间戳": time.time(),
                            "响应": 返回结果
                        }

                # 记录LLM调用日志（全透明溯源）
                self._记录LLM调用日志(返回结果, 系统提示词, 消息列表)

                return 返回结果

            except urllib.error.HTTPError as e:
                错误详情 = ""
                try:
                    错误详情 = e.read().decode("utf-8", errors="replace")
                except Exception:
                    pass
                # 4xx错误不重试（客户端错误），5xx重试
                if 400 <= e.code < 500 and e.code != 429:
                    最后错误 = {
                        "成功": False,
                        "错误": f"HTTP {e.code}: {错误详情[:500]}" if 错误详情 else f"HTTP错误: {e.code}",
                        "原始请求": {"url": self.接口地址, "headers": 请求头, "body": 请求体},
                        "原始响应": 错误详情,
                        "耗时毫秒": int((time.time() - 开始时间) * 1000)
                    }
                    break  # 4xx不重试
                最后错误 = {
                    "成功": False,
                    "错误": f"HTTP {e.code}: {错误详情[:500]}" if 错误详情 else f"HTTP错误: {e.code}",
                    "原始请求": {"url": self.接口地址, "headers": 请求头, "body": 请求体},
                    "原始响应": 错误详情,
                    "耗时毫秒": int((time.time() - 开始时间) * 1000)
                }
                if 尝试次数 >= 最大重试:
                    break
                延迟 = min(self.重试基础延迟 * (2 ** 尝试次数), self.重试最大延迟)
                print(f"  ⚠️ 模型请求HTTP {e.code}, 第{尝试次数+1}次重试, 等待{延迟}秒...")
                time.sleep(延迟)
                continue

            except urllib.error.URLError as e:
                最后错误 = {
                    "成功": False,
                    "错误": f"连接错误: {str(e.reason)}",
                    "原始请求": {"url": self.接口地址, "headers": 请求头, "body": 请求体},
                    "原始响应": None,
                    "耗时毫秒": int((time.time() - 开始时间) * 1000)
                }
                if 尝试次数 >= 最大重试:
                    break
                延迟 = min(self.重试基础延迟 * (2 ** 尝试次数), self.重试最大延迟)
                print(f"  ⚠️ 模型连接失败, 第{尝试次数+1}次重试, 等待{延迟}秒...")
                time.sleep(延迟)
                continue

            except Exception as e:
                最后错误 = {
                    "成功": False,
                    "错误": f"未知错误: {str(e)}",
                    "原始请求": {"url": self.接口地址, "headers": 请求头, "body": 请求体},
                    "原始响应": None,
                    "耗时毫秒": int((time.time() - 开始时间) * 1000)
                }
                if 尝试次数 >= 最大重试:
                    break
                延迟 = min(self.重试基础延迟 * (2 ** 尝试次数), self.重试最大延迟)
                print(f"  ⚠️ 模型请求异常: {str(e)[:80]}, 第{尝试次数+1}次重试, 等待{延迟}秒...")
                time.sleep(延迟)
                continue

        # 记录失败的LLM调用日志
        if 最后错误:
            self._记录LLM调用日志(最后错误, 系统提示词, 消息列表)
        return 最后错误

    def _记录LLM调用日志(self, 结果: dict, 系统提示词: str, 消息列表: list):
        """将LLM调用原始请求/响应追加写入JSONL日志（全透明溯源）"""
        if not 模型直连器类._LLM日志路径:
            return
        try:
            日志条目 = {
                "时间": time.strftime("%Y-%m-%d %H:%M:%S"),
                "模型": self.当前模型名,
                "成功": 结果.get("成功", False),
                "耗时毫秒": 结果.get("耗时毫秒", 0),
                "错误": 结果.get("错误", "") if not 结果.get("成功") else "",
                "系统提示词长度": len(系统提示词) if 系统提示词 else 0,
                "消息数量": len(消息列表) if 消息列表 else 0,
                "原始请求": 结果.get("原始请求"),
                "原始响应": 结果.get("原始响应"),
                "回复内容": 结果.get("回复内容", "")[:2000] if 结果.get("成功") else "",
                "工具调用": 结果.get("工具调用", []) if 结果.get("成功") else []
            }
            with 模型直连器类._日志锁:
                with open(模型直连器类._LLM日志路径, "a", encoding="utf-8") as f:
                    f.write(json.dumps(日志条目, ensure_ascii=False) + "\n")
        except Exception:
            pass

    def 验证连通性(self) -> dict:
        """验证模型接口配置是否就绪（不发HTTP请求，实际连通性在对话时自然验证）"""
        if not self.接口地址:
            return {"连通": False, "原因": "未配置接口地址"}
        密钥列表 = self.密钥配置.get("密钥列表", {})
        模型密钥 = 密钥列表.get(self.当前模型名, {})
        for 变量名, 环境键 in self.环境变量.items():
            实际值 = 模型密钥.get(变量名, "")
            if not 实际值 and not os.environ.get(环境键):
                return {"连通": False, "原因": f"未配置密钥: {变量名}"}
        return {"连通": True, "原因": ""}

    def _构建请求头(self) -> dict:
        """构建请求头，替换密钥变量"""
        请求头 = {}
        for 键, 值 in self.请求头模板.items():
            if isinstance(值, str) and "${" in 值:
                值 = self._替换变量(值)
            请求头[键] = 值
        return 请求头

    def _构建请求体(self, 消息列表: list) -> dict:
        """构建请求体"""
        请求体 = {}
        for 键, 值 in self.请求模板.items():
            if 值 == "${消息列表}":
                请求体[键] = 消息列表
            elif isinstance(值, str) and "${" in 值:
                请求体[键] = self._替换变量(值)
            else:
                请求体[键] = 值
        return 请求体

    def _替换变量(self, 文本: str) -> str:
        """替换${变量名}为实际值，优先从密钥文件读取（按模型名分组）"""
        for 变量名, 环境键 in self.环境变量.items():
            占位符 = f"${{{变量名}}}"
            if 占位符 in 文本:
                模型密钥 = self.密钥配置.get("密钥列表", {}).get(self.当前模型名, {})
                实际值 = 模型密钥.get(变量名, "")
                if not 实际值:
                    实际值 = os.environ.get(环境键, "")
                文本 = 文本.replace(占位符, 实际值)
        return 文本

    def _提取工具调用(self, 响应JSON: dict) -> list:
        """从响应中提取function calling的工具调用列表"""
        try:
            消息 = 响应JSON.get("choices", [{}])[0].get("message", {})
            工具调用原始 = 消息.get("tool_calls", [])
            if not 工具调用原始:
                return []
            结果 = []
            for 调用 in 工具调用原始:
                函数 = 调用.get("function", {})
                参数字符串 = 函数.get("arguments", "{}")
                try:
                    参数 = json.loads(参数字符串)
                except (json.JSONDecodeError, TypeError):
                    参数 = {}
                结果.append({
                    "id": 调用.get("id", ""),
                    "名称": 函数.get("name", ""),
                    "参数": 参数
                })
            return 结果
        except (IndexError, KeyError, TypeError):
            return []

    def _提取回复(self, 响应JSON: dict) -> str:
        """从响应中提取回复内容（简单的点分路径解析）
        注意: function calling时content可能为null, 此时返回空字符串而非JSON dump
        """
        路径 = self.响应路径
        if not 路径.startswith("$."):
            return json.dumps(响应JSON, ensure_ascii=False)

        路径部分 = 路径[2:].split(".")
        当前 = 响应JSON
        for i, 部分 in enumerate(路径部分):
            # 处理数组索引如 choices[0]
            if "[" in 部分:
                键名 = 部分.split("[")[0]
                索引 = int(部分.split("[")[1].rstrip("]"))
                当前 = 当前.get(键名, [])[索引]
            else:
                当前 = 当前.get(部分)
            if 当前 is None:
                # 最后一步为null(function calling时content=null) → 返回空字符串
                if i == len(路径部分) - 1:
                    return ""
                # 中间步骤缺失 → 返回JSON dump作为兜底
                return json.dumps(响应JSON, ensure_ascii=False)
        return str(当前) if 当前 is not None else ""
