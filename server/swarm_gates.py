# -*- coding: utf-8 -*-
"""蜂群机器闸（Step2 结构搬家，2026-11-22 R2收口）：原 swarm_pipeline._run_machine_gates 抽出。
纯搬家零行为变更：gate 命令执行、按退出码判定、失败回拼 note_stage 上报语义不变。
swarm_pipeline 通过 from swarm_gates import _run_machine_gates 兼容旧名。"""

def _run_machine_gates(cfg, cwd, build_results, note_stage, log):
    g = (cfg or {}).get('machine_gate')
    if not g:
        return True, build_results
    import subprocess as _sp
    cmds = g.get('commands') or []
    ok_all, results = True, []
    for c in cmds:
        name, cmd = str(c.get('name') or 'gate'), str(c.get('cmd') or '')
        if not cmd:
            continue
        allow = bool(c.get('allow_fail'))
        try:
            p = _sp.run(cmd, cwd=cwd, shell=True, capture_output=True, timeout=int(c.get('timeout') or 600))
            rc, out = p.returncode, ((p.stdout or b'') + (p.stderr or b''))[:4000].decode('utf-8', 'ignore')
        except Exception as e:
            rc, out = -1, 'gate 执行异常: %s' % e
        passed = (rc == 0) or allow
        if not passed:
            ok_all = False
        results.append({'name': name, 'cmd': cmd, 'rc': rc, 'passed': passed, 'output': out})
        log('[pipeline] 机器闸[%s] rc=%d %s' % (name, rc, '通过' if passed else '不通过'))
    note_stage('machine_gate', {'ok': ok_all, 'results': [
        {k: v for k, v in r.items() if k != 'output'} for r in results]})
    if not ok_all and g.get('feed_review') is not False:
        digest = '\n\n'.join('▶ 机器闸[%s] 失败(rc=%d)输出：\n%s' % (r['name'], r['rc'], r['output'][:1500])
                             for r in results if not r['passed'])
        build_results = list(build_results) + ['【机器闸失败意见——审核前已实测，必须逐条核验是否已修复】\n%s' % digest]
    return ok_all, build_results


