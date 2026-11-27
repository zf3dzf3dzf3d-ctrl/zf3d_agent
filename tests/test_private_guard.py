# -*- coding: utf-8 -*-
"""私有目录读防护（2026-11-24）。

背景：private/ 是应用自己的隐私与凭据目录（密钥库、对话库、记忆、日志、port.json 里的 auth_token）。
此前只有 read 工具过守卫，列目录 / 目录树 / 找文件 / 内容检索这几类工具对 private/ 零防护；
而且 read 工具对密钥库 api_keys.json 读写都放行——读回等于把全部密钥交给模型。

修复：
  - security.is_blocked_system_path(path, for_write=False)：密钥库仅写放行（代填 API Key），读回拦截
  - tools/coding/backend/_private_guard.py：列目录 / 检索 / 遍历类工具对私有目录一律不处理
  - list_dir / tree_dir / find_files / search_in_files / regex_search 五个工具接入

钉死的契约：
  A security 口径：密钥库可写不可读；记忆目录读写照旧；port.json / 密钥库备份 / bak / 内部密钥都拦
  B 各种绕过写法：设备路径前缀、大小写、正斜杠、兄弟目录
  C 五个工具：以私有目录为目标 → 拒绝或零结果；以含私有子目录的目录为目标 → 结果不含私有路径
  D 非私有路径不受影响

全程只读：不写、不删任何文件。
用法：py tests/test_private_guard.py   （退出码 0 = 全过）
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'server')
for _p in (SERVER, ROOT):
    if _p not in sys.path:
        sys.path.insert(0, _p)

_fail = []
BS = chr(92)
SEP = os.sep


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, detail))
    if not cond:
        _fail.append(name)


def P(*parts):
    return os.path.join(ROOT, *parts)


import security  # noqa: E402
from tools.coding.backend import _private_guard as pg  # noqa: E402

# ===== A =====
blocked = security.is_blocked_system_path
check('A1 密钥库：读 → 拦截', blocked(P('private', 'api_keys.json')) is True)
check('A2 密钥库：写（代填 API Key）→ 放行', blocked(P('private', 'api_keys.json'), for_write=True) is False)
check('A3 长期记忆目录：读 → 照旧放行', blocked(P('private', '记忆', 'x.md')) is False)
check('A4 长期记忆目录：写 → 照旧放行', blocked(P('private', '记忆', 'x.md'), for_write=True) is False)
check('A5 port.json（含 auth_token）→ 拦截', blocked(P('private', 'port.json')) is True)
check('A6 密钥库的历史备份 → 拦截', blocked(P('private', 'config_backups', 'api_keys.json')) is True)
check('A7 密钥库的 .bak 副本 → 拦截', blocked(P('private', 'api_keys.json.bak.20261123')) is True)
check('A8 server/private 内部密钥 → 拦截', blocked(P('server', 'private', 'internal_secret.txt')) is True)
check('A9 密钥库：写入接口也不能读回——for_write 只放行写，不改变读判定',
      blocked(P('private', 'api_keys.json'), for_write=False) is True)

# ===== B =====
check('B1 Win32 设备路径前缀（' + BS + BS + '?' + BS + '）→ 拦截',
      blocked(BS + BS + '?' + BS + P('private', 'port.json')) is True)
check('B2 大小写 + 正斜杠 → 拦截', blocked(P('PRIVATE', 'Port.JSON').replace(BS, '/')) is True)
check('B3 兄弟目录 private/记忆2 不得被“记忆”白名单误放行', blocked(P('private', '记忆2', 'x.md')) is True)
check('B4 密钥库同前缀的其它文件 private/api_keys.json.old → 拦截', blocked(P('private', 'api_keys.json.old')) is True)

# ===== C 五个工具 =====
from tools.coding.backend import list_dir, tree_dir, find_files  # noqa: E402
from tools.coding.backend import search_in_files, regex_search, read  # noqa: E402


class Ctx(object):
    def __init__(self, project_dir=ROOT):
        self.out = []
        self.err = None
        self.project_dir = project_dir
        self.base_dir = ROOT
        self.chat_id = 'test-private-guard'

    def safe_project_path(self, p):
        return p if os.path.isabs(p) else os.path.join(self.project_dir, p)

    def send_json(self, d):
        self.out.append(d)

    def send_error(self, e):
        self.err = str(e)


def run(mod, body):
    c = Ctx()
    mod.handle(body, c)
    return c


def in_private(path):
    p = os.path.normcase(str(path))
    return (SEP + 'private' + SEP) in p or p.rstrip(SEP).endswith(SEP + 'private')


# list_dir（拒绝时走 JSON 返回：{'ok': False, 'error': ...}）
c = run(list_dir, {'path': P('private')})
check('C1 list_dir private/ → 拒绝并说明', (c.out[0] or {}).get('ok') is False and 'private protected' in str((c.out[0] or {}).get('error')), c.out)
c = run(list_dir, {'path': P('server', 'private')})
check('C2 list_dir server/private → 拒绝', (c.out[0] or {}).get('ok') is False and 'private protected' in str((c.out[0] or {}).get('error')), c.out)
c = run(list_dir, {'paths': [P('server'), P('private', 'db')]})
dirs = (c.out[0] or {}).get('dirs') or []
priv = [d for d in dirs if in_private(d.get('path'))]
check('C2b list_dir 多路径里夹带私有目录 → 该路径报错，其余照常',
      len(dirs) == 2 and priv and 'private protected' in str(priv[0].get('error')) and not priv[0].get('entries'), dirs[:1])

# tree_dir
c = run(tree_dir, {'path': P('private'), 'max_depth': 1})
check('C3 tree_dir private/ → 拒绝', c.err is not None and 'private protected' in c.err, c.err)
tree_dir._TREE_CACHE.clear()
c = run(tree_dir, {'path': ROOT, 'max_depth': 1, 'force': True})
tree = (c.out[0] or {}).get('tree', '') if c.out else ''
lines = [l for l in tree.splitlines() if l.rstrip().endswith('private/')]
check('C4 tree_dir 项目根 → 目录树里不出现 private/', c.err is None and not lines, lines[:2])
tree_dir._TREE_CACHE.clear()
c = run(tree_dir, {'path': P('server'), 'max_depth': 1, 'force': True})
tree = (c.out[0] or {}).get('tree', '') if c.out else ''
lines = [l for l in tree.splitlines() if l.rstrip().endswith('private/')]
check('C5 tree_dir server/ → 目录树里不出现 server/private', c.err is None and not lines, lines[:2])

# find_files
c = run(find_files, {'path': P('private'), 'pattern': '*.json'})
check('C6 find_files private/ → 零结果', (c.out[0] or {}).get('count') == 0, c.out)
c = run(find_files, {'path': P('server'), 'pattern': '*.txt', 'max_results': 500})
files = (c.out[0] or {}).get('files', []) if c.out else []
check('C7 find_files server/ → 结果不含 server/private 下的文件', c.err is None and not any(in_private(f) for f in files),
      [f for f in files if in_private(f)][:2])

# search_in_files / regex_search
c = run(search_in_files, {'path': P('private'), 'keyword': 'token'})
check('C8 search_in_files private/ → 零匹配', (c.out[0] or {}).get('total_matches') == 0, c.out)
c = run(search_in_files, {'path': P('private', 'api_keys.json'), 'keyword': 'dpapi'})
check('C9 search_in_files 直接指定密钥库 → 零匹配', (c.out[0] or {}).get('total_matches') == 0, c.out)
c = run(search_in_files, {'path': P('server'), 'keyword': 'secret', 'max_results': 200})
res = (c.out[0] or {}).get('results', []) if c.out else []
check('C10 search_in_files server/ → 结果不含 server/private 下的文件', not any(in_private(r.get('file')) for r in res),
      [r.get('file') for r in res if in_private(r.get('file'))][:2])
c = run(regex_search, {'path': P('private'), 'pattern': 'token'})
check('C11 regex_search private/ → 零匹配', (c.out[0] or {}).get('total_matches') == 0, c.out)
c = run(regex_search, {'path': P('server'), 'pattern': 'secret', 'max_results': 200})
res = (c.out[0] or {}).get('results', []) if c.out else []
check('C12 regex_search server/ → 结果不含 server/private 下的文件', not any(in_private(r.get('file')) for r in res),
      [r.get('file') for r in res if in_private(r.get('file'))][:2])

# read
c = run(read, {'path': P('private', 'api_keys.json')})
out = c.out[0] if c.out else {}
check('C13 read 密钥库 → 拒绝（不再把密钥读进模型上下文）', out.get('ok') is False and 'Blocked' in str(out.get('error')), out)
c = run(read, {'path': 'private/api_keys.json'})
out = c.out[0] if c.out else {}
check('C14 read 相对路径的密钥库 → 同样拒绝', out.get('ok') is False and 'Blocked' in str(out.get('error')), out)
c = run(read, {'path': P('private', 'port.json')})
out = c.out[0] if c.out else {}
check('C15 read port.json → 拒绝', out.get('ok') is False and 'Blocked' in str(out.get('error')), out)

# ===== D 非私有路径不受影响 =====
c = run(list_dir, {'path': P('server')})
names = [e.get('name') for e in ((c.out[0] or {}).get('entries') or [])] if c.out else []
check('D1 list_dir server/ 正常返回（上级目录里看得到 private 这个目录名，但进不去）',
      c.err is None and (c.out[0] or {}).get('ok') is True and 'security.py' in names, (c.err, len(names)))
c = run(find_files, {'path': P('tools', 'quality'), 'pattern': '*.py'})
check('D2 find_files 普通目录照常工作', c.err is None and ((c.out[0] or {}).get('count') or 0) >= 5, (c.out[0] or {}).get('count'))
check('D3 项目代码 / 文档 / 前端资源都不是私有路径',
      not pg.is_private(P('server', 'security.py')) and not pg.is_private(P('docs', 'x.md')) and not pg.is_private(P('public', 'js', 'app.js')))
check('D4 项目根目录下名字含“记忆”但不在 private 里的目录不被误拦', not pg.is_private(P('记忆', 'x.md')))

print('== 私有目录读防护回归: %d fail ==' % len(_fail))
sys.exit(1 if _fail else 0)
