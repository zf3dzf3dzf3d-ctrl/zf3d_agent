"""
存储引擎 — SQLite封装，零外部依赖（sqlite3是Python标准库）
线程安全，支持FTS5全文搜索，替代JSON全量读写
用于：记忆索引、对话记录、知识库索引等结构化数据
内置TF-IDF向量搜索引擎，零依赖语义搜索
"""
import sqlite3
import json
import math
import threading
from pathlib import Path
from datetime import datetime


class 存储引擎类:
    """SQLite存储引擎，线程安全，支持全文搜索+向量搜索"""

    def __init__(self, 路径: str):
        self._路径 = str(路径)
        self._锁 = threading.Lock()
        父目录 = Path(路径).parent
        父目录.mkdir(parents=True, exist_ok=True)
        self._连接 = sqlite3.connect(self._路径, check_same_thread=False)
        self._连接.row_factory = sqlite3.Row
        self._连接.execute("PRAGMA journal_mode=WAL")
        self._连接.execute("PRAGMA synchronous=NORMAL")
        self._初始化表()

    def _初始化表(self):
        """创建表结构（IF NOT EXISTS，幂等）"""
        with self._锁:
            conn = self._连接
            # 对话记录表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS 对话记录 (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    对话ID TEXT NOT NULL,
                    角色 TEXT NOT NULL,
                    内容 TEXT NOT NULL,
                    时间 TEXT,
                    推理过程 TEXT
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_对话_对话ID ON 对话记录(对话ID)")

            # 对话全文搜索（FTS5）
            try:
                conn.execute("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS 对话搜索
                    USING fts5(内容, 对话ID UNINDEXED, 时间 UNINDEXED)
                """)
            except Exception:
                pass  # FTS5不支持时跳过

            # 记忆索引表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS 记忆索引 (
                    名称 TEXT PRIMARY KEY,
                    描述 TEXT,
                    类型 TEXT,
                    标签 TEXT,
                    创建时间 TEXT,
                    更新时间 TEXT,
                    文件路径 TEXT
                )
            """)

            # 记忆向量表（TF-IDF向量搜索）
            conn.execute("""
                CREATE TABLE IF NOT EXISTS 记忆向量 (
                    名称 TEXT PRIMARY KEY,
                    文本 TEXT NOT NULL,
                    向量 TEXT NOT NULL,
                    创建时间 TEXT
                )
            """)

            # 知识库文档表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS 知识库文档 (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    文档名 TEXT NOT NULL,
                    块序号 INTEGER,
                    内容 TEXT NOT NULL,
                    关键词 TEXT,
                    来源 TEXT,
                    创建时间 TEXT
                )
            """)
            try:
                conn.execute("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS 知识库搜索
                    USING fts5(内容, 文档名 UNINDEXED)
                """)
            except Exception:
                pass

            # 剧本表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS 剧本 (
                    名称 TEXT PRIMARY KEY,
                    内容 TEXT NOT NULL,
                    创建时间 TEXT,
                    修改时间 TEXT
                )
            """)

            conn.commit()

    def _执行(self, sql: str, 参数: list = None):
        """执行写操作（线程安全）"""
        with self._锁:
            cursor = self._连接.execute(sql, 参数 or [])
            self._连接.commit()
            return cursor

    def _查询(self, sql: str, 参数: list = None) -> list:
        """执行查询，返回Row列表"""
        with self._锁:
            cursor = self._连接.execute(sql, 参数 or [])
            return cursor.fetchall()

    # ==================== 对话记录 ====================

    def 插入对话消息(self, 对话ID: str, 角色: str, 内容: str, 时间: str = None, 推理过程: str = None):
        """插入一条对话消息"""
        时间 = 时间 or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self._执行(
            "INSERT INTO 对话记录 (对话ID, 角色, 内容, 时间, 推理过程) VALUES (?, ?, ?, ?, ?)",
            [对话ID, 角色, 内容, 时间, 推理过程]
        )
        # 同步写入全文搜索索引
        try:
            self._执行(
                "INSERT INTO 对话搜索 (内容, 对话ID, 时间) VALUES (?, ?, ?)",
                [内容, 对话ID, 时间]
            )
        except Exception:
            pass

    def 批量插入对话消息(self, 消息列表: list):
        """批量插入对话消息
        消息列表项格式: {对话ID, 角色, 内容, 时间, 推理过程}
        """
        with self._锁:
            for msg in 消息列表:
                时间 = msg.get("时间", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
                self._连接.execute(
                    "INSERT INTO 对话记录 (对话ID, 角色, 内容, 时间, 推理过程) VALUES (?, ?, ?, ?, ?)",
                    [msg["对话ID"], msg["角色"], msg["内容"], 时间, msg.get("推理过程")]
                )
                try:
                    self._连接.execute(
                        "INSERT INTO 对话搜索 (内容, 对话ID, 时间) VALUES (?, ?, ?)",
                        [msg["内容"], msg["对话ID"], 时间]
                    )
                except Exception:
                    pass
            self._连接.commit()

    def 查询对话消息(self, 对话ID: str) -> list:
        """查询指定对话的所有消息"""
        rows = self._查询(
            "SELECT 角色, 内容, 时间, 推理过程 FROM 对话记录 WHERE 对话ID = ? ORDER BY id",
            [对话ID]
        )
        return [{"角色": r[0], "内容": r[1], "时间": r[2], "推理过程": r[3]} for r in rows]

    def 删除对话(self, 对话ID: str):
        """删除指定对话的所有消息"""
        self._执行("DELETE FROM 对话记录 WHERE 对话ID = ?", [对话ID])
        try:
            self._执行("DELETE FROM 对话搜索 WHERE 对话ID = ?", [对话ID])
        except Exception:
            pass

    def 搜索对话(self, 关键词: str, limit: int = 20) -> list:
        """全文搜索对话内容（FTS5优先，无结果时回退LIKE）"""
        try:
            rows = self._查询(
                "SELECT 对话ID, snippet(对话搜索) as 片段, 时间 FROM 对话搜索 WHERE 内容 MATCH ? ORDER BY rank LIMIT ?",
                [关键词, limit]
            )
            if rows:
                return [{"对话ID": r[0], "片段": r[1], "时间": r[2]} for r in rows]
        except Exception:
            pass
        # FTS5无结果或不支持时回退LIKE查询
        rows = self._查询(
            "SELECT 对话ID, 内容, 时间 FROM 对话记录 WHERE 内容 LIKE ? ORDER BY id DESC LIMIT ?",
            [f"%{关键词}%", limit]
        )
        return [{"对话ID": r[0], "片段": r[1], "时间": r[2]} for r in rows]

    # ==================== 记忆索引 ====================

    def 插入记忆索引(self, 名称: str, 描述: str, 类型: str, 标签: list, 文件路径: str = None):
        """插入或更新记忆索引"""
        时间 = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self._执行(
            """INSERT INTO 记忆索引 (名称, 描述, 类型, 标签, 创建时间, 更新时间, 文件路径)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(名称) DO UPDATE SET 描述=?, 类型=?, 标签=?, 更新时间=?, 文件路径=?""",
            [名称, 描述, 类型, json.dumps(标签, ensure_ascii=False), 时间, 时间, 文件路径,
             描述, 类型, json.dumps(标签, ensure_ascii=False), 时间, 文件路径]
        )

    def 查询记忆索引(self, 关键词: str = None, limit: int = 50) -> list:
        """查询记忆索引，支持关键词过滤"""
        if 关键词:
            rows = self._查询(
                "SELECT 名称, 描述, 类型, 标签, 创建时间, 更新时间 FROM 记忆索引 WHERE 描述 LIKE ? OR 标签 LIKE ? ORDER BY 更新时间 DESC LIMIT ?",
                [f"%{关键词}%", f"%{关键词}%", limit]
            )
        else:
            rows = self._查询(
                "SELECT 名称, 描述, 类型, 标签, 创建时间, 更新时间 FROM 记忆索引 ORDER BY 更新时间 DESC LIMIT ?",
                [limit]
            )
        return [{
            "名称": r[0], "描述": r[1], "类型": r[2],
            "标签": json.loads(r[3]) if r[3] else [],
            "创建时间": r[4], "更新时间": r[5]
        } for r in rows]

    def 删除记忆索引(self, 名称: str):
        """删除记忆索引"""
        self._执行("DELETE FROM 记忆索引 WHERE 名称 = ?", [名称])

    # ==================== 知识库 ====================

    def 插入知识库文档(self, 文档名: str, 块序号: int, 内容: str, 关键词: str = "", 来源: str = ""):
        """插入知识库文档块"""
        时间 = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self._执行(
            "INSERT INTO 知识库文档 (文档名, 块序号, 内容, 关键词, 来源, 创建时间) VALUES (?, ?, ?, ?, ?, ?)",
            [文档名, 块序号, 内容, 关键词, 来源, 时间]
        )
        try:
            self._执行(
                "INSERT INTO 知识库搜索 (内容, 文档名) VALUES (?, ?)",
                [内容, 文档名]
            )
        except Exception:
            pass

    def 搜索知识库(self, 关键词: str, limit: int = 3) -> list:
        """全文搜索知识库（FTS5优先，无结果时回退LIKE）"""
        try:
            rows = self._查询(
                "SELECT 文档名, snippet(知识库搜索) as 片段 FROM 知识库搜索 WHERE 内容 MATCH ? ORDER BY rank LIMIT ?",
                [关键词, limit]
            )
            if rows:
                return [{"文档名": r[0], "片段": r[1]} for r in rows]
        except Exception:
            pass
        # FTS5无结果或不支持时回退LIKE查询
        rows = self._查询(
            "SELECT 文档名, 内容 FROM 知识库文档 WHERE 内容 LIKE ? LIMIT ?",
            [f"%{关键词}%", limit]
        )
        return [{"文档名": r[0], "片段": r[1][:200]} for r in rows]

    def 列出知识库文档(self) -> list:
        """列出所有知识库文档名"""
        rows = self._查询(
            "SELECT DISTINCT 文档名, COUNT(*) as 块数 FROM 知识库文档 GROUP BY 文档名 ORDER BY 文档名"
        )
        return [{"文档名": r[0], "块数": r[1]} for r in rows]

    def 删除知识库文档(self, 文档名: str):
        """删除指定知识库文档"""
        self._执行("DELETE FROM 知识库文档 WHERE 文档名 = ?", [文档名])
        try:
            self._执行("DELETE FROM 知识库搜索 WHERE 文档名 = ?", [文档名])
        except Exception:
            pass

    # ==================== 剧本 ====================

    def 保存剧本(self, 名称: str, 内容: str):
        """保存剧本（JSON字符串）"""
        时间 = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self._执行(
            """INSERT INTO 剧本 (名称, 内容, 创建时间, 修改时间)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(名称) DO UPDATE SET 内容=?, 修改时间=?""",
            [名称, 内容, 时间, 时间, 内容, 时间]
        )

    def 加载剧本(self, 名称: str) -> str:
        """加载剧本"""
        rows = self._查询("SELECT 内容 FROM 剧本 WHERE 名称 = ?", [名称])
        return rows[0][0] if rows else None

    def 列出剧本(self) -> list:
        """列出所有剧本"""
        rows = self._查询("SELECT 名称, 创建时间, 修改时间 FROM 剧本 ORDER BY 修改时间 DESC")
        return [{"名称": r[0], "创建时间": r[1], "修改时间": r[2]} for r in rows]

    def 删除剧本(self, 名称: str):
        """删除剧本"""
        self._执行("DELETE FROM 剧本 WHERE 名称 = ?", [名称])

    # ==================== 记忆向量搜索（TF-IDF，零依赖） ====================

    def 插入记忆向量(self, 名称: str, 文本: str):
        """插入或更新记忆向量（自动生成TF-IDF向量）"""
        向量 = self._生成向量(文本)
        时间 = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self._执行(
            """INSERT INTO 记忆向量 (名称, 文本, 向量, 创建时间)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(名称) DO UPDATE SET 文本=?, 向量=?, 创建时间=?""",
            [名称, 文本, json.dumps(向量, ensure_ascii=False), 时间,
             文本, json.dumps(向量, ensure_ascii=False), 时间]
        )

    def 搜索记忆向量(self, 查询文本: str, 最大数: int = 5) -> list:
        """向量相似度搜索记忆（余弦相似度，纯Python计算）"""
        查询向量 = self._生成向量(查询文本)
        if not 查询向量:
            return []
        rows = self._查询("SELECT 名称, 文本, 向量 FROM 记忆向量")
        if not rows:
            return []
        # 计算查询向量的模
        查询模 = math.sqrt(sum(v * v for v in 查询向量.values()))
        if 查询模 == 0:
            return []
        结果 = []
        for row in rows:
            名称 = row[0]
            文本 = row[1]
            try:
                文档向量 = json.loads(row[2])
            except (json.JSONDecodeError, TypeError):
                continue
            # 余弦相似度
            点积 = sum(查询向量.get(k, 0) * v for k, v in 文档向量.items())
            文档模 = math.sqrt(sum(v * v for v in 文档向量.values()))
            if 文档模 == 0:
                continue
            相似度 = 点积 / (查询模 * 文档模)
            if 相似度 > 0.01:
                结果.append({"名称": 名称, "文本": 文本[:200], "相似度": round(相似度, 4)})
        结果.sort(key=lambda x: x["相似度"], reverse=True)
        return 结果[:最大数]

    def 删除记忆向量(self, 名称: str):
        """删除记忆向量"""
        self._执行("DELETE FROM 记忆向量 WHERE 名称 = ?", [名称])

    def _生成向量(self, 文本: str) -> dict:
        """生成TF-IDF文本向量（字符bigram + 词混合，纯Python零依赖）

        将中文文本转为字符二元组(bigram)+分词特征，计算TF-IDF权重。
        不需要jieba等分词库，bigram已能捕获大量语义特征。
        """
        if not 文本 or len(文本) < 2:
            return {}
        # 1. 提取特征：字符bigram + 单字 + 英文单词
        特征 = {}
        # 字符bigram（中文语义特征核心）
        for i in range(len(文本) - 1):
            bigram = 文本[i:i+2]
            if '\n' not in bigram and '\r' not in bigram and ' ' not in bigram:
                特征[bigram] = 特征.get(bigram, 0) + 1
        # 英文单词（按空格/标点分割）
        import re
        for word in re.findall(r'[a-zA-Z_]{2,}', 文本):
            word = word.lower()
            特征[word] = 特征.get(word, 0) + 1
        # 2. 计算TF（词频归一化）
        总频 = sum(特征.values())
        if 总频 == 0:
            return {}
        tf = {k: v / 总频 for k, v in 特征.items()}
        # 3. 计算IDF（从已存储文档统计文档频率）
        df = self._统计文档频率(list(特征.keys()))
        总文档数 = df.get("_总数", 1)
        idf = {}
        for k in 特征:
            文档频 = df.get(k, 0)
            if 文档频 == 0:
                idf[k] = math.log(总文档数 + 1) + 1  # 新词给较高权重
            else:
                idf[k] = math.log((总文档数 + 1) / (文档频 + 1)) + 1
        # 4. TF-IDF = TF * IDF
        向量 = {k: tf[k] * idf[k] for k in 特征}
        return 向量

    def _统计文档频率(self, 特征列表: list) -> dict:
        """统计各特征在已有文档中出现的频率（用于IDF计算）"""
        if not 特征列表:
            return {"_总数": 1}
        rows = self._查询("SELECT 向量 FROM 记忆向量")
        总数 = len(rows)
        df = {"_总数": max(总数, 1)}
        if 总数 == 0:
            return df
        # 统计每个特征在多少个文档中出现
        for row in rows:
            try:
                文档向量 = json.loads(row[0])
                for k in 特征列表:
                    if k in 文档向量:
                        df[k] = df.get(k, 0) + 1
            except (json.JSONDecodeError, TypeError):
                continue
        return df

    # ==================== 迁移 ====================

    def 迁移对话记录(self, 对话目录: str):
        """从JSON文件迁移对话记录到SQLite
        保留原文件作为备份，不删除
        """
        目录 = Path(对话目录)
        if not 目录.exists():
            return {"迁移数": 0, "消息数": 0}

        迁移数 = 0
        消息数 = 0
        for 文件 in 目录.glob("*.json"):
            if 文件.name.startswith("_"):
                continue
            try:
                with open(文件, "r", encoding="utf-8") as f:
                    数据 = json.load(f)
                历史 = 数据.get("历史", [])
                if not 历史:
                    continue
                对话ID = 文件.stem
                消息列表 = []
                for msg in 历史:
                    消息列表.append({
                        "对话ID": 对话ID,
                        "角色": msg.get("角色", ""),
                        "内容": msg.get("内容", ""),
                        "时间": msg.get("时间", ""),
                        "推理过程": msg.get("推理过程", "")
                    })
                if 消息列表:
                    self.批量插入对话消息(消息列表)
                    迁移数 += 1
                    消息数 += len(消息列表)
            except Exception:
                continue

        return {"迁移数": 迁移数, "消息数": 消息数}

    def 关闭(self):
        """关闭数据库连接"""
        with self._锁:
            self._连接.close()


# 全局单例
_存储引擎实例 = None
_存储引擎锁 = threading.Lock()


def 获取存储引擎(路径: str = None) -> 存储引擎类:
    """获取全局存储引擎实例（单例）"""
    global _存储引擎实例
    if _存储引擎实例 is None:
        with _存储引擎锁:
            if _存储引擎实例 is None:
                if 路径 is None:
                    路径 = "./隐私区/我的数据/智能体.db"
                _存储引擎实例 = 存储引擎类(路径)
    return _存储引擎实例
