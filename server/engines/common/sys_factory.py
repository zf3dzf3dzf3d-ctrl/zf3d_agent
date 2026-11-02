# -*- coding: utf-8 -*-
"""sys_factory: P4 应用工厂（ZhuFeng Agent OS 六动词·创造层）

把「一句话要个工具」变成落地能力：
- sys_factory_make:   传入 name(工具名, 如 zf_mytool) + code(完整模块源码，须含 execute(name,args,ctx)->(ok,result))
                      落盘到 private/用户设置/sys_factory/<name>.py，py_compile 校验 + import 试运行后登记进系统调用表
- sys_factory_list:   列出已生成工具（含启用/停用状态、生成时间）
- sys_factory_disable/enable: 停用/重新启用（停用后 schema 不再下发、execute 拒绝）
- sys_factory_delete: 删除（删前自动 .bak 备份）

安全设计（照抄 sys_* 标准范式 + 本期强化）：
- ZF_FACTORY 环境变量动态闸门，默认关闭；关时 schema 不下发、执行直接拒绝
- 生成代码强制 py_compile 编译校验 + import 试运行（execute 缺失/不可导入 → 拒绝落盘）
- 工具名白名单校验：^[a-z][a-z0-9_]{2,30}$，且禁止 sys_/zf_ 内核前缀冲突（zf_ 允许，禁 sys_ 保留字）
- 生成工具统一标 dangerous 级走 syscall 权限网关（enforce 模式下需 approve）
- 单工具代码上限 64KB；落盘自动 .bak；删除走备份不直接抹
- 全程 syscall audit 审计
"""
import os
import re
import json
import time
import py_compile
import importlib

from engines.common.syscall import check_permission as _sys_check
from engines.common.syscall import audit as _syscall_audit
from engines.common.syscall import register as _syscall_register

# ---- 动态闸门（不固化，运行中改 ZF_FACTORY 即时生效） ----
def _factory_gate():
    return os.environ.get('ZF_FACTORY', '0') == '1'

_BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'private', '用户设置', 'sys_factory')
_INDEX_PATH = os.path.join(_BASE, '_index.json')
_MAX_CODE = 64 * 1024

_NAME_RE = re.compile(r'^[a-z][a-z0-9_]{2,30}$')
# 内核保留前缀：不允许生成工具占用（sys_* 是内核系统调用命名空间）
_RESERVED = re.compile(r'^(sys_|zf_config|kernel_)')


def _ensure_dir():
    os.makedirs(_BASE, exist_ok=True)


def _load_index():
    try:
        with open(_INDEX_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def _save_index(idx):
    _ensure_dir()
    with open(_INDEX_PATH, 'w', encoding='utf-8') as f:
        json.dump(idx, f, ensure_ascii=False, indent=2)


# ---- 运行时已加载模块缓存（enable/disable 即时生效用） ----
_LOADED = {}


def _module_path(name):
    return os.path.join(_BASE, name + '.py')


def _load_and_register(name):
    """import 生成模块并登记到系统调用表（dangerous 级）。返回 (ok, msg)。"""
    try:
        mod_path = _module_path(name)
        spec = importlib.util.spec_from_file_location('sys_factory_' + name, mod_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        if not hasattr(mod, 'execute'):
            return False, '模块缺少 execute(name, args, ctx) 入口'
        _LOADED[name] = mod
        _syscall_register('fct_' + name, 'sys_factory', dangerous=True,
                          description='factory generated tool: ' + name)
        return True, 'OK'
    except Exception as e:
        return False, str(e)[:200]


def get_schemas():
    if not _factory_gate():
        return []
    return [
        {'type': 'function', 'function': {
            'name': 'sys_factory_make',
            'description': '应用工厂：根据需求生成/更新一个自定义工具模块并注册为系统调用（dangerous 级）。需给 name（小写下划线工具名）与 code（完整 Python 模块源码，必须定义 execute(name, args, ctx) 返回 (ok, result)；代码里 import 仅限标准库+engines.common）',
            'parameters': {'type': 'object', 'properties': {
                'name': {'type': 'string', 'description': '工具名，如 text_counter'},
                'code': {'type': 'string', 'description': '完整模块源码'},
                'description': {'type': 'string', 'description': '一句话用途说明（可选）'}},
                'required': ['name', 'code']}}},
        {'type': 'function', 'function': {
            'name': 'sys_factory_list',
            'description': '应用工厂：列出所有已生成工具及状态',
            'parameters': {'type': 'object', 'properties': {}}}},
        {'type': 'function', 'function': {
            'name': 'sys_factory_toggle',
            'description': '应用工厂：停用/启用某个已生成工具（action=disable|enable）',
            'parameters': {'type': 'object', 'properties': {
                'action': {'type': 'string', 'enum': ['disable', 'enable']},
                'name': {'type': 'string'}},
                'required': ['action', 'name']}}},
        {'type': 'function', 'function': {
            'name': 'sys_factory_delete',
            'description': '应用工厂：删除某个已生成工具（自动 .bak 备份）',
            'parameters': {'type': 'object', 'properties': {
                'name': {'type': 'string'}}, 'required': ['name']}}},
    ]


def execute(name, args, ctx):
    """统一入口。返回 (ok, result_str)。"""
    if not _factory_gate():
        return False, '应用工厂未开启（设置环境变量 ZF_FACTORY=1）'
    t0 = time.time()
    try:
        if name == 'sys_factory_make':
            ok, r = _do_make(args, ctx)
        elif name == 'sys_factory_list':
            ok, r = _do_list()
        elif name == 'sys_factory_toggle':
            ok, r = _do_toggle(args)
        elif name == 'sys_factory_delete':
            ok, r = _do_delete(args, ctx)
        else:
            ok, r = False, '未知工厂操作: %s' % name
    except Exception as e:
        ok, r = False, '工厂异常: %s' % e
    _syscall_audit(name, (ctx or {}).get('engine_id', '?'), ok,
                   (time.time() - t0) * 1000, level='system', err='' if ok else str(r)[:120])
    return ok, r


def run_generated(tool_name, args, ctx):
    """供分发层调用：执行某个已生成工具（'fct_<name>'）。走 dangerous 权限网关。"""
    if not _factory_gate():
        return False, '应用工厂未开启'
    name = tool_name[4:] if tool_name.startswith('fct_') else tool_name
    t0 = time.time()
    ok_perm, why = _sys_check('fct_' + name)
    if not ok_perm:
        _syscall_audit('fct_' + name, (ctx or {}).get('engine_id', '?'), False,
                       0.0, level='dangerous', err=why)
        return False, why
    mod = _LOADED.get(name)
    if mod is None:
        ok, msg = _load_and_register(name)
        if not ok:
            return False, '加载失败: %s' % msg
        mod = _LOADED.get(name)
    idx = _load_index().get(name)
    if not idx or idx.get('disabled'):
        return False, '工具 %s 已停用' % name
    try:
        ok, result = mod.execute(tool_name, args or {}, ctx or {})
    except Exception as e:
        ok, result = False, '执行异常: %s' % e
    _syscall_audit('fct_' + name, (ctx or {}).get('engine_id', '?'), ok,
                   (time.time() - t0) * 1000, level='dangerous',
                   err='' if ok else str(result)[:120])
    return ok, result


# ---- 动态 schema：已生成且启用的工具，追加 fct_* schema 下发 ----
def get_generated_schemas():
    """分发层每轮注入前调用：为每个启用的生成工具产出 schema。"""
    if not _factory_gate():
        return []
    out = []
    for name, idx in sorted(_load_index().items()):
        if idx.get('disabled'):
            continue
        out.append({'type': 'function', 'function': {
            'name': 'fct_' + name,
            'description': '[工厂生成] %s' % (idx.get('description') or name),
            'parameters': {'type': 'object', 'properties': idx.get('params') or {}}}})
    return out


# ---------------- 内部实现 ----------------

def _do_make(args, ctx):
    name = str(args.get('name') or '').strip()
    code = str(args.get('code') or '')
    desc = str(args.get('description') or '')[:200]
    if not _NAME_RE.match(name):
        return False, '工具名不合法（须 ^[a-z][a-z0-9_]{2,30}$）: %s' % name
    if _RESERVED.match(name):
        return False, '工具名占用内核保留前缀（sys_/zf_config/kernel_）: %s' % name
    if len(code) > _MAX_CODE:
        return False, '代码超过 64KB 上限'
    if 'execute' not in code:
        return False, '代码必须定义 execute(name, args, ctx)'
    _ensure_dir()
    path = _module_path(name)
    # 1) 先写临时文件编译校验
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(code)
    try:
        py_compile.compile(tmp, doraise=True)
    except Exception as e:
        try:
            os.remove(tmp)
        except Exception:
            pass
        return False, 'py_compile 编译失败: %s' % str(e)[:300]
    # 2) 覆盖已存在文件前备份
    if os.path.exists(path):
        bak = path + '.bak'
        try:
            with open(path, 'r', encoding='utf-8') as fo, open(bak, 'w', encoding='utf-8') as fb:
                fb.write(fo.read())
        except Exception:
            pass
    os.replace(tmp, path)
    # 3) import 试运行 + 登记系统调用表
    _LOADED.pop(name, None)
    ok, msg = _load_and_register(name)
    if not ok:
        # 回滚：恢复备份或删除新文件
        bak = path + '.bak'
        if os.path.exists(bak):
            os.replace(bak, path)
            _load_and_register(name)  # 旧版回填
        else:
            try:
                os.remove(path)
            except Exception:
                pass
        return False, '试运行失败已回滚: %s' % msg
    # 4) 登记索引
    idx = _load_index()
    idx[name] = {'description': desc, 'created': time.time(),
                 'updated': time.time(), 'disabled': False,
                 'size': len(code)}
    _save_index(idx)
    return True, '工具 %s 已生成并注册（fct_%s，dangerous 级）' % (name, name)


def _do_list():
    idx = _load_index()
    if not idx:
        return True, '(应用工厂暂无生成工具)'
    out = ['%-24s %-8s %s' % ('NAME', 'STATE', 'DESC')]
    for n, i in sorted(idx.items()):
        out.append('%-24s %-8s %s' % (
            n[:24], 'disabled' if i.get('disabled') else 'enabled',
            (i.get('description') or '')[:40]))
    return True, '\n'.join(out)


def _do_toggle(args):
    name = str(args.get('name') or '').strip()
    action = str(args.get('action') or '')
    idx = _load_index()
    if name not in idx:
        return False, '工具不存在: %s' % name
    idx[name]['disabled'] = (action == 'disable')
    idx[name]['updated'] = time.time()
    _save_index(idx)
    if idx[name]['disabled']:
        _LOADED.pop(name, None)
    return True, '工具 %s 已%s' % (name, '停用' if action == 'disable' else '启用')


def _do_delete(args, ctx):
    name = str(args.get('name') or '').strip()
    idx = _load_index()
    if name not in idx:
        return False, '工具不存在: %s' % name
    path = _module_path(name)
    if os.path.exists(path):
        bak = path + '.bak'
        try:
            with open(path, 'r', encoding='utf-8') as fo, open(bak, 'w', encoding='utf-8') as fb:
                fb.write(fo.read())
            os.remove(path)
        except Exception as e:
            return False, '删除失败(已留.bak): %s' % e
    idx.pop(name, None)
    _save_index(idx)
    _LOADED.pop(name, None)
    return True, '工具 %s 已删除（.bak 备份保留于 %s）' % (name, _BASE)
