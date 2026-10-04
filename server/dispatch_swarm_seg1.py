# -*- coding: utf-8 -*-
# 拆分分段模块：由原 dispatch_swarm.py 按行段【无改动】切分，由同名门面加载合并。
# -*- coding: utf-8 -*-
"""
dispatch_swarm.py - 对话内并发子任务派发（蜂群）
- 单对话内部派发：不开新对话、不建流程图节点
- 主控一次 submit N 个子任务 → ThreadPoolExecutor 并发调 LLM → collect 统一回收
- 纯内存任务表（进程内），带简单 GC 防膨胀
"""
import os
import time
import uuid
import threading
from concurrent.futures import ThreadPoolExecutor

from config import BASE_DIR

# 并发上限（同一时间在跑的子任务数）
MAX_WORKERS = 6
# 保留的最近批次数量（防内存膨胀）
MAX_BATCHES = 30
# 单个子任务 LLM 超时（秒）
TASK_TIMEOUT = 300

_LOCK = threading.Lock()
_COND = threading.Condition(_LOCK)
_BATCHES = {}          # batch_id -> {status, tasks:[...], created_at, done_count}

# ---- batch state persistence: data/swarm_state/batch-<id>.json ----
_SWARM_STATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'swarm_state')

def _persist_batch(batch_id):
    try:
        import json as _json
        os.makedirs(_SWARM_STATE_DIR, exist_ok=True)
        b = _BATCHES.get(batch_id)
        if not b:
            return
        with open(os.path.join(_SWARM_STATE_DIR, 'batch-%s.json' % batch_id), 'w', encoding='utf-8') as f:
            _json.dump({'batch_id': batch_id, 'status': b.get('status'),
                        'created_at': str(b.get('created_at')),
                        'tasks': [{'id': t.get('id'), 'goal': str(t.get('goal'))[:100], 'status': t.get('status')}
                                  for t in b.get('tasks', [])]}, f, ensure_ascii=False)
    except Exception:
        pass

def _recover_batches_on_boot():
    """mark running batches/tasks as lost on boot so they can be resubmitted."""
    try:
        import glob as _glob, json as _json
        for fp in _glob.glob(os.path.join(_SWARM_STATE_DIR, 'batch-*.json')):
            try:
                d = _json.load(open(fp, encoding='utf-8'))
                changed = False
                if d.get('status') == 'running':
                    d['status'] = 'lost'; changed = True
                for t in d.get('tasks', []):
                    if t.get('status') in ('running', 'pending'):
                        t['status'] = 'lost'; changed = True
                if changed:
                    _json.dump(d, open(fp, 'w', encoding='utf-8'), ensure_ascii=False)
            except Exception:
                continue
    except Exception:
        pass

_recover_batches_on_boot()
_EXECUTOR = ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix='swarm')


# ---------- 模型调用（直调 OpenAI 兼容接口） ----------

def _resolve_model(model_name=None):
    import sys, os
    if BASE_DIR not in sys.path:
        sys.path.insert(0, BASE_DIR)
    import model_config as mc
    cfg = mc.load_models_config(include_key=True)
    items = cfg.get('list', [])
    m = None
    if model_name:
        m = next((x for x in items if x.get('name') == model_name), None)
        if not m:
            raise RuntimeError('未找到模型: %s' % model_name)
    if not m:
        m = mc.get_default_model()
    if not m:
        raise RuntimeError('未配置任何大模型')
    key = m.get('key') or m.get('apiKey') or ''
    base = (m.get('baseUrl') or m.get('baseURL') or m.get('apiUrl') or '').rstrip('/')
    if base.endswith('/chat/completions'):
        base = base[:-len('/chat/completions')]
    return {'name': m.get('name'), 'model_id': m.get('modelId'),
            'key': key, 'base': base}


def _post_chat(url, payload, key, timeout):
    """带网络抖动重试的 POST：超时/连接错误/5xx/429 指数退避重试，彻底抗抖动。"""
    import requests
    last_err = None
    for attempt in range(4):   # 1 次正常 + 3 次抖动重试（2s/4s/8s 退避）
        try:
            r = requests.post(
                url,
                json=payload,
                headers={'Authorization': 'Bearer ' + key},
                timeout=timeout)
            if r.status_code in (429, 500, 502, 503, 504) and attempt < 3:
                last_err = RuntimeError('HTTP %s' % r.status_code)
                time.sleep(2 * (2 ** attempt))
                continue
            return r
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError,
                requests.exceptions.ChunkedEncodingError) as e:
            last_err = e
            if attempt < 3:
                time.sleep(2 * (2 ** attempt))
                continue
            raise
    raise last_err or RuntimeError('请求失败')


def _chat(model, messages, timeout=TASK_TIMEOUT, max_tokens=16384, temperature=0.3, retry=3):
    import requests
    payload = {'model': model['model_id'], 'messages': messages,
               'temperature': temperature, 'max_tokens': max_tokens}
    for attempt in range(retry + 1):
        try:
            r = _post_chat(model['base'] + '/chat/completions', payload,
                           model['key'], timeout)
        except Exception:
            if attempt >= retry:
                raise
            time.sleep(3)
            continue
        if r.status_code == 400 and attempt < retry:
            # 可能不认识某参数，去掉附加参数重试
            payload = {k: payload[k] for k in ('model', 'messages', 'temperature', 'max_tokens')}
            continue
        r.raise_for_status()
        ch = r.json()['choices'][0]
        msg = ch['message'] or {}
        content = msg.get('content') or ''
        if not content.strip():
            # 推理模型可能把答案放在 reasoning_content 里，兜底取出（去掉思维链样式行）
            rc = msg.get('reasoning_content') or ''
            if rc.strip():
                content = rc
        if content.strip() or attempt >= retry:
            return content  # empty on last try: caller has text-summary fallback
        # 空回复（思考模型 token 被 reasoning 吃光），关思考+加倍重试
        payload['thinking'] = {'type': 'disabled'}
        payload['max_tokens'] = min(payload['max_tokens'] * 2, 32768)


# ---------- 赛道选模（加强版） ----------
# 赛道：strong=推理/旗舰赛道（重活），fast=轻快赛道（轻活），auto=按任务启发式自动分配。
# 同一个蜂巢批次里，重活走强模型、轻活走快模型，既保质量又提整体收敛速度。

_TRACK_KEYWORDS = {
    'fast': ('fast', 'mini', 'flash', 'lite', 'turbo', 'air', 'instant', '小', '快', '轻'),
    'strong': ('pro', 'max', 'plus', 'opus', 'thinking', 'reasoner', 'r1', 'o1', 'o3', 'o4',
               'deepseek', ' reasoning', '大', '强', '旗舰'),
}

# 重任务启发式关键词（命中 → strong 赛道）
_HEAVY_GOAL_KEYWORDS = (
    '架构', '设计', '审查', '评审', '重构', '分析', '规划', '方案', '推理', '算法',
    '调试', '排查', '定位', '根因', '安全', '优化', '对比', '评估', '总结全局', '综述',
)


_TRACK_CFG_CACHE = None   # (timestamp, names) 赛道选模的模型名缓存，10s 内复用


def _pick_model_by_track(track=None, goal=''):
    """按赛道从当前「可见即可通」的已启用语言模型里直接挑一个名字。
    只做本地配置匹配，不发任何网络探测/连通性测试（可见的模型默认可通）。
    选不到返回 None（走默认模型）。带 10s 配置缓存，避免每个子任务重复读盘。
    """
    try:
        import model_config as mc
        global _TRACK_CFG_CACHE
        now = time.time()
        names = None
        with _LOCK:
            hit = _TRACK_CFG_CACHE
            if hit and now - hit[0] < 10:
                names = hit[1]
        if names is None:
            cfg = mc.load_models_config()
            # 「可见即可通」：已启用、语言类型、有接口地址、非图像生成 —— 与 mixin_models 的可用口径一致
            names = [m.get('name') or '' for m in cfg.get('list', [])
                     if m.get('enabled') and m.get('modelType', 'language') == 'language'
                     and (m.get('baseUrl') or m.get('baseURL') or m.get('endpoint') or m.get('apiUrl'))
                     and not m.get('imageGen')]
            with _LOCK:
                _TRACK_CFG_CACHE = (now, names)
        if not names:
            return None
        track = (track or 'auto').lower()
        if track == 'auto':
            g = (goal or '')
            heavy = len(g) > 600 or any(k in g for k in _HEAVY_GOAL_KEYWORDS)
            track = 'strong' if heavy else 'fast'
        # 名称匹配不上时用 modelId 再匹配一轮（如 modelId 含 flash/mini/7b 等词）
        import model_config as mc2
        pairs = []  # (name, name+modelId 小写)
        for m in mc2.load_models_config().get('list', []):
            nm = m.get('name') or ''
            if nm in names:
                pairs.append((nm, (nm + ' ' + (m.get('modelId') or m.get('version') or '')).lower()))
        kws = _TRACK_KEYWORDS.get(track or 'fast', ())
        cands = [nm for nm, hay in pairs if any(k in hay for k in kws)]
        if cands:
            # fast 赛道选名字+id最短的（通常最轻快）；strong 按配置顺序（排前面的通常是旗舰）
            return sorted(cands, key=len)[0] if track == 'fast' else cands[0]
        # 兜底（仍不轮询）：fast → 硅基流动 Qwen 小模型优先，否则默认模型；strong → DeepSeek 优先，否则默认模型
        if track == 'fast':
            for nm in names:
                if '硅基' in nm or 'qwen' in nm.lower():
                    return nm
            return None
        for nm in names:
            if 'deepseek' in nm.lower():
                return nm
        return None
    except Exception:
        return None


def _fallback_models(cur_name):
    """仲裁备用模型序列：同 provider 优先，语言模型，排除当前与视觉/语音类。"""
    try:
        import model_config as mc
        cfg = mc.load_models_config()
        out, seen = [], {cur_name}
        for m in cfg.get('list', []):
            n = m.get('name')
            if (n and n not in seen and m.get('enabled')
                    and m.get('modelType', 'language') == 'language'
                    and '向量化' not in n and '语音' not in n and '视频' not in n
                    and '识图' not in n and '生图' not in n and '视觉' not in n):
                out.append(n)
                seen.add(n)
        return out[:3]
    except Exception:
        return []


# ---------- 小弟工具集 ----------
# v5.2.3：小弟从"极简 5 工具"升级为"朱峰底层全工具"——直接复用主控注册表
# （engines/codex_style 的 tool registry），schema 给模型、执行走 reg.execute。
# 注册表不可用时回退内置极简工具（SWARM_MINI_TOOLS + _exec_tool）。

SWARM_MINI_TOOLS = [
    {'type': 'function', 'function': {
        'name': 'read_file', 'description': '读取文本文件内容',
        'parameters': {'type': 'object', 'properties': {
            'path': {'type': 'string', 'description': '相对路径'}},
            'required': ['path']}}},
    {'type': 'function', 'function': {
        'name': 'write_file', 'description': '写入文本文件（覆盖）',
        'parameters': {'type': 'object', 'properties': {
            'path': {'type': 'string'}, 'content': {'type': 'string'}},
            'required': ['path', 'content']}}},
    {'type': 'function', 'function': {
        'name': 'list_dir', 'description': '列出目录内容',
        'parameters': {'type': 'object', 'properties': {
            'path': {'type': 'string', 'description': '相对路径，默认.'},
            'max_count': {'type': 'integer', 'description': '最多条数，默认100'}},
            'required': []}}},
    {'type': 'function', 'function': {
        'name': 'search_files', 'description': '在目录中搜索关键词，返回 文件:行号:内容',
        'parameters': {'type': 'object', 'properties': {
            'path': {'type': 'string', 'description': '相对路径，默认.'},
            'pattern': {'type': 'string', 'description': '要搜的关键词'},
            'ext': {'type': 'string', 'description': '仅搜此扩展名如 .py'}},
            'required': ['pattern']}}},
    {'type': 'function', 'function': {
        'name': 'run_code', 'description': '运行 shell 命令并返回输出',
        'parameters': {'type': 'object', 'properties': {
            'code': {'type': 'string'}}, 'required': ['code']}}},
    # 【2026-10-01 修复】智能体广场三工具（发帖失败"未知工具"）
    {'type': 'function', 'function': {
        'name': 'forum_read', 'description': '读取智能体广场帖子列表或单帖全文。post_id>0 读单帖；keyword 过滤关键词。',
        'parameters': {'type': 'object', 'properties': {
            'topic': {'type': 'string'}, 'post_id': {'type': 'integer'}, 'keyword': {'type': 'string'}},
            'required': []}}},
    {'type': 'function', 'function': {
        'name': 'forum_write', 'description': '在智能体广场发新帖（纯文本≤5000字）。topic 为话题标记。',
        'parameters': {'type': 'object', 'properties': {
            'topic': {'type': 'string'}, 'body': {'type': 'string'}, 'trace_id': {'type': 'string'}},
            'required': ['body']}}},
    {'type': 'function', 'function': {
        'name': 'forum_reply', 'description': '回帖指定广场帖子（纯文本）。',
        'parameters': {'type': 'object', 'properties': {
            'post_id': {'type': 'integer'}, 'body': {'type': 'string'}, 'trace_id': {'type': 'string'}},
            'required': ['post_id', 'body']}}},
    # 【2026-10-02】图片工作台 AI 工具（识图修图一句话完成）
    {'type': 'function', 'function': {
        'name': 'wb_list', 'description': '列出图片工作台可用图像工具（裁剪/缩放/放大/去背/换色/水印等）。',
        'parameters': {'type': 'object', 'properties': {}}, 'required': []}},
    {'type': 'function', 'function': {
        'name': 'wb_apply', 'description': '对图片执行工作台工具（放大/去背/水印/裁剪等），返回结果图URL并自动回贴用户工作台画布。image 传 dataURL 或本地路径。',
        'parameters': {'type': 'object', 'properties': {
            'tool': {'type': 'string'}, 'image': {'type': 'string'},
            'params': {'type': 'object'}},
            'required': ['tool', 'image']}}},
]

_SWARM_WORKDIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_SWARM_TIMEOUT = 120   # 单工具超时
_MAX_TOOL_ROUNDS = 16  # 小弟最多连续调几轮工具（原8，放宽以减少半途截断导致的返工）
_MAX_OUTPUT_CHARS = 16000  # 工具结果截断长度

# ---------- 对话框工具桥（2026-09-15）----------
# 蜂巢子智能体不再维护自己的极简工具集，直接复用对话框的整套工具：
#   schema 来源：public/js/tools-defs-*.js（与主控对话框同一份定义，单一事实源）
#   执行来源：tools/ 注册表（tools/{minimal,coding,writing,vision}/backend/*.py），
#   通过 mock handler + ToolContext 桥接，和 HTTP /api/tools/* 完全同一条代码路径。
_DIALOG_EXCLUDE = {
    'task_complete', 'switch_tool_category', 'ask_user', 'task_list',
    'plan_batch', 'long_plan', 'get_tool_result',
    'swarm_dispatch', 'swarm_collect',
}
_DIALOG_TOOL_CACHE = {'defs': None}


def _load_dialog_tool_defs():
    """解析前端 tools-defs-*.js，取与对话框一致的工具 schema（带缓存）。"""
    if _DIALOG_TOOL_CACHE['defs'] is not None:
        return _DIALOG_TOOL_CACHE['defs']
    import io as _io
    import re as _re
    import json as _json
    defs_dir = os.path.join(_SWARM_WORKDIR, 'public', 'js')
    tools = {}
    try:
        for fn in sorted(os.listdir(defs_dir)):
            if not (fn.startswith('tools-defs-') and fn.endswith('.js')):
                continue
            _src = _io.open(os.path.join(defs_dir, fn), encoding='utf-8',
                            errors='replace').read()
            for m in _re.finditer(r'"([a-zA-Z][\w-]{2,60})"\s*:\s*\{\s*"type"\s*:\s*"function"', _src):
                name = m.group(1)
                if name in tools or name in _DIALOG_EXCLUDE:
                    continue
                start = _src.index('{', m.start())
                depth, i2, in_str, esc = 0, start, False, False
                while i2 < len(_src):
                    ch = _src[i2]
                    if in_str:
                        if esc:
                            esc = False
                        elif ch == '\\':
                            esc = True
                        elif ch == '"':
                            in_str = False
                    else:
                        if ch == '"':
                            in_str = True
                        elif ch == '{':
                            depth += 1
                        elif ch == '}':
                            depth -= 1
                            if depth == 0:
                                break
                    i2 += 1
                try:
                    obj = _json.loads(_src[start:i2 + 1])
                    if isinstance(obj, dict) and obj.get('function', {}).get('name'):
                        tools[name] = {'type': 'function', 'function': obj['function']}
                except Exception:
                    continue
    except Exception:
        pass
    _DIALOG_TOOL_CACHE['defs'] = tools or None
    return _DIALOG_TOOL_CACHE['defs']


class _DialogBridgeHandler(object):
    """mock HTTP handler：让 tools backend 的 ToolContext 无需真实 HTTP 就能回包。"""

    def __init__(self, workdir):
        self._workdir = workdir
        self.response = None

    def _send_json(self, data, code=200):
        self.response = data

    def _safe_project_path(self, rel_path, project_dir):
        return os.path.abspath(os.path.join(project_dir, rel_path or '.'))


def _exec_dialog_tool(name, args):
    """走对话框 tools 注册表执行（与 /api/tools/* 同路径）。返回 (ok, str)。"""
    try:
        import sys as _sys
        if _SWARM_WORKDIR not in _sys.path:
            _sys.path.insert(0, _SWARM_WORKDIR)
        from tools import get_handler
        from tools.coding.backend.base import ToolContext
        handler_mod = get_handler(name)
        if not handler_mod:
            return False, 'unknown dialog tool: %s' % name
        body = dict(args if isinstance(args, dict) else {})
        # 优先用前端/调用方传来的真实项目路径，防止误落到应用根仓库（多项目误建分支防护）
        _pp = str(body.get('_project_path') or '').strip()
        if _pp and os.path.isdir(_pp):
            body['_project_path'] = _pp
        else:
            body['_project_path'] = _SWARM_WORKDIR
        _workdir = body['_project_path']
        bridge = _DialogBridgeHandler(_workdir)
        ctx = ToolContext(bridge, body)
        handler_mod.handle(body, ctx)
        resp = bridge.response
        if resp is None:
            return False, 'tool %s returned no response' % name
        if isinstance(resp, dict) and resp.get('ok') is False:
            return False, str(resp.get('error') or resp)[:_MAX_OUTPUT_CHARS]
        if isinstance(resp, dict):
            payload = {k: v for k, v in resp.items() if k != 'ok'}
            try:
                return True, _json_dumps(payload)
            except Exception:
                return True, str(payload)
        return True, str(resp)
    except Exception as e:
        return False, 'tool %s error: %s' % (name, str(e)[:300])


def _json_dumps(obj):
    import json as _json
    try:
        return _json.dumps(obj, ensure_ascii=False, default=str)
    except Exception:
        return str(obj)



def _get_full_tools():
    """加载朱峰底层完整工具 schema（来自主控 codex_style 注册表）。失败返回 (None, None) 走极简回退。"""
    try:
        import sys
        if BASE_DIR not in sys.path:
            sys.path.insert(0, BASE_DIR)
        from engines.codex_style import engine as _ce
        reg = _ce.get_registry()
        schemas = reg.schemas() or []
        if schemas:
            return schemas, reg
    except Exception:
        pass
    return None, None


def _exec_full_tool(reg, name, args):
    """通过主控注册表执行工具，返回 (ok, str)。任何异常收敛为字符串，不外抛。"""
    try:
        _args = args if isinstance(args, dict) else {}
        # 优先用调用方传来的真实项目路径，防止 git 等操作误落到应用根仓库（多项目防护）
        _pp = str(_args.get('_project_path') or '').strip()
        _wd = _pp if (_pp and os.path.isdir(_pp)) else _SWARM_WORKDIR
        return reg.execute(name, _args, {'workdir': _wd})
    except Exception as e:
        return False, 'tool %s error: %s' % (name, str(e)[:300])


def _safe_path(p):
    """限定在项目根目录内，防目录穿越。"""
    full = os.path.abspath(os.path.join(_SWARM_WORKDIR, p or '.'))
    if not (full == _SWARM_WORKDIR or full.startswith(_SWARM_WORKDIR + os.sep)):
        raise PermissionError('越出工作目录: %s' % p)
    return full
def _exec_tool(name, args, workdir=None):
    _WD = workdir if (workdir and os.path.isdir(workdir)) else _SWARM_WORKDIR
    def _safe_path(p):
        full = os.path.abspath(os.path.join(_WD, p or '.'))
        if not (full == _WD or full.startswith(_WD + os.sep)):
            raise PermissionError('越出工作目录: %s' % p)
        return full
    try:
        if name == 'read_file':
            path = _safe_path(args.get('path'))
            with open(path, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read(_MAX_OUTPUT_CHARS * 4)
            out = content if len(content) <= _MAX_OUTPUT_CHARS else content[:_MAX_OUTPUT_CHARS] + '\n...(已截断)'
            return 'ok: %s\n%s' % (path, out)
        if name == 'write_file':
            path = _safe_path(args.get('path'))
            # 黑板写前检查：防多智能体并发写同一文件冲突
            try:
                from engines.common import project_blackboard as _pbb
                if _pbb.bb_enabled():
                    _owner = 'swarm-worker:%s' % uuid.uuid4().hex[:8]
                _r = _pbb.bb_acquire('swarm', [path], _owner, role='swarm:write_file', hint='')
                if not _r.get('ok'):
                    _cs = _r.get('conflicts') or []
                    _who = '、'.join(str(c.get('owner') or '?') for c in _cs)
                    return '⛔ 黑板占用冲突：%s 正在被 %s 开发，请稍后再试或提醒用户裁决。' % (os.path.basename(path), _who)
                try:
                    _pbb.bb_release('swarm', [path], _owner)
                except Exception:
                    pass
            except Exception:
                pass
            content = str(args.get('content') or '')
            d = os.path.dirname(path)
            if d and not os.path.isdir(d):
                os.makedirs(d, exist_ok=True)
            if os.path.exists(path):
                try:
                    os.replace(path, path + '.bak')
                except Exception:
                    pass
            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)
            return 'ok: 已写入 %s (%d 字符)' % (path, len(content))
        if name == 'list_dir':
            path = _safe_path(args.get('path') or '.')
            max_count = int(args.get('max_count') or 100)
            items = []
            for root, dirs, files in os.walk(path):
                rel = os.path.relpath(root, path)
                for n in dirs:
                    items.append(os.path.join(rel, n) + '/')
                for n in files:
                    items.append(os.path.join(rel, n))
                if len(items) >= max_count:
                    break
            return 'ok: %d 项\n%s' % (len(items), '\n'.join(items[:max_count]))
        if name == 'search_files':
            import re
            path = _safe_path(args.get('path') or '.')
            pat = str(args.get('pattern') or '')
            ext = args.get('ext')
            hits, searched = [], 0
            for root, dirs, files in os.walk(path):
                if len(hits) >= 20:
                    break
                for fn in files:
                    if ext and not fn.endswith(ext):
                        continue
                    fp = os.path.join(root, fn)
                    try:
                        with open(fp, 'r', encoding='utf-8', errors='ignore') as f:
                            for i, line in enumerate(f, 1):
                                if pat in line:
                                    hits.append('%s:%d: %s' % (os.path.relpath(fp, path), i, line.strip()[:120]))
                                    if len(hits) >= 20:
                                        break
                    except Exception:
                        pass
            return 'ok: %d 处命中\n%s' % (len(hits), '\n'.join(hits[:20]))
        if name == 'run_code':
            import subprocess
            try:
                from engines.common.shell_exec import _inject_git_c
                _c = _inject_git_c(args.get('code') or '', _WD)
            except Exception:
                _c = args.get('code') or ''
            # P0 沙箱：统一走 Job Object 资源围栏（off/非 Windows/导入失败时直通）
            try:
                from engines.common.sandbox import sandbox_mode, run_isolated
                if sandbox_mode() == 'job':
                    r = run_isolated(_c, timeout=_SWARM_TIMEOUT, cwd=_WD, shell=True)
                    _out = (r.stdout or b'').decode('utf-8', errors='replace')
                    _err = (r.stderr or b'').decode('utf-8', errors='replace')
                else:
                    raise ImportError
            except ImportError:
                import subprocess
                r = subprocess.run(_c, shell=True,
                                   capture_output=True, text=True,
                                   encoding='utf-8', errors='replace',
                                   timeout=_SWARM_TIMEOUT,
                                   cwd=_WD)
                _out = r.stdout or ''
                _err = r.stderr or ''
            out = (('exit=%d\n' % r.returncode) + _out + _err)
            return 'ok:\n' + (out if len(out) <= _MAX_OUTPUT_CHARS else out[:_MAX_OUTPUT_CHARS] + '\n...(已截断)')
        # 【2026-10-01 修复】智能体广场三工具（发帖失败"未知工具"）
        if name in ('forum_read', 'forum_write', 'forum_reply'):
            from engines.common.forum_bbs_bridge import forum_exec as _fx
            return _fx(name, args)
        # 【2026-10-02】图片工作台 AI 工具接入（wb_list/wb_apply）
        if name in ('wb_list', 'wb_apply'):
            from engines.common.workbench_bridge import workbench_exec as _wx
            return _wx(name, args)
        return 'error: 未知工具 %s' % name
    except Exception as e:
        return 'error: %s' % str(e)[:300]




# ---- subtask heartbeat & cancel ----
_CANCELLED = set()
_CANCEL_LOCK = __import__('threading').Lock()

def cancel_subtask(batch_id, task_id):
    with _CANCEL_LOCK:
        _CANCELLED.add('%s:%s' % (batch_id, task_id))

def is_cancelled(batch_id, task_id):
    with _CANCEL_LOCK:
        return ('%s:%s' % (batch_id, task_id)) in _CANCELLED

class _Heartbeat(object):
    """write running status into persisted batch file; respond to cancel."""
    def __init__(self, batch_id, task_id):
        self.batch_id, self.task_id = batch_id, task_id
        self.cancelled = False
        self._set('running')
    def tick(self):
        self.cancelled = is_cancelled(self.batch_id, self.task_id)
        if self.cancelled:
            self._set('cancelled')
    def _set(self, st):
        try:
            import json as _json
            fp = os.path.join(_SWARM_STATE_DIR, 'batch-%s.json' % self.batch_id)
            if os.path.exists(fp):
                d = _json.load(open(fp, encoding='utf-8'))
                for t in d.get('tasks', []):
                    if t.get('id') == self.task_id:
                        t['status'] = st
                _json.dump(d, open(fp, 'w', encoding='utf-8'), ensure_ascii=False)
        except Exception:
            pass
    def finish(self, st='done'):
        self._set(st)
