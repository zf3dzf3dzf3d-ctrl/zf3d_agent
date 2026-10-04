# -*- coding: utf-8 -*-
"""
mixin_models_3d.py - 3D 大模型生成代理（多服务商统一入口）
POST /api/models/3d/generate
body: {provider: 'tripo'|'meshy'|'rodin'|'hunyuan', mode, image(dataURL|url), prompt, modelId, format}
- API Key 从公开配置 name=对应服务商配置名 的私有 key 取（private/api_keys.json，经 model_config）。
  面板里可建多条 3D 配置：Tripo 3D 生成 / Meshy 3D 生成 / Rodin 3D 生成 / Hunyuan3D 生成。
  hunyuan 的 key 填法：腾讯云 SecretId:SecretKey（用冒号分隔）。
- 均为异步任务：创建任务 → 同步轮询最多 ~150 秒 → 超时返回 taskId。
- 统一返回：{ok, provider, taskId, status:'success'|'processing', url, previewUrl, format}
"""
import base64
import hashlib
import hmac
import json
import time
import urllib.request

POLL_MAX_SECONDS = 150

PROVIDER_KEY_NAME = {
    'tripo': 'Tripo 3D 生成',
    'meshy': 'Meshy 3D 生成',
    'rodin': 'Rodin 3D 生成',
    'hunyuan': 'Hunyuan3D 生成',
}


def _get_provider_key(provider):
    name = PROVIDER_KEY_NAME.get(provider)
    if not name:
        return None
    from model_config import load_models_config
    try:
        cfg = load_models_config(include_key=True)
    except Exception:
        cfg = None
    items = (cfg or {}).get('list') or (cfg or {}).get('models') or []
    for m in items:
        if isinstance(m, dict) and (m.get('name') == name or m.get('displayName') == name):
            k = str(m.get('key') or m.get('apiKey') or '').strip()
            if k:
                return k
    return None


def _post_json(url, payload, headers, timeout=60):
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'),
                                 headers=dict(headers, **{'Content-Type': 'application/json'}), method='POST')
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def _get_json(url, headers, timeout=30):
    req = urllib.request.Request(url, headers=headers, method='GET')
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def _poll(fn, interval=5):
    """同步轮询，fn 返回 ('success', payload)/('failed', err)/('pending', None)"""
    deadline = time.time() + POLL_MAX_SECONDS
    while time.time() < deadline:
        time.sleep(interval)
        try:
            state, payload = fn()
        except Exception:
            continue
        if state != 'pending':
            return state, payload
    return 'timeout', None


def _validate_common(body):
    """返回 (mode, image, prompt, fmt) 或抛 ValueError"""
    mode = body.get('mode') or 'image2model'
    image = str(body.get('image') or '').strip()
    prompt = str(body.get('prompt') or '').strip()
    fmt = (body.get('format') or 'glb').lower()
    if mode == 'text2model' and not prompt:
        raise ValueError('文生 3D 需要填写描述')
    if mode == 'image2model' and not image:
        raise ValueError('图生 3D 需要上传参考图')
    return mode, image, prompt, fmt


def _img_type(dataurl):
    head = dataurl[:30].lower()
    return 'jpg' if ('jpeg' in head or 'jpg' in head) else 'png'


# ---------------------------------------------------------------- Tripo
def gen_tripo(body, key):
    mode, image, prompt, fmt = _validate_common(body)
    model_id = body.get('modelId') or 'v3.1-20260211'
    payload = {'model': model_id, 'format': fmt}
    headers = {'Authorization': 'Bearer ' + key}
    if mode == 'text2model':
        payload['prompt'] = prompt
        create_url = 'https://openapi.tripo3d.com/v3/generation/text-to-model'
    else:
        if image.startswith('data:'):
            _, _, b64 = image.partition(',')
            payload['image'] = {'type': _img_type(image), 'file_base64': b64}
        else:
            payload['image'] = {'url': image}
        if prompt:
            payload['prompt'] = prompt
        create_url = 'https://openapi.tripo3d.com/v3/generation/image-to-model'
    resp = _post_json(create_url, payload, headers)
    if resp.get('code') not in (0, '0'):
        raise RuntimeError('Tripo 返回错误: %s' % (resp.get('message') or json.dumps(resp, ensure_ascii=False)[:200]))
    task_id = (resp.get('data') or {}).get('task_id') or ''
    if not task_id:
        raise RuntimeError('Tripo 未返回 task_id')

    def check():
        st = _get_json('https://openapi.tripo3d.com/v3/tasks/' + task_id, headers)
        data = st.get('data') or {}
        status = str(data.get('status') or '')
        if status == 'success':
            out = data.get('output') or {}
            return 'success', {'url': out.get('model_url') or out.get('model') or out.get('pbr_model') or '',
                               'previewUrl': out.get('rendered_image_url') or out.get('rendered_image') or out.get('preview') or ''}
        if status in ('failed', 'cancelled', 'banned', 'unknown'):
            return 'failed', 'Tripo 生成失败（%s）: %s' % (status, data.get('message') or '')
        return 'pending', None

    return task_id, fmt, check


# ---------------------------------------------------------------- Meshy
def gen_meshy(body, key):
    mode, image, prompt, fmt = _validate_common(body)
    model_id = body.get('modelId') or 'meshy-5'
    headers = {'Authorization': 'Bearer ' + key}
    if mode == 'text2model':
        url = 'https://api.meshy.ai/openapi/v2/text-to-3d'
        payload = {'mode': 'preview', 'prompt': prompt, 'art_style': 'realistic', 'format': fmt}
        if model_id:
            payload['model'] = model_id
    else:
        url = 'https://api.meshy.ai/openapi/v2/image-to-3d'
        # Meshy 支持 data URI 直接作为 image_url
        payload = {'image_url': image, 'format': fmt}
        if prompt:
            payload['prompt'] = prompt
    resp = _post_json(url, payload, headers)
    task_id = resp.get('result') or ''
    if not task_id:
        raise RuntimeError('Meshy 未返回任务 ID: %s' % json.dumps(resp, ensure_ascii=False)[:200])

    def check():
        st = _get_json(url + '/' + task_id, headers)
        status = str(st.get('status') or '')
        if status == 'SUCCEEDED':
            mu = st.get('model_urls') or {}
            u = mu.get(fmt) or mu.get('glb') or ''
            return 'success', {'url': u, 'previewUrl': mu.get('thumbnail') or st.get('thumbnail_url') or ''}
        if status == 'FAILED':
            return 'failed', 'Meshy 生成失败: %s' % (st.get('task_error') or {})
        return 'pending', None

    return task_id, fmt, check


# ---------------------------------------------------------------- Rodin (Hyper3D)
def gen_rodin(body, key):
    mode, image, prompt, fmt = _validate_common(body)
    headers = {'Authorization': 'Bearer ' + key}
    payload = {'tier': 'Regular'}
    if mode == 'text2model':
        payload['prompt'] = prompt
    else:
        payload['images'] = [image]  # Rodin 接受 dataURI
    resp = _post_json('https://api.hyper3d.com/api/v2/rodin', payload, headers, timeout=120)
    task_id = resp.get('uuid') or ''
    if not task_id:
        raise RuntimeError('Rodin 未返回 uuid: %s' % json.dumps(resp, ensure_ascii=False)[:200])

    def check():
        st = _get_json('https://api.hyper3d.com/api/v2/status?uuid=' + task_id, headers)
        status = str(st.get('status') or '')
        if status == 'Done':
            dl = _post_json('https://api.hyper3d.com/api/v2/download', {'uuid': task_id}, headers)
            lst = dl.get('list') or []
            url = ''
            preview = ''
            for item in lst:
                name = str(item.get('name') or '').lower()
                if name.endswith('.' + fmt) and not url:
                    url = item.get('url') or ''
                if not preview and (name.endswith('.png') or name.endswith('.jpg') or name.endswith('.webp')):
                    preview = item.get('url') or ''
            if not url and lst:
                url = lst[0].get('url') or ''
            return 'success', {'url': url, 'previewUrl': preview}
        if status in ('Failed', 'Error', 'Cancelled'):
            return 'failed', 'Rodin 生成失败（%s）' % status
        return 'pending', None

    return task_id, fmt, check


# ---------------------------------------------------------------- Hunyuan3D（腾讯云，TC3 签名）
def _tc3_signature(secret_id, secret_key, service, action, version, payload, timestamp):
    date = time.strftime('%Y-%m-%d', time.gmtime(timestamp))
    http_method = 'POST'
    canonical_uri = '/'
    canonical_query = ''
    canonical_headers = 'content-type:application/json; charset=utf-8\nhost:%s.tencentcloudapi.com\nx-tc-action:%s\n' % (service, action.lower())
    signed_headers = 'content-type;host;x-tc-action'
    hashed_payload = hashlib.sha256(json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')).hexdigest()
    canonical_request = '\n'.join([http_method, canonical_uri, canonical_query, canonical_headers, signed_headers, hashed_payload])
    hashed_request = hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()
    string_to_sign = '\n'.join(['TC3-HMAC-SHA256', str(timestamp), '%s/%s/tc3_request' % (date, service), hashed_request])
    k_date = hmac.new(('TC3' + secret_key).encode('utf-8'), date.encode('utf-8'), hashlib.sha256).digest()
    k_service = hmac.new(k_date, service.encode('utf-8'), hashlib.sha256).digest()
    k_signing = hmac.new(k_service, 'tc3_request'.encode('utf-8'), hashlib.sha256).digest()
    sig = hmac.new(k_signing, string_to_sign.encode('utf-8'), hashlib.sha256).hexdigest()
    return ('TC3-HMAC-SHA256 Credential=%s/%s/%s/tc3_request, SignedHeaders=%s, Signature=%s'
            % (secret_id, date, service, signed_headers, sig))


def _tc3_call(secret_id, secret_key, service, action, version, payload):
    ts = int(time.time())
    auth = _tc3_signature(secret_id, secret_key, service, action, version, payload, ts)
    headers = {
        'X-TC-Action': action,
        'X-TC-Version': version,
        'X-TC-Timestamp': str(ts),
        'Authorization': auth,
        'Host': '%s.tencentcloudapi.com' % service,
    }
    return _post_json('https://%s.tencentcloudapi.com' % service, payload, headers)


def gen_hunyuan(body, key):
    if ':' not in key:
        raise ValueError('Hunyuan3D 的 Key 需填「SecretId:SecretKey」（冒号分隔）')
    sid, _, skey = key.partition(':')
    mode, image, prompt, fmt = _validate_common(body)
    svc, ver = 'hunyuan', '2023-09-01'
    if mode == 'text2model':
        resp = _tc3_call(sid, skey, svc, 'SubmitHunyuanTo3DJob', ver, {'Prompt': prompt})
    else:
        # 腾讯云接口只接受 COS/TBASE 地址，dataURL 先转 base64 交给临时文件不可行 →
        # 支持公网 URL 直传；dataURL 情况下提示走文生或提供 URL
        if image.startswith('data:'):
            raise ValueError('腾讯混元 3D 的图生模式需要公网图片 URL（暂不支持本地图），可改用文生 3D 或先用图床')
        resp = _tc3_call(sid, skey, svc, 'SubmitHunyuanTo3DJob', ver, {'ImageUrl': image})
    if resp.get('Response', {}).get('Error'):
        raise RuntimeError('Hunyuan3D 返回错误: %s' % resp['Response']['Error'].get('Message'))
    job_id = (resp.get('Response') or {}).get('JobId') or ''
    if not job_id:
        raise RuntimeError('Hunyuan3D 未返回 JobId')

    def check():
        st = _tc3_call(sid, skey, svc, 'QueryHunyuanTo3DJob', ver, {'JobId': job_id})
        d = st.get('Response') or {}
        status = str(d.get('Status') or '')
        if status in ('DONE', 'SUCCESS'):
            res = d.get('ResultFile3Ds') or []
            url = ''
            preview = ''
            for item in res:
                if not url:
                    url = item.get('Url') or ''
                preview = preview or item.get('PreviewImageUrl') or ''
            return 'success', {'url': url, 'previewUrl': preview}
        if status in ('FAILED',):
            return 'failed', 'Hunyuan3D 生成失败: %s' % (d.get('ErrorMessage') or '')
        return 'pending', None

    return job_id, fmt, check


GENERATORS = {'tripo': gen_tripo, 'meshy': gen_meshy, 'rodin': gen_rodin, 'hunyuan': gen_hunyuan}


# ---------------------------------------------------------------- 入口
def handle_3d_generate(handler):
    try:
        body = handler._read_body()
    except Exception:
        handler._send_json({'ok': False, 'err': 'Invalid JSON body'}, 400)
        return
    if not isinstance(body, dict):
        handler._send_json({'ok': False, 'err': 'body 必须是 JSON 对象'}, 400)
        return

    provider = str(body.get('provider') or 'tripo').lower()
    if provider not in GENERATORS:
        handler._send_json({'ok': False, 'err': '不支持的 3D 服务商: %s（可用: %s）' % (provider, ', '.join(GENERATORS))})
        return

    key = _get_provider_key(provider)
    if not key:
        handler._send_json({'ok': False, 'err': '未找到 %s 的 API Key，请到「大模型设置 → 3D」新建该服务商配置并填入 Key' % PROVIDER_KEY_NAME[provider]})
        return

    try:
        task_id, fmt, check = GENERATORS[provider](body, key)
    except ValueError as e:
        handler._send_json({'ok': False, 'err': str(e)})
        return
    except Exception as e:
        handler._send_json({'ok': False, 'err': '%s 请求失败: %s' % (provider, e)}, 502)
        return

    state, payload = _poll(check)
    if state == 'success':
        handler._send_json({'ok': True, 'provider': provider, 'taskId': task_id, 'status': 'success',
                            'format': fmt, 'url': payload.get('url', ''), 'previewUrl': payload.get('previewUrl', '')})
    elif state == 'failed':
        handler._send_json({'ok': False, 'err': payload, 'provider': provider})
    else:
        handler._send_json({'ok': True, 'provider': provider, 'taskId': task_id, 'status': 'processing',
                            'format': fmt,
                            'message': '任务已提交且仍在生成中，请稍后重新点击生成或到服务商控制台查询（任务号 %s）' % task_id})
