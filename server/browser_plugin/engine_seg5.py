# -*- coding: utf-8 -*-
"""
engine_seg5 —— 验证码/滑块能力增强（只增不删）：
  1) ocr 动作：ddddocr 识图验证码（selector 元素截图或 path 文件）；滑块缺口偏移（bg+target 双图 slide_match）
  2) shot_element：元素级截图（selector/ref/frame），可带 ocr=True 直接返回识别文本
  3) drag：Playwright 原生 mouse 真实拖拽（加速-过冲-回拉轨迹，trusted 事件）
  4) solve_captcha：组合动作（滑块/文字码自动识别处理）
所有 selector 类动作统一支持 frame 参数穿透 iframe。
"""
import os
import time
import random

_OCR = None
_OCR_ERR = ''


def _get_ocr():
    """ddddocr 懒加载单例；失败时抛出带原因的异常。"""
    global _OCR, _OCR_ERR
    if _OCR is None:
        try:
            import ddddocr
            _OCR = ddddocr.DdddOcr(show_ad=False)
        except Exception as e:
            _OCR_ERR = str(e)
            raise RuntimeError('ddddocr 不可用: %s（可降级用 screenshot+AI 看图识别）' % _OCR_ERR)
    return _OCR


def _tgt(page, params):
    """统一取操作目标：frame 参数存在时返回 frame_locator（.locator() 兼容），否则 page。"""
    fr = params.get('frame')
    if fr:
        return page.frame_locator(fr)
    return page


def _loc(t, params):
    """根据 ref/selector 在目标（page 或 frame_locator）上取 locator。"""
    ref = params.get('ref') or ''
    sel = params.get('selector') or ''
    if ref:
        return t.locator('[data-zfref="%s"]' % ref).first
    if sel:
        return t.locator(sel).first
    return None


def _elem_png_b64(el):
    """元素截图 → (b64, path)"""
    p = os.path.join(os.environ.get('TEMP', '.'), 'zf_shot_%d.png' % int(time.time() * 1000))
    el.screenshot(path=p, timeout=15000)
    with open(p, 'rb') as f:
        import base64
        return base64.b64encode(f.read()).decode('ascii'), p


@register('ocr')
def _act_ocr(engine, params):
    """识图验证码：selector/ref（页面内元素）或 path（本地图片）。
    滑块：bg=背景图selector + target=滑块图selector → 返回缺口 x 偏移 offset。"""
    s = engine

    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        t = _tgt(page, params)
        bg = params.get('bg')
        tg = params.get('target')
        ocr = _get_ocr()
        # 滑块缺口模式：两张图 slide_match
        if bg and tg:
            b1, _ = _elem_png_b64(_loc(t, {'selector': bg}))
            b2, _ = _elem_png_b64(_loc(t, {'selector': tg}))
            import base64 as _b
            r = ocr.slide_match(_b.b64decode(b2), _b.b64decode(b1), simple_target=True)
            off = int(r['target'][0])
            return {'ok': True, 'mode': 'slide', 'offset_x': off, 'detail': r.get('target')}
        # 文字码模式
        el = _loc(t, params)
        if el is not None:
            b64, _p = _elem_png_b64(el)
        elif params.get('path'):
            with open(params['path'], 'rb') as f:
                raw = f.read()
            import base64 as _b
            b64 = _b.b64encode(raw).decode('ascii')
        else:
            return {'ok': False, 'error': '需要 selector/ref（验证码元素）或 path（图片文件）'}
        import base64 as _b
        text = ocr.classification(_b.b64decode(b64))
        return {'ok': True, 'mode': 'text', 'text': text}
    return _act_run(s, params, _do)


@register('shot_element')
def _act_shot_element(engine, params):
    """元素级截图：只截验证码等小元素，体积小识别准；ocr=True 时顺带返回识别文本。"""
    s = engine

    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        t = _tgt(page, params)
        el = _loc(t, params)
        if el is None:
            return {'ok': False, 'error': '需要 ref 或 selector'}
        try:
            el.wait_for(state='visible', timeout=8000)
        except Exception:
            pass
        b64, p = _elem_png_b64(el)
        r = {'ok': True, 'data': b64, 'path': p, 'url': page.url, 'ts': int(time.time())}
        if params.get('ocr'):
            try:
                import base64 as _b
                r['text'] = _get_ocr().classification(_b.b64decode(b64))
            except Exception as e:
                r['ocr_error'] = str(e)
        return r
    return _act_run(s, params, _do)


@register('drag')
def _act_drag(engine, params):
    """真实鼠标拖拽（trusted 事件）：selector/ref 定位滑块，distance=水平拖动像素，
    或 target_selector/target_x 指定终点；轨迹带缓动+2~6px 过冲回拉，模拟人手。"""
    s = engine

    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        t = _tgt(page, params)
        el = _loc(t, params)
        if el is None:
            return {'ok': False, 'error': '需要 ref 或 selector 定位拖拽起点'}
        try:
            el.wait_for(state='visible', timeout=8000)
        except Exception:
            pass
        box = el.bounding_box()
        if not box:
            return {'ok': False, 'error': '目标不可见或无 bounding_box'}
        sx = box['x'] + box['width'] / 2
        sy = box['y'] + box['height'] / 2
        # 终点计算
        if params.get('target_selector'):
            tb = t.locator(params['target_selector']).first.bounding_box()
            dx = tb['x'] + tb['width'] / 2 - sx
        elif params.get('target_x') is not None:
            dx = float(params['target_x']) - sx
        else:
            dx = float(params.get('distance') or 0)
        if not dx:
            return {'ok': False, 'error': '需要 distance 或 target_selector/target_x'}
        m = page.mouse
        m.move(sx, sy)
        m.down()
        # 缓动轨迹：先快后慢 + 抖动 + 过冲回拉
        total = int(abs(dx))
        direction = 1 if dx > 0 else -1
        steps = max(12, min(45, total // 6 or 12))
        moved = 0.0
        overshoot = min(6.0, max(2.0, total * 0.02))
        for i in range(1, steps + 1):
            # ease-out：前段快后段慢
            ratio = 1 - (1 - i / steps) ** 2
            jitter = random.uniform(-1.5, 1.5)
            moved = dx * ratio + jitter
            m.move(sx + moved, sy + random.uniform(-1.2, 1.2))
            page.wait_for_timeout(random.randint(8, 24))
        # 过冲再回拉
        m.move(sx + moved + direction * overshoot, sy)
        page.wait_for_timeout(random.randint(40, 90))
        m.move(sx + dx, sy)
        page.wait_for_timeout(random.randint(60, 140))
        m.up()
        return {'ok': True, 'from_x': sx, 'moved': dx, 'url': page.url}
    return _act_run(s, params, _do)


@register('solve_captcha')
def _act_solve_captcha(engine, params):
    """组合动作：
    mode=slide（默认）：bg=背景图selector, target=滑块图selector, handle=滑块手柄selector
      → ddddocr slide_match 算缺口 → drag 真实拖过
    mode=text：img=验证码图selector, input=输入框selector, submit=提交按钮selector(可选)
      → 识别 → 填入 →（可选提交）
    """
    s = engine

    def _do():
        ctx, page = s._ensure()
        page = s._pick_page(params.get('index'))
        t = _tgt(page, params)
        mode = params.get('mode') or 'slide'
        if mode == 'slide':
            bg, tg = params.get('bg'), params.get('target')
            handle = params.get('handle')
            if not (bg and tg and handle):
                return {'ok': False, 'error': '滑块模式需要 bg/target/handle 三个 selector'}
            r = _act_ocr(engine, dict(params, bg=bg, target=tg))
            if not r.get('ok'):
                return r
            off = r['offset_x']
            d = _act_drag(engine, {'distance': off, 'selector': handle, 'frame': params.get('frame')})
            d['offset_x'] = off
            return d
        elif mode == 'text':
            img = params.get('img')
            inp = params.get('input')
            if not (img and inp):
                return {'ok': False, 'error': '文字码模式需要 img/input 两个 selector'}
            el = _loc(t, {'selector': img})
            b64, _p = _elem_png_b64(el)
            import base64 as _b
            text = _get_ocr().classification(_b.b64decode(b64))
            t.locator(inp).first.fill(text)
            r = {'ok': True, 'mode': 'text', 'text': text}
            if params.get('submit'):
                t.locator(params['submit']).first.click(timeout=8000)
                page.wait_for_load_state('domcontentloaded', timeout=15000)
                r['url'] = page.url
            return r
        return {'ok': False, 'error': '未知 mode: %s' % mode}
    return _act_run(s, params, _do)
