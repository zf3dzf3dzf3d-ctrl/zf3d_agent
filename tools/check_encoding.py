# -*- coding: utf-8 -*-
"""check_encoding.py - 全局编码门禁扫描（进化建议书落地项）
扫描：U+FFFD 替换字符、非法 UTF-8 序列、iss/isl 文件编码。
用法：python tools/check_encoding.py [根目录]  （默认当前目录）
发布/收尾必须计数=0。出处：进化/课题池「乱码检测统一工具」课题（复现3次）。
"""
import sys, os

EXT_WHITELIST = {'.py', '.js', '.css', '.html', '.md', '.json', '.txt', '.iss', '.isl', '.bat', '.cmd'}
SKIP_DIRS = {'.git', 'node_modules', '__pycache__', 'browser_profile', 'data', 'logs'}

def scan(root):
    bad_ufffd, bad_utf8, bad_iss = [], [], []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            ext = os.path.splitext(fn)[1].lower()
            if ext not in EXT_WHITELIST:
                continue
            p = os.path.join(dirpath, fn)
            try:
                raw = open(p, 'rb').read()
            except OSError:
                continue
            if not raw:
                continue
            # U+FFFD 替换字符
            if b'\xef\xbf\xbd' in raw:
                bad_ufffd.append(p)
            # 非法 UTF-8
            try:
                raw.decode('utf-8')
            except UnicodeDecodeError as e:
                # UTF-8 BOM 视为合法
                try:
                    raw.decode('utf-8-sig')
                except UnicodeDecodeError:
                    bad_utf8.append((p, str(e)[:60]))
            # iss/isl 必须是 UTF-8(可带BOM) 且含中文时无 BOM 则告警
            if ext in ('.iss', '.isl'):
                has_bom = raw.startswith(b'\xef\xbb\xbf')
                has_cjk = any(b >= 0xE4 for b in raw[:2000])  # 粗检
                if not has_bom:
                    bad_iss.append((p, 'no BOM' + (' + CJK content' if has_cjk else '')))
    return bad_ufffd, bad_utf8, bad_iss

def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    bad_ufffd, bad_utf8, bad_iss = scan(root)
    print(f'== check_encoding 门禁扫描 (root={root}) ==')
    for p in bad_ufffd:
        print(f'[U+FFFD] {p}')
    for p, e in bad_utf8:
        print(f'[非法UTF-8] {p}  {e}')
    for p, w in bad_iss:
        print(f'[iss缺BOM] {p}  {w}')
    total = len(bad_ufffd) + len(bad_utf8) + len(bad_iss)
    print(f'问题总数: {total}  (U+FFFD={len(bad_ufffd)}, 非法UTF-8={len(bad_utf8)}, iss缺BOM={len(bad_iss)})')
    print('门禁判定: ' + ('PASS ✅ 计数=0' if total == 0 else 'FAIL ❌ 必须归零'))
    sys.exit(0 if total == 0 else 1)

if __name__ == '__main__':
    main()
