"""浏览器引擎 — Playwright封装，提供底层浏览器操作能力

职责：
1. 管理浏览器实例生命周期（启动/关闭）
2. 页面操作原语（打开页面/点击/填写/滚动/截图）
3. 无障碍树提取（核心：让AI用最少token理解页面）
4. 正文提取（去掉导航/广告/侧边栏，只保留主要内容）
5. 会话持久化（Cookie/localStorage保存加载）

设计原则：
- 无障碍树优先，不截图（省token、快）
- role+name定位元素（比CSS选择器稳定）
- 惰性初始化（首次调用工具时才启动浏览器）
- 全局单例（多工具共享一个浏览器实例）
"""
import os
import json
import time
import threading
from pathlib import Path


class 浏览器引擎类:
    """Playwright浏览器引擎封装"""

    def __init__(self, 配置: dict):
        self._配置 = 配置
        self._playwright = None
        self._浏览器 = None
        self._上下文 = None
        self._页面 = None
        self._已启动 = False
        self._锁 = threading.Lock()

    @property
    def 已启动(self) -> bool:
        return self._已启动

    def 启动(self):
        """启动浏览器（持久化上下文，自动保存cookie）"""
        if self._已启动:
            return
        from playwright.sync_api import sync_playwright

        启动设置 = self._配置.get("启动设置", {})
        页面设置 = self._配置.get("页面设置", {})
        会话设置 = self._配置.get("会话设置", {})

        用户数据目录 = 会话设置.get("会话目录", "隐私区/浏览器会话")
        项目根 = Path(__file__).parent.parent.parent.parent
        绝对目录 = str(项目根 / 用户数据目录)
        os.makedirs(绝对目录, exist_ok=True)

        self._playwright = sync_playwright().start()

        launch_opts = {
            "headless": 启动设置.get("无头模式", False),
            "viewport": {
                "width": 页面设置.get("视口宽度", 1280),
                "height": 页面设置.get("视口高度", 720),
            },
            "user_agent": 页面设置.get("用户代理", ""),
            "locale": 页面设置.get("语言", "zh-CN"),
            "timezone_id": 页面设置.get("时区", "Asia/Shanghai"),
            "user_data_dir": 绝对目录,
        }

        # 优先使用系统Edge（零下载），否则用Chromium
        浏览器类型 = 启动设置.get("浏览器类型", "msedge")
        if 浏览器类型 == "msedge":
            launch_opts["channel"] = "msedge"
        self._上下文 = self._playwright.chromium.launch_persistent_context(**launch_opts)
        if self._上下文.pages:
            self._页面 = self._上下文.pages[0]
        else:
            self._页面 = self._上下文.new_page()

        超时 = self._配置.get("行为设置", {}).get("默认超时秒", 15)
        self._页面.set_default_timeout(超时 * 1000)
        self._已启动 = True

    def 关闭(self):
        """关闭浏览器，保存会话"""
        if self._上下文:
            try:
                self._上下文.close()
            except Exception:
                pass
        if self._playwright:
            try:
                self._playwright.stop()
            except Exception:
                pass
        self._已启动 = False
        self._页面 = None
        self._上下文 = None
        self._浏览器 = None
        self._playwright = None

    def 打开页面(self, 网址: str) -> dict:
        """打开URL，返回页面标题+URL+状态"""
        if not self._已启动:
            self.启动()
        self._页面.goto(网址, wait_until="domcontentloaded")
        标题 = self._页面.title()
        return {"标题": 标题, "URL": self._页面.url}

    def 提取无障碍树(self) -> dict:
        """提取页面的无障碍树（精简版）

        返回嵌套字典：{角色, 名称, 值, 子节点}
        已过滤无关角色、截断长文本、限制深度和节点数
        """
        if not self._页面:
            return {}

        树设置 = self._配置.get("无障碍树设置", {})
        最大深度 = 树设置.get("最大深度", 10)
        最大节点数 = 树设置.get("最大节点数", 200)
        忽略角色 = set(树设置.get("忽略角色", []))
        截断长度 = 树设置.get("文本截断长度", 200)
        忽略空节点 = 树设置.get("忽略空节点", True)

        原始树 = self._页面.accessibility.snapshot()

        节点计数 = [0]

        def 精简(节点, 深度):
            if 深度 > 最大深度:
                return None
            if 节点计数[0] >= 最大节点数:
                return None

            角色 = 节点.get("role", "")
            if 角色 in 忽略角色:
                return None

            名称 = (节点.get("name") or "").strip()
            值 = (节点.get("value") or "").strip() if isinstance(节点.get("value"), str) else ""

            if 忽略空节点 and not 名称 and not 值 and not 节点.get("children"):
                return None

            if len(名称) > 截断长度:
                名称 = 名称[:截断长度] + "..."

            结果 = {"角色": 角色}
            if 名称:
                结果["名称"] = 名称
            if 值:
                结果["值"] = 值

            子节点列表 = []
            for 子 in (节点.get("children") or []):
                精简后 = 精简(子, 深度 + 1)
                if 精简后:
                    节点计数[0] += 1
                    子节点列表.append(精简后)

            if 子节点列表:
                结果["子节点"] = 子节点列表

            return 结果

        return 精简(原始树, 0) or {}

    def 提取正文(self) -> str:
        """提取页面主要文本内容

        策略：优先找main/article标签，否则找文本密度最大的区域
        去掉script/style/nav/footer/aside
        """
        if not self._页面:
            return ""

        脚本 = """
        () => {
            // 移除不需要的元素
            const remove = ['script', 'style', 'nav', 'footer', 'aside', 'noscript', 'iframe'];
            const clone = document.body.cloneNode(true);
            for (const tag of remove) {
                clone.querySelectorAll(tag).forEach(e => e.remove());
            }

            // 优先找main/article
            let main = clone.querySelector('main, article, [role="main"]');
            if (main) {
                return main.innerText;
            }

            // 找文本密度最大的div
            let best = null, bestLen = 0;
            clone.querySelectorAll('div, section').forEach(div => {
                const text = div.innerText || '';
                if (text.length > bestLen) {
                    bestLen = text.length;
                    best = text;
                }
            });

            return best || clone.innerText || '';
        }
        """
        文本 = self._页面.evaluate(脚本)
        if 文本:
            文本 = "\n".join(line.strip() for line in 文本.splitlines() if line.strip())
        return 文本[:10000]

    def 提取元素列表(self, 元素类型: str) -> list:
        """提取特定类型元素

        元素类型: 链接/图片/表单/表格/按钮/输入框
        返回: [{角色, 名称, 值, 属性}]
        """
        if not self._页面:
            return []

        类型映射 = {
            "链接": 'a[href]',
            "图片": 'img',
            "按钮": 'button, [role="button"], input[type="button"], input[type="submit"]',
            "输入框": 'input, textarea, select, [role="textbox"]',
            "表格": 'table',
            "表单": 'form',
        }
        选择器 = 类型映射.get(元素类型, "")
        if not 选择器:
            return []

        元素列表 = self._页面.query_selector_all(选择器)
        结果 = []
        for el in 元素列表[:100]:
            项 = {}
            名称 = el.inner_text().strip() if 元素类型 != "图片" else ""
            if 名称:
                项["名称"] = 名称[:200]
            href = el.get_attribute("href")
            if href:
                项["链接"] = href
            src = el.get_attribute("src")
            if src:
                项["源地址"] = src
            alt = el.get_attribute("alt")
            if alt:
                项["描述"] = alt
            placeholder = el.get_attribute("placeholder")
            if placeholder:
                项["提示"] = placeholder
            value = el.get_attribute("value")
            if value:
                项["值"] = value[:200]
            if 项:
                项["标签"] = el.evaluate("e => e.tagName.toLowerCase()")
                结果.append(项)
        return 结果

    def 点击元素(self, 角色: str, 名称: str) -> bool:
        """通过role+name定位并点击元素"""
        if not self._页面:
            return False
        try:
            self._页面.get_by_role(角色, name=名称).click()
            return True
        except Exception:
            try:
                self._页面.get_by_text(名称).click()
                return True
            except Exception:
                return False

    def 填写表单(self, 角色: str, 名称: str, 值: str) -> bool:
        """通过role+name定位输入框并填写"""
        if not self._页面:
            return False
        try:
            self._页面.get_by_role(角色, name=名称).fill(值)
            return True
        except Exception:
            try:
                self._页面.get_by_placeholder(名称).fill(值)
                return True
            except Exception:
                try:
                    self._页面.get_by_label(名称).fill(值)
                    return True
                except Exception:
                    return False

    def 滚动页面(self, 方向: str, 像素: int = 500) -> int:
        """滚动页面，返回当前滚动位置"""
        if not self._页面:
            return 0
        if 方向 == "下":
            self._页面.evaluate(f"window.scrollBy(0, {像素})")
        elif 方向 == "上":
            self._页面.evaluate(f"window.scrollBy(0, -{像素})")
        elif 方向 == "右":
            self._页面.evaluate(f"window.scrollBy({像素}, 0)")
        elif 方向 == "左":
            self._页面.evaluate(f"window.scrollBy(-{像素}, 0)")
        return self._页面.evaluate("window.scrollY")

    def 返回上一页(self) -> dict:
        """浏览器后退"""
        if not self._页面:
            return {}
        self._页面.go_back(wait_until="domcontentloaded")
        return {"标题": self._页面.title(), "URL": self._页面.url}

    def 截图(self, 保存路径: str = None) -> str:
        """截图，返回base64或保存到文件"""
        if not self._页面:
            return ""
        if 保存路径:
            self._页面.screenshot(path=保存路径)
            return f"已保存到: {保存路径}"
        else:
            数据 = self._页面.screenshot()
            import base64
            return base64.b64encode(数据).decode("utf-8")

    def 执行JS(self, 脚本: str):
        """执行JavaScript"""
        if not self._页面:
            return None
        return self._页面.evaluate(脚本)

    def 获取页面信息(self) -> dict:
        """返回当前页面标题、URL、加载状态"""
        if not self._页面:
            return {}
        return {
            "标题": self._页面.title(),
            "URL": self._页面.url,
        }

    def 获取Cookie(self) -> list:
        """获取当前上下文的Cookie"""
        if not self._上下文:
            return []
        return self._上下文.cookies()

    def 设置Cookie(self, cookies: list):
        """加载Cookie到上下文"""
        if not self._上下文:
            return
        self._上下文.add_cookies(cookies)

    def 获取localStorage(self) -> dict:
        """获取当前页面的localStorage"""
        if not self._页面:
            return {}
        return self._页面.evaluate("""() => {
            const items = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                items[key] = localStorage.getItem(key);
            }
            return items;
        }""")

    def 设置localStorage(self, 数据: dict):
        """设置localStorage"""
        if not self._页面 or not 数据:
            return
        for 键, 值 in 数据.items():
            self._页面.evaluate(f"localStorage.setItem({json.dumps(键)}, {json.dumps(值)})")

    def 切换标签页(self, 索引: int = None, 标题: str = None) -> dict:
        """切换到指定标签页"""
        if not self._上下文:
            return {}
        页面列表 = self._上下文.pages
        if 索引 is not None and 0 <= 索引 < len(页面列表):
            self._页面 = 页面列表[索引]
        elif 标题:
            for p in 页面列表:
                if 标题 in p.title():
                    self._页面 = p
                    break
        self._页面.bring_to_front()
        return {"标题": self._页面.title(), "URL": self._页面.url, "标签数": len(页面列表)}

    def 获取标签列表(self) -> list:
        """获取所有标签页信息"""
        if not self._上下文:
            return []
        return [{"序号": i, "标题": p.title(), "URL": p.url}
                for i, p in enumerate(self._上下文.pages)]
