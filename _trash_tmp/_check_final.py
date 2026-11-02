# -*- coding: utf-8 -*-
import sqlite3, os, glob
root = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0"
con = sqlite3.connect(os.path.join(root, "server", "data", "memory.db"))
print("memory.db rows:", con.execute("select (select count(*) from _rows)+(select count(*) from _tables)").fetchone()[0])
con.close()
print("profiles:", os.listdir(os.path.join(root, "server", "browser_plugin", "data", "profiles")))
print("unexpected Login Data:", glob.glob(os.path.join(root, "server", "browser_plugin", "data", "profiles", "*", "Default", "Login Data")))
print("网站档案:", os.listdir(os.path.join(root, "public", "项目记录", "网站档案")))
print("brain:", os.listdir(os.path.join(root, "private", "brain")))
