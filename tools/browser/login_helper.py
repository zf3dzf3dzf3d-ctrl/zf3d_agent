# -*- coding: utf-8 -*-
"""弹出可见浏览器窗口，由用户手动登录各网站；登录态保存到 browser_data/profile"""
import os, sys, time
BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(BASE))
os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(ROOT, "python", "browsers")

from playwright.sync_api import sync_playwright

PROFILE = os.path.join(BASE, "browser_data", "profile")
os.makedirs(PROFILE, exist_ok=True)

SITES = [
    "https://billing-cost.console.aliyun.com/",
    "https://www.zf3d.com/",  # 朱峰社区
]

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        PROFILE, headless=False,
        viewport={"width": 1366, "height": 900},
        user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"),
        args=["--disable-blink-features=AutomationControlled"],
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    for site in SITES:
        page.goto(site, timeout=30000)
        input(f"\n>>> 请在浏览器窗口中完成登录: {site}\n>>> 登录完成后回到这里按回车继续...")
    print("\n登录态已保存到:", PROFILE)
    print("以后运行『启动浏览器服务.bat』即可带登录态操作网页。窗口保持打开，直接关闭浏览器窗口退出。")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        ctx.close()
