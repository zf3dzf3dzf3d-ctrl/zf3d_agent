# -*- coding: utf-8 -*-
"""HTTP 路由处理（聚合入口）。

原来 3000+ 行的 HandlerRoutes 已按业务拆分到 routes/ 包：
  mixin_proxy.py     - API 代理（转发第三方 AI 服务 / 流式 SSE / 系统提示词注入）
  mixin_static.py    - 静态文件 / 健康检查 / 版本 / 监控
  mixin_pixel.py     - 像素动画（display / GIF 导出）
  mixin_dispatch.py  - GET/POST/DELETE 路由分发
  mixin_project.py   - 项目文件夹 / 文件系统 / 项目记忆
  mixin_settings.py  - 各类配置 JSON 读写（健康守护 / 循环模式 / 用户设置等）
  mixin_db.py        - /api/db/* 数据库读写
  mixin_hotreload.py - 热更新 SSE / 状态 / 手动重载
  mixin_models.py    - 大模型配置 / 提示词生成
  mixin_backup.py    - 项目备份（zip 快照 / 恢复 / 删除）

扩展方式：新建 mixin_xxx.py（继承 MixinBase），在下方 HandlerRoutes 中追加基类即可。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from routes._shared import *  # noqa: F401,F403  保持原模块级符号对旧引用可见
from routes.mixin_base import MixinBase
from routes.mixin_core import MixinCore
from routes.mixin_proxy import MixinProxy
from routes.mixin_static import MixinStatic
from routes.mixin_pixel import MixinPixel
from routes.mixin_project import MixinProject
from routes.mixin_project_fs import MixinProjectFs
from routes.mixin_refboard import MixinRefboard
from routes.mixin_settings import MixinSettings
from routes.mixin_db import MixinDb
from routes.mixin_hotreload import MixinHotreload
from routes.mixin_models import MixinModels
from routes.mixin_backup import MixinBackup
from routes.mixin_media import MixinMedia
from routes.mixin_ext import MixinExt
from routes.api_dispatch_get import MixinDispatchGet
from routes.api_dispatch_post import MixinDispatchPost
from routes.api_dispatch_delete import MixinDispatchDelete
from routes.mixin_zf3d import Zf3dRoutesMixin
from routes.mixin_dispatch_pool import MixinDispatchPool
from routes.mixin_tasknotes import MixinTaskNotes


class HandlerRoutes(
    MixinDispatchGet,
    MixinDispatchPost,
    MixinDispatchDelete,
    MixinDispatchPool,
    MixinCore,
    MixinProxy,
    MixinStatic,
    MixinPixel,
    MixinProject,
    MixinProjectFs,
    MixinRefboard,
    MixinSettings,
    MixinDb,
    MixinHotreload,
    MixinModels,
    MixinBackup,
    MixinMedia,
    MixinExt,
    Zf3dRoutesMixin,
    MixinTaskNotes,
    MixinBase,
):
    """路由处理（由各 Mixin 组成）"""
    pass
