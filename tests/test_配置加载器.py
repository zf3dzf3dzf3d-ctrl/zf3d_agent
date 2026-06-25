"""
配置加载器测试 — JSON读取+热重载+全局事件+全局命令
"""
import sys
import json
import time
from pathlib import Path

内核目录 = Path(__file__).parent.parent / "公共区" / "内核"
if str(内核目录) not in sys.path:
    sys.path.insert(0, str(内核目录))

from 配置加载器 import 配置加载器类, 全局事件中心, 全局命令中心


class Test配置加载器:

    def test_加载全部配置(self, 临时目录):
        # 创建模拟配置目录
        配置目录 = 临时目录 / "公共区" / "配置"
        配置目录.mkdir(parents=True)

        系统配置 = {"运行模式": "模块化", "网页端口": 8080}
        with open(配置目录 / "系统配置.json", "w", encoding="utf-8") as f:
            json.dump(系统配置, f, ensure_ascii=False)

        加载器 = 配置加载器类(临时目录)
        配置 = 加载器.加载全部配置()
        assert "系统配置" in 配置
        assert 配置["系统配置"]["网页端口"] == 8080

    def test_获取配置(self, 临时目录):
        配置目录 = 临时目录 / "公共区" / "配置"
        配置目录.mkdir(parents=True)
        with open(配置目录 / "系统配置.json", "w", encoding="utf-8") as f:
            json.dump({"端口": 9999}, f, ensure_ascii=False)

        加载器 = 配置加载器类(临时目录)
        加载器.加载全部配置()
        配置 = 加载器.获取配置("系统配置")
        assert 配置 is not None
        assert 配置["端口"] == 9999

    def test_获取不存在的配置(self, 临时目录):
        加载器 = 配置加载器类(临时目录)
        加载器.加载全部配置()
        配置 = 加载器.获取配置("不存在的配置")
        # 获取配置返回{}（默认值），不是None
        assert 配置 == {}


class Test全局事件中心:

    def test_订阅和发布(self):
        收到的事件 = []

        def 回调(数据):
            收到的事件.append(数据)

        全局事件中心.订阅("测试事件", 回调)
        全局事件中心.发布("测试事件", {"内容": "测试"})

        assert len(收到的事件) == 1
        assert 收到的事件[0]["内容"] == "测试"

    def test_取消订阅(self):
        收到的事件 = []

        def 回调(数据):
            收到的事件.append(数据)

        全局事件中心.订阅("取消测试", 回调)
        全局事件中心.取消订阅("取消测试", 回调)
        全局事件中心.发布("取消测试", {})

        assert len(收到的事件) == 0


class Test全局命令中心:

    def test_注册和执行命令(self):
        执行结果 = {"called": False}

        def 命令(参数):
            执行结果["called"] = True
            执行结果["参数"] = 参数
            return {"成功": True}

        全局命令中心.注册命令("测试命令", 命令)
        结果 = 全局命令中心.执行("测试命令", {"key": "value"})
        assert 执行结果["called"]
        assert 执行结果["参数"]["key"] == "value"
        assert 结果["成功"]

    def test_执行未知命令(self):
        结果 = 全局命令中心.执行("不存在的命令", {})
        assert "错误" in 结果
