# -*- coding: utf-8 -*-
"""
zf_runninghub.py - RunningHub（算力云）API 接入通道

功能：
  接入 RunningHub 平台（https://www.runninghub.cn / .ai）的 AI 生成 API，
  当前内置首个接口：Minimax H3 RH Enhanced Multi-Reference（多参考图+音频→视频）。
  接口: /rhart-video/minimax-h3-rh-enhanced/ref2va，价格约 $0.6/次。

鉴权：
  - 需在 https://www.runninghub.cn 注册并创建 API Key（任务中心 → API Key）
  - Key 存放在 server/zf_channel_rates.json（与智谱/方舟通道同文件），格式：
      "runninghub": { "apiKey": "rh-xxxx", "enabled": true }
  - 不填 Key 时调用会返回明确的未配置错误，不影响其他通道。

API 说明（官方文档: https://www.runninghub.ai/zh-cn/api-doc）：
  1) 发起任务: POST https://www.runninghub.cn/task/api/openapi/v2/run
     Header: Host + Authorization: Bearer <apiKey>
     Body: {"apiName":"API_CREATE_TASK","apiKey":...,"nodeInfoList":[...],"workflowId":...}
     本模块用"接口式"调用（商城 API），直接传 endpoint+params。
  2) 轮询状态: POST /task/api/openapi/v2/status
  3) 取结果:   POST /task/api/openapi/v2/outputs
"""

import json
import os
import time
import urllib.request

BASE = 'https://www.runninghub.cn'
CHANNEL_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'zf_channel_rates.json')

# 商城 API：多参考图+音频 → 视频（Minimax H3 RH Enhanced）
VIDEO_REF2VA_ENDPOINT = '/rhart-video/minimax-h3-rh-enhanced/ref2va'
VIDEO_REF2VA_PRICE_USD = 0.6


def get_config():
    """读取 runninghub 通道配置（zf_channel_rates.json 覆盖 > 默认）。"""
    cfg = {'enabled': True, 'apiKey': ''}
    try:
        with open(CHANNEL_FILE, 'r', encoding='utf-8') as f:
            ov = json.load(f).get('runninghub') or {}
        cfg.update(ov)
    except Exception:
        pass
    return cfg


def _post(path, payload, timeout=60):
    cfg = get_config()
    key = (cfg.get('apiKey') or '').strip()
    if not key:
        return {'code': -1, 'msg': '未配置 RunningHub API Key。请在 server/zf_channel_rates.json 中添加 '
                                   '"runninghub": {"apiKey": "你的Key"}（runninghub.cn 注册后任务中心获取）'}
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Host': 'www.runninghub.cn', 'Content-Type': 'application/json',
                 'Authorization': 'Bearer ' + key},
        method='POST')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8'))
    except Exception as e:
        body = ''
        try:
            body = e.read().decode('utf-8', 'ignore')[:500]
        except Exception:
            pass
        return {'code': -1, 'msg': 'RunningHub 请求失败: %s %s' % (e, body)}


def create_video_ref2va(image_urls, audio_url=None, video_urls=None,
                        duration_seconds=5, prompt='', resolution='1080p', aspect='9:16'):
    """
    发起多参考图/音频生成视频任务。
    image_urls: 1~9 张参考图 URL 列表（JPG/PNG，≤10MB）
    audio_url : 驱动音频 URL（可选）
    video_urls: 参考视频 URL 列表，≤3 个（可选）
    返回: {'code':200,'data':{'taskId':...}} 或错误
    """
    if not image_urls or not (1 <= len(image_urls) <= 9):
        return {'code': -1, 'msg': 'image_urls 必须为 1~9 张图片 URL'}
    if video_urls and len(video_urls) > 3:
        return {'code': -1, 'msg': 'video_urls 最多 3 个'}
    payload = {
        'endpoint': VIDEO_REF2VA_ENDPOINT,
        'images': list(image_urls),
        'durationSeconds': int(duration_seconds),
        'resolution': resolution,
        'aspectRatio': aspect,
    }
    if prompt:
        payload['prompt'] = prompt
    if audio_url:
        payload['audio'] = audio_url
    if video_urls:
        payload['videos'] = list(video_urls)
    return _post('/task/api/openapi/v2/run', payload)


def get_status(task_id):
    return _post('/task/api/openapi/v2/status', {'taskId': task_id})


def get_outputs(task_id):
    return _post('/task/api/openapi/v2/outputs', {'taskId': task_id})


def wait_result(task_id, timeout_sec=900, interval=10):
    """轮询直到任务完成，返回 outputs（含视频 URL）。"""
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        st = get_status(task_id)
        code = str((st or {}).get('code') or (st or {}).get('msgCode') or '')
        if code in ('200', 'API203002'):  # API203002=任务完成
            return get_outputs(task_id)
        # 已知失败/错误状态提前返回，避免空转到超时
        if code and code != '200' and not code.startswith('API203'):
            return st
        time.sleep(interval)
    return {'code': -1, 'msg': '等待超时（%d 秒），可稍后用 get_outputs(%s) 手动取结果' % (timeout_sec, task_id)}


def generate_video_blocking(image_urls, **kw):
    """一步式：建任务→等完成→返回视频 URL 结果。"""
    r = create_video_ref2va(image_urls, **kw)
    task_id = ((r.get('data') or {}).get('taskId')) if isinstance(r.get('data'), dict) else None
    if not task_id:
        return r
    return wait_result(task_id)


def status_report():
    cfg = get_config()
    return {'enabled': cfg.get('enabled'), 'keyConfigured': bool((cfg.get('apiKey') or '').strip()),
            'endpoint': VIDEO_REF2VA_ENDPOINT, 'price_usd_per_call': VIDEO_REF2VA_PRICE_USD}


if __name__ == '__main__':
    print(json.dumps(status_report(), ensure_ascii=False))
