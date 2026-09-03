# -*- coding: utf-8 -*-
"""Mixin: DELETE 分发（自动拆分自 mixin_dispatch.py，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase


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

        # ===== 鐩戞帶闃熷垪鍒犻櫎锛堟爣璁板凡澶勭悊锛?=====
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
                    try: conn.close()
                    except Exception: pass
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

                if resource == 'nodes' and len(parts) > 1:
                    node_id = parts[1]
                    cur.execute('DELETE FROM canvas_nodes WHERE id=?', (node_id,))
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

                elif resource == 'stats':
                    cur.execute('DELETE FROM task_stats')
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

                elif resource == 'logs':
                    cur.execute('DELETE FROM app_logs')
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

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
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

                elif resource == 'projects' and len(parts) > 1:
                    proj_id = parts[1]
                    # 鍒犻櫎椤圭洰鏃讹紝娓呴櫎鑺傜偣鐨?project_id锛堜笉鍒犻櫎鑺傜偣鏈韩锛?
                    cur.execute('UPDATE canvas_nodes SET project_id=NULL WHERE project_id=?', (proj_id,))
                    cur.execute('DELETE FROM projects WHERE id=?', (proj_id,))
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

                elif resource == 'chat':
                    # --- 鍘嗗彶闈㈡澘 v2锛氬垹闄ゅ崟涓細璇?/ 娓呯┖鍏ㄩ儴瀵硅瘽鍘嗗彶 ---
                    # 鏃ф暟鎹簱鍙兘宸插瓨鍦ㄥ綊妗ｈ〃浣嗙己灏?model_id锛屼笅闈細琛ラ綈瀛楁銆?
                    cur.execute('''CREATE TABLE IF NOT EXISTS chat_history_archive (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        session_id TEXT NOT NULL,
                        session_name TEXT,
                        role TEXT,
                        content TEXT,
                        model_id TEXT,
                            created_at INTEGER
                    )''')
                    # 褰掓。鍐欏叆鍙娇鐢ㄥ熀纭€瀛楁锛屽吋瀹规棭鏈熸病鏈?model_id 鐨勬棫琛ㄣ€?
                    if len(parts) > 1:
                        sid = parts[1]
                        # 褰掓。璇ヤ細璇?
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
                        # 鐪熸鍒犻櫎璇ヤ細璇濈殑 chat_history锛堜慨澶嶅師鏉ュ彧褰掓。涓嶅垹闄ょ殑 bug锛?
                        cur.execute('DELETE FROM chat_history WHERE session_id=?', (sid,))
                        deleted_rows = cur.rowcount
                        try:
                            cur.execute('DELETE FROM sessions WHERE id=?', (sid,))
                        except Exception:
                            pass
                        conn.commit()
                        result = {'ok': True, 'deleted': deleted_rows, 'archived_rows': archived, 'cleared': sid}
                    else:
                        # 娓呯┖鍏ㄩ儴锛氬厛鍏ㄩ儴褰掓。锛屽啀娓呯┖ chat_history
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
                            pass
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
            print(f'[DELETE /api/db] 500 閿欒: {e}')
            traceback.print_exc()
            if conn:
                try: conn.close()
                except Exception: pass
            self._send_error(str(e), 500)
            return

        # 连接已关闭，安全发送响应
        if result is not None:
            self._send_json(result)
        else:
            self._send_error('Unknown DELETE route: ' + path, 404)


    # ===== 鐑洿鏂?SSE 鍜?API 澶勭悊 =====


