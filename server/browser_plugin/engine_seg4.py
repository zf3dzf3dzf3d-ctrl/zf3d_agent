# -*- coding: utf-8 -*-
# 拆分分段模块：网站档案扩展（map_site / archive_site）——由门面 engine.py 合并加载。
# 功能：
#   map_site    抓取当前页面同域全部链接（去重归一化，默认限 500 条）
#   archive_site 一键 map + 落档 public/项目记录/网站档案/<域名>.md，追加合并，自动登记 _索引.md
#                 mode=diff 时与已有档案对比，报告新增/失效链接
import os
import re
import json
import time
import urllib.parse

_ARCHIVE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'public', '项目记录', '网站档案')

_LINK_JS = r"""
() => {
  const out = new Map();
  const base = location.origin;
  document.querySelectorAll('a[href]').forEach(a => {
    try {
      const u = new URL(a.href, location.href);
      if (u.origin !== base) return;
      u.hash = '';
      const href = u.href;
      if (!href || href === location.origin + '/') return;
      const label = (a.innerText || a.title || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (!out.has(href) || (label && !out.get(href))) out.set(href, label);
    } catch (e) {}
  });
  return Array.from(out, ([href, label]) => ({href, label}));
}
"""


def _domain_of(url):
    try:
        return urllib.parse.urlparse(url).netloc or 'unknown'
    except Exception:
        return 'unknown'


def _safe_name(domain):
    return re.sub(r'[\\/:*?"<>|]', '_', domain) or 'unknown'


@register('map_site')
def _act_map_site(engine, params):
    """抓取当前页面同域全部链接。params: session, index, limit"""
    sn = params.get('session') or 'default'
    s = get_session(sn)
    limit = max(1, min(int(params.get('limit') or 500), 2000))

    def _do():
        page = s._pick_page(params.get('index'))
        entry = page.url
        try:
            title = page.title()
        except Exception:
            title = ''
        links = page.evaluate(_LINK_JS) or []
        seen = set()
        out = []
        for it in links:
            href = it.get('href')
            if not href or href in seen:
                continue
            seen.add(href)
            out.append({'href': href, 'label': it.get('label') or ''})
            if len(out) >= limit:
                break
        return {'ok': True, 'entry_url': entry, 'title': title,
                'count': len(out), 'links': out}
    r = _run_in(sn, None, _do)
    try:
        _site_mem_touch(_domain_of(r.get('entry_url') or ''), 'map_site',
                        r.get('entry_url') or '', r.get('title') or '',
                        r.get('count') or 0)
    except Exception:
        pass
    return r


# ---------- 站点知识记忆钩子（private/记忆/站点/<域名>.md，隐私区） ----------
# 写入时机绑定在代码路径里（不靠提示词）：archive_site/map_site 调用即自动记录访问。

_SITE_MEM_DIR = os.path.normpath(os.path.join(
    _PLUGIN_DIR, '..', '..', 'private', '记忆', '站点'))


def _site_mem_touch(domain, action, entry, title='', count=0):
    """AI 调 map_site/archive_site 时自动登记一次访问（追加合并，幂等轻量）"""
    try:
        if not domain:
            return
        os.makedirs(_SITE_MEM_DIR, exist_ok=True)
        safe = _safe_name(domain)
        fp = os.path.join(_SITE_MEM_DIR, safe + '.md')
        # 硬校验：落盘路径必须在项目 private 隐私区内，防止相对层级写错导致跨目录误写
        _priv = os.path.normpath(os.path.join(_PLUGIN_DIR, '..', '..', 'private'))
        if not os.path.abspath(fp).startswith(os.path.abspath(_priv) + os.sep):
            raise ValueError('site memory path escapes private dir: %r' % fp)
        now = time.strftime('%Y-%m-%d %H:%M')
        if not os.path.isfile(fp):
            with open(fp, 'w', encoding='utf-8') as f:
                f.write('# 站点记忆：%s\n'
                        '<!-- 密码靠浏览器 profile，此处严禁写密码 -->\n\n' % domain)
        with open(fp, 'a', encoding='utf-8') as f:
            f.write('## 访问记录\n- [%s] %s（%s%s）\n' % (
                now, action, entry,
                (' · ' + str(title)) if title else '',
            ))
    except Exception:
        pass


@register('archive_site')
def _act_archive_site(engine, params):
    """一键抓链接并落档。params: session, title, note, limit, mode('write'|'diff')"""
    sn = params.get('session') or 'default'
    s = get_session(sn)
    limit = max(1, min(int(params.get('limit') or 500), 2000))
    mode = params.get('mode') or 'write'

    def _do():
        page = s._pick_page(params.get('index'))
        entry = page.url
        try:
            title = page.title()
        except Exception:
            title = ''
        links = page.evaluate(_LINK_JS) or []
        seen = set()
        fresh = []
        for it in links:
            href = it.get('href')
            if not href or href in seen:
                continue
            seen.add(href)
            fresh.append({'href': href, 'label': it.get('label') or ''})
            if len(fresh) >= limit:
                break

        domain = _safe_name(_domain_of(entry))
        os.makedirs(_ARCHIVE_DIR, exist_ok=True)
        path = os.path.join(_ARCHIVE_DIR, domain + '.md')
        idx_path = os.path.join(_ARCHIVE_DIR, '_索引.md')

        old_hrefs = set()
        if os.path.isfile(path):
            try:
                with open(path, encoding='utf-8') as f:
                    for line in f:
                        m = re.match(r'^- \[(.*?)\]\((.*?)\)', line.strip())
                        if m:
                            old_hrefs.add(m.group(2))
            except Exception:
                pass

        if mode == 'diff':
            new_links = [l for l in fresh if l['href'] not in old_hrefs]
            gone = sorted(old_hrefs - seen)
            return {'ok': True, 'mode': 'diff', 'domain': domain,
                    'archive': path, 'old_count': len(old_hrefs),
                    'fresh_count': len(fresh),
                    'new': [l['href'] for l in new_links],
                    'gone': gone}

        # write 模式：追加合并
        merged = dict(old_hrefs)
        added = []
        now = time.strftime('%Y-%m-%d %H:%M')
        lines = []
        if not os.path.isfile(path):
            lines.append('# 网站档案：' + (params.get('title') or title or domain))
            lines.append('')
            lines.append('- 入口URL: ' + entry)
            lines.append('- 首次建档: ' + now)
            lines.append('')
        lines.append('## 抓取记录 ' + now)
        if params.get('note'):
            lines.append('> ' + str(params['note']))
        lines.append('')
        for l in fresh:
            star = '' if l['href'] in merged else ' 🆕'
            if l['href'] not in merged:
                added.append(l['href'])
            merged.add(l['href'])
            lines.append('- [%s](%s)%s' % (l['label'] or l['href'], l['href'], star))
        lines.append('')
        with open(path, 'a', encoding='utf-8') as f:
            f.write('\n'.join(lines) + '\n')

        # 登记索引
        idx_line = '- [%s](%s) · %d 链接 · 更新 %s\n' % (
            domain, entry, len(merged), now)
        idx_exists = os.path.isfile(idx_path)
        idx_content = ''
        if idx_exists:
            with open(idx_path, encoding='utf-8') as f:
                idx_content = f.read()
        if ('(' + entry + ')') not in idx_content:
            if not idx_exists:
                idx_content = '# 网站档案索引\n\n'
            idx_content += idx_line
            with open(idx_path, 'w', encoding='utf-8') as f:
                f.write(idx_content)

        return {'ok': True, 'mode': 'write', 'domain': domain,
                'archive': path, 'index': idx_path,
                'fresh_count': len(fresh), 'total': len(merged),
                'added': len(added), 'entry_url': entry}
    r = _run_in(sn, None, _do)
    try:
        if r.get('mode') == 'write':
            _site_mem_touch(_domain_of(r.get('entry_url') or ''),
                            'archive_site', r.get('entry_url') or '',
                            params.get('note') or '')
    except Exception:
        pass
    return r
