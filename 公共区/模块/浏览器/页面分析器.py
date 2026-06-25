"""页面分析器 — 将原始页面数据转换为AI友好的结构化文本

职责：
1. 格式化无障碍树为缩进文本（让AI用最少token理解页面结构）
2. 提取主要内容（正文文本，去掉导航/广告）
3. 提取列表数据（帖子列表/商品列表等）
4. 提取表格数据
5. 判断页面类型（列表页/详情页/表单页等）
6. 生成页面简短摘要

核心目标：让AI用最少的token理解页面内容。
"""


class 页面分析器类:
    """页面内容分析器"""

    def 格式化无障碍树(self, 原始树: dict, 缩进: int = 0, 最大深度: int = 10) -> str:
        """将无障碍树格式化为缩进文本

        输出示例：
        ├─ heading "登录"
        ├─ textbox "用户名" (empty)
        ├─ textbox "密码" (empty)
        └─ button "提交"
        """
        if not 原始树 or 缩进 >= 最大深度:
            return ""

        前缀 = "  " * 缩进
        角色 = 原始树.get("角色", "")
        名称 = 原始树.get("名称", "")
        值 = 原始树.get("值", "")

        # 跳过纯结构角色（无名称无值无子节点）
        if not 名称 and not 值 and not 原始树.get("子节点"):
            return ""

        行 = f"{前缀}├─ {角色}"
        if 名称:
            行 += f' "{名称}"'
        if 值:
            行 += f' [值: {值}]'
        行 += "\n"

        子节点 = 原始树.get("子节点", [])
        for 子 in 子节点:
            行 += self.格式化无障碍树(子, 缩进 + 1, 最大深度)

        return 行

    def 分析页面类型(self, 无障碍树: dict) -> str:
        """判断页面类型

        返回: 列表页/详情页/表单页/登录页/搜索页/文章页/其他
        基于无障碍树的结构特征判断
        """
        if not 无障碍树:
            return "未知"

        # 统计元素类型
        元素统计 = {}
        self._统计元素(无障碍树, 元素统计)

        文本框数 = 元素统计.get("textbox", 0)
        按钮数 = 元素统计.get("button", 0)
        链接数 = 元素统计.get("link", 0)
        标题数 = 元素统计.get("heading", 0)

        # 登录页：有密码框+少量按钮
        树文本 = self.格式化无障碍树(无障碍树, 最大深度=5)
        if "密码" in 树文本 or "password" in 树文本.lower():
            return "登录页"

        # 表单页：多个输入框
        if 文本框数 >= 2 and 按钮数 >= 1:
            return "表单页"

        # 列表页：大量链接，少量标题
        if 链接数 >= 10 and 标题数 >= 3:
            return "列表页"

        # 搜索页：有搜索框
        if "搜索" in 树文本 or "search" in 树文本.lower():
            return "搜索页"

        # 文章页：有标题+段落文本
        if 标题数 >= 1 and 元素统计.get("paragraph", 0) >= 2:
            return "文章页"

        # 详情页：中等链接+有标题
        if 1 <= 链接数 <= 10 and 标题数 >= 1:
            return "详情页"

        return "其他"

    def _统计元素(self, 节点: dict, 统计: dict):
        """递归统计无障碍树中各角色数量"""
        if not 节点:
            return
        角色 = 节点.get("角色", "")
        if 角色:
            统计[角色] = 统计.get(角色, 0) + 1
        for 子 in 节点.get("子节点", []):
            self._统计元素(子, 统计)

    def 生成页面摘要(self, 页面信息: dict, 无障碍树: dict = None) -> str:
        """生成页面简短摘要

        格式：页面类型 | 标题 | 主要元素数量 | 关键内容预览
        """
        标题 = 页面信息.get("标题", "无标题")
        页面类型 = "未知"
        元素概览 = ""

        if 无障碍树:
            页面类型 = self.分析页面类型(无障碍树)
            统计 = {}
            self._统计元素(无障碍树, 统计)
            重要元素 = []
            for 角色 in ["heading", "link", "textbox", "button", "table"]:
                数量 = 统计.get(角色, 0)
                if 数量 > 0:
                    中文名 = {"heading": "标题", "link": "链接", "textbox": "输入框",
                              "button": "按钮", "table": "表格"}[角色]
                    重要元素.append(f"{中文名}{数量}")

            if 重要元素:
                元素概览 = "，".join(重要元素)

        摘要 = f"[{页面类型}] {标题}"
        if 元素概览:
            摘要 += f" | {元素概览}"
        return 摘要

    def 提取列表数据(self, 引擎) -> list:
        """提取列表型数据（帖子列表/商品列表等）

        自动识别列表容器，提取每项的文本和链接
        """
        脚本 = """
        () => {
            const results = [];
            // 找重复结构的容器
            const containers = [
                'article', '.post-list .post-item', '.threadlist li',
                '.product-list .product-item', '.search-result .result-item',
                'main ul li', '.list-item'
            ];

            for (const sel of containers) {
                const items = document.querySelectorAll(sel);
                if (items.length >= 2) {
                    items.forEach((item, i) => {
                        const title = item.querySelector('h1, h2, h3, .title, .subject');
                        const link = item.querySelector('a[href]');
                        const time = item.querySelector('.time, .date, time');
                        const author = item.querySelector('.author, .user');
                        if (title || link) {
                            results.push({
                                序号: i + 1,
                                标题: title ? title.innerText.trim() : '',
                                链接: link ? link.href : '',
                                作者: author ? author.innerText.trim() : '',
                                时间: time ? time.innerText.trim() : '',
                                摘要: item.innerText.substring(0, 200).trim()
                            });
                        }
                    });
                    if (results.length > 0) return results;
                }
            }
            return results;
        }
        """
        try:
            return 引擎.执行JS(脚本) or []
        except Exception:
            return []

    def 提取表格数据(self, 引擎) -> list:
        """提取表格数据为列表套字典"""
        脚本 = """
        () => {
            const tables = document.querySelectorAll('table');
            const results = [];
            for (const table of tables) {
                const headers = [...table.querySelectorAll('th')].map(th => th.innerText.trim());
                const rows = [...table.querySelectorAll('tbody tr')];
                if (rows.length === 0) continue;

                for (const row of rows) {
                    const cells = [...row.querySelectorAll('td')].map(td => td.innerText.trim());
                    if (cells.length === 0) continue;

                    const record = {};
                    if (headers.length === cells.length) {
                        headers.forEach((h, i) => { record[h] = cells[i]; });
                    } else {
                        cells.forEach((c, i) => { record[`列${i+1}`] = c; });
                    }
                    results.push(record);
                }
            }
            return results;
        }
        """
        try:
            return 引擎.执行JS(脚本) or []
        except Exception:
            return []

    def 分析内容结构(self, 正文: str) -> dict:
        """分析正文的内容结构

        返回：{总字数, 段落数, 是否有代码, 是否有列表, 关键词预览}
        """
        if not 正文:
            return {"总字数": 0}

        段落 = [p for p in 正文.split("\n") if p.strip()]
        return {
            "总字数": len(正文),
            "段落数": len(段落),
            "是否有代码": "def " in 正文 or "function " in 正文 or "    " in 正文,
            "是否有列表": any(line.strip().startswith(("- ", "• ", "* ", "1.", "2."))
                              for line in 段落[:20]),
            "预览": 正文[:300] + "..." if len(正文) > 300 else 正文,
        }
