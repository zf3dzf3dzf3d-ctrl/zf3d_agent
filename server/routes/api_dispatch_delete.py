# -*- coding: utf-8 -*-
"""Mixin: DELETE 分发（自动拆分自 mixin_dispatch.py，方法体未改动）"""
from routes._shared import *
import time
from routes.mixin_base import MixinBase
import logging


from util_log import get_logger

log = get_logger('api_dispatch_delete')
class MixinDispatchDelete(MixinBase):
    def do_DELETE(self):
        self._drain_body()
        # 安全：拦截恶意网页的跨站删除请求（CSRF）
        if not self._check_origin():
            self.close_connection = True
            return
        # 安全：token 认证（默认关闭不影响使用）
        from security import check_request_token
        if not check_request_token(self):
            self.close_connection = True
            return
        parsed = urlparse(self.path)
        path = parsed.path

        # ===== 备份管理：删除快照 =====
        if path.startswith('/api/backup/delete/'):
            backup_name = path[len('/api/backup/delete/'):]
            self._handle_backup_delete(backup_name)
            return

        # ===== 工作区 JSON：删除 =====
        if path == '/api/workspace/delete':
            self._handle_workspace_delete()
            return

        # ===== 监控队列删除（标记已处理锛?=====
        if path.startswith('/api/monitor/poll/'):
            chat_id = parse_qs(parsed.query).get('chat_id', [''])[0]
            if not chat_id:
                self._send_json({'ok': False, 'error': 'missing chat_id'}, 400)
                return
            key = path[len('/api/monitor/poll/'):]
            conn = None
            try:
                with _db_lock:
                    conn = get_db()
                    cur = conn.cursor()
                    cur.execute(
                        "DELETE FROM app_data WHERE category='monitor_queue' AND key=? "
                        "AND json_extract(value, '$.chat_id')=?",
                        (key, chat_id)
                    )
                    conn.commit()
                    deleted = cur.rowcount
                    conn.close()
                    conn = None
                self._send_json({'ok': True, 'deleted': deleted})
            except Exception as e:
                if conn:
                    try:
                        conn.close()
                    except Exception:
                        logging.debug("swallow", exc_info=True)
                self._send_error(str(e), 500)
            return

        if not path.startswith('/api/db/'):
            self._send_error('Unknown path: ' + path, 404)
            return

        parts = path[len('/api/db/'):].split('/')
        resource = parts[0] if parts else ''

        result = None
        conn = None
        try:
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                # 【修复 NameError 2026-11-11】审核发现 now 从未赋值（墓碑 L88 与日志底线 L101 均引用未定义名）。
                # app_logs.ts 与 kv_store.updated_at 均为毫秒时间戳口径（见 mixin_base.py L26 注释）。
                now_ms = int(time.time() * 1000)  # ts 毫秒口径，与 mixin_base.py app_logs 对齐

                if resource == 'nodes' and len(parts) > 1:
                    node_id = parts[1]
                    cur.execute('DELETE FROM canvas_nodes WHERE id=?', (node_id,))
                    # 【防重启复活】写墓碑：记录"该节点已被用户关闭"。
                    # 关闭后在途的异步回写（saveNode POST）即使晚于 DELETE 到达，重启后也不会复活窗口。
                    # 恢复已关闭对话（restoreLastClosed）走 POST /nodes/{id}/revive 显式复活，清除墓碑。
                    try:
                        cur.execute('INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)',
                                    ('node_tombstone:' + node_id, str(now_ms), now_ms))
                    except Exception:
                        pass
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

                elif resource == 'stats':
                    cur.execute('DELETE FROM task_stats')
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

                elif resource == 'logs':
                    # 【清理底线 2026-11-11】策划案 v2.1 P2：不再全量清空 app_logs，只删 30 天前的旧日志
                    cur.execute('DELETE FROM app_logs WHERE ts < ?', (now_ms - 30 * 86400000,))
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount,
                              'policy': 'only older than 30 days (audit baseline)'}

                elif resource == 'kv' and len(parts) > 1:
                    key = parts[1]
                    cur.execute('DELETE FROM kv_store WHERE key=?', (key,))
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

                elif resource == 'sessions' and len(parts) > 1:
                    sid = parts[1]
                    cur.execute('''CREATE TABLE IF NOT EXISTS chat_history_archive (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, session_name TEXT, role TEXT, content TEXT, model_id TEXT, created_at INTEGER)''')
                    # 归档时防重：跳过 archive 中已存在的完全相同行(session_id+role+content+created_at)
                    cur.execute('''
                        INSERT INTO chat_history_archive (session_id, session_name, role, content, model_id, created_at)
                        SELECT ch.session_id || '_arc_' || ch.created_at, COALESCE(s.name, ch.session_id), ch.role, ch.content, ch.model_id, ch.created_at
                        FROM chat_history ch LEFT JOIN sessions s ON s.id = ch.session_id
                        WHERE ch.session_id=? AND NOT EXISTS (
                            SELECT 1 FROM chat_history_archive a
                            WHERE a.session_id = ch.session_id || '_arc_' || ch.created_at AND a.role = ch.role
                              AND a.content = ch.content AND a.created_at = ch.created_at
                        )
                    ''', (sid,))
                    # 与 DELETE /chat/{sid} 保持一致：归档后删除原数据，避免重复归档
                    cur.execute('DELETE FROM chat_history WHERE session_id=?', (sid,))
                    cur.execute('DELETE FROM sessions WHERE id=?', (sid,))
                    # 云端镜像联动：写关闭标记，同步链路推到云端后由云端删除该会话镜像
                    try:
                        cur.execute('INSERT INTO chat_history (session_id, role, content, created_at) VALUES (?, ?, ?, ?)', (sid, '__closed__', '', int(time.time()*1000)))
                        conn.commit()
                    except Exception: logging.debug("swallow", exc_info=True)
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

                elif resource == 'projects' and len(parts) > 1:
                    proj_id = parts[1]
# 删除项目时，清空节点的 project_id（不删除节点本身）
                    cur.execute('UPDATE canvas_nodes SET project_id=NULL WHERE project_id=?', (proj_id,))
                    cur.execute('DELETE FROM projects WHERE id=?', (proj_id,))
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

                elif resource == 'chat':
                    # --- 历史面板 v2：删除单个会话 / 清空全部对话历史 ---
                    # 旧数据库可能已存在归档表但缺少 model_id 字段，下面会补齐字段
                    cur.execute('''CREATE TABLE IF NOT EXISTS chat_history_archive (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        session_id TEXT NOT NULL,
                        session_name TEXT,
                        role TEXT,
                        content TEXT,
                        model_id TEXT,
                            created_at INTEGER
                    )''')
# 归档写入只使用基础字段，兼容早期没有 model_id 的旧表。
                    if len(parts) > 1:
                        sid = parts[1]
                        # 归档该会璇?
                        cur.execute('''
                            INSERT INTO chat_history_archive
                                (session_id, session_name, role, content, model_id, created_at)
                            SELECT ch.session_id || '_arc_' || ch.created_at, COALESCE(s.name, ch.session_id), ch.role, ch.content, ch.model_id, ch.created_at
                            FROM chat_history ch
                            LEFT JOIN sessions s ON s.id = ch.session_id
                            WHERE ch.session_id=? AND NOT EXISTS (
                                SELECT 1 FROM chat_history_archive a
                                WHERE a.session_id = ch.session_id || '_arc_' || ch.created_at AND a.role = ch.role
                                  AND a.content = ch.content AND a.created_at = ch.created_at
                            )
                        ''', (sid,))
                        archived = cur.rowcount
# 真删除该会话的 chat_history（修复原来只归档不删除的 bug）
                        cur.execute('DELETE FROM chat_history WHERE session_id=?', (sid,))
                        deleted_rows = cur.rowcount
                        try:
                                                        cur.execute('DELETE FROM sessions WHERE id=?', (sid,))
                        except Exception:
                            logging.debug("swallow", exc_info=True)
                        conn.commit()
                        result = {'ok': True, 'deleted': deleted_rows, 'archived_rows': archived, 'cleared': sid}
                    else:
# 清空全部：先全部归档，再清空 chat_history
                        cur.execute('''
                            INSERT INTO chat_history_archive
                                (session_id, session_name, role, content, model_id, created_at)
                            SELECT ch.session_id || '_arc_' || ch.created_at, COALESCE(s.name, ch.session_id),
                                   ch.role, ch.content, ch.model_id, ch.created_at
                            FROM chat_history ch
                            LEFT JOIN sessions s ON s.id = ch.session_id
                            WHERE NOT EXISTS (
                                SELECT 1 FROM chat_history_archive a
                                WHERE a.session_id = ch.session_id || '_arc_' || ch.created_at AND a.role = ch.role
                                  AND a.content = ch.content AND a.created_at = ch.created_at
                            )
                        ''')
                        archived = cur.rowcount
                        cur.execute('DELETE FROM chat_history')
                        deleted_rows = cur.rowcount
                        try:
                                                        cur.execute('DELETE FROM sessions')
                        except Exception:
                            logging.debug("swallow", exc_info=True)
                        conn.commit()
                        result = {'ok': True, 'deleted': deleted_rows, 'archived_rows': archived, 'cleared': 'all'}

                elif resource == 'data' and len(parts) > 1:
                    category = parts[1]
                    if len(parts) > 2:
                        key = parts[2]
                        cur.execute('DELETE FROM app_data WHERE category=? AND key=?', (category, key))
                    else:
                        cur.execute('DELETE FROM app_data WHERE category=?', (category,))
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

                elif resource == 'chat-history' and len(parts) > 1 and parts[1] == 'archive':
                    cur.execute('DELETE FROM chat_history_archive')
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

                elif resource == 'chat-history' and len(parts) > 1:
                    try:
                        row_id = int(parts[1])
                    except ValueError:
                        result = {'ok': False, 'error': 'invalid id'}
                    else:
                        cur.execute('DELETE FROM chat_history_archive WHERE id=?', (row_id,))
                        conn.commit()
                        result = {'ok': True, 'deleted': cur.rowcount}

                else:
                    result = None  # 404

                conn.close()
                conn = None
        except Exception as e:
            log.info(f'[DELETE /api/db] 500 閿欒: {e}')
            traceback.print_exc()
            if conn:
                try:
                    conn.close()
                except Exception:
                    logging.debug("swallow", exc_info=True)
            self._send_error(str(e), 500)
            return

        # 连接已关闭，安全发送响应
        if result is not None:
            self._send_json(result)
        else:
            self._send_error('Unknown DELETE route: ' + path, 404)


    # ===== 鐑洿鏂?SSE 鍜?API 处理 =====


