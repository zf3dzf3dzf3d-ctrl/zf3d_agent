"""Mixin: GET 分发（自动拆分自 mixin_dispatch.py，方法体未改动）"""
from routes._shared import *
from routes.mixin_download import MixinDownload
from routes.mixin_share import ShareRoutesMixin
from routes.mixin_loginstate import MixinLoginState
from routes.mixin_file_bridge import FengkongFileBridge
from routes.mixin_workbench import MixinWorkbench

class MixinDispatchGet(ShareRoutesMixin, MixinLoginState, MixinDownload, FengkongFileBridge, MixinWorkbench):

    def do_GET(self):
        self._drain_body()
        if not self._check_origin():
            self.close_connection = True
            return
        parsed = urlparse(self.path)
        path = parsed.path
        # 【安全修复 2026-11-23】token 校验前移到 dispatch_get / 巨型 if-elif 链之前，
        # 与 do_POST 侧（api_dispatch_post.do_POST）及 dispatcher.py 文档契约对齐。
        # 原先校验放在分发之后，导致注册表 200+ 条 @route_get 路由（含
        # /api/models/reveal-key 明文显钥、/api/models/config、/api/app/quit、
        # /api/device/control 等）全部免 token。仅 /api/ 前缀受检：静态页面须免
        # token 加载（浏览器靠静态响应种下的 zf_auth Cookie 回填后续 API 调用）。
        from security import check_request_token
        if path.startswith('/api/'):
            if not check_request_token(self):
                self.close_connection = True
                return
        from routes.dispatcher import dispatch_get, ensure_loaded
        ensure_loaded()
        if dispatch_get(self, path, parsed):
            return
        # ---- Matrix 进化看板 v1：GET /api/matrix/board（6.2.0 对齐 charlie 6.1.0 钩子，bravo 2026-11-27）----
        # JSON 默认；?view=html 返回自包含看板页。只读聚合，永不影响主流程。
        # 经 routes/matrix_board_api.py 转发器走 matrix/board_api.py 真身（单一实现原则）。
        if path == '/api/matrix/board':
            try:
                from routes.matrix_board_api import json_payload as _bjp, render_html as _brh
                if 'view=html' in (parsed.query or ''):
                    _body = _brh().encode('utf-8')
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/html; charset=utf-8')
                    self.send_header('Content-Length', str(len(_body)))
                    self.end_headers()
                    self.wfile.write(_body)
                else:
                    self._send_json(_bjp())
            except Exception:
                try:
                    self._send_json({'ok': False, 'error': 'board hook failed'}, 500)
                except Exception:
                    pass
            return
        # ---- Matrix 进化看板 v1 结束 ----
        # 【20261123 B3 样板】/api/lab/* 三路径已迁 routes/domain_lab.py（route_get 注册，链首优先）

        # 【20261123 B3 续】/api/verify-pairs 已迁 routes/domain_verify.py

        # 注册表版在 routes/domain_growth_fengkong.py（list=GET 读，control/scene=POST 写）。
        if path == '/api/settings':
            cfg = {}
            try:
                import json as _json, os as _os
                _p = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', 'private', 'settings.json')
                with open(_p, 'r', encoding='utf-8') as f:
                    cfg = _json.load(f) or {}
            except Exception:
                cfg = {}
            self._send_json({'ok': True, 'settings': cfg})
            return
        if path == '/api/roles':
            self._handle_roles_get()
            return
            try:
                from urllib.parse import parse_qs as _pqs
                _q = _pqs(parsed.query or '')
                _st = _mon.get_stats(days=(_q.get('days') or ['7'])[0])
                self._send_json({'ok': True, 'stats': _st})
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            return
        if path.startswith('/api/chat-pool/slot/') and path.endswith('/events'):
            self._handle_chat_pool_events()
            return
        if path == '/api/jobs' or path.startswith('/api/jobs/'):
            self._handle_jobs_get(path)
            return
        if path.startswith('/api/external/'):
            import external_router
            external_router.handle_external_admin(self, path[len('/api/external/'):])
            return
        if path == '/api/app-root':
            self._send_json({'ok': True, 'base_root': BASE_DIR.replace('/', '\\')}, 200)
            return
        if path == '/api/scenes' or path.startswith('/api/scenes/'):
            self._handle_scenes_get(path)
            return
        if path.startswith('/api/db/'):
            self._handle_db_get(path)
            return
        if path == '/api/prompt-gen' and self.command == 'POST':
            self._handle_prompt_gen()
            return
        if path.startswith('/api/ui-sync/sse'):
            self._handle_ui_sync_sse()
            return
        if path == '/api/chat/last-model' and self.command == 'GET':
            self._handle_get_last_model()
            return
        if path == '/api/chat/last-model' and self.command == 'POST':
            self._handle_report_last_model()
            return
        if path.startswith('/api/share'):
            self.route_share()
            return
        if path.startswith('/api/qq/') or path.startswith('/api/qqbot/'):
            self._send_json({'ok': False, 'removed': True, 'msg': 'QQ 群采集功能已卸载（NapCat 与本机 QQ 版本不兼容，停止维护）'})
            return
        if path.startswith('/api/zf3d/'):
            try:
                self._read_body()
            except Exception:
                pass
            self._send_json({'ok': False, 'error': 'zf3d module removed'}, 200)
            return
        if path.startswith('/api/vault/'):
            self._handle_vault_get(path, parsed)
            return
        if path.startswith('/api/loginstate/'):
            self._handle_loginstate_get(path, parsed)
            return
        if path.startswith('/api/project/open-folder'):
            self._handle_open_project_folder(parsed)
            return
        if path.startswith('/api/project/browse-folder'):
            self._handle_browse_folder(parsed)
            return
        if path.startswith('/api/project/filetree'):
            self._handle_project_filetree(parsed)
            return
        if path.startswith('/api/fs/browse'):
            self._handle_fs_browse(parsed)
            return
        if path.startswith('/api/starmap/scan'):
            self._handle_starmap_scan(parsed)
            return
        if path.startswith('/api/save'):
            self._handle_game_save_get(parsed)
            return
        if path.startswith('/api/git/graph'):
            self._handle_git_graph(parsed)
            return
        if path.startswith('/api/git/commit'):
            self._handle_git_commit(parsed)
            return
        if path == '/api/git/branches':
            import sys as _sys, os as _os
            _srv = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
            if _srv not in _sys.path:
                _sys.path.insert(0, _srv)
            import git_branch_api as _gb
            self._send_json(_gb.handle_branches_get(parsed.query))
            return
        if path.startswith('/api/remote/id'):
            self._handle_remote_id(parsed)
            return
        if path.startswith('/api/fs/file'):
            self._handle_fs_file(parsed)
            return
        if path.startswith('/api/fs/thumb'):
            self._handle_fs_thumb(parsed)
            return
        if path.startswith('/api/fs/text'):
            self._handle_fs_text(parsed)
            return
        if path in ('/api/fs/docx', '/api/fs/xlsx', '/api/fs/office_pdf'):
            import sys as _sys2, os as _os2
            _tool = _os2.path.join(_os2.path.dirname(_os2.path.dirname(_os2.path.dirname(_os2.path.abspath(__file__)))), 'tools', 'office-viewer')
            if _tool not in _sys2.path:
                _sys2.path.insert(0, _tool)
            import office_docs as _od
            _fn = {'/api/fs/docx': _od.handle_fs_docx, '/api/fs/xlsx': _od.handle_fs_xlsx, '/api/fs/office_pdf': _od.export_to_pdf}[path]
            _fn(self, parsed)
            return
        if path.startswith('/api/refboard-media/'):
            self._handle_refboard_media_get(path[len('/api/refboard-media/'):])
            return
        if path == '/api/background/assets':
            import os, json as _json
            pub = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'public')
            imgs, vids = ([], [])
            img_dir = os.path.join(pub, 'i桌面', 'i桌面图片')
            vid_dir = os.path.join(pub, 'i桌面', 'i桌面视频')
            if os.path.isdir(img_dir):
                imgs = sorted(('i桌面/i桌面图片/' + f for f in os.listdir(img_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))))
            if os.path.isdir(vid_dir):
                vids = sorted(('i桌面/i桌面视频/' + f for f in os.listdir(vid_dir) if f.lower().endswith(('.mp4', '.webm'))))
            body = _json.dumps({'ok': True, 'images': imgs, 'videos': vids}, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith('/api/ext/'):
            self._handle_ext(method='GET', path=path)
            return
        if path.startswith('/api/privacy/status'):
            import mixin_privacy as _mp
            self._send_json(_mp.handle_privacy_get('/api/privacy/status', parse_qs(parsed.query)))
            return
        if path.startswith('/api/hw/driver-check'):
            self._handle_hw_driver_check()
            return
        if path == '/api/dock/state':
            import sys as _sys3, os as _os3
            _srv3 = _os3.path.dirname(_os3.path.dirname(_os3.path.abspath(__file__)))
            if _srv3 not in _sys3.path:
                _sys3.path.insert(0, _srv3)
            from engines.common.dock_state import dock_state_get
            self._send_json(dock_state_get())
            return
        self._serve_static(path)

    def _brief_store(self):
        import os as _os
        try:
            here = _os.path.dirname(_os.path.abspath(__file__))
            data_dir = _os.path.normpath(_os.path.join(here, '..', 'data'))
            if not _os.path.isdir(data_dir):
                _os.makedirs(data_dir, exist_ok=True)
            return _os.path.join(data_dir, 'user_brief_state.json')
        except Exception:
            return _os.path.join(_os.path.expanduser('~'), '.zf_user_brief_state.json')

    def _handle_user_brief(self):
        import os as _os
        import json as _json
        import re as _re
        import subprocess as _sp
        from datetime import datetime as _dt
        now_ms = int(_dt.now().timestamp() * 1000)
        state = {'lastVisit': 0, 'visitCount': 0}
        fpath = self._brief_store()
        try:
            if _os.path.isfile(fpath):
                with open(fpath, 'r', encoding='utf-8') as f:
                    state = _json.load(f)
        except Exception:
            state = {'lastVisit': 0, 'visitCount': 0}
        last = int(state.get('lastVisit') or 0)
        cnt = int(state.get('visitCount') or 0) + 1
        days_away = max(0, int((now_ms - last) / 86400000)) if last else -1
        try:
            with open(fpath, 'w', encoding='utf-8') as f:
                _json.dump({'lastVisit': now_ms, 'visitCount': cnt}, f)
        except Exception:
            pass
        out = {'ok': True, 'lastVisit': last, 'daysAway': days_away, 'visitCount': cnt}
        plans = []
        try:
            here = _os.path.dirname(_os.path.abspath(__file__))
            for d in (os.path.join('..', '..', 'system', 'longplan'), os.path.join('..', '..', 'private', '记忆', 'longplan'), os.path.join('..', 'data', 'longplan')):
                full = _os.path.normpath(_os.path.join(here, d))
                if not _os.path.isdir(full):
                    continue
                for fn in _os.listdir(full):
                    if not fn.endswith('.md'):
                        continue
                    try:
                        with open(_os.path.join(full, fn), 'r', encoding='utf-8', errors='ignore') as f:
                            txt = f.read()
                        pend = len(_re.findall('- \\[ \\]', txt))
                        done = len(_re.findall('- \\[x\\]', txt, _re.IGNORECASE))
                        if pend > 0:
                            title = fn[:-3]
                            m = _re.search('#\\s*(.+)', txt)
                            if m:
                                title = m.group(1).strip()[:40] or title
                            plans.append({'id': fn[:-3], 'title': title, 'pending': pend, 'done': done})
                    except Exception:
                        continue
            plans.sort(key=lambda p: -p['pending'])
            plans = plans[:3]
        except Exception:
            plans = []
        out['unfinishedPlans'] = plans
        recs = []
        try:
            mem_dir = _os.path.normpath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..', 'private', '记忆'))
            if _os.path.isdir(mem_dir):
                files = [(_os.path.getmtime(_os.path.join(mem_dir, fn)), fn[:-3]) for fn in _os.listdir(mem_dir) if fn.endswith('.md')]
                files.sort(reverse=True)
                recs = [n for _, n in files[:5]]
        except Exception:
            recs = []
        out['recentRecords'] = recs
        gitinfo = {}
        try:
            base = _os.path.normpath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..'))
            r1 = _sp.run(['git', '-C', base, 'rev-parse', '--abbrev-ref', 'HEAD'], capture_output=True, text=True, timeout=3)
            if r1.returncode == 0:
                gitinfo['branch'] = r1.stdout.strip()
                r2 = _sp.run(['git', '-C', base, 'status', '--porcelain'], capture_output=True, text=True, timeout=3)
                gitinfo['dirty'] = len([l for l in r2.stdout.splitlines() if l.strip()])
        except Exception:
            gitinfo = {}
        out['git'] = gitinfo
        try:
            self._send_json(out)
        except Exception:
            pass

    def _remote_check_key(self, qs):
        """校验访问 key（与 zf3d_commands 使用的 api_key 一致）"""
        try:
            from zf3d_commands import _get_api_key
            expect = _get_api_key() or ''
        except Exception:
            expect = ''
        key = (qs.get('key') or [''])[0]
        if not expect or key != expect:
            self._send_json({'ok': False, 'err': 'bad key'}, 403)
            return False
        return True
    _GEO_IP_CACHE = {'ip': None, 'data': None, 't': 0}

    def _handle_geo_reverse(self, qs):
        """GET /api/geo/reverse?lat=&lon= — 坐标反查省+市（用于浏览器精确定位）。"""
        import urllib.request as _urq
        import urllib.parse as _upp
        try:
            lat = float((qs.get('lat') or [''])[0])
            lon = float((qs.get('lon') or [''])[0])
        except Exception:
            self._send_json({'ok': False, 'err': 'bad lat/lon'})
            return
        try:
            url = 'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + _upp.quote(str(lat)) + '&longitude=' + _upp.quote(str(lon)) + '&localityLanguage=zh'
            req = _urq.Request(url, headers={'User-Agent': 'zf3d-agent/5.1'})
            with _urq.urlopen(req, timeout=6) as resp:
                data = __import__('json').loads(resp.read().decode('utf-8', 'ignore'))
            region = data.get('principalSubdivision') or ''
            city = data.get('city') or data.get('locality') or ''
            if city or region:
                self._send_json({'ok': True, 'region': region, 'city': city})
            else:
                self._send_json({'ok': False, 'err': 'no result'})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 502)

    def _handle_geo_ip(self):
        """GET /api/geo/ip — 按客户端 IP 无感定位城市，带 6 小时缓存。"""
        import json as _json
        import time as _time
        import urllib.request as _urq
        ip = (self.headers.get('X-Forwarded-For') or '').split(',')[0].strip()
        if not ip:
            ip = (self.headers.get('X-Real-IP') or '').strip()
        if not ip:
            ip = self.client_address[0] if self.client_address else ''
        if not ip or ip.startswith(('127.', '10.', '192.168.', '172.16.', '172.17.', '172.18.', '172.19.', '172.2', '172.30.', '172.31.', '169.254.', '::1')) or ip == 'localhost':
            try:
                req0 = _urq.Request('https://api.ipify.org', headers={'User-Agent': 'zf3d-agent/5.1'})
                with _urq.urlopen(req0, timeout=4) as r0:
                    pub = r0.read().decode('utf-8', 'ignore').strip()
                if not pub or len(pub) > 45 or (':' in pub and pub.count(':') > 1):
                    raise ValueError('no public ip')
                ip = pub
            except Exception:
                self._send_json({'ok': False, 'err': 'private ip'})
                return
        cache = self._GEO_IP_CACHE
        if cache['ip'] == ip and cache['data'] and (_time.time() - cache['t'] < 6 * 3600):
            self._send_json(cache['data'])
            return
        try:
            url = 'https://ipwho.is/' + ip + '?fields=success,country,region,city,latitude,longitude'
            req = _urq.Request(url, headers={'User-Agent': 'zf3d-agent/5.1'})
            with _urq.urlopen(req, timeout=4) as resp:
                data = _json.loads(resp.read().decode('utf-8', 'ignore'))
            if not data.get('success'):
                raise ValueError(data.get('message') or 'geo failed')
            out = {'ok': True, 'city': data.get('city') or '', 'region': data.get('region') or '', 'lat': data.get('latitude'), 'lon': data.get('longitude')}
            cache.update({'ip': ip, 'data': out, 't': _time.time()})
            self._send_json(out)
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 502)

    def _handle_remote_sessions(self, qs):
        if not self._remote_check_key(qs):
            return
        try:
            import sqlite3
            from db import get_db
            c = get_db()
            c.row_factory = sqlite3.Row
            rows = c.execute("SELECT session_id, COUNT(*) AS n, MAX(created_at) AS last_time, MAX(CASE WHEN role='user' THEN substr(content,1,50) END) AS preview FROM chat_history WHERE role IN ('user','assistant') GROUP BY session_id ORDER BY last_time DESC LIMIT 50").fetchall()
            c.row_factory = None
            self._send_json({'ok': True, 'sessions': [dict(r) for r in rows]})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_remote_history(self, qs):
        if not self._remote_check_key(qs):
            return
        sid = (qs.get('session_id') or [''])[0]
        if not sid:
            self._send_json({'ok': False, 'err': 'missing session_id'}, 400)
            return
        try:
            import sqlite3
            from db import get_db
            c = get_db()
            c.row_factory = sqlite3.Row
            rows = c.execute("SELECT role, content, created_at FROM chat_history WHERE session_id = ? AND role IN ('user','assistant','progress') ORDER BY created_at ASC LIMIT 500", (sid,)).fetchall()
            c.row_factory = None
            self._send_json({'ok': True, 'session_id': sid, 'messages': [dict(r) for r in rows]})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_remote_chat_status(self, qs):
        """GET /api/zf3d/remote/chat_status — 手机峰控检测电脑本地会话是否更新（只回版本号，轻量）。"""
        if not self._remote_check_key(qs):
            return
        sid = (qs.get('session_id') or [''])[0]
        if not sid:
            self._send_json({'ok': False, 'err': 'missing session_id'}, 400)
            return
        try:
            from db import get_db
            c = get_db()
            row = c.execute("SELECT COUNT(*) AS n, COALESCE(MAX(id),0) AS max_id FROM chat_history WHERE session_id = ? AND role IN ('user','assistant')", (sid,)).fetchone()
            c.row_factory = None
            self._send_json({'ok': True, 'session_id': sid, 'count': row[0], 'max_id': row[1]}, extra_headers={'Cache-Control': 'no-store'})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_remote_chat_pull(self, qs):
        """GET /api/zf3d/remote/chat_pull — 手机峰控增量拉取电脑本地会话新消息（since_id 之后）。"""
        if not self._remote_check_key(qs):
            return
        sid = (qs.get('session_id') or [''])[0]
        since = int((qs.get('since_id') or ['0'])[0] or 0)
        if not sid:
            self._send_json({'ok': False, 'err': 'missing session_id'}, 400)
            return
        try:
            import sqlite3
            from db import get_db
            c = get_db()
            c.row_factory = sqlite3.Row
            rows = c.execute("SELECT id, role, content, created_at FROM chat_history WHERE session_id = ? AND role IN ('user','assistant','progress') AND id > ? ORDER BY id ASC LIMIT 200", (sid, since)).fetchall()
            row = c.execute("SELECT COUNT(*) AS n, COALESCE(MAX(id),0) AS max_id FROM chat_history WHERE session_id = ? AND role IN ('user','assistant')", (sid,)).fetchone()
            c.row_factory = None
            self._send_json({'ok': True, 'session_id': sid, 'since_id': since, 'messages': [dict(r) for r in rows], 'count': row[0], 'max_id': row[1]}, extra_headers={'Cache-Control': 'no-store'})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 500)
    _VIDEO_MIME = {'.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.m4v': 'video/mp4', '.ts': 'video/mp2t', '.flv': 'video/x-flv', '.wmv': 'video/x-ms-wmv', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.srt': 'text/plain; charset=utf-8'}

    def _handle_video_stream(self, parsed):
        """GET /api/video/stream?p=<本地路径> — 带 Range 的单文件预览流。"""
        import os as _os
        import re as _re
        from urllib.parse import parse_qs, unquote
        try:
            qs = parse_qs(parsed.query)
            p = unquote((qs.get('p') or [''])[0]).strip()
            if not p:
                raise ValueError('missing p')
            p = _os.path.abspath(p)
            from tools.coding.backend import _pathguard as _pg
            _ok, _reason = _pg.check(p)
            if not _ok:
                self._send_json({'ok': False, 'err': _reason}, 400)
                return
            if not _os.path.isfile(p):
                raise ValueError('file not found')
            ext = _os.path.splitext(p)[1].lower()
            ctype = self._VIDEO_MIME.get(ext, 'application/octet-stream')
            size = _os.path.getsize(p)
            start, end, status = (0, size - 1, 200)
            m = _re.match('bytes=(\\d*)-(\\d*)$', (self.headers.get('Range') or '').strip())
            if m and (m.group(1) or m.group(2)):
                if m.group(1):
                    start = int(m.group(1))
                    if m.group(2):
                        end = min(int(m.group(2)), size - 1)
                else:
                    start = max(0, size - int(m.group(2)))
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{size}')
                    self.end_headers()
                    return
                status = 206
            length = max(0, end - start + 1)
            self.send_response(status)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(length))
            self.send_header('Accept-Ranges', 'bytes')
            if status == 206:
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.end_headers()
            with open(p, 'rb') as f:
                f.seek(start)
                remain = length
                while remain > 0:
                    chunk = f.read(min(1 << 20, remain))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remain -= len(chunk)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass
        except Exception as e:
            try:
                self._send_json({'ok': False, 'err': str(e)}, 400)
            except Exception:
                pass