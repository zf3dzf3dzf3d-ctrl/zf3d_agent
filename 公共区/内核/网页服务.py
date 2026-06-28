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
            查询串 = 解析结果.query or ""

            if 路径 == "/" or 路径 == "/index.html":
                self._返回文件(self.界面目录 / "主页.html", "text/html", 查询串)
            elif ".." in 路径:
                # 防止路径穿越攻击
                self.send_response(403)
                self.end_headers()
                self.wfile.write("forbidden".encode("utf-8"))
            elif 路径.endswith(".css"):
                self._返回文件(self.界面目录 / 路径.lstrip("/"), "text/css", 查询串)
            elif 路径.endswith(".js"):
                self._返回文件(self.界面目录 / 路径.lstrip("/"), "application/javascript", 查询串)
            elif 路径.startswith("/api/"):
                self._处理API_GET(路径, 解析结果)
            else:
                self._返回文件(self.界面目录 / 路径.lstrip("/"), self._猜测类型(路径), 查询串)
        except Exception as e:
            if isinstance(e, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, OSError)):
                return  # 客户端已断开/连接异常，无需处理
            print(f"  ❌ GET异常: {e}")
            if self.运行诊断器:
                self.运行诊断器.记录错误("网页服务.do_GET", e)
            try:
                self._返回JSON({"错误": f"服务器异常: {str(e)}"}, 500)
            except Exception:
                return  # 响应也失败了，放弃

    def do_POST(self):
        try:
            解析结果 = urlparse(self.path)
            路径 = unquote(解析结果.path)
            if 路径.startswith("/api/"):
                内容长度 = int(self.headers.get("Content-Length", 0))
                原始体 = self.rfile.read(内容长度) if 内容长度 > 0 else b"{}"
                ctype = self.headers.get("Content-Type", "")
                if "multipart/form-data" in ctype:
                    # multipart请求不解析JSON，保留原始字节供handler读取
                    self._multipart_body = 原始体
                    self._处理API_POST(路径, {})
                else:
                    请求体 = 原始体.decode("utf-8") if 原始体 else "{}"
                    try:
                        请求数据 = json.loads(请求体)
                    except json.JSONDecodeError:
                        请求数据 = {}
                    self._处理API_POST(路径, 请求数据)
            else:
                self._返回JSON({"错误": "未知路径"}, 404)
        except Exception as e:
            if isinstance(e, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, OSError)):
                return  # 客户端已断开/连接异常，无需处理
            print(f"  ❌ POST异常: {e}")
            if self.运行诊断器:
                self.运行诊断器.记录错误("网页服务.do_POST", e)
            try:
                self._返回JSON({"错误": f"服务器异常: {str(e)}"}, 500)
            except Exception:
                return  # 响应也失败了，放弃

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
        elif 路径 == "/api/stock-panel":
            """股票盘面：指数+涨幅榜+跌幅榜+市场总览（缓存）"""
            参数 = parse_qs(解析结果.query)
            页码 = int(参数.get("page", ["1"])[0])
            from 股票缓存 import 获取股票缓存
            缓存 = 获取股票缓存()
            结果 = 缓存.读取或请求(f"panel_{页码}", "panel", lambda: self._获取股票盘面(页码))
            self._返回JSON(结果)
        elif 路径 == "/api/stock-kline":
            """股票K线数据（支持日K/周K/月K，缓存+增量更新）"""
            参数 = parse_qs(解析结果.query)
            代码 = 参数.get("code", [""])[0]
            周期 = 参数.get("period", ["daily"])[0]
            from 股票缓存 import 获取股票缓存
            缓存 = 获取股票缓存()
            结果 = 缓存.读取或请求(f"kline_{代码}_{周期}", "kline", lambda: self._获取股票K线(代码, 周期))
            self._返回JSON(结果)
        elif 路径 == "/api/stock-minute":
            """股票分时数据（缓存）"""
            参数 = parse_qs(解析结果.query)
            代码 = 参数.get("code", [""])[0]
            from 股票缓存 import 获取股票缓存
            缓存 = 获取股票缓存()
            结果 = 缓存.读取或请求(f"minute_{代码}", "minute", lambda: self._获取股票分时(代码))
            self._返回JSON(结果)
        elif 路径 == "/api/stock-search":
            """搜索股票（代码/名称模糊匹配，缓存）"""
            参数 = parse_qs(解析结果.query)
            关键词 = 参数.get("q", [""])[0]
            from 股票缓存 import 获取股票缓存
            缓存 = 获取股票缓存()
            结果 = 缓存.读取或请求(f"search_{关键词}", "search", lambda: self._搜索股票(关键词))
            self._返回JSON(结果)
        elif 路径 == "/api/stock-detail":
            """个股详情（PE/PB/市值/换手率等，缓存）"""
            参数 = parse_qs(解析结果.query)
            代码 = 参数.get("code", [""])[0]
            from 股票缓存 import 获取股票缓存
            缓存 = 获取股票缓存()
            结果 = 缓存.读取或请求(f"detail_{代码}", "detail", lambda: self._获取股票详情(代码))
            self._返回JSON(结果)
        elif 路径 == "/api/stock-sectors":
            """板块行情（行业+概念，缓存）"""
            from 股票缓存 import 获取股票缓存
            缓存 = 获取股票缓存()
            结果 = 缓存.读取或请求("sectors", "sectors", lambda: self._获取板块行情())
            self._返回JSON(结果)
        elif 路径 == "/api/stock-capital-flow":
            """个股资金流向明细（缓存）"""
            参数 = parse_qs(解析结果.query)
            代码 = 参数.get("code", [""])[0]
            from 股票缓存 import 获取股票缓存
            缓存 = 获取股票缓存()
            结果 = 缓存.读取或请求(f"flow_{代码}", "flow", lambda: self._获取资金流向(代码))
            self._返回JSON(结果)
        elif 路径 == "/api/stock-batch":
            """批量查询自选股行情"""
            参数 = parse_qs(解析结果.query)
            代码列表 = 参数.get("codes", [""])[0].split(",")
            代码列表 = [c.strip() for c in 代码列表 if c.strip()]
            self._返回JSON(self._批量查询行情(代码列表))
        elif 路径 == "/api/stock-export":
            """导出K线数据为CSV"""
            参数 = parse_qs(解析结果.query)
            代码 = 参数.get("code", [""])[0]
            周期 = 参数.get("period", ["daily"])[0]
            self._返回CSV(self._导出K线CSV(代码, 周期), f"{代码}_{周期}.csv")
        elif 路径 == "/api/stock-cache-stats":
            """股票缓存统计"""
            from 股票缓存 import 获取股票缓存
            缓存 = 获取股票缓存()
            self._返回JSON({"成功": True, "统计": 缓存.获取缓存统计()})
        elif 路径 == "/api/stock-cache-clear":
            """清空股票缓存"""
            from 股票缓存 import 获取股票缓存
            缓存 = 获取股票缓存()
            缓存.清空缓存()
            self._返回JSON({"成功": True, "消息": "股票缓存已清空"})
        elif 路径 == "/api/stock-bulk-start":
            """启动全量K线+财务数据下载"""
            参数 = parse_qs(解析结果.query)
            周期 = 参数.get("period", ["daily"])[0]
            增量 = 参数.get("incremental", ["1"])[0] != "0"
            含财务 = 参数.get("finance", ["1"])[0] != "0"
            强制刷新 = 参数.get("refresh", ["0"])[0] == "1"
            print(f"[股票下载] 启动请求: 周期={周期} 增量={增量} 财务={含财务} 刷新={强制刷新}")
            from 股票缓存 import 获取下载引擎
            引擎 = 获取下载引擎()
            结果 = 引擎.启动下载(周期, 增量, 含财务, 强制刷新列表=强制刷新)
            print(f"[股票下载] 启动结果: {结果}")
            self._返回JSON(结果)
        elif 路径 == "/api/stock-bulk-progress":
            """查询全量下载进度"""
            from 股票缓存 import 获取下载引擎, 获取股票缓存
            引擎 = 获取下载引擎()
            缓存 = 获取股票缓存()
            进度 = 引擎.获取进度()
            统计 = 缓存.取本地K线统计()
            财务统计 = 缓存.取财务数据统计()
            self._返回JSON({"成功": True, "进度": 进度, "本地统计": 统计, "财务统计": 财务统计})
        elif 路径 == "/api/stock-bulk-stop":
            """停止全量下载"""
            from 股票缓存 import 获取下载引擎
            引擎 = 获取下载引擎()
            引擎.停止()
            self._返回JSON({"成功": True, "消息": "正在停止..."})
        elif 路径 == "/api/stock-finance":
            """查询单只股票本地财务数据"""
            参数 = parse_qs(解析结果.query)
            代码 = 参数.get("code", [""])[0]
            from 股票缓存 import 获取股票缓存
            缓存 = 获取股票缓存()
            数据 = 缓存.取财务数据(代码)
            self._返回JSON({"成功": True, "数据": 数据})
        elif 路径 == "/api/drives":
            # 返回可用磁盘驱动器列表 + 用户文件夹快捷方式
            驱动器列表 = []
            用户目录 = os.path.expanduser("~")
            快捷方式列表 = [
                {"盘符": "桌面", "路径": os.path.join(用户目录, "Desktop"), "标签": "桌面", "图标": "🖥️", "类型": "文件夹"},
                {"盘符": "文档", "路径": os.path.join(用户目录, "Documents"), "标签": "文档", "图标": "📄", "类型": "文件夹"},
                {"盘符": "下载", "路径": os.path.join(用户目录, "Downloads"), "标签": "下载", "图标": "📥", "类型": "文件夹"},
                {"盘符": "图片", "路径": os.path.join(用户目录, "Pictures"), "标签": "图片", "图标": "🖼️", "类型": "文件夹"},
            ]
            for 快捷方式 in 快捷方式列表:
                if os.path.exists(快捷方式["路径"]):
                    驱动器列表.append(快捷方式)
            if sys.platform == "win32":
                for 盘符 in string.ascii_uppercase:
                    驱动器路径 = f"{盘符}:\\"
                    if os.path.exists(驱动器路径):
                        try:
                            使用 = shutil.disk_usage(驱动器路径)
                            总大小GB = round(使用.total / (1024**3), 1)
                            已用GB = round(使用.used / (1024**3), 1)
                            可用GB = round(使用.free / (1024**3), 1)
                            驱动器列表.append({
                                "盘符": f"{盘符}:",
                                "路径": 驱动器路径,
                                "标签": f"本地磁盘 {盘符}",
                                "图标": "💾",
                                "类型": "磁盘",
                                "总大小GB": 总大小GB,
                                "已用GB": 已用GB,
                                "可用GB": 可用GB,
                            })
                        except:
                            驱动器列表.append({"盘符": f"{盘符}:", "路径": 驱动器路径, "标签": f"本地磁盘 {盘符}", "图标": "💾", "类型": "磁盘"})
            else:
                驱动器列表.append({"盘符": "/", "路径": "/", "标签": "根目录", "图标": "💾", "类型": "磁盘"})
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
        elif 路径 == "/api/file-move":
            结果 = self.文件管理器.移动(数据.get("源路径", ""), 数据.get("目标目录", ""))
            self._返回JSON(结果)
        elif 路径 == "/api/file-copy":
            结果 = self.文件管理器.复制(数据.get("源路径", ""), 数据.get("目标目录", ""), 数据.get("新名称", None))
            self._返回JSON(结果)
        elif 路径 == "/api/file-replace":
            结果 = self.文件管理器.替换文本(
                数据.get("路径", ""),
                数据.get("旧文本", ""),
                数据.get("新文本", "")
            )
            self._返回JSON(结果)
        elif 路径 == "/api/save-image":
            """保存图片文件（直接二进制body）"""
            保存路径 = 数据.get("路径", "")
            if not 保存路径:
                self._返回JSON({"成功": False, "错误": "缺少路径"})
                return
            # 数据字段是 base64 编码的图片
            图片数据 = 数据.get("数据", "")
            if not 图片数据:
                self._返回JSON({"成功": False, "错误": "缺少数据"})
                return
            # 去掉 data:image/png;base64, 前缀
            if "," in 图片数据:
                图片数据 = 图片数据.split(",", 1)[1]
            try:
                import base64
                字节 = base64.b64decode(图片数据)
                # 确保目录存在
                import os
                目录 = os.path.dirname(保存路径)
                if 目录 and not os.path.exists(目录):
                    os.makedirs(目录, exist_ok=True)
                with open(保存路径, "wb") as f:
                    f.write(字节)
                print(f"  ✅ 图片已保存: {保存路径} ({len(字节)} 字节)")
                self._返回JSON({"成功": True, "路径": 保存路径})
            except Exception as e:
                print(f"  ❌ 图片保存失败: {e}")
                self._返回JSON({"成功": False, "错误": str(e)})
        elif 路径 == "/api/image-inpaint":
            """图片加工 - OpenCV去水印/去杂物 (multipart/form-data: image, mask, algorithm, radius)"""
            try:
                import cv2
                import base64
                import numpy as np

                ctype = self.headers.get("Content-Type", "")
                if "multipart/form-data" not in ctype:
                    self._返回JSON({"成功": False, "错误": "需要multipart/form-data"})
                    return

                # 解析multipart
                boundary = ctype.split("boundary=")[1].encode()
                body = getattr(self, '_multipart_body', b'')
                parts = body.split(b"--" + boundary)

                image_data = None
                mask_data = None
                algorithm = "TELEA"
                radius = 3

                for part in parts:
                    if b"Content-Disposition" not in part:
                        continue
                    header_end = part.find(b"\r\n\r\n")
                    if header_end < 0:
                        continue
                    header = part[:header_end].decode("utf-8", errors="replace")
                    content = part[header_end+4:]
                    if content.endswith(b"\r\n"):
                        content = content[:-2]

                    if 'name="image"' in header:
                        image_data = content
                    elif 'name="mask"' in header:
                        mask_data = content
                    elif 'name="algorithm"' in header:
                        algorithm = content.decode("utf-8", errors="replace")
                    elif 'name="radius"' in header:
                        radius = int(content.decode("utf-8", errors="replace"))

                if not image_data or not mask_data:
                    self._返回JSON({"成功": False, "错误": "缺少图片或遮罩"})
                    return

                # 解码图片和遮罩
                img_arr = np.frombuffer(image_data, np.uint8)
                img = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
                mask_arr = np.frombuffer(mask_data, np.uint8)
                mask = cv2.imdecode(mask_arr, cv2.IMREAD_GRAYSCALE)

                if img is None or mask is None:
                    self._返回JSON({"成功": False, "错误": "无法解码图片"})
                    return

                # 尺寸对齐
                if img.shape[:2] != mask.shape[:2]:
                    mask = cv2.resize(mask, (img.shape[1], img.shape[0]))

                # 二值化遮罩
                _, mask = cv2.threshold(mask, 128, 255, cv2.THRESH_BINARY)

                # 膨胀遮罩边缘，扩大修复区域3px，减少接缝
                kernel = np.ones((3, 3), np.uint8)
                mask = cv2.dilate(mask, kernel, iterations=1)

                alg = cv2.INPAINT_NS if algorithm == "NS" else cv2.INPAINT_TELEA
                result = cv2.inpaint(img, mask, radius, alg)

                # 对修复区域边缘做羽化混合，消除接缝色差
                feather_mask = cv2.GaussianBlur(mask.astype(np.float32), (21, 21), 0)
                feather_mask = np.clip(feather_mask / 255.0, 0, 1)
                feather_3ch = cv2.merge([feather_mask, feather_mask, feather_mask])
                blended = (img.astype(np.float32) * (1 - feather_3ch) +
                          result.astype(np.float32) * feather_3ch)
                result = blended.astype(np.uint8)

                # 编码返回
                _, buf = cv2.imencode(".png", result)
                b64 = base64.b64encode(buf).decode("utf-8")
                self._返回JSON({"成功": True, "图片": b64})
            except ImportError:
                self._返回JSON({"成功": False, "错误": "opencv-python未安装"})
            except Exception as e:
                self._返回JSON({"成功": False, "错误": str(e)})
        elif 路径 == "/api/permission":
            self.文件管理器.用户确认权限(
                数据.get("路径", ""),
                数据.get("操作", "读"),
                数据.get("选择", "拒绝")
            )
            self._返回JSON({"成功": True})
        elif 路径 == "/api/ask-user-response":
            """用户在前端提交询问回答"""
            from 操作.询问用户 import 询问用户
            结果 = 询问用户.提交回答(数据.get("id", ""), 数据.get("回答", {}))
            self._返回JSON(结果)
        elif 路径 == "/api/ask-user-pending":
            """获取待答询问列表（SSE失败时轮询兼容）"""
            from 操作.询问用户 import 询问用户
            self._返回JSON({"待答": 询问用户.获取待答()})
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
        elif 路径 == "/api/tool-keys":
            """工具密钥管理（Tavily等非LLM工具的API Key）"""
            if not self.模型直连器:
                self._返回JSON({"错误": "模型直连器未初始化"})
            elif not 数据:
                # GET：返回工具密钥状态（掩码）
                密钥列表 = self.模型直连器.密钥配置.get("密钥列表", {})
                tavily配置 = 密钥列表.get("TAVILY", {})
                tavily密钥 = tavily配置.get("API密钥", "") if isinstance(tavily配置, dict) else ""
                掩码密钥 = (tavily密钥[:6] + "****" + tavily密钥[-4:]) if len(tavily密钥) > 12 else ("已配置" if tavily密钥 else "")
                self._返回JSON({"成功": True, "工具列表": [
                    {"名称": "Tavily", "描述": "AI搜索引擎，网络搜索+网页抓取", "密钥字段": "API密钥", "已配置": bool(tavily密钥), "掩码值": 掩码密钥}
                ]})
            else:
                # POST：保存工具密钥
                工具名 = 数据.get("工具", "")
                密钥值 = 数据.get("密钥", "")
                if 工具名 == "Tavily" and 密钥值:
                    self.模型直连器.保存模型密钥("TAVILY", {"API密钥": 密钥值})
                    密钥路径 = self.配置加载器.项目根目录 / "隐私区" / "我的配置" / "密钥.json"
                    try:
                        from 模型直连器 import 加密密钥配置
                        加密后配置 = 加密密钥配置(self.模型直连器.密钥配置)
                        with open(密钥路径, "w", encoding="utf-8") as f:
                            json.dump(加密后配置, f, ensure_ascii=False, indent=2)
                        self._返回JSON({"成功": True, "消息": "Tavily密钥已保存（加密存储）"})
                    except Exception as e:
                        self._返回JSON({"错误": f"保存失败: {e}"})
                else:
                    self._返回JSON({"错误": "不支持的工具或密钥为空"})
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
            网页请求处理器._tts停止标志 = True  # 先停止之前的播放
            import time as _time; _time.sleep(0.1)  # 等待旧线程退出
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
        elif 路径 == "/api/check-update":
            """检查GitHub是否有新版本"""
            try:
                from 更新检查器 import 更新检查器类
                系统配置 = self.配置加载器.配置缓存.get("系统配置", {})
                系统配置["项目根目录"] = str(self.配置加载器.项目根目录)
                检查器 = 更新检查器类(系统配置)
                结果 = 检查器.检查更新(强制=数据.get("强制", False))
                self._返回JSON(结果)
            except Exception as e:
                self._返回JSON({"有更新": False, "错误": str(e)})
        elif 路径 == "/api/do-update":
            """执行更新：下载并覆盖公共区"""
            try:
                from 更新检查器 import 更新检查器类
                系统配置 = self.配置加载器.配置缓存.get("系统配置", {})
                系统配置["项目根目录"] = str(self.配置加载器.项目根目录)
                检查器 = 更新检查器类(系统配置)
                下载地址 = 数据.get("下载地址", "")
                if not 下载地址:
                    结果 = 检查器.检查更新(强制=True)
                    下载地址 = 结果.get("下载地址", "")
                if not 下载地址:
                    self._返回JSON({"成功": False, "错误": "无法获取下载地址"})
                    return
                结果 = 检查器.执行更新(下载地址)
                self._返回JSON(结果)
            except Exception as e:
                self._返回JSON({"成功": False, "错误": str(e)})
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
                # 同步patch操作注册中心的进度回调，使操作（如询问用户）也走SSE
                if self.操作注册中心:
                    self.操作注册中心.设置进度回调(_SSE推入)

                结果 = 对话模块.运行({"消息": 消息})

                # 恢复原始方法
                对话模块._推入推理流 = 原始推入
                if self.操作注册中心:
                    self.操作注册中心.设置进度回调(原始推入)

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

    def _返回文件(self, 路径: Path, 类型: str, 查询串: str = ""):
        try:
            if 路径.exists():
                self.send_response(200)
                self.send_header("Content-Type", f"{类型}; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "http://localhost:8765")
                # 带版本号的静态资源(?v=xxx)长期缓存；动态内容(如逻辑.js)用no-cache
                if "?v=" in 查询串 or "&v=" in 查询串:
                    self.send_header("Cache-Control", "max-age=86400")  # 缓存1天
                else:
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

    # ============ 股票数据接口 ============

    def _东财请求(self, url, headers=None):
        """东方财富API请求（带重试）"""
        import urllib.request
        默认headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://quote.eastmoney.com/"
        }
        if headers:
            默认headers.update(headers)
        for 尝试 in range(3):
            try:
                req = urllib.request.Request(url, headers=默认headers)
                resp = urllib.request.urlopen(req, timeout=8)
                return json.loads(resp.read().decode("utf-8"))
            except Exception:
                if 尝试 >= 2:
                    raise
                import time; time.sleep(0.3)

    def _获取股票盘面(self, 页码: int = 1) -> dict:
        """获取盘面数据：指数+涨幅榜+跌幅榜+市场总览"""
        from datetime import datetime
        try:
            # 1. 获取指数
            指数 = []
            指数代码 = [
                ("1.000001", "上证指数"), ("0.399001", "深证成指"),
                ("0.399006", "创业板指"), ("1.000688", "科创50")
            ]
            指数url = "https://push2.eastmoney.com/api/qt/ulist.np/get?fields=f1,f2,f3,f4,f12,f14&secids=" + ",".join([c for c, _ in 指数代码])
            try:
                数据 = self._东财请求(指数url)
                for item in (数据.get("data", {}).get("diff", {}) or {}).values():
                    指数.append({
                        "代码": item.get("f12", ""),
                        "名称": item.get("f14", ""),
                        "最新价": round(item.get("f2", 0) / 100, 2) if item.get("f2") else 0,
                        "涨跌幅": round(item.get("f3", 0) / 100, 2) if item.get("f3") else 0
                    })
            except Exception:
                pass

            # 2. 获取涨幅榜（A股，按涨幅降序，支持翻页）
            涨幅榜 = []
            总数涨 = 0
            url涨 = f"https://push2.eastmoney.com/api/qt/clist/get?pn={页码}&pz=20&po=1&np=1&fltt=2&invt=2&fields=f2,f3,f6,f7,f8,f9,f10,f12,f14,f15,f16,f17,f18,f20,f21,f62,f184,f66&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fid=f3"
            try:
                数据 = self._东财请求(url涨)
                总数涨 = 数据.get("data", {}).get("total", 0)
                for item in (数据.get("data", {}).get("diff", []) or []):
                    涨幅榜.append({
                        "代码": item.get("f12", ""),
                        "名称": item.get("f14", ""),
                        "最新价": round(item.get("f2", 0) / 100, 2) if item.get("f2") else 0,
                        "涨幅": round(item.get("f3", 0) / 100, 2) if item.get("f3") else 0,
                        "涨速": round(item.get("f7", 0) / 100, 2) if item.get("f7") else 0,
                        "主力净流入": round((item.get("f62", 0) or 0) / 100000000, 2),
                        "成交额": self._格式化成交额(item.get("f6", 0)),
                        "量比": round(item.get("f8", 0) / 100, 2) if item.get("f8") else 0,
                        "换手率": round(item.get("f8", 0) / 100, 2) if item.get("f8") else 0,
                        "PE": round(item.get("f9", 0) / 100, 2) if item.get("f9") else 0,
                        "PB": round(item.get("f10", 0) / 100, 2) if item.get("f10") else 0
                    })
            except Exception:
                pass

            # 3. 获取跌幅榜
            跌幅榜 = []
            url跌 = "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=10&po=0&np=1&fltt=2&invt=2&fields=f2,f3,f6,f12,f14,f62&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fid=f3"
            try:
                数据 = self._东财请求(url跌)
                for item in (数据.get("data", {}).get("diff", []) or []):
                    跌幅榜.append({
                        "代码": item.get("f12", ""),
                        "名称": item.get("f14", ""),
                        "最新价": round(item.get("f2", 0) / 100, 2) if item.get("f2") else 0,
                        "涨幅": round(item.get("f3", 0) / 100, 2) if item.get("f3") else 0,
                        "主力净流入": round((item.get("f62", 0) or 0) / 100000000, 2),
                        "成交额": self._格式化成交额(item.get("f6", 0))
                    })
            except Exception:
                pass

            # 4. 市场总览：涨跌家数、涨停跌停数
            市场总览 = {"上涨": 0, "下跌": 0, "平盘": 0, "涨停": 0, "跌停": 0}
            try:
                url总 = "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5000&po=1&np=1&fltt=2&invt=2&fields=f3,f12&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fid=f3"
                数据总 = self._东财请求(url总)
                for item in (数据总.get("data", {}).get("diff", []) or []):
                    pct = round(item.get("f3", 0) / 100, 2) if item.get("f3") else 0
                    code = item.get("f12", "")
                    涨停幅 = 19.9 if (code.startswith("30") or code.startswith("68")) else 9.9
                    跌停幅 = -19.9 if (code.startswith("30") or code.startswith("68")) else -9.9
                    if pct > 0:
                        市场总览["上涨"] += 1
                        if pct >= 涨停幅:
                            市场总览["涨停"] += 1
                    elif pct < 0:
                        市场总览["下跌"] += 1
                        if pct <= 跌停幅:
                            市场总览["跌停"] += 1
                    else:
                        市场总览["平盘"] += 1
            except Exception:
                pass

            return {
                "成功": True,
                "时间": datetime.now().strftime("%H:%M:%S"),
                "指数": 指数,
                "涨幅榜": 涨幅榜,
                "跌幅榜": 跌幅榜,
                "市场总览": 市场总览,
                "涨幅榜总数": 总数涨,
                "当前页": 页码
            }
        except Exception as e:
            return {"成功": False, "错误": str(e)}

    def _格式化成交额(self, 值):
        """格式化成交额（东财返回的是元）"""
        if not 值: return "-"
        亿 = 值 / 100000000
        if 亿 >= 1: return f"{亿:.1f}亿"
        万 = 值 / 10000
        return f"{万:.0f}万"

    def _获取股票K线(self, 代码: str, 周期: str = "daily") -> dict:
        """获取K线数据（支持日K/周K/月K）"""
        try:
            secid = self._代码转secid(代码)
            if not secid:
                return {"成功": False, "错误": f"无法识别股票代码: {代码}"}
            周期映射 = {"daily": 101, "weekly": 102, "monthly": 103}
            klt = 周期映射.get(周期, 101)
            天数 = 120 if klt == 101 else (200 if klt == 102 else 240)
            url = f"https://push2his.eastmoney.com/api/qt/stock/kline/get?secid={secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt={klt}&fqt=1&beg=0&end=20500101&lmt={天数}"
            数据 = self._东财请求(url)
            klines = 数据.get("data", {}).get("klines", []) or []
            结果 = []
            for k in klines:
                parts = k.split(",")
                if len(parts) >= 7:
                    结果.append({
                        "日期": parts[0], "开": float(parts[1]),
                        "收": float(parts[2]), "高": float(parts[3]),
                        "低": float(parts[4]), "量": float(parts[5]),
                        "额": float(parts[6])
                    })
            # 股票信息
            info = 数据.get("data", {}) or {}
            股票信息 = {
                "名称": info.get("name", ""),
                "代码": info.get("code", 代码),
                "最新价": 结果[-1]["收"] if 结果 else 0,
                "涨跌幅": ((结果[-1]["收"] - 结果[-2]["收"]) / 结果[-2]["收"] * 100) if len(结果) >= 2 else 0
            }
            # 计算MA5/MA10/MA20
            if len(结果) >= 5:
                股票信息["MA5"] = round(sum(d["收"] for d in 结果[-5:]) / 5, 2)
            if len(结果) >= 10:
                股票信息["MA10"] = round(sum(d["收"] for d in 结果[-10:]) / 10, 2)
            if len(结果) >= 20:
                股票信息["MA20"] = round(sum(d["收"] for d in 结果[-20:]) / 20, 2)
            # 计算完整MA序列（供前端画线）
            ma5_list, ma10_list, ma20_list = [], [], []
            for i in range(len(结果)):
                if i >= 4:
                    ma5_list.append(round(sum(d["收"] for d in 结果[i-4:i+1]) / 5, 2))
                else:
                    ma5_list.append(None)
                if i >= 9:
                    ma10_list.append(round(sum(d["收"] for d in 结果[i-9:i+1]) / 10, 2))
                else:
                    ma10_list.append(None)
                if i >= 19:
                    ma20_list.append(round(sum(d["收"] for d in 结果[i-19:i+1]) / 20, 2))
                else:
                    ma20_list.append(None)
            return {"成功": True, "数据": 结果, "MA5": ma5_list, "MA10": ma10_list, "MA20": ma20_list, "股票信息": 股票信息, "周期": 周期}
        except Exception as e:
            return {"成功": False, "错误": str(e)}

    def _获取股票分时(self, 代码: str) -> dict:
        """获取分时数据"""
        try:
            secid = self._代码转secid(代码)
            if not secid:
                return {"成功": False, "错误": f"无法识别股票代码: {代码}"}
            url = f"https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid={secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57&iscr=0&ndays=1"
            数据 = self._东财请求(url)
            trends = 数据.get("data", {}).get("trends", []) or []
            结果 = []
            for t in trends:
                parts = t.split(",")
                if len(parts) >= 6:
                    结果.append({
                        "时间": parts[0],
                        "价格": float(parts[1]),
                        "均价": float(parts[2]) if len(parts) > 2 else None,
                        "量": float(parts[4]) if len(parts) > 4 else 0
                    })
            info = 数据.get("data", {}) or {}
            昨收 = info.get("prePreClose", 0) or info.get("preClose", 0)
            股票信息 = {
                "名称": info.get("name", ""),
                "代码": info.get("code", 代码),
                "最新价": 结果[-1]["价格"] if 结果 else 0,
                "涨跌幅": ((结果[-1]["价格"] - 昨收) / 昨收 * 100) if 结果 and 昨收 else 0
            }
            return {"成功": True, "数据": 结果, "昨收价": 昨收, "股票信息": 股票信息}
        except Exception as e:
            return {"成功": False, "错误": str(e)}

    def _代码转secid(self, 代码: str) -> str:
        """股票代码转东财secid（如 600519 → 1.600519, 000001 → 0.000001）"""
        代码 = 代码.strip()
        # 指数
        指数映射 = {"000001": "1.000001", "399001": "0.399001", "399006": "0.399006", "000688": "1.000688"}
        if 代码 in 指数映射:
            return 指数映射[代码]
        # 个股：6开头=上海(1)，0/3开头=深圳(0)
        if 代码.startswith("6"):
            return f"1.{代码}"
        elif 代码.startswith(("0", "3")):
            return f"0.{代码}"
        elif 代码.startswith("8") or 代码.startswith("4"):
            return f"0.{代码}"  # 北交所
        return ""

    def _批量查询行情(self, 代码列表: list) -> dict:
        """批量查询多只股票的实时行情（一次API请求）"""
        try:
            if not 代码列表:
                return {"成功": True, "数据": []}
            from 股票缓存 import 获取股票缓存
            缓存 = 获取股票缓存()
            # 先查缓存
            joined_codes = "-".join(sorted(代码列表))
            缓存键 = "batch_" + joined_codes
            cached = 缓存.读取缓存(缓存键, "batch")
            if cached is not None:
                return cached
            # 批量请求东财
            secids = []
            for 代码 in 代码列表:
                secid = self._代码转secid(代码)
                if secid:
                    secids.append(secid)
            if not secids:
                return {"成功": False, "错误": "无有效代码"}
            url = "https://push2.eastmoney.com/api/qt/ulist.np/get?fields=f2,f3,f4,f6,f12,f14,f15,f16,f17,f62&secids=" + ",".join(secids)
            数据 = self._东财请求(url)
            结果 = []
            for item in (数据.get("data", {}).get("diff", {}) or {}).values():
                结果.append({
                    "代码": item.get("f12", ""),
                    "名称": item.get("f14", ""),
                    "最新价": round(item.get("f2", 0) / 100, 2) if item.get("f2") else 0,
                    "涨跌幅": round(item.get("f3", 0) / 100, 2) if item.get("f3") else 0,
                    "涨跌额": round(item.get("f4", 0) / 100, 2) if item.get("f4") else 0,
                    "成交额": self._格式化成交额(item.get("f6", 0)),
                    "最高": round(item.get("f15", 0) / 100, 2) if item.get("f15") else 0,
                    "最低": round(item.get("f16", 0) / 100, 2) if item.get("f16") else 0,
                    "主力净流入": round((item.get("f62", 0) or 0) / 100000000, 2)
                })
            返回 = {"成功": True, "数据": 结果}
            缓存.写入缓存(缓存键, "batch", 返回)
            return 返回
        except Exception as e:
            return {"成功": False, "错误": str(e)}

    def _导出K线CSV(self, 代码: str, 周期: str = "daily") -> str:
        """导出K线数据为CSV字符串"""
        from 股票缓存 import 获取股票缓存
        缓存 = 获取股票缓存()
        数据 = 缓存.读取或请求(f"kline_{代码}_{周期}", "kline", lambda: self._获取股票K线(代码, 周期))
        if not 数据 or not 数据.get("成功"):
            return "错误,数据获取失败\n"
        lines = ["日期,开盘,收盘,最高,最低,成交量,成交额"]
        for d in 数据.get("数据", []):
            lines.append(f"{d['日期']},{d['开']},{d['收']},{d['高']},{d['低']},{d['量']},{d['额']}")
        return "\n".join(lines)

    def _返回CSV(self, csv内容: str, 文件名: str):
        """返回CSV文件下载响应"""
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{文件名}"')
        body = csv内容.encode("utf-8-sig")  # BOM for Excel
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _搜索股票(self, 关键词: str) -> dict:
        """搜索股票（代码/名称模糊匹配）"""
        try:
            关键词 = 关键词.strip()
            if not 关键词:
                return {"成功": True, "结果": []}
            url = f"https://searchapi.eastmoney.com/api/suggest/get?input={关键词}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8"
            数据 = self._东财请求(url)
            结果 = []
            for item in (数据.get("QuotationCodeTable", {}).get("Data", []) or []):
                code = item.get("Code", "")
                name = item.get("Name", "")
                mkt = item.get("MktNum", "")
                # 只保留A股
                if mkt in ("0", "1") or code.startswith(("0", "3", "6", "8", "4")):
                    cat = "指数" if "指数" in name or "成指" in name else "A股"
                    结果.append({"代码": code, "名称": name, "类型": cat})
            return {"成功": True, "结果": 结果[:20]}
        except Exception as e:
            return {"成功": False, "错误": str(e)}

    def _获取股票详情(self, 代码: str) -> dict:
        """获取个股详情：PE/PB/市值/换手率等"""
        try:
            secid = self._代码转secid(代码)
            if not secid:
                return {"成功": False, "错误": f"无法识别股票代码: {代码}"}
            url = f"https://push2.eastmoney.com/api/qt/stock/get?secid={secid}&fields=f57,f58,f84,f85,f86,f92,f116,f117,f162,f167,f168,f169,f170,f171,f173,f177,f183,f184,f186,f187,f188,f190,f191"
            数据 = self._东财请求(url)
            d = 数据.get("data", {}) or {}
            if not d:
                return {"成功": False, "错误": "未获取到数据"}
            def _val(key):
                v = d.get(key, 0)
                return v if v else 0
            def _div100(key):
                v = d.get(key, 0)
                return round(v / 100, 2) if v else 0
            详情 = {
                "代码": d.get("f57", 代码),
                "名称": d.get("f58", ""),
                "最新价": _div100("f84") if d.get("f84") else _val("f43"),
                "涨跌幅": _div100("f170"),
                "涨跌额": _div100("f169"),
                "成交量": self._格式化成交额(d.get("f135", 0) or d.get("f5", 0)),
                "成交额": self._格式化成交额(d.get("f6", 0)),
                "振幅": _div100("f171"),
                "换手率": _div100("f168"),
                "市盈率(动)": _div100("f162"),
                "市盈率(静)": _div100("f167"),
                "市净率": _div100("f184"),
                "总市值": self._格式化成交额(d.get("f116", 0)),
                "流通市值": self._格式化成交额(d.get("f117", 0)),
                "52周最高": _div100("f177"),
                "52周最低": _div100("f183"),
                "上市日期": d.get("f186", ""),
            }
            return {"成功": True, "详情": 详情}
        except Exception as e:
            return {"成功": False, "错误": str(e)}

    def _获取板块行情(self) -> dict:
        """获取板块行情：行业板块+概念板块"""
        try:
            结果 = {"行业": [], "概念": []}
            # 行业板块
            url行 = "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=20&po=1&np=1&fltt=2&invt=2&fields=f2,f3,f4,f8,f12,f14,f104,f105,f128&fs=m:90+t:2&fid=f3"
            try:
                数据 = self._东财请求(url行)
                for item in (数据.get("data", {}).get("diff", []) or []):
                    结果["行业"].append({
                        "代码": item.get("f12", ""),
                        "名称": item.get("f14", ""),
                        "涨跌幅": round(item.get("f3", 0) / 100, 2) if item.get("f3") else 0,
                        "涨家数": item.get("f104", 0),
                        "跌家数": item.get("f105", 0),
                        "领涨股": item.get("f128", ""),
                        "换手率": round(item.get("f8", 0) / 100, 2) if item.get("f8") else 0
                    })
            except Exception:
                pass
            # 概念板块
            url概 = "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=20&po=1&np=1&fltt=2&invt=2&fields=f2,f3,f4,f8,f12,f14,f104,f105,f128&fs=m:90+t:3&fid=f3"
            try:
                数据 = self._东财请求(url概)
                for item in (数据.get("data", {}).get("diff", []) or []):
                    结果["概念"].append({
                        "代码": item.get("f12", ""),
                        "名称": item.get("f14", ""),
                        "涨跌幅": round(item.get("f3", 0) / 100, 2) if item.get("f3") else 0,
                        "涨家数": item.get("f104", 0),
                        "跌家数": item.get("f105", 0),
                        "领涨股": item.get("f128", ""),
                        "换手率": round(item.get("f8", 0) / 100, 2) if item.get("f8") else 0
                    })
            except Exception:
                pass
            return {"成功": True, "板块": 结果}
        except Exception as e:
            return {"成功": False, "错误": str(e)}

    def _获取资金流向(self, 代码: str) -> dict:
        """获取个股资金流向明细（近5日）"""
        try:
            secid = self._代码转secid(代码)
            if not secid:
                return {"成功": False, "错误": f"无法识别股票代码: {代码}"}
            url = f"https://push2.eastmoney.com/api/qt/stock/fflow/daykline/get?secid={secid}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65&lmt=5"
            数据 = self._东财请求(url)
            klines = 数据.get("data", {}).get("klines", []) or []
            结果 = []
            for k in klines:
                parts = k.split(",")
                if len(parts) >= 10:
                    结果.append({
                        "日期": parts[0],
                        "主力净流入": round(float(parts[1]) / 10000, 2),
                        "小单净流入": round(float(parts[2]) / 10000, 2),
                        "中单净流入": round(float(parts[3]) / 10000, 2),
                        "大单净流入": round(float(parts[5]) / 10000, 2) if len(parts) > 5 else 0,
                        "超大单净流入": round(float(parts[4]) / 10000, 2) if len(parts) > 4 else 0,
                        "主力净流入占比": round(float(parts[6]) / 100, 2) if len(parts) > 6 else 0
                    })
            return {"成功": True, "数据": 结果, "代码": 代码}
        except Exception as e:
            return {"成功": False, "错误": str(e)}


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
