# -*- coding: utf-8 -*-
# chat_gate 拆分分段模块：由原 chat_gate.py 按行段【无改动】切分，
# 由 chat_gate.py 门面加载后合并进同一命名空间（分段之间为隐式互相引用）。
# -*- coding: utf-8 -*-
"""
对话闸门 chat_gate v4 —— 模型分组多车道 + AIMD 自适应调度（所有大模型请求的唯一闸门）
================================================================
需求演进：
  v2：单车道真串行（"给大模型前面加高架桥，避免全部拥堵导致全部卡死"）
  v3：多车道 + 粘性哈希（"如何让 10 个对话同时更好地利用这些车道？"）
  v3.1：收口修复（车道编号 1 基统一、重哈希加盐、僵尸车道复活、整体持锁防双 worker）
  v4（2026-09-09）："网络响应好就更通畅，响应不好就收紧；按不同的大模型排列和排队"
    - ① 模型分组：按接口域名把活跃模型瓜分到互不相交的车道组（智谱/火山方舟
      各走各的车道，一家抽风只堵自己的组）；同对话在组内粘性，回复顺序不变。
    - ② AIMD 自适应（学 TCP 拥塞控制）：请求失败 → 该车道放行间隔指数退避
      （×2）；响应变慢（超该车道滚动中位数 slow_mult 倍）→ 轻度收紧（×1.5）；
      成功 → 间隔向基准回落（×0.75）。好→通畅，差→收紧，自动恢复。
    - ③ 车道数自适应：全局失败潮 → 车道数收缩到下限（断网风暴保护）；
      持续健康 → 回升到上限。冷却 60s 防振荡，仅内存生效不写盘。
    - ④ 兼容：provider 传空或 auto.provider_group=false 时退化为 v3.1 全池行为；
      旧 chat_gate.json 无 auto 段时用默认值。
  v4.5（2026-09-09）：对话优先级两档（作用域=同一个大模型，不同大模型不参与）：
    用户原话："第一档他加速其他减速，第二档他加速其他停止给他让道"
    - 档1 加速⚡：插队优先放行；同模型普通票放行间隔×3（减速）。
    - 档2 让道⚡：插队优先放行；同模型普通票完全让停（跑不出去），档2跑完后
      另有 20 秒独占保持期（防多轮 Agent 循环的请求间隙被普通对话钻空抢跑）。
    - 空闲 10 分钟自动降回普通（每次请求刷新保活）；仅内存生效（重启回普通）。
    - 控制入口：POST /api/gate/control {action:'set_priority', box, tier}；
      前端对话框头部 ⚡ 按钮循环切换。票面带 info['priority']，
      被让停的普通票带 info['held']=True（面板/小狗守卫可见）。

接入点（全项目仅两处，均经本闸门）：
  - routes/mixin_proxy.py        /api/proxy + /api/proxy_stream（gate 层统一入口）
面板：/gate-panel.html  控制 API：POST /api/gate/control
"""

import hashlib
import json
import os
import queue
import threading
import time

# ===== 持久化配置路径（server/private/chat_gate.json）=====
_GATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'private')
_GATE_CFG = os.path.join(_GATE_DIR, 'chat_gate.json')

_LOCK = threading.RLock()

# ===== 【v4.7 锁追踪】=====
# 现象：_LOCK 偶发被持有数十秒，几十个线程全部堵死（面板/发消息全部卡死），
# 但 py-spy 抓不到持锁线程的 Python 帧（疑似卡在 C 层）。给所有 with _LOCK:
# 换成 _gate_lock()：拿锁超过 8s 就把"持有者线程名/持有时长/持锁位置"打到 stdout，
# 一次性定位真凶。开销：每 acquire/release 多几个字典赋值，可忽略。
import contextlib as _ctxlib
import sys as _sys

_LOCK_OWNER = {'thread': None, 'ident': None, 'since': 0.0, 'where': ''}
_TLS = threading.local()   # 【v4.7.1】重入深度必须是线程本地——全局计数器在多线程下串号，会把"持有者"错标成无关线程


@_ctxlib.contextmanager
def _gate_lock(where=''):
    _me = threading.current_thread()
    _f = _sys._getframe(1)
    while _f is not None and _f.f_code.co_filename.endswith('contextlib.py'):
        _f = _f.f_back   # 跳过 contextlib.__enter__ 包装帧，拿到真实调用点
    if _f is not None:
        _site = '%s:%d' % (_f.f_code.co_filename.replace('\\', '/').split('/')[-1], _f.f_lineno)
    else:
        _site = where or '?'
    if not _LOCK.acquire(timeout=8.0):
        # 告警并打印持有者当前完整调用栈——直接看它卡在哪一行
        try:
            import traceback as _tb
            _frames = _sys._current_frames()
            _ostack = ''
            for _t in threading.enumerate():
                if _t.ident == _LOCK_OWNER.get('ident') and _t.ident in _frames:
                    _ostack = ''.join(_tb.format_stack(_frames[_t.ident])[-8:])
                    break
        except Exception:
            _ostack = '(栈获取失败)'
        print('[GateLock][WARN] %s 等锁超过 8s！持有者=%s 已持 %.1fs（acquire at %s）\n%s'
              % (_me.name, _LOCK_OWNER['thread'],
                 time.time() - _LOCK_OWNER['since'], _LOCK_OWNER['where'], _ostack),
              flush=True)
        _LOCK.acquire()
    _TLS.depth = getattr(_TLS, 'depth', 0) + 1
    if _TLS.depth == 1:
        _LOCK_OWNER.update(thread=_me.name, ident=_me.ident,
                           since=time.time(), where=_site)
    try:
        yield
    finally:
        _TLS.depth = getattr(_TLS, 'depth', 1) - 1
        if _TLS.depth <= 0:
            _LOCK_OWNER.update(thread=None, ident=None, since=0.0, where='')
        _LOCK.release()


# ===== 配置（持久化）=====
_enabled = True      # False = 闸门暂停：新请求直接 503 拒绝
_gap = 2.0           # 同车道相邻两次"连上游"的最小间隔基准（秒）
_lanes = 9           # 车道数（1~16）：每条车道独立串行，车道间并行
_cfg_mtime = 0.0

# ===== v4 自适应配置（持久化于 chat_gate.json 的 auto 段）=====
_AUTO_DEFAULTS = {
    'enabled': True,          # 总开关：False 时 gap/车道数全部固定（纯手动模式）
    'provider_group': True,   # 按接口域名分组瓜分车道（False = 全池 v3 行为）
    'min_lanes': 8,           # 车道数自适应下限
    'max_lanes': 12,          # 车道数自适应上限
    'max_gap_mult': 4.0,      # 单车道间隔退避上限倍数（gap×mult，4 → 2s 基准最长 8s；v4.7 从 16 降档）
    'slow_mult': 2.5,         # run_s 超过该车道滚动中位数 × slow_mult 视为"变慢"
}
_auto_cfg = dict(_AUTO_DEFAULTS)

# ===== 车道注册表 =====
_lane_workers = {}    # lane -> Thread
_lane_queues = {}     # lane -> queue.Queue
_lane_last_end = {}   # lane -> float（该车道上一个请求结束/强制回收的时刻）
_lane_gen = {}        # lane -> 代数；缩容时置 -1，worker 空闲且代数不符则退出
_lane_gap_mult = {}   # lane -> float（v4 AIMD 间隔倍数，1.0 = 不收紧）
_lane_run_hist = {}   # lane -> [run_s,...]（v4 最近 20 次运行时长，算慢速基线）

# 放行后超过该秒数仍未 release()，车道 worker 强制回收许可（防单请求挂死堵车道）
_RUN_TIMEOUT = 30 * 60

_seq = 0             # 全局请求序号（监控展示用）

# ===== v4 模型分组（按接口域名）=====
_provider_last_seen = {}   # 域名 -> 最后请求时刻（TTL 内视为活跃）
_PROVIDER_TTL = 600.0      # 10 分钟无请求的模型不再参与车道瓜分

# ===== v4 全局车道数自适应 =====
_global_hist = []          # 最近 40 次完成结果 [(ok, ts), ...]
_GLOBAL_HIST_MAX = 40
_last_lane_adjust = 0.0
_LANE_ADJUST_COOLDOWN = 60.0   # 车道数调节冷却（秒），防振荡；测试可临时调小

# ===== 每对话框策略：{box_id: {'allowed': bool, 'note': str}} =====
_box_rules = {}

# ===== v4.2 报废车让道：每对话网络级失败追踪 =====
# 用户需求原话："如果一个车报废了（网络异常），全局系统让他给其他对话让道先跑，
# 而不是堵在那里不断重试把其他对话堵死。"
_box_net_fail = {}          # {box: [连续失败次数 streak, 最近失败时刻 ts]}
_NET_BACKOFF_MAX = 60.0     # 应急休整退避上限（秒）
_NET_FAIL_TTL = 300.0       # 5 分钟前的失败不再触发让道（视为自然恢复）
_NET_ERR_PAT = ('urlopen error', 'urlerror', 'timed out', 'timeout',
                'connection', 'reset', 'refused', 'unreachable',
                'gaierror', 'getaddrinfo', 'ssl', 'broken pipe', 'eof')


def _is_net_error(err):
    """判定是否网络级失败（上游连不上/超时），与业务层错误（4xx/5xx 响应）区分。"""
    s = str(err or '').lower()
    return any(p in s for p in _NET_ERR_PAT)


def _net_backoff(streak):
    """应急休整时长：连续失败 2/4/8/16/32/60 秒指数退避（到点自然放行探一次）。"""
    return min(_NET_BACKOFF_MAX, 2.0 * (2 ** min(streak - 1, 5)))

# ===== v4.5 对话优先级（两档，作用域=同一个大模型）=====
# 用户需求原话："第一档他加速其他减速，第二档他加速其他停止给他让道；
# 同一个大模型；不同大模型不参与优先级。"
_PRIORITY_TTL = 600.0       # 优先级空闲保活：对话 10 分钟无请求自动降回普通
_PRIO_GRACE = 20.0          # 档2跑完后的让道保持期（秒），防多轮循环间隙被钻空
_PRIO_DECEL_MULT = 3.0      # 档1活动期间同模型普通票的放行间隔倍数（减速）
_box_priority = {}          # {box: 1/2} 对话优先级档位（仅内存，重启回普通）
_box_priority_ts = {}       # {box: 最近活跃时刻}（每次请求刷新，驱动 TTL 降回）
_prio_hold_until = {}       # {provider: 档2让道保持截止时刻}

# ===== 监控记录 =====
_MAX_HISTORY = 200
_history = []
_active = {}
_box_stats = {}


