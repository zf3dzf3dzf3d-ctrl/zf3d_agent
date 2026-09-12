"""
快速浮窗 - 工具函数模块（从 quick_wheel.py 拆出）

包含：颜色混合工具（纯函数）、截屏工具。
零依赖（PIL 为可选延迟导入），供 quick_wheel.py 引用。
"""
import io
import base64


# ---------- 截屏 ----------

def _截图base64():
    """全屏截图并返回 PNG base64 字符串"""
    from PIL import ImageGrab
    img = ImageGrab.grab()
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


# ---------- 颜色工具 ----------

def _hex到rgb(颜色):
    return int(颜色[1:3], 16), int(颜色[3:5], 16), int(颜色[5:7], 16)


def _rgb到hex(r, g, b):
    return f"#{min(255, max(0, r)):02x}{min(255, max(0, g)):02x}{min(255, max(0, b)):02x}"


def _混色(c1, c2, t):
    """线性混合两个颜色，t=0→c1, t=1→c2"""
    r1, g1, b1 = _hex到rgb(c1)
    r2, g2, b2 = _hex到rgb(c2)
    return _rgb到hex(int(r1 + (r2 - r1) * t), int(g1 + (g2 - g1) * t), int(b1 + (b2 - b1) * t))
