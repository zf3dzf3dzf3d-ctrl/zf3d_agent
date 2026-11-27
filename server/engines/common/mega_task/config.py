# -*- coding: utf-8 -*-
"""mega 模式全部可调常量集中在此，便于后期剥离时整体搬走。"""
import os

# ===== 档位标识 =====
CTX_MODE = 'mega'

# ===== 存储路径 =====
# private 目录由上层静态服务排除，HTTP 不可直读
_THIS = os.path.dirname(os.path.abspath(__file__))
_SERVER = os.path.abspath(os.path.join(_THIS, '..', '..', '..'))
ARCHIVE_ROOT = os.path.join(_SERVER, 'private', 'mega_archive')

# 会话内文件布局
TURNS_FILE = 'turns.jsonl'      # 原文，一字不删，append-only
BLOBS_DIR = 'blobs'             # 超长 tool_result 分片
INDEX_FILE = 'index.json'       # 轮次元信息 + 索引块
CHECKPOINT_FILE = 'checkpoints.md'  # agent 自产关键结论
LOCK_FILE = '.lock'             # 同会话并发写保护

# ===== 组装策略（token 预算相关）=====
RECENT_RAW_TURNS = 3            # 原文直发的最近轮数
INDEX_HEAD_CHARS = 600          # 索引每条最大字符
FOLD_BLOCK_SIZE = 15            # 索引块大小：每 15 轮一块
FOLD_KEEP_TAIL = 3              # 折叠时保留末尾几块不折，其余老块合并为一段
FOLDED_MAX_SEGMENTS = 5         # 折叠段上限，超过则老折叠段再合并（防线性膨胀）
CHECKPOINT_EVERY = 10           # 每 10 轮强制 agent 产一次 checkpoint
BLOB_THRESHOLD = 4000           # 单条 tool_result 超此长度进 blobs 分片
MAX_ARCHIVE_SEARCH_HITS = 8     # archive_search 最多回几条
MAX_ARCHIVE_LOAD_CHARS = 20000  # archive_load 单次回传上限

# ===== 稳定性（前缀缓存命中的前提）=====
# 注入内容里出现这些行一律剥掉，否则前缀每轮变，缓存全丢
VOLATILE_PATTERNS = (
    r'\n?生成时间[^\n]*',
    r'\n?\[动态状态\][^\n]*',
)

# ===== 工具名 =====
TOOL_SEARCH = 'archive_search'
TOOL_LOAD = 'archive_load'


def session_dir(session_id):
    """会话归档目录，自动建。"""
    sid = str(session_id or 'default').strip() or 'default'
    # 防目录穿越
    sid = sid.replace('..', '_').replace('/', '_').replace('\\', '_')
    d = os.path.join(ARCHIVE_ROOT, sid)
    os.makedirs(os.path.join(d, BLOBS_DIR), exist_ok=True)
    return d


def ensure_root():
    os.makedirs(ARCHIVE_ROOT, exist_ok=True)
    return ARCHIVE_ROOT
