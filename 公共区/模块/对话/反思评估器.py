"""反思评估器 — 任务反思 + 错误分类 + 恢复策略

职责：
1. 任务完成后自评（从对话模块抽出）
2. 错误分类体系（替代字符串嗅探）
3. 分层恢复策略建议

核心改进：
- 错误分类替代字符串嗅探（不再 if "400" in 错误信息）
- 分层恢复：网络错误→指数退避，语义错误→换方法，配置错误→终止
- 反思逻辑独立，可单独测试
"""
from datetime import datetime


class 反思评估器类:
    """任务反思与错误恢复"""

    # 错误类型常量
    网络错误 = "网络错误"
    限流错误 = "限流错误"
    配置错误 = "配置错误"
    模型语义错误 = "模型语义错误"
    用户取消 = "用户取消"
    未知错误 = "未知错误"

    def 评估(self, 用户消息: str, 推理结果: dict, 模型直连器=None) -> str:
        """任务完成后让LLM自评

        返回反思文本，失败返回空字符串
        """
        if not 模型直连器:
            return ""
        try:
            推理过程摘要 = "\n".join(
                f"步{s.get('步骤', '?')}: {s.get('操作', '回复')} → "
                f"{'✅' if s.get('成功', True) else '❌'} {s.get('结果', '')[:100]}"
                for s in 推理结果.get("推理过程", [])
                if s.get("类型") == "操作"
            )[:1500]
            反思提示 = (
                f"任务: {用户消息[:200]}\n"
                f"执行摘要:\n{推理过程摘要}\n\n"
                f"请用3句话以内反思：\n"
                f"1. 用户的核心需求是否完全满足？\n"
                f"2. 遇到了什么困难，如何解决的？\n"
                f"3. 下次类似任务有什么可以做得更好？"
            )
            反思结果 = 模型直连器.发送消息(
                [{"role": "user", "content": 反思提示}],
                "你是任务反思专家。简洁、真诚、有建设性。"
            )
            if 反思结果.get("成功"):
                反思内容 = 反思结果.get("回复内容", "")
                print(f"  💡 反思: {反思内容[:100]}...")
                return 反思内容
        except Exception as e:
            print(f"  ⚠️ 生成反思失败: {e}")
        return ""

    def 分类错误(self, 错误信息: str) -> str:
        """错误分类（替代字符串嗅探）

        根据错误信息判断错误类型，用于选择恢复策略
        """
        if not 错误信息:
            return self.未知错误

        错误小写 = 错误信息.lower()

        # 用户取消
        if "cancel" in 错误小写 or "abort" in 错误小写 or "取消" in 错误信息:
            return self.用户取消

        # 限流（429）
        if "429" in 错误信息 or "rate limit" in 错误小写 or "rate_limit" in 错误小写:
            return self.限流错误

        # 网络错误（超时/连接失败/DNS）
        if any(kw in 错误小写 for kw in ["timeout", "超时", "timed out"]):
            return self.网络错误
        if any(kw in 错误小写 for kw in ["connection", "连接", "refused", "unreachable", "dns"]):
            return self.网络错误
        if any(kw in 错误小写 for kw in ["urlopen", "socket", "eof", "reset"]):
            return self.网络错误

        # 配置错误（401认证/403禁止/404模型不存在）
        if "401" in 错误信息 or "authentication" in 错误小写 or "unauthorized" in 错误小写:
            return self.配置错误
        if "403" in 错误信息 or "forbidden" in 错误小写:
            return self.配置错误
        if "404" in 错误信息 or "not found" in 错误小写 or "modelnotopen" in 错误小写.replace(" ", ""):
            return self.配置错误
        if "insufficient balance" in 错误小写 or "余额不足" in 错误信息:
            return self.配置错误
        if "api key" in 错误小写 and ("incorrect" in 错误小写 or "invalid" in 错误小写):
            return self.配置错误

        # 模型语义错误（400请求格式错误/工具调用格式问题）
        if "400" in 错误信息 or "bad request" in 错误小写:
            return self.模型语义错误
        if "tool" in 错误小写 and ("message" in 错误小写 or "format" in 错误小写):
            return self.模型语义错误
        if "messages with role" in 错误小写:
            return self.模型语义错误

        # 余额不足（402）
        if "402" in 错误信息 or "payment required" in 错误小写:
            return self.配置错误

        return self.未知错误

    def 友好化错误(self, 错误信息: str) -> str:
        """技术错误码→中文友好提示"""
        错误类型 = self.分类错误(错误信息)
        友好映射 = {
            self.网络错误: "网络连接出现问题，请检查网络后重试",
            self.限流错误: "请求过于频繁，请稍等片刻再试",
            self.配置错误: "API配置有误（密钥过期/余额不足/模型未开通），请在设置中检查",
            self.模型语义错误: "AI理解出了问题，正在尝试换一种方式",
            self.用户取消: "已取消",
            self.未知错误: f"遇到未知问题: {错误信息[:150]}",
        }
        return 友好映射.get(错误类型, 错误信息[:200])

    def 建议_恢复策略(self, 错误类型: str, 连续失败次数: int = 0) -> dict:
        """根据错误类型建议恢复策略

        返回:
            {
                "策略": "重试" | "降级" | "换方法" | "终止" | "人工介入",
                "退避秒": float,     # 重试前等待秒数
                "提示": str,         # 给AI的提示
                "可恢复": bool       # 是否可自动恢复
            }
        """
        if 错误类型 == self.网络错误:
            # 网络错误：指数退避重试
            退避秒 = min(2 ** 连续失败次数, 30)  # 最大30秒
            return {
                "策略": "重试",
                "退避秒": 退避秒,
                "提示": f"网络错误，{退避秒}秒后重试",
                "可恢复": 连续失败次数 < 3
            }

        if 错误类型 == self.限流错误:
            # 限流：等待更长时间后重试
            退避秒 = min(5 * (连续失败次数 + 1), 60)
            return {
                "策略": "重试",
                "退避秒": 退避秒,
                "提示": f"API限流，{退避秒}秒后重试",
                "可恢复": 连续失败次数 < 2
            }

        if 错误类型 == self.模型语义错误:
            # 模型语义错误：降级到文本模式或换方法
            if 连续失败次数 == 0:
                return {
                    "策略": "降级",
                    "退避秒": 0,
                    "提示": "FC格式错误，降级到文本模式",
                    "可恢复": True
                }
            return {
                "策略": "换方法",
                "退避秒": 0,
                "提示": "连续语义错误，换一种方法",
                "可恢复": 连续失败次数 < 3
            }

        if 错误类型 == self.配置错误:
            # 配置错误：不可自动恢复，需人工介入
            return {
                "策略": "终止",
                "退避秒": 0,
                "提示": "配置错误（API Key/模型未开通/余额不足），需人工修复",
                "可恢复": False
            }

        if 错误类型 == self.用户取消:
            return {
                "策略": "终止",
                "退避秒": 0,
                "提示": "用户已取消",
                "可恢复": False
            }

        # 未知错误：看连续失败次数
        if 连续失败次数 < 2:
            return {
                "策略": "重试",
                "退避秒": 1,
                "提示": "未知错误，重试一次",
                "可恢复": True
            }
        if 连续失败次数 < 3:
            return {
                "策略": "换方法",
                "退避秒": 0,
                "提示": f"连续失败{连续失败次数}次，换一种方法",
                "可恢复": True
            }
        return {
            "策略": "终止",
            "退避秒": 0,
            "提示": f"连续失败{连续失败次数}次，终止任务",
            "可恢复": False
        }
