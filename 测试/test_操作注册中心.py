"""
操作注册中心测试 — 注册/别名/执行/统计
运行: python -m unittest 测试.test_操作注册中心
"""
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "公共区" / "内核"))

from 操作注册中心 import 操作注册中心类


class Test操作注册中心(unittest.TestCase):

    def setUp(self):
        self.注册中心 = 操作注册中心类()

    def test_注册内置操作(self):
        self.注册中心.注册内置操作()
        操作列表 = self.注册中心.列出所有操作()
        self.assertGreater(len(操作列表), 50)

    def test_已知操作存在(self):
        self.注册中心.注册内置操作()
        for 名称 in ["读取文件", "写入文件", "获取时间", "数学计算", "搜索代码", "Git状态"]:
            self.assertIn(名称, self.注册中心.列出所有操作(), f"缺少操作: {名称}")

    def test_别名解析(self):
        self.注册中心.注册内置操作()
        # 注册别名
        self.注册中心.注册别名("测试别名", "读取文件")
        # 通过别名查找应能找到
        self.assertIn("测试别名", self.注册中心._别名表)

    def test_执行未知操作(self):
        结果 = self.注册中心.执行("不存在的操作", {})
        self.assertFalse(结果["成功"])

    def test_英文名映射(self):
        self.注册中心.注册内置操作()
        工具定义 = self.注册中心.获取工具定义()
        self.assertGreater(len(工具定义), 50)
        # 每个工具必须有英文名（符合API要求）
        for 工具 in 工具定义:
            name = 工具["function"]["name"]
            self.assertTrue(name.replace("_", "").replace("-", "").isalnum(),
                           f"工具名不符合规范: {name}")

    def test_解析工具调用(self):
        self.注册中心.注册内置操作()
        # 英文→中文
        中文名, 中文参数 = self.注册中心.解析工具调用("read_file", {"path": "test.txt"})
        self.assertEqual(中文名, "读取文件")
        # path应映射回中文"路径"
        self.assertIn("路径", 中文参数)
        self.assertEqual(中文参数["路径"], "test.txt")
        # 中文参数名反查
        中文名2, _ = self.注册中心.解析工具调用("math_calc", {})
        self.assertEqual(中文名2, "数学计算")

    def test_操作统计(self):
        self.注册中心.注册内置操作()
        统计 = self.注册中心.获取操作统计()
        self.assertIn("统计", 统计)
        self.assertIn("总调用数", 统计)
        self.assertEqual(统计["总调用数"], 0)

    def test_获取操作说明(self):
        self.注册中心.注册内置操作()
        说明 = self.注册中心.获取操作说明()
        self.assertIsInstance(说明, str)
        self.assertGreater(len(说明), 100)

    def test_获取操作JSON描述(self):
        self.注册中心.注册内置操作()
        描述 = self.注册中心.获取操作JSON描述()
        self.assertIsInstance(描述, list)
        self.assertGreater(len(描述), 50)
        for 项 in 描述:
            self.assertIn("名称", 项)
            self.assertIn("描述", 项)
            self.assertIn("参数", 项)

    def test_设置文件管理器(self):
        # 不应崩溃
        self.注册中心.设置文件管理器(None)

    def test_设置模型直连器(self):
        self.注册中心.设置模型直连器(None)

    def test_动态注册操作(self):
        from 操作.基类 import 操作基类, 操作结果

        class 自定义操作(操作基类):
            名称 = "测试自定义操作"
            描述 = "测试用"
            参数结构 = {}

            def 执行(self, 参数):
                return 操作结果.成功("ok")

        self.注册中心.注册(自定义操作())
        self.assertIn("测试自定义操作", self.注册中心.列出所有操作())
        # 动态注册应有英文名映射
        self.assertIn("测试自定义操作", self.注册中心._英文名映射)


if __name__ == "__main__":
    unittest.main()
