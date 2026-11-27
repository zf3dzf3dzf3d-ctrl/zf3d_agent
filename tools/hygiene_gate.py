# -*- coding: utf-8 -*-
"""hygiene_gate - 入库卫生闸门 CLI（pre-commit 与快照守护共用同一规则源）。

规则源：tools/coding/backend/_file_protect.py（L0 写入端四查同一套，防规则双份漂移——
吸取旧 pre-commit 双副本钩子双副本漂移的教训）。

用法：
    python tools/hygiene_gate.py            # 检查当前仓库暂存区（pre-commit 语境）
    python tools/hygiene_gate.py --staged   # 同上（显式）
退出码：0=通过；1=存在违规（pre-commit 将拦截提交）；2=闸门自身异常（不拦，fail-open）

五查（仓库卫生策划案 2026-11-22，与 self_check._guard_hygiene 同口径）：
  ①畸形文件名 ②空文件 ③无效 UTF-8（.bat/.ps1/.cmd 与二进制豁免）
  ④U+FFFD 内容毁损 ⑤根目录白名单外新增文件
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tools.coding.backend import _file_protect as fp  # noqa: E402 规则单源

# 二进制/ANSI 扩展名单源：_file_protect.BINARY_EXTS（本文件不再自持一份）


def _git(*args):
    return subprocess.run(['git'] + list(args), capture_output=True)


def main():
    try:
        r = _git('diff', '--cached', '--name-status', '-z', '--diff-filter=ACMR')
        if r.returncode != 0:
            print('[hygiene-gate] git diff 失败，跳过检查（fail-open）')
            return 2
        items = r.stdout.decode('utf-8', 'replace').split('\x00')
        pairs = []
        i = 0
        while i < len(items):
            status = items[i].strip()
            if not status:
                i += 1
                continue
            # rename/copy 的 -z 序列是 status\0旧路径\0新路径，取新路径
            if status[0] in ('R', 'C'):
                f = items[i + 2].strip() if i + 2 < len(items) else ''
                i += 3
            else:
                f = items[i + 1].strip() if i + 1 < len(items) else ''
                i += 2
            if f:
                pairs.append((status, f.replace(os.sep, '/')))
        violations = []
        for status, f in pairs:
            fp_abs = os.path.join(ROOT, f)
            if not os.path.isfile(fp_abs):
                continue
            ext = os.path.splitext(f)[1].lower()
            is_new = status.startswith('A')
            # ①畸形文件名（仅新增）
            if is_new:
                issue = fp._name_issue(f)
                if issue:
                    violations.append('[文件名] %s：%s' % (f, issue))
                    continue
            # ②空文件（仅新增）
            if is_new and os.path.getsize(fp_abs) == 0:
                if os.path.basename(f).rsplit('.', 1)[0] not in fp._EMPTY_OK_STEMS:
                    violations.append('[空文件] %s：新增空文件多为意外产物' % f)
                    continue
            # ③④编码与乱码
            if not fp.is_binary_path(f):
                try:
                    with open(fp_abs, 'rb') as fh:
                        data = fh.read()
                    if len(data) <= 2 * 1024 * 1024:
                        try:
                            text = data.decode('utf-8', errors='strict')
                        except UnicodeDecodeError as ue:
                            violations.append('[无效UTF-8] %s：%s' % (f, ue))
                            continue
                        n = text.count('\ufffd')
                        if n:
                            if is_new and n >= fp._FFFD_BLOCK_MIN:
                                violations.append('[乱码] %s：%d 处 U+FFFD（疑似错码写毁）'
                                                  % (f, n))
                            elif not is_new:
                                h = _git('show', 'HEAD:' + f)
                                if h.returncode == 0 and '\ufffd' not in h.stdout.decode(
                                        'utf-8', 'replace'):
                                    violations.append('[乱码] %s：HEAD 干净而暂存版含 %d 处 '
                                                      'U+FFFD（净增污染）' % (f, n))
                except Exception as e:
                    print('[hygiene-gate] [警告] 检查 %s 异常：%r（放行）' % (f, e))
            # ⑤根目录白名单（仅新增；硬拦——应急走 git commit --no-verify）
            if is_new and os.path.dirname(fp_abs) == ROOT:
                if os.path.basename(f).lower() not in fp._ROOT_OK_NAMES and \
                        os.path.splitext(f)[1].lower() not in fp._ROOT_OK_EXTS:
                    violations.append('[根层提醒] %s：根目录新文件（探针请落 tmp/）' % f)
        if violations:
            print('==== hygiene_gate 拦截 %d 项 ====' % len(violations))
            for v in violations:
                print('  ' + v)
            print('整改：改名/修内容后重新 add；确认无误可用 git commit --no-verify 豁免。')
            return 1
        return 0
    except Exception as e:
        print('[hygiene-gate] 闸门自身异常（fail-open 放行）：%r' % e)
        return 2


if __name__ == '__main__':
    sys.exit(main())
