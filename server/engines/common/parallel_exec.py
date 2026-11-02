# -*- coding: utf-8 -*-
"""并行工具执行器（各引擎 execute_tool_calls 复用，不重复造轮子）。

设计：
- 只读工具（白名单）→ 线程池并行执行；
- 写操作 / 未知工具 → 严格按原顺序串行，保证状态一致性；
- 返回格式与各引擎现有串行循环完全一致（[{tool_call_id, role, content, _ok}]）。
"""
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor

# 只读白名单：这些工具无副作用，可安全并行
READONLY_TOOLS = {
    'read_file', 'read_lines', 'tree_dir', 'find_files', 'search_in_files',
    'file_info', 'get_tool_result',  # 纯只读，可安全并行
}
# project_record 仅只读动作可并行；write/append/delete 视为副作用
RECORD_READONLY_ACTIONS = {'list', 'read', 'search'}

# 明确有副作用的工具，绝不并行
WRITE_TOOLS = {
    'write_file', 'replace_text', 'move_file', 'run_code',
    'project_record_write', 'browser_control',
}

_MAX_WORKERS = 4

# 黑板占用锁：写工具需持有对应文件；run_code 无法精确到文件 → 放行+审计
try:
    from engines.common import project_blackboard as _pbb
except Exception:
    _pbb = None

# 需要传 path 的写工具 → 检查哪个参数；run_code 只审计
_BB_PATH_KEYS = {'write_file': ['path', 'paths'], 'replace_text': ['path', 'paths'],
                 'move_file': ['src', 'dst']}
# files 数组元素是 {path, content} 对象，需单独提取其中 path
_BB_FILES_KEYS = {'write_file': ['files']}
# moves 数组元素是 {src, dst} 对象，需单独提取其中 src+dst
_BB_MOVES_KEYS = {'move_file': ['moves']}
_BB_AUDIT_TOOLS = {'run_code', 'browser_control'}
_BB_PROJECT_KEY = 'project_id'  # ctx 中项目 ID 的键名

# 与各引擎 _clip_result 一致：头 3/4 + 尾 1/4（报错和最终输出多在结尾）


def _clip_result(out, max_len):
    """头 3/4 + 尾 1/4 截断，中段标注省略。与引擎侧 _clip_result 策略一致。"""
    if not max_len or len(out) <= max_len:
        return out
    tail = max_len // 4
    head = max_len - tail
    return (out[:head]
            + '\n...[中段 %d 字符已省略]...\n' % (len(out) - max_len)
            + out[-tail:])


def make_dict_adapter(tools, max_len=None):
    """把 {name: {'run': fn}} 形式的工具表适配成 reg.execute(name,args,ctx)->(ok,result) 接口。"""
    import json as _json

    class _Adapter(object):
        def execute(self, name, args, ctx):
            t = (tools or {}).get(name)
            if t is None:
                return False, 'unknown tool: %s' % name
            try:
                out = t['run'](args, ctx)
            except Exception as e:
                return False, 'tool error: %s' % e
            if not isinstance(out, str):
                out = _json.dumps(out, ensure_ascii=False)
            if max_len:
                out = _clip_result(out, max_len)
            return True, out

    return _Adapter()


def _is_readonly(name, args=None):
    if name == 'project_record':
        return isinstance(args, dict) and str(args.get('action') or '').lower() in RECORD_READONLY_ACTIONS
    return name in READONLY_TOOLS


def _parse_args(args):
    if isinstance(args, str):
        try:
            return json.loads(args or '{}')
        except json.JSONDecodeError:
            return {'_raw': args}
    return args or {}


def execute_parallel(tool_calls, ctx, reg, counter=None):
    """并行执行一批工具调用。reg 需提供 reg.execute(name, args, ctx) -> (ok, result)。

    策略：扫描调用列表，把连续的只读工具组成“并行组”一次性并发；
    写工具及前后间隙单独串行。整体保持输入顺序输出结果。
    """
    calls = list(tool_calls or [])
    n = len(calls)
    results = [None] * n

    def _bb_paths(name, args):
        """从写工具参数提取涉及路径。"""
        keys = _BB_PATH_KEYS.get(name)
        if not keys:
            return []
        out = []
        for k in keys:
            v = args.get(k)
            if isinstance(v, list):
                out.extend([x for x in v if x])
            elif v:
                out.append(v)
        # 批量写：files=[{path, content}, ...]，提取其中的 path
        for k in _BB_FILES_KEYS.get(name, []):
            for item in (args.get(k) or []):
                if isinstance(item, dict) and item.get('path'):
                    out.append(item['path'])
        # 批量移动：moves=[{src, dst}, ...]，提取其中的 src+dst
        for k in _BB_MOVES_KEYS.get(name, []):
            for item in (args.get(k) or []):
                if isinstance(item, dict):
                    for pk in ('src', 'dst'):
                        if item.get(pk):
                            out.append(item[pk])
        return out

    def _bb_guard(name, args, owner):
        """写前黑板检查。返回 None=放行（含自动 acquire），str=拒绝原因。"""
        if _pbb is None or not _pbb.bb_enabled():
            return None
        pid = (ctx or {}).get(_BB_PROJECT_KEY) or 'default'
        if name in _BB_AUDIT_TOOLS:
            _pbb.bb_audit_run_code(pid, owner, '%s %s' % (name, str(args.get('code') or args.get('action') or '')[:100]))
            return None
        paths = _bb_paths(name, args)
        if not paths:
            return None
        r = _pbb.bb_acquire(pid, paths, owner, role='tool:%s' % name, hint='')
        if r.get('ok'):
            return None
        cs = r.get('conflicts') or []
        who = '、'.join(sorted({(c.get('role') or '') + '(' + str(c.get('owner'))[:8] + ')' for c in cs}))
        return ('⛔ 黑板占用冲突：%s 正在被其他智能体开发（%s，已占 %d 秒）。'
                '请先等待或提醒用户裁决（可强制接管）。超过 %d 秒无心跳会自动放行。'
                % ('、'.join(os.path.basename(str(c['path'])) for c in cs), who,
                   max((c.get('held_for_sec') or 0) for c in cs), _pbb.HEARTBEAT_TIMEOUT))

    def run_one(tc):
        name = tc.get('name') or ''
        args = _parse_args(tc.get('arguments'))
        owner = _pbb.bb_owner_of(ctx) if _pbb else None
        if _pbb and name not in READONLY_TOOLS and name != 'project_record':
            deny = _bb_guard(name, args, owner)
            if deny:
                return {
                    'tool_call_id': tc.get('tool_call_id') or tc.get('id') or '',
                    'role': 'tool',
                    'content': '[BLOCK %s] %s' % (name, deny),
                    '_ok': False,
                }
        t0 = time.time()
        ok, result = reg.execute(name, args, ctx)
        dt = time.time() - t0
        # 写成功即释放黑板占用（避免锁挂到超时才被回收）
        if _pbb and ok and name not in READONLY_TOOLS and name != 'project_record':
            try:
                _rl = _bb_paths(name, args)
                if _rl:
                    _pbb.bb_release((ctx or {}).get(_BB_PROJECT_KEY) or 'default', _rl, owner)
            except Exception:
                pass
        if counter is not None:
            counter['total'] += 1
        header = '[OK %s %.2fs]' % (name, dt) if ok else '[ERR %s %.2fs]' % (name, dt)
        return {
            'tool_call_id': tc.get('tool_call_id') or tc.get('id') or '',
            'role': 'tool',
            'content': '%s %s' % (header, result),
            '_ok': ok,
        }

    i = 0
    while i < n:
        name = calls[i].get('name') or ''
        if _is_readonly(name, _parse_args(calls[i].get('arguments'))):
            # 收集连续只读段
            j = i
            while j < n and _is_readonly(calls[j].get('name') or '', _parse_args(calls[j].get('arguments'))):
                j += 1
            seg = calls[i:j]
            if len(seg) == 1:
                results[i] = run_one(seg[0])
            else:
                with ThreadPoolExecutor(max_workers=min(_MAX_WORKERS, len(seg))) as ex:
                    done = list(ex.map(run_one, seg))
                results[i:j] = done
            i = j
        else:
            results[i] = run_one(calls[i])
            i += 1

    return results
