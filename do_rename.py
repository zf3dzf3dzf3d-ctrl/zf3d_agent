# -*- coding: utf-8 -*-
"""按内容语义重命名拼凑文件，并同步更新所有引用。"""
import os, shutil

# 1) 纯重命名映射
renames = {
 # 前端根目录 js/inline-NN.js（index.html 逐一引用，内容已核对）
 'public/js/inline-00.js': 'public/js/inline-boot-hide.js',
 'public/js/inline-01.js': 'public/js/inline-lazy-scripts.js',
 'public/js/inline-02.js': 'public/js/inline-theme-panel-resize.js',
 'public/js/inline-03.js': 'public/js/inline-settings-lazy-mount.js',
 'public/js/inline-04.js': 'public/js/inline-model-panel-mount.js',
 'public/js/inline-05.js': 'public/js/inline-edge-bars.js',
 'public/js/inline-06.js': 'public/js/inline-clock-weather.js',
 'public/js/inline-07.js': 'public/js/inline-settings-nav-resize.js',
 'public/js/inline-08.js': 'public/js/inline-turbo-mode.js',
 'public/js/inline-09.js': 'public/js/inline-page-health.js',
 # css/inline/ 子目录（旧副本，无引用）
 'public/css/inline/inline-01.css': 'public/css/inline/inline-boot-anim.css',
 'public/css/inline/inline-02.css': 'public/css/inline/inline-crisp-text.css',
 'public/css/inline/inline-03.css': 'public/css/inline/inline-no-glass.css',
 # js/inline/ 子目录（旧副本，无引用）
 'public/js/inline/inline-01.js': 'public/js/inline/inline-boot-hide.js',
 'public/js/inline/inline-02.js': 'public/js/inline/inline-model-panel-mount.js',
 'public/js/inline/inline-03.js': 'public/js/inline/inline-edge-bars.js',
 'public/js/inline/inline-04.js': 'public/js/inline/inline-settings-nav-resize.js',
 'public/js/inline/inline-05.js': 'public/js/inline/inline-turbo-mode.js',
 # 服务端分段模块（门面 _SEGMENTS 引用，语义按已读取的函数清单定名）
 'server/brain/main_brain_seg1.py': 'server/brain/main_brain_local_collect.py',
 'server/brain/main_brain_seg2.py': 'server/brain/main_brain_llm_tools.py',
 'server/brain/main_brain_seg3.py': 'server/brain/main_brain_state_loop.py',
 'server/dispatch_swarm_seg1.py': 'server/dispatch_swarm_infra.py',
 'server/dispatch_swarm_seg2.py': 'server/dispatch_swarm_tasks.py',
 'server/screen_recorder_seg1.py': 'server/screen_recorder_session.py',
 'server/screen_recorder_seg2.py': 'server/screen_recorder_core.py',
 'server/screen_recorder_seg3.py': 'server/screen_recorder_di.py',
}
for src, dst in renames.items():
    if os.path.exists(src):
        os.rename(src, dst)
        print('renamed:', src, '->', dst)
    else:
        print('MISSING:', src)

# 2) 引用同步更新
def patch(path, pairs):
    t = open(path, encoding='utf-8', errors='replace').read()
    orig = t
    for old, new in pairs:
        t = t.replace(old, new)
    if t != orig:
        open(path, 'w', encoding='utf-8', newline='').write(t)
        print('patched:', path)
    else:
        print('no-change:', path)

patch('public/index.html', [(f'js/inline-{i:02d}.js', f'js/{dst}') for i, dst in enumerate([
 'inline-boot-hide.js','inline-lazy-scripts.js','inline-theme-panel-resize.js','inline-settings-lazy-mount.js',
 'inline-model-panel-mount.js','inline-edge-bars.js','inline-clock-weather.js','inline-settings-nav-resize.js',
 'inline-turbo-mode.js','inline-page-health.js'])])

patch('public/js/panel-settings-drag.js', [('避免 inline-04 的', '避免 inline-model-panel-mount 的')])

patch('server/brain/main_brain.py', [
 ('main_brain_seg1.py', 'main_brain_local_collect.py'),
 ("'main_brain_seg1'", "'main_brain_local_collect'"),
 ("'main_brain_seg2'", "'main_brain_llm_tools'"),
 ("'main_brain_seg3'", "'main_brain_state_loop'"),
])
patch('server/dispatch_swarm.py', [
 ('dispatch_swarm_seg1.py', 'dispatch_swarm_infra.py'),
 ("'dispatch_swarm_seg1'", "'dispatch_swarm_infra'"),
 ("'dispatch_swarm_seg2'", "'dispatch_swarm_tasks'"),
])
patch('server/screen_recorder.py', [
 ('screen_recorder_seg1', 'screen_recorder_session'),
 ("'screen_recorder_seg1'", "'screen_recorder_session'"),
 ("'screen_recorder_seg2'", "'screen_recorder_core'"),
 ("'screen_recorder_seg3'", "'screen_recorder_di'"),
])
print('DONE')
