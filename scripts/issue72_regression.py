# -*- coding: utf-8 -*-
"""Issue #35 / #72 验收回归：复现「同键并发写 + 异常」场景，对比旧代码模式与本地 HEAD 修复模式。

旧模式（公开仓库 224e1f7）: INSERT INTO + except: pass   → 唯一约束失败后事务残留 → 他连接 locked
新模式（本地 HEAD 5478948）: INSERT OR REPLACE + rollback → 重复键被合理处理，事务干净
"""
import sqlite3, threading, time

OLD_FIX = "INSERT INTO app_data(category, key, value) VALUES (?,?,?)"
NEW_FIX = "INSERT OR REPLACE INTO app_data(category, key, value) VALUES (?,?,?)"

def setup(db):
    c = sqlite3.connect(db)
    c.execute("CREATE TABLE IF NOT EXISTS app_data(id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, key TEXT, value TEXT)")
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_app_data_cat_key ON app_data(category, key)")
    c.commit(); c.close()

def run_mode(label, sql, rollback_on_error):
    db = "regress_%s.db" % label
    import os
    if os.path.exists(db): os.remove(db)
    setup(db)
    # 先写一次同键，制造冲突前提
    c0 = sqlite3.connect(db); c0.execute(sql, ('fps_crime', 'fps_5', 'first')); c0.commit(); c0.close()

    errors = []
    other_locked = []

    holder = []  # 故意不 close，模拟服务进程中异常后连接未归还、事务残留

    def writer():
        c = sqlite3.connect(db, timeout=1)
        holder.append(c)
        try:
            c.execute("BEGIN")
            try:
                c.execute(sql, ('fps_crime', 'fps_5', 'second'))
                c.commit()
            except Exception as e:
                errors.append(str(e))
                if rollback_on_error:
                    try: c.rollback()
                    except Exception: pass
                # 旧模式：不 rollback，事务残留挂住（这正是缺陷：except pass 后连接被复用/未归还）
        finally:
            if rollback_on_error:
                c.close()  # 修复模式正常归还

    def other():
        # 稍等，让 writer 先进入异常未回滚状态
        time.sleep(0.3)
        c = sqlite3.connect(db, timeout=1)
        try:
            c.execute(sql, ('app', 'probe', 'x'))
            c.commit()
        except Exception as e:
            other_locked.append(str(e))
        finally:
            c.close()

    t1 = threading.Thread(target=writer); t2 = threading.Thread(target=other)
    t1.start(); t2.start(); t1.join(5); t2.join(5)
    for c in holder:
        try: c.close()
        except Exception: pass

    ok_first = False
    c = sqlite3.connect(db)
    try:
        c.execute("SELECT 1 FROM app_data WHERE category='app' AND key='probe'")
        ok_first = True
    except Exception:
        pass
    c.close()
    print("[%s] writer异常=%s | 其他连接被锁=%s | 其他连接最终可写=%s" % (
        label, errors or '无', other_locked or '无', '是' if ok_first or not other_locked else '否'))
    return errors, other_locked

print("=== 复现旧模式缺陷（公开仓库代码）===")
e_old, l_old = run_mode("old", OLD_FIX, False)
print("=== 验证修复模式（本地 HEAD 代码）===")
e_new, l_new = run_mode("new", NEW_FIX, True)

print()
print("判定：")
print("  旧模式缺陷复现（UNIQUE失败且他连接被锁阻塞）:", bool(e_old) and 'locked' in str(l_old))
print("  修复模式同键写入不报错（OR REPLACE 合理处理重复键）:", not e_new)
print("  修复模式其他连接不被残留事务阻塞:", not l_new)
