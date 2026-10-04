import json, os, threading, time, re

# 角色数据库文件路径
_ROLES_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           'private', 'roles_db.json')
_lock = threading.Lock()

# 【性能优化1】进程内缓存：避免每次请求都读磁盘。以文件 mtime 判断失效。
_cache = {'mtime': 0, 'data': None}


def _load():
    try:
        mtime = os.path.getmtime(_ROLES_PATH)
        # 缓存仍有效，直接返回
        if _cache['data'] is not None and _cache['mtime'] == mtime:
            return _cache['data']
        with open(_ROLES_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        _cache['data'] = data
        _cache['mtime'] = mtime
        return data
    except Exception:
        return {'roles': [], 'selected': {}}


def _save(data):
    # 【防呆校验】禁止用空角色列表覆盖已有角色数据（防止异常/初始化路径清空角色库）
    try:
        if os.path.exists(_ROLES_PATH):
            with open(_ROLES_PATH, 'r', encoding='utf-8') as f:
                old = json.load(f)
            old_n = len((old or {}).get('roles') or [])
            new_n = len((data or {}).get('roles') or [])
            if old_n > 0 and new_n == 0:
                raise ValueError('refuse to overwrite roles_db.json with empty roles list (had %d roles)' % old_n)
    except ValueError:
        raise
    except Exception:
        pass  # 旧文件读不出时放行（首次创建等场景）
    os.makedirs(os.path.dirname(_ROLES_PATH), exist_ok=True)
    try:
        if os.path.exists(_ROLES_PATH):
            with open(_ROLES_PATH + '.bak', 'w', encoding='utf-8') as f:
                with open(_ROLES_PATH, 'r', encoding='utf-8') as src:
                    f.write(src.read())
    except Exception:
        pass
    with open(_ROLES_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    # 同步缓存
    try:
        _cache['data'] = data
        _cache['mtime'] = os.path.getmtime(_ROLES_PATH)
    except Exception:
        pass


def list_roles():
    with _lock:
        rs = _load().get('roles', [])
        # 置顶优先，其次自定义 order，最后按名字（保证拖拽调序结果稳定展示）
        return sorted(rs, key=lambda r: (0 if r.get('top') else 1,
                                         r.get('order', 999999),
                                         str(r.get('name') or '')))


def get_role(role_id):
    for r in list_roles():
        if str(r.get('id')) == str(role_id):
            return r
    return None


def add_role(name, prompt, avatar='', chat_skin=''):
    with _lock:
        data = _load()
        role = {
            'id': 'r%d' % int(time.time() * 1000),
            'name': str(name or '未命名角色')[:60],
            'avatar': str(avatar or '🎭')[:8],
            'prompt': str(prompt or ''),
            'chat_skin': str(chat_skin or '')[:60],
            'created_at': time.strftime('%Y-%m-%d %H:%M:%S'),
            'updated_at': time.strftime('%Y-%m-%d %H:%M:%S'),
        }
        data.setdefault('roles', []).append(role)
        _save(data)
        return role


def update_role(role_id, name=None, prompt=None, avatar=None, chat_skin=None):
    with _lock:
        data = _load()
        for r in data.get('roles', []):
            if str(r.get('id')) == str(role_id):
                if name is not None:
                    r['name'] = str(name)[:60]
                if prompt is not None:
                    r['prompt'] = str(prompt)
                if avatar is not None:
                    r['avatar'] = str(avatar)[:8]
                if chat_skin is not None:
                    r['chat_skin'] = str(chat_skin)[:60]
                r['updated_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
                _save(data)
                return r
        return None


def delete_role(role_id):
    with _lock:
        data = _load()
        before = len(data.get('roles', []))
        data['roles'] = [r for r in data.get('roles', []) if str(r.get('id')) != str(role_id)]
        if len(data['roles']) < before:
            # 同步清理 selected 里的残留引用
            sel = data.get('selected') or {}
            data['selected'] = {k: v for k, v in sel.items() if str(v) != str(role_id)}
            _save(data)
            return True
        return False


def set_role_top(role_id, top):
    """置顶/取消置顶角色。"""
    with _lock:
        data = _load()
        for r in data.get('roles', []):
            if str(r.get('id')) == str(role_id):
                if top:
                    r['top'] = True
                else:
                    r.pop('top', None)
                r['updated_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
                _save(data)
                return True
        return False


def move_role(role_id, before_id):
    """拖拽排序角色：把 role_id 移到 before_id 之前；before_id 为空 = 移到末尾"""
    with _lock:
        data = _load()
        rs = sorted(data.get('roles', []), key=lambda r: (0 if r.get('top') else 1,
                                                          r.get('order', 999999),
                                                          str(r.get('name') or '')))
        src = [r for r in rs if str(r.get('id')) == str(role_id)]
        if not src:
            return False
        rs = [r for r in rs if str(r.get('id')) != str(role_id)]
        idx = len(rs)
        for i, r in enumerate(rs):
            if str(r.get('id')) == str(before_id):
                idx = i
                break
        rs.insert(idx, src[0])
        for i, r in enumerate(rs):
            r['order'] = i + 1
        data['roles'] = rs
        _save(data)
        return True


def select_role(box_id, role_id):
    """为对话选中角色；role_id 为空 = 取消选中。"""
    with _lock:
        data = _load()
        if role_id:
            data.setdefault('selected', {})[str(box_id)] = str(role_id)
        else:
            (data.setdefault('selected', {})).pop(str(box_id), None)
        _save(data)
        return True


def get_selected_role(box_id):
    with _lock:
        data = _load()
        rid = (data.get('selected') or {}).get(str(box_id))
        if not rid:
            return None
        for r in data.get('roles', []):
            if str(r.get('id')) == str(rid):
                return r
        return None


def get_last_selected_role():
    """【新增】取全局最近一次被选中的角色（供新建对话默认绑定用）。
    遍历 selected 字典，找出现顺序中最后一个有效选择。"""
    with _lock:
        data = _load()
        sel = data.get('selected') or {}
        # dict 在 py3.7+ 保持插入序，取最后一个非空选择
        rid = None
        for v in sel.values():
            if v:
                rid = v
        if not rid:
            return None
        for r in data.get('roles', []):
            if str(r.get('id')) == str(rid):
                return r
        return None


def get_selected_map():
    """返回 {box_id: role_id} 的对话框绑定映射（场景中已绑定角色的对话）。"""
    with _lock:
        return dict(_load().get('selected') or {})


def get_groups():
    """角色分组列表（按 order 排序）"""
    with _lock:
        gs = _load().get('role_groups') or []
        if isinstance(gs, str):
            try:
                import json as _json
                gs = _json.loads(gs)
            except Exception:
                gs = []
        gs = [g for g in gs if isinstance(g, dict)]
        return sorted(gs, key=lambda g: g.get('order', 0))


def _next_group_order(data):
    mx = 0
    for g in data.get('role_groups', []):
        mx = max(mx, g.get('order', 0))
    return mx + 1


def add_group(name):
    with _lock:
        data = _load()
        g = {'id': 'g%d' % int(time.time() * 1000),
             'name': str(name or '新建组')[:40],
             'order': _next_group_order(data)}
        data.setdefault('role_groups', []).append(g)
        _save(data)
        return g


def rename_group(group_id, name):
    with _lock:
        data = _load()
        for g in data.get('role_groups', []):
            if str(g.get('id')) == str(group_id):
                g['name'] = str(name or g['name'])[:40]
                _save(data)
                return g
        return None


def delete_group(group_id):
    """删除分组（组内角色变为未分组，不删角色）"""
    with _lock:
        data = _load()
        before = len(data.get('role_groups', []))
        data['role_groups'] = [g for g in data.get('role_groups', []) if str(g.get('id')) != str(group_id)]
        if len(data['role_groups']) < before:
            for r in data.get('roles', []):
                if str(r.get('group')) == str(group_id):
                    r.pop('group', None)
            _save(data)
            return True
        return False


def assign_role_group(role_id, group_id):
    """把角色移入分组；group_id 为空 = 移出分组"""
    with _lock:
        data = _load()
        for r in data.get('roles', []):
            if str(r.get('id')) == str(role_id):
                if group_id:
                    r['group'] = str(group_id)
                else:
                    r.pop('group', None)
                _save(data)
                return True
        return False


def move_group(group_id, before_id):
    """拖拽排序分组：把 group_id 移到 before_id 之前；before_id 为空 = 移到末尾"""
    with _lock:
        data = _load()
        gs = sorted(data.get('role_groups', []), key=lambda g: g.get('order', 0))
        src = [g for g in gs if str(g.get('id')) == str(group_id)]
        if not src:
            return False
        gs = [g for g in gs if str(g.get('id')) != str(group_id)]
        idx = len(gs)
        for i, g in enumerate(gs):
            if str(g.get('id')) == str(before_id):
                idx = i
                break
        gs.insert(idx, src[0])
        for i, g in enumerate(gs):
            g['order'] = i + 1
        data['role_groups'] = gs
        _save(data)
        return True


def inject_role_into_payload(payload, box_id):
    """按对话 box_id 注入所选角色的 system 提示词到 payload.messages。
    无选中角色/角色无 prompt/异常时静默跳过（不阻断请求）。"""
    try:
        if not isinstance(payload, dict) or not box_id:
            return
        role = get_selected_role(box_id)
        if not role:
            return
        prompt = (role.get('prompt') or '').strip()
        if not prompt:
            return
        msgs = payload.get('messages')
        if not isinstance(msgs, list):
            payload['messages'] = msgs = []
        sys_msg = {'role': 'system', 'content': '[角色扮演] %s：%s' % (role.get('name') or '', prompt)}
        # 已有注入标记则替换并置顶，移除其余旧标记条目，避免重复叠加
        found = False
        for i, m in enumerate(msgs):
            if isinstance(m, dict) and m.get('role') == 'system' and str(m.get('content', '')).startswith('[角色扮演]'):
                if not found:
                    msgs[i] = sys_msg
                    found = True
                else:
                    msgs[i] = None  # 多余旧标记，稍后移除
        if found:
            msgs[:] = [m for m in msgs if m is not None]
            try:
                msgs.remove(sys_msg)
            except ValueError:
                pass
        msgs.insert(0, sys_msg)
    except Exception:
        pass
