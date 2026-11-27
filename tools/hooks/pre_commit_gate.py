# -*- coding: utf-8 -*-
"""pre-commit 第三棒（并入 .githooks/pre-commit 链）。

两道闸：
  1. 暂存区卫生（恒硬拦）：private/、凭据/cookie、tmp/bak 残渣、>5MB 大文件；
  2. 反模式计数器（只许降不许涨）——2026-11-24 起对正式提交【硬拦截】：上涨即拒绝提交。
     此前的“软警告”拦不住回潮：2026-11-23 全天九项指标持平；当夜至次日清晨，蜂群新增的
     协作插件在没有任何拦截的情况下带入 8 处宽泛异常捕获、2 处静默吞异常、7 处 print。

     不拦的两种情况（都留痕）：
       - 保护性快照：快照守护、切换分支前的自动收起、流水线工作区提交。它们用
         `git -c zf.snapshot=1 commit ...` 提交，本脚本读这个一次性配置项识别。
         快照的职责是防丢——拦它等于让工作成果失去保护。
       - 豁免期内的上涨：tools/quality/waivers.json 对某指标登记了 ceiling 与 until，
         到期自动失效。判定逻辑在 count_antipatterns.load_waivers，与 run_checks 同一把尺子。

     参数：--soft 退回“只警告”（应急）；--strict 保留，等同默认。

     所有放行追加写入 private/logs/gate_exemptions.jsonl（机器本地，不随分发），可审计。

注意：本仓 core.hooksPath=.githooks（2026-11-22 复活），装进 .git/hooks 的钩子
永不生效——本文件由 .githooks/pre-commit 第三棒引用，勿再装 .git/hooks。
"""
import contextlib
import datetime
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXEMPTION_LOG = ROOT / 'private' / 'logs' / 'gate_exemptions.jsonl'
COUNTER = ROOT / 'tools' / 'quality' / 'count_antipatterns.py'

FORBIDDEN_NAME_SUFFIXES = ('.log', '.env')
FORBIDDEN_NAME_PARTS = ('cookie', '.pem', '.key')
FORBIDDEN_PATTERNS = ('tmp_*', '_tmp_*', '*.bak', '*.bak-*', '*.bak.*',
                      '*.prebak', '*.mybak')
# apply_*.py 2026-11-24 改根锚定（与 .gitignore /apply_*.py 同型修正，跟随 2026-11-22 /_* 判例）：
# 只拦根目录的 apply_*.py 临时脚本，解除对 tools/sandbox/apply_acl.py 正式沙箱工具的误伤
ROOT_ONLY_PATTERNS = ('apply_*.py',)
MAX_BYTES = 5 * 1024 * 1024


def fnmatch_any(name, patterns):
    from fnmatch import fnmatch
    return any(fnmatch(name, p) for p in patterns)


def staged_files():
    out = subprocess.run(
        ['git', 'diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'],
        cwd=str(ROOT), capture_output=True)
    return [s.decode('utf-8', 'replace') for s in out.stdout.split(b'\0') if s]


def check_staging():
    bad = []
    for rel in staged_files():
        p = ROOT / rel
        norm = rel.replace('\\', '/')
        low = norm.lower()
        if norm.startswith('private/'):
            bad.append((rel, 'private/ 隐私目录严禁入库'))
        if any(part in low for part in FORBIDDEN_NAME_PARTS):
            bad.append((rel, '凭据/密钥类文件名命中禁止清单'))
        if fnmatch_any(Path(norm).name, FORBIDDEN_PATTERNS) or \
                low.endswith(FORBIDDEN_NAME_SUFFIXES) or \
                (Path(norm).parent == Path('.') and fnmatch_any(Path(norm).name, ROOT_ONLY_PATTERNS)):
            bad.append((rel, '临时/备份/日志残渣命中禁止清单'))
        with contextlib.suppress(OSError):
            if p.is_file() and p.stat().st_size > MAX_BYTES:
                bad.append((rel, '>5MB 大文件需在策划案内明示理由后人工放行'))
    if bad:
        print('[FAIL] 暂存区卫生检查不通过：')
        for rel, why in bad:
            print('  %s\n    -> %s' % (rel, why))
        return 1
    return 0


def is_snapshot_commit():
    """本次提交是否为保护性快照（调用方用 git -c zf.snapshot=1 commit ...）。"""
    r = subprocess.run(['git', 'config', '--get', 'zf.snapshot'],
                       cwd=str(ROOT), capture_output=True, text=True)
    return r.returncode == 0 and r.stdout.strip() == '1'


def check_counter():
    """跑计数器并打印对比表。返回 (退出码, 结构化结果)。

    按路径加载计数器模块而不是起子进程：既要它打印的表，也要它算出的结构化结果（留痕用），
    一次扫描两样都拿。"""
    spec = importlib.util.spec_from_file_location('zf_count_antipatterns', str(COUNTER))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.report(mod.scan())


def _head_short():
    r = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'],
                       cwd=str(ROOT), capture_output=True, text=True)
    return r.stdout.strip() or '?'


def log_exemption(kind, info):
    """豁免留痕：追加一行 JSON。写不进去不阻断——日志不是授权凭证。"""
    rec = {
        'ts': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'kind': kind,                       # snapshot | waiver | soft
        'head': _head_short(),
        'exceeded': {m: list(v) for m, v in (info.get('exceeded') or {}).items()},
        'waived': {m: {'ceiling': w.get('ceiling'), 'until': w.get('until')}
                   for m, w in (info.get('waived') or {}).items()},
    }
    with contextlib.suppress(OSError):
        EXEMPTION_LOG.parent.mkdir(parents=True, exist_ok=True)
        with EXEMPTION_LOG.open('a', encoding='utf-8') as f:
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')


def main():
    with contextlib.suppress(Exception):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    soft = '--soft' in sys.argv            # --strict 保留：等同默认
    rc1 = check_staging()
    if rc1:
        return 1
    rc2, info = check_counter()
    if info.get('waived'):
        log_exemption('waiver', info)
    if not rc2:
        return 0
    if is_snapshot_commit():
        log_exemption('snapshot', info)
        print('[WARN] 保护性快照：反模式上涨不拦截（快照的职责是防丢）。'
              '已留痕 private/logs/gate_exemptions.jsonl')
        return 0
    if soft:
        log_exemption('soft', info)
        print('[WARN] --soft：反模式上涨仅警告（应急模式，勿长期使用）。'
              '已留痕 private/logs/gate_exemptions.jsonl')
        return 0
    print('[FAIL] 提交被拒绝。')
    return rc2


if __name__ == '__main__':
    sys.exit(main())
