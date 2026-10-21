# -*- coding: utf-8 -*-
import sqlite3
DB = r'C:\work\web\data\zf3d.db'
c = sqlite3.connect(DB)
c.executescript('''
CREATE TABLE IF NOT EXISTS ai_accounts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  api_token TEXT UNIQUE,
  token_hash TEXT,
  token_created_at TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS ai_usage(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  model TEXT, prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  balance_after REAL,
  source_ip TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS ai_recharge(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  order_no TEXT UNIQUE,
  amount REAL NOT NULL,
  credits REAL,
  pay_method TEXT,
  status TEXT DEFAULT 'pending',
  proof TEXT,
  admin_note TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS ai_pricing(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT UNIQUE,
  price_in REAL, price_out REAL,
  multiplier REAL DEFAULT 1.0,
  enabled INTEGER DEFAULT 1
);
''')
rows = [
    ('zhipu-glm-4.6', 1.0, 1.0, 0.2),
    ('deepseek-v3',   1.0, 1.0, 0.8),
    ('deepseek-r1',   2.0, 4.0, 1.5),
    ('gpt-4o',        10.0, 30.0, 4.0),
]
c.executemany('INSERT OR IGNORE INTO ai_pricing(model,price_in,price_out,multiplier) VALUES(?,?,?,?)', rows)
c.commit()
print('OK', [r[0] for r in c.execute("select name from sqlite_master where type='table' and name like 'ai_%'")])
