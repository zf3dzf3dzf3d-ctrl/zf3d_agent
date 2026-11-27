# -*- coding: utf-8 -*-
"""
check_installer.py — 安装脚本编码自检门禁（发布硬项）
用法: python check_installer.py <脚本.iss> [更多.iss ...]
检查项: ① UTF-8 BOM 头 ② 无 U+FFFD / 非法 UTF-8 ③ [Languages] 含中文段
        ④ Default.isl 不作为唯一语言
退出码: 0=全部通过, 1=有问题（禁止编译分发）
"""
import sys

from util_log import get_logger

log = get_logger('check_installer')
def check(path):
    errors = []
    raw = open(path, 'rb').read()
    # ① BOM
    if not raw.startswith(b'\xef\xbb\xbf'):
        errors.append('缺少 UTF-8 BOM 头')
    # ② 解码 + U+FFFD
    try:
        text = raw.decode('utf-8-sig')
        if '\ufffd' in text:
            errors.append('含 U+FFFD 替换字符（乱码痕迹）')
    except UnicodeDecodeError as e:
        errors.append(f'非法 UTF-8: {e}')
        return errors
    # ③ 中文语言段
    if '[Languages]' not in text:
        errors.append('缺少 [Languages] 段')
    else:
        lang_section = text.split('[Languages]', 1)[1].split('[', 2)
        seg = lang_section[0] if len(lang_section) > 1 else text.split('[Languages]', 1)[1]
        if 'ChineseSimplified.isl' not in seg:
            errors.append('[Languages] 未包含 ChineseSimplified.isl 中文段')
    # ④ Default.isl 不得是唯一语言
    if 'MessagesFile' in text and 'ChineseSimplified' not in text and 'Default.isl' in text:
        errors.append('仅 Default.isl（英文）作为唯一语言')
    return errors

def main():
    if len(sys.argv) < 2:
        log.info('用法: python check_installer.py <脚本.iss> [...]')
        return 1
    failed = False
    for p in sys.argv[1:]:
        errs = check(p)
        if errs:
            failed = True
            log.info(f'[FAIL] {p}')
            for e in errs:
                log.info(f'  - {e}')
        else:
            log.info(f'[PASS] {p}')
    return 1 if failed else 0

if __name__ == '__main__':
    sys.exit(main())
