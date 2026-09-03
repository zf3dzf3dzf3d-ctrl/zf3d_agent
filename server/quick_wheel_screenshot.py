"""
快速浮窗 - 截图/识图/翻译/OCR Mixin（从 quick_wheel.py 拆出）

依赖宿主类提供：self._根窗口, self._弹窗, self._中心, self.配置,
self.模型直连器, self._强制关闭弹窗(), self._新建回答弹窗(), self._启动LLM(),
self._显示气泡(), self._追加文本()
"""
import tkinter as tk
import math
import io
import base64

from quick_wheel_utils import _截图base64


from quick_wheel_canvas import 画布Mixin


class 截图翻译Mixin(画布Mixin):

    # ============ 截图选区 ============

    def _启动识图(self):
        """关闭轮盘后截图识图"""
        try:
            图片b64 = _截图base64()
        except ImportError:
            self._新建回答弹窗("需要安装Pillow")
            return
        except Exception as e:
            self._新建回答弹窗(f"截图失败: {e}")
            return
        消息 = [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{图片b64}"}},
            {"type": "text", "text": "简洁描述图片内容"}
        ]}]
        提示词 = "你是图片分析助手，简洁描述图片内容。"
        self._新建回答弹窗()
        self._启动LLM(消息, 提示词)

    def _启动截图选区(self, 取字=False):
        try:
            from screenshot_capture import 截图选区
            self._截图选区器 = 截图选区(
                回调=lambda b64: self._截图完成(b64, 取字),
                根窗口=self._根窗口
            )
            self._截图选区器.弹出()
        except Exception as e:
            self._新建回答弹窗(f"截图选区启动失败: {e}")

    def _复制图片到剪贴板(self, 图片b64):
        try:
            import base64 as b64mod
            import io
            from PIL import Image
            pil_img = Image.open(io.BytesIO(b64mod.b64decode(图片b64)))
            pil_img.load()

            # 准备BMP DIB数据（去掉14字节BMP文件头）
            bmp_buf = io.BytesIO()
            pil_img.save(bmp_buf, "BMP")
            dib_data = bmp_buf.getvalue()[14:]
            bmp_buf.close()

            # 准备PNG数据
            png_buf = io.BytesIO()
            pil_img.save(png_buf, "PNG")
            png_data = png_buf.getvalue()
            png_buf.close()

            import win32clipboard
            win32clipboard.OpenClipboard()
            win32clipboard.EmptyClipboard()
            # CF_DIB (8)
            win32clipboard.SetClipboardData(win32clipboard.CF_DIB, dib_data)
            # PNG (自定义格式，QQ/微信优先读这个)
            png_fmt = win32clipboard.RegisterClipboardFormat("PNG")
            win32clipboard.SetClipboardData(png_fmt, png_data)
            win32clipboard.CloseClipboard()
        except Exception as e:
            print(f"复制图片到剪贴板失败: {e}")
        except Exception as e:
            print(f"复制图片到剪贴板失败: {e}")

    def _本地OCR(self, 图片b64, 回调):
        """本地OCR识别，优先Tesseract，回退Windows OCR(winsdk)"""
        try:
            import base64 as b64mod
            import io
            from PIL import Image
            pil_img = Image.open(io.BytesIO(b64mod.b64decode(图片b64)))
            if pil_img.width < 1000:
                倍数 = 1000 / pil_img.width
                pil_img = pil_img.resize((1000, int(pil_img.height * 倍数)), Image.LANCZOS)
            # 优先Tesseract
            try:
                import pytesseract
                import shutil as _shutil
                import os as _os
                for 路径 in [
                    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
                    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
                    _shutil.which("tesseract"),
                ]:
                    if 路径 and _os.path.exists(路径):
                        pytesseract.pytesseract.tesseract_cmd = 路径
                        break
                文本 = pytesseract.image_to_string(pil_img, lang="chi_sim+eng")
                回调(文本.strip() or "未检测到文字")
                return
            except Exception as e:
                print(f"Tesseract失败: {e}")
            # 回退：Windows OCR (winsdk)
            文本 = self._windows_ocr_winsdk(pil_img)
            回调(文本 or "未检测到文字")
        except Exception as e:
            回调(f"识别失败: {e}")

    def _windows_ocr_winsdk(self, pil_img):
        """使用winsdk调用Windows自带OCR API"""
        try:
            import asyncio
            import tempfile
            import os
            from winsdk.windows.media.ocr import OcrEngine
            from winsdk.windows.globalization import Language
            from winsdk.windows.graphics.imaging import BitmapDecoder
            from winsdk.windows.storage import StorageFile, FileAccessMode

            tmp = os.path.join(tempfile.gettempdir(), "_zf3d_ocr_tmp.png")
            pil_img.save(tmp, "PNG")

            async def _ocr():
                file = await StorageFile.get_file_from_path_async(tmp)
                stream = await file.open_async(FileAccessMode.READ)
                decoder = await BitmapDecoder.create_async(stream)
                bitmap = await decoder.get_software_bitmap_async()
                engine = OcrEngine.try_create_from_language(Language("zh-CN"))
                if not engine:
                    engine = OcrEngine.try_create_from_user_profile_languages()
                if not engine:
                    return ""
                result = await engine.recognize_async(bitmap)
                return result.text

            文本 = asyncio.run(_ocr())
            os.remove(tmp)
            return 文本.strip()
        except Exception as e:
            print(f"Windows OCR失败: {e}")
            return ""

    def _截图LLM调用(self, 消息, 提示词, 回调):
        # 检查当前模型是否支持vision，不支持则找已配密钥的vision模型
        原模型 = self.模型直连器.当前模型名
        需要切换 = False
        模型列表 = self.模型直连器.模型配置列表
        当前配置 = next((m for m in 模型列表 if m.get("名称") == 原模型), {})
        if not 当前配置.get("支持vision", False):
            # 找一个支持vision且已配密钥的模型
            for m in 模型列表:
                if m.get("支持vision", False):
                    密钥列表 = self.模型直连器.密钥配置.get("密钥列表", {})
                    模型密钥 = 密钥列表.get(m.get("名称", ""), {})
                    有密钥 = any(v for v in 模型密钥.values() if v)
                    if 有密钥:
                        self.模型直连器.切换模型(m["名称"])
                        需要切换 = True
                        break
            if not 需要切换:
                if self._根窗口:
                    self._根窗口.after(0, lambda: self._追加截图结果("❌ 当前模型不支持图片识别，请在设置中配置一个支持vision的模型（如通义千问/智谱/Kimi/豆包/OpenAI/Claude/Gemini）"))
                return
        结果 = self.模型直连器.发送消息流式(
            消息列表=消息, 系统提示词=提示词, 流式回调=回调)
        if 需要切换:
            self.模型直连器.切换模型(原模型)
        if not 结果.get("成功"):
            错误 = 结果.get('错误', '未知错误')
            if self._根窗口:
                self._根窗口.after(0, lambda: self._追加截图结果(f"\n❌ 错误: {错误}"))

    def _追加截图结果(self, 片段):
        try:
            全文 = self._截图结果文本.get("1.0", "end")
            if "识别中..." in 全文 or "翻译中..." in 全文:
                self._截图结果文本.delete("1.0", "end")
                标题 = "📝 识别结果\n\n" if getattr(self, '_截图识别模式', '') == "识别" else "🔤 翻译结果\n\n"
                self._截图结果文本.insert("end", 标题, "标题")
            self._截图结果文本.insert("end", 片段, "段落")
            self._截图结果文本.see("end")
        except Exception as e:
            print(f"追加截图结果异常: {e}")
            pass

    def _显示气泡(self, 文本):
        """在鼠标旁显示一个临时气泡提示，2秒后自动消失"""
        气泡 = tk.Toplevel(self._根窗口)
        气泡.overrideredirect(True)
        气泡.attributes("-topmost", True)
        气泡.attributes("-alpha", 0.0)
        气泡.configure(bg="#3a1a1a")
        标签 = tk.Label(
            气泡, text=文本, fg="#ffaaaa", bg="#3a1a1a",
            font=("Microsoft YaHei UI", 10), padx=14, pady=8
        )
        标签.pack()
        气泡.update_idletasks()
        w = 气泡.winfo_reqwidth()
        h = 气泡.winfo_reqheight()
        x = self._中心[0] - w // 2
        y = self._中心[1] - h - 70
        if y < 10: y = self._中心[1] + 20
        气泡.geometry(f"{w}x{h}+{x}+{y}")
        # 淡入
        当前 = [0.0]
        def 渐显():
            当前[0] += 0.15
            if 当前[0] >= 0.9:
                气泡.attributes("-alpha", 0.9)
            else:
                try:
                    气泡.attributes("-alpha", 当前[0])
                    气泡.after(16, 渐显)
                except Exception:
                    pass
        渐显()
        # 2秒后淡出关闭
        def 关闭():
            渐减 = [0.9]
            def 渐隐():
                渐减[0] -= 0.1
                if 渐减[0] <= 0:
                    气泡.destroy()
                else:
                    try:
                        气泡.attributes("-alpha", 渐减[0])
                        气泡.after(16, 渐隐)
                    except Exception:
                        气泡.destroy()
            渐隐()
        气泡.after(2000, 关闭)
