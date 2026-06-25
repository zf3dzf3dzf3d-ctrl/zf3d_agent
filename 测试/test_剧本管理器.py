"""
剧本管理器测试 — 录制/回放/变量替换
运行: python -m unittest 测试.test_剧本管理器
"""
import unittest
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "公共区" / "内核"))

from 剧本管理器 import 剧本管理器


class Test剧本管理器(unittest.TestCase):

    def setUp(self):
        self.临时目录 = Path(tempfile.mkdtemp(prefix="zf3d_script_"))
        self.管理器 = 剧本管理器(操作注册中心=None, 项目根目录=str(self.临时目录))

    def tearDown(self):
        import shutil
        shutil.rmtree(self.临时目录, ignore_errors=True)

    def test_开始录制(self):
        结果 = self.管理器.开始录制("测试剧本")
        self.assertTrue(结果["成功"])
        self.assertEqual(结果["名称"], "测试剧本")

    def test_重复录制(self):
        self.管理器.开始录制("第一个")
        结果 = self.管理器.开始录制("第二个")
        self.assertFalse(结果["成功"])

    def test_停止录制(self):
        self.管理器.开始录制("测试")
        self.管理器.记录操作("获取时间", {}, {"时间": "12:00"})
        结果 = self.管理器.停止录制()
        self.assertTrue(结果["成功"])
        self.assertEqual(结果["步数"], 1)

    def test_停止无录制(self):
        结果 = self.管理器.停止录制()
        self.assertFalse(结果["成功"])

    def test_录制记录步骤(self):
        self.管理器.开始录制("测试")
        self.管理器.记录操作("操作A", {"参数": 1}, {"结果": "ok"})
        self.管理器.记录操作("操作B", {"参数": 2}, {"结果": "ok"})
        结果 = self.管理器.停止录制()
        剧本 = 结果["剧本"]
        self.assertEqual(len(剧本["步骤"]), 2)
        self.assertEqual(剧本["步骤"][0]["操作"], "操作A")
        self.assertEqual(剧本["步骤"][1]["操作"], "操作B")

    def test_保存和加载剧本(self):
        self.管理器.开始录制("保存测试")
        self.管理器.记录操作("获取时间", {}, {})
        self.管理器.停止录制()
        加载结果 = self.管理器.加载剧本("保存测试")
        self.assertTrue(加载结果["成功"])
        self.assertEqual(加载结果["剧本"]["名称"], "保存测试")

    def test_加载不存在剧本(self):
        结果 = self.管理器.加载剧本("不存在的剧本")
        self.assertFalse(结果["成功"])

    def test_列出剧本(self):
        self.管理器.开始录制("剧本A")
        self.管理器.停止录制()
        self.管理器.开始录制("剧本B")
        self.管理器.停止录制()
        列表 = self.管理器.列出剧本()
        self.assertGreaterEqual(len(列表), 2)

    def test_删除剧本(self):
        self.管理器.开始录制("待删除")
        self.管理器.停止录制()
        结果 = self.管理器.删除剧本("待删除")
        self.assertTrue(结果["成功"])

    def test_变量替换_字符串(self):
        上下文 = {"名字": "张三"}
        结果 = self.管理器._替换变量("你好${名字}", 上下文)
        self.assertEqual(结果, "你好张三")

    def test_变量替换_字典(self):
        上下文 = {"step1": {"result": "ok"}}
        结果 = self.管理器._替换变量({"content": "${step1.result}"}, 上下文)
        self.assertEqual(结果["content"], "ok")

    def test_变量替换_列表(self):
        上下文 = {"值": "42"}
        结果 = self.管理器._替换变量(["${值}", "普通文本"], 上下文)
        self.assertEqual(结果[0], "42")
        self.assertEqual(结果[1], "普通文本")

    def test_变量替换_无占位符(self):
        上下文 = {"名字": "张三"}
        结果 = self.管理器._替换变量("普通文本", 上下文)
        self.assertEqual(结果, "普通文本")

    def test_回放无注册中心(self):
        剧本 = {"步骤": [{"序号": 1, "操作": "test", "参数": {}}]}
        结果 = self.管理器.回放(剧本)
        self.assertFalse(结果["成功"])

    def test_回放空剧本(self):
        剧本 = {"步骤": []}
        结果 = self.管理器.回放(剧本)
        self.assertFalse(结果["成功"])

    def test_序列化(self):
        # 可序列化对象
        self.assertEqual(self.管理器._序列化("字符串"), "字符串")
        self.assertEqual(self.管理器._序列化(42), 42)
        # 不可序列化对象→字符串
        class 不可序列化:
            pass
        结果 = self.管理器._序列化(不可序列化())
        self.assertIsInstance(结果, str)

    def test_截断(self):
        长文本 = "A" * 1000
        结果 = self.管理器._截断(长文本, 100)
        self.assertEqual(len(结果), 103)  # 100 + "..."

    def test_截断短文本(self):
        结果 = self.管理器._截断("短", 100)
        self.assertEqual(结果, "短")

    def test_正在录制属性(self):
        self.assertFalse(self.管理器.正在录制)
        self.管理器.开始录制("test")
        self.assertTrue(self.管理器.正在录制)
        self.管理器.停止录制()
        self.assertFalse(self.管理器.正在录制)


if __name__ == "__main__":
    unittest.main()
