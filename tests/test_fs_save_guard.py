# -*- coding: utf-8 -*-
"""fs/text-save 写路由安全防护回归（工程基建总纲 Phase 3.2 20261123）。

钉死攻击链闭环：同源注入页面曾经 POST /api/fs/text-save 改写
private/api_keys.json（真 key 换攻击者中转 key = 劫持后续全部对话外流）。
修复 = 写路由补敏感目录黑名单（与读路由 _handle_fs_text 同款）。

  1) private/api_keys.json -> 403 敏感目录禁止写入
  2) private/记忆/*.md      -> 403
  3) 正常项目内新路径        -> 通过安全闸（落到 404 父目录不存在，证明零写入）
  4) ../ 越出项目根          -> 403（存量根白名单回归保护）

handler 依赖以最小桩注入（headers/_cached_body/_send_error），全程零真实写盘。
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server'))

from routes.project_fs_text import _handle_fs_text_save  # noqa: E402

_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, detail))
    if not cond:
        _fail.append(name)


class _Headers:
    def __init__(self, n):
        self._n = n

    def get(self, k, d=None):
        return str(self._n) if k == 'Content-Length' else d


class FakeSelf:
    def __init__(self, body):
        self._body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.err = None

    @property
    def headers(self):
        return _Headers(len(self._body))

    def _cached_body(self, n):
        return self._body[:n]

    def _send_error(self, msg, code):
        self.err = (msg, code)


def attempt(path):
    fs = FakeSelf({'path': path, 'text': 'ZF-GUARD-PROBE'})
    _handle_fs_text_save(fs)
    return fs.err


err = attempt('private/api_keys.json')
check('private/api_keys.json 禁写', bool(err) and err[1] == 403
      and '敏感目录' in err[0], str(err))

err = attempt('private/记忆/篡改.md')
check('private/记忆 禁写', bool(err) and err[1] == 403, str(err))

err = attempt('docs/__不存在的目录zzz__/probe.md')
check('正常路径过闸到存在性检查(零写入)', bool(err) and err[1] == 404
      and '父目录' in err[0], str(err))

err = attempt('../../__越界__probe.txt')
check('../ 越出项目根禁写(存量防线)', bool(err) and err[1] == 403
      and '项目根' in err[0], str(err))

print('== fs/text-save 写防护回归: %d fail ==' % len(_fail))
sys.exit(1 if _fail else 0)
