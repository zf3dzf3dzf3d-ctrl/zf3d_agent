# -*- coding: utf-8 -*-
"""C1: 登录态失效自动重登 —— 联动密码库(vault)，检测到登录页时自动填表登录。
流程：
  1. _detect_login_page 判断当前页是否疑似登录页（engine_seg2 已有）
  2. vault.get_item(domain) 取账号密码
  3. 通用选择器探测用户名/密码输入框与提交按钮，填表提交
  4. 提交后复检：若仍在登录页则失败；否则 success 并提示 credentials_save 保存新登录态
"""
import os
_USER_SELECTORS = [
    'input[type="email"]', 'input[name="username"]', 'input[name="user"]',
    'input[name="email"]', 'input[name="account"]', 'input[name="login"]',
    'input[id="username"]', 'input[id="email"]', 'input[placeholder*="用户名"]',
    'input[placeholder*="账号"]', 'input[placeholder*="邮箱"]',
]
_PWD_SELECTORS = ['input[type="password"]']
_BTN_SELECTORS = [
    'button[type="submit"]', 'input[type="submit"]',
    'button:has-text("登录")', 'button:has-text("登 录")', 'button:has-text("Log in")',
    'button:has-text("Sign in")', 'input[value="登录"]',
]


def _first_visible(page, selectors, timeout=1200):
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if el.is_visible(timeout=timeout):
                return el
        except Exception:
            continue
    return None


def auto_relogin(page, domain, username=None, config=None):
    """在 page 上对 domain 做自动重登。domain 同时作为 vault 的 site 键。"""
    try:
        import vault
    except Exception as e:
        return {'ok': False, 'error': '密码库模块不可用: %s' % e}
    r = vault.get_item(domain, username)
    if not r.get('ok'):
        # 宽松匹配：域名含站点关键字
        try:
            items = vault.list_items()
            for it in items.get('items', []):
                key = (it.get('site') or '').lower()
                if key and (key in domain or domain in key or
                            domain.split('.')[-2] in key if domain.count('.') >= 1 else False):
                    r = vault.get_item(it.get('site'), it.get('username'))
                    if r.get('ok'):
                        break
        except Exception:
            pass
        if not r.get('ok'):
            return {'ok': False, 'error': '密码库中没有 %s 的账号（先在密码库保存该站账号）' % domain}
    user, pwd = r['username'], r['password']
    try:
        ue = _first_visible(page, _USER_SELECTORS)
        pe = _first_visible(page, _PWD_SELECTORS)
        if not ue or not pe:
            return {'ok': False, 'error': '页面上未找到登录表单（用户名框%s 密码框%s）'
                                            % ('√' if ue else '×', '√' if pe else '×')}
        ue.fill(user)
        pe.fill(pwd)
        btn = _first_visible(page, _BTN_SELECTORS)
        if btn:
            btn.click()
        else:
            pe.press('Enter')
        page.wait_for_load_state('networkidle', timeout=15000)
    except Exception as e:
        return {'ok': False, 'error': '填表登录异常: %s' % e}
    # 复检
    from browser_plugin.engine_seg2 import _detect_login_page
    still = _detect_login_page(page)
    if still.get('login_required'):
        return {'ok': False, 'error': '登录后仍疑似在登录页（账号密码可能不对或需验证码）'}
    return {'ok': True, 'site': domain, 'username': user,
            'hint': '自动重登成功！建议立即 credentials_save 保存新登录态，下次失效可直接恢复。'}
