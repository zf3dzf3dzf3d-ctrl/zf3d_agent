# -*- coding: utf-8 -*-
"""Mixin: i小说工作台 API（小说播放器 + AI 点播生成）
GET  /api/novel/list          -> 书架：列出所有小说（读 小说/index.json）
GET  /api/novel/get?file=xx   -> 读单本小说全文（.novel.json）
POST /api/novel/save          -> 保存小说（body: {file, data}，原子写，自动 .bak）
POST /api/novel/generate      -> AI 点播生成：body {prompt, genre, length, title, chapter}
                                生成一篇短篇正文，返回文本（不落盘；保存走 /api/novel/save）
安全：file 只取 basename，限制在 小说/books/ 内。
"""
import os, json, shutil, time, threading, re
from routes._shared import *
from routes.mixin_base import MixinBase
from util_log import get_logger

log = get_logger('novel')

# 已知证书链异常、必须降级 TLS 校验的小说书源站点（白名单制，2026-11 安全收口）
_NOVEL_TLS_INSECURE_HOSTS = set()

_NOVEL_DIR = os.path.normpath(os.path.join(BASE_DIR, 'public', 'canvas', '小说'))
_BOOKS_DIR = os.path.join(_NOVEL_DIR, 'books')
_NOVEL_PROGRESS_FILE = os.path.normpath(os.path.join(BASE_DIR, 'server', 'data', 'novel_progress.json'))
_NOVEL_TOKEN_FILE = os.path.normpath(os.path.join(BASE_DIR, 'server', 'data', 'novel_token.txt'))
# v1.1 P2'：网络收集书库（本地 txt 缓存，HTTP 不可直读，合规：仅公版/免费，不分发）
_NOVEL_IMPORT_DIR = os.path.normpath(os.path.join(BASE_DIR, 'server', 'data', 'novels_local'))
_GUTENBERG_WHITELIST = ('www.gutenberg.org', 'gutenberg.org', 'gutenberg.pglaf.org')
# v2.0 网络书源（多源聚合搜索/抓取，按顺序试，任何源失败静默降级）
_NOVEL_WEB_SOURCES = ('www.69shu.pro', 'www.69shu.com', '69shu.cx')
_novel_fetch_lock = threading.Lock()
_novel_fetch_last = [0.0]  # 速率限制：>=1秒/请求
_novel_progress_lock = threading.Lock()


class MixinNovel(MixinBase):
    def _novel_safe_path(self, name):
        """防目录穿越：只允许 books/ 下的 .novel.json（v1.1 加严：拒绝绝对路径/盘符/隐藏分隔符）"""
        name = os.path.basename(str(name or '').strip())
        if not name or name.startswith('.'):
            return None
        if os.path.isabs(name) or ':' in name or '\\' in name or '/' in name:
            return None
        if not name.endswith('.novel.json'):
            name += '.novel.json'
        p = os.path.normpath(os.path.join(_BOOKS_DIR, name))
        # 严格前缀校验：必须在 books 目录内部（含尾分隔符语义）
        if os.path.dirname(p) != os.path.normpath(_BOOKS_DIR):
            return None
        return p

    # ---------- v1.1 P0'：写操作轻量 token 鉴权（本地单用户） ----------
    @staticmethod
    def _novel_token():
        """读取/首次生成 server/data/novel_token.txt"""
        try:
            with open(_NOVEL_TOKEN_FILE, 'r', encoding='utf-8') as f:
                t = f.read().strip()
            if t:
                return t
        except Exception:
            pass
        import secrets
        t = secrets.token_hex(16)
        os.makedirs(os.path.dirname(_NOVEL_TOKEN_FILE), exist_ok=True)
        with open(_NOVEL_TOKEN_FILE, 'w', encoding='utf-8') as f:
            f.write(t)
        return t

    def _novel_auth_ok(self, body):
        """写接口鉴权：body/headers 带 token 且匹配。未配置前自动生成，本地同机无感。"""
        want = self._novel_token()
        got = ''
        if isinstance(body, dict):
            got = str(body.get('token') or '')
        if not got:
            got = (self.headers.get('X-Novel-Token') or '').strip()
        return got == want

    def _handle_novel_token(self):
        """GET /api/novel/token：下发本机写 token（仅本地回环可用的个人服务器）"""
        self._send_json({'ok': True, 'token': self._novel_token()})


    def _novel_progress_read_all(self):
        try:
            with open(_NOVEL_PROGRESS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f) or {}
        except Exception:
            return {}

    def _novel_progress_write_all(self, data):
        os.makedirs(os.path.dirname(_NOVEL_PROGRESS_FILE), exist_ok=True)
        self._novel_atomic_write_json(_NOVEL_PROGRESS_FILE, data, indent=1)

    # ---------- S2 重构：抽公共模板（原子写 JSON / 读书架索引） ----------
    @staticmethod
    def _novel_atomic_write_json(path, data, indent=2):
        """原子写 JSON（tmp→dump→os.replace），全模块统一模板"""
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=indent)
        os.replace(tmp, path)

    def _novel_index_read(self):
        """读书架 index.json，返回 items 列表（兼容旧 list / dict.books/files/list 格式）"""
        idx_path = os.path.join(_NOVEL_DIR, 'index.json')
        if not os.path.isfile(idx_path):
            return []
        with open(idx_path, 'r', encoding='utf-8-sig') as f:
            raw = json.load(f)
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            return raw.get('books') or raw.get('files') or raw.get('list') or []
        return []

    def _handle_novel_list(self):
        try:
            self._send_json({'ok': True, 'items': self._novel_index_read()})
        except Exception as e:
            log.info(f'[GET /api/novel/list] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_novel_get(self, qs):
        try:
            name = (qs.get('file') or [''])[0]
            p = self._novel_safe_path(name)
            if not p or not os.path.isfile(p):
                self._send_json({'ok': False, 'err': '小说不存在: ' + name}, 404)
                return
            with open(p, 'r', encoding='utf-8') as f:
                data = json.load(f)
            self._send_json({'ok': True, 'data': data})
        except Exception as e:
            log.info(f'[GET /api/novel/get] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_novel_save(self):
        try:
            raw = self._read_body()
            body = raw if isinstance(raw, dict) else json.loads(raw or '{}')
            # v1.1 P0'：写接口 token 鉴权
            if not self._novel_auth_ok(body):
                self._send_json({'ok': False, 'err': 'token 鉴权失败'}, 403); return
            name = body.get('file') or ''
            data = body.get('data') or {}
            if not isinstance(data, dict):
                raise ValueError('data 必须是对象')
            os.makedirs(_BOOKS_DIR, exist_ok=True)
            p = self._novel_safe_path(name)
            if not p:
                self._send_json({'ok': False, 'err': '非法文件名'}, 400)
                return
            if os.path.isfile(p) and not os.path.isdir(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '.git')):
                # P1 统一策略（2026-11-20）：git 仓库内跳过备份（git 快照即真源），非 git 才落 .bak
                from datetime import datetime
                bak = p + '.bak.' + datetime.now().strftime('%Y%m%d_%H%M%S_%f')
                shutil.copy2(p, bak)
            self._novel_atomic_write_json(p, data)
            # 更新书架索引（带元数据）
            self._novel_index_upsert(data.get('title') or os.path.basename(p), os.path.basename(p), meta=data)
            self._send_json({'ok': True, 'file': os.path.basename(p)})
        except Exception as e:
            log.info(f'[POST /api/novel/save] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _novel_index_upsert(self, title, fname, meta=None):
        try:
            items = self._novel_index_read()
            items = [it for it in items
                     if (it.get('file') if isinstance(it, dict) else it) != fname]
            entry = {'title': title, 'file': fname,
                     'updated_at': int(time.time() * 1000)}
            # 书架元数据（genre/created_at/chapters 数），供前端副标题展示
            if isinstance(meta, dict):
                for k in ('genre', 'created_at'):
                    if meta.get(k):
                        entry[k] = meta[k]
                if meta.get('chapters'):
                    entry['chapters'] = len(meta['chapters'])
            items.insert(0, entry)
            os.makedirs(_NOVEL_DIR, exist_ok=True)
            self._novel_atomic_write_json(os.path.join(_NOVEL_DIR, 'index.json'),
                                          {'books': items})
        except Exception as e:
            log.info('[novel index] warn: %s' % e)

    def _novel_load_book(self, p):
        """读书，兼容旧单文本格式与新版连载格式"""
        with open(p, 'r', encoding='utf-8') as f:
            return json.load(f)

    def _novel_text_of(self, book):
        """取全文（兼容旧格式 content / 新格式 chapters 拼接）"""
        if book.get('chapters'):
            return '\n\n'.join('第%s章 %s\n%s' % (i + 1, c.get('title') or '', c.get('text') or '')
                               for i, c in enumerate(book['chapters']))
        return book.get('content') or ''

    def _handle_novel_outline(self):
        """POST /api/novel/outline：AI 生成全书章节目录。body {prompt, genre, n}"""
        try:
            raw = self._read_body()
            body = raw if isinstance(raw, dict) else json.loads(raw or '{}')
            # v1.1 P0'：写接口 token 鉴权（outline 触发生成落盘链路）
            if not self._novel_auth_ok(body):
                self._send_json({'ok': False, 'err': 'token 鉴权失败'}, 403); return
            prompt = str(body.get('prompt') or '').strip()
            genre = str(body.get('genre') or '不限').strip()
            profile = str(body.get('profile') or '').strip()[:200]
            n = max(2, min(int(body.get('n') or 6), 30))
            if not prompt:
                self._send_json({'ok': False, 'err': '请描述你想看什么'}, 400)
                return
            sys_p = ('你是网文编辑。只输出章节目录，格式为每行「1. 章名：一句话内容梗概」，共%d章，'
                     '不要任何其他解释。' % n)
            user_p = (f'[写作要求：这是小说大纲创作任务，必须输出完整{n}章目录，「简洁」规则不适用。]\n'
                      f'题材：{genre}\n需求：{prompt}\n'
                      + (f'主角人设（全书保持一致）：{profile}\n' if profile else '')
                      + f'请规划全书{n}章的目录。')
            from zf3d_commands import _call_llm
            text, err = _call_llm(user_p, model_name='', project_ctx=sys_p)
            if err:
                self._send_json({'ok': False, 'err': '生成失败: ' + err}, 502)
                return
            chapters = []
            for line in text.splitlines():
                line = line.strip()
                if not line:
                    continue
                # 解析「1. 章名：梗概」
                t = line.lstrip('0123456789.、 ）(　 ')
                if '：' in t:
                    name, brief = t.split('：', 1)
                elif ':' in t:
                    name, brief = t.split(':', 1)
                else:
                    name, brief = t, ''
                if name.strip():
                    chapters.append({'title': name.strip()[:50], 'brief': brief.strip()[:120], 'text': ''})
            self._send_json({'ok': True, 'chapters': chapters})
        except Exception as e:
            log.info(f'[POST /api/novel/outline] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)

    # ---------- S3 重构：拆 chapter 的提示词拼装与滚动摘要两个 helper ----------
    def _novel_build_chapter_prompt(self, book, chs, idx, ch, genre, prompt, directive):
        """拼第 idx 章生成的 system/user 提示词（含前文梗概+上一章结尾 800 字）"""
        sys_p = ('你是网文作者。直接输出小说正文，不要任何解释、标题前缀、思考过程。'
                 '段落之间空一行，每章约2500字。')
        prev_ctx = ''
        if book.get('summary'):
            prev_ctx += '【前文梗概】' + book['summary'] + '\n'
        # 拼上一章结尾 800 字保连贯
        for j in range(idx - 1, -1, -1):
            if chs[j].get('text'):
                prev_ctx += '【上一章结尾】' + chs[j]['text'][-800:] + '\n'
                break
        user_p = (f'[写作要求：这是小说创作任务，必须写满约2500字的正文，'
                  f'禁止简化、省略或摘要式输出，「简洁」规则对本任务不适用。]\n'
                  f'题材：{genre}\n全书需求：{prompt or book.get("title")}\n'
                  + (f'主角人设（必须保持一致）：{book.get("profile")}\n' if book.get('profile') else '')
                  + (f'读者最新指令（本章必须体现）：{directive}\n' if directive else '')
                  + f'{prev_ctx}请写第{idx + 1}章「{ch.get("title")}」'
                  + (f'（本章要点：{ch.get("brief")}）' if ch.get('brief') else '')
                  + '\n直接输出正文。')
        return sys_p, user_p

    def _novel_roll_summary(self, chs, idx, book):
        """滚动摘要：每 3 章用模型压缩一次，硬上限 600 字；失败静默保留旧摘要"""
        if not (idx > 0 and idx % 3 == 0):
            return
        from zf3d_commands import _call_llm
        done = [c for c in chs[:idx + 1] if c.get('text')]
        sum_in = '\n'.join('第%d章%s：%s' % (i + 1, c.get('title'), (c.get('text') or '')[:300])
                           for i, c in enumerate(done))
        stxt, serr = _call_llm(
            f'[写作要求：剧情摘要任务，「简洁」规则不适用。]\n'
            f'请把以下章节内容压缩为不超过600字的剧情梗概，保留主要人物与关键伏笔：\n{sum_in}',
            model_name='', project_ctx='你是网文编辑，只输出梗概正文。')
        if not serr and stxt.strip():
            book['summary'] = stxt.strip()[:600]

    def _handle_novel_chapter(self):
        """POST /api/novel/chapter：逐章生成（滚动摘要续写）。body {file, index, prompt, genre}
        生成第 index 章（0基），写入书籍 chapters，并更新滚动摘要 summary。"""
        try:
            raw = self._read_body()
            body = raw if isinstance(raw, dict) else json.loads(raw or '{}')
            name = str(body.get('file') or '').strip()
            idx = int(body.get('index') or 0)
            prompt = str(body.get('prompt') or '').strip()
            genre = str(body.get('genre') or '不限').strip()
            directive = str(body.get('directive') or '').strip()[:200]
            # v1.1 收口：chapter 写书文件+调LLM 属写操作，补 token 鉴权
            if not self._novel_auth_ok(body):
                self._send_json({'ok': False, 'err': 'token 鉴权失败'}, 403); return
            p = self._novel_safe_path(name)
            if not p or not os.path.isfile(p):
                self._send_json({'ok': False, 'err': '书籍不存在: ' + name}, 404)
                return
            book = self._novel_load_book(p)
            chs = book.get('chapters') or []
            if idx < 0 or idx >= len(chs):
                self._send_json({'ok': False, 'err': '章节序号越界'}, 400)
                return
            if chs[idx].get('text'):
                self._send_json({'ok': True, 'chapter': chs[idx], 'index': idx, 'cached': True})
                return
            ch = chs[idx]
            sys_p, user_p = self._novel_build_chapter_prompt(book, chs, idx, ch, genre, prompt, directive)
            from zf3d_commands import _call_llm
            text, err = _call_llm(user_p, model_name='', project_ctx=sys_p)
            if err:
                self._send_json({'ok': False, 'err': '生成失败: ' + err}, 502)
                return
            ch['text'] = text.strip()
            self._novel_roll_summary(chs, idx, book)
            # 兼容：content 字段同步全文，旧阅读器仍可读
            book['content'] = self._novel_text_of(book)
            self._novel_atomic_write_json(p, book)
            self._send_json({'ok': True, 'index': idx, 'chapter': ch, 'summary': book.get('summary')})
        except Exception as e:
            log.info(f'[POST /api/novel/chapter] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_novel_generate(self):
        """AI 点播生成一篇短篇。同步阻塞（模型侧 timeout 120s）。"""
        try:
            raw = self._read_body()
            body = raw if isinstance(raw, dict) else json.loads(raw or '{}')
            # v1.1 P0'：写接口 token 鉴权（generate 生成即落盘属写操作）
            if not self._novel_auth_ok(body):
                self._send_json({'ok': False, 'err': 'token 鉴权失败'}, 403); return
            prompt = str(body.get('prompt') or '').strip()
            genre = str(body.get('genre') or '不限').strip()
            length = str(body.get('length') or '短篇').strip()
            chapter = str(body.get('chapter') or '').strip()
            if not prompt:
                self._send_json({'ok': False, 'err': '请描述你想看什么'}, 400)
                return
            word_target = {'短篇': 2000, '中篇': 5000, '章节': 3000}.get(length, 2000)
            sys_p = ('你是网文作者。直接输出小说正文，不要任何解释、标题前缀、思考过程。'
                     '用「第X章 章名」格式分章，正文段落之间空一行。')
            user_p = (f'题材：{genre}\n篇幅：约{word_target}字（{length}）\n'
                      f'需求：{prompt}')
            if chapter:
                user_p += f'（这是续写：{chapter}）'
            # 防污染：系统内置 system 有「简洁回复」指令，小说场景必须显式覆盖
            user_p = (f'[写作要求：这是小说创作任务，必须写满约{word_target}字的长篇正文，'
                      f'禁止简化、省略或摘要式输出，「简洁」规则对本任务不适用。]\n' + user_p)
            from zf3d_commands import _call_llm
            text, err = _call_llm(user_p, model_name='', project_ctx=sys_p)
            if err:
                self._send_json({'ok': False, 'err': '生成失败: ' + err}, 502)
                return
            # 生成即落盘（防前端误刷新丢全文）
            fname = str(body.get('file') or '').strip() or ('ai_' + str(int(time.time())) + '.novel.json')
            os.makedirs(_BOOKS_DIR, exist_ok=True)
            sp = self._novel_safe_path(fname)
            if sp:
                # 已存在且是连载书 → 追加为新章；否则整本覆盖
                book = None
                if os.path.isfile(sp):
                    try:
                        book = self._novel_load_book(sp)
                    except Exception:
                        book = None
                if book and book.get('chapters'):
                    book['chapters'].append({'title': chapter or '新章', 'text': text.strip()})
                    book['content'] = self._novel_text_of(book)
                    data = book
                else:
                    data = {'title': body.get('title') or prompt[:20], 'content': text}
                self._novel_atomic_write_json(sp, data)
                self._novel_index_upsert(body.get('title') or prompt[:20], os.path.basename(sp), meta=data)
            self._send_json({'ok': True, 'text': text, 'file': os.path.basename(sp) if sp else None})
        except Exception as e:
            log.info(f'[POST /api/novel/generate] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)

    # ---------- V1.5 进度双源续读（参照 mixin_comics：单锁+原子写，落 server/data/ 不入 git） ----------
    def _handle_novel_progress_get(self):
        try:
            with _novel_progress_lock:
                data = self._novel_progress_read_all()
            self._send_json({'ok': True, 'progress': data})
        except Exception as e:
            log.info(f'[GET /api/novel/progress] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_novel_progress_post(self):
        try:
            raw = self._read_body()
            body = raw if isinstance(raw, dict) else json.loads(raw or '{}')
            fname = os.path.basename(str(body.get('file') or '').strip())
            if not fname:
                self._send_json({'ok': False, 'err': 'file 必填'}, 400)
                return
            key = fname[:-11] if fname.endswith('.novel.json') else fname  # 复合键用书名
            entry = {
                'file': fname,
                'chapter': int(body.get('chapter') or 0),
                'scroll': float(body.get('scroll') or 0),
                'updatedAt': time.strftime('%Y-%m-%d %H:%M:%S'),
            }
            with _novel_progress_lock:
                data = self._novel_progress_read_all()
                data[key] = entry
                self._novel_progress_write_all(data)
            self._send_json({'ok': True, 'key': key})
        except Exception as e:
            log.info(f'[POST /api/novel/progress] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)

    # ============================================================
    # v1.1 P2'：网络收集（古登堡整本 txt 直链 → 本地书库 → inovel 可读）
    # GET  /api/novel/import/catalog  -> 内置公版书单（古登堡中文区精选）
    # POST /api/novel/import          -> body {gid, title}：拉整本 txt 入库
    # ============================================================
    _GUTENBERG_CATALOG = [
        {'gid': 24264, 'title': '红楼梦', 'author': '曹雪芹'},
        {'gid': 23864, 'title': '孙子兵法', 'author': '孙武'},
        {'gid': 25328, 'title': '西游记', 'author': '吴承恩'},
        {'gid': 23948, 'title': '三国演义', 'author': '罗贯中'},
        {'gid': 24518, 'title': '水浒传', 'author': '施耐庵'},
        {'gid': 25102, 'title': '聊斋志异（选）', 'author': '蒲松龄'},
        {'gid': 23962, 'title': '诗经', 'author': '佚名'},
        {'gid': 23997, 'title': '道德经', 'author': '老子'},
        {'gid': 24269, 'title': '庄子（选）', 'author': '庄周'},
        {'gid': 24255, 'title': '论语', 'author': '孔子弟子'},
        {'gid': 25204, 'title': '儒林外史', 'author': '吴敬梓'},
        {'gid': 23950, 'title': '镜花缘', 'author': '李汝珍'},
        {'gid': 23981, 'title': '封神演义（选）', 'author': '许仲琳'},
        {'gid': 24969, 'title': '牡丹亭', 'author': '汤显祖'},
        {'gid': 25171, 'title': '桃花扇', 'author': '孔尚任'},
    ]

    def _handle_novel_import_catalog(self):
        try:
            self._send_json({'ok': True, 'items': self._GUTENBERG_CATALOG,
                             'source': '古登堡计划（公版，整本 txt 直链）'})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 500)

    @staticmethod
    def _novel_fetch_url(url):
        """限速（>=1秒/次）+ 证书绕过抓取（本机无 CA 链，CERT_NONE 仅限白名单公版站，非白名单域直接拒绝）。
        参数 url：白名单域（gutenberg.org 及子域）的完整地址；
        返回：http.client.HTTPResponse（调用方需自行 .read() 取 bytes，勿当字符串用）。
        后续扩展更多公版书源时，请扩展 _GUTENBERG_WHITELIST 常量列表而非硬编码新判断。"""
        from urllib.parse import urlparse
        host = (urlparse(url).hostname or '').lower()
        if not any(host == d or host.endswith('.' + d) for d in _GUTENBERG_WHITELIST):
            raise ValueError('非白名单域名，拒绝抓取: %s' % host)
        with _novel_fetch_lock:
            gap = time.time() - _novel_fetch_last[0]
            if gap < 1.0:
                time.sleep(1.0 - gap)
            _novel_fetch_last[0] = time.time()
        import urllib.request, ssl
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE  # 仅限 _GUTENBERG_WHITELIST 域
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        return urllib.request.urlopen(req, timeout=60, context=ctx)

    def _handle_novel_import(self):
        try:
            body = self._read_body()
            if not isinstance(body, dict):
                self._send_json({'ok': False, 'err': 'body 必须为 JSON'}, 400); return
            if not self._novel_auth_ok(body):
                self._send_json({'ok': False, 'err': 'token 鉴权失败'}, 403); return
            gid = str(body.get('gid') or '').strip()
            title = str(body.get('title') or '').strip() or ('gutenberg_' + gid)
            # 消毒：仅中英文/数字/空格/连字符，防 ../ 盘符逃出 novels_local
            title = os.path.basename(re.sub(r'[^\w\s\-（）()]', '', title)).strip()
            if not title:
                self._send_json({'ok': False, 'err': '书名非法'}, 400); return
            if not gid.isdigit():
                self._send_json({'ok': False, 'err': 'gid 必须为数字'}, 400); return
            # 主站 503 时自动切 pglaf 官方镜像
            urls = ['https://www.gutenberg.org/cache/epub/%s/pg%s.txt' % (gid, gid),
                    'https://gutenberg.pglaf.org/cache/epub/%s/pg%s.txt' % (gid, gid)]
            raw = None; last_err = None
            for u in urls:
                try:
                    resp = self._novel_fetch_url(u); raw = resp.read()
                    if len(raw) >= 10000: break
                except Exception as e2:
                    last_err = e2
            if raw is None or len(raw) < 10000:
                self._send_json({'ok': False, 'err': '下载失败：%s' % last_err}, 502); return
            for enc in ('utf-8', 'gb18030'):
                try:
                    text = raw.decode(enc)
                    break
                except Exception:
                    pass
            else:
                text = raw.decode('utf-8', 'ignore')  # 双编码均失败：忽略非法字节兜底
            # 入库：本地 txt（HTTP 不可直读）+ 写入书架 .novel.json 供 inovel 阅读
            book_dir = os.path.join(_NOVEL_IMPORT_DIR, title)
            os.makedirs(book_dir, exist_ok=True)
            txt_path = os.path.join(book_dir, 'full.txt')
            with open(txt_path, 'w', encoding='utf-8') as f:
                f.write(text)
            data = {'title': title, 'content': text, 'genre': '公版收集',
                    'source': {'site': 'gutenberg', 'gid': gid},
                    'created_at': int(time.time() * 1000)}
            fname = 'import_%s.novel.json' % gid
            p = self._novel_safe_path(fname)
            if not p:
                self._send_json({'ok': False, 'err': '文件名非法'}, 400); return
            os.makedirs(_BOOKS_DIR, exist_ok=True)
            self._novel_atomic_write_json(p, data, indent=None)
            # v1.1 收口：补书架索引（否则导入书不出现在书架 list）
            self._novel_index_upsert(title, fname, meta=data)
            self._send_json({'ok': True, 'file': fname, 'title': title,
                             'chars': len(text), 'txt': txt_path})
        except Exception as e:
            log.info(f'[POST /api/novel/import] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)

    # ============================================================
    # v2.0 多源网络搜索 + 网络书源整本导入
    # GET  /api/novel/search?wd=xx -> 多源聚合搜索（内置书单 + 网络书源，永不空手）
    # POST /api/novel/import_web   -> body {src: '69shu', url, title}：抓整本入库
    # ============================================================
    @staticmethod
    def _novel_http_get(url, enc='utf-8', timeout=12, retries=2):
        """带重试的抓取：gzip 解码 + 完整浏览器头（UA/Referer/Accept），降低被反爬拒连概率"""
        import gzip as _gzip
        import urllib.request, ssl, time as _time
        # 安全修复（2026-11 收口）：默认校验证书；仅对已知证书链有问题的小说站降级（环境变量可强制全开）
        # 2026-11-22 步骤三：host 解析由脆弱的 split('/')[2] 改为 urlparse（原写法在 URL 含端口/凭证时取错段或 KeyError）
        from urllib.parse import urlparse as _up2
        ctx = ssl.create_default_context()
        _host = (_up2(url).hostname or '').lower()
        if os.environ.get('NOVEL_INSECURE_TLS') == '1':
            ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
        elif _host in _NOVEL_TLS_INSECURE_HOSTS:
            ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
        last_err = None
        for attempt in range(retries + 1):
            try:
                req = urllib.request.Request(url, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.9',
                    'Referer': url,
                    'Accept-Encoding': 'gzip'})
                raw = urllib.request.urlopen(req, timeout=timeout, context=ctx).read()
                if raw[:2] == b'\x1f\x8b':
                    raw = _gzip.decompress(raw)
                return raw.decode(enc, 'ignore')
            except Exception as e:
                last_err = e
                if attempt < retries:
                    _time.sleep(1.2 * (attempt + 1))
        raise last_err

    @classmethod
    def _novel_search_web(cls, kw):
        """必应网搜多源：www.bing.com 搜「书名+小说」，解析结果为可读站点链接。
        注意：查询词必须短（kw+'小说'），拼长词必应会误解为单字检索。"""
        from urllib.parse import quote
        q = quote(kw + '小说')
        html = cls._novel_http_get('https://www.bing.com/search?q=%s&setlang=zh-CN&mkt=zh-CN' % q)
        items = []
        seen = set()
        # 结果块 <li class="b_algo"><h2><a href="URL">title</a>
        for m in re.finditer(r'<li class="b_algo".*?<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html, re.S):
            url, name = m.group(1), re.sub(r'<[^>]+>', '', m.group(2)).strip()
            host = ''
            try:
                from urllib.parse import urlparse
                host = (urlparse(url).hostname or '').lower()
            except Exception:
                continue
            if not url.startswith('http') or host in seen:
                continue
            seen.add(host)
            items.append({'src': 'web', 'url': url, 'title': name, 'site': host.replace('www.', '')})
        return items

    def _handle_novel_search(self, qs):
        try:
            wd = (qs.get('wd') or [''])[0].strip()
            if not wd:
                self._send_json({'ok': False, 'err': 'wd 必填'}, 400); return
            items = []
            # 1) 内置公版书单匹配（永不失败）
            for it in self._GUTENBERG_CATALOG:
                if wd in it['title'] or wd in it.get('author', ''):
                    items.append({'src': 'gutenberg', 'gid': it['gid'],
                                  'title': it['title'] + '（' + it['author'] + '·公版）', 'site': '古登堡'})
            # 2) 网络书源聚合（失败静默）
            try:
                items += self._novel_search_web(wd)[:20]
            except Exception:
                pass
            # 3) 书架本地匹配
            try:
                for it in self._novel_index_read():
                    if wd in str(it.get('title') or ''):
                        items.append({'src': 'local', 'file': it.get('file'),
                                      'title': it.get('title'), 'site': '本地书架'})
            except Exception:
                pass
            if not items:
                items.append({'src': 'none', 'title': '未找到「' + wd + '」：网络书源暂不可达，可搜公版经典（三国演义/红楼梦等）或换关键词', 'site': ''})
            self._send_json({'ok': True, 'items': items})
        except Exception as e:
            log.info(f'[GET /api/novel/search] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)

    @staticmethod
    def _novel_browser_get(url, wait_ms=2500):
        """浏览器兜底抓取（Playwright headless 独立实例，带完整浏览器指纹，可过大部分反爬）"""
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True, args=['--disable-blink-features=AutomationControlled'])
            try:
                pg = b.new_page(user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
                pg.goto(url, timeout=25000, wait_until='domcontentloaded')
                pg.wait_for_timeout(wait_ms)
                return pg.content()
            finally:
                b.close()

    # 2026-11-22 步骤三拆分：原 _handle_novel_import_web 内嵌逻辑抽为两个类方法（无改动搬移）
    @classmethod
    def _novel_parse_toc(cls, html, host):
        """目录链接宽容解析（相对/绝对链接、章节名含章/节/卷/话/回或第N模式；命中太少退化为同域html短文字链接）"""
        from urllib.parse import urlparse as _up
        ch_links = []
        base = 'https://' + host
        def _abs(u):
            if u.startswith('//'): return 'https:' + u
            if u.startswith('/'): return base + u
            if not u.startswith('http'): return base + '/' + u.lstrip('/')
            return u
        def _same(u):
            try: return (_up(u).hostname or '') == host
            except Exception: return False
        _A = re.compile(r'<a[^>]+href="([^"]+)"[^>]*>([^<]{1,60})</a>')
        for m in _A.finditer(html):
            href, name = m.group(1).strip(), m.group(2).strip()
            if not name or href.startswith(('javascript', '#')): continue
            href = _abs(href)
            if not _same(href): continue
            if (re.search(r'第?\s*\d+', name) and len(name) <= 40) or \
                    any(c in name for c in ('章', '节', '卷', '话', '回', '章節')):
                ch_links.append({'url': href, 'title': name})
        if len(ch_links) < 3:
            seen_h = set()
            for m in _A.finditer(html):
                href, name = m.group(1).strip(), m.group(2).strip()
                if not name or href.startswith(('javascript', '#')): continue
                href = _abs(href)
                if not _same(href) or href in seen_h: continue
                if re.search(r'\.(?:html?|shtm?)($|\?)', href) and len(name) >= 2:
                    seen_h.add(href)
                    ch_links.append({'url': href, 'title': name})
        return ch_links

    def _novel_fetch_chapters(self, ch_links):
        """逐章抓取正文：urllib 优先、浏览器兜底；容器 id/class 多模式匹配，正文>100字才收录"""
        chapters = []
        for cl in ch_links:
            try:
                try:
                    ch_html = self._novel_http_get(cl['url'], timeout=15)
                except Exception:
                    ch_html = self._novel_browser_get(cl['url'], wait_ms=1500)
                # 正文容器优先 id=content / class=content
                seg = None
                mm = re.search(r'<div[^>]+id=["\']content["\'][^>]*>(.*?)</div>', ch_html, re.S)
                if not mm:
                    mm = re.search(r'<div[^>]+class=["\'][^"\']*content[^"\']*["\'][^>]*>(.*?)</div>', ch_html, re.S)
                if not mm:
                    mm = re.search(r'<div[^>]+class=["\'][^"\']*(?:box_txt|showtxt|txt|read)[^"\']*["\'][^>]*>(.*?)</div>', ch_html, re.S)
                if not mm:
                    mm = re.search(r'<div[^>]+id=["\'][^"\']*(?:txt|chapter|book)[^"\']*["\'][^>]*>(.*?)</div>', ch_html, re.S)
                if mm:
                    seg = mm.group(1)
                if not seg:
                    continue
                text = re.sub(r'<br\s*/?>', '\n', seg)
                text = re.sub(r'<script.*?</script>', '', text, flags=re.S)
                text = re.sub(r'<[^>]+>', '', text).strip()
                if len(text) > 100:
                    chapters.append({'title': cl['title'], 'text': text})
            except Exception:
                continue
        return chapters

    def _handle_novel_import_web(self):
        """网络书源整本导入：抓目录页 → 拼章节正文 → 单本入库。body {url, title, token}"""
        try:
            body = self._read_body()
            if not isinstance(body, dict):
                self._send_json({'ok': False, 'err': 'body 必须为 JSON'}, 400); return
            if not self._novel_auth_ok(body):
                self._send_json({'ok': False, 'err': 'token 鉴权失败'}, 403); return
            url = str(body.get('url') or '').strip()
            title = str(body.get('title') or '').strip()
            from urllib.parse import urlparse
            host = (urlparse(url).hostname or '').lower()
            if not url.startswith('https://') or not host:
                self._send_json({'ok': False, 'err': '仅支持 https 书源链接'}, 400); return
            try:
                html = self._novel_http_get(url)
            except Exception:
                # urllib 被反爬拒连（10054 等）→ 浏览器兜底
                html = self._novel_browser_get(url)
            mt = re.search(r'<h1[^>]*>([^<]+)</h1>', html)
            if not title:
                title = mt.group(1).strip() if mt else '网络小说'
            title = os.path.basename(re.sub(r'[^\w\s\-（）()]', '', title)).strip() or '网络小说'
            # 2026-11-22 步骤三拆分：目录解析 → _novel_parse_toc；章节抓取 → _novel_fetch_chapters
            ch_links = self._novel_parse_toc(html, host)
            if not ch_links:
                self._send_json({'ok': False, 'err': '目录解析失败（该源结构变化）'}, 502); return
            ch_links = ch_links[:200]  # 上限200章防失控
            chapters = self._novel_fetch_chapters(ch_links)
            if not chapters:
                self._send_json({'ok': False, 'err': '章节正文抓取失败（网络或反爬）'}, 502); return
            data = {'title': title, 'chapters': chapters,
                    'content': self._novel_text_of({'chapters': chapters}),
                    'genre': '网络小说', 'source': {'site': '69shu', 'url': url},
                    'created_at': int(time.time() * 1000)}
            fname = 'web_%d.novel.json' % int(time.time())
            p = self._novel_safe_path(fname)
            if not p:
                self._send_json({'ok': False, 'err': '文件名非法'}, 400); return
            os.makedirs(_BOOKS_DIR, exist_ok=True)
            self._novel_atomic_write_json(p, data, indent=None)
            self._novel_index_upsert(title, fname, meta=data)
            self._send_json({'ok': True, 'file': fname, 'title': title, 'chapters': len(chapters)})
        except Exception as e:
            log.info(f'[POST /api/novel/import_web] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)
