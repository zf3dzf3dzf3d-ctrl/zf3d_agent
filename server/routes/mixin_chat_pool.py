# -*- coding: utf-8 -*-
"""Mixin: 对话池（chat_pool）管理 API（池系统 v1.0）

路由：
  POST /api/chat-pool/chat                 托管发起一轮上游请求（_turn_id 幂等）
  GET  /api/chat-pool/slot/<id>/events     SSE 订阅槽位事件（?cursor=N&turn_id=... 断点续读）
  POST /api/chat-pool/slot/<id>/cancel     停止一轮 Turn（用户停止/超时掐断）
  GET  /api/chat-pool/status               全池只读快照（面板/将来风筝可单向读取）
  GET  /api/chat-pool/active               轻量活跃快照
  GET  /api/chat-pool/config               前端开关探测 {enabled}

设计约束（用户定规矩）：小狗守卫/风筝与池解耦——本 mixin 不依赖、不通知它们；
浏览器断开订阅只影响订阅本身，池内 worker 照常收上游（断点续读的意义所在）。
"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinChatPool(MixinBase):
    # ---- /api/chat-pool/slot/<id>/<suffix> 路径解析 ----
    def _pool_slot_id(self, suffix):
        try:
            parts = urlparse(self.path).path.split('/')
            if len(parts) >= 6 and parts[1] == 'api' and parts[2] == 'chat-pool' \
                    and parts[3] == 'slot' and parts[5] == suffix:
                return parts[4]
        except Exception:
            pass
        return ''

    def _handle_chat_pool_chat(self):
        """POST /api/chat-pool/chat：托管发起（立即返回，不等上游）。"""
        try:
            body = self._read_body()
        except Exception as _e:
            # 【400诊断 2026-09-10】读 body 异常不再静默吞掉：记录原始字节特征，
            # 用于定位「Missing _target_url」类 400 的真实来头（连接中途断/编码坏/截断）。
            self._pool400_diag('read-body-EX', exc=_e)
            body = {}
        import chat_pool
        turn_id = str(body.get('_turn_id') or '')
        resp = chat_pool.submit(body, turn_id)
        if (not resp.get('ok') and not resp.get('fallback')
                and resp.get('error') == 'Missing _target_url'):
            # body 读到了但没有 _target_url：记录 body 键与预览（前端载荷构造/空请求的直接证据）
            self._pool400_diag('no-target', body=body)
        code = 200
        if not resp.get('ok') and not resp.get('fallback'):
            code = int(resp.get('status') or 400)
        self._send_json(resp, code)

    def _pool400_diag(self, tag, exc=None, body=None):
        """池路由 400 诊断：Content-Length / chunked / 已缓存字节数 / 字节头尾 / 异常栈。
        仅在异常路径触发，正常请求零开销；print 走 server_stdout.log。"""
        try:
            import time as _t
            import traceback as _tb
            parts = ['[Pool400Diag][%s][%s]' % (_t.strftime('%H:%M:%S'), tag)]
            parts.append('CL=%s TE=%s' % (
                self.headers.get('Content-Length'), self.headers.get('Transfer-Encoding')))
            raw = getattr(self, '_cached_raw_body', None)
            parts.append('cached=%s consumed=%s' % (
                (len(raw) if raw is not None else 'None'),
                getattr(self, '_body_consumed', None)))
            if raw:
                parts.append('head=%r tail=%r' % (raw[:120], raw[-80:]))
            if body is not None:
                parts.append('body_keys=%s preview=%r' % (
                    list(body.keys())[:12], str(body)[:200]))
            if exc is not None:
                parts.append('EXC=%r' % exc)
                parts.append(_tb.format_exc()[-400:])
            print(' | '.join(parts), flush=True)
        except Exception:
            pass

    def _handle_chat_pool_cancel(self):
        """POST /api/chat-pool/slot/<id>/cancel：停止一轮 Turn。"""
        slot_id = self._pool_slot_id('cancel')
        try:
            body = self._read_body()
        except Exception:
            body = {}
        import chat_pool
        self._send_json(chat_pool.cancel(slot_id, str(body.get('turn_id') or '')))

    def _handle_chat_pool_events(self):
        """GET /api/chat-pool/slot/<id>/events?cursor=N&turn_id=...

        SSE 事件流（与热更新 SSE 同款头部 + 心跳模式）：
          event: meta   {seq, state, turn_id}
          event: chunk  {seq, text}          ← 上游 SSE 原始行透传（流式模式）
          event: result {seq, result}        ← 聚合结果（非流式模式 / 上游非SSE）
          event: error  {seq, error, status}
          event: done   {seq, state, usage}  ← Turn 结束（done/failed/cancelled/gone）
        断线重连：带 cursor=最后收到的 seq，服务端重放 seq>cursor 的事件再续直播。
        """
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        slot_id = self._pool_slot_id('events')
        try:
            cursor = int((qs.get('cursor') or ['0'])[0] or 0)
        except Exception:
            cursor = 0
        turn_id = str((qs.get('turn_id') or [''])[0] or '')

        import chat_pool
        slot = chat_pool.find_slot(slot_id)
        if not slot:
            self._send_json({'ok': False, 'error': 'slot not found: %s' % slot_id}, 404)
            return

        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()

        try:
            from config import SSE_HEARTBEAT_SEC
            hb = max(2.0, min(float(SSE_HEARTBEAT_SEC), 25.0))
        except Exception:
            hb = 10.0

        sock_errs = (BrokenPipeError, ConnectionResetError, ConnectionAbortedError,
                     OSError, ValueError)
        last = cursor

        def _write(raw):
            self.wfile.write(raw)
            self.wfile.flush()

        try:
            while True:
                batch = []
                gone = False
                superseded = False
                with slot.cond:
                    t = slot.turn
                    if t is None or (turn_id and t.get('turn_id') != turn_id):
                        gone = True
                        # 槽位被更新的 Turn 占据=被取代（让位信号）；槽位为空=已清理（gone 可重投）
                        superseded = bool(t is not None and turn_id)
                    else:
                        batch = [e for e in slot.events if e['seq'] > last]
                        if not batch:
                            slot.cond.wait(hb)
                            t = slot.turn
                            if t is None or (turn_id and t.get('turn_id') != turn_id):
                                gone = True
                                superseded = bool(t is not None and turn_id)
                            else:
                                batch = [e for e in slot.events if e['seq'] > last]
                if gone:
                    # 被新 Turn 取代 → superseded（前端安静退出让位，不重试）；
                    # 槽位已被清理（缓冲过期）→ gone（前端可带同 turn_id 重投重跑）
                    _write(('event: done\ndata: %s\n\n' % json.dumps(
                        {'seq': last, 'state': 'superseded' if superseded else 'gone'})).encode('utf-8'))
                    self.close_connection = True
                    break
                ended = False
                for ev in batch:
                    _write(('event: %s\ndata: %s\n\n' % (
                        ev.get('kind', 'chunk'),
                        json.dumps(ev, ensure_ascii=False))).encode('utf-8'))
                    last = ev['seq']
                    if ev.get('kind') == 'done':
                        ended = True
                if ended:
                    # 订阅一次性：done 后显式关连接（SSE 无 Content-Length，
                    # 不关的话诊断类客户端（curl/IWR）等不到 EOF）
                    self.close_connection = True
                    break
                if not batch:
                    _write(b': hb\n\n')
        except sock_errs:
            pass   # 浏览器断开：订阅结束，池内 worker 照常收上游（断点续读补齐）
        except Exception as e:
            print('[ChatPool] events 订阅异常: %s' % e)

    def _handle_chat_pool_status(self):
        try:
            import chat_pool
            self._send_json(chat_pool.status_snapshot())
        except Exception as e:
            self._send_error('chat pool status error: %s' % e, 500)

    def _handle_chat_pool_active(self):
        try:
            import chat_pool
            self._send_json(chat_pool.active_snapshot())
        except Exception as e:
            self._send_error('chat pool active error: %s' % e, 500)

    def _handle_chat_pool_config(self):
        """前端启动/发送前探测：决定走池还是旧 /api/proxy(_stream) 路径。"""
        try:
            import chat_pool
            c = chat_pool.cfg()
            self._send_json({
                'ok': True,
                'enabled': bool(c.get('enabled')),
                'conn_pool_enabled': bool((c.get('conn_pool') or {}).get('enabled')),
                'version': '1.0',
            })
        except Exception as e:
            self._send_json({'ok': False, 'enabled': False, 'error': str(e)})
