# -*- coding: utf-8 -*-
import ast, py_compile, sys
P = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\server\routes\mixin_project_fs.py'
py_compile.compile(P, doraise=True)
print('COMPILE_OK')
sys.path.insert(0, r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\server')
from routes.mixin_project_fs import MixinProjectFs, start_thumb_warmup
print('hasattr_thumb=', hasattr(MixinProjectFs, '_handle_fs_thumb'))
print('hasattr_text=', hasattr(MixinProjectFs, '_handle_fs_text'))
