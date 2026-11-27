# -*- coding: utf-8 -*-
"""文件保护清单（两级：readonly 只读 / critical 关键）。

设计目标：
- readonly  坚决不可动。连写都不发生；shell 改写/删除同样硬拦。
- critical  可以改，但必须过多重验证：
    1) 写前内容合法性检查（乱码 / 语法错 / 体量突然缩水 / 锚点缺失）
    2) 写后回读比对（落盘内容与拟写入内容是否一致）
    任一关不过即拒绝写入，并自动回滚到写前快照，不会留下半坏文件。

对外接口：
    check_write(path)                       -> (ok: bool, err: str|None)
        readonly 直接返回 (False, 原因)；critical 返回 (True, 提示文案)；
        不在清单返回 (True, None)
    precheck(path, new_content)             -> (ok: bool, err: str|None)
        仅对 critical 生效的写前校验
    verify_after_write(path, expected)      -> (ok: bool, err: str|None)
        写后回读比对
    rollback(path)                          -> dict
        从最近一次快照恢复
    add(path, level) / remove(path) / list() / level_of(path)

清单存储：private/file_protection.json（项目根 private 目录）。
支持 glob 与目录前缀；readonly 优先级高于 critical，两级互斥。
出错时的行为（2026-11-24）：
  - 校验类检查（precheck / 语法 / 体量 / 锚点）自身出错不阻断写入，维持既有行为；
  - 保护清单本身读不出来（JSON 损坏、顶层结构不对）一律拒绝（fail-closed）：list_all()['load_error']
    非空即处于拒绝态——此时一切写入、一切 shell 命令都被拒；损坏的清单不会被自动覆盖，
    由人修复或删除它（删除后自动重建默认清单并重新并入执法设施）。
"""

import ast
import json
import os
import re
import tempfile
import time

# 模块自身位于 tools/coding/backend/，上溯 3 层即项目根
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
PRIVATE_DIR = os.path.join(PROJECT_ROOT, 'private')
LIST_FILE = os.path.join(PRIVATE_DIR, 'file_protection.json')
SNAPSHOT_DIR = os.path.join(PRIVATE_DIR, 'file_protect_snapshots')

LEVEL_READONLY = 'readonly'
LEVEL_CRITICAL = 'critical'

# 快照保留份数（关键文件长期可回滚）
MAX_SNAPSHOTS = 20

_cache = {'data': None, 'mtime': None, 'loaded_at': 0.0}

# 执法设施清单模块（server/util_enforcement.py）。按路径加载，不依赖 sys.path ——
# 本模块既在服务进程里用，也在提交钩子里用，两种环境的 sys.path 并不相同。
_enforcement_mod = None


def _enforcement():
    """取执法设施清单模块；取不到返回 None（保护加不上时不阻断写入，维持既有行为）。"""
    global _enforcement_mod
    if _enforcement_mod is not None:
        return _enforcement_mod
    try:
        import importlib.util as _ilu
        p = os.path.join(PROJECT_ROOT, 'server', 'util_enforcement.py')
        if not os.path.isfile(p):
            return None
        spec = _ilu.spec_from_file_location('util_enforcement', p)
        if spec is None or spec.loader is None:
            return None
        mod = _ilu.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _enforcement_mod = mod
        return mod
    except (ImportError, OSError, SyntaxError, ValueError):
        return None


def _listed(data, path, level):
    return any(str(x).strip() == path for x in (data.get(level) or []))


def ensure_enforcement():
    """把执法设施并入保护清单（幂等，每个进程首次读清单时自动执行一次）。

    规则：
      - 只增不删：不动任何已有条目
      - 清单要求只读的路径，若已被登记为 critical，则升为只读（只读是最低要求，不降级）
      - 清单要求 critical 的路径，若已是只读，保持只读（不擅自降级）
      - 开关文件（ENFORCEMENT_READONLY_FLAGS，如紧急停止开关）同样按只读并入，不要求文件存在
      - 人工豁免：清单 JSON 里的 "enforcement_optout" 列表（由人维护），其中的路径跳过
      - 清单处于拒绝态（load_error）时不做任何改动，见 _load

    同时修正一处历史遗留：旧默认清单把 security.py / config.py / db.py / server.py 写成
    裸文件名，而匹配按“项目根相对路径”计算，这些条目从未命中过真实文件——
    这四个核心文件此前实际上处于无校验写入状态。

    返回 {'ok': bool, 'changed': bool, 'added': [(路径, 级别)], ...}。
    """
    spec = _enforcement()
    if spec is None:
        return {'ok': False, 'changed': False, 'added': [], 'error': 'util_enforcement unavailable'}
    data = _load()
    if data.get('load_error'):
        # 拒绝态下不落盘：否则会把损坏的清单覆盖成“只剩执法条目”的新清单，其余条目与锚点全丢
        return {'ok': False, 'changed': False, 'added': [],
                'error': '保护清单无法解析，未做任何改动: %s' % data['load_error']}
    optout = set(data.get('enforcement_optout') or [])
    added, changed = [], False
    targets = ([(p, LEVEL_READONLY) for p in
                spec.ENFORCEMENT_READONLY + tuple(getattr(spec, 'ENFORCEMENT_READONLY_FLAGS', ()))] +
               [(p, LEVEL_CRITICAL) for p in spec.ENFORCEMENT_CRITICAL])
    for path, level in targets:
        if path in optout:
            continue
        if level == LEVEL_READONLY:
            if _listed(data, path, LEVEL_READONLY):
                continue
            if _listed(data, path, LEVEL_CRITICAL):
                # 升级：从 critical 挪到 readonly
                data[LEVEL_CRITICAL] = [x for x in (data.get(LEVEL_CRITICAL) or [])
                                        if str(x).strip() != path]
                data.setdefault(LEVEL_READONLY, []).append(path)
                added.append((path, level))
                changed = True
                continue
        else:
            if _listed(data, path, LEVEL_READONLY) or _listed(data, path, LEVEL_CRITICAL):
                continue
        data.setdefault(level, []).append(path)
        added.append((path, level))
        changed = True
    if changed:
        if not _save(data):
            return {'ok': False, 'changed': False, 'added': added, 'error': 'save failed'}
    return {'ok': True, 'changed': changed, 'added': added}


# ---------------------------------------------------------------- 清单读写

def _default_list():
    return {
        'critical': [],
        'readonly': [],
        'anchors': {},
        'enforcement_optout': [],
    }


def _load():
    """按文件 mtime 增量刷新清单，避免进程内缓存读到旧数据。"""
    global _cache
    try:
        mtime = os.path.getmtime(LIST_FILE)
    except OSError:
        mtime = None
    cached = _cache['data']
    if cached is not None and _cache['mtime'] == mtime:
        # 拒绝态只短缓存 2 秒：文件修好了而修改时间粒度没变（或刚才只是瞬时读失败）时能自动恢复
        if not cached.get('load_error') or time.time() - _cache.get('loaded_at', 0) < 2:
            return cached
    data = _default_list()
    if not os.path.isfile(LIST_FILE):
        # 清单缺失（首次运行 / 重装 / 误删）时立即补默认清单。
        # 否则 readonly/critical 保护会静默失效（历史故障：selftest 报"readonly 保护清单为空"）。
        try:
            init_default()
            return _load()
        except Exception:
            pass
    load_error = None
    try:
        if os.path.isfile(LIST_FILE):
            # utf-8-sig：人工用记事本改过的清单可能带 BOM，不该因此被判为损坏
            with open(LIST_FILE, 'r', encoding='utf-8-sig') as f:
                raw = json.load(f)
            if not isinstance(raw, dict):
                load_error = '顶层不是 JSON 对象'
            else:
                for k in ('critical', 'readonly'):
                    v = raw.get(k)
                    if not isinstance(v, list):
                        load_error = load_error or ('"%s" 不是列表' % k)
                        continue
                    data[k] = [str(x) for x in v if isinstance(x, str)]
                a = raw.get('anchors')
                if isinstance(a, dict):
                    data['anchors'] = {str(k): v for k, v in a.items() if isinstance(v, (list, str))}
                oo = raw.get('enforcement_optout')
                if isinstance(oo, list):
                    data['enforcement_optout'] = [str(x) for x in oo if isinstance(x, str)]
    except (OSError, ValueError) as e:
        # json.JSONDecodeError 与 UnicodeDecodeError 都是 ValueError 子类；读文件是 OSError
        load_error = str(e)[:200]
    if load_error:
        # 【fail-closed】清单读不出来 = 不知道什么受保护，不能按“什么都不受保护”放行。
        # 拒绝态：check_write 一律拒绝，_protect_cmd_hit 一律拒绝；这里再让项目内文件按只读匹配，
        # 兜住只看 level_of / _entries 的调用方。不落盘——损坏的清单留给人处理，也不自动并入执法条目。
        data['readonly'] = [PROJECT_ROOT]
        data['load_error'] = load_error
    _cache['data'] = data
    _cache['mtime'] = mtime
    _cache['loaded_at'] = time.time()
    if load_error:
        return data
    # 每个进程首次读清单时，把执法设施并入（幂等；失败不阻断，维持既有行为）。
    # 先置位再调用，防递归：ensure_enforcement 内部还会调 _load。
    if not _cache.get('enforced'):
        _cache['enforced'] = True
        ensure_enforcement()
    return data


def _save(data):
    try:
        os.makedirs(PRIVATE_DIR, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=PRIVATE_DIR, suffix='.tmp')
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, LIST_FILE)
        _cache['data'] = data
        try:
            _cache['mtime'] = os.path.getmtime(LIST_FILE)
        except OSError:
            _cache['mtime'] = None
        return True
    except Exception:
        return False


def _norm(path):
    try:
        p = str(path or '').strip()
        if not p:
            return ''
        return os.path.abspath(os.path.expanduser(p)).replace('\\', '/').rstrip('/')
    except Exception:
        return str(path or '')


def _entries(level):
    return [x for x in (_load().get(level) or []) if x]


def _match(path, patterns):
    """path 命中 patterns 中任一条目即返回该条目（供报错指明规则）。

    支持三种写法：
      - 绝对路径 / 项目内绝对路径：精确或前缀（目录）匹配
      - 相对项目根的路径：转绝对后匹配
      - glob：用 fnmatch 匹配绝对路径与相对路径两种形态
    """
    p = _norm(path)
    if not p:
        return None
    rel = p[len(PROJECT_ROOT):].lstrip('/') if p.startswith(PROJECT_ROOT) else p
    for pat in patterns:
        raw = str(pat).strip()
        if not raw:
            continue
        cand = _norm(raw)
        if p == cand or p.startswith(cand + '/'):
            return raw
        if raw.endswith('/') and (rel + '/').startswith(raw):
            return raw
        if any(ch in raw for ch in '*?['):
            import fnmatch
            if fnmatch.fnmatch(p, cand) or fnmatch.fnmatch(rel, raw):
                return raw
    return None


def level_of(path):
    """返回文件所属保护级别；不在清单返回 None。readonly 优先。"""
    try:
        data = _load()
        if _match(path, data.get('readonly') or []):
            return LEVEL_READONLY
        if _match(path, data.get('critical') or []):
            return LEVEL_CRITICAL
    except Exception:
        return None
    return None


def check_write(path):
    """写入前闸门。

    返回 (ok, err)：
      - readonly          -> (False, 'readonly protected: ...')
      - critical          -> (True, 'critical protected: 需通过多重校验')  （提示用）
      - 不在清单/异常      -> (True, None)
    """
    try:
        data = _load()
        if data.get('load_error'):
            return False, ('readonly protected: 保护清单无法解析（%s），fail-closed：已拒绝一切写入。'
                           '请人工检查或删除 %s 后重试；删除后会自动重建默认清单。'
                           % (data['load_error'], LIST_FILE))
        lvl = level_of(path)
    except Exception as e:
        # 这是授权类检查：检查自身出错时拒绝，而不是放行
        return False, 'readonly protected: 写保护检查出错，fail-closed 拒绝写入(%s)' % e
    if lvl == LEVEL_READONLY:
        return False, ('readonly protected: %s 是只读保护文件，禁止写入/修改/删除。'
                       '如需变更请先在管理工具中移除只读保护。' % path)
    if lvl == LEVEL_CRITICAL:
        return True, ('critical protected: %s 是关键文件，本次修改已启用多重校验'
                      '（写前内容检查 + 写后回读比对），校验失败将自动回滚。' % path)
    return True, None


# ---------------------------------------------------------------- 校验逻辑

_GARBLE_CHARS = '\ufffd'
_CTRL_RE = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f]')
_REPEAT_RE = re.compile(r'(.)\1{80,}')


def _looks_garbled(text):
    """乱码/半损坏内容检测。返回 (is_bad, reason)。"""
    if not isinstance(text, str):
        return True, 'content is not text'
    if _GARBLE_CHARS in text:
        return True, 'contains replacement char U+FFFD（内容疑似乱码）'
    m = _CTRL_RE.search(text)
    if m:
        return True, 'contains control char 0x%02x（内容疑似二进制损坏）' % ord(m.group(1))
    if _REPEAT_RE.search(text):
        return True, 'contains abnormally repeated characters（内容疑似写坏）'
    if text and not text.strip():
        return True, 'content is blank（清空关键文件视为损坏）'
    return False, None


def _syntax_check(path, content):
    """按扩展名做语法校验。无法校验的类型放行。"""
    low = str(path).lower()
    try:
        if low.endswith('.py'):
            ast.parse(content, filename=str(path))
            return True, None
        if low.endswith(('.js', '.jsx', '.mjs', '.ts')):
            # JS 用 node --check（无 node 时跳过，不阻断）
            import subprocess
            fd, tmp = tempfile.mkstemp(suffix=os.path.splitext(path)[1], dir=PRIVATE_DIR if os.path.isdir(PRIVATE_DIR) else None)
            try:
                with os.fdopen(fd, 'w', encoding='utf-8') as f:
                    f.write(content)
                r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                if r.returncode != 0 and r.stderr:
                    return False, 'JS syntax check failed: ' + (r.stderr or '').strip()[:300]
            finally:
                try:
                    os.remove(tmp)
                except OSError:
                    pass
            return True, None
        if low.endswith('.json'):
            json.loads(content)
            return True, None
    except SyntaxError as e:
        return False, 'syntax check failed for %s: line %s: %s' % (path, getattr(e, 'lineno', '?'), getattr(e, 'msg', str(e)))
    except json.JSONDecodeError as e:
        return False, 'JSON syntax check failed for %s: line %s col %s: %s' % (path, getattr(e, 'lineno', '?'), getattr(e, 'colno', '?'), getattr(e, 'msg', str(e)))
    except Exception:
        # 缺 node 等环境问题不阻断
        return True, None
    return True, None


def _size_check(path, new_content):
    """体量突变检查：新内容相对旧内容缩水过多视为损坏。"""
    try:
        if not os.path.isfile(path):
            return True, None
        with open(path, 'r', encoding='utf-8', errors='replace') as f:
            old = f.read()
        old_len, new_len = len(old), len(new_content)
        if old_len >= 2000 and new_len < old_len * 0.5:
            return False, ('size dropped too much: %d -> %d bytes（原文件 %d 字节，'
                           '新内容仅 %d，疑似被截断）' % (old_len, new_len, old_len, new_len))
    except Exception:
        return True, None
    return True, None


def _anchor_check(path, new_content):
    """锚点检查：清单里登记的关键函数/类名是否还在。比语法检查更能抓"被删段"。"""
    try:
        anchors = _load().get('anchors') or {}
        keys = _match(path, list(anchors.keys()))
        if not keys:
            return True, None
        names = anchors.get(keys) or []
        if isinstance(names, str):
            names = [names]
        missing = []
        for n in names:
            n = str(n).strip()
            if n and n not in new_content:
                missing.append(n)
        if missing:
            return False, 'anchor missing: 关键定义 %s 不在新内容中（疑似被误删）' % ', '.join(missing)
    except Exception:
        return True, None
    return True, None


# ---------------------------------------------------------------- L0 卫生四查（2026-11-22）

# 【仓库卫生策划案 2026-11-22】precheck/verify_after_write 只保护清单内文件，
# 其余写入零审核——56 个根残渣与 .gitignore 乱码即由此入库。hygiene_check 把
# 轻量四查扩到所有写入（"写完必须审核"的机械落点），与保护清单解耦：
#   ①内容损坏（U+FFFD/控制符净增） ②空新文件 ③畸形文件名 ④根层白名单外提醒
# 拦截只拒绝写入并在报错中说明原因（会话可改名/改内容重试），不做回滚。

# 畸形文件名特征：shell 残渣高发字符（历史实锤：' 0 1 $($j+1) %TEMP%_noop.txt m[1]) {1}）
_BAD_NAME_CHARS = '\'"$%`{}'
_RESERVED_NAMES = {'con', 'prn', 'aux', 'nul'}
_RESERVED_NAMES.update('com%d' % i for i in range(1, 10))
_RESERVED_NAMES.update('lpt%d' % i for i in range(1, 10))
# 合法空文件：Python 包机制与占位
_EMPTY_OK_STEMS = {'__init__', '.gitkeep', '.keep'}
# U+FFFD 少量出现可能是文档示例（_encoding.py 即如此），达到阈值才判内容毁损
_FFFD_BLOCK_MIN = 10

# 二进制/ANSI 扩展名总表（编码查豁免）——self_check/hygiene_gate/hygiene_check 共用单源
BINARY_EXTS = ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.zip', '.gz',
               '.mp3', '.mp4', '.woff', '.woff2', '.ttf', '.eot', '.pdf', '.exe',
               '.dll', '.psd', '.blend', '.fbx', '.glb', '.bin', '.part',
               '.xlsx', '.docx', '.pptx', '.zplug',
               '.bat', '.ps1', '.cmd', '.vbs')  # bat/ps1/cmd/vbs 依赖 ANSI 码页

# 根目录白名单：根层新建文件走提醒不阻断（入库端另有快照闸门兜底）
# 注意：快照守护（self_check._guard_hygiene 第⑤查）会把根层白名单之外的文件**隔离**到
# private/rollback_quarantine/——想清楚再往根目录放文件，放之前先登记在这里。
# 2026-11-24 增补：agents.md / security.md / claude.md（给 AI 智能体的项目规约、漏洞披露流程，以及指向规约的入口；
# 均为仓库治理的标准文件名）。
_ROOT_OK_NAMES = {'readme.md', 'license.md', '.gitignore', '.gitattributes',
                  '.start_web_agent.bat', '.启动朱峰智能体.bat',
                  'requirements.txt', 'bandit-minimal.yaml',
                  'ai_proxy.py', 'rsi_checkup.py', 'agents.md', 'security.md', 'claude.md'}
_ROOT_OK_EXTS = {'.bat', '.ps1', '.lnk', '.vbs'}


def is_binary_path(path):
    """两级后缀判定：x.zip.part4 命中 .zip，x.bat 命中 .bat。
    splitext 只取最后一段，.part4/.m3u8 这类带序号尾段会漏。"""
    s = str(path).lower()
    stem, ext = os.path.splitext(s)
    if ext in BINARY_EXTS:
        return True
    _, ext2 = os.path.splitext(stem)
    return ext2 in BINARY_EXTS


def _ctrl_count(text):
    """控制符计数（排除 \\t \\n \\r）。"""
    if not isinstance(text, str):
        return 0
    return sum(1 for ch in text if ord(ch) < 32 and ch not in '\t\n\r')


def _name_issue(path):
    """畸形文件名检查。返回原因文本，无问题返回 None。"""
    base = os.path.basename(str(path))
    if not base or base != base.strip() or base.endswith('.'):
        return '文件名首尾含空格或以点结尾（Windows 危险名，历史残渣特征）'
    bad = ''.join(ch for ch in base if ch in _BAD_NAME_CHARS or ord(ch) < 32)
    if bad:
        return ('文件名含畸形字符 %r（shell 重定向残渣特征，历史实锤见 '
                'docs/仓库卫生纪律-垃圾零入库与写后必审策划案-20261122.md §二B）' % bad)
    stem = base.rsplit('.', 1)[0] if '.' in base else base
    if stem.lower() in _RESERVED_NAMES:
        return '文件名是 Windows 保留设备名 %s' % stem
    if stem.isdigit():
        return '文件名是纯数字 %s（如历史残渣 0/1，多为 2>1 笔误产物）' % stem
    return None


def _root_note(path):
    """根目录白名单外新文件提醒（不阻断）。返回提醒文本或 None。"""
    try:
        d = _norm(os.path.dirname(str(path) or '.'))
        if d != _norm(PROJECT_ROOT):
            return None
        base = os.path.basename(path)
        if base.lower() in _ROOT_OK_NAMES:
            return None
        if os.path.splitext(base)[1].lower() in _ROOT_OK_EXTS:
            return None
        return ('根目录新建文件提醒：探针/一次性脚本请落 tmp/（已 gitignore），'
                '正式脚本落 tools/，文档落 docs/（仓库卫生策划案 2026-11-22）')
    except Exception:
        return None


def hygiene_check(path, content, is_new=None, old_content=None):
    """L0 卫生四查：所有写入默认过检（不区分保护清单）。

    返回 (ok, err)：ok=False 时 err 为拒绝原因；ok=True 且 err 非空时 err 为提醒文案。
    old_content 提供时（replace_text 编辑存量文件），U+FFFD/控制符按净增判定——
    已毁损文件的存量乱码不拦（否则该文件永久无法编辑），只拦本次新添的污染。
    """
    try:
        if is_new is None:
            is_new = not os.path.isfile(path)
        if is_new:
            issue = _name_issue(path)
            if issue:
                return False, issue
        if isinstance(content, str):
            n_new = content.count('\ufffd')
            n_old = old_content.count('\ufffd') if isinstance(old_content, str) else 0
            if n_new >= _FFFD_BLOCK_MIN and n_new > n_old:
                return False, ('content has %d U+FFFD chars（内容疑似被错误编码毁损，'
                               '净增 %d）' % (n_new, n_new - n_old))
            c_new = _ctrl_count(content)
            c_old = _ctrl_count(old_content) if isinstance(old_content, str) else 0
            if c_new > c_old:
                return False, 'contains control char（内容疑似二进制损坏，净增）'
            if is_new and not content.strip() and \
                    os.path.basename(path).rsplit('.', 1)[0] not in _EMPTY_OK_STEMS:
                return False, 'new file is empty（新建空文件多为意外产物，占位请用 .gitkeep）'
        if is_new:
            note = _root_note(path)
            if note:
                return True, note
    except Exception:
        # 校验自身异常不阻断（与 precheck 同哲学：宁可放行不打断业务）
        return True, None
    return True, None


def precheck(path, new_content):
    """critical 文件写前校验。返回 (ok, err)。非 critical 直接放行。"""
    try:
        if level_of(path) != LEVEL_CRITICAL:
            return True, None
        if not isinstance(new_content, str):
            return False, 'content must be text'
        bad, reason = _looks_garbled(new_content)
        if bad:
            return False, reason
        ok, err = _syntax_check(path, new_content)
        if not ok:
            return False, err
        ok, err = _size_check(path, new_content)
        if not ok:
            return False, err
        ok, err = _anchor_check(path, new_content)
        if not ok:
            return False, err
    except Exception:
        # 校验自身异常不阻断（宁可放行也不要打断正常业务流程）
        return True, None
    return True, None


# ---------------------------------------------------------------- 快照与回滚

def _snap_paths(path):
    key = re.sub(r'[^0-9A-Za-z._-]', '_', _norm(path))[-120:]
    d = os.path.join(SNAPSHOT_DIR, key)
    return d, os.path.join(d, '%d.content' % int(time.time() * 1000))


def make_snapshot(path):
    """写入前为关键文件留存长期快照（区别于 create_backup 的滚动备份）。"""
    try:
        if level_of(path) == LEVEL_READONLY:
            return None    # 只读文件永不写入，也就不需要写前快照；有快照才有回滚，回滚是一种写入
        if not os.path.isfile(path):
            return None
        d, dst = _snap_paths(path)
        os.makedirs(d, exist_ok=True)
        with open(path, 'rb') as f:
            data = f.read()
        with open(dst, 'wb') as f:
            f.write(data)
        # 只保留最近 MAX_SNAPSHOTS 份
        files = sorted((os.path.join(d, x) for x in os.listdir(d)), key=os.path.getmtime)
        for old in files[:-MAX_SNAPSHOTS]:
            try:
                os.remove(old)
            except OSError:
                pass
        return dst
    except Exception:
        return None


def _normalize_for_compare(data):
    """比对前统一行尾与 BOM，避免文本模式写入的 CRLF 造成误判。"""
    if isinstance(data, str):
        data = data.encode('utf-8')
    # 去 UTF-8 BOM
    if data.startswith(b'\xef\xbb\xbf'):
        data = data[3:]
    # 统一行尾为 \n
    return data.replace(b'\r\n', b'\n')


def verify_after_write(path, expected):
    """写后回读比对：落盘内容是否等于拟写入内容。

    行尾差异（CRLF/LF）与 BOM 视为一致——write 工具以文本模式落盘，
    这些是平台差异而非损坏。
    """
    try:
        if not os.path.isfile(path):
            return False, 'file missing after write: %s' % path
        with open(path, 'rb') as f:
            actual = _normalize_for_compare(f.read())
        if isinstance(expected, str):
            try:
                want = _normalize_for_compare(expected.encode('utf-8'))
            except Exception:
                want = _normalize_for_compare(expected)
        else:
            want = _normalize_for_compare(expected or b'')
        if actual != want:
            return False, ('write-back mismatch: %s 落盘内容与拟写入内容不一致'
                           '（磁盘 %d 字节 / 预期 %d 字节，疑似写入被打断或损坏）'
                           % (path, len(actual), len(want)))
        bad, reason = _looks_garbled(actual.decode('utf-8', errors='replace'))
        if bad:
            return False, reason
    except Exception as e:
        return False, 'verify_after_write error: %s' % e
    return True, None


def rollback(path):
    """从最近一次快照恢复关键文件。返回 {'ok':bool, ...}。

    回滚是把盘上内容整体换掉，本质是一次写入，所以同样受只读保护约束：文件后来升为只读的，
    旧快照不能把它覆盖回去（旧版本 = 旧的、更弱的守卫）。"""
    try:
        p = _norm(path)
        if level_of(path) == LEVEL_READONLY:
            return {'ok': False, 'error': 'readonly protected: %s 是只读保护文件，不经回滚覆盖' % p}
        if list_all().get('load_error'):
            return {'ok': False, 'error': '保护清单无法解析，拒绝回滚'}
        d, _ = _snap_paths(path)
        if not os.path.isdir(d):
            return {'ok': False, 'error': 'no snapshot for %s' % p}
        files = sorted((os.path.join(d, x) for x in os.listdir(d)), key=os.path.getmtime)
        if not files:
            return {'ok': False, 'error': 'snapshot dir empty for %s' % p}
        src = files[-1]
        with open(src, 'rb') as f:
            data = f.read()
        with open(p, 'wb') as f:
            f.write(data)
        return {'ok': True, 'path': p, 'restored_from': src, 'size': len(data)}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


# ---------------------------------------------------------------- 清单维护

def _root_rel(path):
    """任意写法的路径 → “项目根相对路径 / 正斜杠”；不在项目内返回 None（比较时不分大小写）。"""
    p = _norm(path)
    root = PROJECT_ROOT.replace('\\', '/').rstrip('/').lower()
    if p.lower().startswith(root + '/'):
        return p[len(root) + 1:]
    return None


def _readonly_enforcement(path):
    """path（任意写法：相对 / 绝对 / 正反斜杠）是否为只读级执法设施；是则返回其规范写法，否则 None。"""
    spec = _enforcement()
    if spec is None:
        return None
    raw = str(path or '').strip().replace('\\', '/').lower()
    rel = (_root_rel(path) or '').lower()
    for item in tuple(spec.ENFORCEMENT_READONLY) + tuple(getattr(spec, 'ENFORCEMENT_READONLY_FLAGS', ())):
        if raw == item.lower() or (rel and rel == item.lower()):
            return item
    return None


def _deny_if_unreadable():
    """清单处于拒绝态时返回错误字典，否则 None。所有会落盘的入口都先问这一句。"""
    data = _load()
    if data.get('load_error'):
        return {'ok': False, 'error': ('保护清单无法解析，拒绝修改（%s）。请人工检查或删除 %s；'
                                       '删除后会自动重建默认清单。' % (data['load_error'], LIST_FILE))}
    return None


def add(path, level=LEVEL_CRITICAL, force=False):
    """把文件加入清单。返回 {'ok':bool, ...}。

    执法设施不得经本接口降级（把只读改成 critical 等于解除保护）；确需变更由人显式传 force=True。"""
    try:
        p = _norm(path)
        if not p:
            return {'ok': False, 'error': 'empty path'}
        if level not in (LEVEL_READONLY, LEVEL_CRITICAL):
            return {'ok': False, 'error': 'level must be readonly or critical'}
        if not force and level != LEVEL_READONLY:
            item = _readonly_enforcement(path)
            if item is not None:
                return {'ok': False, 'error': (
                    '%s 是执法设施，不允许降级为 critical（只读是其最低保护级别）。'
                    '确需变更由人执行 add(path, level, force=True)。' % item)}
        denied = _deny_if_unreadable()
        if denied:
            return denied
        data = _load()
        other = LEVEL_READONLY if level == LEVEL_CRITICAL else LEVEL_CRITICAL
        # 两级互斥：从另一级移除
        data[other] = [x for x in (data.get(other) or []) if x.strip() != str(path).strip()]
        cur = data.get(level) or []
        if str(path).strip() not in [x.strip() for x in cur]:
            cur = cur + [str(path).strip()]
        data[level] = cur
        if _save(data):
            return {'ok': True, 'path': p, 'level': level, 'list': list_all()}
        return {'ok': False, 'error': 'save failed'}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def remove(path, force=False):
    """把文件移出清单。

    执法设施（server/util_enforcement.py 的只读清单）默认拒绝经本接口移除：否则智能体一条
    `_file_protect.remove(...)` 就能给自己解除保护。确需变更须由人显式传 force=True；
    且下次启动会被 ensure_enforcement 重新加回——长期豁免请把路径写进清单 JSON 的
    "enforcement_optout" 列表。"""
    try:
        p = str(path or '').strip()
        if not force:
            item = _readonly_enforcement(p)
            if item is not None:
                return {'ok': False, 'error': (
                    '%s 是执法设施，不允许经工具接口解除只读保护。'
                    '确需变更：由人执行 remove(path, force=True)，'
                    '或在清单 JSON 的 enforcement_optout 中登记后手动移除。' % item)}
        denied = _deny_if_unreadable()
        if denied:
            return denied
        data = _load()
        before = sum(len(data.get(k) or []) for k in ('critical', 'readonly'))
        for k in ('critical', 'readonly'):
            data[k] = [x for x in (data.get(k) or []) if x.strip() != p]
        after = sum(len(data.get(k) or []) for k in ('critical', 'readonly'))
        if _save(data):
            return {'ok': True, 'removed': before - after, 'path': _norm(path), 'list': list_all()}
        return {'ok': False, 'error': 'save failed'}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def set_anchors(path, names):
    try:
        p = str(path or '').strip()
        if not p:
            return {'ok': False, 'error': 'empty path'}
        denied = _deny_if_unreadable()
        if denied:
            return denied
        data = _load()
        if isinstance(names, str):
            names = [x for x in re.split(r'[,，;；\s]+', names) if x]
        data['anchors'][p] = [str(x) for x in (names or [])]
        if _save(data):
            return {'ok': True, 'path': _norm(p), 'anchors': data['anchors'][p]}
        return {'ok': False, 'error': 'save failed'}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def list_all():
    data = _load()
    return {
        'critical': list(data.get('critical') or []),
        'readonly': list(data.get('readonly') or []),
        'anchors': dict(data.get('anchors') or {}),
        'enforcement_optout': list(data.get('enforcement_optout') or []),
        # 非空 = 清单无法解析，处于拒绝态（一切写入与 shell 命令都被拒），见 _load
        'load_error': data.get('load_error'),
        'list_file': LIST_FILE,
    }


def init_default():
    """首次启用时写入一份默认清单（已存在则不覆盖）。"""
    try:
        if os.path.isfile(LIST_FILE):
            return {'ok': True, 'already': True}
        data = {
            'critical': [
                'server.py',
                'security.py',
                'config.py',
                'db.py',
                'private/file_protection.json',
                'tools/coding/backend/write.py',
                'tools/coding/backend/replace_text.py',
                'tools/coding/backend/_file_protect.py',
                'tools/coding/backend/_preflight.py',
                'tools/coding/backend/_pathguard.py',
            ],
            'readonly': [
                'private/file_protection.json',
            ],
            'anchors': {
                'server.py': ['def main'],
            },
        }
        # 清单自身只读：防止被自身规则误伤后无法恢复
        data['critical'] = [x for x in data['critical'] if x != 'private/file_protection.json']
        if not _save(data):
            return {'ok': False, 'default': True, 'error': 'save failed'}
        # 全新安装：执法设施随默认清单一并落盘，首次启用即受保护
        ensure_enforcement()
        return {'ok': True, 'default': True, 'list': list_all()}
    except Exception as e:
        return {'ok': False, 'error': str(e)}
