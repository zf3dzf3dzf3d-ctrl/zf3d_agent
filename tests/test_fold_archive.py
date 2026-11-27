# -*- coding: utf-8 -*-
"""agent_loop 上下文折叠+归档检索闭环回归（工程基建总纲 P2.1 核心资产安全网 20261123）。

钉死"折叠不丢事实"契约（agent_loop._fold_history + search_archive）：
  1) 超阈值触发折叠，输出短于输入且含 '[上下文折叠]' 摘要；
  2) 被折叠原文完整落盘 tool_result_archive（L2）；
  3) search_archive 按关键词能把落盘事实捞回（闭环）；
  4) 末 2 轮（_PROTECT=6）永不折叠；
  5) L1 头部片段保留在摘要里。

测试用 ZF_CTX_WINDOW_CHARS/ZF_FOLD_THRESHOLD 环境变量把阈值压小，
ARCHIVE_DIR 指向临时目录，绝不触碰真实归档。
"""
import glob
import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server'))

import engines.common.agent_loop as al      # noqa: E402
import engines.common.search_archive as sa  # noqa: E402

_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, detail))
    if not cond:
        _fail.append(name)


tmp = tempfile.mkdtemp(prefix='zf_fold_')
ad = os.path.join(tmp, 'archive')
os.makedirs(ad)
sa.ARCHIVE_DIR = ad   # 折叠落盘与检索共用此模块属性（_fold_history 按名回读）

env_keys = ('ZF_CTX_WINDOW_CHARS', 'ZF_FOLD_THRESHOLD', 'ZF_FOLD_HISTORY')
env_save = {k: os.environ.get(k) for k in env_keys}
os.environ['ZF_CTX_WINDOW_CHARS'] = '1200'
os.environ['ZF_FOLD_THRESHOLD'] = '0.5'   # 阈值 = 600 字符
os.environ['ZF_FOLD_HISTORY'] = '1'
try:
    KEY = 'ZFTEST-MARKER-7X7'
    msgs = [{'role': 'system', 'content': 'you are tester'}]
    for i in range(20):
        msgs.append({'role': 'user', 'content': '问题%d' % i})
        msgs.append({'role': 'assistant', 'content': '',
                     'tool_calls': [{'id': 'c%d' % i,
                                     'function': {'name': 'web_search', 'arguments': '{}'}}]})
        body = '背景资料%d：' % i
        if i == 3:
            body += KEY * 2          # 唯一标记埋在被折叠区
        body += 'x' * 80
        msgs.append({'role': 'tool', 'tool_call_id': 'c%d' % i, 'content': body})

    out = al._fold_history(msgs)
    check('触发折叠(变短)', len(out) < len(msgs),
          '%d -> %d' % (len(msgs), len(out)))
    summary = [m for m in out if m.get('role') == 'user'
               and '[上下文折叠]' in str(m.get('content'))]
    check('含折叠摘要', bool(summary))
    if summary:
        check('L1 头部片段保留', '背景资料' in str(summary[0].get('content')))

    files = glob.glob(os.path.join(ad, '*.json'))
    check('归档落盘', bool(files), '%d 个文件' % len(files))
    if files:
        with open(files[0], encoding='utf-8') as f:
            arc = json.load(f)
        check('归档含完整原文', KEY in json.dumps(arc, ensure_ascii=False))

    hits = sa.search_archive(KEY)
    check('search_archive 捞回', bool(hits) and KEY in json.dumps(hits, ensure_ascii=False),
          '%d hits' % len(hits or []))

    check('末2轮保护(背景资料19仍在)', any(
        m.get('role') == 'tool' and '背景资料19' in str(m.get('content')) for m in out))
finally:
    for k in env_keys:
        if env_save[k] is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = env_save[k]
    shutil.rmtree(tmp, ignore_errors=True)


print('== 折叠归档闭环回归: %d fail ==' % len(_fail))


def test_fold_archive():
    """pytest 入口（快速优化冲刺 A4 20261123）：模块导入时已完整执行折叠归档回归。"""
    assert not _fail, '折叠归档回归失败: ' + ', '.join(_fail)


if __name__ == '__main__':
    sys.exit(1 if _fail else 0)
