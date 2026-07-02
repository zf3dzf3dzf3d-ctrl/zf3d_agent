# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['打包入口.py'],
    pathex=[],
    binaries=[],
    datas=[('公共区', '公共区'), ('public', 'public'), ('引擎管理', '引擎管理'), ('启动.bat', '启动.bat'), ('说明.md', '说明.md')],
    hiddenimports=['PIL', 'PIL.ImageGrab', 'psutil', 'docx', 'docx.shared', 'docx.enum.text', 'docx.oxml.ns', 'openpyxl', 'olefile', 'edge_tts', 'pygame', 'win32com', 'win32com.client', 'sqlite3', '_sqlite3'],
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
    name='朱峰社区智能体',
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
    icon=['C:\\Users\\Administrator\\Desktop\\zf3d_Agent\\新系统_v2_开发版\\公共区\\界面\\favicon.png'],
)
