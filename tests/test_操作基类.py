"""
操作基类测试 — 操作结果包装+参数验证
"""
import sys
from pathlib import Path

内核目录 = Path(__file__).parent.parent / "公共区" / "内核"
if str(内核目录) not in sys.path:
    sys.path.insert(0, str(内核目录))

from 操作基类 import 操作结果, 操作基类


class Test操作结果:

    def test_成功结果(self):
        结果 = 操作结果.成功("数据内容")
        assert 结果.成功
        assert 结果.数据 == "数据内容"
        assert 结果.错误 == ""

    def test_失败结果(self):
        结果 = 操作结果.失败("出错了")
        assert not 结果.成功
        assert 结果.错误 == "出错了"
        assert 结果.数据 == ""

    def test_带元数据(self):
        结果 = 操作结果.成功("数据", 元数据={"耗时毫秒": 100})
        assert 结果.元数据["耗时毫秒"] == 100

    def test_转字典_成功(self):
        结果 = 操作结果.成功("数据")
        字典 = 结果.转字典()
        assert 字典["成功"] is True
        assert 字典["数据"] == "数据"

    def test_转字典_失败(self):
        结果 = 操作结果.失败("错误")
        字典 = 结果.转字典()
        assert 字典["成功"] is False
        assert 字典["错误"] == "错误"

    def test_默认元数据含操作类型(self):
        结果 = 操作结果.成功("数据")
        assert "操作类型" in 结果.元数据


class Test操作基类_参数验证:

    def test_缺少必填参数(self):
        class 测试操作(操作基类):
            名称 = "测试操作"
            参数结构 = {
                "必填参数": {"类型": "字符串", "必填": True, "说明": "必填"}
            }
        操作 = 测试操作()
        错误 = 操作.验证参数({})
        assert 错误  # 应返回错误信息

    def test_可选参数不报错(self):
        class 测试操作(操作基类):
            名称 = "测试操作"
            参数结构 = {
                "可选参数": {"类型": "字符串", "必填": False, "说明": "可选"}
            }
        操作 = 测试操作()
        错误 = 操作.验证参数({})
        assert not 错误  # 不应返回错误

    def test_参数齐全不报错(self):
        class 测试操作(操作基类):
            名称 = "测试操作"
            参数结构 = {
                "参数1": {"类型": "字符串", "必填": True, "说明": "参数1"},
                "参数2": {"类型": "整数", "必填": False, "说明": "参数2"}
            }
        操作 = 测试操作()
        错误 = 操作.验证参数({"参数1": "值", "参数2": 10})
        assert not 错误
