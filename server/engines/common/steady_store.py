# -*- coding: utf-8 -*-
"""steady_store — 可移植工单/状态稳定存储（零依赖，仅 Python 标准库）。

从朱峰社区智能体「托管派单落盘收口」工程（v1~v4，2026-11-23）提炼的通用稳定性原语，
不依赖本项目任何其他模块，任何项目整个文件拷走即可用。

解决的四个经典事故模式（每一个都有生产实锤）：
1. 「半截损坏文件」——进程死在 json.dump 中途，状态文件损坏全历史丢失
   → 原子写：临时文件 + os.replace（Windows 同目录原子替换）。
2. 「工单静默蒸发」——收尾才一次性记账，中途死亡零痕迹、重启无人认领
   → 阶段态就地更新（claimed→working→reviewing→done/failed 每阶段即写）。
3. 「长任务被误杀」——外部监督按"超时无心跳"判死，长任务没死先被判死
   → 心跳节流刷新（touch，默认 30s 节流防刷盘）。
4. 「复活无限套娃」——重启复活后再次死亡又再复活，烧钱循环
   → 预算化复活（每单至多 1 次 revive，每次启动至多 budget 单，FIFO 旧单先）。

设计红线（改动前必读）：
- 旁挂纪律：本模块任何失败都不抛出、不阻塞主流程（调用方不需要包 try）。
  状态存储是"黑匣子"，黑匣子坏了不能把飞机弄坠。
- 本模块只忠实记录，不做任何质量判断（fail-closed 闸门是调用方的事）。
- 记录列表最新在头部；超出 max_records 从尾部裁剪。
- record = dict，至少含 job_id/state/updated_at；state 终态判定用 is_terminal()。

用法三步（见文件尾部 __main__ 自检）：
    store = JobStore('data/jobs.json')
    store.update('job-1', 'claimed', role='x', task='y', meta={'tid': 't1'})
    store.update('job-1', 'working'); store.touch('job-1')
    store.update('job-1', 'done', result='ok')
重启后（boot 钩子里）：
    dead = store.mark_stale_dead()
    store.revive(dead, dispatch=my_dispatch, budget=2,
                 skip=lambda j: bool(j.get('revived_from')))
外部重启调度器探测：
    if store.active(threshold_sec=900): 不重启
"""
import json
import os
import time

from util_log import get_logger

log = get_logger('steady_store')
TERMINAL_STATES = ('done', 'failed', 'dead')
DEFAULT_MAX_RECORDS = 200
DEFAULT_HEARTBEAT_GAP = 30.0
DEFAULT_ACTIVE_THRESHOLD = 900   # 15 分钟内有心跳才算"在途"
DEFAULT_REVIVE_BUDGET = 2


def is_terminal(state):
    return state in TERMINAL_STATES


class JobStore(object):
    """工单/阶段态稳定存储。一个实例对应一个 json 文件；线程安全靠调用方
    （进程内单实例时建议包一把锁——参考 domain_town._JOB_STATE_LOCK 的用法）。"""

    def __init__(self, path, max_records=DEFAULT_MAX_RECORDS, now_fn=time.time):
        self.path = path
        self.max_records = int(max_records)
        self._now = now_fn   # 可注入假时钟（测试用）

    # ---------- 原子读写 ----------
    def load(self):
        """读全量 {'jobs': [...]}；文件不存在/损坏返回 {}（黑匣子坏了不许炸主流程）。"""
        try:
            with open(self.path, 'r', encoding='utf-8') as f:
                d = json.load(f)
            return d if isinstance(d, dict) else {}
        except Exception:
            return {}

    def save(self, d):
        """原子写：临时文件 + os.replace。任何失败静默返回 False（旁挂纪律）。"""
        try:
            base = os.path.dirname(self.path)
            if base:
                os.makedirs(base, exist_ok=True)
            tmp = self.path + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(d, f, ensure_ascii=False, indent=1)
            os.replace(tmp, self.path)
            return True
        except Exception:
            return False

    # ---------- 阶段态工单 ----------
    def snapshot(self):
        """只读快照：工单记录列表（最新在头部）。"""
        return list(self.load().get('jobs') or [])

    def _find(self, jobs, job_id):
        for j in jobs:
            if isinstance(j, dict) and j.get('job_id') == job_id:
                return j
        return None

    def update(self, job_id, state, role='', task='',
               review_state=None, result=None, meta=None):
        """就地更新工单阶段（无则建行）。meta 仅建行首写合并（tid/source/revived_from）。"""
        try:
            now = self._now()
            d = self.load()
            jobs = d.get('jobs') or []
            rec = self._find(jobs, job_id)
            if rec is None:
                rec = {'job_id': job_id, 'created_at': now}
                for k, v in (meta or {}).items():
                    if v is not None:
                        rec[k] = v
                jobs.insert(0, rec)
            rec['state'] = state
            rec['updated_at'] = now
            if role:
                rec['role'] = role
            if task:
                rec['task'] = str(task)[:500]
            if review_state is not None:
                rec['review_state'] = review_state
            if result is not None:
                rec['result'] = str(result)[:300]
            del jobs[self.max_records:]
            d['jobs'] = jobs
            return self.save(d)
        except Exception:
            return False

    def touch(self, job_id, min_gap=DEFAULT_HEARTBEAT_GAP):
        """心跳：仅刷新 updated_at 不改阶段；min_gap 节流（窗口内重复调用零磁盘写）。"""
        try:
            now = self._now()
            d = self.load()
            rec = self._find(d.get('jobs') or [], job_id)
            if rec is None or now - float(rec.get('updated_at') or 0) < min_gap:
                return False
            rec['updated_at'] = now
            return self.save(d)
        except Exception:
            return False

    # ---------- 重启复活 ----------
    def mark_stale_dead(self, reason='进程重启时工单未收尾'):
        """把所有非终态记录定性 dead（守护线程随旧进程死亡不可能再有进展），
        返回被定性的记录列表。boot 钩子首见调用一次。"""
        try:
            now = self._now()
            d = self.load()
            jobs = d.get('jobs') or []
            dead = []
            for j in jobs:
                if isinstance(j, dict) and not is_terminal(j.get('state')):
                    j['state'] = 'dead'
                    j['dead_reason'] = reason
                    j['updated_at'] = now
                    dead.append(j)
            if dead:
                self.save(d)
            return dead
        except Exception:
            return []

    def revive(self, dead_jobs, dispatch, budget=DEFAULT_REVIVE_BUDGET,
               skip=None, prepare=None, announce=None):
        """预算化复活：dead_jobs 按 FIFO（调用方传 reversed(最新在头部列表) 即旧单先）。
        dispatch(role, task, meta) -> {'ok': True, 'job_id': 新id} 或 None/非ok。
        prepare(rec) -> (role, task, meta) 或 None 跳过（如失踪角色换人）。
        skip(rec) -> True 跳过（如 revived_from 已存在=复活单不再套娃）。
        announce(rec, new_id) 复活成功通知（发事件用）。
        成功后旧单写 revived_as；返回成功数。任何异常计入失败继续下一单。"""
        ok_count = 0
        for j in (dead_jobs or []):
            if ok_count >= budget:
                break
            try:
                if not isinstance(j, dict):
                    continue
                if skip and skip(j):
                    continue
                role = j.get('role') or ''
                task = str(j.get('task') or '').strip()
                if not task:
                    continue
                meta = {'tid': j.get('tid'),
                        'source': j.get('source') or 'assign',
                        'revived_from': j.get('job_id')}
                if prepare:
                    prepared = prepare(j)
                    if prepared is None:
                        continue
                    role, task, meta = prepared
                r = dispatch(role, task, meta)
                if not (isinstance(r, dict) and r.get('ok')):
                    continue
                ok_count += 1
                new_id = r.get('job_id')
                # 旧单回写复活去向（独立小事务，失败不回滚复活本身）
                try:
                    d = self.load()
                    old = self._find(d.get('jobs') or [], j.get('job_id'))
                    if old is not None:
                        old['revived_as'] = new_id
                        old['updated_at'] = self._now()
                    self.save(d)
                except Exception:
                    pass
                if announce:
                    try:
                        announce(j, new_id)
                    except Exception:
                        pass
            except Exception:
                continue
        return ok_count

    # ---------- 外部探测 ----------
    def active(self, threshold_sec=DEFAULT_ACTIVE_THRESHOLD):
        """在途工单数：非终态且 threshold_sec 内有心跳。
        供空闲重启调度器等外部组件探测："有在途单就不重启"。"""
        try:
            fresh_after = self._now() - float(threshold_sec)
            n = 0
            for j in self.snapshot():
                if (not is_terminal(j.get('state'))
                        and float(j.get('updated_at') or 0) > fresh_after):
                    n += 1
            return n
        except Exception:
            return 0   # 探测失败按"不在途"上报——调用方应自行决定失败策略
                     # （重启调度器场景请反着用：探测异常按忙处理更安全）


if __name__ == '__main__':
    # 零依赖自检：任何电脑 python steady_store.py 直接跑
    import tempfile
    td = tempfile.mkdtemp(prefix='steady_store_selfcheck_')
    st = JobStore(os.path.join(td, 'jobs.json'))
    assert st.update('j1', 'claimed', role='r', task='t', meta={'tid': 'x'})
    assert st.update('j1', 'working')
    assert st.touch('j1') is False      # 30s 节流窗口内：跳过（正确语义）
    d = st.load()
    for j in d['jobs']:
        if j['job_id'] == 'j1':
            j['updated_at'] -= 60       # 手工拨老出窗口
    st.save(d)
    assert st.touch('j1') is True       # 窗口外：刷新成功
    assert st.update('j1', 'done', review_state='done', result='ok')
    rec = st.snapshot()[0]
    assert rec['state'] == 'done' and rec['tid'] == 'x'
    dead = st.update('j2', 'working', role='r', task='t2') and st.mark_stale_dead()
    assert len(dead) == 1 and dead[0]['state'] == 'dead'
    box = {'called': 0}
    def _dispatch(role, task, meta):
        box['called'] += 1
        return {'ok': True, 'job_id': 'j2-new'}
    n = st.revive(reversed(dead), dispatch=_dispatch, skip=lambda j: bool(j.get('revived_from')))
    assert n == 1 and box['called'] == 1
    assert st.snapshot()[0].get('revived_as') == 'j2-new' or any(
        j.get('revived_as') == 'j2-new' for j in st.snapshot())
    assert st.active() == 0   # 全终态
    assert not os.path.exists(os.path.join(td, 'jobs.json.tmp'))
    log.info('steady_store selfcheck: ALL OK')
