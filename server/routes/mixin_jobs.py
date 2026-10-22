# -*- coding: utf-8 -*-
"""Mixin Jobs：后台流水线任务化异步壳（可编排后台流水线 P0）。

设计（零改 swarm_pipeline 内核）：
  - POST /api/jobs/submit   起 daemon 线程包 swarm_pipeline.run_pipeline，立即返 job_id
  - GET  /api/jobs          最近任务列表
  - GET  /api/jobs/<id>     单任务状态
  - GET  /api/jobs/<id>/transcript  按 session_id 拼 agent_turns 多角色对话流
  - POST /api/jobs/<id>/resume      手动审核续跑（复用内核 resume_verdict，P1 接线，此处先占位）

状态机：queued -> running -> done(exit0) / await_review(exit3) / failed(其余)
正文只存 agent_turns（内核 persist 写），jobs 表只存摘要，transcript 经 session_id 关联回看。
"""
from routes._shared import *
from routes.mixin_base import MixinBase
import threading

# 并发上限：信号量限同时跑的流水线数，超出则 worker 阻塞排队（status 保持 queued）
_JOBS_SEM = threading.Semaphore(4)
_JOBS_SEQ = [0]
_JOBS_SEQ_LOCK = threading.Lock()


def _gen_job_id():
    with _JOBS_SEQ_LOCK:
        _JOBS_SEQ[0] += 1
        n = _JOBS_SEQ[0]
    return 'job-%d-%02d' % (int(time.time()), n)


def _brief_report(report, exit_code):
    """把内核 report dict 压成有界摘要存 report_json（不塞正文）。"""
    try:
        stages = report.get('stages') if isinstance(report, dict) else None
        names = list(stages.keys()) if isinstance(stages, dict) else []
        out = {
            'exit': exit_code,
            'id': report.get('id') if isinstance(report, dict) else None,
            'stages_done': names,
            'elapsed': round(time.time() - report['t0'], 1) if isinstance(report, dict) and report.get('t0') else None,
        }
        if isinstance(report, dict) and report.get('error'):
            out['error'] = str(report['error'])[:500]
        if exit_code == 3 and isinstance(report, dict) and report.get('verdict'):
            out['verdict_brief'] = str(report['verdict'])[:2000]
        return json.dumps(out, ensure_ascii=False)
    except Exception:
        return json.dumps({'exit': exit_code}, ensure_ascii=False)


def _pipeline_logger(tag):
    def _log(msg):
        try:
            print('[job:%s] %s' % (tag, msg))
        except Exception:
            pass
    return _log


def _run_pipeline_worker(job_id, cfg, cwd):
    """daemon 线程 worker：跑一条流水线并按返回码写终态。"""
    import db as _db
    _db.update_job(job_id, status='running')
    with _JOBS_SEM:
        try:
            import swarm_pipeline
            exit_code, report = swarm_pipeline.run_pipeline(
                cfg, cwd=cwd, log=_pipeline_logger(job_id))
        except Exception as e:
            import traceback
            _db.update_job(job_id, status='failed',
                           error='worker异常: %s\n%s' % (e, traceback.format_exc()[:2000]))
            return
    # 映射终态
    if exit_code == 0:
        status = 'done'
    elif exit_code == 3:
        status = 'await_review'
    else:
        status = 'failed'
    sid = report.get('id') if isinstance(report, dict) else cfg.get('session')
    _db.update_job(job_id, status=status,
                   report_json=_brief_report(report, exit_code),
                   session_id=sid,
                   error=(report.get('error') if isinstance(report, dict) and status == 'failed' else None))


class MixinJobs(MixinBase):

    # ---------- POST /api/jobs/upload ----------（2026-10-22 新增：新建任务附件图片落盘）
    def _handle_jobs_upload(self):
        """接收 {filename, data_b64}（兼容 dataURL），存 public/uploads/jobs/，返回 url。
        供前端粘贴图片卡片上传；静态服务直接按 /uploads/jobs/<file> 访问。"""
        import re as _re
        import base64
        try:
            data = self._read_json() or {}
        except Exception:
            data = {}
        raw = str(data.get('data_b64') or '')
        name = str(data.get('filename') or 'attach.png')
        if raw[:60].find(',') >= 0 and raw[:30].startswith('data:'):
            raw = raw.split(',', 1)[1]
        try:
            blob = base64.b64decode(raw)
        except Exception:
            self._send_json({'ok': False, 'error': 'base64 解码失败'}, code=400)
            return
        if len(blob) > 8 * 1024 * 1024:
            self._send_json({'ok': False, 'error': '附件超过8MB'}, code=413)
            return
        # [R-1 健壮性] 扩展名白名单：防上传 .svg/.html 等可被静态服务直接访问并执行的类型（存储型 XSS）
        _ext = ('.' + name.rsplit('.', 1)[-1].lower()) if '.' in name else ''
        if _ext not in ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'):
            self._send_json({'ok': False, 'error': '仅支持图片格式(png/jpg/gif/webp/bmp)'}, code=400)
            return
        safe = _re.sub(r'[^A-Za-z0-9._-]', '_', name)[:60] or 'attach.png'
        fn = '%d_%s' % (int(time.time() * 1000), safe)
        d = os.path.join(PUBLIC_DIR, 'uploads', 'jobs')
        try:
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, fn), 'wb') as f:
                f.write(blob)
        except Exception as e:
            self._send_json({'ok': False, 'error': '保存失败: %s' % e}, code=500)
            return
        self._send_json({'ok': True, 'url': '/uploads/jobs/' + fn, 'name': name})

    # ---------- POST /api/jobs/submit ----------
    def _handle_jobs_submit(self):
        import db as _db
        try:
            data = self._read_json() or {}
        except Exception:
            data = {}
        if not isinstance(data, dict):
            data = {}
        goal = str(data.get('goal') or '').strip()
        # 【2026-10-22 调整】允许无 goal 提交：只要粘贴了附件卡片（文本/图片）即可，
        # 正文拼进 goal（后端 swarm_pipeline 只消费 goal，附件走 extra_ctx 需 goal 非空）
        if not goal:
            goal = str(data.get('context') or '').strip()[:200] or '(未填写目标，见任务附件)'
        cfg = dict(data)            # 透传 planners/builders/reviewers/summarize/decision_gate 等
        cfg['goal'] = goal
        job_id = _gen_job_id()
        session_id = str(cfg.get('session') or ('pl-' + str(int(time.time()))))
        cfg['session'] = session_id   # 固定 session，便于 submit 后立即知道关联键
        cwd = os.path.abspath(data.get('cwd') or BASE_DIR)
        if not _db.create_job(job_id, goal, session_id, json.dumps(cfg, ensure_ascii=False)):
            self._send_json({'ok': False, 'error': '建任务失败'}, code=500)
            return
        t = threading.Thread(target=_run_pipeline_worker,
                             args=(job_id, cfg, cwd), daemon=True)
        t.start()
        self._send_json({'ok': True, 'job_id': job_id, 'session_id': session_id, 'status': 'queued'})

    # ---------- POST /api/jobs/<id>/resume ----------
    def _handle_jobs_resume(self, job_id):
        """[P1 审核续跑回路] 手动审核续跑：读原任务 cfg，注入用户裁决为内核
        resume_verdict，跳过策划/收口/决策门，直接施工→审核→总结。
        复用同一 job_id/session_id，transcript 续写（前台可回看完整多角色流）。
        内核 resume_verdict 原为死变量（主体从未消费），本次接线才真正生效。"""
        import db as _db
        job = _db.get_job(job_id)
        if not job:
            self._send_json({'ok': False, 'error': '任务不存在: %s' % job_id}, code=404)
            return
        if job.get('status') != 'await_review':
            self._send_json({'ok': False,
                             'error': '仅 await_review 状态可续跑，当前=%s' % job.get('status')},
                            code=409)
            return
        try:
            data = self._read_json() or {}
        except Exception:
            data = {}
        verdict = str(data.get('verdict') or '').strip()
        if not verdict:
            self._send_json({'ok': False, 'error': '缺少 verdict（用户裁决文本）'}, code=400)
            return
        try:
            cfg = json.loads(job.get('cfg_json') or '{}')
        except Exception:
            cfg = {}
        cfg['goal'] = job.get('goal') or cfg.get('goal') or ''
        cfg['session'] = job.get('session_id') or ('pl-' + str(int(time.time())))
        cfg['resume_verdict'] = verdict
        cfg['decision_gate'] = False  # 续跑不再触发决策断点，防二次 return3 死循环
        cwd = os.path.abspath(data.get('cwd') or BASE_DIR)
        _db.update_job(job_id, status='queued')
        t = threading.Thread(target=_run_pipeline_worker,
                             args=(job_id, cfg, cwd), daemon=True)
        t.start()
        self._send_json({'ok': True, 'job_id': job_id, 'session_id': cfg['session'],
                         'status': 'queued', 'resumed': True})

    # ---------- GET /api/jobs[/<id>[/transcript]] ----------
    def _handle_jobs_get(self, path):
        import db as _db
        rest = path[len('/api/jobs'):].strip('/')
        if not rest:
            rows = _db.list_jobs(limit=100)
            self._send_json({'ok': True, 'jobs': rows})
            return
        parts = rest.split('/')
        job_id = parts[0]
        job = _db.get_job(job_id)
        if not job:
            self._send_json({'ok': False, 'error': '任务不存在: %s' % job_id}, code=404)
            return
        if len(parts) >= 2 and parts[1] == 'transcript':
            sid = job.get('session_id') or ''
            turns = _db.get_agent_turns(sid)
            flow = [{'role': t.get('role'), 'content': t.get('content'),
                     'turn_no': t.get('turn_no'), 'created_at': t.get('created_at')}
                    for t in turns]
            self._send_json({'ok': True, 'job_id': job_id, 'session_id': sid,
                             'status': job.get('status'), 'count': len(flow), 'turns': flow})
            return
        # 默认返回单任务状态：解析 cfg_json 为 cfg 字段透出（供前端「失败重跑」复用原配置），
        # 同时移除原始 cfg_json 大字符串，向后兼容（不消费 cfg 的旧前端无影响）。
        raw_cfg = job.pop('cfg_json', None)
        try:
            job['cfg'] = json.loads(raw_cfg or '{}')
        except Exception:
            job['cfg'] = {}
        self._send_json({'ok': True, 'job': job})
