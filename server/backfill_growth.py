# -*- coding: utf-8 -*-
"""
backfill_growth.py —— 历史经验回填（一次性脚本）
读 server/data/zf_data.db 的 task_stats，按 success 统计回填经验。
用法：pythonw backfill_growth.py
幂等：只在 user_growth.json 无 backfilled 标记时执行一次。
"""
import json, os, sqlite3, sys

HERE = os.path.dirname(os.path.abspath(__file__))
# 与 config.DB_PATH 同源：private/db/zf3d_canvas.db
try:
    sys.path.insert(0, HERE)
    from config import DB_PATH as _DB
except Exception:
    _DB = os.path.abspath(os.path.join(HERE, '..', 'private', 'db', 'zf3d_canvas.db'))
DB = _DB
GF = os.path.join(HERE, 'data', 'user_growth.json')

def main():
    try:
        with open(GF, 'r', encoding='utf-8') as f:
            st = json.load(f)
    except Exception:
        st = {}
    if st.get('backfilled'):
        print('[backfill] already done, skip')
        return
    done = fail = 0
    try:
        conn = sqlite3.connect(DB)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*), SUM(success) FROM task_stats WHERE COALESCE(task_title,'') <> ''")
        total, ok = cur.fetchone()
        conn.close()
        done = int(ok or 0)
        fail = int((total or 0) - done)
    except Exception as e:
        print('[backfill] db read err:', e)
        return
    exp = done * 20  # 与 task_complete 事件同价
    st['exp'] = st.get('exp', 0) + exp
    st.setdefault('events', {})
    st['events']['task_complete'] = st['events'].get('task_complete', 0) + done
    st['events']['task_fail'] = st['events'].get('task_fail', 0) + fail
    st['backfilled'] = True
    os.makedirs(os.path.dirname(GF), exist_ok=True)
    tmp = GF + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(st, f, ensure_ascii=False, indent=1)
    os.replace(tmp, GF)
    print(f'[backfill] done: tasks={done} fail={fail} exp+={exp}')

if __name__ == '__main__':
    main()
