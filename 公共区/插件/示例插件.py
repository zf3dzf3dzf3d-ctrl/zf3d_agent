"""示例插件 — 放一个 .py 文件到 公共区/插件/ 目录就自动注册为操作

插件编写规则：
1. 文件中定义 操作基类 的子类
2. 每个子类自动注册为一个操作
3. 类不能以下划线开头
4. 必须实现 执行(self, 参数) 方法，返回 操作结果

删除本文件或移到其他目录即可取消加载。
"""
import random
from 操作.基类 import 操作基类, 操作结果


class 今日运势(操作基类):
    """获取今日运势"""
    名称 = "今日运势"
    描述 = "随机获取今日运势（示例插件）"
    参数结构 = {}

    def 执行(self, 参数):
        运势 = random.choice(["大吉", "中吉", "小吉", "末吉", "凶"])
        幸运色 = random.choice(["红色", "蓝色", "绿色", "黄色", "紫色"])
        return 操作结果(成功=True, 结果=f"今日运势: {运势}\n幸运色: {幸运色}")


class 随机密码(操作基类):
    """生成随机密码"""
    名称 = "随机密码"
    描述 = "生成指定长度的随机密码"
    参数结构 = {
        "长度": {"类型": "整数", "必填": False, "说明": "密码长度，默认16位"}
    }

    def 执行(self, 参数):
        长度 = 参数.get("长度", 16)
        if not isinstance(长度, int):
            长度 = int(长度) if str(长度).isdigit() else 16
        字符集 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
        密码 = "".join(random.choice(字符集) for _ in range(长度))
        return 操作结果(成功=True, 结果=密码)
