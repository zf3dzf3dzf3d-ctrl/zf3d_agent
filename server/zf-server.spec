# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules

hiddenimports = ['playwright']
hiddenimports += collect_submodules('routes')
hiddenimports += collect_submodules('brain')
hiddenimports += collect_submodules('engines')
hiddenimports += collect_submodules('browser_plugin')


a = Analysis(
    ['server.py'],
    pathex=[],
    binaries=[],
    datas=[('brain/main_brain_seg1.py', 'brain'), ('brain/main_brain_seg2.py', 'brain'), ('brain/main_brain_seg3.py', 'brain'), ('browser_plugin/engine_seg1.py', 'browser_plugin'), ('browser_plugin/engine_seg2.py', 'browser_plugin'), ('browser_plugin/engine_seg3.py', 'browser_plugin'), ('browser_plugin/engine_seg4.py', 'browser_plugin'), ('dispatch_swarm_seg1.py', '.'), ('dispatch_swarm_seg2.py', '.'), ('engines/common/agent_loop_seg1.py', 'engines/common'), ('engines/common/agent_loop_seg2.py', 'engines/common'), ('screen_recorder_seg1.py', '.'), ('screen_recorder_seg2.py', '.'), ('screen_recorder_seg3.py', '.'), ('screen_recorder_transcode.py', '.')],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='zf-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
