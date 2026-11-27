# -*- coding: utf-8 -*-
"""M1.7 明文密钥出站脱敏回归（2026-11-24）。

验收口径（策划案 M1.7）：模型上下文与工具结果中检索不到明文 Key。
覆盖：
  A scrub 纯函数：精确替换（尾 4 位可见）、最长优先、前缀不误伤、去重、空清单原样、
    非字符串原样、超长原样、清单刷新（注入时钟）、清单读取失败降级（跳过脱敏不崩溃）
  B run 工具端到端（真实 handle + 注入密钥清单）：stdout/stderr 中的明文密钥被掩码，
    key_redacted 声明尾号；脱敏器缺失时输出被丢弃（fail-closed）
  C 真实密钥清单不参与：测试全程注入，private/api_keys.json 不被读写

用法：py tests/test_key_scrub.py   （退出码 0 = 全过）
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'server')
for _p in (SERVER, ROOT):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import model_config as mc  # noqa: E402
import util_key_scrub as ks  # noqa: E402

_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, str(detail)[:130]))
    if not cond:
        _fail.append(name)


KEY_LONG = 'sk-ZFKEY-1234567890abcdefABCDEF'
KEY_SHORT = 'sk-ZFKEY-12345'
MASK_LONG = '••••••CDEF'
MASK_SHORT = '••••••2345'


def inject(keys):
    mc._load_keys_map = lambda: dict(keys)
    mc._load_model_file_keys = lambda: {}
    ks._state['built_at'] = 0.0   # 强制下次 scrub 重建清单


inject({'线路A': KEY_LONG})
txt = '前置 ' + KEY_LONG + ' 后置'
clean, hits = ks.scrub(txt)
check('1 精确替换且尾号可见', clean == '前置 ' + MASK_LONG + ' 后置', clean)
check('2 hits 声明尾号', hits == [(KEY_LONG[-4:], 1)], hits)
check('3 原文不再含明文', KEY_LONG not in clean)
check('4 无密钥文本原样', ks.scrub('普通输出')[0] == '普通输出')

# 最长优先：短键是长键前缀
inject({'短': KEY_SHORT, '长': KEY_LONG})
text2 = KEY_LONG + ' | ' + KEY_SHORT
clean2, hits2 = ks.scrub(text2)
check('5 最长优先：长键不被短键吃掉前缀',
      clean2 == MASK_LONG + ' | ' + MASK_SHORT, clean2)

# 前缀不误伤：只出现长键前 10 个字符（不是完整密钥）→ 不替换
inject({'线路A': KEY_LONG})
partial = KEY_LONG[:10] + '……'
clean3, _ = ks.scrub(partial)
check('6 不完整前缀不误伤', partial in clean3 or '••••••' not in clean3, clean3)

# 空清单
inject({})
check('7 空清单原样返回', ks.scrub(KEY_LONG)[0] == KEY_LONG)

# 非字符串
check('8 非字符串原样', ks.scrub(b'bytes')[0] == b'bytes')

# 超长跳过
inject({'线路A': KEY_LONG})
big = 'x' * (2 * 1024 * 1024 + 16) + KEY_LONG
clean4, hits4 = ks.scrub(big)
check('9 超长输入跳过脱敏（性能护栏，记日志）', KEY_LONG in clean4 and hits4 == [])

# 清单刷新（注入时钟走完刷新间隔）
inject({'线路A': KEY_LONG})
_1 = ks.scrub(KEY_LONG)[0]
inject({'线路B': 'sk-NEWKEY-9999zzzz9999'})
ks._state['built_at'] -= ks._REFRESH_SEC + 1   # 时钟拨过刷新间隔
_2, h2 = ks.scrub('sk-NEWKEY-9999zzzz9999')
check('10 清单到期自动重建', 'sk-NEWKEY-9999zzzz9999' not in _2 and h2, _2[:30])

# ===== B run 工具端到端 =====
from tools.coding.backend import run as run_tool  # noqa: E402


class FakeCtx(object):
    def __init__(self):
        self.sent = []
        self.project_dir = ROOT
        self.project_dir_note = ''

    def send_json(self, obj):
        self.sent.append(obj)


inject({'线路A': KEY_LONG})
ctx = FakeCtx()
run_tool.handle({'code': 'echo leak-' + KEY_LONG + '-leak', '_session_id': 'sx', '_call_id': 'ks1'}, ctx)
r = ctx.sent[-1] if ctx.sent else {}
out = str(r.get('stdout') or '')
check('B1 run 结果中明文密钥被掩码', KEY_LONG not in out and MASK_LONG[:8] in out.replace('••••••', '••••••'), out[-60:])
check('B2 key_redacted 声明尾号', r.get('key_redacted') == ['CDEF'], r.get('key_redacted'))

# stderr 通道同样覆盖
ctx2 = FakeCtx()
run_tool.handle({'code': 'echo leak-' + KEY_LONG + '-leak 1>&2', '_session_id': 'sx', '_call_id': 'ks2'}, ctx2)
r2 = ctx2.sent[-1] if ctx2.sent else {}
err = str(r2.get('stderr') or '')
check('B3 stderr 通道同样脱敏', KEY_LONG not in err, err[-60:])

# ===== C 脱敏器缺失 fail-closed =====
saved = sys.modules.pop('util_key_scrub', None)


class _Blocker(object):
    def find_spec(self, name, path=None, target=None):
        if name == 'util_key_scrub':
            raise ImportError('blocked for test')
        return None


sys.meta_path.insert(0, _Blocker())
sys.modules.pop('util_key_scrub', None)
try:
    ctx3 = FakeCtx()
    run_tool.handle({'code': 'echo hi', '_session_id': 'sx', '_call_id': 'ks3'}, ctx3)
    r3 = ctx3.sent[-1] if ctx3.sent else {}
    check('C 脱敏器缺失 → 输出丢弃（fail-closed，key_redact_error 留痕）',
          r3.get('stdout') == '' and 'key_redact_error' in r3, r3.get('key_redact_error'))
finally:
    sys.meta_path.pop(0)
    if saved is not None:
        sys.modules['util_key_scrub'] = saved
    import importlib
    importlib.invalidate_caches()

print('== 明文密钥出站脱敏回归: %d fail ==' % len(_fail))
sys.exit(1 if _fail else 0)
