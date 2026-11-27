# -*- coding: utf-8 -*-
"""自动生成（server/tools/split_dispatch.py 机械拆分）：routes\api_dispatch_get.py 的
以 return 结尾精确 path 分支，逐支注册进路由注册表。

纯搬家：函数体来自原 if 分支逐行 dedent，未改任何语句；
重新生成会整体覆盖本文件。"""

from routes.dispatcher import route_get

from util_log import get_logger

log = get_logger('domain_legacy_get')
# 公共 stdlib 兜底（机械迁移分支常用名；未被使用也无副作用）
import time
from urllib.parse import parse_qs


@route_get(['/api/agents', '/agent-info', '/.well-known/agent.json'])
def _h_api_agents_1(self, path, parsed):
    # 原 do_GET 分支（path == '/api/agents' or path == '/agent-info' or path == '/.well-known/agent.json'），机械搬家园
    import agent_registry as _ar
    try:
        import agent_registry as _ar
        if path == '/api/agents':
            _qs = parse_qs(parsed.query or '')
            _scope = (_qs.get('scope') or ['local'])[0]
            self._send_json(_ar.list_agents(scope=_scope))
        else:
            self._send_json(_ar.get_self_card_public())
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_get('/api/plaza/config')
def _h_api_plaza_config_2(self, path, parsed):
    # 原 do_GET 分支（path == '/api/plaza/config'），机械搬家园
    from config import BASE_DIR as _base
    import json as _json
    import os as _os
    _ws_port = 8625  # 兜底默认与 6.2.0 端口段一致；真源 port.json 的 plaza_ws_port
    _warn = None
    try:
        import os as _os
        import json as _json
        from config import BASE_DIR as _base
        _pj = _os.path.join(_base, 'private', 'port.json')
        with open(_pj, 'r', encoding='utf-8-sig') as _f:
            _ws_port = int(_json.load(_f).get('plaza_ws_port') or _ws_port)
    except Exception as _e:
        _warn = str(_e)
    _out = {'ok': True, 'ws_port': _ws_port}
    if _warn:
        _out['warn'] = _warn
    self._send_json(_out)
    return


@route_get('/api/tts/config')
def _h_api_tts_config_1(self, path, parsed):
    # 流式TTS端口下发（前端 tts_stream_client.js 连接前拉取，替代旧硬编码 8524——
    # 6.2.0 端口段迁移后前端仍在拨 8524，导致流式TTS前端静默失联，本案收口）
    from config import BASE_DIR as _base
    import json as _json, os as _os
    _port = 8622
    _enabled = True
    try:
        _ts = _json.load(open(_os.path.join(_base, 'private', 'port.json'),
                              encoding='utf-8-sig')).get('tts_stream') or {}
        _port = int(_ts.get('port') or _port)
        _enabled = bool(_ts.get('enabled', True))
    except Exception:
        pass
    self._send_json({'ok': True, 'port': _port, 'enabled': _enabled})
    return


@route_get('/api/fengkong/files')
def _h_api_fengkong_files_3(self, path, parsed):
    # 原 do_GET 分支（path == '/api/fengkong/files'），机械搬家园
    self._handle_fk_files(parsed)
    return


@route_get('/api/fengkong/changes')
def _h_api_fengkong_changes_4(self, path, parsed):
    # 原 do_GET 分支（path == '/api/fengkong/changes'），机械搬家园
    self._handle_fk_changes(parsed)
    return


@route_get('/api/fengkong/download')
def _h_api_fengkong_download_5(self, path, parsed):
    # 原 do_GET 分支（path == '/api/fengkong/download'），机械搬家园
    self._handle_fk_download(parsed)
    return


@route_get('/api/fengkong/thumb')
def _h_api_fengkong_thumb_6(self, path, parsed):
    # 原 do_GET 分支（path == '/api/fengkong/thumb'），机械搬家园
    self._handle_fk_thumb(parsed)
    return


@route_get('/api/growth/full')
def _h_api_growth_full_7(self, path, parsed):
    # 原 do_GET 分支（path == '/api/growth/full'），机械搬家园
    import growth_engine
    try:
        import growth_engine
        self._send_json(growth_engine.growth_full())
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_get('/api/growth/summary')
def _h_api_growth_summary_8(self, path, parsed):
    # 原 do_GET 分支（path == '/api/growth/summary'），机械搬家园
    import growth_engine
    try:
        import growth_engine
        self._send_json(growth_engine.summary())
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_get('/api/model-link-stats')
def _h_api_model_link_stats_9(self, path, parsed):
    # 原 do_GET 分支（path == '/api/model-link-stats'），机械搬家园
    import model_link_stats as _mls
    try:
        import model_link_stats as _mls
        self._send_json({'ok': True, 'enabled': _mls.is_enabled(), 'data': _mls.summary()})
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_get('/api/tokstats')
def _h_api_tokstats_10(self, path, parsed):
    # 原 do_GET 分支（path == '/api/tokstats'），机械搬家园
    import tok_stats as _ts
    try:
        import tok_stats as _ts
        self._send_json(_ts.summary())
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_get('/api/download/progress')
def _h_api_download_progress_11(self, path, parsed):
    # 原 do_GET 分支（path == '/api/download/progress'），机械搬家园
    from urllib.parse import parse_qs as _pqs
    from urllib.parse import parse_qs as _pqs
    self._handle_download_progress(_pqs(parsed.query or ''))
    return


@route_get('/api/download/list')
def _h_api_download_list_12(self, path, parsed):
    # 原 do_GET 分支（path == '/api/download/list'），机械搬家园
    self._handle_download_list()
    return


@route_get('/api/agent/protocol')
def _h_api_agent_protocol_13(self, path, parsed):
    # 原 do_GET 分支（path == '/api/agent/protocol'），机械搬家园
    self._handle_agent_protocol_get()
    return


@route_get('/api/supervisor')
def _h_api_supervisor_14(self, path, parsed):
    # 原 do_GET 分支（path == '/api/supervisor'），机械搬家园
    self._handle_supervisor_get()
    return


@route_get('/api/butler/state')
def _h_api_butler_state_15(self, path, parsed):
    # 原 do_GET 分支（path == '/api/butler/state'），机械搬家园
    import butler_store as _bs
    from urllib.parse import parse_qs as _pq, urlparse as _pu
    from urllib.parse import parse_qs as _pq, urlparse as _pu
    try:
        from urllib.parse import parse_qs as _pq, urlparse as _pu
        _q = _pq(_pu(self.path).query)
        _role = (_q.get('role') or ['健康师'])[0]
        import butler_store as _bs
        s, p, recs = _bs.summary(role=_role, days=7)
        self._send_json({'ok': True, 'summary': s, 'profile': p, 'records_count': len(recs), 'role': _role})
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_get('/api/workbench/widgets')
def _h_api_workbench_widgets_16(self, path, parsed):
    # 原 do_GET 分支（path == '/api/workbench/widgets'），机械搬家园
    from urllib.parse import parse_qs as _pq
    import workbench_panel as _wp
    try:
        from urllib.parse import parse_qs as _pq
        _q = _pq(parsed.query)
        import workbench_panel as _wp
        self._send_json({'ok': True, 'widgets': _wp.list_widgets((_q.get('project') or ['default'])[0])})
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_get('/api/butler/team')
def _h_api_butler_team_17(self, path, parsed):
    # 原 do_GET 分支（path == '/api/butler/team'），机械搬家园
    import butler_store as _bs
    from urllib.parse import parse_qs as _pq
    try:
        from urllib.parse import parse_qs as _pq
        import butler_store as _bs
        _q = _pq(parsed.query)
        if (_q.get('templates') or ['0'])[0] == '1':
            self._send_json({'ok': True, 'templates': _bs.list_templates()})
            return
        _pq_project = _q.get('project')
        if _pq_project and _pq_project[0]:
            _pid = _pq_project[0]
            self._send_json({'ok': True, 'team': _bs.get_project_team(_pid), 'project': _pid})
        else:
            self._send_json({'ok': True, 'team': _bs.get_team(), 'project': 'global'})
    except ValueError as e:
        self._send_json({'ok': False, 'err': str(e)}, 400)
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_get('/api/butler/chat_brief')
def _h_api_butler_chat_brief_18(self, path, parsed):
    # 原 do_GET 分支（path == '/api/butler/chat_brief'），机械搬家园
    from urllib.parse import parse_qs as _pq
    from db import db_read
    try:
        from urllib.parse import parse_qs as _pq
        _q = _pq(parsed.query)
        _sid = (_q.get('id') or [''])[0]
        if not _sid:
            self._send_json({'ok': False, 'err': 'missing id'})
            return
        from db import db_read
        rows = db_read('\n                    SELECT role, content, created_at FROM (\n                        SELECT role, content, created_at FROM chat_history WHERE session_id = ?\n                        UNION ALL\n                        SELECT role, content, created_at FROM chat_history_archive WHERE session_id = ?\n                    ) ORDER BY created_at ASC LIMIT 4\n                ', (_sid, _sid))
        msgs = [{'role': r['role'], 'preview': (r['content'] or '')[:200], 'created_at': r['created_at']} for r in rows]
        self._send_json({'ok': True, 'session_id': _sid, 'found': bool(msgs), 'brief': msgs})
    except Exception as e:
        self._send_json({'ok': True, 'session_id': _sid, 'found': False, 'brief': [], 'err': str(e)})
    return


@route_get('/api/pins')
def _h_api_pins_19(self, path, parsed):
    # 原 do_GET 分支（path == '/api/pins'），机械搬家园
    import datasource_pins as _dp
    from urllib.parse import parse_qs as _pq
    try:
        from urllib.parse import parse_qs as _pq
        _q = _pq(parsed.query)
        import datasource_pins as _dp
        try:
            _dp.ensure_auto_sync()
            _dp.migrate_default_to((_q.get('project') or ['default'])[0])
        except Exception:
            pass
        _proj = (_q.get('project') or ['default'])[0]
        self._send_json({'ok': True, 'pins': _dp.list_pins(_proj), 'pos': _dp.get_positions(_proj)})
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_get('/api/brain/state')
def _h_api_brain_state_20(self, path, parsed):
    # 原 do_GET 分支（path == '/api/brain/state'），机械搬家园
    self._handle_brain_state()
    return


@route_get('/api/brain/report')
def _h_api_brain_report_21(self, path, parsed):
    # 原 do_GET 分支（path == '/api/brain/report'），机械搬家园
    self._handle_brain_report()
    return


@route_get('/api/agent/protocol/last')
def _h_api_agent_protocol_last_22(self, path, parsed):
    # 原 do_GET 分支（path == '/api/agent/protocol/last'），机械搬家园
    self._handle_agent_protocol_last()
    return


@route_get('/api/gate/status')
def _h_api_gate_status_23(self, path, parsed):
    # 原 do_GET 分支（path == '/api/gate/status'），机械搬家园
    self._handle_gate_status()
    return


@route_get('/api/gate/active')
def _h_api_gate_active_24(self, path, parsed):
    # 原 do_GET 分支（path == '/api/gate/active'），机械搬家园
    self._handle_gate_active()
    return


@route_get('/api/db/lockdiag')
def _h_api_db_lockdiag_25(self, path, parsed):
    # 原 do_GET 分支（path == '/api/db/lockdiag'），机械搬家园
    from config import _db_lock as _DL
    from security import _is_loopback_request
    try:
        from security import _is_loopback_request
        if not _is_loopback_request(self):
            self._send_json({'ok': False, 'error': '仅限本机访问'}, 403)
            return
        from config import _db_lock as _DL
        _h = getattr(_DL, '_holder', None)
        if _h is not None:
            _info = {'holder': _h.name, 'held_sec': round(time.time() - getattr(_DL, '_held_since', time.time()), 1), 'stack': _DL._stack_of(_h)}
        else:
            _info = {'holder': None, 'note': '当前无人持锁（写库空闲）'}
        self._send_json({'ok': True, 'data': _info})
    except Exception as _e:
        self._send_json({'ok': False, 'error': str(_e)})
    return


@route_get('/api/chat-pool/status')
def _h_api_chat_pool_status_26(self, path, parsed):
    # 原 do_GET 分支（path == '/api/chat-pool/status'），机械搬家园
    self._handle_chat_pool_status()
    return


@route_get('/api/chat-pool/active')
def _h_api_chat_pool_active_27(self, path, parsed):
    # 原 do_GET 分支（path == '/api/chat-pool/active'），机械搬家园
    self._handle_chat_pool_active()
    return


@route_get('/api/chat-pool/config')
def _h_api_chat_pool_config_28(self, path, parsed):
    # 原 do_GET 分支（path == '/api/chat-pool/config'），机械搬家园
    self._handle_chat_pool_config()
    return


@route_get('/api/trustee/status')
def _h_api_trustee_status_29(self, path, parsed):
    # 原 do_GET 分支（path == '/api/trustee/status'），机械搬家园
    self._handle_trustee_status()
    return


@route_get('/api/engineering/graph')
def _h_api_engineering_graph_30(self, path, parsed):
    # 原 do_GET 分支（path == '/api/engineering/graph'），机械搬家园
    self._handle_eng_graph()
    return


@route_get('/api/engineering/boards')
def _h_api_engineering_boards_31(self, path, parsed):
    # 原 do_GET 分支（path == '/api/engineering/boards'），机械搬家园
    self._handle_eng_boards()
    return


@route_get('/api/engineering/projects')
def _h_api_engineering_projects_32(self, path, parsed):
    # 原 do_GET 分支（path == '/api/engineering/projects'），机械搬家园
    self._handle_eng_projects()
    return


@route_get('/api/loop_s/events')
def _h_api_loop_s_events_33(self, path, parsed):
    # 原 do_GET 分支（path == '/api/loop_s/events'），机械搬家园
    self._handle_loop_s_events()
    return


@route_get('/api/loop_s/status')
def _h_api_loop_s_status_34(self, path, parsed):
    # 原 do_GET 分支（path == '/api/loop_s/status'），机械搬家园
    self._handle_loop_s_status()
    return


@route_get('/api/approval/list')
def _h_api_approval_list_35(self, path, parsed):
    # 原 do_GET 分支（path == '/api/approval/list'），机械搬家园
    self._handle_approval_list()
    return


@route_get('/api/cleanup/speed')
def _h_api_cleanup_speed_36(self, path, parsed):
    # 原 do_GET 分支（path == '/api/cleanup/speed'），机械搬家园
    from routes.mixin_cleanup import handle_cleanup_speed
    from routes.mixin_cleanup import handle_cleanup_speed
    handle_cleanup_speed(self, do_run=False)
    return


@route_get('/api/cleanup/step')
def _h_api_cleanup_step_37(self, path, parsed):
    # 原 do_GET 分支（path == '/api/cleanup/step'），机械搬家园
    from routes.mixin_cleanup import handle_cleanup_step
    from routes.mixin_cleanup import handle_cleanup_step
    handle_cleanup_step(self, do_run=False, key=(parse_qs(parsed.query or '').get('key') or [''])[0])
    return


@route_get('/api/trash/list')
def _h_api_trash_list_38(self, path, parsed):
    # 原 do_GET 分支（path == '/api/trash/list'），机械搬家园
    self._handle_trash_list(parsed)
    return


@route_get('/api/avatar/tts')
def _h_api_avatar_tts_39(self, path, parsed):
    # 原 do_GET 分支（path == '/api/avatar/tts'），机械搬家园
    self._handle_avatar_tts(qs=parse_qs(parsed.query))
    return


# 【2026-11-23 安全整改】/api/models/refresh 写操作已迁 POST（domain_legacy_post.py），
# 原 GET 注册删除：GET 形态可被浏览器预取/<img>跨站触发。


@route_get('/api/models/reveal-key')
def _h_api_models_reveal_key_41(self, path, parsed):
    # 【安全 2026-11-24】GET 明文显钥已下线。原实现凭 URL 里的 4 位尾号即返回解密后的完整密钥，
    # 而本机回环请求免 token——智能体自己执行的 shell 命令就能把全部密钥取走。
    # 明文显钥改为 POST + 查看密码（routes/domain_key_reveal.py）。这里只回引导信息，绝不返回 key。
    # 回归：tests/test_key_reveal.py 断言本路由的响应里没有 key 字段
    # （本文件是机械拆分的生成物，若被重新生成，该测试会变红）。
    self._send_json({'ok': False,
                     'err': '明文显钥已改为 POST，并需要输入“查看密钥密码”',
                     'need_password': True}, 405)
    return


@route_get('/api/models/config')
def _h_api_models_config_42(self, path, parsed):
    # 原 do_GET 分支（path == '/api/models/config'），机械搬家园
    from model_config import load_models_config
    from model_config import load_models_config
    cfg = load_models_config()
    if cfg is None:
        self._send_json({'ok': False, 'err': 'models.json 不存在，请通过 POST /api/models/config 初始化'}, 404)
    else:
        self._send_json({'ok': True, 'config': cfg})
    return


@route_get('/api/health')
def _h_api_health_43(self, path, parsed):
    # 原 do_GET 分支（path == '/api/health'），机械搬家园
    self.do_GET_health()
    return


@route_get('/api/routes/health')
def _h_api_routes_health_44(self, path, parsed):
    # 原 do_GET 分支（path == '/api/routes/health'），机械搬家园
    import routes_manager
    try:
        import routes_manager
        self._send_json({'ok': True, 'routes': routes_manager.status(), 'ts': int(__import__('time').time())})
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_get('/api/health/config')
def _h_api_health_config_45(self, path, parsed):
    # 原 do_GET 分支（path == '/api/health/config'），机械搬家园
    self._handle_health_config_get()
    return


@route_get('/api/keys/audit')
def _h_api_keys_audit_46(self, path, parsed):
    # 原 do_GET 分支（path == '/api/keys/audit'），机械搬家园
    self._handle_key_audit()
    return


@route_get('/api/health/state')
def _h_api_health_state_47(self, path, parsed):
    # 原 do_GET 分支（path == '/api/health/state'），机械搬家园
    self._handle_health_state_get()
    return


@route_get('/api/health/report')
def _h_api_health_report_48(self, path, parsed):
    # 原 do_GET 分支（path == '/api/health/report'），机械搬家园
    self._handle_health_report_get()
    return


@route_get('/api/usage/tokens')
def _h_api_usage_tokens_49(self, path, parsed):
    # 原 do_GET 分支（path == '/api/usage/tokens'），机械搬家园
    import token_usage_stats
    qs = parse_qs(parsed.query)
    month = (qs.get('month') or [''])[0]
    days = (qs.get('days') or ['31'])[0]
    try:
        import token_usage_stats
        data = token_usage_stats.token_usage_summary(days)
        if month:
            data['month_detail'] = token_usage_stats.month_detail(month)
        self._send_json(data)
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_get('/api/usage/detail')
def _h_api_usage_detail_50(self, path, parsed):
    # 原 do_GET 分支（path == '/api/usage/detail'），机械搬家园
    import token_usage_stats
    qs = parse_qs(parsed.query)
    try:
        import token_usage_stats
        data = token_usage_stats.usage_detail(page=qs.get('page', ['1'])[0], page_size=qs.get('page_size', ['30'])[0], month=qs.get('month', [''])[0], model=qs.get('model', [''])[0], q=qs.get('q', [''])[0], range_=qs.get('range', [''])[0])
        self._send_json(data)
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_get('/api/agent/turns')
def _h_api_agent_turns_51(self, path, parsed):
    # 原 do_GET 分支（path == '/api/agent/turns'），机械搬家园
    from db import get_agent_turns
    qs = parse_qs(parsed.query)
    sid = (qs.get('session_id') or [''])[0]
    if not sid:
        self._send_json({'ok': False, 'err': 'missing session_id'}, 400)
        return
    try:
        from db import get_agent_turns
        rows = get_agent_turns(sid)
        self._send_json({'ok': True, 'session_id': sid, 'turns': rows})
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_get('/api/agent/monitor')
def _h_api_agent_monitor_52(self, path, parsed):
    # 原 do_GET 分支（path == '/api/agent/monitor'），机械搬家园
    from db import db_read
    qs = parse_qs(parsed.query)
    try:
        limit = min(max(int((qs.get('limit') or ['20'])[0]), 1), 200)
    except ValueError:
        limit = 20
    try:
        from db import db_read
        rows = db_read("\n                    SELECT session_id,\n                           COUNT(*) AS msg_count,\n                           SUM(CASE WHEN role='tool_call' OR role='tool' THEN 1 ELSE 0 END) AS tool_count,\n                           SUM(CASE WHEN role='error' THEN 1 ELSE 0 END) AS error_count,\n                           MAX(created_at) AS last_ts\n                    FROM agent_turns\n                    WHERE created_at > ?\n                    GROUP BY session_id\n                    ORDER BY last_ts DESC\n                    LIMIT ?", (int(time.time()) - 86400 * 7, limit))
        sessions = []
        now = int(time.time())
        for r in rows:
            sid = r['session_id']
            n, tools, errs = (r.get('msg_count') or 0, r.get('tool_count') or 0, r.get('error_count') or 0)
            last_ts = r.get('last_ts')
            last = db_read('SELECT role, content FROM agent_turns WHERE session_id=? ORDER BY id DESC LIMIT 1', (sid,), fetch='one')
            last_role = (last or {}).get('role', '')
            last_content = ((last or {}).get('content') or '')[:200]
            if last_role == 'error':
                status = 'error'
            elif last_role == 'assistant' and now - int(last_ts or 0) > 600:
                status = 'done'
            elif now - int(last_ts or 0) > 3600:
                status = 'stalled'
            else:
                status = 'running'
            sessions.append({'session_id': sid, 'status': status, 'msg_count': n or 0, 'tool_count': tools or 0, 'error_count': errs or 0, 'last_ts': last_ts, 'last_role': last_role, 'last_content': last_content})
        self._send_json({'ok': True, 'now': now, 'sessions': sessions})
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_get('/api/network_guard')
def _h_api_network_guard_53(self, path, parsed):
    # 原 do_GET 分支（path == '/api/network_guard'），机械搬家园
    self._handle_network_guard()
    return


@route_get('/api/briefing')
def _h_api_briefing_54(self, path, parsed):
    # 原 do_GET 分支（path == '/api/briefing'），机械搬家园
    from routes.mixin_briefing import handle_route as _brief
    from routes.mixin_briefing import handle_route as _brief
    _brief(self)
    return


@route_get('/api/backup_version')
def _h_api_backup_version_55(self, path, parsed):
    # 原 do_GET 分支（path == '/api/backup_version'），机械搬家园
    self._handle_backup_version()
    return


@route_get('/api/repair_inject_status')
def _h_api_repair_inject_status_56(self, path, parsed):
    # 原 do_GET 分支（path == '/api/repair_inject_status'），机械搬家园
    self._handle_repair_inject_status()
    return


@route_get('/api/updater/check')
def _h_api_updater_check_57(self, path, parsed):
    # 原 do_GET 分支（path == '/api/updater/check'），机械搬家园
    self._handle_updater_check()
    return


@route_get('/api/updater/config')
def _h_api_updater_config_58(self, path, parsed):
    # 原 do_GET 分支（path == '/api/updater/config'），机械搬家园
    self._handle_updater_config_get()
    return


@route_get('/api/version')
def _h_api_version_59(self, path, parsed):
    # 原 do_GET 分支（path == '/api/version'），机械搬家园
    self.do_GET_version()
    return


@route_get('/api/appdocs')
def _h_api_appdocs_60(self, path, parsed):
    # 原 do_GET 分支（path == '/api/appdocs'），机械搬家园
    self.get_appdocs()
    return


@route_get('/api/readme')
def _h_api_readme_60b(self, path, parsed):
    # 简介面板数据源：根目录 README 原文（docs/软件介绍.md 已并入 README，单文档维护）
    self.get_readme()
    return


@route_get('/api/workspace/list')
def _h_api_workspace_list_61(self, path, parsed):
    # 原 do_GET 分支（path == '/api/workspace/list'），机械搬家园
    self._handle_workspace_list()
    return


# 【2026-11-23 安全整改】/api/workspace/open-folder 写操作已迁 POST，原 GET 注册删除。


@route_get('/api/workspace/load')
def _h_api_workspace_load_63(self, path, parsed):
    # 原 do_GET 分支（path == '/api/workspace/load'），机械搬家园
    self._handle_workspace_load()
    return


# 【2026-11-23 安全整改】/api/app/restart、/api/app/quit 写操作走既有 POST 注册
# （domain_legacy_post.py:1335/1342，restart_server.py 升级链已用 POST），原 GET 注册删除。


@route_get('/api/pixel/display')
def _h_api_pixel_display_66(self, path, parsed):
    # 原 do_GET 分支（path == '/api/pixel/display'），机械搬家园
    self._handle_pixel_display_poll()
    return


@route_get('/api/pixel/export_gif')
def _h_api_pixel_export_gif_67(self, path, parsed):
    # 原 do_GET 分支（path == '/api/pixel/export_gif'），机械搬家园
    self._handle_pixel_export_gif()
    return


@route_get('/api/monitor/poll')
def _h_api_monitor_poll_68(self, path, parsed):
    # 原 do_GET 分支（path == '/api/monitor/poll'），机械搬家园
    self._handle_monitor_poll(parse_qs(parsed.query))
    return


@route_get('/api/employee/timers')
def _h_api_employee_timers_70(self, path, parsed):
    # 原 do_GET 分支（path == '/api/employee/timers'），机械搬家园
    from employee_scheduler import load_timers
    from employee_scheduler import load_timers
    self._send_json({'ok': True, 'timers': load_timers()})
    return


@route_get('/api/backup/list')
def _h_api_backup_list_71(self, path, parsed):
    # 原 do_GET 分支（path == '/api/backup/list'），机械搬家园
    self._handle_backup_list()
    return


# 【2026-11-23 安全整改】/api/backup/open-folder 写操作已迁 POST，原 GET 注册删除。


@route_get('/api/models/config')
def _h_api_models_config_73(self, path, parsed):
    # 原 do_GET 分支（path == '/api/models/config'），机械搬家园
    self._handle_models_config_get()
    return


@route_get('/api/hot-reload/sse')
def _h_api_hot_reload_sse_74(self, path, parsed):
    # 原 do_GET 分支（path == '/api/hot-reload/sse'），机械搬家园
    self._handle_hot_reload_sse()
    return


@route_get('/api/zf3d/status')
def _h_api_zf3d_status_75(self, path, parsed):
    # 原 do_GET 分支（path == '/api/zf3d/status'），机械搬家园
    self._handle_get_zf3d_status()
    return


@route_get('/api/zf3d/status')
def _h_api_zf3d_status_76(self, path, parsed):
    # 原 do_GET 分支（path == '/api/zf3d/status'），机械搬家园
    self._handle_zf3d_status()
    return


@route_get('/api/zf3d/site-config')
def _h_api_zf3d_site_config_77(self, path, parsed):
    # 原 do_GET 分支（path == '/api/zf3d/site-config'），机械搬家园
    self._handle_zf3d_site_config()
    return


@route_get('/api/zf3d/logo-img')
def _h_api_zf3d_logo_img_78(self, path, parsed):
    # 原 do_GET 分支（path == '/api/zf3d/logo-img'），机械搬家园
    self._handle_zf3d_logo_img()
    return


@route_get('/api/geo/ip')
def _h_api_geo_ip_79(self, path, parsed):
    # 原 do_GET 分支（path == '/api/geo/ip'），机械搬家园
    self._handle_geo_ip()
    return


@route_get('/api/geo/reverse')
def _h_api_geo_reverse_80(self, path, parsed):
    # 原 do_GET 分支（path == '/api/geo/reverse'），机械搬家园
    self._handle_geo_reverse(parse_qs(parsed.query))
    return


@route_get('/api/zf3d/ai-balance')
def _h_api_zf3d_ai_balance_81(self, path, parsed):
    # 原 do_GET 分支（path == '/api/zf3d/ai-balance'），机械搬家园
    self._handle_zf3d_ai_balance()
    return


@route_get('/api/zf3d/heartbeat-status')
def _h_api_zf3d_heartbeat_status_82(self, path, parsed):
    # 原 do_GET 分支（path == '/api/zf3d/heartbeat-status'），机械搬家园
    self._handle_zf3d_heartbeat_status()
    return


@route_get('/api/zf3d/ai-token')
def _h_api_zf3d_ai_token_83(self, path, parsed):
    # 原 do_GET 分支（path == '/api/zf3d/ai-token'），机械搬家园
    self._handle_zf3d_ai_token()
    return


@route_get('/api/zf3d/identity-ticket')
def _h_api_zf3d_identity_ticket_84(self, path, parsed):
    # 原 do_GET 分支（path == '/api/zf3d/identity-ticket'），机械搬家园
    self._handle_zf3d_identity_ticket()
    return


@route_get('/api/zf3d/remote_sync')
def _h_api_zf3d_remote_sync_85(self, path, parsed):
    # 原 do_GET 分支（path == '/api/zf3d/remote_sync'），机械搬家园
    self._handle_zf3d_remote_sync(parse_qs(parsed.query))
    return


@route_get('/api/zf3d/remote/sessions')
def _h_api_zf3d_remote_sessions_86(self, path, parsed):
    # 原 do_GET 分支（path == '/api/zf3d/remote/sessions'），机械搬家园
    self._handle_remote_sessions(parse_qs(parsed.query))
    return


@route_get('/api/zf3d/remote/history')
def _h_api_zf3d_remote_history_87(self, path, parsed):
    # 原 do_GET 分支（path == '/api/zf3d/remote/history'），机械搬家园
    self._handle_remote_history(parse_qs(parsed.query))
    return


@route_get('/api/zf3d/remote/chat_status')
def _h_api_zf3d_remote_chat_status_88(self, path, parsed):
    # 原 do_GET 分支（path == '/api/zf3d/remote/chat_status'），机械搬家园
    self._handle_remote_chat_status(parse_qs(parsed.query))
    return


@route_get('/api/zf3d/remote/chat_pull')
def _h_api_zf3d_remote_chat_pull_89(self, path, parsed):
    # 原 do_GET 分支（path == '/api/zf3d/remote/chat_pull'），机械搬家园
    self._handle_remote_chat_pull(parse_qs(parsed.query))
    return


@route_get('/api/update-status')
def _h_api_update_status_90(self, path, parsed):
    # 原 do_GET 分支（path == '/api/update-status'），机械搬家园
    self._handle_get_update_status()
    return


@route_get('/api/hot-reload/status')
def _h_api_hot_reload_status_91(self, path, parsed):
    # 原 do_GET 分支（path == '/api/hot-reload/status'），机械搬家园
    self._handle_hot_reload_status()
    return


@route_get('/api/loop-mode-config')
def _h_api_loop_mode_config_92(self, path, parsed):
    # 原 do_GET 分支（path == '/api/loop-mode-config'），机械搬家园
    if self.command == 'POST':
        self._handle_loop_mode_config_post()
    else:
        self._handle_loop_mode_config_get()
    return


@route_get('/api/engines')
def _h_api_engines_93(self, path, parsed):
    # 原 do_GET 分支（path == '/api/engines'），机械搬家园
    import engines_loader
    try:
        import engines_loader
        self._send_json({'ok': True, 'engines': engines_loader.summary()})
    except Exception as e:
        log.info('[GET /api/engines] 500: %s' % e)
        self._send_json({'ok': False, 'engines': []}, 500)
    return


@route_get('/api/modes')
def _h_api_modes_94(self, path, parsed):
    # 原 do_GET 分支（path == '/api/modes'），机械搬家园
    import mode_loader
    try:
        import mode_loader
        self._send_json({'ok': True, 'modes': mode_loader.summary()})
    except Exception as e:
        log.info('[GET /api/modes] 500: %s' % e)
        self._send_json({'ok': False, 'modes': []}, 500)
    return


# 【2026-11-23 安全整改】/api/refboard-save 写操作走既有 POST 注册
# （domain_legacy_post.py:1370，前端 app-medianode-x.js 已用 POST），原 GET 注册删除。


@route_get('/api/refboard-load')
def _h_api_refboard_load_96(self, path, parsed):
    # 原 do_GET 分支（path == '/api/refboard-load'），机械搬家园
    self._handle_refboard_load()
    return


@route_get('/api/fs/ops')
def _h_api_fs_ops_97(self, path, parsed):
    # 原 do_GET 分支（path == '/api/fs/ops'），机械搬家园
    self._handle_fs_ops()
    return


@route_get('/api/chat-mode-rules')
def _h_api_chat_mode_rules_98(self, path, parsed):
    # 原 do_GET 分支（path == '/api/chat-mode-rules'），机械搬家园
    if self.command == 'POST':
        self._handle_chat_mode_rules_post()
    else:
        self._handle_chat_mode_rules_get()
    return


@route_get('/api/tool-result-limits')
def _h_api_tool_result_limits_99(self, path, parsed):
    # 原 do_GET 分支（path == '/api/tool-result-limits'），机械搬家园
    if self.command == 'POST':
        self._handle_tool_result_limits_post()
    else:
        self._handle_tool_result_limits_get()
    return


@route_get('/api/user-settings')
def _h_api_user_settings_100(self, path, parsed):
    # 原 do_GET 分支（path == '/api/user-settings'），机械搬家园
    if self.command == 'POST':
        self._handle_user_settings_post()
    else:
        self._handle_user_settings_get()
    return


@route_get('/api/chat-attachments')
def _h_api_chat_attachments_101(self, path, parsed):
    # 原 do_GET 分支（path == '/api/chat-attachments'），机械搬家园
    self._handle_chat_attachments_get(parse_qs(parsed.query))
    return


@route_get('/api/background')
def _h_api_background_102(self, path, parsed):
    # 原 do_GET 分支（path == '/api/background'），机械搬家园
    if self.command == 'POST':
        self._handle_background_post()
    else:
        self._handle_background_get()
    return


@route_get('/api/macro-lib')
def _h_api_macro_lib_103(self, path, parsed):
    # 原 do_GET 分支（path == '/api/macro-lib'），机械搬家园
    if self.command == 'POST':
        self._handle_macro_lib_post()
    else:
        self._handle_macro_lib_get()
    return


@route_get('/api/pyconsole/history')
def _h_api_pyconsole_history_104(self, path, parsed):
    # 原 do_GET 分支（path == '/api/pyconsole/history'），机械搬家园
    self._handle_pyconsole_history()
    return


@route_get('/api/user-tools')
def _h_api_user_tools_105(self, path, parsed):
    # 原 do_GET 分支（path == '/api/user-tools'），机械搬家园
    if self.command == 'POST':
        self._handle_user_tools_post()
    else:
        self._handle_user_tools_get()
    return


@route_get('/api/user-preferences')
def _h_api_user_preferences_106(self, path, parsed):
    # 原 do_GET 分支（path == '/api/user-preferences'），机械搬家园
    if self.command == 'POST':
        self._handle_user_preferences_post()
    else:
        self._handle_user_preferences_get()
    return


@route_get('/api/worklog')
def _h_api_worklog_107(self, path, parsed):
    # 原 do_GET 分支（path == '/api/worklog'），机械搬家园
    self._handle_worklog_get()
    return


@route_get('/api/config/export')
def _h_api_config_export_108(self, path, parsed):
    # 原 do_GET 分支（path == '/api/config/export'），机械搬家园
    self._handle_config_export()
    return


@route_get('/api/workbench/tools')
def _h_api_workbench_tools_109(self, path, parsed):
    # 原 do_GET 分支（path == '/api/workbench/tools'），机械搬家园
    self._handle_wb_tools_list()
    return


@route_get('/api/workbench/state')
def _h_api_workbench_state_110(self, path, parsed):
    # 原 do_GET 分支（path == '/api/workbench/state'），机械搬家园
    self._handle_wb_state_get()
    return


@route_get('/api/workbench/gallery')
def _h_api_workbench_gallery_111(self, path, parsed):
    # 原 do_GET 分支（path == '/api/workbench/gallery'），机械搬家园
    self._handle_wb_gallery_get()
    return


@route_get('/api/workbench/thumb')
def _h_api_workbench_thumb_112(self, path, parsed):
    # 原 do_GET 分支（path == '/api/workbench/thumb'），机械搬家园
    self._handle_wb_thumb_get(parsed.query)
    return


@route_get('/api/config-agent/memory')
def _h_api_config_agent_memory_113(self, path, parsed):
    # 原 do_GET 分支（path == '/api/config-agent/memory'），机械搬家园
    if self.command == 'POST':
        self._handle_config_agent_memory_post()
    else:
        self._handle_config_agent_memory_get()
    return


@route_get('/api/user/brief')
def _h_api_user_brief_114(self, path, parsed):
    # 原 do_GET 分支（path == '/api/user/brief'），机械搬家园
    self._handle_user_brief()
    return


@route_get('/api/table-viewer')
def _h_api_table_viewer_115(self, path, parsed):
    # 原 do_GET 分支（path == '/api/table-viewer'），机械搬家园
    self._handle_table_viewer_get(parsed.query)
    return


@route_get('/api/schedule')
def _h_api_schedule_116(self, path, parsed):
    # 原 do_GET 分支（path == '/api/schedule'），机械搬家园
    self._handle_schedule_get(parsed.query)
    return


@route_get('/api/webproxy')
def _h_api_webproxy_117(self, path, parsed):
    # 原 do_GET 分支（path == '/api/webproxy'），机械搬家园
    self._handle_webproxy('GET')
    return


@route_get('/api/webproxy_sync_cookies')
def _h_api_webproxy_sync_cookies_118(self, path, parsed):
    # 原 do_GET 分支（path == '/api/webproxy_sync_cookies'），机械搬家园
    self._handle_webproxy_cookie_sync(parsed.query)
    return


@route_get('/api/browser')
def _h_api_browser_119(self, path, parsed):
    # 原 do_GET 分支（path == '/api/browser'），机械搬家园
    self._handle_browser_get(parsed.query)
    return


@route_get('/api/demo/list')
def _h_api_demo_list_120(self, path, parsed):
    # 原 do_GET 分支（path == '/api/demo/list'），机械搬家园
    self._handle_demo_list()
    return


@route_get('/api/demo/get')
def _h_api_demo_get_121(self, path, parsed):
    # 原 do_GET 分支（path == '/api/demo/get'），机械搬家园
    self._handle_demo_get(parse_qs(parsed.query))
    return


@route_get('/api/novel/list')
def _h_api_novel_list_122(self, path, parsed):
    # 原 do_GET 分支（path == '/api/novel/list'），机械搬家园
    self._handle_novel_list()
    return


@route_get('/api/novel/get')
def _h_api_novel_get_123(self, path, parsed):
    # 原 do_GET 分支（path == '/api/novel/get'），机械搬家园
    self._handle_novel_get(parse_qs(parsed.query))
    return


@route_get('/api/novel/progress')
def _h_api_novel_progress_124(self, path, parsed):
    # 原 do_GET 分支（path == '/api/novel/progress'），机械搬家园
    self._handle_novel_progress_get()
    return


@route_get('/api/novel/import/catalog')
def _h_api_novel_import_catalog_125(self, path, parsed):
    # 原 do_GET 分支（path == '/api/novel/import/catalog'），机械搬家园
    self._handle_novel_import_catalog()
    return


@route_get('/api/novel/token')
def _h_api_novel_token_126(self, path, parsed):
    # 原 do_GET 分支（path == '/api/novel/token'），机械搬家园
    self._handle_novel_token()
    return


@route_get('/api/novel/search')
def _h_api_novel_search_127(self, path, parsed):
    # 原 do_GET 分支（path == '/api/novel/search'），机械搬家园
    self._handle_novel_search(parse_qs(parsed.query))
    return


@route_get('/api/ivideo/sites')
def _h_api_ivideo_sites_128(self, path, parsed):
    # 原 do_GET 分支（path == '/api/ivideo/sites'），机械搬家园
    self._handle_ivideo_sites()
    return


@route_get('/api/ivideo/search')
def _h_api_ivideo_search_129(self, path, parsed):
    # 原 do_GET 分支（path == '/api/ivideo/search'），机械搬家园
    self._handle_ivideo_search(parse_qs(parsed.query))
    return


@route_get('/api/ivideo/detail')
def _h_api_ivideo_detail_130(self, path, parsed):
    # 原 do_GET 分支（path == '/api/ivideo/detail'），机械搬家园
    self._handle_ivideo_detail(parse_qs(parsed.query))
    return


@route_get('/api/ivideo/proxy')
def _h_api_ivideo_proxy_131(self, path, parsed):
    # 原 do_GET 分支（path == '/api/ivideo/proxy'），机械搬家园
    self._handle_ivideo_proxy(parse_qs(parsed.query))
    return


@route_get('/api/ivideo/progress')
def _h_api_ivideo_progress_132(self, path, parsed):
    # 原 do_GET 分支（path == '/api/ivideo/progress'），机械搬家园
    self._handle_ivideo_progress(parse_qs(parsed.query))
    return


@route_get('/api/ivideo/bili/search')
def _h_api_ivideo_bili_search_133(self, path, parsed):
    # 原 do_GET 分支（path == '/api/ivideo/bili/search'），机械搬家园
    self._handle_ivideo_bili_search(parse_qs(parsed.query))
    return


@route_get('/api/ivideo/bili/play')
def _h_api_ivideo_bili_play_134(self, path, parsed):
    # 原 do_GET 分支（path == '/api/ivideo/bili/play'），机械搬家园
    self._handle_ivideo_bili_play(parse_qs(parsed.query))
    return


@route_get('/api/iimage/sites')
def _h_api_iimage_sites_135(self, path, parsed):
    # 原 do_GET 分支（path == '/api/iimage/sites'），机械搬家园
    self._handle_iimage_sites()
    return


@route_get('/api/iimage/search')
def _h_api_iimage_search_136(self, path, parsed):
    # 原 do_GET 分支（path == '/api/iimage/search'），机械搬家园
    self._handle_iimage_search(parse_qs(parsed.query))
    return


@route_get('/api/iimage/proxy')
def _h_api_iimage_proxy_137(self, path, parsed):
    # 原 do_GET 分支（path == '/api/iimage/proxy'），机械搬家园
    self._handle_iimage_proxy(parse_qs(parsed.query))
    return


@route_get('/api/iimage/favs')
def _h_api_iimage_favs_138(self, path, parsed):
    # 原 do_GET 分支（path == '/api/iimage/favs'），机械搬家园
    self._handle_iimage_favs_get()
    return


@route_get('/api/idol/list')
def _h_api_idol_list_139(self, path, parsed):
    # 原 do_GET 分支（path == '/api/idol/list'），机械搬家园
    self._handle_idol_list()
    return


@route_get('/api/idol/detail')
def _h_api_idol_detail_140(self, path, parsed):
    # 原 do_GET 分支（path == '/api/idol/detail'），机械搬家园
    self._handle_idol_detail(parse_qs(parsed.query))
    return


@route_get('/api/idol/file')
def _h_api_idol_file_141(self, path, parsed):
    # 原 do_GET 分支（path == '/api/idol/file'），机械搬家园
    self._handle_idol_file(parse_qs(parsed.query))
    return


@route_get('/api/iauth/sites')
def _h_api_iauth_sites_142(self, path, parsed):
    # 原 do_GET 分支（path == '/api/iauth/sites'），机械搬家园
    self._handle_iauth_sites()
    return


# 【2026-11-23 安全整改】/api/escape/new 开新局写操作已迁 POST（domain_legacy_post.py，
# difficulty 走 JSON body），原 GET 注册删除。


@route_get('/api/webmarks')
def _h_api_webmarks_144(self, path, parsed):
    # 原 do_GET 分支（path == '/api/webmarks'），机械搬家园
    self._handle_webmarks_get()
    return


@route_get('/api/webpage/fetch')
def _h_api_webpage_fetch_145(self, path, parsed):
    # 原 do_GET 分支（path == '/api/webpage/fetch'），机械搬家园
    self._handle_webpage_fetch(parse_qs(parsed.query))
    return


@route_get('/api/sheets/list')
def _h_api_sheets_list_146(self, path, parsed):
    # 原 do_GET 分支（path == '/api/sheets/list'），机械搬家园
    self._handle_docs_list('sheets')
    return


@route_get('/api/sheets/get')
def _h_api_sheets_get_147(self, path, parsed):
    # 原 do_GET 分支（path == '/api/sheets/get'），机械搬家园
    self._handle_docs_get('sheets', parse_qs(parsed.query))
    return


@route_get('/api/docs/list')
def _h_api_docs_list_148(self, path, parsed):
    # 原 do_GET 分支（path == '/api/docs/list'），机械搬家园
    self._handle_docs_list('docs')
    return


@route_get('/api/docs/get')
def _h_api_docs_get_149(self, path, parsed):
    # 原 do_GET 分支（path == '/api/docs/get'），机械搬家园
    self._handle_docs_get('docs', parse_qs(parsed.query))
    return


@route_get('/api/minds/list')
def _h_api_minds_list_150(self, path, parsed):
    # 原 do_GET 分支（path == '/api/minds/list'），机械搬家园
    self._handle_docs_list('minds')
    return


@route_get('/api/minds/get')
def _h_api_minds_get_151(self, path, parsed):
    # 原 do_GET 分支（path == '/api/minds/get'），机械搬家园
    self._handle_docs_get('minds', parse_qs(parsed.query))
    return


@route_get('/api/psds/list')
def _h_api_psds_list_152(self, path, parsed):
    # 原 do_GET 分支（path == '/api/psds/list'），机械搬家园
    self._handle_docs_list('psds')
    return


@route_get('/api/psds/get')
def _h_api_psds_get_153(self, path, parsed):
    # 原 do_GET 分支（path == '/api/psds/get'），机械搬家园
    self._handle_docs_get('psds', parse_qs(parsed.query))
    return


@route_get('/api/boards/list')
def _h_api_boards_list_154(self, path, parsed):
    # 原 do_GET 分支（path == '/api/boards/list'），机械搬家园
    self._handle_docs_list('boards')
    return


@route_get('/api/boards/get')
def _h_api_boards_get_155(self, path, parsed):
    # 原 do_GET 分支（path == '/api/boards/get'），机械搬家园
    self._handle_docs_get('boards', parse_qs(parsed.query))
    return


@route_get('/api/applock/status')
def _h_api_applock_status_156(self, path, parsed):
    # 原 do_GET 分支（path == '/api/applock/status'），机械搬家园
    qs = parse_qs(parsed.query)
    self._send_json(self._handle_applock_status((qs.get('app') or ['manga'])[0]))
    return


@route_get('/api/applock/check')
def _h_api_applock_check_157(self, path, parsed):
    # 原 do_GET 分支（path == '/api/applock/check'），机械搬家园
    qs = parse_qs(parsed.query)
    self._send_json(self._handle_applock_check((qs.get('app') or ['manga'])[0]))
    return


@route_get('/api/comics/sources')
def _h_api_comics_sources_158(self, path, parsed):
    # 原 do_GET 分支（path == '/api/comics/sources'），机械搬家园
    self._handle_comics_sources()
    return


@route_get('/api/comics/list')
def _h_api_comics_list_159(self, path, parsed):
    # 原 do_GET 分支（path == '/api/comics/list'），机械搬家园
    self._handle_comics_list(parse_qs(parsed.query))
    return


@route_get('/api/comics/chapters')
def _h_api_comics_chapters_160(self, path, parsed):
    # 原 do_GET 分支（path == '/api/comics/chapters'），机械搬家园
    self._handle_comics_chapters(parse_qs(parsed.query))
    return


@route_get('/api/comics/pages')
def _h_api_comics_pages_161(self, path, parsed):
    # 原 do_GET 分支（path == '/api/comics/pages'），机械搬家园
    self._handle_comics_pages(parse_qs(parsed.query))
    return


@route_get('/api/comics/img')
def _h_api_comics_img_162(self, path, parsed):
    # 原 do_GET 分支（path == '/api/comics/img'），机械搬家园
    self._handle_comics_img(parse_qs(parsed.query))
    return


@route_get('/api/comics/proxy')
def _h_api_comics_proxy_163(self, path, parsed):
    # 原 do_GET 分支（path == '/api/comics/proxy'），机械搬家园
    self._handle_comics_proxy(parse_qs(parsed.query))
    return


@route_get('/api/news/list')
def _h_api_news_list_164(self, path, parsed):
    # 原 do_GET 分支（path == '/api/news/list'），机械搬家园
    self._handle_news_list(parse_qs(parsed.query))
    return


@route_get('/api/iapp/dispatch')
def _h_api_iapp_dispatch_165(self, path, parsed):
    # 原 do_GET 分支（path == '/api/iapp/dispatch'），机械搬家园
    self._handle_iapp_dispatch(parse_qs(parsed.query))
    return


@route_get('/api/comics/progress')
def _h_api_comics_progress_166(self, path, parsed):
    # 原 do_GET 分支（path == '/api/comics/progress'），机械搬家园
    self._handle_comics_progress_get()
    return


@route_get('/api/hw/info')
def _h_api_hw_info_167(self, path, parsed):
    # 原 do_GET 分支（path == '/api/hw/info'），机械搬家园
    self._handle_hw_info()
    return


@route_get('/api/hw/live')
def _h_api_hw_live_168(self, path, parsed):
    # 原 do_GET 分支（path == '/api/hw/live'），机械搬家园
    self._handle_hw_live()
    return


@route_get('/api/hw/extra')
def _h_api_hw_extra_169(self, path, parsed):
    # 原 do_GET 分支（path == '/api/hw/extra'），机械搬家园
    self._handle_hw_extra()
    return


@route_get('/api/tvproxy')
def _h_api_tvproxy_170(self, path, parsed):
    # 原 do_GET 分支（path == '/api/tvproxy'），机械搬家园
    self._handle_tvproxy_get()
    return


@route_get('/api/tv/status')
def _h_api_tv_status_171(self, path, parsed):
    # 原 do_GET 分支（path == '/api/tv/status'），机械搬家园
    self._handle_tv_status()
    return


# 【2026-11-23 安全整改】/api/tv/refresh 触发拉取类操作已迁 POST，原 GET 注册删除。


@route_get('/api/notes')
def _h_api_notes_173(self, path, parsed):
    # 原 do_GET 分支（path == '/api/notes'），机械搬家园
    self._handle_notes_get()
    return


@route_get('/api/home/devices')
def _h_api_home_devices_174(self, path, parsed):
    # 原 do_GET 分支（path == '/api/home/devices'），机械搬家园
    self._handle_ihome_get()
    return


# 【2026-11-23 安全整改】/api/iapp/event 走既有 POST 注册（domain_legacy_post.py:50，
# 前端 zf-app-dock.js 已用 POST），原 GET 注册删除。/api/iapp/dispatch 的"GET 读 +
# POST 写"协议保留不动（AI 工具链 iapp_tools.py 依赖）；confirmed 仅由 syscall
# 人工审批通道供值，请求自填值被忽略（iapp_tools 统一确认原语）。


@route_get('/api/iapp/activity')
def _h_api_iapp_activity_176(self, path, parsed):
    # 原 do_GET 分支（path == '/api/iapp/activity'），机械搬家园
    self._handle_iapp_activity(parse_qs(parsed.query))
    return


@route_get('/api/iapp/cmds')
def _h_api_iapp_cmds_177(self, path, parsed):
    # 原 do_GET 分支（path == '/api/iapp/cmds'），机械搬家园
    self._handle_iapp_cmds_get(parse_qs(parsed.query))
    return


@route_get(['/api/games/featured', '/api/games/free', '/api/games/search', '/api/games/detail', '/api/games/list'])
def _h_api_games_featured_178(self, path, parsed):
    # 原 do_GET 分支（path == '/api/games/featured' or path == '/api/games/free' or path == '/api/games/search' or path == '/api/games/detail' or path == '/api/games/list'），机械搬家园
    self._handle_games_get()
    return


@route_get('/api/comics/download/status')
def _h_api_comics_download_status_179(self, path, parsed):
    # 原 do_GET 分支（path == '/api/comics/download/status'），机械搬家园
    import comics_download as dl
    import comics_download as dl
    dl.load_state()
    self._send_json({'ok': True, 'tasks': dl.status()})
    return


@route_get('/api/convert/status')
def _h_api_convert_status_180(self, path, parsed):
    # 原 do_GET 分支（path == '/api/convert/status'），机械搬家园
    self._handle_convert_status()
    return


@route_get('/api/pathguard/status')
def _h_api_pathguard_status_181(self, path, parsed):
    # 原 do_GET 分支（path == '/api/pathguard/status'），机械搬家园
    from tools.coding.backend import _pathguard as _pg
    from tools.coding.backend import _pathguard as _pg
    self._send_json({'ok': True, 'status': _pg.status()})
    return


@route_get('/api/video/stream')
def _h_api_video_stream_182(self, path, parsed):
    # 原 do_GET 分支（path == '/api/video/stream'），机械搬家园
    self._handle_video_stream(parsed)
    return

