# -*- coding: utf-8 -*-
"""
dispatch_swarm.py - 对话内并发子任务派发（蜂群）—— 单文件真源（20261123 exec 拆分还原）

原文件曾按行段拆为 dispatch_swarm_infra / dispatch_swarm_tasks 两段、
由门面 exec 拼接（旧"单文件≤300行"指标产物）。20261123 按策划案
Phase 0.2 按原加载顺序拼回本文件，语义零变化。
分段原文件归档于 archive/exec拆分还原备份-20261123/。
"""

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
import random
import threading
from concurrent.futures import ThreadPoolExecutor

from config import BASE_DIR

from util_log import get_logger

log = get_logger('dispatch_swarm')
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
        payload = {'batch_id': batch_id, 'status': b.get('status'),
                    'created_at': str(b.get('created_at')),
                    'tasks': [{'id': t.get('id'), 'goal': str(t.get('goal'))[:100],
                               'role': t.get('role') or '', 'status': t.get('status'),
                               'error': (str(t.get('output'))[:200] if t.get('status') == 'failed' else '')}
                              for t in b.get('tasks', [])]}
        # P1: tmp + os.replace 原子覆盖，防并发写坏 json
        _tmp = os.path.join(_SWARM_STATE_DIR, 'batch-%s.json.tmp' % batch_id)
        with open(_tmp, 'w', encoding='utf-8') as f:
            _json.dump(payload, f, ensure_ascii=False)
        os.replace(_tmp, os.path.join(_SWARM_STATE_DIR, 'batch-%s.json' % batch_id))
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
    import sys
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


_relay_perf_lock = threading.Lock()
def _relay_perf_log(line):
    """【2026-11-16】中转线路耗时落盘：swarm 对话直连站方中转（不经 ai_proxy:8624、
    不经系统代理），此前 16:15-17:00 全 swarm 变慢时本地无任何耗时留档无法定量归因。
    超 5MB 滚动 .1。"""
    try:
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'private', 'logs', 'swarm_relay_perf.log')
        with _relay_perf_lock:
            try:
                if os.path.getsize(p) > 5 * 1024 * 1024:
                    os.replace(p, p + '.1')
            except Exception:
                pass
            with open(p, 'a', encoding='utf-8') as f:
                f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + line + '\n')
    except Exception:
        pass


def _post_chat(url, payload, key, timeout):
    """带网络抖动重试的 POST：超时/连接错误/5xx/429 指数退避重试，彻底抗抖动。"""
    import requests
    headers = {'Authorization': 'Bearer ' + key}
    # 【2026-10-16 修复】官方中转线路（zf_models_relay）需 X-ZF-Key + X-ZF-User 鉴权，
    # 蜂群子任务线程原样只发 Bearer 导致 401 秒失败（对齐 dual_protocol.py 同款修复）
    # 【P0-2 收编 20261123】子串判定改 security.is_zf_relay_url 域名精确匹配
    import security as _sec
    if _sec.is_zf_relay_url(url):
        try:
            import sys as _sys
            if BASE_DIR not in _sys.path:
                _sys.path.insert(0, BASE_DIR)
            from zf3d_commands import _get_api_key as _zf_gk
            _zf_key = _zf_gk() or ''
            if _zf_key:
                headers['X-ZF-Key'] = _zf_key
                try:
                    from zf3d_heartbeat import _get_login_status as _zf_gls
                    _ls, _lu, _zf_uid = _zf_gls()
                    if _zf_uid and int(_zf_uid) > 0:
                        headers['X-ZF-User'] = str(_zf_uid)
                except Exception:
                    pass
        except Exception:
            pass
    last_err = None
    for attempt in range(4):   # 1 次正常 + 3 次抖动重试（2s/4s/8s 退避）
        _t0 = time.time()
        try:
            r = requests.post(
                url,
                json=payload,
                headers=headers,
                timeout=timeout)
            _relay_perf_log('[relay] %s status=%s dt=%.1fs attempt=%d/4'
                            % (url.split('?')[0][-60:], r.status_code, time.time() - _t0, attempt + 1))
            if r.status_code in (429, 500, 502, 503, 504) and attempt < 3:
                last_err = RuntimeError('HTTP %s' % r.status_code)
                # 【抖动消峰 20261123】等比例随机抖动 0.7~1.3×：6 个 worker 的固定退避（2s/4s/8s）
                # 会在同一时刻集体醒来轰上游，随机错峰后不再对齐（前端 loop-core 同款策略）
                time.sleep((2 * (2 ** attempt)) * (0.7 + random.random() * 0.6))
                continue
            return r
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError,
                requests.exceptions.ChunkedEncodingError) as e:
            _relay_perf_log('[relay] %s EXC %s: %.1fs attempt=%d/4'
                            % (url.split('?')[0][-60:], type(e).__name__, time.time() - _t0, attempt + 1))
            last_err = e
            if attempt < 3:
                # 【抖动消峰 20261123】同款 0.7~1.3× 随机错峰（连接异常路径）
                time.sleep((2 * (2 ** attempt)) * (0.7 + random.random() * 0.6))
                continue
            raise
    raise last_err or RuntimeError('请求失败')


def _chat(model, messages, timeout=TASK_TIMEOUT, max_tokens=16384, temperature=0.3, retry=3):
    payload = {'model': model['model_id'], 'messages': messages,
               'temperature': temperature, 'max_tokens': max_tokens}
    for attempt in range(retry + 1):
        try:
            # 【2026-10-22 修复】zf relay 线路 URL 已含 ?model=xxx，不能再拼 /chat/completions（404）
            _url = model['base'] + ('' if 'zf_models_relay' in model['base'] else '/chat/completions')
            r = _post_chat(_url, payload,
                           model['key'], timeout)
        except Exception:
            if attempt >= retry:
                raise
            # 【抖动消峰 20261123】3s 基线同样随机错峰
            time.sleep(3 * (0.7 + random.random() * 0.6))
            continue
        if r.status_code == 400 and attempt < retry:
            # 可能不认识某参数，去掉附加参数重试
            payload = {k: payload[k] for k in ('model', 'messages', 'temperature', 'max_tokens')}
            continue
        r.raise_for_status()
        _resp = r.json()
        ch = _resp['choices'][0]
        # [A2 token记账 2026-11-22] 防御式旁挂：usage 缺失/异常只记0，绝不影响主流程
        try:
            from swarm_token_meter import extract_usage, record_usage
            record_usage(model=model.get('name', ''),
                         usage=extract_usage(_resp))
        except Exception:
            pass
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
            cfg = mc.load_models_config(include_key=True)
            # 「可见即可通」：已启用、语言类型、有接口地址、非图像生成 —— 与 mixin_models 的可用口径一致
            # 【2026-10-16 修复】排除无 key 的模型：strong 赛道兜底会优先挑 DeepSeek 等直连模型，
            # 未填 key 时 401 必失败；只从「有鉴权凭据」的模型里选（zf relay 有共享 key，不受影响）
            names = [m.get('name') or '' for m in cfg.get('list', [])
                     if m.get('enabled') and m.get('modelType', 'language') == 'language'
                     and (m.get('baseUrl') or m.get('baseURL') or m.get('endpoint') or m.get('apiUrl'))
                     and not m.get('imageGen')
                     and (m.get('key') or m.get('apiKey'))]
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
    # 【2026-10-12】模型直连控制台：console 工具（exec/history，双开关闸门）
    {'type': 'function', 'function': {
        'name': 'console', 'description': '模型直连指挥台控制台。action=exec 在项目根执行 shell 命令（与指挥台同一通道，限时30s输出截断，受 ZF_PYCONSOLE 与 ZF_AGENT_CONSOLE 双开关控制）；action=history 回读指挥台最近执行记录（含用户在指挥台敲的命令和模型自己的执行回显），实现双向视野。',
        'parameters': {'type': 'object', 'properties': {
            'action': {'type': 'string', 'enum': ['exec', 'history']},
            'code': {'type': 'string', 'description': 'exec 时的 shell 命令'},
            'limit': {'type': 'integer', 'description': 'history 读取条数，默认20'}},
            'required': ['action']}}},
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
    _t0 = time.time()
    _out = _exec_tool_inner(name, args, workdir=workdir)
    try:
        from engines.common import tool_stats
        tool_stats.record(name, 'swarm', not str(_out or '').startswith('error:'),
                          (time.time() - _t0) * 1000.0)
    except Exception:
        pass
    return _out


def _exec_tool_inner(name, args, workdir=None):
    _WD = workdir if (workdir and os.path.isdir(workdir)) else _SWARM_WORKDIR
    def _safe_path(p):
        full = os.path.abspath(os.path.join(_WD, p or '.'))
        if not (full == _WD or full.startswith(_WD + os.sep)):
            raise PermissionError('越出工作目录: %s' % p)
        return full
    try:
        # 路径守卫：拦截对运行环境/项目外的写、删、移动（P0 防线，异常放行不影响主流程）
        try:
            from path_guard import guard_run_code
            _g_code = str(args.get('code') or '')
            _allow, _msg = guard_run_code(_g_code, _WD)
            if not _allow:
                return 'blocked: %s' % _msg
        except Exception:
            pass
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
                # [修复 2026-11-23] _owner 预定义：原实现 bb 未启用时 _owner 未定义，
                # bb_acquire 处 NameError 被外层 except 吞掉 → 黑板检查整段失效。
                # bb 关闭时 bb_acquire/bb_release 均直接返回 ok=True（传 None 安全）。
                _owner = None
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
        if name == 'console':
            # 【2026-10-12】模型直连控制台：双开关（ZF_PYCONSOLE 总闸 + ZF_AGENT_CONSOLE 暴露闸）
            if os.environ.get('ZF_AGENT_CONSOLE', 'off').lower() != 'on':
                return 'console 工具未启用（设置环境变量 ZF_AGENT_CONSOLE=on 后重启生效）'
            try:
                from routes.mixin_pyconsole import pyconsole_exec_direct, pyconsole_history_snapshot
                if args.get('action') == 'history':
                    items = pyconsole_history_snapshot(int(args.get('limit') or 20))
                    if not items:
                        return '（指挥台暂无执行记录）'
                    return '\n'.join('[%s %s] exit=%s\n%s\n%s' % (it.get('kind'), it.get('ts'), it.get('exit'), it.get('code'), str(it.get('output') or '')[:1500]) for it in items)
                r = pyconsole_exec_direct(args.get('code'), _WD, kind='agent')
                if r.get('ok'):
                    out = 'exit=%d\n%s' % (r['exit'], r['output'])
                    return out if len(out) <= _MAX_OUTPUT_CHARS else out[:_MAX_OUTPUT_CHARS] + '\n...(已截断)'
                return '错误：%s' % r.get('error')
            except Exception as e:
                return 'console 工具异常：%s' % e
        if name == 'run_code':
            # 防刷熔断：拦截无业务含义的重复占位命令（异常放行不影响主流程）
            try:
                from echo_breaker import check_echo_loop
                _blk = check_echo_loop(args.get('code'))
                if _blk:
                    return _blk
            except Exception:
                pass
            _c = args.get('code') or ''
            # 【2026-11-06 收口】统一走 shell_exec.run_shell（内含 git -C 注入、
            # cwd 兜底、Job Object 沙箱、熔断与 9009 重试），消除重复执行通道
            try:
                from engines.common.shell_exec import run_shell as _run_shell
                rc, _out_b, _err_b, _note = _run_shell(_c, timeout=_SWARM_TIMEOUT, cwd=_WD)
                _out = _out_b.decode('utf-8', errors='replace')
                _err = _err_b.decode('utf-8', errors='replace')
                if _note:
                    _err = (_err + '\n[note] ' + _note)
            except Exception as e:
                _out, _err, rc = '', 'run_shell 执行异常: %s' % e, -1
            out = (('exit=%d\n' % rc) + _out + _err)
            # 工作台只读回显钩子（绝不影响主流程）
            try:
                from routes.mixin_pyconsole import pyconsole_push
                pyconsole_push('agent', _c, out, rc)
            except Exception:
                pass
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
                # 原子覆盖：tmp+replace，避免与 _persist_batch 并发时互相覆盖丢状态
                # [修复 2026-11-23] tmp 名用 .hb.tmp 与 _persist_batch 的 .json.tmp 区分：
                # 两写者共用同名 tmp 时，一方 open(tmp,'w') 截断另一方刚写好的内容、
                # 或 os.replace 把对方载荷搬走 → 丢状态/内容错配
                tmp = fp + '.hb.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    _json.dump(d, f, ensure_ascii=False)
                os.replace(tmp, fp)
        except Exception as e:
            try:
                log.info('[swarm_state] heartbeat _set failed batch=%s task=%s: %r' % (self.batch_id, self.task_id, e))
            except Exception:
                pass
    def finish(self, st='done'):
        self._set(st)


# -*- coding: utf-8 -*-
# 拆分分段模块：由原 dispatch_swarm.py 按行段【无改动】切分，由同名门面加载合并。
def _run_subtask(batch_id, task_id, goal, context, model_name, track='auto', allowed_tools=None, trace_id=None):
    """线程池 worker：跑一个子任务并写回结果。任何异常都不能让线程崩掉。"""
    _allow = set(str(n) for n in allowed_tools) if allowed_tools else None  # 局部变量，线程安全
    t0 = time.time()
    _hb = _Heartbeat(batch_id, task_id)   # 心跳/取消：running 状态写状态文件，可被 cancel 置位
    # D1 轻量链路追踪：子任务写一条 span（start/end 带同一 trace_id，可按 trace_id 串起全批链路）
    _span = None
    try:
        import trace_core as _tc
        _t = _tc.Trace(trace_id or _tc.new_trace_id('sw'))
        _span = _t.span('subtask', name='%s/%s' % (batch_id, task_id))
    except Exception:
        _span = None
    messages = []
    result = {'status': 'failed', 'output': '未知错误', 'model': model_name or '',
              'elapsed': round(time.time() - t0, 1)}
    try:
        # 赛道选模：未显式指定模型时按 track 分配（strong/fast/auto）
        if not model_name:
            model_name = _pick_model_by_track(track, goal)
        model = _resolve_model(model_name)
        messages = [
            {'role': 'system', 'content':
                '你是蜂巢（蜂群）子智能体，被主控派发执行子任务。你可以使用主控的全部工具'
                '（文件读写、代码运行、搜索、浏览器等，见工具列表），工作目录=项目根目录，路径用相对路径。'
                '路径铁律：所有文件产出只能写入当前项目根目录内（用相对路径）；'
                '严禁写入 C 盘安装/运行目录（如 ...\\Programs\\ 下）或其他项目/版本目录；'
                '若工具返回"路径守卫拦截"，说明目标越界，必须改为项目内相对路径重做，不得绕过守卫。'
                '规则：1) 先做再问，不要反问、不要寒暄；2) 一轮内尽量并行发出多个独立工具调用；'
                '3) 结论/产出为主，输出精炼；4) 读完文件必须在最终回复列出关键内容；'
                '5) 目标达成后立即停止调用工具、直接给出最终结论。'
                '6) 动手前先在心里把【子任务】目标复述一遍：要做的是什么、产出给谁用；'
                '如果目标里有验收标准(accept)，把它当作唯一的完成判据，结束时逐条对照，不满足就继续做或如实说明差距；'
                '不要做目标之外的事、不要改与目标无关的文件。'
                '双路验证协议：涉及删除/覆盖/加密/改配置等不可逆或关键操作时，必须先独立推理两次'
                '（两次都基于事实重新推导，不抄第一次结论），两次结论一致才执行；不一致时不要自作主张二选一，'
                '在最终回复开头标注【双路不一致】并分别列出两条结论及分歧点，交由主控裁决。'
                '【S3 提交纪律】凡修改了 server/** 下代码，收尾必须显式执行'
                ' git add <具体文件> && git commit -m "[fix] 改了什么/为什么"，'
                '禁止依赖自动快照收编改动；【S4 死锁SOP】凡排查"连接成功但不响应/卡死/死锁"，'
                '第一步必须先抓线程栈实锤卡点（运行 server/thread_dump.py），禁止直接读码瞎猜。'
                '【S5 写盘必核 2026-11-22】write/replace_text 返回 failed_summary 或 files[].error 时，'
                '本次不算写入成功，必须逐条修复重写后再收尾，禁止忽略失败文件直接给最终结论。'
                '双副本已消灭收口（a23f9cae），只写 public/** 单本即可，禁止再手工 copy 到 server/public。'},
            {'role': 'user', 'content':
                '【子任务】\n' + goal +
                ('\n\n【上下文（主控提供，含项目背景与已完成产出，供直接使用）】\n' + context if context else '')}
        ]
        try:
            # 朱峰底层全工具：schema 来自主控注册表，注册表失败则回退极简工具
            # 工具 schema 直接用对话框定义（单一事实源）；拿不到再回落 codex 注册表/蜂巢极简集
            dialog_tools = _load_dialog_tool_defs()
            if dialog_tools:
                tools = list(dialog_tools.values())
            else:
                full_tools, full_reg = _get_full_tools()
                tools = full_tools if full_tools else SWARM_MINI_TOOLS
            # 【2026-10-12】console 工具按开关过滤下发：ZF_AGENT_CONSOLE=off 时不给模型 schema（执行层双闸仍兜底）
            if os.environ.get('ZF_AGENT_CONSOLE', 'off').lower() != 'on':
                tools = [t for t in tools if (t.get('function', {}).get('name') or t.get('name')) != 'console']
            # 工具白名单继承：allowed_tools 非空时只暴露白名单内工具
            if allowed_tools:
                _allow = set(str(n) for n in allowed_tools)
                tools = [t for t in tools if (t.get('function', {}).get('name') or t.get('name')) in _allow]
            content = ''
            for _round in range(_MAX_TOOL_ROUNDS):
                _hb.tick()
                if _hb.cancelled:
                    result = {'status': 'cancelled', 'output': '子任务被主控取消',
                              'model': model_name or '', 'elapsed': round(time.time() - t0, 1)}
                    return result
                payload = {'model': model['model_id'], 'messages': messages,
                           'temperature': 0.3, 'max_tokens': 16384,
                           'tools': tools}
                # [抗网络抖动] 超时/连接中断/5xx/429 指数退避重试，绝不一次抖动就判死
                # 【2026-10-22 修复】zf relay 线路 URL 已含 ?model=xxx，不能再拼 /chat/completions（404）
                _url = model['base'] + ('' if 'zf_models_relay' in model['base'] else '/chat/completions')
                r = _post_chat(_url,
                               payload, model['key'], TASK_TIMEOUT)
                r.raise_for_status()
                _resp = r.json()
                # [A2 token记账 2026-11-22] 防御式旁挂：usage 缺失/异常只记0，绝不影响主流程
                try:
                    from swarm_token_meter import extract_usage, record_usage
                    record_usage(batch_id=batch_id, task_id=task_id,
                                 model=model.get('name', ''),
                                 usage=extract_usage(_resp))
                except Exception:
                    pass
                msg = _resp['choices'][0]['message']
                content = msg.get('content') or ''
                tool_calls = msg.get('tool_calls') or []
                if not tool_calls:
                    break
                messages = messages + [msg]
                for tc in tool_calls:
                    fn = (tc.get('function') or {}).get('name') or ''
                    try:
                        args = __import__('json').loads((tc.get('function') or {}).get('arguments') or '{}')
                    except Exception:
                        args = {}
                    if _allow and fn not in _allow:
                        ok, out = False, '工具 %s 不在本批次白名单内，已拒绝执行' % fn
                    else:
                        ok, out = _exec_dialog_tool(fn, args)
                        if not ok and not _load_dialog_tool_defs():
                            # 对话框注册表不可用时回落内置极简实现
                            ok, out = _exec_tool(fn, args)
                    out = ('ok: ' if ok else 'error: ') + str(out)[:_MAX_OUTPUT_CHARS]
                    messages.append({'role': 'tool',
                                     'tool_call_id': tc.get('id') or '',
                                     'content': out[:_MAX_OUTPUT_CHARS]})
                content = ''  # 还有工具轮，最终以无工具调用那轮为准
            if not content.strip():
                # 兜底：不带工具、禁思考再要一次纯文本总结
                try:
                    content = _chat(model, messages[-2:] + [{'role': 'user', 'content': '请直接给出你的最终结论，不要调用任何工具。'}])
                except Exception:
                    content = ''
            if not content.strip():
                # 最终兜底：从工具结果里提取关键信息拼成产出
                tool_lines = [m2['content'][:200] for m2 in messages if m2.get('role') == 'tool']
                if tool_lines:
                    content = '[工具结果汇总]\n' + '\n---\n'.join(tool_lines[-3:])
            # [闭环修复 2026-11-02 收口③] 协议化 FINAL 标记优先：正文含 ===FINAL=== 时取标记后的最终结论，
            # 避免靠"哪轮是结论"启发式猜测；未用协议的旧任务走原逻辑不受影响
            if '===FINAL===' in content:
                content = content.split('===FINAL===')[-1].strip() or content
            # [闭环修复 2026-11-02] 保留首轮 assistant 正文为 first_output，防最终结论异常时信息丢失
            _first = next((m.get('content') or '' for m in messages
                           if m.get('role') == 'assistant' and isinstance(m.get('content'), str) and m.get('content').strip()), '')
            # [P1-3 收尾硬校验 2026-11-22] goal 带【产出文件】清单时逐文件核验：
            # 存在 + 任务窗口内有写入 + 非空。不过 → 不记 done，差距喂回主控重派。
            # 这是"done≠实现"的制度性收口：模型停止调工具不再等于完成。
            _vok, _vgap = True, ''
            try:
                _vok, _vgap = _verify_targets(goal, t0, _SWARM_WORKDIR)
            except Exception:
                pass   # 校验自身异常不阻塞主流程（fail-open 到旧行为）
            if not _vok:
                result = {'status': 'failed',
                          'output': ('[收尾硬校验未过] 子任务声称完成，但产出文件核验不符：%s。'
                                     '请主控据此重派或人工补做；子任务文本结论见 first_output。' % _vgap)[:500],
                          'first_output': _first[:2000],
                          'model': model['name'], 'elapsed': round(time.time() - t0, 1)}
                return result
            result = {'status': 'done', 'output': content,
                      'first_output': _first[:2000],
                      'model': model['name'], 'elapsed': round(time.time() - t0, 1)}
        except Exception as e:
            result = {'status': 'failed', 'output': str(e)[:500],
                      'model': model_name or '', 'elapsed': round(time.time() - t0, 1)}
            # [P1④闭环修复 2026-11-03] 401/403 鉴权失败专项告警：key 失效会静默吞掉整批蜂群产出，必须显式标记
            if '401' in str(e) or '403' in str(e):
                result['alert'] = 'AUTH_FAIL'
                result['output'] = ('[鉴权失败告警] 模型 %s 返回 401/403，key 可能已失效，'
                                    '请检查密钥配置: %s' % (model_name or '', str(e)[:300]))[:500]
                try:
                    with open(os.path.join(os.path.dirname(__file__), '..', 'logs',
                                           'swarm_auth_alerts.log'), 'a', encoding='utf-8') as f:
                        f.write('%s AUTH_FAIL model=%s batch=%s task=%s err=%s\n'
                                % (time.strftime('%Y-%m-%d %H:%M:%S'), model_name or '',
                                   batch_id, task_id, str(e)[:200]))
                except Exception:
                    pass
            # 条件触发仲裁：失败且开启开关时，自动换备用模型重跑一次
            try:
                if os.environ.get('ZF_SWARM_ARBITRATE', '1').strip() in ('1', 'true', 'yes'):
                    cur_name = (locals().get('model') or {}).get('name') or (model_name or '')
                    for fb in _fallback_models(cur_name):
                        try:
                            fb_model = _resolve_model(fb)
                            content = _chat(fb_model, messages)
                            # [P1-3 2026-11-22] 仲裁重跑走 _chat 无工具纯文本，写不了文件：
                            # 原 goal 要求产出文件时，核验不过就不给 done（否则重跑反而洗白失败）
                            _fv_ok, _fv_gap = True, ''
                            try:
                                _fv_ok, _fv_gap = _verify_targets(goal, t0, _SWARM_WORKDIR)
                            except Exception:
                                pass
                            if _fv_ok:
                                result = {'status': 'done', 'output': content,
                                          'model': fb_model['name'] + '(仲裁重跑)',
                                          'elapsed': round(time.time() - t0, 1)}
                            else:
                                result = {'status': 'failed',
                                          'output': ('[收尾硬校验未过][仲裁重跑为纯文本无工具，产出文件核验不符：%s]'
                                                     ' | 原始失败: %s' % (_fv_gap, str(e)[:200]))[:500],
                                          'model': fb_model['name'] + '(仲裁重跑)',
                                          'elapsed': round(time.time() - t0, 1)}
                            break
                        except Exception:
                            continue
            except Exception as e2:
                result = {'status': 'failed', 'output': (str(e) + ' | 仲裁失败: ' + str(e2))[:500],
                          'model': model_name or '', 'elapsed': round(time.time() - t0, 1)}
    except Exception as e:
        # 模型解析等前置失败也必须有结果，不能让线程崩掉
        result = {'status': 'failed', 'output': str(e)[:500],
                  'model': model_name or '', 'elapsed': round(time.time() - t0, 1)}
    finally:
        # D1: 结束子任务 span（观测永不影响主流程）
        if _span is not None:
            try:
                _span.end(status=result.get('status') or 'failed',
                          model=result.get('model'), elapsed=result.get('elapsed'))
            except Exception:
                pass
        # 无论成功失败，必须把结果写回批次表并唤醒 collect，绝不留挂死任务
        try:
            with _COND:
                b = _BATCHES.get(batch_id)
                if b:
                    for t in b['tasks']:
                        if t['id'] == task_id:
                            t.update(result)
                            t['ended_at'] = time.time()
                            break
                    b['done_count'] = sum(1 for t in b['tasks']
                                          if t['status'] in ('done', 'failed', 'cancelled'))
                    if b['done_count'] >= len(b['tasks']):
                        b['status'] = 'done'
                    _COND.notify_all()
        except Exception:
            pass
        # P1: 无论成功/失败/取消，都必须落一份收尾状态到 batch json（failed 不再无收尾）
        try:
            _hb.finish(str(result.get('status') or 'done'))
            _persist_batch(batch_id)
        except Exception:
            pass


# ---------- 对外接口 ----------

def _extract_target_files(goal):
    """P1-3 收尾硬校验：从 goal 提取【产出文件】小节的相对路径清单。
    格式：【产出文件】a.py, b/c.js（逗号/顿号/分号/换行分隔均可，止于下一个【小节）。
    【2026-11-22 第四轮复审】支持多行清单——主控常把列表写成多行，原正则遇换行截断
    会漏掉第二行起的文件（漏验不误杀，但校验不完整）。
    无该小节返回 []（兼容旧任务，跳过校验）。"""
    import re as _re
    m = _re.search(r'【产出文件】\s*([^\u3010]+)', str(goal or ''))
    if not m:
        return []
    parts = _re.split(r'[,，;；、\n]+', m.group(1))
    return [p.strip().strip('"\'') for p in parts if p.strip()][:50]


def _verify_targets(goal, started_at, project_root):
    """P1-3 收尾硬校验：目标文件存在 + 任务窗口内有写入 + 非空。
    返回 (ok, 差距描述)。ok=True 表示通过或无需校验（goal 无【产出文件】）。
    纯 os 层实现，不走 git（线程池里 git 是全局单锁，收尾阶段不加剧排队；
    且并发会话下 git diff 会互相污染，文件级判据才是本任务自己的证据）。"""
    targets = _extract_target_files(goal)
    if not targets:
        return True, ''
    # 【2026-11-22 复审修复】熔断探针被强制改为只读前缀 goal，原 goal 里可能残留
    # 【产出文件】小节——探针禁止写文件，核验必然不过，会被误判 failed。探针免核验。
    if '【熔断探针·只读】' in str(goal):
        return True, ''
    missing, stale, empty = [], [], []
    slack = 30   # mtime 粒度/时钟抖动余量
    for name in targets:
        if not name or name.startswith(('..', '/')) or (len(name) > 1 and name[1] == ':'):
            continue   # 相对路径铁律之外的写法不核验（路径守卫本来就会拦）
        fp = name if os.path.isabs(name) else os.path.join(project_root, name.replace('/', os.sep))
        try:
            if not os.path.isfile(fp):
                missing.append(name)
                continue
            if os.path.getsize(fp) == 0:
                empty.append(name)
                continue
            if os.path.getmtime(fp) < started_at - slack:
                stale.append(name)
        except OSError:
            missing.append(name)
    bad = []
    if missing:
        bad.append('未创建: %s' % ', '.join(missing[:8]))
    if stale:
        bad.append('任务期间未更新(mtime早于开工): %s' % ', '.join(stale[:8]))
    if empty:
        bad.append('空文件: %s' % ', '.join(empty[:8]))
    return (not bad), ('；'.join(bad) if bad else '')


def _is_hard_bug(goal):
    """【S1 2026-10-17 熔断分流】疑难 Bug 识别：死锁/卡死/无响应类任务禁止并行改码。
    关键词刻意收窄（不收"卡"单字，避免误伤 UI 类任务）。"""
    import re as _re
    return bool(_re.search(r'死锁|卡死|不发字|无响应|hang|连接成功但', str(goal), _re.I))


# 探针只读白名单：熔断命中时辅助会话仅允许只读/搜索/抓栈类工具
_PROBE_READ_TOOLS = ['read_file', 'read_lines', 'search_in_files', 'find_files',
                     'tree_dir', 'file_info', 'run_code', 'get_tool_result',
                     'project_record', 'browser_control']


def submit(tasks, model_name=None, shared_context='', allowed_tools=None):
    """提交一批子任务并立刻并发启动。
    tasks: [{goal: str, context: str(可选)}]
    allowed_tools: 工具白名单(list[str])，非空时子任务只暴露这些工具（继承对话框配置）。
                   None/空 = 不过滤，用对话框全量工具定义（兼容旧行为）。
    【S1 熔断】批内任一任务命中疑难 Bug 关键词 → 全批降为串行单主诊：
    仅派第 1 个任务并行执行（允许写），其余任务强制转只读探针白名单，防多会话互相覆盖修复。
    返回 batch_id + 每个子任务 id。"""
    if not tasks or not isinstance(tasks, list):
        raise ValueError('tasks 不能为空')
    tasks = tasks[:20]  # 单批上限
    # 【S1 熔断分流】疑难任务命中 → 降并发：仅主诊可写，其余转只读探针
    _hard = any(_is_hard_bug((tk or {}).get('goal')) for tk in tasks)
    _main_idx_done = [False]  # 闭包标记：第一个任务是否已按主诊派出
    if _hard:
        try:
            import trace_core as _tc0
            _tc0.Trace(_tc0.new_trace_id('sw')).event(
                'swarm_fuse', name='hard_bug_detected', status='running',
                tasks=len(tasks))
        except Exception:
            pass
    batch_id = 'sw-' + uuid.uuid4().hex[:10]
    now = time.time()
    # D1: 每批生成 trace_id，批次事件落 trace JSONL，子任务继承同一 trace_id
    _trace_id = None
    try:
        import trace_core as _tc
        _trace_id = _tc.new_trace_id('sw')
        _tc.Trace(_trace_id).event('swarm', name='batch/%s' % batch_id,
                                   status='running', tasks=len(tasks))
    except Exception:
        _trace_id = None
    batch = {'id': batch_id, 'status': 'running', 'created_at': now,
             'done_count': 0, 'tasks': [], 'trace_id': _trace_id}
    # 【修复 2026-11-23】先注册后提交：原实现先 submit 后注册，抢跑的子任务线程
    # 在收尾时 _BATCHES.get(batch_id) 拿到 None，结果写回被静默丢弃，批次永不收口。
    with _LOCK:
        _BATCHES[batch_id] = batch
        # GC：只留最近 MAX_BATCHES 批
        if len(_BATCHES) > MAX_BATCHES:
            for k in sorted(_BATCHES, key=lambda k: _BATCHES[k]['created_at'])[:-MAX_BATCHES]:
                b = _BATCHES[k]
                if b['status'] == 'done':
                    del _BATCHES[k]
    for i, tk in enumerate(tasks):
        goal = str((tk or {}).get('goal') or '').strip()
        if not goal:
            continue
        tid = 'st-%d-%s' % (i + 1, uuid.uuid4().hex[:6])
        task = {'id': tid, 'goal': goal[:20000], 'status': 'running',
                'context': str((tk or {}).get('context') or '')[:60000],
                'track': str((tk or {}).get('track') or 'auto').lower(),
                'output': '', 'started_at': now, 'ended_at': None}
        # P1 留痕：从 goal 提取角色名（如【策划师素材包·xxx】→ 策划师），供审计"谁干了啥"
        try:
            _m_role = __import__('re').search(r'【([^】·]{1,8}?)(?:素材包)?[·】]', goal)
            task['role'] = _m_role.group(1) if _m_role else ''
        except Exception:
            task['role'] = ''
        batch['tasks'].append(task)
        # 【S1 熔断】疑难批：第 1 个任务为主诊（原白名单），后续强制只读探针
        _task_allow = allowed_tools
        if _hard:
            if not _main_idx_done[0]:
                _main_idx_done[0] = True
                task['fuse_role'] = '主诊'
            else:
                _task_allow = list(_PROBE_READ_TOOLS) if not allowed_tools else \
                    [t for t in allowed_tools if t in _PROBE_READ_TOOLS]
                task['fuse_role'] = '探针(只读)'
                task['goal'] = ('【熔断探针·只读】禁止写入/修改任何文件，只做调查取证'
                                '（可调 thread_dump 抓线程栈），结论交主诊汇总。\n' + task['goal'])
        batch['fused'] = _hard
        _EXECUTOR.submit(_run_subtask, batch_id, tid,
                         task['goal'], task['context'], model_name,
                         task.get('track') or 'auto',
                         _task_allow, _trace_id)
    # P1 修复断链：submit 时立即落盘 batch json（此前从不落盘，目录恒空；心跳只在文件已存在时才写）
    try:
        _persist_batch(batch_id)
    except Exception:
        pass
    return batch_id


def status(batch_id):
    """查批次进度。"""
    with _LOCK:
        b = _BATCHES.get(batch_id)
        if not b:
            return None
        return {'id': b['id'], 'status': b['status'],
                'total': len(b['tasks']), 'done': b['done_count'],
                'tasks': [{'id': t['id'], 'goal': t['goal'][:60],
                           'status': t['status'],
                           'output': t.get('output', ''),
                           'elapsed': t.get('elapsed')}
                          for t in b['tasks']]}


def collect(batch_id, wait_sec=0):
    """回收结果。wait_sec>0 时最多等这么久直到批次完成。"""
    deadline = time.time() + max(0, wait_sec if wait_sec else 0)
    # [2026-09-30] 600s 硬上限已移除；wait_sec 由调用方实参决定。
    # [2026-10-30 区域8盘点·全量核对] 精确正则 \.collect\( 全 server 实查：
    # 共 7 处匹配 / 6 处真实调用，wait_sec 实参各不相同：
    #   api_dispatch_post.py L152=600 / swarm_solve_ab.py L25=1200 /
    #   swarm_solve_exam.py L49=600 / swarm_tools.py L104=调用方传参(默认0) /
    #   swarm_pipeline.py L195=0(轮询) / swarm_pipeline.py L212=60(补跑)
    # 注意：wait_sec=0 时 deadline=当前时间，L326 循环一次不进、立即返回（非无限等待）；
    # 无限等待仅在调用方显式传大 wait_sec 时发生。批次级停滞另有 swarm_pipeline
    # _STALL_LIMIT=600 兜底，子任务 LLM 每轮 HTTP 有 seg1 TASK_TIMEOUT=300 超时。
    with _COND:
        b = _BATCHES.get(batch_id)
        if not b:
            return None
        b['collected'] = b.get('collected', 0) + 1  # 回收计数（可观测性）
        # 回收即落盘：把每个小弟的完整产出持久化到文件，
        # 即使主控上下文被压缩/指针化，也能从文件找回，不丢失小弟成果。
        if b['status'] == 'done' and b.get('collected', 0) == 1:
            try:
                import io as _io
                _dir = os.path.join(_SWARM_WORKDIR, '蜂群回收')
                os.makedirs(_dir, exist_ok=True)
                _fp = os.path.join(_dir, '%s.md' % b['id'])
                with _io.open(_fp, 'w', encoding='utf-8') as _f:
                    _f.write('# 蜂群批次 %s 回收记录\n\n' % b['id'])
                    for _t in b['tasks']:
                        _f.write('## 小弟 %s（%s，%s，耗时%ss）\n目标: %s\n\n产出:\n%s\n\n---\n' % (
                            _t['id'], _t.get('status'), _t.get('model', ''),
                            _t.get('elapsed'), _t['goal'], _t.get('output', '')))
                b['saved_to'] = _fp
                # [闭环修复 2026-11-02 步骤1.3] 同步镜像一份到进化报告目录，补"报告不落盘"P1
                try:
                    _evo = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), 'private', '记忆', '进化报告')
                    os.makedirs(_evo, exist_ok=True)
                    with _io.open(os.path.join(_evo, '%s.md' % b['id']), 'w', encoding='utf-8') as _f2:
                        _f2.write(_io.open(_fp, 'r', encoding='utf-8').read())
                except Exception:
                    pass  # 镜像失败不影响主落盘
            except Exception:
                pass  # 落盘失败不影响回收
            # D1: 批次回收时落一条批次级结束事件（带 trace_id + 各子任务状态）
            if b.get('trace_id'):
                try:
                    import trace_core as _tc
                    _tc.Trace(b['trace_id']).event(
                        'swarm', name='batch/%s' % b['id'],
                        status='done', collected=len(b['tasks']),
                        ok=sum(1 for _t in b['tasks'] if _t.get('status') == 'done'))
                except Exception:
                    pass
        while b['status'] != 'done' and time.time() < deadline:
            _COND.wait(timeout=1)
        return {'id': b['id'], 'status': b['status'],
                'total': len(b['tasks']), 'done': b['done_count'],
                'tasks': [{'id': t['id'], 'goal': t['goal'], 'status': t['status'],
                           'output': t.get('output', ''), 'model': t.get('model', ''),
                           'elapsed': t.get('elapsed')}
                          for t in b['tasks']]}


def poll_notifications():
    """非阻塞轮询：返回自上次轮询以来新完成的批次（小弟给主脑发的消息）。
    主脑 agent loop 每轮调用一次，把'小弟完成'作为消息注入对话，主脑不用阻塞等待。"""
    msgs = []
    with _LOCK:
        for b in _BATCHES.values():
            if b['status'] == 'done' and not b.get('notified'):
                b['notified'] = True
                b['collected'] = b.get('collected', 0)
                if not b.get('saved_to'):
                    # 首次通知时也落盘（即使主脑不主动 collect，成果也不丢）
                    try:
                        import io as _io
                        _dir = os.path.join(_SWARM_WORKDIR, '蜂群回收')
                        os.makedirs(_dir, exist_ok=True)
                        _fp = os.path.join(_dir, '%s.md' % b['id'])
                        with _io.open(_fp, 'w', encoding='utf-8') as _f:
                            _f.write('# 蜂群批次 %s 回收记录\n\n' % b['id'])
                            for _t in b['tasks']:
                                _f.write('## 小弟 %s（%s，%s，耗时%ss）\n目标: %s\n\n产出:\n%s\n\n---\n' % (
                                    _t['id'], _t.get('status'), _t.get('model', ''),
                                    _t.get('elapsed'), _t['goal'], _t.get('output', '')))
                        b['saved_to'] = _fp
                    except Exception:
                        pass
                fails = [t for t in b['tasks'] if t['status'] == 'failed']
                msgs.append({
                    'batch_id': b['id'],
                    'done': b['done_count'], 'total': len(b['tasks']),
                    'failed': len(fails),
                    'saved_to': b.get('saved_to'),
                    'failed_ids': [t['id'] for t in fails],
                })
    return msgs


def list_batches():
    with _LOCK:
        return [{'id': b['id'], 'status': b['status'],
                 'total': len(b['tasks']), 'done': b['done_count'],
                 'created_at': b['created_at']}
                for b in _BATCHES.values()]


def mermaid(batch_id):
    """生成某批次的 mermaid 状态流程图文本（可直接贴进对话渲染）。"""
    with _LOCK:
        b = _BATCHES.get(batch_id)
        if not b:
            return None
        tasks = [(t['id'], t['goal'][:30], t['status'], t.get('elapsed'),
                  t.get('output', '') or '')
                 for t in b['tasks']]
        bstat, bdone, btotal = b['status'], b['done_count'], len(b['tasks'])
        bcol = b.get('collected', 0)
    head = b['id']
    if bstat == 'done' and bcol > 0:
        rec = '已回收(第%d次)' % bcol
    elif bstat == 'done':
        rec = '待回收'
    else:
        rec = '回收: 等待完成'
    lines = ['flowchart TD',
             '  D0["蜂群批次 %s<br/>状态: %s<br/>完成 %d/%d<br/>🔁 %s"]' % (
                 head[:20], bstat, bdone, btotal, rec)]
    for tid, goal, st, el, out in tasks:
        label = '%s<br/>%s' % (tid[:14], goal.replace('"', "'"))
        dropped = ('[已丢弃' in out) or ('[已截断' in out) or ('已丢弃' in out[-80:])
        if st == 'done':
            if dropped:
                node = '  %s["⚠️ %s%s<br/>结果已丢弃→get_tool_result查回"]:::warn' % (
                    tid, label, ('<br/>%.1fs' % el) if el else '')
            else:
                node = '  %s["✅ %s%s"]:::ok' % (tid, label, ('<br/>%.1fs' % el) if el else '')
        elif st == 'failed':
            node = '  %s["❌ %s"]:::bad' % (tid, label)
        else:
            node = '  %s["⏳ %s<br/>运行中"]:::run' % (tid, label)
        lines.append(node)
        lines.append('  D0 --> %s' % tid)
    lines.append('  classDef ok fill:#1a4d2e,stroke:#4caf50,color:#fff;')
    lines.append('  classDef bad fill:#5c1a1a,stroke:#f44336,color:#fff;')
    lines.append('  classDef run fill:#4d3a1a,stroke:#ffc107,color:#fff;')
    lines.append('  classDef warn fill:#5c3a1a,stroke:#ff9800,color:#fff;')
    return '\n'.join(lines)
