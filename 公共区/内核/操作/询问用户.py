"""询问用户操作 — Human-in-the-Loop交互式用户输入

AI在ReAct推理循环中遇到歧义或需要用户决策时，调用本操作。
推理循环暂停，前端弹出一个窗口展示所有问题，用户回答后结果作为工具返回值注入对话，AI继续。

支持3种问题类型：
- choice: 多选一（或带multiSelect的多选）
- yesno: 是/否确认
- text: 自由文本输入

一次调用可携带1~4个问题，在同一个窗口中展示，用户一次性回答。
"""
import json
import time
import threading
from 操作基类 import 操作基类, 操作结果


class 询问用户(操作基类):
    """向用户提问并等待回答，阻塞直到用户响应或超时"""

    名称 = "询问用户"
    描述 = "向用户提出问题并等待回答。支持多问题（1~4个），每问支持choice(选择)/yesno(是否)/text(文本输入)三种类型。调用后推理暂停，用户在前端弹窗中回答后继续。"
    参数结构 = {
        "问题列表": {
            "类型": "列表",
            "必填": True,
            "说明": "问题数组，每项含: 问题(必填), 类型(choice/yesno/text,默认text), 选项(choice类型必填,数组[{label,description}]), 默认值(可选), 占位符(可选), 多选(可选,布尔)"
        },
        "超时秒数": {
            "类型": "整数",
            "必填": False,
            "说明": "等待用户回答的超时秒数，默认300秒"
        }
    }

    # ===== 类级共享状态（所有实例共享，供网页服务调用） =====
    _待答队列 = {}           # {请求ID: {"问题列表": [...], "事件": Event, "回答": None, "时间": ...}}
    _队列锁 = threading.Lock()

    @classmethod
    def 提交回答(cls, 请求ID: str, 回答: dict) -> dict:
        """用户在前端提交回答后，网页服务调用此方法唤醒阻塞的操作"""
        with cls._队列锁:
            待答 = cls._待答队列.get(请求ID)
            if not 待答:
                return {"成功": False, "错误": "请求不存在或已过期"}
            if 待答["回答"] is not None:
                return {"成功": False, "错误": "此请求已被回答"}
            待答["回答"] = 回答
            待答["事件"].set()
        return {"成功": True}

    @classmethod
    def 获取待答(cls) -> list:
        """返回当前所有待答请求（供前端轮询兼容）"""
        with cls._队列锁:
            return [
                {"id": rid, "问题列表": v["问题列表"], "时间": v["时间"]}
                for rid, v in cls._待答队列.items()
                if v["回答"] is None
            ]

    def 执行(self, 参数: dict) -> 操作结果:
        问题列表 = 参数.get("问题列表", [])
        超时秒数 = 参数.get("超时秒数", 300)

        # 参数校验
        if not 问题列表:
            return 操作结果.失败("问题列表不能为空")
        if not isinstance(问题列表, list):
            return 操作结果.失败("问题列表必须是数组")
        if len(问题列表) > 4:
            return 操作结果.失败("一次最多4个问题")
        if len(问题列表) < 1:
            return 操作结果.失败("至少需要1个问题")

        # 规范化问题列表（补全默认值）
        规范化列表 = []
        for i, q in enumerate(问题列表):
            if not isinstance(q, dict):
                return 操作结果.失败(f"第{i+1}个问题格式错误，必须是对象")
            问题文本 = q.get("问题", "").strip()
            if not 问题文本:
                return 操作结果.失败(f"第{i+1}个问题缺少'问题'字段")
            问题类型 = q.get("类型", "text")
            if 问题类型 not in ("choice", "yesno", "text"):
                问题类型 = "text"
            选项 = q.get("选项", [])
            if 问题类型 == "choice" and not 选项:
                return 操作结果.失败(f"第{i+1}个问题类型为choice但未提供选项")
            规范化列表.append({
                "问题": 问题文本,
                "类型": 问题类型,
                "选项": 选项 if isinstance(选项, list) else [],
                "默认值": q.get("默认值", ""),
                "占位符": q.get("占位符", ""),
                "多选": q.get("多选", False)
            })

        # 生成请求ID
        请求ID = f"ask_{int(time.time() * 1000)}"

        # 存入待答队列
        事件 = threading.Event()
        with self._队列锁:
            self._待答队列[请求ID] = {
                "问题列表": 规范化列表,
                "事件": 事件,
                "回答": None,
                "时间": time.strftime("%H:%M:%S")
            }

        # 通过进度回调推送到推理流→SSE→前端
        if self.进度回调:
            self.进度回调("询问用户", {"id": 请求ID, "问题列表": 规范化列表})

        # 阻塞等待用户回答
        已回答 = 事件.wait(timeout=超时秒数)

        # 清理待答队列
        with self._队列锁:
            待答 = self._待答队列.pop(请求ID, None)

        if not 已回答 or not 待答 or not 待答["回答"]:
            return 操作结果.成功(
                f"用户未在{超时秒数}秒内回答，已跳过询问。请根据已有信息继续决策。"
            )

        # 构建回答摘要文本（注入到ReAct观察）
        回答数据 = 待答["回答"]
        摘要行 = []
        for i, q in enumerate(规范化列表):
            问题文本 = q["问题"]
            回答值 = 回答数据.get(f"问题{i+1}", "")
            if q["类型"] == "choice":
                标签 = q.get("多选") and "选择了" or "选择了"
                摘要行.append(f"问题: {问题文本}\n→ 用户{标签}: {回答值}")
            elif q["类型"] == "yesno":
                摘要行.append(f"问题: {问题文本}\n→ 用户回答: {'是' if 回答值 else '否'}")
            else:
                摘要行.append(f"问题: {问题文本}\n→ 用户输入: {回答值}")

        摘要文本 = "\n\n".join(摘要行)
        return 操作结果.成功(摘要文本, 元数据={"操作类型": "询问用户", "问题数": len(规范化列表)})
