#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Skills Market 技能市场（独立文件，可单文件删除下线）

设计原则：本地只存一份"市场索引"（_market.json，仅元数据+下载路径），
不下载技能内容，不占用空间。用户选中某个技能后才按需下载安装到 skills/ 目录。

索引来源（默认源）：
  - anthropics/skills          官方 Agent Skills（github stars 17w+）
  - obra/superpowers           高星技能合集
  - addyosmani/agent-skills    高星工程技能合集
  - mattpocock/skills          高星技能合集

_market.json 结构：
{
  "updated": 1735689600,
  "sources": ["anthropics/skills", "..."],
  "items": [
    {
      "id": "pdf",                          ← 安装后技能目录名
      "name": "PDF 处理",
      "description": "...",
      "stars": 172675,                      ← 来源仓库星标
      "source": "anthropics/skills",        ← 仓库
      "path": "skills/pdf",                 ← 仓库内路径（多技能仓库用）
      "url": "https://github.com/anthropics/skills/tree/main/skills/pdf",
      "api": "https://api.github.com/repos/anthropics/skills/contents/skills/pdf",
      "installed": false                    ← 刷新 list 时动态填充
    }
  ]
}

API（挂在 /api/ext/skills/ 下）：
  GET  /api/ext/skills/market_list     → {ok, items, updated}
  POST /api/ext/skills/market_install  {id}   → 从源下载技能文件到 skills/<id>/
  POST /api/ext/skills/market_refresh  → 从 GitHub 重新拉取索引（需网络）
"""

import os
import json
import time
import base64
import threading
import subprocess

_DIR = os.path.dirname(os.path.abspath(__file__))
_SKILLS_DIR = os.path.join(_DIR, 'skills')
_INDEX_PATH = os.path.join(_SKILLS_DIR, '_market.json')
_LOCK = threading.Lock()

# 索引源：仓库及其技能根目录
SOURCES = [
    {'repo': 'anthropics/skills', 'dir': 'skills', 'note': '官方 Agent Skills', 'limit': 30},
    {'repo': 'obra/superpowers', 'dir': 'skills', 'note': '高星技能合集', 'limit': 30},
    {'repo': 'addyosmani/agent-skills', 'dir': 'skills', 'note': '工程技能合集', 'limit': 30},
    {'repo': 'mattpocock/skills', 'dir': 'skills', 'note': '高星技能合集', 'limit': 20},
    {'repo': 'K-Dense-AI/scientific-agent-skills', 'dir': 'skills', 'note': '科研技能合集', 'limit': 30},
    {'repo': 'JimLiu/baoyu-skills', 'dir': 'skills', 'note': '宝玉技能合集', 'limit': 30},
]

_GH_HEADERS = {'User-Agent': 'zf-agent', 'Accept': 'application/vnd.github+json'}


def _gh_token():
    """从 git credential 取 token，提升 GitHub API 限额（可选）。"""
    try:
        r = subprocess.run(['git', 'credential', 'fill'],
                           input='protocol=https\nhost=github.com\n\n',
                           capture_output=True, text=True, timeout=15)
        for l in r.stdout.splitlines():
            if l.startswith('password='):
                return l.split('=', 1)[1]
    except Exception:
        pass
    return None


def _gh_api(url, token=None, timeout=30):
    import urllib.request
    headers = dict(_GH_HEADERS)
    if token:
        headers['Authorization'] = 'token ' + token
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def _load_index():
    data = _read_json(_INDEX_PATH)
    if isinstance(data, dict) and isinstance(data.get('items'), list):
        return data
    return {'updated': 0, 'sources': [], 'items': []}


def _read_json(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _save_index(data):
    with open(_INDEX_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _installed_ids():
    ids = set()
    try:
        for name in os.listdir(_SKILLS_DIR):
            if name.startswith(('_', '.')):
                continue
            if os.path.isfile(os.path.join(_SKILLS_DIR, name, 'skill.json')):
                ids.add(name)
    except OSError:
        pass
    return ids


def list_market():
    """读取本地索引（不联网），动态标注 installed。"""
    data = _load_index()
    installed = _installed_ids()
    items = []
    for it in data.get('items', []):
        it = dict(it)
        it['installed'] = it.get('id') in installed
        items.append(it)
    return {'updated': data.get('updated', 0), 'items': items}


def refresh_market(limit_per_source=None):
    """联网重新拉取索引（只存元数据）。"""
    token = _gh_token()
    items = []
    sources = []
    for src in SOURCES:
        repo = src['repo']
        try:
            meta = _gh_api('https://api.github.com/repos/' + repo, token)
            stars = meta.get('stargazers_count', 0)
        except Exception as e:
            print('[SkillsMarket] repo meta failed: %s %s' % (repo, e))
            continue
        sources.append(repo)
        try:
            entries = _gh_api(
                'https://api.github.com/repos/%s/contents/%s' % (repo, src['dir']), token)
        except Exception as e:
            print('[SkillsMarket] contents failed: %s %s' % (repo, e))
            continue
        n = 0
        _limit = limit_per_source if limit_per_source else src.get('limit', 50)
        for ent in entries:
            if ent.get('type') != 'dir':
                continue
            sid = ent.get('name', '')
            if sid.startswith(('_', '.')):
                continue
            items.append({
                'id': sid,
                'name': sid,
                'description': '',
                'stars': stars,
                'source': repo,
                'path': '%s/%s' % (src['dir'], sid),
                'url': 'https://github.com/%s/tree/main/%s/%s' % (repo, src['dir'], sid),
                'api': 'https://api.github.com/repos/%s/contents/%s/%s' % (repo, src['dir'], sid),
            })
            n += 1
            if n >= _limit:
                break
    data = {'updated': int(time.time()), 'sources': sources, 'items': items}
    if items:
        with _LOCK:
            _save_index(data)
    return data


def _readme_brief(text, max_len=200):
    """从 README 前几行提取一句简介。"""
    for line in (text or '').splitlines():
        line = line.strip().lstrip('#').strip()
        if line and not line.startswith(('-', '*', '[', '!', '<', '|')) and len(line) > 15:
            return line[:max_len]
    return ''


def _fetch_dir_files(api_url, token, out_dir, subdir=''):
    """递归下载一个 GitHub contents 目录到本地。"""
    import urllib.request
    entries = _gh_api(api_url, token)
    os.makedirs(out_dir, exist_ok=True)
    count = 0
    for ent in entries:
        name = ent.get('name', '')
        if ent.get('type') == 'dir':
            count += _fetch_dir_files(ent.get('url'), token,
                                      os.path.join(out_dir, name), subdir)
        elif ent.get('type') == 'file':
            dl = ent.get('download_url')
            if not dl:
                continue
            req = urllib.request.Request(dl, headers={'User-Agent': 'zf-agent'})
            with urllib.request.urlopen(req, timeout=60) as r:
                content = r.read()
            with open(os.path.join(out_dir, name), 'wb') as f:
                f.write(content)
            count += 1
    return count


def install_skill(mid):
    """按需下载安装市场技能到 skills/<mid>/，并补齐 skill.json。"""
    if not mid or mid.startswith(('_', '.')) or '\\' in mid or '/' in mid or '..' in mid:
        return None, '非法技能 id: ' + mid
    data = _load_index()
    item = None
    for it in data.get('items', []):
        if it.get('id') == mid:
            item = it
            break
    if not item:
        return None, '市场索引中不存在: ' + mid
    dest = os.path.join(_SKILLS_DIR, mid)
    if os.path.isfile(os.path.join(dest, 'skill.json')):
        return {'id': mid, 'already': True}, None
    token = _gh_token()
    try:
        n = _fetch_dir_files(item['api'], token, dest)
    except Exception as e:
        return None, '下载失败: %s' % e
    # 补 skill.json（市场技能多是 SKILL.md 规范，转成本地规范）
    sp = os.path.join(dest, 'skill.json')
    if not os.path.isfile(sp):
        meta = {
            'id': mid,
            'name': item.get('name') or mid,
            'description': item.get('description', ''),
            'enabled': True,
        }
        # 找提示词正文文件
        prompt_file = None
        for cand in ('SKILL.md', 'skill.md', 'PROMPT.md', 'prompt.md', 'README.md'):
            if os.path.isfile(os.path.join(dest, cand)):
                prompt_file = cand
                break
        if prompt_file:
            meta['prompt'] = prompt_file
            # 尝试解析 SKILL.md frontmatter 补充 name/description
            if prompt_file == 'SKILL.md':
                try:
                    with open(os.path.join(dest, 'SKILL.md'), 'r', encoding='utf-8') as f:
                        head = f.read(2000)
                    import re
                    m = re.search(r'^name:\s*(.+)$', head, re.M)
                    if m:
                        meta['name'] = m.group(1).strip()
                    m = re.search(r'^description:\s*(.+)$', head, re.M)
                    if m:
                        meta['description'] = m.group(1).strip()[:200]
                except OSError:
                    pass
        with open(sp, 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
    return {'id': mid, 'files': n, 'installed': True}, None


def _send(handler, data, code=200):
    try:
        handler._send_json(data, code)
    except Exception:
        pass


def handle(handler, method, tail, body):
    """tail 形如 ['market_list']。"""
    action = tail[0] if tail else ''

    if method == 'GET' and action == 'market_list':
        _send(handler, {'ok': True, **list_market()})
        return True

    if method == 'POST' and action == 'market_refresh':
        try:
            data = refresh_market()
            _send(handler, {'ok': True, 'count': len(data.get('items', [])),
                            'sources': data.get('sources', [])})
        except Exception as e:
            _send(handler, {'ok': False, 'error': str(e)}, 500)
        return True

    if method == 'POST' and action == 'market_install':
        mid = str(body.get('id') or '')
        result, err = install_skill(mid)
        if err:
            _send(handler, {'ok': False, 'error': err}, 400)
        else:
            _send(handler, {'ok': True, **result})
        return True

    if method == 'POST' and action == 'market_delete':
        # 卸载：删除技能目录（_market 索引不受影响）
        import shutil
        mid = str(body.get('id') or '')
        dest = os.path.join(_SKILLS_DIR, mid)
        if not mid or mid.startswith(('_', '.')) or not os.path.isdir(dest):
            _send(handler, {'ok': False, 'error': '技能不存在: ' + mid}, 400)
            return True
        shutil.rmtree(dest, ignore_errors=True)
        _send(handler, {'ok': True, 'id': mid, 'deleted': True})
        return True

    return False
