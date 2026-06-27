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

            # 推理日志表（每轮推理一条记录）
            conn.execute("""
                CREATE TABLE IF NOT EXISTS 推理日志 (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    对话ID TEXT NOT NULL,
                    轮次 INTEGER,
                    用户消息 TEXT,
                    助手回复 TEXT,
                    步数 INTEGER,
                    成功 INTEGER,
                    推理过程 TEXT,
                    llm调用摘要 TEXT,
                    时间 TEXT
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_推理日志_对话ID ON 推理日志(对话ID)")

            # 对话索引表（替代 _索引.json）
            conn.execute("""
                CREATE TABLE IF NOT EXISTS 对话索引 (
                    对话ID TEXT PRIMARY KEY,
                    标题 TEXT,
                    创建时间 TEXT,
                    更新时间 TEXT,
                    消息数 INTEGER DEFAULT 0
                )
            """)

            # 操作结果表（大结果独立存储，不污染对话历史）
            conn.execute("""
                CREATE TABLE IF NOT EXISTS 操作结果 (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    对话ID TEXT,
                    步骤 INTEGER,
                    操作名 TEXT,
                    结果 TEXT,
                    结果长度 INTEGER,
                    时间 TEXT
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_操作结果_对话ID ON 操作结果(对话ID)")
            try:
                conn.execute("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS 操作结果搜索
                    USING fts5(结果, 操作名 UNINDEXED, 对话ID UNINDEXED)
                """)
            except Exception:
                pass

            # 诊断记录表（替代运行诊断.json全量读写）
            conn.execute("""
                CREATE TABLE IF NOT EXISTS 诊断记录 (
                    id TEXT PRIMARY KEY,
                    时间 TEXT NOT NULL,
                    级别 TEXT NOT NULL,
                    来源 TEXT,
                    异常类型 TEXT,
                    异常信息 TEXT,
                    堆栈 TEXT,
                    信息 TEXT,
                    已解决 INTEGER DEFAULT 0,
                    解决说明 TEXT
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_诊断_级别 ON 诊断记录(级别)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_诊断_已解决 ON 诊断记录(已解决)")

            # 监控规则表（替代监控规则.json全量读写）
            conn.execute("""
                CREATE TABLE IF NOT EXISTS 监控规则 (
                    id TEXT PRIMARY KEY,
                    名称 TEXT,
                    目标模块 TEXT,
                    目标函数 TEXT,
                    异常类型 TEXT,
                    关键字 TEXT,
                    动作 TEXT,
                    启用 INTEGER DEFAULT 1,
                    创建者 TEXT,
                    创建时间 TEXT,
                    触发次数 INTEGER DEFAULT 0,
                    最后触发 TEXT
                )
            """)

            # KV存储表（用户画像/记忆库/摘要索引等JSON数据增量存储）
            conn.execute("""
                CREATE TABLE IF NOT EXISTS KV存储 (
                    键 TEXT PRIMARY KEY,
                    值 TEXT NOT NULL,
                    更新时间 TEXT
                )
            """)

            # 任务经验表（任务完成后自动提炼的可复用经验）
            conn.execute("""
                CREATE TABLE IF NOT EXISTS 任务经验 (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    任务描述 TEXT NOT NULL,
                    任务类型 TEXT,
                    有效方法 TEXT,
                    无效方法 TEXT,
                    下次建议 TEXT,
                    成功 INTEGER DEFAULT 0,
                    步数 INTEGER DEFAULT 0,
                    创建时间 TEXT,
                    访问次数 INTEGER DEFAULT 0,
                    最后访问 TEXT
                )
            """)
            try:
                conn.execute("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS 任务经验搜索
                    USING fts5(任务描述, 任务类型 UNINDEXED, 有效方法, 无效方法, 下次建议)
                """)
            except Exception:
                pass

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

    # ==================== 推理日志 ====================

    def 插入推理日志(self, 对话ID: str, 轮次: int, 数据: dict):
        """插入一条推理日志记录
        数据格式: {用户消息, 助手回复, 步数, 成功, 推理过程, llm调用记录}
        llm调用记录只存摘要（步骤/时间/成功/耗时），不存完整原始请求/响应
        """
        时间 = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        # 瘦身llm调用记录：只存摘要，不存完整请求/响应
        调用摘要 = []
        for 调用 in 数据.get("llm调用记录", []):
            调用摘要.append({
                "步骤": 调用.get("步骤", 0),
                "时间": 调用.get("时间", ""),
                "成功": 调用.get("成功", False),
                "耗时毫秒": 调用.get("耗时毫秒", 0)
            })
        self._执行(
            """INSERT INTO 推理日志 (对话ID, 轮次, 用户消息, 助手回复, 步数, 成功, 推理过程, llm调用摘要, 时间)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [对话ID, 轮次,
             数据.get("用户消息", "")[:5000],
             数据.get("助手回复", "")[:5000],
             数据.get("步数", 0),
             1 if 数据.get("成功", True) else 0,
             json.dumps(数据.get("推理过程", []), ensure_ascii=False),
             json.dumps(调用摘要, ensure_ascii=False),
             时间]
        )

    def 查询推理日志(self, 对话ID: str) -> list:
        """查询指定对话的所有推理日志"""
        rows = self._查询(
            "SELECT 轮次, 用户消息, 助手回复, 步数, 成功, 推理过程, llm调用摘要, 时间 FROM 推理日志 WHERE 对话ID = ? ORDER BY id",
            [对话ID]
        )
        return [{
            "轮次": r[0], "用户消息": r[1], "助手回复": r[2],
            "步数": r[3], "成功": bool(r[4]),
            "推理过程": json.loads(r[5]) if r[5] else [],
            "llm调用记录": json.loads(r[6]) if r[6] else [],
            "时间": r[7]
        } for r in rows]

    def 删除推理日志(self, 对话ID: str):
        """删除指定对话的所有推理日志"""
        self._执行("DELETE FROM 推理日志 WHERE 对话ID = ?", [对话ID])

    # ==================== 对话索引 ====================

    def 插入对话索引(self, 对话ID: str, 标题: str = "新对话", 创建时间: str = None, 更新时间: str = None):
        """插入或更新对话索引"""
        时间 = 创建时间 or datetime.now().isoformat()
        更新 = 更新时间 or 时间
        self._执行(
            """INSERT INTO 对话索引 (对话ID, 标题, 创建时间, 更新时间, 消息数)
               VALUES (?, ?, ?, ?, 0)
               ON CONFLICT(对话ID) DO UPDATE SET 标题=?, 更新时间=?""",
            [对话ID, 标题, 时间, 更新, 标题, 更新]
        )

    def 查询对话索引(self) -> list:
        """获取所有对话列表（按更新时间降序）"""
        rows = self._查询(
            "SELECT 对话ID, 标题, 创建时间, 更新时间, 消息数 FROM 对话索引 ORDER BY 更新时间 DESC"
        )
        return [{"id": r[0], "标题": r[1], "创建时间": r[2], "更新时间": r[3], "消息数": r[4]} for r in rows]

    def 更新对话索引(self, 对话ID: str, 消息数: int = None, 标题: str = None, 更新时间: str = None):
        """更新对话索引的消息数/标题/更新时间"""
        时间 = 更新时间 or datetime.now().isoformat()
        if 标题 is not None:
            self._执行(
                "UPDATE 对话索引 SET 消息数=?, 标题=?, 更新时间=? WHERE 对话ID=?",
                [消息数 or 0, 标题, 时间, 对话ID]
            )
        elif 消息数 is not None:
            self._执行(
                "UPDATE 对话索引 SET 消息数=?, 更新时间=? WHERE 对话ID=?",
                [消息数, 时间, 对话ID]
            )
        else:
            self._执行(
                "UPDATE 对话索引 SET 更新时间=? WHERE 对话ID=?",
                [时间, 对话ID]
            )

    def 删除对话索引(self, 对话ID: str):
        """删除对话索引"""
        self._执行("DELETE FROM 对话索引 WHERE 对话ID = ?", [对话ID])

    # ==================== 操作结果 ====================

    def 插入操作结果(self, 对话ID: str, 步骤: int, 操作名: str, 结果: str):
        """存储操作执行结果（大结果独立存储，不污染对话历史）"""
        时间 = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self._执行(
            "INSERT INTO 操作结果 (对话ID, 步骤, 操作名, 结果, 结果长度, 时间) VALUES (?, ?, ?, ?, ?, ?)",
            [对话ID, 步骤, 操作名, 结果, len(结果), 时间]
        )
        try:
            self._执行(
                "INSERT INTO 操作结果搜索 (结果, 操作名, 对话ID) VALUES (?, ?, ?)",
                [结果, 操作名, 对话ID]
            )
        except Exception:
            pass

    def 搜索操作结果(self, 关键词: str, 对话ID: str = None, limit: int = 10) -> list:
        """搜索操作结果（FTS5优先，无结果时回退LIKE）"""
        try:
            if 对话ID:
                rows = self._查询(
                    "SELECT 操作名, snippet(操作结果搜索) as 片段, 时间 FROM 操作结果搜索 WHERE 结果 MATCH ? AND 对话ID = ? ORDER BY rank LIMIT ?",
                    [关键词, 对话ID, limit]
                )
            else:
                rows = self._查询(
                    "SELECT 操作名, snippet(操作结果搜索) as 片段, 时间 FROM 操作结果搜索 WHERE 结果 MATCH ? ORDER BY rank LIMIT ?",
                    [关键词, limit]
                )
            if rows:
                return [{"操作名": r[0], "片段": r[1], "时间": r[2]} for r in rows]
        except Exception:
            pass
        # 回退LIKE查询
        if 对话ID:
            rows = self._查询(
                "SELECT 操作名, 结果, 时间 FROM 操作结果 WHERE 对话ID = ? AND 结果 LIKE ? ORDER BY id DESC LIMIT ?",
                [对话ID, f"%{关键词}%", limit]
            )
        else:
            rows = self._查询(
                "SELECT 操作名, 结果, 时间 FROM 操作结果 WHERE 结果 LIKE ? ORDER BY id DESC LIMIT ?",
                [f"%{关键词}%", limit]
            )
        return [{"操作名": r[0], "片段": r[1][:500], "时间": r[2]} for r in rows]

    def 删除操作结果(self, 对话ID: str):
        """删除指定对话的所有操作结果"""
        self._执行("DELETE FROM 操作结果 WHERE 对话ID = ?", [对话ID])
        try:
            self._执行("DELETE FROM 操作结果搜索 WHERE 对话ID = ?", [对话ID])
        except Exception:
            pass

    # ==================== 诊断记录 ====================

    def 插入诊断记录(self, 记录: dict):
        """插入一条诊断记录（增量，不全量读写）"""
        self._执行(
            """INSERT OR REPLACE INTO 诊断记录
               (id, 时间, 级别, 来源, 异常类型, 异常信息, 堆栈, 信息, 已解决, 解决说明)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [记录.get("id", ""), 记录.get("时间", ""), 记录.get("级别", "错误"),
             记录.get("来源", ""), 记录.get("异常类型", ""), 记录.get("异常信息", ""),
             记录.get("堆栈", ""), 记录.get("信息", ""),
             1 if 记录.get("已解决", False) else 0, 记录.get("解决说明", "")]
        )

    def 查询诊断记录(self, 级别: str = None, 未解决Only: bool = False, 最近数: int = 200) -> list:
        """查询诊断记录（增量查询，不全量读取）"""
        sql = "SELECT id, 时间, 级别, 来源, 异常类型, 异常信息, 堆栈, 信息, 已解决, 解决说明 FROM 诊断记录 WHERE 1=1"
        参数 = []
        if 级别:
            sql += " AND 级别 = ?"
            参数.append(级别)
        if 未解决Only:
            sql += " AND 已解决 = 0"
        sql += " ORDER BY id DESC LIMIT ?"
        参数.append(最近数)
        rows = self._查询(sql, 参数)
        return [{
            "id": r[0], "时间": r[1], "级别": r[2], "来源": r[3],
            "异常类型": r[4], "异常信息": r[5], "堆栈": r[6], "信息": r[7],
            "已解决": bool(r[8]), "解决说明": r[9]
        } for r in rows]

    def 解决诊断记录(self, 记录ID: str = "", 全部未解决: bool = False, 解决说明: str = "") -> int:
        """标记诊断记录为已解决，返回标记数量"""
        if 全部未解决:
            cursor = self._执行(
                "UPDATE 诊断记录 SET 已解决=1, 解决说明=? WHERE 已解决=0",
                [解决说明 or "AI批量标记已解决"]
            )
        else:
            cursor = self._执行(
                "UPDATE 诊断记录 SET 已解决=1, 解决说明=? WHERE id=?",
                [解决说明, 记录ID]
            )
        return cursor.rowcount

    def 清除已解决诊断(self) -> dict:
        """清除所有已解决的诊断记录"""
        cursor = self._执行("DELETE FROM 诊断记录 WHERE 已解决=1")
        return {"清除数": cursor.rowcount}

    def 诊断统计(self) -> dict:
        """获取诊断统计"""
        rows = self._查询("SELECT 级别, COUNT(*) FROM 诊断记录 GROUP BY 级别")
        统计 = {}
        for r in rows:
            统计[r[0]] = r[1]
        return {"总错误": 统计.get("错误", 0), "总警告": 统计.get("警告", 0)}

    # ==================== 监控规则 ====================

    def 插入监控规则(self, 规则: dict):
        """插入或更新监控规则（增量）"""
        self._执行(
            """INSERT OR REPLACE INTO 监控规则
               (id, 名称, 目标模块, 目标函数, 异常类型, 关键字, 动作, 启用, 创建者, 创建时间, 触发次数, 最后触发)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [规则.get("id", ""), 规则.get("名称", ""), 规则.get("目标模块", ""),
             规则.get("目标函数", ""), 规则.get("异常类型", ""), 规则.get("关键字", ""),
             规则.get("动作", "记录"), 1 if 规则.get("启用", True) else 0,
             规则.get("创建者", "AI"), 规则.get("创建时间", ""),
             规则.get("触发次数", 0), 规则.get("最后触发", "")]
        )

    def 查询监控规则(self) -> list:
        """查询所有监控规则"""
        rows = self._查询("SELECT id, 名称, 目标模块, 目标函数, 异常类型, 关键字, 动作, 启用, 创建者, 创建时间, 触发次数, 最后触发 FROM 监控规则 ORDER BY id")
        return [{
            "id": r[0], "名称": r[1], "目标模块": r[2], "目标函数": r[3],
            "异常类型": r[4], "关键字": r[5], "动作": r[6], "启用": bool(r[7]),
            "创建者": r[8], "创建时间": r[9], "触发次数": r[10], "最后触发": r[11]
        } for r in rows]

    def 删除监控规则(self, 规则ID: str) -> bool:
        """删除监控规则"""
        cursor = self._执行("DELETE FROM 监控规则 WHERE id = ?", [规则ID])
        return cursor.rowcount > 0

    def 更新规则触发(self, 规则ID: str, 触发时间: str):
        """更新规则触发次数和最后触发时间（增量UPDATE）"""
        self._执行(
            "UPDATE 监控规则 SET 触发次数 = 触发次数 + 1, 最后触发 = ? WHERE id = ?",
            [触发时间, 规则ID]
        )

    # ==================== KV存储 ====================

    def 写入KV(self, 键: str, 值: str):
        """写入KV存储（INSERT OR REPLACE，增量）"""
        时间 = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self._执行(
            "INSERT INTO KV存储 (键, 值, 更新时间) VALUES (?, ?, ?) ON CONFLICT(键) DO UPDATE SET 值=?, 更新时间=?",
            [键, 值, 时间, 值, 时间]
        )

    def 写入KV_JSON(self, 键: str, 值: dict):
        """写入KV存储（JSON序列化）"""
        self.写入KV(键, json.dumps(值, ensure_ascii=False))

    def 读取KV(self, 键: str) -> str:
        """读取KV存储"""
        rows = self._查询("SELECT 值 FROM KV存储 WHERE 键 = ?", [键])
        return rows[0][0] if rows else None

    def 读取KV_JSON(self, 键: str, 默认值: dict = None) -> dict:
        """读取KV存储（JSON反序列化）"""
        值 = self.读取KV(键)
        if 值 is None:
            return 默认值 if 默认值 is not None else {}
        try:
            return json.loads(值)
        except (json.JSONDecodeError, TypeError):
            return 默认值 if 默认值 is not None else {}

    def 删除KV(self, 键: str):
        """删除KV"""
        self._执行("DELETE FROM KV存储 WHERE 键 = ?", [键])

    # ==================== 任务经验 ====================

    def 插入任务经验(self, 经验: dict):
        """插入一条任务经验卡片"""
        时间 = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self._执行(
            """INSERT INTO 任务经验
               (任务描述, 任务类型, 有效方法, 无效方法, 下次建议, 成功, 步数, 创建时间, 访问次数, 最后访问)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)""",
            [经验.get("任务描述", ""), 经验.get("任务类型", ""),
             经验.get("有效方法", ""), 经验.get("无效方法", ""),
             经验.get("下次建议", ""),
             1 if 经验.get("成功", False) else 0,
             经验.get("步数", 0), 时间, ""]
        )
        # 同步写入FTS5搜索索引
        try:
            self._执行(
                "INSERT INTO 任务经验搜索 (任务描述, 任务类型, 有效方法, 无效方法, 下次建议) VALUES (?, ?, ?, ?, ?)",
                [经验.get("任务描述", ""), 经验.get("任务类型", ""),
                 经验.get("有效方法", ""), 经验.get("无效方法", ""),
                 经验.get("下次建议", "")]
            )
        except Exception:
            pass

    def 搜索任务经验(self, 关键词: str, limit: int = 3) -> list:
        """搜索相关任务经验（FTS5优先，回退LIKE）"""
        try:
            rows = self._查询(
                "SELECT 任务描述, 任务类型, 有效方法, 无效方法, 下次建议, 成功, id FROM 任务经验搜索 "
                "WHERE 任务描述 MATCH ? OR 有效方法 MATCH ? OR 下次建议 MATCH ? "
                "ORDER BY rank LIMIT ?",
                [关键词, 关键词, 关键词, limit]
            )
            if rows:
                # 更新访问次数
                for r in rows:
                    self._执行(
                        "UPDATE 任务经验 SET 访问次数 = 访问次数 + 1, 最后访问 = ? WHERE id = ?",
                        [datetime.now().strftime("%Y-%m-%d %H:%M:%S"), r[6]]
                    )
                return [{
                    "任务描述": r[0], "任务类型": r[1], "有效方法": r[2],
                    "无效方法": r[3], "下次建议": r[4], "成功": bool(r[5])
                } for r in rows]
        except Exception:
            pass
        # 回退LIKE查询
        rows = self._查询(
            "SELECT 任务描述, 任务类型, 有效方法, 无效方法, 下次建议, 成功, id FROM 任务经验 "
            "WHERE 任务描述 LIKE ? OR 有效方法 LIKE ? OR 下次建议 LIKE ? "
            "ORDER BY 访问次数 DESC, id DESC LIMIT ?",
            [f"%{关键词}%", f"%{关键词}%", f"%{关键词}%", limit]
        )
        return [{
            "任务描述": r[0], "任务类型": r[1], "有效方法": r[2],
            "无效方法": r[3], "下次建议": r[4], "成功": bool(r[5])
        } for r in rows]

    def 查询最近经验(self, limit: int = 10) -> list:
        """查询最近的任务经验"""
        rows = self._查询(
            "SELECT 任务描述, 任务类型, 有效方法, 无效方法, 下次建议, 成功 FROM 任务经验 "
            "ORDER BY id DESC LIMIT ?",
            [limit]
        )
        return [{
            "任务描述": r[0], "任务类型": r[1], "有效方法": r[2],
            "无效方法": r[3], "下次建议": r[4], "成功": bool(r[5])
        } for r in rows]

    # ==================== 迁移 ====================

    def 迁移对话记录(self, 对话目录: str):
        """从JSON文件迁移对话记录到SQLite
        迁移对话历史+推理日志+对话索引，保留原文件作为备份
        """
        目录 = Path(对话目录)
        if not 目录.exists():
            return {"迁移数": 0, "消息数": 0, "推理日志数": 0}

        迁移数 = 0
        消息数 = 0
        推理日志数 = 0
        for 文件 in 目录.glob("*.json"):
            if 文件.name.startswith("_"):
                continue
            try:
                with open(文件, "r", encoding="utf-8") as f:
                    数据 = json.load(f)
                对话ID = 文件.stem
                # 迁移对话历史
                历史 = 数据.get("历史", [])
                if 历史:
                    消息列表 = []
                    for msg in 历史:
                        消息列表.append({
                            "对话ID": 对话ID,
                            "角色": msg.get("角色", ""),
                            "内容": msg.get("内容", ""),
                            "时间": msg.get("时间", ""),
                            "推理过程": msg.get("推理过程", "")
                        })
                    self.批量插入对话消息(消息列表)
                    消息数 += len(消息列表)
                # 迁移推理日志
                推理日志列表 = 数据.get("推理日志", [])
                for i, log in enumerate(推理日志列表):
                    self.插入推理日志(对话ID, i + 1, {
                        "用户消息": log.get("用户消息", ""),
                        "助手回复": log.get("助手回复", ""),
                        "步数": log.get("步数", 0),
                        "成功": log.get("成功", True),
                        "推理过程": log.get("推理过程", []),
                        "llm调用记录": log.get("llm调用记录", [])
                    })
                    推理日志数 += 1
                # 迁移对话索引
                标题 = 对话ID
                if 历史:
                    首条 = 历史[0].get("内容", "")
                    标题 = 首条[:20].replace("\n", " ").strip() + ("..." if len(首条) > 20 else "")
                保存时间 = 数据.get("保存时间", "")
                创建时间 = 历史[0].get("时间", 保存时间) if 历史 else 保存时间
                self.插入对话索引(对话ID, 标题, 创建时间, 保存时间)
                if 消息数 or 历史:
                    self.更新对话索引(对话ID, 消息数=len(历史))
                迁移数 += 1
            except Exception:
                continue

        return {"迁移数": 迁移数, "消息数": 消息数, "推理日志数": 推理日志数}

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
