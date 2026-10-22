# -*- coding: utf-8 -*-
"""
tray_monitor.py — 监控面板：一行一任务
========================================
用户设想的行式监控：
  每行 = 任务名称 + 进度条 + 工具使用数量
  点击行展开 = 最近流水详情（agent_turns 摘要）
  「还原窗口」= 打开工作台定位到该任务（用户习惯一致，回到熟悉的前台）
  「前台/后台」= 面板置顶切换（前台盯 / 后台让位）

数据源（全复用现有 API，零新依赖）：
  GET /api/jobs                → 最近任务列表（id/goal/status/created_at）
  GET /api/jobs/{id}/transcript → agent_turns 流水（统计工具数 + 展开详情）

由 quick_ask_tray.py 托盘菜单「监控面板」拉起，也可独立运行：
  python\pythonw.exe server\tray_monitor.py
"""
import os
import sys
import json
import time
import threading
import webbrowser
import urllib.request

_HERE = os.path.dirname(os.path.abspath(__file__))
_BASE = os.path.dirname(_HERE)

POLL_MS = 3000          # 列表轮询间隔
PANEL_W, PANEL_H = 460, 420

_STATUS_CN = {
    'queued': ('排队中', '#f9e2af'),
    'running': ('进行中', '#89b4fa'),
    'done': ('已完成', '#a6e3a1'),
    'ok': ('已完成', '#a6e3a1'),
    'failed': ('失败', '#f38ba8'),
    'error': ('失败', '#f38ba8'),
}


def _api_port():
    try:
        with open(os.path.join(_BASE, 'private', 'port.json'), 'r', encoding='utf-8-sig') as f:
            cfg = json.load(f)
        return int(cfg.get('api_port') or cfg.get('port') or 8000)
    except Exception:
        return 8000


def _get(path, timeout=6):
    req = urllib.request.Request('http://127.0.0.1:%d%s' % (_api_port(), path))
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8', 'replace'))


def _open_workbench():
    webbrowser.open('http://127.0.0.1:%d/' % _api_port())


def _fmt_time(ts):
    try:
        return time.strftime('%m-%d %H:%M', time.localtime(int(ts)))
    except Exception:
        return ''


def run_panel(root=None, topmost=False):
    """构建并显示监控面板。root 为托盘的 tkinter root 时共用主循环。"""
    import tkinter as tk
    from tkinter import ttk

    own_root = root is None
    if own_root:
        root = tk.Tk()
    root.title('朱峰智能体 · 任务监控')
    root.geometry('%dx%d' % (PANEL_W, PANEL_H))
    root.attributes('-topmost', topmost)
    root.configure(bg='#1e1e2e')

    # ---------- 顶栏 ----------
    top = tk.Frame(root, bg='#181825')
    top.pack(fill='x')
    tk.Label(top, text('📋 任务监控', font=('Microsoft YaHei UI', 11, 'bold'),
                       bg='#181825', fg='#cdd6f4')).pack(side='left', padx=10, pady=6)
    _pin_var = tk.BooleanVar(value=topmost)

    def _toggle_pin():
        root.attributes('-topmost', _pin_var.get())
    tk.Checkbutton(top, text='前台置顶', variable=_pin_var, command=_toggle_pin,
                   bg='#181825', fg='#a6adc8', selectcolor='#313244',
                   activebackground='#181825', activeforeground='#cdd6f4',
                   font=('Microsoft YaHei UI', 9), bd=0).pack(side='right', padx=8)
    tk.Button(top, text='工作台', command=_open_workbench, relief='flat',
              bg='#313244', fg='#cdd6f4', font=('Microsoft YaHei UI', 9),
              activebackground='#45475a', activeforeground='#cdd6f4',
              cursor='hand2').pack(side='right', padx=4)

    # ---------- 滚动列表 ----------
    canvas = tk.Canvas(root, bg='#1e1e2e', highlightthickness=0)
    sb = ttk.Scrollbar(root, orient='vertical', command=canvas.yview)
    body = tk.Frame(canvas, bg='#1e1e2e')
    body.bind('<Configure>', lambda e: canvas.configure(scrollregion=canvas.bbox('all')))
    _win = canvas.create_window((0, 0), window=body, anchor='nw')
    canvas.bind('<Configure>', lambda e: canvas.itemconfig(_win, width=e.width))
    canvas.configure(yscrollcommand=sb.set)
    canvas.pack(side='left', fill='both', expand=True)
    sb.pack(side='right', fill='y')
    canvas.bind_all('<MouseWheel>', lambda e: canvas.yview_scroll(-1 * (e.delta // 120), 'units'))

    _rows = {}       # job_id -> {'card','bar','tool_label','detail','open','expanded'}
    _expanded = set()

    def _detail_text(turns):
        lines = []
        for t in turns[-8:]:
            role = {'tool': '🔧', 'assistant': '🤖', 'user': '👤'}.get(t.get('role'), '·')
            c = (t.get('content') or '').replace('\n', ' ')[:80]
            lines.append('%s %s' % (role, c))
        return '\n'.join(lines) or '（暂无流水）'

    def _render(jobs):
        # 清理已消失的行
        for jid in list(_rows):
            if jid not in {j.get('id') for j in jobs}:
                _rows[jid]['card'].destroy()
                del _rows[jid]

        for j in jobs:
            jid = j.get('id')
            status = (j.get('status') or 'queued').lower()
            cn, color = _STATUS_CN.get(status, (status, '#a6adc8'))
            if jid not in _rows:
                card = tk.Frame(body, bg='#313244', bd=0, highlightthickness=1,
                                highlightbackground='#45475a')
                card.pack(fill='x', padx=8, pady=4)

                head = tk.Frame(card, bg='#313244')
                head.pack(fill='x')
                lbl = tk.Label(head, text='…', font=('Microsoft YaHei UI', 10, 'bold'),
                               bg='#313244', fg='#cdd6f4', anchor='w', cursor='hand2')
                lbl.pack(side='left', fill='x', expand=True, padx=(8, 4), pady=(6, 0))
                tools_lbl = tk.Label(head, text='', font=('Microsoft YaHei UI', 9),
                                     bg='#313244', fg='#a6adc8')
                tools_lbl.pack(side='right', padx=8)

                bar = ttk.Progressbar(card, mode='indeterminate', length=PANEL_W - 60)
                bar.pack(fill='x', padx=8, pady=(2, 0))

                detail = tk.Label(card, text='', font=('Microsoft YaHei UI', 9),
                                  bg='#313244', fg='#a6adc8', anchor='nw', justify='left',
                                  wraplength=PANEL_W - 90)
                open_btn = tk.Button(card, text='⬆ 还原窗口', relief='flat',
                                     bg='#45475a', fg='#cdd6f4', cursor='hand2',
                                     font=('Microsoft YaHei UI', 9),
                                     activebackground='#585b70', activeforeground='#cdd6f4',
                                     command=lambda jj=jid: _goto_job(jj))

                def _toggle(jj=jid, det=detail, ob=open_btn):
                    if jj in _expanded:
                        _expanded.discard(jj)
                        det.pack_forget(); ob.pack_forget()
                    else:
                        _expanded.add(jj)
                        det.pack(fill='x', padx=8, pady=2)
                        ob.pack(anchor='e', padx=8, pady=(0, 6))
                lbl.bind('<Button-1>', lambda e, jj=jid: _toggle())
                card._toggle = _toggle

                _rows[jid] = {'card': card, 'lbl': lbl, 'bar': bar,
                              'tools': tools_lbl, 'detail': detail, 'open': open_btn}

            r = _rows[jid]
            goal = (j.get('goal') or jid).strip().replace('\n', ' ')
            if len(goal) > 36:
                goal = goal[:36] + '…'
            r['lbl'].config(text='%s  %s · %s' % (cn, goal, _fmt_time(j.get('created_at'))))
            r['lbl'].config(fg=color)

            # 进度条：运行中=流动，完成=满，失败/排队=停
            if status in ('running', 'queued'):
                if not r['bar'].cget('mode') == 'indeterminate' or str(r['bar'].cget('value')) == '0.0':
                    r['bar'].start(12)
                r['bar'].config(mode='indeterminate')
            else:
                r['bar'].stop()
                r['bar'].config(mode='determinate', maximum=100,
                                value=100 if status in ('done', 'ok') else 0)

            # 展开：拉流水统计工具数 + 详情
            if jid in _expanded:
                threading.Thread(target=_fetch_detail, args=(jid,), daemon=True).start()

    def _goto_job(jid):
        # 还原窗口：打开工作台（用户习惯一致的前台界面）
        _open_workbench()

    def _fetch_detail(jid):
        try:
            data = _get('/api/jobs/%s/transcript' % jid, timeout=6)
            turns = data.get('turns') or []
            n_tools = sum(1 for t in turns if t.get('role') == 'tool')
            txt = '🔧 工具调用 %d 次 · 流水 %d 条\n%s' % (
                n_tools, len(turns), _detail_text(turns))
            _apply_detail(jid, n_tools, txt)
        except Exception as e:
            _apply_detail(jid, None, '（流水读取失败：%s）' % str(e)[:60])

    def _apply_detail(jid, n_tools, txt):
        def ui():
            r = _rows.get(jid)
            if not r:
                return
            if n_tools is not None:
                r['tools'].config(text='🔧 %d' % n_tools)
            r['detail'].config(text=txt)
        try:
            root.after(0, ui)
        except Exception:
            pass

    def _refresh():
        try:
            data = _get('/api/jobs?limit=100', timeout=6)
            jobs = data.get('jobs') or []
        except Exception:
            jobs = []
        try:
            root.after(0, lambda: _render(jobs))
        except Exception:
            return
        root.after(POLL_MS, _refresh)

    root.after(200, _refresh)

    # 定位到屏幕右下角
    root.update_idletasks()
    try:
        sw, sh = root.winfo_screenwidth(), root.winfo_screenheight()
        root.geometry('+%d+%d' % (sw - PANEL_W - 40, sh - PANEL_H - 80))
    except Exception:
        pass

    if own_root:
        root.mainloop()
    return root


if __name__ == '__main__':
    run_panel()
