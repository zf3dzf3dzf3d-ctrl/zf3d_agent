"""
知识库模块 — 文档分块+BM25索引+语义召回
零外部依赖，纯Python标准库实现

功能：
1. 文档分块：按句子边界+固定长度，支持重叠
2. 中文分词：2-gram滑窗（无需jieba）
3. BM25索引：纯标准库实现
4. 知识召回：用户对话时自动检索相关文档块注入上下文
5. 存储引擎：复用SQLite存储引擎，支持FTS5全文搜索
"""
import re
import math
import json
import hashlib
from pathlib import Path
from datetime import datetime
from collections import Counter, defaultdict

from 存储引擎 import 获取存储引擎


class 文档分块器:
    """零依赖文档分块器，按句子边界+固定长度"""

    def 分块(self, 文本: str, 块大小: int = 512, 重叠: int = 64) -> list:
        """将长文本分块，在句子边界处切分，保留重叠部分"""
        if not 文本 or not 文本.strip():
            return []
        # 按句子切分（中英文标点）
        句子 = re.split(r'([。！？\.\!\?\n]+)', 文本)
        # 合并句子和标点
        合并句子 = []
        for i in range(0, len(句子) - 1, 2):
            合并句子.append(句子[i] + (句子[i + 1] if i + 1 < len(句子) else ""))
        if 句子 and not 合并句子:
            合并句子 = [文本]

        块列表 = []
        当前块 = ""
        for 句 in 合并句子:
            句 = 句.strip()
            if not 句:
                continue
            if len(当前块) + len(句) > 块大小 and 当前块:
                块列表.append(当前块.strip())
                # 保留重叠部分（取当前块末尾的"重叠"长度字符）
                当前块 = 当前块[-重叠:] if len(当前块) > 重叠 else ""
            当前块 += 句
        if 当前块.strip():
            块列表.append(当前块.strip())
        return 块列表


class 中文分词器:
    """2-gram滑窗分词，无需jieba"""

    @staticmethod
    def 分词(文本: str) -> list:
        """提取中文2-gram + 英文单词 + 数字"""
        词列表 = []
        # 提取中文连续段
        中文段 = re.findall(r'[\u4e00-\u9fff]+', 文本)
        for 段 in 中文段:
            if len(段) == 1:
                词列表.append(段)
            else:
                # 2-gram滑窗
                for i in range(len(段) - 1):
                    词列表.append(段[i:i + 2])
        # 提取英文单词
        英文词 = re.findall(r'[a-zA-Z]+', 文本)
        词列表.extend([w.lower() for w in 英文词])
        # 提取数字
        数字 = re.findall(r'\d+', 文本)
        词列表.extend(数字)
        return 词列表


class BM25索引:
    """纯标准库BM25实现"""

    def __init__(self, 文档列表: list = None):
        self._文档 = []
        self._分词结果 = []
        self._文档频率 = Counter()
        self._平均长度 = 0
        self._已构建 = False
        if 文档列表:
            self.构建索引(文档列表)

    def 构建索引(self, 文档列表: list):
        """构建BM25倒排索引"""
        self._文档 = 文档列表
        self._分词结果 = [中文分词器.分词(doc) for doc in 文档列表]
        self._文档频率 = Counter()
        for 分词 in self._分词结果:
            for 词 in set(分词):
                self._文档频率[词] += 1
        总长度 = sum(len(d) for d in self._分词结果)
        self._平均长度 = 总长度 / len(self._分词结果) if self._分词结果 else 1
        self._已构建 = True

    def 搜索(self, 查询: str, top_k: int = 3, 最小得分: float = 0.0) -> list:
        """返回最相关的top_k文档块，格式: [(文档内容, 得分)]"""
        if not self._已构建 or not self._文档:
            return []
        查询词 = 中文分词器.分词(查询)
        if not 查询词:
            return []
        得分列表 = []
        N = len(self._文档)
        k1, b = 1.5, 0.75
        for i, 文档分词 in enumerate(self._分词结果):
            s = 0.0
            for 词 in 查询词:
                if 词 not in self._文档频率:
                    continue
                # IDF公式
                df = self._文档频率[词]
                idf = math.log((N - df + 0.5) / (df + 0.5) + 1)
                # TF分量
                tf = 文档分词.count(词)
                dl = len(文档分词)
                s += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / self._平均长度))
            if s >= 最小得分:
                得分列表.append((self._文档[i], s))
        得分列表.sort(key=lambda x: -x[1])
        return 得分列表[:top_k]


class 知识库模块:
    """知识库管理：导入文档→分块→索引→召回"""

    def __init__(self):
        self.配置 = {}
        self.项目根目录 = None
        self.知识库目录 = None
        self.分块器 = 文档分块器()
        self.BM25 = BM25索引()
        self._文档块缓存 = []  # [(文档名, 块内容)]
        self._已加载 = False
        self.存储引擎 = None

    def 初始化(self, 配置: dict):
        """初始化知识库模块"""
        self.配置 = 配置
        self.项目根目录 = Path(配置.get("项目根目录", "."))
        self.知识库目录 = self.项目根目录 / "隐私区" / "我的知识库"
        self.知识库目录.mkdir(parents=True, exist_ok=True)
        try:
            self.存储引擎 = 获取存储引擎(str(self.项目根目录 / "隐私区" / "我的数据" / "智能体.db"))
        except Exception:
            pass
        # 加载已有索引
        self.重建索引()

    def 导入文档(self, 文档名: str, 内容: str, 来源: str = "") -> dict:
        """导入文档：分块→存储→重建索引"""
        块大小 = self.配置.get("分块大小", 512)
        重叠 = self.配置.get("分块重叠", 64)
        块列表 = self.分块器.分块(内容, 块大小, 重叠)
        if not 块列表:
            return {"成功": False, "错误": "文档内容为空或分块失败"}

        # 存储到SQLite
        if self.存储引擎:
            # 先删除旧的同名文档
            self.存储引擎.删除知识库文档(文档名)
            for i, 块 in enumerate(块列表):
                关键词 = " ".join(中文分词器.分词(块)[:20])
                self.存储引擎.插入知识库文档(文档名, i, 块, 关键词, 来源)

        # 同时保存原始文档到文件系统
        文档路径 = self.知识库目录 / f"{文档名}.json"
        文档数据 = {
            "文档名": 文档名,
            "来源": 来源,
            "导入时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "块数": len(块列表),
            "块大小": 块大小,
            "重叠": 重叠,
            "内容": 内容
        }
        with open(文档路径, "w", encoding="utf-8") as f:
            json.dump(文档数据, f, ensure_ascii=False, indent=2)

        # 重建内存索引
        self.重建索引()
        return {"成功": True, "文档名": 文档名, "块数": len(块列表)}

    def 重建索引(self):
        """从SQLite加载所有文档块，重建BM25索引"""
        self._文档块缓存 = []
        if not self.存储引擎:
            return
        try:
            文档列表 = self.存储引擎.列出知识库文档()
            for 文档信息 in 文档列表:
                文档名 = 文档信息["文档名"]
                # 查询该文档的所有块
                rows = self.存储引擎._查询(
                    "SELECT 块序号, 内容 FROM 知识库文档 WHERE 文档名 = ? ORDER BY 块序号",
                    [文档名]
                )
                for r in rows:
                    self._文档块缓存.append((文档名, r[1]))
        except Exception:
            pass

        # 重建BM25
        if self._文档块缓存:
            文档内容列表 = [块[1] for 块 in self._文档块缓存]
            self.BM25.构建索引(文档内容列表)
        self._已加载 = True

    def 召回(self, 查询文本: str, top_k: int = None) -> list:
        """BM25召回相关文档块"""
        if not self._已加载 or not self._文档块缓存:
            return []
        top_k = top_k or self.配置.get("召回数量", 3)
        最小得分 = self.配置.get("最小得分", 0.5)
        结果 = self.BM25.搜索(查询文本, top_k, 最小得分)
        # 通过文档内容反查文档名
        内容到文档名 = {}
        for 文档名, 块内容 in self._文档块缓存:
            if 块内容 not in 内容到文档名:
                内容到文档名[块内容] = 文档名
        return [{
            "文档名": 内容到文档名.get(文档, ""),
            "内容": 文档,
            "得分": round(得分, 3)
        } for 文档, 得分 in 结果]

    def 召回文本(self, 查询文本: str, top_k: int = None) -> str:
        """召回并拼接为文本（用于注入提示词）"""
        结果 = self.召回(查询文本, top_k)
        if not 结果:
            return ""
        最大字数 = self.配置.get("最大注入字数", 1500)
        拼接 = []
        总字数 = 0
        for 项 in 结果:
            内容 = 项["内容"]
            if 总字数 + len(内容) > 最大字数:
                内容 = 内容[:最大字数 - 总字数] + "..."
            拼接.append(f"【{项['文档名']}】(相关度:{项['得分']}):\n{内容}")
            总字数 += len(内容)
            if 总字数 >= 最大字数:
                break
        return "\n\n---\n\n".join(拼接)

    def 列出文档(self) -> list:
        """列出已导入的文档"""
        if self.存储引擎:
            return self.存储引擎.列出知识库文档()
        return []

    def 删除文档(self, 文档名: str) -> dict:
        """删除指定文档"""
        if self.存储引擎:
            self.存储引擎.删除知识库文档(文档名)
        文件路径 = self.知识库目录 / f"{文档名}.json"
        if 文件路径.exists():
            文件路径.unlink()
        self.重建索引()
        return {"成功": True, "文档名": 文档名}
