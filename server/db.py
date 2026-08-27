#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据库操作
"""

import os
import shutil
import sqlite3
import threading
import time
import traceback

from config import DB_PATH, _db_lock, BASE_DIR, QUIET_CONSOLE

# ===== 数据库备份目录（安全留底用）=====
BACKUP_DIR = os.path.join(BASE_DIR, 'private', 'backups')
os.makedirs(BACKUP_DIR, exist_ok=True)


def _dbg(msg):
    """过程日志:静默模式下不输出(见 config.QUIET_CONSOLE)"""
    if not QUIET_CONSOLE:
        print(msg)


def _safe_backup_db(reason):
    """破坏性操作前，先将当前数据库主库 + WAL + SHM 完整备份到 backups/ 目录。
    返回备份好的主库路径（主库不存在则返回 None）。
    目的：任何删除/重建前先留底，确保中途停止也能找回数据。
    """
    stamp = time.strftime('%Y%m%d_%H%M%S')
    backup_main = os.path.join(BACKUP_DIR, f'pre_rebuild_{stamp}_{reason}.db')

    try:
        if os.path.exists(DB_PATH):
            shutil.copy2(DB_PATH, backup_main)
            _dbg(f'[SQLite] 安全备份主库 -> {backup_main}')

        # 一并备份 WAL / SHM（可能含尚未合并进主库的最新数据）
        for suffix in ['-wal', '-shm']:
            fpath = DB_PATH + suffix
            if os.path.exists(fpath) and os.path.getsize(fpath) > 0:
                dst = backup_main + suffix
                try:
                    shutil.copy2(fpath, dst)
                    _dbg(f'[SQLite] 备份副作用文件 {suffix} -> {dst}')
                except Exception as e:
                    _dbg(f'[SQLite] 备份 {suffix} 失败(忽略): {e}')

        return backup_main if os.path.exists(backup_main) else None
    except Exception as e:
        _dbg(f'[SQLite] 数据库安全备份失败: {e}')
        traceback.print_exc()
        return None


def _try_sqlite_recover():
    """温和恢复：抢救聊天记录 + 整库备份留底，绝不删除源文件。
    返回 (db_backup, chat_export)，均可能为 None。
    """
    if not os.path.exists(DB_PATH):
        return None, None

    stamp = time.strftime('%Y%m%d_%H%M%S')
    db_rec = None
    chat_rec = None

    # 抢救聊天记录到独立备份
    try:
        import sqlite3
        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            n = conn.execute('SELECT COUNT(*) AS c FROM chat_history').fetchone()['c']
            if n > 0:
                chat_rec = os.path.join(BACKUP_DIR, f'chat_{stamp}_{n}msgs.db')
                shutil.copy2(DB_PATH, chat_rec)
                _dbg(f'[SQLite] 已抢救聊天记录({n}条) -> {chat_rec}')
    except Exception as e:
        _dbg(f'[SQLite] 抢救聊天记录失败(忽略): {e}')

    # 尝试整库备份留底
    try:
        if os.path.getsize(DB_PATH) > 0:
            db_rec = os.path.join(BACKUP_DIR, f'pre_rebuild_{stamp}_recover.db')
            shutil.copy2(DB_PATH, db_rec)
            _dbg(f'[SQLite] 整库备份留底 -> {db_rec}')
    except Exception as e:
        _dbg(f'[SQLite] 整库备份失败(忽略): {e}')

    return (db_rec, chat_rec)


def init_db():
    """初始化数据库表（含损坏自动恢复）。

    安全策略（防止中途停止导致数据被不可抗力永久删除）：
      1. 首次失败先温和恢复：先抢救数据留底，再尝试只移除损坏的 WAL/SHM（不删主库）；
      2. 任何删除/重建前必须先安全备份（_safe_backup_db），确保可找回；
      3. 全程绝不直接删除主库文件：重建仅在原库上建表，原库始终保留留底，
         把"不可抗力删除"变为"允许安全删除（可找回）"。
    """
    try:
        _init_db_inner()
        return
    except Exception as e:
        _dbg(f'[SQLite] 初始化失败，进入安全恢复流程: {e}')
        traceback.print_exc()

    # ===== 阶段1：温和恢复（先留底，再仅处理 WAL）=====
    _try_sqlite_recover()
    try:
        _init_db_inner()
        _dbg('[SQLite] 温和恢复成功（主库数据保留）')
        return
    except Exception as e2:
        _dbg(f'[SQLite] 温和恢复仍未成功: {e2}')

    # ===== 阶段2：备份留底，然后安全移除副作用文件 =====
    _safe_backup_db('init_rebuild')

    for suffix in ['-wal', '-shm']:
        fpath = DB_PATH + suffix
        try:
            if os.path.exists(fpath):
                os.remove(fpath)
                _dbg(f'[SQLite] 已安全移除损坏副作用文件: {fpath}')
        except Exception as e3:
            _dbg(f'[SQLite] 移除 {fpath} 失败: {e3}')

    # ===== 阶段3：最终重建（保留主库，仅在其上建表）=====
    _init_db_inner()
    _dbg('[SQLite] 数据库重建完成，原主库已备份留底（可找回）')

def get_db():
    """获取数据库连接（每次新建，用完即关）"""
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA busy_timeout=30000')
    # 不启用 foreign_keys=ON：前端用 cb1/cb2 作为 session_id，不在 sessions 表中
    return conn


def _init_db_inner():
    """实际建表逻辑"""
    conn = get_db()
    cursor = conn.cursor()
    # WAL 模式只需在初始化时设一次，后续所有连接自动继承
    cursor.execute('PRAGMA journal_mode=WAL')

    # 1. 画布节点（对话框）
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS canvas_nodes (
            id TEXT PRIMARY KEY,
            title TEXT,
            model_id TEXT,
            x REAL DEFAULT 0,
            y REAL DEFAULT 0,
            w REAL DEFAULT 320,
            h REAL DEFAULT 420,
            collapsed INTEGER DEFAULT 0,
            z_index INTEGER DEFAULT 50,
            created_at INTEGER,
            updated_at INTEGER
        )
    ''')
    # 新表首次创建时直接补齐会话级累计统计列
    try:
        cur_node_cols = conn.cursor()
        cur_node_cols.execute('PRAGMA table_info(canvas_nodes)')
        node_cols = [row[1] for row in cur_node_cols.fetchall()]
        for col in ('session_total_tokens', 'session_total_api_calls', 'session_total_duration',
                    'session_total_prompt_tokens', 'session_total_completion_tokens',
                    'session_total_cache_hit_tokens', 'session_total_cache_miss_tokens'):
            if col not in node_cols:
                cur_node_cols.execute(f'ALTER TABLE canvas_nodes ADD COLUMN {col} INTEGER DEFAULT 0')
    except Exception as e:
        _dbg(f'[SQLite] 迁移 canvas_nodes 会话统计列跳过: {e}')

    # 补齐 per-chat 模型覆盖列（model_id_override / reasoning_effort）
    try:
        cur_node_cols2 = conn.cursor()
        cur_node_cols2.execute('PRAGMA table_info(canvas_nodes)')
        node_cols2 = [row[1] for row in cur_node_cols2.fetchall()]
        for col in ('model_id_override', 'reasoning_effort'):
            if col not in node_cols2:
                cur_node_cols2.execute(f'ALTER TABLE canvas_nodes ADD COLUMN {col} TEXT DEFAULT \'\'')
    except Exception as e:
        _dbg(f'[SQLite] 迁移 canvas_nodes 模型覆盖列跳过: {e}')

    # 2. 画布视口状态
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS canvas_view (
            id INTEGER PRIMARY KEY DEFAULT 1,
            x REAL DEFAULT 0,
            y REAL DEFAULT 0,
            scale REAL DEFAULT 1,
            updated_at INTEGER
        )
    ''')
    cursor.execute('INSERT OR IGNORE INTO canvas_view (id, x, y, scale) VALUES (1, 0, 0, 1)')

    # 3. 通用键值存储
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS kv_store (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at INTEGER
        )
    ''')

    # 4. 会话管理
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            name TEXT,
            created_at INTEGER,
            updated_at INTEGER
        )
    ''')

    # 5. 对话历史
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            role TEXT,
            content TEXT,
            created_at INTEGER,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )
    ''')

    # 5b. 已关闭会话的历史归档（独立于 sessions，避免级联删除）
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS chat_history_archive (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            session_name TEXT,
            role TEXT,
            content TEXT,
            model_id TEXT,
            created_at INTEGER
        )
    ''')

    # 6. 通用数据表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS app_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            key TEXT,
            value TEXT,
            created_at INTEGER,
            updated_at INTEGER
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_app_data_cat ON app_data(category)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_history(session_id)')

    # 7. 运行日志表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS app_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER,
            level TEXT,
            box_id TEXT,
            action TEXT,
            detail TEXT
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_logs_ts ON app_logs(ts)')

    # 8. 项目表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at INTEGER,
            updated_at INTEGER
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name)')

    # 9. 任务统计表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS task_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            model_id TEXT,
            task_title TEXT,
            success INTEGER DEFAULT 0,
            tokens_used INTEGER DEFAULT 0,
            duration_ms INTEGER DEFAULT 0,
            depth INTEGER DEFAULT 0,
            created_at INTEGER
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_task_stats_ts ON task_stats(created_at)')

    # === 兼容性迁移：为旧表添加新列（已存在则跳过） ===
    # canvas_nodes 加 scroll_pos（记录对话内滚动位置）
    try:
        cur2 = conn.cursor()
        cur2.execute('PRAGMA table_info(canvas_nodes)')
        cols_nodes = [row[1] for row in cur2.fetchall()]
        if 'scroll_pos' not in cols_nodes:
            cur2.execute('ALTER TABLE canvas_nodes ADD COLUMN scroll_pos REAL DEFAULT 0')
            _dbg('[SQLite] 迁移: canvas_nodes + scroll_pos')
    except Exception as e:
        _dbg(f'[SQLite] 迁移 canvas_nodes 跳过: {e}')

    # chat_history 加 model_id（记录每条消息使用的模型）
    try:
        cur3 = conn.cursor()
        cur3.execute('PRAGMA table_info(chat_history)')
        cols_chat = [row[1] for row in cur3.fetchall()]
        if 'model_id' not in cols_chat:
            cur3.execute('ALTER TABLE chat_history ADD COLUMN model_id TEXT')
            _dbg('[SQLite] 迁移: chat_history + model_id')
    except Exception as e:
        _dbg(f'[SQLite] 迁移 chat_history 跳过: {e}')

    # chat_history_archive 加 model_id（清理会话后仍可统计所用模型）
    try:
        cur_archive = conn.cursor()
        cur_archive.execute('PRAGMA table_info(chat_history_archive)')
        cols_archive = [row[1] for row in cur_archive.fetchall()]
        if cols_archive and 'model_id' not in cols_archive:
            cur_archive.execute('ALTER TABLE chat_history_archive ADD COLUMN model_id TEXT')
            _dbg('[SQLite] 迁移: chat_history_archive + model_id')
    except Exception as e:
        _dbg(f'[SQLite] 迁移 chat_history_archive 跳过: {e}')

    # chat_history 加 parent_id（AI回复关联的用户消息ID，精准绑定问答对）
    try:
        cur_parent = conn.cursor()
        cur_parent.execute('PRAGMA table_info(chat_history)')
        cols_chat2 = [row[1] for row in cur_parent.fetchall()]
        if 'parent_id' not in cols_chat2:
            cur_parent.execute('ALTER TABLE chat_history ADD COLUMN parent_id INTEGER')
            _dbg('[SQLite] 迁移: chat_history + parent_id')
    except Exception as e:
        _dbg(f'[SQLite] 迁移 chat_history parent_id 跳过: {e}')

    # canvas_nodes 加 project_id（关联项目）
    try:
        cur4 = conn.cursor()
        cur4.execute('PRAGMA table_info(canvas_nodes)')
        cols_nodes2 = [row[1] for row in cur4.fetchall()]
        if 'project_id' not in cols_nodes2:
            cur4.execute('ALTER TABLE canvas_nodes ADD COLUMN project_id TEXT')
            _dbg('[SQLite] 迁移: canvas_nodes + project_id')
    except Exception as e:
        _dbg(f'[SQLite] 迁移 canvas_nodes project_id 跳过: {e}')

    # projects 加 folder_path（关联的本地文件夹路径）
    try:
        cur5 = conn.cursor()
        cur5.execute('PRAGMA table_info(projects)')
        cols_proj = [row[1] for row in cur5.fetchall()]
        if 'folder_path' not in cols_proj:
            cur5.execute('ALTER TABLE projects ADD COLUMN folder_path TEXT DEFAULT NULL')
            _dbg('[SQLite] 迁移: projects + folder_path')
    except Exception as e:
        _dbg(f'[SQLite] 迁移 projects folder_path 跳过: {e}')

    # projects 加 memory_text / memory_status（AI 自动生成的项目记忆）
    try:
        cur5b = conn.cursor()
        cur5b.execute('PRAGMA table_info(projects)')
        cols_proj2 = [row[1] for row in cur5b.fetchall()]
        if 'memory_text' not in cols_proj2:
            cur5b.execute('ALTER TABLE projects ADD COLUMN memory_text TEXT DEFAULT NULL')
            _dbg('[SQLite] 迁移: projects + memory_text')
        if 'memory_status' not in cols_proj2:
            cur5b.execute("ALTER TABLE projects ADD COLUMN memory_status TEXT DEFAULT 'none'")
            _dbg('[SQLite] 迁移: projects + memory_status')
    except Exception as e:
        _dbg(f'[SQLite] 迁移 projects memory_text/status 跳过: {e}')

    # task_stats 加 api_calls（记录每次任务的 API 调用次数）
    try:
        cur6 = conn.cursor()
        cur6.execute('PRAGMA table_info(task_stats)')
        cols_stats = [row[1] for row in cur6.fetchall()]
        if 'api_calls' not in cols_stats:
            cur6.execute('ALTER TABLE task_stats ADD COLUMN api_calls INTEGER DEFAULT 0')
            _dbg('[SQLite] 迁移: task_stats + api_calls')
    except Exception as e:
        _dbg(f'[SQLite] 迁移 task_stats api_calls 跳过: {e}')

    conn.commit()
    conn.close()
    _dbg(f'[SQLite] 数据库已初始化: {DB_PATH}')
