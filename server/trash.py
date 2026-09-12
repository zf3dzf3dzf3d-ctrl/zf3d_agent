#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""trash - 删除缓冲垃圾箱（删除 ≠ 真删：先进 system/trash 并登记数据库，可随时找回）

规则：
  1. move_to_trash(): 把文件/目录移入垃圾箱并在 trash_items 表登记（删除动作的统一入口）
  2. restore():       按 id 恢复到原路径（目标被占用时自动加后缀，绝不覆盖现有文件）
  3. purge():         强制删除（用户明确说"强制删除/彻底删除"才调用），真删并清掉登记
  4. auto_cleanup():  超过 TRASH_RETENTION_DAYS（默认30天）的条目自动真删（低频后台执行）

目录结构：system/trash/YYYYMMDD/<序号>_<原名>
数据库表：trash_items（见 db.py _init_db_inner）
"""
import os
import time
import shutil
import sqlite3

TOOL_NAME = 'trash'

# 垃圾箱根目录：system/trash（遵守 docs/文件位置规范.md，过程产物不进项目根目录）
TRASH_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         'system', 'trash')

# 默认保留天数：超过后 auto_cleanup 自动真删
TRASH_RETENTION_DAYS = 30


def _now_ms():
    return int(time.time() * 1000)


def _ensure_db_table(conn):
    """确保 trash_items 表存在（幂等，兼容 db 未重建的老库）"""
    conn.execute('''
        CREATE TABLE IF NOT EXISTS trash_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            orig_path TEXT NOT NULL,
            trash_path TEXT NOT NULL,
            name TEXT,
            size INTEGER DEFAULT 0,
            is_dir INTEGER DEFAULT 0,
            deleted_at INTEGER,
            expires_at INTEGER,
            source TEXT,
            restored INTEGER DEFAULT 0
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_trash_expires ON trash_items(expires_at)')


def trash_path():
    """返回垃圾箱根目录（确保存在）"""
    os.makedirs(TRASH_DIR, exist_ok=True)
    return TRASH_DIR


def _unique_dst(directory, name):
    """目录内取名不冲突：name -> name(2) -> name(3)..."""
    dst = os.path.join(directory, name)
    if not os.path.exists(dst):
        return dst
    base, ext = os.path.splitext(name)
    i = 2
    while True:
        dst = os.path.join(directory, '%s(%d)%s' % (base, i, ext))
        if not os.path.exists(dst):
            return dst
        i += 1


def _dir_size(path):
    total = 0
    if os.path.isfile(path):
        try:
            return os.path.getsize(path)
        except OSError:
            return 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


def move_to_trash(path, source='unknown', conn=None):
    """把文件/目录移入垃圾箱并登记。返回登记记录 dict；失败抛异常。

    path:        要删除的原始路径
    source:      来源标识，如 'fs_ops' / 'project_record' / 'chat_delete'
    conn:        可传入外部 sqlite 连接（事务一致性）；不传则自开自管
    """
    src = os.path.realpath(path)
    if not os.path.exists(src):
        raise FileNotFoundError('目标不存在: ' + src)

    own = conn is None
    if own:
        from config import DB_PATH
        conn = sqlite3.connect(DB_PATH, timeout=30)
        conn.row_factory = sqlite3.Row
    try:
        _ensure_db_table(conn)
        day = time.strftime('%Y%m%d')
        day_dir = os.path.join(trash_path(), day)
        os.makedirs(day_dir, exist_ok=True)
        tpath = _unique_dst(day_dir, os.path.basename(src) or 'unnamed')

        # 同盘 rename 秒完成；跨盘 fallback copy+rm
        try:
            shutil.move(src, tpath)
        except (OSError, shutil.Error):
            if os.path.isdir(src):
                shutil.copytree(src, tpath)
                shutil.rmtree(src, ignore_errors=True)
            else:
                shutil.copy2(src, tpath)
                os.remove(src)

        size = _dir_size(tpath)
        is_dir = 1 if os.path.isdir(tpath) else 0
        now = _now_ms()
        expires = now + TRASH_RETENTION_DAYS * 86400 * 1000
        cur = conn.execute(
            '''INSERT INTO trash_items
               (orig_path, trash_path, name, size, is_dir, deleted_at, expires_at, source, restored)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)''',
            [src, tpath, os.path.basename(tpath), size, is_dir, now, expires, source])
        item_id = cur.lastrowid
        if own:
            conn.commit()
        return {'id': item_id, 'orig_path': src, 'trash_path': tpath,
                'name': os.path.basename(tpath), 'size': size,
                'is_dir': bool(is_dir), 'deleted_at': now,
                'expires_at': expires, 'source': source}
    finally:
        if own:
            try:
                conn.close()
            except Exception:
                pass


def restore(item_id, conn=None):
    """按 id 从垃圾箱恢复到原路径。返回 dict；垃圾箱物理文件已丢失时抛 FileNotFoundError。"""
    own = conn is None
    if own:
        from config import DB_PATH
        conn = sqlite3.connect(DB_PATH, timeout=30)
        conn.row_factory = sqlite3.Row
    try:
        _ensure_db_table(conn)
        row = conn.execute('SELECT * FROM trash_items WHERE id=?', [item_id]).fetchone()
        if row is None:
            raise KeyError('垃圾箱无此记录 id=%s' % item_id)
        tpath = row['trash_path']
        if not os.path.exists(tpath):
            raise FileNotFoundError('垃圾箱文件已不存在(可能已被清理): ' + tpath)
        orig = row['orig_path']
        parent = os.path.dirname(orig)
        os.makedirs(parent, exist_ok=True)
        dst = orig
        if os.path.exists(dst):
            # 原位已被新文件占用：恢复到旁边，绝不覆盖
            dst = _unique_dst(parent, row['name'] or os.path.basename(tpath))
        shutil.move(tpath, dst)
        conn.execute('UPDATE trash_items SET restored=1, trash_path=? WHERE id=?', [dst, item_id])
        if own:
            conn.commit()
        return {'id': item_id, 'restored_to': dst}
    finally:
        if own:
            try:
                conn.close()
            except Exception:
                pass


def purge(item_id, conn=None):
    """强制彻底删除（真删）。用户明确要求"强制删除/彻底删除"时才调用。"""
    own = conn is None
    if own:
        from config import DB_PATH
        conn = sqlite3.connect(DB_PATH, timeout=30)
        conn.row_factory = sqlite3.Row
    try:
        _ensure_db_table(conn)
        row = conn.execute('SELECT * FROM trash_items WHERE id=?', [item_id]).fetchone()
        if row is None:
            raise KeyError('垃圾箱无此记录 id=%s' % item_id)
        tpath = row['trash_path']
        if os.path.isdir(tpath):
            shutil.rmtree(tpath, ignore_errors=True)
        elif os.path.exists(tpath):
            try:
                os.remove(tpath)
            except OSError:
                pass
        conn.execute('DELETE FROM trash_items WHERE id=?', [item_id])
        if own:
            conn.commit()
        return {'id': item_id, 'purged': True, 'path': tpath}
    finally:
        if own:
            try:
                conn.close()
            except Exception:
                pass


def list_items(include_restored=False, conn=None):
    """列出垃圾箱条目（恢复过的默认不显示）"""
    own = conn is None
    if own:
        from config import DB_PATH
        conn = sqlite3.connect(DB_PATH, timeout=30)
        conn.row_factory = sqlite3.Row
    try:
        _ensure_db_table(conn)
        sql = 'SELECT * FROM trash_items'
        if not include_restored:
            sql += ' WHERE restored=0'
        sql += ' ORDER BY deleted_at DESC'
        rows = conn.execute(sql).fetchall()
        return [dict(r) for r in rows]
    finally:
        if own:
            try:
                conn.close()
            except Exception:
                pass


def auto_cleanup(now=None):
    """清理超过保留期的垃圾箱条目。返回 {'purged': n, 'errors': [...]}。
    由 server 启动线程/定期任务低频调用，每次自己开短连接。"""
    if now is None:
        now = _now_ms()
    purged, errors = 0, []
    try:
        from config import DB_PATH
        conn = sqlite3.connect(DB_PATH, timeout=30)
        conn.row_factory = sqlite3.Row
    except Exception as e:
        return {'purged': 0, 'errors': ['打开数据库失败: ' + str(e)]}
    try:
        _ensure_db_table(conn)
        rows = conn.execute(
            'SELECT id, trash_path FROM trash_items WHERE restored=0 AND expires_at<=?',
            [now]).fetchall()
        for r in rows:
            tpath = r['trash_path']
            try:
                if os.path.isdir(tpath):
                    shutil.rmtree(tpath, ignore_errors=True)
                elif os.path.exists(tpath):
                    os.remove(tpath)
                conn.execute('DELETE FROM trash_items WHERE id=?', [r['id']])
                purged += 1
            except Exception as e:
                errors.append('id=%s: %s' % (r['id'], e))
        conn.commit()
    except Exception as e:
        errors.append(str(e))
    finally:
        try:
            conn.close()
        except Exception:
            pass
    # 顺手清空的日期目录
    try:
        for d in os.listdir(trash_path()):
            full = os.path.join(trash_path(), d)
            if os.path.isdir(full) and not os.listdir(full):
                os.rmdir(full)
    except OSError:
        pass
    return {'purged': purged, 'errors': errors}
