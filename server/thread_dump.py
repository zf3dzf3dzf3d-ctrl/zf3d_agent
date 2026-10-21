# -*- coding: utf-8 -*-
# 【S2 2026-10-17】线程栈抓取工具（死锁/卡死"抓现场"能力，策划案-疑难bug排查机制改造 S2）
# 用法：python thread_dump.py [--pid N]；输出 server/logs/thrdump_<ts>.txt
# 三级降级：py-spy（外部进程）→ faulthandler.dump_traceback → sys._current_frames 摘要
import sys, os, time, argparse

LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')


def _dump_py_spy(pid):
    try:
        import subprocess
        r = subprocess.run(['py-spy', 'dump', '--pid', str(pid)],
                           capture_output=True, text=True, timeout=30,
                           encoding='utf-8', errors='replace',
                           creationflags=0x08000000 if os.name == 'nt' else 0)
        if r.returncode == 0 and r.stdout.strip():
            return '[py-spy dump]\n' + r.stdout
    except (FileNotFoundError, OSError, Exception):
        pass  # py-spy 未安装/超时，降级
    return None


def _dump_faulthandler(pid):
    try:
        if pid and pid != os.getpid():
            # 跨进程：faulthandler 只能抓自己，跨进程交给 _current_frames 摘要
            return None
        # faulthandler 要求真实文件对象（有 fileno），StringIO 不支持 → 先写临时文件再读回
        import faulthandler, tempfile
        with tempfile.TemporaryFile(mode='w+', encoding='utf-8') as tf:
            faulthandler.dump_traceback(file=tf)
            tf.seek(0)
            return '[faulthandler.dump_traceback]\n' + tf.read()
    except ImportError:
        return None


def _dump_current_frames(pid):
    import threading, traceback
    lines = ['[sys._current_frames 摘要] pid=%s' % pid]
    frames = sys._current_frames()
    for t in threading.enumerate():
        fid = t.ident
        fr = frames.get(fid)
        lines.append('\n=== 线程 %s (ident=%s, daemon=%s) ===' % (t.name, fid, t.daemon))
        if fr:
            lines.extend(traceback.format_stack(fr))
        else:
            lines.append('  (无栈帧信息)')
    return '\n'.join(lines)


def dump(pid=None):
    pid = pid or os.getpid()
    os.makedirs(LOG_DIR, exist_ok=True)
    ts = time.strftime('%Y%m%d_%H%M%S')
    out_path = os.path.join(LOG_DIR, 'thrdump_%s.txt' % ts)
    parts = ['线程栈抓取 @ %s  pid=%s' % (time.strftime('%Y-%m-%d %H:%M:%S'), pid)]
    got = _dump_py_spy(pid) or _dump_faulthandler(pid) or _dump_current_frames(pid)
    parts.append(got)
    content = '\n\n'.join(parts)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(content)
    return out_path, content


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--pid', type=int, default=None)
    a = ap.parse_args()
    p, c = dump(a.pid)
    print('已写入: %s' % p)
    print(c[:3000])
