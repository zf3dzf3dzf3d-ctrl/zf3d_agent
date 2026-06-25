"""
网页服务 - 内置Web服务+API接口
API路径全部使用英文，避免中文URL编码问题
"""
import json
import os
import sys
import string
import shutil
import subprocess
import struct
import time
import threading
from datetime import datetime
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote
from pathlib import Path


def _提取docx文本(文件路径):
    """从.docx文件提取带格式的文本，返回HTML（保留字体颜色、粗体、斜体等）"""
    from docx import Document
    from docx.shared import RGBColor, Pt
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    doc = Document(文件路径)
    html_parts = []

    # 样式名→HTML标签映射
    标题映射 = {"Heading 1": "h1", "Heading 2": "h2", "Heading 3": "h3",
               "Heading 4": "h4", "Heading 5": "h5", "Heading 6": "h6",
               "Title": "h1", "Subtitle": "h2"}

    def _run转html(run):
        """将单个run转为带inline style的HTML"""
        text = run.text or ""
        if not text:
            return ""
        # HTML转义
        text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        # 保留换行
        text = text.replace("\n", "<br>")

        styles = []
        # 字体颜色
        try:
            if run.font.color and run.font.color.rgb:
                styles.append(f"color:#{run.font.color.rgb}")
        except:
            pass
        # 字体大小
        try:
            if run.font.size:
                styles.append(f"font-size:{run.font.size.pt}pt")
        except:
            pass
        # 字体名称
        try:
            if run.font.name:
                styles.append(f"font-family:{run.font.name}")
        except:
            pass
        # 粗体
        if run.font.bold:
            text = f"<strong>{text}</strong>"
        # 斜体
        if run.font.italic:
            text = f"<em>{text}</em>"
        # 下划线
        if run.font.underline:
            text = f"<u>{text}</u>"
        # 删除线
        try:
            if run.font.strike:
                text = f"<s>{text}</s>"
        except:
            pass
        # 包裹inline style
        if styles:
            text = f'<span style="{";".join(styles)}">{text}</span>'
        return text

    def _段落转html(p):
        """将段落转为HTML"""
        # 检查是否为标题
        style_name = p.style.name if p.style else ""
        tag = 标题映射.get(style_name, "p")
        # 合并所有run
        inner = "".join(_run转html(run) for run in p.runs)
        if not inner.strip():
            inner = "&nbsp;"
        # 对齐方式
        align_map = {WD_ALIGN_PARAGRAPH.CENTER: "center", WD_ALIGN_PARAGRAPH.RIGHT: "right",
                     WD_ALIGN_PARAGRAPH.JUSTIFY: "justify"}
        align = ""
        try:
            if p.alignment and p.alignment in align_map:
                align = f' style="text-align:{align_map[p.alignment]}"'
        except:
            pass
        return f"<{tag}{align}>{inner}</{tag}>"

    def _遍历文档体(doc):
        """按文档顺序遍历段落和表格"""
        from docx.oxml.ns import qn
        body = doc.element.body
        for child in body.iterchildren():
            if child.tag == qn('w:p'):
                # 段落
                for p in doc.paragraphs:
                    if p._element is child:
                        html_parts.append(_段落转html(p))
                        break
            elif child.tag == qn('w:tbl'):
                # 表格
                for tbl in doc.tables:
                    if tbl._element is child:
                        html_parts.append(_表格转html(tbl))
                        break

    def _表格转html(tbl):
        """将表格转为HTML"""
        rows_html = []
        for row in tbl.rows:
            cells_html = []
            for cell in row.cells:
                cell_parts = []
                for p in cell.paragraphs:
                    cell_parts.append(_段落转html(p))
                cells_html.append(f"<td>{''.join(cell_parts) or '&nbsp;'}</td>")
            rows_html.append(f"<tr>{''.join(cells_html)}</tr>")
        return f'<table>{"".join(rows_html)}</table>'

    _遍历文档体(doc)
    return "\n".join(html_parts) if html_parts else "<p>（空文档）</p>"


def _提取doc文本(文件路径):
    """从.doc文件提取文本，返回HTML"""
    import olefile
    ole = olefile.OleFileIO(文件路径)
    word_data = ole.openstream('WordDocument').read()
    flags = struct.unpack_from('<H', word_data, 0x000A)[0]
    fComplex = (flags & 0x0004) != 0
    fExtChar = (flags & 0x1000) != 0
    fWhichTblStm = (flags & 0x0200) != 0
    fcMin = struct.unpack_from('<I', word_data, 0x0018)[0]
    nFib = struct.unpack_from('<H', word_data, 0x0002)[0]
    text = ""
    if nFib >= 0x00C1:
        ccpText = struct.unpack_from('<I', word_data, 0x004C)[0]
        if fComplex:
            table_name = '1Table' if fWhichTblStm else '0Table'
            table_data = ole.openstream(table_name).read()
            fcClx = struct.unpack_from('<I', word_data, 0x01A2)[0]
            lcbClx = struct.unpack_from('<I', word_data, 0x01A6)[0]
            clx = table_data[fcClx:fcClx + lcbClx]
            parts = []
            pos = 0
            while pos < len(clx):
                clxt = clx[pos]
                if clxt == 2:
                    pos += 1
                    cb = struct.unpack_from('<I', clx, pos)[0]
                    pos += 4
                    n = (cb - 4) // 12
                    cps = []
                    for i in range(n + 1):
                        cps.append(struct.unpack_from('<I', clx, pos + i * 4)[0])
                    pcd_off = pos + (n + 1) * 4
                    for i in range(n):
                        pcd = clx[pcd_off + i * 8: pcd_off + (i + 1) * 8]
                        fc_raw = struct.unpack_from('<I', pcd, 2)[0]
                        compressed = (fc_raw & 0x40000000) != 0
                        fc = fc_raw & 0x3FFFFFFF
                        cnt = cps[i + 1] - cps[i]
                        if compressed:
                            off = fc // 2
                            parts.append(word_data[off:off + cnt].decode('cp1252', errors='ignore'))
                        else:
                            parts.append(word_data[fc:fc + cnt * 2].decode('utf-16-le', errors='ignore'))
                    pos = pcd_off + n * 8
                elif clxt == 1:
                    pos += 1
                    cb = struct.unpack_from('<H', clx, pos)[0]
                    pos += 2 + cb
                else:
                    break
            text = ''.join(parts)
        else:
            if fExtChar:
                text = word_data[fcMin:fcMin + ccpText * 2].decode('utf-16-le', errors='ignore')
            else:
                text = word_data[fcMin:fcMin + ccpText].decode('cp1252', errors='ignore')
    else:
        fcMac = struct.unpack_from('<I', word_data, 0x001C)[0]
        text = word_data[fcMin:fcMac].decode('cp1252', errors='ignore')
    ole.close()
    text = text.replace('\x07', '\t').replace('\x0B', '').replace('\x0C', '')
    html_parts = []
    for p in text.split('\r'):
        p = p.strip()
        if p:
            p = p.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            html_parts.append(f'<p>{p}</p>')
    return '\n'.join(html_parts) if html_parts else '<p>（空文档或无法读取）</p>'


class 网页请求处理器(BaseHTTPRequestHandler):
    """HTTP请求处理器"""
    界面目录 = None
    文件管理器 = None
    配置加载器 = None
    模型直连器 = None
    模块注册 = None
    操作注册中心 = None
    运行诊断器 = None  # 运行诊断器实例
    当前模型名 = None  # 当前对话使用的模型名
    _tts停止标志 = False  # TTS停止标志
    _tts_speaker = None  # SAPI SpVoice实例引用
    _tts_process = None  # powershell进程引用

    def do_GET(self):
        try:
            解析结果 = urlparse(self.path)
            路径 = unquote(解析结果.path)

            if 路径 == "/" or 路径 == "/index.html":
                self._返回文件(self.界面目录 / "主页.html", "text/html")
            elif 路径.endswith(".css"):
                self._返回文件(self.界面目录 / 路径.lstrip("/"), "text/css")
            elif 路径.endswith(".js"):
                self._返回文件(self.界面目录 / 路径.lstrip("/"), "application/javascript")
            elif 路径.startswith("/api/"):
                self._处理API_GET(路径, 解析结果)
            else:
                self._返回文件(self.界面目录 / 路径.lstrip("/"), self._猜测类型(路径))
        except Exception as e:
            if isinstance(e, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
                return  # 客户端已断开，无需处理
            print(f"  ❌ GET异常: {e}")
            if self.运行诊断器:
                self.运行诊断器.记录错误("网页服务.do_GET", e)
            self._返回JSON({"错误": f"服务器异常: {str(e)}"}, 500)

    def do_POST(self):
        try:
            解析结果 = urlparse(self.path)
            路径 = unquote(解析结果.path)
            if 路径.startswith("/api/"):
                内容长度 = int(self.headers.get("Content-Length", 0))
                请求体 = self.rfile.read(内容长度).decode("utf-8") if 内容长度 > 0 else "{}"
                try:
                    请求数据 = json.loads(请求体)
                except json.JSONDecodeError:
                    请求数据 = {}
                self._处理API_POST(路径, 请求数据)
            else:
                self._返回JSON({"错误": "未知路径"}, 404)
        except Exception as e:
            if isinstance(e, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
                return  # 客户端已断开，无需处理
            print(f"  ❌ POST异常: {e}")
            if self.运行诊断器:
                self.运行诊断器.记录错误("网页服务.do_POST", e)
            self._返回JSON({"错误": f"服务器异常: {str(e)}"}, 500)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "http://localhost:8765")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _检查鉴权(self) -> bool:
        """检查API鉴权：启用时非localhost请求需携带正确令牌"""
        配置 = self.配置加载器.配置缓存.get("系统配置", {})
        鉴权配置 = 配置.get("API鉴权", {})
        if not 鉴权配置.get("启用", False):
            return True
        # localhost免鉴权
        客户端地址 = self.client_address[0]
        if 客户端地址 in ("127.0.0.1", "::1", "localhost"):
            return True
        # 检查Bearer token
        令牌 = 鉴权配置.get("令牌", "")
        if not 令牌:
            return True
        auth头 = self.headers.get("Authorization", "")
        if auth头.startswith("Bearer "):
            提供的令牌 = auth头[7:]
            if 提供的令牌 == 令牌:
                return True
        return False

    def _处理API_GET(self, 路径: str, 解析结果):
        if not self._检查鉴权():
            self._返回JSON({"错误": "未授权：缺少或无效的令牌"}, 401)
            return
        if 路径 == "/api/config":
            self._返回JSON(self.配置加载器.配置缓存)
        elif 路径 == "/api/files":
            参数 = parse_qs(解析结果.query)
            目录 = 参数.get("path", ["./"])[0]
            结果 = self.文件管理器.列目录(目录)
            self._返回JSON(结果)
        elif 路径 == "/api/file-tree":
            参数 = parse_qs(解析结果.query)
            目录 = 参数.get("path", ["./"])[0]
            深度 = int(参数.get("depth", ["3"])[0])
            结果 = self.文件管理器.目录树(目录, 深度)
            self._返回JSON(结果)
        elif 路径 == "/api/image":
            参数 = parse_qs(解析结果.query)
            图片路径 = 参数.get("path", [""])[0]
            校验 = self.文件管理器._校验权限(图片路径, "读")
            if not 校验["允许"]:
                self._返回JSON({"错误": 校验["原因"]}, 403)
                return
            完整路径 = self.文件管理器._解析路径(图片路径)
            if not 完整路径.exists() or not 完整路径.is_file():
                self._返回JSON({"错误": "文件不存在"}, 404)
                return
            后缀 = 完整路径.suffix.lower()
            类型映射 = {".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".gif":"image/gif",".webp":"image/webp",".bmp":"image/bmp",".svg":"image/svg+xml"}
            类型 = 类型映射.get(后缀, "application/octet-stream")
            try:
                with open(完整路径, "rb") as f:
                    数据 = f.read()
                self.send_response(200)
                self.send_header("Content-Type", 类型)
                self.send_header("Content-Length", len(数据))
                self.send_header("Cache-Control", "max-age=3600")
                self.end_headers()
                self.wfile.write(数据)
            except Exception as e:
                self._返回JSON({"错误": str(e)}, 500)
        elif 路径 == "/api/audio":
            参数 = parse_qs(解析结果.query)
            音频路径 = 参数.get("path", [""])[0]
            校验 = self.文件管理器._校验权限(音频路径, "读")
            if not 校验["允许"]:
                self._返回JSON({"错误": 校验["原因"]}, 403)
                return
            完整路径 = self.文件管理器._解析路径(音频路径)
            if not 完整路径.exists() or not 完整路径.is_file():
                self._返回JSON({"错误": "文件不存在"}, 404)
                return
            后缀 = 完整路径.suffix.lower()
            类型映射 = {".mp3":"audio/mpeg",".wav":"audio/wav",".ogg":"audio/ogg",".m4a":"audio/mp4",".flac":"audio/flac",".aac":"audio/aac",".opus":"audio/opus",".wma":"audio/x-ms-wma"}
            类型 = 类型映射.get(后缀, "application/octet-stream")
            try:
                with open(完整路径, "rb") as f:
                    数据 = f.read()
                self.send_response(200)
                self.send_header("Content-Type", 类型)
                self.send_header("Content-Length", len(数据))
                self.send_header("Cache-Control", "max-age=3600")
                self.end_headers()
                self.wfile.write(数据)
            except Exception as e:
                self._返回JSON({"错误": str(e)}, 500)
        elif 路径 == "/api/video":
            参数 = parse_qs(解析结果.query)
            视频路径 = 参数.get("path", [""])[0]
            校验 = self.文件管理器._校验权限(视频路径, "读")
            if not 校验["允许"]:
                self._返回JSON({"错误": 校验["原因"]}, 403)
                return
            完整路径 = self.文件管理器._解析路径(视频路径)
            if not 完整路径.exists() or not 完整路径.is_file():
                self._返回JSON({"错误": "文件不存在"}, 404)
                return
            后缀 = 完整路径.suffix.lower()
            需转码 = 后缀 in [".avi", ".wmv"]
            if 需转码:
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                proc = subprocess.Popen(
                    ["ffmpeg", "-i", str(完整路径), "-c:v", "libx264", "-preset", "ultrafast",
                     "-c:a", "aac", "-b:a", "128k", "-movflags", "frag_keyframe+empty_moov",
                     "-f", "mp4", "-threads", "2", "pipe:1"],
                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
                )
                try:
                    while True:
                        块 = proc.stdout.read(65536)
                        if not 块:
                            break
                        self.wfile.write(块)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                finally:
                    proc.stdout.close()
                    proc.kill()
                return
            类型映射 = {".mp4":"video/mp4",".webm":"video/webm",".mkv":"video/x-matroska",".avi":"video/x-msvideo",".wmv":"video/x-ms-wmv",".mov":"video/quicktime",".flv":"video/x-flv",".ts":"video/mp2t"}
            类型 = 类型映射.get(后缀, "video/mp4")
            文件大小 = 完整路径.stat().st_size
            range_header = self.headers.get("Range")
            if range_header:
                import re
                m = re.match(r"bytes=(\d+)-(\d*)", range_header)
                if m:
                    start = int(m.group(1))
                    end = int(m.group(2)) if m.group(2) else 文件大小 - 1
                    end = min(end, 文件大小 - 1)
                    长度 = end - start + 1
                    self.send_response(206)
                    self.send_header("Content-Type", 类型)
                    self.send_header("Content-Length", 长度)
                    self.send_header("Content-Range", f"bytes {start}-{end}/{文件大小}")
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Cache-Control", "max-age=3600")
                    self.end_headers()
                    with open(完整路径, "rb") as f:
                        f.seek(start)
                        剩余 = 长度
                        while 剩余 > 0:
                            块 = f.read(min(65536, 剩余))
                            if not 块:
                                break
                            try:
                                self.wfile.write(块)
                            except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                                return
                            剩余 -= len(块)
                    return
            self.send_response(200)
            self.send_header("Content-Type", 类型)
            self.send_header("Content-Length", 文件大小)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "max-age=3600")
            self.end_headers()
            try:
                with open(完整路径, "rb") as f:
                    while True:
                        块 = f.read(65536)
                        if not 块:
                            break
                        self.wfile.write(块)
            except Exception as e:
                self._返回JSON({"错误": str(e)}, 500)
        elif 路径 == "/api/file-content":
            参数 = parse_qs(解析结果.query)
            文件路径 = 参数.get("path", [""])[0]
            校验 = self.文件管理器._校验权限(文件路径, "读")
            if not 校验["允许"]:
                self._返回JSON({"错误": 校验["原因"]}, 403)
                return
            完整路径 = self.文件管理器._解析路径(文件路径)
            if not 完整路径.exists() or not 完整路径.is_file():
                self._返回JSON({"错误": "文件不存在"}, 404)
                return
            文件大小 = 完整路径.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", 文件大小)
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            try:
                with open(完整路径, "rb") as f:
                    while True:
                        块 = f.read(65536)
                        if not 块:
                            break
                        self.wfile.write(块)
            except Exception as e:
                self._返回JSON({"错误": str(e)}, 500)
        elif 路径 == "/api/doc-content":
            参数 = parse_qs(解析结果.query)
            文件路径 = 参数.get("path", [""])[0]
            校验 = self.文件管理器._校验权限(文件路径, "读")
            if not 校验["允许"]:
                self._返回JSON({"错误": 校验["原因"]}, 403)
                return
            完整路径 = self.文件管理器._解析路径(文件路径)
            if not 完整路径.exists() or not 完整路径.is_file():
                self._返回JSON({"错误": "文件不存在"}, 404)
                return
            try:
                html = _提取doc文本(str(完整路径))
                self._返回JSON({"成功": True, "html": html})
            except Exception as e:
                self._返回JSON({"错误": str(e)}, 500)
        elif 路径 == "/api/docx-content":
            参数 = parse_qs(解析结果.query)
            文件路径 = 参数.get("path", [""])[0]
            校验 = self.文件管理器._校验权限(文件路径, "读")
            if not 校验["允许"]:
                self._返回JSON({"错误": 校验["原因"]}, 403)
                return
            完整路径 = self.文件管理器._解析路径(文件路径)
            if not 完整路径.exists() or not 完整路径.is_file():
                self._返回JSON({"错误": "文件不存在"}, 404)
                return
            try:
                html = _提取docx文本(str(完整路径))
                self._返回JSON({"成功": True, "html": html})
            except Exception as e:
                self._返回JSON({"错误": str(e)}, 500)
        elif 路径 == "/api/audit-log":
            self._返回JSON({"日志": self.文件管理器.获取审计日志()})
        elif 路径 == "/api/pending":
            self._返回JSON({"待确认": self.文件管理器.获取待确认()})
        elif 路径 == "/api/modules":
            self._返回JSON({"模块": list(self.模块注册.keys()) if self.模块注册 else []})
        elif 路径 == "/api/status":
            对话状态 = {}
            if self.模块注册 and "对话" in self.模块注册:
                对话状态 = self.模块注册["对话"].获取状态()
            当前模型 = "默认"
            if self.模型直连器:
                当前模型 = self.模型直连器.当前模型名 or "默认"
            self._返回JSON({
                "状态": "运行中", "版本": "2.0.0",
                "对话": 对话状态,
                "当前模型": 当前模型,
                "操作数": len(self.操作注册中心.列出所有操作()) if self.操作注册中心 else 0
            })
        elif 路径 == "/api/actions":
            if self.操作注册中心:
                self._返回JSON({"操作": self.操作注册中心.获取操作JSON描述()})
            else:
                self._返回JSON({"操作": []})
        elif 路径 == "/api/token-stats":
            """获取Token使用统计"""
            from 模型直连器 import 模型直连器类
            self._返回JSON({"成功": True, "统计": 模型直连器类.获取Token统计()})
        elif 路径 == "/api/cache-stats":
            """获取LLM缓存统计"""
            from 模型直连器 import 模型直连器类
            self._返回JSON({"成功": True, "统计": 模型直连器类.获取缓存统计()})
        elif 路径 == "/api/cache-clear":
            """清空LLM缓存"""
            from 模型直连器 import 模型直连器类
            模型直连器类.清空缓存()
            self._返回JSON({"成功": True, "消息": "缓存已清空"})
        elif 路径 == "/api/conv-search":
            """搜索对话内容（SQLite全文搜索）"""
            参数 = parse_qs(解析结果.query)
            关键词 = 参数.get("q", [""])[0]
            if 关键词:
                try:
                    from 存储引擎 import 获取存储引擎
                    引擎 = 获取存储引擎()
                    结果 = 引擎.搜索对话(关键词)
                    self._返回JSON({"成功": True, "结果": 结果})
                except Exception as e:
                    self._返回JSON({"成功": False, "错误": str(e)})
            else:
                self._返回JSON({"成功": False, "错误": "缺少搜索关键词"})
        elif 路径 == "/api/reasoning-stream":
            """轮询获取推理流（实时显示AI操作过程）"""
            参数 = parse_qs(解析结果.query)
            上次索引 = int(参数.get("index", ["0"])[0])
            if self.模块注册 and "对话" in self.模块注册:
                try:
                    结果 = self.模块注册["对话"].获取推理流(上次索引)
                    self._返回JSON(结果)
                except Exception as e:
                    self._返回JSON({"成功": False, "错误": str(e)})
            else:
                self._返回JSON({"成功": False, "错误": "对话模块未就绪"})
        elif 路径 == "/api/history":
            if self.模块注册 and "对话" in self.模块注册:
                历史 = self.模块注册["对话"].获取历史()
                self._返回JSON({"历史": 历史})
            else:
                self._返回JSON({"历史": []})
        elif 路径 == "/api/tasks":
            if self.模块注册 and "任务" in self.模块注册:
                self._返回JSON(self.模块注册["任务"]._列出任务())
            else:
                self._返回JSON({"任务列表": []})
        elif 路径 == "/api/models":
            # 返回可用模型列表
            模型列表 = []
            if self.模型直连器:
                模型列表 = self.模型直连器.获取模型列表()
            if not 模型列表:
                模型列表.append({"名称": "默认模型", "当前": True})
            self._返回JSON({"模型": 模型列表})
        elif 路径 == "/api/drives":
            # 返回可用磁盘驱动器列表
            驱动器列表 = []
            # 添加常用快捷方式（桌面、我的文档）
            用户目录 = os.path.expanduser("~")
            快捷方式列表 = [
                {"盘符": "桌面", "路径": os.path.join(用户目录, "Desktop"), "标签": "桌面", "图标": "🖥️"},
                {"盘符": "我的文档", "路径": os.path.join(用户目录, "Documents"), "标签": "我的文档", "图标": "📄"},
            ]
            for 快捷方式 in 快捷方式列表:
                if os.path.exists(快捷方式["路径"]):
                    驱动器列表.append(快捷方式)
            if sys.platform == "win32":
                for 盘符 in string.ascii_uppercase:
                    驱动器路径 = f"{盘符}:\\"
                    if os.path.exists(驱动器路径):
                        try:
                            使用 = shutil.disk_usage(驱动器路径) if hasattr(shutil, 'disk_usage') else None
                            驱动器列表.append({
                                "盘符": f"{盘符}:",
                                "路径": 驱动器路径,
                                "标签": 盘符,
                                "图标": "💾"
                            })
                        except:
                            驱动器列表.append({"盘符": f"{盘符}:", "路径": 驱动器路径, "标签": 盘符, "图标": "💾"})
            else:
                驱动器列表.append({"盘符": "/", "路径": "/", "标签": "根目录", "图标": "💾"})
            self._返回JSON({"驱动器": 驱动器列表})
        elif 路径 == "/api/folder-dialog":
            # Windows原生文件夹选择对话框
            选中路径 = self._打开文件夹选择对话框()
            self._返回JSON({"路径": 选中路径})
        elif 路径 == "/api/conversations":
            if self.模块注册 and "对话" in self.模块注册:
                self._返回JSON({"对话列表": self.模块注册["对话"].获取对话列表(), "当前ID": self.模块注册["对话"].当前对话ID})
            else:
                self._返回JSON({"对话列表": [], "当前ID": None})
        elif 路径 == "/api/current-plan":
            if self.模块注册 and "对话" in self.模块注册:
                self._返回JSON({"计划": self.模块注册["对话"].当前计划, "工作模式": self.模块注册["对话"].工作模式})
            else:
                self._返回JSON({"计划": None})
        elif 路径 == "/api/checkpoint-info":
            """获取检查点信息"""
            if self.模块注册 and "对话" in self.模块注册:
                self._返回JSON({"有检查点": self.模块注册["对话"].有检查点()})
            else:
                self._返回JSON({"有检查点": False})
        elif 路径 == "/api/health":
            """系统健康自检"""
            启动器 = getattr(self, '_启动器实例', None)
            if 启动器:
                self._返回JSON(启动器.自检())
            else:
                self._返回JSON({"状态": "未知", "错误": "启动器实例未绑定"})
        elif 路径 == "/api/action-stats":
            """操作调用统计"""
            if self.操作注册中心:
                self._返回JSON(self.操作注册中心.获取操作统计())
            else:
                self._返回JSON({"错误": "操作注册中心未就绪"})
        elif 路径 == "/api/engine-diff":
            """对比工作引擎与主引擎文件差异"""
            try:
                结果 = self._引擎差异分析()
                self._返回JSON(结果)
            except Exception as e:
                self._返回JSON({"成功": False, "错误": str(e)})
        elif 路径 == "/api/engine-backups":
            """列出可用备份"""
            try:
                项目根 = self.配置加载器.项目根目录
                备份目录 = 项目根 / "引擎管理" / "备份"
                备份列表 = []
                if 备份目录.exists():
                    for d in sorted(备份目录.iterdir(), reverse=True):
                        if d.is_dir():
                            文件数 = sum(1 for _ in d.rglob("*") if _.is_file())
                            备份列表.append({"名称": d.name, "文件数": 文件数})
                self._返回JSON({"成功": True, "备份列表": 备份列表})
            except Exception as e:
                self._返回JSON({"成功": False, "错误": str(e)})
        else:
            print(f"  ❌ 未知GET API: {路径}")
            self._返回JSON({"错误": "未知API: " + 路径}, 404)

    def _处理API_POST(self, 路径: str, 数据: dict):
        if not self._检查鉴权():
            self._返回JSON({"错误": "未授权：缺少或无效的令牌"}, 401)
            return
        if 路径 == "/api/chat":
            self._处理对话(数据)
        elif 路径 == "/api/resume-checkpoint":
            """从检查点续跑"""
            if self.模块注册 and "对话" in self.模块注册:
                结果 = self.模块注册["对话"].续跑检查点()
                self._返回JSON(结果)
            else:
                self._返回JSON({"成功": False, "错误": "对话模块未就绪"})
        elif 路径 == "/api/clear-checkpoint":
            """清除检查点"""
            if self.模块注册 and "对话" in self.模块注册:
                self.模块注册["对话"]._清除检查点()
                self._返回JSON({"成功": True})
            else:
                self._返回JSON({"成功": False, "错误": "对话模块未就绪"})
        elif 路径 == "/api/file-read":
            结果 = self.文件管理器.读取文件(数据.get("路径", ""))
            self._返回JSON(结果)
        elif 路径 == "/api/file-write":
            结果 = self.文件管理器.写入文件(数据.get("路径", ""), 数据.get("内容", ""))
            self._返回JSON(结果)
        elif 路径 == "/api/file-mkdir":
            结果 = self.文件管理器.创建目录(数据.get("路径", ""))
            self._返回JSON(结果)
        elif 路径 == "/api/file-create":
            结果 = self.文件管理器.新建文件(数据.get("路径", ""))
            self._返回JSON(结果)
        elif 路径 == "/api/file-delete":
            结果 = self.文件管理器.删除(数据.get("路径", ""))
            self._返回JSON(结果)
        elif 路径 == "/api/open-in-explorer":
            目标路径 = os.path.abspath(数据.get("路径", ""))
            try:
                if sys.platform == "win32":
                    os.startfile(目标路径)
                elif sys.platform == "darwin":
                    subprocess.Popen(["open", 目标路径])
                else:
                    subprocess.Popen(["xdg-open", 目标路径])
                self._返回JSON({"成功": True})
            except Exception as e:
                self._返回JSON({"成功": False, "错误": str(e)})
        elif 路径 == "/api/file-rename":
            结果 = self.文件管理器.重命名(数据.get("路径", ""), 数据.get("新名称", ""))
            self._返回JSON(结果)
        elif 路径 == "/api/file-replace":
            结果 = self.文件管理器.替换文本(
                数据.get("路径", ""),
                数据.get("旧文本", ""),
                数据.get("新文本", "")
            )
            self._返回JSON(结果)
        elif 路径 == "/api/permission":
            self.文件管理器.用户确认权限(
                数据.get("路径", ""),
                数据.get("操作", "读"),
                数据.get("选择", "拒绝")
            )
            self._返回JSON({"成功": True})
        elif 路径 == "/api/shutdown":
            self._返回JSON({"成功": True})
            def _延迟退出():
                time.sleep(0.5)
                if self._启动器实例:
                    self._启动器实例.停止()
                os._exit(0)
            threading.Thread(target=_延迟退出, daemon=True).start()
        elif 路径 == "/api/save-config":
            self.配置加载器.保存配置(
                数据.get("名称", ""),
                数据.get("数据", {}),
                数据.get("区域", "公共区")
            )
            self._返回JSON({"成功": True})
        elif 路径 == "/api/reload-config":
            self.配置加载器.重载配置()
            self._返回JSON({"成功": True})
        elif 路径 == "/api/model-config":
            """获取或保存模型配置"""
            if not self.模型直连器:
                self._返回JSON({"错误": "模型直连器未初始化"})
            elif not 数据:
                模型详情列表 = []
                for m in self.模型直连器.模型配置列表:
                    名称 = m.get("名称", "")
                    详情 = self.模型直连器.获取模型配置详情(名称)
                    模型详情列表.append(详情)
                self._返回JSON({"成功": True, "模型列表": 模型详情列表, "当前模型": self.模型直连器.当前模型名})
            else:
                模型名 = 数据.get("模型", "")
                密钥 = 数据.get("密钥", {})
                self.模型直连器.保存模型密钥(模型名, 密钥)
                密钥路径 = self.配置加载器.项目根目录 / "隐私区" / "我的配置" / "密钥.json"
                try:
                    from 模型直连器 import 加密密钥配置
                    加密后配置 = 加密密钥配置(self.模型直连器.密钥配置)
                    with open(密钥路径, "w", encoding="utf-8") as f:
                        json.dump(加密后配置, f, ensure_ascii=False, indent=2)
                    self._返回JSON({"成功": True, "消息": "密钥已保存（加密存储）"})
                except Exception as e:
                    self._返回JSON({"错误": f"保存失败: {e}"})
        elif 路径 == "/api/run-action":
            if self.操作注册中心:
                操作名 = 数据.get("操作", "")
                参数 = 数据.get("参数", {})
                结果 = self.操作注册中心.执行(操作名, 参数)
                self._返回JSON(结果)
            else:
                self._返回JSON({"错误": "操作注册中心未初始化"})
        elif 路径 == "/api/work-mode":
            if self.模块注册 and "对话" in self.模块注册:
                模式 = 数据.get("模式", "商量")
                成功 = self.模块注册["对话"].设置工作模式(模式)
                self._返回JSON({"成功": 成功, "当前模式": self.模块注册["对话"].工作模式})
            else:
                self._返回JSON({"错误": "对话模块未加载"})
        elif 路径 == "/api/clear-chat":
            if self.模块注册 and "对话" in self.模块注册:
                self.模块注册["对话"].清空历史()
                self._返回JSON({"成功": True})
            else:
                self._返回JSON({"错误": "对话模块未加载"})
        elif 路径 == "/api/cancel":
            """用户取消当前正在执行的对话"""
            if self.模块注册 and "对话" in self.模块注册:
                self.模块注册["对话"].取消()
                self._返回JSON({"成功": True})
            else:
                self._返回JSON({"错误": "对话模块未加载"})
        elif 路径 == "/api/tts":
            """TTS语音合成 - 优先edge-tts神经语音(晓晓)，失败回退SAPI"""
            文本 = 数据.get("文本", "")
            if not 文本:
                self._返回JSON({"错误": "文本为空"})
                return
            文本 = 文本[:500]
            网页请求处理器._tts停止标志 = False
            网页请求处理器._tts_speaker = None
            网页请求处理器._tts_process = None
            def _tts播放(待播文本):
                # 方案1: edge-tts 神经语音（晓晓，语速+30%，音量+100%，需联网）
                try:
                    import asyncio
                    import edge_tts
                    import os
                    import tempfile
                    import time
                    os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")
                    import pygame
                    if not pygame.mixer.get_init():
                        pygame.mixer.init()
                    pygame.mixer.music.stop()
                    async def _生成():
                        communicate = edge_tts.Communicate(
                            待播文本,
                            'zh-CN-XiaoxiaoNeural',
                            rate='+30%',
                            volume='+100%'
                        )
                        tmp = os.path.join(tempfile.gettempdir(), 'zf3d_tts.mp3')
                        await asyncio.wait_for(communicate.save(tmp), timeout=30.0)
                        return tmp
                    音频文件 = asyncio.run(_生成())
                    if 网页请求处理器._tts停止标志:
                        return
                    pygame.mixer.music.load(音频文件)
                    pygame.mixer.music.play()
                    while pygame.mixer.music.get_busy():
                        if 网页请求处理器._tts停止标志:
                            pygame.mixer.music.stop()
                            break
                        time.sleep(0.1)
                    pygame.mixer.music.unload()
                    try:
                        os.remove(音频文件)
                    except Exception:
                        pass
                except Exception:
                    # 方案2: 回退到 SAPI SpVoice（离线）
                    try:
                        import pythoncom
                        import win32com.client
                        pythoncom.CoInitialize()
                        try:
                            speaker = win32com.client.Dispatch("SAPI.SpVoice")
                            网页请求处理器._tts_speaker = speaker
                            speaker.Speak("", 3)
                            speaker.Rate = 3
                            speaker.Volume = 100
                            speaker.Speak(待播文本, 0)
                        finally:
                            pythoncom.CoUninitialize()
                    except Exception:
                        import subprocess
                        干净文本 = 待播文本.replace("'", "''").replace('"', '')
                        cmd = f'powershell -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak(\'{干净文本}\')"'
                        proc = subprocess.Popen(cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        网页请求处理器._tts_process = proc
            t = threading.Thread(target=_tts播放, args=(文本,), daemon=True)
            t.start()
            self._返回JSON({"成功": True})
        elif 路径 == "/api/tts-stop":
            """停止当前TTS播放"""
            网页请求处理器._tts停止标志 = True
            def _tts停止():
                # 停止 pygame 播放
                try:
                    os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")
                    import pygame
                    if pygame.mixer.get_init():
                        pygame.mixer.music.stop()
                except Exception:
                    pass
                # 停止 SAPI 播放（用同一个实例）
                sp = 网页请求处理器._tts_speaker
                if sp:
                    try:
                        import pythoncom
                        pythoncom.CoInitialize()
                        try:
                            sp.Speak("", 3)
                        finally:
                            pythoncom.CoUninitialize()
                    except Exception:
                        pass
                    网页请求处理器._tts_speaker = None
                # 杀掉 powershell 进程
                proc = 网页请求处理器._tts_process
                if proc:
                    try:
                        proc.kill()
                    except Exception:
                        pass
                    网页请求处理器._tts_process = None
            t = threading.Thread(target=_tts停止, daemon=True)
            t.start()
            self._返回JSON({"成功": True})
        elif 路径 == "/api/conversation-new":
            if self.模块注册 and "对话" in self.模块注册:
                结果 = self.模块注册["对话"].新建对话()
                self._返回JSON({"成功": True, "对话": 结果})
            else:
                self._返回JSON({"错误": "对话模块未加载"})
        elif 路径 == "/api/conversation-switch":
            if self.模块注册 and "对话" in self.模块注册:
                结果 = self.模块注册["对话"].切换对话(数据.get("id", ""))
                self._返回JSON(结果)
            else:
                self._返回JSON({"错误": "对话模块未加载"})
        elif 路径 == "/api/conversation-messages":
            if self.模块注册 and "对话" in self.模块注册:
                结果 = self.模块注册["对话"].获取对话消息(数据.get("id", ""))
                self._返回JSON(结果)
            else:
                self._返回JSON({"错误": "对话模块未加载"})
        elif 路径 == "/api/conversation-delete":
            if self.模块注册 and "对话" in self.模块注册:
                结果 = self.模块注册["对话"].删除对话(数据.get("id", ""))
                self._返回JSON(结果)
            else:
                self._返回JSON({"错误": "对话模块未加载"})
        elif 路径 == "/api/conversation-rename":
            if self.模块注册 and "对话" in self.模块注册:
                结果 = self.模块注册["对话"].重命名对话(数据.get("id", ""), 数据.get("标题", ""))
                self._返回JSON(结果)
            else:
                self._返回JSON({"错误": "对话模块未加载"})
        elif 路径 == "/api/conversation-save":
            if self.模块注册 and "对话" in self.模块注册:
                self.模块注册["对话"]._保存当前对话()
            self._返回JSON({"成功": True})
        elif 路径 == "/api/memory-add":
            if self.模块注册 and "对话" in self.模块注册:
                self.模块注册["对话"].添加永久记忆(数据.get("内容", ""))
                self._返回JSON({"成功": True})
            else:
                self._返回JSON({"错误": "对话模块未加载"})
        elif 路径 == "/api/plan-approve":
            if self.模块注册 and "对话" in self.模块注册:
                批准 = 数据.get("批准", False)
                if 批准:
                    self.模块注册["对话"].设置工作模式("执行")
                    self._返回JSON({"成功": True, "消息": "计划已批准，切换到执行模式"})
                else:
                    self.模块注册["对话"].当前计划 = None
                    self._返回JSON({"成功": True, "消息": "计划已拒绝"})
            else:
                self._返回JSON({"错误": "对话模块未加载"})
        elif 路径 == "/api/plan-execute":
            if self.模块注册 and "对话" in self.模块注册:
                结果 = self.模块注册["对话"].执行已批准计划()
                self._返回JSON(结果)
            else:
                self._返回JSON({"错误": "对话模块未加载"})
        elif 路径 == "/api/folder-dialog":
            选中路径 = self._打开文件夹选择对话框()
            self._返回JSON({"路径": 选中路径})
        elif 路径 == "/api/switch-model":
            # 切换当前对话模型
            模型名 = 数据.get("模型", "")
            if self.模型直连器:
                结果 = self.模型直连器.切换模型(模型名)
                if 结果.get("成功"):
                    self.当前模型名 = 模型名
                    if self.模块注册 and "对话" in self.模块注册:
                        self.模块注册["对话"].模型直连器 = self.模型直连器
                    # 持久化当前模型选择到 模型规则.json
                    try:
                        模型规则路径 = self.配置加载器.项目根目录 / "公共区" / "配置" / "模型规则.json"
                        with open(模型规则路径, "r", encoding="utf-8") as f:
                            模型规则 = json.load(f)
                        模型规则["当前模型"] = 模型名
                        with open(模型规则路径, "w", encoding="utf-8") as f:
                            json.dump(模型规则, f, ensure_ascii=False, indent=2)
                    except Exception:
                        pass
                    self._返回JSON({"成功": True, "当前模型": 模型名})
                else:
                    self._返回JSON({"错误": 结果.get("错误", "切换失败")})
            else:
                self._返回JSON({"错误": "模型直连器未初始化"})
        elif 路径 == "/api/task-run":
            if self.模块注册 and "任务" in self.模块注册:
                结果 = self.模块注册["任务"].运行(数据)
                self._返回JSON(结果)
            else:
                self._返回JSON({"错误": "任务模块未加载"})
        elif 路径 == "/api/engine-merge":
            """合并工作引擎文件到主引擎"""
            try:
                结果 = self._执行引擎合并(数据)
                self._返回JSON(结果)
            except Exception as e:
                self._返回JSON({"成功": False, "错误": str(e)})
        elif 路径 == "/api/engine-rollback":
            """回滚主引擎到指定备份"""
            try:
                备份名 = 数据.get("备份", "")
                结果 = self._执行引擎回滚(备份名)
                self._返回JSON(结果)
            except Exception as e:
                self._返回JSON({"成功": False, "错误": str(e)})
        else:
            print(f"  ❌ 未知POST API: {路径}")
            self._返回JSON({"错误": "未知API: " + 路径}, 404)

    def _引擎差异分析(self) -> dict:
        """对比工作引擎与主引擎的文件差异"""
        import hashlib
        项目根 = self.配置加载器.项目根目录
        主引擎路径 = 项目根 / "公共区"
        工作引擎路径 = 项目根 / "隐私区" / "我的工作引擎" / "公共区"
        忽略模式 = ["__pycache__", ".pyc", ".git", ".log", ".bak", "__pycache__"]
        最大差异 = 50

        if not 工作引擎路径.exists():
            return {"成功": True, "新增": [], "修改": [], "删除": [], "未变": 0, "提示": "工作引擎目录为空或不存在"}

        def _忽略(路径: str) -> bool:
            return any(p in 路径 for p in 忽略模式)

        def _哈希(文件路径) -> str:
            h = hashlib.md5()
            with open(文件路径, "rb") as f:
                for chunk in iter(lambda: f.read(8192), b""):
                    h.update(chunk)
            return h.hexdigest()

        # 收集主引擎文件
        主文件 = {}
        for f in 主引擎路径.rglob("*"):
            if f.is_file() and not _忽略(str(f)):
                相对 = f.relative_to(主引擎路径).as_posix()
                主文件[相对] = _哈希(f)

        # 收集工作引擎文件
        工作文件 = {}
        for f in 工作引擎路径.rglob("*"):
            if f.is_file() and not _忽略(str(f)):
                相对 = f.relative_to(工作引擎路径).as_posix()
                工作文件[相对] = _哈希(f)

        新增 = [k for k in 工作文件 if k not in 主文件]
        删除 = [k for k in 主文件 if k not in 工作文件]
        修改 = [k for k in 工作文件 if k in 主文件 and 工作文件[k] != 主文件[k]]
        未变 = sum(1 for k in 工作文件 if k in 主文件 and 工作文件[k] == 主文件[k])

        # 截断
        新增 = sorted(新增)[:最大差异]
        删除 = sorted(删除)[:最大差异]
        修改 = sorted(修改)[:最大差异]

        return {"成功": True, "新增": 新增, "修改": 修改, "删除": 删除, "未变": 未变}

    def _执行引擎合并(self, 数据: dict) -> dict:
        """执行文件合并：备份→检测→复制→记日志"""
        import shutil
        import py_compile
        项目根 = self.配置加载器.项目根目录
        主引擎路径 = 项目根 / "公共区"
        工作引擎路径 = 项目根 / "隐私区" / "我的工作引擎" / "公共区"
        文件列表 = 数据.get("文件列表", [])
        执行合并 = 数据.get("执行", False)

        if not 文件列表:
            return {"成功": False, "错误": "未选择文件"}

        if not 工作引擎路径.exists():
            return {"成功": False, "错误": "工作引擎目录不存在"}

        # 检测阶段
        检测结果 = []
        全部通过 = True
        for 相对路径 in 文件列表:
            源文件 = 工作引擎路径 / 相对路径
            if not 源文件.exists():
                检测结果.append({"路径": 相对路径, "状态": "源文件不存在"})
                全部通过 = False
                continue
            # 语法检查
            if 相对路径.endswith(".py"):
                try:
                    py_compile.compile(str(源文件), doraise=True)
                    检测结果.append({"路径": 相对路径, "状态": "通过"})
                except py_compile.PyCompileError as e:
                    检测结果.append({"路径": 相对路径, "状态": f"语法错误: {str(e)[:200]}"})
                    全部通过 = False
            elif 相对路径.endswith(".json"):
                try:
                    with open(源文件, "r", encoding="utf-8") as f:
                        json.load(f)
                    检测结果.append({"路径": 相对路径, "状态": "通过"})
                except Exception as e:
                    检测结果.append({"路径": 相对路径, "状态": f"JSON错误: {e}"})
                    全部通过 = False
            else:
                检测结果.append({"路径": 相对路径, "状态": "通过"})

        if not 全部通过:
            return {"成功": False, "错误": "检测未通过，已阻止合并", "检测结果": 检测结果}

        if not 执行合并:
            return {"成功": True, "已检测": True, "检测结果": 检测结果, "消息": "检测通过，可执行合并"}

        # 执行合并：先备份
        from datetime import datetime
        时间戳 = datetime.now().strftime("%Y%m%d_%H%M%S")
        备份目录 = 项目根 / "引擎管理" / "备份" / 时间戳
        备份目录.mkdir(parents=True, exist_ok=True)
        for 相对路径 in 文件列表:
            源文件 = 主引擎路径 / 相对路径
            if 源文件.exists():
                备份目标 = 备份目录 / 相对路径
                备份目标.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(源文件, 备份目标)

        # 复制工作引擎→主引擎
        合并数 = 0
        for 相对路径 in 文件列表:
            源文件 = 工作引擎路径 / 相对路径
            目标文件 = 主引擎路径 / 相对路径
            目标文件.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(源文件, 目标文件)
            合并数 += 1

        # 清理旧备份（保留10个）
        备份根 = 项目根 / "引擎管理" / "备份"
        if 备份根.exists():
            备份列表 = sorted(备份根.iterdir())
            while len(备份列表) > 10:
                最旧 = 备份列表.pop(0)
                shutil.rmtree(最旧, ignore_errors=True)

        # 记录合并日志
        合并日志路径 = 项目根 / "引擎管理" / "合并日志.json"
        try:
            with open(合并日志路径, "r", encoding="utf-8") as f:
                合并日志 = json.load(f)
        except Exception:
            合并日志 = {"记录": []}
        合并日志["记录"].append({
            "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "方向": "工作引擎→主引擎",
            "变更摘要": f"合并 {合并数} 个文件: {', '.join(文件列表[:5])}{'...' if len(文件列表) > 5 else ''}",
            "备份": 时间戳
        })
        with open(合并日志路径, "w", encoding="utf-8") as f:
            json.dump(合并日志, f, ensure_ascii=False, indent=2)

        return {"成功": True, "合并数": 合并数, "备份": 时间戳, "检测结果": 检测结果}

    def _执行引擎回滚(self, 备份名: str) -> dict:
        """从指定备份恢复主引擎文件"""
        import shutil
        项目根 = self.配置加载器.项目根目录
        备份目录 = 项目根 / "引擎管理" / "备份" / 备份名
        主引擎路径 = 项目根 / "公共区"

        if not 备份目录.exists():
            return {"成功": False, "错误": f"备份不存在: {备份名}"}

        恢复数 = 0
        for f in 备份目录.rglob("*"):
            if f.is_file():
                相对 = f.relative_to(备份目录)
                目标 = 主引擎路径 / 相对
                目标.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, 目标)
                恢复数 += 1

        # 记录日志
        from datetime import datetime
        合并日志路径 = 项目根 / "引擎管理" / "合并日志.json"
        try:
            with open(合并日志路径, "r", encoding="utf-8") as f:
                合并日志 = json.load(f)
        except Exception:
            合并日志 = {"记录": []}
        合并日志["记录"].append({
            "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "方向": "回滚",
            "变更摘要": f"从备份 [{备份名}] 恢复 {恢复数} 个文件"
        })
        with open(合并日志路径, "w", encoding="utf-8") as f:
            json.dump(合并日志, f, ensure_ascii=False, indent=2)

        return {"成功": True, "恢复数": 恢复数, "备份": 备份名}

    def _处理对话(self, 数据: dict):
        try:
            消息 = 数据.get("消息", "")
            上下文 = 数据.get("上下文", {})

            # 构建文件上下文注入文本
            文件上下文提示 = self._构建文件上下文提示(上下文)

            # 注入当前工作目录到操作注册中心（供操作类作为默认保存路径）
            当前文件夹 = 上下文.get("当前文件夹", "") if 上下文 else ""
            if 当前文件夹 and self.操作注册中心:
                self.操作注册中心.设置当前工作目录(当前文件夹)

            if self.模块注册 and "对话" in self.模块注册:
                对话模块 = self.模块注册["对话"]
                # 将文件上下文注入对话模块
                if 文件上下文提示:
                    对话模块.文件上下文 = 文件上下文提示
                else:
                    对话模块.文件上下文 = ""

                # SSE流式响应
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                self.send_header("Access-Control-Allow-Origin", "http://localhost:8765")
                self.end_headers()

                def _SSE写入(事件数据):
                    try:
                        行 = f"data: {json.dumps(事件数据, ensure_ascii=False)}\n\n"
                        self.wfile.write(行.encode("utf-8"))
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                        pass

                # 拦截推理流推送，实时写SSE
                原始推入 = 对话模块._推入推理流
                def _SSE推入(类型, 内容):
                    原始推入(类型, 内容)
                    _SSE写入({"类型": "推理流", "记录": [{"类型": 类型, "内容": 内容}]})
                对话模块._推入推理流 = _SSE推入

                结果 = 对话模块.运行({"消息": 消息})

                # 恢复原始方法
                对话模块._推入推理流 = 原始推入

                # 发送最终结果
                _SSE写入({"类型": "完成", "结果": 结果})
            elif self.模型直连器:
                消息列表 = [{"role": "user", "content": 消息}]
                系统提示词 = 数据.get("系统提示词", "")
                if 文件上下文提示:
                    系统提示词 = (系统提示词 + "\n\n" if 系统提示词 else "") + 文件上下文提示
                结果 = self.模型直连器.发送消息(消息列表, 系统提示词)
                if 结果["成功"]:
                    self._返回JSON({"成功": True, "回复": 结果["回复内容"]})
                else:
                    self._返回JSON({"成功": False, "错误": 结果.get("错误", "调用失败")})
            else:
                self._返回JSON({"成功": False, "错误": "无可用的模型或对话模块"})
        except Exception as e:
            if isinstance(e, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
                return  # 客户端已断开（用户点停止），无需处理
            import traceback
            traceback.print_exc()
            if self.运行诊断器:
                self.运行诊断器.记录错误("网页服务._处理对话", e)
            # 异常也写入对话历史，确保不丢失
            if self.模块注册 and "对话" in self.模块注册:
                try:
                    对话模块 = self.模块注册["对话"]
                    错误信息 = f"❌ 对话处理异常: {type(e).__name__}: {str(e)[:300]}"
                    对话模块.对话历史.append({"角色": "助手", "内容": 错误信息, "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
                    对话模块._保存当前对话()
                except Exception:
                    pass
            # SSE模式下通过事件发送错误（header已发送，不能再返回JSON）
            if self.模块注册 and "对话" in self.模块注册:
                try:
                    错误结果 = {"成功": False, "错误": f"对话处理遇到问题: {str(e)[:200]}", "回复": f"❌ 对话处理遇到问题，请稍后重试"}
                    错误行 = f"data: {json.dumps({'类型': '完成', '结果': 错误结果}, ensure_ascii=False)}\n\n"
                    self.wfile.write(错误行.encode("utf-8"))
                    self.wfile.flush()
                except Exception:
                    pass
            else:
                self._返回JSON({"成功": False, "错误": f"对话处理遇到问题，请稍后重试: {str(e)[:200]}"})

    def _构建文件上下文提示(self, 上下文: dict) -> str:
        """根据前端传来的上下文构建系统提示词注入"""
        if not 上下文:
            return ""
        部分 = ["\n\n## 当前工作环境\n"]
        # 当前文件夹
        当前文件夹 = 上下文.get("当前文件夹", "")
        if 当前文件夹:
            # 读取目录树摘要（浅层）
            try:
                树结果 = self.文件管理器.目录树(当前文件夹, 1)
                if 树结果.get("成功") and 树结果.get("树", {}).get("子项"):
                    子项列表 = 树结果["树"]["子项"]
                    文件列表 = [f["名称"] for f in 子项列表 if f["类型"] == "文件"]
                    目录列表 = [d["名称"] for d in 子项列表 if d["类型"] == "目录"]
                    部分.append(f"当前打开的文件夹: {当前文件夹}")
                    if 目录列表:
                        部分.append(f"  子目录: {', '.join(目录列表[:30])}")
                    if 文件列表:
                        部分.append(f"  文件: {', '.join(文件列表[:30])}")
            except:
                部分.append(f"当前打开的文件夹: {当前文件夹}")
        # 打开的文件列表
        打开的文件 = 上下文.get("打开的文件列表", [])
        if 打开的文件:
            部分.append(f"已打开的文件: {', '.join(f['名称'] for f in 打开的文件)}")
        # 当前正在编辑的文件
        当前文件 = 上下文.get("当前文件")
        if 当前文件:
            内容预览 = (当前文件.get("内容") or "")[:3000]
            部分.append(f"\n当前正在编辑的文件: {当前文件.get('名称')} ({当前文件.get('路径')})")
            部分.append(f"文件内容:\n```\n{内容预览}\n{'...(已截断)' if len(当前文件.get('内容') or '') > 3000 else ''}\n```")
        # 选中文件/文件夹
        选中文件 = 上下文.get("选中文件", [])
        if 选中文件:
            文件数 = sum(1 for f in 选中文件 if f.get("类型") != "目录")
            文件夹数 = sum(1 for f in 选中文件 if f.get("类型") == "目录")
            部分.append(f"\n## 📋 用户已选中以下文件/文件夹（共{len(选中文件)}项：{文件数}个文件，{文件夹数}个文件夹）:")
            for 项 in 选中文件:
                类型标签 = "📁" if 项.get("类型") == "目录" else "📄"
                部分.append(f"- {类型标签} {项.get('名称', '')} ({项.get('路径', '')})")
            部分.append("用户已在资源管理器中选中上述文件/文件夹，请在回复时知晓这些被选中的内容。用户可能会要求你对这些文件执行批量操作。")
        # 框选文本
        框选 = 上下文.get("框选文本")
        if 框选 and 框选.get("内容"):
            框选原文 = 框选['内容']
            框选文件路径 = 框选.get('所在文件', '')
            框选文件名 = 框选.get('所在文件名', '')
            旧文本JSON = json.dumps(框选原文, ensure_ascii=False)
            # 判断是否为Word文档
            后缀 = Path(框选文件名).suffix.lower() if 框选文件名 else ""
            is_word = 后缀 == ".docx"
            is_excel = 后缀 in (".xlsx", ".xls")
            if is_word:
                操作名 = "替换Word文本"
                部分.append(f"\n## ⚠️ 框选文本操作（最高优先级）")
                部分.append(f"用户已在Word文档「{框选文件名}」中框选文本，你【必须】使用「替换Word文本」操作修改.docx文件！")
                部分.append(f"【禁止】使用「替换文本」操作（那是用于纯文本文件的，无法操作.docx）")
                部分.append(f"【禁止】使用「读取文件」（你已能看到原文）")
                部分.append(f"【禁止】回复文字让用户确认，直接执行替换即可")
                部分.append(f"\n框选原文（必须原封不动作为旧文本参数）:")
                部分.append(f"```\n{框选原文}\n```")
                部分.append(f"文件路径: {框选文件路径}")
                部分.append(f"\n直接输出以下JSON即可（只需修改新文本字段）:")
                部分.append(f'{{"思考": "根据用户指令处理Word文档中的框选文本", "操作": "替换Word文本", "参数": {{"路径": "{框选文件路径}", "旧文本": {旧文本JSON}, "新文本": "修改后的内容"}}}}')
                部分.append(f"\n例如删除就写: \"新文本\": \"\"")
                部分.append(f"例如改写就写: \"新文本\": \"改写后的文本\"")
            elif is_excel:
                操作名 = "替换Excel文本"
                部分.append(f"\n## ⚠️ 框选文本操作（最高优先级）")
                部分.append(f"用户已在Excel文档「{框选文件名}」中框选文本，你【必须】使用「替换Excel文本」操作修改.xlsx文件！")
                部分.append(f"【禁止】使用「替换文本」操作（那是用于纯文本文件的，无法操作.xlsx）")
                部分.append(f"【禁止】使用「读取文件」（你已能看到原文）")
                部分.append(f"【禁止】回复文字让用户确认，直接执行替换即可")
                部分.append(f"\n框选原文（必须原封不动作为旧文本参数）:")
                部分.append(f"```\n{框选原文}\n```")
                部分.append(f"文件路径: {框选文件路径}")
                部分.append(f"\n直接输出以下JSON即可（只需修改新文本字段）:")
                部分.append(f'{{"思考": "根据用户指令处理Excel文档中的框选文本", "操作": "替换Excel文本", "参数": {{"路径": "{框选文件路径}", "旧文本": {旧文本JSON}, "新文本": "修改后的内容"}}}}')
                部分.append(f"\n例如删除就写: \"新文本\": \"\"")
                部分.append(f"例如改写就写: \"新文本\": \"改写后的文本\"")
            else:
                操作名 = "替换文本"
                部分.append(f"\n## ⚠️ 框选文本操作（最高优先级）")
                部分.append(f"用户已在文件「{框选文件名}」中框选文本，你【必须】使用「替换文本」操作！")
                部分.append(f"【禁止】使用读取文件（你已能看到原文）")
                部分.append(f"【禁止】使用写入文件重写整个文件")
                部分.append(f"【禁止】回复文字让用户确认，直接执行替换即可")
                部分.append(f"\n框选原文（必须原封不动作为旧文本参数）:")
                部分.append(f"```\n{框选原文}\n```")
                部分.append(f"文件路径: {框选文件路径}")
                部分.append(f"\n直接输出以下JSON即可（只需修改新文本字段）:")
                部分.append(f'{{"思考": "根据用户指令处理框选文本", "操作": "替换文本", "参数": {{"路径": "{框选文件路径}", "旧文本": {旧文本JSON}, "新文本": "修改后的内容"}}}}')
                部分.append(f"\n例如删除就写: \"新文本\": \"\"")
                部分.append(f"例如改写就写: \"新文本\": \"改写后的文本\"")
        # 文件操作提示
        部分.append("\n你可以通过以下操作来操作文件（在回复中使用JSON格式调用）:")
        if 框选 and 框选.get("内容"):
            # 有框选时不再重复列出其他操作，避免模型分心
            pass
        else:
            部分.append("""```json
{"思考": "分析需求", "操作": "读取文件", "参数": {"路径": "文件路径"}}
{"思考": "分析需求", "操作": "写入文件", "参数": {"路径": "文件路径", "内容": "文件内容"}}
{"思考": "分析需求", "操作": "创建文件", "参数": {"路径": "文件路径", "内容": "初始内容"}}
{"思考": "分析需求", "操作": "追加文件", "参数": {"路径": "文件路径", "内容": "追加内容"}}
{"思考": "分析需求", "操作": "列出目录", "参数": {"路径": "目录路径"}}
{"思考": "分析需求", "操作": "删除文件", "参数": {"路径": "文件路径"}}
{"思考": "分析需求", "操作": "替换文本", "参数": {"路径": "文件路径", "旧文本": "被替换的原文", "新文本": "替换后的新文本"}}
```""")
        return "\n".join(部分)

    def _返回文件(self, 路径: Path, 类型: str):
        try:
            if 路径.exists():
                self.send_response(200)
                self.send_header("Content-Type", f"{类型}; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "http://localhost:8765")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                with open(路径, "rb") as f:
                    self.wfile.write(f.read())
            else:
                self.send_response(404)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write("file not found".encode("utf-8"))
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass  # 客户端已断开，无需处理

    def _返回JSON(self, 数据: dict, 状态码: int = 200):
        try:
            self.send_response(状态码)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "http://localhost:8765")
            self.end_headers()
            self.wfile.write(json.dumps(数据, ensure_ascii=False).encode("utf-8"))
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass  # 客户端已断开（如用户点停止），无需记录

    def _打开文件夹选择对话框(self) -> str:
        """用tkinter弹出Windows原生文件夹选择对话框"""
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)
            result = filedialog.askdirectory(title="选择文件夹")
            root.destroy()
            return result or ""
        except Exception as e:
            print(f"⚠ 文件夹选择对话框失败: {e}")
            return ""

    def _猜测类型(self, 路径: str) -> str:
        后缀映射 = {
            ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
            ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
            ".svg": "image/svg+xml", ".ico": "image/x-icon"
        }
        后缀 = Path(路径).suffix.lower()
        return 后缀映射.get(后缀, "application/octet-stream")

    def log_message(self, format, *args):
        """输出简要HTTP请求日志"""
        print(f"  [{self.log_date_time_string()}] {args[0] if args else ''}")


class 网页服务类:
    """Web服务管理器"""

    def __init__(self, 端口: int, 界面目录: Path):
        self.端口 = 端口
        self.界面目录 = 界面目录
        self.服务器 = None

    def 启动(self, 文件管理器=None, 配置加载器=None, 模型直连器=None,
             模块注册=None, 操作注册中心=None, 启动器实例=None, 运行诊断器=None):
        网页请求处理器.界面目录 = self.界面目录
        网页请求处理器.文件管理器 = 文件管理器
        网页请求处理器.配置加载器 = 配置加载器
        网页请求处理器.模型直连器 = 模型直连器
        网页请求处理器.模块注册 = 模块注册
        网页请求处理器.操作注册中心 = 操作注册中心
        网页请求处理器.运行诊断器 = 运行诊断器
        网页请求处理器._启动器实例 = 启动器实例
        # 设置当前模型名
        if 模型直连器:
            网页请求处理器.当前模型名 = 模型直连器.当前模型名

        self.服务器 = ThreadingHTTPServer(("0.0.0.0", self.端口), 网页请求处理器)
        print(f"🌐 Web服务已启动: http://localhost:{self.端口}")
        self.服务器.serve_forever()

    def 停止(self):
        if self.服务器:
            self.服务器.shutdown()
            print("🌐 Web服务已停止")
