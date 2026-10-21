# -*- coding: utf-8 -*-
"""zf_daemon_install.py - 智能体OS守护化安装器（智能体OS·阶段B）

用 Windows 计划任务（schtasks /SC ONSTART）实现开机常驻，零第三方依赖。
- 注册：python zf_daemon_install.py install   （需管理员权限运行一次）
- 注销：python zf_daemon_install.py uninstall
- 状态：python zf_daemon_install.py status

说明：
- ONSTART 任务以 SYSTEM 身份开机启动 server 启动脚本（不弹窗、不依赖用户登录）
- 默认不实际执行 install（安全考虑），需人工在管理员终端运行
"""
import os
import sys
import subprocess

_TASK_NAME = 'ZFZhufengAgentOS'
_HERE = os.path.dirname(os.path.abspath(__file__))
_SERVER = os.path.dirname(os.path.dirname(_HERE))  # engines/common -> engines -> server
_PY = sys.executable
# 启动目标：统一经 tray_server 拉起（项目确立的入口原则；开机任务用绝对路径，工作目录与交互环境不同）
_LAUNCHER = os.path.join(_SERVER, 'tray_server.py')


def _run(cmd):
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=30,
                           creationflags=0x08000000)
        out = (p.stdout or b'').decode('gbk', 'replace') + (p.stderr or b'').decode('gbk', 'replace')
        return p.returncode, out.strip()
    except Exception as e:
        return 1, str(e)


def install():
    if not os.path.exists(_LAUNCHER):
        return 1, '启动脚本不存在: %s（请先修改 _LAUNCHER）' % _LAUNCHER
    cmd = ['schtasks', '/Create', '/F', '/TN', _TASK_NAME,
           '/SC', 'ONSTART', '/RU', 'SYSTEM',
           '/TR', '"%s" "%s"' % (_PY, _LAUNCHER)]
    return _run(cmd)


def uninstall():
    return _run(['schtasks', '/Delete', '/F', '/TN', _TASK_NAME])


def status():
    return _run(['schtasks', '/Query', '/TN', _TASK_NAME])


if __name__ == '__main__':
    act = (sys.argv[1] if len(sys.argv) > 1 else 'status').lower()
    fn = {'install': install, 'uninstall': uninstall, 'status': status}.get(act)
    if not fn:
        print('用法: python zf_daemon_install.py [install|uninstall|status]')
        sys.exit(1)
    rc, out = fn()
    print(('rc=%d\n' % rc) + out)
