# -*- coding: utf-8 -*-
"""Mixin: 对话串行管理器（ChatGate）管理 API
路由：
  GET  /api/gate/status   面板轮询：全局状态+模型分组+车道明细+活动队列+历史+每对话统计
  GET  /api/gate/active   轻量快照：仅活跃票据（小狗守卫红绿灯联动轮询）
  POST /api/gate/control  控制：enable/disable/set_gap/set_lanes/set_auto/allow_box/deny_box/set_priority/clear_history
"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinGate(MixinBase):
    def _handle_gate_status(self):
        try:
            import chat_gate
            self._send_json(chat_gate.status_snapshot())
        except Exception as e:
            self._send_error('gate status error: %s' % e, 500)

    def _handle_gate_active(self):
        """轻量快照：仅活跃票据（小狗守卫红绿灯联动轮询，每 15s 一次，响应体极小）"""
        try:
            import chat_gate
            self._send_json(chat_gate.active_snapshot())
        except Exception as e:
            self._send_error('gate active error: %s' % e, 500)

    def _handle_gate_control(self):
        try:
            import chat_gate
            body = self._read_body()
            action = str(body.get('action', ''))
            ok, msg = False, '未知操作'
            if action == 'enable':
                ok = chat_gate.set_enabled(True)
                msg = '闸门已恢复放行'
            elif action == 'disable':
                ok = chat_gate.set_enabled(False)
                msg = '闸门已全局暂停（新请求将被拒绝）'
            elif action == 'set_gap':
                ok = chat_gate.set_gap(body.get('gap', 2.0))
                msg = '间隔已更新'
            elif action == 'set_lanes':
                ok = chat_gate.set_lanes(body.get('lanes', 3))
                msg = '车道数已更新（扩容即时生效，缩容等残留跑完）'
            elif action == 'set_auto':
                ok = chat_gate.set_auto(body.get('auto') or {})
                msg = '自适应参数已更新（即时生效）'
            elif action == 'probe':
                # v4.3 并发容量探测：provider 必填（接口域名）；force=true 强制重测
                prov = str(body.get('provider') or '').strip()
                if not prov:
                    self._send_json({'ok': False, 'error': '缺少 provider（接口域名）'}, 400)
                    return
                ok, msg = chat_gate.start_probe(prov, force=bool(body.get('force')))
                msg = str(msg)
            elif action == 'allow_box':
                ok = chat_gate.set_box_allowed(body.get('box', ''), True,
                                               str(body.get('note', '')))
                msg = '对话已恢复【允许】'
            elif action == 'set_priority':
                # v4.5 对话优先级：tier 0=普通 1=加速 2=让道
                # （只影响同一个大模型内的排队，不同大模型不参与）
                ok, msg = chat_gate.set_box_priority(body.get('box', ''),
                                                     body.get('tier', 0))
                msg = str(msg)
            elif action == 'deny_box':
                ok = chat_gate.set_box_allowed(body.get('box', ''), False,
                                               str(body.get('note', '')))
                msg = '对话已设为【不通过】'
            elif action == 'clear_history':
                ok = chat_gate.clear_history()
                msg = '历史已清空'
            else:
                self._send_json({'ok': False, 'error': '未知 action: %s' % action}, 400)
                return
            self._send_json({'ok': ok, 'msg': msg})
        except Exception as e:
            self._send_error('gate control error: %s' % e, 500)
