# -*- coding: utf-8 -*-
"""Mixin: 工作日志/自验收/可选插件（由 mixin_settings.py 拆出，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinSettingsWorklog(MixinBase):
    # ===== 工作日志：AI 任务完成记录（GET 查询 / POST 追加）=====

    def _worklog_read(self):
        if not os.path.exists(_WORKLOG_PATH):
            return {}
        try:
            with open(_WORKLOG_PATH, 'r', encoding='utf-8-sig') as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _worklog_write(self, data):
        os.makedirs(os.path.dirname(_WORKLOG_PATH), exist_ok=True)
        tmp = _WORKLOG_PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, _WORKLOG_PATH)

    def _handle_worklog_get(self):
        """GET /api/worklog?days=N：返回最近 N 天（默认7）的工作日志"""
        try:
            qs = parse_qs(parsed_qs[1]) if (parsed_qs := urlparse(self.path)) else {}
            days = int((qs.get('days') or ['7'])[0] or 7)
            days = max(1, min(days, _WORKLOG_MAX_DAYS))
            with _WORKLOG_LOCK:
                data = self._worklog_read()
            # 只保留最近 days 天，按日期倒序
            keys = sorted(data.keys(), reverse=True)[:days]
            out = {k: data[k] for k in keys if isinstance(data.get(k), list)}
            total = sum(len(v) for v in out.values())
            self._send_json({'ok': True, 'days': days, 'total': total, 'log': out}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'log': {}, 'error': str(e)}, 200)

    def _handle_worklog_post(self):
        """POST /api/worklog {summary, chatId, success}：追加一条工作记录（防重）"""
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self._cached_body(length) if length > 0 else b'{}'
            body = json.loads(raw.decode('utf-8') or '{}')
        except Exception as e:
            self._send_json({'ok': False, 'error': 'json 解析失败: ' + str(e)}, 400)
            return
        summary = str(body.get('summary') or '').strip()
        if not summary:
            self._send_json({'ok': False, 'error': '缺少 summary'}, 400)
            return
        summary = summary[:2000]  # 单条上限
        day = time.strftime('%Y-%m-%d')
        now_ts = time.time()
        entry = {
            'ts': now_ts,
            'time': time.strftime('%H:%M:%S'),
            'summary': summary,
            'chat_id': str(body.get('chatId') or ''),
            'success': bool(body.get('success', True)),
        }
        try:
            with _WORKLOG_LOCK:
                data = self._worklog_read()
                day_list = data.get(day)
                if not isinstance(day_list, list):
                    day_list = []
                # 防重：同 chatId 同摘要内容 60 秒内不重复记录
                dup = False
                for it in day_list[-10:]:
                    if isinstance(it, dict) and it.get('chat_id') == entry['chat_id'] \
                            and it.get('summary') == summary and abs(float(it.get('ts', 0)) - now_ts) < 60:
                        dup = True
                        break
                if not dup:
                    day_list.append(entry)
                    # 单日条数上限
                    if len(day_list) > _WORKLOG_MAX_ENTRIES_PER_DAY:
                        day_list = day_list[-_WORKLOG_MAX_ENTRIES_PER_DAY:]
                    data[day] = day_list
                    # 只保留最近 N 天
                    keys = sorted(data.keys(), reverse=True)
                    for k in keys[_WORKLOG_MAX_DAYS:]:
                        data.pop(k, None)
                    self._worklog_write(data)
            self._send_json({'ok': True, 'day': day, 'count': len(day_list)}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': '写工作日志失败: ' + str(e)}, 500)

    # ===== AI 轻量自验收（git 双快照对比）=====
    def _self_check_post(self, body):
        """POST /api/self-check/* → tools/coding/backend/self_check.py
        body.action = 'start'（用户提问，打起点快照）| 'finish'（任务终止，对比差距）"""
        try:
            from tools.coding.backend import self_check as _self_check
            from tools.coding.backend.base import ToolContext
        except Exception as e:
            self._send_json({'ok': False, 'mode': 'unavailable',
                             'message': '自验收模块不可用: ' + str(e)}, 200)
            return
        try:
            _self_check.handle(body, ToolContext(self, body))
        except Exception as e:
            try:
                self._send_json({'ok': False, 'mode': 'error', 'message': str(e)}, 200)
            except Exception:
                pass

    def _handle_self_check_start_post(self):
        body = self._read_json()
        body['action'] = 'start'
        self._self_check_post(body)

    def _handle_self_check_finish_post(self):
        body = self._read_json()
        body['action'] = 'finish'
        self._self_check_post(body)

    # ===== 可选插件（录音/录像依赖）：状态查询 / 安装 =====
    _PLUGIN_DIR_NAME = 'audio-video-plugin'
    # 需要复制到 python\Lib\site-packages 的包/模块
    _PLUGIN_SP_ITEMS = ['soundcard', 'numpy', 'numpy.libs', 'cffi', 'pycparser', '_cffi_backend.cp311-win_amd64.pyd']
    # 需要复制到 python\ 根目录的 tcl/tk 运行时（_tkinter.pyd 放 DLLs）
    _PLUGIN_ROOT_ITEMS = ['tcl', 'tcl86t.dll', 'tk86t.dll']
    _PLUGIN_DLLS_ITEM = '_tkinter.pyd'
    _PLUGIN_INSTALLED_MARK = '.plugin-installed'

    def _plugin_src_dir(self):
        base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        return os.path.join(base, 'plugins', self._PLUGIN_DIR_NAME)

    def _plugin_py_dir(self):
        base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        return os.path.join(base, 'python')

    def _plugin_check_imports(self):
        """直接用嵌入式 Python 试导入，最可靠的 installed 判定"""
        py = os.path.join(self._plugin_py_dir(), 'python.exe')
        code = "import importlib\n" \
               "mods=['numpy','soundcard','tkinter']\n" \
               "r={}\n" \
               "for m in mods:\n" \
               "    try:\n" \
               "        importlib.import_module(m); r[m]=True\n" \
               "    except Exception:\n" \
               "        r[m]=False\n" \
               "import json;print(json.dumps(r))"
        try:
            out = subprocess.run([py, '-c', code], capture_output=True, text=True, timeout=60)
            for line in out.stdout.strip().splitlines():
                line = line.strip()
                if line.startswith('{'):
                    return json.loads(line)
        except Exception:
            pass
        return None

    def _handle_plugin_status(self):
        try:
            src = self._plugin_src_dir()
            source_available = os.path.isdir(src)
            res = self._plugin_check_imports()
            if res is not None:
                installed = all(res.values())
                missing = [k for k, v in res.items() if not v]
            else:
                # 导入测试失败时退回文件判定
                sp = os.path.join(self._plugin_py_dir(), 'Lib', 'site-packages')
                installed = (os.path.isdir(os.path.join(sp, 'numpy'))
                             and os.path.isdir(os.path.join(sp, 'soundcard'))
                             and os.path.isfile(os.path.join(self._plugin_py_dir(), 'tcl86t.dll')))
                missing = ['numpy/soundcard/tk'] if not installed else []
            self._send_json({
                'ok': True,
                'installed': installed,
                'sourceAvailable': source_available,
                'missing': missing,
            }, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_plugin_install(self):
        try:
            import shutil
            src = self._plugin_src_dir()
            pydir = self._plugin_py_dir()
            if not os.path.isdir(src):
                self._send_json({'ok': False, 'error': '插件包缺失（plugins/audio-video-plugin）'}, 400)
                return
            sp = os.path.join(pydir, 'Lib', 'site-packages')
            os.makedirs(sp, exist_ok=True)
            copied = 0
            for name in self._PLUGIN_SP_ITEMS:
                s = os.path.join(src, name)
                d = os.path.join(sp, name)
                if not os.path.exists(s):
                    continue
                if os.path.isdir(s):
                    if os.path.exists(d):
                        shutil.rmtree(d, ignore_errors=True)
                    shutil.copytree(s, d)
                else:
                    shutil.copy2(s, d)
                copied += 1
            for name in self._PLUGIN_ROOT_ITEMS:
                s = os.path.join(src, name)
                d = os.path.join(pydir, name)
                if not os.path.exists(s):
                    continue
                if os.path.isdir(s):
                    if os.path.exists(d):
                        shutil.rmtree(d, ignore_errors=True)
                    shutil.copytree(s, d)
                else:
                    shutil.copy2(s, d)
                copied += 1
            # _tkinter.pyd 放 DLLs
            s = os.path.join(src, self._PLUGIN_DLLS_ITEM)
            if os.path.exists(s):
                shutil.copy2(s, os.path.join(pydir, 'DLLs', self._PLUGIN_DLLS_ITEM))
                copied += 1
            # 写安装标记
            try:
                with open(os.path.join(src, self._PLUGIN_INSTALLED_MARK), 'w', encoding='utf-8') as f:
                    f.write('installed')
            except Exception:
                pass
            # 安装后复检
            res = self._plugin_check_imports()
            installed = bool(res and all(res.values()))
            if installed:
                self._send_json({'ok': True, 'installed': True, 'copied': copied, 'note': '重启程序后生效'}, 200)
            else:
                self._send_json({'ok': False, 'error': '文件已复制但导入校验未通过，请重启程序后再试',
                                 'copied': copied, 'check': res}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)
