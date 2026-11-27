# -*- coding: utf-8 -*-
"""ihome_provider_mock.py —— i家电控制 mock provider（T1 先行段，2026-11-11）

策划案 v1.3 硬闸门：mock 链路 IHOME_LOGIC_OK 未产出前，禁止实现任何真 provider。
接口签名与未来真 provider（mijia/ha）保持一致：execute(device:dict, op:str) -> dict
返回 {provider, op, device, state, ts}，真 provider 接入时仅需替换本文件实现。
"""
import time


def execute(device, op):
    """模拟控制回执：不触碰真实设备，仅返回模拟结果。"""
    if op == 'status':
        return {'provider': 'mock', 'op': 'status', 'device': device.get('name'),
                'state': device.get('online') and 'online' or 'offline', 'ts': int(time.time())}
    state = 'on' if op == 'on' else ('off' if op == 'off' else 'toggled')
    return {'provider': 'mock', 'op': op, 'device': device.get('name'),
            'state': state, 'ts': int(time.time())}
