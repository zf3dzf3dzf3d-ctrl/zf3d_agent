#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""util_release_verify.py - 发布包签名（Ed25519 清单签名）：校验为主，附带签名用的纯函数。

解决什么问题
------------
SHA-256 校验只能证明“拿到的包与校验和一致”。校验和与包若出自同一个被攻陷的渠道
（对象存储桶、镜像站、备份服务器），一致性毫无意义。签名把信任锚从“渠道”换成“一把私钥”：
  - 发布者用离线保存的私钥，对“包内每个文件的路径 + 哈希”清单签名；
  - 客户端用钉死在本文件里的公钥验签，再逐个文件核对清单；
  - 渠道被攻陷、镜像被替换、校验和被改写，都过不了验签——攻击者没有私钥。
信任锚是 RELEASE_PUBLIC_KEY。它必须位于更新包之外（就在这里，随客户端代码分发）。

格式
----
清单 release-manifest.json（UTF-8，无 BOM）：
    {"scheme": "zf-release-ed25519-v1", "version": "6.0.1", "built_at": "2026-11-24T05:30:00",
     "files": [{"path": "server/server.py", "sha256": "<64hex>", "size": 1234}, ...]}
签名 release-manifest.sig：对清单文件的**原始字节**做 Ed25519 签名，标准 base64，文件内无换行。
密钥：32 字节原始种子 / 公钥，base64。私钥只存在于发布者手里，绝不进仓库、不进更新包。

校验规则（verify_release，全部满足才算通过）
----------------------------------------------
  1 清单与签名文件都在，清单可解析、scheme 匹配；
  2 清单里的路径全部是包内相对路径（不允许绝对路径、不允许 ..）；
  3 签名与清单字节、钉死的公钥匹配；
  4 包内每个文件都在清单里且哈希一致（不允许多出未登记的文件）；
  5 清单里登记的文件在包内都存在。
任一条不满足即拒绝，并给出原因。校验过程中出现的任何异常都按“不通过”处理。

排除项（与更新器覆盖文件时的排除口径一致，这些本来就不会被安装）：
    __pycache__ / *.pyc / *.pyo / .git / node_modules / private / *.bak

接入与开关
----------
update_checker 在覆盖文件之前调用 verify_release：
  - config.update.require_signature = true  → 未签名或不合格一律拒装（正式发布签署后的常态）；
  - 缺省（false）                            → 带签名且合格 → 放行；带签名但不合格 → 拒装
                                              （签名坏了是明确的篡改信号，没有放行的理由）；
                                               完全未签名 → 放行并记警告（签署流程尚未启用时的过渡态）。
"""
import base64
import hashlib
import json
import os

SCHEME = 'zf-release-ed25519-v1'
MANIFEST_NAME = 'release-manifest.json'
SIGNATURE_NAME = 'release-manifest.sig'

# 信任锚：发布公钥（base64，32 字节）。由维护者运行 tools/release/keygen.py 生成密钥对后填入。
# 为空表示尚未启用签名：require_signature 模式下一律拒装；过渡模式下未签名包放行。
# 2026-11-24 钉入：私钥在发布机 %LOCALAPPDATA%\zf-release-keys\（仓库之外），更换私钥须随客户端发版。
RELEASE_PUBLIC_KEY = 'CRUCsP0Oeh2xvU8zzB0a2iAmLmzQDdiM1I4nzvINY7U='

EXCLUDED_DIRS = frozenset(('__pycache__', '.git', 'node_modules', 'private'))
EXCLUDED_SUFFIXES = ('.pyc', '.pyo', '.bak')
_RESERVED = frozenset((MANIFEST_NAME, SIGNATURE_NAME))


def iter_package_files(root):
    """包内“会被安装”的文件：返回排序后的相对路径列表（正斜杠）。清单生成与校验共用同一口径。"""
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in EXCLUDED_DIRS)
        for fn in sorted(filenames):
            if fn.endswith(EXCLUDED_SUFFIXES):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, root).replace('\\', '/')
            if rel in _RESERVED:
                continue
            out.append(rel)
    return out


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def build_manifest(root, version, built_at=None):
    """生成清单字节（规范 JSON：键有序、无多余空白，保证同一包永远得到同一份清单）。"""
    import datetime
    files = []
    for rel in iter_package_files(root):
        files.append({'path': rel, 'sha256': sha256_file(os.path.join(root, rel)),
                      'size': os.path.getsize(os.path.join(root, rel))})
    doc = {'scheme': SCHEME, 'version': str(version), 'built_at': built_at or datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S'),
           'files': files}
    return json.dumps(doc, ensure_ascii=False, sort_keys=True, separators=(',', ':'), indent=None).encode('utf-8')


def sign_manifest(manifest_bytes, private_key_b64):
    """对清单字节做 Ed25519 签名，返回 base64 签名。只给 tools/release/sign_release.py 调用。"""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    seed = base64.b64decode(private_key_b64, validate=True)
    if len(seed) != 32:
        raise ValueError('私钥必须是 32 字节种子的 base64')
    key = Ed25519PrivateKey.from_private_bytes(seed)
    sig = key.sign(manifest_bytes)
    return base64.b64encode(sig).decode('ascii')


def _b64_key(text, what):
    raw = base64.b64decode(str(text or '').strip(), validate=True)
    if len(raw) != 32:
        raise ValueError('%s必须是 32 字节的 base64' % what)
    return raw


def _pinned_key(public_key_b64):
    """未显式传入时，在调用时取当前钉死的公钥（不写成参数默认值——默认值在定义时就固定了）。"""
    return RELEASE_PUBLIC_KEY if public_key_b64 is None else public_key_b64


def verify_signature(manifest_bytes, signature_b64, public_key_b64=None):
    """验签。返回 (ok, reason)。任何异常都按不通过处理。"""
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.exceptions import InvalidSignature
        pub = _b64_key(_pinned_key(public_key_b64), '公钥')
        sig = base64.b64decode(str(signature_b64 or '').strip(), validate=True)
        Ed25519PublicKey.from_public_bytes(pub).verify(sig, manifest_bytes)
        return True, ''
    except ImportError:
        return False, '发布签名校验不可用：缺少 cryptography 库'
    except (InvalidSignature, ValueError):
        return False, '签名与清单不匹配（清单被改写，或并非由官方私钥签署）'


def _safe_rel(p):
    """清单条目的路径必须是包内相对路径。返回规范相对路径或 None（非法）。"""
    if not isinstance(p, str) or not p or '\\' in p:
        return None
    if p.startswith('/') or len(p) > 1 and p[1] == ':' or '\x00' in p:
        return None
    parts = p.split('/')
    if any(part in ('', '.', '..') for part in parts):
        return None
    return p


def verify_release(root, public_key_b64=None, required=False):
    """校验一个已解压的更新包目录。

    public_key_b64 不传时使用钉死的 RELEASE_PUBLIC_KEY。
    required=True ：未签名或不合格一律不通过。
    required=False：未签名 → 通过（reason 注明“未签名”，调用方记警告）；
                    带签名但不合格 → 不通过。
    返回 (ok, reason, files_checked)。"""
    public_key_b64 = _pinned_key(public_key_b64)
    mpath = os.path.join(root, MANIFEST_NAME)
    spath = os.path.join(root, SIGNATURE_NAME)
    has_manifest = os.path.isfile(mpath)
    has_sig = os.path.isfile(spath)
    if not has_manifest and not has_sig:
        if required:
            return False, '更新包未签名（require_signature 已开启，拒绝安装）', 0
        return True, '未签名', 0
    if not (has_manifest and has_sig):
        return False, '更新包签名不完整（清单与签名必须同时存在）', 0
    try:
        with open(mpath, 'rb') as f:
            manifest_bytes = f.read()
        with open(spath, 'r', encoding='ascii') as f:
            signature = f.read().strip()
    except (OSError, UnicodeDecodeError) as e:
        return False, '读取签名文件失败：%s' % e, 0
    if not public_key_b64:
        return False, '客户端尚未配置发布公钥（RELEASE_PUBLIC_KEY 为空），无法校验签名', 0
    ok, reason = verify_signature(manifest_bytes, signature, public_key_b64)
    if not ok:
        return False, reason, 0
    try:
        doc = json.loads(manifest_bytes.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return False, '清单不是合法的 UTF-8 JSON', 0
    if not isinstance(doc, dict) or doc.get('scheme') != SCHEME:
        return False, '清单格式或 scheme 不受支持', 0
    entries = doc.get('files')
    if not isinstance(entries, list) or not entries:
        return False, '清单没有登记任何文件', 0
    expected = {}
    for e in entries:
        if not isinstance(e, dict):
            return False, '清单条目不是对象', 0
        rel = _safe_rel(e.get('path'))
        digest = e.get('sha256')
        if rel is None or not isinstance(digest, str) or len(digest) != 64:
            return False, '清单含非法条目：%r' % (e.get('path'),), 0
        try:
            int(digest, 16)
        except ValueError:
            return False, '清单含非法哈希：%s' % rel, 0
        expected[rel] = digest.lower()
    actual = iter_package_files(root)
    actual_set = set(actual)
    extra = sorted(actual_set - set(expected))
    if extra:
        return False, '包内有 %d 个未登记在签名清单里的文件，例如：%s' % (len(extra), ', '.join(extra[:3])), 0
    missing = sorted(set(expected) - actual_set)
    if missing:
        return False, '清单登记的 %d 个文件在包内缺失，例如：%s' % (len(missing), ', '.join(missing[:3])), 0
    for rel in actual:
        try:
            digest = sha256_file(os.path.join(root, rel))
        except OSError as e:
            return False, '读取包内文件失败：%s（%s）' % (rel, e), 0
        if digest != expected[rel]:
            return False, '文件与签名清单不符：%s' % rel, 0
    return True, '', len(actual)
