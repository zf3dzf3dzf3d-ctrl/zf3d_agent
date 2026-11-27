# -*- coding: utf-8 -*-
"""Mixin: 备份（自动拆分自 handler_routes.py，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase
from util_log import get_logger

log = get_logger('backup')


class MixinBackup(MixinBase):
    def _get_backup_dir(self):
        return os.path.join(BASE_DIR, 'backups')

    @staticmethod

    def _format_backup_size(n):
        if n == 0:
            return '0 B'
        units = ['B', 'KB', 'MB', 'GB']
        i = 0
        while n >= 1024 and i < len(units) - 1:
            n /= 1024
            i += 1
        return '%.1f %s' % (n, units[i])


    def _handle_backup_list(self):
        """GET /api/backup/list - 列出所有备份"""
        backup_dir = self._get_backup_dir()
        backups = []
        try:
            if os.path.isdir(backup_dir):
                for fname in os.listdir(backup_dir):
                    fpath = os.path.join(backup_dir, fname)
                    if not os.path.isfile(fpath):
                        continue
                    if fname.endswith('.zip'):
                        btype = 'snapshot'
                    elif fname.endswith('.db'):
                        btype = 'database'
                    else:
                        continue
                    stat = os.stat(fpath)
                    backups.append({
                        'filename': fname,
                        'size': stat.st_size,
                        'size_human': self._format_backup_size(stat.st_size),
                        'display_time': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(stat.st_mtime)),
                        'mtime': stat.st_mtime,
                        'type': btype,
                    })
            backups.sort(key=lambda b: b['mtime'], reverse=True)
            for b in backups:
                del b['mtime']
            self._send_json({'ok': True, 'backups': backups})
        except Exception as e:
            log.info('[GET /api/backup/list] 500: %s' % e)
            traceback.print_exc()
            self._send_json({'ok': False, 'error': str(e)})


    def _handle_backup_open_folder(self):
        """GET /api/backup/open-folder - 在文件管理器中打开备份目录"""
        backup_dir = self._get_backup_dir()
        os.makedirs(backup_dir, exist_ok=True)
        try:
            if sys.platform == 'win32':
                os.startfile(backup_dir)
            elif sys.platform == 'darwin':
                subprocess.Popen(['open', backup_dir], creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            else:
                subprocess.Popen(['xdg-open', backup_dir], creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            self._send_json({'ok': True})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)})


    def _backup_collect_files(self):
        """遍历项目目录，返回 (fpath, arcname) 列表，排除备份目录等"""
        result = []
        for root, dirs, files in os.walk(BASE_DIR):
            dirs[:] = [d for d in dirs if d not in self._BACKUP_EXCLUDE_DIRS]
            for fname in files:
                ext = os.path.splitext(fname)[1].lower()
                if ext in self._BACKUP_EXCLUDE_EXTS:
                    continue
                # 排除各种 .bak 文件（.bak, .bak.0, .bak2 等）
                if '.bak' in fname.lower():
                    continue
                fpath = os.path.join(root, fname)
                arcname = os.path.relpath(fpath, BASE_DIR)
                result.append((fpath, arcname))
        return result

    @staticmethod
    def _checkpoint_dbs():
        """【P1 备份一致性】打 zip 快照前对 5 个分库执行 wal_checkpoint(TRUNCATE)：
        把 WAL 里未合并的数据页写回主 .db 并截断 -wal 文件。否则 zip 里 .db 与
        -wal 不一致，恢复（尤其换机/停服后恢复）会丢快照前最后一段写入。
        逐库失败（如正被长事务占用）不阻塞备份主流程，仅尽力而为。"""
        try:
            import sqlite3
            try:
                from config import TABLE_DB_MAP
                db_paths = sorted(set(TABLE_DB_MAP.values()))
            except Exception:
                db_paths = [DB_PATH]  # 兜底：至少主库（routes/_shared 已导入）
            for db_p in db_paths:
                try:
                    conn = sqlite3.connect(db_p, timeout=5)
                    try:
                        conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
                    finally:
                        conn.close()
                except Exception:
                    pass
        except Exception:
            pass


    # ===== 全部配置导出/导入（迁移到别的机器/目录用） =====
    # 导出内容：模型配置+密钥、用户设置、用户习惯、对话模式规则、工具结果限额、MCP/扩展设置
    _CONFIG_EXPORT_FILES = [
        ('public/config/models.json',      False),  # (相对路径, 是否必需)
        # 注意：private/api_keys.json（API 密钥）不参与导出/导入，密钥有单独管理入口，避免泄露
        ('private/用户设置/user_settings.json',    False),
        ('private/用户设置/user_preferences.json', False),
        ('private/chat_loop_mode.json',    False),
        ('private/chat_mode_rules.json',   False),
        ('private/tool_result_limits.json', False),
        ('private/extensions/mcp_servers.json', False),
        ('private/extensions/settings.json', False),
    ]

    def _handle_config_export(self):
        """GET /api/config/export - 打包所有配置为 JSON 下载"""
        import json as _json
        try:
            data = {
                '_type': 'zf3d_config_export',
                '_version': 1,
                '_exported_at': time.strftime('%Y-%m-%d %H:%M:%S'),
                'files': {},
            }
            missing = []
            for rel, required in self._CONFIG_EXPORT_FILES:
                fpath = os.path.join(BASE_DIR, rel.replace('/', os.sep))
                if os.path.isfile(fpath):
                    try:
                        with open(fpath, 'r', encoding='utf-8-sig') as f:
                            data['files'][rel] = _json.load(f)
                    except Exception as e:
                        if required:
                            raise
                        data['files'][rel] = {'_error': str(e)}
                else:
                    missing.append(rel)
            body = _json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8')
            fname = 'zf3d_config_%s.json' % time.strftime('%Y%m%d_%H%M%S')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Disposition', 'attachment; filename="%s"' % fname)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            log.info('[GET /api/config/export] 导出 %d 个配置文件, 缺失 %d 个' % (len(data['files']), len(missing)))
        except Exception as e:
            log.info('[GET /api/config/export] 500: %s' % e)
            traceback.print_exc()
            self._send_json({'ok': False, 'error': str(e)})

    def _handle_config_import(self):
        """POST /api/config/import - 从导出的 JSON 恢复配置（覆盖前自动备份到 backups/config_import_pre/）"""
        import json as _json
        try:
            body = self._read_body()
            data = body.get('data')
            if isinstance(data, str):
                data = _json.loads(data)
            if not isinstance(data, dict) or data.get('_type') != 'zf3d_config_export':
                self._send_json({'ok': False, 'error': '文件格式不正确：不是本系统导出的配置文件'})
                return
            files = data.get('files') or {}
            if not files:
                self._send_json({'ok': False, 'error': '配置文件为空'})
                return
            pre_dir = os.path.join(BASE_DIR, 'backups', 'config_import_pre')
            os.makedirs(pre_dir, exist_ok=True)
            stamp = time.strftime('%Y%m%d_%H%M%S')
            restored, skipped = [], []
            for rel, content in files.items():
                if not isinstance(content, dict) or '_error' in content:
                    skipped.append(rel)
                    continue
                # 安全：只允许写入白名单内的相对路径
                if rel not in [r for r, _ in self._CONFIG_EXPORT_FILES]:
                    skipped.append(rel)
                    continue
                fpath = os.path.abspath(os.path.join(BASE_DIR, rel.replace('/', os.sep)))
                if not fpath.startswith(os.path.abspath(BASE_DIR)):
                    skipped.append(rel)
                    continue
                os.makedirs(os.path.dirname(fpath), exist_ok=True)
                # 覆盖前备份已有文件
                if os.path.isfile(fpath):
                    bak_name = os.path.splitext(os.path.basename(fpath))[0] + '_pre_%s%s' % (
                        stamp, os.path.splitext(fpath)[1])
                    try:
                        with open(fpath, 'r', encoding='utf-8-sig') as f:
                            old = f.read()
                        with open(os.path.join(pre_dir, bak_name), 'w', encoding='utf-8') as f:
                            f.write(old)
                    except Exception:
                        pass
                with open(fpath, 'w', encoding='utf-8') as f:
                    _json.dump(content, f, ensure_ascii=False, indent=2)
                restored.append(rel)
            self._send_json({
                'ok': True,
                'restored': restored,
                'skipped': skipped,
                'message': '已导入 %d 个配置文件，请刷新页面生效' % len(restored),
            })
        except Exception as e:
            log.info('[POST /api/config/import] 500: %s' % e)
            traceback.print_exc()
            self._send_json({'ok': False, 'error': str(e)})


    def _handle_backup_create(self):
        """POST /api/backup/create - 创建项目快照（zip）"""
        backup_dir = self._get_backup_dir()
        os.makedirs(backup_dir, exist_ok=True)

        timestamp = time.strftime('%Y%m%d_%H%M%S')
        filename = 'snapshot_%s.zip' % timestamp
        filepath = os.path.join(backup_dir, filename)
        counter = 1
        while os.path.exists(filepath):
            filename = 'snapshot_%s_%d.zip' % (timestamp, counter)
            filepath = os.path.join(backup_dir, filename)
            counter += 1

        # 【P1】打包前先把 5 个分库的 WAL 合并截断，保证 zip 内 .db 数据完整
        self._checkpoint_dbs()

        try:
            import zipfile
            file_count = 0
            with zipfile.ZipFile(filepath, 'w', zipfile.ZIP_DEFLATED) as zf:
                for fpath, arcname in self._backup_collect_files():
                    try:
                        zf.write(fpath, arcname)
                        file_count += 1
                    except Exception:
                        pass
            stat = os.stat(filepath)
            self._send_json({
                'ok': True,
                'filename': filename,
                'size_human': self._format_backup_size(stat.st_size),
                'file_count': file_count,
            })
        except Exception as e:
            log.info('[POST /api/backup/create] 500: %s' % e)
            traceback.print_exc()
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except Exception:
                    pass
            self._send_json({'ok': False, 'error': str(e)})


    def _handle_backup_restore(self):
        """POST /api/backup/restore - 从快照恢复项目"""
        try:
            body = self._read_body()
        except Exception:
            body = {}
        filename = str(body.get('filename', '')).strip()
        if not filename:
            self._send_json({'ok': False, 'error': '缺少 filename 参数'})
            return

        if '..' in filename or '/' in filename or '\\' in filename:
            self._send_json({'ok': False, 'error': '无效的文件名'})
            return

        backup_dir = self._get_backup_dir()
        src_path = os.path.join(backup_dir, filename)
        if not os.path.isfile(src_path):
            self._send_json({'ok': False, 'error': '快照文件不存在: ' + filename})
            return

        # 【P1 恢复保护】服务必然正在本进程运行，恢复 = 用 zip 覆盖运行中的
        # 代码/数据库文件，轻则本次会话错乱、重则服务崩溃且无法再重启。
        # 无 force=yes 一律拒绝，提示走托盘"重启后台"后再操作（或前端显式确认后带
        # force=yes 重试，风险自担）。
        if str(body.get('force') or '').strip().lower() != 'yes':
            self._send_json({
                'ok': False,
                'need_force': True,
                'error': '恢复会覆盖运行中的程序与数据库文件，请通过托盘“重启后台”后再操作；'
                         '如确认了解风险，可携带 force=yes 参数重试',
            })
            return

        # Step 1: 创建恢复前快照
        timestamp = time.strftime('%Y%m%d_%H%M%S')
        pre_filename = 'snapshot_prerestore_%s.zip' % timestamp
        pre_filepath = os.path.join(backup_dir, pre_filename)
        counter = 1
        while os.path.exists(pre_filepath):
            pre_filename = 'snapshot_prerestore_%s_%d.zip' % (timestamp, counter)
            pre_filepath = os.path.join(backup_dir, pre_filename)
            counter += 1

        try:
            import zipfile

            # 【P1】恢复前快照同样先 checkpoint，保证 pre_restore 备份自身数据完整
            self._checkpoint_dbs()

            with zipfile.ZipFile(pre_filepath, 'w', zipfile.ZIP_DEFLATED) as zf:
                for fpath, arcname in self._backup_collect_files():
                    try:
                        zf.write(fpath, arcname)
                    except Exception:
                        pass

            # Step 2: 解压快照到项目目录
            with zipfile.ZipFile(src_path, 'r') as zf:
                for member in zf.namelist():
                    member_path = os.path.normpath(member)
                    # 安全：阻止路径穿越
                    if member_path.startswith('..') or os.path.isabs(member_path):
                        continue
                    # 不恢复到 backups 目录
                    if member_path.startswith('backups') or member_path.startswith(os.sep + 'backups'):
                        continue
                    target = os.path.abspath(os.path.join(BASE_DIR, member_path))
                    if not target.startswith(os.path.abspath(BASE_DIR)):
                        continue
                    zf.extract(member, BASE_DIR)

            self._send_json({
                'ok': True,
                'message': '项目已从快照恢复，请刷新页面',
                'pre_restore_backup': pre_filename,
            })
        except Exception as e:
            log.info('[POST /api/backup/restore] 500: %s' % e)
            traceback.print_exc()
            self._send_json({'ok': False, 'error': str(e)})


    # ===== 工作区 JSON 保存/打开（无限画布整体存取，用户可直接查看 .json 文件） =====
    def _get_workspace_dir(self):
        d = os.path.join(BASE_DIR, 'private', 'workspace')
        os.makedirs(d, exist_ok=True)
        return d

    def _handle_workspace_save(self):
        """POST /api/workspace/save - 保存画布状态为 JSON 文件"""
        import json as _json
        try:
            body = self._read_body()
            data = body.get('data')
            if data is None:
                self._send_json({'ok': False, 'error': 'missing data'})
                return
            name = (body.get('name') or '').strip() or time.strftime('画布_%Y-%m-%d_%H%M')
            # 保留中文/字母/数字/下划线/横线/空格，仅去掉非法路径字符（此前把中文文件名全吞掉导致保存异常）
            import re as _re
            safe = _re.sub(r'[\\/:*?"<>|\r\n\t]', '', name).strip() or 'workspace'
            if safe.endswith('.'):
                safe = safe.rstrip('.') or 'workspace'
            if not safe.endswith('.json'):
                safe += '.json'
            path = os.path.join(self._get_workspace_dir(), safe)
            with open(path, 'w', encoding='utf-8') as f:
                _json.dump(data, f, ensure_ascii=False, indent=2)
            self._send_json({'ok': True, 'filename': safe, 'size': os.path.getsize(path)})
        except Exception as e:
            log.info('[POST /api/workspace/save] 500: %s' % e)
            traceback.print_exc()
            self._send_json({'ok': False, 'error': str(e)})

    def _handle_workspace_list(self):
        """GET /api/workspace/list - 列出所有已保存的工作区 JSON"""
        try:
            files = []
            ws_dir = self._get_workspace_dir()
            for fname in os.listdir(ws_dir):
                if not fname.endswith('.json'):
                    continue
                fpath = os.path.join(ws_dir, fname)
                if not os.path.isfile(fpath):
                    continue
                stat = os.stat(fpath)
                files.append({
                    'filename': fname,
                    'size': stat.st_size,
                    'size_human': self._format_backup_size(stat.st_size),
                    'display_time': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(stat.st_mtime)),
                    'mtime': stat.st_mtime,
                })
            files.sort(key=lambda b: b['mtime'], reverse=True)
            for b in files:
                del b['mtime']
            self._send_json({'ok': True, 'files': files})
        except Exception as e:
            log.info('[GET /api/workspace/list] 500: %s' % e)
            traceback.print_exc()
            self._send_json({'ok': False, 'error': str(e)})

    def _handle_workspace_load(self):
        """GET /api/workspace/load?name=xxx.json - 读取工作区 JSON"""
        import json as _json
        try:
            qs = parse_qs(urlparse(self.path).query)
            name = (qs.get('name') or [''])[0]
            if not name or '..' in name or '/' in name or '\\' in name:
                self._send_json({'ok': False, 'error': '无效的文件名'})
                return
            if not name.endswith('.json'):
                name += '.json'
            path = os.path.join(self._get_workspace_dir(), name)
            if not os.path.isfile(path):
                self._send_json({'ok': False, 'error': '文件不存在: ' + name})
                return
            with open(path, 'r', encoding='utf-8-sig') as f:
                data = _json.load(f)
            self._send_json({'ok': True, 'data': data})
        except Exception as e:
            log.info('[GET /api/workspace/load] 500: %s' % e)
            traceback.print_exc()
            self._send_json({'ok': False, 'error': str(e)})

    def _handle_workspace_delete(self):
        """DELETE /api/workspace/delete?name=xxx.json - 删除工作区 JSON"""
        try:
            qs = parse_qs(urlparse(self.path).query)
            name = (qs.get('name') or [''])[0]
            if not name or '..' in name or '/' in name or '\\' in name:
                self._send_json({'ok': False, 'error': '无效的文件名'})
                return
            if not name.endswith('.json'):
                name += '.json'
            path = os.path.join(self._get_workspace_dir(), name)
            if os.path.isfile(path):
                os.remove(path)
            self._send_json({'ok': True})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)})

    def _handle_workspace_open_folder(self):
        """GET /api/workspace/open-folder - 在资源管理器中打开保存文件夹"""
        try:
            import subprocess
            d = self._get_workspace_dir()
            if os.name == 'nt':
                os.startfile(d)  # noqa
            elif sys_platform := __import__('platform').system():
                if sys_platform == 'Darwin':
                    subprocess.Popen(['open', d], creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                else:
                    subprocess.Popen(['xdg-open', d], creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            self._send_json({'ok': True, 'path': d})
        except Exception as e:
            log.info('[GET /api/workspace/open-folder] 500: %s' % e)
            self._send_json({'ok': False, 'error': str(e)})

    def _handle_app_restart(self):
        """POST /api/app/restart - 统一转发到 restart_server.py（与 /api/restart_server 同一套带锁逻辑）。
        【移除自杀定时器 2026-11-22】旧版转发后 10 秒 os._exit(0) 兜底自杀：
        ① 旧架构下 server 跑在托盘进程里，这个 os._exit 会把托盘一起硬杀，
           图标来不及注销 → 死图标 + relaunch_tray 新图标 = 「两个朱峰图标」；
        ② restart_server 的优雅关停（记忆库 git 快照）若超过 10 秒会被它截断。
        现在 server 是独立裸进程，restart_server 自带 锁→杀旧→拉新→健康检查 完整闭环，
        兜底强杀也在其 kill_old 内，这里只需触发即可。"""
        try:
            import subprocess, sys
            self._send_json({'ok': True, 'msg': '重启中，页面将在几秒后自动恢复'})
            log.info('[POST /api/app/restart] 转发到 restart_server.py 执行统一重启...')
            script = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'restart_server.py')
            if not os.path.isfile(script):
                log.warning('[restart] 警告: 未找到 %s' % script)
            try:
                # 【P1 修复 2026-11-23】经 cmd start /b 中转，使 restart_server 脱离本
                # server 进程树：此前直接 Popen 拉起 → restart_server 是本进程子进程，
                # kill_old 兜底 taskkill /F /T /PID <旧server> 会连子树一起杀，重启脚本
                # 自己杀自己（=web 重启偶发"杀了没起来"）。与 tray_server._on_restart
                # 同款写法；argv 列表 + shell=False 防注入，start 后首个 '' 占位窗口标题
                # （含空格路径被 list2cmdline 加引号后仍按程序名解析，不会被误当标题）。
                cmd = ['cmd', '/c', 'start', '', '/b',
                       sys.executable, script, '--manual']
                subprocess.Popen(
                    cmd, shell=False, cwd=os.path.dirname(script),
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0) if sys.platform == 'win32' else 0,
                )
            except Exception as e:
                log.error('[restart] 拉起重启脚本失败: %s' % e)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)})

    def _handle_app_quit(self):
        """POST /api/app/quit - 退出整个服务进程"""
        try:
            self._send_json({'ok': True, 'msg': '服务正在退出'})
            log.info('[POST /api/app/quit] 服务进程即将退出...')

            def _do_quit():
                # 【P0-A2 修复】旧版 sleep 0.6 后裸 os._exit(0)，绕过 _shutdown_watcher 的
                # 记忆库 git 快照与热更新停止，与"退出系统"声称的优雅关停不符。改为触发
                # request_shutdown() 让看门狗完成 快照→server.shutdown→os._exit，
                # 与托盘 _on_quit 路径语义统一；本线程仅在触发失败/看门狗卡死时兜底强退。
                time.sleep(0.6)  # 留出 HTTP 响应回写时间
                try:
                    import server as _srv
                    _srv.request_shutdown()
                except Exception as e:
                    log.error('%s %s', '[POST /api/app/quit] 优雅关停触发失败，兜底强退:', e)
                    os._exit(0)
                    return
                time.sleep(12)  # 兜底上限：看门狗仍未退出则强杀，防退不掉
                os._exit(0)

            import threading
            threading.Thread(target=_do_quit, daemon=True).start()
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)})

    def _handle_backup_delete(self, filename):
        """DELETE /api/backup/delete/{filename} - 删除备份文件"""
        if '..' in filename or '/' in filename or '\\' in filename:
            self._send_json({'ok': False, 'error': '无效的文件名'})
            return

        backup_dir = self._get_backup_dir()
        filepath = os.path.join(backup_dir, filename)
        if not os.path.isfile(filepath):
            self._send_json({'ok': False, 'error': '文件不存在: ' + filename})
            return
        try:
            try:
                from trash import move_to_trash as _m2t
            except ImportError:
                from server.trash import move_to_trash as _m2t
            try:
                _m2t(filepath, source='backup_delete')
            except Exception:
                os.remove(filepath)
            self._send_json({'ok': True})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)})


