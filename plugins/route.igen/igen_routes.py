# -*- coding: utf-8 -*-
"""i模型生成（igen）M1-v4：ComfyUI(8188) HTTP 桥接层。

真源：
- 策划案 v5.1（public/项目记录/i模型生成/策划案v5.1.md）
- M0.5 模型配对真源（project_record「i模型生成-M0.5链路验证通过」）：
  qwen_image 链 = UNETLoader(qwen_image_2512_fp8_e4m3fn)
                + CLIPLoader(qwen_2.5_vl_7b_fp8_scaled, type=qwen_image)
                + VAELoader(qwen_image_vae)
                + KSampler(euler/simple/steps20/cfg2.5)

接口（异步任务模型：submit 立即返回 prompt_id，前端/AI 轮询 status）：
  POST /api/igen/generate  {prompt, width?, height?, steps?, cfg?, seed?}
       -> {ok, prompt_id}；vram_free<6GB 或队列满时拒单
  GET  /api/igen/status?prompt_id=xxx
       -> {ok, done, file?}；done 时图已落盘 private/igen/<日期>/

红线（策划案 v5.1）：
- 图只落 private/igen/（HTTP 不可直读，读图走既有 private 代理或 igen/file）
- 显存拒单阈值 6GB；与用户已有 ComfyUI 任务共存（FIFO 排队，不硬抢）
- 只调本机 8188，不接受外部 URL
"""
import os
import json
import time
import random
import urllib.request
import subprocess
from urllib.parse import parse_qs, urlencode

from routes.dispatcher import route_post, route_get

from util_log import get_logger

log = get_logger('igen_routes')
# 插件路径适配（T2.4 批量）：副本位于 plugins/route.igen/，重指 __file__ 到源路径，
# 使全部 dirname 链（server/routes → server → 项目根）与源文件语义一致，逻辑零改动
__file__ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'server', 'routes', 'domain_igen.py')

COMFY = 'http://127.0.0.1:8188'
IGEN_ROOT = os.path.normpath(os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'private', 'igen'))
VRAM_MIN_FREE = 6 * 1024 * 1024 * 1024  # 6GB 默认拒单阈值（M0.5 实测定）
# 2026-11-17 分模型阈值：ComfyUI 会自动 offload，小模型（qwen 20步 fp8）实测低显存也能出图；
# 用户显存常年只剩 1~2GB，统一 6GB 阈值等于永久拒单。按模型配阈值，未列出的走默认。
VRAM_MIN_BY_MODEL = {
    'qwen2512': 1 * 1024 * 1024 * 1024,   # 快速小模型：1GB
    'zimage': 2 * 1024 * 1024 * 1024,     # 质量型：2GB
}
MAX_DIM = 2048
MIN_DIM = 256

# ---- M0.5 实测模型配对真源（勿改，改前先在 ComfyUI object_info 复核）
# 2026-11-16 M1 修复：object_info 实测枚举值带 .safetensors 后缀，/prompt 校验精确匹配，缺后缀=400 Bad Request
# 2026-11-17 多模型：文生图模型清单（dir D:\ComfyUI_models\diffusion_models 实查在位；z_image 与 qwen 共用 Qwen2.5-VL 文本编码器 + qwen_image_vae）
T2I_MODELS = {
    'qwen2512': {
        'label': 'Qwen 2512（快速·推荐）',
        'unet': 'qwen_image_2512_fp8_e4m3fn.safetensors',
        'clip': 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
        'clip_type': 'qwen_image',
        'vae': 'qwen_image_vae.safetensors',
        'steps': 20, 'cfg': 2.5,
    },
    'zimage': {
        'label': 'Z-Image Turbo（高速·质量佳）',
        'unet': 'z_image_turbo_bf16.safetensors',
        'clip': 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
        'clip_type': 'qwen_image',
        'vae': 'qwen_image_vae.safetensors',
        'steps': 8, 'cfg': 2.5,
    },
}
MODEL_UNET = 'qwen_image_2512_fp8_e4m3fn.safetensors'
MODEL_CLIP = 'qwen_2.5_vl_7b_fp8_scaled.safetensors'
MODEL_VAE = 'qwen_image_vae.safetensors'


def _comfy_get(path, timeout=8):
    with urllib.request.urlopen(COMFY + path, timeout=timeout) as r:
        return json.load(r)


def _comfy_post(path, obj, timeout=15):
    data = json.dumps(obj).encode('utf-8')
    req = urllib.request.Request(COMFY + path, data=data,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


COMFY_DIR = r'D:\ComfyUI-H3\ComfyUI_windows_portable'
COMFY_BAT = os.path.normpath(os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'public', '项目记录', '启动ComfyUI_no_cuda_graph.bat'))
_auto_starting = False


def _ensure_comfy_alive():
    """8188 不在线时自动拉起 ComfyUI（用户零手动）。最多等 180 秒。

    成功返回 None；失败返回 err 字符串。并发请求只起一次（_auto_starting 闸）。
    """
    global _auto_starting
    try:
        _comfy_get('/system_stats', timeout=3)
        return None  # 已在线
    except Exception:
        pass
    if _auto_starting:
        return 'ComfyUI 正在自动启动中，请 30 秒后重试'
    _auto_starting = True
    try:
        log.info('[igen] 8188 不可达，自动启动 ComfyUI ...')
        bat = COMFY_BAT if os.path.exists(COMFY_BAT) else 'run_nvidia_gpu.bat'
        subprocess.Popen(bat, cwd=COMFY_DIR,
                         creationflags=subprocess.CREATE_NEW_CONSOLE)
        for _ in range(60):  # 最多等 180 秒
            time.sleep(3)
            try:
                _comfy_get('/system_stats', timeout=3)
                log.info('[igen] ComfyUI 自动启动完成')
                return None
            except Exception:
                continue
        return 'ComfyUI 自动启动超时（180 秒），请手动检查 %s' % COMFY_DIR
    except Exception as e:
        return 'ComfyUI 自动启动失败: %s' % e
    finally:
        _auto_starting = False


def _precheck(model_key='qwen2512'):
    """红线检查：ComfyUI 在线（不在线自动拉起）+ 显存余量（按模型阈值）。返回 None 或 err_str。"""
    alive_err = _ensure_comfy_alive()
    if alive_err:
        return alive_err
    try:
        st = _comfy_get('/system_stats')
    except Exception as e:
        return 'ComfyUI(8188) 不可达: %s' % e
    try:
        vram = st['devices'][0].get('vram_free', 0)
    except Exception:
        vram = 0
    need = VRAM_MIN_BY_MODEL.get(model_key, VRAM_MIN_FREE)
    if vram < need:
        # 2026-11-17: 显存不够时先让 ComfyUI 卸载缓存模型再重测，而不是直接拒单。
        # ComfyUI 会把跑过的模型常驻显存/内存缓存（--cache-none 也只管部分），
        # POST /free 能主动释放；释放后 qwen 小模型在 1GB 级余量也能跑。
        try:
            _comfy_post('/free', {'unload_models': True, 'free_memory': True})
            import time as _t
            _t.sleep(2)
            st2 = _comfy_get('/system_stats')
            vram = st2['devices'][0].get('vram_free', 0)
            log.info('[igen precheck] 显存不足已触发 /free 释放: %.2fGB -> %.2fGB' % (
                st['devices'][0].get('vram_free', 0) / 1e9, vram / 1e9))
        except Exception as e:
            log.error('[igen precheck] /free 释放失败: %s' % e)
        if vram < need:
            return '显存不足：free=%.1fGB < %.1fGB(%s) 拒单阈值' % (
                vram / 1e9, need / 1e9, model_key)
    try:
        q = _comfy_get('/queue')
        if len(q.get('queue_running', [])) + len(q.get('queue_pending', [])) >= 8:
            return 'ComfyUI 队列拥堵（>=8），稍后再试'
    except Exception as e:
        # 队列检查是软闸门：/queue 短暂异常时放行（不拒单），
        # 与上面显存检查的保守策略（异常→拒单）有意不同：显存爆了会炸任务，队列查不到只会多排队。
        log.error('[igen precheck] /queue 查询失败，软放行: %s' % e)
    return None


def _build_workflow(prompt, width, height, steps, cfg, seed, model_key='qwen2512'):
    """文生图链（M0.5 实测配对真源）。model_key 见 T2I_MODELS。"""
    mc = T2I_MODELS.get(model_key) or T2I_MODELS['qwen2512']
    return {
        '1': {'class_type': 'UNETLoader', 'inputs': {
            'unet_name': mc['unet'], 'weight_dtype': 'default'}},
        '2': {'class_type': 'CLIPLoader', 'inputs': {
            'clip_name': mc['clip'], 'type': mc['clip_type'], 'device': 'default'}},
        '3': {'class_type': 'VAELoader', 'inputs': {'vae_name': MODEL_VAE}},
        '4': {'class_type': 'CLIPTextEncode', 'inputs': {
            'text': prompt, 'clip': ['2', 0]}},
        '5': {'class_type': 'CLIPTextEncode', 'inputs': {'text': '', 'clip': ['2', 0]}},
        '6': {'class_type': 'EmptySD3LatentImage', 'inputs': {
            'width': width, 'height': height, 'batch_size': 1}},
        '7': {'class_type': 'KSampler', 'inputs': {
            'model': ['1', 0], 'positive': ['4', 0], 'negative': ['5', 0],
            'latent_image': ['6', 0], 'seed': seed, 'steps': steps,
            'cfg': cfg, 'sampler_name': 'euler', 'scheduler': 'simple',
            'denoise': 1.0}},
        '8': {'class_type': 'VAEDecode', 'inputs': {
            'samples': ['7', 0], 'vae': ['3', 0]}},
        '9': {'class_type': 'SaveImage', 'inputs': {
            'images': ['8', 0], 'filename_prefix': 'igen'}},
    }


def _fetch_history(prompt_id):
    """查 /history。返回 (entry或None, err)。entry=None+err=None 表示任务未完成。"""
    try:
        hist = _comfy_get('/history/%s' % prompt_id)
    except Exception as e:
        return None, 'history 查询失败: %s' % e
    entry = hist.get(prompt_id)
    if not entry:
        return None, None  # 未完成，非错误
    return entry, None


def _download_output(entry, prompt_id, date_dir):
    """下载产物第一张到 date_dir。返回 (rel_path, err)。"""
    outs = (entry.get('outputs') or {}).get('9', {}).get('images') or []
    if not outs:
        status = (entry.get('status') or {})
        if status.get('status_str') == 'error':
            msgs = json.dumps(status.get('messages', []), ensure_ascii=False)[:500]
            return None, '生成失败(ComfyUI status=error): %s' % msgs
        return None, None
    im = outs[0]  # batch_size=1，只取第一张
    fn, sub = im.get('filename'), im.get('subfolder', '')
    if not fn:
        return None, None
    qs = urlencode({'filename': fn, 'subfolder': sub, 'type': im.get('type', 'output')})
    try:
        with urllib.request.urlopen(COMFY + '/view?' + qs, timeout=30) as r:
            blob = r.read()
    except Exception as e:
        return None, '下载产物失败: %s' % e
    os.makedirs(date_dir, exist_ok=True)
    final_path = os.path.join(date_dir, '%s_%s' % (prompt_id[:8], fn))
    tmp_path = final_path + '.part'
    with open(tmp_path, 'wb') as f:
        f.write(blob)
    os.replace(tmp_path, final_path)  # 原子改名：.part 半文件永不会被前缀短路探测误认为完整图
    return os.path.relpath(final_path, IGEN_ROOT).replace('\\', '/'), None


# ---------- POST /api/igen/generate ----------
@route_post('/api/igen/generate')
def _h_generate(handler, path, parsed):
    try:
        body = handler._read_body() or {}
        prompt = str(body.get('prompt') or '').strip()[:2000]
        if not prompt:
            handler._send_json({'ok': False, 'err': 'need prompt'}, 400)
            return
        width = int(body.get('width') or 1024)
        height = int(body.get('height') or 1024)
        steps = max(1, min(int(body.get('steps') or 20), 50))
        cfg = min(max(float(body.get('cfg') or 2.5), 1.0), 12.0)
        seed = body.get('seed')
        if seed in (None, ''):
            seed = random.randint(0, 2**53)
        else:
            seed = int(seed)
            if not (0 <= seed < 2**53):
                handler._send_json({'ok': False,
                                    'err': 'seed 须在 0 ~ 2^53 之间，收到 %s' % seed}, 400)
                return
        # 尺寸取 64 倍数并限幅
        width = min(max(width // 64 * 64, MIN_DIM), MAX_DIM)
        height = min(max(height // 64 * 64, MIN_DIM), MAX_DIM)
        # 模型选择（默认 qwen2512）
        model_key = str(body.get('model') or 'qwen2512')
        if model_key not in T2I_MODELS:
            handler._send_json({'ok': False,
                                'err': '未知模型 %s，可选: %s' % (model_key, ', '.join(T2I_MODELS))}, 400)
            return
        mc = T2I_MODELS[model_key]
        # 未显式传 steps/cfg 时用该模型的推荐值
        if body.get('steps') in (None, ''):
            steps = mc['steps']
        if body.get('cfg') in (None, ''):
            cfg = mc['cfg']

        err = _precheck(model_key)
        if err:
            handler._send_json({'ok': False, 'err': err, 'suggest': '等显存释放或排队后再试'}, 503)
            return
        wf = _build_workflow(prompt, width, height, steps, cfg, seed, model_key)
        res = _comfy_post('/prompt', {'prompt': wf, 'client_id': 'igen_bridge'})
        pid = res.get('prompt_id')
        if not pid:
            handler._send_json({'ok': False, 'err': 'ComfyUI 未返回 prompt_id: %s' % json.dumps(res, ensure_ascii=False)[:300]}, 502)
            return
        log.info('[POST /api/igen/generate] prompt_id=%s %dx%d steps=%d cfg=%.1f seed=%d'
              % (pid, width, height, steps, cfg, seed))
        handler._send_json({'ok': True, 'prompt_id': pid, 'width': width,
                            'height': height, 'steps': steps, 'cfg': cfg,
                            'seed': seed, 'poll': '/api/igen/status?prompt_id=%s' % pid})
    except Exception as e:
        log.info('[POST /api/igen/generate] 500: %s' % e)
        handler._send_json({'ok': False, 'err': str(e)}, 500)


# ---------- GET /api/igen/status?prompt_id=xxx ----------
@route_get('/api/igen/status')
def _h_status(handler, path, parsed):
    try:
        qs = parse_qs(parsed.query)
        pid = (qs.get('prompt_id') or [''])[0]
        if not pid or not all(c.isalnum() or c == '-' for c in pid):
            handler._send_json({'ok': False, 'err': 'need valid prompt_id'}, 400)
            return
        date_dir = os.path.join(IGEN_ROOT, time.strftime('%Y-%m-%d'))
        prefix = '%s_' % pid[:8]
        # 防重下载：已落盘的 pid 直接返回，不再重复 /history+/view IO
        done_prefix_hit = None
        try:
            for name in os.listdir(date_dir):
                if name.startswith(prefix) and not name.endswith('.part'):  # .part 半文件不算完成图
                    done_prefix_hit = os.path.relpath(
                        os.path.join(date_dir, name), IGEN_ROOT).replace('\\', '/')
                    break
        except OSError:
            pass  # 日期目录尚不存在 = 肯定没落盘，继续正常轮询
        if done_prefix_hit:
            handler._send_json({'ok': True, 'done': True, 'file': done_prefix_hit,
                                'bytes': os.path.getsize(os.path.join(IGEN_ROOT, done_prefix_hit))})
            return
        entry, err = _fetch_history(pid)
        if err:
            handler._send_json({'ok': False, 'done': True, 'err': err}, 200)
            return
        if entry:
            rel, derr = _download_output(entry, pid, date_dir)
            if derr:
                handler._send_json({'ok': False, 'done': True, 'err': derr}, 200)
                return
            if rel:
                handler._send_json({'ok': True, 'done': True, 'file': rel,
                                    'bytes': os.path.getsize(os.path.join(IGEN_ROOT, rel))})
                return
        # 未完成：报排队位置
        q = _comfy_get('/queue')
        running = [x[1] for x in q.get('queue_running', [])]
        pending = [x[1] for x in q.get('queue_pending', [])]
        pos = pending.index(pid) + 1 if pid in pending else 0
        handler._send_json({'ok': True, 'done': False,
                            'running': pid in running, 'queue_pos': pos})
    except Exception as e:
        log.info('[GET /api/igen/status] 500: %s' % e)
        handler._send_json({'ok': False, 'err': str(e)}, 500)


# ---------- GET /api/igen/models ----------
@route_get('/api/igen/models')
def _h_models(handler, path, parsed):
    """文生图模型清单（前端下拉用）。"""
    handler._send_json({'ok': True, 'models': [
        {'key': k, 'label': v['label'], 'steps': v['steps'], 'cfg': v['cfg']}
        for k, v in T2I_MODELS.items()]})


# ---------- GET /api/igen/history ----------
@route_get('/api/igen/history')
def _h_history(handler, path, parsed):
    """历史产物列表（新→旧），前端缩略图列表用。"""
    try:
        qs = parse_qs(parsed.query)
        limit = min(max(int((qs.get('limit') or ['60'])[0]), 1), 200)
        items = []
        try:
            days = sorted(os.listdir(IGEN_ROOT), reverse=True)
        except OSError:
            days = []
        for day in days:
            ddir = os.path.join(IGEN_ROOT, day)
            if not os.path.isdir(ddir):
                continue
            try:
                names = sorted(os.listdir(ddir), reverse=True)
            except OSError:
                continue
            for name in names:
                if name.endswith('.part'):
                    continue
                fp = os.path.join(ddir, name)
                if not os.path.isfile(fp):
                    continue
                ext = os.path.splitext(name)[1].lower()
                if ext not in ('.png', '.jpg', '.jpeg', '.webp', '.gif'):
                    continue
                items.append({
                    'rel': day + '/' + name,
                    'bytes': os.path.getsize(fp),
                    'mtime': int(os.path.getmtime(fp)),
                })
                if len(items) >= limit:
                    break
            if len(items) >= limit:
                break
        items.sort(key=lambda x: -x['mtime'])
        handler._send_json({'ok': True, 'items': items[:limit]})
    except Exception as e:
        log.info('[GET /api/igen/history] 500: %s' % e)
        handler._send_json({'ok': False, 'err': str(e)}, 500)


# ---------- GET /api/igen/image?rel=2026-11-17/xxx.png ----------
@route_get('/api/igen/image')
def _h_image(handler, path, parsed):
    """private/igen 产物图代理读：严格限制在 private/igen/ 内，../ 越权 403。"""
    try:
        qs = parse_qs(parsed.query)
        rel = (qs.get('rel') or [''])[0].replace('\\', '/')
        if not rel or '..' in rel.split('/'):
            handler._send_json({'ok': False, 'err': 'bad rel'}, 400)
            return
        target = os.path.normpath(os.path.join(IGEN_ROOT, rel))
        if not target.startswith(IGEN_ROOT + os.sep):
            handler._send_json({'ok': False, 'err': 'path traversal denied'}, 403)
            return
        if not os.path.isfile(target):
            handler._send_json({'ok': False, 'err': 'file not found'}, 404)
            return
        with open(target, 'rb') as f:
            blob = f.read()
        ext = os.path.splitext(target)[1].lower()
        ctype = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
                 'webp': 'image/webp', 'gif': 'image/gif'}.get(ext.lstrip('.'),
                 'application/octet-stream')
        handler.send_response(200)
        handler.send_header('Content-Type', ctype)
        handler.send_header('Content-Length', str(len(blob)))
        handler.send_header('Cache-Control', 'private, max-age=3600')
        handler.end_headers()
        handler.wfile.write(blob)
    except Exception as e:
        log.info('[GET /api/igen/image] 500: %s' % e)
        try:
            handler._send_json({'ok': False, 'err': str(e)}, 500)
        except Exception:
            pass
