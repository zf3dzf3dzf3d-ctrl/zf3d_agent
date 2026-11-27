# -*- coding: utf-8 -*-
"""
check_capabilities —— 插件 capabilities 声明与实现对齐检查器
（工程基建总纲 Phase 3.1 20261123；"漂移零容忍"的机器化落实）。

背景：外部评价指出 manifest 曾声明实现里不存在的 net.fetch（声明-实现漂移）。
本检查器把对齐固化为可跑断言：

  ENFORCED   kernel_ctx._cap() 真实强制的能力（硬能力）
  ADVISORY   声明性软能力（ctx.log 等无害面，暂不强制，升级需先审计 ctx 使用面）

断言：
  1) 所有插件声明的 capabilities ⊆ ENFORCED ∪ ADVISORY（未知名 = 漂移，fail）；
  2) 插件 main.py 实际调用了硬能力入口（ctx.route / ctx.tool / ctx.ui.mount /
     schedule_every）却未在 manifest 声明对应能力 = 反向漂移，fail；
  3) 输出对齐矩阵供审计留痕。

用法：py tools/quality/check_capabilities.py   退出码 0=对齐, 1=漂移。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PLUG = ROOT / 'plugins'

# kernel_ctx.py _cap() 实际强制的能力（20261123 与实现对齐核定）
ENFORCED = {'plugin.manage', 'http.route', 'tool.register', 'ui.mount', 'schedule.every',
           'event.use', 'store.rw'}  # 20261123 第二轮对齐：event.use/store.rw 补强制
# 声明性软能力（ctx.log 无害面；强制化前置条件：先审计各插件 ctx.log 使用面）
ADVISORY = {'log.write'}
KNOWN = ENFORCED | ADVISORY

# 硬能力入口 -> 声明名（反向漂移检测用）
ENTRY_RE = {
    'http.route': re.compile(r'ctx\.route\.(?:get|post|register|add)'),
    'tool.register': re.compile(r'ctx\.tool\.'),
    'ui.mount': re.compile(r'ctx\.ui\.mount'),
    'schedule.every': re.compile(r'ctx\.schedule_every\('),
}


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    drift, reverse, rows = [], [], []
    for mf in sorted(PLUG.glob('*/manifest.json')):
        pid = mf.parent.name
        try:
            caps = set(json.loads(mf.read_text(encoding='utf-8-sig')).get('capabilities', []))
        except Exception as e:
            drift.append((pid, 'manifest 解析失败: %r' % e))
            continue
        unknown = caps - KNOWN
        if unknown:
            drift.append((pid, '未知能力声明: %s' % sorted(unknown)))
        main_py = mf.parent / 'main.py'
        used = set()
        if main_py.exists():
            src = main_py.read_text(encoding='utf-8-sig', errors='ignore')
            src = re.sub(r'#.*$', '', src, flags=re.M)  # 剥行注释（_template 的示例调用在注释里）
            for cap, rex in ENTRY_RE.items():
                if rex.search(src):
                    used.add(cap)
        need_declare = used & ENFORCED - caps
        if need_declare:
            reverse.append((pid, '使用了硬能力入口却未声明: %s' % sorted(need_declare)))
        rows.append((pid, sorted(caps)))
    for pid, caps in rows:
        print('  %-22s %s' % (pid, ','.join(caps) or '(无)'))
    for pid, why in drift:
        print('[DRIFT] %s: %s' % (pid, why))
    for pid, why in reverse:
        print('[REVERSE-DRIFT] %s: %s' % (pid, why))
    if drift or reverse:
        print('[FAIL] capabilities 漂移 %d 处 / 反向漂移 %d 处' % (len(drift), len(reverse)))
        return 1
    print('[OK] 全部插件 capabilities 声明与实现对齐（强制 %s / 软 %s）'
          % (sorted(ENFORCED), sorted(ADVISORY)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
