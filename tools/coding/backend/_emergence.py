#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
_emergence - 涌现侦测器（P2 灵魂：task_complete 旁路自动触发）

设计准绳：docs/能力涌现系统-策划案.md v2.7 §10.3
范式照抄 _memory_tools.maybe_stage_summary —— 攒满 N 次任务才侦测一次，防刷屏；
开关 off 完全跳过（与 capability_tree.emerge 共用 settings.emerge_enabled）。
严格 try/except 静默，绝不阻塞收尾。

MVP 启发式侦测：从 task_complete 的 message/scope 提炼候选能力名（首行截断），
挂到该 subject 的根 seed 主干下，建 status=sprout/clarity=0.1 候选节点，
写 emergence_event(kind='emerge', notified=0) 入待确认队列。
后续可升级为接 LLM 语义抽取，本层先跑通"自动攒→自动生候选→等 confirm"闭环。
"""
import os
import re
import time
import sqlite3
import importlib

TOOL_NAME = '_emergence'


def _ct():
    """复用 capability_tree 的连接/建表，避免 DDL 漂移。"""
    from tools.coding.backend import capability_tree as ct
    return ct


def _get_setting(c, key, default=''):
    r = c.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    return r['value'] if r else default


def _set_setting(c, key, value):
    c.execute('INSERT INTO settings(key,value) VALUES(?,?) '
              'ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, str(value)))


def _clean_name(text):
    """从任务总结里提炼候选能力名：取首个非空行，去 markdown 标记，截断。"""
    if not text:
        return ''
    for line in str(text).split('\n'):
        s = re.sub(r'^[\s>#*\-•·]+', '', line).strip()
        if s:
            return s[:24]
    return ''


def record_task(ctx, body, threshold=3):
    """task_complete 收尾旁路钩子：攒满 threshold 次任务自动侦测一次涌现候选。
    返回 (候选事件数 or None)。开关 off / 攒不够 / 无候选 → 静默返回 None。"""
    ct = None
    try:
        ct = _ct()
        # 方案A：reload 确保拿到 capability_tree 最新的 _render_emerge 落盘函数
        # （server 进程可能缓存旧版模块，不 reload 则新建的辅助函数不可见）
        try:
            importlib.reload(ct)
        except Exception:
            pass
        ct._init(ctx)
        c = ct._conn(ctx)
        try:
            # ① 开关门控：off 完全跳过（不计数，与手动 emerge 同语义）
            if _get_setting(c, 'emerge_enabled', 'on') == 'off':
                return None

            # ② 攒满 N 计数：未满则只累加，返回
            cnt = int(_get_setting(c, 'emerge_task_count', '0') or '0')
            cnt += 1
            thr = int(_get_setting(c, 'emerge_threshold', str(threshold)) or threshold)
            if cnt < thr:
                _set_setting(c, 'emerge_task_count', cnt)
                c.commit()
                return None
            # 到阈值：清零计数，本批侦测一次
            _set_setting(c, 'emerge_task_count', 0)

            # ③ 解析归属 subject
            # 方案A：统一归到一棵全局涌现树，不再按对话 chat_id 分树
            # （旧行为：每个对话各建一棵 cb-xxx 能力树，候选与画布 project.tree.json 割裂，
            #  画布永远看不到候选 → 用户体感"科技树不更新"）。
            st = 'project'
            sid = '_emergence'

            # ④ 找根节点（depth=0 主干）；没有则建一个 project 种子主干
            root = c.execute(
                'SELECT id,path,depth FROM capability '
                'WHERE subject_type=? AND subject_id=? AND parent_id IS NULL '
                'ORDER BY id LIMIT 1', (st, sid)).fetchone()
            t = time.time()
            if not root:
                rtext = '涌现能力总树' if sid == '_emergence' else (sid or '项目') + '能力树'
                cur = c.execute(
                    'INSERT INTO capability(subject_type,subject_id,parent_id,text,path,depth,'
                    'clarity,status,icon,kind,binds,created_at,updated_at)'
                    ' VALUES(?,?,NULL,?,?,0,0.5,\'seed\',\'\',\'capability\',\'\',?,?)',
                    (st, sid, rtext, rtext, t, t))
                c.commit()
                root = {'id': cur.lastrowid, 'path': rtext, 'depth': 0}

            # ⑤ 提炼候选名（message 优先，回落 scope）
            cand = _clean_name(body.get('message') or body.get('scope') or '')
            if not cand:
                c.commit()
                return None
            # ⑥ 去重：同 subject 下已有同名未确认候选 → 不重复建
            dup = c.execute(
                'SELECT id FROM capability WHERE subject_type=? AND subject_id=? '
                'AND text=? AND status=\'sprout\'', (st, sid, cand)).fetchone()
            if dup:
                c.commit()
                return None

            # ⑦ 建候选节点（挂根下，sprout/0.1 萌芽）
            depth = root['depth'] + 1
            path = cand if not root['path'] else (root['path'] + '/' + cand)
            cur = c.execute(
                'INSERT INTO capability(subject_type,subject_id,parent_id,text,path,depth,'
                'clarity,status,icon,kind,binds,created_at,updated_at)'
                ' VALUES(?,?,?,?,?,?,0.1,\'sprout\',\'\',\'capability\',\'\',?,?)',
                (st, sid, root['id'], cand, path, depth, t, t))
            c.commit()
            cid = cur.lastrowid
            # ⑧ 写待确认事件（notified=0，进 emerge_pending 队列）
            detail = '任务收尾自动侦测：从【%s】涌现【%s】' % (root['path'], cand)
            c.execute(
                'INSERT INTO emergence_event(cap_id,kind,delta_clarity,detail,notified,created_at)'
                ' VALUES(?,?,0.05,?,0,?)', (cid, 'emerge', detail, t))
            c.commit()
            pending = c.execute(
                'SELECT COUNT(*) n FROM emergence_event WHERE kind=\'emerge\' AND notified=0'
            ).fetchone()['n']
            # 方案A：建候选后立即落盘全局涌现树 → 画布经 liveTick(2s) 自动长出候选球
            try:
                ct._render_emerge(c, ctx)
            except Exception:
                pass
            return int(pending)
        finally:
            try:
                c.close()
            except Exception:
                pass
    except Exception:
        return None
