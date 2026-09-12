# -*- coding: utf-8 -*-
"""Mixin: 像素动画（自动拆分自 handler_routes.py，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinPixel(MixinBase):
    def _handle_pixel_display_poll(self):
        """GET /api/pixel/display - return the latest pixel display data."""
        conn = None
        try:
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("SELECT value FROM app_data WHERE category='pixel_display' AND key='latest' ORDER BY id DESC LIMIT 1")
                row = cur.fetchone()
                conn.close()
            conn = None
            if row:
                d = json.loads(row['value'])
                self._send_json({
                    'ok': True,
                    'has_data': True,
                    'data': d.get('data', ''),
                    'title': d.get('title', ''),
                    'timestamp': d.get('timestamp', 0)
                })
            else:
                self._send_json({'ok': True, 'has_data': False})
        except Exception as e:
            print(f'[GET /api/pixel/display] 500: {e}')
            traceback.print_exc()
            if conn:
                try: conn.close()
                except Exception: pass
            self._send_error(str(e), 500)

    # PXL 璋冭壊鏉匡紙RGB 鍏冪粍锛?
    _PXL_PALETTES = {
        'B': [(0,0,0), (255,255,255)],
        'C16': [
            (0,0,0),(29,43,83),(126,37,83),(0,135,81),
            (171,82,52),(95,87,79),(194,195,199),(255,241,232),
            (255,0,77),(255,163,0),(255,236,39),(0,228,54),
            (41,173,255),(131,56,236),(255,119,168),(255,204,170)
        ]
    }


    def _handle_pixel_export_gif(self):
        """GET /api/pixel/export_gif - 瀵煎嚭褰撳墠鍍忕礌鍔ㄧ敾涓篏IF"""
        conn = None
        try:
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("SELECT value FROM app_data WHERE category='pixel_display' AND key='latest' ORDER BY id DESC LIMIT 1")
                row = cur.fetchone()
                conn.close()
                conn = None

            if not row:
                self._send_json({'ok': False, 'error': 'no data'})
                return

            d = json.loads(row['value'])
            pxl_data = d.get('data', '')
            if not pxl_data:
                self._send_json({'ok': False, 'error': 'no pxl data'})
                return

            # 解析PXL数据
            import re as _re
            colon_idx = pxl_data.index(':')
            header = pxl_data[:colon_idx].strip()
            body = pxl_data[colon_idx + 1:].strip()

            header_parts = header.split()
            size_mode = header_parts[0]
            frame_info = header_parts[1] if len(header_parts) > 1 else ''

            m = _re.match(r'^(\d+)x(\d+)(B|C\d+)$', size_mode, _re.I)
            if not m:
                self._send_json({'ok': False, 'error': 'invalid PXL header'})
                return

            width = int(m.group(1))
            height = int(m.group(2))
            mode = m.group(3).upper()

            frame_count = 1
            fps = 4
            if frame_info:
                fm = _re.match(r'^F(\d+)(?:@(\d+))?$', frame_info, _re.I)
                if fm:
                    frame_count = int(fm.group(1))
                    if fm.group(2):
                        fps = int(fm.group(2))

            # 璋冭壊鏉?
            palette = _PXL_PALETTES.get(mode, _PXL_PALETTES['B'])

            # 瑙ｇ爜RLE锛圔妯″紡=浜ゆ浛璁℃暟锛孋16妯″紡=棰滆壊.鏁伴噺瀵癸級
            def decode_rle(rle_str, total_pixels):
                pixels = []
                if mode == 'B':
                    nums = rle_str.split(',')
                    current_color = 0
                    for num in nums:
                        count = int(num.strip())
                        if count <= 0: continue
                        for _ in range(count):
                            pixels.append(current_color)
                        current_color = 1 - current_color
                else:
                    # C16: token = 棰滆壊.鏁伴噺 鎴?棰滆壊(榛樿1), X=閫忔槑
                    tokens = rle_str.split(',')
                    for tok in tokens:
                        tok = tok.strip()
                        if not tok: continue
                        # 閫忔槑鑹?
                        if tok[0].upper() == 'X':
                            parts = tok.split('.')
                            cnt = int(parts[1]) if len(parts) > 1 and parts[1] else 1
                            for _ in range(cnt):
                                pixels.append(-1)  # -1 = 閫忔槑
                            continue
                        if '.' in tok:
                            parts = tok.split('.')
                            ci = int(parts[0])
                            cnt = int(parts[1]) if len(parts) > 1 and parts[1] else 1
                        else:
                            ci = int(tok)
                            cnt = 1
                        ci = max(0, min(ci, len(palette) - 1))
                        for _ in range(cnt):
                            pixels.append(ci)
                while len(pixels) < total_pixels:
                    pixels.append(0)
                return pixels[:total_pixels]

            frame_strs = body.split('|')
            frames = []
            for i in range(min(len(frame_strs), frame_count)):
                pixels = decode_rle(frame_strs[i].strip(), width * height)
                frames.append(pixels)

            if not frames:
                self._send_json({'ok': False, 'error': 'no frames decoded'})
                return

            # 鐢≒illow鐢熸垚GIF
            from PIL import Image

            pixel_size = 16  # 姣忎釜鍍忕礌鏀惧ぇ鍒?6x16
            img_w = width * pixel_size
            img_h = height * pixel_size

            images = []
            for frame_pixels in frames:
                img = Image.new('RGBA', (img_w, img_h), (0, 0, 0, 0))
                pixels_obj = img.load()
                for y in range(height):
                    for x in range(width):
                        idx = y * width + x
                        color_idx = frame_pixels[idx] if idx < len(frame_pixels) else 0
                        if color_idx == -1:
                            continue  # 閫忔槑锛岃烦杩?
                        color = palette[color_idx] if color_idx < len(palette) else palette[0]
                        rgba = (color[0], color[1], color[2], 255)
                        for py in range(pixel_size):
                            for px in range(pixel_size):
                                pixels_obj[x * pixel_size + px, y * pixel_size + py] = rgba
                images.append(img)

            # 淇濆瓨涓篏IF
            exports_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'exports')
            os.makedirs(exports_dir, exist_ok=True)
            gif_path = os.path.join(exports_dir, 'pixel_animation.gif')

            duration_ms = int(1000 / fps)
            if len(images) == 1:
                images[0].save(gif_path, 'GIF', transparency=0)
            else:
                images[0].save(
                    gif_path, 'GIF',
                    save_all=True,
                    append_images=images[1:],
                    duration=duration_ms,
                    loop=0,
                    disposal=2,
                    transparency=0
                )

            gif_url = '/exports/pixel_animation.gif?t=' + str(int(time.time()))
            self._send_json({'ok': True, 'url': gif_url, 'frames': len(images), 'size': str(img_w) + 'x' + str(img_h)})

        except Exception as e:
            print(f'[GET /api/pixel/export_gif] 500: {e}')
            traceback.print_exc()
            if conn:
                try: conn.close()
                except Exception: pass
            self._send_json({'ok': False, 'error': str(e)})




