"""
股票数据缓存引擎 — Cache-Aside模式 + SQLite持久化 + 交易日智能TTL

设计参考: QuantDB (github.com/franksunye/quantdb)
- 盘中: 短TTL(15秒) 实时刷新
- 盘后: 长TTL(4小时) 避免重复请求
- 非交易日: 永不过期
- 增量更新: K线只拉缺失日期
"""

import sqlite3
import threading
import json
import time
from datetime import datetime, timedelta
from pathlib import Path


class 股票缓存引擎:
    """SQLite持久化缓存，线程安全"""

    def __init__(self, 数据库路径: str = None):
        if 数据库路径 is None:
            数据库路径 = str(Path(__file__).parent.parent.parent / "隐私区" / "我的数据" / "股票缓存.db")
        self.数据库路径 = 数据库路径
        self._锁 = threading.Lock()
        self._初始化数据库()

    def _获取连接(self):
        conn = sqlite3.connect(self.数据库路径, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def _初始化数据库(self):
        with self._锁:
            conn = self._获取连接()
            try:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS 股票缓存 (
                        缓存键 TEXT PRIMARY KEY,
                        数据类型 TEXT NOT NULL,
                        数据内容 TEXT NOT NULL,
                        更新时间 TEXT NOT NULL,
                        过期时间 REAL NOT NULL
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS K线增量 (
                        代码 TEXT NOT NULL,
                        周期 TEXT NOT NULL,
                        最后日期 TEXT NOT NULL,
                        更新时间 TEXT NOT NULL,
                        PRIMARY KEY (代码, 周期)
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS K线数据 (
                        代码 TEXT NOT NULL,
                        周期 TEXT NOT NULL,
                        日期 TEXT NOT NULL,
                        开 REAL, 收 REAL, 高 REAL, 低 REAL,
                        量 REAL, 额 REAL,
                        PRIMARY KEY (代码, 周期, 日期)
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS A股列表 (
                        代码 TEXT PRIMARY KEY,
                        名称 TEXT,
                        市场 TEXT,
                        更新时间 TEXT
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS 财务数据 (
                        代码 TEXT PRIMARY KEY,
                        名称 TEXT,
                        市盈率 REAL,
                        市净率 REAL,
                        总市值 REAL,
                        流通市值 REAL,
                        净资产收益率 REAL,
                        每股收益 REAL,
                        每股净资产 REAL,
                        股东人数 INTEGER,
                        户均持股 REAL,
                        营业收入 REAL,
                        归属净利润 REAL,
                        营收同比增长 REAL,
                        净利润同比增长 REAL,
                        报告期 TEXT,
                        更新时间 TEXT
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS 下载检查点 (
                        任务名 TEXT PRIMARY KEY,
                        阶段 TEXT,
                        已完成代码 TEXT,
                        失败列表 TEXT,
                        总数 INTEGER,
                        已完成数 INTEGER,
                        失败数 INTEGER,
                        更新时间 TEXT
                    )
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_缓存类型 ON 股票缓存(数据类型)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_kline_代码 ON K线数据(代码)")
                conn.commit()
            finally:
                conn.close()

    # ============ 交易日判断 ============

    def _当前时间(self) -> datetime:
        return datetime.now()

    def _是否交易日(self) -> bool:
        """判断今天是否为交易日（周一~周五，排除节假日粗略判断）"""
        now = self._当前时间()
        # 周末不交易
        if now.weekday() >= 5:
            return False
        # 简单节假日判断（可后续扩展）
        节假日 = [
            ("01-01",), ("01-02",), ("01-03",),  # 元旦
            ("05-01",), ("05-02",), ("05-03",),  # 劳动节
            ("10-01",), ("10-02",), ("10-03",), ("10-04",),
            ("10-05",), ("10-06",), ("10-07",),  # 国庆
        ]
        mmdd = now.strftime("%m-%d")
        for hd in 节假日:
            if mmdd == hd[0]:
                return False
        return True

    def _是否盘中(self) -> bool:
        """判断当前是否在交易时间段 (9:25-11:30, 13:00-15:00)"""
        if not self._是否交易日():
            return False
        now = self._当前时间()
        t = now.hour * 100 + now.minute
        return (925 <= t <= 1130) or (1300 <= t <= 1500)

    def _计算TTL(self, 数据类型: str) -> float:
        """根据数据类型和交易状态计算TTL（秒）"""
        if self._是否盘中():
            ttl_map = {
                "panel": 15,       # 盘面15秒
                "kline": 30,        # K线30秒
                "minute": 10,       # 分时10秒
                "detail": 30,       # 详情30秒
                "search": 86400,   # 搜索结果缓存1天
                "sectors": 30,      # 板块30秒
                "flow": 60,         # 资金流向60秒
                "batch": 15,        # 批量行情15秒
            }
        elif self._是否交易日():
            # 盘后但仍是交易日：长缓存
            ttl_map = {
                "panel": 3600, "kline": 14400, "minute": 3600,
                "detail": 7200, "search": 86400, "sectors": 3600,
                "flow": 7200, "batch": 1800,
            }
        else:
            # 非交易日：永不过期（返回7天）
            ttl_map = {
                "panel": 604800, "kline": 604800, "minute": 604800,
                "detail": 604800, "search": 604800, "sectors": 604800,
                "flow": 604800, "batch": 604800,
            }
        return ttl_map.get(数据类型, 60)

    # ============ Cache-Aside 核心方法 ============

    def 读取缓存(self, 缓存键: str, 数据类型: str) -> dict:
        """读取缓存，未命中或过期返回None"""
        with self._锁:
            conn = self._获取连接()
            try:
                row = conn.execute(
                    "SELECT 数据内容, 过期时间 FROM 股票缓存 WHERE 缓存键=?",
                    (缓存键,)
                ).fetchone()
                if not row:
                    return None
                数据内容, 过期时间戳 = row
                # 检查是否过期
                if time.time() > 过期时间戳:
                    return None
                return json.loads(数据内容)
            except Exception:
                return None
            finally:
                conn.close()

    def 写入缓存(self, 缓存键: str, 数据类型: str, 数据: dict):
        """写入缓存，自动计算TTL"""
        ttl = self._计算TTL(数据类型)
        过期时间 = time.time() + ttl
        with self._锁:
            conn = self._获取连接()
            try:
                conn.execute(
                    "INSERT OR REPLACE INTO 股票缓存 (缓存键, 数据类型, 数据内容, 更新时间, 过期时间) VALUES (?,?,?,?,?)",
                    (缓存键, 数据类型, json.dumps(数据, ensure_ascii=False),
                     self._当前时间().strftime("%Y-%m-%d %H:%M:%S"), 过期时间)
                )
                conn.commit()
            except Exception:
                pass
            finally:
                conn.close()

    def 读取或请求(self, 缓存键: str, 数据类型: str, 请求函数):
        """Cache-Aside: 先查缓存，未命中则请求并写入"""
        cached = self.读取缓存(缓存键, 数据类型)
        if cached is not None:
            cached["_缓存命中"] = True
            return cached
        # 缓存未命中，请求数据
        数据 = 请求函数()
        if 数据 and 数据.get("成功", False):
            self.写入缓存(缓存键, 数据类型, 数据)
        数据["_缓存命中"] = False
        return 数据

    # ============ K线增量更新 ============

    def 获取K线最后日期(self, 代码: str, 周期: str) -> str:
        """获取本地K线缓存的最后日期，用于增量更新"""
        with self._锁:
            conn = self._获取连接()
            try:
                row = conn.execute(
                    "SELECT 最后日期 FROM K线增量 WHERE 代码=? AND 周期=?",
                    (代码, 周期)
                ).fetchone()
                return row[0] if row else None
            except Exception:
                return None
            finally:
                conn.close()

    def 更新K线最后日期(self, 代码: str, 周期: str, 最后日期: str):
        """更新K线缓存的最后日期"""
        with self._锁:
            conn = self._获取连接()
            try:
                conn.execute(
                    "INSERT OR REPLACE INTO K线增量 (代码, 周期, 最后日期, 更新时间) VALUES (?,?,?,?)",
                    (代码, 周期, 最后日期, self._当前时间().strftime("%Y-%m-%d %H:%M:%S"))
                )
                conn.commit()
            except Exception:
                pass
            finally:
                conn.close()

    # ============ 管理方法 ============

    def 获取缓存统计(self) -> dict:
        """获取缓存统计信息"""
        with self._锁:
            conn = self._获取连接()
            try:
                total = conn.execute("SELECT COUNT(*) FROM 股票缓存").fetchone()[0]
                expired = conn.execute(
                    "SELECT COUNT(*) FROM 股票缓存 WHERE 过期时间 < ?",
                    (time.time(),)
                ).fetchone()[0]
                valid = total - expired
                by_type = {}
                for row in conn.execute(
                    "SELECT 数据类型, COUNT(*) FROM 股票缓存 GROUP BY 数据类型"
                ).fetchall():
                    by_type[row[0]] = row[1]
                kline_count = conn.execute("SELECT COUNT(*) FROM K线增量").fetchone()[0]
                return {
                    "总缓存数": total,
                    "有效缓存": valid,
                    "已过期": expired,
                    "K线增量记录": kline_count,
                    "各类型": by_type,
                    "是否盘中": self._是否盘中(),
                    "是否交易日": self._是否交易日(),
                    "当前时间": self._当前时间().strftime("%Y-%m-%d %H:%M:%S")
                }
            except Exception as e:
                return {"错误": str(e)}
            finally:
                conn.close()

    def 清空缓存(self):
        """清空所有股票缓存"""
        with self._锁:
            conn = self._获取连接()
            try:
                conn.execute("DELETE FROM 股票缓存")
                conn.execute("DELETE FROM K线增量")
                conn.commit()
            finally:
                conn.close()

    def 清理过期(self):
        """清理过期缓存"""
        with self._锁:
            conn = self._获取连接()
            try:
                conn.execute("DELETE FROM 股票缓存 WHERE 过期时间 < ?", (time.time(),))
                conn.commit()
            finally:
                conn.close()

    # ============ K线数据持久化存储 ============

    def 存K线数据(self, 代码: str, 周期: str, 数据列表: list):
        """将K线数据批量写入SQLite（增量：跳过已存在的日期）"""
        if not 数据列表:
            return
        with self._锁:
            conn = self._获取连接()
            try:
                rows = [(代码, 周期, d["日期"], d["开"], d["收"], d["高"], d["低"], d["量"], d["额"]) for d in 数据列表]
                conn.executemany("INSERT OR REPLACE INTO K线数据 (代码,周期,日期,开,收,高,低,量,额) VALUES (?,?,?,?,?,?,?,?,?)", rows)
                最后日期 = 数据列表[-1]["日期"]
                conn.execute("INSERT OR REPLACE INTO K线增量 (代码,周期,最后日期,更新时间) VALUES (?,?,?,?)",
                             (代码, 周期, 最后日期, self._当前时间().strftime("%Y-%m-%d %H:%M:%S")))
                conn.commit()
            finally:
                conn.close()

    def 取K线数据(self, 代码: str, 周期: str, limit: int = 0) -> list:
        """从本地SQLite读取K线数据"""
        with self._锁:
            conn = self._获取连接()
            try:
                sql = "SELECT 日期,开,收,高,低,量,额 FROM K线数据 WHERE 代码=? AND 周期=? ORDER BY 日期"
                if limit > 0:
                    sql += f" DESC LIMIT {limit}"
                    rows = conn.execute(sql, (代码, 周期)).fetchall()
                    return [{"日期": r[0], "开": r[1], "收": r[2], "高": r[3], "低": r[4], "量": r[5], "额": r[6]} for r in reversed(rows)]
                rows = conn.execute(sql, (代码, 周期)).fetchall()
                return [{"日期": r[0], "开": r[1], "收": r[2], "高": r[3], "低": r[4], "量": r[5], "额": r[6]} for r in rows]
            except Exception:
                return []
            finally:
                conn.close()

    def 存A股列表(self, 股票列表: list):
        """保存A股股票列表"""
        with self._锁:
            conn = self._获取连接()
            try:
                conn.execute("DELETE FROM A股列表")
                rows = [(s["代码"], s.get("名称", ""), s.get("市场", ""), self._当前时间().strftime("%Y-%m-%d %H:%M:%S")) for s in 股票列表]
                conn.executemany("INSERT OR REPLACE INTO A股列表 (代码,名称,市场,更新时间) VALUES (?,?,?,?)", rows)
                conn.commit()
            finally:
                conn.close()

    def 取A股列表(self) -> list:
        """读取A股股票列表"""
        with self._锁:
            conn = self._获取连接()
            try:
                rows = conn.execute("SELECT 代码,名称,市场 FROM A股列表").fetchall()
                return [{"代码": r[0], "名称": r[1], "市场": r[2]} for r in rows]
            except Exception:
                return []
            finally:
                conn.close()

    def 取本地K线统计(self) -> dict:
        """统计本地已下载的K线数据"""
        with self._锁:
            conn = self._获取连接()
            try:
                total = conn.execute("SELECT COUNT(DISTINCT 代码) FROM K线数据").fetchone()[0]
                rows = conn.execute("SELECT COUNT(*) FROM K线数据").fetchone()[0]
                dates = conn.execute("SELECT MIN(日期), MAX(日期) FROM K线数据").fetchone()
                a股总数 = conn.execute("SELECT COUNT(*) FROM A股列表").fetchone()[0]
                return {
                    "已下载股票数": total,
                    "A股总数": a股总数,
                    "总K线条数": rows,
                    "最早日期": dates[0] if dates[0] else "",
                    "最新日期": dates[1] if dates[1] else ""
                }
            except Exception as e:
                return {"错误": str(e)}
            finally:
                conn.close()

    def 取本地K线代码列表(self) -> list:
        """从K线数据表提取所有已有代码（远程获取A股列表失败时的兜底）"""
        with self._锁:
            conn = self._获取连接()
            try:
                rows = conn.execute("SELECT DISTINCT 代码 FROM K线数据").fetchall()
                return [{"代码": r[0], "名称": r[0], "市场": ""} for r in rows]
            except Exception:
                return []
            finally:
                conn.close()

    # ============ 财务数据存储 ============

    def 存财务数据(self, 数据: dict):
        """存储单只股票的财务数据"""
        if not 数据 or not 数据.get("代码"):
            return
        with self._锁:
            conn = self._获取连接()
            try:
                conn.execute("""INSERT OR REPLACE INTO 财务数据
                    (代码,名称,市盈率,市净率,总市值,流通市值,净资产收益率,每股收益,每股净资产,股东人数,户均持股,营业收入,归属净利润,营收同比增长,净利润同比增长,报告期,更新时间)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (数据["代码"], 数据.get("名称",""), 数据.get("市盈率"), 数据.get("市净率"),
                     数据.get("总市值"), 数据.get("流通市值"), 数据.get("净资产收益率"),
                     数据.get("每股收益"), 数据.get("每股净资产"), 数据.get("股东人数"),
                     数据.get("户均持股"), 数据.get("营业收入"), 数据.get("归属净利润"),
                     数据.get("营收同比增长"), 数据.get("净利润同比增长"),
                     数据.get("报告期",""),
                     self._当前时间().strftime("%Y-%m-%d %H:%M:%S")))
                conn.commit()
            finally:
                conn.close()

    def 取财务数据(self, 代码: str) -> dict:
        """读取单只股票的财务数据"""
        with self._锁:
            conn = self._获取连接()
            try:
                row = conn.execute("SELECT * FROM 财务数据 WHERE 代码=?", (代码,)).fetchone()
                if not row:
                    return {}
                列名 = ["代码","名称","市盈率","市净率","总市值","流通市值","净资产收益率","每股收益","每股净资产","股东人数","户均持股","营业收入","归属净利润","营收同比增长","净利润同比增长","报告期","更新时间"]
                return dict(zip(列名, row))
            except Exception:
                return {}
            finally:
                conn.close()

    def 取财务数据统计(self) -> dict:
        """统计本地财务数据"""
        with self._锁:
            conn = self._获取连接()
            try:
                total = conn.execute("SELECT COUNT(*) FROM 财务数据").fetchone()[0]
                有ROE = conn.execute("SELECT COUNT(*) FROM 财务数据 WHERE 净资产收益率 IS NOT NULL").fetchone()[0]
                有股东数 = conn.execute("SELECT COUNT(*) FROM 财务数据 WHERE 股东人数 IS NOT NULL").fetchone()[0]
                return {"已下载财务数据": total, "有ROE": 有ROE, "有股东人数": 有股东数}
            except Exception as e:
                return {"错误": str(e)}
            finally:
                conn.close()

    # ============ 下载检查点 ============

    def 存检查点(self, 任务名: str, 阶段: str, 已完成代码: list, 失败列表: list, 总数: int, 已完成数: int, 失败数: int):
        """保存下载进度检查点（支持断点续传）"""
        with self._锁:
            conn = self._获取连接()
            try:
                conn.execute("""INSERT OR REPLACE INTO 下载检查点
                    (任务名,阶段,已完成代码,失败列表,总数,已完成数,失败数,更新时间)
                    VALUES (?,?,?,?,?,?,?,?)""",
                    (任务名, 阶段, json.dumps(已完成代码, ensure_ascii=False),
                     json.dumps(失败列表, ensure_ascii=False), 总数, 已完成数, 失败数,
                     self._当前时间().strftime("%Y-%m-%d %H:%M:%S")))
                conn.commit()
            finally:
                conn.close()

    def 取检查点(self, 任务名: str) -> dict:
        """读取下载检查点"""
        with self._锁:
            conn = self._获取连接()
            try:
                row = conn.execute("SELECT * FROM 下载检查点 WHERE 任务名=?", (任务名,)).fetchone()
                if not row:
                    return None
                列名 = ["任务名","阶段","已完成代码","失败列表","总数","已完成数","失败数","更新时间"]
                r = dict(zip(列名, row))
                r["已完成代码"] = json.loads(r["已完成代码"]) if r["已完成代码"] else []
                r["失败列表"] = json.loads(r["失败列表"]) if r["失败列表"] else []
                return r
            except Exception:
                return None
            finally:
                conn.close()

    def 删检查点(self, 任务名: str):
        with self._锁:
            conn = self._获取连接()
            try:
                conn.execute("DELETE FROM 下载检查点 WHERE 任务名=?", (任务名,))
                conn.commit()
            finally:
                conn.close()


class 全量下载引擎:
    """A股全量K线+财务数据多线程下载器（对齐GitHub主流架构）

    架构参考: QuantDB / Tushare+AKShare双源方案
    - ThreadPoolExecutor 线程池 (替代手动Thread)
    - 限速保护 (请求间隔控制，防止IP被封)
    - 断点续传 (检查点持久化到SQLite，中断后从断点恢复)
    - 指数退避重试 (1s→2s→4s)
    - 错误详情追踪 (记录失败股票+原因)
    - 数据校验 (条数/日期连续性检查)
    """

    def __init__(self, 缓存引擎: 股票缓存引擎):
        self.缓存 = 缓存引擎
        self._停止 = False
        self._进度 = {"状态": "空闲", "总数": 0, "已完成": 0, "失败": 0, "跳过": 0, "当前代码": "", "开始时间": 0, "耗时秒": 0, "阶段": "", "失败详情": [], "数据源": ""}
        self._锁 = threading.Lock()
        self._线程 = None
        self._线程数 = 8   # K线阶段8线程
        self._请求间隔 = 0.15  # K线阶段限速0.15秒
        self._上次请求时间 = 0
        self._限速锁 = threading.Lock()
        self._last_error = ""

    def 获取进度(self) -> dict:
        with self._锁:
            p = dict(self._进度)
            if p["开始时间"] > 0:
                p["耗时秒"] = round(time.time() - p["开始时间"], 1)
                if p["已完成"] > 0 and p["耗时秒"] > 0:
                    p["速度每秒"] = round(p["已完成"] / p["耗时秒"], 1)
                    剩余 = p["总数"] - p["已完成"] - p["失败"] - p["跳过"]
                    p["预计剩余秒"] = round(剩余 / p["速度每秒"], 0) if p["速度每秒"] > 0 else 0
            return p

    def 停止(self):
        self._停止 = True
        with self._锁:
            self._进度["状态"] = "正在停止..."

    def _更新进度(self, **kwargs):
        with self._锁:
            self._进度.update(kwargs)

    def _限速等待(self):
        """请求间隔控制，防止IP被封（专用锁，线程间串行等待）"""
        with self._限速锁:
            elapsed = time.time() - self._上次请求时间
            if elapsed < self._请求间隔:
                time.sleep(self._请求间隔 - elapsed)
            self._上次请求时间 = time.time()

    def _指数退避重试(self, 请求函数, max_retries=3):
        """指数退避重试 (1s→2s→4s)，返回 (结果, 错误信息)"""
        last_error = None
        for attempt in range(max_retries):
            if self._停止:
                return None, "已停止"
            try:
                self._限速等待()
                result = 请求函数()
                return result, None
            except Exception as e:
                last_error = str(e)
                if attempt < max_retries - 1:
                    wait = 2 ** attempt  # 1s, 2s, 4s
                    time.sleep(wait)
        return None, last_error

    def 获取A股列表(self):
        """获取全部A股列表（东财优先，失败切新浪）"""
        self._更新进度(数据源="尝试东财...")
        结果 = self._获取A股列表_东财()
        if 结果:
            self._更新进度(数据源="东财")
            return 结果
        # 东财失败，切新浪
        self._更新进度(状态="东财失败，切换新浪数据源...", 数据源="尝试新浪...")
        结果 = self._获取A股列表_新浪()
        if 结果:
            self._更新进度(数据源="新浪")
        return 结果

    def _获取A股列表_东财(self):
        """从东财获取全部A股代码列表+基础财务指标"""
        import urllib.request
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Referer": "https://quote.eastmoney.com/"}
        # pz=10000确保覆盖全部A股（沪深主板+创业板+科创板+北交所），fs增加北交所m:0+t:81
        url = "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=10000&po=1&np=1&fltt=2&invt=2&fields=f2,f3,f9,f12,f14,f20,f21,f23&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81&fid=f3"

        def _请求():
            req = urllib.request.Request(url, headers=headers)
            resp = urllib.request.urlopen(req, timeout=10)
            return json.loads(resp.read().decode("utf-8"))

        data, err = self._指数退避重试(_请求, max_retries=3)
        if not data or not data.get("data"):
            self._last_error = err or "东财无数据"
            return []

        结果 = []
        diff_list = data.get("data", {})
        if diff_list:
            diff_list = diff_list.get("diff", []) or []
        for item in diff_list:
            代码 = item.get("f12", "")
            名称 = item.get("f14", "")
            if not 代码:
                continue
            # 名称为空时用代码作为名称（停牌/退市整理期等）
            if not 名称 or 名称 == "-":
                名称 = 代码
            # 北交所代码以8/4开头，沪市6开头，其余深市
            if 代码.startswith("6"):
                市场 = "SH"
            elif 代码.startswith(("8", "4")):
                市场 = "BJ"
            else:
                市场 = "SZ"
            结果.append({"代码": 代码, "名称": 名称, "市场": 市场})
            self.缓存.存财务数据({
                "代码": 代码, "名称": 名称,
                "市盈率": round(item.get("f9", 0) / 100, 2) if item.get("f9") else None,
                "市净率": round(item.get("f23", 0) / 100, 2) if item.get("f23") else None,
                "总市值": item.get("f20", 0),
                "流通市值": item.get("f21", 0),
            })
        return 结果

    def _获取A股列表_新浪(self):
        """从新浪获取A股列表（备用源，仅代码+名称，无财务数据）"""
        import urllib.request
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Referer": "https://finance.sina.com.cn/"}
        # 新浪A股列表：分页拉取沪深两市
        结果 = []
        for 市场前缀, 市场标签 in [("sh", "SH"), ("sz", "SZ")]:
            for 页 in range(1, 60):
                try:
                    url = f"http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page={页}&num=100&sort=symbol&asc=1&node={市场前缀}a&symbol=&_s_r_a=auto"
                    req = urllib.request.Request(url, headers=headers)
                    resp = urllib.request.urlopen(req, timeout=10)
                    raw = resp.read().decode("gbk")
                    data = json.loads(raw)
                    if not data:
                        break
                    for item in data:
                        代码 = item.get("code", "")[-6:]
                        名称 = item.get("name", "")
                        if 代码 and 名称:
                            结果.append({"代码": 代码, "名称": 名称, "市场": 市场标签 if 代码.startswith("6") else "SZ"})
                    if len(data) < 100:
                        break
                except Exception:
                    break
        self._last_error = "" if 结果 else "新浪数据源也失败"
        return 结果

    def 代码转secid(self, 代码: str) -> str:
        if 代码.startswith("6"):
            return f"1.{代码}"
        elif 代码.startswith(("0", "3")):
            return f"0.{代码}"
        elif 代码.startswith(("8", "4")):
            return f"0.{代码}"
        return ""

    def 请求K线(self, 代码: str, 周期: str = "daily", 起始日期: str = None) -> list:
        """请求K线数据（东财优先，失败切新浪）
        
        参数:
            起始日期: 增量下载时的起始日期(YYYYMMDD)，只拉此日期之后的数据。None=拉最近120天
        """
        结果 = self._请求K线_东财(代码, 周期, 起始日期)
        if 结果:
            return 结果
        # 东财失败，切新浪
        return self._请求K线_新浪(代码, 周期)

    def _请求K线_东财(self, 代码: str, 周期: str = "daily", 起始日期: str = None) -> list:
        """从东财请求K线数据（指数退避重试 + 数据校验）
        
        参数:
            起始日期: 增量模式下的起始日期(YYYYMMDD)，只拉此日期之后的数据
        """
        import urllib.request
        secid = self.代码转secid(代码)
        if not secid:
            return []
        周期映射 = {"daily": 101, "weekly": 102, "monthly": 103}
        klt = 周期映射.get(周期, 101)
        # 增量模式：beg设为本地最后日期，lmt设大值确保拉到最新
        # 全量模式：beg=0，lmt=120拉最近120天
        if 起始日期:
            beg = 起始日期.replace("-", "")
            lmt = 30  # 增量最多拉30天，够覆盖假期
        else:
            beg = "0"
            lmt = 120 if klt == 101 else (200 if klt == 102 else 240)
        url = f"https://push2his.eastmoney.com/api/qt/stock/kline/get?secid={secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt={klt}&fqt=1&beg={beg}&end=20500101&lmt={lmt}"
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Referer": "https://quote.eastmoney.com/"}

        def _do_request():
            req = urllib.request.Request(url, headers=headers)
            resp = urllib.request.urlopen(req, timeout=8)
            data = json.loads(resp.read().decode("utf-8"))
            klines = data.get("data", {}).get("klines", []) or []
            结果 = []
            for k in klines:
                parts = k.split(",")
                if len(parts) >= 7:
                    结果.append({"日期": parts[0], "开": float(parts[1]), "收": float(parts[2]), "高": float(parts[3]), "低": float(parts[4]), "量": float(parts[5]), "额": float(parts[6])})
            return 结果

        结果, _err = self._指数退避重试(_do_request, max_retries=3)
        if 结果 and len(结果) > 0:
            # 全量模式拉到<3条视为失败；增量模式拉到1条也正常（可能只差1天）
            if not 起始日期 and len(结果) < 3:
                return []
            for i in range(1, len(结果)):
                if 结果[i]["日期"] < 结果[i-1]["日期"]:
                    结果.sort(key=lambda x: x["日期"])
                    break
        return 结果 or []

    def _请求K线_新浪(self, 代码: str, 周期: str = "daily") -> list:
        """从新浪请求K线数据（备用源）
        scale: 240=日K, 1200=周K, 7200=月K
        """
        import urllib.request
        前缀 = "sh" if 代码.startswith("6") else "sz"
        scale_map = {"daily": 240, "weekly": 1200, "monthly": 7200}
        scale = scale_map.get(周期, 240)
        datalen = 120 if scale == 240 else (200 if scale == 1200 else 240)
        url = f"http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol={前缀}{代码}&scale={scale}&ma=no&datalen={datalen}"
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Referer": "https://finance.sina.com.cn/"}

        def _do_request():
            req = urllib.request.Request(url, headers=headers)
            resp = urllib.request.urlopen(req, timeout=8)
            raw = resp.read().decode("utf-8")
            data = json.loads(raw)
            结果 = []
            for item in data:
                结果.append({
                    "日期": item.get("day", "")[:10],
                    "开": float(item.get("open", 0)),
                    "收": float(item.get("close", 0)),
                    "高": float(item.get("high", 0)),
                    "低": float(item.get("low", 0)),
                    "量": float(item.get("volume", 0)),
                    "额": 0  # 新浪不提供成交额
                })
            return 结果

        结果, _err = self._指数退避重试(_do_request, max_retries=2)
        return 结果 or []

    def 请求财务详情(self, 代码: str, 名称: str = "") -> dict:
        """请求单只股票的财务详情：ROE、股东人数、EPS、BVPS、营收、净利润、同比增长
        
        使用东财数据中心API（datacenter），比旧版F10接口更稳定
        """
        import urllib.request
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Referer": "https://data.eastmoney.com/"}
        结果 = {"代码": 代码, "名称": 名称}

        # 1. 关键财务指标（ROE、EPS、BVPS、营收、净利润）— 东财数据中心
        def _请求指标():
            url1 = f"https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=ALL&filter=(SECURITY_CODE%3D%22{代码}%22)&pageNumber=1&pageSize=1&sortColumns=REPORT_DATE&sortTypes=-1"
            req1 = urllib.request.Request(url1, headers=headers)
            resp1 = urllib.request.urlopen(req1, timeout=8)
            return json.loads(resp1.read().decode("utf-8"))
        data1, _ = self._指数退避重试(_请求指标, max_retries=2)
        if data1:
            rows = data1.get("result", {}).get("data", []) or []
            if rows:
                r = rows[0]
                结果["报告期"] = str(r.get("REPORT_DATE", ""))[:10]
                # ROE
                roe = r.get("WEIGHTAVG_ROE") or r.get("ROEJQ") or r.get("ROE")
                结果["净资产收益率"] = float(roe) if roe else None
                # EPS
                eps = r.get("BASIC_EPS") or r.get("EPSJB")
                结果["每股收益"] = float(eps) if eps else None
                # BVPS
                bps = r.get("BPS") or r.get("TOTAL_ASSETS")
                结果["每股净资产"] = float(bps) if bps else None
                # 营收
                营收 = r.get("TOTAL_OPERATE_INCOME") or r.get("YYSR")
                结果["营业收入"] = float(营收) if 营收 else None
                # 净利润
                净利 = r.get("PARENT_NETPROFIT") or r.get("GSJLR")
                结果["归属净利润"] = float(净利) if 净利 else None
                # 同比增长（如果API直接返回）
                营收增长 = r.get("YSTZ") or r.get("TOTAL_OPERATE_INCOME_YOY")
                if 营收增长:
                    结果["营收同比增长"] = float(营收增长)
                净利增长 = r.get("SJLTZ") or r.get("PARENT_NETPROFIT_YOY")
                if 净利增长:
                    结果["净利润同比增长"] = float(净利增长)

        # 2. 股东人数 — 东财数据中心
        def _请求股东():
            url2 = f"https://datacenter.eastmoney.com/api/data/v1/get?reportName=RPT_F10_EH_HOLDERSNUM&columns=ALL&filter=(SECURITY_CODE%3D%22{代码}%22)&pageNumber=1&pageSize=1&sortColumns=END_DATE&sortTypes=-1"
            req2 = urllib.request.Request(url2, headers=headers)
            resp2 = urllib.request.urlopen(req2, timeout=8)
            return json.loads(resp2.read().decode("utf-8"))
        data2, _ = self._指数退避重试(_请求股东, max_retries=2)
        if data2:
            rows = data2.get("result", {}).get("data", []) or []
            if rows:
                row = rows[0]
                结果["股东人数"] = row.get("HOLDER_NUM")
                总股本 = row.get("TOTAL_SHARES", 0) or 0
                if 结果.get("股东人数") and 总股本:
                    结果["户均持股"] = round(总股本 / 结果["股东人数"], 0)
                if not 结果.get("报告期"):
                    结果["报告期"] = str(row.get("END_DATE", ""))[:10]

        return 结果 if len(结果) > 2 else {}

    def 启动下载(self, 周期: str = "daily", 增量: bool = True, 含财务: bool = True, 强制刷新列表: bool = False):
        """启动后台多线程下载
        
        参数:
            强制刷新列表: True时强制从远程重新获取A股列表（忽略本地缓存）
        """
        # 清理已结束的线程引用
        if self._线程 and not self._线程.is_alive():
            self._线程 = None
        if self._线程 and self._线程.is_alive():
            return {"成功": False, "错误": "下载任务正在运行中"}
        self._停止 = False
        self._线程 = threading.Thread(target=self._下载任务, args=(周期, 增量, 含财务, 强制刷新列表), daemon=True)
        self._线程.start()
        return {"成功": True, "消息": "下载已启动"}

    def _下载任务(self, 周期: str, 增量: bool, 含财务: bool = True, 强制刷新列表: bool = False):
        from concurrent.futures import ThreadPoolExecutor, as_completed
        try:
            print(f"[股票下载] 任务开始: 周期={周期} 增量={增量} 财务={含财务} 刷新={强制刷新列表}")
            # 初始延迟：让上一次的连接完全释放
            time.sleep(1)
            # ===== 阶段0: 获取A股列表 =====
            self._更新进度(状态="准备A股列表...", 总数=0, 已完成=0, 失败=0, 跳过=0, 当前代码="", 开始时间=time.time(), 阶段="列表", 失败详情=[])
            print("[股票下载] 阶段0: 准备A股列表")

            # 先查本地
            股票列表 = self.缓存.取A股列表()
            print(f"[股票下载] 本地A股列表: {len(股票列表)}只")

            # 增量模式：本地有足够列表且未强制刷新时直接用，不请求远程
            if 增量 and 股票列表 and len(股票列表) >= 1000 and not 强制刷新列表:
                self._更新进度(状态=f"使用本地A股列表({len(股票列表)}只)", 跳过=0)
            else:
                # 本地没有或不完整：远程拉取
                if 股票列表:
                    self._更新进度(状态=f"本地列表不完整({len(股票列表)}只)，尝试远程刷新...")
                远程列表 = self.获取A股列表()
                if 远程列表:
                    股票列表 = 远程列表
                    self.缓存.存A股列表(股票列表)
                    self._更新进度(状态=f"获取到{len(股票列表)}只A股")
                elif 股票列表:
                    # 远程失败但有本地缓存，继续用本地
                    self._更新进度(状态=f"远程失败，使用本地缓存({len(股票列表)}只)")
                else:
                    # 本地列表也没 → 从K线数据表中提取已有代码作为兜底
                    本地代码列表 = self.缓存.取本地K线代码列表()
                    if 本地代码列表:
                        股票列表 = 本地代码列表
                        self._更新进度(状态=f"远程失败且无列表缓存，从K线数据恢复{len(股票列表)}只代码")
                    else:
                        错误信息 = getattr(self, '_last_error', '') or '未知错误'
                        self._更新进度(状态=f"失败: 无法获取A股列表 ({错误信息})")
                        return

            # ===== 阶段1: K线下载（断点续传） =====
            检查点名 = f"kline_{周期}"
            检查点 = self.缓存.取检查点(检查点名) if 增量 else None
            已完成代码 = set(检查点["已完成代码"]) if 检查点 else set()
            失败列表 = list(检查点["失败列表"]) if 检查点 else []

            # 增量模式：跳过本地已有数据的股票
            待下载 = []
            已跳过 = 0
            增量日期表 = {}  # 代码 → 本地最后日期，传给下载函数
            # 盘中时今天K线不完整，目标日期=昨天；盘后/非交易日目标日期=今天
            if self.缓存._是否盘中():
                目标日期 = (self.缓存._当前时间() - timedelta(days=1)).strftime("%Y-%m-%d")
                盘中提示 = "（盘中，只更新到昨日）"
            else:
                目标日期 = self.缓存._当前时间().strftime("%Y-%m-%d")
                盘中提示 = ""
            for s in 股票列表:
                代码 = s["代码"]
                if 增量:
                    本地最后日期 = self.缓存.获取K线最后日期(代码, 周期)
                    if 本地最后日期:
                        # 本地最后日期 >= 目标日期 → 已是最新，跳过
                        if 本地最后日期 >= 目标日期:
                            已跳过 += 1
                            continue
                        # 本地有数据但落后 → 需要增量更新
                        增量日期表[代码] = 本地最后日期
                        待下载.append(s)
                        continue
                # 非增量模式 或 本地完全没数据
                if 代码 in 已完成代码:
                    已跳过 += 1
                    continue
                待下载.append(s)

            self._更新进度(状态=f"下载K线中({len(待下载)}只待下载,{已跳过}只已跳过)", 总数=len(待下载), 已完成=0, 失败=len(失败列表), 跳过=已跳过, 阶段="K线")
            print(f"[股票下载] 阶段1 K线: {len(待下载)}只待下载, {已跳过}只已跳过, 目标日期={目标日期}, 盘中={盘中提示}")

            批量缓冲 = []
            批量锁 = threading.Lock()
            完成数 = [0]
            失败数 = [len(失败列表)]
            进度锁 = threading.Lock()

            盘中模式 = self.缓存._是否盘中()
            今日 = self.缓存._当前时间().strftime("%Y-%m-%d")

            def _下载单只K线(任务):
                if self._停止:
                    return None
                代码 = 任务["代码"]
                self._更新进度(当前代码=代码)
                # 增量模式：只拉本地最后日期之后的数据
                起始 = 增量日期表.get(代码)
                数据 = self.请求K线(代码, 周期, 起始日期=起始)
                if 数据:
                    # 盘中模式：过滤掉今天的不完整K线（等收盘后再更新）
                    if 盘中模式:
                        数据 = [d for d in 数据 if d["日期"] < 今日]
                    if not 数据:
                        return ("ok", 代码)  # 没有新数据也算成功
                    with 批量锁:
                        批量缓冲.append((代码, 周期, 数据))
                        if len(批量缓冲) >= 10:
                            for item in 批量缓冲:
                                self.缓存.存K线数据(item[0], item[1], item[2])
                            批量缓冲.clear()
                    return ("ok", 代码)
                else:
                    return ("fail", 代码, "K线数据为空或请求失败")

            with ThreadPoolExecutor(max_workers=self._线程数) as executor:
                futures = {executor.submit(_下载单只K线, s): s for s in 待下载}
                for future in as_completed(futures):
                    if self._停止:
                        break
                    result = future.result()
                    if result:
                        with 进度锁:
                            if result[0] == "ok":
                                完成数[0] += 1
                                已完成代码.add(result[1])
                            else:
                                失败数[0] += 1
                                失败列表.append({"代码": result[1], "原因": result[2]})
                            self._更新进度(已完成=完成数[0], 失败=失败数[0])
                            # 每50只存一次检查点
                            if (完成数[0] + 失败数[0]) % 50 == 0:
                                self.缓存.存检查点(检查点名, "K线", list(已完成代码), 失败列表, len(待下载), 完成数[0], 失败数[0])

            # 写入剩余缓冲
            if 批量缓冲:
                for item in 批量缓冲:
                    self.缓存.存K线数据(item[0], item[1], item[2])
                批量缓冲.clear()

            # 存最终检查点
            self.缓存.存检查点(检查点名, self._停止 and "中断" or "K线完成", list(已完成代码), 失败列表, len(待下载), 完成数[0], 失败数[0])

            if self._停止:
                self._更新进度(状态="已停止(可重新增量下载续传)", 当前代码="", 失败详情=失败列表[:20])
                return

            # ===== 阶段2: 财务详情下载（ROE/股东人数/EPS/BVPS） =====
            if 含财务:
                print(f"[股票下载] 阶段2 财务: 开始下载, K线完成{完成数[0]}只")
                检查点名2 = "finance"
                检查点2 = self.缓存.取检查点(检查点名2)
                已完成代码2 = set(检查点2["已完成代码"]) if 检查点2 else set()
                失败列表2 = list(检查点2["失败列表"]) if 检查点2 else []

                待下载2 = [s for s in 股票列表 if s["代码"] not in 已完成代码2]
                self._更新进度(状态=f"下载财务详情({len(待下载2)}只待下载,每只2个API,3线程0.5s间隔)", 总数=len(待下载2), 已完成=0, 失败=len(失败列表2), 跳过=len(已完成代码2), 阶段="财务")

                # 财务阶段：3线程 + 0.5s间隔（降低频率避免被封IP）
                原间隔 = self._请求间隔
                self._请求间隔 = 0.5
                财务线程数 = 3

                完成数2 = [0]
                失败数2 = [len(失败列表2)]
                进度锁2 = threading.Lock()

                def _下载单只财务(任务):
                    if self._停止:
                        return None
                    代码 = 任务["代码"]
                    名称 = 任务.get("名称", "")
                    self._更新进度(当前代码=代码)
                    详情 = self.请求财务详情(代码, 名称)
                    if 详情 and len(详情) > 2:
                        已有 = self.缓存.取财务数据(代码)
                        if 已有:
                            详情.setdefault("市盈率", 已有.get("市盈率"))
                            详情.setdefault("市净率", 已有.get("市净率"))
                            详情.setdefault("总市值", 已有.get("总市值"))
                            详情.setdefault("流通市值", 已有.get("流通市值"))
                        self.缓存.存财务数据(详情)
                        # 日志：每100只输出一次
                        总完成 = 完成数2[0] + 失败数2[0] + 1
                        if 总完成 % 100 == 0:
                            print(f"  [财务] {总完成}/{len(待下载2)} 完成,当前{代码} ROE={详情.get('净资产收益率')}")
                        return ("ok", 代码)
                    else:
                        总完成 = 完成数2[0] + 失败数2[0] + 1
                        if 总完成 % 50 == 0:
                            print(f"  [财务] {总完成}/{len(待下载2)} 失败{代码}: 财务数据获取失败")
                        return ("fail", 代码, "财务数据获取失败")

                with ThreadPoolExecutor(max_workers=财务线程数) as executor:
                    futures = {executor.submit(_下载单只财务, s): s for s in 待下载2}
                    for future in as_completed(futures):
                        if self._停止:
                            break
                        result = future.result()
                        if result:
                            with 进度锁2:
                                if result[0] == "ok":
                                    完成数2[0] += 1
                                    已完成代码2.add(result[1])
                                else:
                                    失败数2[0] += 1
                                    失败列表2.append({"代码": result[1], "原因": result[2]})
                                self._更新进度(已完成=完成数2[0], 失败=失败数2[0])
                                if (完成数2[0] + 失败数2[0]) % 50 == 0:
                                    self.缓存.存检查点(检查点名2, "财务", list(已完成代码2), 失败列表2, len(待下载2), 完成数2[0], 失败数2[0])

                self.缓存.存检查点(检查点名2, self._停止 and "中断" or "财务完成", list(已完成代码2), 失败列表2, len(待下载2), 完成数2[0], 失败数2[0])

            # ===== 完成 =====
            if self._停止:
                self._更新进度(状态="已停止(可重新增量下载续传)", 当前代码="", 失败详情=失败列表[:20])
            else:
                self._请求间隔 = 原间隔
                self.缓存.删检查点(检查点名)
                if 含财务:
                    self.缓存.删检查点(检查点名2)
                # 生成详细完成摘要
                数据源 = self._进度.get("数据源", "")
                摘要 = f"K线: {完成数[0]}成功/{失败数[0]}失败/{已跳过}跳过"
                if 含财务:
                    摘要 += f" | 财务: {完成数2[0]}成功/{失败数2[0]}失败"
                if 数据源:
                    摘要 += f" | 数据源: {数据源}"
                if len(股票列表) < 1000:
                    摘要 += f" | ⚠️仅{len(股票列表)}只(东财IP被封,请稍后重试)"
                if 失败列表 and len(失败列表) <= 5:
                    摘要 += f" | K线失败: {','.join([f['代码'] for f in 失败列表[:5]])}"
                if 含财务 and 失败列表2 and len(失败列表2) <= 5:
                    摘要 += f" | 财务失败: {','.join([f['代码'] for f in 失败列表2[:5]])}"
                print(f"[股票下载] ✅ 任务完成: {摘要}")
                self._更新进度(状态=f"完成 - {摘要}", 当前代码="", 已完成=完成数[0], 失败=失败数[0], 失败详情=失败列表[:20])
        except Exception as e:
            import traceback
            错误堆栈 = traceback.format_exc()
            print(f"[股票下载] ❌ 任务异常: {e}")
            print(f"[股票下载] 堆栈:\n{错误堆栈}")
            # 记录到运行诊断器
            try:
                sys.path.insert(0, str(Path(__file__).parent))
                from 运行诊断器 import 运行诊断器类
                if 运行诊断器类._实例引用:
                    运行诊断器类._实例引用.记录错误(
                        "股票下载.任务", 异常对象=e,
                        异常类型=type(e).__name__, 异常信息=str(e))
            except Exception:
                pass
            self._更新进度(状态=f"错误: {e}", 当前代码="")
        finally:
            self._线程 = None  # 清理线程引用，允许重新启动


# 全局单例
_缓存引擎 = None
_引擎锁 = threading.Lock()
_下载引擎 = None
_下载锁 = threading.Lock()

def 获取股票缓存(路径: str = None) -> 股票缓存引擎:
    global _缓存引擎
    if _缓存引擎 is None:
        with _引擎锁:
            if _缓存引擎 is None:
                _缓存引擎 = 股票缓存引擎(路径)
    return _缓存引擎

def 获取下载引擎() -> 全量下载引擎:
    global _下载引擎
    if _下载引擎 is None:
        with _下载锁:
            if _下载引擎 is None:
                _下载引擎 = 全量下载引擎(获取股票缓存())
    return _下载引擎
