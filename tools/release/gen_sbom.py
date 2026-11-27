# -*- coding: utf-8 -*-
"""gen_sbom - M2.7 软件物料清单（CycloneDX 1.5 JSON）生成（2026-11-24）。

从两份带哈希的锁定文件（server/requirements.lock / requirements.win.lock）生成
CycloneDX 格式的 SBOM：每个依赖一条 component（name/version/purl），随发布包交付，
满足供应链审计的最小要求（策划案 M2.7）。

用法：py tools/release/gen_sbom.py [--out dist/sbom.cdx.json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOCKS = ('server/requirements.lock', 'server/requirements.win.lock')
ENTRY_RE = re.compile(r'^([A-Za-z0-9_.\-]+)==([^\s\\]+)', re.M)


def components_from_lock(path: Path) -> list:
    comps = []
    text = path.read_text(encoding='utf-8')
    for m in ENTRY_RE.finditer(text):
        name, ver = m.group(1).lower(), m.group(2).rstrip('\\').strip()
        comps.append({
            'type': 'library',
            'name': name,
            'version': ver,
            'purl': 'pkg:pypi/%s@%s' % (name, ver),
        })
    return comps


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(ROOT / 'dist' / 'sbom.cdx.json'))
    args = ap.parse_args()
    comps, seen = [], set()
    for rel in LOCKS:
        p = ROOT / rel
        if not p.is_file():
            print('[跳过] %s 不存在' % rel)
            continue
        for c in components_from_lock(p):
            key = (c['name'], c['version'])
            if key not in seen:
                seen.add(key)
                comps.append(c)
    bom = {
        'bomFormat': 'CycloneDX',
        'specVersion': '1.5',
        'serialNumber': 'urn:uuid:zf-%s' % time.strftime('%Y%m%d%H%M%S'),
        'version': 1,
        'metadata': {
            'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'tools': [{'name': 'tools/release/gen_sbom.py', 'version': '1.0'}],
            'component': {'type': 'application', 'name': '朱峰智能体无限'},
        },
        'components': sorted(comps, key=lambda c: (c['name'], c['version'])),
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bom, ensure_ascii=False, indent=1), encoding='utf-8')
    print('[OK] SBOM 已生成: %s（%d 个组件，CycloneDX 1.5）' % (out, len(comps)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
