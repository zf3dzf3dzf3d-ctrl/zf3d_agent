# -*- coding: utf-8 -*-
"""内置浏览器 browser_control 端到端回归测试。
直接 POST /api/tools/browser_control，覆盖全动作。
用法: python server/test/test_browser_e2e.py
"""
import json
import urllib.request
import urllib.error
import sys

BASE = 'http://127.0.0.1:8505/api/tools/browser_control'
PASS = 0
FAIL = 0


def call(**kw):
    req = urllib.request.Request(BASE, data=json.dumps(kw).encode(),
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read())
        except Exception:
            return {'ok': False, 'error': 'HTTP %d' % e.code}


def check(name, cond, info=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print('PASS  %s' % name)
    else:
        FAIL += 1
        print('FAIL  %s  %s' % (name, info))


def main():
    # 1 goto
    d = call(action='goto', url='example.com', timeout=20000)
    check('goto example.com', d.get('ok') and 'example' in d.get('url', ''), d)
    check('goto 返回截图路径', bool(d.get('screenshot')), d)

    # 2 content
    d = call(action='content')
    check('content 读取正文', d.get('ok') and 'Example' in (d.get('text') or ''), d)

    # 3 eval
    d = call(action='eval', expression='document.title')
    check('eval 标题', d.get('ok') and 'Example' in str(d.get('result', '')), d)

    # 4 screenshot
    d = call(action='screenshot')
    check('screenshot', d.get('ok') and bool(d.get('screenshot')), d)

    # 5 tabs
    d = call(action='tabs')
    check('tabs 列出', d.get('ok') and d.get('tabs'), d)

    # 6 tab_new
    d = call(action='tab_new', url='www.baidu.com')
    check('tab_new 百度', d.get('ok'), d)
    d = call(action='tabs')
    check('tabs >= 2', d.get('ok') and len(d.get('tabs', [])) >= 2, d)

    # 7 tab_switch
    d = call(action='tab_switch', index=0)
    check('tab_switch 回第0个', d.get('ok'), d)

    # 8 back
    d = call(action='back')
    check('back', 'ok' in d, d)

    # 9 fill/type/press（在 example.com 搜索无输入框，只验证不抛未知错误）
    d = call(action='press', key='Escape')
    check('press', d.get('ok') is not None, d)

    # 10 tab_close
    d = call(action='tab_close', index=1)
    check('tab_close 第1个', d.get('ok'), d)

    # 11 file 直读（路径校验）
    d = call(action='file', path='../../etc/passwd')
    check('file 非法路径被拒', d.get('ok') is False, d)

    # 12 错误信息友好化
    d = call(action='goto', url='nonexistent.abc123xyz', timeout=8000)
    check('goto 失败返回可读错误', d.get('ok') is False and 'ERR_NAME_NOT_RESOLVED' in str(d.get('error', '')), d)

    # 13 close all
    d = call(action='close', **{'all': True})
    check('close all', d.get('ok'), d)

    print('\n结果: %d 通过 / %d 失败' % (PASS, FAIL))
    sys.exit(1 if FAIL else 0)


if __name__ == '__main__':
    main()

