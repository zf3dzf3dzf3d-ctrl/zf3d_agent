# -*- coding: utf-8 -*-
"""Mixin: 在线升级器/一键重启/备用版本/网络守护/修复请求（由 mixin_settings.py 拆出，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinSettingsUpdater(MixinBase):
    # ==================== 在线升级器 (updater.py) ====================
    def _handle_updater_check(self):
        """GET /api/updater/check — 检查远程是否有新版本"""
        try:
            import updater
            self._send_json(updater.check_update())
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_updater_check_post(self):
        self._handle_updater_check()

    def _handle_updater_apply(self):
        """POST /api/updater/apply — 手动执行升级（git 拉取+重启）"""
        try:
            import updater
            self._send_json({'ok': True, 'message': '升级开始，请等待几秒后刷新页面'})
            # 延迟执行，先让响应送达浏览器；升级脚本会在新线程中完成并重启服务
            def _do():
                import time as _t
                _t.sleep(1.0)
                updater.apply_update()
            threading.Thread(target=_do, daemon=True).start()
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_updater_config_get(self):
        """GET /api/updater/config — 读取升级器配置+本地版本"""
        try:
            import updater
            cfg = updater.load_cfg()
            cfg['local_version'] = updater.get_local_version()
            self._send_json({'ok': True, 'config': cfg})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_updater_config_post(self):
        """POST /api/updater/config — 保存升级器配置"""
        try:
            import updater
            body = self._read_body()
            cfg = updater.load_cfg()
            for k in ('remote_type', 'github_repo', 'gitee_repo', 'branch'):
                if k in body:
                    cfg[k] = str(body[k]).strip()
            for k in ('auto_check_on_start', 'auto_apply'):
                if k in body:
                    cfg[k] = bool(body[k])
            if 'check_interval_hours' in body:
                try:
                    cfg['check_interval_hours'] = max(0.0, float(body['check_interval_hours']))
                except Exception:
                    pass
            updater.save_cfg(cfg)
            self._send_json({'ok': True, 'config': cfg})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_updater_restore_stash(self):
        """POST /api/updater/restore_stash — 升级后恢复升级前被保护的本地改动"""
        try:
            import updater
            self._send_json(updater.restore_stash())
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    # ===== 一键重启后台服务器 =====
    def _handle_restart_server(self):
        try:
            import subprocess
            import sys as _sys
            script = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'restart_server.py')
            subprocess.Popen(
                # --force：用户手动点击 → 跳过 restart_server.py 的 60 秒限流，支持连续多次重启
                [_sys.executable, script, '--manual', '--force'],
                cwd=os.path.dirname(script),
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0,  # 不弹系统黑框
            )
            print('[Restart] 用户触发一键重启，重启脚本已启动，服务器即将退出')
            self._send_json({'ok': True, 'message': '重启命令已发出，后台将在几秒后自动恢复，页面请稍后刷新'}, 200)
            # 延迟退出，先让响应送达浏览器
            def _exit():
                import time as _t
                _t.sleep(1.5)
                os._exit(0)
            threading.Thread(target=_exit, daemon=True).start()
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    # ===== 备用版本状态查询（含修复请求/通知队列） =====
    def _handle_revive_backend(self):
        """POST /api/revive — 安全重启后台（走 auto_revive --force）。
        与一键重启的区别：重启前自动等待 AI 半成品代码恢复可加载（导入自检），
        绝不带病启动；旧服务器由 restart_server 精确结束，不误杀其他进程。"""
        try:
            import subprocess
            import sys as _sys
            script = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'auto_revive.py')
            subprocess.Popen(
                [_sys.executable, script, '--force', '--delay', '1'],
                cwd=os.path.dirname(script),
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0,
            )
            print('[Revive] 用户从文件面板触发安全重启，auto_revive 已启动（延迟 1 秒执行）')
            self._send_json({'ok': True, 'message': '安全重启已启动：约 2~5 秒后新后台就绪，请稍候刷新'}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    # ===== 备用版本状态查询（含修复请求/通知队列） =====
    def _handle_backup_version(self):
        try:
            import backup_version
            info = {
                'ok': True,
                'backups': backup_version.find_backup_versions(),
                'repair_requests': [],
                'notifications': [],
            }
            rr_path = os.path.join(backup_version.BASE_DIR, 'private',
                                   backup_version.REPAIR_REQUEST_FILE)
            if os.path.isfile(rr_path):
                try:
                    with open(rr_path, 'r', encoding='utf-8-sig') as f:
                        info['repair_requests'].append(json.load(f))
                except Exception:
                    pass
            # 同时读取本版本发往其他版本的通知队列
            for nb in info['backups']:
                npath = os.path.join(nb['dir'], 'private', 'repair_request.json')
                try:
                    if os.path.isfile(npath):
                        with open(npath, 'r', encoding='utf-8-sig') as f:
                            info['notifications'].append(
                                {'target': nb['name'], 'content': json.load(f)})
                except Exception:
                    pass
            self._send_json(info, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    # ===== 手动触发升级流程（拉起备用版本并写修复请求） =====
    def _handle_backup_escalate(self):
        try:
            import threading as _th
            import backup_version
            self._send_json({'ok': True,
                             'message': '升级流程已在后台执行：拉起备用版本并写入修复请求'},
                            200)
            _th.Thread(target=backup_version.escalate, daemon=True).start()
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    # ===== 修复请求应答（备用版本智能体修复完成后回传结果） =====
    def _handle_backup_repair_ack(self):
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self._cached_body(length) if length > 0 else b'{}'
            payload = json.loads(raw.decode('utf-8') or '{}')
            result = {
                'acknowledged_at': time.strftime('%Y-%m-%d %H:%M:%S'),
                'by': payload.get('by', '备用版本智能体'),
                'result': payload.get('result', ''),
                'details': payload.get('details', ''),
            }
            ack_path = os.path.join(os.path.dirname(os.path.dirname(
                os.path.abspath(__file__))), 'private', 'repair_ack.json')
            with open(ack_path, 'w', encoding='utf-8') as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
            self._send_json({'ok': True, 'message': '修复应答已记录'}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    # ===== 网络守护状态查询 =====
    def _handle_network_guard(self):
        try:
            import network_guard
            self._send_json({'ok': True, **network_guard.get_status()}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    # ===== 修复请求注入状态查询 =====
    def _handle_repair_inject_status(self):
        try:
            import repair_inject
            pending = repair_inject.read_pending()
            done_path = repair_inject._done_path()
            done = None
            if os.path.isfile(done_path):
                try:
                    with open(done_path, 'r', encoding='utf-8-sig') as f:
                        done = json.load(f)
                except Exception:
                    done = {'note': '存在但不可读'}
            self._send_json({'ok': True, 'pending': pending, 'last_consumed': done}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)
