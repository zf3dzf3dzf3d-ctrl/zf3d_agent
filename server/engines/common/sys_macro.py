# -*- coding: utf-8 -*-
"""sys_macro: P3 宏录制/回放（ZhuFeng Agent OS 感知/控制/接管第三阶段）

提供操作宏能力：
- sys_macro_ctrl:  start 开始录制（开缓冲）/ stop 停止录制 / save 命名保存
- sys_macro_add:   向录制缓冲追加一条操作（click/type/key/scroll，参数与 sys_input 一致）
- sys_macro_list:  列出已保存宏
- sys_macro_run:   回放宏（逐条调用 sys_input 执行，dangerous 级走 syscall 权限网关）
安全设计（照抄 sys_* 标准范式）：
- ZF_MACRO 环境变量动态闸门，默认关闭；关时 schema 不下发、执行直接拒绝
- 回放走 syscall check_permission/enforce（对齐 sys_input dangerous 级）
- 宏落盘 private/用户设置/sys_macro_lib.json，单宏操作上限 200 条防滥用
"""
import os
import json
import time

from engines.common.syscall import check_permission as _sys_check
from engines.common.syscall import approve as _sys_approve
from engines.common.syscall import audit as _syscall_audit

# ---- 动态闸门（不固化，运行中改 ZF_MACRO 即时生效） ----
def _macro_gate():
    return os.environ.get('ZF_MACRO', '0') == '1'

_LIB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'private', '用户设置', 'sys_macro_lib.json')

_MAX_OPS = 200
_REC_BUFFER = []       # 录制缓冲: [{'op':'click','x':..,...}]
_RECORDING = [False]

_VALID_OPS = ('click', 'type', 'key', 'scroll')


def _load_lib():
    try:
        with open(_LIB_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def _save_lib(lib):
    os.makedirs(os.path.dirname(_LIB_PATH), exist_ok=True)
    with open(_LIB_PATH, 'w', encoding='utf-8') as f:
        json.dump(lib, f, ensure_ascii=False, indent=2)


def get_schemas():
    if not _macro_gate():
        return []
    return [
        {'type': 'function', 'function': {
            'name': 'sys_macro_ctrl',
            'description': '宏录制控制：start=开始录制（清空缓冲），stop=停止录制，save=把缓冲保存为命名宏（需带 name 参数）',
            'parameters': {'type': 'object', 'properties': {
                'action': {'type': 'string', 'enum': ['start', 'stop', 'save']},
                'name': {'type': 'string', 'description': 'save 时必填：宏名称'}},
                'required': ['action']}}},
        {'type': 'function', 'function': {
            'name': 'sys_macro_add',
            'description': '录制中：向宏缓冲追加一条操作。op=click 需 x/y（可选 button/double）；op=type 需 text；op=key 需 key（如 enter/ctrl+s）；op=scroll 需 y（像素）',
            'parameters': {'type': 'object', 'properties': {
                'op': {'type': 'string', 'enum': ['click', 'type', 'key', 'scroll']},
                'x': {'type': 'integer'}, 'y': {'type': 'integer'},
                'button': {'type': 'string'}, 'double': {'type': 'boolean'},
                'text': {'type': 'string'}, 'key': {'type': 'string'},
                'delay_ms': {'type': 'integer', 'description': '执行此步前等待毫秒，默认200'}},
                'required': ['op']}}},
        {'type': 'function', 'function': {
            'name': 'sys_macro_list',
            'description': '列出已保存的宏（名称、步数、保存时间）',
            'parameters': {'type': 'object', 'properties': {}}}},
        {'type': 'function', 'function': {
            'name': 'sys_macro_run',
            'description': '回放指定宏（逐条执行键鼠操作，dangerous 级需权限确认）',
            'parameters': {'type': 'object', 'properties': {
                'name': {'type': 'string', 'description': '宏名称'}},
                'required': ['name']}}},
    ]


def execute(tool_name, args, ctx=None):
    args = args or {}
    if not _macro_gate():
        return False, '[sys_macro] 未开启：设置环境变量 ZF_MACRO=1 后可用'

    if tool_name == 'sys_macro_ctrl':
        action = args.get('action')
        if action == 'start':
            _REC_BUFFER.clear()
            _RECORDING[0] = True
            _syscall_audit('sys_macro_record_start', 'common:sys_macro', True, 0)
            return True, '录制已开始，缓冲已清空。用 sys_macro_add 逐步追加操作。'
        if action == 'stop':
            _RECORDING[0] = False
            _syscall_audit('sys_macro_record_stop', 'common:sys_macro', True, 0)
            return True, '录制已停止，缓冲共 %d 条操作。可用 sys_macro_ctrl save 保存。' % len(_REC_BUFFER)
        if action == 'save':
            name = (args.get('name') or '').strip()
            if not name:
                return False, 'save 需要 name 参数'
            if not _REC_BUFFER:
                return False, '缓冲为空，没有可保存的操作'
            lib = _load_lib()
            lib[name] = {'ops': list(_REC_BUFFER), 'ts': time.time()}
            try:
                _save_lib(lib)
            except Exception as e:
                return False, '保存失败: %s' % e
            _syscall_audit('sys_macro_save', 'common:sys_macro', True, 0)
            return True, '宏「%s」已保存，共 %d 条操作。' % (name, len(_REC_BUFFER))
        return False, '未知 action: %s' % action

    if tool_name == 'sys_macro_add':
        if not _RECORDING[0]:
            return False, '未在录制中，请先 sys_macro_ctrl start'
        op = args.get('op')
        if op not in _VALID_OPS:
            return False, 'op 必须是 %s 之一' % '/'.join(_VALID_OPS)
        if len(_REC_BUFFER) >= _MAX_OPS:
            return False, '缓冲已达上限 %d 条，请 stop 后 save' % _MAX_OPS
        entry = {'op': op,
                 'delay_ms': max(0, min(int(args.get('delay_ms') or 200), 10000))}
        if op == 'click':
            if 'x' not in args or 'y' not in args:
                return False, 'click 需要 x/y'
            entry['x'], entry['y'] = int(args['x']), int(args['y'])
            for k in ('button', 'double'):
                if args.get(k) is not None:
                    entry[k] = args[k]
        elif op == 'type':
            if not args.get('text'):
                return False, 'type 需要 text'
            entry['text'] = str(args['text'])[:2000]
        elif op == 'key':
            if not args.get('key'):
                return False, 'key 需要 key 参数'
            entry['key'] = str(args['key'])[:64]
        elif op == 'scroll':
            if 'y' not in args:
                return False, 'scroll 需要 y（正数向下/负数向上）'
            entry['y'] = int(args['y'])
        _REC_BUFFER.append(entry)
        return True, '已追加第 %d 条：%s' % (len(_REC_BUFFER), json.dumps(entry, ensure_ascii=False))

    if tool_name == 'sys_macro_list':
        lib = _load_lib()
        if not lib:
            return True, '暂无已保存宏'
        rows = ['%s | %d 步 | %s' % (k, len(v.get('ops', [])),
                                     time.strftime('%m-%d %H:%M', time.localtime(v.get('ts', 0))))
                for k, v in lib.items()]
        return True, '已保存宏 %d 个：\n' % len(lib) + '\n'.join(rows)

    if tool_name == 'sys_macro_run':
        name = (args.get('name') or '').strip()
        lib = _load_lib()
        if name not in lib:
            return False, '宏不存在: %s（用 sys_macro_list 查看）' % name
        ops = lib[name].get('ops', [])
        if not ops:
            return False, '宏为空'
        # dangerous 级：走 syscall 权限网关（enforce 下需人工确认）
        okp, pmsg = _sys_check('sys_macro_run', 'common:sys_macro')
        if not okp:
            return False, '[权限拦截] %s' % pmsg

        from engines.common import sys_input
        results, failed = [], 0
        for i, e in enumerate(ops, 1):
            if e.get('delay_ms'):
                time.sleep(e['delay_ms'] / 1000.0)
            op = e['op']
            try:
                if op == 'click':
                    ok, msg = sys_input.execute('sys_input_click',
                        {'x': e['x'], 'y': e['y'], 'button': e.get('button', 'left'),
                         'double': e.get('double', False)}, ctx)
                elif op == 'type':
                    ok, msg = sys_input.execute('sys_input_type', {'text': e['text']}, ctx)
                elif op == 'key':
                    ok, msg = sys_input.execute('sys_input_key', {'key': e['key']}, ctx)
                elif op == 'scroll':
                    ok, msg = sys_input.execute('sys_input_scroll', {'y': e['y']}, ctx)
                else:
                    ok, msg = False, '未知操作'
            except Exception as ex:
                ok, msg = False, '执行异常: %s' % ex
            results.append('%d/%d %s -> %s' % (i, len(ops), op, 'OK' if ok else str(msg)[:80]))
            if not ok:
                failed += 1
        _syscall_audit('sys_macro_run', 'common:sys_macro', failed == 0,
                       len(ops), err='failed=%d name=%s' % (failed, name) if failed else '')
        return failed == 0, '回放「%s」完成：%d/%d 步成功\n%s' % (
            name, len(ops) - failed, len(ops), '\n'.join(results))

    return False, '未知工具: %s' % tool_name
