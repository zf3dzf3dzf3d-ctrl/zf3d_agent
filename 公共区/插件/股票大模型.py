"""
股票大模型插件 — 桥接本地股票预测大模型项目
启动时检查本地大模型项目是否存在，存在则注册操作，不存在则静默跳过
外部用户无此项目路径，插件自动空转，不影响系统运行
"""
import os
import sys
import json

from 操作.基类 import 操作基类, 操作结果

# ===== 本地大模型项目路径（仅自己机器上有）=====
_股票模型路径 = r"F:\ai测试\股票大模型001"

# 检查本地大模型是否存在
_大模型可用 = (
    os.path.exists(os.path.join(_股票模型路径, "Agent接口.py"))
    and os.path.exists(os.path.join(_股票模型路径, "预测引擎.py"))
)

if _大模型可用:
    if _股票模型路径 not in sys.path:
        sys.path.insert(0, _股票模型路径)
    try:
        from Agent接口 import 处理请求 as _股票预测请求
        _已加载 = True
    except Exception as e:
        _已加载 = False
        print(f"   ⚠️ 股票大模型插件: 导入Agent接口失败: {e}")
else:
    _已加载 = False


class 股票预测(操作基类):
    """股票涨跌预测 — 基于本地LSTM神经网络大模型"""
    名称 = "股票预测"
    描述 = (
        "使用本地训练好的LSTM神经网络模型预测A股涨跌概率。"
        "支持单股预测（返回涨/跌/平概率）、批量预测、多周期选股（返回Top N）。"
        "需要本地部署股票大模型项目。"
    )
    参数结构 = {
        "股票代码": {"类型": "字符串", "必填": False, "说明": "股票代码如600519，批量模式用逗号分隔"},
        "模式": {"类型": "字符串", "必填": False, "说明": "单股/批量/选股，默认单股"},
        "预测天数": {"类型": "整数", "必填": False, "说明": "预测未来几天，默认1"},
        "数量": {"类型": "整数", "必填": False, "说明": "选股模式返回Top N，默认5"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        if not _已加载:
            return 操作结果.失败(
                "股票大模型未部署。此功能需要本地安装股票预测大模型项目。\n"
                "如需使用，请联系开发者获取授权。"
            )
        股票代码 = 参数.get("股票代码", "")
        模式 = 参数.get("模式", "单股")
        预测天数 = 参数.get("预测天数", 1)
        数量 = 参数.get("数量", 5)
        try:
            预测天数 = int(预测天数)
        except Exception:
            预测天数 = 1
        try:
            数量 = int(数量)
        except Exception:
            数量 = 5

        请求参数 = {"股票代码": 股票代码, "模式": 模式, "预测天数": 预测天数, "数量": 数量}
        try:
            结果str = _股票预测请求(请求参数)
            结果 = json.loads(结果str)
            if "错误" in 结果:
                return 操作结果.失败(结果["错误"])
            return 操作结果.成功(json.dumps(结果, ensure_ascii=False, indent=2))
        except Exception as e:
            return 操作结果.失败(f"股票预测调用失败: {e}")


class 股票选股(操作基类):
    """AI选股 — 多周期模型投票+Chronos大模型投票，输出Top N"""
    名称 = "股票选股"
    描述 = (
        "全市场多周期AI选股。5个周期(1/3/5/10/20日)×12分组=60个LSTM模型投票+"
        "Chronos大模型zero-shot投票+实时行情+涨停过滤，输出综合得分最高的Top N股票。"
        "需要本地部署股票大模型项目。"
    )
    参数结构 = {
        "数量": {"类型": "整数", "必填": False, "说明": "返回Top N只股票，默认5"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        if not _已加载:
            return 操作结果.失败(
                "股票大模型未部署。此功能需要本地安装股票预测大模型项目。\n"
                "如需使用，请联系开发者获取授权。"
            )
        数量 = 参数.get("数量", 5)
        try:
            数量 = int(数量)
        except Exception:
            数量 = 5
        try:
            结果str = _股票预测请求({"模式": "选股", "数量": 数量})
            结果 = json.loads(结果str)
            if "错误" in 结果:
                return 操作结果.失败(结果["错误"])
            return 操作结果.成功(json.dumps(结果, ensure_ascii=False, indent=2))
        except Exception as e:
            return 操作结果.失败(f"选股调用失败: {e}")
