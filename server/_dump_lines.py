# -*- coding: utf-8 -*-
import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
src = open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2_发布版\server\chat_gate.py', encoding='utf-8-sig').read().splitlines()
a, b = int(sys.argv[1]), int(sys.argv[2])
for i in range(a - 1, min(b, len(src))):
    print('%4d %s' % (i + 1, src[i]))
