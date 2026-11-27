#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""util_key_reveal_dialog.py - 在桌面上弹出原生窗口，设置或修改“查看密钥密码”（独立子进程）。

由 util_key_reveal.start_dialog() 拉起，不随服务进程的请求线程运行：
  - 密码只在本地窗口里输入、在本进程内完成哈希与落盘，不经过任何网络接口；
  - Tk 的生命周期局限在本进程，窗口卡死或崩溃不影响服务；
  - 智能体的 HTTP 请求没法替用户往原生窗口里输入——这正是“首设必须走原生窗口”的意义。

用法：python util_key_reveal_dialog.py --mode setup | change
退出码：0 已设置 / 1 用户取消或超时 / 2 出错
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import util_key_reveal as kr  # noqa: E402

TIMEOUT_MS = 180 * 1000        # 3 分钟无操作自动关闭


def main():
    mode = 'setup'
    if '--mode' in sys.argv:
        i = sys.argv.index('--mode')
        mode = sys.argv[i + 1] if i + 1 < len(sys.argv) else 'setup'
    changing = kr.is_configured() or mode == 'change'
    try:
        import tkinter as tk
        from tkinter import ttk, messagebox
    except ImportError:
        return 2

    root = tk.Tk()
    root.title('朱峰智能体无限 · 查看密钥密码')
    root.resizable(False, False)
    root.attributes('-topmost', True)
    root.lift()
    root.focus_force()

    frame = ttk.Frame(root, padding=22)
    frame.grid(sticky='nsew')
    ttk.Label(frame, text='修改查看密钥密码' if changing else '设置查看密钥密码',
              font=('Microsoft YaHei UI', 14, 'bold')).grid(column=0, row=0, columnspan=2, sticky='w')
    ttk.Label(frame, text='在设置页查看明文 API Key 时需要输入这个密码。\n'
                          '它只保存在本机（只存哈希），请牢记；修改时需要先输入当前密码。',
              justify='left').grid(column=0, row=1, columnspan=2, sticky='w', pady=(10, 16))

    row = 2
    cur_var = new_var = chk_var = None
    cur_ent = new_ent = chk_ent = None
    if changing:
        ttk.Label(frame, text='当前密码').grid(column=0, row=row, sticky='w', pady=4)
        cur_var = tk.StringVar()
        cur_ent = ttk.Entry(frame, textvariable=cur_var, show='*', width=28)
        cur_ent.grid(column=1, row=row, pady=4)
        row += 1
    ttk.Label(frame, text='新密码').grid(column=0, row=row, sticky='w', pady=4)
    new_var = tk.StringVar()
    new_ent = ttk.Entry(frame, textvariable=new_var, show='*', width=28)
    new_ent.grid(column=1, row=row, pady=4)
    row += 1
    ttk.Label(frame, text='再输一次').grid(column=0, row=row, sticky='w', pady=4)
    chk_var = tk.StringVar()
    chk_ent = ttk.Entry(frame, textvariable=chk_var, show='*', width=28)
    chk_ent.grid(column=1, row=row, pady=4)
    row += 1

    note = tk.StringVar(value='密码长度 %d 到 %d 位。' % (kr.MIN_LEN, kr.MAX_LEN))
    ttk.Label(frame, textvariable=note, foreground='#a04000').grid(column=0, row=row, columnspan=2, sticky='w', pady=(8, 4))

    result = {'code': 1}

    def on_ok():
        new_pw = new_var.get()
        if changing and not kr.verify_password(cur_var.get()):
            note.set('当前密码不正确。')
            return
        if new_pw != chk_var.get():
            note.set('两次输入的新密码不一致。')
            return
        res = kr.set_password(new_pw, replace=changing)
        if not res.get('ok'):
            note.set(res.get('error') or '设置失败')
            return
        result['code'] = 0
        try:
            messagebox.showinfo('朱峰智能体无限', '查看密钥密码已设置。回到设置页，输入这个密码即可查看明文密钥。', parent=root)
        except tk.TclError as e:
            # 密码已经设置成功；确认框弹不出来时至少在标准错误上留一句
            sys.stderr.write('[key-reveal-dialog] 密码已设置，但确认框弹出失败: %s\n' % e)
        root.destroy()

    def on_cancel():
        root.destroy()

    btns = ttk.Frame(frame)
    btns.grid(column=0, row=row + 1, columnspan=2, sticky='e', pady=(14, 0))
    ttk.Button(btns, text='取消', command=on_cancel).grid(column=0, row=0, padx=(0, 8))
    ok = ttk.Button(btns, text='保存', command=on_ok)
    ok.grid(column=1, row=0)
    ok.bind('<Return>', lambda e: on_ok())
    for ent in (cur_ent, new_ent, chk_ent):
        if ent is not None:
            ent.bind('<Return>', lambda e: on_ok())
    root.protocol('WM_DELETE_WINDOW', on_cancel)
    root.after(TIMEOUT_MS, root.destroy)
    (cur_ent if cur_ent is not None else new_ent).focus_set()
    if '--smoke' in sys.argv:
        # 自检：只确认在本解释器里能把这个窗口建出来并完成一次布局（不进入事件循环，窗口一闪即关）
        root.update_idletasks()
        root.update()
        root.destroy()
        return 0
    root.mainloop()
    return result['code']


if __name__ == '__main__':
    sys.exit(main())
