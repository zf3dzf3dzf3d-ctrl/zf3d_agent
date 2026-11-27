# -*- coding: utf-8 -*-
"""
secure_store.py - 敏感数据（API Key）DPAPI 加密存储（纯标准库，Windows）
- CryptProtectData/CryptUnprotectData（ctypes → crypt32），当前用户级加密，密文绑定本机本用户
- 文件格式: {'_meta': {..., 'encrypted': True}, 'keys': {name: 'dpapi:<base64>'}}
- 兼容旧明文 api_keys.json：读到明文 key 时解密层自动返回原值；写盘时统一加密（自动迁移）
- DPAPI 失败/非 Windows 时【显式报错，绝不降级明文落盘】（K5 修复 2026-11-26）
- 解密方向保留旧明文兼容（历史降级文件可读），解密失败返回空串（宁缺勿泄）
"""
import base64
import sys
import time

try:
    import ctypes
    import ctypes.wintypes
    _IS_WIN = sys.platform == 'win32'
except Exception:
    _IS_WIN = False

_PREFIX = 'dpapi:'
_CRYPTPROTECT_UI_FORBIDDEN = 0x01


class SecureStoreError(RuntimeError):
    """DPAPI 加密不可用时抛出（fail-closed 信号，调用方不得把明文落盘）。"""
    pass


class DATA_BLOB(ctypes.Structure):
    _fields_ = [('cbData', ctypes.c_uint), ('pbData', ctypes.POINTER(ctypes.c_char))]


def _blob(data):
    buf = ctypes.create_string_buffer(data, len(data))
    return DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), buf


def _dpapi_protect(plain: str) -> str:
    """返回 dpapi:<base64> 密文；失败抛 RuntimeError。"""
    if not _IS_WIN:
        raise RuntimeError('not windows')
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    in_blob, in_buf = _blob(plain.encode('utf-8'))
    out_blob = DATA_BLOB()
    if not crypt32.CryptProtectData(
            ctypes.byref(in_blob), None, None, None, None,
            _CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(out_blob)):
        raise RuntimeError('CryptProtectData failed: %s' % kernel32.GetLastError())
    try:
        raw = ctypes.string_at(out_blob.pbData, out_blob.cbData)
        return _PREFIX + base64.b64encode(raw).decode('ascii')
    finally:
        kernel32.LocalFree(out_blob.pbData)


def _dpapi_unprotect(cipher_b64: str) -> str:
    if not _IS_WIN:
        raise RuntimeError('not windows')
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    raw = base64.b64decode(cipher_b64)
    in_blob, in_buf = _blob(raw)
    out_blob = DATA_BLOB()
    if not crypt32.CryptUnprotectData(
            ctypes.byref(in_blob), None, None, None, None,
            _CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(out_blob)):
        raise RuntimeError('CryptUnprotectData failed: %s' % kernel32.GetLastError())
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData).decode('utf-8')
    finally:
        kernel32.LocalFree(out_blob.pbData)


def encrypt_value(plain: str) -> str:
    """加密单个 key；加密失败显式抛 SecureStoreError（fail-closed，绝不静默降级明文落盘）。
    K5 修复（2026-11-26）：原实现 except 后原样返回明文属静默降级存储。
    现改为抛 SecureStoreError：调用方（model_config._save_keys_map）捕获后拒绝写盘，
    密钥保留在内存等待下次保存，不会出现明文落盘的窗口。"""
    s = str(plain or '')
    if not s or s.startswith(_PREFIX):
        return s  # 空值/已加密值原样返回（非明文降级路径）
    try:
        return _dpapi_protect(s)
    except SecureStoreError:
        raise
    except Exception as e:
        raise SecureStoreError('DPAPI 加密失败（fail-closed，拒绝明文降级）: %s' % e) from e


def decrypt_value(val: str) -> str:
    """解密单个 key；明文原样返回，解密失败返回空串（宁缺勿泄）。"""
    val = str(val or '')
    if not val.startswith(_PREFIX):
        return val  # 旧明文/降级明文
    try:
        return _dpapi_unprotect(val[len(_PREFIX):])
    except Exception:
        return ''


def is_encrypted(val: str) -> bool:
    return str(val or '').startswith(_PREFIX)


def load_keys(path, loader):
    """
    读取 key 映射表并解密。
    loader(path) -> 文件原始 dict（由调用方提供 JSON 读取）。
    返回 {name: 明文key}。
    """
    data = loader(path, {'keys': {}})
    keys = data.get('keys') if isinstance(data, dict) else None
    if not isinstance(keys, dict):
        return {}
    return {str(k): decrypt_value(v) for k, v in keys.items()}


def save_keys(path, keys_map, saver, version):
    """
    加密写入 key 映射表（调用方提供原子写 saver 与版本号）。
    返回 saver 的结果；加密失败抛 SecureStoreError（由调用方决定拒写，不静默降级明文）。
    _meta.encrypted 恒为 True（能走到 saver 说明全部加密成功）。
    """
    enc = {}
    for k, v in (keys_map or {}).items():
        enc[k] = encrypt_value(str(v or ''))
    return saver(path, {
        '_meta': {
            'version': version,
            'updated_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
            'encrypted': True,
            'crypto': 'dpapi-user',
        },
        'keys': enc,
    })
