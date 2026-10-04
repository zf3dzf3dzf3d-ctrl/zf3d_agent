#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""browser_control - 内置浏览器工具（画布版）【合一改造版】。

★ 与画布「内置浏览器节点」彻底共用同一个浏览器引擎/会话/profile：
  本模块不再自己启动 Playwright，所有动作转调
  server/browser_plugin/engine.py（画布节点用的就是它）。
  → 画布里登录的网站 AI 立即可用；AI 打开的页面画布实时可见。
  会话固定走 engine 的 default 会话（profile:
  server/browser_plugin/data/profiles/default），与画布节点一致。

对外契约保持不变（前端 browser_control.js / 工具描述无需改动）：
- open/goto 打开网页、back 后退、screenshot 截图（返回给画布面板展示）
- click/type/press/fill 页面交互（可用于登录、发帖）
- content 读取页面文本、eval 执行 JS、close 关闭会话
- file 直接读取截图文件（旧 browser_shots 与新 engine shots 均可）
- track_save / track_note 浏览跟踪记录（逻辑保留，正文改由引擎取）

兼容性说明：
- headless 参数不再生效（统一由 browser_plugin/config.json 控制），
  保证 AI 与画布永远看的是同一个浏览器实例。
- 旧独立 profile（server/data/browser_profile）弃用；需要旧登录态时
  把该目录内容拷到 server/browser_plugin/data/profiles/default 即可。
"""
import os
import re
import time
import sys
import base64
import urllib.parse

TOOL_NAME = 'browser_control'

_TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(_TOOLS_DIR)))
_SERVER_DIR = os.path.join(_PROJECT_ROOT, 'server')

# 导入画布浏览器引擎（browser_plugin，与画布节点同一份代码）
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)
from browser_plugin import engine as _engine  # noqa: E402

# 截图可直读的两个基础目录：旧的 browser_shots（历史截图）与引擎 shots
_LEGACY_SHOT_DIR = os.path.join(_SERVER_DIR, 'data', 'browser_shots')
_SHOT_DIRS = [_LEGACY_SHOT_DIR,
              os.path.join(_SERVER_DIR, 'browser_plugin', 'data', 'shots')]

_TRACK_DIR = os.path.join(_SERVER_DIR, 'data', 'browser_track')


def _norm_name(s):
    """会话名归一化：传入会话名则用之（支持挂到对话 slot），否则固定 default。"""
    return (str(s).strip() if s else '') or 'default'


def _d(kwargs, k, default=None):
    v = kwargs.get(k)
    return default if v is None else v


def _shot(session='default', kwargs=None):
    """对当前页面截图，返回统一结果字段（兼容旧前端 b64/path 两种取法）。"""
    r = _engine.dispatch('screenshot', {'session': session})
    out = {'ok': True, 'url': r.get('url'), 'title': r.get('title'),
           'data': r.get('data')}
    dataurl = r.get('data') or ''
    if ',' in dataurl:
        out['b64'] = dataurl.split(',', 1)[1]
    # 引擎截图落盘路径（供 file 动作/前端轮询用）
    try:
        shots = os.path.join(_SERVER_DIR, 'browser_plugin', 'data', 'shots',
                             session)
        if os.path.isdir(shots):
            files = [f for f in os.listdir(shots) if f.endswith('.png')]
            files.sort(key=lambda f: os.path.getmtime(os.path.join(shots, f)))
            if files:
                out['path'] = os.path.join(shots, files[-1]).replace('\\', '/')
    except Exception:
        pass
    return out


def _goto(url, wait_selector=None, session='default'):
    r = _engine.dispatch('goto', {'session': session, 'url': url})
    out = {'ok': True, 'url': r.get('url'), 'title': r.get('title')}
    # 打开页面后顺手截一张，画布面板与 AI 都能立刻看到
    try:
        out.update(_shot(session))
    except Exception:
        pass
    # 阶段2 读取挂钩：命中站点记忆时附带历史摘要（AI 零感知获得上下文）
    try:
        mem = _site_mem_read(_norm_domain(r.get('url') or url))
        if mem:
            out['site_memory'] = '📌 该站有历史记忆（private/记忆/站点/）：\n' + mem
    except Exception:
        pass
    return out


# ---------- 浏览跟踪记录（原逻辑保留，正文改由引擎取） ----------

def _track_file(name):
    os.makedirs(_TRACK_DIR, exist_ok=True)
    return os.path.join(_TRACK_DIR, '%s.md' % name)


def _track_write(name, note, content_r):
    fp = _track_file(name)
    html = (content_r or {}).get('html', '')
    # 去掉标签粗略取正文
    text = re.sub(r'<script[\s\S]*?</script>|<style[\s\S]*?</style>', '', html)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    line = '| %s | %s | %s |\n' % (
        time.strftime('%Y-%m-%d %H:%M:%S'),
        (note or '').replace('|', '\\|')[:200],
        text[:1500])
    head = ''
    if not os.path.isfile(fp):
        head = '# 浏览跟踪记录（会话: %s）\n\n| 时间 | 备注 | 页面正文 |\n|---|---|---|\n' % name
    with open(fp, 'a', encoding='utf-8') as f:
        f.write(head + line)
    return {'ok': True, 'path': fp, 'note': '已记录'}


def _track_note(name, note):
    fp = _track_file(name)
    head = ''
    if not os.path.isfile(fp):
        head = '# 浏览跟踪记录（会话: %s）\n\n| 时间 | 备注 | 页面正文 |\n|---|---|---|\n' % name
    with open(fp, 'a', encoding='utf-8') as f:
        f.write(head + '| %s | %s | （备注） |\n' % (
            time.strftime('%Y-%m-%d %H:%M:%S'),
            (note or '').replace('|', '\\|')[:2000]))
    return {'ok': True, 'path': fp, 'note': '已记录'}


# ---------- 站点知识记忆（private/记忆/站点/<域名>.md，隐私区，git 不跟踪） ----------
# 域名口径与 engine_seg4._domain_of 一致（netloc 原样，不去 www/端口），
# 保证 archive_site 与本文件写入同一份记忆文件，不分裂。

_SITE_MEM_DIR = os.path.join(_PROJECT_ROOT, 'private', '记忆', '站点')


def _norm_domain(url):
    try:
        return urllib.parse.urlparse(url or '').netloc or ''
    except Exception:
        return ''


def _site_mem_file(domain):
    safe = re.sub(r'[\\/:*?"<>|]', '_', domain) or 'unknown'
    return os.path.join(_SITE_MEM_DIR, safe + '.md')


def _site_mem_read(domain, limit=500):
    """读取站点记忆头部摘要（只读，失败静默，不打断浏览）"""
    if not domain:
        return ''
    fp = _site_mem_file(domain)
    if not os.path.isfile(fp):
        return ''
    try:
        with open(fp, encoding='utf-8') as f:
            return f.read(limit)
    except Exception:
        return ''


def _site_mem_append(domain, section, text, url=''):
    if not domain or not str(text or '').strip():
        return
    try:
        os.makedirs(_SITE_MEM_DIR, exist_ok=True)
        fp = _site_mem_file(domain)
        if not os.path.isfile(fp):
            with open(fp, 'w', encoding='utf-8') as f:
                f.write('# 站点记忆：%s\n'
                        '<!-- 密码靠浏览器 profile，此处严禁写密码 -->\n\n' % domain)
        line = '- [%s] %s%s\n' % (
            time.strftime('%Y-%m-%d %H:%M'),
            str(text).replace('\n', ' ')[:300],
            ('（' + url + '）') if url else '')
        with open(fp, 'a', encoding='utf-8') as f:
            f.write('## %s\n%s' % (section, line))
    except Exception:
        pass


def _site_mem_note(session, section, text, url=''):
    """写站点经验，url 为空时取当前页地址"""
    if not url:
        try:
            r = _engine.dispatch('evaluate', {'session': session,
                                              'expr': 'location.href'})
            url = r.get('result') or ''
        except Exception:
            pass
    domain = _norm_domain(url)
    _site_mem_append(domain, section, text, url)
    return {'ok': True, 'domain': domain, 'path': _site_mem_file(domain),
            'note': '站点记忆已更新'}


# ---------- 主入口 ----------

def handle(body, ctx):
    # 【默认跟随工作台】未显式传 session 且 payload 带 _chat_id 时，自动挂到该对话
    # 工作台抽屉的浏览器会话 wb_c_<chat_id>（与 app-workbench-drawer.js 抽屉 slot
    # 的 'wb_c_' + stable 拼接逐字符一致）→ AI 与工作台物理同页，AI 无需感知。
    # 显式 session（如 'default'/画布节点旧用法）优先不覆盖；_chat_id 空回退 default。
    if not str(body.get('session') or '').strip():
        _cid = str(body.get('_chat_id') or '').strip()
        if _cid:
            body['session'] = 'wb_c_' + _cid

    action = (body.get('action') or 'open').strip().lower()
    url = (body.get('url') or '').strip()
    ses = {'session': _norm_name(body.get('session'))}

    # 截图直读：file 动作不进浏览器线程，直接返回文件（兼容新旧截图目录）
    if action == 'file':
        fp = body.get('path') or ''
        real = os.path.realpath(fp)
        bases = [os.path.realpath(b) for b in _SHOT_DIRS if os.path.isdir(b)]
        if not any(real.startswith(b) for b in bases):
            return ctx.send_error('非法路径')
        if not os.path.isfile(real):
            return ctx.send_error('文件不存在')
        with open(real, 'rb') as f:
            return ctx.send_json({'ok': True,
                                  'b64': base64.b64encode(f.read()).decode()})

    try:
        if action in ('open', 'goto'):
            if not url:
                return ctx.send_error('缺少 url')
            data = _goto(url, body.get('wait_selector'), ses['session'])
        elif action == 'back':
            r = _engine.dispatch('back', ses)
            data = {'ok': True, 'url': r.get('url'), 'title': r.get('title')}
            try:
                data.update(_shot(ses['session']))
            except Exception:
                pass
        elif action == 'content':
            r = _engine.dispatch('content', ses)
            data = {'ok': True, 'url': r.get('url'), 'title': r.get('title'),
                    'content': r.get('html', ''),
                    'text': re.sub(r'\s+', ' ', re.sub(
                        r'<script[\s\S]*?</script>|<style[\s\S]*?</style>|<[^>]+>',
                        ' ', r.get('html', ''))).strip()[:20000]}
        elif action == 'screenshot':
            data = _shot(ses['session'])
        elif action == 'click':
            p = {'session': ses['session']}
            if body.get('x') is not None and body.get('y') is not None:
                p['x'], p['y'] = float(body['x']), float(body['y'])
            elif body.get('text'):
                p['text'] = body['text']
            elif body.get('selector'):
                p['selector'] = body['selector']
            else:
                return ctx.send_error('需要 selector / text / x+y')
            r = _engine.dispatch('click', p)
            data = {'ok': True, 'url': r.get('url'), 'how': 'engine'}
            try:
                data.update(_shot(ses['session']))
            except Exception:
                pass
        elif action == 'scroll':
            if body.get('selector'):
                r = _engine.dispatch('evaluate', dict(
                    ses, expr="(function(){var e=document.querySelector(%s);"
                              "if(e)e.scrollIntoView();return true})()" %
                              __import__('json').dumps(body['selector'])))
            elif str(body.get('to')) == 'top':
                r = _engine.dispatch('evaluate', dict(
                    ses, expr="window.scrollTo(0,0),true"))
            elif str(body.get('to')) == 'bottom':
                r = _engine.dispatch('evaluate', dict(
                    ses, expr="window.scrollTo(0,document.body.scrollHeight),true"))
            else:
                r = _engine.dispatch('wheel', dict(
                    ses, deltaY=int(body.get('y') or 0)))
            data = {'ok': True}
        elif action == 'type':
            sel = body.get('selector') or ''
            text = body.get('text') or ''
            if sel:
                _engine.dispatch('fill', dict(ses, selector=sel, value=text))
            else:
                # 无选择器：向当前焦点元素插入文本
                import json as _json
                _engine.dispatch('evaluate', dict(
                    ses, expr="(function(){document.execCommand('insertText',"
                              "false,%s);return true})()" % _json.dumps(text)))
            data = {'ok': True}
        elif action == 'fill':
            if not body.get('selector'):
                return ctx.send_error('需要 selector')
            _engine.dispatch('fill', dict(ses, selector=body['selector'],
                                          value=body.get('text') or ''))
            data = {'ok': True}
        elif action == 'press':
            _engine.dispatch('press', dict(ses,
                                           key=body.get('key') or 'Enter'))
            data = {'ok': True}
        elif action == 'eval':
            expr = (body.get('expression') or body.get('script')
                    or body.get('code') or '')
            if not expr:
                return ctx.send_error('缺少 expression')
            r = _engine.dispatch('evaluate', dict(ses, expr=expr))
            data = {'ok': True, 'result': r.get('result')}
        elif action == 'tabs':
            r = _engine.dispatch('tabs', ses)
            data = {'ok': True, 'tabs': r.get('tabs', []),
                    'active': r.get('active', 0)}
        elif action in ('tab_new', 'newtab'):
            _engine.dispatch('newtab', dict(ses, url=url))
            data = (_goto(url, session=ses['session']) if url else {'ok': True, 'url': 'about:blank'})
        elif action in ('tab_switch', 'switchtab'):
            r = _engine.dispatch('switchtab', dict(
                ses, index=int(body.get('index') or 0)))
            data = {'ok': True, 'url': r.get('url'), 'title': r.get('title')}
            try:
                data.update(_shot(ses['session']))
            except Exception:
                pass
        elif action in ('tab_close', 'closetab'):
            _engine.dispatch('closetab', dict(
                ses, index=int(body.get('index') or 0)))
            data = {'ok': True}
        elif action == 'track_save':
            c = _engine.dispatch('content', ses)
            data = _track_write(_norm_name(body.get('session')), body.get('text') or '', c)
        elif action == 'track_note':
            data = _track_note(_norm_name(body.get('session')), body.get('text') or '')
        elif action == 'site_note':
            # 站点知识记忆：沉淀操作经验/失败教训到 private/记忆/站点/<域名>.md
            text = (body.get('text') or body.get('note') or '').strip()
            if not text:
                return ctx.send_error('缺少 text（要沉淀的经验/教训）')
            data = _site_mem_note(ses['session'],
                                  body.get('section') or '操作经验',
                                  text, body.get('url') or '')
        elif action == 'site_memory':
            # 读取指定/当前站点的知识记忆
            dom = body.get('domain') or _norm_domain(url)
            if not dom:
                try:
                    r = _engine.dispatch('evaluate', dict(
                        ses, expr='location.href'))
                    dom = _norm_domain(r.get('result') or '')
                except Exception:
                    pass
            mem = _site_mem_read(dom, limit=3000)
            data = {'ok': True, 'domain': dom,
                    'memory': mem, 'path': _site_mem_file(dom)}
        elif action == 'close':
            if body.get('all'):
                _engine.close_session(ses['session'])
                data = {'ok': True, 'note': '会话已关闭（登录态保留）'}
            else:
                try:
                    _engine.dispatch('closetab', dict(ses, index=body.get('index')))
                except Exception:
                    pass
                data = {'ok': True}
        else:
            return ctx.send_error(
                '未知 action: %s（支持 open/goto/back/content/screenshot/click/'
                'scroll/type/fill/press/eval/tabs/newtab/switchtab/closetab/'
                'track_save/track_note/close/file）' % action)
        return ctx.send_json(data)
    except Exception as e:
        msg = str(e)
        # 引擎 worker 卡死时的自救提示（与画布节点同款恢复手段）
        if '超时' in msg or 'timeout' in msg.lower():
            try:
                _engine.kill_session(ses['session'])
                msg += '（已自动重建会话，请重试该操作）'
            except Exception:
                pass
        return ctx.send_error('浏览器错误: %s' % msg)
