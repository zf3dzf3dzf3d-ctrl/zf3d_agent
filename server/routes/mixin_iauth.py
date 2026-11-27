# -*- coding: utf-8 -*-
"""Mixin: i授权（iAuth）P1 适配器框架 —— 网页AI代问答。

真源：策划案-i授权 v2.1（private/记忆/策划案-i授权.md）
站点配置：server/config/webai_sites.json（选择器外置，改版优先只改配置）

接口（P1）：
  GET  /api/iauth/sites                    -> 站点清单（来自 webai_sites.json，含 enabled）
  POST /api/iauth/ask  {site, question}    -> 端到端问答：打开站点→注入钩子→发送→捕获答案
安全：
  - 站点名白名单校验，只允许 webai_sites.json 中已登记且 enabled=true 的站点；
  - 写操作（P2 的 operate）尚未开放，本 P1 只做只读问答；
  - 全程走内置浏览器引擎（browser_plugin.engine），登录态复用持久化 profile。
# 捕获方案（灵光站实测结论，见站点记忆 www.lingguang.com）：
#   回复正文渲染在跨域 sandbox iframe，且 SSE 请求由 iframe 内发起，
#   主 frame 的 fetch 钩子拦截不到（已实测 answer_timeout）。
#   改用 Playwright 网络层监听：page.on('response') 对所有 frame（含跨域）可达，
#   在 sess.run 闭包内注册监听器并挂到 sess 自定义缓冲，轮询阶段从缓冲取正文。
"""
import os
import sys
import json
import time
import threading
import re

from util_log import get_logger

log = get_logger('iauth')
_SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)

from browser_plugin import engine  # noqa: E402

_SITES_CFG = os.path.join(_SERVER_DIR, 'config', 'webai_sites.json')
_iauth_lock = threading.Lock()  # 同一时刻只允许一个代问答任务（浏览器会话互斥）


def _load_sites():
    try:
        with open(_SITES_CFG, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        return cfg.get('sites', {})
    except Exception as e:
        log.error('[iauth] 加载 webai_sites.json 失败: %s' % e)
        return {}


# SSE 捕获缓冲（进程级）：{session_name: [chunk, ...]}，由网络层监听器写入
_SSE_BUF = {}
_SSE_BUF_LOCK = threading.Lock()

# 需要读取响应正文的 URL 关键词（来自站点配置 ssePathPattern）


def _extract_answer(sse_chunks, delta_field):
    """从 SSE chunk 列表提取答案正文：找 turn/finalResponse/delta 事件的 delta 字段拼接。"""
    full = ''.join(sse_chunks)
    parts = []
    # SSE data: 行逐条解析，宽松 JSON（事件名在 JSON 内字段 method/event）
    for line in full.split('\n'):
        line = line.strip()
        if not line.startswith('data:'):
            continue
        payload = line[5:].strip()
        if not payload or payload == '[DONE]':
            continue
        try:
            obj = json.loads(payload)
        except Exception:
            continue
        text = None
        # 形态1: {method/event: 'turn/finalResponse/delta', delta: '...'}
        m = obj.get('method') or obj.get('event') or ''
        if 'delta' in str(m).lower():
            text = obj.get(delta_field) or obj.get('delta')
        # 形态2: {delta: {text/content: '...'}} 或 {delta: '...'}
        if text is None and isinstance(obj.get('delta'), (str, dict)):
            d = obj['delta']
            text = d if isinstance(d, str) else (d.get('text') or d.get('content'))
        if isinstance(text, str) and text:
            parts.append(text)
    ans = ''.join(parts)
    # 去 HTML 标签 + 解码常见实体（delta 是 HTML 片段）
    ans = re.sub(r'<script[\s\S]*?</script>', '', ans, flags=re.I)
    ans = re.sub(r'<[^>]+>', '', ans)
    ans = ans.replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&').replace('&quot;', '"').replace('&#39;', "'")
    return ans.strip()


class MixinIauth(object):
    """i授权 P1：网页AI代问答适配器框架。"""

    # ---------- GET /api/iauth/sites ----------
    def _handle_iauth_sites(self):
        sites = _load_sites()
        out = []
        for sid, s in sites.items():
            if sid.startswith('_'):
                continue
            out.append({
                'id': sid, 'name': s.get('name', sid),
                'enabled': bool(s.get('enabled')),
                'entry': s.get('entry'), 'readMode': s.get('readMode'),
                'notes': s.get('notes', '')
            })
        self._send_json({'ok': True, 'sites': out})

    # ---------- POST /api/iauth/ask ----------
    def _handle_iauth_ask(self, body):
        site_id = str(body.get('site') or '').strip()
        question = str(body.get('question') or '').strip()
        if not question:
            self._send_json({'ok': False, 'err': 'question 不能为空'}); return
        sites = _load_sites()
        cfg = sites.get(site_id)
        if not cfg or not cfg.get('enabled'):
            # 白名单外/未启用 → 拒绝（v2.1 反④裁决：默认拒绝，不静默执行）
            self._send_json({'ok': False, 'err': '站点未登记或未启用: %s' % site_id,
                             'need_confirm': False, 'denied': True}); return
        if not getattr(self, '_session_or_default', None):
            pass  # 兼容占位

        timeout_sec = int(cfg.get('answerTimeoutSec', 120))
        if not _iauth_lock.acquire(timeout=5):
            self._send_json({'ok': False, 'err': '已有代问答任务进行中，请稍后'}); return
        try:
            result = self._iauth_run(site_id, cfg, question, timeout_sec)
            self._send_json(result)
        except Exception as e:
            log.info('[POST /api/iauth/ask] 500: %s' % e)
            self._send_json({'ok': False, 'err': str(e)}, 500)
        finally:
            _iauth_lock.release()

    def _iauth_run(self, site_id, cfg, question, timeout_sec):
        t0 = time.time()
        sess = engine.get_session('iauth')  # 独立会话，复用持久化 profile 登录态
        sse_pattern = cfg.get('ssePathPattern', 'stream_chat')

        # 清空本会话 SSE 缓冲
        with _SSE_BUF_LOCK:
            _SSE_BUF['iauth'] = []

        # 全部页面操作必须在 sess.run 闭包内执行（BrowserSession 单 worker 线程模型）。
        # 【超时纪律】闭包内每个 Playwright 调用显式传 timeout，杜绝无界阻塞把
        # 会话 worker 线程卡死（_stuck 后整个会话瘫痪、锁长时间占住）。
        PW_TIMEOUT = 20000  # per-step 20s

        def _do():
            s = sess  # sess.run 以无参调用闭包（见 engine dispatch 的 _do() 同款），session 对象经闭包捕获
            ctx, page0 = s._ensure()
            page = s._pick_page(None)
            # 0. 网络层监听：对所有 frame（含跨域 sandbox iframe）可达。
            #    监听器写进程级缓冲 _SSE_BUF['iauth']（监听器回调在 Playwright
            #    自己的事件线程执行，不能在闭包内持有 sess 内部锁）。
            def _on_response(resp):
                try:
                    if sse_pattern in (resp.url or ''):
                        _SSE_BUF.setdefault('iauth', []).append(resp.text())
                except Exception:
                    pass
            page.on('response', _on_response)
            # 1. 打开/复用站点页面
            try:
                cur = page.url if page else ''
                if not page or cfg.get('urlMatch', site_id) not in cur:
                    page.goto(cfg['entry'], timeout=PW_TIMEOUT)
                    page.wait_for_load_state('domcontentloaded', timeout=PW_TIMEOUT)
                    page = s._pick_page(None)
                # 2. 填入问题并发送
                sel = cfg.get('inputSelector', 'textarea')
                page.fill(sel, question, timeout=PW_TIMEOUT)
                if cfg.get('sendMethod') == 'enter':
                    page.press(sel, 'Enter', timeout=PW_TIMEOUT)
                else:
                    page.click(cfg.get('sendButtonSelector', 'button[type=submit]'),
                               timeout=PW_TIMEOUT)
                return True
            finally:
                # 【监听器泄漏修复】无论成功失败都成对注销，防止多题累积旧监听器
                # 把上一题残留 SSE 混入下一题答案。
                try:
                    page.remove_listener('response', _on_response)
                except Exception:
                    pass

        ok = sess.run(_do)
        # 【结果判定修复】sess.run 返回 dict（永远为真值），旧代码 if not ok
        # 把超时/stuck 结果静默吞掉。必须检查 dict 内部标记。
        if not isinstance(ok, bool):
            if not ok or ok.get('ok') is False:
                reason = (ok or {}).get('error') or 'browser_session_error'
                # 会话卡死/超时 → 立即 kill 重建，防止死会话把下一次任务也拖死
                if (ok or {}).get('timeout') or (ok or {}).get('stuck'):
                    try:
                        engine.kill_session('iauth')
                    except Exception:
                        pass
                return {'ok': False, 'err': 'browser_session_error', 'site': site_id,
                        'detail': reason,
                        'elapsedSec': round(time.time() - t0, 1),
                        'hint': '浏览器会话执行失败（发送阶段），请查看服务器日志'}
        if ok is not True:
            return {'ok': False, 'err': 'browser_session_error', 'site': site_id,
                    'elapsedSec': round(time.time() - t0, 1),
                    'hint': '浏览器会话执行失败（发送阶段），请查看服务器日志'}
        # 3. 轮询捕获答案（双结束信号：答案非空 + 3s 无增量 或 超时）
        interval = cfg.get('pollIntervalMs', 1000) / 1000.0
        delta_field = cfg.get('deltaField', 'delta')
        answer, stable_since, deadline = '', None, time.time() + timeout_sec
        while time.time() < deadline:
            time.sleep(interval)
            with _SSE_BUF_LOCK:
                chunks = list(_SSE_BUF.get('iauth', []))
            ans = _extract_answer(chunks, delta_field)
            if ans and ans == answer:
                if stable_since and time.time() - stable_since >= 3:
                    break  # 3s 无增量 → 结束
            elif ans:
                answer = ans
                stable_since = time.time()
        if not answer:
            return {'ok': False, 'err': 'answer_timeout', 'site': site_id,
                    'elapsedSec': round(time.time() - t0, 1),
                    'hint': '答案超时未捕获，站点可能改版或需重新登录'}
        return {'ok': True, 'site': site_id, 'question': question,
                'answer': answer, 'elapsedSec': round(time.time() - t0, 1)}
