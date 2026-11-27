# -*- coding: utf-8 -*-
"""项目文件管理器·文本读写域（重构 Step4：自 mixin_project_fs.py 按 kind 拆出，方法体未改动）。

包含：/api/fs-text 读、/api/fs-text-save 写（编码探测/原子写/备份）。
"""
from urllib.parse import parse_qs  # 【修复】本文件直接使用 parse_qs；此前仅靠 import * 间接可用，重构后缺失导致 NameError
import os
import json
import traceback  # 【修复 2026-11-23】两个 handler 的 except 分支调用 traceback.print_exc()，缺失时真实报错被 NameError 掩盖

from util_log import get_logger

log = get_logger('project_fs_text')
def _handle_fs_text(self, parsed):
    """【文本文件预览】/api/fs/text?path=...：返回文本文件内容（限常见文本类型，≤2MB）。"""
    qs = parse_qs(parsed.query)
    raw_path = (qs.get('path', [''])[0] or '').strip()
    try:
        if not raw_path:
            self._send_error('缺少 path 参数', 400)
            return
        rp = os.path.realpath(raw_path)
        if not os.path.isfile(rp):
            # 【v37 修复·读接口路径锚定对齐 text-save】相对路径按服务进程 cwd 解析不到时，
            # 回退锚定项目根（与 _handle_fs_text_save 的 _project_root 逻辑一致），
            # 否则会出现「保存成功(200)但读取 404 文件不存在」的不一致。
            if not os.path.isabs(raw_path):
                _project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
                rp2 = os.path.realpath(os.path.join(_project_root, raw_path))
                # 【v37 加固·对齐 text-save 白名单】回退解析结果必须落在项目根内，防 ../../ 越界读取
                if rp2.startswith(os.path.realpath(_project_root) + os.sep) and os.path.isfile(rp2):
                    rp = rp2
        if not os.path.isfile(rp):
            self._send_error('文件不存在: ' + raw_path, 404)
            return
        # 【安全加固】敏感目录黑名单（与 mixin_project_fs / project_fs_thumb 同款）：
        # 项目内 private/、.git、cache/thumbs 不允许经本接口读出，
        # 防止被注入页面借此探测/读取本机敏感文件
        _low = rp.lower()
        for _seg in ('\\private\\', '\\.git\\', '\\cache\\thumbs\\'):
            if _seg in _low:
                self._send_error('敏感目录禁止访问', 403)
                return
        TEXT_EXTS = {'.txt', '.md', '.log', '.py', '.js', '.json', '.html', '.css',
                     '.xml', '.csv', '.ini', '.cfg', '.bat', '.sh', '.yml', '.yaml',
                     '.sql', '.ts'}
        parts = os.path.splitext(rp)
        ext = parts[1].lower()
        if ext == '.bak':
            stem_ext = os.path.splitext(parts[0])[1].lower()
            if stem_ext in TEXT_EXTS:
                ext = stem_ext
        if ext not in TEXT_EXTS:
            self._send_error('不支持的文本类型: ' + parts[1], 403)
            return
        size = os.path.getsize(rp)
        if size > 2 * 1024 * 1024:
            self._send_error('文件过大（>2MB）', 413)
            return
        try:
            with open(rp, 'rb') as f:
                raw = f.read()
        except (PermissionError, OSError) as e:
            self._send_error('无法读取: ' + str(e), 403)
            return
        if raw.startswith(b'\xef\xbb\xbf'):
            raw = raw[3:]
        try:
            text = raw.decode('utf-8')
        except UnicodeDecodeError:
            try:
                text = raw.decode('gbk')
            except UnicodeDecodeError:
                text = raw.decode('utf-8', errors='replace')
        self._send_json({'ok': True, 'path': rp, 'text': text})
    except Exception as e:
        log.error(f'[GET /api/fs/text] 500 错误: {e}')
        traceback.print_exc()
        try:
            self._send_error(str(e), 500)
        except Exception:
            pass

def _handle_fs_text_save(self):
    """【文本文件保存】POST /api/fs/text-save  body={path, text}：
    将编辑器内容写回本地文本文件（限 /api/fs/text 相同的文本类型，≤2MB）。"""
    try:
        length = int(self.headers.get('Content-Length') or 0)
        body = json.loads(self._cached_body(length).decode('utf-8')) if length else {}
        raw_path = (body.get('path') or '').strip()
        text = body.get('text')
        if text is None or not isinstance(text, str):
            self._send_error('缺少 text 参数', 400)
            return
        if not raw_path:
            self._send_error('缺少 path 参数', 400)
            return
        rp = os.path.realpath(raw_path)
        # 【2026-10-29 修复】原逻辑要求文件必须已存在，导致自动落盘兜底（施工队新建策划案 md）必然 404。
        # 放宽为：允许新建文件；相对路径以服务 cwd（server/）解析失败时，改锚定项目根（server 的上一级）重解析。
        if not os.path.isfile(rp):
            if not os.path.isabs(raw_path):
                _root_rp = os.path.realpath(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), raw_path))
                if os.path.isfile(_root_rp) or os.path.isdir(os.path.dirname(_root_rp)):
                    rp = _root_rp
            _pdir = os.path.dirname(rp)
            if not os.path.isdir(_pdir):
                self._send_error('文件不存在且父目录不存在: ' + raw_path, 404)
                return
        # 【2026-10-29 加固】新建/写入范围白名单：解析结果必须落在项目根内，防 ../ 越界新建
        _project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        _root_prefix = os.path.realpath(_project_root) + os.sep
        if not (rp + os.sep).startswith(_root_prefix) and rp != os.path.realpath(_project_root):
            self._send_error('路径越出项目根，禁止写入: ' + raw_path, 403)
            return
        # 【20261123 加固·Phase 3.2】敏感目录黑名单（与 _handle_fs_text 同款）：
        # 项目根白名单放行了项目内 private/ —— 无此黑名单时，同源注入页面可经本
        # 接口改写 private/api_keys.json（真 key 换成攻击者中转 key = 劫持后续
        # 全部对话外流）或篡改 private/记忆/ 等运行时隐私资产。写路由必须与读路由同防。
        _low = rp.lower()
        for _seg in ('\\private\\', '\\.git\\', '\\cache\\thumbs\\'):
            if _seg in _low:
                self._send_error('敏感目录禁止写入', 403)
                return
        TEXT_EXTS = {'.txt', '.md', '.log', '.py', '.js', '.json', '.html', '.css',
                     '.xml', '.csv', '.ini', '.cfg', '.bat', '.sh', '.yml', '.yaml',
                     '.sql', '.ts'}
        parts = os.path.splitext(rp)
        ext = parts[1].lower()
        if ext == '.bak':
            stem_ext = os.path.splitext(parts[0])[1].lower()
            if stem_ext in TEXT_EXTS:
                ext = stem_ext
        if ext not in TEXT_EXTS:
            self._send_error('不支持的文本类型: ' + parts[1], 403)
            return
        data = text.encode('utf-8')
        if len(data) > 2 * 1024 * 1024:
            self._send_error('内容过大（>2MB）', 413)
            return
        # 写回（保留原编码风格：若原文件是 GBK 则按 GBK 写回，否则 UTF-8）
        try:
            with open(rp, 'rb') as f:
                old = f.read()
            if old.startswith(b'\xef\xbb\xbf'):
                old_body = old[3:]
            else:
                old_body = old
            try:
                old_body.decode('utf-8')
                enc = 'utf-8'
                if old.startswith(b'\xef\xbb\xbf'):
                    data = b'\xef\xbb\xbf' + data
            except UnicodeDecodeError:
                # 【乱码修复 2026-09-22】原文件是 GBK 等非 UTF-8 编码时：
                # 仅当内容能【无损】编码回 GBK 才按 GBK 写回；
                # 否则一律回退 UTF-8，绝不使用 errors='replace' 静默吞字符
                # （此前 errors='replace' 会把编不了的中文替换/截断，产生 U+FFFD 乱码，
                #  page103307.html 的 GBK→UTF-8 转码乱码即属同类问题）。
                try:
                    data = text.encode('gbk')
                    enc = 'gbk'
                except UnicodeEncodeError:
                    data = text.encode('utf-8')
                    enc = 'utf-8'
        except OSError:
            enc = 'utf-8'
        # 统一备份到 system/backup/（不再在原文件旁落 .bak），并做非法文件名守卫
        try:
            from path_policy import backup_path, sanitize_write_path
            backup_path(rp, tag='editor_save')
            rp, _warn = sanitize_write_path(rp)
        except Exception:
            pass
        # 沙箱保护：写入前记录可撤销快照（.bak + 沙箱双保险，全部操作可在任务簿时间线回退）
        try:
            from engines.common.sandbox import snapshot_before_write
            snapshot_before_write(rp, tag='editor_save', source='editor')
        except Exception:
            pass
        with open(rp, 'wb') as f:
            f.write(data)
        self._send_json({'ok': True, 'path': rp, 'encoding': enc, 'size': len(data)})
    except Exception as e:
        log.error(f'[POST /api/fs/text-save] 500 错误: {e}')
        traceback.print_exc()
        try:
            self._send_error(str(e), 500)
        except Exception:
            pass


# ===== 文件操作（删除/移动/复制）：POST /api/fs/ops =====
# ===== 【画布参考板】保存/载入（PureRef 式参考图布局） =====
