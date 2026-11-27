# -*- coding: utf-8 -*-
"""mixin_notes.py —— i记事本 API（M-N1）
GET  /api/notes          -> {ok, notes:[{id,title,content,createdAt,updatedAt}]}
POST /api/notes          -> {title,content, id?, deleted?} 保存/新建/删除
存储：server/data/notes.json（简单 JSON 落盘，含 .bak 轮换备份）
"""
import json
import os
import threading
import time

_notes_lock = threading.Lock()


class MixinNotes:

    def _notes_store(self):
        here = os.path.dirname(os.path.abspath(__file__))
        data_dir = os.path.normpath(os.path.join(here, '..', 'data'))
        os.makedirs(data_dir, exist_ok=True)
        return os.path.join(data_dir, 'notes.json')

    def _notes_load(self):
        try:
            with open(self._notes_store(), 'r', encoding='utf-8') as f:
                d = json.load(f)
                return d if isinstance(d, list) else []
        except Exception:
            return []

    def _notes_save(self, notes):
        path = self._notes_store()
        # 简单 .bak 轮换：写前备份旧文件
        try:
            if os.path.isfile(path):
                with open(path, 'r', encoding='utf-8') as f:
                    old = f.read()
                with open(path + '.bak', 'w', encoding='utf-8') as f:
                    f.write(old)
        except Exception:
            pass
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(notes, f, ensure_ascii=False, indent=1)

    def _handle_notes_get(self):
        with _notes_lock:
            notes = self._notes_load()
        # 按更新时间倒序
        notes.sort(key=lambda n: n.get('updatedAt', 0), reverse=True)
        self._send_json({'ok': True, 'notes': notes})

    def _handle_notes_post(self, body):
        if not isinstance(body, dict):
            return self._send_json({'ok': False, 'err': 'bad body'}, 400)
        nid = str(body.get('id') or '')
        title = str(body.get('title') or '').strip()[:100]
        content = str(body.get('content') or '')
        if len(content) > 500000:
            return self._send_json({'ok': False, 'err': 'content too large'}, 413)
        now = int(time.time() * 1000)
        with _notes_lock:
            notes = self._notes_load()
            if body.get('deleted'):
                notes = [n for n in notes if n.get('id') != nid]
            elif nid:
                hit = None
                for n in notes:
                    if n.get('id') == nid:
                        hit = n
                        break
                if hit:
                    hit['title'] = title
                    hit['content'] = content
                    hit['updatedAt'] = now
                else:
                    notes.append({'id': nid, 'title': title, 'content': content,
                                  'createdAt': now, 'updatedAt': now})
            else:
                nid = 'n%d' % int(now * 1000 + len(notes))
                notes.append({'id': nid, 'title': title or '未命名', 'content': content,
                              'createdAt': now, 'updatedAt': now})
            try:
                self._notes_save(notes)
            except Exception as e:
                return self._send_json({'ok': False, 'err': 'save failed: %s' % e}, 500)
        self._send_json({'ok': True, 'id': nid})
