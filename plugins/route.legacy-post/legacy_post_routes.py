# -*- coding: utf-8 -*-
"""自动生成（server/tools/split_dispatch.py 机械拆分）：routes\api_dispatch_post.py 的
以 return 结尾精确 path 分支，逐支注册进路由注册表。

纯搬家：函数体来自原 if 分支逐行 dedent，未改任何语句；
重新生成会整体覆盖本文件。"""

from routes.dispatcher import route_post
from routes.api_dispatch_post import _make_tool_cap  # 20261123 补：拆分时丢失的工具能力构造器

# 公共 stdlib 兜底（机械迁移分支常用名；未被使用也无副作用）
import json
from urllib.parse import parse_qs, urlparse


@route_post('/api/plaza/upload')
def _h_api_plaza_upload_1(self, path, parsed):
    # 原 do_POST 分支（path == '/api/plaza/upload'），机械搬家园
    from plaza.upload import handle_plaza_upload
    from plaza.upload import handle_plaza_upload
    handle_plaza_upload(self)
    return


@route_post('/api/hw/driver-open')
def _h_api_hw_driver_open_2(self, path, parsed):
    # 原 do_POST 分支（path == '/api/hw/driver-open'），机械搬家园
    self._handle_hw_driver_open()
    return


@route_post('/api/notes')
def _h_api_notes_3(self, path, parsed):
    # 原 do_POST 分支（path == '/api/notes'），机械搬家园
    try:
        body = self._read_body() or {}
    except Exception:
        body = {}
    self._handle_notes_post(body)
    return


@route_post('/api/iapp/event')
def _h_api_iapp_event_4(self, path, parsed):
    # 原 do_POST 分支（path == '/api/iapp/event'），机械搬家园
    try:
        body = self._read_body() or {}
    except Exception:
        body = {}
    self._handle_iapp_event(qs=parse_qs(parsed.query), body=body)
    return


@route_post('/api/iapp/cmd')
def _h_api_iapp_cmd_5(self, path, parsed):
    # 原 do_POST 分支（path == '/api/iapp/cmd'），机械搬家园
    try:
        body = self._read_body() or {}
    except Exception:
        body = {}
    self._handle_iapp_cmd_post(qs=parse_qs(parsed.query), body=body)
    return


@route_post('/api/home/devices')
def _h_api_home_devices_6(self, path, parsed):
    # 原 do_POST 分支（path == '/api/home/devices'），机械搬家园
    try:
        body = self._read_body() or {}
    except Exception:
        body = {}
    self._handle_ihome_post(body)
    return


@route_post('/api/home/control')
def _h_api_home_control_7(self, path, parsed):
    # 原 do_POST 分支（path == '/api/home/control'），机械搬家园
    try:
        body = self._read_body() or {}
    except Exception:
        body = {}
    self._handle_ihome_control(body)
    return


@route_post('/api/games/list')
def _h_api_games_list_8(self, path, parsed):
    # 原 do_POST 分支（path == '/api/games/list'），机械搬家园
    try:
        body = self._read_body() or {}
    except Exception:
        body = {}
    self._handle_games_post(body)
    return


@route_post('/api/plaza/authticket')
def _h_api_plaza_authticket_9(self, path, parsed):
    # 原 do_POST 分支（path == '/api/plaza/authticket'），机械搬家园
    from plaza.authticket import handle_plaza_authticket
    from plaza.authticket import handle_plaza_authticket
    handle_plaza_authticket(self)
    return


@route_post('/api/ui-sync/emit')
def _h_api_ui_sync_emit_10(self, path, parsed):
    # 原 do_POST 分支（path == '/api/ui-sync/emit'），机械搬家园
    import ui_sync
    try:
        body = self._read_body() or {}
        import ui_sync
        ui_sync.broadcast(str(body.get('type') or 'db:changed')[:64], key=str(body.get('key') or '')[:128], data=body.get('data') or {}, cid=str(body.get('cid') or '')[:64], debounce=0.3)
        self._send_json({'ok': True})
    except Exception as e:
        self._send_json({'ok': False, 'error': str(e)}, 500)
    return


@route_post('/api/growth/checkin')
def _h_api_growth_checkin_11(self, path, parsed):
    # 原 do_POST 分支（path == '/api/growth/checkin'），机械搬家园
    self._handle_growth_checkin()
    return


@route_post('/api/fengkong/send')
def _h_api_fengkong_send_12(self, path, parsed):
    # 原 do_POST 分支（path == '/api/fengkong/send'），机械搬家园
    import json as _json
    import json as _json
    try:
        body = _json.loads(self._cached_body(int(self.headers.get('Content-Length') or 0)) or b'{}')
    except Exception:
        body = {}
    self._handle_fk_send(body)
    return


@route_post('/api/fengkong/upload')
def _h_api_fengkong_upload_13(self, path, parsed):
    # 原 do_POST 分支（path == '/api/fengkong/upload'），机械搬家园
    try:
        clen = int(self.headers.get('Content-Length') or 0)
    except ValueError:
        clen = 0
    if clen <= 0 or clen > 200 * 1024 * 1024:
        self._send_json({'ok': False, 'error': 'bad size'}, 400)
        return
    self._handle_fk_upload(self._cached_body(clen))
    return


@route_post('/api/workbench/tools')
def _h_api_workbench_tools_14(self, path, parsed):
    # 原 do_POST 分支（path == '/api/workbench/tools'），机械搬家园
    self._handle_wb_tools_list()
    return


@route_post('/api/workbench/tools/apply')
def _h_api_workbench_tools_apply_15(self, path, parsed):
    # 原 do_POST 分支（path == '/api/workbench/tools/apply'），机械搬家园
    self._handle_wb_tools_apply(self._read_body())
    return


@route_post('/api/pathguard/approve')
def _h_api_pathguard_approve_16(self, path, parsed):
    # 原 do_POST 分支（path == '/api/pathguard/approve'），机械搬家园
    from tools.coding.backend import _pathguard as _pg
    body = self._read_body() or {}
    from tools.coding.backend import _pathguard as _pg
    r = _pg.approve(body.get('path', ''), bool(body.get('permanent')))
    self._send_json({'ok': True, 'result': r})
    return


@route_post('/api/pathguard/revoke')
def _h_api_pathguard_revoke_17(self, path, parsed):
    # 原 do_POST 分支（path == '/api/pathguard/revoke'），机械搬家园
    from tools.coding.backend import _pathguard as _pg
    body = self._read_body() or {}
    from tools.coding.backend import _pathguard as _pg
    r = _pg.revoke(body.get('path'))
    self._send_json({'ok': True, 'result': r})
    return


@route_post('/api/workbench/state')
def _h_api_workbench_state_18(self, path, parsed):
    # 原 do_POST 分支（path == '/api/workbench/state'），机械搬家园
    self._handle_wb_state_post(self._read_body())
    return


@route_post('/api/perf-log')
def _h_api_perf_log_19(self, path, parsed):
    # 原 do_POST 分支（path == '/api/perf-log'），机械搬家园
    self._handle_perf_log_post()
    return


@route_post('/api/agent/protocol')
def _h_api_agent_protocol_20(self, path, parsed):
    # 原 do_POST 分支（path == '/api/agent/protocol'），机械搬家园
    self._handle_agent_protocol_post()
    return


@route_post('/api/supervisor')
def _h_api_supervisor_21(self, path, parsed):
    # 原 do_POST 分支（path == '/api/supervisor'），机械搬家园
    self._handle_supervisor_post()
    return


@route_post('/api/agent/protocol/probe')
def _h_api_agent_protocol_probe_22(self, path, parsed):
    # 原 do_POST 分支（path == '/api/agent/protocol/probe'），机械搬家园
    self._handle_agent_protocol_probe()
    return


@route_post('/api/roles')
def _h_api_roles_23(self, path, parsed):
    # 原 do_POST 分支（path == '/api/roles'），机械搬家园
    self._handle_roles_post()
    return


@route_post('/api/workbench/widgets')
def _h_api_workbench_widgets_24(self, path, parsed):
    # 原 do_POST 分支（path == '/api/workbench/widgets'），机械搬家园
    import workbench_panel as _wp
    try:
        import workbench_panel as _wp
        body = self._read_body() or {}
        _pid = str((body or {}).get('project') or 'default')
        _op = str((body or {}).get('op') or 'add')
        if _op == 'add':
            w = _wp.add_widget(_pid, (body or {}).get('widget') or {})
            self._send_json({'ok': True, 'widget': w})
        elif _op == 'update':
            w = _wp.update_widget(_pid, str((body or {}).get('id') or ''), (body or {}).get('patch') or {})
            self._send_json({'ok': True, 'widget': w})
        elif _op == 'delete':
            _wp.delete_widget(_pid, str((body or {}).get('id') or ''))
            self._send_json({'ok': True})
        else:
            self._send_json({'ok': False, 'err': '未知 op: %s' % _op}, 400)
    except ValueError as e:
        self._send_json({'ok': False, 'err': str(e)}, 400)
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_post('/api/employee/timers')
def _h_api_employee_timers_25(self, path, parsed):
    # 原 do_POST 分支（path == '/api/employee/timers'），机械搬家园
    import employee_scheduler as es
    try:
        import employee_scheduler as es
        body = self._read_body() or {}
        op = str(body.get('op') or '')
        if op == 'add':
            name = str(body.get('name') or '').strip()
            prompt = str(body.get('task_prompt') or '').strip()
            sch = body.get('schedule') or {}
            if not name or not prompt or (not isinstance(sch, dict)) or (sch.get('type') not in ('daily', 'interval', 'once', 'weekly')):
                self._send_json({'ok': False, 'err': '参数不合法（需 name/task_prompt/schedule.type=daily|interval|once|weekly）'}, 400)
                return
            if sch.get('type') == 'interval':
                try:
                    sec = int(sch.get('seconds') or 0)
                except Exception:
                    sec = 0
                if sec < es.MIN_INTERVAL_SECONDS:
                    self._send_json({'ok': False, 'err': 'interval 最小 %d 秒' % es.MIN_INTERVAL_SECONDS}, 400)
                    return
            if sch.get('type') == 'daily' and (not sch.get('time')):
                self._send_json({'ok': False, 'err': 'daily 需 time=HH:MM'}, 400)
                return
            if sch.get('type') == 'once' and (not sch.get('at')) and (not sch.get('delay_minutes')):
                self._send_json({'ok': False, 'err': 'once 需 at=YYYY-MM-DD HH:MM 或 delay_minutes'}, 400)
                return
            if sch.get('type') == 'weekly' and ((not sch.get('time')) or ('weekday' not in sch)):
                self._send_json({'ok': False, 'err': 'weekly 需 time=HH:MM + weekday(0=周一..6=周日)'}, 400)
                return
            tid = es.add_timer(name, str(body.get('box_id') or '').strip(), prompt, sch, enabled=bool(body.get('enabled', True)))
            self._send_json({'ok': True, 'id': tid})
        elif op in ('enable', 'disable'):
            self._send_json({'ok': es.set_enabled(str(body.get('id') or ''), op == 'enable')})
        elif op == 'remove':
            self._send_json({'ok': es.remove_timer(str(body.get('id') or ''))})
        else:
            self._send_json({'ok': False, 'err': '未知 op: %s' % op}, 400)
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_post('/api/webhook/trigger')
def _h_api_webhook_trigger_25b(self, path, parsed):
    """B4 Webhook 触发：外部 HTTP 回调 → 投递员工定时器式注入（复用 monitor_queue 链路）。
    安全基线（免疫卡009 教训）：默认仅本机回环 127.0.0.1/::1；
    对外启用须显式配置 config.webhook_external=true 且带 token 校验（X-Webhook-Token
    与 config.webhook_token 一致），二者缺一即 403，不做任何来源白名单/鉴权旁路。
    body: {employee, prompt, delay_minutes?}"""
    import employee_scheduler as es
    try:
        host = (self.client_address[0] if getattr(self, 'client_address', None) else '')
        if host not in ('127.0.0.1', '::1', 'localhost'):
            # 对外开关：默认关闭；显式 webhook_external=true 才放行非回环，且必须配 token
            _ext, _tok = False, ''
            try:
                import config as _cfg
                _ext = bool(getattr(_cfg, 'WEBHOOK_EXTERNAL', False))
                _tok = str(getattr(_cfg, 'WEBHOOK_TOKEN', '') or '')
            except Exception:
                pass
            if not _ext or not _tok:
                self._send_json({'ok': False, 'err': 'forbidden: webhook 仅允许本机调用 (got %s)' % host}, 403)
                return
            if str(self.headers.get('X-Webhook-Token') or '') != _tok:
                self._send_json({'ok': False, 'err': 'forbidden: webhook token 校验失败'}, 403)
                return
        body = self._read_body() or {}
        name = str(body.get('employee') or '').strip()
        prompt = str(body.get('prompt') or '').strip()
        if not name or not prompt:
            self._send_json({'ok': False, 'err': '需 employee + prompt'}, 400)
            return
        sch = {'type': 'once'}
        try:
            dm = float(body.get('delay_minutes') or 0)
        except (TypeError, ValueError):
            dm = 0
        if dm > 0:
            sch['delay_minutes'] = dm
        tid = es.add_timer(name, str(body.get('box_id') or '').strip(), prompt, sch, enabled=True)
        self._send_json({'ok': True, 'id': tid, 'note': 'once 触发已登记，由 employee_scheduler 执行'})
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_post('/api/pins/extract')
def _h_api_pins_extract_26(self, path, parsed):
    # 原 do_POST 分支（path == '/api/pins/extract'），机械搬家园
    import datasource_pins as _dp
    try:
        import datasource_pins as _dp
        body = self._read_body() or {}
        _b = body or {}
        r = _dp.extract(str(_b.get('url') or ''), str(_b.get('selector') or ''), str(_b.get('attr') or 'text'))
        self._send_json({'ok': True, **r})
    except ValueError as e:
        self._send_json({'ok': False, 'err': str(e)}, 400)
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_post('/api/pins')
def _h_api_pins_27(self, path, parsed):
    # 原 do_POST 分支（path == '/api/pins'），机械搬家园
    import datasource_pins as _dp
    try:
        import datasource_pins as _dp
        body = self._read_body() or {}
        _b = body or {}
        _op = str(_b.get('op') or 'list')
        _pid = str(_b.get('project') or 'default')
        if _op == 'list':
            self._send_json({'ok': True, 'pins': _dp.list_pins(_pid)})
        elif _op == 'add':
            p = _dp.add_pin(dict(_b.get('pin') or {}, project=_pid))
            self._send_json({'ok': True, 'pin': p})
        elif _op == 'update':
            p = _dp.update_pin(_pid, str(_b.get('id') or ''), _b.get('patch') or {})
            self._send_json({'ok': True, 'pin': p})
        elif _op == 'delete':
            _dp.delete_pin(_pid, str(_b.get('id') or ''))
            self._send_json({'ok': True})
        elif _op == 'refresh':
            p = _dp.refresh_pin(_pid, str(_b.get('id') or ''))
            self._send_json({'ok': True, 'pin': p})
        elif _op == 'save_pos':
            _dp.save_positions(_pid, _b.get('positions') or {})
            self._send_json({'ok': True})
        else:
            self._send_json({'ok': False, 'err': '未知 op: %s' % _op}, 400)
    except ValueError as e:
        self._send_json({'ok': False, 'err': str(e)}, 400)
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_post('/api/butler/record')
def _h_api_butler_record_28(self, path, parsed):
    # 原 do_POST 分支（path == '/api/butler/record'），机械搬家园
    import butler_store as _bs
    try:
        body = self._read_body() or {}  # 20261123 补：机械搬运时丢失的请求体读取，缺失即 NameError
        text = str((body or {}).get('text') or '')
        _role = str((body or {}).get('role') or '健康师')
        updates, hits = _bs.record_from_text(text, role=_role)
        self._send_json({'ok': True, 'updates': updates, 'hits': hits})
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_post('/api/butler/profile')
def _h_api_butler_profile_29(self, path, parsed):
    # 原 do_POST 分支（path == '/api/butler/profile'），机械搬家园
    import butler_store as _bs
    try:
        body = self._read_body() or {}  # 20261123 补：机械搬运时丢失的请求体读取
        _bs.save_profile((body or {}).get('profile') or {}, role=str((body or {}).get('role') or '健康师'))
        self._send_json({'ok': True})
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_post('/api/brain/chat')
def _h_api_brain_chat_30(self, path, parsed):
    # 原 do_POST 分支（path == '/api/brain/chat'），机械搬家园
    self._handle_brain_chat()
    return


@route_post('/api/brain/control')
def _h_api_brain_control_31(self, path, parsed):
    # 原 do_POST 分支（path == '/api/brain/control'），机械搬家园
    self._handle_brain_control()
    return


@route_post('/api/brain/summary')
def _h_api_brain_summary_32(self, path, parsed):
    # 原 do_POST 分支（path == '/api/brain/summary'），机械搬家园
    self._handle_brain_summary()
    return


@route_post('/api/cleanup/speed')
def _h_api_cleanup_speed_33(self, path, parsed):
    # 原 do_POST 分支（path == '/api/cleanup/speed'），机械搬家园
    from routes.mixin_cleanup import handle_cleanup_speed
    from routes.mixin_cleanup import handle_cleanup_speed
    handle_cleanup_speed(self, do_run=True)
    return


@route_post('/api/cleanup/step')
def _h_api_cleanup_step_34(self, path, parsed):
    # 原 do_POST 分支（path == '/api/cleanup/step'），机械搬家园
    from routes.mixin_cleanup import handle_cleanup_step
    _q = parse_qs(urlparse(self.path).query)
    handle_cleanup_step(self, do_run=True, key=(_q.get('key') or [''])[0])
    return


@route_post('/api/trash/op')
def _h_api_trash_op_35(self, path, parsed):
    # 原 do_POST 分支（path == '/api/trash/op'），机械搬家园
    self._handle_trash_op()
    return


@route_post('/api/health/config')
def _h_api_health_config_36(self, path, parsed):
    # 原 do_POST 分支（path == '/api/health/config'），机械搬家园
    self._handle_health_config_post()
    return


@route_post('/api/health/remind')
def _h_api_health_remind_37(self, path, parsed):
    # 原 do_POST 分支（path == '/api/health/remind'），机械搬家园
    self._handle_health_remind()
    return


@route_post('/api/health/heartbeat')
def _h_api_health_heartbeat_38(self, path, parsed):
    # 原 do_POST 分支（path == '/api/health/heartbeat'），机械搬家园
    self._handle_health_heartbeat()
    return


@route_post('/api/health/event')
def _h_api_health_event_39(self, path, parsed):
    # 原 do_POST 分支（path == '/api/health/event'），机械搬家园
    self._handle_health_event()
    return


@route_post('/api/updater/check')
def _h_api_updater_check_40(self, path, parsed):
    # 原 do_POST 分支（path == '/api/updater/check'），机械搬家园
    self._handle_updater_check_post()
    return


@route_post('/api/updater/apply')
def _h_api_updater_apply_41(self, path, parsed):
    # 原 do_POST 分支（path == '/api/updater/apply'），机械搬家园
    self._handle_updater_apply()
    return


@route_post('/api/updater/config')
def _h_api_updater_config_42(self, path, parsed):
    # 原 do_POST 分支（path == '/api/updater/config'），机械搬家园
    self._handle_updater_config_post()
    return


@route_post('/api/updater/restore_stash')
def _h_api_updater_restore_stash_43(self, path, parsed):
    # 原 do_POST 分支（path == '/api/updater/restore_stash'），机械搬家园
    self._handle_updater_restore_stash()
    return


@route_post('/api/restart_server')
def _h_api_restart_server_44(self, path, parsed):
    # 原 do_POST 分支（path == '/api/restart_server'），机械搬家园
    self._handle_restart_server()
    return


@route_post('/api/network_guard')
def _h_api_network_guard_45(self, path, parsed):
    # 原 do_POST 分支（path == '/api/network_guard'），机械搬家园
    self._handle_network_guard()
    return


@route_post('/api/backup_version/escalate')
def _h_api_backup_version_escalate_46(self, path, parsed):
    # 原 do_POST 分支（path == '/api/backup_version/escalate'），机械搬家园
    self._handle_backup_escalate()
    return


@route_post('/api/backup_version/repair_ack')
def _h_api_backup_version_repair_ack_47(self, path, parsed):
    # 原 do_POST 分支（path == '/api/backup_version/repair_ack'），机械搬家园
    self._handle_backup_repair_ack()
    return


@route_post('/api/engine2d/console-report')
def _h_api_engine2d_console_report_48(self, path, parsed):
    # 原 do_POST 分支（path == '/api/engine2d/console-report'），机械搬家园
    self._handle_engine2d_console_report()
    return


@route_post('/api/avatar/tts')
def _h_api_avatar_tts_49(self, path, parsed):
    # 原 do_POST 分支（path == '/api/avatar/tts'），机械搬家园
    self._handle_avatar_tts(body=self._read_body())
    return


@route_post('/api/save')
def _h_api_save_50(self, path, parsed):
    # 原 do_POST 分支（path == '/api/save'），机械搬家园
    self._handle_game_save_post()
    return


@route_post('/api/iimage/favs')
def _h_api_iimage_favs_51(self, path, parsed):
    # 原 do_POST 分支（path == '/api/iimage/favs'），机械搬家园
    self._handle_iimage_favs_post(self._read_body())
    return


@route_post('/api/escape/action')
def _h_api_escape_action_52(self, path, parsed):
    # 原 do_POST 分支（path == '/api/escape/action'），机械搬家园
    self._handle_escape_action(self._read_body())
    return


@route_post('/api/idol/media/add')
def _h_api_idol_media_add_53(self, path, parsed):
    # 原 do_POST 分支（path == '/api/idol/media/add'），机械搬家园
    self._handle_idol_media_add(self._read_body())
    return


@route_post('/api/idol/media/remove')
def _h_api_idol_media_remove_54(self, path, parsed):
    # 原 do_POST 分支（path == '/api/idol/media/remove'），机械搬家园
    self._handle_idol_media_remove(self._read_body())
    return


@route_post('/api/idol/avatar/set')
def _h_api_idol_avatar_set_55(self, path, parsed):
    # 原 do_POST 分支（path == '/api/idol/avatar/set'），机械搬家园
    self._handle_idol_avatar_set(self._read_body())
    return


@route_post('/api/idol/delete')
def _h_api_idol_delete_56(self, path, parsed):
    # 原 do_POST 分支（path == '/api/idol/delete'），机械搬家园
    self._handle_idol_delete(self._read_body())
    return


@route_post('/api/webmarks')
def _h_api_webmarks_57(self, path, parsed):
    # 原 do_POST 分支（path == '/api/webmarks'），机械搬家园
    self._handle_webmarks_post(self._read_body())
    return
    return


@route_post('/api/iauth/ask')
def _h_api_iauth_ask_58(self, path, parsed):
    # 原 do_POST 分支（path == '/api/iauth/ask'），机械搬家园
    self._handle_iauth_ask(self._read_body())
    return


@route_post('/api/sandbox/status')
def _h_api_sandbox_status_59(self, path, parsed):
    # 原 do_POST 分支（path == '/api/sandbox/status'），机械搬家园
    from engines.common.sandbox import sandbox_status
    from engines.common.sandbox import sandbox_status
    self._send_json({'ok': True, **sandbox_status()})
    return


@route_post('/api/sandbox/set')
def _h_api_sandbox_set_60(self, path, parsed):
    # 原 do_POST 分支（path == '/api/sandbox/set'），机械搬家园
    from engines.common.sandbox import sandbox_status
    from engines.common.sandbox import set_config, sandbox_status
    from engines.common.sandbox import set_config, sandbox_status
    try:
        body = self._read_body()
    except Exception:
        body = {}
    ok, msg = set_config(mode=body.get('mode'), mem_mb=body.get('mem_mb') if isinstance(body.get('mem_mb'), int) else None)
    self._send_json({'ok': ok, 'msg': msg, **({'status': sandbox_status()} if ok else {})})
    return


@route_post('/api/swarm/submit')
def _h_api_swarm_submit_61(self, path, parsed):
    # 原 do_POST 分支（path == '/api/swarm/submit'），机械搬家园
    self._handle_swarm_post()
    return


@route_post('/api/swarm/status')
def _h_api_swarm_status_62(self, path, parsed):
    # 原 do_POST 分支（path == '/api/swarm/status'），机械搬家园
    self._handle_swarm_post()
    return


@route_post('/api/swarm/collect')
def _h_api_swarm_collect_63(self, path, parsed):
    # 原 do_POST 分支（path == '/api/swarm/collect'），机械搬家园
    self._handle_swarm_post()
    return


@route_post('/api/swarm/list')
def _h_api_swarm_list_64(self, path, parsed):
    # 原 do_POST 分支（path == '/api/swarm/list'），机械搬家园
    self._handle_swarm_post()
    return


@route_post('/api/dispatch_successor')
def _h_api_dispatch_successor_65(self, path, parsed):
    # 原 do_POST 分支（path == '/api/dispatch_successor'），机械搬家园
    from routes.mixin_successor import handle_route as _succ
    from routes.mixin_successor import handle_route as _succ
    _succ(self)
    return


@route_post(['/api/agent/import/candidates', '/api/agent/import/scan', '/api/agent/import/run', '/api/agent/import/status'])
def _h_api_agent_import_candidates_66(self, path, parsed):
    # 原 do_POST 分支（path == '/api/agent/import/candidates' or path == '/api/agent/import/scan' or path == '/api/agent/import/run' or path == '/api/agent/import/status'），机械搬家园
    self._handle_agent_import()
    return


@route_post(['/api/memory/import/candidates', '/api/memory/import/scan', '/api/memory/import/run', '/api/memory/import/auto'])
def _h_api_memory_import_candidates_67(self, path, parsed):
    # 原 do_POST 分支（path == '/api/memory/import/candidates' or path == '/api/memory/import/scan' or path == '/api/memory/import/run' or path == '/api/memory/import/auto'），机械搬家园
    self._handle_memory_import()
    return


@route_post(['/api/browser/profile/import/candidates', '/api/browser/profile/import/scan', '/api/browser/profile/import/run', '/api/browser/profile/import/auto', '/api/browser/profile/import/reserve-backup', '/api/browser/profile/import/reserve-restore', '/api/browser/profile/import/health'])
def _h_api_browser_profile_import_candidates_68(self, path, parsed):
    # 原 do_POST 分支（path == '/api/browser/profile/import/candidates' or path == '/api/browser/profile/import/scan' or path == '/api/browser/profile/import/run' or path == '/api/browser/profile/import/auto' or path == '/api/browser/profile/import/reserve-backup' or path == '/api/browser/profile/import/reserve-restore' or path == '/api/browser/profile/import/health'），机械搬家园
    self._handle_profile_import()
    return


@route_post('/api/components/install')
def _h_api_components_install_69(self, path, parsed):
    # 原 do_POST 分支（path == '/api/components/install'），机械搬家园
    self._handle_components_install()
    return


@route_post('/api/components/status')
def _h_api_components_status_70(self, path, parsed):
    # 原 do_POST 分支（path == '/api/components/status'），机械搬家园
    self._handle_components_status()
    return


@route_post('/api/components/log')
def _h_api_components_log_71(self, path, parsed):
    # 原 do_POST 分支（path == '/api/components/log'），机械搬家园
    self._handle_components_log()
    return


@route_post('/api/components/progress')
def _h_api_components_progress_72(self, path, parsed):
    # 原 do_POST 分支（path == '/api/components/progress'），机械搬家园
    self._handle_components_progress()
    return


@route_post('/api/plugins/center/status')
def _h_api_plugins_center_status_73(self, path, parsed):
    # 原 do_POST 分支（path == '/api/plugins/center/status'），机械搬家园
    self._handle_plugins_center_status()
    return


@route_post('/api/plugins/center/clean')
def _h_api_plugins_center_clean_74(self, path, parsed):
    # 原 do_POST 分支（path == '/api/plugins/center/clean'），机械搬家园
    self._handle_plugins_center_clean()
    return


@route_post('/api/plugins/ondemand/status')
def _h_api_plugins_ondemand_status_75(self, path, parsed):
    # 原 do_POST 分支（path == '/api/plugins/ondemand/status'），机械搬家园
    self._handle_plugins_ondemand_status()
    return


@route_post('/api/plugins/ondemand/install')
def _h_api_plugins_ondemand_install_76(self, path, parsed):
    # 原 do_POST 分支（path == '/api/plugins/ondemand/install'），机械搬家园
    self._handle_plugins_ondemand_install()
    return


@route_post('/api/plugins/ondemand/uninstall')
def _h_api_plugins_ondemand_uninstall_77(self, path, parsed):
    # 原 do_POST 分支（path == '/api/plugins/ondemand/uninstall'），机械搬家园
    self._handle_plugins_ondemand_uninstall()
    return


@route_post('/api/plugins/audio-video/install')
def _h_api_plugins_audio_video_install_78(self, path, parsed):
    # 原 do_POST 分支（path == '/api/plugins/audio-video/install'），机械搬家园
    self._handle_plugin_install()
    return


@route_post('/api/plugins/audio-video/status')
def _h_api_plugins_audio_video_status_79(self, path, parsed):
    # 原 do_POST 分支（path == '/api/plugins/audio-video/status'），机械搬家园
    self._handle_plugin_status()
    return


@route_post('/api/models/config')
def _h_api_models_config_80(self, path, parsed):
    # 原 do_POST 分支（path == '/api/models/config'），机械搬家园
    self._handle_models_config_post()
    return


@route_post('/api/models/3d/generate')
def _h_api_models_3d_generate_81(self, path, parsed):
    # 原 do_POST 分支（path == '/api/models/3d/generate'），机械搬家园
    from mixin_models_3d import handle_3d_generate
    from mixin_models_3d import handle_3d_generate
    handle_3d_generate(self)
    return


@route_post('/api/external/chat')
def _h_api_external_chat_82(self, path, parsed):
    # 原 do_POST 分支（path == '/api/external/chat'），机械搬家园
    import external_router
    import external_router
    external_router.handle_external_chat(self)
    return


@route_post('/api/external/config')
def _h_api_external_config_83(self, path, parsed):
    # 原 do_POST 分支（path == '/api/external/config'），机械搬家园
    import external_router as _er
    import external_gateway
    import external_router
    import external_router
    import external_gateway
    body = external_router._read_body(self)
    cfg = external_gateway.load_config()
    new_cfg = body.get('config') or {}
    if isinstance(new_cfg, dict) and new_cfg:
        cfg.update({k: v for k, v in new_cfg.items() if k != 'gateway'})
        new_gw = new_cfg.get('gateway')
        if isinstance(new_gw, dict):
            gw = dict(cfg.get('gateway') or {})
            for k, v in new_gw.items():
                if k == 'apiKey' and str(v).startswith('****'):
                    continue
                gw[k] = v
            cfg['gateway'] = gw
        external_gateway.save_config(cfg)
    import external_router as _er
    _er._send_json(self, 200, {'ok': True})
    return


@route_post('/api/config-agent/memory')
def _h_api_config_agent_memory_84(self, path, parsed):
    # 原 do_POST 分支（path == '/api/config-agent/memory'），机械搬家园
    self._handle_config_agent_memory_post()
    return


@route_post('/api/proxy')
def _h_api_proxy_85(self, path, parsed):
    # 原 do_POST 分支（path == '/api/proxy'），机械搬家园
    self._handle_proxy()
    return


@route_post('/api/gate/control')
def _h_api_gate_control_86(self, path, parsed):
    # 原 do_POST 分支（path == '/api/gate/control'），机械搬家园
    self._handle_gate_control()
    return


@route_post('/api/proxy_stream')
def _h_api_proxy_stream_87(self, path, parsed):
    # 原 do_POST 分支（path == '/api/proxy_stream'），机械搬家园
    self._handle_proxy_stream()
    return


@route_post('/api/chat-pool/chat')
def _h_api_chat_pool_chat_88(self, path, parsed):
    # 原 do_POST 分支（path == '/api/chat-pool/chat'），机械搬家园
    self._handle_chat_pool_chat()
    return


@route_post('/api/trustee/config')
def _h_api_trustee_config_89(self, path, parsed):
    # 原 do_POST 分支（path == '/api/trustee/config'），机械搬家园
    self._handle_trustee_config()
    return


@route_post('/api/engineering/node/upsert')
def _h_api_engineering_node_upsert_90(self, path, parsed):
    # 原 do_POST 分支（path == '/api/engineering/node/upsert'），机械搬家园
    self._handle_eng_node_upsert()
    return


@route_post('/api/engineering/node/status')
def _h_api_engineering_node_status_91(self, path, parsed):
    # 原 do_POST 分支（path == '/api/engineering/node/status'），机械搬家园
    self._handle_eng_node_status()
    return


@route_post('/api/engineering/edge/upsert')
def _h_api_engineering_edge_upsert_92(self, path, parsed):
    # 原 do_POST 分支（path == '/api/engineering/edge/upsert'），机械搬家园
    self._handle_eng_edge_upsert()
    return


@route_post('/api/engineering/edge/delete')
def _h_api_engineering_edge_delete_93(self, path, parsed):
    # 原 do_POST 分支（path == '/api/engineering/edge/delete'），机械搬家园
    self._handle_eng_edge_delete()
    return


@route_post('/api/engineering/summary')
def _h_api_engineering_summary_94(self, path, parsed):
    # 原 do_POST 分支（path == '/api/engineering/summary'），机械搬家园
    self._handle_eng_summary()
    return


@route_post('/api/engineering/project/create')
def _h_api_engineering_project_create_95(self, path, parsed):
    # 原 do_POST 分支（path == '/api/engineering/project/create'），机械搬家园
    self._handle_eng_project_create()
    return


@route_post('/api/engineering/project/rename')
def _h_api_engineering_project_rename_96(self, path, parsed):
    # 原 do_POST 分支（path == '/api/engineering/project/rename'），机械搬家园
    self._handle_eng_project_rename()
    return


@route_post('/api/engineering/project/delete')
def _h_api_engineering_project_delete_97(self, path, parsed):
    # 原 do_POST 分支（path == '/api/engineering/project/delete'），机械搬家园
    self._handle_eng_project_delete()
    return


@route_post('/api/loop_s/start')
def _h_api_loop_s_start_98(self, path, parsed):
    # 原 do_POST 分支（path == '/api/loop_s/start'），机械搬家园
    self._handle_loop_s_start()
    return


@route_post('/api/loop_s/stop')
def _h_api_loop_s_stop_99(self, path, parsed):
    # 原 do_POST 分支（path == '/api/loop_s/stop'），机械搬家园
    self._handle_loop_s_stop()
    return


@route_post('/api/jobs/submit')
def _h_api_jobs_submit_100(self, path, parsed):
    # 原 do_POST 分支（path == '/api/jobs/submit'），机械搬家园
    self._handle_jobs_submit()
    return


@route_post('/api/jobs/upload')
def _h_api_jobs_upload_101(self, path, parsed):
    # 原 do_POST 分支（path == '/api/jobs/upload'），机械搬家园
    self._handle_jobs_upload()
    return


@route_post('/api/ext/skills/prompt')
def _h_api_ext_skills_prompt_102(self, path, parsed):
    # 原 do_POST 分支（path == '/api/ext/skills/prompt'），机械搬家园
    from extensions import skills as _ext_skills
    from extensions import skills as _ext_skills
    _ext_skills.handle(self, 'GET', ['prompt'], {})
    return


@route_post('/api/webproxy')
def _h_api_webproxy_103(self, path, parsed):
    # 原 do_POST 分支（path == '/api/webproxy'），机械搬家园
    self._handle_webproxy('POST')
    return


@route_post('/api/browser')
def _h_api_browser_104(self, path, parsed):
    # 原 do_POST 分支（path == '/api/browser'），机械搬家园
    self._handle_browser_post(self._read_body())
    return


@route_post('/api/webrecon')
def _h_api_webrecon_105(self, path, parsed):
    # 原 do_POST 分支（path == '/api/webrecon'），机械搬家园
    self._handle_webrecon_post(self._read_body())
    return


@route_post('/api/tts')
def _h_api_tts_106(self, path, parsed):
    # 原 do_POST 分支（path == '/api/tts'），机械搬家园
    self._handle_tts()
    return


@route_post('/api/ppt-gen')
def _h_api_ppt_gen_107(self, path, parsed):
    # 原 do_POST 分支（path == '/api/ppt-gen'），机械搬家园
    from tools import get_handler
    try:
        from tools import get_handler
        _mod = get_handler('ppt_gen')
        body = self._read_body()
        if body.get('action') == 'status':
            _c = _make_tool_cap(self)
            _mod.handle({'action': 'status'}, _c)
            self._send_json({'ok': True, 'data': getattr(_c, '_out', {})})
            return
        _c = _make_tool_cap(self)
        _mod.handle(body, _c)
        _out = getattr(_c, '_out', {})
        if _out.get('ok'):
            self._send_json({'ok': True, 'data': {'tools': 'ppt_gen', **_out.get('data', {})}})
        else:
            self._send_json({'ok': False, 'data': {'error': _out.get('data', {}).get('error', 'PPT 生成失败')}})
    except Exception as e:
        self._send_json({'ok': False, 'data': {'error': str(e)}})
    return


@route_post('/api/video-free-gen')
def _h_api_video_free_gen_108(self, path, parsed):
    # 原 do_POST 分支（path == '/api/video-free-gen'），机械搬家园
    from tools import get_handler
    try:
        from tools import get_handler
        _mod = get_handler('video_gen')
        body = self._read_body()
        _c = _make_tool_cap(self)
        _mod.handle(body, _c)
        _out = getattr(_c, '_out', {})
        if _out.get('ok'):
            self._send_json({'ok': True, 'data': {'tools': 'video_gen', **_out.get('data', {})}})
        else:
            self._send_json({'ok': False, 'data': {'error': _out.get('data', {}).get('error', '视频生成失败')}})
    except Exception as e:
        self._send_json({'ok': False, 'data': {'error': str(e)}})
    return


@route_post('/api/model3d')
def _h_api_model3d_109(self, path, parsed):
    # 原 do_POST 分支（path == '/api/model3d'），机械搬家园
    from tools import get_handler
    try:
        from tools import get_handler
        _mod = get_handler('model3d_gen')
        body = self._read_body()
        _c = _make_tool_cap(self)
        _mod.handle(body, _c)
        _out = getattr(_c, '_out', {})
        if _out.get('ok'):
            self._send_json({'ok': True, 'data': {'tools': 'model3d_gen', **_out.get('data', {})}})
        else:
            self._send_json({'ok': False, 'data': {'error': _out.get('data', {}).get('error', '3D 生成失败')}})
    except Exception as e:
        self._send_json({'ok': False, 'data': {'error': str(e)}})
    return


@route_post('/api/chat/report-model')
def _h_api_chat_report_model_110(self, path, parsed):
    # 原 do_POST 分支（path == '/api/chat/report-model'），机械搬家园
    self._handle_report_last_model()
    return


@route_post('/api/chat/last-model')
def _h_api_chat_last_model_111(self, path, parsed):
    # 原 do_POST 分支（path == '/api/chat/last-model'），机械搬家园
    self._handle_report_last_model()
    return


@route_post('/api/loop-mode-config')
def _h_api_loop_mode_config_112(self, path, parsed):
    # 原 do_POST 分支（path == '/api/loop-mode-config'），机械搬家园
    self._handle_loop_mode_config_post()
    return


@route_post('/api/dock/state-save')
def _h_api_dock_state_save_113(self, path, parsed):
    # 原 do_POST 分支（path == '/api/dock/state-save'），机械搬家园
    import engines.common.dock_state as _ds
    import traceback as _tbds
    try:
        _raw = self._read_body()
        _body = _raw if isinstance(_raw, dict) else json.loads(_raw or '{}')
    except Exception:
        _body = {}
    try:
        import engines.common.dock_state as _ds
        self._send_json(_ds.dock_state_save(_body))
    except Exception as _ds_e:
        import traceback as _tbds
        self._send_json({'ok': False, 'error': 'dock_state_save 异常: %r' % _ds_e, 'traceback': _tbds.format_exc()})
    return


@route_post('/api/dock/state')
def _h_api_dock_state_114(self, path, parsed):
    # 原 do_POST 分支（path == '/api/dock/state'），机械搬家园
    import engines.common.dock_state as _ds
    import traceback as _tbds
    try:
        import engines.common.dock_state as _ds
        self._send_json(_ds.dock_state_get())
    except Exception as _ds_e:
        import traceback as _tbds
        self._send_json({'ok': False, 'error': 'dock_state_get 异常: %r' % _ds_e, 'traceback': _tbds.format_exc()})
    return


@route_post('/api/zf3d/login')
def _h_api_zf3d_login_115(self, path, parsed):
    # 原 do_POST 分支（path == '/api/zf3d/login'），机械搬家园
    self._handle_zf3d_login()
    return


@route_post('/api/zf3d/relay-proxy')
def _h_api_zf3d_relay_proxy_116(self, path, parsed):
    # 原 do_POST 分支（path == '/api/zf3d/relay-proxy'），机械搬家园
    self._handle_zf_relay_proxy()
    return


@route_post('/api/tokstats/report')
def _h_api_tokstats_report_117(self, path, parsed):
    # 原 do_POST 分支（path == '/api/tokstats/report'），机械搬家园
    import tok_stats as _ts
    try:
        import tok_stats as _ts
        body = self._read_body() or {}
        for it in body.get('chunks') or []:
            try:
                _ts.record(str(it.get('id') or 'anon'), int(it.get('chars') or 0))
            except Exception:
                pass
        self._send_json({'ok': True})
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_post('/api/zf3d/checkin')
def _h_api_zf3d_checkin_118(self, path, parsed):
    # 原 do_POST 分支（path == '/api/zf3d/checkin'），机械搬家园
    self._handle_zf3d_checkin()
    return


@route_post('/api/zf3d/heartbeat-config')
def _h_api_zf3d_heartbeat_config_119(self, path, parsed):
    # 原 do_POST 分支（path == '/api/zf3d/heartbeat-config'），机械搬家园
    self._handle_zf3d_heartbeat_config()
    return


@route_post('/api/zf3d/ai-channels')
def _h_api_zf3d_ai_channels_120(self, path, parsed):
    # 原 do_POST 分支（path == '/api/zf3d/ai-channels'），机械搬家园
    import json as _json
    import zf_channel_config
    import zf_channel_config
    body = self._read_json_body() if hasattr(self, '_read_json_body') else {}
    if not isinstance(body, dict) or not body:
        try:
            import json as _json
            ln = int(self.headers.get('Content-Length') or 0)
            # 【连接黑洞防御 2026-11-25】入口 _drain_body 已读走 body，二次裸读 rfile.read 永久阻塞；走缓存口径
            raw = self._cached_body(ln) if ln else b'{}'
            body = _json.loads(raw.decode('utf-8', errors='replace') or '{}')
        except Exception:
            body = {}
    zf_channel_config.save_channels(body.get('channels') or {})
    self._send_json({'ok': True, 'channels': zf_channel_config.load_channels(False), 'rates_ready': {'vision': zf_channel_config.rates_ready('vision'), 'imagegen': zf_channel_config.rates_ready('imagegen')}})
    return


@route_post('/api/chat-mode-rules')
def _h_api_chat_mode_rules_121(self, path, parsed):
    # 原 do_POST 分支（path == '/api/chat-mode-rules'），机械搬家园
    self._handle_chat_mode_rules_post()
    return


@route_post('/api/tools-result-limits')
def _h_api_tools_result_limits_122(self, path, parsed):
    # 原 do_POST 分支（path == '/api/tools-result-limits'），机械搬家园
    self._handle_tool_result_limits_post()
    return


@route_post('/api/user-settings')
def _h_api_user_settings_123(self, path, parsed):
    # 原 do_POST 分支（path == '/api/user-settings'），机械搬家园
    self._handle_user_settings_post()
    return


@route_post('/api/chat-attachments')
def _h_api_chat_attachments_124(self, path, parsed):
    # 原 do_POST 分支（path == '/api/chat-attachments'），机械搬家园
    self._handle_chat_attachments_post()
    return


@route_post('/api/background')
def _h_api_background_125(self, path, parsed):
    # 原 do_POST 分支（path == '/api/background'），机械搬家园
    self._handle_background_post()
    return


@route_post('/api/macro-lib')
def _h_api_macro_lib_126(self, path, parsed):
    # 原 do_POST 分支（path == '/api/macro-lib'），机械搬家园
    self._handle_macro_lib_post()
    return


@route_post('/api/pyconsole/exec')
def _h_api_pyconsole_exec_127(self, path, parsed):
    # 原 do_POST 分支（path == '/api/pyconsole/exec'），机械搬家园
    self._handle_pyconsole_exec()
    return


@route_post('/api/user-tools')
def _h_api_user_tools_128(self, path, parsed):
    # 原 do_POST 分支（path == '/api/user-tools'），机械搬家园
    self._handle_user_tools_post()
    return


@route_post('/api/user-preferences')
def _h_api_user_preferences_129(self, path, parsed):
    # 原 do_POST 分支（path == '/api/user-preferences'），机械搬家园
    self._handle_user_preferences_post()
    return


@route_post('/api/combo-state')
def _h_api_combo_state_130(self, path, parsed):
    # 原 do_POST 分支（path == '/api/combo-state'），机械搬家园
    self._handle_combo_state_post()
    return


@route_post('/api/hot-reload/reload')
def _h_api_hot_reload_reload_131(self, path, parsed):
    # 原 do_POST 分支（path == '/api/hot-reload/reload'），机械搬家园
    self._handle_hot_reload_manual()
    return


@route_post('/api/worklog')
def _h_api_worklog_132(self, path, parsed):
    # 原 do_POST 分支（path == '/api/worklog'），机械搬家园
    self._handle_worklog_post()
    return


@route_post('/api/self-check/start')
def _h_api_self_check_start_133(self, path, parsed):
    # 原 do_POST 分支（path == '/api/self-check/start'），机械搬家园
    self._handle_self_check_start_post()
    return


@route_post('/api/self-check/finish')
def _h_api_self_check_finish_134(self, path, parsed):
    # 原 do_POST 分支（path == '/api/self-check/finish'），机械搬家园
    self._handle_self_check_finish_post()
    return


@route_post('/api/project/link-folder')
def _h_api_project_link_folder_135(self, path, parsed):
    # 原 do_POST 分支（path == '/api/project/link-folder'），机械搬家园
    self._handle_link_folder()
    return


@route_post('/api/project/context')
def _h_api_project_context_136(self, path, parsed):
    # 原 do_POST 分支（path == '/api/project/context'），机械搬家园
    self._handle_project_context()
    return


@route_post('/api/project/memory/generate')
def _h_api_project_memory_generate_137(self, path, parsed):
    # 原 do_POST 分支（path == '/api/project/memory/generate'），机械搬家园
    self._handle_generate_project_memory()
    return


@route_post('/api/workspace/save')
def _h_api_workspace_save_138(self, path, parsed):
    # 原 do_POST 分支（path == '/api/workspace/save'），机械搬家园
    self._handle_workspace_save()
    return


@route_post('/api/app/restart')
def _h_api_app_restart_139(self, path, parsed):
    # 原 do_POST 分支（path == '/api/app/restart'），机械搬家园
    self._handle_app_restart()
    return


@route_post('/api/app/quit')
def _h_api_app_quit_140(self, path, parsed):
    # 原 do_POST 分支（path == '/api/app/quit'），机械搬家园
    self._handle_app_quit()
    return


@route_post('/api/backup/create')
def _h_api_backup_create_141(self, path, parsed):
    # 原 do_POST 分支（path == '/api/backup/create'），机械搬家园
    self._handle_backup_create()
    return


@route_post('/api/config/import')
def _h_api_config_import_142(self, path, parsed):
    # 原 do_POST 分支（path == '/api/config/import'），机械搬家园
    self._handle_config_import()
    return


@route_post('/api/backup/restore')
def _h_api_backup_restore_143(self, path, parsed):
    # 原 do_POST 分支（path == '/api/backup/restore'），机械搬家园
    self._handle_backup_restore()
    return


@route_post('/api/refboard-save')
def _h_api_refboard_save_144(self, path, parsed):
    # 原 do_POST 分支（path == '/api/refboard-save'），机械搬家园
    self._handle_refboard_save()
    return


@route_post('/api/refboard-load')
def _h_api_refboard_load_145(self, path, parsed):
    # 原 do_POST 分支（path == '/api/refboard-load'），机械搬家园
    self._handle_refboard_load()
    return


@route_post('/api/refboard-media-save')
def _h_api_refboard_media_save_146(self, path, parsed):
    # 原 do_POST 分支（path == '/api/refboard-media-save'），机械搬家园
    self._handle_refboard_media_save()
    return


@route_post('/api/record-devices')
def _h_api_record_devices_147(self, path, parsed):
    # 原 do_POST 分支（path == '/api/record-devices'），机械搬家园
    self._handle_record_devices()
    return


@route_post('/api/record-start')
def _h_api_record_start_148(self, path, parsed):
    # 原 do_POST 分支（path == '/api/record-start'），机械搬家园
    self._handle_record_start()
    return


@route_post('/api/record-stop')
def _h_api_record_stop_149(self, path, parsed):
    # 原 do_POST 分支（path == '/api/record-stop'），机械搬家园
    self._handle_record_stop()
    return


@route_post('/api/record-status')
def _h_api_record_status_150(self, path, parsed):
    # 原 do_POST 分支（path == '/api/record-status'），机械搬家园
    self._handle_record_status()
    return


@route_post('/api/record-logs')
def _h_api_record_logs_151(self, path, parsed):
    # 原 do_POST 分支（path == '/api/record-logs'），机械搬家园
    self._handle_record_logs()
    return


@route_post('/api/screenrecord-settings')
def _h_api_screenrecord_settings_152(self, path, parsed):
    # 原 do_POST 分支（path == '/api/screenrecord-settings'），机械搬家园
    self._handle_screenrecord_settings()
    return


@route_post('/api/screenrecord-devices')
def _h_api_screenrecord_devices_153(self, path, parsed):
    # 原 do_POST 分支（path == '/api/screenrecord-devices'），机械搬家园
    self._handle_screenrecord_devices()
    return


@route_post('/api/screenrecord-select-area')
def _h_api_screenrecord_select_area_154(self, path, parsed):
    # 原 do_POST 分支（path == '/api/screenrecord-select-area'），机械搬家园
    self._handle_screenrecord_select_area()
    return


@route_post('/api/screenrecord-start')
def _h_api_screenrecord_start_155(self, path, parsed):
    # 原 do_POST 分支（path == '/api/screenrecord-start'），机械搬家园
    self._handle_screenrecord_start()
    return


@route_post('/api/screenrecord-stop')
def _h_api_screenrecord_stop_156(self, path, parsed):
    # 原 do_POST 分支（path == '/api/screenrecord-stop'），机械搬家园
    self._handle_screenrecord_stop()
    return


@route_post('/api/screenrecord-status')
def _h_api_screenrecord_status_157(self, path, parsed):
    # 原 do_POST 分支（path == '/api/screenrecord-status'），机械搬家园
    self._handle_screenrecord_status()
    return


@route_post('/api/screenrecord-logs')
def _h_api_screenrecord_logs_158(self, path, parsed):
    # 原 do_POST 分支（path == '/api/screenrecord-logs'），机械搬家园
    self._handle_screenrecord_logs()
    return


@route_post('/api/screenrecord-log')
def _h_api_screenrecord_log_159(self, path, parsed):
    # 原 do_POST 分支（path == '/api/screenrecord-log'），机械搬家园
    self._handle_screenrecord_log()
    return


@route_post('/api/screenrecord-test-volume')
def _h_api_screenrecord_test_volume_160(self, path, parsed):
    # 原 do_POST 分支（path == '/api/screenrecord-test-volume'），机械搬家园
    self._handle_screenrecord_test_volume()
    return


@route_post('/api/chatbox-pop')
def _h_api_chatbox_pop_161(self, path, parsed):
    # 原 do_POST 分支（path == '/api/chatbox-pop'），机械搬家园
    self._handle_chatbox_pop()
    return


@route_post('/api/qqbot/start')
def _h_api_qqbot_start_162(self, path, parsed):
    # 原 do_POST 分支（path == '/api/qqbot/start'），机械搬家园
    self._send_json({'ok': False, 'err': 'QQ机器人模块已移除'})
    return


@route_post('/api/qqbot/stop')
def _h_api_qqbot_stop_163(self, path, parsed):
    # 原 do_POST 分支（path == '/api/qqbot/stop'），机械搬家园
    self._send_json({'ok': True, 'removed': True})
    return


@route_post('/api/qqbot/autoreply')
def _h_api_qqbot_autoreply_164(self, path, parsed):
    # 原 do_POST 分支（path == '/api/qqbot/autoreply'），机械搬家园
    self._send_json({'ok': True, 'removed': True})
    return


@route_post('/api/fs/text-save')
def _h_api_fs_text_save_165(self, path, parsed):
    # 原 do_POST 分支（path == '/api/fs/text-save'），机械搬家园
    self._handle_fs_text_save()
    return


@route_post('/api/demo/save')
def _h_api_demo_save_166(self, path, parsed):
    # 原 do_POST 分支（path == '/api/demo/save'），机械搬家园
    self._handle_demo_save()
    return


@route_post('/api/novel/save')
def _h_api_novel_save_167(self, path, parsed):
    # 原 do_POST 分支（path == '/api/novel/save'），机械搬家园
    self._handle_novel_save()
    return


@route_post('/api/novel/outline')
def _h_api_novel_outline_168(self, path, parsed):
    # 原 do_POST 分支（path == '/api/novel/outline'），机械搬家园
    self._handle_novel_outline()
    return


@route_post('/api/novel/chapter')
def _h_api_novel_chapter_169(self, path, parsed):
    # 原 do_POST 分支（path == '/api/novel/chapter'），机械搬家园
    self._handle_novel_chapter()
    return


@route_post('/api/novel/generate')
def _h_api_novel_generate_170(self, path, parsed):
    # 原 do_POST 分支（path == '/api/novel/generate'），机械搬家园
    self._handle_novel_generate()
    return


@route_post('/api/novel/progress')
def _h_api_novel_progress_171(self, path, parsed):
    # 原 do_POST 分支（path == '/api/novel/progress'），机械搬家园
    self._handle_novel_progress_post()
    return


@route_post('/api/novel/import')
def _h_api_novel_import_172(self, path, parsed):
    # 原 do_POST 分支（path == '/api/novel/import'），机械搬家园
    self._handle_novel_import()
    return


@route_post('/api/novel/import_web')
def _h_api_novel_import_web_173(self, path, parsed):
    # 原 do_POST 分支（path == '/api/novel/import_web'），机械搬家园
    self._handle_novel_import_web()
    return


@route_post('/api/sheets/save')
def _h_api_sheets_save_174(self, path, parsed):
    # 原 do_POST 分支（path == '/api/sheets/save'），机械搬家园
    self._handle_docs_save('sheets')
    return


@route_post('/api/docs/save')
def _h_api_docs_save_175(self, path, parsed):
    # 原 do_POST 分支（path == '/api/docs/save'），机械搬家园
    self._handle_docs_save('docs')
    return


@route_post('/api/minds/save')
def _h_api_minds_save_176(self, path, parsed):
    # 原 do_POST 分支（path == '/api/minds/save'），机械搬家园
    self._handle_docs_save('minds')
    return


@route_post('/api/psds/save')
def _h_api_psds_save_177(self, path, parsed):
    # 原 do_POST 分支（path == '/api/psds/save'），机械搬家园
    self._handle_docs_save('psds')
    return


@route_post('/api/boards/save')
def _h_api_boards_save_178(self, path, parsed):
    # 原 do_POST 分支（path == '/api/boards/save'），机械搬家园
    self._handle_docs_save('boards')
    return


@route_post('/api/comics/progress')
def _h_api_comics_progress_179(self, path, parsed):
    # 原 do_POST 分支（path == '/api/comics/progress'），机械搬家园
    self._handle_comics_progress_post()
    return


@route_post('/api/comics/download/add')
def _h_api_comics_download_add_180(self, path, parsed):
    # 原 do_POST 分支（path == '/api/comics/download/add'），机械搬家园
    import comics_download as dl
    try:
        import comics_download as dl
        raw = self._read_body()
        body = raw if isinstance(raw, dict) else json.loads(raw or '{}')
        tid = dl.add_task(body.get('source') or 'local', str(body.get('mangaId') or ''), body.get('title') or '未命名', str(body.get('chapterId') or ''), body.get('chapterTitle') or '', body.get('pages') or [])
        self._send_json({'ok': True, 'taskId': tid})
    except Exception as e:
        self._send_json({'ok': False, 'err': str(e)}, 500)
    return


@route_post('/api/fs/ops')
def _h_api_fs_ops_181(self, path, parsed):
    # 原 do_POST 分支（path == '/api/fs/ops'），机械搬家园
    self._handle_fs_ops()
    return


@route_post('/api/convert/upload')
def _h_api_convert_upload_182(self, path, parsed):
    # 原 do_POST 分支（path == '/api/convert/upload'），机械搬家园
    self._handle_convert_upload(self._read_body())
    return


@route_post('/api/convert/inbox/scan')
def _h_api_convert_inbox_scan_183(self, path, parsed):
    # 原 do_POST 分支（path == '/api/convert/inbox/scan'），机械搬家园
    self._handle_convert_scan()
    return


@route_post('/api/revive')
def _h_api_revive_184(self, path, parsed):
    # 原 do_POST 分支（path == '/api/revive'），机械搬家园
    self._handle_revive_backend()
    return


@route_post('/api/ivideo/progress')
def _h_api_ivideo_progress_186(self, path, parsed):
    # 原 do_POST 分支（path == '/api/ivideo/progress'），机械搬家园
    try:
        raw = self._read_body()
        body = raw if isinstance(raw, dict) else json.loads(raw or '{}')
    except Exception:
        body = {}
    qs = {k: [str(v)] for k, v in body.items()}
    self._handle_ivideo_progress(qs)
    return

