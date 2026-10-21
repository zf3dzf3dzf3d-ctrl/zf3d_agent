#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""model3d_gen - 3D 模型生成：有 Tripo/Meshy/Rodin/混元 key 走云端，否则本地参数化占位 GLB
用法: {"action":"generate","prompt":"一只可爱的猫","provider":"tripo|meshy|rodin|hunyuan|auto"}
产物: public/outputs/model3d/<uuid>.glb，前端 3D 工作台查看器可直接预览。
"""
import os
import json
import time
import struct
import urllib.request

TOOL_NAME = 'model3d_gen'

_OUTPUT_DIR = os.path.join('public', 'outputs', 'model3d')

# 各服务商最小接入参数（有 key 才启用）
_PROVIDERS = {
    'tripo': {'key_names': ['tripo', 'Tripo'], 'task_url': 'https://api.tripo3d.ai/v2/open/task'},
    'meshy': {'key_names': ['meshy', 'Meshy'], 'task_url': 'https://api.meshy.ai/openapi/v2/text-to-3d'},
    'rodin': {'key_names': ['rodin', 'Rodin'], 'task_url': 'https://api_hyperhuman.deemos.com/api/v2/rodin'},
    'hunyuan': {'key_names': ['hunyuan', '混元', '混元3D'], 'task_url': ''},
}


def _keys():
    try:
        with open(os.path.join('private', 'api_keys.json'), encoding='utf-8') as f:
            return (json.load(f) or {}).get('keys', {}) or {}
    except Exception:
        return {}


def _find_key(provider):
    ks = _keys()
    for kn in _PROVIDERS.get(provider, {}).get('key_names', []):
        for k, v in ks.items():
            if kn.lower() in k.lower() and v:
                return v
    return None


def _make_placeholder_glb(prompt, out_path):
    """本地参数化 GLB：根据 prompt 哈希生成带颜色变化的简单几何体（可预览、可下载）"""
    import hashlib
    h = int(hashlib.md5(prompt.encode('utf-8')).hexdigest(), 16)
    r = 0.35 + (h % 60) / 100.0
    g = 0.35 + ((h >> 8) % 60) / 100.0
    b = 0.35 + ((h >> 16) % 60) / 100.0

    # 简单立方体（单位米）+ PBR 材质
    verts = []
    sx, sy, sz = 0.5, 0.5 + (h >> 4) % 40 / 100.0, 0.5
    for dz in (-1, 1):
        for dy in (-1, 1):
            for dx in (-1, 1):
                verts += [dx * sx, dy * sy, dz * sz]
    faces = [
        (0, 1, 3), (0, 3, 2), (4, 6, 7), (4, 7, 5),
        (0, 4, 5), (0, 5, 1), (2, 3, 7), (2, 7, 6),
        (0, 2, 6), (0, 6, 4), (1, 5, 7), (1, 7, 3),
    ]
    idx = []
    for f in faces:
        idx += list(f)

    # --- 手写最小 GLB（binary glTF 2.0）---
    # 顶点 position accessor (float32)
    pos_bin = struct.pack('<%df' % len(verts), *verts)
    idx_bin = struct.pack('<%dH' % len(idx), *idx)

    import base64
    # 用 GLB chunk 方式而不是 data URI：构建 JSON + BIN
    gltf = {
        "asset": {"version": "2.0", "generator": "zf-agent-placeholder"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {
            "baseColorFactor": [r, g, b, 1.0], "metallicFactor": 0.1, "roughnessFactor": 0.6}}],
        "buffers": [{"byteLength": len(pos_bin) + len(idx_bin)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos_bin), "target": 34962},
            {"buffer": 0, "byteOffset": len(pos_bin), "byteLength": len(idx_bin), "target": 34963},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 8, "type": "VEC3",
             "min": [-sx, -sy, -sz], "max": [sx, sy, sz]},
            {"bufferView": 1, "componentType": 5123, "count": len(idx), "type": "SCALAR"},
        ],
    }
    json_bin = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    while len(json_bin) % 4:
        json_bin += b' '
    while len(pos_bin + idx_bin) % 4:
        pos_bin += b'\x00'

    bin_chunk = pos_bin + idx_bin
    total = 12 + 8 + len(json_bin) + 8 + len(bin_chunk)
    glb = struct.pack('<III', 0x46546C67, 2, total)
    glb += struct.pack('<II', len(json_bin), 0x4E4F534A) + json_bin
    glb += struct.pack('<II', len(bin_chunk), 0x004E4942) + bin_chunk

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'wb') as f:
        f.write(glb)
    return out_path


def _cloud_generate(provider, key, prompt, out_path):
    """云端生成（同步等待轮询，最长 5 分钟）"""
    import urllib.error
    if provider == 'tripo':
        req = urllib.request.Request(
            _PROVIDERS['tripo']['task_url'],
            data=json.dumps({'type': 'TextToModel', 'prompt': prompt}).encode(),
            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
        r = json.loads(urllib.request.urlopen(req, timeout=60).read())
        tid = r.get('data', {}).get('task_id')
        if not tid:
            raise RuntimeError('tripo 下单失败: %s' % r)
        for _ in range(60):
            time.sleep(5)
            q = urllib.request.Request(
                _PROVIDERS['tripo']['task_url'] + '/' + tid,
                headers={'Authorization': 'Bearer ' + key})
            st = json.loads(urllib.request.urlopen(q, timeout=30).read()).get('data', {})
            if st.get('status') == 'success':
                url = st.get('output', {}).get('model') or st.get('output', {}).get('pbr_model')
                urllib.request.urlretrieve(url, out_path)
                return 'tripo'
            if st.get('status') in ('failed', 'cancelled'):
                raise RuntimeError('tripo 任务失败: %s' % st.get('status'))
        raise RuntimeError('tripo 超时')
    raise RuntimeError('provider %s 接入待实现（已预留）' % provider)


def handle(body, ctx):
    action = (body or {}).get('action', 'generate')
    if action == 'status':
        avail = [p for p in _PROVIDERS if _find_key(p)]
        ctx.send_json({'ok': True, 'data': {'tool': 'model3d_gen', 'cloud_providers': avail,
                                            'fallback': 'local-placeholder-glb', 'ready': True}})
        return
    prompt = (body or {}).get('prompt', '').strip()
    if not prompt:
        ctx.send_json({'ok': False, 'data': {'error': 'prompt 不能为空'}})
        return
    os.makedirs(_OUTPUT_DIR, exist_ok=True)
    out = os.path.join(_OUTPUT_DIR, 'model_%s_%s.glb' % (
        time.strftime('%Y%m%d_%H%M%S'), os.urandom(3).hex()))
    provider_req = (body.get('provider') or 'auto').lower()
    try:
        used = None
        if provider_req != 'local':
            cands = [provider_req] if provider_req in _PROVIDERS else list(_PROVIDERS)
            for p in cands:
                key = _find_key(p)
                if key:
                    used = _cloud_generate(p, key, prompt, out)
                    break
        if not used:
            _make_placeholder_glb(prompt, out)
            used = 'local-placeholder-glb'
        ctx.send_json({'ok': True, 'data': {
            'tool': 'model3d_gen', 'url': '/outputs/model3d/' + os.path.basename(out),
            'file': os.path.basename(out), 'provider': used,
            'bytes': os.path.getsize(out)}})
    except Exception as e:
        ctx.send_json({'ok': False, 'data': {'error': '3D 生成失败: %s' % e}})


if __name__ == '__main__':
    class _T:
        def send_json(self, o, *a, **k):
            print(json.dumps(o, ensure_ascii=False, indent=2))
    handle({'action': 'generate', 'prompt': '一只可爱的橘猫'}, _T())
