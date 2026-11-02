# -*- coding: utf-8 -*-
"""Mixin: 健康守护/循环模式/工具结果限额（由 mixin_settings.py 拆出，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinSettingsHealth(MixinBase):
    def _handle_key_audit(self):
        """【P2.2 密钥体检上墙】GET /api/keys/audit：复用 key_audit.audit_keys()，
        只回 名称+状态+hash8 指纹，绝不输出 Key 明文。红=空Key，黄=未加密明文，绿=健康。"""
        try:
            import key_audit
            report = key_audit.audit_keys()
            items = []
            for it in report.get('items', []):
                if it.get('kind') != 'model_key':
                    continue
                if it.get('empty'):
                    level = 'red'
                elif it.get('encrypted') is False:
                    level = 'yellow'
                else:
                    level = 'green'
                items.append({'name': it.get('name'), 'level': level,
                              'encrypted': bool(it.get('encrypted')), 'hash8': it.get('hash8')})
            self._send_json({'ok': True, 'time': report.get('time'), 'items': items,
                             'warnings': report.get('warnings', []),
                             'auth_fails_7d': report.get('auth_fails_7d', 0),
                             'all_ok': bool(report.get('ok'))}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': '密钥体检失败: ' + str(e)}, 500)

    def _handle_health_config_get(self):
        defaults = {
            'intervalMinutes': 30,
            'graceMinutes': 10,
            'forceLockMinutes': 10,
        }
        try:
            with _HEALTH_CONFIG_LOCK:
                if os.path.exists(_HEALTH_CONFIG_PATH):
                    with open(_HEALTH_CONFIG_PATH, 'r', encoding='utf-8-sig') as f:
                        data = json.load(f)
                    if isinstance(data, dict):
                        defaults.update({k: data[k] for k in defaults if k in data})
            # 服务端强制约束：间隔只能 30~60 分钟
            defaults['intervalMinutes'] = max(30, min(60, int(defaults.get('intervalMinutes', 30))))
            self._send_json({'ok': True, 'config': defaults}, 200)
        except Exception as e:
            self._send_json({'ok': True, 'config': defaults, '_error': str(e)}, 200)


    def _handle_health_config_post(self):
        try:
            data = self._read_body()
            if not isinstance(data, dict):
                raise ValueError('配置必须是 JSON 对象')
            defaults = {
                'intervalMinutes': 30,
                'graceMinutes': 10,
                'forceLockMinutes': 10,
            }
            with _HEALTH_CONFIG_LOCK:
                existing = dict(defaults)
                if os.path.exists(_HEALTH_CONFIG_PATH):
                    try:
                        with open(_HEALTH_CONFIG_PATH, 'r', encoding='utf-8-sig') as f:
                            loaded = json.load(f)
                        if isinstance(loaded, dict):
                            existing.update({k: loaded[k] for k in defaults if k in loaded})
                    except Exception:
                        pass
                for key in defaults:
                    if key in data:
                        value = int(data[key])
                        if value <= 0:
                            raise ValueError(key + ' 必须大于 0')
                        existing[key] = value
                # 服务端强制约束：提醒间隔只允许 30~60 分钟，不允许用户设置过久
                existing['intervalMinutes'] = max(30, min(60, int(existing.get('intervalMinutes', 30))))
                if 'graceMinutes' not in existing:
                    existing['graceMinutes'] = 10
                if 'forceLockMinutes' not in existing:
                    existing['forceLockMinutes'] = 10
                os.makedirs(os.path.dirname(_HEALTH_CONFIG_PATH), exist_ok=True)
                tmp = _HEALTH_CONFIG_PATH + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(existing, f, ensure_ascii=False, indent=2)
                os.replace(tmp, _HEALTH_CONFIG_PATH)
            self._send_json({'ok': True, 'config': existing}, 200)
        except ValueError as e:
            self._send_json({'ok': False, 'error': str(e)}, 400)
        except Exception as e:
            self._send_json({'ok': False, 'error': '写健康配置失败: ' + str(e)}, 500)

    def _handle_health_remind(self):
        """健康守卫多实例冷却锁（多实例时间对齐）：
        前端到点弹窗前先调此接口抢锁，抢到（acquired=true）的实例才弹窗+语音，
        冷却期内其他实例/其他端口的多实例收到 acquired=false 静默顺延。
        冷却期 = intervalMinutes * 80%（与配置联动）。"""
        try:
            try:
                data = self._read_body() or {}
            except Exception:
                data = {}
            try:
                interval_min = max(30, min(60, int(data.get('intervalMinutes', 30))))
            except Exception:
                interval_min = 30
            cooldown_ms = int(interval_min * 60 * 1000 * 0.8)
            lock_path = os.path.join(os.path.dirname(os.path.abspath(_HEALTH_CONFIG_PATH)), '.health_last_remind.json')
            now_ms = int(time.time() * 1000)
            acquired = False
            last_ts = 0
            with _HEALTH_CONFIG_LOCK:
                if os.path.exists(lock_path):
                    try:
                        with open(lock_path, 'r', encoding='utf-8-sig') as f:
                            last_ts = int(json.load(f).get('lastRemindTs', 0))
                    except Exception:
                        last_ts = 0
                if now_ms - last_ts >= cooldown_ms:
                    tmp = lock_path + '.tmp'
                    with open(tmp, 'w', encoding='utf-8') as f:
                        json.dump({'lastRemindTs': now_ms}, f)
                    os.replace(tmp, lock_path)  # 原子写，防竞态双抢
                    acquired = True
                    last_ts = now_ms
            self._send_json({'ok': True, 'acquired': acquired,
                             'cooldownMs': cooldown_ms, 'nextAllowedMs': last_ts + cooldown_ms}, 200)
        except Exception as e:
            # 抢锁接口故障时放行，不影响健康守卫主功能
            self._send_json({'ok': False, 'acquired': True, '_error': str(e)}, 200)

    # ===== 健康守护数据库持久化（2026-09-23 新增） =====
    def _health_ensure_tables(self, conn):
        conn.execute('''CREATE TABLE IF NOT EXISTS health_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            active_seconds REAL DEFAULT 0,
            state_day TEXT DEFAULT '',
            updated_at TEXT DEFAULT ''
        )''')
        conn.execute('''CREATE TABLE IF NOT EXISTS health_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT DEFAULT (datetime('now','localtime')),
            event_type TEXT DEFAULT '',
            work_seconds REAL DEFAULT 0,
            detail TEXT DEFAULT ''
        )''')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_health_events_ts ON health_events(ts)')
        conn.execute('''CREATE TABLE IF NOT EXISTS health_daily (
            day TEXT PRIMARY KEY,
            active_seconds REAL DEFAULT 0
        )''')

    def _handle_health_heartbeat(self):
        """前端定期上报当前活跃工作秒数：单行状态表存进度，跨刷新累计到日汇总。"""
        try:
            data = self._read_body()
            seconds = float(data.get('active_seconds', 0))
            if seconds < 0:
                seconds = 0
            conn = get_db()
            # 【P3 锁降级 2026-10-17】健康遥测限时抢锁，抢不到(>1.5s)直接回忙，前端会自动重试心跳
            if not _db_lock.acquire(timeout=1.5):
                self._send_json({'ok': False, 'error': 'db busy, heartbeat skipped'}, 503)
                return
            try:
                self._health_ensure_tables(conn)
                row = conn.execute('SELECT active_seconds, state_day FROM health_state WHERE id=1').fetchone()
                today = time.strftime('%Y-%m-%d')
                prev = float(row[0]) if row else 0.0
                prev_day = row[1] if row else ''
                delta = 0.0
                if prev_day == today and seconds > prev:
                    delta = seconds - prev
                elif prev_day != today:
                    delta = seconds  # 新的一天，从头累计
                if delta > 0:
                    conn.execute('''INSERT INTO health_daily(day, active_seconds) VALUES(?,?)
                        ON CONFLICT(day) DO UPDATE SET active_seconds = active_seconds + ?''',
                        (today, delta, delta))
                conn.execute('''INSERT INTO health_state(id, active_seconds, state_day, updated_at)
                    VALUES(1,?,?,datetime('now','localtime'))
                    ON CONFLICT(id) DO UPDATE SET active_seconds=?, state_day=?, updated_at=datetime('now','localtime')''',
                    (seconds, today, seconds, today))
                conn.commit()
            finally:
                _db_lock.release()
            self._send_json({'ok': True, 'active_seconds': seconds, 'day': today}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': '心跳写库失败: ' + str(e)}, 500)

    def _handle_health_event(self):
        """记录提醒/强制锁定/跳过等事件。"""
        try:
            data = self._read_body()
            etype = str(data.get('type', ''))[:32]
            work_seconds = float(data.get('work_seconds', 0))
            detail = str(data.get('detail', ''))[:200]
            conn = get_db()
            # 【P3 锁降级 2026-10-17】健康事件(提醒/锁定记录)限时抢锁，抢不到(>1.5s)回忙丢弃
            if not _db_lock.acquire(timeout=1.5):
                self._send_json({'ok': False, 'error': 'db busy, event skipped'}, 503)
                return
            try:
                self._health_ensure_tables(conn)
                conn.execute('INSERT INTO health_events(event_type, work_seconds, detail) VALUES(?,?,?)',
                             (etype, work_seconds, detail))
                conn.commit()
            finally:
                _db_lock.release()
            self._send_json({'ok': True}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': '事件写库失败: ' + str(e)}, 500)

    def _handle_health_state_get(self):
        """前端启动时恢复计时：今天已活跃秒数（跨刷新累计，跨天清零）。"""
        try:
            # F2 读锁分离：纯 SELECT 不再排队全局 _db_lock
            row = db_read('SELECT active_seconds, state_day FROM health_state WHERE id=1', fetch='one')
            today = time.strftime('%Y-%m-%d')
            if row and row['state_day'] == today:
                self._send_json({'ok': True, 'active_seconds': float(row[0]), 'day': today}, 200)
            else:
                self._send_json({'ok': True, 'active_seconds': 0, 'day': today}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e), 'active_seconds': 0}, 200)

    def _handle_health_report_get(self):
        """健康报告：近 N 天每日活跃汇总 + 最近事件。"""
        try:
            qs = parse_qs(urlparse(self.path).query)
            try:
                days = max(1, min(90, int((qs.get('days') or ['7'])[0])))
            except Exception:
                days = 7
            # F2 读锁分离：纯 SELECT 不再排队全局 _db_lock
            daily = db_read(
                'SELECT day, ROUND(active_seconds/60.0,1) AS minutes FROM health_daily ORDER BY day DESC LIMIT ?',
                (days,))
            events = db_read(
                "SELECT ts, event_type, ROUND(work_seconds/60.0,1) AS work_minutes, detail FROM health_events "
                "ORDER BY id DESC LIMIT 50")
            self._send_json({'ok': True,
                             'daily': [{'day': r['day'], 'minutes': r['minutes']} for r in daily],
                             'events': [{'ts': r['ts'], 'type': r['event_type'], 'work_minutes': r['work_minutes'], 'detail': r['detail']} for r in events]}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_loop_mode_config_get(self):
        try:
            with _LOOP_MODE_CONFIG_LOCK:
                if not os.path.exists(_LOOP_MODE_CONFIG_PATH):
                    self._send_json({'default_mode': '1', 'per_chat': {}}, 200)
                    return
                with open(_LOOP_MODE_CONFIG_PATH, 'r', encoding='utf-8-sig') as f:
                    data = json.load(f)
            self._send_json(data, 200)
        except Exception as e:
            self._send_json({'default_mode': '1', 'per_chat': {}, '_error': str(e)}, 200)


    def _handle_loop_mode_config_post(self):
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self._cached_body(length) if length > 0 else b'{}'
            data = json.loads(raw.decode('utf-8') or '{}')
        except Exception as e:
            self._send_json({'ok': False, 'error': 'json 解析失败: ' + str(e)}, 400)
            return
        try:
            with _LOOP_MODE_CONFIG_LOCK:
                existing = {}
                if os.path.exists(_LOOP_MODE_CONFIG_PATH):
                    try:
                        with open(_LOOP_MODE_CONFIG_PATH, 'r', encoding='utf-8-sig') as f:
                            existing = json.load(f) or {}
                    except Exception:
                        existing = {}
                # 当前选中即默认：default_mode 直接存选中值（数字或插件模式 id 字符串），失败才回退 '1'
                if 'default_mode' in data:
                    dm = data['default_mode']
                    try:
                        existing['default_mode'] = int(dm)
                    except (TypeError, ValueError):
                        existing['default_mode'] = str(dm).strip() if str(dm).strip() else '1'
                if 'per_chat' in data and isinstance(data['per_chat'], dict):
                    existing['per_chat'] = data['per_chat']
                os.makedirs(os.path.dirname(_LOOP_MODE_CONFIG_PATH), exist_ok=True)
                tmp = _LOOP_MODE_CONFIG_PATH + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(existing, f, ensure_ascii=False, indent=2)
                os.replace(tmp, _LOOP_MODE_CONFIG_PATH)
            self._send_json({'ok': True, 'config': existing}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': '写 json 失败: ' + str(e)}, 500)


    def _handle_tool_result_limits_get(self):
        # 工具结果出口限额：读取 private/tool_result_limits.json
        try:
            with _TOOL_RESULT_LIMITS_LOCK:
                if not os.path.exists(_TOOL_RESULT_LIMITS_PATH):
                    self._send_json({'exit_limits': {}}, 200)
                    return
                with open(_TOOL_RESULT_LIMITS_PATH, 'r', encoding='utf-8-sig') as f:
                    data = json.load(f)
            self._send_json(data, 200)
        except Exception as e:
            self._send_json({'exit_limits': {}, '_error': str(e)}, 200)


    def _handle_tool_result_limits_post(self):
        # 工具结果出口限额：整包写入 private/tool_result_limits.json（替换式保存）
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self._cached_body(length) if length > 0 else b'{}'
            data = json.loads(raw.decode('utf-8') or '{}')
        except Exception as e:
            self._send_json({'ok': False, 'error': 'json 解析失败: ' + str(e)}, 400)
            return
        try:
            with _TOOL_RESULT_LIMITS_LOCK:
                os.makedirs(os.path.dirname(_TOOL_RESULT_LIMITS_PATH), exist_ok=True)
                tmp = _TOOL_RESULT_LIMITS_PATH + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                os.replace(tmp, _TOOL_RESULT_LIMITS_PATH)
            self._send_json({'ok': True, 'config': data}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': '写 json 失败: ' + str(e)}, 500)
