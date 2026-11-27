# -*- coding: utf-8 -*-
"""Mixin: 循环内核化·阶段B —— Loop-S 内核循环 API

路由：
  POST /api/loop_s/start           发起一次 Loop-S 运行（立即返回 run_id，后台线程执行）
  GET  /api/loop_s/events          SSE 订阅事件流（?run_id=&cursor=N 断点续读）
  GET  /api/loop_s/status          运行状态快照（?run_id=）

阶段B约束：默认 loop_host=browser，本组端点不接入任何现有前端路径，
仅作内核循环的独立通道；浏览器断开订阅不影响循环执行（与 chat_pool 同规约）。
"""
import json
import time
from routes._shared import *
from routes.mixin_base import MixinBase
import loop_s


class MixinLoopS(MixinBase):
    def _loop_s_run_id(self):
        try:
            qs = parse_qs(urlparse(self.path).query or '')
            return (qs.get('run_id') or [''])[0]
        except Exception:
            return ''

    # ===== 阶段C：审批状态机 =====
    def _handle_approval_resolve(self, req_id):
        try:
            body = self._read_body() or {}
        except Exception as e:
            self._send_json({'ok': False, 'err': 'read body: %s' % e}, 400)
            return
        action = str(body.get('action') or '')
        if action not in ('approve', 'reject'):
            self._send_json({'ok': False, 'err': "action must be 'approve' or 'reject'"}, 400)
            return
        ok, a = loop_s.resolve_approval(req_id, action, str(body.get('reason') or ''))
        if not ok:
            self._send_json({'ok': False, 'err': 'req not found or already resolved'}, 404)
            return
        self._send_json({'ok': True, 'req_id': req_id, 'status': a['status']})

    def _handle_approval_list(self):
        try:
            qs = parse_qs(urlparse(self.path).query or '')
            status = (qs.get('status') or [''])[0] or None
        except Exception:
            status = None
        self._send_json({'ok': True, 'items': loop_s.list_approvals(status)})

    def _handle_loop_s_start(self):
        try:
            body = self._read_body() or {}
        except Exception as e:
            self._send_json({'ok': False, 'err': 'read body: %s' % e}, 400)
            return
        messages = body.get('messages') or []
        ctx = body.get('ctx') or {}
        dry = bool(body.get('dry_run'))
        if dry:
            # 自检通道：假模型脚本 + 假引擎，无外呼
            script = body.get('dry_script') or []
            model_call = loop_s.dry_model_call_factory(script)
            engine_mod = loop_s._dry_engine()
            # D3：dry_gate=True 时给假引擎包审批闸门（联调审批兜底，不外呼）
            if body.get('dry_gate'):
                engine_mod = loop_s._approval_engine(engine_mod)
                ctx.setdefault('_approval_whitelist',
                               body.get('approval_whitelist') or
                               ['read_file', 'search_in_files', 'find_files', 'file_info',
                                'tree_dir', 'read_lines', 'list_dir'])
        else:
            if not ctx.get('_target_url'):
                self._send_json({'ok': False, 'err': 'Missing _target_url'}, 400)
                return
            model_call = None  # 生产默认路径
            engine_mod = loop_s.get_production_engine()
            # 默认审批白名单：纯只读工具不拦（可由 body.approval_whitelist 覆盖）
            ctx.setdefault('_approval_whitelist',
                           body.get('approval_whitelist') or
                           ['read_file', 'search_in_files', 'find_files', 'file_info',
                            'tree_dir', 'read_lines', 'list_dir'])
        rid = loop_s.start_async(engine_mod, messages, ctx, model_call=model_call)
        self._send_json({'ok': True, 'run_id': rid})

    def _handle_loop_s_events(self):
        rid = self._loop_s_run_id()
        qs = parse_qs(urlparse(self.path).query or '')
        try:
            cursor = int((qs.get('cursor') or ['0'])[0])
        except ValueError:
            cursor = 0
        run = loop_s.get_run(rid)
        if run is None:
            self._send_json({'ok': False, 'err': 'run not found'}, 404)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()

        def _write(b):
            self.wfile.write(b)
            self.wfile.flush()

        last = cursor
        idle = 0
        while True:
            batch = loop_s.events_since(rid, last)
            if batch is None:
                _write(('event: gone\ndata: {}\n\n').encode('utf-8'))
                break
            for ev in batch:
                _write(('event: %s\ndata: %s\n\n' % (
                    ev['kind'], json.dumps(ev, ensure_ascii=False))).encode('utf-8'))
                last = ev['seq']
            run = loop_s.get_run(rid)
            if run and run.get('state') != 'running' and not loop_s.events_since(rid, last):
                _write(('event: done\ndata: %s\n\n' % json.dumps(
                    {'seq': last, 'state': run.get('state')})).encode('utf-8'))
                break
            # 断线保护：客户端断开时写入会抛异常，让 ThreadingHTTPServer 收尾
            try:
                _write(b': ping\n\n')
            except Exception:
                break
            time.sleep(0.5)
            idle += 1
            if idle > 2400:  # ~20 分钟无消费即收流
                break
        self.close_connection = True

    def _handle_loop_s_status(self):
        rid = self._loop_s_run_id()
        run = loop_s.get_run(rid)
        if run is None:
            self._send_json({'ok': False, 'err': 'run not found'}, 404)
            return
        with run['lock']:
            self._send_json({'ok': True, 'run_id': rid, 'state': run['state'],
                             'seq': run['seq'], 'events': len(run['events']),
                             'result': (run['result'] or '')[:2000]})

    def _handle_loop_s_stop(self):
        """A10 停止通道：POST {run_id}，置 stop_flag 下一轮检查后终止。"""
        try:
            body = self._read_body() or {}
        except Exception as e:
            self._send_json({'ok': False, 'err': 'read body: %s' % e}, 400)
            return
        rid = str(body.get('run_id') or '')
        ok = loop_s.request_stop(rid)
        self._send_json({'ok': bool(ok)})

