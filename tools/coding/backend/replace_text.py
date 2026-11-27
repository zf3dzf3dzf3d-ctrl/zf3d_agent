#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""replace_text - Replace text in files with bounded automatic backups."""
import os

from tools.coding.backend._backup import create_backup
from tools.coding.backend.write import _auto_checkpoint

TOOL_NAME = 'replace_text'


def _replace_in_file(path, old_text, new_text, replace_all, do_backup, project_dir=None):
    # 【2026-11-19 基址归一化】相对路径一律相对项目根解析（server 进程 cwd=server/，防误落 server/）
    # 【2026-11-23 项目基准修复】"项目根"优先取对话关联项目目录（与 read/tree_dir/write 同基准），
    # 修"读的是项目文件、替换却写到本体安装目录同名路径"的分裂；项目目录失效回退软件根目录。
    if path and not os.path.isabs(path):
        _base = project_dir or ''
        if not _base or not os.path.isdir(_base):
            try:
                from config import BASE_DIR as _BASE
            except Exception:
                from tools.coding.backend._changelog import BASE_DIR as _BASE
            _base = _BASE
        path = os.path.join(_base, path)
    # 【2026-09-11 只提示不限制】越界不再拒绝，提示文案存入 _warn 附在结果里
    _warn = ''
    try:
        from tools.coding.backend import _pathguard as _pg
        ok, err = _pg.check(path, project_dir)
        if not ok:
            if _pg.is_pending(err):
                # 已取消对话框确认：项目外路径自动放行并记录日志，不弹窗
                return None, '已自动放行项目外路径（仅记录，不需确认）', None, ''
            return None, err, None, ''
        _warn = err
    except Exception:
        pass
    # 【2026-09-11 编码自愈】自动检测编码读入，写回用同一编码，杜绝 GBK 文件被 UTF-8 重写污染
    _enc = 'utf-8'
    try:
        from tools.coding.backend import _encoding
        content, _enc = _encoding.read_text(path)
    except ImportError:
        with open(path, 'r', encoding='utf-8', errors='replace') as file:
            content = file.read()
    except FileNotFoundError:
        return None, 'File not found: ' + path, None, ''
    except Exception as exc:
        return None, str(exc), None, ''

    count = content.count(old_text)
    if count == 0:
        # 【2026-09-17 失败诊断增强】0 匹配时给出模糊匹配提示，避免反复盲试
        hint = ''
        try:
            # 用 old_text 前 60 字符和后 60 字符分别探测，找最接近的行
            probes = [p for p in (old_text.strip()[:60], old_text.strip()[-60:]) if len(p) >= 8]
            best = []
            for p in probes:
                idx = content.find(p)
                if idx >= 0:
                    line_no = content.count('\n', 0, idx) + 1
                    line = content[max(0, content.rfind('\n', 0, idx) + 1):content.find('\n', idx)]
                    best.append(f'第{line_no}行附近有片段: {line.strip()[:120]}')
            if best:
                hint = '；疑似位置 -> ' + ' | '.join(best[:2])
        except Exception:
            pass
        return None, f'old_text not found in file: {path} (0 matches, nothing replaced)' + hint, None, ''
    if not replace_all and count > 1:
        # 【2026-09-17 失败诊断增强】多匹配时列出各匹配所在行号
        line_nos = []
        start = 0
        while True:
            idx = content.find(old_text, start)
            if idx < 0:
                break
            line_nos.append(content.count('\n', 0, idx) + 1)
            start = idx + 1
            if len(line_nos) >= 8:
                break
        return None, (f'old_text matches {count} locations (lines: {", ".join(map(str, line_nos))}), '
                      f'set all=true to replace all, or make old_text more specific'), None, ''

    try:
        # 文件保护闸门：readonly 硬拦 / critical 多重校验
        try:
            from tools.coding.backend import _file_protect as _fprot
            ok, err = _fprot.check_write(path)
            if not ok:
                return None, err, None, ''
            _prot_snap = _fprot.make_snapshot(path) if _fprot.level_of(path) == 'critical' else None
        except Exception:
            _prot_snap = None
        backup_path = create_backup(path) if do_backup else None
        new_content = content.replace(old_text, new_text) if replace_all else content.replace(old_text, new_text, 1)
        # 文件保护写前校验（critical：乱码/语法/体量/锚点）
        try:
            ok, err = _fprot.precheck(path, new_content)
            if not ok:
                return None, 'file protect rejected: ' + err, None, ''
        except Exception:
            pass
        # 【2026-11-22 L0 写入端扩面】卫生查：存量文件编辑也拦"本次净增"的乱码/控制符污染
        # （old_content 传原内容：已毁损文件的存量乱码不拦，否则该文件永久无法编辑）
        try:
            ok, err = _fprot.hygiene_check(path, new_content, is_new=False, old_content=content)
            if not ok:
                return None, 'hygiene rejected: ' + err, None, ''
        except Exception:
            pass
        # 预检闸门：替换后语法不过拒写
        try:
            from tools.coding.backend import _preflight
            ok, err = _preflight.check_syntax(path, new_content)
            if not ok:
                return None, 'preflight rejected: ' + err, None, ''
        except Exception:
            pass
        with open(path, 'w', encoding=_enc) as file:
            file.write(new_content)
        # 写后回读比对（仅 critical）
        if _prot_snap:
            try:
                ok, err = _fprot.verify_after_write(path, new_content)
                if not ok:
                    rb = _fprot.rollback(path)
                    return None, ('file protect rejected: ' + err +
                                  ('（已自动回滚）' if rb.get('ok') else '')), None, ''
            except Exception:
                pass
    except Exception as exc:
        return None, str(exc), None, ''
    return count if replace_all else 1, None, backup_path, ''


def handle(body, ctx):
    try:
        old_text = body.get('old_text', '')
        if not old_text:
            ctx.send_error('old_text is required')
            return
        paths = body.get('paths') or ([body.get('path', '')] if body.get('path') else [])
        if not paths:
            ctx.send_error('No path specified')
            return

        # 【M1.3 能力策略】fs.write：用户规则 deny 即拒；ask 须带审批票据（_policy_ticket）
        try:
            import hashlib as _hl
            from util_policy import get_default_engine, check_tool_call, project_rel
        except ImportError as _ipe:
            ctx.send_error('能力策略模块缺失，fail-closed 拒绝: %s' % _ipe)
            return
        _pol_engine = get_default_engine()
        _old16 = _hl.sha256(str(body.get('old_text', '')).encode('utf-8')).hexdigest()[:16]
        for _pp in paths:
            _pol_params = {'path': str(_pp), 'op': 'replace', 'old16': _old16}
            # 规则按项目根相对路径书写：绝对/相对写法统一归一化后再判定
            _ok, _reason, _dec = check_tool_call(_pol_engine, 'fs.write', project_rel(str(_pp)), _pol_params, body)
            if not _ok:
                ctx.send_json({'ok': False, 'path': _pp, 'error': '[能力策略] ' + _reason,
                               'policy': {'action': getattr(_dec, 'action', ''),
                                          'layer': getattr(_dec, 'layer', '')}})
                return

        replace_all = bool(body.get('all', False))
        do_backup = bool(body.get('backup', True))
        results = []
        _proj_dir = getattr(ctx, 'project_dir', None) or ''
        _last_warns = {}
        for path in paths:
            replacements, error, backup_path, _warn = _replace_in_file(
                path, old_text, body.get('new_text', ''), replace_all, do_backup, _proj_dir
            )
            if _warn:
                _last_warns[path] = _warn
            result = {'path': path}
            if error:
                result['error'] = error
            else:
                result.update({
                    'replacements': replacements,
                    'backup': bool(backup_path),
                    'backup_path': backup_path,
                    **({'path_warning': _warn} if _warn else {}),
                })
            results.append(result)

        # 【2026-11-23】项目路径无效回退本体时必须告知 AI（与 write 同口径），防它以为改的是项目文件。
        # 失败结果也附：错误文案里的解析路径能暴露落点，但提示能直接给出原因与补救方向。
        _pd_note = getattr(ctx, 'project_dir_note', '') or ''
        if _pd_note:
            for r in results:
                if r.get('path'):
                    r['path_warning'] = (r['path_warning'] + ' | ' + _pd_note) if r.get('path_warning') else _pd_note

        if len(results) == 1:
            ok_single = 'error' not in results[0]
        else:
            ok_single = all('error' not in r for r in results)
        # 变更溯源记账（旁路，失败静默）
        try:
            from tools.coding.backend import _changelog
            for r in results:
                if r.get('path') and 'error' not in r:
                    _changelog.record_change(body.get('_chat_id', ''), 'replace_text', r['path'], r.get('backup_path') or '')
        except Exception:
            pass
        # 自动 checkpoint（旁路，失败静默）【2026-11-22 补 chat_id】账本进本对话专属账，
        # 不再落共享旧账（与 write 工具同口径）
        try:
            _auto_checkpoint(results, chat_id=body.get('_chat_id', ''))
        except Exception:
            pass
        if len(results) == 1:
            ctx.send_json({'ok': ok_single, **results[0]})
        else:
            # 【2026-11-22 修复"假成功"】多文件 ok=全部成功（原 any()：部分失败也报成功，
            # 失败文件被模型忽略）；注释原本就声明"有失败时 ok=false"，此处对齐实现。
            # 失败清单放顶层 error（蜂群桥只认顶层 error 生成模型可见报错）。
            ok_multi = all('error' not in r for r in results)
            _failed = [r for r in results if 'error' in r]
            if _failed:
                _summary = ('以下 %d 个文件替换失败，本次不算完成：%s'
                            % (len(_failed), '; '.join(str(r.get('error'))[:80] for r in _failed[:5])))
                ctx.send_json({'ok': False, 'multi': True, 'files': results,
                               'error': _summary, 'failed_summary': _summary})
            else:
                ctx.send_json({'ok': True, 'multi': True, 'files': results})
    except Exception as exc:
        ctx.send_error(str(exc))
