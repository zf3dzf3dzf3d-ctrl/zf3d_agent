# -*- coding: utf-8 -*-
"""zf_share.py — 朱峰社区共享空间客户端（2026-09-25）

与 www.zf3d.com 网站端 api_share.asp 对接：
- 会员上传 ≤100MB 项目到 OSS（share/projects/），私有/公有可选
- 智能体内列出/下载/在线打开公有与自己的私有项目
- 远期：网址索引（用户授权后自动发布网站总结）
"""
import json
import logging
import os
import urllib.request
import urllib.error
import urllib.parse

_BASE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_BASE)
_CFG_FILE = os.path.normpath(os.path.join(_BASE, '..', 'public', 'config', 'zf_share.json'))

_DEFAULT_CFG = {
    "api_base": "https://www.zf3d.com/api/api_share.asp",
    "page_base": "https://www.zf3d.com/share.html",
    "max_upload_mb": 100,
    "index_consent": False  # 网址索引自动发布需用户显式同意
}


def load_cfg():
    cfg = dict(_DEFAULT_CFG)
    try:
        with open(_CFG_FILE, encoding='utf-8') as f:
            cfg.update(json.load(f))
    except Exception:
        pass
    return cfg


def save_cfg(patch):
    cfg = load_cfg()
    cfg.update(patch)
    os.makedirs(os.path.dirname(_CFG_FILE), exist_ok=True)
    with open(_CFG_FILE, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    return cfg


def _request(path_qs, data=None, method='GET', timeout=30):
    cfg = load_cfg()
    url = cfg['api_base'] + path_qs
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Referer', 'https://www.zf3d.com/')
    # 身份票：智能体携带本地会员登录后的会话票据（由 mixin_zf3d 登录时写入）
    try:
        import zf_identity as _zfi
        sec = _zfi.internal_secret()
        if sec:
            req.add_header('X-ZF-Agent-Key', sec)
    except Exception:
        pass
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8', 'replace'))


def _login_session():
    """读取本地保存的朱峰会员登录 cookies（mixin_zf3d 维护）"""
    try:
        import sqlite3
        db = os.path.join(_BASE, 'data', 'app.db')
        if not os.path.exists(db):
            db = os.path.join(_ROOT, 'server', 'data', 'app.db')
        conn = sqlite3.connect(db)
        cur = conn.cursor()
        cur.execute("SELECT value FROM app_data WHERE category='zf3d' AND key='cookies'")
        row = cur.fetchone()
        conn.close()
        return (json.loads(row[0]) if row else {})
    except Exception:
        return {}


def list_projects(visibility='public', page=1, page_size=20):
    qs = '?a=list&visibility=%s&page=%d&page_size=%d' % (visibility, page, page_size)
    return _request(qs)


def project_detail(pid):
    return _request('?a=detail&id=%d' % pid)


def get_upload_ticket(filename, size, title='', visibility='public', desc=''):
    """向网站申请上传票据：返回 {oss_key, upload_url, public_url, id}"""
    body = urllib.parse.urlencode({
        'a': 'ticket', 'filename': filename, 'size': size,
        'title': title, 'visibility': visibility, 'desc': desc,
        'session': json.dumps(_login_session(), ensure_ascii=False)
    }).encode('utf-8')
    return _request('', data=body, method='POST')


def upload_project(local_path, title, visibility='public', desc=''):
    """上传 ≤100MB 项目：先取票据，再 PUT/POST 到 OSS"""
    cfg = load_cfg()
    size = os.path.getsize(local_path)
    if size > cfg['max_upload_mb'] * 1024 * 1024:
        raise ValueError('文件超过 %dMB 限制' % cfg['max_upload_mb'])
    filename = os.path.basename(local_path)
    ticket = get_upload_ticket(filename, size, title, visibility, desc)
    if not ticket.get('ok'):
        raise RuntimeError(ticket.get('msg', '获取上传票据失败'))
    # OSS 表单上传（PostObject）
    boundary = '----zfshare%s' % os.urandom(8).hex()
    fields = dict(ticket.get('form', {}))
    file_field = fields.pop('file_field', 'file')
    lines = []
    for k, v in fields.items():
        lines.append('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n' % (boundary, k, v))
    lines.append('--%s\r\nContent-Disposition: form-data; name="%s"; filename="%s"\r\nContent-Type: application/octet-stream\r\n\r\n' % (boundary, file_field, filename))

    def _gen():
        """流式构造 multipart，避免一次性把 100MB 读入内存"""
        yield ''.join(lines).encode('utf-8')
        with open(local_path, 'rb') as f:
            while True:
                chunk = f.read(1024 * 256)
                if not chunk:
                    break
                yield chunk
        yield ('\r\n--%s--\r\n' % boundary).encode('utf-8')

    req = urllib.request.Request(ticket['upload_url'], data=_gen(), method='POST')
    req.add_header('Content-Type', 'multipart/form-data; boundary=%s' % boundary)
    req.add_header('Content-Length', str(size))
    with urllib.request.urlopen(req, timeout=600) as resp:
        resp.read()
    return _request('?a=confirm&id=%s' % ticket.get('id', ''))


def download_project(pid, dest_dir=None):
    """下载项目到本地（默认 public/projects/<pid>/）"""
    det = project_detail(pid)
    if not det.get('ok'):
        raise RuntimeError(det.get('msg', '项目不存在'))
    url = det['data']['url']
    dest_dir = dest_dir or os.path.normpath(os.path.join(_BASE, '..', 'public', 'projects', str(pid)))
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, os.path.basename(urllib.parse.urlparse(url).path) or 'project.bin')
    with urllib.request.urlopen(url, timeout=60) as resp, open(dest, 'wb') as f:
        while True:
            chunk = resp.read(1024 * 256)
            if not chunk:
                break
            f.write(chunk)
    return det['data'] | {'local_path': dest}


def publish_url_index(url, title, summary, consent=False):
    """把网站总结发布到社区网址索引（必须用户同意）"""
    cfg = load_cfg()
    if not (consent or cfg.get('index_consent')):
        return {'ok': False, 'msg': '用户未授权发布网址索引'}
    body = urllib.parse.urlencode({
        'a': 'index_publish', 'url': url, 'title': title, 'summary': summary,
        'session': json.dumps(_login_session(), ensure_ascii=False)
    }).encode('utf-8')
    return _request('', data=body, method='POST')
