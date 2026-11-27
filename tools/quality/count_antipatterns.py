# -*- coding: utf-8 -*-
"""
反模式计数器 —— 纪律进机器（《策划案-工程基建提升总纲-从6.5到8-20261123》P1.1）

核心规则：与 baseline.json 比对，任何指标【只许降不许涨】。上涨即退出码 1，
提交/推送被钩子拦截。基线锁定 20261123 现状（3929 处宽泛 except / 1432 处
静默吞错 / 1783 处 print 日志），归零是 Phase 2 的活，门禁只管"不许更坏"。

指标：
  except_exception  `except Exception` 出现次数（正则，全仓产品代码）
  except_pass       行内 `except ...: pass` 静默吞错（正则，跨行 pass 也算）
  print_stmt        `print(` 语句当日志（仅产品目录；scripts/tests/tools 钩子
                    等基础设施的 CLI 输出合法，不计）
  exec_call         对 exec() 的真实调用（AST 精确抓，docstring 提及不误报）
  dup_module_def    同文件同名函数重复定义（AST，_bf_dbg 型半截补丁探测器）
  parse_errors      AST 解析失败文件数（上涨=有人提交了语法坏文件）
  undeclared_import 第三方 import 未在 requirements.txt 声明的去重个数（AST，
                    快速优化冲刺 SprintB 第 7 指标 20261123：fastmcp 漏声明致新机
                    启动即崩的 N1 类事故防复发。标准库经 sys.stdlib_module_names
                    排除，首方模块按常见 sys.path 根一级条目识别，仓内别名表
                    映射 Crypto→pycryptodome 等分发名后再比对）

用法：
  py tools/quality/count_antipatterns.py             # 比对模式（门禁用）
  py tools/quality/count_antipatterns.py --baseline  # 重新锁定基线（需在报告里说明理由）
"""
import ast
import contextlib
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASELINE = Path(__file__).resolve().parent / 'baseline.json'
# 带到期时间的豁免（见 load_waivers）：限期放行某项上涨，到期自动失效
WAIVERS = Path(__file__).resolve().parent / 'waivers.json'
REQUIREMENTS = ROOT / 'requirements.txt'

# 扫描缓存（2026-11-24 提速）：全仓 AST 扫描 ~5s/次，而蜂群高频快照 commit 每次
# 都过 pre-commit 第三棒 → 体感"每次提交卡 5 秒"。按 size+mtime_ns 逐文件指纹做
# 增量缓存：未变文件复用上次结果；本扫描器 / requirements.txt 变化 → 全量失效
# 重算（尺子变了不用旧测量）；缓存落 private/logs/（SKIP_DIRS 内：不入库、不参与
# 统计、门禁也拦 private/）；--baseline 强制真扫；ZF_NO_SCAN_CACHE=1 逃生舱；
# 缓存损坏 / 写失败自动降级为全量扫，不阻断。
CACHE_FILE = ROOT / 'private' / 'logs' / 'scan_cache.json'
CACHE_VERSION = 2
# 逃生舱：设 ZF_NO_SCAN_CACHE=1 时强制全量真扫

# 排除：非产品代码 / 归档 / 内嵌解释器 / 隐私运行时
# trash：删除缓冲垃圾箱（产品自带回收站，30 天自动清）——已删除文件不计反模式
SKIP_DIRS = {'.git', 'archive', 'node_modules', '__pycache__', 'python',
             '历史版本', 'private', 'data', 'docs', 'tmp', 'trash',
             'zf-trash', '.zf-trash', 'exports', 'system', 'tmp_audit'}   # +exports/system：发布导出副本与回收站是全项目镜像，绝不可计入测量口径（2026-11-25 门禁假红复盘）  # 20261124：实际垃圾箱目录名是 zf-trash，与上方 trash 意图对齐（已删除文件不计）
# print 指标豁免目录：命令行工具与测试的 stdout 输出是其本职，不算"print 当日志"
PRINT_EXEMPT_PREFIXES = {('scripts',), ('tests',), ('tools', 'hooks'),
                         ('tools', 'quality'), ('tools', 'release'),
                         ('tools', 'sandbox')}   # M1.0 沙箱验证工具：stdout 即报告
# print 指标豁免文件（20261123 口径修正）：这些文件的 print 是【命令行界面输出】
# （CLI 入口 / 桌面独立进程 / 自检脚本的用户可见输出），迁移到文件日志反而破坏 UX，
# 且桌面/网关独立进程与主服务共写轮转日志在 Windows 有锁险。与"print 当日志"
# （运行时模块把 stdout 当日志用）性质不同，如实分开统计。
PRINT_EXEMPT_FILES = {
    'server/cli.py',                                # CLI 入口
    'tools/webrecon/cli.py',                        # webrecon CLI 入口
    'tools/pre_release_check.py',                   # 发布检查器（控制台报告即输出）
    'server/tools/selftest_town.py',                # 自检脚本
    'tools/coding/backend/self_check.py',           # 自检守护（快照五查同源）
    'server/tray_server.py',                        # 托盘独立进程
    'server/webview_client.py',                     # 桌面壳独立进程
    'ai_proxy.py',                                  # 独立计费网关进程（敏感面）
    'tools/comfy_bridge.py',                        # 桥接工具（控制台交互）
    # --- 20261123 全量扫清时追加：同类控制台 UX / 构建与一次性脚本 ---
    'server/tools/rebuild_dispatch.py', 'server/tools/eval_question_bank.py',
    'server/tools/tmp_patch_topics.py', 'server/tools/check_prompt_sync.py',
    'server/tools/check_js_release.py', 'server/chess_engine/_diag1.py',
    'public/canvas/小说/build_sanguo.py',
    'tools/hygiene_gate.py', 'tools/check_encoding.py',
    'tools/coding/e2e_guard_test.py', 'server/plaza/test_plaza.py',
    'server/chess_engine/smoke_test.py',
    'server/view_guard.py',  # 一次性调试探针（读 5.1.2 旧版路径，控制台输出即输出）
    # --- canvas 内容构建脚本（控制台 UX，20261123 全量扫清时甄别）---
    'public/canvas/小说/_build_sunzi.py', 'public/canvas/小说/fetch_sanguo.py',
    'public/canvas/小说/restyle_inovel.py', 'public/canvas/演示/tools/import_md.py',
    'public/canvas/演示/tools/import_pptx.py',
}
# undeclared_import 指标额外豁免：运行时/垃圾目录的 py 不代表产品依赖面
UNDECLARED_EXTRA_SKIP = {'zf-trash', '.zf-trash', '垃圾桶', '垃圾箱', 'temp',
                         'outputs_villager', 'extensions_disabled_backup'}
# import 顶名 -> 分发名（requirements.txt 写法）别名表；比对前统一小写；未列出的按原名比对
IMPORT_ALIAS = {'crypto': 'pycryptodome', 'pil': 'pillow', 'cv2': 'opencv_python',
                'sklearn': 'scikit_learn', 'yaml': 'pyyaml', 'bs4': 'beautifulsoup4',
                'dotenv': 'python_dotenv', 'docx': 'python_docx', 'pptx': 'python_pptx',
                'serial': 'pyserial', 'websocket': 'websocket_client',
                'win32api': 'pywin32', 'win32con': 'pywin32', 'win32gui': 'pywin32',
                'win32com': 'pywin32', 'pythoncom': 'pywin32', 'webview': 'pywebview'}
# 已知缺失的首方模块（视频合成功能残缺：server/video/ 仅有 director_ai.py，
# video_tools.py/fx_cut.py 文件缺失，导入点为死路径）——不计入未声明第三方指标，
# 缺陷单独登记（验收报告收尾轮），修复时应补齐模块文件而非声明依赖
KNOWN_MISSING_FIRST_PARTY = {'fx_cut', 'video_tools', 'evolution'}  # evolution: server/evolution_lab/ 本地一等模块（sys.path 注入加载，非第三方）
RE_EXCEPT_EXC = re.compile(r'except\s+Exception\b')
RE_EXCEPT_PASS = re.compile(r'except[^\n:]*:\s*pass\b')
RE_PRINT = re.compile(r'^\s*print\(', re.M)
RE_SCRIPT_SRC = re.compile(r'<script[^>]*?src="([^"]+)"', re.I)

METRIC_ORDER = ['except_exception', 'except_pass', 'print_stmt',
                'exec_call', 'dup_module_def', 'parse_errors',
                'html_dup_script', 'html_mojibake', 'text_mojibake', 'undeclared_import']

# ---- 乱码检测（2026-11-24 白屏事故防复发：UTF-8 文件被按 GBK 误读重写）----
# 事故原型：index.html 标题被写成乱码且 </title> 的 '<' 被吃掉 → 标签永不闭合，
# 整个文档被吞进 <title> → 页面全白。判据三重（阈值经全仓校准：1477 文件、
# 事故样本 11/11 自检、误报机制逐一甄别）：
#   ① 宇宙预筛：行内非 ASCII 连续段（≥2 字符）落入「UTF-8 中文按 GBK 配对可达
#      字符宇宙」占比 ≥ 0.75。宇宙 = 引导字节(81-BF ∪ E2-E9 ∪ EF) × 尾字节(40-7E
#      ∪ 80-BF ∪ E2-EF) 的 GBK 解码结果；正版常用字 GBK 码位大多落不进该空间。
#   ② 往返验证：段 GBK 编回字节后按 UTF-8 宽松解码，须还原出 ≥2 个中文。
#   ③ 还原质量：外来脚本碎片（西里尔/希腊等误配产物）必须为 0；替换符（尾部
#      丢字节）≤ max(1, 中文字数//2)。实测正版中文误判样（版本变化/查看清单）
#      还原出 [替换,汉字,替换,汉字] junk=2 被此条拒绝，真乱码 junk≤1 全保留。
MOJIBAKE_SCAN_EXTS = ('.js', '.css', '.json', '.html')
# 豁免文件：内容本身就是乱码→中文修复映射表（键即乱码样本，设计使然）。
# tools/fix_encoding.ps1 不在扫描扩展名内，无需登记。
MOJIBAKE_INTENTIONAL_FILES = {'tools/fix_caizhi.js'}
_MOJI_UNI = None


def _mojibake_universe():
    """可达宇宙单例（~9k 字符，首次构建毫秒级）。"""
    global _MOJI_UNI
    if _MOJI_UNI is None:
        leads = set(range(0x81, 0xC0)) | set(range(0xE2, 0xEA)) | {0xEF}
        trails = set(range(0x40, 0x7F)) | set(range(0x80, 0xC0)) | set(range(0xE2, 0xF0))
        uni = set()
        for b1 in leads:
            for b2 in trails:
                with contextlib.suppress(UnicodeDecodeError):
                    uni.add(bytes([b1, b2]).decode('gbk'))
        _MOJI_UNI = uni
    return _MOJI_UNI


def _moji_clean_char(c):
    """还原结果里的「干净」字符：中文/中文标点/全角/ASCII。"""
    return (0x4E00 <= ord(c) <= 0x9FFF or 0x3000 <= ord(c) <= 0x303F
            or 0xFF00 <= ord(c) <= 0xFFEF or ord(c) < 0x7F)


def _moji_line_flag(line, uni):
    """行级判定：任一非 ASCII 连续段三重判据全过 → 该行计乱码。"""
    for m in re.finditer(r'[^\x00-\x7f]{2,}', line):
        run = m.group()
        if sum(1 for c in run if c in uni) / len(run) < 0.75:
            continue
        try:
            restored = run.encode('gbk').decode('utf-8', errors='replace')
        except UnicodeEncodeError:
            continue
        cjk = sum(1 for c in restored if 0x4E00 <= ord(c) <= 0x9FFF)
        if cjk < 2:
            continue
        clean = sum(1 for c in restored if _moji_clean_char(c))
        junk = len(restored) - clean - restored.count(' ')
        if junk <= max(1, cjk // 2):
            return True
    return False


def _count_mojibake(text, uni):
    """逐行计数（指标口径 = 乱码行数，与其它指标「处」粒度一致）。"""
    return sum(1 for ln in text.splitlines() if _moji_line_flag(ln, uni))


def _first_party_names():
    """全仓目录名 + .py 模块名集合 = 首方模块名（routes/插件等子目录里的
    模块常被以顶层名 import——sys.path 根不止仓库根，故按全量名字识别）。"""
    names = set()
    skip = SKIP_DIRS | UNDECLARED_EXTRA_SKIP
    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel = Path(dirpath).relative_to(ROOT)
        if any(part in skip for part in rel.parts):
            dirnames[:] = []
            continue
        dirnames[:] = [d for d in dirnames if d not in skip]
        names.update(dirnames)
        names.update(f[:-3] for f in filenames if f.endswith('.py'))
    return names


def _declared_packages():
    """requirements.txt 声明的分发名集合（小写、- 归一为 _，去版本约束/extras）。"""
    names = set()
    try:
        for line in REQUIREMENTS.read_text('utf-8-sig').splitlines():
            line = line.split('#', 1)[0].strip()
            if not line:
                continue
            token = re.split(r'[=<>!~;\s\[]', line, 1)[0].strip().lower()
            if token:
                names.add(token.replace('-', '_'))
    except OSError:
        pass
    return names


def _unguarded_imports(tree):
    """收集"未被 try 保护的"import 顶名——可选扩展模块一律 try/except ImportError
    懒加载（优雅降级），不会崩启动；会崩的只有裸 import（fastmcp 事故原型）。
    try/except 儿孙节点内的 import 视为受保护；except/orelse/finalbody 内的
    import 仍按其位置语境判定（orelse/finalbody 正常执行路径不受保护）。"""
    names = set()

    def visit(node, in_try):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.Import):
                if not in_try:
                    for alias in child.names:
                        names.add(alias.name.split('.')[0])
            elif isinstance(child, ast.ImportFrom):
                # 相对导入（level>0）必为首方模块；from . import x 无顶名可判
                if not in_try and child.module and child.level == 0:
                    names.add(child.module.split('.')[0])
            elif isinstance(child, ast.Try):
                # 整个 Try 子树（含 orelse/finalbody）内的 import 视为受保护
                visit(child, True)
                continue
            visit(child, in_try)

    visit(tree, False)
    return names


def count_file(py, count_print, count_moji=False):
    """返回单文件的 (regex计数dict, exec调用数, 重复定义数, 解析是否失败, 裸import顶名集合)。"""
    text = py.read_text('utf-8-sig', errors='ignore')
    counts = {
        'except_exception': len(RE_EXCEPT_EXC.findall(text)),
        'except_pass': len(RE_EXCEPT_PASS.findall(text)),
        'print_stmt': len(RE_PRINT.findall(text)) if count_print else 0,
        # .py 的乱码计数随本函数顺带完成（文本已读，零额外 IO）；canvas/ 不入产品口径
        'text_mojibake': _count_mojibake(text, _mojibake_universe()) if count_moji else 0,
    }
    exec_calls = 0
    dup_defs = 0
    parse_ok = True
    imports = set()
    try:
        tree = ast.parse(text, filename=str(py))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                    and node.func.id == 'exec':
                exec_calls += 1
        # 同作用域重复定义（_bf_dbg 型半截补丁探测器）：
        #   - 模块级同名函数定义多次（后定义静默覆盖先定义，事故原型）
        #   - 同一个类体内同名方法定义多次（同类覆盖疤痕）
        # 跨类同名方法是合法模式（不同类各有一个 handle 等），不计。
        dup_defs = _count_scope_dups(tree)
        imports = _unguarded_imports(tree)
    except SyntaxError:
        parse_ok = False
    return counts, exec_calls, dup_defs, parse_ok, imports


def _count_scope_dups(tree):
    """按作用域统计同名定义重复：模块体 + 每个类体/函数体各自独立计数。"""
    total = 0

    def scan(body):
        nonlocal total
        names = Counter()
        for node in body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                names[node.name] += 1
        total += sum(n - 1 for n in names.values() if n > 1)
        for node in body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                scan(node.body)

    scan(tree.body)
    return total


def _iter_files(ext):
    """遍历待扫文件（os.walk 剪枝：SKIP_DIRS 目录整枝跳过——不再空走 python/
    内嵌解释器等巨目录，这是旧 rglob 全树遍历热路径 ~1s 的主因）。"""
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if name.lower().endswith(ext):   # lower：Windows 下 rglob 原本大小写不敏感，保持一致
                p = Path(dirpath) / name
                yield p, p.relative_to(ROOT)


def scan(use_cache=None):
    """全仓反模式扫描。默认走指纹缓存（未变文件不重扫），尺子变化自动全量失效。

    指纹三要素：① 逐文件 size+mtime_ns（任何被扫文件变了→增量失效）；② 扫描器
    自身（本文件）——METRIC_ORDER/豁免清单/别名表等口径全在文件内，尺子变了整份
    缓存作废；③ requirements.txt（声明面变了→undeclared_import 需重算，而 import
    顶名必须重收集）。--baseline 与 ZF_NO_SCAN_CACHE=1 强制全量真扫。
    """
    no_cache = ('--baseline' in sys.argv
                or (os.environ.get('ZF_NO_SCAN_CACHE') == '1'))
    if use_cache is False or (use_cache is None and no_cache):
        return _scan_full(persist=False)

    cached = _load_cache()
    if cached is None:
        return _scan_full(persist=True)

    prev_files = cached['files']
    prev_size = cached.get('scanner_fingerprint')
    req_now = _requirements_fingerprint()
    if cached.get('requirements_fingerprint') != req_now or prev_size != _scanner_fingerprint():
        return _scan_full(persist=True)   # 尺子/声明面变了：整份缓存作废

    total = {m: 0 for m in METRIC_ORDER}
    n_files = 0
    all_imports = set()
    changed = []                       # 需要重扫的文件
    seen_rels = set()                  # 现存文件清单（清理缓存死条目用）
    first_party = _first_party_names()
    for py, rel in _iter_files('.py'):
        parts = rel.parts
        n_files += 1
        seen_rels.add(str(rel))
        fp = _file_fingerprint(py)
        prev = prev_files.get(str(rel))
        if prev is None or prev[0] != fp:
            changed.append((py, rel, parts))
            continue
        # 未变：复用上次逐文件结果
        old = prev[1]
        for k, v in old['counts'].items():
            total[k] += v
        total['exec_call'] += old['exec_calls']
        total['dup_module_def'] += old['dup_defs']
        if not old['parse_ok']:
            total['parse_errors'] += 1
        if not any(part in UNDECLARED_EXTRA_SKIP for part in parts):
            all_imports |= set(old['imports'])

    for py, rel, parts in changed:     # 只真扫新增/修改过的文件
        count_print = not any(tuple(parts[:len(p)]) == p for p in PRINT_EXEMPT_PREFIXES) \
            and rel.as_posix() not in PRINT_EXEMPT_FILES
        counts, exec_calls, dup_defs, parse_ok, imports = count_file(
            py, count_print, 'canvas' not in parts)
        for k, v in counts.items():
            total[k] += v
        total['exec_call'] += exec_calls
        total['dup_module_def'] += dup_defs
        if not parse_ok:
            total['parse_errors'] += 1
        if not any(part in UNDECLARED_EXTRA_SKIP for part in parts):
            all_imports |= imports
        prev_files[str(rel)] = (fp, {'counts': counts, 'exec_calls': exec_calls,
                                     'dup_defs': dup_defs, 'parse_ok': parse_ok,
                                     'imports': sorted(imports)})

    # 被删除的文件从缓存里清掉（防缓存无限膨胀）
    for dead in list(prev_files):
        if dead not in seen_rels:
            del prev_files[dead]

    total['_files_scanned'] = n_files
    html_store = _html_metrics(total, cached.get('html') or {})   # html 同样按指纹复用
    text_store = _text_metrics(total, cached.get('text') or {})   # 乱码域按指纹复用
    _imports_metrics(total, all_imports, first_party)
    _save_cache({'version': CACHE_VERSION,
                 'scanner_fingerprint': _scanner_fingerprint(),
                 'requirements_fingerprint': req_now,
                 'files': prev_files,
                 'html': html_store,
                 'text': text_store})
    return total


def _text_metrics(total, prev=None):
    """乱码域指标（js/css/json/html，2026-11-24 白屏事故防复发）。

    .py 由 count_file 在读文本时顺带计数，此处不重复。口径对齐校准脚本：
    canvas/（内容演示区）、.bak 备份、乱码映射表豁免文件不计。
    prev=上次逐文件缓存 {rel: [指纹, 计数]}，未变文件直接复用。"""
    uni = _mojibake_universe()
    out = {}
    details = []
    for ext in MOJIBAKE_SCAN_EXTS:
        for f, rel in _iter_files(ext):
            key = str(rel)
            # 路径统一正斜杠比对（Windows str(rel) 是反斜杠，豁免名单会被静默绕过）
            if '.bak' in f.name.lower() or rel.as_posix() in MOJIBAKE_INTENTIONAL_FILES:
                continue
            if 'canvas' in rel.parts:
                continue
            fp = _file_fingerprint(f)
            old = prev.get(key) if prev else None
            if old and old[0] == fp:
                n = old[1]
            else:
                try:
                    text = f.read_text('utf-8', errors='replace')
                except OSError:
                    continue
                n = _count_mojibake(text, uni)
            out[key] = [fp, n]
            if n:
                total['text_mojibake'] += n
                details.append('%s×%d' % (key, n))
    if details:
        shown = details[:15]
        more = len(details) - len(shown)
        total['_text_mojibake_detail'] = ' '.join(shown) + (' …等%d个文件' % more if more > 0 else '')
    return out


def _html_metrics(total, prev=None):
    """html 域指标（20261123 Phase 4.3）：重复 script 加载与乱码注释。

    prev=上次逐文件缓存 {rel: [指纹, mojibake, dup]}，未变文件直接复用；
    返回最新逐文件结果供写入缓存。"""
    out = {}
    for h, rel in _iter_files('.html'):
        key = str(rel)
        fp = _file_fingerprint(h)
        old = prev.get(key) if prev else None
        if old and old[0] == fp:
            mo, dup = old[1], old[2]
        else:
            try:
                text = h.read_text('utf-8', errors='ignore')
            except OSError:
                continue
            text = re.sub(r'<!--.*?-->', '', text, flags=re.S)  # 注释掉的死标签/损毁注释不计数
            mo = text.count('?????')
            srcs = Counter(s.split('?')[0].lower()
                           for s in RE_SCRIPT_SRC.findall(text))
            dup = sum(n - 1 for n in srcs.values() if n > 1)
        out[key] = [fp, mo, dup]
        total['html_mojibake'] += mo
        total['html_dup_script'] += dup
    return out


def _imports_metrics(total, all_imports, first_party):
    """SprintB 第 7 指标（20261123）：第三方 import 去重数 vs requirements.txt 声明。"""
    stdlib = getattr(sys, 'stdlib_module_names', set())
    third_party = {n.lower() for n in all_imports
                   if n and n.lower() not in stdlib
                   and n.lower() not in first_party
                   and not n.startswith('_')}
    mapped = {IMPORT_ALIAS.get(n, n) for n in third_party}
    undeclared = sorted((mapped - _declared_packages()) - KNOWN_MISSING_FIRST_PARTY)
    total['undeclared_import'] = len(undeclared)
    total['_undeclared_names'] = ' '.join(undeclared)


def _file_fingerprint(py):
    """单文件指纹：size + mtime_ns（纳秒级，普通编辑必变）。"""
    try:
        st = py.stat()
        return '%d:%d' % (st.st_size, st.st_mtime_ns)
    except OSError:
        return 'gone'


def _scanner_fingerprint():
    """扫描器自身指纹——口径全在本文件内，尺子变了缓存整体作废。"""
    return _file_fingerprint(Path(__file__))


def _requirements_fingerprint():
    return _file_fingerprint(REQUIREMENTS)


def _load_cache():
    """读缓存；缺失/损坏/版本不符/逃生舱 → 返回 None 走全量。"""
    if os.environ.get('ZF_NO_SCAN_CACHE') == '1':
        return None
    try:
        raw = json.loads(CACHE_FILE.read_text(encoding='utf-8'))
        if raw.get('version') != CACHE_VERSION or not isinstance(raw.get('files'), dict):
            return None
        return raw
    except (OSError, ValueError):
        return None


def _save_cache(payload):
    """写缓存；失败静默降级——缓存是加速器，不是数据资产。

    用 contextlib.suppress 而非「except 吞掉后写 pass」——本仓库 except_pass
    指标只许降不许涨，加速器自身不得贡献新计数。"""
    with contextlib.suppress(OSError):
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')


def _scan_full(persist=True):
    """真全量扫描（缓存冷启动 / 尺子变化 / --baseline / 逃生舱路径）。"""
    total = {m: 0 for m in METRIC_ORDER}
    n_files = 0
    all_imports = set()
    files = {}
    first_party = _first_party_names()
    for py, rel in _iter_files('.py'):
        parts = rel.parts
        n_files += 1
        count_print = not any(tuple(parts[:len(p)]) == p for p in PRINT_EXEMPT_PREFIXES) \
            and rel.as_posix() not in PRINT_EXEMPT_FILES
        counts, exec_calls, dup_defs, parse_ok, imports = count_file(
            py, count_print, 'canvas' not in parts)
        for k, v in counts.items():
            total[k] += v
        total['exec_call'] += exec_calls
        total['dup_module_def'] += dup_defs
        if not parse_ok:
            total['parse_errors'] += 1
        if not any(part in UNDECLARED_EXTRA_SKIP for part in parts):
            all_imports |= imports
        files[str(rel)] = (_file_fingerprint(py),
                           {'counts': counts, 'exec_calls': exec_calls,
                            'dup_defs': dup_defs, 'parse_ok': parse_ok,
                            'imports': sorted(imports)})
    total['_files_scanned'] = n_files
    html_store = _html_metrics(total)
    text_store = _text_metrics(total)
    _imports_metrics(total, all_imports, first_party)
    if persist:
        _save_cache({'version': CACHE_VERSION,
                     'scanner_fingerprint': _scanner_fingerprint(),
                     'requirements_fingerprint': _requirements_fingerprint(),
                     'files': files,
                     'html': html_store,
                     'text': text_store})
    return total


def load_waivers(today=None):
    """读取带到期时间的豁免。返回 (生效中的 {指标: 条目}, 已过期 [(指标, until)], 非法 [(原因, 条目)])。

    条目格式（tools/quality/waivers.json 的 "waivers" 列表）：
        {"metric": "except_exception", "ceiling": 3930, "until": "2026-12-01",
         "reason": "为什么可以暂时超", "by": "谁批的"}
    生效条件：metric 在 METRIC_ORDER 内、ceiling 为整数、reason 非空、until 不早于今天。
    到期自动失效——豁免是"限期还债"，不是改基线的后门。同一指标多条生效时取最宽松的一条。"""
    import datetime
    today = today or datetime.date.today().isoformat()
    active, expired, invalid = {}, [], []
    if not WAIVERS.exists():
        return active, expired, invalid
    with contextlib.suppress(OSError, ValueError):
        raw = json.loads(WAIVERS.read_text(encoding='utf-8'))
        items = (raw.get('waivers') if isinstance(raw, dict) else raw) or []
        for w in items:
            if not isinstance(w, dict):
                invalid.append(('条目不是对象', w))
                continue
            m = w.get('metric')
            ceil = w.get('ceiling')
            until = str(w.get('until') or '')
            reason = str(w.get('reason') or '').strip()
            if m not in METRIC_ORDER or isinstance(ceil, bool) or not isinstance(ceil, int) or not reason:
                invalid.append(('字段缺失或非法（metric / ceiling 整数 / reason）', w))
                continue
            try:
                datetime.date.fromisoformat(until)
            except ValueError:
                invalid.append(('until 不是 YYYY-MM-DD', w))
                continue
            if until < today:
                expired.append((m, until))
                continue
            cur = active.get(m)
            if cur is None or (ceil, until) > (cur.get('ceiling', 0), str(cur.get('until') or '')):
                active[m] = w
    return active, expired, invalid


def report(now):
    """打印对比表，返回 (退出码, 结构化结果)。

    结构化结果供提交钩子留痕：
      exceeded {指标: (基线, 当前)}  未被豁免覆盖的上涨
      waived   {指标: 豁免条目}      被生效中的豁免覆盖的上涨
      blocked  [指标]                需要拦截的指标（即 exceeded 的键）
      expired  [(指标, until)]       已到期失效的豁免
    """
    info = {'exceeded': {}, 'waived': {}, 'blocked': [], 'expired': []}
    if not BASELINE.exists():
        print('[FAIL] 缺少 baseline.json，先跑: py tools/quality/count_antipatterns.py --baseline')
        return 2, info
    base = json.loads(BASELINE.read_text(encoding='utf-8'))
    active, expired, invalid = load_waivers()
    print('%-18s %8s %8s  %s' % ('metric', 'baseline', 'now', 'verdict'))
    for m in METRIC_ORDER:
        b, n = base.get(m, 0), now.get(m, 0)
        if n <= b:
            verdict = 'OK'
        else:
            w = active.get(m)
            if w and n <= w.get('ceiling', 0):
                verdict = 'WAIVED (至 %s，上限 %d)' % (w.get('until'), w.get('ceiling', 0))
                info['waived'][m] = w
            else:
                verdict = 'FAIL (+%d)' % (n - b)
                info['exceeded'][m] = (b, n)
                info['blocked'].append(m)
        print('%-18s %8d %8d  %s' % (m, b, n, verdict))
    print('scanned .py files:', now['_files_scanned'])
    if now.get('undeclared_import'):
        print('[i] 未声明第三方 import（应补录 requirements.txt）:',
              now.get('_undeclared_names', ''))
    if now.get('text_mojibake'):
        print('[i] 乱码行明细（文件×行数，GBK 误读防复发）:',
              now.get('_text_mojibake_detail', ''))
    info['expired'] = expired
    for m, until in expired:
        print('[i] 已到期失效的豁免: %s（until %s）。到期即恢复硬口径；确需续期请更新 until 并写明理由'
              % (m, until))
    for why, w in invalid:
        print('[!] 非法豁免条目已忽略: %s -> %s' % (why, json.dumps(w, ensure_ascii=False)[:120]))
    if info['waived']:
        print('[WAIVED] %d 项上涨在豁免期内放行: %s'
              % (len(info['waived']), ', '.join(sorted(info['waived']))))
    if info['blocked']:
        print('[FAIL] 反模式上涨，禁止提交: %s' % ', '.join(info['blocked']))
        print('       处置三选一：① 当场消化（把新增的宽泛异常捕获、静默吞异常、print 改掉）；'
              '② 确属合理新增，在 tools/quality/waivers.json 登记 ceiling 与 until（到期自动失效，须写理由）；'
              '③ 保护性快照不受此限。')
        return 1, info
    print('[OK] 全部指标未超基线（只许降不许涨）%s'
          % ('；其中 %d 项在豁免期内' % len(info['waived']) if info['waived'] else ''))
    return 0, info


def main():
    with contextlib.suppress(Exception):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    now = scan()
    if '--baseline' in sys.argv:
        BASELINE.write_text(json.dumps(now, indent=2), encoding='utf-8')
        print('baseline 已锁定 ->', BASELINE)
        print(json.dumps(now, indent=2))
        return 0
    rc, _info = report(now)
    return rc


if __name__ == '__main__':
    sys.exit(main())
