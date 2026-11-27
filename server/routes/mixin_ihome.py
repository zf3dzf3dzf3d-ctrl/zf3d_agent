# -*- coding: utf-8 -*-
"""mixin_ihome.py —— i家电设备台账 API（T0，2026-11-11）
GET  /api/home/devices  -> {ok, devices:[{id,name,room,type,brand,model,note,createdAt,updatedAt}]}
POST /api/home/devices  -> {name,room,type,brand,model,note, id?, deleted?} 保存/新建/删除
存储：server/data/home_devices.json（简单 JSON 落盘，.bak 轮换备份）
安全：门锁类设备（type 含"锁"）仅允许登记查询，永久禁止任何控制指令（策划案禁区）。
"""
import json
import os
import threading
import time
import uuid

_ihome_lock = threading.Lock()


class MixinIhome:

    def _ihome_store(self):
        here = os.path.dirname(os.path.abspath(__file__))
        data_dir = os.path.normpath(os.path.join(here, '..', 'data'))
        os.makedirs(data_dir, exist_ok=True)
        return os.path.join(data_dir, 'home_devices.json')

    def _ihome_load(self):
        try:
            with open(self._ihome_store(), 'r', encoding='utf-8') as f:
                d = json.load(f)
                return d if isinstance(d, list) else []
        except Exception:
            return []

    def _ihome_save(self, devices):
        path = self._ihome_store()
        try:
            if os.path.isfile(path):
                with open(path, 'r', encoding='utf-8') as f:
                    old = f.read()
                with open(path + '.bak', 'w', encoding='utf-8') as f:
                    f.write(old)
        except Exception:
            pass
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(devices, f, ensure_ascii=False, indent=1)

    def _handle_ihome_get(self):
        with _ihome_lock:
            devices = self._ihome_load()
        devices.sort(key=lambda d: d.get('updatedAt', 0), reverse=True)
        self._send_json({'ok': True, 'devices': devices})

    def _handle_ihome_post(self, body):
        if not isinstance(body, dict):
            return self._send_json({'ok': False, 'err': 'bad body'}, 400)
        did = str(body.get('id') or '')
        name = str(body.get('name') or '').strip()[:50]
        room = str(body.get('room') or '').strip()[:30]
        dtype = str(body.get('type') or '').strip()[:30]
        brand = str(body.get('brand') or '').strip()[:30]
        model = str(body.get('model') or '').strip()[:50]
        note = str(body.get('note') or '')[:2000]
        # T0 v1.2 schema 补3列：在线状态/协议类型/可控性（旧数据缺字段自动为默认值，向后兼容）
        online = 1 if body.get('online') else 0
        protocol = str(body.get('protocol') or '').strip()[:20]
        ctrl = 1 if body.get('ctrl') else 0
        now = time.time()
        with _ihome_lock:
            devices = self._ihome_load()
            if body.get('deleted') and did:
                devices = [d for d in devices if d.get('id') != did]
            else:
                if not name:
                    return self._send_json({'ok': False, 'err': 'name required'}, 400)
                if did:
                    hit = None
                    for d in devices:
                        if d.get('id') == did:
                            hit = d
                            break
                    if hit:
                        hit.update({'name': name, 'room': room, 'type': dtype,
                                    'brand': brand, 'model': model, 'note': note,
                                    'online': online, 'protocol': protocol, 'ctrl': ctrl,
                                    'updatedAt': now})
                    else:
                        devices.append({'id': did, 'name': name, 'room': room,
                                        'type': dtype, 'brand': brand, 'model': model,
                                        'note': note, 'online': online,
                                        'protocol': protocol, 'ctrl': ctrl,
                                        'createdAt': now, 'updatedAt': now})
                else:
                    did = 'd' + uuid.uuid4().hex[:12]  # uuid4 防碰撞（T1 控制寻址依赖 id）
                    devices.append({'id': did, 'name': name, 'room': room, 'type': dtype,
                                    'brand': brand, 'model': model, 'note': note,
                                    'online': online, 'protocol': protocol, 'ctrl': ctrl,
                                    'createdAt': now, 'updatedAt': now})
            try:
                self._ihome_save(devices)
            except Exception as e:
                return self._send_json({'ok': False, 'err': 'save failed: %s' % e}, 500)
        self._send_json({'ok': True, 'id': did})

    # ---------- T1 先行段：写闸门 + mock 控制链路（2026-11-11） ----------
    # 写闸门三重防线（策划案 v1.3 硬项）：
    #   1) op 白名单：仅 on/off/toggle/状态查询
    #   2) 门锁硬拦截：type 含 '锁' 直接拒绝（禁区，零例外）
    #   3) 写操作二次确认：必须显式 confirm=true
    IHOME_ALLOWED_OPS = ('on', 'off', 'toggle', 'status')

    def _handle_ihome_control(self, body):
        if not isinstance(body, dict):
            return self._send_json({'ok': False, 'err': 'bad body'}, 400)
        did = str(body.get('id') or '')
        op = str(body.get('op') or '').strip().lower()
        confirm = body.get('confirm') is True
        if not did:
            return self._send_json({'ok': False, 'err': 'missing id'}, 400)
        if op not in self.IHOME_ALLOWED_OPS:
            return self._send_json({'ok': False, 'err': 'op not allowed: %s' % op}, 403)
        with _ihome_lock:
            devices = self._ihome_load()
            dev = next((d for d in devices if d.get('id') == did), None)
        if dev is None:
            return self._send_json({'ok': False, 'err': 'device not found'}, 404)
        # 门锁硬拦截：T1 验收硬项，任何控制指令（含状态外的写操作）永久禁止
        if '锁' in str(dev.get('type') or '') and op != 'status':
            return self._send_json({'ok': False, 'err': 'forbidden: 门锁类设备永久禁止控制（策划案禁区）'}, 403)
        # 写操作（非 status）必须二次确认
        if op != 'status' and not confirm:
            return self._send_json({'ok': False, 'err': 'write op requires confirm=true'}, 428)
        # mock 链路（IHOME_LOGIC_OK 闸门）：真 provider 接入前仅走模拟
        try:
            from routes.ihome_provider_mock import execute
            result = execute(dev, op)
        except Exception as e:
            return self._send_json({'ok': False, 'err': 'provider failed: %s' % e}, 500)
        self._send_json({'ok': True, 'result': result})
