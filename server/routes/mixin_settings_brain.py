# -*- coding: utf-8 -*-
"""Mixin: 主脑（Main Brain）（由 mixin_settings.py 拆出，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase
import logging
import re


class MixinSettingsBrain(MixinBase):
    # ==================== 多智能体协作监控 ====================
    def _handle_multiagent_monitor(self):
        """GET /api/multiagent/monitor?limit=100 — 活跃会话 + 最近事件流"""
        try:
            import sys as _sys
            _sys.path.insert(0, os.path.join(BASE_DIR, 'server'))
            import multiagent_monitor as _mon
            from urllib.parse import parse_qs, urlparse as _up
            qs = parse_qs(_up(self.path).query)
            limit = int((qs.get('limit') or ['100'])[0])
            snap = _mon.get_snapshot(limit=min(max(limit, 10), 500))
            self._send_json({'ok': True, **snap})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_multiagent_groupchat(self, body=None):
        """GET /api/multiagent/groupchat?limit=50 — 读取 AI 群聊房间
        POST /api/multiagent/groupchat — {sender, content} 用户手动发言"""
        try:
            import sys as _sys
            _sys.path.insert(0, os.path.join(BASE_DIR, 'server'))
            import groupchat_db as _gc
            if body is not None:
                sender = str(body.get('sender') or '👤 用户')
                content = str(body.get('content') or '').strip()
                if not content:
                    self._send_json({'ok': False, 'error': 'content 为空'}, 400)
                    return
                _gc.post(sender, '', content)
                self._send_json({'ok': True})
                return
            from urllib.parse import parse_qs, urlparse as _up
            qs = parse_qs(_up(self.path).query)
            limit = int((qs.get('limit') or ['50'])[0])
            msgs = _gc.read(limit=min(max(limit, 5), 200))
            self._send_json({'ok': True, 'messages': msgs,
                             'latest_seq': _gc.latest_seq()})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    # ==================== 角色数据库（注入角色） ====================
    def _handle_roles_get(self):
        """GET /api/roles?box=xxx — 角色列表 + 该对话当前选中角色"""
        try:
            import sys as _sys
            _sys.path.insert(0, os.path.join(BASE_DIR, 'server'))
            import roles_db as rdb
            from urllib.parse import parse_qs, urlparse as _up
            qs = parse_qs(_up(self.path).query)
            box = (qs.get('box') or [''])[0]
            sel = rdb.get_selected_role(box) if box else None
            last = rdb.get_last_selected_role()
            self._send_json({'ok': True, 'roles': rdb.list_roles(),
                             'groups': rdb.get_groups(),
                             'selected': rdb.get_selected_map(),
                             'selected_id': (sel or {}).get('id', '') if sel else '',
                             'selected_avatar': (sel or {}).get('avatar', '') if sel else '',
                             'selected_name': (sel or {}).get('name', '') if sel else '',
                             'last_id': (last or {}).get('id', '') if last else ''})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_roles_post(self):
        """POST /api/roles
        action=list / create / update / delete / select
        create/update: {name, prompt, avatar, id}
        select: {box, role_id}（role_id 空 = 取消注入）
        """
        try:
            import sys as _sys
            _sys.path.insert(0, os.path.join(BASE_DIR, 'server'))
            import roles_db as rdb
            body = self._read_body()
            act = str(body.get('action') or 'list')
            if act == 'create':
                r = rdb.add_role(body.get('name'), body.get('prompt'),
                                 body.get('avatar'), body.get('chat_skin'))
                self._send_json({'ok': bool(r), 'role': r})
            elif act == 'update':
                r = rdb.update_role(body.get('id'), body.get('name'),
                                    body.get('prompt'), body.get('avatar'),
                                    body.get('chat_skin'))
                self._send_json({'ok': bool(r), 'role': r})
            elif act == 'delete':
                self._send_json({'ok': rdb.delete_role(body.get('id'))})
            elif act == 'select':
                rdb.select_role(body.get('box'), body.get('role_id'))
                sel = rdb.get_selected_role(body.get('box'))
                self._send_json({'ok': True, 'selected': sel})
            elif act == 'group_add':
                # 新建角色分组：{name}
                g = rdb.add_group(str(body.get('name') or '').strip()[:40])
                self._send_json({'ok': bool(g), 'group': g})
            elif act == 'group_rename':
                self._send_json({'ok': bool(rdb.rename_group(body.get('id'), str(body.get('name') or '').strip()[:40]))})
            elif act == 'group_delete':
                self._send_json({'ok': rdb.delete_group(body.get('id'))})
            elif act == 'group_move':
                # 拖拽排序：{id, before_id}
                self._send_json({'ok': rdb.move_group(body.get('id'), body.get('before_id'))})
            elif act == 'role_move':
                # 角色拖拽排序：{id, before_id}
                self._send_json({'ok': rdb.move_role(body.get('id'), body.get('before_id'))})
            elif act == 'group_assign':
                # 角色进/出组：{role_id, group_id}（group_id 空 = 出组）
                self._send_json({'ok': rdb.assign_role_group(body.get('role_id'), body.get('group_id'))})
            elif act == 'top':
                # 置顶/取消置顶：{id, top}
                self._send_json({'ok': rdb.set_role_top(body.get('id'), bool(body.get('top')))})
            elif act == 'group_set':
                # 群聊模式配置：{box, enabled, host_id, member_ids:[...]}
                try:
                    rdb.set_group(body.get('box'), bool(body.get('enabled')),
                                  body.get('host_id'), body.get('member_ids') or [])
                    self._send_json({'ok': True, 'group': rdb.get_group(body.get('box'))})
                except Exception as e2:
                    self._send_json({'ok': False, 'error': str(e2)}, 500)
            elif act == 'group_get':
                self._send_json({'ok': True, 'group': rdb.get_group(body.get('box'))})
            elif act == 'collab_get':
                # 协作配置一次拉全：群聊 + 流水线
                _b = body.get('box')
                self._send_json({'ok': True, 'group': rdb.get_group(_b),
                                 'pipeline': rdb.get_pipeline(_b) or []})
            elif act == 'pipeline_set':
                # 流水线配置：{box, role_ids:[...]}（空列表=关闭）
                try:
                    rdb.set_pipeline(body.get('box'), body.get('role_ids') or [])
                    self._send_json({'ok': True})
                except Exception as e2:
                    self._send_json({'ok': False, 'error': str(e2)}, 500)
            elif act == 'pipeline_get':
                ids = rdb.get_pipeline(body.get('box')) or []
                self._send_json({'ok': True, 'role_ids': ids})
            elif act == 'ai_fill':
                # AI 根据角色名自动生成描述/提示词草稿（人工再修改确认）
                name = str(body.get('name') or '').strip()[:60]
                hint = str(body.get('hint') or '').strip()[:200]
                if not name:
                    self._send_json({'ok': False, 'error': '请先填写角色名'})
                    return
                try:
                    from brain.main_brain import _call_llm

                    def _clean_desc(t):
                        """清洗 AI 返回：去引号/前缀/markdown，按句截断"""
                        t = str(t or '').strip().strip('`"\'“”‘’').strip()
                        for p in ('描述：', '描述:', '角色描述：', '简介：', '说明：'):
                            if t.startswith(p):
                                t = t[len(p):].strip()
                        t = t.replace('*', '').replace('#', '').strip()
                        # 兜底：去掉夹带的英文单词/字母片段（保留中文、数字与常用标点）
                        t = re.sub(r'[A-Za-z]+', ' ', t)
                        t = re.sub(r'\s{2,}', ' ', t).strip(' ,.;:~·-—… ')
                        # 超长时按中文句号/问号截到第一句（最多80字）
                        if len(t) > 80:
                            cut = -1
                            for ch in ('。', '！', '？', '；'):
                                i = t.find(ch)
                                if i != -1 and (cut == -1 or i < cut):
                                    cut = i
                            if cut != -1 and cut + 1 <= 80:
                                t = t[:cut + 1]
                            else:
                                t = t[:80]
                        return t.strip()

                    def _is_ok(t):
                        """要求：非空、以中文为主、长度合理"""
                        if not t or len(t) < 4 or len(t) > 120:
                            return False
                        zh = sum(1 for c in t if '\u4e00' <= c <= '\u9fff')
                        return zh >= max(4, int(len(t) * 0.5))

                    def _gen_desc():
                        sys_p = ('你是角色设定助手。用户给你一个角色名，请用简体中文写一句该角色的描述，'
                                 '要求：\n'
                                 '1. 必须全部使用简体中文，禁止输出英文单词或英文字母；\n'
                                 '2. 严格控制在 20~50 个汉字；\n'
                                 '3. 概括角色的身份定位、性格特点和说话风格；\n'
                                 '4. 只输出这一句中文描述，不要解释、不要引号、不要列表、不要任何前缀。')
                        user_p = '角色名：%s' % name + (('\n补充要求：%s' % hint) if hint else '')
                        return _call_llm(BASE_DIR,
                                         [{'role': 'system', 'content': sys_p},
                                          {'role': 'user', 'content': user_p}],
                                         max_tokens=200,
                                         temperature=0.7)

                    text = _clean_desc(_gen_desc())
                    # 结果不合格（偏英文/过长/为空）时最多重试 2 次，共 3 次
                    for _ in range(2):
                        if _is_ok(text):
                            break
                        text = _clean_desc(_gen_desc())
                    if text and _is_ok(text):
                        self._send_json({'ok': True, 'prompt': text})
                    elif text:
                        self._send_json({'ok': False, 'error': 'AI 多次生成都未达标，请点"AI 生成"再试一次'})
                    else:
                        self._send_json({'ok': False, 'error': '模型返回为空，请检查模型配置（是否已选择默认模型）'})
                except Exception as e2:
                    self._send_json({'ok': False, 'error': 'AI 生成失败：%s' % e2})
            else:
                self._send_json({'ok': True, 'roles': rdb.list_roles()})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    # ==================== 主脑（Main Brain） ====================
    def _handle_brain_state(self):
        """GET /api/brain/state — 运行状态 + 消息流"""
        try:
            import sys as _sys
            _sys.path.insert(0, os.path.join(BASE_DIR, 'server'))
            from brain.main_brain import get_state
            self._send_json(get_state(BASE_DIR))
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_brain_chat(self):
        """POST /api/brain/chat {text} — 与主脑对话（独立会话）"""
        try:
            import sys as _sys
            _sys.path.insert(0, os.path.join(BASE_DIR, 'server'))
            from brain.main_brain import brain_chat
            body = self._read_body()
            # 优先用前端传来的真实项目路径，防止误落到应用根仓库（多项目误建分支防护）
            _pp = str((body or {}).get('_project_path') or '').strip()
            _brain_base = _pp if (_pp and os.path.isdir(_pp)) else BASE_DIR
            self._send_json(brain_chat(_brain_base, body.get('text')))
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_brain_control(self):
        """POST /api/brain/control {paused, auto_report}"""
        try:
            import sys as _sys
            _sys.path.insert(0, os.path.join(BASE_DIR, 'server'))
            from brain.main_brain import brain_control
            body = self._read_body()
            self._send_json(brain_control(BASE_DIR,
                           body.get('paused'), body.get('auto_report'),
                           body.get('interval')))
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_brain_summary(self):
        """POST /api/brain/summary — 手动触发一次总结"""
        try:
            import sys as _sys
            _sys.path.insert(0, os.path.join(BASE_DIR, 'server'))
            from brain.main_brain import request_manual_summary
            self._send_json(request_manual_summary(BASE_DIR))
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_brain_report(self):
        """GET /api/brain/report — 最近一次主脑总结报告（供一键复制）"""
        try:
            import sys as _sys, json as _json
            _sys.path.insert(0, os.path.join(BASE_DIR, 'server'))
            # 优先内存态，其次读 summaries.jsonl 尾部
            try:
                from brain.main_brain import get_memory_report
                self._send_json(get_memory_report(BASE_DIR))
                return
            except ImportError: logging.debug("swallow", exc_info=True)
            path = os.path.join(BASE_DIR, 'private', 'brain', 'summaries.jsonl')
            if os.path.exists(path):
                last = None
                with open(path, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            try:
                                last = _json.loads(line)
                            except Exception:
                                logging.debug("swallow", exc_info=True)
                if last:
                    self._send_json({'ok': True, 'time': last.get('time', ''),
                                     'text': last.get('text', ''), 'why': last.get('why', '')})
                    return
            self._send_json({'ok': True, 'text': '', 'time': ''})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)
