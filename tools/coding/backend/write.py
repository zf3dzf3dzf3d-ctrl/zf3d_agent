#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""write - Write text files with bounded automatic backups."""

import os

from tools.coding.backend._backup import create_backup
from tools.coding.backend import git_async

TOOL_NAME = 'write'

# 本次请求的对话项目目录（handle 里注入，供 _write_file 白名单校验）
_CTX_PROJECT_DIR = {}


def _auto_checkpoint(results, chat_id=''):
    """写操作成功后自动 git 暂存（旁路，失败静默）。

    【2026-09-10 延迟合并提交】执行期只 git add -A 暂存 + 把改动文件记入
    pending 清单，不再逐次 commit；本轮回答结束（self_check finish 终点
    快照）时一次性提交。一轮对话改 100 个文件也只产出 1 个 git 提交。
    """
    try:
        ok_paths = [r['path'] for r in (results or []) if r.get('path') and 'error' not in r]
        if not ok_paths:
            return
        project_dir = None
        try:
            from config import BASE_DIR
            project_dir = BASE_DIR
        except Exception:
            from tools.coding.backend._changelog import BASE_DIR
            project_dir = BASE_DIR
        if not project_dir or not os.path.isdir(project_dir):
            return
        def _g(cmd):
            return git_async.run(cmd, cwd=project_dir)
        # 【2026-09-20 并发隔离】不再 git add -A（会把其他并发会话的在途文件
        # 也暂存进来）；write 执行期只记 pending 清单，add 留给终点快照按
        # 本对话文件清单选择性执行。chat_id 此处拿不到，pending 先入共享
        # 账，由 finish 侧 legacy 兼容逻辑兜底收取。
        from tools.coding.backend.git_save_step import pending_append
        # 【2026-09-20 并发隔离】补传 chat_id：pending 清单进本对话专属账本
        # 【2026-11-22 账本改造】存仓库相对路径（原存 basename 无法还原路径，
        # 选择性快照 P1-1 Phase B 依赖相对路径 add）；替换模块经 write 复用同一函数，一并生效
        _rels = []
        for _p in ok_paths:
            try:
                _rels.append(os.path.relpath(_p, project_dir).replace(os.sep, '/'))
            except Exception:
                _rels.append(os.path.basename(_p))
        pending_append(project_dir, _rels, chat_id=str(chat_id or ''))
    except Exception:
        pass


def _write_file(path, content, project_dir=''):
    if not path:
        return {'path': path, 'error': 'No path specified'}
    # 【2026-11-19 基址归一化修复】相对路径一律相对项目根解析。
    # 根因：server 进程 cwd=server/，Python 相对路径按 cwd 解析，
    # 导致 write_file 写"相对路径"实际落到 server/ 下（落盘假成功根因）。
    # 归一化必须在所有闸门（pathguard/file_protect/preflight）之前，
    # 保证守卫层与 I/O 层解析到同一文件位置。
    # 【2026-11-23 项目基准修复】"项目根"改为优先取对话关联项目目录
    # （与 read/tree_dir/run 的取基准一致），修"读的是项目文件、写的却落本体
    # 安装目录"的分裂；未关联项目或目录失效时回退软件根目录。
    # 【2026-11-23 并发安全】project_dir 由 handle 按请求显式传参：模块级
    # _CTX_PROJECT_DIR 是跨线程共享 dict，并发对话互相 clear/注入会让相对
    # 路径解析到别人的项目（改动前该竞态只污染白名单中心，无害；基准修复后
    # 会写错目录）。取值一律走本函数参数，dict 仅作外部观察兼容保留。
    if not os.path.isabs(path):
        _base = project_dir or ''
        if not _base or not os.path.isdir(_base):
            try:
                from config import BASE_DIR as _BASE
            except Exception:
                from tools.coding.backend._changelog import BASE_DIR as _BASE
            _base = _BASE
        path = os.path.join(_base, path)
    try:
        from security import is_blocked_system_path
        if is_blocked_system_path(path, for_write=True):      # 写操作：密钥库允许代填，其余私有路径照拦
            return {'path': path, 'error': 'Blocked: system directory is not writable'}
    except Exception:
        pass
    # 【2026-09-09 路径白名单】写入必须落在软件发布版目录或对话关联项目目录内。
    # 事故：模型路径幻觉把半成品写到了 F:\朱峰后续社区…（发布版路径多打两个字），
    # 在 F 盘根误建整棵目录树。白名单从根上杜绝：目录都建不出来，文件更写不进去。
    _warn = ''
    try:
        from tools.coding.backend import _pathguard as _pg
        ok, err = _pg.check(path, project_dir)
        if not ok:
            return {'path': path, 'error': err}
        if err == 'auto':
            # 项目外路径：已自动放行并记录日志，仅提示不弹窗。
            # 【2026-11-23 文案修复】原文案被下一行 _warn = err 无条件覆盖成裸 'auto'，
            # AI 看不懂也无法自纠；现改为可自纠指引并真正到达结果里。
            _warn = ('该路径在当前项目目录之外（写到了安装目录/其他位置），已自动放行并记录。'
                     '若这是当前项目的产出，请改用相对路径（将落在项目内）或项目内绝对路径。')
        elif err:
            _warn = err  # 越界提示等其他文案（不阻断）
    except Exception:
        pass
    # 文件保护闸门：readonly 硬拦 / critical 多重校验
    try:
        from tools.coding.backend import _file_protect as _fprot
        ok, err = _fprot.check_write(path)
        if not ok:
            return {'path': path, 'error': err}
        _prot_snapshot = _fprot.make_snapshot(path) if _fprot.level_of(path) == 'critical' else None
        ok, err = _fprot.precheck(path, content)
        if not ok:
            return {'path': path, 'error': 'file protect rejected: ' + err,
                    'protected': True, 'restored': False}
    except Exception:
        _prot_snapshot = None
    # 【2026-11-22 L0 写入端扩面】卫生四查对所有写入默认生效（与保护清单解耦）：
    # ①乱码/损坏内容 ②空新文件 ③畸形文件名 ④根层白名单外新文件提醒。
    # "写完必须审核"的机械落点——普通新建文件也过检，不再只保护清单内文件。
    try:
        from tools.coding.backend import _file_protect as _fprot_hyg
        _ok2, _err2 = _fprot_hyg.hygiene_check(path, content, is_new=not os.path.isfile(path))
        if not _ok2:
            return {'path': path, 'error': 'hygiene rejected: ' + _err2, 'hygiene': True}
        if _err2:
            _warn = (_warn + ' | ' + _err2) if _warn else _err2
    except Exception:
        pass
    # 预检闸门：语法不过拒写
    try:
        from tools.coding.backend import _preflight
        ok, err = _preflight.check_syntax(path, content)
        if not ok:
            return {'path': path, 'error': 'preflight rejected: ' + err}
    except Exception:
        pass
    try:
        backup_path = create_backup(path) if os.path.isfile(path) else None
        directory = os.path.dirname(path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as file:
            file.write(content)
        # 写后回读比对（仅 critical）：不一致自动回滚
        if _prot_snapshot or _fprot.level_of(path) == 'critical':
            try:
                ok, err = _fprot.verify_after_write(path, content)
                if not ok:
                    rb = _fprot.rollback(path)
                    return {'path': path, 'error': 'file protect rejected: ' + err,
                            'protected': True, 'restored': bool(rb.get('ok')),
                            'restore_detail': rb}
            except Exception:
                pass
        return {
            'path': path,
            'size': len(content.encode('utf-8')),
            'backup': bool(backup_path),
            'backup_path': backup_path,
            **({'path_warning': _warn} if _warn else {}),
            **({'protect_level': 'critical'} if _prot_snapshot else {}),
        }
    except Exception as exc:
        return {'path': path, 'error': str(exc)}


def handle(body, ctx):
    # 对话项目目录按请求取一次本线程局部值，全程显式传参（并发安全见 _write_file 注释）；
    # 模块级 dict 仅作外部观察兼容保留
    _pd = getattr(ctx, 'project_dir', None) or ''
    _CTX_PROJECT_DIR.clear()
    _CTX_PROJECT_DIR['dir'] = _pd
    files = body.get('files')
    if not files:
        files = [{'path': body.get('path', ''), 'content': body.get('content', '')}]

    # 【M1.3 能力策略】fs.write：用户规则 deny 即拒；ask 须带审批票据（_policy_ticket）。
    # 策略模块缺失属于授权类检查失效，fail-closed 拒绝写入。
    try:
        import hashlib as _hl
        from util_policy import get_default_engine, check_tool_call, project_rel
    except ImportError as _ipe:
        ctx.send_json({'ok': False, 'error': '能力策略模块缺失，fail-closed 拒绝写入: %s' % _ipe})
        return
    _pol_engine = get_default_engine()
    for _pf in files:
        _pp = str(_pf.get('path', ''))
        _pol_params = {'path': _pp, 'op': 'write',
                       'sha16': _hl.sha256(str(_pf.get('content', '')).encode('utf-8')).hexdigest()[:16]}
        # 规则按项目根相对路径书写：绝对/相对写法统一归一化后再判定
        _ok, _reason, _dec = check_tool_call(_pol_engine, 'fs.write', project_rel(_pp), _pol_params, body)
        if not _ok:
            ctx.send_json({'ok': False, 'path': _pp, 'error': '[能力策略] ' + _reason,
                           'policy': {'action': getattr(_dec, 'action', ''),
                                      'layer': getattr(_dec, 'layer', '')}})
            return

    results = [_write_file(item.get('path', ''), item.get('content', ''), _pd) for item in files]
    # 【2026-11-23】前端传来的项目路径无效时（如项目在未挂载的盘符上），ToolContext
    # 已静默回退软件根目录——必须把这件事告诉 AI，否则它以为写进了项目文件夹。
    _pd_note = getattr(ctx, 'project_dir_note', '') or ''
    if _pd_note:
        for r in results:
            if r.get('path'):
                r['path_warning'] = (r['path_warning'] + ' | ' + _pd_note) if r.get('path_warning') else _pd_note
    # 变更溯源记账（旁路，失败静默）+ 自动 checkpoint
    try:
        from tools.coding.backend import _changelog
        for r in results:
            if r.get('path') and 'error' not in r:
                _changelog.record_change(body.get('_chat_id', ''), 'write', r['path'], r.get('backup_path') or '')
        _auto_checkpoint(results, chat_id=body.get('_chat_id', ''))
    except Exception:
        pass
    if len(results) == 1:
        ctx.send_json({'ok': 'error' not in results[0], **results[0]})
    else:
        # 【2026-11-22 修复"假成功"】多文件模式 ok=全部成功。原恒 True：全部被闸门拒绝
        # （语法预检/路径守卫/文件保护）也报成功，模型据此虚报完成。失败清单同时放顶层
        # error（蜂群桥 _exec_dialog_tool 只认顶层 error 生成模型可见报错）。
        _failed = [r for r in results if 'error' in r]
        if _failed:
            _summary = ('以下 %d 个文件写入失败，本次不算完成：%s'
                        % (len(_failed), '; '.join(str(r.get('error'))[:80] for r in _failed[:5])))
            ctx.send_json({'ok': False, 'multi': True, 'files': results,
                           'error': _summary, 'failed_summary': _summary})
        else:
            ctx.send_json({'ok': True, 'multi': True, 'files': results})
