# -*- coding: utf-8 -*-
"""M2.4 模糊测试：multipart 上传解析器（server/handler_base.py _parse_multipart_file）。

变异策略：随机 boundary/分隔符/头段/截断/嵌套边界/二进制噪声，各 100000 次组合。
不变量：解析函数对任意字节输入**永不抛异常**（可返回任何结果——垃圾进垃圾出，
但进程不被打穿）；调用方 _handle_upload_multipart 已有 400 分支兜底。

用法：py tools/fuzz/fuzz_multipart.py [次数]
"""
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'server'))

import handler_base  # noqa: E402

Cls = handler_base.HandlerBase
handler = object.__new__(Cls)      # 跳过 __init__：_parse_multipart_file 只用入参


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 100000
    rng = random.Random(20261124)
    crashes = 0
    samples = []
    noises = [b'\x00', b'\r', b'\n', b'\r\n', b'--', b'--\r\n', b'"', b'\\', b'\xff\xfe',
              b'Content-Disposition: form-data; name="f"; filename="a.png"\r\n\r\n']
    for i in range(n):
        boundary = bytes(rng.randrange(33, 127) for _ in range(rng.randrange(1, 24)))
        body = bytearray()
        for _ in range(rng.randrange(0, 5)):
            body += b'--' + boundary + rng.choice(noises)
            if rng.randrange(2):
                body += bytes(rng.randrange(256) for _ in range(rng.randrange(0, 48)))
            body += b'\r\n'
        if rng.randrange(4) == 0:
            body += b'--' + boundary + b'--\r\n'
        if rng.randrange(3) == 0:
            body += bytes(rng.randrange(256) for _ in range(rng.randrange(0, 32)))   # 尾部二进制噪声
        try:
            handler._parse_multipart_file(bytes(body), boundary.decode('latin-1', 'replace'))
        except Exception as e:                      # 不变量：永不抛出
            crashes += 1
            if len(samples) < 5:
                samples.append('#%d %r body=%s… boundary=%r' % (i, e, bytes(body[:24]).hex(), boundary[:12]))
    print('模糊测试完成: %d 次（随机 boundary/分隔符/嵌套/截断/二进制噪声）' % n)
    print('异常逃逸: %d' % crashes)
    for s in samples:
        print('  ', s)
    if crashes:
        print('[FAIL] 发现问题')
        return 1
    print('[OK] 全部变异输入通过（永不抛出）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
