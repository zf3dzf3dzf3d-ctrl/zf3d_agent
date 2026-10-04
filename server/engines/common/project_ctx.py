# -*- coding: utf-8 -*-
"""阶段C步骤2：服务端按 chat.projectId（body._project_id）从 DB 解析项目根目录。

以服务端 DB 的 projects.folder_path 为权威源，覆盖前端传来的 _project_path，
防止前端在对话未绑项目时回退到全局活动项目造成多对话串项目。
"""
import logging
import os


def resolve_project_root_from_body(body):
    """按 body._project_id 查 DB 返回 (root, name)。

    命中时同步把 body['_project_path']/_project_name 覆盖为 DB 权威值；
    未传 _project_id 或查不到时返回 (body['_project_path'], None) 回退旧行为。
    永不抛异常（DB 异常时打日志回退）。
    """
    root = body.get('_project_path')
    name = None
    pid = str(body.get('_project_id') or '').strip()
    if pid:
        try:
            from db import get_db, _db_lock
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute('SELECT folder_path, name FROM projects WHERE id=?', (pid,))
                row = cur.fetchone()
                conn.close()
            if row and row['folder_path']:
                root = str(row['folder_path'])
                name = str(row['name'] or '')
                body['_project_path'] = root
                body['_project_name'] = name
        except Exception as e:
            logging.debug('resolve_project_root_from_body skip: %s' % e)
    return root, name


def resolve_race_worktree(body):
    """P1-2 施工队 cwd 强绑定：body._race_worktree 存在时强制接管工作目录。

    铁律（验收红线）：
    1. 立即清除 _project_id（防 DB 权威值把工作目录覆盖回主线项目）；
    2. _project_path 无条件强制覆盖为 worktree 目录；
    3. worktree 目录不存在时抛 RuntimeError（绝不走兜底链漂移回主线）。
    返回 worktree 路径；非施工队会话返回 None（零影响）。
    必须在 resolve_project_root_from_body 之前调用（否则会被 DB 权威覆盖吃掉）。
    """
    wt = str(body.get('_race_worktree') or '').strip()
    if not wt:
        return None
    if not os.path.isdir(wt):
        # 【验收红线】施工现场目录已消失（被清/被移）：必须报错，绝不允许静默兜底回主线
        raise RuntimeError('[race] 施工现场目录不存在（拒绝兜底回主线）: %s' % wt)
    # 防 DB 权威覆盖：清掉 _project_id，施工队会话不参与项目根解析
    try:
        body.pop('_project_id', None)
    except Exception:
        body['_project_id'] = ''
    body['_project_path'] = wt
    body['_race_worktree_bound'] = True
    return wt

