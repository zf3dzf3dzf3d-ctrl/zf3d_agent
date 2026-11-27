# -*- coding: utf-8 -*-
"""sign_release.py - 给发布包签名（Ed25519 清单签名）。

用法：
    py tools/release/sign_release.py <发布包目录> --key <私钥文件> --version <版本号>

做什么：
  1 列出包内每个会被安装的文件（排除 __pycache__ / *.pyc / .git / node_modules / private / *.bak），
    逐个算 SHA-256，写成清单 release-manifest.json；
  2 用私钥对清单的原始字节签名，写成 release-manifest.sig；
  3 两个文件都放进包目录的根。

发布流程中的位置：打包完成 → 运行本脚本 → 再压缩 / 上传。签名之后包内不得再改动任何文件，
否则客户端校验会失败（这正是签名的意义）。

私钥从 --key 指定的文件读取（tools/release/keygen.py 生成的 32 字节种子的 base64）。本脚本拒绝
读取仓库目录内的私钥文件。
"""
import argparse
import base64
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'server'))

import util_release_verify as rv  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('package_root', help='发布包目录（打包后、压缩前）')
    ap.add_argument('--key', required=True, help='私钥文件路径（必须在仓库之外）')
    ap.add_argument('--version', required=True, help='发布版本号，写进清单')
    a = ap.parse_args()
    pkg = Path(a.package_root).expanduser().resolve()
    key_path = Path(a.key).expanduser().resolve()
    if not pkg.is_dir():
        print('[失败] 发布包目录不存在：%s' % pkg)
        return 2
    try:
        key_path.relative_to(ROOT.resolve())
        inside = True
    except ValueError:
        inside = False
    if inside:
        print('[拒绝] 私钥不能放在本仓库目录内。')
        return 2
    try:
        key = key_path.read_text(encoding='ascii').strip().splitlines()[0].strip()
    except (OSError, IndexError, UnicodeDecodeError) as e:
        print('[失败] 读取私钥失败：%s' % e)
        return 2
    manifest = rv.build_manifest(str(pkg), a.version)
    try:
        signature = rv.sign_manifest(manifest, key)
    except ImportError:
        print('[失败] 需要 cryptography 库：py -m pip install cryptography')
        return 2
    except ValueError as e:
        print('[失败] 私钥格式不对：%s' % e)
        return 2
    (pkg / rv.MANIFEST_NAME).write_bytes(manifest)
    (pkg / rv.SIGNATURE_NAME).write_text(signature + '\n', encoding='ascii')
    n = len(json.loads(manifest)['files'])
    ok, reason, checked = rv.verify_release(str(pkg), public_key_b64=public_key_of(key))
    if not ok:
        print('[失败] 签名后自检未通过：%s' % reason)
        return 1
    print('[OK] 已签名：%s（%d 个文件，签名后自检通过，共核对 %d 个）' % (pkg.name, n, checked))
    return 0


def public_key_of(private_key_b64):
    """由私钥推导公钥，用于签名后的自检。"""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    seed = base64.b64decode(private_key_b64, validate=True)
    pub = Ed25519PrivateKey.from_private_bytes(seed).public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return base64.b64encode(pub).decode('ascii')


if __name__ == '__main__':
    sys.exit(main())
