# -*- coding: utf-8 -*-
"""打开知乎（持久化登录态），截图验证是否已登录。
用法:
  python tools/browser_login.py open   -> 打开知乎并截图（有头浏览器，可手动登录）
  python tools/browser_login.py check  -> 无头检查当前登录态并截图
"""
import sys, os
from playwright.sync_api import sync_playwright

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILE = os.path.join(BASE, "private", "browser_profile")
SHOT = os.path.join(BASE, "private", "zhihu_check.png")

def find_chrome():
    import glob
    pats = [
        r"C:\Users\Administrator\AppData\Local\ms-playwright\chromium-*\chrome-win\chrome.exe",
        r"C:\Users\Administrator\AppData\Local\ms-playwright\chromium-*\chrome-win64\chrome.exe",
    ]
    for pat in pats:
        hits = sorted(glob.glob(pat), reverse=True)
        if hits:
            return hits[0]
    return None

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "check"
    os.makedirs(PROFILE, exist_ok=True)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            PROFILE,
            headless=(mode == "check"),
            executable_path=find_chrome(),
            viewport={"width": 1366, "height": 800},
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.zhihu.com/", timeout=60000)
        page.wait_for_timeout(4000)
        page.screenshot(path=SHOT)
        logged_in = page.locator('button:has-text("登录")').count() == 0
        # 更可靠的判断：右上角出现用户头像（img.ProfileHeader 头像或 [data-za-detail-view-element_name]）
        try:
            name = page.locator(".AppHeader-user img").first.get_attribute("alt", timeout=3000)
        except Exception:
            name = None
        print(f"登录态: {'已登录 ' + name if name else ('未登录(可能未登录)' if logged_in else '页面显示登录按钮 -> 未登录')}")
        print(f"截图: {SHOT}")
        if mode != "check":
            input("浏览器已打开，如需登录请在窗口中手动操作，完成后回车关闭...")
        ctx.close()

if __name__ == "__main__":
    main()
