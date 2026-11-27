# -*- coding: utf-8 -*-
"""执法设施不变量（2026-11-24）。

“执法设施”= 约束智能体的那套东西本身：执行闸门、审计链、审批钩子、认证、提交钩子、门禁脚本与基线、
给智能体的规约。它们若能被智能体随手改写，其余一切约束都只是建议。
唯一真源是 server/util_enforcement.py；消费方是文件保护清单、热重载引擎、根目录白名单。

背景事故（本文件要防的就是这几类）：
  - 保护清单把 security.py 等写成裸文件名，而匹配按“项目根相对路径”算——四个核心文件的保护从未生效；
  - 第一版执法清单凭直觉挑，server/ 下 32 个调用执法原语的模块漏了 28 个；
  - 保护清单 JSON 一损坏就按空清单放行，全部保护静默消失；
  - 热重载“重载成功”但线上行为没变（处理器类仍引用旧类对象），安全修复看似上线其实没有；
  - shell 守卫只匹配完整路径，先 cd 再写裸文件名即可绕过只读；
  - 只读的判定是“命令里出现该路径即拦”，把需要被执行的脚本设成只读会让智能体连门禁都跑不了。

钉死的契约：
  A 清单自身：每条路径都真实存在；只读与关键两级无重叠、无重复；只读清单里没有需要被执行的脚本
  B 保护清单（真实清单）：清单条目全部已登记；只读条目确实不可写；关键条目至少是关键级
  C 热重载：只读执法模块与工具模块被排除；纯过滤函数正确；开关默认关闭；假生效检测正确
  F 调用方覆盖：调用执法原语的模块必须在清单里，或带原因地写进 DEFERRED_CONSUMERS
  D 根目录白名单包含给智能体的规约文件；规约文件在根目录、不是空壳、引用的仓库路径都存在
  E 源码约束：热重载的各个扫描点都查询了排除集合
  G 清单损坏 = 拒绝态：一切写入与 shell 命令被拒；损坏文件不被覆盖；修复后自动恢复
  H shell 守卫：完整路径、切目录后的裸文件名都拦；日常命令不误伤

用法：py tests/test_enforcement_assets.py   （退出码 0 = 全过）
"""
import ast
import json
import os
import re
import shutil
import sys
import tempfile
import time
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'server')
for _p in (SERVER, ROOT):
    if _p not in sys.path:
        sys.path.insert(0, _p)

_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, detail))
    if not cond:
        _fail.append(name)


def P(rel):
    return os.path.join(ROOT, *rel.split('/'))


import util_enforcement as ue  # noqa: E402
from tools.coding.backend import _file_protect as fp  # noqa: E402
from tools.coding.backend.run import _protect_cmd_hit  # noqa: E402

RO, CR, FLAGS = ue.ENFORCEMENT_READONLY, ue.ENFORCEMENT_CRITICAL, ue.ENFORCEMENT_READONLY_FLAGS
DEFERRED = dict(ue.DEFERRED_CONSUMERS)
ALL = tuple(RO) + tuple(CR) + tuple(FLAGS)

# ===== A 清单自身 =====
missing = [p for p in RO + CR if not os.path.exists(P(p))]
check('A1 清单里的每条路径都真实存在（防写了不存在的文件，或文件改名后清单失效）', not missing, missing)
flag_home_missing = [p for p in FLAGS if not os.path.isdir(os.path.dirname(P(p)))]
check('A1b 开关文件所在的目录存在（开关文件本身时有时无，按路径保护）', not flag_home_missing, flag_home_missing)
check('A2 只读 / 关键 / 开关 三者互不重叠', not (set(RO) & set(CR)) and not (set(FLAGS) & (set(RO) | set(CR))))
check('A3 各清单内部都没有重复条目',
      len(set(RO)) == len(RO) and len(set(CR)) == len(CR) and len(set(FLAGS)) == len(FLAGS))
runnable = [p for p in RO if p.endswith(('.bat', '.cmd', '.ps1', '.vbs', '.sh'))
            or p.startswith(('scripts/', 'tools/hooks/', 'tools/hygiene', 'tools/release/'))]
check('A4 只读清单里没有需要被执行的脚本（只读 = 命令里出现该路径即拦，脚本设只读会连门禁都跑不了）',
      not runnable, runnable)
must_ro = {'server/engines/common/syscall.py', 'server/engines/common/tool_base.py', 'server/egress_gate.py',
           'server/audit_chain.py', 'server/bot_gateway/approve_hook.py', 'server/secure_store.py',
           'server/kill_switch.py', 'server/browser_guard.py', 'server/util_key_reveal.py',
           'tools/quality/baseline.json', 'agents.md', 'security.md', 'claude.md'}
must_cr = {'server/security.py', 'server/config.py', 'server/db.py', 'server/handler_base.py',
           'server/routes/dispatcher.py', 'server/routes/api_dispatch_get.py', 'server/routes/api_dispatch_post.py',
           'tools/coding/backend/run.py', 'scripts/run_checks.py', 'tools/hooks/pre_commit_gate.py',
           'server/selftest.py'}
check('A5 执行闸门 / 审批 / 审计 / 出域 / 紧急停止 / 密钥 / 规约 必须在只读清单里',
      must_ro <= set(RO) and 'server/private/KILL_SWITCH' in FLAGS, sorted(must_ro - set(RO)))
check('A6 认证 / 请求入口 / 路由分发 / 出域代理 / shell 工具 / 门禁脚本 必须在关键清单里',
      must_cr <= set(CR), sorted(must_cr - set(CR)))
check('A7 暂缓纳入的调用方没有同时出现在清单里（二选一，不许两头都占）',
      not (set(DEFERRED) & set(ALL)), sorted(set(DEFERRED) & set(ALL)))

# ===== F 调用方覆盖 =====
_prim = set(ue.ENFORCEMENT_PRIMITIVES)
_funcs = set(ue.ENFORCEMENT_PRIMITIVE_FUNCS)


def _uses_primitive(node):
    if isinstance(node, ast.ImportFrom) and node.module:
        if node.module in _prim or any(node.module.startswith(m + '.') for m in _prim):
            return True
        if node.module == 'security' and any(a.name in _funcs for a in node.names):
            return True
    if isinstance(node, ast.Import) and any(a.name in _prim for a in node.names):
        return True
    if isinstance(node, ast.Name) and node.id in _funcs:
        return True
    if isinstance(node, ast.Attribute) and node.attr in _funcs:
        return True
    return False


consumers, unparsable = {}, []
_SKIP_PREFIX = ('server/data/swarm_pipeline/wt-', 'server/data/swarm_pipeline/wt-')
for _base in ('server', 'tools'):
    for _dp, _dns, _fns in os.walk(os.path.join(ROOT, _base)):
        _dns[:] = [d for d in _dns if d not in ('private', '__pycache__')]
        for _fn in _fns:
            if not _fn.endswith('.py'):
                continue
            _rel = os.path.relpath(os.path.join(_dp, _fn), ROOT).replace('\\', '/')
            if any(_rel.startswith(sp) for sp in _SKIP_PREFIX):
                continue
            try:
                _tree = ast.parse(open(os.path.join(_dp, _fn), encoding='utf-8-sig').read())
            except (SyntaxError, ValueError):
                unparsable.append(_rel)
                continue
            if any(_uses_primitive(n) for n in ast.walk(_tree)):
                consumers[_rel] = True
unlisted = sorted(p for p in consumers if p not in ALL and p not in DEFERRED)
stale_deferred = sorted(p for p in DEFERRED if p not in consumers)
check('F1 server/ 与 tools/ 下调用执法原语的模块全部在清单里（共 %d 个调用方）' % len(consumers),
      not unlisted, unlisted)
check('F2 暂缓名单里没有已经不再调用执法原语的模块（原因过期就该从名单里拿掉）', not stale_deferred, stale_deferred)
check('F3 调用方扫描没有解析不了的源文件', not unparsable, unparsable)
check('F4 暂缓的每一个都写了原因', all(len(r.strip()) >= 20 for r in DEFERRED.values()))

# ===== B 真实保护清单 =====
saved_list, saved_snap = fp.LIST_FILE, fp.SNAPSHOT_DIR
res = fp.ensure_enforcement()
check('B0 真实清单处于健康状态（load_error 为空）', not fp.list_all().get('load_error'), fp.list_all().get('load_error'))
check('B1 把清单并入真实保护清单：成功且幂等', res.get('ok') is True and res.get('changed') is False, res)
again = fp.ensure_enforcement()
check('B2 再执行一次不再有改动（幂等）', again.get('changed') is False, again)
optout = set(fp.list_all().get('enforcement_optout') or [])
not_ro = [p for p in RO + FLAGS if p not in optout and fp.level_of(P(p)) != fp.LEVEL_READONLY]
check('B3 只读清单与开关文件的每一条在真实清单里确实是只读级', not not_ro, not_ro)
not_protected = [p for p in CR if fp.level_of(P(p)) not in (fp.LEVEL_CRITICAL, fp.LEVEL_READONLY)]
check('B4 关键清单的每一条在真实清单里至少是关键级（四核心文件的保护曾经从未生效）', not not_protected, not_protected)
for rel in ('server/security.py', 'server/config.py', 'server/db.py', 'server/server.py'):
    ok, msg = fp.check_write(P(rel))
    check('B5 %s 的写入现在真的会经过校验' % rel, ok is True and 'critical protected' in (msg or ''))
ok, msg = fp.check_write(P('server/engines/common/syscall.py'))
check('B6 执行闸门不可写，且提示如何由人解除', ok is False and 'readonly protected' in msg)
ok, msg = fp.check_write(P('server/private/KILL_SWITCH'))
check('B6b 紧急停止开关文件（不存在时也一样）不可写', ok is False and 'readonly protected' in msg)
abs_syscall = P('server/engines/common/syscall.py')
for label, arg in (('规范相对路径', 'server/engines/common/syscall.py'), ('绝对路径', abs_syscall),
                   ('反斜杠', 'server\\engines\\common\\syscall.py'), ('带 ./ 前缀', './server/engines/common/syscall.py'),
                   ('大小写不同', 'Server/Engines/Common/Syscall.py')):
    r1, r2 = fp.remove(arg), fp.add(arg, 'critical')
    check('B7 工具接口不能解除执法设施的只读保护，也不能降级（%s）' % label,
          r1.get('ok') is False and r2.get('ok') is False, (r1, r2))
after = fp.ensure_enforcement()
check('B8 被拒绝的 remove/add 没有留下任何副作用', after.get('changed') is False, after)
check('B9 保留的旧条目没有被清掉（只增不删）', 'private/file_protection.json' in fp.list_all()['readonly']
      and 'tools/coding/backend/write.py' in fp.list_all()['critical'])
check('B10 快照与回滚不能绕过只读（文件先做过快照、后升为只读时，旧快照不得覆盖回去）',
      fp.make_snapshot(P('server/engines/common/syscall.py')) is None
      and fp.rollback(P('server/engines/common/syscall.py')).get('ok') is False)

# ===== C 热重载 =====
ex = ue.hot_reload_excluded_modules()
for m in ('engines.common.syscall', 'engines.common.tool_base', 'bot_gateway.approve_hook', 'egress_gate',
          'audit_chain', 'path_guard', 'secure_store', 'kill_switch', 'browser_guard', 'util_key_reveal',
          'util_enforcement', 'tools.coding.backend.run', 'tools.coding.backend.read'):
    check('C1 执法模块 %s 不参与热重载' % m, m in ex)
check('C2 路径 → 模块名的推导正确',
      ue.module_name_of('server/engines/common/syscall.py') == 'engines.common.syscall'
      and ue.module_name_of('server/routes/dispatcher.py') == 'routes.dispatcher'
      and ue.module_name_of('server/security.py') == 'security'
      and ue.module_name_of('.githooks/pre-commit') is None
      and ue.module_name_of('tools/coding/backend/run.py') is None)
sample = {'config.py': 'config', 'tools/coding/backend/run.py': 'tools.coding.backend.run',
          'routes/api_dispatch_get.py': 'routes.api_dispatch_get', 'engines/common/syscall.py': 'engines.common.syscall'}
kept, removed = ue.filter_enforcement(sample)
check('C3 过滤函数：只剔除执法模块，不改动传入的表',
      kept == {'config.py': 'config', 'routes/api_dispatch_get.py': 'routes.api_dispatch_get'}
      and sorted(removed) == [('engines/common/syscall.py', 'engines.common.syscall'),
                              ('tools/coding/backend/run.py', 'tools.coding.backend.run')]
      and len(sample) == 4, (kept, removed))
check('C3b 关键清单里的服务端模块按设计保持热重载（开发取舍；要改这是 deliberate 的一步，改这里）',
      'security' not in ex and 'routes.api_dispatch_post' not in ex and 'config' not in ex)

import hot_reload as hr  # noqa: E402

check('C12 热重载的硬编码监视表里没有执法模块', not (set(hr.HotReloader.PY_MODULES.values()) & ex),
      sorted(set(hr.HotReloader.PY_MODULES.values()) & ex))

tmp = tempfile.mkdtemp(prefix='zf_enf_')
saved_path, saved_env = hr._config.PORT_JSON_PATH, os.environ.pop('ZF_HOT_RELOAD', None)
try:
    no_flag = os.path.join(tmp, 'a.json')
    open(no_flag, 'w').write(json.dumps({'api_port': 8620}))
    hr._config.PORT_JSON_PATH = no_flag
    check('C4 热重载默认关闭（没有显式开启就不开）', hr.hot_reload_enabled() is False)
    with_flag = os.path.join(tmp, 'b.json')
    open(with_flag, 'w').write(json.dumps({'hot_reload': True}))
    hr._config.PORT_JSON_PATH = with_flag
    check('C5 机器本地配置 "hot_reload": true → 开启', hr.hot_reload_enabled() is True)
    os.environ['ZF_HOT_RELOAD'] = '0'
    check('C6 环境变量显式关闭优先于配置文件', hr.hot_reload_enabled() is False)
    os.environ['ZF_HOT_RELOAD'] = '1'
    hr._config.PORT_JSON_PATH = os.path.join(tmp, 'missing.json')
    check('C7 环境变量开启；配置文件不存在也不报错', hr.hot_reload_enabled() is True)
    os.environ.pop('ZF_HOT_RELOAD')
    bad = os.path.join(tmp, 'bad.json')
    open(bad, 'w').write('{不是 json')
    hr._config.PORT_JSON_PATH = bad
    check('C8 配置文件损坏 → 关闭（不抛异常、不误开）', hr.hot_reload_enabled() is False)
finally:
    hr._config.PORT_JSON_PATH = saved_path
    if saved_env is not None:
        os.environ['ZF_HOT_RELOAD'] = saved_env
shutil.rmtree(tmp, ignore_errors=True)

mod = types.ModuleType('routes.fake_mix')


class OldMixin(object):
    pass


class NewMixin(object):
    pass


for cls in (OldMixin, NewMixin):
    cls.__module__ = 'routes.fake_mix'
    cls.__name__ = 'MixinFake'
setattr(mod, 'MixinFake', NewMixin)


class StaleHandler(OldMixin, object):
    pass


class FreshHandler(NewMixin, object):
    pass


fake = {'routes.fake_mix': mod}
check('C9 假生效检测：处理器仍引用旧类 → 报告出来',
      hr.find_stale_mixins(StaleHandler, ['routes.fake_mix'], fake) == [('routes.fake_mix', 'MixinFake')])
check('C10 假生效检测：处理器已用新类 → 无残留', hr.find_stale_mixins(FreshHandler, ['routes.fake_mix'], fake) == [])
check('C11 假生效检测：模块没被重载就不误报', hr.find_stale_mixins(StaleHandler, [], fake) == [])

# ===== D 根目录白名单与规约文件 =====
# 规约的正式位置是仓库根目录（智能体只认根目录）。根目录是白名单制：快照守护会把白名单外的新文件隔离到
# private/rollback_quarantine/，而白名单的改动要重启后才对运行中的守护生效——2026-11-24 这三份文件就这样
# “消失”过一次。D2 守住“它们必须在根目录”，D6 守住“只有这一份”。
GOV = ('AGENTS.md', 'SECURITY.md', 'CLAUDE.md')


def _locate(name):
    return os.path.join(ROOT, name)


names = fp._ROOT_OK_NAMES
check('D1 根目录白名单包含 agents.md / security.md / claude.md', set(x.lower() for x in GOV) <= names,
      sorted(set(x.lower() for x in GOV) - names))
at_root = [n for n in GOV if os.path.isfile(os.path.join(ROOT, n))]
check('D2 三份规约在仓库根目录（智能体只认根目录；若被卫生闸隔离，从 private/rollback_quarantine/ 取回，并核对 _ROOT_OK_NAMES 与服务是否已重启）',
      len(at_root) == 3, '已在根目录: %s' % at_root)
for rel, least in (('AGENTS.md', 4000), ('SECURITY.md', 1200)):
    path = _locate(rel)
    text = open(path, encoding='utf-8').read() if os.path.isfile(path) else ''
    check('D3 %s 存在且有实质内容（%d 字符以上）' % (rel, least), len(text) >= least, len(text))
agents = open(_locate('AGENTS.md'), encoding='utf-8').read()
check('D4 规约覆盖：提交门禁 / 私有目录 / fail-closed / 热重载 / 调用方登记 / 完成的定义',
      all(k in agents for k in ('waivers.json', 'private/', 'fail-closed', 'util_enforcement', '完成的定义',
                                '--no-verify', 'hot_reload')))
refs = set()
for rel in GOV:
    path = _locate(rel)
    if os.path.isfile(path):
        refs |= set(re.findall(r'`([^`\s]+)`', open(path, encoding='utf-8').read()))
code_dirs = 'server|tools|scripts|tests|public|plugins|extensions|\\.githooks'
path_refs = sorted(r for r in refs
                   if re.match(r'^(%s)/[^*{}<>|]+$' % code_dirs, r) or r in GOV or re.match(r'^\.[^/]+\.bat$', r))
missing_refs = [r for r in path_refs if r not in FLAGS and not os.path.exists(_locate(r) if r in GOV else P(r))]
check('D6 规约只有根目录一份，没有暂存副本（防双真源）', not os.path.isdir(os.path.join(ROOT, 'docs', 'agent-governance')))
check('D5 规约里以反引号标出的仓库路径（%d 个）全部存在——文档不许指向不存在的文件' % len(path_refs),
      not missing_refs, missing_refs)

# ===== E 源码约束 =====
src = open(os.path.join(SERVER, 'hot_reload.py'), encoding='utf-8').read()
ast.parse(src)
check('E1 热重载的初始化扫描、自动发现、周期重扫、变更检查、手动重载都查询了排除集合',
      src.count('in self._excluded') >= 6, src.count('in self._excluded'))
check('E2 init_hot_reloader 先问开关再启动', 'if not hot_reload_enabled():' in src)
check('E3 重载记录里区分“成功”与“生效”，并带 needs_restart',
      "'effective': effective" in src and "'needs_restart': not effective" in src)
check('E4 状态接口暴露被排除的模块', "'excluded_py': sorted(self._excluded)" in src)

# ===== G 清单损坏 = 拒绝态 =====
# 用项目内 tmp/ 下的临时清单做实验（同卷，os.replace 才能原子落盘）；结束后把模块状态原样换回。
work = os.path.join(ROOT, 'tmp', 'zf_enf_list_%d' % os.getpid())
os.makedirs(work, exist_ok=True)
fake_list = os.path.join(work, 'file_protection.json')


def use_fake_list():
    fp._cache = {'data': None, 'mtime': None, 'loaded_at': 0.0, 'enforced': False}


try:
    fp.LIST_FILE, fp.SNAPSHOT_DIR = fake_list, os.path.join(work, 'snaps')
    target = P('server/server.py')
    outside = os.path.join(tempfile.gettempdir(), 'zf_enf_outside.txt')

    def write_list(text, mtime=None):
        with open(fake_list, 'w', encoding='utf-8') as f:
            f.write(text)
        if mtime is not None:
            os.utime(fake_list, (mtime, mtime))
        use_fake_list()

    good = json.dumps({'critical': ['private/file_protection.json', 'server/server.py'], 'readonly': ['private/file_protection.json'],
                       'anchors': {'server.py': ['def main']}})
    write_list('{不是 json')
    st = fp.list_all()
    check('G1 JSON 损坏 → 进入拒绝态，list_all 暴露 load_error', bool(st.get('load_error')), st.get('load_error'))
    ok, msg = fp.check_write(target)
    check('G2 拒绝态下写工具被拒，且说明怎么恢复', ok is False and '无法解析' in msg and 'fail-closed' in msg)
    ok, msg = fp.check_write(P('README.md'))
    check('G3 拒绝态下项目内任何文件都不可写（不知道什么受保护，就都不放行）', ok is False)
    ok, msg = fp.check_write(outside)
    check('G4 拒绝态下项目之外的路径同样拒绝（拒绝态 = 停下来等人修，不做范围猜测）', ok is False)
    hit = _protect_cmd_hit('dir /b')
    check('G5 拒绝态下 shell 命令被拒（原来只读清单读不到时会按未命中放行）', bool(hit) and '无法解析' in hit)
    before = open(fake_list, 'rb').read()
    r = fp.ensure_enforcement()
    check('G6 拒绝态下 ensure_enforcement 不做任何改动', r.get('ok') is False and r.get('changed') is False, r)
    r1 = fp.add('README.md')
    r2 = fp.remove('server/server.py')
    r3 = fp.set_anchors('server/server.py', 'def main')
    r4 = fp.rollback(target)
    r5 = fp.init_default()
    check('G7 拒绝态下增删改锚点、回滚、重建默认全部拒绝', all(x.get('ok') is False for x in (r1, r2, r3, r4)),
          [x.get('error') for x in (r1, r2, r3, r4)])
    check('G8 损坏的清单没有被任何入口覆盖（留给人处理）', open(fake_list, 'rb').read() == before and r5.get('already') is True)
    # 重新进入拒绝态，然后在不重置缓存、修改时间也不变的前提下把文件修好
    T = float(int(time.time()))
    write_list('{不是 json', mtime=T)
    check('G9a 重新进入拒绝态', bool(fp.list_all().get('load_error')))
    with open(fake_list, 'w', encoding='utf-8') as f:
        f.write(good)
    os.utime(fake_list, (T, T))
    check('G9 修好了文件但修改时间没变：2 秒内仍按拒绝态（短缓存，不立刻重读）',
          bool(fp.list_all().get('load_error')))
    time.sleep(2.2)
    check('G10 2 秒后自动重试，恢复健康', not fp.list_all().get('load_error'))
    ok, msg = fp.check_write(target)
    check('G11 恢复后关键文件回到关键级校验', ok is True and 'critical protected' in msg)

    for label, text in (('顶层是数组', '[]'), ('空对象', '{}'), ('"critical" 不是列表', '{"critical": null, "readonly": []}')):
        write_list(text)
        check('G12 清单结构不对也算损坏：%s' % label, bool(fp.list_all().get('load_error')))
    write_list('\ufeff' + good)
    check('G13 带 BOM 的合法清单不算损坏（人工用记事本改过）', not fp.list_all().get('load_error'))

    os.remove(fake_list)
    use_fake_list()
    st = fp.list_all()
    check('G14 清单被删 → 自动重建默认清单，状态健康', not st.get('load_error') and os.path.isfile(fake_list))
    check('G15 重建的清单重新并入执法设施（否则删文件就成了永久解除保护）',
          'server/engines/common/syscall.py' in st['readonly'] and 'server/server.py' in st['critical'])
    check('G16 重建后 shell 守卫恢复到正常判定', _protect_cmd_hit('dir /b') is None
          and bool(_protect_cmd_hit('type nul > server/engines/common/syscall.py')))
    json.load(open(fake_list, encoding='utf-8'))
    check('G17 重建出来的清单是合法 JSON', True)
finally:
    fp.LIST_FILE, fp.SNAPSHOT_DIR = saved_list, saved_snap
    use_fake_list()
    shutil.rmtree(work, ignore_errors=True)
check('G18 实验后真实清单状态未被触碰', not fp.list_all().get('load_error')
      and fp.level_of(P('server/engines/common/syscall.py')) == fp.LEVEL_READONLY
      and fp.LIST_FILE == saved_list)

# ===== H shell 守卫 =====
allow = ('dir /b', 'py scripts/run_checks.py', 'git status', 'git add -A', 'git commit -m "fix: gate"',
         'py tests/test_private_guard.py', 'py tests/test_enforcement_assets.py', 'py tests/test_key_reveal.py',
         'py -3 -c "print(1)"', 'del perf_baseline.json', 'cd server && py selftest.py')
for c in allow:
    check('H1 不误伤: %s' % c, _protect_cmd_hit(c) is None, _protect_cmd_hit(c))
block = ('type nul > server\\engines\\common\\syscall.py',
         'cd server/engines/common && echo x > syscall.py',
         'cd /d server && type nul > kill_switch.py',
         'cd server\\private && del KILL_SWITCH',
         'del server\\private\\KILL_SWITCH',
         'del ' + P('server/private/KILL_SWITCH'),
         'pushd tools\\quality && echo {} > baseline.json',
         'echo 9999 > tools/quality/baseline.json',
         'type AGENTS.md',
         'type nul > ' + P('server/engines/common/syscall.py'))
for c in block:
    check('H2 拦截: %s' % c, bool(_protect_cmd_hit(c)))

print('== 执法设施不变量: %d fail ==' % len(_fail))
for n in _fail:
    print('   FAIL:', n)
sys.exit(1 if _fail else 0)
