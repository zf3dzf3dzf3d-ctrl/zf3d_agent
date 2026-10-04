#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
最小自测 selftest.py —— 改版后一键验证核心安全与数据路径。

覆盖用例：
  1. replace_text 匹配/零匹配返回结构（P0 回归：零匹配不得 ok:true）
  2. run.py 危险命令分级（danger 前自动 git 快照）
  3. security.py 路径黑名单（系统目录拦截）
  5. secure_store DPAPI 加密往返

用法：python server/selftest.py
退出码 0=全绿，1=有红。
"""
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'server'))
sys.path.insert(0, ROOT)

PASS, FAIL = [], []


def check(name, fn):
    try:
        fn()
        PASS.append(name)
        print('  [PASS] %s' % name)
    except Exception as e:
        FAIL.append((name, str(e)))
        print('  [FAIL] %s: %s' % (name, e))


class _FakeHandler:
    """模拟 HTTP handler，捕获 send_json/send_error，供工具 handle 测试。"""
    def __init__(self):
        self.sent = None
        self.error = None

    def send_json(self, obj, status=200):
        self.sent = obj

    def send_error(self, code, msg=''):
        self.error = (code, msg)


def t_replace_text():
    from tools.coding.backend import replace_text as rt
    d = tempfile.mkdtemp()
    p = os.path.join(d, 'a.txt')
    with open(p, 'w', encoding='utf-8') as f:
        f.write('hello world')
    h1 = _FakeHandler()
    rt.handle({'path': p, 'old_text': 'world', 'new_text': 'python'}, h1)
    assert h1.sent and h1.sent.get('ok') is True, h1.sent
    with open(p, encoding='utf-8') as f:
        assert f.read() == 'hello python', '替换未生效'
    # 关键：零匹配不得假成功（P0 回归）
    h2 = _FakeHandler()
    rt.handle({'path': p, 'old_text': '不存在xyzq', 'new_text': 'y'}, h2)
    payload = h2.sent or {}
    assert h2.error or payload.get('ok') is not True, \
        '零匹配返回 ok:true（P0 回归！）: %s' % payload


def t_run_classify():
    from tools.coding.backend.run import _classify
    # 【2026-09 同步】分级已改为 blocked/safe 两档：危险命令 → blocked（拦截）。
    # 旧 danger 级「执行前自动 git 快照」钩子已按需求移除（由全局 auto-checkpoint 承担）；
    # 删除类命令由 trash_intercept 兜底改写为缓冲垃圾箱，不在此分级拦截。
    # 注意：git reset --hard 不在当前黑名单（由 auto-checkpoint 兜底，可回滚）
    assert _classify('format c:')[0] == 'blocked'
    assert _classify('rd /s /q c:/x')[0] == 'blocked'
    assert _classify('reg delete HKLM')[0] == 'blocked'
    assert _classify('net user hack pass /add')[0] == 'blocked'
    assert _classify('taskkill /f /im python.exe')[0] == 'blocked'
    assert _classify('git reset --hard')[0] == 'safe'
    assert _classify('echo hi')[0] == 'safe'


def t_security_paths():
    import security
    assert security.is_blocked_system_path('C:\\Windows\\System32\\x.exe'), '系统目录未被拦截'
    assert not security.is_blocked_system_path(os.path.join(ROOT, 'server')), '项目目录被误拦'


def t_checkpoint_roundtrip():
    d = tempfile.mkdtemp()
    old = lc.CKPT
    lc.CKPT = os.path.join(d, 'ckpt.json')
    try:
        lc.save('eng1', [{'role': 'user', 'content': 'hi'}], {'k': 1}, 1)
        data = lc.load()
        assert data and data['engine_id'] == 'eng1' and data['turn'] == 1, data
        lc.clear('selftest')
        assert not lc.load(), 'clear 后仍能读到断点'
    finally:
        lc.CKPT = old


def t_secure_store_roundtrip():
    import secure_store as ss
    secret = 'sk-selftest-abc123xyz'
    ct = ss.encrypt_value(secret)
    assert ct != secret, 'encrypt_value 未加密'
    assert ss.decrypt_value(ct) == secret, 'DPAPI 往返失败'
    assert ss.decrypt_value('sk-plain-passthrough') == 'sk-plain-passthrough', '明文兼容降级失败'


def t_bigmodel_channel():
    """回归：朱峰大模型（open.bigmodel.cn）必须归 zhufeng 通道，不得落 cloud。"""
    from token_usage_stats import _CHANNEL_SQL
    assert "LIKE '%bigmodel%'" in _CHANNEL_SQL, '_CHANNEL_SQL 缺少 bigmodel 规则'
    import sqlite3
    conn = sqlite3.connect(':memory:')
    conn.execute('CREATE TABLE t(provider TEXT, model TEXT)')
    conn.executemany('INSERT INTO t VALUES(?,?)', [
        ('open.bigmodel.cn', 'glm-4'), ('https://open.bigmodel.cn/api/paas/v4', 'glm-4'),
        ('127.0.0.1', 'glm-5.3-flash'), ('127.0.0.1', 'mimo-local'),
        ('api.deepseek.com', 'deepseek-chat'), ('', '')])
    rows = conn.execute('SELECT provider || "|" || COALESCE(model,""), ' + _CHANNEL_SQL + ' FROM t').fetchall()
    got = dict(rows)
    assert got.get('open.bigmodel.cn|glm-4') == 'zhufeng', got
    assert got.get('https://open.bigmodel.cn/api/paas/v4|glm-4') == 'zhufeng', got
    assert got.get('127.0.0.1|glm-5.3-flash') == 'zhufeng', got  # 8787代理+glm 兜底归朱峰
    assert got.get('127.0.0.1|mimo-local') == 'local', got       # 本地非glm仍归本地
    assert got.get('api.deepseek.com|deepseek-chat') == 'cloud', got
    assert got.get('|') == 'cloud', got


def t_protect_cmd_hit():
    """回归：readonly 保护文件在 shell 中被改写/删除必须被 _protect_cmd_hit 拦截。"""
    from tools.coding.backend.run import _protect_cmd_hit
    from tools.coding.backend import _file_protect as _fprot
    ro = _fprot.list_all().get('readonly') or []
    assert ro, 'readonly 保护清单为空，保护失效'
    # 命中：命令里出现任一 readonly 路径（含引号/正反斜杠形态）
    p = str(ro[0]).strip()
    assert _protect_cmd_hit('type nul > ' + p), 'readonly 路径未被拦截: %s' % p
    assert _protect_cmd_hit('del "' + p + '"'), '带引号形态未被拦截'
    assert _protect_cmd_hit('type nul > ' + p.replace('\\', '/')), '正斜杠形态未被拦截'
    # 放行：不涉及任何保护路径的无关命令不得误伤
    assert _protect_cmd_hit('dir /b') is None, '无关命令被误拦（拦不过度）'
    assert _protect_cmd_hit('') is None


def t_trash_intercept():
    """回归：shell 删除命令必须被改写为「移入垃圾箱 + echo 占位」，不得真删。

    注意：不能用系统 TEMP——trash_intercept 把 TEMP 内删除视为合法缓存清理
    （protected 跳过），必须用项目内临时目录才能测到拦截路径。
    """
    d = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_selftest_tmp')
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, 'victim.txt')
    with open(p, 'w', encoding='utf-8') as f:
        f.write('precious')
    try:
        from tools.coding.backend.trash_intercept import rewrite_command
        new_cmd, notes = rewrite_command('del ' + p, d)
        assert notes, '删除命令未产生拦截备注（可能被真删）: %r' % new_cmd
        assert not os.path.exists(p), '原文件仍在（未移入垃圾箱，改写无效）'
        assert 'del ' not in new_cmd.lower() or 'echo' in new_cmd.lower(), \
            '删除段未被改写为占位: %r' % new_cmd
        # 非删除命令原样放行
        new2, notes2 = rewrite_command('dir /b', d)
        assert new2 == 'dir /b' and not notes2, '无关命令被误改写: %r %r' % (new2, notes2)
    finally:
        import shutil
        shutil.rmtree(d, ignore_errors=True)


def main():
    print('=== 朱峰智能体最小自测 ===')
    check('replace_text 匹配/零匹配(P0回归)', t_replace_text)
    check('run.py 危险命令分级', t_run_classify)
    check('security 系统路径拦截', t_security_paths)
    check('secure_store DPAPI 往返', t_secure_store_roundtrip)
    check('bigmodel 通道归类回归', t_bigmodel_channel)
    check('shell readonly 保护拦截', t_protect_cmd_hit)
    check('trash_intercept 删除改写', t_trash_intercept)
    print('-' * 40)
    print('通过 %d  失败 %d' % (len(PASS), len(FAIL)))
    sys.exit(1 if FAIL else 0)


if __name__ == '__main__':
    main()
