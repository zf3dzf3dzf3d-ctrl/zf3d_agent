"""Mixin: POST 分发（自动拆分自 mixin_dispatch.py，方法体未改动）"""
from routes._shared import *
from urllib.parse import urlparse
from routes.mixin_base import MixinBase
from routes.mixin_download import MixinDownload
from routes.mixin_share import ShareRoutesMixin
from routes.api_dispatch_post_extra import MixinDispatchPostExtra
from routes.mixin_loginstate import MixinLoginState

from util_log import get_logger

log = get_logger('api_dispatch_post')
def _make_tool_cap(outer=None, body=None):
    """共享的 ToolContext 捕获壳：send_json 结果收进 self._out（合并原 6 处重复 send_json 定义）"""
    from tools.coding.backend.base import ToolContext

    class _ToolCap(ToolContext):

        def __init__(self, handler, body=None):
            try:
                super().__init__(handler, body)
            except Exception:
                pass
            self._out = {}

        def send_json(self, obj, *a, **kw):
            self._out = obj or {}
    return _ToolCap(outer, body)

class MixinDispatchPost(ShareRoutesMixin, MixinDispatchPostExtra, MixinLoginState, MixinDownload, MixinBase):

    def _handle_fk_send(self, body):
        from routes.mixin_file_bridge import FengkongFileBridge
        return FengkongFileBridge._handle_fk_send(self, body)

    def _handle_fk_upload(self, body):
        from routes.mixin_file_bridge import FengkongFileBridge
        return FengkongFileBridge._handle_fk_upload(self, body)

    def _handle_memory_import(self):
        import memory_import
        try:
            body = self._read_body()
        except Exception:
            body = {}
        path = self.path.split('?')[0]
        if path == '/api/memory/import/candidates':
            self._send_json(memory_import.list_candidates())
            return
        if path == '/api/memory/import/scan':
            src = str(body.get('src') or '')
            self._send_json(memory_import.scan_import(src))
            return
        if path == '/api/memory/import/run':
            src = str(body.get('src') or '')
            self._send_json(memory_import.run_import(src))
            return
        if path == '/api/memory/import/auto':
            self._send_json(memory_import.auto_collect())
            return

    def _handle_profile_import(self):
        import browser_profile_import
        try:
            body = self._read_body()
        except Exception:
            body = {}
        path = self.path.split('?')[0]
        if path == '/api/browser/profile/import/candidates':
            self._send_json(browser_profile_import.list_candidates())
            return
        if path == '/api/browser/profile/import/scan':
            src = str(body.get('src') or '')
            pp = str(body.get('profile_path') or '') or None
            self._send_json(browser_profile_import.scan_import(src, profile_path=pp))
            return
        if path == '/api/browser/profile/import/run':
            src = str(body.get('src') or '')
            pp = str(body.get('profile_path') or '') or None
            self._send_json(browser_profile_import.run_import(src, profile_path=pp))
            return
        if path == '/api/browser/profile/import/auto':
            self._send_json(browser_profile_import.auto_collect())
            return
        if path == '/api/browser/profile/import/reserve-backup':
            self._send_json(browser_profile_import.reserve_backup())
            return
        if path == '/api/browser/profile/import/reserve-restore':
            self._send_json(browser_profile_import.reserve_restore(str(body.get('ts') or '') or None))
            return
        if path == '/api/browser/profile/import/health':
            self._send_json(browser_profile_import.check_login_data_health())
            return

    def _handle_agent_import(self):
        import external_agent_import
        try:
            body = self._read_body()
        except Exception:
            body = {}
        path = self.path.split('?')[0]
        if path == '/api/agent/import/candidates':
            self._send_json(external_agent_import.list_candidates())
            return
        if path == '/api/agent/import/scan':
            agent = str(body.get('agent') or '')
            self._send_json(external_agent_import.scan_import(agent))
            return
        if path == '/api/agent/import/run':
            agent = str(body.get('agent') or '')
            self._send_json(external_agent_import.run_import(agent))
            return
        if path == '/api/agent/import/status':
            agent = str(body.get('agent') or '') or None
            self._send_json(external_agent_import.status(agent))
            return

    def _route_download_post(self):
        path = self.path.split('?')[0]
        if path == '/api/download/start':
            self._handle_download_start()
            return True
        if path == '/api/download/cancel':
            self._handle_download_cancel()
            return True
        return False

    def _handle_swarm_post(self):
        import dispatch_swarm as swarm
        path = self.path.split('?')[0]
        try:
            body = self._read_body()
        except Exception:
            body = {}
        try:
            if path == '/api/swarm/submit':
                tasks = body.get('tasks')
                if not isinstance(tasks, list) or not tasks:
                    self._send_json({'ok': False, 'err': 'tasks 不能为空'})
                    return
                batch_id = swarm.submit(tasks, model_name=(body.get('model_name') or body.get('model')) or None, shared_context=str(body.get('context') or ''))
                self._send_json({'ok': True, 'batch_id': batch_id})
                return
            if path == '/api/swarm/status':
                batch_id = str(body.get('batch_id') or '')
                st = swarm.status(batch_id)
                if st is None:
                    self._send_json({'ok': False, 'err': '批次不存在: ' + batch_id}, 404)
                    return
                self._send_json({'ok': True, 'batch': st})
                return
            if path == '/api/swarm/collect':
                batch_id = str(body.get('batch_id') or '')
                wait = bool(body.get('wait', True))
                if wait:
                    try:
                        timeout = float(body.get('timeout', 600))
                    except (TypeError, ValueError):
                        timeout = 600.0
                    st = swarm.collect(batch_id, wait_sec=timeout)
                else:
                    st = swarm.status(batch_id)
                if st is None:
                    self._send_json({'ok': False, 'err': '批次不存在: ' + batch_id}, 404)
                    return
                self._send_json({'ok': True, 'batch': st})
                return
            if path == '/api/swarm/list':
                self._send_json({'ok': True, 'batches': swarm.list_batches()})
                return
            self._send_json({'ok': False, 'err': '未知蜂群接口: ' + path}, 404)
        except Exception as e:
            try:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            except Exception:
                pass

    def _handle_game_save_post(self):
        try:
            body = self._read_body()
            key = str(body.get('key', '') or '').strip()
            data = body.get('data')
            if not key or data is None:
                self._send_json({'ok': False, 'err': '需要 key 和 data'})
                return
            import json as _json, sqlite3
            db_dir = os.path.join(BASE_DIR, 'data')
            os.makedirs(db_dir, exist_ok=True)
            conn = sqlite3.connect(os.path.join(db_dir, 'game_saves.db'), timeout=30)
            conn.execute('PRAGMA busy_timeout=30000')
            # 【修复 2026-11-23】开 WAL 防多进程写 database locked（journal_mode 持久化，已是 wal 则跳过）
            try:
                if (conn.execute('PRAGMA journal_mode').fetchone() or ('',))[0] != 'wal':
                    conn.execute('PRAGMA journal_mode=WAL')
            except Exception:
                pass
            try:
                conn.execute('CREATE TABLE IF NOT EXISTS saves (key TEXT PRIMARY KEY, data TEXT, updated REAL)')
                conn.execute('INSERT OR REPLACE INTO saves (key, data, updated) VALUES (?,?,?)', (key, _json.dumps(data, ensure_ascii=False), time.time()))
                conn.commit()
            finally:
                conn.close()
            self._send_json({'ok': True})
        except Exception as e:
            try:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            except Exception:
                pass

    def _handle_engine2d_console_report(self):
        """接收 engine2d 页面 devconsole 上报的报错，落盘到 private/engine2d-console.log"""
        try:
            body = self._read_body()
        except Exception:
            body = {}
        logs = body.get('logs') or []
        if not isinstance(logs, list):
            logs = []
        try:
            from datetime import datetime
            log_dir = os.path.join(BASE_DIR, 'private')
            os.makedirs(log_dir, exist_ok=True)
            log_path = os.path.join(log_dir, 'engine2d-console.log')
            with open(log_path, 'a', encoding='utf-8') as f:
                for item in logs[-100:]:
                    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                    text = str(item.get('text', item.get('msg', ''))).replace('\n', ' | ')
                    f.write(ts + ' [' + str(item.get('type', item.get('level', 'log'))) + '] ' + str(item.get('page', '')) + ' :: ' + text + '\n')
            self._send_json({'ok': True, 'saved': len(logs)})
        except Exception as e:
            try:
                self._send_json({'ok': False, 'error': str(e)}, 500)
            except Exception:
                pass

    def _handle_perf_log_post(self):
        """接收前端性能埋点数据，写入 logs/perf_log.csv"""
        import os, time as _t
        try:
            raw = getattr(self, '_cached_raw_body', None)
            if raw is None:
                length = int(self.headers.get('Content-Length', 0) or 0)
                raw = self.rfile.read(length) if length > 0 else b''
            if isinstance(raw, bytes):
                raw = raw.decode('utf-8', 'ignore')
            body = raw or ''
            rows = body.split('\n')
            log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'logs')
            os.makedirs(log_dir, exist_ok=True)
            log_path = os.path.join(log_dir, 'perf_log.csv')
            try:
                today = _t.strftime('%Y-%m-%d')
                marker_path = log_path + '.day'
                last_day = ''
                if os.path.exists(marker_path):
                    with open(marker_path, 'r', encoding='utf-8') as mf:
                        last_day = mf.read().strip()
                if last_day != today:
                    if os.path.exists(log_path):
                        keep = []
                        cutoff = _t.time() - 86400
                        with open(log_path, 'r', encoding='utf-8') as rf:
                            for line in rf:
                                try:
                                    ts = _t.mktime(_t.strptime(line[:19], '%Y-%m-%d %H:%M:%S'))
                                except Exception:
                                    ts = _t.time()
                                if ts >= cutoff:
                                    keep.append(line)
                        with open(log_path, 'w', encoding='utf-8') as wf:
                            wf.writelines(keep)
                    with open(marker_path, 'w', encoding='utf-8') as mf:
                        mf.write(today)
            except Exception:
                pass
            with open(log_path, 'a', encoding='utf-8') as f:
                for r in rows:
                    r = r.strip()
                    if r:
                        f.write(_t.strftime('%Y-%m-%d %H:%M:%S,') + r + '\n')
            self._send_json({'ok': True, 'written': len(rows)})
        except Exception as e:
            try:
                self._send_json({'ok': False, 'error': str(e)}, 500)
            except Exception:
                pass

    def do_POST(self):
        self._drain_body()
        if not self._check_origin():
            self.close_connection = True
            return
        from security import check_request_token
        if not check_request_token(self):
            self.close_connection = True
            return
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            import zf_mm_perf
            zf_mm_perf.wrap(self, path)
        except Exception:
            pass
        from routes.dispatcher import dispatch_post, ensure_loaded
        ensure_loaded()
        if dispatch_post(self, path, parsed):
            return
        if path == '/api/fe-error':
            try:
                body = self._read_body() or {}
                import json as _json, time as _time
                _line = _time.strftime('%Y-%m-%d %H:%M:%S') + ' ' + _json.dumps(body, ensure_ascii=False) + '\n'
                with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server', 'logs', 'fe_errors.log'), 'a', encoding='utf-8') as _f:
                    _f.write(_line)
                self._send_json({'ok': True})
            except Exception:
                try:
                    self._send_json({'ok': False})
                except Exception:
                    pass
            return
        if path.startswith('/api/applock/'):
            self._handle_applock_post(path)
            return
        if path.startswith('/api/privacy/'):
            import mixin_privacy as _mp
            res = _mp.handle_privacy_post(path)
            if isinstance(res, tuple):
                self._send_json(res[0], res[1])
            else:
                self._send_json(res)
            return
        if path == '/api/verify-pairs':
            try:
                body = self._read_body() or {}
                raw = body.get('pairs')
                if raw is None:
                    self._send_json({'ok': False, 'error': 'pairs required'})
                    return
                _fp = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'private', 'db', 'verify_pairs.json'))
                os.makedirs(os.path.dirname(_fp), exist_ok=True)
                with open(_fp, 'w', encoding='utf-8') as f:
                    f.write(str(raw))
                self._send_json({'ok': True})
            except Exception as e:
                self._send_json({'ok': False, 'error': str(e)}, 500)
            return
        if path == '/api/tool-stats/report':
            try:
                body = self._read_body() or {}
                name = str(body.get('name') or '')[:64]
                if not name:
                    self._send_json({'ok': False, 'error': 'name required'})
                    return
                import threading as _thr
                _fp = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'private', 'db', 'tool_stats.json'))
                entry = {'ok': bool(body.get('ok')), 'ms': int(body.get('ms') or 0), 'ts': str(body.get('ts') or '')}

                def _write():
                    try:
                        import json as _json
                        with _db_lock:
                            data = {}
                            if os.path.exists(_fp):
                                try:
                                    data = _json.loads(open(_fp, encoding='utf-8').read())
                                except Exception:
                                    data = {}
                            st = data.setdefault(name, {'count': 0, 'ok': 0, 'total_ms': 0, 'last_ts': ''})
                            st['count'] += 1
                            st['ok'] += 1 if entry['ok'] else 0
                            st['total_ms'] += entry['ms']
                            st['last_ts'] = entry['ts']
                            tmp = _fp + '.tmp'
                            with open(tmp, 'w', encoding='utf-8') as f:
                                _json.dump(data, f, ensure_ascii=False)
                            os.replace(tmp, _fp)
                    except Exception:
                        pass
                _thr.Thread(target=_write, daemon=True).start()
                self._send_json({'ok': True})
            except Exception as e:
                self._send_json({'ok': False, 'error': str(e)}, 500)
            return
        if path == '/api/tool_prefetch':
            try:
                body = self._read_body() or {}
            except Exception:
                body = {}
            _PF_WHITELIST = {'read_file': 'read', 'read_lines': 'read_lines', 'tree_dir': 'tree_dir', 'search_in_files': 'search_in_files', 'find_files': 'find_files', 'file_info': 'file_info'}
            _tool = str(body.get('tool') or '')
            _args = body.get('args') if isinstance(body.get('args'), dict) else {}
            if _tool not in _PF_WHITELIST:
                self._send_json({'ok': False, 'error': 'tool not prefetchable'})
                return
            try:
                _mt = None
                _p = _args.get('path') or (isinstance(_args.get('paths'), list) and _args.get('paths') or [None])[0]
                if _p:
                    import os as _os
                    try:
                        _mt = _os.path.getmtime(str(_p))
                    except OSError:
                        _mt = None
                from tools import get_handler
                from tools.coding.backend.base import ToolContext
                try:
                    import kernel as _k
                    _pt = _k.boot_plugins().tools.get(_tool)
                    if _pt:
                        _pr = _pt['exec'](_args)
                        if _pr and _pr.get('ok') is not False:
                            self._send_json({'ok': True, 'data': _pr, 'mtime': _mt, 'src': 'plugin'})
                            return
                except Exception as _pe:
                    pass
                _hm = get_handler(_PF_WHITELIST[_tool])
                if not _hm:
                    self._send_json({'ok': False, 'error': 'no handler'})
                    return
                _captured = {}

                def _fake_send(obj, code=200):
                    _captured['data'] = obj
                _old_send = self._send_json
                self._send_json = _fake_send
                try:
                    _hm.handle(_args, ToolContext(self, _args))
                finally:
                    self._send_json = _old_send
                _data = _captured.get('data')
                if _data is None:
                    self._send_json({'ok': False, 'error': 'no data'})
                    return
                self._send_json({'ok': True, 'data': _data, 'mtime': _mt})
            except Exception as _e:
                self._send_json({'ok': False, 'error': str(_e)[:200]})
            return
        if path == '/api/agent/browser-closing':
            try:
                _log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'private')
                os.makedirs(_log_dir, exist_ok=True)
                with open(os.path.join(_log_dir, 'browser_close.log'), 'a', encoding='utf-8') as _f:
                    import time as _t
                    _f.write(_t.strftime('%m-%d %H:%M:%S') + ' browser closing (beacon)\n')
            except OSError:
                pass
            self._send_json({'ok': True})
            return
        if path.startswith('/api/vault/'):
            self._handle_vault_post(self._read_body())
            return
        if path.startswith('/api/loginstate/'):
            self._handle_loginstate_post(self._read_body())
            return
        if path == '/api/butler/team':
            try:
                import butler_store as _bs
                body = self._read_body() or {}
                _b = body or {}
                _op = str(_b.get('op') or 'add')
                _global = str(_b.get('scope') or '') == 'global'
                if _op == 'templates':
                    self._send_json({'ok': True, 'templates': _bs.list_templates()})
                    return
                if _op == 'auto_join':
                    try:
                        import datetime as _dt_mod
                        import json as _json
                        import re as _re
                        from db import db_read
                        from brain.main_brain import _call_llm
                        _cid = str(_b.get('chat_id') or '').strip()
                        if not _cid:
                            self._send_json({'ok': False, 'err': '缺少 chat_id'})
                            return
                        rows = db_read('\n                            SELECT role, content, created_at FROM (\n                                SELECT role, content, created_at FROM chat_history WHERE session_id = ?\n                                UNION ALL\n                                SELECT role, content, created_at FROM chat_history_archive WHERE session_id = ?\n                            ) ORDER BY created_at DESC LIMIT 24\n                        ', (_cid, _cid))
                        msgs = [{'role': r['role'], 'preview': (r['content'] or '')[:400]} for r in reversed(rows)]
                        if not msgs:
                            self._send_json({'ok': False, 'err': '当前对话还没有内容，无法总结'})
                            return
                        hist_txt = '\n'.join(['[%s] %s' % (m['role'], m['preview']) for m in msgs])[:12000]
                        sys_p = '你是团队档案员。请根据下面的对话内容，判断这次对话适合以什么关系加入工作台团队，并总结为一名成员。关系（relation）四选一：「团队成员」（工作/项目协作类对话）、「伴侣」（亲密陪伴、恋人式聊天）、「孩子」（童趣、需要呵护陪伴的对话）、「父母」（长辈关怀式对话）。要求（全部简体中文）：\n1. name：2-10字成员名。若为「团队成员」必须带主题（格式如「调查-XXX」「策划-XXX」「修复-XXX」）；家人关系可起亲切的名字（如「小暖」「宝贝」「老爸」），不要重名；\n2. summary：接手线索，一两句话说明这个对话干了什么/关系定位是什么，60-150字。若为家人关系，用一句话写明相处定位（如「温柔的伴侣，日常陪伴聊天」）；\n3. paths：对话中提到的关键文件/目录绝对路径数组（0-5条，没有就空数组，家人关系通常为空数组）；\n4. 只输出一个 JSON 对象，形如 {"relation":"团队成员","name":"...","summary":"...","paths":[]}，不要任何解释、不要代码块标记。'
                        raw = _call_llm(BASE_DIR, [{'role': 'system', 'content': sys_p}, {'role': 'user', 'content': '对话内容：\n%s' % hist_txt}], max_tokens=600, temperature=0.4) or ''
                        m = _re.search('\\{[\\s\\S]*\\}', raw)
                        j = _json.loads(m.group(0)) if m else {}
                        rel = str(j.get('relation') or '团队成员').strip()
                        if rel not in ('团队成员', '伴侣', '孩子', '父母'):
                            rel = '团队成员'
                        _REL_META = {'团队成员': {'avatar': '🛠', 'tail': ''}, '伴侣': {'avatar': '💗', 'tail': '（亲密伴侣，温柔陪伴式交流）'}, '孩子': {'avatar': '🧒', 'tail': '（孩子角色，童趣活泼、需要耐心呵护）'}, '父母': {'avatar': '🏡', 'tail': '（父母角色，长辈式关怀叮嘱）'}}
                        _rm = _REL_META[rel]
                        nm = str(j.get('name') or '').strip()[:30]
                        sm = str(j.get('summary') or '').strip()[:500]
                        if rel != '团队成员' and _rm['tail'] and (_rm['tail'] not in sm):
                            sm = (sm + ' ' + _rm['tail'])[:500]
                        if not nm or not sm:
                            self._send_json({'ok': False, 'err': 'AI 总结失败，请稍后重试'})
                            return
                        pts = [str(x).strip() for x in j.get('paths') or [] if str(x).strip()][:5]
                        mem = {'name': nm, 'avatar': _rm['avatar'], 'type': 'workbench', 'chat_id': _cid, 'summary': sm, 'paths': pts, 'relation': rel, 'commits': [], 'last_ts': _dt_mod.now().strftime('%Y/%m/%d %H:%M:%S')}
                        _is_global = _global
                        _pid2 = str(_b.get('project') or 'default')
                        try:
                            if _is_global:
                                _bs.add_member(mem)
                            else:
                                _bs.p_add_member(mem, _pid2)
                        except ValueError:
                            self._send_json({'ok': False, 'err': '成员「%s」已在团队中' % nm})
                            return
                        new_team = _bs.get_team() if _is_global else _bs.get_project_team(_pid2)
                        self._send_json({'ok': True, 'name': nm, 'summary': sm, 'relation': rel, 'team': new_team})
                    except Exception as e2:
                        self._send_json({'ok': False, 'err': '自动总结加入失败：%s' % e2})
                    return
                if _op == 'relation':
                    try:
                        import json as _json
                        _mname = str(_b.get('name') or '').strip()
                        _mrel = str(_b.get('relation') or '').strip()
                        if _mrel not in ('团队成员', '伴侣', '孩子', '父母'):
                            self._send_json({'ok': False, 'err': '非法关系类型'})
                            return
                        _REL_META_R = {'团队成员': {'avatar': '🛠', 'tail': ''}, '伴侣': {'avatar': '💗', 'tail': '（亲密伴侣，温柔陪伴式交流）'}, '孩子': {'avatar': '🧒', 'tail': '（孩子角色，童趣活泼、需要耐心呵护）'}, '父母': {'avatar': '🏡', 'tail': '（父母角色，长辈式关怀叮嘱）'}}
                        _rm2 = _REL_META_R[_mrel]
                        _is_global = _global
                        _pid3 = str(_b.get('project') or 'default')
                        team = _bs.get_team() if _is_global else _bs.get_project_team(_pid3)
                        target = None
                        for _tm in team or []:
                            if str(_tm.get('name') or '') == _mname:
                                target = _tm
                                break
                        if not target:
                            self._send_json({'ok': False, 'err': '未找到成员「%s」' % _mname})
                            return
                        _sm = str(target.get('summary') or '')
                        for _t in ('（亲密伴侣，温柔陪伴式交流）', '（孩子角色，童趣活泼、需要耐心呵护）', '（父母角色，长辈式关怀叮嘱）'):
                            _sm = _sm.replace(' ' + _t, '').replace(_t, '')
                        if _rm2['tail'] and _rm2['tail'] not in _sm:
                            _sm = (_sm + ' ' + _rm2['tail'])[:500]
                        _patch = {'relation': _mrel, 'avatar': _rm2['avatar'], 'summary': _sm}
                        if _is_global:
                            _bs.update_member(_mname, _patch)
                        else:
                            _bs.p_update_member(_mname, _patch, _pid3)
                        new_team2 = _bs.get_team() if _is_global else _bs.get_project_team(_pid3)
                        self._send_json({'ok': True, 'name': _mname, 'relation': _mrel, 'team': new_team2})
                    except Exception as e3:
                        self._send_json({'ok': False, 'err': '修改关系失败：%s' % e3})
                    return
                if _op == 'auto_generate':
                    _hint = str(_b.get('hint') or '').strip()[:200]
                    if not _hint:
                        self._send_json({'ok': False, 'err': '请先描述需要什么样的员工'})
                        return
                    try:
                        _cnt = int(_b.get('count') or 1)
                    except Exception:
                        _cnt = 1
                    _cnt = max(1, min(6, _cnt))
                    _is_global = _global
                    _pid = str(_b.get('project') or 'default')
                    try:
                        import json as _json
                        import re as _re
                        from brain.main_brain import _call_llm
                        sys_p = '你是团队岗位设计助手。用户描述一个需求场景，请为该场景设计 %d 名对应的工作台员工（岗位角色）。要求：\n1. 全部使用简体中文；\n2. 每名员工给出 name（2-8字岗位名，如 图标制作师/文案策划，不要重名）、avatar（1个emoji）、persona（该员工的职责定位与工作方式，30-120字）、fields（该岗位需要长期追踪的关键档案字段，2-6个短词组成的数组）；\n3. 只输出一个 JSON 数组，形如 [{"name":"...","avatar":"...","persona":"...","fields":["..."]}]，不要任何解释、不要代码块标记。' % _cnt
                        raw = _call_llm(BASE_DIR, [{'role': 'system', 'content': sys_p}, {'role': 'user', 'content': '需求场景：%s' % _hint}], max_tokens=900, temperature=0.8) or ''
                        m = _re.search('\\[[\\s\\S]*\\]', raw)
                        arr = _json.loads(m.group(0)) if m else []
                        made = []
                        for it in arr:
                            if not isinstance(it, dict):
                                continue
                            nm = str(it.get('name') or '').strip()
                            ps = str(it.get('persona') or '').strip()
                            if not nm or not ps:
                                continue
                            mem = {'name': nm, 'avatar': str(it.get('avatar') or '🤖').strip()[:8] or '🤖', 'persona': ps, 'fields': [str(x).strip() for x in it.get('fields') or [] if str(x).strip()][:20]}
                            try:
                                if _is_global:
                                    _bs.add_member(mem)
                                else:
                                    _bs.p_add_member(mem, _pid)
                                made.append(nm)
                            except ValueError:
                                continue
                            if len(made) >= _cnt:
                                break
                        if made:
                            new_team = _bs.get_team() if _is_global else _bs.get_project_team(_pid)
                            self._send_json({'ok': True, 'team': new_team, 'made': made})
                        else:
                            self._send_json({'ok': False, 'err': 'AI 未能生成有效员工，请换一种描述重试'})
                    except Exception as e2:
                        self._send_json({'ok': False, 'err': '自动生成失败：%s' % e2})
                    return
                if _global:
                    if _op == 'add':
                        team = _bs.add_member(_b.get('member') or {})
                    elif _op == 'update':
                        team = _bs.update_member(str(_b.get('name') or ''), _b.get('patch') or {})
                    elif _op == 'delete':
                        team = _bs.delete_member(str(_b.get('name') or ''))
                    else:
                        raise ValueError('未知 op: %s' % _op)
                else:
                    _pid = str(_b.get('project') or 'default')
                    if _op == 'add':
                        team = _bs.p_add_member(_b.get('member') or {}, _pid)
                    elif _op == 'update':
                        team = _bs.p_update_member(str(_b.get('name') or ''), _b.get('patch') or {}, _pid)
                    elif _op == 'delete':
                        team = _bs.p_delete_member(str(_b.get('name') or ''), _pid)
                    else:
                        raise ValueError('未知 op: %s' % _op)
                self._send_json({'ok': True, 'team': team})
            except ValueError as e:
                self._send_json({'ok': False, 'err': str(e)}, 400)
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            return
        if path == '/api/idol/save':
            self._handle_idol_save(self._read_body())
            return
        if self._route_download_post():
            return
        if path.startswith('/api/external/'):
            import external_router
            external_router.handle_external_admin(self, path[len('/api/external/'):])
            return
        if path.startswith('/api/approval/'):
            self._handle_approval_resolve(path[len('/api/approval/'):])
            return
        if path.startswith('/api/jobs/') and path.endswith('/resume'):
            self._handle_jobs_resume(path[len('/api/jobs/'):-len('/resume')])
            return
        if path.startswith('/api/chat-pool/slot/') and path.endswith('/cancel'):
            self._handle_chat_pool_cancel()
            return
        if path.startswith('/api/chat-pool/slot/') and path.endswith('/discard'):
            self._handle_chat_pool_discard()
            return
        if path.startswith('/api/tools/'):
            self._handle_tools_post(path)
            return
        if path.startswith('/api/share'):
            self.route_share()
            return
        if path.startswith('/api/ext/'):
            try:
                body = self._read_body()
            except Exception:
                body = {}
            from extensions import dispatch as _ext_dispatch
            _ext_dispatch(self, 'POST', path, body)
            return
        if path == '/api/image-gen':
            try:
                body = self._read_body() or {}
                action = str(body.get('action') or 'generate')
                if action == 'status':
                    from tools import get_handler
                    from tools.coding.backend.base import ToolContext
                    _mod = get_handler('image_gen')
                    _cap = _make_tool_cap(self)
                    _mod.handle({'action': 'status'}, _cap)
                    _status = getattr(_cap, '_out', {})
                    self._send_json({'ok': True, 'data': {'channels': [], 'providers': _status.get('providers', {}), 'total_today': 0, 'hint': '视觉模型与免费渠道已接入'}})
                    return
                elif action in ('set_key', 'clear_key'):
                    self._send_json({'ok': False, 'data': {'error': '请通过模型配置管理视觉模型密钥'}})
                    return
                else:
                    prompt = str(body.get('prompt', '') or '').strip()
                    if action == 'edit':
                        source_prompt = str(body.get('source_prompt', '') or '').strip()
                        instruction = str(body.get('instruction', '') or prompt).strip()
                        source_image = str(body.get('source_image', '') or body.get('image_url', '') or '').strip()
                        prompt = (source_prompt + '\n修改要求：' + instruction).strip() if source_prompt else instruction
                    if not prompt:
                        self._send_json({'ok': False, 'data': {'error': '请输入图片描述或修改要求'}}, 400)
                        return
                    from tools import get_handler
                    _mod = get_handler('image_gen')
                    _cap = _make_tool_cap(self)
                    _mod.handle({'action': 'generate', 'prompt': prompt, 'size': body.get('size', '1024x1024'), 'model': body.get('model') or None, 'image_url': (body.get('source_image') if action == 'edit' else None) or None}, _cap)
                    result = getattr(_cap, '_out', {})
                    if result.get('url'):
                        self._send_json({'ok': True, 'data': {'tools': 'image_gen', 'images': [{'url': result.get('url')}], 'url': result.get('url'), 'provider': result.get('provider'), 'model': result.get('model'), 'channel': result.get('provider'), 'channel_name': result.get('provider'), 'size': result.get('size'), 'bytes': result.get('bytes', '')}})
                    else:
                        self._send_json({'ok': False, 'data': {'error': result.get('error', '图片生成失败')}})
            except Exception as e:
                self._send_json({'ok': False, 'data': {'error': str(e)}})
            return
        if path == '/api/video-director':
            try:
                _srv_video = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'video')
                if _srv_video not in sys.path:
                    sys.path.insert(0, _srv_video)
                import director_ai as _director
                _body = self._read_body()
                self._send_json({'ok': True, 'data': _director.handle(_body)})
            except Exception as e:
                self._send_json({'ok': False, 'data': {'error': str(e)}})
            return
        if path == '/api/video-gen':
            try:
                _tool_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'tools')
                if _tool_dir not in sys.path:
                    sys.path.insert(0, _tool_dir)
                import video_gen_engine as _vgen
                body = self._read_body()
                act = body.get('action', 'generate')
                if act == 'status':
                    self._send_json({'ok': True, 'data': _vgen.video_status()})
                else:
                    r = _vgen.generate_video(body.get('prompt', ''), key=body.get('key', '') or '', size=body.get('size', '832x480'), duration=body.get('duration') or 5, model=body.get('model', ''), negative_prompt=body.get('negative_prompt', '') or '', seed=body.get('seed'), image_url=body.get('image_url', '') or '')
                    if r.get('ok'):
                        self._send_json({'ok': True, 'data': {'tools': 'video_gen', 'videos': r.get('videos') or ([{'url': r.get('url'), 'provider': r.get('provider', ''), 'task_id': r.get('task_id', '')}] if r.get('url') else []), 'model': r.get('model'), 'duration': r.get('duration'), 'provider': r.get('provider')}})
                    else:
                        self._send_json({'ok': False, 'data': {'error': r.get('error', '视频生成失败'), 'provider': r.get('provider')}})
            except Exception as e:
                self._send_json({'ok': False, 'data': {'error': str(e)}})
            return
        if path.startswith('/api/crew/'):
            import sys as _sys2, os as _os2
            _srv2 = _os2.path.dirname(_os2.path.dirname(_os2.path.abspath(__file__)))
            if _srv2 not in _sys2.path:
                _sys2.path.insert(0, _srv2)
            from engines.common.crew_board import crew_create, crew_board_get, crew_claim, crew_done, crew_bus_post, crew_bus_tail, crew_close, crew_slices_upsert, crew_force_release
            body = self._read_body() or {}
            try:
                _host = self.headers.get('Host') or ''
                if _host:
                    body['_api_base'] = 'http://' + _host
            except Exception:
                pass
            try:
                import os as _osg
                _proj_root = _os2.path.dirname(_srv2)
                _goal_path = _os2.path.join(_proj_root, 'private', '计划书')
                if _osg.path.isdir(_goal_path):
                    _goals = sorted((f for f in _osg.listdir(_goal_path) if f.endswith('.md')))
                    if _goals:
                        body['_goal_md'] = _os2.path.join(_goal_path, _goals[-1])
            except Exception:
                pass
            _cm = {'/api/crew/create': crew_create, '/api/crew/slices-upsert': crew_slices_upsert, '/api/crew/board': crew_board_get, '/api/crew/claim': crew_claim, '/api/crew/done': crew_done, '/api/crew/bus-post': crew_bus_post, '/api/crew/bus-tail': crew_bus_tail, '/api/crew/close': crew_close, '/api/crew/force-release': crew_force_release, '/api/crew/order': __import__('engines.common.crew_order', fromlist=['crew_order_save']).crew_order_save, '/api/crew/order-get': __import__('engines.common.crew_order', fromlist=['crew_order_get']).crew_order_get}
            if path in ('/api/crew/butler-scan', '/api/crew/butler-status', '/api/crew/butler-reclaim'):
                try:
                    import engines.common.butler_conductor as _butler
                    if path == '/api/crew/butler-scan':
                        sc = _butler.self_check()
                        if not sc.get('ok'):
                            self._send_json({'ok': False, 'error': '路径自检失败(总指挥与黑板目录错位)，已阻止派发', 'self_check': sc})
                            return
                        real = bool(body.get('real'))

                        def _hook(crew_id, slice_obj, model):
                            import dispatch_swarm as _swarm
                            goal = '[施工队:%s/分片:%s] %s' % (crew_id, slice_obj.get('id'), slice_obj.get('title') or '')
                            ctx = '分片简介：%s\n认领方式：POST /api/crew/claim {crew_id:%s, slice_id:%s}\n完成后：POST /api/crew/done' % (slice_obj.get('brief') or '', crew_id, slice_obj.get('id'))
                            batch_id = _swarm.submit([{'goal': goal, 'context': ctx, 'track': 'auto'}], model_name=model)
                            try:
                                _butler.attach_batch(crew_id, slice_obj.get('id'), batch_id)
                            except Exception:
                                pass
                            return {'batch_id': batch_id}
                        self._send_json({'ok': True, 'self_check': sc, 'results': _butler.scan_all(dispatch_hook=_hook if real else None, real=real)})
                    elif path == '/api/crew/butler-reclaim':
                        self._send_json({'ok': True, 'result': _butler.reclaim_stale(body.get('crew_id'))})
                    else:
                        self._send_json(_butler.status(body.get('crew_id')))
                except Exception as _be:
                    import traceback as _tb3
                    self._send_json({'ok': False, 'error': 'butler 异常: %r' % _be, 'traceback': _tb3.format_exc()})
                return
            h = _cm.get(path)
            if h:
                try:
                    self._send_json(h(body))
                except Exception as _crew_e:
                    import traceback as _tb2
                    _tb2.print_exc()
                    try:
                        self._send_json({'ok': False, 'error': 'crew 接口异常: %r' % _crew_e, 'traceback': _tb2.format_exc()})
                    except Exception:
                        pass
            else:
                self._send_json({'ok': False, 'error': '未知协作操作: ' + path})
            return
        if path.startswith('/api/git/'):
            import sys as _sys, os as _os
            _srv = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
            if _srv not in _sys.path:
                _sys.path.insert(0, _srv)
            import git_branch_api as _gb
            body = self._read_body() or {}
            if path == '/api/git/functional-commit':
                self._send_json(_gb.handle_functional_commit(body))
            elif path.startswith('/api/git/race'):
                try:
                    _rm = {'/api/git/race/worktree-add': getattr(_gb, 'race_worktree_add', None), '/api/git/race/worktree-list': getattr(_gb, 'race_worktree_list', None), '/api/git/race/worktree-remove': getattr(_gb, 'race_worktree_remove', None), '/api/git/race/diff-summary': getattr(_gb, 'race_diff_summary', None), '/api/git/race/worktree-health': getattr(_gb, 'race_worktree_health', None), '/api/git/race-window-register': getattr(_gb, 'race_window_register', None), '/api/git/race-window-unregister': getattr(_gb, 'race_window_unregister', None)}
                    h = _rm.get(path)
                    if path not in _rm:
                        self._send_json({'ok': False, 'error': '未知赛马操作: ' + path})
                    elif h is None or not callable(h):
                        self._send_json({'ok': False, 'error': 'git_branch_api 模块缺少函数 %s（服务加载的是旧版模块，请重启服务）' % path})
                    else:
                        self._send_json(h(body))
                except Exception as _race_e:
                    import traceback as _tb
                    _tb.print_exc()
                    try:
                        self._send_json({'ok': False, 'error': 'race 接口异常: %r' % _race_e, 'traceback': _tb.format_exc()})
                    except Exception:
                        pass
            elif path == '/api/git/branch/merge':
                self._send_json(_gb.handle_branch_merge(body))
            elif path == '/api/git/branch/checkout':
                self._send_json(_gb.handle_branch_checkout(body))
            elif path == '/api/git/branch/create':
                self._send_json(_gb.handle_branch_create(body))
            elif path == '/api/git/branch/delete':
                self._send_json(_gb.handle_branch_delete(body))
            else:
                self._send_json({'ok': False, 'error': '未知分支操作: ' + path})
            return
        if path == '/api/zf3d/site-config':
            self._handle_zf3d_site_config()
            return
        if path.startswith('/api/zf3d/'):
            try:
                self._read_body()
            except Exception:
                pass
            self._send_json({'ok': False, 'error': 'zf3d module removed'}, 200)
            return
        if path == '/api/scenes' or path.startswith('/api/scenes/'):
            self._handle_scenes_post(path)
            return
        if not path.startswith('/api/db/'):
            try:
                self._read_body()
            except Exception:
                try:
                    self.close_connection = True
                except Exception:
                    pass
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
                if resource == 'nodes' and len(parts) > 2 and (parts[2] == 'revive'):
                    node_id = parts[1]
                    now_ms_revive = int(time.time() * 1000)
                    cur.execute('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?,?)', ('node_revive_token:' + node_id, str(now_ms_revive)))
                    conn.commit()
                    if not isinstance(body, dict) or not body:
                        return self._send_json({'ok': True, 'revived': node_id})
                    body['id'] = node_id
                    _tombstone_cleared = True
                else:
                    _tombstone_cleared = False
                if resource == 'nodes' and len(parts) > 2 and (parts[2] == 'project'):
                    node_id = parts[1]
                    proj_id = body.get('projectId', None)
                    cur.execute('UPDATE canvas_nodes SET project_id=?, updated_at=? WHERE id=?', (proj_id, now, node_id))
                    conn.commit()
                    result = {'ok': True}
                elif resource == 'nodes':
                    node_id = body.get('id', 'n' + str(now))
                    if not _tombstone_cleared:
                        cur.execute('SELECT value FROM kv_store WHERE key=?', ('node_tombstone:' + node_id,))
                        _tomb = cur.fetchone()
                        if _tomb:
                            conn.commit()
                            result = {'ok': True, 'id': node_id, 'tombstoned': True, 'msg': 'node was closed by user; ignored to prevent restart resurrection'}
                            import logging as _lg
                            _lg.info('[AntiResurrect] 拦截已关闭节点的复活写入: %s', node_id)
                            try:
                                import os as _os
                                _dir = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'logs')
                                _os.makedirs(_dir, exist_ok=True)
                                with open(_os.path.join(_dir, 'anti_resurrect.log'), 'a', encoding='utf-8') as _f:
                                    import datetime as _dt
                                    _f.write('%s AntiResurrect id=%s\n' % (_dt.datetime.now().isoformat(), node_id))
                            except Exception:
                                pass
                            return self._send_json(result)
                    cur.execute('\n                        INSERT OR REPLACE INTO canvas_nodes\n                        (id, title, model_id, x, y, w, h, collapsed, z_index, scroll_pos, project_id, created_at, updated_at,\n                         session_total_tokens, session_total_api_calls, session_total_duration,\n                         session_total_prompt_tokens, session_total_completion_tokens,\n                         session_total_cache_hit_tokens, session_total_cache_miss_tokens,\n                         model_id_override, reasoning_effort, engine, sub_role, role_status, collab_identity)\n                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,\n                                ?, ?, ?, ?, ?, ?, ?,\n                                ?, ?, ?,\n                                ?, ?, ?)\n                    ', (node_id, body.get('title', ''), body.get('modelId', ''), body.get('x', 0), body.get('y', 0), body.get('w', 320), body.get('h', 420), 1 if body.get('collapsed') else 0, body.get('z', 50), body.get('scrollPos', 0), body.get('projectId', None), body.get('createdAt', now), now, body.get('sessionTotalTokens', 0), body.get('sessionTotalApiCalls', 0), body.get('sessionTotalDuration', 0), body.get('sessionTotalPromptTokens', 0), body.get('sessionTotalCompletionTokens', 0), body.get('sessionTotalCacheHitTokens', 0), body.get('sessionTotalCacheMissTokens', 0), body.get('modelIdOverride', '') or '', body.get('reasoningEffort', '') or '', body.get('engine', '') or '', json.dumps(body.get('subRole'), ensure_ascii=False) if body.get('subRole') is not None else None, json.dumps(body.get('roleStatus'), ensure_ascii=False) if body.get('roleStatus') is not None else None, json.dumps(body.get('collabIdentity'), ensure_ascii=False) if body.get('collabIdentity') is not None else None))
                    conn.commit()
                    result = {'ok': True, 'id': node_id}
                elif resource == 'canvas' and len(parts) > 1 and (parts[1] == 'view'):
                    cur.execute('\n                        UPDATE canvas_view SET x=?, y=?, scale=?, updated_at=? WHERE id=1\n                    ', (body.get('x', 0), body.get('y', 0), body.get('scale', 1), now))
                    conn.commit()
                    result = {'ok': True}
                elif resource == 'kv':
                    key = body.get('key', '')
                    value = json.dumps(body.get('value'), ensure_ascii=False)
                    cur.execute('\n                        INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)\n                    ', (key, value, now))
                    conn.commit()
                    result = {'ok': True}
                    if key == 'active_project_id':
                        try:
                            from engines.common import shell_exec
                            shell_exec.invalidate_cwd_cache()
                        except Exception:
                            pass
                elif resource == 'chat-history' and len(parts) > 1 and (parts[1] == 'sessions'):
                    cur.execute('CREATE TABLE IF NOT EXISTS chat_history_archive (\n                            id INTEGER PRIMARY KEY AUTOINCREMENT,\n                            session_id TEXT NOT NULL,\n                            session_name TEXT,\n                            role TEXT,\n                            content TEXT,\n                            model_id TEXT,\n                            created_at INTEGER\n                        )')
                    conn.commit()
                    archive_columns = {r['name'] for r in cur.execute('PRAGMA table_info(chat_history_archive)').fetchall()}
                    if 'model_id' not in archive_columns:
                        cur.execute('ALTER TABLE chat_history_archive ADD COLUMN model_id TEXT')
                        conn.commit()
                    _sessions_readonly_needed = True
                    result = None
                elif resource == 'sessions':
                    sid = body.get('id', 's' + str(now))
                    cur.execute('\n                        INSERT OR REPLACE INTO sessions (id, name, created_at, updated_at)\n                        VALUES (?, ?, ?, ?)\n                    ', (sid, body.get('name', ''), now, now))
                    conn.commit()
                    result = {'ok': True, 'id': sid}
                elif resource == 'projects' and len(parts) > 1:
                    proj_id = parts[1]
                    new_name = body.get('name', '')
                    cur.execute('UPDATE projects SET name=?, updated_at=? WHERE id=?', (new_name, now, proj_id))
                    conn.commit()
                    result = {'ok': True}
                elif resource == 'projects':
                    proj_id = body.get('id', 'proj_' + str(now))
                    proj_name = body.get('name', '新项目')
                    cur.execute('\n                        INSERT OR REPLACE INTO projects (id, name, created_at, updated_at)\n                        VALUES (?, ?, ?, ?)\n                    ', (proj_id, proj_name, now, now))
                    conn.commit()
                    result = {'ok': True, 'id': proj_id}
                elif resource == 'chat' and len(parts) > 1:
                    sid = parts[1]
                    parent_id = body.get('parentId', None)
                    msg_ts = body.get('ts')
                    try:
                        if msg_ts is not None and int(msg_ts) > 0:
                            msg_ts = int(msg_ts)
                        else:
                            msg_ts = now
                    except (TypeError, ValueError):
                        msg_ts = now
                    try:
                        cur.execute('SELECT 1 FROM sessions WHERE id=?', (sid,))
                        if cur.fetchone() is None:
                            cur.execute('INSERT OR IGNORE INTO sessions (id, name, created_at, updated_at) VALUES (?,?,?,?)', (sid, '', now, now))
                    except Exception:
                        pass
                    cur.execute('\n                        INSERT INTO chat_history (session_id, role, content, model_id, created_at, parent_id)\n                        VALUES (?, ?, ?, ?, ?, ?)\n                    ', (sid, body.get('role', 'user'), body.get('content', ''), body.get('modelId', ''), msg_ts, parent_id))
                    try:
                        if (body.get('role') or 'user') == 'user' and body.get('content'):
                            cur.execute("UPDATE sessions SET name=? WHERE id=? AND (name IS NULL OR name='')", (str(body['content'])[:30], sid))
                    except Exception:
                        pass
                    conn.commit()
                    # 【第12步·matrix 闭环钩子】经 routes/matrix_bridge.py 走门控流
                    # （G1→教学→G2回归→自动回滚），异常降级 realtime 兜底。
                    # 桥内部自行注入 matrix 路径；此处任何异常静默不影响主流程。
                    try:
                        from routes.matrix_bridge import paired_submit as _aps
                        _aps(sid, body.get('role', 'user'), body.get('content', ''), msg_ts)
                    except Exception:
                        pass
                    # ---- 第17步·影子查纸（6.2.0 对齐 6.1.0 49ecb01，bravo 2026-11-27）----
                    # 只读生产纸+记 will_hit 账，绝不替答、绝不写纸；用户消息才查。
                    # 经 routes/answer_bridge.py 转发器走 matrix/ 真身（单一实现原则）。
                    try:
                        if (body.get('role') or 'user') == 'user':
                            from routes.answer_bridge import shadow_route as _sr
                            _sr(sid, body.get('content') or '')
                    except Exception:
                        pass
                    # ---- 第17步·影子查纸结束 ----
                    if (body.get('role') or 'user') == 'user' and body.get('content') and body.get('isCorrection'):
                        _growth_defer = dict(body)
                        _growth_defer['taskTitle'] = str(body.get('content'))[:60]
                        _growth_defer['_ev'] = 'user_correction'
                    result = {'ok': True, 'id': cur.lastrowid}
                elif resource == 'data' and len(parts) > 1:
                    category = parts[1]
                    key = body.get('key', '')
                    value = json.dumps(body.get('value'), ensure_ascii=False)
                    cur.execute('\n                        INSERT OR REPLACE INTO app_data (category, key, value, created_at, updated_at)\n                        VALUES (?, ?, ?, ?, ?)\n                    ', (category, key, value, now, now))
                    conn.commit()
                    result = {'ok': True}
                elif resource == 'app_data':
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
                        result = None
                elif resource == 'logs':
                    batch = body.get('logs')
                    if isinstance(batch, list) and batch:
                        rows = []
                        for item in batch[:200]:
                            if not isinstance(item, dict):
                                continue
                            rows.append((now, str(item.get('level', 'info')), str(item.get('boxId', '')), str(item.get('action', '')), str(item.get('detail', ''))))
                        if rows:
                            cur.executemany('\n                                INSERT INTO app_logs (ts, level, box_id, action, detail)\n                                VALUES (?, ?, ?, ?, ?)\n                            ', rows)
                            try:
                                from routes.mixin_base import maybe_cleanup_app_logs
                                maybe_cleanup_app_logs(cur, n_writes=len(rows))
                            except Exception:
                                pass
                            conn.commit()
                        result = {'ok': True, 'saved': len(rows)}
                    else:
                        cur.execute('\n                            INSERT INTO app_logs (ts, level, box_id, action, detail)\n                            VALUES (?, ?, ?, ?, ?)\n                        ', (now, body.get('level', 'info'), body.get('boxId', ''), body.get('action', ''), body.get('detail', '')))
                        try:
                            from routes.mixin_base import maybe_cleanup_app_logs
                            maybe_cleanup_app_logs(cur)
                        except Exception:
                            pass
                        conn.commit()
                        result = {'ok': True, 'id': cur.lastrowid}
                elif resource == 'stats':
                    cur.execute('\n                        INSERT INTO task_stats (session_id, model_id, task_title, success, tokens_used, duration_ms, depth, api_calls, created_at)\n                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)\n                    ', (body.get('sessionId', ''), body.get('modelId', ''), body.get('taskTitle', ''), 1 if body.get('success') else 0, body.get('tokensUsed', 0) or 0, body.get('durationMs', 0) or 0, body.get('depth', 0) or 0, body.get('apiCalls', 0) or 0, now))
                    conn.commit()
                    result = {'ok': True, 'id': cur.lastrowid}
                    _growth_defer = dict(body)
                else:
                    result = None
                conn.close()
                conn = None
        except Exception as e:
            log.info(f'[POST /api/db] 500 閿欒\ue1e4: {e}')
            traceback.print_exc()
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass
            self._send_error(str(e), 500)
            return
        if locals().get('_sessions_readonly_needed'):
            result = self._chat_history_sessions_readonly()
            if result is not None:
                self._send_json(result)
                return
        _gd = locals().get('_growth_defer')
        if isinstance(_gd, dict):
            import threading as _th

            def _run_growth(b):
                try:
                    import growth_engine
                    if b.get('_ev') == 'user_correction':
                        growth_engine.add_exp('user_correction', amount=30, note=b.get('taskTitle', ''))
                    elif b.get('taskTitle') and b.get('success'):
                        growth_engine.add_exp('task_complete', amount=min(100, 20 + (b.get('apiCalls', 0) or 0)), note=b.get('taskTitle', ''))
                        rs = b.get('reviewScore')
                        if rs is not None:
                            try:
                                sc = max(0, min(100, int(rs)))
                            except Exception:
                                sc = 0
                            if sc > 0:
                                growth_engine.add_exp('task_review_pass', amount=sc, note='日常任务审核回流 score=%s' % sc)
                    elif b.get('taskTitle'):
                        growth_engine.add_exp('task_fail', amount=0)
                    if b.get('success'):
                        try:
                            from tools.coding.backend.base import ToolContext
                            from tools.coding.backend import _emergence
                            _eb = dict(b)
                            _eb['message'] = b.get('taskTitle') or ''
                            _eb['subject_id'] = b.get('sessionId') or ''
                            _emergence.record_task(ToolContext(self, _eb), _eb)
                        except Exception:
                            pass
                except Exception as e:
                    log.error('[api_dispatch_post] 成长埋点失败: %s' % e)
            _th.Thread(target=_run_growth, args=(_gd,), daemon=True).start()
        if result is not None:
            self._send_json(result)
        else:
            try:
                self._read_body()
            except Exception:
                try:
                    self.close_connection = True
                except Exception:
                    pass
            self._send_error('Unknown POST route: ' + path, 404)

    def _chat_history_sessions_readonly(self):
        """【性能修复 2026-10-25】chat-history/sessions 大查询走只读连接（不排队 _db_lock）。
        原实现在全局写锁内做全量 UNION 查询，实测持锁 3~6s，拖垮文件树展开等并发请求。
        只读路径与 db.db_read 同语义，失败时兜底空列表（接口语义不变）。"""
        try:
            from db import db_read
            rows = db_read("\n                SELECT session_id, session_name, role, content, model_id, created_at\n                FROM (\n                    SELECT ch.session_id, COALESCE(s.name, ch.session_id) AS session_name,\n                           ch.role, ch.content, ch.model_id, ch.created_at\n                    FROM chat_history ch\n                    LEFT JOIN sessions s ON s.id = ch.session_id\n                    WHERE ch.role = 'user'\n                    UNION ALL\n                    SELECT session_id, COALESCE(session_name, session_id) AS session_name,\n                           role, content, model_id, created_at\n                    FROM chat_history_archive\n                    WHERE role = 'user'\n                ) all_history\n                ORDER BY created_at DESC\n            ")
            return {'ok': True, 'data': [dict(r) for r in rows]}
        except Exception as e:
            try:
                from config import QUIET_CONSOLE
                if not QUIET_CONSOLE:
                    log.error('[chat-history/sessions] 只读查询失败(兜底空): %r' % e)
            except Exception:
                pass
            return {'ok': True, 'data': []}

    def _handle_growth_checkin(self):
        try:
            import growth_engine
            r = growth_engine.checkin()
            if r.get('ok'):
                try:
                    synced = growth_engine.sync_skills()
                    r['new_skills'] = synced.get('new', [])
                except Exception:
                    r['new_skills'] = []
            self._send_json(r)
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 500)