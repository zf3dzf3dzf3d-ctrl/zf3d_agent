#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
analyze_project - 项目分析工具
扫描项目目录结构，生成结构化 JSON + mermaid 流程图，
并把结果写入共享上下文池（shared_context 类别，全局共享），
供后续所有节点/对话通过 read_shared_context 读取。
"""
import os
import re
import json
import time
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'analyze_project'
CATEGORY = 'analyze_project'

SKIP_DIRS = {
    'node_modules', '.git', '__pycache__', '.svn', 'dist', 'build',
    '.idea', '.vscode', '.vs', 'bin', 'obj', '.next', '.nuxt',
    'venv', '.venv', 'env', '.pytest_cache', '.mypy_cache', 'coverage',
    'site-packages',
}
TEXT_EXTS = {
    '.py', '.js', '.ts', '.jsx', '.tsx', '.json', '.html', '.htm', '.css',
    '.scss', '.less', '.vue', '.md', '.txt', '.yml', '.yaml', '.xml',
    '.asp', '.asa', '.cs', '.java', '.go', '.rs', '.php', '.sql', '.sh',
    '.bat', '.ps1', '.ini', '.cfg', '.conf', '.toml', '.env', '.svg',
}
MAX_FILES = 5000          # 最多扫描文件数
MAX_FILE_BYTES = 512000   # 单文件读取上限


def _safe_root(ctx, root):
    """限制在项目根目录内，防目录穿越"""
    base = getattr(ctx, 'project_dir', None) or os.getcwd()
    root = os.path.abspath(os.path.join(base, root or '.'))
    if not root.startswith(os.path.abspath(base)):
        return None
    return root if os.path.isdir(root) else None


def _walk(root, max_depth):
    """收集文件树（带深度限制）"""
    files = []
    total = 0
    for dirpath, dirnames, filenames in os.walk(root):
        rel = os.path.relpath(dirpath, root)
        depth = 0 if rel == '.' else rel.count(os.sep) + 1
        dirnames[:] = [d for d in dirnames
                       if d not in SKIP_DIRS and not d.startswith('.')]
        if depth >= max_depth:
            dirnames[:] = []
        for fn in sorted(filenames):
            total += 1
            if len(files) < MAX_FILES:
                ext = os.path.splitext(fn)[1].lower()
                files.append({
                    'path': os.path.normpath(os.path.join(rel, fn)).replace('\\', '/'),
                    'ext': ext,
                    'size': 0,
                })
        if total >= MAX_FILES * 3:
            break
    return files, total


def _collect_entry_points(root, files):
    """识别入口/配置文件，用于生成流程图主干"""
    entry_names = {
        'main.py', 'app.py', 'server.py', 'manage.py', 'run.py',
        'index.js', 'main.js', 'server.js', 'app.js',
        'index.html', 'package.json', 'requirements.txt',
        'web.config', 'docker-compose.yml', 'dockerfile',
    }
    entries = [f['path'] for f in files if os.path.basename(f['path']).lower() in entry_names]
    return entries[:30]


def _collect_routes(root, files):
    """从源码中粗提取路由/接口路径，帮助生成调用流程"""
    routes = []
    route_pat = re.compile(
        r"""@app\.route\(\s*['"]([^'"]+)['"]|
            @router\.(?:get|post|put|delete|route)\(\s*['"]([^'"]+)['"]|
            app\.(?:get|post|put|delete)\(\s*['"]([^'"]+)['"]|
            (?:doAction|action)\s*===?\s*['"]([\w\-]+)['"]
        """,
        re.IGNORECASE | re.VERBOSE)
    scanned = 0
    for f in files:
        if f['ext'] not in TEXT_EXTS or scanned >= 300:
            continue
        fp = os.path.join(root, f['path'])
        try:
            if os.path.getsize(fp) > MAX_FILE_BYTES:
                continue
            with open(fp, 'r', encoding='utf-8', errors='ignore') as fh:
                text = fh.read(MAX_FILE_BYTES)
        except OSError:
            continue
        scanned += 1
        for m in route_pat.finditer(text):
            r = next((g for g in m.groups() if g), None)
            if r and len(routes) < 100:
                routes.append({'file': f['path'], 'route': r})
    return routes


def _build_mermaid(data):
    """根据分析数据生成 mermaid flowchart"""
    lines = ['flowchart TD']
    entries = data['entry_points'][:8]
    routes = data['routes'][:20]
    top_dirs = data['top_dirs'][:6]

    # 顶层目录节点
    for i, d in enumerate(top_dirs):
        lines.append(f'    D{i}["📁 {d["name"]} ({d["files"]}文件)"]')
    if top_dirs:
        lines.append('    ROOT["项目根"]')
        for i in range(len(top_dirs)):
            lines.append(f'    ROOT --> D{i}')

    # 入口文件节点
    for i, e in enumerate(entries):
        name = os.path.basename(e)
        lines.append(f'    E{i}["🚀 {name}<br/>{e}"]')
        # 挂到最相近的顶层目录
        top = e.split('/')[0]
        for j, d in enumerate(top_dirs):
            if d['name'] == top:
                lines.append(f'    D{j} --> E{i}')
                break

    # 路由节点（按文件分组）
    by_file = {}
    for r in routes:
        by_file.setdefault(r['file'], []).append(r['route'])
    for i, (fp, rs) in enumerate(list(by_file.items())[:10]):
        fname = os.path.basename(fp)
        rid = f'R{i}'
        lines.append(f'    {rid}["⚡ {fname}"]')
        for j, r in enumerate(rs[:6]):
            lines.append(f'    {rid} --> M{i}_{j}["{r}"]')
        # 挂到入口
        for k, e in enumerate(entries):
            if e.split('/')[-1] == fname:
                lines.append(f'    E{k} --> {rid}')
                break
    if len(lines) == 1:
        lines.append('    EMPTY["（未发现可分析内容）"]')
    return '\n'.join(lines)


def _save_shared(conn, chat_id, data, mermaid):
    """写入共享上下文池（app_data 表），所有对话/节点可读"""
    now = int(time.time() * 1000)
    payload = {
        'root': data['root'],
        'analyzed_at': now,
        'summary': {
            'total_files': data['total_files'],
            'scanned_files': data['scanned_files'],
            'entry_points': data['entry_points'],
            'top_dirs': data['top_dirs'],
        },
        'mermaid': mermaid,
        'files': data['files'],
        'routes': data['routes'],
    }
    key = 'project_analysis'
    value = json.dumps(payload, ensure_ascii=False)
    row = conn.execute(
        'SELECT id FROM app_data WHERE category=? AND key=?',
        [CATEGORY, key]).fetchone()
    if row:
        conn.execute(
            'UPDATE app_data SET value=?, updated_at=? WHERE category=? AND key=?',
            [value, now, CATEGORY, key])
    else:
        conn.execute(
            'INSERT INTO app_data (category, key, value, created_at, updated_at) VALUES (?,?,?,?,?)',
            [CATEGORY, key, value, now, now])
    conn.commit()


def _get_conn(ctx):
    """在 db_lock 保护下获取数据库连接（返回 None 表示失败，调用方需自行关闭）"""
    with ctx.db_lock:
        conn = ctx.get_db()
    return conn


def handle(body, ctx):
    try:
        action = body.get('action', 'analyze')

        if action == 'analyze':
            root = _safe_root(ctx, body.get('root') or '.')
            if not root:
                return ctx.send_json({'ok': False, 'error': '目录不存在或越出项目根'})
            max_depth = min(int(body.get('max_depth') or 6), 10)
            files, total = _walk(root, max_depth)
            entries = _collect_entry_points(root, files)
            routes = _collect_routes(root, files)

            # 顶层目录统计
            dir_stat = {}
            for f in files:
                top = f['path'].split('/')[0]
                if top == f['path']:
                    top = '.'
                s = dir_stat.setdefault(top, {'name': top, 'files': 0, 'exts': {}})
                s['files'] += 1
                s['exts'][f['ext'] or '.'] = s['exts'].get(f['ext'] or '.', 0) + 1
            top_dirs = sorted(dir_stat.values(),
                              key=lambda d: -d['files'])[:15]

            data = {
                'root': root,
                'total_files': total,
                'scanned_files': len(files),
                'entry_points': entries,
                'top_dirs': top_dirs,
                'files': files,
                'routes': routes,
            }
            mermaid = _build_mermaid(data)

            conn = _get_conn(ctx)
            try:
                _save_shared(conn, body.get('_chat_id', ''), data, mermaid)
            finally:
                conn.close()

            # 返回给模型的摘要（files 明细太长，只给前 200 条）
            return ctx.send_json({
                'ok': True,
                'root': root,
                'total_files': total,
                'scanned_files': len(files),
                'entry_points': entries,
                'top_dirs': [{k: v for k, v in d.items() if k != 'exts'} for d in top_dirs],
                'routes_found': len(routes),
                'mermaid': mermaid,
                'saved_to': 'shared_context 池（key=project_analysis）',
                'files_sample': [f['path'] for f in files[:200]],
                'hint': '完整分析已存入共享上下文池，任何节点/对话可用 read_shared_context 读取。',
            })

        elif action == 'status':
            # 只查是否已有分析结果
            conn = _get_conn(ctx)
            try:
                row = conn.execute(
                    "SELECT value FROM app_data WHERE category='analyze_project' AND key='project_analysis'"
                ).fetchone()
            finally:
                conn.close()
            if not row:
                return ctx.send_json({'ok': True, 'exists': False})
            try:
                v = json.loads(row['value'])
                return ctx.send_json({
                    'ok': True, 'exists': True,
                    'root': v.get('root'),
                    'analyzed_at': v.get('analyzed_at'),
                    'summary': v.get('summary'),
                })
            except Exception:
                return ctx.send_json({'ok': True, 'exists': False})

        else:
            return ctx.send_json({'ok': False, 'error': f'未知 action: {action}'})
    except Exception as e:
        return ctx.send_json({'ok': False, 'error': str(e)})
