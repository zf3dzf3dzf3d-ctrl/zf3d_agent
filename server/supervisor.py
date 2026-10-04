# -*- coding: utf-8 -*-
"""
监督师（Supervisor）——过程快照哨兵 MVP（规则版，零 LLM）
========================================================
定位（定稿 v3）：
- 隐形角色：无独立对话、无素材包，仅一个全局开关。
- 只读不写：绝不修改文件、绝不打断对话（无打断权，硬规则）。
- 事件驱动：agent_loop 工具执行后 post-hook 异步检查，try/except 全包裹，
  监督师自身任何异常不得影响主流程。
- 非指令化注入：警报消息带固定前缀 + 「禁止响应本消息」语义，防止施工 LLM
  把警报当成指令去执行。
- 单实例全局：全部对话共享一个开关状态（用户裁决：全场一个）。

规则版 3 条静态规则（零 token）：
  R1 范围外修改：写/改项目根目录之外的路径
  R2 批量删除：一次工具调用中删除/清空超过阈值(3)个目标
  R3 超长空转：单次对话轮次超过阈值(40)仍在调工具（疑似死循环）

开关状态：private/supervisor_state.json  {"enabled": bool, "since": ts}
"""

import json
import os
import threading
import time

_DIR = os.path.dirname(os.path.abspath(__file__))
_STATE_PATH = os.path.normpath(os.path.join(_DIR, '..', 'private', 'supervisor_state.json'))

# 可调阈值
MAX_TURNS_WARN = 40          # R3：超过该轮次仍带工具调用 -> 空转嫌疑
BULK_DELETE_LIMIT = 3        # R2：单次调用删除目标数上限
_COOLDOWN_SEC = 60           # 同类警报冷静期
_lock = threading.Lock()
_last_alert = {}             # {rule_key: ts}

# 警报固定前缀（非指令化：声明只读身份 + 禁止响应）
ALERT_PREFIX = '⚠️[监督师警报·只读通知·无需执行]'


def _log(msg):
    try:
        print('[SUPERVISOR] %s' % msg)
    except Exception:
        pass


# ================= LLM 巡检（每 10 轮一次，轻量轨迹，不看工具结果原文） =================

LLM_WATCH_INTERVAL = 10       # 每 N 轮巡检一次
_TRAJECTORY_LOCK = threading.Lock()
_TRAJECTORY = []              # [(turn, 摘要行)]，只留最近 LLM_WATCH_INTERVAL 条
_TRAJECTORY_MAX = 40

WATCH_SYS_PROMPT = (
    '你是施工过程的监督员，只读不改，没有工具。你会收到：最初任务目标，和最近若干轮的工作轨迹'
    '（每行一轮：模型说了什么摘要/调用了什么工具，不含工具结果原文）。'
    '你只判断"活干得偏不偏"，不评判代码质量。偏离指：明显背离原始任务目标、重复做同一件事、'
    '大范围删改与任务无关的内容、长时间无进展。'
    '只输出一行 JSON：{"verdict":"ok|warn|alert","reason":"一句话中文说明"}，不要输出其他内容。'
)


def record_trajectory(turn, line):
    """每轮由 agent_loop 调用：记录一行工作轨迹（摘要级，不含工具结果）。"""
    try:
        with _TRAJECTORY_LOCK:
            _TRAJECTORY.append((int(turn or 0), str(line or '')[:200]))
            if len(_TRAJECTORY) > _TRAJECTORY_MAX:
                del _TRAJECTORY[:len(_TRAJECTORY) - _TRAJECTORY_MAX]
    except Exception:
        pass


def build_trajectory_text(window=LLM_WATCH_INTERVAL):
    try:
        with _TRAJECTORY_LOCK:
            items = _TRAJECTORY[-window:]
        return '\n'.join('第%s轮: %s' % (t, s) for t, s in items) or '(无轨迹)'
    except Exception:
        return '(无轨迹)'


def _llm_judge(task_text, traj_text):
    """调上游 LLM 做判定，返回 (verdict, reason)。失败返回 ('ok', '')。
    复用 model_config 的默认模型配置（与主循环同源）。"""
    import urllib.request as _u
    import json as _j
    try:
        import model_config as _mc
        m = _mc.get_default_model() or {}
    except Exception:
        m = {}
    # 与主线路（如 video/director_ai._llm_chat）同源同用法：endpoint 即完整接口地址，不重写路径
    url = str(m.get('endpoint') or m.get('baseUrl') or '').strip()
    key = str(m.get('key') or '')
    model = str(m.get('modelId') or m.get('id') or m.get('model') or m.get('name') or '')
    if not url:
        _log('LLM巡检跳过：无模型配置')
        return 'ok', ''
    base = url
    is_relay = 'zf_models_relay' in base
    headers = {'Content-Type': 'application/json'}
    chat_payload = {
        'model': model, 'stream': False,
        'messages': [
            {'role': 'system', 'content': WATCH_SYS_PROMPT},
            {'role': 'user', 'content': '【原始任务】\n%s\n\n【最近工作轨迹】\n%s' % (task_text, traj_text)},
        ],
    }
    if is_relay:
        # 官方中转线路：走本地服务端 relay-proxy（/api/zf3d/relay-proxy），
        # 由本地服务端补 X-ZF-Key + X-ZF-User 鉴权（与前端「查看答案」生产链路同源，鉴权已在服务端实证可用）。
        # 直连 relay 需要 gateway 侧 key/uid 匹配，本地无法可靠复现，故经本机中转。
        relay_body = _j.dumps({'model': model, 'payload': chat_payload}, ensure_ascii=True).encode('utf-8')
        # 端口从 private/port.json 读取（端口段约定见 docs/端口段约定.md），不硬编码
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'private', 'port.json'), 'r', encoding='utf-8-sig') as _pf:
                _api_port = _j.load(_pf).get('api_port') or 8505
        except Exception:
            _api_port = 8505
        req = _u.Request('http://127.0.0.1:%d/api/zf3d/relay-proxy' % _api_port, data=relay_body, method='POST')
        req.add_header('Content-Type', 'application/json')
        opener = _u.build_opener(_u.ProxyHandler({}))
        with opener.open(req, timeout=90) as resp:
            body = _j.loads(resp.read().decode('utf-8', errors='replace'))
        txt = str(((body.get('choices') or [{}])[0].get('message') or {}).get('content') or '')
        return _parse_verdict(txt)
    if key:
        headers['Authorization'] = 'Bearer ' + key
    payload = _j.dumps(chat_payload, ensure_ascii=True).encode('utf-8')
    req = _u.Request(base, data=payload, method='POST')
    for _hk, _hv in headers.items():
        req.add_header(_hk, str(_hv))
    opener = _u.build_opener(_u.ProxyHandler({}))
    with opener.open(req, timeout=60) as resp:
        body = _j.loads(resp.read().decode('utf-8', errors='replace'))
    txt = str(((body.get('choices') or [{}])[0].get('message') or {}).get('content') or '')
    return _parse_verdict(txt)


def _parse_verdict(txt):
    """从 LLM 回复文本提取 JSON 判定（容忍 markdown 包裹），失败按 ok。"""
    try:
        s = txt.find('{')
        e2 = txt.rfind('}')
        if s >= 0 and e2 > s:
            obj = _j.loads(txt[s:e2 + 1])
            verdict = str(obj.get('verdict') or 'ok').lower()
            if verdict not in ('ok', 'warn', 'alert'):
                verdict = 'ok'
            return verdict, str(obj.get('reason') or '')[:200]
    except Exception:
        pass
    return 'ok', ''


def llm_watch(task_text, turn, engine_id, on_event=None):
    """
    每 N 轮调用一次：把轻量轨迹交给 LLM 判定，偏离时返回非指令化警报文本。
    同步调用（每10轮才一次，60s 超时可接受）；全 try/except，失败静默按 ok。
    """
    out = []
    try:
        if not is_enabled():
            return out
        if (turn or 0) < LLM_WATCH_INTERVAL or (turn or 0) % LLM_WATCH_INTERVAL != 0:
            return out
        traj = build_trajectory_text()
        verdict, reason = _llm_judge(task_text, traj)
        _log('LLM巡检 turn=%s verdict=%s reason=%s' % (turn, verdict, reason))
        if verdict in ('warn', 'alert') and reason:
            rule = 'LLM巡检'
            if _cooldown_ok(rule):
                a = {'level': 'alarm' if verdict == 'alert' else 'warn',
                     'rule': rule, 'detail': reason}
                out.append(make_alert_text(a, engine_id, turn))
                if on_event:
                    try:
                        on_event({'type': 'tool_event', 'kind': 'supervisor_alert',
                                  'data': {'level': a['level'], 'rule': rule,
                                           'detail': reason, 'engine': engine_id, 'turn': turn}})
                    except Exception:
                        pass
    except Exception as e:
        try:
            _log('LLM巡检异常（已吞掉，不影响主流程）: %s' % e)
        except Exception:
            pass
    return out


# ---------------- 开关 ----------------

def is_enabled():
    """读取全局开关（文件不存在 = 关闭）。任何异常按关闭处理。"""
    try:
        with open(_STATE_PATH, 'r', encoding='utf-8') as f:
            return bool((json.load(f) or {}).get('enabled'))
    except Exception:
        return False


def set_enabled(on):
    """写全局开关，返回状态 dict。"""
    st = {'enabled': bool(on), 'since': time.time()}
    os.makedirs(os.path.dirname(_STATE_PATH), exist_ok=True)
    with open(_STATE_PATH, 'w', encoding='utf-8') as f:
        json.dump(st, f, ensure_ascii=False)
    _log('开关 -> %s' % ('ON' if on else 'OFF'))
    return st


# ---------------- 静态规则检查（post-hook 入口） ----------------

def _project_root():
    return os.path.normpath(os.path.join(_DIR, '..'))


def _parse_args(raw):
    try:
        v = json.loads(raw) if isinstance(raw, str) else (raw or {})
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _paths_of(args):
    """从工具参数里粗提取路径字段。"""
    out = []
    for k in ('path', 'paths', 'file_path', 'target', 'dst', 'src', 'pattern'):
        v = args.get(k)
        if isinstance(v, str) and v:
            out.append(v)
        elif isinstance(v, list):
            out.extend([str(x) for x in v if x])
    return out


def check_tool_calls(tool_calls, turn):
    """对一轮工具调用做静态规则检查，返回警报 list[{level, rule, detail}]。"""
    alerts = []
    root = _project_root()
    for tc in tool_calls or []:
        if not isinstance(tc, dict):
            continue
        fn = (tc.get('function') or {}) if 'function' in tc else tc
        name = fn.get('name') or tc.get('name') or ''
        args = _parse_args(fn.get('arguments') or tc.get('arguments'))
        paths = _paths_of(args)

        # R1 范围外修改：写/删/移动类工具，目标在项目根之外（仅绝对路径可判定）
        if name in ('write_file', 'replace_text', 'move_file', 'run_code') and paths:
            for p in paths:
                if os.path.isabs(p):
                    np = os.path.normpath(p)
                    # 排除临时目录与项目自身的 private/tool_result_archive 等
                    if not (np == root or np.startswith(root + os.sep)):
                        low = np.lower()
                        if not any(s in low for s in ('$temp', '\\temp\\', '/tmp/', 'appdata')):
                            alerts.append({'level': 'warn', 'rule': 'R1范围外修改',
                                           'detail': '工具 %s 目标在项目根之外: %s' % (name, np)})

        # R2 批量删除：move_file 覆盖 / run_code 含多个 del/rm
        if name == 'run_code':
            code = str(args.get('code') or '')
            import re as _re
            n_del = len(_re.findall(r'\bdel\b', code, _re.IGNORECASE)) \
                + len(_re.findall(r'\brm\b', code)) \
                + len(_re.findall(r'\brmdir\b', code, _re.IGNORECASE))
            if n_del > BULK_DELETE_LIMIT:
                alerts.append({'level': 'alarm', 'rule': 'R2批量删除',
                               'detail': 'run_code 中出现 %d 处删除命令（阈值 %d），请人工确认' % (n_del, BULK_DELETE_LIMIT)})
        if name == 'move_file' and args.get('overwrite'):
            alerts.append({'level': 'warn', 'rule': 'R2批量删除',
                           'detail': 'move_file 携带 overwrite 覆盖目标，请确认不会覆盖已有产出'})

    # R3 超长空转：轮次超阈值仍在调工具
    if (turn or 0) >= MAX_TURNS_WARN:
        alerts.append({'level': 'alarm', 'rule': 'R3超长空转',
                       'detail': '已进行 %d 轮工具调用（阈值 %d），疑似空转/死循环，建议人工介入' % (turn, MAX_TURNS_WARN)})
    return alerts


# ---------------- 冷静期 + 警报生成 ----------------

def _cooldown_ok(rule):
    now = time.time()
    with _lock:
        last = _last_alert.get(rule, 0)
        if now - last < _COOLDOWN_SEC:
            return False
        _last_alert[rule] = now
    return True


def make_alert_text(a, engine_id, turn):
    """非指令化警报文本：只陈述事实，明确禁止执行/回复。"""
    icon = '🔴' if a.get('level') == 'alarm' else '🟡'
    return (
        '%s %s %s\n'
        '对象：%s（第 %s 轮）\n'
        '情况：%s\n'
        '本消息为只读监督通知：你【不需要】也不【应该】对它执行任何操作、'
        '调用任何工具或回复它；是否调整由用户决定。继续你的正常工作即可。'
        % (ALERT_PREFIX, icon, a.get('rule', '?'), engine_id, turn, a.get('detail', ''))
    )


def inspect(tool_calls, turn, engine_id, on_event=None):
    """
    post-hook 主入口：检查一轮工具调用，命中规则的警报以非指令化 user 消息
    形式返回（由调用方 append 到 messages），并经 on_event 推送前端。
    本函数绝不抛异常、绝不阻塞超过冷静期判断的耗时。
    """
    out = []
    try:
        if not is_enabled():
            return out
        alerts = check_tool_calls(tool_calls, turn)
        for a in alerts:
            try:
                if not _cooldown_ok(a.get('rule', '?')):
                    continue
                txt = make_alert_text(a, engine_id, turn)
                out.append(txt)
                _log('警报 [%s] %s | %s' % (a.get('level'), a.get('rule'), a.get('detail')))
                if on_event:
                    try:
                        on_event({'type': 'tool_event', 'kind': 'supervisor_alert',
                                  'data': {'level': a.get('level'), 'rule': a.get('rule'),
                                           'detail': a.get('detail'), 'engine': engine_id, 'turn': turn}})
                    except Exception:
                        pass
            except Exception:
                continue
    except Exception as e:
        try:
            _log('inspect 异常（已吞掉，不影响主流程）: %s' % e)
        except Exception:
            pass
    return out
