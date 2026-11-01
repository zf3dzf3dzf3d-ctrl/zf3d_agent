# -*- coding: utf-8 -*-
# 一次性：用「后台抓取专用 profile」(private/浏览器数据/profiles/default) 有头打开百炼，
# 让用户登录一次，登录态即持久化到 extract 用的同一份 profile，后台刷新随即生效。
# 脚本轮询等待 metricValue 出现（=登录成功且数据渲染），抓到实时值后打印并退出。用完即删。
import sys, os, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
SRV = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SRV)
PROFILE = os.path.normpath(os.path.join(ROOT, 'private', '浏览器数据', 'profiles', 'default'))
_ptemp = os.path.join(SRV, 'temp', 'pw_tmp'); os.makedirs(_ptemp, exist_ok=True)
os.environ['TEMP'] = _ptemp; os.environ['TMP'] = _ptemp
URL = "https://bailian.console.aliyun.com/cn-beijing/subscription/token-plan/personal"
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    ctx = pw.chromium.launch_persistent_context(
        PROFILE, headless=False,
        args=['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
        ignore_default_args=['--enable-automation'])
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    page.goto(URL, wait_until='domcontentloaded', timeout=60000)
    print('[WAIT] 已用后台抓取专用 profile 打开百炼，请在弹出的窗口中登录...')
    ok_pct = ok_day = None
    deadline = time.time() + 240  # 最多等4分钟
    while time.time() < deadline:
        try:
            m = page.query_selector('[class*=metricValue]')
            if m:
                ok_pct = (m.inner_text() or '').strip()
            # 剩余天数
            di = None
            for it in page.query_selector_all('[class*=infoItem]'):
                if '剩余天数' in (it.inner_text() or ''):
                    v = it.query_selector('[class*=infoValue]')
                    if v: di = (v.inner_text() or '').strip(); break
            if ok_pct and di:
                ok_day = di
                break
        except Exception as e:
            pass
        time.sleep(3)
    print('[RESULT] metricValue =', repr(ok_pct))
    print('[RESULT] 剩余天数 =', repr(ok_day))
    ck = ctx.cookies(URL)
    names = sorted([c['name'] for c in ck])
    print('[COOKIE_COUNT]', len(ck), 'names:', names[:60])
    ctx.close()
