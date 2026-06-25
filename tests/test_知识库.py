"""
知识库测试 — 文档分块+中文分词+BM25索引+召回
"""
import sys
from pathlib import Path

内核目录 = Path(__file__).parent.parent / "公共区" / "内核"
模块记忆目录 = Path(__file__).parent.parent / "公共区" / "模块" / "记忆"
for p in [str(内核目录), str(模块记忆目录)]:
    if p not in sys.path:
        sys.path.insert(0, p)

from 知识库 import 文档分块器, 中文分词器, BM25索引


class Test文档分块器:

    def test_正常分块(self):
        分块器 = 文档分块器()
        文本 = "这是第一句话。这是第二句话。这是第三句话。"
        块列表 = 分块器.分块(文本, 块大小=100, 重叠=10)
        assert len(块列表) > 0
        assert "第一句" in 块列表[0]

    def test_空文本(self):
        分块器 = 文档分块器()
        块列表 = 分块器.分块("", 块大小=100, 重叠=10)
        assert len(块列表) == 0

    def test_短文本一个块(self):
        分块器 = 文档分块器()
        文本 = "短文本"
        块列表 = 分块器.分块(文本, 块大小=512, 重叠=64)
        assert len(块列表) == 1
        assert 块列表[0] == "短文本"

    def test_长文本多块(self):
        分块器 = 文档分块器()
        # 生成一段长文本，每句独立
        句子列表 = [f"这是第{i}段内容。" for i in range(50)]
        文本 = "".join(句子列表)
        块列表 = 分块器.分块(文本, 块大小=50, 重叠=10)
        # 50句话每句约7字，块大小50字，应该分成多个块
        assert len(块列表) > 1

    def test_重叠保留(self):
        分块器 = 文档分块器()
        # 每句约8字，块大小15字，应产生多块且有重叠
        文本 = "句子一内容。句子二内容。句子三内容。句子四内容。句子五内容。"
        块列表 = 分块器.分块(文本, 块大小=15, 重叠=5)
        assert len(块列表) > 1


class Test中文分词器:

    def test_中文分词(self):
        词列表 = 中文分词器.分词("Python编程语言")
        # 应包含英文词和中文2-gram
        assert "python" in 词列表 or "Python" in [w.lower() for w in 词列表]
        assert any("编程" in w or "程语" in w or "程语" in w for w in 词列表)

    def test_纯中文(self):
        词列表 = 中文分词器.分词("人工智能技术")
        assert len(词列表) > 0
        # 2-gram: 人工, 工智, 智能等技术
        assert "人工" in 词列表

    def test_纯英文(self):
        词列表 = 中文分词器.分词("hello world")
        assert "hello" in 词列表
        assert "world" in 词列表

    def test_数字(self):
        词列表 = 中文分词器.分词("2026年")
        assert "2026" in 词列表

    def test_空字符串(self):
        词列表 = 中文分词器.分词("")
        assert len(词列表) == 0


class TestBM25索引:

    def test_构建并搜索(self):
        文档列表 = [
            "Python是一种广泛使用的编程语言",
            "JavaScript主要用于网页开发",
            "机器学习是人工智能的分支",
        ]
        索引 = BM25索引(文档列表)
        结果 = 索引.搜索("Python编程", top_k=2)
        assert len(结果) > 0
        # Python文档应该排在前面
        assert "Python" in 结果[0][0]

    def test_空索引搜索(self):
        索引 = BM25索引()
        结果 = 索引.搜索("测试")
        assert len(结果) == 0

    def test_无匹配文档(self):
        文档列表 = ["苹果香蕉橘子"]
        索引 = BM25索引(文档列表)
        # "量子力学"与文档无共同词，得分应为0，被最小得分过滤
        结果 = 索引.搜索("量子力学", top_k=3, 最小得分=0.01)
        assert len(结果) == 0

    def test_多个文档排序(self):
        文档列表 = [
            "Python Python Python 编程",
            "Python 编程",
            "JavaScript 网页",
        ]
        索引 = BM25索引(文档列表)
        结果 = 索引.搜索("Python", top_k=3)
        # Python出现最多的文档应排第一
        assert "Python" in 结果[0][0]
        # 得分应递减
        assert 结果[0][1] >= 结果[1][1]

    def test_最小得分过滤(self):
        文档列表 = ["完全无关的内容"]
        索引 = BM25索引(文档列表)
        结果 = 索引.搜索("Python", top_k=3, 最小得分=100.0)
        assert len(结果) == 0
