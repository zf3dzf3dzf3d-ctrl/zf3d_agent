"""
多线程下载模块 - 断点续传/多线程分块/全速下载
优先使用 aria2c（C语言多连接加速），未安装时回退纯Python实现
"""
import os
import sys
import json
import time
import threading
import subprocess
import shutil
import urllib.request
import urllib.parse
from pathlib import Path
from .基类 import 操作结果, 操作基类


def _检测aria2c():
    """检测系统是否安装 aria2c"""
    try:
        r = subprocess.run(['aria2c', '--version'], capture_output=True, text=True, timeout=5)
        return r.returncode == 0
    except Exception:
        return False


class 多线程下载(操作基类):
    """多线程断点续传下载器

    优先级：
    1. aria2c（多连接+C语言优化，速度最快）
    2. 纯Python多线程分块（无外部依赖，回退方案）

    支持后台下载模式：参数 后台=true 时立即返回，下载在独立线程完成
    """
    名称 = "多线程下载"
    描述 = "多线程断点续传下载文件。优先使用aria2c加速（多连接），未安装时回退纯Python多线程。支持断点续传、自动重试、后台下载"
    参数结构 = {
        "下载地址": {"类型": "字符串", "必填": True, "说明": "文件下载URL"},
        "保存路径": {"类型": "字符串", "必填": True, "说明": "文件保存完整路径（含文件名）"},
        "线程数": {"类型": "整数", "必填": False, "说明": "下载线程数，默认32（全速），范围1-32"},
        "重试次数": {"类型": "整数", "必填": False, "说明": "每个分块下载失败重试次数，默认5"},
    }

    # 每块最小大小（低于此值不拆分，直接单线程）
    _最小分块大小 = 256 * 1024  # 256KB
    # 每次写入缓冲区大小
    _缓冲区大小 = 256 * 1024  # 256KB
    # 请求头
    _请求头 = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*",
        "Accept-Encoding": "identity",  # 不压缩，确保Content-Length准确
    }

    _下载计数器 = 0
    _下载计数锁 = threading.Lock()

    def 执行(self, 参数: dict) -> 操作结果:
        下载地址 = 参数.get("下载地址", "").strip()
        保存路径 = 参数.get("保存路径", "").strip()
        线程数 = 参数.get("线程数", 32)
        重试次数 = 参数.get("重试次数", 5)

        if not 下载地址:
            return 操作结果.失败("下载地址为空")
        if not 保存路径:
            return 操作结果.失败("保存路径为空")

        线程数 = max(1, min(32, int(线程数)))
        重试次数 = max(0, min(10, int(重试次数)))

        保存路径 = Path(保存路径)
        保存路径.parent.mkdir(parents=True, exist_ok=True)

        # 生成唯一下载ID（用于前端区分多个同时下载的进度条）
        with 多线程下载._下载计数锁:
            多线程下载._下载计数器 += 1
            下载ID = 多线程下载._下载计数器

        回调 = self.进度回调
        取消 = self.取消检查
        文件名 = 保存路径.name

        def _后台执行():
            结果 = self._执行下载(下载地址, 保存路径, 线程数, 重试次数, 下载ID, 文件名)
            if 回调:
                if 结果.成功:
                    回调("下载完成", {
                        "下载ID": 下载ID,
                        "文件名": 文件名,
                        "保存路径": str(保存路径),
                        "大小MB": 结果.元数据.get("文件大小MB", 0),
                    })
                else:
                    回调("下载失败", {
                        "下载ID": 下载ID,
                        "文件名": 文件名,
                        "错误": 结果.错误,
                    })

        t = threading.Thread(target=_后台执行, daemon=True)
        t.start()
        return 操作结果.成功(
            f"下载已启动: {文件名}\n进度条实时显示，完成后自动通知",
            元数据={"操作类型": "多线程下载", "模式": "后台", "下载ID": 下载ID, "保存路径": str(保存路径)}
        )

    def _执行下载(self, 下载地址, 保存路径, 线程数, 重试次数, 下载ID=0, 文件名=""):
        """实际执行下载（后台共用）"""
        # 临时分块目录
        临时目录 = 保存路径.parent / f".{保存路径.name}.parts"
        元数据路径 = 保存路径.parent / f".{保存路径.name}.dlmeta"

        try:
            # 优先使用 aria2c
            if _检测aria2c():
                return self._aria2c下载(下载地址, 保存路径, 线程数, 重试次数, 下载ID, 文件名)

            # 回退到纯Python
            文件大小, 支持断点 = self._获取文件信息(下载地址)

            if 文件大小 <= 0:
                return self._单线程下载(下载地址, 保存路径, 重试次数, 下载ID, 文件名)

            if 文件大小 < self._最小分块大小 or not 支持断点 or 线程数 == 1:
                return self._单线程下载(下载地址, 保存路径, 重试次数, 下载ID, 文件名)

            return self._多线程下载(下载地址, 保存路径, 文件大小, 线程数, 重试次数, 临时目录, 元数据路径, 下载ID, 文件名)

        except Exception as e:
            return 操作结果.失败(f"下载失败: {e}")

    def _aria2c下载(self, url, 保存路径, 线程数, 重试次数, 下载ID=0, 文件名=""):
        """使用 aria2c 下载（多连接加速）"""
        下载目录 = str(保存路径.parent)
        if not 文件名:
            文件名 = 保存路径.name
        开始时间 = time.time()
        上次推送 = 0

        cmd = [
            'aria2c',
            '--console-log-level=warn',
            '--summary-interval=1',
            f'--max-connection-per-server={线程数}',
            f'--split={线程数}',
            f'--max-tries={重试次数 + 1}',
            '--retry-wait=2',
            '--continue=true',          # 断点续传
            '--file-allocation=none',    # 不预分配磁盘空间（省时间）
            f'--dir={下载目录}',
            f'--out={文件名}',
            '--enable-color=false',
            url,
        ]

        try:
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding='utf-8', errors='replace',
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
            )

            while True:
                line = proc.stdout.readline()
                if not line and proc.poll() is not None:
                    break
                if not line:
                    continue

                line = line.strip()

                # 检查取消标志
                if self.取消检查 and self.取消检查():
                    proc.terminate()
                    try:
                        proc.wait(timeout=5)
                    except Exception:
                        proc.kill()
                    return 操作结果.失败(
                        f"下载已取消（aria2c）\n可重新执行此操作继续断点续传",
                        元数据={"操作类型": "多线程下载", "模式": "aria2c", "已取消": True}
                    )

                # 解析 aria2c 进度行
                # 格式: [#17870 482MiB/9.3GiB(5%) CN:16 DL:2.4MiB ETA:1h12m]
                if '[' in line and ']' in line and 'DL:' in line:
                    import re
                    已下载匹配 = re.search(r'(\d+\.?\d*)([KMG]?)i?B?/', line)
                    总大小匹配 = re.search(r'/(\d+\.?\d*)([KMG]?)i?B?', line)
                    百分比匹配 = r'(\d+)%'
                    速度匹配 = r'DL:([\d.]+)([KMG]?)i?B/s'
                    eta匹配 = r'ETA:(\S+)'
                    cn匹配 = r'CN:(\d+)'

                    def 解析大小(数值, 单位):
                        倍数 = {'': 1, 'K': 1024, 'M': 1024**2, 'G': 1024**3}
                        return float(数值) * 倍数.get(单位, 1)

                    已下载MB = 0
                    总大小MB = 0
                    百分比 = 0
                    速度MB = 0
                    eta = ''
                    分块 = ''

                    m = re.search(r'已下载.*?(\d+\.?\d*)([KMG]?)i?B?/(\d+\.?\d*)([KMG]?)i?B?\((\d+)%\).*?DL:([\d.]+)([KMG]?)i?B/s.*?ETA:(\S+)', line)
                    if m:
                        倍数 = {'': 1, 'K': 1024, 'M': 1024**2, 'G': 1024**3}
                        已下载MB = round(float(m.group(1)) * 倍数.get(m.group(2), 1) / (1024*1024), 2)
                        总大小MB = round(float(m.group(3)) * 倍数.get(m.group(4), 1) / (1024*1024), 2)
                        百分比 = int(m.group(5))
                        速度MB = round(float(m.group(6)) * 倍数.get(m.group(7), 1) / (1024*1024), 2)
                        eta = m.group(8)
                        分块 = m.group(0)
                    else:
                        # 简化解析
                        m1 = re.search(r'(\d+\.?\d*)([KMG]?)i?B?/(\d+\.?\d*)([KMG]?)i?B?\((\d+)%\)', line)
                        if m1:
                            倍数 = {'': 1, 'K': 1024, 'M': 1024**2, 'G': 1024**3}
                            已下载MB = round(float(m1.group(1)) * 倍数.get(m1.group(2), 1) / (1024*1024), 2)
                            总大小MB = round(float(m1.group(3)) * 倍数.get(m1.group(4), 1) / (1024*1024), 2)
                            百分比 = int(m1.group(5))
                        m2 = re.search(r'DL:([\d.]+)([KMG]?)i?B/s', line)
                        if m2:
                            倍数 = {'': 1, 'K': 1024, 'M': 1024**2, 'G': 1024**3}
                            速度MB = round(float(m2.group(1)) * 倍数.get(m2.group(2), 1) / (1024*1024), 2)
                        m3 = re.search(r'ETA:(\S+)', line)
                        if m3:
                            eta = m3.group(1)
                        m4 = re.search(r'CN:(\d+)', line)
                        if m4:
                            分块 = f"{m4.group(1)}连接"

                    # 推送进度（含ETA）
                    if self.进度回调 and time.time() - 上次推送 > 1:
                        self.进度回调("下载进度", {
                            "下载ID": 下载ID,
                            "文件名": 文件名,
                            "已下载MB": 已下载MB,
                            "总大小MB": 总大小MB,
                            "百分比": 百分比,
                            "速度MB每秒": 速度MB,
                            "ETA": eta,
                            "已完成分块": 分块,
                        })
                        上次推送 = time.time()

            ret = proc.wait()

            if ret == 0:
                耗时 = time.time() - 开始时间
                大小mb = 保存路径.stat().st_size / (1024*1024) if 保存路径.exists() else 0
                速度mb = 大小mb / 耗时 if 耗时 > 0 else 0
                return 操作结果.成功(
                    f"下载完成: {文件名}\n"
                    f"大小: {大小mb:.2f} MB\n"
                    f"模式: aria2c({线程数}连接)\n"
                    f"耗时: {耗时:.1f}秒\n"
                    f"平均速度: {速度mb:.2f} MB/s",
                    元数据={
                        "操作类型": "多线程下载",
                        "模式": "aria2c",
                        "线程数": 线程数,
                        "文件大小MB": round(大小mb, 2),
                        "耗时秒": round(耗时, 1),
                        "速度MB每秒": round(速度mb, 2),
                        "保存路径": str(保存路径),
                    }
                )
            else:
                return 操作结果.失败(
                    f"aria2c下载失败(退出码{ret})\n可重新执行此操作继续断点续传",
                    元数据={"操作类型": "多线程下载", "模式": "aria2c", "退出码": ret}
                )

        except FileNotFoundError:
            # aria2c 不存在，回退
            文件大小, 支持断点 = self._获取文件信息(url)
            if 文件大小 <= 0 or 文件大小 < self._最小分块大小 or not 支持断点:
                return self._单线程下载(url, 保存路径, 重试次数, 下载ID, 文件名)
            临时目录 = 保存路径.parent / f".{保存路径.name}.parts"
            元数据路径 = 保存路径.parent / f".{保存路径.name}.dlmeta"
            return self._多线程下载(url, 保存路径, 文件大小, 线程数, 重试次数, 临时目录, 元数据路径, 下载ID, 文件名)
        except Exception as e:
            return 操作结果.失败(f"aria2c下载异常: {e}")

    def _获取文件信息(self, url: str):
        """HEAD请求获取文件大小和是否支持断点续传

        某些服务器不支持HEAD(返回405)，降级为GET+Range探测
        """
        文件大小 = 0
        支持断点 = False

        # 尝试1: HEAD请求
        try:
            请求 = urllib.request.Request(url, headers=self._请求头, method='HEAD')
            响应 = urllib.request.urlopen(请求, timeout=30)
            文件大小 = int(响应.headers.get('Content-Length', 0))
            accept_ranges = 响应.headers.get('Accept-Ranges', '')
            支持断点 = 'bytes' in (accept_ranges or '').lower()
            响应.close()
            if 文件大小 > 0:
                return 文件大小, 支持断点
        except urllib.error.HTTPError as e:
            if e.code != 405:
                # HEAD被拒绝(405)时降级，其他错误继续尝试
                pass
        except Exception:
            pass

        # 尝试2: GET + Range:0-0 探测（下载1字节测试）
        try:
            探测头 = dict(self._请求头)
            探测头["Range"] = "bytes=0-0"
            请求 = urllib.request.Request(url, headers=探测头)
            响应 = urllib.request.urlopen(请求, timeout=30)
            # 206 Partial Content = 支持Range
            if 响应.status == 206:
                支持断点 = True
                content_range = 响应.headers.get('Content-Range', '')
                # Content-Range: bytes 0-0/12345
                if '/' in content_range:
                    文件大小 = int(content_range.rsplit('/', 1)[-1])
            else:
                # 200 OK = 不支持Range，但能获取大小
                文件大小 = int(响应.headers.get('Content-Length', 0))
            响应.close()
        except Exception:
            pass

        return 文件大小, 支持断点

    def _单线程下载(self, url, 保存路径, 重试次数, 下载ID=0, 文件名=""):
        """单线程直接下载（不支持Range或文件太小）"""
        for 尝试 in range(重试次数 + 1):
            try:
                请求 = urllib.request.Request(url, headers=self._请求头)
                响应 = urllib.request.urlopen(请求, timeout=60)
                总大小 = int(响应.headers.get('Content-Length', 0))
                已下载 = 0
                开始时间 = time.time()
                上次推送 = 0
                with open(保存路径, 'wb') as f:
                    while True:
                        # 检查取消标志
                        if self.取消检查 and self.取消检查():
                            响应.close()
                            return 操作结果.失败(
                                f"下载已取消\n已下载: {已下载}/{总大小} bytes",
                                元数据={"操作类型": "多线程下载", "模式": "单线程", "已取消": True}
                            )
                        数据 = 响应.read(self._缓冲区大小)
                        if not 数据:
                            break
                        f.write(数据)
                        已下载 += len(数据)
                        if self.进度回调 and 总大小 > 0 and time.time() - 上次推送 > 1:
                            耗时 = time.time() - 开始时间
                            速度 = 已下载 / (1024*1024) / 耗时 if 耗时 > 0 else 0
                            剩余 = (总大小 - 已下载) / (速度 * 1024 * 1024) if 速度 > 0 else 0
                            eta = f"{int(剩余//60)}m{int(剩余%60)}s" if 剩余 > 0 else ""
                            self.进度回调("下载进度", {
                                "下载ID": 下载ID,
                                "文件名": 保存路径.name,
                                "已下载MB": round(已下载 / (1024*1024), 2),
                                "总大小MB": round(总大小 / (1024*1024), 2),
                                "百分比": 已下载 * 100 // 总大小,
                                "速度MB每秒": round(速度, 2),
                                "ETA": eta,
                                "已完成分块": f"0/1",
                            })
                            上次推送 = time.time()
                响应.close()
                大小mb = 已下载 / (1024 * 1024)
                return 操作结果.成功(
                    f"下载完成: {保存路径.name}\n大小: {大小mb:.2f} MB\n模式: 单线程",
                    元数据={
                        "操作类型": "多线程下载",
                        "模式": "单线程",
                        "文件大小": 已下载,
                        "文件大小MB": round(大小mb, 2),
                        "保存路径": str(保存路径),
                    }
                )
            except Exception as e:
                if 尝试 < 重试次数:
                    time.sleep(1)
                    continue
                return 操作结果.失败(f"单线程下载失败({尝试+1}次重试后): {e}")
        return 操作结果.失败("单线程下载失败: 超出重试次数")

    def _多线程下载(self, url, 保存路径, 文件大小, 线程数, 重试次数, 临时目录, 元数据路径, 下载ID=0, 文件名=""):
        """多线程分块下载"""
        # 计算每块大小
        实际线程数 = min(线程数, max(1, 文件大小 // self._最小分块大小))
        块大小 = 文件大小 // 实际线程数
        # 最后一块承担余数
        分块列表 = []
        for i in range(实际线程数):
            start = i * 块大小
            end = (i + 1) * 块大小 - 1 if i < 实际线程数 - 1 else 文件大小 - 1
            分块列表.append({
                "序号": i,
                "start": start,
                "end": end,
                "已下载": 0,
                "完成": False,
            })

        # 断点续传：加载已有元数据
        if 元数据路径.exists():
            try:
                with open(元数据路径, 'r', encoding='utf-8') as f:
                    旧数据 = json.load(f)
                if 旧数据.get("url") == url and 旧数据.get("文件大小") == 文件大小:
                    for 块 in 分块列表:
                        for 旧块 in 旧数据.get("分块", []):
                            if 旧块["序号"] == 块["序号"]:
                                块["已下载"] = 旧块.get("已下载", 0)
                                块["完成"] = 旧块.get("完成", False)
                                break
                    已完成字节数 = sum(块["已下载"] for 块 in 分块列表)
                    if 已完成字节数 >= 文件大小 and all(块["完成"] for 块 in 分块列表):
                        # 所有分块已完成，直接合并
                        pass
                    else:
                        pass  # 继续未完成的分块
            except Exception:
                pass  # 元数据损坏，重新下载

        # 创建临时目录
        临时目录.mkdir(parents=True, exist_ok=True)

        # 进度跟踪
        进度锁 = threading.Lock()
        开始时间 = time.time()
        已完成字节数 = sum(块["已下载"] for 块 in 分块列表)
        总字节数 = 文件大小
        进度打印时间 = 0

        def _保存元数据():
            """保存断点续传元数据"""
            try:
                with open(元数据路径, 'w', encoding='utf-8') as f:
                    json.dump({
                        "url": url,
                        "文件大小": 文件大小,
                        "分块": [{"序号": 块["序号"], "start": 块["start"], "end": 块["end"],
                                   "已下载": 块["已下载"], "完成": 块["完成"]} for 块 in 分块列表],
                    }, f, ensure_ascii=False)
            except Exception:
                pass

        def _下载分块(块):
            """单个线程下载一个分块"""
            非局部 = {"已下载": 块["已下载"]}
            part文件 = 临时目录 / f"part_{块['序号']}"

            # 如果已完成，跳过
            if 块["完成"]:
                return True

            for 尝试 in range(重试次数 + 1):
                try:
                    # 检查取消标志
                    if self.取消检查 and self.取消检查():
                        return False

                    当前位置 = 块["start"] + 非局部["已下载"]
                    if 当前位置 > 块["end"]:
                        块["完成"] = True
                        return True

                    请求头 = dict(self._请求头)
                    请求头["Range"] = f"bytes={当前位置}-{块['end']}"

                    请求 = urllib.request.Request(url, headers=请求头)
                    响应 = urllib.request.urlopen(请求, timeout=60)

                    # 追加模式写入
                    模式 = 'ab' if 非局部["已下载"] > 0 else 'wb'
                    with open(part文件, 模式) as f:
                        while True:
                            # 检查取消标志
                            if self.取消检查 and self.取消检查():
                                响应.close()
                                块["已下载"] = 非局部["已下载"]
                                _保存元数据()
                                return False
                            数据 = 响应.read(self._缓冲区大小)
                            if not 数据:
                                break
                            f.write(数据)
                            非局部["已下载"] += len(数据)

                            # 更新进度（线程安全）
                            nonlocal_progress(进度锁, 分块列表, 块["序号"], 非局部["已下载"],
                                              _保存元数据, 开始时间, 总字节数)

                    响应.close()

                    # 检查是否下载完整
                    expected = 块["end"] - 块["start"] + 1
                    if 非局部["已下载"] >= expected:
                        块["已下载"] = 非局部["已下载"]
                        块["完成"] = True
                        _保存元数据()
                        return True
                    else:
                        # 未下载完，继续重试
                        块["已下载"] = 非局部["已下载"]
                        _保存元数据()
                        continue

                except Exception:
                    块["已下载"] = 非局部["已下载"]
                    _保存元数据()
                    if 尝试 < 重试次数:
                        time.sleep(1 + 尝试)  # 递增等待
                        continue
                    return False

            return False

        # 推送下载开始
        if self.进度回调:
            self.进度回调("下载进度", {
                "下载ID": 下载ID,
                "文件名": 保存路径.name,
                "已下载MB": round(已完成字节数 / (1024*1024), 2),
                "总大小MB": round(文件大小 / (1024*1024), 2),
                "百分比": 已完成字节数 * 100 // 文件大小 if 文件大小 > 0 else 0,
                "速度MB每秒": 0,
                "已完成分块": f"0/{实际线程数}",
            })

        # 启动线程
        线程列表 = []
        for 块 in 分块列表:
            t = threading.Thread(target=_下载分块, args=(块,), daemon=True)
            t.start()
            线程列表.append(t)

        # 等待所有线程完成（同时推送下载进度）
        用户取消 = False
        while any(t.is_alive() for t in 线程列表):
            time.sleep(1)
            # 检查取消标志
            if self.取消检查 and self.取消检查():
                用户取消 = True
                break
            if self.进度回调:
                with 进度锁:
                    已完成字节数 = sum(块["已下载"] for 块 in 分块列表)
                    已完成分块数 = sum(1 for 块 in 分块列表 if 块["完成"])
                耗时 = time.time() - 开始时间
                速度 = 已完成字节数 / (1024*1024) / 耗时 if 耗时 > 0 else 0
                百分比 = 已完成字节数 * 100 // 文件大小 if 文件大小 > 0 else 0
                剩余 = (文件大小 - 已完成字节数) / (速度 * 1024 * 1024) if 速度 > 0 else 0
                eta = f"{int(剩余//60)}m{int(剩余%60)}s" if 剩余 > 0 else ""
                self.进度回调("下载进度", {
                    "下载ID": 下载ID,
                    "文件名": 保存路径.name,
                    "已下载MB": round(已完成字节数 / (1024*1024), 2),
                    "总大小MB": round(文件大小 / (1024*1024), 2),
                    "百分比": 百分比,
                    "速度MB每秒": round(速度, 2),
                    "ETA": eta,
                    "已完成分块": f"{已完成分块数}/{实际线程数}",
                })
        for t in 线程列表:
            t.join(timeout=5)  # 最多等5秒让线程退出

        # 用户取消
        if 用户取消:
            with 进度锁:
                _保存元数据()
            已下载 = sum(块["已下载"] for 块 in 分块列表)
            return 操作结果.失败(
                f"下载已取消\n已下载: {已下载}/{文件大小} bytes ({已下载 * 100 // 文件大小}%)\n"
                f"可重新执行此操作继续断点续传",
                元数据={
                    "操作类型": "多线程下载",
                    "模式": "多线程",
                    "已取消": True,
                    "文件大小": 文件大小,
                    "已下载": 已下载,
                    "进度": f"{已下载 * 100 // 文件大小}%",
                    "保存路径": str(保存路径),
                }
            )

        # 最终进度更新
        with 进度锁:
            _保存元数据()

        # 检查是否全部完成
        未完成 = [块 for 块 in 分块列表 if not 块["完成"]]
        if 未完成:
            已下载 = sum(块["已下载"] for 块 in 分块列表)
            return 操作结果.失败(
                f"下载未完成: {len(未完成)}/{实际线程数}个分块失败\n"
                f"已下载: {已下载}/{文件大小} bytes ({已下载 * 100 // 文件大小}%)\n"
                f"可重新执行此操作继续断点续传",
                元数据={
                    "操作类型": "多线程下载",
                    "模式": "多线程",
                    "文件大小": 文件大小,
                    "已下载": 已下载,
                    "进度": f"{已下载 * 100 // 文件大小}%",
                    "保存路径": str(保存路径),
                }
            )

        # 合并分块文件
        已合并 = 0
        with open(保存路径, 'wb') as out:
            for 块 in 分块列表:
                part文件 = 临时目录 / f"part_{块['序号']}"
                if part文件.exists():
                    with open(part文件, 'rb') as f:
                        while True:
                            数据 = f.read(self._缓冲区大小)
                            if not 数据:
                                break
                            out.write(数据)
                            已合并 += len(数据)

        # 清理临时文件
        try:
            for 块 in 分块列表:
                part文件 = 临时目录 / f"part_{块['序号']}"
                if part文件.exists():
                    part文件.unlink()
            临时目录.rmdir()
            if 元数据路径.exists():
                元数据路径.unlink()
        except Exception:
            pass

        耗时 = time.time() - 开始时间
        大小mb = 文件大小 / (1024 * 1024)
        速度mb = 大小mb / 耗时 if 耗时 > 0 else 0

        return 操作结果.成功(
            f"下载完成: {保存路径.name}\n"
            f"大小: {大小mb:.2f} MB\n"
            f"模式: 多线程({实际线程数}线程)\n"
            f"耗时: {耗时:.1f}秒\n"
            f"平均速度: {速度mb:.2f} MB/s",
            元数据={
                "操作类型": "多线程下载",
                "模式": "多线程",
                "线程数": 实际线程数,
                "文件大小": 文件大小,
                "文件大小MB": round(大小mb, 2),
                "耗时秒": round(耗时, 1),
                "速度MB每秒": round(速度mb, 2),
                "保存路径": str(保存路径),
            }
        )


def response_headers_get(headers, key, default=''):
    """安全获取HTTP响应头（兼容大小写）"""
    try:
        return headers.get(key, default) or headers.get(key.lower(), default) or default
    except Exception:
        return default


def nonlocal_progress(lock, 分块列表, 序号, 已下载, 保存回调, 开始时间, 总字节数):
    """线程安全地更新分块进度并定期保存元数据"""
    with lock:
        for 块 in 分块列表:
            if 块["序号"] == 序号:
                块["已下载"] = 已下载
                if 块["end"] - 块["start"] + 1 <= 已下载:
                    块["完成"] = True
                break
        # 每2秒保存一次元数据
        if time.time() - nonlocal_progress._上次保存 > 2:
            保存回调()
            nonlocal_progress._上次保存 = time.time()

nonlocal_progress._上次保存 = 0
