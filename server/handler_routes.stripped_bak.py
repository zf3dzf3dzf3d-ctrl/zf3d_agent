#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HTTP 璺敱澶勭悊
"""

import os
import sys
import json
import ssl
import socket
import time
import shutil
import subprocess
import threading
import traceback
import urllib.request
import urllib.error
from urllib.parse import urlparse, parse_qs

from config import BASE_DIR, DB_PATH, CONFIG_PATH, PUBLIC_DIR, MIME_TYPES, HOST, PORT, _db_lock, VERSION
from db import get_db, init_db
from scheduler import ScheduledTask, _scheduled_tasks, _sched_lock
from handler_tools import HandlerTools
from handler_routes_backup import BackupRoutesMixin
from handler_routes_zf3d import Zf3dRoutesMixin
from handler_routes_away_project import AwayProjectRoutesMixin

class HandlerRoutes(BackupRoutesMixin, Zf3dRoutesMixin, AwayProjectRoutesMixin, HandlerTools):
    """璺敱澶勭悊 Mixin"""

    def do_OPTIONS(self):
        self._send_json({'ok': True})

    # ===== API 浠ｇ悊锛氳浆鍙戣姹傚埌绗笁鏂?AI 鏈嶅姟锛堣В鍐?CORS锛?=====
    def _handle_proxy(self):
        try:
            body = self._read_body()
            target_url = body.get('_target_url', '')
            method = body.get('_method', 'POST')
            headers = body.get('_headers', {})
            payload = body.get('_body', {})

            if not target_url:
                self._send_error('Missing _target_url', 400)
                return

            # 鏋勯€犺浆鍙戣姹?
            data = json.dumps(payload, ensure_ascii=True).encode('utf-8')
            req = urllib.request.Request(target_url, data=data, method=method)

            # 璁剧疆璇锋眰澶?
            for hk, hv in headers.items():
                req.add_header(hk, hv)

            # 娴忚鍣?UA 鍏滃簳锛歶rllib 榛樿 UA (Python-urllib/3.x) 浼氳 Cloudflare 1010 鎷︽埅
            # 锛堝疄娴?miaomio.net 403 error code: 1010锛屽姞娴忚鍣?UA 鍚?200 OK锛?
            if not any(k.lower() == 'user-agent' for k in headers):
                req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
                req.add_header('Accept', 'application/json, text/plain, */*')

            # 鍙戦€佽姹傦紙甯﹁秴鏃讹級
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE

            try:
                resp = urllib.request.urlopen(req, timeout=300, context=ctx)
                resp_body = resp.read().decode('utf-8', errors='replace')
                resp_status = resp.getcode()

                # 解析 JSON；若为 SSE 流式响应则逐行聚合
                try:
                    resp_data = json.loads(resp_body)
                except json.JSONDecodeError:
                    if resp_status == 200 and ('data:' in resp_body or 'data:' in resp_body.replace('\r', '')):
                        # 流式 SSE 响应：聚合 data: 行
                        sse_choices = []
                        content_parts = []
                        tool_calls_acc = {}
                        finish_reason = None
                        for line in resp_body.replace('\r', '').split('\n'):
                            line = line.strip()
                            if not line.startswith('data:'):
                                continue
                            payload = line[5:].strip()
                            if not payload or payload == '[DONE]':
                                continue
                            try:
                                chunk = json.loads(payload)
                            except json.JSONDecodeError:
                                continue
                            if not isinstance(chunk, dict):
                                continue
                            if 'choices' in chunk and isinstance(chunk['choices'], list):
                                for c in chunk['choices']:
                                    if not isinstance(c, dict):
                                        continue
                                    if c.get('finish_reason'):
                                        finish_reason = c.get('finish_reason')
                                    delta = c.get('delta') or c.get('message') or {}
                                    if not isinstance(delta, dict):
                                        continue
                                    if delta.get('content'):
                                        content_parts.append(delta['content'])
                                    tc = delta.get('tool_calls')
                                    if tc:
                                        for t in tc:
                                            idx = t.get('index', 0)
                                            if idx not in tool_calls_acc:
                                                tool_calls_acc[idx] = {'id': t.get('id') or '', 'type': t.get('type') or 'function', 'function': {'name': '', 'arguments': ''}}
                                            if t.get('id'):
                                                tool_calls_acc[idx]['id'] = t['id']
                                            if t.get('function'):
                                                if t['function'].get('name'):
                                                    tool_calls_acc[idx]['function']['name'] += t['function']['name']
                                                if t['function'].get('arguments'):
                                                    tool_calls_acc[idx]['function']['arguments'] += t['function']['arguments']
                        message = {'role': 'assistant', 'content': ''.join(content_parts)}
                        if tool_calls_acc:
                            message['tool_calls'] = [tool_calls_acc[k] for k in sorted(tool_calls_acc)]
                        resp_data = {
                            'id': 'chatcmpl-sse',
                            'object': 'chat.completion',
                            'choices': [{'index': 0, 'message': message, 'finish_reason': finish_reason or 'stop'}],
                        }
                    else:
                        resp_data = {'raw': resp_body}

                self._send_json({
                    'ok': resp_status == 200,
                    'status': resp_status,
                    'data': resp_data,
                    'raw': resp_body if resp_status != 200 else None
                })
            except urllib.error.HTTPError as e:
                err_body = e.read().decode('utf-8', errors='replace')
                print(f'[Proxy] HTTP {e.code}: {err_body[:500]}')
                self._send_json({
                    'ok': False,
                    'status': e.code,
                    'error': err_body[:2000],
                    'data': None
                })
            except urllib.error.URLError as e:
                print(f'[Proxy] URL Error: {e}')
                self._send_json({
                    'ok': False,
                    'status': 0,
                    'error': f'杩炴帴澶辫触: {e.reason}',
                    'data': None
                })
            except socket.timeout as e:
                print(f'[Proxy] Timeout: {e}')
                self._send_json({
                    'ok': False,
                    'status': 0,
                    'error': '璇锋眰瓒呮椂锛屽凡缁堟',
                    'data': None
                })

        except Exception as e:
            print(f'[Proxy] 寮傚父: {e}')
            self._send_json({'ok': False, 'error': str(e), 'status': 0})

    # ===== 鍋ュ悍妫€鏌?=====
    def do_GET_health(self):
        self._send_json({'ok': True, 'service': 'zf3d-sqlite', 'port': PORT})

    def do_GET_version(self):
        # 从 version.json 实时读取；失败时回落到 config.VERSION
        try:
            vp = os.path.join(BASE_DIR, 'private', 'version.json')
            with open(vp, 'r', encoding='utf-8') as f:
                vj = json.load(f)
            ver = vj.get('version') or VERSION
        except Exception:
            ver = VERSION
        self._send_json({'ok': True, 'version': ver})

    # ===== 璺敱鍒嗗彂 =====
    def _serve_static(self, path):
        """鎻愪緵闈欐€佹枃浠舵湇鍔?"""
        from urllib.parse import unquote
        # 瀹夊叏锛氶樆姝㈢洰褰曠┛瓒?
        if '..' in path:
            self.send_error(403)
            return
        # 鏍硅矾寰?-> index.html
        if path == '/' or path == '':
            path = '/index.html'
        # URL 瑙ｇ爜锛堟敮鎸佷腑鏂囨枃浠跺悕锛屽 鎹愯禒_寰俊.gif锛?
        path = unquote(path)
        # 鏄犲皠鍒?public 鐩綍
        file_path = os.path.join(PUBLIC_DIR, path.lstrip('/'))
        # 鐩綍鍒欒ˉ index.html
        if os.path.isdir(file_path):
            file_path = os.path.join(file_path, 'index.html')
        if not os.path.isfile(file_path):
            self.send_error(404, 'File not found: ' + path)
            return
        # 纭畾 MIME 绫诲瀷
        ext = os.path.splitext(file_path)[1].lower()
        mime = MIME_TYPES.get(ext, 'application/octet-stream')
        try:
            with open(file_path, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, str(e))


    def _handle_pixel_display_poll(self):
        """GET /api/pixel/display - return the latest pixel display data."""
        conn = None
        try:
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("SELECT value FROM app_data WHERE category='pixel_display' AND key='latest' ORDER BY id DESC LIMIT 1")
                row = cur.fetchone()
                conn.close()
            conn = None
            if row:
                d = json.loads(row['value'])
                self._send_json({
                    'ok': True,
                    'has_data': True,
                    'data': d.get('data', ''),
                    'title': d.get('title', ''),
                    'timestamp': d.get('timestamp', 0)
                })
            else:
                self._send_json({'ok': True, 'has_data': False})
        except Exception as e:
            print(f'[GET /api/pixel/display] 500: {e}')
            traceback.print_exc()
            if conn:
                try: conn.close()
                except: pass
            self._send_error(str(e), 500)

    # PXL 璋冭壊鏉匡紙RGB 鍏冪粍锛?
    _PXL_PALETTES = {
        'B': [(0,0,0), (255,255,255)],
        'C16': [
            (0,0,0),(29,43,83),(126,37,83),(0,135,81),
            (171,82,52),(95,87,79),(194,195,199),(255,241,232),
            (255,0,77),(255,163,0),(255,236,39),(0,228,54),
            (41,173,255),(131,56,236),(255,119,168),(255,204,170)
        ]
    }

    def _handle_pixel_export_gif(self):
        """GET /api/pixel/export_gif - 瀵煎嚭褰撳墠鍍忕礌鍔ㄧ敾涓篏IF"""
        conn = None
        try:
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("SELECT value FROM app_data WHERE category='pixel_display' AND key='latest' ORDER BY id DESC LIMIT 1")
                row = cur.fetchone()
                conn.close()
                conn = None

            if not row:
                self._send_json({'ok': False, 'error': 'no data'})
                return

            d = json.loads(row['value'])
            pxl_data = d.get('data', '')
            if not pxl_data:
                self._send_json({'ok': False, 'error': 'no pxl data'})
                return

            # 瑙ｆ瀽PXL鏁版嵁
            import re as _re
            colon_idx = pxl_data.index(':')
            header = pxl_data[:colon_idx].strip()
            body = pxl_data[colon_idx + 1:].strip()

            header_parts = header.split()
            size_mode = header_parts[0]
            frame_info = header_parts[1] if len(header_parts) > 1 else ''

            m = _re.match(r'^(\d+)x(\d+)(B|C\d+)$', size_mode, _re.I)
            if not m:
                self._send_json({'ok': False, 'error': 'invalid PXL header'})
                return

            width = int(m.group(1))
            height = int(m.group(2))
            mode = m.group(3).upper()

            frame_count = 1
            fps = 4
            if frame_info:
                fm = _re.match(r'^F(\d+)(?:@(\d+))?$', frame_info, _re.I)
                if fm:
                    frame_count = int(fm.group(1))
                    if fm.group(2):
                        fps = int(fm.group(2))

            # 璋冭壊鏉?
            palette = _PXL_PALETTES.get(mode, _PXL_PALETTES['B'])

            # 瑙ｇ爜RLE锛圔妯″紡=浜ゆ浛璁℃暟锛孋16妯″紡=棰滆壊.鏁伴噺瀵癸級
            def decode_rle(rle_str, total_pixels):
                pixels = []
                if mode == 'B':
                    nums = rle_str.split(',')
                    current_color = 0
                    for num in nums:
                        count = int(num.strip())
                        if count <= 0: continue
                        for _ in range(count):
                            pixels.append(current_color)
                        current_color = 1 - current_color
                else:
                    # C16: token = 棰滆壊.鏁伴噺 鎴?棰滆壊(榛樿1), X=閫忔槑
                    tokens = rle_str.split(',')
                    for tok in tokens:
                        tok = tok.strip()
                        if not tok: continue
                        # 閫忔槑鑹?
                        if tok[0].upper() == 'X':
                            parts = tok.split('.')
                            cnt = int(parts[1]) if len(parts) > 1 and parts[1] else 1
                            for _ in range(cnt):
                                pixels.append(-1)  # -1 = 閫忔槑
                            continue
                        if '.' in tok:
                            parts = tok.split('.')
                            ci = int(parts[0])
                            cnt = int(parts[1]) if len(parts) > 1 and parts[1] else 1
                        else:
                            ci = int(tok)
                            cnt = 1
                        ci = max(0, min(ci, len(palette) - 1))
                        for _ in range(cnt):
                            pixels.append(ci)
                while len(pixels) < total_pixels:
                    pixels.append(0)
                return pixels[:total_pixels]

            frame_strs = body.split('|')
            frames = []
            for i in range(min(len(frame_strs), frame_count)):
                pixels = decode_rle(frame_strs[i].strip(), width * height)
                frames.append(pixels)

            if not frames:
                self._send_json({'ok': False, 'error': 'no frames decoded'})
                return

            # 鐢≒illow鐢熸垚GIF
            from PIL import Image

            pixel_size = 16  # 姣忎釜鍍忕礌鏀惧ぇ鍒?6x16
            img_w = width * pixel_size
            img_h = height * pixel_size

            images = []
            for frame_pixels in frames:
                img = Image.new('RGBA', (img_w, img_h), (0, 0, 0, 0))
                pixels_obj = img.load()
                for y in range(height):
                    for x in range(width):
                        idx = y * width + x
                        color_idx = frame_pixels[idx] if idx < len(frame_pixels) else 0
                        if color_idx == -1:
                            continue  # 閫忔槑锛岃烦杩?
                        color = palette[color_idx] if color_idx < len(palette) else palette[0]
                        rgba = (color[0], color[1], color[2], 255)
                        for py in range(pixel_size):
                            for px in range(pixel_size):
                                pixels_obj[x * pixel_size + px, y * pixel_size + py] = rgba
                images.append(img)

            # 淇濆瓨涓篏IF
            exports_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'exports')
            os.makedirs(exports_dir, exist_ok=True)
            gif_path = os.path.join(exports_dir, 'pixel_animation.gif')

            duration_ms = int(1000 / fps)
            if len(images) == 1:
                images[0].save(gif_path, 'GIF', transparency=0)
            else:
                images[0].save(
                    gif_path, 'GIF',
                    save_all=True,
                    append_images=images[1:],
                    duration=duration_ms,
                    loop=0,
                    disposal=2,
                    transparency=0
                )

            gif_url = '/exports/pixel_animation.gif?t=' + str(int(time.time()))
            self._send_json({'ok': True, 'url': gif_url, 'frames': len(images), 'size': str(img_w) + 'x' + str(img_h)})

        except Exception as e:
            print(f'[GET /api/pixel/export_gif] 500: {e}')
            traceback.print_exc()
            if conn:
                try: conn.close()
                except: pass
            self._send_json({'ok': False, 'error': str(e)})



    def _handle_monitor_poll(self, query=None):

        allowed_ids = {
            chat_id for chat_id in (query or {}).get('chat_id', [])
            if isinstance(chat_id, str) and chat_id
        }
        if not allowed_ids:
            self._send_json({'ok': False, 'error': 'missing chat_id'}, 400)
            return

        conn = None
        try:
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                placeholders = ','.join('?' for _ in allowed_ids)
                cur.execute(
                    "SELECT key, value FROM app_data "
                    "WHERE category='monitor_queue' "
                    "AND json_extract(value, '$.chat_id') IN (" + placeholders + ") "
                    "ORDER BY created_at",
                    tuple(allowed_ids)
                )

                rows = cur.fetchall()
                items = []
                for r in rows:
                    try:
                        data = json.loads(r['value'])
                        if data.get('chat_id', '') not in allowed_ids:
                            continue
                        items.append({
                            'key': r['key'],
                            'chat_id': data.get('chat_id', ''),
                            'message': data.get('message', '')
                        })
                    except Exception:
                        pass
                conn.close()
                conn = None
            self._send_json({'ok': True, 'items': items, 'count': len(items)})
        except Exception as e:
            print(f'[GET /api/monitor/poll] 500 閿欒: {e}')
            traceback.print_exc()
            if conn:
                try: conn.close()
                except: pass
            self._send_error(str(e), 500)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # API 璺敱
        if path == '/api/health':
            self.do_GET_health()
            return

        if path == '/api/version':
            self.do_GET_version()
            return

        if path.startswith('/api/db/'):
            self._handle_db_get(path)
            return

        # ===== 澶囦唤绠＄悊 =====
        if path == '/api/backup/list':
            self._handle_backup_list()
            return
        if path == '/api/backup/open-folder':
            self._handle_backup_open_folder()
            return

        # ===== 鏈卞嘲绀惧尯鐘舵€?=====
        if path == '/api/zf3d/status':
            self._handle_zf3d_status()
            return
        if path == '/api/zf3d/site-config':
            self._handle_zf3d_site_config()
            return
        if path == '/api/zf3d/logo-img':
            self._handle_zf3d_logo_img()
            return

        # ===== 鍍忕礌鏄剧ず鍣ㄩ潰鏉胯疆璇?=====
        if path == '/api/pixel/display':
            self._handle_pixel_display_poll()
            return

        # ===== 鍍忕礌鏄剧ず鍣ㄥ鍑篏IF =====
        if path == '/api/pixel/export_gif':
            self._handle_pixel_export_gif()
            return

        # ===== 鐩戞帶闃熷垪杞 =====
        if path == '/api/monitor/poll':
            self._handle_monitor_poll(parse_qs(parsed.query))
            return

        # ===== 绂诲矖妯″紡 =====
        if path == '/api/away/status':
            self._handle_away_status()
            return
        if path == '/api/away/config':
            self._handle_away_config_get()
            return

        # ===== 读取用户最后使用的大模型 =====
        if path == '/api/chat/last-model':
            self._handle_get_last_model()
            return

        # ===== 鍋ュ悍瀹堟姢妯″紡 =====
        if path == '/api/health/config':
            self._handle_health_config_get()
            return

        # ===== 鎵撳紑椤圭洰鏂囦欢澶?=====
        if path.startswith('/api/project/open-folder'):
            self._handle_open_project_folder(parsed)
            return

        # ===== 娴忚鐩綍锛堟枃浠跺す閫夋嫨鍣級=====
        if path.startswith('/api/project/browse-folder'):
            self._handle_browse_folder(parsed)
            return
        if path == '/api/project/files':
            self._handle_project_files(parsed)
            return
        if path == '/api/project/file-preview':
            self._handle_project_file_preview(parsed)
            return

        # ===== 鐑洿鏂帮細SSE 瀹炴椂鎺ㄩ€?=====
        if path == '/api/hot-reload/sse':
            self._handle_hot_reload_sse()
            return

        # ===== 鐑洿鏂帮細鐘舵€佹煡璇?=====
        if path == '/api/hot-reload/status':
            self._handle_hot_reload_status()
            return

        # 闈濧PI璺緞 -> 闈欐€佹枃浠舵湇鍔?
        if path == '/api/update-status':
            self._handle_update_status()
            return

        self._serve_static(path)

    def _handle_db_get(self, path):
        """澶勭悊 /api/db/* 鐨?GET 璇锋眰"""
        parsed = urlparse(self.path)
        parts = path[len('/api/db/'):].split('/')
        resource = parts[0] if parts else ''

        # 鍏堟煡璇㈡暟鎹紝鍏抽棴杩炴帴锛屽啀鍙戦€佸搷搴旓紙閬垮厤杩炴帴娉勬紡锛?
        result = None
        conn = None
        try:
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()

                if resource == 'nodes':
                    cur.execute('SELECT * FROM canvas_nodes ORDER BY z_index')
                    result = {'ok': True, 'data': [dict(r) for r in cur.fetchall()]}

                elif resource == 'canvas' and len(parts) > 1 and parts[1] == 'view':
                    cur.execute('SELECT * FROM canvas_view WHERE id=1')
                    row = cur.fetchone()
                    result = {'ok': True, 'data': dict(row) if row else {}}

                elif resource == 'kv' and len(parts) > 1:
                    key = parts[1]
                    cur.execute('SELECT value FROM kv_store WHERE key=?', (key,))
                    row = cur.fetchone()
                    result = {'ok': True, 'data': row['value'] if row else None}

                elif resource == 'chat-history' and len(parts) > 1 and parts[1] in ('sessions', 'all'):
                    # Existing installations may predate the archive table.
                    cur.execute('''
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
                    cur.execute("PRAGMA table_info(chat_history_archive)")
                    archive_columns = {row['name'] for row in cur.fetchall()}
                    if 'model_id' not in archive_columns:
                        cur.execute('ALTER TABLE chat_history_archive ADD COLUMN model_id TEXT')
                    cur.execute('''
                        SELECT session_id, session_name, role, content, model_id, created_at
                        FROM (
                            SELECT ch.session_id, COALESCE(s.name, ch.session_id) AS session_name,
                                   ch.role, ch.content, ch.model_id, ch.created_at
                            FROM chat_history ch
                            LEFT JOIN sessions s ON s.id = ch.session_id
                            WHERE ch.role = 'user'
                            UNION ALL
                            SELECT session_id, COALESCE(session_name, session_id) AS session_name,
                                   role, content, model_id, created_at
                            FROM chat_history_archive
                            WHERE role = 'user'
                        ) all_history
                        ORDER BY created_at DESC
                    ''')
                    result = {'ok': True, 'data': [dict(row) for row in cur.fetchall()]}

                elif resource == 'sessions':
                    cur.execute('SELECT * FROM sessions ORDER BY created_at DESC')
                    result = {'ok': True, 'data': [dict(r) for r in cur.fetchall()]}

                elif resource == 'projects':
                    cur.execute('SELECT * FROM projects ORDER BY created_at DESC')
                    result = {'ok': True, 'data': [dict(r) for r in cur.fetchall()]}

                elif resource == 'chat' and len(parts) > 1:
                    sid = parts[1]
                    cur.execute('SELECT * FROM chat_history WHERE session_id=? ORDER BY created_at', (sid,))
                    result = {'ok': True, 'data': [dict(r) for r in cur.fetchall()]}

                elif resource == 'data' and len(parts) > 1:
                    category = parts[1]
                    if len(parts) > 2:
                        key = parts[2]
                        cur.execute('SELECT value FROM app_data WHERE category=? AND key=?', (category, key))
                        row = cur.fetchone()
                        result = {'ok': True, 'data': row['value'] if row else None}
                    else:
                        cur.execute('SELECT * FROM app_data WHERE category=?', (category,))
                        result = {'ok': True, 'data': [dict(r) for r in cur.fetchall()]}

                elif resource == 'logs':
                    limit = 200
                    qs = parse_qs(parsed.query)
                    if 'limit' in qs:
                        limit = min(int(qs['limit'][0]), 2000)
                    cur.execute('SELECT * FROM app_logs ORDER BY ts DESC LIMIT ?', (limit,))
                    result = {'ok': True, 'data': [dict(r) for r in cur.fetchall()]}

                elif resource == 'stats':
                    # ===== 鐢ㄦ埛淇℃伅鍒楄〃闈㈡澘锛氭寜浼氳瘽鍒嗙粍鐨勯棶棰樼骇鎴愯触鏁版嵁 =====
                    qs = parse_qs(parsed.query)
                    if qs.get('view', [''])[0] == 'userlist':
                        # 鏁版嵁婧愶細sessions + chat_history锛堢敤鎴烽棶棰橈級+ task_stats锛堟垚鍔熶笌鍚︼級
                        today_start = int(time.mktime(time.strptime(time.strftime('%Y-%m-%d', time.localtime()), '%Y-%m-%d')) * 1000)

                        # 1) 姣忎釜浼氳瘽鐨勭敤鎴烽棶棰樺強鏃堕棿
                        cur.execute('SELECT session_id, content, created_at FROM chat_history WHERE role=? ORDER BY created_at ASC', ('user',))
                        user_msgs = cur.fetchall()

                        # 2) 浠诲姟鎴愯触璁板綍锛坰ession_id, task_title, success锛?
                        cur.execute('SELECT session_id, task_title, success, created_at FROM task_stats ORDER BY created_at ASC')
                        stats_rows = cur.fetchall()

                        # 鎸?session 鍒嗙粍
                        sess_map = {}
                        for r in user_msgs:
                            sid = r['session_id']
                            if sid not in sess_map:
                                sess_map[sid] = {'sid': sid, 'questions': [], 'firstTs': r['created_at'], 'lastTs': r['created_at']}
                            q = {'ts': r['created_at'], 'text': (r['content'] or '')[:120], 'ok': None}
                            sess_map[sid]['questions'].append(q)
                        for r in stats_rows:
                            sid = r['session_id']
                            if sid in sess_map:
                                # 鍖归厤闂鏂囨湰鏈€杩戠殑 user 娑堟伅锛堝湪 stats 璁板綍涔嬪墠銆佷笖鏂囨湰鍚?task_title 鎴栨渶鎺ヨ繎鏃堕棿锛?
                                matched = False
                                t_title = (r['task_title'] or '').strip()
                                if t_title:
                                    for q in sess_map[sid]['questions']:
                                        if q['ts'] <= (r['created_at'] or 0) and (q['text'] and t_title in q['text'] or q['text'] in t_title):
                                            q['ok'] = 1 if r['success'] else 0
                                            matched = True
                                            break
                                if not matched:
                                    # 鏃犱汉璁ら 鈫?璁颁负鈥滄湭鍥炵瓟闂鈥濓紙浠呰渚ф爮鏉℃暟锛?
                                    sess_map[sid]['questions'].append({'ts': r['created_at'], 'text': t_title, 'ok': (1 if r['success'] else 0), 'unclaimed': 1})
                        # lastTs 鏇存柊涓烘渶鍚庝竴鏉℃秷鎭椂闂?
                        cur.execute('SELECT session_id, MAX(created_at) AS mx FROM chat_history GROUP BY session_id')
                        for r in cur.fetchall():
                            if r['session_id'] in sess_map:
                                sess_map[r['session_id']]['lastTs'] = r['mx']

                        sessions = list(sess_map.values())
                        for s in sessions:
                            ok_n = sum(1 for q in s['questions'] if q.get('ok') == 1)
                            fa_n = sum(1 for q in s['questions'] if q.get('ok') == 0)
                            un_n = sum(1 for q in s['questions'] if q.get('unclaimed'))
                            s['okCount'] = ok_n; s['failCount'] = fa_n
                            s['qCount'] = len(s['questions'])
                        sessions.sort(key=lambda x: x['lastTs'] or 0, reverse=True)
                        result = {'ok': True, 'data': {'sessions': sessions, 'todayStart': today_start}}
                    else:
                        date_range = qs.get('range', ['all'])[0]
                        if date_range == 'today':
                            today_start = int(time.mktime(time.strptime(time.strftime('%Y-%m-%d', time.localtime()), '%Y-%m-%d')) * 1000)
                            cur.execute('SELECT * FROM task_stats WHERE created_at >= ? ORDER BY created_at DESC', (today_start,))
                        elif date_range == 'month':
                            month_start = int(time.mktime(time.strptime(time.strftime('%Y-%m-01', time.localtime()), '%Y-%m-%d')) * 1000)
                            cur.execute('SELECT * FROM task_stats WHERE created_at >= ? ORDER BY created_at DESC', (month_start,))
                        else:
                            cur.execute('SELECT * FROM task_stats ORDER BY created_at DESC LIMIT 500')
                        rows = [dict(r) for r in cur.fetchall()]
                        total_tasks = len(rows)
                        success_tasks = sum(1 for r in rows if r.get('success'))
                        total_tokens = sum(r.get('tokens_used', 0) or 0 for r in rows)
                        avg_tokens = int(total_tokens / total_tasks) if total_tasks > 0 else 0
                        daily_map = {}
                        for r in rows:
                            day_str = time.strftime('%Y-%m-%d', time.localtime(r.get('created_at', 0) / 1000))
                            if day_str not in daily_map:
                                daily_map[day_str] = {'date': day_str, 'tasks': 0, 'tokens': 0, 'success': 0}
                            daily_map[day_str]['tasks'] += 1
                            daily_map[day_str]['tokens'] += r.get('tokens_used', 0) or 0
                            if r.get('success'):
                                daily_map[day_str]['success'] += 1
                        daily = sorted(daily_map.values(), key=lambda x: x['date'])
                        result = {'ok': True, 'data': {
                            'tasks': rows,
                            'summary': {
                                'total_tasks': total_tasks,
                                'success_tasks': success_tasks,
                                'fail_tasks': total_tasks - success_tasks,
                                'total_tokens': total_tokens,
                                'avg_tokens': avg_tokens
                            },
                            'daily': daily
                        }}

                else:
                    result = None  # 404

                conn.close()
                conn = None
        except Exception as e:
            print(f'[GET /api/db] 500 閿欒: {e}')
            traceback.print_exc()
            if conn:
                try: conn.close()
                except: pass
            self._send_error(str(e), 500)
            return

        # 杩炴帴宸插叧闂紝瀹夊叏鍙戦€佸搷搴?
        if result is not None:
            self._send_json(result)
        else:
            self._send_error('Unknown GET route: ' + path, 404)

    def _handle_release_create(self):
        try:
            body = self._read_body()
            script = os.path.join(BASE_DIR, 'scripts', 'release_flow.py')
            version = str(body.get('version', '')).strip()
            summary = str(body.get('summary', '')).strip()
            output_root = str(body.get('output_dir', body.get('output_root', os.path.dirname(BASE_DIR))))
            command = [sys.executable, str(script), version, '--summary', summary, '--output-root', output_root]
            completed = subprocess.run(command, cwd=str(BASE_DIR), capture_output=True, text=True, timeout=300)
            if completed.returncode != 0:
                self._send_json({'ok': False, 'error': completed.stderr.strip() or completed.stdout.strip()})
                return
            self._send_json({'ok': True, 'data': json.loads(completed.stdout), 'excluded': ['.git', '.venv', 'venv', 'data', 'private', 'backups', 'node_modules', '*.pyc', '*.bak']})
        except Exception as exc:
            self._send_json({'ok': False, 'error': str(exc)})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # ===== API 浠ｇ悊锛堣В鍐?CORS锛?=====
        if path == '/api/proxy':
            self._handle_proxy()
            return

        # ===== 鍏嶈垂鐢熷浘锛堟殏鏈紑鏀撅紝淇濈暀 image_gen 妯″潡渚涘悗缁仮澶嶏級 =====
        if path == '/api/image-gen':
            try:
                import image_gen as _igen
                body = self._read_body()
                action = body.get('action', 'generate')
                if action == 'status':
                    self._send_json({'ok': True, 'data': _igen.status()})
                elif action in ('set_key', 'clear_key'):
                    provider = str(body.get('provider', '') or '').strip()
                    key = body.get('key')
                    if action == 'clear_key':
                        r = _igen.clear_key(provider)
                    else:
                        r = _igen.set_key(provider, key)
                    if r.get('ok'):
                        self._send_json({'ok': True, 'data': r})
                    else:
                        self._send_json({'ok': False, 'data': {'error': r.get('error', '密钥保存失败')}})
                else:
                    prompt = str(body.get('prompt', '') or '').strip()
                    if action == 'edit':
                        source_prompt = str(body.get('source_prompt', '') or '').strip()
                        instruction = str(body.get('instruction', '') or prompt).strip()
                        source_image = str(body.get('source_image', '') or '').strip()
                        prompt = (source_prompt + '\n修改要求：' + instruction).strip() if source_prompt else instruction
                    if not prompt:
                        self._send_json({'ok': False, 'data': {'error': '请输入图片描述或修改要求'}}, status=400)
                        return
                    result = _igen.generate(prompt, size=body.get('size', '1024x1024'),
                                            model=body.get('model') or None,
                                            image_url=(source_image if action == 'edit' and source_image else None))
                    if result.get('url'):
                        self._send_json({'ok': True, 'data': {'tool': 'image_gen', 'images': [{'url': result.get('url')}], 'url': result.get('url'), 'provider': result.get('provider'), 'model': result.get('model'), 'channel': result.get('channel'), 'size': result.get('size')}})
                    else:
                        self._send_json({'ok': False, 'data': {'error': result.get('error', '鍥剧墖鐢熸垚澶辫触')}})
            except Exception as e:
                self._send_json({'ok': False, 'data': {'error': str(e)}})
            return

        # ===== 瑙嗛鐢熸垚锛堝娓犻亾锛歅ollinations Veo-3 鍏嶈垂榛樿 / 纭呭熀娴佸姩 Wan2.1 闇€ key锛?=====
        if path == '/api/video-gen':
            try:
                import video_gen as _vgen
                body = self._read_body()
                act = body.get('action', 'generate')
                if act == 'status':
                    self._send_json({'ok': True, 'data': _vgen.video_status()})
                else:
                    r = _vgen.generate_video(
                        body.get('prompt', ''),
                        key=body.get('key', '') or '',
                        size=body.get('size', '832x480'),
                        duration=body.get('duration') or 5,
                        model=body.get('model', 'veo3'),
                        negative_prompt=body.get('negative_prompt', '') or '',
                        seed=body.get('seed'))
                    # 缁熶竴杩斿洖鏍煎紡
                    if r.get('ok'):
                        self._send_json({
                            'ok': True,
                            'data': {
                                'tool': 'video_gen',
                                'videos': [{'url': r.get('url'), 'provider': r.get('provider'),
                                            'task_id': r.get('task_id')}],
                                'model': r.get('model'),
                                'duration': r.get('duration'),
                                'provider': r.get('provider')
                            }
                        })
                    else:
                        self._send_json({'ok': False, 'data': {'error': r.get('error', '瑙嗛鐢熸垚澶辫触'),
                                                                  'provider': r.get('provider')}})
            except Exception as e:
                self._send_json({'ok': False, 'data': {'error': str(e)}})
            return

        # ===== 澶囦唤绠＄悊 =====
        if path == '/api/backup/create':
            self._handle_backup_create()
            return
        if path == '/api/backup/restore':
            self._handle_backup_restore()
            return

        # ===== 绂诲矖妯″紡 =====
        if path == '/api/away/heartbeat':
            self._handle_away_heartbeat()
            return
        if path == '/api/away/config':
            self._handle_away_config_save()
            return

        # ===== 鍋ュ悍瀹堟姢妯″紡 =====
        if path == '/api/health/config':
            self._handle_health_config_save()
            return

        # ===== 鍩虹宸ュ叿锛堣鍙?鍐欏叆/杩愯锛?=====
        if path.startswith('/api/tools/'):
            self._handle_tools_post(path)
            return

        # ===== 鍏宠仈鏂囦欢澶瑰埌椤圭洰 =====
        if path == '/api/project/link-folder':
            self._handle_link_folder()
            return

        # ===== 记住用户最后使用的大模型（前端每次发消息时上报） =====
        if path == '/api/chat/report-model':
            self._handle_report_last_model()
            return

        # ===== 生成项目记忆 =====
        if path == '/api/project/memory/generate':
            self._handle_generate_project_memory()
            return

        # ===== 鐑洿鏂帮細鎵嬪姩閲嶈浇 =====
        if path == '/api/hot-reload/reload':
            self._handle_hot_reload_manual()
            return

        # ===== 鏂扮増鏈埗浣滄祦 =====
        if path == '/api/release/create':
            self._handle_release_create()
            return

        # ===== 鑷姩鏇存柊 =====
        if path == '/api/update-status':
            self._handle_update_status()
            return

        if path == '/api/check-update':
            self._handle_check_update()
            return
        if path == '/api/do-update':
            self._handle_do_update(self._read_body())
            return

        if path == '/api/update-status':
            self._handle_update_status()
            return
            return

        # ===== 鏈卞嘲绀惧尯鐧诲綍/绛惧埌 =====
        if path == '/api/zf3d/login':
            self._handle_zf3d_login()
            return
        if path == '/api/zf3d/checkin':
            self._handle_zf3d_checkin()
            return
        if path == '/api/zf3d/status':
            self._handle_zf3d_status()
            return
        if path == '/api/zf3d/heartbeat-config':
            self._handle_zf3d_heartbeat_config()
            return
        if path == '/api/zf3d/heartbeat-status':
            self._handle_zf3d_heartbeat_status()
            return
        if path == '/api/zf3d/site-config':
            self._handle_zf3d_site_config()
            return

        if not path.startswith('/api/db/'):
            self._send_error('Unknown path: ' + path, 404)
            return

        parts = path[len('/api/db/'):].split('/')
        resource = parts[0] if parts else ''

        result = None
        conn = None
        try:
            body = self._read_body()
            now = int(__import__('time').time() * 1000)

            with _db_lock:
                conn = get_db()
                cur = conn.cursor()

                if resource == 'nodes' and len(parts) > 2 and parts[2] == 'project':
                    # POST /nodes/{id}/project 鈥?璁剧疆鑺傜偣鐨勯」鐩綊灞?
                    node_id = parts[1]
                    proj_id = body.get('projectId', None)
                    cur.execute('UPDATE canvas_nodes SET project_id=?, updated_at=? WHERE id=?', (proj_id, now, node_id))
                    conn.commit()
                    result = {'ok': True}

                elif resource == 'nodes':
                    node_id = body.get('id', 'n' + str(now))
                    cur.execute('''
                        INSERT OR REPLACE INTO canvas_nodes
                        (id, title, model_id, x, y, w, h, collapsed, z_index, scroll_pos, project_id, created_at, updated_at,
                         session_total_tokens, session_total_api_calls, session_total_duration,
                         session_total_prompt_tokens, session_total_completion_tokens,
                         session_total_cache_hit_tokens, session_total_cache_miss_tokens)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                                ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        node_id, body.get('title', ''), body.get('modelId', ''),
                        body.get('x', 0), body.get('y', 0),
                        body.get('w', 320), body.get('h', 420),
                        1 if body.get('collapsed') else 0,
                        body.get('z', 50),
                        body.get('scrollPos', 0),
                        body.get('projectId', None),
                        body.get('createdAt', now), now,
                        body.get('sessionTotalTokens', 0), body.get('sessionTotalApiCalls', 0),
                        body.get('sessionTotalDuration', 0), body.get('sessionTotalPromptTokens', 0),
                        body.get('sessionTotalCompletionTokens', 0),
                        body.get('sessionTotalCacheHitTokens', 0), body.get('sessionTotalCacheMissTokens', 0)
                    ))
                    conn.commit()
                    result = {'ok': True, 'id': node_id}

                elif resource == 'canvas' and len(parts) > 1 and parts[1] == 'view':
                    cur.execute('''
                        UPDATE canvas_view SET x=?, y=?, scale=?, updated_at=? WHERE id=1
                    ''', (body.get('x', 0), body.get('y', 0), body.get('scale', 1), now))
                    conn.commit()
                    result = {'ok': True}

                elif resource == 'kv':
                    key = body.get('key', '')
                    value = json.dumps(body.get('value'), ensure_ascii=False)
                    cur.execute('''
                        INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
                    ''', (key, value, now))
                    conn.commit()
                    result = {'ok': True}

                elif resource == 'chat-history' and len(parts) > 1 and parts[1] == 'sessions':
                    # Existing installations may predate the archive table.
                    cur.execute('''
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
                    cur.execute("PRAGMA table_info(chat_history_archive)")
                    archive_columns = {row['name'] for row in cur.fetchall()}
                    if 'model_id' not in archive_columns:
                        cur.execute('ALTER TABLE chat_history_archive ADD COLUMN model_id TEXT')
                    cur.execute('''
                        SELECT session_id, session_name, role, content, model_id, created_at
                        FROM (
                            SELECT ch.session_id, COALESCE(s.name, ch.session_id) AS session_name,
                                   ch.role, ch.content, ch.model_id, ch.created_at
                            FROM chat_history ch
                            LEFT JOIN sessions s ON s.id = ch.session_id
                            WHERE ch.role = 'user'
                            UNION ALL
                            SELECT session_id, COALESCE(session_name, session_id) AS session_name,
                                   role, content, model_id, created_at
                            FROM chat_history_archive
                            WHERE role = 'user'
                        ) all_history
                        ORDER BY created_at DESC
                    ''')
                    result = {'ok': True, 'data': [dict(row) for row in cur.fetchall()]}

                elif resource == 'sessions':
                    sid = body.get('id', 's' + str(now))
                    cur.execute('''
                        INSERT OR REPLACE INTO sessions (id, name, created_at, updated_at)
                        VALUES (?, ?, ?, ?)
                    ''', (sid, body.get('name', ''), now, now))
                    conn.commit()
                    result = {'ok': True, 'id': sid}

                elif resource == 'projects' and len(parts) > 1:
                    # POST /projects/{id} 鈥?閲嶅懡鍚?
                    proj_id = parts[1]
                    new_name = body.get('name', '')
                    cur.execute('UPDATE projects SET name=?, updated_at=? WHERE id=?', (new_name, now, proj_id))
                    conn.commit()
                    result = {'ok': True}

                elif resource == 'projects':
                    proj_id = body.get('id', 'proj_' + str(now))
                    proj_name = body.get('name', '新项目')
                    cur.execute('''
                        INSERT OR REPLACE INTO projects (id, name, created_at, updated_at)
                        VALUES (?, ?, ?, ?)
                    ''', (proj_id, proj_name, now, now))
                    conn.commit()
                    result = {'ok': True, 'id': proj_id}

                elif resource == 'chat' and len(parts) > 1:
                    sid = parts[1]
                    parent_id = body.get('parentId', None)
                    cur.execute('''
                        INSERT INTO chat_history (session_id, role, content, model_id, created_at, parent_id)
                        VALUES (?, ?, ?, ?, ?, ?)
                    ''', (sid, body.get('role', 'user'), body.get('content', ''), body.get('modelId', ''), now, parent_id))
                    conn.commit()
                    result = {'ok': True, 'id': cur.lastrowid}

                elif resource == 'data' and len(parts) > 1:
                    category = parts[1]
                    key = body.get('key', '')
                    value = json.dumps(body.get('value'), ensure_ascii=False)
                    cur.execute('''
                        INSERT OR REPLACE INTO app_data (category, key, value, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                    ''', (category, key, value, now, now))
                    conn.commit()
                    result = {'ok': True}

                elif resource == 'app_data':
                    # POST /api/db/app_data - 鏀寔 action: delete (app-zf3d.js 閫€鍑虹櫥褰曟椂璋冪敤)
                    action = body.get('action', '')
                    filt = body.get('filter', {})
                    cat = filt.get('category', '')
                    if action == 'delete' and cat:
                        cur.execute('DELETE FROM app_data WHERE category=?', (cat,))
                        conn.commit()
                        result = {'ok': True, 'deleted': cur.rowcount}
                    elif action == 'delete' and len(parts) > 1:
                        cat = parts[1]
                        cur.execute('DELETE FROM app_data WHERE category=?', (cat,))
                        conn.commit()
                        result = {'ok': True, 'deleted': cur.rowcount}
                    else:
                        result = None  # 404

                elif resource == 'logs':
                    cur.execute('''
                        INSERT INTO app_logs (ts, level, box_id, action, detail)
                        VALUES (?, ?, ?, ?, ?)
                    ''', (now, body.get('level', 'info'), body.get('boxId', ''),
                          body.get('action', ''), body.get('detail', '')))
                    conn.commit()
                    result = {'ok': True, 'id': cur.lastrowid}

                elif resource == 'stats':
                    cur.execute('''
                        INSERT INTO task_stats (session_id, model_id, task_title, success, tokens_used, duration_ms, depth, api_calls, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        body.get('sessionId', ''),
                        body.get('modelId', ''),
                        body.get('taskTitle', ''),
                        1 if body.get('success') else 0,
                        body.get('tokensUsed', 0) or 0,
                        body.get('durationMs', 0) or 0,
                        body.get('depth', 0) or 0,
                        body.get('apiCalls', 0) or 0,
                        now
                    ))
                    conn.commit()
                    result = {'ok': True, 'id': cur.lastrowid}

                else:
                    result = None  # 404

                conn.close()
                conn = None
        except Exception as e:
            print(f'[POST /api/db] 500 閿欒: {e}')
            traceback.print_exc()
            if conn:
                try: conn.close()
                except: pass
            self._send_error(str(e), 500)
            return

        # 杩炴帴宸插叧闂紝瀹夊叏鍙戦€佸搷搴?
        if result is not None:
            self._send_json(result)
        else:
            self._send_error('Unknown POST route: ' + path, 404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # ===== 澶囦唤绠＄悊 =====
        if path.startswith('/api/backup/delete/'):
            backup_name = path[len('/api/backup/delete/'):]
            self._handle_backup_delete(backup_name)
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
                    except: pass
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

                elif resource == 'kv' and len(parts) > 1:
                    key = parts[1]
                    cur.execute('DELETE FROM kv_store WHERE key=?', (key,))
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

                elif resource == 'sessions' and len(parts) > 1:
                    sid = parts[1]
                    cur.execute('''CREATE TABLE IF NOT EXISTS chat_history_archive (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, session_name TEXT, role TEXT, content TEXT, model_id TEXT, created_at INTEGER)''')
                    cur.execute('''
                        INSERT INTO chat_history_archive (session_id, session_name, role, content, model_id, created_at)
                        SELECT ch.session_id, COALESCE(s.name, ch.session_id), ch.role, ch.content, ch.model_id, ch.created_at
                        FROM chat_history ch LEFT JOIN sessions s ON s.id = ch.session_id
                        WHERE ch.session_id=?
                    ''', (sid,))
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
                            SELECT ch.session_id, COALESCE(s.name, ch.session_id),
                                   ch.role, ch.content, ch.model_id, ch.created_at
                            FROM chat_history ch
                            LEFT JOIN sessions s ON s.id = ch.session_id
                            WHERE ch.session_id=?
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
                            SELECT ch.session_id, COALESCE(s.name, ch.session_id),
                                   ch.role, ch.content, ch.model_id, ch.created_at
                            FROM chat_history ch
                            LEFT JOIN sessions s ON s.id = ch.session_id
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
                except: pass
            self._send_error(str(e), 500)
            return

        # 杩炴帴宸插叧闂紝瀹夊叏鍙戦€佸搷搴?
        if result is not None:
            self._send_json(result)
        else:
            self._send_error('Unknown DELETE route: ' + path, 404)


    # ===== 鐑洿鏂?SSE 鍜?API 澶勭悊 =====

    def _handle_hot_reload_sse(self):
        """GET /api/hot-reload/sse - stream hot reload events."""
        from hot_reload import get_hot_reloader
        hr = get_hot_reloader()
        if not hr:
            self._send_error('hot reload engine not started', 503)
            return

        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()

        # 娉ㄥ唽涓?SSE 瀹㈡埛绔?
        hr.add_sse_client(self.wfile)

        # 蹇冭烦闂撮殧鍙厤锛堥粯璁?10s锛岄伩寮€甯歌鍙嶄唬鐨?30s 绌洪棽鍒囨柇 + 娴忚鍣ㄤ唬鐞?60s 鍒囨柇锛?
        try:
            from config import SSE_HEARTBEAT_SEC
            _hb = max(2.0, min(float(SSE_HEARTBEAT_SEC), 25.0))
        except Exception:
            _hb = 10.0

        import time as _time
        import socket as _sock
        import select as _sel
        _sock_errs = (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError, ValueError)
        try:
            while True:
                # 鐢ㄧ煭杞 + select 鍚屾椂鎵挎媴銆屽績璺冲彂閫併€?銆屾娴嬪鎴风鏂紑銆?
                # 涓嶅啀鐢?_time.sleep(15) 閭ｇ銆屽啓澶辫触鎵嶇煡閬撴柇浜嗐€嶇殑琚姩绛栫暐
                try:
                    _r, _, _ = _sel.select([self.connection], [], [], _hb)
                except _sock_errs:
                    break
                except Exception:
                    # select 澶辫触鏃堕€€鍖栦负 sleep 鍏滃簳
                    _time.sleep(_hb)
                    _r = []

                # 娌℃湁鍙浜嬩欢 = 鍒颁簡蹇冭烦鏃堕棿
                if not _r:
                    try:
                        self.wfile.write(b': heartbeat\n\n')
                        self.wfile.flush()
                    except _sock_errs:
                        break
                    except Exception as e:
                        print(f'[SSE] 蹇冭烦鍐欏叆寮傚父: {e}', flush=True)
                        traceback.print_exc()
                        # 鍗曟澶辫触涓嶉€€鍑猴紝淇濇寔杩炴帴锛堥伩鍏?reload 鏃跺伓鍙戞姈鍔ㄨ鎵€鏈夌獥鍙ｇ绾匡級
                        continue
        except _sock_errs:
            pass
        except Exception as e:
            print(f'[SSE] 涓诲惊鐜紓甯? {e}', flush=True)
            traceback.print_exc()
        finally:
            try:
                hr.remove_sse_client(self.wfile)
            except Exception:
                pass

    def _handle_hot_reload_status(self):
        """Return hot-reload engine status."""
        from hot_reload import get_hot_reloader
        hr = get_hot_reloader()
        if not hr:
            self._send_json({'ok': False, 'error': 'hot reload engine not started'})
            return
        self._send_json({'ok': True, 'status': hr.get_status()})

    def _handle_hot_reload_manual(self):
        """Manually reload a hot-reload module."""
        from hot_reload import get_hot_reloader
        hr = get_hot_reloader()
        if not hr:
            self._send_json({'ok': False, 'error': 'hot reload engine not started'})
            return
        try:
            body = self._read_body()
            module_name = body.get('module', None)
            result = hr.manual_reload(module_name)
            self._send_json(result)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)})

