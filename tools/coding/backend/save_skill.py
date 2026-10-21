#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""save_skill - 保存技能：把一段可复用的提示词/工作流程保存为技能包。

写入到应用根目录 extensions/skills/<id>/：
  skill.json  技能清单（spec/id/name/description/triggers/prompt 等）
  prompt.md   技能提示词正文

技能目录 mtime 变化会触发热更新，保存后立即生效，无需重启。
接收 body:
  {
    id:          技能英文标识（必填，作文件夹名，如 code_review）
    name:        技能显示名（可选，默认同 id）
    description: 一句话描述（可选）
    prompt:      提示词正文（必填；或传 prompt_file 引用已有文件内容）
    triggers:    触发关键词数组（可选）
    overwrite:   已存在时是否覆盖（默认 false，存在则报错）
  }
"""
import os
import json
import re
import time

TOOL_NAME = 'save_skill'

SKILLS_ROOT = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'extensions', 'skills'))


def handle(body, ctx):
    try:
        sid = (body.get('id', '') or '').strip()
        name = (body.get('name', '') or '').strip() or sid
        description = (body.get('description', '') or '').strip()
        prompt = (body.get('prompt', '') or '').strip()
        triggers = body.get('triggers') or []
        overwrite = bool(body.get('overwrite', False))

        if not sid or not re.match(r'^[A-Za-z0-9_\-]+$', sid):
            ctx.send_error('技能 id 只能是英文/数字/下划线/中划线，例如 code_review。当前: %r' % sid)
            return
        if not prompt:
            ctx.send_error('缺少 prompt（技能提示词正文）')
            return
        if not isinstance(triggers, list):
            triggers = [str(triggers)]

        skill_dir = os.path.join(SKILLS_ROOT, sid)
        skill_file = os.path.join(skill_dir, 'skill.json')
        if os.path.exists(skill_file) and not overwrite:
            ctx.send_error('技能已存在: %s（如需覆盖请传 overwrite: true）' % sid)
            return

        os.makedirs(skill_dir, exist_ok=True)

        skill_json = {
            'spec': 1,
            'id': sid,
            'name': name,
            'description': description or ('技能 ' + sid),
            'version': time.strftime('1.0.%Y%m%d'),
            'enabled': True,
            'prompt': 'prompt.md',
            'tools': [],
            'triggers': triggers,
            'autoInject': False
        }
        with open(skill_file, 'w', encoding='utf-8') as f:
            json.dump(skill_json, f, ensure_ascii=False, indent=2)

        prompt_path = os.path.join(skill_dir, 'prompt.md')
        with open(prompt_path, 'w', encoding='utf-8') as f:
            f.write(prompt.rstrip() + '\n')

        ctx.send_json({
            'ok': True,
            'id': sid,
            'skill_dir': skill_dir,
            'skill_file': skill_file,
            'prompt_file': prompt_path,
            'hot_reload': True
        })
    except Exception as e:
        ctx.send_error(str(e))
