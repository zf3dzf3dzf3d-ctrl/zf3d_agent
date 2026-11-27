# -*- coding: utf-8 -*-
"""hygiene_check - 全仓卫生体检（只读，出报告不改任何文件）。

与《检测报告-全仓文件副本与引用关系》的副本线互补，本脚本管"垃圾/乱码线"。
规则源与 L0 写入端 / L2 快照闸门 / L3 pre-commit 同源：_file_protect.py。

用法：
    py -3 tools/hygiene_check.py            # 报告到 stdout，有发现 exit 1
    py -3 tools/hygiene_check.py --out F    # 追加写入报告文件（建议落 private/ 不入库）

六查：
  ①畸形文件名 ②空文件 ③无效 UTF-8 ④U+FFFD 内容毁损
  ⑤根目录白名单外被追踪文件 ⑥tmp/ 下仍被追踪的残留
"""
import os
import subprocess
import sys

from util_log import get_logger

log = get_logger('hygiene_check')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tools.coding.backend import _file_protect as fp  # noqa: E402

# 二进制/ANSI 扩展名单源：_file_protect.BINARY_EXTS


def _git(*args):
    return subprocess.run(['git'] + list(args), capture_output=True)


def main():
    out_path = None
    if '--out' in sys.argv:
        out_path = sys.argv[sys.argv.index('--out') + 1]

    tracked = [f for f in _git('ls-files', '-z').stdout.decode('utf-8', 'replace').split('\x00') if f]
    others = [f for f in _git('ls-files', '--others', '--exclude-standard', '-z')
              .stdout.decode('utf-8', 'replace').split('\x00') if f]

    findings = {k: [] for k in ('畸形文件名', '空文件', '无效UTF-8', 'U+FFFD', '根层白名单外', 'tmp残留追踪')}

    def scan(f, tracked_file):
        rel = f.replace(os.sep, '/')
        ext = os.path.splitext(rel)[1].lower()
        issue = fp._name_issue(rel)
        if issue:
            findings['畸形文件名'].append('%s（%s）' % (rel, issue))
        p = os.path.join(ROOT, rel)
        if not os.path.isfile(p):
            return
        if os.path.getsize(p) == 0 and \
                os.path.basename(rel).rsplit('.', 1)[0] not in fp._EMPTY_OK_STEMS:
            findings['空文件'].append(rel)
        if tracked_file and rel.startswith('tmp/'):
            findings['tmp残留追踪'].append(rel)
        if tracked_file and '/' not in rel and ext not in fp._ROOT_OK_EXTS and \
                rel.lower() not in fp._ROOT_OK_NAMES:
            findings['根层白名单外'].append(rel)
        if fp.is_binary_path(rel) or os.path.getsize(p) > 2 * 1024 * 1024:
            return
        try:
            with open(p, 'rb') as fh:
                text = fh.read().decode('utf-8', errors='strict')
        except UnicodeDecodeError as ue:
            findings['无效UTF-8'].append('%s（%s）' % (rel, ue))
            return
        except Exception:
            return
        n = text.count('\ufffd')
        if n >= fp._FFFD_BLOCK_MIN:
            findings['U+FFFD'].append('%s（%d 处）' % (rel, n))

    for f in tracked:
        scan(f, True)
    for f in others:
        scan(f, False)

    lines = ['==== 仓库卫生体检 %s ====' % __import__('time').strftime('%Y-%m-%d %H:%M:%S')]
    lines.append('被追踪 %d / 未追踪未忽略 %d' % (len(tracked), len(others)))
    total = 0
    for k, v in findings.items():
        total += len(v)
        lines.append('')
        lines.append('◆ %s：%d 项' % (k, len(v)))
        for x in v[:40]:
            lines.append('   ' + x)
        if len(v) > 40:
            lines.append('   …（其余 %d 项略）' % (len(v) - 40))
    lines.append('')
    lines.append('结论：%s（共 %d 项发现）' % ('干净' if total == 0 else '需整改', total))
    report = '\n'.join(lines)
    log.info(report)
    if out_path:
        try:
            os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
            with open(out_path, 'a', encoding='utf-8') as fh:
                fh.write(report + '\n\n')
        except Exception as e:
            log.error('[hygiene-check] 报告写盘失败：%r' % e)
    return 1 if total else 0


if __name__ == '__main__':
    sys.exit(main())
