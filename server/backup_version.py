#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
备用版本拉起/修复模块 - backup_version
当本版本(5.1.2)断网修复不了时（连续自动重启失败或断网持续超过 2 倍阈值），
自动拉起一个"朱峰社区智能体"的其他版本作为备用后台，并尝试自动修复本版本。

自动发现备用版本的规则：
  1. 读取 private/backup_version.json 中的 manual_backup_dir（优先，用户手工指定）
  2. 扫描上级目录中所有 朱峰社区智能体无限_* 的兄弟版本目录，
     要求：存在 server/server.py + 自带 python/python.exe，端口 != 本版本端口
     按"版本目录名字典序最大优先"排序（即优先拉起最新的其他版本）。

自动修复本版本：
  - 用本版本自带的 python 重新执行 restart_server.py（等价于一次完整重启修复）
  - 若本版本 server.py 无法启动，则持续由备用版本提供服务（备用版本不会被杀）
"""
import os
import sys
import json
import time
import glob
import subprocess
import urllib.request

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 本版本根目录
PARENT_DIR = os.path.dirname(BASE_DIR)
CFG_PATH = os.path.join(BASE_DIR, 'private', 'backup_version.json')
LOG_FILE = os.path.join(BASE_DIR, 'private', 'backup_version.log')

SIBLING_PATTERN = '朱峰社区智能体无限_*'


def log(msg):
    ts = time.strftime('%Y-%m-%d %H:%M:%S')
    line = '[%s][BackupVersion] %s' % (ts, msg)
    print(line)
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass


def load_cfg():
    try:
        with open(CFG_PATH, 'r', encoding='utf-8-sig') as f:
            return json.load(f)
    except Exception:
        return {}


def _get_port_of(base):
    """读取某版本根目录的端口（private/port.json -> api_port）"""
    pj = os.path.join(base, 'private', 'port.json')
    try:
        with open(pj, 'r', encoding='utf-8-sig') as f:
            return int(json.load(f).get('api_port'))
    except Exception:
        return None


def find_backup_versions():
    """返回可用的备用版本列表 [{dir, name, port, py}]，按名字倒序（新版本优先）"""
    cfg = load_cfg()
    my_port = _get_port_of(BASE_DIR) or 8505

    candidates = []
    manual = cfg.get('manual_backup_dir', '')
    if manual and os.path.isdir(os.path.join(manual, 'server')):
        candidates.append(manual)

    for d in sorted(glob.glob(os.path.join(PARENT_DIR, SIBLING_PATTERN)), reverse=True):
        d = os.path.normpath(d)
        if os.path.normcase(d) == os.path.normcase(BASE_DIR):
            continue
        if d not in candidates and os.path.isdir(os.path.join(d, 'server')):
            candidates.append(d)

    result = []
    for d in candidates:
        py = os.path.join(d, 'python', 'python.exe')
        if not os.path.isfile(py):
            continue  # 要求备用版本自带 python，避免依赖系统环境
        port = _get_port_of(d)
        if port is None or port == my_port:
            continue
        result.append({'dir': d, 'name': os.path.basename(d), 'port': port, 'py': py})
    return result


def is_alive(port, timeout=3):
    """检查某端口后台是否健康"""
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d/api/health' % port, timeout=timeout):
            return True
    except Exception:
        return False


def launch_backup(backup=None):
    """拉起备用版本后台。返回备用信息 dict 或 None。"""
    backups = [backup] if backup else find_backup_versions()
    for b in backups:
        try:
            if is_alive(b['port']):
                log('备用版本 %s 已在运行 (port=%d)，直接使用' % (b['name'], b['port']))
                return b
            log('拉起备用版本 %s (port=%d): %s' % (b['name'], b['port'], b['dir']))
            subprocess.Popen(
                [b['py'], os.path.join(b['dir'], 'server', 'server.py')],
                cwd=os.path.join(b['dir'], 'server'),
                creationflags=subprocess.CREATE_NEW_CONSOLE if sys.platform == 'win32' else 0,
            )
            # 等待就绪，最多 60 秒
            for _ in range(30):
                time.sleep(2)
                if is_alive(b['port']):
                    log('✅ 备用版本 %s 已就绪 (port=%d)' % (b['name'], b['port']))
                    return b
            log('⚠️ 备用版本 %s 启动后未就绪' % b['name'])
        except Exception as e:
            log('拉起备用版本 %s 失败: %s' % (b.get('name', '?'), e))
    return None


REPAIR_REQUEST_FILE = 'repair_request.json'


def write_repair_request(backup, reason=''):
    """把本版本的错误诊断报告写进备用版本的 private/ 目录，
    备用版本的智能体即可读取该文件，了解本版本出了什么问题并着手修复。"""
    if not backup:
        return None
    try:
        # 收集本版本最近的错误信息
        err_summary = []
        for lf in (os.path.join(BASE_DIR, 'private', 'backup_version.log'),
                   os.path.join(BASE_DIR, 'private', 'server.log'),
                   os.path.join(BASE_DIR, 'server', 'server.log')):
            try:
                with open(lf, 'r', encoding='utf-8-sig', errors='ignore') as f:
                    err_summary.append('--- %s (最后50行) ---\n%s' %
                                       (os.path.basename(lf), '\n'.join(f.readlines()[-50:])))
            except Exception:
                pass
        guard_state = {}
        try:
            with open(os.path.join(BASE_DIR, 'private', 'network_guard_state.json'), 'r', encoding='utf-8') as f:
                guard_state = json.load(f)
        except Exception:
            pass

        report = {
            'type': 'repair_request',
            'from_version': os.path.basename(BASE_DIR),
            'from_dir': BASE_DIR,
            'from_port': _get_port_of(BASE_DIR),
            'created_at': time.strftime('%Y-%m-%d %H:%M:%S'),
            'reason': reason or '断网自救失败（连续自动重启失败或断网持续超2倍阈值）',
            'network_guard_state': guard_state,
            'recent_logs': '\n'.join(err_summary) or '(未找到日志)',
            'how_to_help': (
                '1. 读取上方 recent_logs 定位故障原因（多为上游网络/代理配置问题或 server.py 启动失败）；\n'
                '2. 如可修复配置文件（private/ 目录），直接修改 from_dir 下对应文件；\n'
                '3. 修复后用 from_dir 自带的 python 执行其 server/restart_server.py 重启本版本；\n'
                '4. 通过 http://127.0.0.1:{port}/api/health 确认恢复后，本修复请求可删除。'
            ).format(port=_get_port_of(BASE_DIR)),
        }
        dst = os.path.join(backup['dir'], 'private', REPAIR_REQUEST_FILE)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        log('已把修复请求写入备用版本: %s' % dst)
        return dst
    except Exception as e:
        log('写入修复请求失败: %s' % e)
        return None


def repair_self():
    """尝试自动修复本版本：调用本版本 restart_server.py 完整重启。"""
    try:
        script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'restart_server.py')
        py = sys.executable
        log('开始自动修复本版本 (restart_server.py)')
        r = subprocess.run([py, script], cwd=os.path.dirname(script),
                           capture_output=True, timeout=180, text=True)
        ok = (r.returncode == 0)
        log('自动修复本版本结果: %s' % ('成功' if ok else '失败 code=%s' % r.returncode))
        return ok
    except Exception as e:
        log('自动修复本版本异常: %s' % e)
        return False


def escalate():
    """升级流程入口：断网自救失败时调用。
    1. 拉起备用版本（保证服务不中断）
    2. 尝试自动修复本版本
    3. 修复成功后备用版本保留运行（不杀），由用户自行决定去留
    """
    log('===== 触发升级流程：本版本自救失败，开始拉起备用版本 + 自动修复 =====')
    backup = launch_backup()
    if backup:
        log('备用版本可用: %s，前端可访问 http://127.0.0.1:%d' % (backup['name'], backup['port']))
        write_repair_request(backup)
    else:
        log('❌ 未找到可用的备用版本（需要有 server/server.py + python/python.exe 且端口不同）')
    ok = repair_self()
    log('===== 升级流程结束 (本版本修复:%s, 备用:%s) =====' %
        ('成功' if ok else '失败', backup['name'] if backup else '无'))
    return {'backup': backup, 'repaired': ok}


if __name__ == '__main__':
    escalate()

