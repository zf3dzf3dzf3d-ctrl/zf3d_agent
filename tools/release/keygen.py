# -*- coding: utf-8 -*-
"""keygen.py - 生成发布签名密钥对（Ed25519）。

用法：
    py tools/release/keygen.py --out <私钥文件路径，必须在仓库之外>

输出：
  - 公钥（base64）打印在屏幕上：填入 server/util_release_verify.py 的 RELEASE_PUBLIC_KEY
  - 私钥写入 --out 指定的文件（32 字节种子的 base64，一行）

注意：
  - 私钥是整个发布链的信任锚。不进仓库、不进更新包、不进聊天记录、不进截图。
  - 本脚本拒绝把私钥写进本仓库目录内。
  - 私钥一旦丢失：只能随客户端发版更换公钥。一旦泄露：立即更换并发版（旧公钥随之作废）。
"""
import argparse
import base64
import os
import stat
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def generate():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    key = Ed25519PrivateKey.generate()
    seed = key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw,
                             serialization.NoEncryption())
    pub = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return seed, pub


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True, help='私钥文件路径（必须在仓库之外）')
    a = ap.parse_args()
    out = Path(a.out).expanduser().resolve()
    try:
        out.relative_to(ROOT.resolve())
        inside = True
    except ValueError:
        inside = False
    if inside:
        print('[拒绝] 私钥不能放在本仓库目录内（会被提交、被快照、被分发）。请指定仓库之外的路径。')
        return 2
    if out.exists():
        print('[拒绝] %s 已存在，不覆盖（避免误删正在使用的私钥）' % out)
        return 2
    try:
        seed, pub = generate()
    except ImportError:
        print('[失败] 需要 cryptography 库：py -m pip install cryptography')
        return 2
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(base64.b64encode(seed).decode('ascii') + '\n', encoding='ascii')
    try:
        os.chmod(str(out), stat.S_IRUSR | stat.S_IWUSR)      # 仅当前用户可读写（Windows 上作用有限）
    except OSError as e:
        print('[提示] 未能收紧私钥文件权限（%s）。请确认 %s 只对当前用户可读' % (e, out))
    print('私钥已写入：%s' % out)
    print()
    print('公钥（base64，填入 server/util_release_verify.py 的 RELEASE_PUBLIC_KEY）：')
    print(base64.b64encode(pub).decode('ascii'))
    print()
    print('下一步：妥善备份私钥（离线）；把公钥填入客户端代码并随版发布。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
