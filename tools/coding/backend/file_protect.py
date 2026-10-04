#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""file_protect - 文件保护清单管理（readonly 只读 / critical 关键）

用法：
  action=list                                     查看清单
  action=add      path=... level=critical|readonly 加入保护
  action=remove   path=...                         移出保护
  action=level    path=...                         查询单文件级别
  action=anchors  path=... names=a,b,c             登记关键定义锚点
  action=init                                       写入默认清单
  action=rollback  path=...                        从快照恢复关键文件

级别语义：
  readonly  坚决不可动，连写都不发生；shell 改写/删除同样硬拦
  critical  可以改，但必须过多重验证（写前内容检查 + 写后回读比对），
           失败即拒绝并自动回滚，不会留下半坏文件
"""
import os
from tools.coding.backend.base import ToolContext
from tools.coding.backend import _file_protect as fp

TOOL_NAME = 'file_protect'


def handle(body, ctx):
    action = str(body.get('action') or 'list').strip().lower()
    try:
        if action == 'list':
            data = fp.list_all()
            data['ok'] = True
            ctx.send_json(data)
            return

        if action == 'init':
            ctx.send_json({'ok': True, 'result': fp.init_default(), 'list': fp.list_all()})
            return

        if action in ('add', 'level', 'remove', 'anchors', 'rollback'):
            path = body.get('path') or body.get('paths')
            if isinstance(path, list):
                path = path[0] if path else ''
            path = str(path or '').strip()
            if not path:
                ctx.send_error('path is required')
                return
            # 相对路径按项目根解析
            if not os.path.isabs(path):
                path = os.path.join(fp.PROJECT_ROOT, path)
            path = os.path.normpath(path)

            if action == 'add':
                level = str(body.get('level') or 'critical').strip().lower()
                ctx.send_json({'ok': True, 'result': fp.add(path, level)})
                return

            if action == 'level':
                lvl = fp.level_of(path)
                ctx.send_json({'ok': True, 'path': path, 'level': lvl,
                               'protected': lvl is not None})
                return

            if action == 'remove':
                # 兼容绝对/相对两种写法：两种形态都试删
                rel = os.path.relpath(path, fp.PROJECT_ROOT).replace('\\', '/')
                removed = fp.remove(path)
                if not removed.get('removed'):
                    removed = fp.remove(rel)
                ctx.send_json({'ok': True, 'result': removed})
                return

            if action == 'anchors':
                names = body.get('names') or body.get('anchors')
                ctx.send_json({'ok': True, 'result': fp.set_anchors(path, names)})
                return

            if action == 'rollback':
                res = fp.rollback(path)
                ctx.send_json({'ok': bool(res.get('ok')), 'result': res})
                return

        ctx.send_error('unknown action: %s' % action)
    except Exception as exc:
        ctx.send_error(str(exc))
