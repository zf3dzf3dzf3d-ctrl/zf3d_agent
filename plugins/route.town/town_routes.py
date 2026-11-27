# -*- coding: utf-8 -*-
"""i小镇 E3 记忆治理 + 只读读端（S2 首项，2026-11-18）。

职责：
1. E3 记忆治理：读取记忆 md 时按作废标记过滤（[VOIDED] 行头或 voided:true 元行）；
   write_memory 追加记忆（append-only，单文件单写者边界由调用方互斥保证）。
2. town 只读读端：/api/town/events 与 /api/town/memories 走 dispatcher 注册表，
   只读、append-only 红线（架构师第4轮刺①：读端禁止回写/标记已消费）。

记忆条格式约定（E3）：
  正常条目行：`- 【...】内容` 或任意行
  作废标记：   `- [VOIDED] 原内容`（整行以 [VOIDED] 开头即过滤）
"""
import json
import threading

# 记忆目录（server 进程直读直写，与 town_events 同一红线口径）
import os as _os
_MEM_DIR = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.dirname(
    _os.path.abspath(__file__)))), 'private', '记忆', '小镇')

# 单文件单写者互斥（策划案 S2：同一角色同时只接一单）
_mem_locks = {}
_mem_locks_guard = threading.Lock()


def _lock_for(role):
    with _mem_locks_guard:
        if role not in _mem_locks:
            _mem_locks[role] = threading.Lock()
        return _mem_locks[role]


def filter_voided(text):
    """E3 核心：按 [VOIDED] 标记过滤记忆条目，返回有效条目列表。"""
    out = []
    for line in (text or '').splitlines():
        s = line.strip()
        if not s or s.startswith('#'):
            continue
        if s.startswith('[VOIDED]') or s.startswith('- [VOIDED]'):
            continue
        out.append(s)
    return out


def read_memory(role, max_chars=2000):
    """读角色记忆（已过滤作废条目）。只读。"""
    fp = _os.path.join(_MEM_DIR, role + '.md')
    try:
        with open(fp, 'r', encoding='utf-8-sig') as f:
            return filter_voided(f.read(max_chars * 8))[:20]
    except Exception:
        return []


def write_memory(role, entry):
    """追加一条记忆（append-only；entry 内含 [VOIDED] 前缀视为非法拒绝）。
    2026-11-20 防双横线：write_memory 自己加 '- ' 前缀（L67），调用方若再传 '- 【…'
    会落盘成 '- - 【…'，LLM 读到坏记忆又模仿输出 → 嵌套复发。入口统一剥掉前缀。"""
    if not role or not entry:
        return {'ok': False, 'err': 'role/entry 必填'}
    entry = str(entry).lstrip(' 　-*•-')
    if '[VOIDED]' in entry[:12]:
        return {'ok': False, 'err': '禁止外部写入 VOIDED 标记'}
    with _lock_for(role):
        try:
            _os.makedirs(_MEM_DIR, exist_ok=True)
            with open(_os.path.join(_MEM_DIR, role + '.md'), 'a', encoding='utf-8') as f:
                f.write('\n- %s\n' % str(entry)[:500])
            return {'ok': True}
        except Exception as e:
            return {'ok': False, 'err': str(e)}


def void_memory(role, keyword):
    """E3 作废操作：给命中关键词的记忆条目行加 [VOIDED] 前缀（原地改写，唯一允许的非追加写）。"""
    fp = _os.path.join(_MEM_DIR, role + '.md')
    with _lock_for(role):
        try:
            with open(fp, 'r', encoding='utf-8-sig') as f:
                lines = f.readlines()
            n = 0
            for i, ln in enumerate(lines):
                s = ln.strip()
                if s and not s.startswith('#') and not s.startswith('[VOIDED]') and keyword in s:
                    lines[i] = '- [VOIDED] ' + s.lstrip('- ').rstrip() + '\n'
                    n += 1
            with open(fp, 'w', encoding='utf-8') as f:
                f.writelines(lines)
            return {'ok': True, 'voided': n}
        except Exception as e:
            return {'ok': False, 'err': str(e)}


def _read_events(limit=50):
    """读事件流 jsonl 尾部 N 条。只读。"""
    import json as _json
    ev_path = _os.path.join(_MEM_DIR, 'events.jsonl')
    try:
        with open(ev_path, 'r', encoding='utf-8-sig') as f:
            lines = f.readlines()
        out = []
        for ln in lines[-limit:]:
            ln = ln.strip()
            if not ln:
                continue
            try:
                out.append(_json.loads(ln))
            except Exception:
                pass
        return out
    except Exception:
        return []


# ---------- town 只读路由（dispatcher 注册表，禁追加 if-path）----------

# ---------- 村民聊天/工作聚合（可视化读端，append-only 只读） ----------

def _read_chat(limit=120):
    """聚合聊天流：_crew 下各工单 bus.jsonl 的对话（谁说了什么）+ 各村民记忆条目。
    返回统一消息列表 [{ts, from, kind, text}]，按时间倒序。只读。"""
    import json as _json
    crew_dir = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
                             'data', '_crew')
    msgs = []
    try:
        if _os.path.isdir(crew_dir):
            for fn in sorted(_os.listdir(crew_dir)):
                if not fn.endswith('.bus.jsonl'):
                    continue
                try:
                    with open(_os.path.join(crew_dir, fn), 'r', encoding='utf-8-sig') as f:
                        for ln in f:
                            ln = ln.strip()
                            if not ln:
                                continue
                            try:
                                o = _json.loads(ln)
                            except Exception:
                                continue
                            msgs.append({
                                'ts': o.get('ts') or 0,
                                'from': str(o.get('from') or '?'),
                                'kind': str(o.get('type') or 'chat'),
                                'text': str(o.get('text') or '')[:300],
                            })
                except Exception:
                    pass
    except Exception:
        pass
    # 村民记忆（作为工作日志类消息）
    try:
        for fn in sorted(_os.listdir(_MEM_DIR)):
            if not fn.endswith('.md') or fn == 'events.jsonl':
                continue
            role = fn[:-3]
            for m in read_memory(role):
                msgs.append({'ts': 0, 'from': role, 'kind': 'memory', 'text': m[:300]})
    except Exception:
        pass
    # 2026-11-20 去重：同 (from,kind,text) 只保留最早一条，消掉 bus.jsonl/记忆追加式带来的重复刷屏
    seen = set()
    uniq = []
    for m in msgs:
        key = (m.get('from'), m.get('kind'), m.get('text'))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(m)
    uniq.sort(key=lambda x: x.get('ts') or 0, reverse=True)
    return uniq[:limit]


def _route_get_chat(self, path, parsed):
    """/api/town/chat —— 村民聊天+工作消息聚合（可视化用，只读）。"""
    try:
        if path == '/api/town/chat':
            self._send_json({'ok': True, 'messages': _read_chat()})
            return True
    except Exception:
        pass
    return False


def _read_outputs(limit=60):
    """成果展廊读端：列出 outputs 目录下工单产出文件（job-*.md），只读。"""
    out = []
    try:
        d = _os.path.join(_MEM_DIR, 'outputs')
        for fn in sorted(_os.listdir(d), reverse=True):
            if not (fn.startswith('job-') and fn.endswith('.md')):
                continue
            fp = _os.path.join(d, fn)
            try:
                st = _os.stat(fp)
                out.append({'file': fn, 'size': st.st_size, 'mtime': st.st_mtime})
            except Exception:
                pass
            if len(out) >= limit:
                break
    except Exception:
        pass
    return out


def _read_output_file(fn, max_chars=4000):
    """读单个产出文件全文（白名单 job-*.md，防路径穿越）。只读。"""
    import re as _re2
    if not _re2.match(r'^job-[\w.-]{1,80}\.md$', fn or ''):
        return None
    fp = _os.path.join(_MEM_DIR, 'outputs', fn)
    try:
        with open(fp, 'r', encoding='utf-8-sig') as f:
            return f.read(max_chars * 4)
    except Exception:
        return None


def _route_get(self, path, parsed):
    try:
        if path == '/api/town/events':
            self._send_json({'ok': True, 'events': _read_events()})
        elif path == '/api/town/outputs':
            qs = parsed.query or ''
            fn = ''
            for kv in qs.split('&'):
                if kv.startswith('file='):
                    import urllib.parse as _up
                    fn = _up.unquote(kv[5:])
            if fn:
                txt = _read_output_file(fn)
                self._send_json({'ok': bool(txt), 'file': fn,
                                 'content': txt or '', 'err': '' if txt else '文件不存在'})
            else:
                self._send_json({'ok': True, 'outputs': _read_outputs()})
        elif path == '/api/town/memories':
            qs = parsed.query or ''
            role = ''
            for kv in qs.split('&'):
                if kv.startswith('role='):
                    import urllib.parse as _up
                    role = _up.unquote(kv[5:])
            if not role:
                self._send_json({'ok': False, 'err': '缺 role 参数'})
            else:
                self._send_json({'ok': True, 'role': role, 'memories': read_memory(role)})
        elif path == '/api/town/jobs-active':
            # 空闲自动重启调度器（idle_auto_restart）探测用：有在途工单（非终态且
            # 15分钟内有心跳）则返回 active=true，调度器跳过本轮无感重启——
            # 修盲区：重启调度器只看 chat-pool，村民后台干活被无感重启掐断（job-1795378354282 实锤）。
            _Fresh = _time.time() - 900
            _n = sum(1 for _j in _town_jobs_snapshot()
                     if _j.get('state') not in _JOB_TERMINAL
                     and float(_j.get('updated_at') or 0) > _Fresh)
            self._send_json({'ok': True, 'active': _n > 0, 'n': _n})
        else:
            return False
        return True
    except Exception:
        return False


def _sync_crew_villagers():
    """步骤5 成员落户：扫 server/data/_crew/*.json 黑板成员，为尚无状态卡的成员懒建档（零模型调用）。"""
    try:
        from engines.common import town_state as _ts
        crew_dir = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
                                 'data', '_crew')
        if not _os.path.isdir(crew_dir):
            return
        have = set()
        for fn in _os.listdir(_ts._STATE_DIR):
            if fn.endswith('.md'):
                have.add(fn[:-3])
        for fn in sorted(_os.listdir(crew_dir)):
            if not fn.endswith('.json'):
                continue
            try:
                with open(_os.path.join(crew_dir, fn), 'r', encoding='utf-8') as f:
                    board = json.load(f)
            except Exception:
                continue
            wins = board.get('windows') or board.get('members') or {}
            roles = []
            if isinstance(wins, dict):
                roles = [str(k) for k in wins.keys()]
            elif isinstance(wins, list):
                roles = [str(w.get('id') or w.get('name') or '') for w in wins if isinstance(w, dict)]
            for r in roles:
                r = r.strip()
                if r and r not in have:
                    try:
                        _ts.bump_xp(r, 0, note='落户建档')  # xp+0 首次自动建卡
                        have.add(r)
                    except Exception:
                        continue
    except Exception:
        pass

def _route_get_state(self, path, parsed):
    """S2.5 自知层只读端点：/api/town/state[?role=x]——列出全村村民或读指定村民状态卡。"""
    try:
        _revive_scan_once()  # P0 重启复活：小镇页面轮询本端点即触发（仅一次）
        from engines.common.town_state import read_state as _read_state
        qs = parsed.query or ''
        role = ''
        for kv in qs.split('&'):
            if kv.startswith('role='):
                import urllib.parse as _up
                role = _up.unquote(kv[5:])
        if role:
            st = _read_state(role)
            if st is None:
                self._send_json({'ok': False, 'err': '该村民尚无状态卡'})
            else:
                self._send_json({'ok': True, 'role': role, 'state': st})
        else:
            try:
                _sync_crew_villagers()
            except Exception:
                pass
            out = []
            try:
                from engines.common.town_state import _STATE_DIR as _SD
                d = _SD
                for fn in sorted(_os.listdir(d)):
                    if fn.endswith('.md'):
                        out.append(_read_state(fn[:-3]) or '')
            except Exception:
                pass
            self._send_json({'ok': True, 'villagers': len(out), 'states': out})
        return True
    except Exception:
        return False


def _route_post(self, path, parsed):
    """仅允许 write_memory / void_memory 两个写动作（E3 治理入口）。"""
    try:
        body = self._read_body() or {}
        if path == '/api/town/memory-write':
            self._send_json(write_memory(str(body.get('role') or ''), str(body.get('entry') or '')))
        elif path == '/api/town/memory-void':
            self._send_json(void_memory(str(body.get('role') or ''), str(body.get('keyword') or '')))
        else:
            return False
        return True
    except Exception:
        return False


# ---------- B5 镇务产出观测（旁挂记账，异常全吞，不碰主逻辑） ----------
_JOB_LEDGER_PATH = _os.path.join(_MEM_DIR, 'job_ledger.jsonl')

def _job_ledger(job_id, role, source, state, review_state='', task='', result='', extra=None):
    """镇务工单结构化记账（B5）：每次派工收尾追加一行 jsonl 到 private/记忆/小镇/job_ledger.jsonl。
    旁挂纪律：任何异常静默吞掉（记账失败绝不影响派工主流程）。
    state: done/error/no_deliverable/...  review_state: ''/done/no-reviewer/error"""
    try:
        import json as _json
        from datetime import datetime as _dtl
        rec = {
            'ts': _dtl.now().astimezone().isoformat(),
            'job_id': job_id, 'role': role, 'source': source,
            'state': state, 'review_state': review_state,
            'ok': bool(state == 'done' and (not review_state or review_state == 'done')),
            'task': (task or '')[:100], 'result': (result or '')[:100],
        }
        if extra:
            rec.update(extra)
        _os.makedirs(_os.path.dirname(_JOB_LEDGER_PATH), exist_ok=True)
        with open(_JOB_LEDGER_PATH, 'a', encoding='utf-8') as f:
            f.write(_json.dumps(rec, ensure_ascii=False) + '\n')
    except Exception:
        pass


# ---------- P0 工单持久化+重启复活（2026-11-23） ----------
# 实锤根因（调查-托管派单准确有效落盘不稳根因-20261123）：派单收尾才一次性记账
# （_job_ledger 仅在 worker 最后一行），环境自愈重启杀死守护线程后工单零痕迹蒸发
# （job-1795378354282 审单半路死亡，无 done 事件、无台账、无复活）。
# 本节把工单改为阶段态持久化：claimed→working→reviewing→done/failed 每阶段即写
# server/data/town_jobs.json；进程启动后首次小镇接口触发 _revive_scan_once：
# 遗留非终态工单定性 dead，并按预算自动复活（每单至多 1 次、每次启动至多 2 单）。
import time as _time

_JOB_STATE_PATH = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
                                'data', 'town_jobs.json')
_JOB_STATE_LOCK = threading.Lock()
_JOB_TERMINAL = ('done', 'failed', 'dead')
TOWN_REVIVE_ENABLE = (_os.environ.get('ZF_TOWN_REVIVE', '') or '1') not in ('0', 'false', 'False')
try:
    TOWN_REVIVE_MAX_PER_BOOT = int(_os.environ.get('ZF_TOWN_REVIVE_MAX', '') or 2)
except ValueError:  # 环境变量配错数字不能崩模块加载
    TOWN_REVIVE_MAX_PER_BOOT = 2
_revive_scan_done = False
_revive_lock = threading.Lock()


# ---------- 第4轮（2026-11-23）：稳定原语收编到零依赖通用模块 ----------
# 原子写/阶段态/心跳/复活预算已提炼为 engines/common/steady_store.py（零依赖可移植，
# 其他项目整文件拷走即可用）。本文件保留同名薄壳委托 + 进程内锁，API 与测试不变。
_STORES = {}


def _store():
    """JobStore 实例按路径缓存（测试换 _JOB_STATE_PATH 即自动切换实例）。"""
    p = _JOB_STATE_PATH
    s = _STORES.get(p)
    if s is None:
        from engines.common.steady_store import JobStore as _JS
        s = _JS(p)
        _STORES[p] = s
    return s


def _load_job_state():
    with _JOB_STATE_LOCK:
        return _store().load()


def _save_job_state(d):
    with _JOB_STATE_LOCK:
        return _store().save(d)


def _job_state(job_id, state, role='', task='', review_state=None, result=None, meta=None):
    """工单阶段落盘：同一 job_id 就地更新状态行（文件上限 200 条，最新在头部）。
    meta 仅建行首写时合并（tid/source/revived_from 等派单上下文，供托管回查对账）。"""
    with _JOB_STATE_LOCK:
        return _store().update(job_id, state, role=role, task=task,
                               review_state=review_state, result=result, meta=meta)


def _town_jobs_snapshot():
    """只读快照（托管回查用）：返回工单记录列表（最新在头部）。"""
    with _JOB_STATE_LOCK:
        return _store().snapshot()


def _job_touch(job_id, min_gap=30.0):
    """工单心跳：仅刷新 updated_at 不改阶段状态（工具调用时触发，min_gap 节流）。"""
    with _JOB_STATE_LOCK:
        return _store().touch(job_id, min_gap=min_gap)


def _revive_scan_once():
    """重启复活扫描（进程生命周期内仅跑一次，小镇接口首见触发）：
    1) 上个进程遗留的非终态工单全部定性 dead（守护线程随旧进程死亡，不可能再有新进展）；
    2) 按预算自动复活：新单 meta.revived_from 指回旧单，旧单记 revived_as 指向新单
       （托管回查据 revived_as 改盯新单）；每单至多复活 1 次（复活的单再死不套娃），
       每次启动至多 TOWN_REVIVE_MAX_PER_BOOT 单（花钱类操作设上限红线）。"""
    global _revive_scan_done
    if _revive_scan_done:
        return
    with _revive_lock:  # 双检查防两 API 线程并发触发重复复活派单
        if _revive_scan_done:
            return
        _revive_scan_done = True
        try:
            dead_jobs = _store().mark_stale_dead()
        except Exception:
            _revive_scan_done = False  # 失败置回：允许后续小镇接口触发重试（boot 早期环境未就绪场景）
            return
        for j in dead_jobs:
            try:
                from engines.common.town_events import emit
                emit('镇长', 'system', {'text': '工单 %s（%s…）因重启中断，已标记死亡'
                                            % (j.get('job_id'), str(j.get('task') or '')[:40])})
            except Exception:
                pass
        if not TOWN_REVIVE_ENABLE or not dead_jobs:
            return

        def _prepare_revival(rec):
            # 复活前角色在册校验：村民已不在册（如改名前的旧档）→ 清空由 impl 自动选人，防派给空气
            role = rec.get('role') or ''
            if role and role not in _pick_all_villagers():
                role = ''
            meta = {'tid': rec.get('tid'),
                    'source': rec.get('source') or 'assign',
                    'revived_from': rec.get('job_id')}
            return role, rec.get('task') or '', meta

        def _announce_revival(rec, new_id):
            try:
                from engines.common.town_events import emit
                emit('镇长', 'system', {'text': '工单 %s 已自动复活为 %s，村民重新开工'
                                            % (rec.get('job_id'), new_id)})
            except Exception:
                pass

        # FIFO 旧单先复活（dead_jobs 最新在头部，reversed 后先派的先回来）；
        # 复活过的单（revived_from 已存在）不套娃——预算纪律在 steady_store.revive 内执行
        _store().revive(reversed(dead_jobs), dispatch=_town_assign_impl,
                        budget=TOWN_REVIVE_MAX_PER_BOOT,
                        skip=lambda rec: bool(rec.get('revived_from'))
                        or not str(rec.get('task') or '').strip(),
                        prepare=_prepare_revival,
                        announce=_announce_revival)


def _review_pass_evidence(review_state, review_full, tool_calls):
    """审单通过判定（防橡皮图章，第4轮收尾抽出可测）：引擎 done + 至少 1 次真实工具调用
    + 判定标记。task_complete 被 loop_s 拦截不经过引擎，calls 天然只统计真核查——
    零核查的 PASS = 光说不查，不采信。
    第7轮修正：判定标记取【最后出现】的那个——第5轮起 result 会回退 reasoning_content，
    思维链可能两个词都提到（"通过应写REVIEW_PASS，但发现X应写REVIEW_FAIL"），
    按包含判定会误判通过；结论性用词在文末，取最后出现者为准。"""
    try:
        _n = int(tool_calls or 0)
    except (TypeError, ValueError):
        _n = 0
    if review_state != 'done' or _n < 1:
        return False
    txt = review_full or ''
    _p = txt.rfind('REVIEW_PASS')
    _f = txt.rfind('REVIEW_FAIL')
    if _p < 0:
        return False
    if _f < 0:
        return True
    return _p > _f  # 双标记并存：最后一次出现者为准（多次翻转取最终结论）


def _deliverable_gate(ov_dir, job_ts):
    """交付物双闸（v6.1 存在闸 + P1 内容闸，2026-11-23 第2轮抽出可测）：
    返回 None=过闸；否则返回判败原因文本（fail-closed：闸自身异常也判败——
    反造假闸异常放行=形同虚设）。
    存在闸：派单后必须有 mtime 更新的新文件（防空手报 done）。
    内容闸：新产出必须是成稿——宏命令「第一件事先建产出文件」会诱导村民先建骨架占坑，
    实测 job-1795378354282 半截草稿（标题含「草稿，取证中」）骗过存在性闸，
    故新文件前3行命中「草稿/取证中/待补/初稿」占位标记，或最大新文件不足100字节即判败。"""
    try:
        _t_new = 0
        _biggest = 0
        _skeleton = []
        for _rt, _dfs, _fs in _os.walk(ov_dir):
            for _f in _fs:
                _fp = _os.path.join(_rt, _f)
                try:
                    _mt = _os.path.getmtime(_fp)
                except OSError:
                    continue
                if _mt > _t_new:
                    _t_new = _mt
                if _mt <= job_ts - 5:  # 5s 容差：只查本单新产出
                    continue
                try:
                    _biggest = max(_biggest, _os.path.getsize(_fp))
                    _head = ''
                    with open(_fp, 'r', encoding='utf-8', errors='replace') as _gf:
                        for _i, _ln in enumerate(_gf):
                            if _i >= 3:
                                break
                            _head += _ln
                except (OSError, ValueError):
                    _head = ''
                for _mk in ('草稿', '取证中', '待补', '初稿'):
                    if _mk in _head:
                        _skeleton.append('%s（前3行含占位标记「%s」）' % (_f, _mk))
                        break
        if _t_new <= job_ts - 5:
            return 'outputs_villager/ 派单后无新产出，空手报done不算完成'
        if _skeleton:
            return '新产出是骨架草稿不是成稿: %s' % '；'.join(_skeleton[:2])
        if _biggest < 100:
            return '新产出最大文件仅 %d 字节，不足成稿' % _biggest
        return None
    except Exception as _ve:
        return '交付物闸异常: %s' % _ve


def _manual_impl(role, task, output=''):
    """手动派工核心（v3.1 P1）：1村民×1任务，产出落盘+记忆+XP+事件。零定时器。"""
    _revive_scan_once()  # P0 重启复活：小镇接口首见触发（进程生命周期内仅一次）
    role = (role or '').strip()
    task = (task or '').strip()
    if not role or not task:
        return {'ok': False, 'err': 'role/task 必填'}
    import re as _re
    if not _re.match(r'^[\w\u4e00-\u9fff\-]{1,40}$', role):
        return {'ok': False, 'err': 'role 非法（限字母数字中文下划线连字符≤40）'}
    from datetime import datetime as _dt
    ts = _dt.now().astimezone().isoformat()
    job_id = 'job-%d' % int(_dt.now().timestamp() * 1000)
    # 1) 产出落盘（用户给了产出则写文件，否则记录任务本身）
    out_dir = _os.path.join(_MEM_DIR, 'outputs')
    out_path = ''
    try:
        _os.makedirs(out_dir, exist_ok=True)
        out_path = _os.path.join(out_dir, job_id + '.md')
        with open(out_path, 'w', encoding='utf-8') as f:
            # 销账整改：产出正文压平单行缩进块（防换行/# 打破坏 markdown 版式，无注入面）
            safe_out = (output or task).replace('\r', ' ').replace('\n', ' ')\
                .replace('#', '\\#').strip() or task
            f.write('# %s 的产出（任务：%s）\n\n- 时间：%s\n\n%s\n' % (role, task, ts, safe_out))
    except Exception as e:
        return {'ok': False, 'err': '产出落盘失败: %s' % e}
    steps = {}
    # 2) 记忆追加（经历入档）
    try:
        mem = write_memory(role, '- 【派工完成】%s（job=%s）' % (task, job_id))
        steps['memory'] = {'ok': bool(mem.get('ok')), 'err': mem.get('err', '')}
    except Exception as e:
        steps['memory'] = {'ok': False, 'err': str(e)}
        mem = {'ok': False}
    # 3) XP +1
    try:
        from engines.common.town_state import bump_xp
        bump_xp(role, 1, note='manual %s' % job_id)
        steps['xp'] = {'ok': True}
    except Exception as e:
        steps['xp'] = {'ok': False, 'err': str(e)}
    # 4) 事件总线
    try:
        from engines.common.town_events import emit, ensure_flusher
        emit('dispatch_post', 'dispatch', {'job_id': job_id, 'role': role, 'task': task[:200], 'output_path': out_path})
        ensure_flusher()
        steps['event'] = {'ok': True}
    except Exception as e:
        steps['event'] = {'ok': False, 'err': str(e)}
    # B5 旁挂记账：手动派工销账一行（异常全吞，不影响返回）
    _job_ledger(job_id, role, 'manual', 'done' if steps.get('event', {}).get('ok') else 'error',
                task=task, result=str(out_path or ''), extra={'steps': {k: v.get('ok') for k, v in steps.items()}})
    # ok=True 仅代表主链第一段（产出落盘）成功；后三段成败分项在 steps 供面板/调用方判读
    return {'ok': True, 'job_id': job_id, 'role': role, 'output_path': out_path,
            'memory': mem, 'steps': steps}


def _route_post_manual(self, path, parsed):
    """手动派工入口：POST /api/town/manual {role, task, output?}——手动驱动主链（P1）。"""
    try:
        if path == '/api/town/manual':
            body = self._read_body() or {}
            self._send_json(_manual_impl(
                str(body.get('role') or ''),
                str(body.get('task') or ''),
                str(body.get('output') or '')))
            return True
    except Exception:
        pass
    return False


# ---------- v2 活的智能体：一键互聊 + 能力圆桌（策划案 v2 §三） ----------

import random as _random
import re as _re_role

# 推理模型英文思维链泄漏特征（content 为空回退 reasoning_content 时出现，2026-11-22）
_RE_COT_LEAK = _re_role.compile(
    r'^(the user|I should|I need to|let me|I\'ll|first,|okay|用户想|我应该|我需要|首先，|好的，我)', _re_role.IGNORECASE)


def _llm_generate(system, user, max_tokens=700):
    """v3 真 LLM 对话引擎：复用 brain.main_brain._call_llm（默认对话线路，含 relay 鉴权头注入）。
    失败/超时返回 None，调用方回退模板兜底层（_ai_line 等），永不阻塞、永不空转。
    base 路径按 domain_town.py 所在 server 目录推导。"""
    try:
        import sys as _sys
        _srv = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
        if _srv not in _sys.path:
            _sys.path.insert(0, _srv)
        from brain import main_brain as _mb
        _call = getattr(_mb, '_call_llm', None)
        if not _call:
            return None
        msgs = [{'role': 'system', 'content': system},
                {'role': 'user', 'content': user}]
        # 第4轮（2026-11-23）：base 传项目根【绝对路径】——_load_model_cfg 用 base 拼
        # models.json/api_keys.json 路径，天然支持绝对值。原实现 cwd 不对时 os.chdir
        # 兜底再切回：chdir 是进程全局态，多线程下互相踩（一个线程 chdir 的瞬间其他
        # 线程的相对路径 I/O 全指错地方），且与启动 cwd 纠缠不清。绝对路径一次根除。
        _root = _os.path.dirname(_srv)
        return _call(_root, msgs, max_tokens=max_tokens, temperature=0.7)
    except Exception:
        return None


def _crew_chat_bus(who, txt):
    """把一句对话直写聊天流总线（user.bus.jsonl）——聊天室读端 _read_chat 只聚合
    _crew/*.bus.jsonl，emit 只进事件流。互聊/圆桌等村民对话必须走这里才在聊天室可见。"""
    try:
        crew_dir = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
                                 'data', '_crew')
        _os.makedirs(crew_dir, exist_ok=True)
        import time as _tt
        with open(_os.path.join(crew_dir, 'user.bus.jsonl'), 'a', encoding='utf-8') as f:
            f.write(json.dumps({'ts': int(_tt.time()), 'from': who,
                                'type': 'chat', 'text': txt}, ensure_ascii=False) + '\n')
    except Exception:
        pass


def _pick_all_villagers(exclude=()):
    """全村名册（排序稳定，不洗牌）：圆桌全员模式用。"""
    pool = set()
    try:
        from engines.common.town_state import _STATE_DIR as _SD
        for fn in _os.listdir(_SD):
            if fn.endswith('.md'):
                pool.add(fn[:-3])
    except Exception:
        pass
    try:
        for fn in _os.listdir(_MEM_DIR):
            if fn.endswith('.md'):
                pool.add(fn[:-3])
    except Exception:
        pass
    pool -= set(exclude)
    return sorted(pool)


def _pick_villagers(n=2, exclude=()):
    """从已有状态卡/记忆档案的村民中随机挑 n 名（排除指定名单）。"""
    pool = set()
    try:
        from engines.common.town_state import _STATE_DIR as _SD
        for fn in _os.listdir(_SD):
            if fn.endswith('.md'):
                pool.add(fn[:-3])
    except Exception:
        pass
    try:
        for fn in _os.listdir(_MEM_DIR):
            if fn.endswith('.md'):
                pool.add(fn[:-3])
    except Exception:
        pass
    pool -= set(exclude)
    pool = sorted(pool)
    _random.shuffle(pool)
    return pool[:n]


def _ai_line(role, buddy, context_hint):
    """生成一句村民发言：优先走记忆拼接（本地零依赖），永不调用外部模型、永不空转。
    说法由灵魂+最近记忆组合而成，保证每个村民说话带自己的经历。"""
    soul = {}
    try:
        from engines.common.town_state import get_soulcard
        soul = get_soulcard(role)
    except Exception:
        pass
    mems = read_memory(role, max_chars=600)
    last = ''
    for m in mems:
        # 2026-11-20 防套娃：互聊记忆（- 【和X聊天】…）整行塞进新话会嵌套引用旧对话原文，
        # 只有「派工完成」类工作记忆才允许拼进发言（且截取正文、剥掉列表/标题标记）
        if '【派工完成】' in m:
            last = m.split('【派工完成】', 1)[1].strip(' 　:-')
            break
    openers = ['%s老哥，最近干得怎么样？', '%s，正好碰到你，说个事。', '嗨 %s，忙不忙？']
    tpl = _random.choice(openers) % buddy
    if last:
        return tpl + '我最近刚%s，你那边有什么心得？' % last.replace('- 【', '').replace('】', '：', 1)[:60]
    if soul.get('creed'):
        return tpl + '我一直信一条：%s' % soul['creed']
    return tpl + '咱们小镇最近挺热闹，你也加油干。'


def _social_impl(a, b, rounds=3):
    """互聊核心：a/b 轮流发言 rounds 轮，每句 emit 进聊天室/事件流 + 写入双方记忆。"""
    import re as _re
    for r in (a, b):
        if not _re.match(r'^[\w\u4e00-\u9fff\-]{1,40}$', r or ''):
            return {'ok': False, 'err': 'role 非法：%s' % r}
    rounds = max(1, min(int(rounds or 3), 5))
    if not a or not b or a == b:
        return {'ok': False, 'err': '需要两名不同村民'}
    try:
        from engines.common.town_events import emit, ensure_flusher
    except Exception:
        return {'ok': False, 'err': '事件总线不可用'}
    dialogue = []
    # v3 真 LLM 引擎：一次调用生成整段对话（含村民灵魂+记忆人设）；失败回退模板兜底
    used_llm = False
    try:
        def _persona(r):
            soul = {}
            try:
                from engines.common.town_state import get_soulcard as _gs
                soul = _gs(r) or {}
            except Exception:
                pass
            mems = read_memory(r, max_chars=300)
            return {'name': r, '灵魂': soul.get('creed') or soul.get('mission') or '',
                    '最近经历': mems[0][:120] if mems else ''}
        sys_p = ('你是小镇村民对话编剧。根据两人的人设（灵魂信条+最近经历）写 %d 轮交替对话，'
                 '每句一行，格式严格为「名字: 内容」，不要旁白，不要 markdown，每句不超过80字。'
                 '内容里禁止出现【】方括号标记和列表符号，直接说大白话。') % rounds
        usr_p = '人设A：%s\n人设B：%s\n请写他们的对话。' % (
            _persona(a), _persona(b))
        txt = _llm_generate(sys_p, usr_p, max_tokens=1500)
        if txt:
            for ln in str(txt).strip().splitlines():
                ln = ln.strip().lstrip('-•0123456789. ')
                if not ln or ':' not in ln and '：' not in ln:
                    continue
                who, _, body = ln.replace('：', ':', 1).partition(':')
                who, body = who.strip()[:40], body.strip()[:120]
                # 2026-11-20 净化：LLM 有时会模仿记忆里的「【和X聊天】」格式，剥掉所有【…】标记前缀
                import re as _re2
                body = _re2.sub(r'^[（(]?【[^】]*】[：:]?\s*', '', body).strip()[:120]
                if who not in (a, b) or not body:
                    continue
                dialogue.append({'from': who, 'text': body, 'llm': True})
                emit(who, 'chat', {'role': who, 'text': body})
                # 2026-11-22 补聊天流：互聊此前只进事件流，聊天室看不见，误以为村民不说话
                _crew_chat_bus(who, body)
                write_memory(who, '【和%s聊天】%s' % ((b if who == a else a), body))
            if dialogue:
                used_llm = True
    except Exception:
        dialogue = []
    if not used_llm:
        for i in range(rounds):
            for who, buddy in ((a, b), (b, a)):
                line = _ai_line(who, buddy, context_hint='round%d' % i)[:120]
                dialogue.append({'from': who, 'text': line})
                emit(who, 'chat', {'role': who, 'text': line})
                _crew_chat_bus(who, line)
                write_memory(who, '【和%s聊天】%s' % (buddy, line))
    try:
        ensure_flusher()
    except Exception:
        pass
    return {'ok': True, 'rounds': rounds, 'dialogue': dialogue, 'engine': 'llm' if used_llm else 'template'}


def _roundtable_impl(topic='', host='', members=None):
    """能力圆桌：主持+成员各发言一次给方案，结论落盘 outputs 并广播。
    members='all' → 全员圆桌（村名册全体参加，上限12人防提示词爆炸）。"""
    import re as _re
    topic = (topic or '').strip()[:120] or '如何让朱峰智能体无限变得更好更优'
    if str(members or '').strip().lower() == 'all':
        roster = _pick_all_villagers(exclude=(host,))
        others = roster[:12]
    else:
        others = _pick_villagers(2, exclude=(host,))
    if len(others) < 1:
        return {'ok': False, 'err': '村里还没有村民，先派一单工'}
    panel = ([host] if host else []) + others
    for r in panel:
        if not _re.match(r'^[\w\u4e00-\u9fff\-]{1,40}$', r or ''):
            return {'ok': False, 'err': 'role 非法：%s' % r}
    # 2026-11-22：圆桌发言写聊天流用
    crew_dir_rt = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
                                'data', '_crew')

    def _bus_chat(cdir, who, txt):
        try:
            import time as _tt
            with open(_os.path.join(cdir, 'user.bus.jsonl'), 'a', encoding='utf-8') as f:
                f.write(json.dumps({'ts': int(_tt.time()), 'from': who,
                                    'type': 'chat', 'text': txt}, ensure_ascii=False) + '\n')
        except Exception:
            pass
    try:
        from engines.common.town_events import emit, ensure_flusher
    except Exception:
        return {'ok': False, 'err': '事件总线不可用'}
    host_r = panel[0]
    speeches = []
    # v3 真 LLM 引擎：一次调用生成全员圆桌发言；失败回退模板兜底
    used_llm = False
    try:
        def _persona(r):
            soul = {}
            try:
                from engines.common.town_state import get_soulcard as _gs
                soul = _gs(r) or {}
            except Exception:
                pass
            mems = read_memory(r, max_chars=300)
            return {'name': r, '使命': soul.get('mission') or '', '信条': soul.get('creed') or '',
                    '最近经历': mems[0][:120] if mems else ''}
        sys_p = ('你是小镇圆桌会议编剧。成员按顺序各发言一次（每人一段），讨论议题并给出具体建议，'
                 '格式严格为「名字: 内容」，不要旁白不要 markdown，每段不超过120字。最后不要写总结。')
        usr_p = '议题：%s\n参会人设：%s' % (topic, [_persona(r) for r in panel])
        # 推理模型预算下限 1200（实测更低预算会被思维链挤掉正文致整场退化模板，2026-11-22）
        txt = _llm_generate(sys_p, usr_p, max_tokens=min(2400, max(1200, 400 * max(1, len(panel)))))
        if txt:
            for ln in str(txt).strip().splitlines():
                ln = ln.strip().lstrip('-•0123456789. ')
                if not ln or (':' not in ln and '：' not in ln):
                    continue
                who, _, body = ln.replace('：', ':', 1).partition(':')
                who, body = who.strip()[:40], body.strip()[:160]
                if who not in panel or not body:
                    continue
                speeches.append({'from': who, 'text': body, 'llm': True})
                emit(who, 'roundtable', {'role': who, 'topic': topic, 'text': body})
                # 2026-11-22：圆桌发言补写聊天流，聊天室直接可见（此前只进事件流）
                _bus_chat(crew_dir_rt, who, '【圆桌·%s】%s' % (topic[:20], body))
                write_memory(who, '- 【圆桌发言】%s' % body)
            if speeches:
                used_llm = True
    except Exception:
        speeches = []
    if not used_llm:
        for r in panel:
            soul = {}
            try:
                from engines.common.town_state import get_soulcard
                soul = get_soulcard(r)
            except Exception:
                pass
            mems = read_memory(r, max_chars=400)
            base = '关于「%s」' % topic
            if mems:
                sp = base + '，我干过%s，我的建议是照着成功经验再来一次并改进一步。' % mems[0][:40]
            elif soul.get('mission'):
                sp = base + '，我的使命是：%s 所以建议先小步试、再推广。' % soul['mission'][:40]
            else:
                sp = base + '，建议先列清单再分头干。'
            sp = sp[:160]
            speeches.append({'from': r, 'text': sp})
            emit(r, 'roundtable', {'role': r, 'topic': topic, 'text': sp})
            _bus_chat(crew_dir_rt, r, '【圆桌·%s】%s' % (topic[:20], sp))
            write_memory(r, '- 【圆桌发言】%s' % sp)
    conclusion = ('圆桌结论（议题：%s）：%s 主持，%s 参与达成共识——%s' %
                  (topic, host_r, '、'.join(panel[1:]),
                   speeches[-1]['text'][:80]))[:300]
    # 结论落盘 outputs（成果展廊可见）
    job_id = 'job-roundtable-%d' % int(_random.random() * 1e12)
    try:
        d = _os.path.join(_MEM_DIR, 'outputs')
        _os.makedirs(d, exist_ok=True)
        with open(_os.path.join(d, job_id + '.md'), 'w', encoding='utf-8') as f:
            safe = conclusion.replace('\r', ' ').replace('\n', ' ').replace('#', '\\#')
            f.write('# 圆桌结论\n\n- 议题：%s\n\n%s\n' % (topic.replace('#', '\\#'), safe))
    except Exception:
        pass
    emit(host_r, 'roundtable_conclusion', {'topic': topic, 'text': conclusion})
    try:
        ensure_flusher()
    except Exception:
        pass
    return {'ok': True, 'topic': topic, 'panel': panel, 'speeches': speeches,
            'conclusion': conclusion, 'engine': 'llm' if used_llm else 'template'}


# ---------- v4 镇长发言：用户进聊天室和村民对话（LLM 真实回应，失败回退模板） ----------


def _system_memory_brief():
    """系统记忆注入（2026-11-20）：扫描 private/记忆/ 顶层与全局目录的记录名+首行摘要，
    供村民提示词引用（他们能"知道"系统的项目记忆，减少幻想）。只读、限长防炸上下文。"""
    mem_root = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.dirname(
        _os.path.abspath(__file__)))), 'private', '记忆')
    names = []
    for sub in ('全局', ''):
        d = _os.path.join(mem_root, sub) if sub else mem_root
        try:
            if _os.path.isdir(d):
                for fn in sorted(_os.listdir(d))[:30]:
                    if fn.endswith('.md') and not fn.startswith('_'):
                        names.append(fn[:-3])
        except Exception:
            pass
    if not names:
        return ''
    return ('另外，你知道本系统（朱峰智能体无限）的项目记忆有这些条目：%s。'
            '回应时可以自然引用相关记忆方向，但不要虚构细节。'
            % '、'.join(names[:20]))


def _user_speak_impl(text, target=''):
    """镇长发言：立刻落聊天流并秒回（2026-11-22 提速：村民 LLM 回应改后台线程生成，
    不再同步阻塞接口——此前要等 LLM 回完才返回，界面等很久才有反应）。
    target='all' 时全员广播（每位村民都在后台回应）。"""
    text = (text or '').strip()[:300]
    if not text:
        return {'ok': False, 'err': '发言内容为空'}
    try:
        from engines.common.town_events import emit, ensure_flusher
    except Exception:
        return {'ok': False, 'err': '事件总线不可用'}
    import time as _t
    import threading as _th
    from_name = '镇长'
    crew_dir = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
                             'data', '_crew')
    try:
        _os.makedirs(crew_dir, exist_ok=True)
        with open(_os.path.join(crew_dir, 'user.bus.jsonl'), 'a', encoding='utf-8') as f:
            f.write(json.dumps({'ts': int(_t.time()), 'from': from_name,
                                'type': 'chat', 'text': text}, ensure_ascii=False) + '\n')
    except Exception:
        pass
    emit(from_name, 'chat', {'role': from_name, 'text': text})

    # 回应者：target='all' 全员广播；否则指定村民或随机一名
    if target == 'all':
        buddies = _pick_villagers(99) or []
    elif target and _re_role.match(r'^[\w\u4e00-\u9fff\-]{1,40}$', target):
        buddies = [target]
    else:
        pool = _pick_villagers(2, exclude=(from_name,))
        buddies = pool[:1]

    def _gen():
        for buddy in buddies:
            try:
                _reply_one(buddy, text, crew_dir)
            except Exception:
                pass
        try:
            ensure_flusher()
        except Exception:
            pass
    if buddies:
        _th.Thread(target=_gen, daemon=True).start()
    return {'ok': True, 'from': from_name, 'reply_from': '、'.join(buddies),
            'reply': '', 'async': True}


def _reply_one(buddy, text, crew_dir):
    """一名村民回应镇长发言（后台线程）：真 LLM + 信条 + 真实经历，写聊天流+事件流。"""
    import time as _t
    from engines.common.town_events import emit
    soul = {}
    try:
        from engines.common.town_state import get_soulcard
        soul = get_soulcard(buddy) or {}
    except Exception:
        pass
    own_mem = []
    try:
        own_mem = read_memory(buddy, max_chars=600)[:5]
    except Exception:
        pass
    sys_mem = _system_memory_brief()
    sys_p = ('你是小镇村民「%s」。信条：%s。镇长刚才说：%s。'
             '你真实做过的事（记忆，禁止编造）：%s。'
             '%s'
             '用一句不超过60字的中文口语回应，必须结合你的信条和你真实做过的事'
             '（不许编造没做过的工作），直接输出那一句话。'
             % (buddy, soul.get('creed') or '热心村民', text,
                '；'.join(own_mem) or '（暂无）',
                sys_mem))
    # 2026-11-22 glm-5.3-flash 是推理模型：思维链常占 300-800 token，120/600 预算下
    # content 频繁为空（实测 600 预算约 50% 概率），_call_llm 退回英文思维链——
    # 预算提到 1200，配合 _RE_COT_LEAK 把仍漏出的英文 CoT 丢弃走模板兜底。
    txt = _llm_generate(sys_p, '请直接输出回应那一句话。', max_tokens=1200)
    reply = ''
    if txt:
        reply = str(txt).strip().splitlines()[0][:120].strip()
    if not reply or _RE_COT_LEAK.match(reply):
        reply = '收到镇长的话！%s' % (soul.get('creed') or '我马上看看能帮上什么。')
    emit(buddy, 'chat', {'role': buddy, 'text': reply})
    # 写进聊天流（_read_chat 聚合 _crew/*.bus.jsonl，界面才能看到）
    try:
        with open(_os.path.join(crew_dir, 'user.bus.jsonl'), 'a', encoding='utf-8') as f:
            f.write(json.dumps({'ts': int(_t.time()), 'from': buddy,
                                'type': 'chat', 'text': reply}, ensure_ascii=False) + '\n')
    except Exception:
        pass
    write_memory(buddy, '【和镇长聊天】%s' % reply)


def _route_post_speak(self, path, parsed):
    """POST /api/town/speak {text, target?}——镇长发言进聊天室，村民回应。"""
    try:
        if path == '/api/town/speak':
            body = self._read_body() or {}
            self._send_json(_user_speak_impl(
                str(body.get('text') or ''),
                str(body.get('target') or '')))
            return True
    except Exception:
        pass
    return False


def _route_post_social(self, path, parsed):
    """POST /api/town/social {a?,b?,rounds?} 一键互聊；POST /api/town/roundtable {topic?,host?} 能力圆桌。"""
    try:
        body = self._read_body() or {}
        if path == '/api/town/social':
            a = str(body.get('a') or '').strip()
            b = str(body.get('b') or '').strip()
            if not a or not b:
                picks = _pick_villagers(2)
                if len(picks) < 2:
                    self._send_json({'ok': False, 'err': '村里还不足两名村民，请先派一单工'})
                    return True
                a = a or picks[0]
                b = b or picks[1]
            self._send_json(_social_impl(a, b, int(body.get('rounds') or 3)))
            return True
        if path == '/api/town/roundtable':
            self._send_json(_roundtable_impl(
                str(body.get('topic') or ''),
                str(body.get('host') or ''),
                str(body.get('members') or '')))
            return True
    except Exception as e:
        try:
            self._send_json({'ok': False, 'err': str(e)})
            return True
        except Exception:
            pass
    return False


from routes.dispatcher import route_get, route_post  # noqa: E402

# 插件路径适配（T2.4 批量）：副本位于 plugins/route.town/，重指 __file__ 到源路径，
# 使全部 dirname 链（server/routes → server → 项目根）与源文件语义一致，逻辑零改动
import os as _pf_os  # noqa: E402  适配器自持导入（插件副本路径重指）
__file__ = _pf_os.path.join(_pf_os.path.dirname(_pf_os.path.abspath(__file__)),
                            '..', '..', 'server', 'routes', 'domain_town.py')

route_get('/api/town/events')(_route_get)
route_get('/api/town/memories')(_route_get)
route_get('/api/town/chat')(_route_get_chat)
route_get('/api/town/outputs')(_route_get)
route_get('/api/town/state')(_route_get_state)
route_get('/api/town/jobs-active')(_route_get)  # P0 空闲重启调度器探测在途工单用
route_post('/api/town/memory-write')(_route_post)
route_post('/api/town/memory-void')(_route_post)
route_post('/api/town/manual')(_route_post_manual)
route_post('/api/town/social')(_route_post_social)
route_post('/api/town/roundtable')(_route_post_social)
route_post('/api/town/speak')(_route_post_speak)


# ==================== v6 真实派单（Grok式拉人干活，2026-11-20） ====================
# 一句话派单：POST /api/town/assign {role?, task}
# 村民走与主对话同一生产引擎（loop_s.run_loop_s + codex_style 全量工具直通），
# 真实调用工具干活，工具调用实时写聊天流（前端 toolcard 直接显示），产出落盘可复核。
_assign_sema = threading.Semaphore(2)   # 全村并发上限2（资源保护，非能力限制）
_assign_locks_guard = threading.Lock()
_assign_locks = {}                      # role -> Lock：同一村民同时只接一单

_CREW_BUS = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
                          'data', '_crew', 'town-v6.bus.jsonl')

def _crew_emit(from_who, kind, text, ts=None):
    """v6 聊天流直写：追加到 _crew bus（_read_chat 聚合读端直接可见，QQ气泡+工具卡渲染）。"""
    try:
        _os.makedirs(_os.path.dirname(_CREW_BUS), exist_ok=True)
        import time as _t
        with open(_CREW_BUS, 'a', encoding='utf-8') as f:
            f.write(json.dumps({'ts': ts or _t.time(), 'from': from_who,
                                'type': kind, 'text': str(text)[:300]},
                               ensure_ascii=False) + '\n')
    except Exception:
        pass

def _assign_lock_for(role):
    with _assign_locks_guard:
        if role not in _assign_locks:
            _assign_locks[role] = threading.Lock()
        return _assign_locks[role]


def _town_model_call(messages, ctx):
    """v6 村民引擎的模型调用：复用 main_brain._call_llm 线路（默认对话线路+relay鉴权头）。
    loop_s 的 default_model_call 需要 ctx._target_url/_headers，这里直接桥接：
    main_brain._call_llm 返回 message dict 或 None——None 时抛错交给 loop_s 的退避重试。"""
    try:
        import sys as _sys
        _srv = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
        if _srv not in _sys.path:
            _sys.path.insert(0, _srv)
        from brain import main_brain as _mb
        _call = getattr(_mb, '_call_llm', None)
        if not _call:
            raise RuntimeError('main_brain._call_llm 不可用')
        # 第4轮（2026-11-23）：base 传项目根【绝对路径】根除 os.chdir 兜底——
        # chdir 是进程全局态，两个村民线程同时干活互相踩 cwd，且与其他线程相对 I/O 竞态
        _root = _os.path.dirname(_srv)
        # 第6轮冷启动容错（E2E 实锤：无感重启后 ~30s 内线路未热，smoke-final 在 T+11s
        # 派单即"模型线路不可用"；且 loop_s 对 RuntimeError 不重试直接上抛）。None=线路
        # 暂不可用（区别于参数错误），本层退避 3 次×4s 再放弃，总容忍 ~12s。
        for _attempt in range(3):
            msg = _call(_root, messages, max_tokens=2000, temperature=0.4, tools=ctx.get('tools'))
            if msg:
                break
            if _attempt < 2:
                _time.sleep(4)
        if not msg:
            raise RuntimeError('模型线路不可用（models.json/api_keys 未配置或线路 401，已冷启动重试3次）')
        return {'choices': [{'message': msg, 'finish_reason': 'stop'}]}
    except Exception:
        raise


def _town_assign_impl(role, task, meta=None):
    """v6 派单核心：后台线程跑真引擎，接口立即返回 job_id（前端轮询聊天流看进度）。
    meta：派单上下文随工单台账落盘（托管传 tid/source，重启复活传 revived_from）。
    （Step1 搬家注：内嵌 _worker 已提为模块级 _town_assign_worker。）"""

    role = (role or '').strip()
    task = (task or '').strip()[:500]
    if not task:
        return {'ok': False, 'err': 'task 必填'}
    if role and not _re_role.match(r'^[\w\u4e00-\u9fff\-]{1,40}$', role):
        return {'ok': False, 'err': 'role 非法'}
    from datetime import datetime as _dt
    try:
        from engines.common.town_events import emit, ensure_flusher
    except Exception:
        return {'ok': False, 'err': '事件总线不可用'}
    if not role:
        pool = _pick_villagers(1)
        role = pool[0] if pool else ''
    if not role:
        return {'ok': False, 'err': '村里还没有村民，请先落户'}
    lk = _assign_lock_for(role)
    if not lk.acquire(blocking=False):
        return {'ok': False, 'err': '村民「%s」手头正有一单没干完，等TA收工再派' % role}
    job_id = 'job-%d' % int(_dt.now().timestamp() * 1000)
    job_ts = _dt.now().timestamp()  # 交付物硬校验基准时刻
    _job_state(job_id, 'claimed', role=role, task=task, meta=meta)  # P0：派单即落盘
    emit(role, 'dispatch', {'job_id': job_id, 'role': role, 'task': task[:200]})
    ensure_flusher()
    # 2026-11-22 修复：上面两行启动线程+return 曾被误挪进 _town_assign_worker 尾部
    # （导致 impl 提前结束返回 None、worker 干完活再克隆自己无限套娃），现归位到本函数。
    threading.Thread(target=_town_assign_worker,
                     args=(role, task, job_id, job_ts, lk), daemon=True,
                     name='town-assign-%s' % role).start()
    _revive_scan_once()  # P0 重启复活：派单成功后兜底触发（放成功路径=用户新单优先占村民，复活单避让忙村民）
    return {'ok': True, 'job_id': job_id, 'role': role,
            'note': '已派单，村民正在用真工具干活，聊天室可见实时工具调用'}



def _town_assign_worker(role, task, job_id, job_ts, lk):
    """Step1 结构搬家（2026-11-22 R2收口）：原 _town_assign_impl 内嵌闭包 _worker 提为模块级。
    纯搬家零行为变更：闭包捕获的 role/task/job_id/job_ts/lk 改为入参，其余引用均为模块级名。
    【NameError 修复 2026-11-22】emit 在本 worker 用了 3 处（claimed/review/done 事件），
    原先只在调用方 _town_assign 里局部导入——搬成模块级函数后导入没跟着走，首次派单即
    NameError 整个接单线程崩掉。与本文件其他后台线程函数（_town_respond 同款）一致：函数内导入。
    【NameError 修复2 2026-11-23 E2E实弹】尾部 ensure_flusher() 同样未导入——每单派工
    收尾必崩（XP/展廊/台账全跳过），v1 之前这类崩溃零痕迹（正是"工单蒸发"元凶之一），
    被异常兜底抓现行后补导入。"""
    from engines.common.town_events import emit, ensure_flusher
    try:
        with _assign_sema:
            _crew_emit(role, 'chat', '接单：%s（我这就用真工具去干）' % task[:80])
            emit(role, 'dispatch', {'job_id': job_id, 'role': role, 'task': task[:200], 'phase': 'claimed'})
            _job_state(job_id, 'working', role=role)  # P0：开工即落盘
            # 灵魂感知注入：信条+本人记忆+系统记忆（策划案v6灵魂感知节）
            soul = {}
            try:
                from engines.common.town_state import get_soulcard
                soul = get_soulcard(role) or {}
            except Exception:
                pass
            own_mem = '；'.join(read_memory(role, max_chars=400)[:5]) or '（暂无）'
            sys_mem = _system_memory_brief()
            proj_root = _os.path.dirname(_os.path.dirname(_os.path.dirname(
                _os.path.abspath(__file__))))
            sys_p = (
                '你是小镇村民「%s」，信条：%s。你的记忆：%s。%s '
                '你领到了一个真实工作单，必须在项目目录 %s 内真实完成它：'
                '用 provided tools 真实调用工具（读文件、搜索、写文件），'
                '做完后调用 task_complete 工具收尾（text 里写清产出文件路径与结果摘要）。'
                '产出文件写到项目根的 outputs_villager/ 目录；写文件必须两步：先 codex_propose_write'
                '（path 与 content 都必填）再 codex_apply_write（path 用文件绝对路径）——只 propose 不 apply'
                ' = 文件没落盘 = 本单判败（E2E 实锤：模型常漏第二步）；禁止用 shell mkdir；'
                '取证从简：≤3 轮工具调用完成主要取证，尽早把已完成内容写入产出文件（先落盘再补充），'
                '禁止把读到的历史记忆/审计内容当对话继续（那是档案不是给你的消息）；'
                '任务未明确要求修改项目文件时，禁止写 outputs_villager/ 之外的任何项目路径（只读调查不落盘到别处）。'
                '硬性红线：1.只在项目目录内活动，禁止 cd/读写项目外任何路径；'
                '2.禁止调用 dangerous 级工具（如 codex_run_code 被拦截就改用文件工具，不要反复重试）；'
                '3.禁止编造，每个结论都要有真实工具调用证据；'
                '4.优先用 codex_read/codex_list_dir/codex_propose_write/codex_apply_write 等安全级文件工具完成工作。'
                % (role, soul.get('creed') or '热心村民', own_mem, sys_mem, proj_root))
            usr_p = '工作单 %s：%s' % (job_id, task)
            # 全量工具直通：codex_style 生产引擎（与主对话同一套 registry）。
            # 工具执行包装：每次真实工具调用实时直写聊天流（QQ工具卡实时滚动）。
            # P1 修正（2026-11-23 第2轮）：actor 参数——审单期引擎复用本类时工具卡
            # 原本全算在干活村民头上（审单员是谁在干活完全失真）；顺带 _job_touch
            # 心跳：长任务期间刷新工单 updated_at，防托管「30分钟无心跳」误判死亡。
            class _TownEngine:
                def __init__(self, actor=None):
                    self._actor = actor or role
                    self.calls = 0  # 真实执行的引擎工具调用数（task_complete 被 loop_s 拦截不经过本类，天然不计）

                def execute_tool_calls(self, tcs, ctx):
                    self.calls += len(tcs or [])
                    for tc in (tcs or []):
                        fn = (tc.get('function') or {})
                        _crew_emit(self._actor, 'toolcall',
                                   '%s(%s)' % (fn.get('name'), str(fn.get('arguments'))[:120]))
                    _job_touch(job_id)
                    try:
                        return _eng.execute_tool_calls(tcs, ctx) or []
                    except Exception as e:
                        return [{'tool_call_id': (tcs[0].get('id') if tcs else ''),
                                 'content': '工具执行异常: %s' % e}]
            try:
                import loop_s as _ls
                from engines.codex_style import engine as _eng
                run = _ls.run_loop_s(_TownEngine(), [
                    {'role': 'system', 'content': sys_p},
                    {'role': 'user', 'content': usr_p}],
                    {'tools': _eng.get_tool_schemas(), 'model': ''},
                    model_call=_town_model_call)
            except Exception as _e:
                run = {'state': 'error', 'result': '引擎接线失败: %s' % _e}
            state = run.get('state') or 'error'
            result = str(run.get('result') or '')[:600]
            # 产出销账：记忆+XP+事件（与 manual 同口径）
            ok_flag = state == 'done'
            # ===== 交付物双闸：存在性（v6.1）+ 内容成稿闸（P1，2026-11-23 第2轮）=====
            # 村民空手报 done ≠ 干完；先建骨架占坑再「取证中」也不是交付——
            # 实测 job-1795378354282 半截草稿骗过存在闸，进入审单后被重启杀死全单蒸发。
            if ok_flag and 'outputs_villager' in task:
                _gate = _deliverable_gate(_os.path.join(proj_root, 'outputs_villager'), job_ts)
                if _gate:
                    ok_flag = False
                    state = 'no_deliverable'
                    result = '交付物硬校验失败：%s | %s' % (_gate, result)
                    _crew_emit(role, 'system', '交付物硬闸：%s' % _gate)
            # ===== v6 第二批：审单验收循环硬闸（B审单）=====
            # A村民干完≠验收通过：另选一位村民用真工具复核产出，通过才进展廊。
            review_state = ''   # 空=未触发审单（A自己都没干成）
            review_txt = ''
            if ok_flag:
                _job_state(job_id, 'reviewing')  # P0：进入审单阶段即落盘
                try:
                    reviewers = _pick_villagers(2)  # 拿2个候选人以便排除A本人
                    _rev = next((r for r in reviewers if r != role), '')
                    if _rev:
                        _crew_emit(_rev, 'chat', '审单 %s：复核「%s」的产出（真实工具验证）' % (job_id, role))
                        emit(_rev, 'review', {'job_id': job_id, 'worker': role, 'phase': 'review'})
                        rev_sys = (
                            '你是小镇审单员「%s」。村民「%s」刚完成工作单 %s（任务：%s），'
                            'TA的报告：%s。请用 provided tools 真实核查（读产出文件 outputs_villager/ '
                            '验证内容是否真实存在且与任务相符，禁止凭空判断）。'
                            '完成后调用 task_complete：text 的第一个词必须是 REVIEW_PASS 或 REVIEW_FAIL'
                            '（禁止先写分析文章，判定词之后再写一句理由）。产出文件写到项目根的 outputs_villager/review/ 目录；'
                            '禁止写该项目其他任何路径，禁止调用 dangerous 级工具。'
                            % (_rev, role, job_id, task[:150], result[:200]))
                        review_full = ''
                        _rev_engine = _TownEngine(actor=_rev)  # .calls 供防橡皮图章核验
                        try:
                            import loop_s as _ls2
                            from engines.codex_style import engine as _eng2
                            rev_run = _ls2.run_loop_s(_rev_engine, [
                                {'role': 'system', 'content': rev_sys},
                                {'role': 'user', 'content': '审单 %s' % job_id}],
                                {'tools': _eng2.get_tool_schemas(), 'model': ''},
                                model_call=_town_model_call)
                            review_state = rev_run.get('state') or 'error'
                            # 全量文本留作标记检索源；review_txt 只做展示截断
                            # （实测 2026-11-22：复核员把 REVIEW_PASS 写在结论末尾，
                            #   300 字截断把标记切掉 → 复核全对却判「审单未过」）
                            review_full = str(rev_run.get('result') or '')
                            review_txt = review_full[:300]
                            if not review_txt.strip():
                                # 兜底：result 为空时从 done 事件回捞 task_complete 正文（防审单员写了结论却因参数名差异被判未过）
                                for _ev in reversed(rev_run.get('events') or []):
                                    _d = _ev.get('data') or {}
                                    _t = str(_d.get('result') or '').strip()
                                    if _ev.get('kind') == 'done' and _t:
                                        review_full = _t
                                        review_txt = _t[:300]
                                        break
                        except Exception as _re:
                            review_state = 'error'
                            review_txt = '审单引擎异常: %s' % _re
                        # 格式化再问（第5轮 E2E 实弹）：推理模型高频不按格式输出标记
                        # （写分析文章忘写 REVIEW_PASS/REVIEW_FAIL）——结论无标记时
                        # 小预算再问一次，只允许输出两标记之一；再问也失手则按未过处理
                        if review_state == 'done' \
                                and 'REVIEW_PASS' not in review_full \
                                and 'REVIEW_FAIL' not in review_full:
                            try:
                                _fmt = _town_model_call(
                                    [{'role': 'system',
                                      'content': '你是审单判定格式化器。根据审单员结论的倾向，只输出一行：REVIEW_PASS 或 REVIEW_FAIL。禁止输出其他任何内容。'},
                                     {'role': 'user',
                                      'content': '审单员结论原文：\n%s\n\n输出一行判定。' % review_full[:1500]}], {})
                                _md = ((_fmt or {}).get('choices') or [{}])[0].get('message', {}) or {}
                                # 推理模型 content 可能被思维链吃空，回退 reasoning_content
                                _ftxt = str(_md.get('content') or _md.get('reasoning_content') or '').strip()
                                if _ftxt:
                                    review_full = review_full + '\n[格式化判定] ' + _ftxt[:80]
                                    _crew_emit(_rev, 'system', '审单判定格式化: %s' % _ftxt[:40])
                            except Exception:
                                pass
                        _calls = getattr(_rev_engine, 'calls', 0)
                        _rev_pass = _review_pass_evidence(review_state, review_full, _calls)
                        if (not _rev_pass and review_state == 'done'
                                and 'REVIEW_PASS' in review_full and int(_calls or 0) < 1):
                            # 防橡皮图章（2026-11-23 第3轮）：REVIEW_PASS 但零真实工具核查
                            # （第7轮补充 calls 条件：双标记判 FAIL 的不算 no-evidence，证据是有的）
                            review_state = 'no-evidence'
                            review_txt = '审单员未做任何真实工具核查，REVIEW_PASS 不采信'
                        _crew_emit(_rev, 'chat' if _rev_pass else 'system',
                                   ('审单通过：%s' % review_txt[:120]) if _rev_pass
                                   else ('审单未过（%s）：%s' % (review_state, review_txt[:120])))
                        try:
                            write_memory(_rev, '【审单%s】%s 的活：%s' % (
                                job_id, role, '通过' if _rev_pass else '未过(%s): %s' % (review_state, review_txt[:80])))
                        except Exception:
                            pass
                        ok_flag = ok_flag and _rev_pass
                    else:
                        review_state = 'no-reviewer'
                        review_txt = '村里没有第二位村民可审单，镇长人工验收兜底'
                except Exception as _rx:
                    review_state = 'error'
                    review_txt = '审单流程异常: %s' % _rx
            _crew_emit(role, 'done' if ok_flag else 'system',
                       ('验收通过，干完了！%s' % result) if ok_flag else ('验收未过（%s%s）：%s' % (state, ('/' + review_state) if review_state else '', result)))
            try:
                write_memory(role, '【派单%s】%s → %s' % (
                    job_id, task[:60], '完成：%s' % result[:120] if ok_flag else '失败(%s): %s' % (state, result[:80])))
            except Exception:
                pass
            # v6 收尾同步：把 outputs_villager 产出复制进展廊目录（展廊读 _MEM_DIR/outputs）
            # 审单硬闸配套：只有 ok_flag（干成且审单通过）的产出才进展廊，未过验收不上墙
            _sync_err = ''
            if ok_flag:
              try:
                import shutil as _sh
                _src = _os.path.join(proj_root, 'outputs_villager')
                _dst = _os.path.join(proj_root, 'private', '记忆', '小镇', 'outputs')
                if _os.path.isdir(_src):
                    _os.makedirs(_dst, exist_ok=True)
                    for _fn in _os.listdir(_src):
                        _sf = _os.path.join(_src, _fn)
                        if _os.path.isfile(_sf):
                            _sh.copy2(_sf, _os.path.join(_dst, _fn))
              except Exception as _se:
                _sync_err = str(_se)  # 不再静默吞异常：同步失败要写进记忆便于排查
            try:
                if _sync_err:
                    write_memory(role, '【派单%s】产出同步展廊失败：%s' % (job_id, _sync_err[:150]))
            except Exception:
                pass
            try:
                from engines.common.town_state import bump_xp
                bump_xp(role, 2 if ok_flag else 0, note='assign %s' % job_id)
            except Exception:
                pass
            emit(role, 'done' if ok_flag else 'system',
                 {'role': role, 'job_id': job_id, 'state': state,
                  'text': ('干完了！%s' % result) if ok_flag else ('这单没干成（%s）：%s' % (state, result))})
            ensure_flusher()
            # B5 旁挂记账（assign 来源补埋点，收口第1轮验证师挂账项）：异常全吞，不影响主流程
            _job_ledger(job_id, role, 'assign', 'done' if ok_flag else (state or 'error'),
                        review_state=review_state, task=task, result=str(result or ''),
                        extra={'source': 'assign'})
            # P0：终态落盘（放最后一步，之前的步骤异常由下方 except 兜底标记 failed）
            _job_state(job_id, 'done' if ok_flag else 'failed',
                       review_state=review_state or '', result=str(result or ''))
    except Exception as _we:
        # P0：worker 未预期异常留终态痕迹；已判定过的结果（交付物判败原因等）拼接保留不覆盖
        # （E2E 实弹教训：ensure_flusher 崩溃曾把「交付物硬校验失败」覆盖成裸 worker异常）
        _prev = ''
        try:
            _prev = str(next((j for j in _town_jobs_snapshot()
                              if j.get('job_id') == job_id), {}).get('result') or '')
        except Exception:
            pass
        _msg = 'worker异常: %s' % _we
        _job_state(job_id, 'failed',
                   result=(_prev + ' | ' + _msg) if _prev and _prev != _msg else _msg)
        raise
    finally:
        lk.release()


def _route_post_assign(self, path, parsed):
    """POST /api/town/assign {role?, task}——v6 一句话派村民干活（Grok式拉人）。"""
    try:
        if path == '/api/town/assign':
            body = self._read_body() or {}
            self._send_json(_town_assign_impl(
                str(body.get('role') or ''),
                str(body.get('task') or '')))
            return True
    except Exception:
        pass
    return False


route_post('/api/town/assign')(_route_post_assign)


# ==================== v7 村民列表（角色库直读）+ 拉角色进村（2026-11-21） ====================
# GET  /api/town/villager-pool  —— 列出角色库(private/roles_db.json)全部角色，标注是否已在村
# POST /api/town/villager-add   —— {id, name?} 把角色库角色拉进村：建状态卡+灵魂卡(信条取角色prompt首段)+落户聊天

def _route_get_villager_pool(self, path, parsed):
    try:
        if path != '/api/town/villager-pool':
            return False
        import sys as _s2
        _srv = _os.path.dirname(_os.path.abspath(__file__))
        if _srv not in _s2.path:
            _s2.path.insert(0, _srv)
        import roles_db as _rdb
        from engines.common.town_state import _STATE_DIR as _SD
        in_town = set()
        try:
            for fn in _os.listdir(_SD):
                if fn.endswith('.md'):
                    in_town.add(fn[:-3])
        except Exception:
            pass
        roles = _rdb.list_roles() or []
        out = []
        for r in roles:
            rid = str(r.get('id') or '')
            name = str(r.get('name') or '')
            slug = _re_role.sub(r'[^\w\u4e00-\u9fff-]', '', (name or rid))[:40] or ('villager-' + rid[-6:])
            out.append({'id': rid, 'name': name, 'slug': slug,
                        'avatar': str(r.get('avatar') or ''),
                        'in_town': (slug in in_town) or (name in in_town)})
        self._send_json({'ok': True, 'roles': out})
        return True
    except Exception as e:
        try:
            self._send_json({'ok': False, 'err': str(e)})
            return True
        except Exception:
            pass
        return False


def _route_post_villager_add(self, path, parsed):
    try:
        if path != '/api/town/villager-add':
            return False
        body = self._read_body() or {}
        rid = str(body.get('id') or '').strip()
        if not rid:
            self._send_json({'ok': False, 'err': '缺 id（角色库角色id）'})
            return True
        import sys as _s2
        _srv = _os.path.dirname(_os.path.abspath(__file__))
        if _srv not in _s2.path:
            _s2.path.insert(0, _srv)
        import roles_db as _rdb
        role = _rdb.get_role(rid)
        if not role:
            self._send_json({'ok': False, 'err': '角色库中找不到该角色'})
            return True
        name = str(role.get('name') or rid)
        slug = _re_role.sub(r'[^\w\u4e00-\u9fff-]', '', name)[:40] or ('villager-' + rid[-6:])
        # 灵魂卡：信条优先取角色 prompt 首个非空行（角色人设→村民信条），其余随机生成
        from engines.common import town_state as _ts
        creed = ''
        for ln in str(role.get('prompt') or '').splitlines():
            ln = ln.strip()
            if ln:
                creed = ln[:60]
                break
        card = _ts.get_soulcard(slug)  # 确保灵魂卡存在
        if creed:
            try:
                soul_dir = _os.path.join(_ts._STATE_DIR, 'soul')
                fp = _os.path.join(soul_dir, slug + '.md')
                with open(fp, 'r', encoding='utf-8-sig') as f:
                    txt = f.read()
                import re as _re2
                txt2 = _re2.sub(r'信条[：:].*', '信条：%s' % creed, txt, count=1)
                if txt2 != txt:
                    with open(fp, 'w', encoding='utf-8') as f:
                        f.write(txt2)
            except Exception:
                pass
        _ts.bump_xp(slug, 0, note='落户建档（来自角色库：%s）' % name)
        _crew_emit(slug, 'chat', '大家好，我是新村民「%s」，从角色库落户进村啦！（信条：%s）' % (name, creed or card.get('creed') or '热心帮衬'))
        from engines.common.town_events import emit, ensure_flusher
        try:
            emit(slug, 'system', {'role': slug, 'text': '新村民落户：%s' % name})
            ensure_flusher()
        except Exception:
            pass
        self._send_json({'ok': True, 'slug': slug, 'name': name,
                        'creed': creed or card.get('creed') or '',
                        'note': '已落户，去聊天室打招呼吧'})
        return True
    except Exception as e:
        try:
            self._send_json({'ok': False, 'err': str(e)})
            return True
        except Exception:
            pass
        return False


route_get('/api/town/villager-pool')(_route_get_villager_pool)
route_post('/api/town/villager-add')(_route_post_villager_add)

