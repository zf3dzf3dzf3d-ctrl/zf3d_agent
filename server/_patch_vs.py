# -*- coding: utf-8 -*-
"""一次性补丁：向 api_dispatch_get.py 注入 /api/video/stream 端点（幂等）"""
import io, sys

P = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2_发布版\server\routes\api_dispatch_get.py"

ROUTE_LINES = (
    "        # ===== 视频工作台本地预览流（带 Range 支持，供 <video> 标签播放） =====\n"
    "        if path == '/api/video/stream':\n"
    "            self._handle_video_stream(parsed)\n"
    "            return\n\n"
)

METHOD_BLOCK = '''
    # ===== 视频工作台本地预览流 =====
    _VIDEO_MIME = {
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
        '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.m4v': 'video/mp4',
        '.ts': 'video/mp2t', '.flv': 'video/x-flv', '.wmv': 'video/x-ms-wmv',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
        '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
        '.srt': 'text/plain; charset=utf-8',
    }

    def _handle_video_stream(self, parsed):
        """GET /api/video/stream?p=<本地路径> — 带 Range 的单文件预览流。"""
        import os as _os
        import re as _re
        from urllib.parse import parse_qs, unquote
        try:
            qs = parse_qs(parsed.query)
            p = unquote((qs.get('p') or [''])[0]).strip()
            if not p:
                raise ValueError('missing p')
            p = _os.path.abspath(p)
            if not _os.path.isfile(p):
                raise ValueError('file not found')
            ext = _os.path.splitext(p)[1].lower()
            ctype = self._VIDEO_MIME.get(ext, 'application/octet-stream')
            size = _os.path.getsize(p)
            start, end, status = 0, size - 1, 200
            m = _re.match(r'bytes=(\\d*)-(\\d*)$', (self.headers.get('Range') or '').strip())
            if m and (m.group(1) or m.group(2)):
                if m.group(1):
                    start = int(m.group(1))
                    if m.group(2):
                        end = min(int(m.group(2)), size - 1)
                else:
                    start = max(0, size - int(m.group(2)))
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{size}')
                    self.end_headers()
                    return
                status = 206
            length = max(0, end - start + 1)
            self.send_response(status)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(length))
            self.send_header('Accept-Ranges', 'bytes')
            if status == 206:
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.end_headers()
            with open(p, 'rb') as f:
                f.seek(start)
                remain = length
                while remain > 0:
                    chunk = f.read(min(1 << 20, remain))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remain -= len(chunk)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass
        except Exception as e:
            try:
                self._send_json({'ok': False, 'err': str(e)}, 400)
            except Exception:
                pass
'''

with io.open(P, 'r', encoding='utf-8-sig') as f:
    src = f.read()

if '_handle_video_stream' in src:
    print('SKIP: already patched')
    sys.exit(0)

# 统一按 \n 处理（原文件实际是 CRLF，io 文本模式读入后 \r\n 保留为 \r\n？——用二进制稳妥）
with io.open(P, 'r', encoding='utf-8-sig', newline='') as f:
    raw = f.read()

crlf = '\r\n' in raw
nl = '\r\n' if crlf else '\n'
route = ROUTE_LINES.replace('\n', nl)
method = METHOD_BLOCK.replace('\n', nl)

anchor = "        # ===== 静态文件兜底"
idx = raw.find(anchor)
if idx < 0:
    print('ANCHOR NOT FOUND')
    sys.exit(1)
raw = raw[:idx] + route + raw[idx:]

raw = raw.rstrip('\r\n \t') + nl * 2 + method.rstrip(nl) + nl

with io.open(P, 'w', encoding='utf-8', newline='') as f:
    f.write(raw)
print('PATCHED OK, crlf=%s' % crlf)
