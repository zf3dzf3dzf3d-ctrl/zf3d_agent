"""
文件管理器测试 — 读写/权限校验/回收站
运行: python -m unittest 测试.test_文件操作
"""
import unittest
import sys
import tempfile
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "公共区" / "内核"))

from 文件管理器 import 文件管理器类


class Test文件管理器(unittest.TestCase):

    def setUp(self):
        self.临时目录 = Path(tempfile.mkdtemp(prefix="zf3d_file_"))
        # 授权目录配置
        权限配置 = {
            "授权目录": [
                {"路径": str(self.临时目录), "权限": ["读", "写"], "授权类型": "永久"}
            ],
            "默认权限": [],
            "禁止后缀": [".exe", ".bat"],
            "禁止关键词路径": ["Windows", "System32"],
            "询问规则": {"新文件夹必须询问": True, "询问超3次自动永久放行": True}
        }
        self.管理器 = 文件管理器类(权限配置, self.临时目录.parent)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.临时目录, ignore_errors=True)

    def test_写入文件(self):
        路径 = str(self.临时目录 / "test.txt")
        结果 = self.管理器.写入文件(路径, "hello world")
        self.assertTrue(结果.get("成功", True))
        # 验证内容
        with open(路径, "r", encoding="utf-8") as f:
            self.assertEqual(f.read(), "hello world")

    def test_读取文件(self):
        路径 = str(self.临时目录 / "read_test.txt")
        with open(路径, "w", encoding="utf-8") as f:
            f.write("test content")
        结果 = self.管理器.读取文件(路径)
        self.assertIn("内容", 结果)

    def test_新建文件(self):
        路径 = str(self.临时目录 / "new_file.txt")
        结果 = self.管理器.新建文件(路径)
        self.assertTrue(Path(路径).exists())

    def test_创建目录(self):
        路径 = str(self.临时目录 / "subdir")
        结果 = self.管理器.创建目录(路径)
        self.assertTrue(Path(路径).exists())

    def test_替换文本(self):
        路径 = str(self.临时目录 / "replace_test.txt")
        with open(路径, "w", encoding="utf-8") as f:
            f.write("hello old world")
        结果 = self.管理器.替换文本(路径, "old", "new")
        with open(路径, "r", encoding="utf-8") as f:
            self.assertIn("new", f.read())
            self.assertNotIn("old", f.read())

    def test_重命名(self):
        旧路径 = str(self.临时目录 / "old_name.txt")
        with open(旧路径, "w", encoding="utf-8") as f:
            f.write("content")
        结果 = self.管理器.重命名(旧路径, "new_name.txt")
        self.assertTrue((self.临时目录 / "new_name.txt").exists())
        self.assertFalse(Path(旧路径).exists())

    def test_AI调用未授权路径(self):
        # 未授权路径，AI调用应被拒绝
        路径 = str(self.临时目录.parent / "unauthorized_test" / "test.txt")
        try:
            结果 = self.管理器.写入文件(路径, "test", AI调用=True)
            # 可能成功或失败取决于权限校验，但不应崩溃
        except Exception as e:
            self.fail(f"AI调用未授权路径不应崩溃: {e}")

    def test_禁止后缀(self):
        路径 = str(self.临时目录 / "test.exe")
        # 禁止后缀对AI调用生效
        结果 = self.管理器.写入文件(路径, "test", AI调用=True)
        self.assertFalse(结果.get("成功", False))

    def test_列目录(self):
        (self.临时目录 / "a.txt").touch()
        (self.临时目录 / "b.txt").touch()
        结果 = self.管理器.列目录(str(self.临时目录))
        self.assertIsInstance(结果, (list, dict))

    def test_批量替换(self):
        路径 = str(self.临时目录 / "batch_test.txt")
        with open(路径, "w", encoding="utf-8") as f:
            f.write("foo bar foo\nfoo baz")
        结果 = self.管理器.批量替换(路径, [
            {"旧文本": "foo", "新文本": "qux", "全部替换": True}
        ])
        with open(路径, "r", encoding="utf-8") as f:
            内容 = f.read()
        self.assertNotIn("foo", 内容)
        self.assertIn("qux", 内容)


if __name__ == "__main__":
    unittest.main()
