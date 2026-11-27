# -*- coding: utf-8 -*-
"""
hash_assets —— 入口页资源版本号自动化（工程基建总纲 Phase 4.1 20261123）。

把 public/index.html 里本地 <script src>/<link href> 的 ?v= 从人肉 bump 改为
内容哈希（sha1 前 8 位）：改文件 -> 跑本工具 -> 刷新即生效，全程不需要手改版本号。

用法：
  py tools/quality/hash_assets.py            # 检查模式：缺失/无版本号/重复/版本戳过期清单
  py tools/quality/hash_assets.py --fix      # 重写全部本地资源的 ?v= 为当前内容哈希

  【版本戳过期】文件改了而 ?v= 没刷（改完忘跑 --fix）——缓存了旧地址的浏览器会继续跑旧
  脚本。20261124 前检查模式不查这项，靠人记；现在过期与缺失/重复一样计入退出码。

说明：
  - 仅处理本地相对路径（js/ css/ 开头）；外链 URL 不动；
  - 同一资源多处引用会被统一改成同一哈希（消除"两处版本号漂移"隐患）；
  - 重复加载由计数器 html_dup_script 指标把关，本工具只提示不拦截。
"""
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INDEX = ROOT / 'public' / 'index.html'
RE_ASSET = re.compile(
    r'(<script[^>]*?\bsrc=")([^"]+)(")|(<=?link[^>]*?\bhref=")([^"]+)(")',
    re.I)
LOCAL_PREFIXES = ('js/', 'css/', 'i桌面/', 'canvas/')
HASH_LEN = 8


def _asset_path(base_dir, url):
    url = url.split('?', 1)[0]
    if not any(url.startswith(p) for p in LOCAL_PREFIXES):
        return None
    p = (ROOT / 'public' / url)
    return p if p.is_file() else None


def _sha1(p):
    return hashlib.sha1(p.read_bytes()).hexdigest()[:HASH_LEN]


def scan():
    """返回 [(属性起, url, 属性终), ...]（已剥离 HTML 注释——注释掉的死标签不算引用）。"""
    text = INDEX.read_text(encoding='utf-8-sig')
    text = re.sub(r'<!--.*?-->', '', text, flags=re.S)
    out = []
    for m in RE_ASSET.finditer(text):
        if m.group(1) is not None:
            out.append((m.group(1), m.group(2), m.group(3)))
        else:
            out.append((m.group(4), m.group(5), m.group(6)))
    return out


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    assets = scan()
    fix = '--fix' in sys.argv
    missing, no_ver, dups, stale = [], [], {}, []
    rewrite = INDEX.read_text(encoding='utf-8-sig')
    for lead, url, tail in assets:
        base = url.split('?', 1)[0]
        dups.setdefault(base, 0)
        dups[base] += 1
        p = _asset_path(INDEX.parent, url)
        if p is None:
            if any(url.startswith(pre) for pre in LOCAL_PREFIXES):
                missing.append(url)
            continue
        h = _sha1(p)
        if '?v=' not in url:
            no_ver.append(url)
        new_url = base + '?v=' + h
        if url != new_url:
            if not fix:
                stale.append(url)
            rewrite = rewrite.replace('"%s"' % url, '"%s"' % new_url)
    dup = {k: v for k, v in dups.items() if v > 1}
    if fix:
        INDEX.write_text(rewrite, encoding='utf-8', newline='\n')
        print('[FIX] 已重写 ?v= 为内容哈希')
    print('本地资源 %d 个：缺失 %d，无版本号 %d，重复加载 %d，版本戳过期 %d'
          % (len([a for a in assets if any(a[1].startswith(p) for p in LOCAL_PREFIXES)]),
             len(missing), len(no_ver), len(dup), len(stale)))
    for u in missing:
        print('  [MISSING]', u)
    if stale:
        print('  [STALE] %s（改了文件没刷版本号，缓存用户会拿到旧脚本；--fix 可补）'
              % ', '.join(stale[:6]))
    if no_ver:
        print('  [NO-VER]', ', '.join(no_ver[:6]),
              '（--fix 可补）' if fix else '（py tools/quality/hash_assets.py --fix 可补）')
    if dup:
        print('  [DUP]', dup, '（重复加载由计数器 html_dup_script 硬把关）')
    rc = 1 if (missing or dup or stale) else 0
    print('[OK] 检查完成' if rc == 0 else '[FAIL] 有缺失/重复/版本戳过期资源')
    return rc


if __name__ == '__main__':
    sys.exit(main())
