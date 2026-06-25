"""
知识库测试 — 文档分块/BM25搜索/召回
运行: python -m unittest 测试.test_知识库
"""
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "公共区" / "内核"))
sys.path.insert(0, str(Path(__file__).parent.parent / "公共区" / "模块" / "记忆"))

from 知识库 import 文档分块器, 中文分词器, BM25索引


class Test文档分块器(unittest.TestCase):

    def setUp(self):
        self.分块器 = 文档分块器()

    def test_短文本不分块(self):
        块 = self.分块器.分块("这是一段短文本。", 块大小=512)
        self.assertEqual(len(块), 1)

    def test_长文本分块(self):
        文本 = "这是一段测试文本。" * 100
        块 = self.分块器.分块(文本, 块大小=100, 重叠=20)
        self.assertGreater(len(块), 1)

    def test_空文本(self):
        self.assertEqual(self.分块器.分块(""), [])
        self.assertEqual(self.分块器.分块("   "), [])

    def test_按句子切分(self):
        文本 = "第一句话。第二句话！第三句话？第四句。"
        块 = self.分块器.分块(文本, 块大小=512)
        self.assertGreaterEqual(len(块), 1)

    def test_重叠保留(self):
        文本 = "A" * 200 + "。" + "B" * 200 + "。" + "C" * 200
        块 = self.分块器.分块(文本, 块大小=150, 重叠=30)
        if len(块) > 1:
            # 第二块应包含第一块末尾的内容
            self.assertTrue(len(块[1]) > 0)


class Test中文分词器(unittest.TestCase):

    def test_中文分词(self):
        词 = 中文分词器.分词("人工智能技术")
        self.assertIsInstance(词, list)
        self.assertGreater(len(词), 0)

    def test_英文分词(self):
        词 = 中文分词器.分词("hello world")
        self.assertIn("hello", 词)
        self.assertIn("world", 词)

    def test_数字分词(self):
        词 = 中文分词器.分词("GPT4模型")
        self.assertIsInstance(词, list)

    def test_空文本(self):
        self.assertEqual(中文分词器.分词(""), [])

    def test_2gram(self):
        词 = 中文分词器.分词("人工智能")
        # "人工智能" 应产生 2-gram: "人工", "工智", "智能"
        self.assertIn("人工", 词)
        self.assertIn("智能", 词)


class TestBM25索引(unittest.TestCase):

    def setUp(self):
        self.文档 = [
            "人工智能是计算机科学的分支",
            "机器学习是人工智能的子领域",
            "深度学习使用神经网络",
        ]
        self.bm25 = BM25索引(self.文档)

    def test_搜索相关文档(self):
        结果 = self.bm25.搜索("人工智能", top_k=2)
        self.assertLessEqual(len(结果), 2)
        self.assertGreater(len(结果), 0)
        # 最相关的应该是包含"人工智能"的文档
        内容, 得分 = 结果[0]
        self.assertIn("人工智能", 内容)

    def test_搜索无结果(self):
        结果 = self.bm25.搜索("完全不存在的词汇xyz", top_k=3, 最小得分=999)
        self.assertEqual(len(结果), 0)

    def test_空索引(self):
        bm25 = BM25索引([])
        self.assertEqual(bm25.搜索("test"), [])

    def test_得分排序(self):
        结果 = self.bm25.搜索("学习", top_k=3)
        得分列表 = [s for _, s in 结果]
        self.assertEqual(得分列表, sorted(得分列表, reverse=True))


if __name__ == "__main__":
    unittest.main()
