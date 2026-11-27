# -*- coding: utf-8 -*-
"""
S0.9.1 白名单回归测试（第12轮裁决固化：安全师整改2 + 子窗三条断言）
被测: server/remote/ws_server.py 的 _pc_cmd_allowed（默认白名单 + 危险字符拦截）
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server', 'remote'))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server'))  # 20261123: ws_server 迁 util_log 后需可解析
import ws_server  # noqa: E402

# 审计落盘隔离：_AUDIT_PATH 是模块常量且 _audit_log 调用时才读全局，
# 此处 monkeypatch 到临时目录，杜绝测试写生产 server/data/ws_audit.log（T6/T8/T9 的留痕全走临时文件）
ws_server._AUDIT_PATH = os.path.join(tempfile.mkdtemp(prefix='ws_audit_test_'), 'ws_audit.log')

PASS = 0
FAIL = 0


def check(name, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}")


cfg = {}  # 空配置 -> 走默认白名单 _CMD_DEFAULT_ALLOW

print("[T1] 解释器类命令阻断（S0.9 修复回归）")
check("python -c 阻断", not ws_server._pc_cmd_allowed(cfg, 'python -c "print(1)"'))
check("node -e 阻断", not ws_server._pc_cmd_allowed(cfg, 'node -e "require(1)"'))
check("git push 阻断", not ws_server._pc_cmd_allowed(cfg, 'git push origin main'))
check("powershell 阻断", not ws_server._pc_cmd_allowed(cfg, 'powershell -Command dir'))

print("[T2] 只读类命令放行")
for c in ('tasklist', 'ipconfig', 'whoami', 'hostname', 'dir', 'systeminfo'):
    check(f"{c} 放行", ws_server._pc_cmd_allowed(cfg, c))

print("[T2b] 参数级白名单（S1-4a 新增：args_re 语义）")
check("tasklist /fi 放行", ws_server._pc_cmd_allowed(cfg, 'tasklist /fi "STATUS eq RUNNING"'))
check("tasklist /v 放行", ws_server._pc_cmd_allowed(cfg, 'tasklist /v'))
check("ipconfig /all 放行", ws_server._pc_cmd_allowed(cfg, 'ipconfig /all'))
check("dir /b 放行", ws_server._pc_cmd_allowed(cfg, 'dir /b'))
check("systeminfo 带参 阻断（白名单禁参）", not ws_server._pc_cmd_allowed(cfg, 'systeminfo /x'))
check("whoami 带参 阻断", not ws_server._pc_cmd_allowed(cfg, 'whoami /priv'))
check("旧式字符串条目=宽松语义（旧兼容，参数不限）", ws_server._pc_cmd_allowed({'allow': ['whoami']}, 'whoami /priv'))
check("旧式字符串条目无参放行", ws_server._pc_cmd_allowed({'allow': ['whoami']}, 'whoami'))

print("[T2c] dir 开关放宽回归（第23轮收口子窗整改：/abco → /[a-z]）")
check("dir /w 放行", ws_server._pc_cmd_allowed(cfg, 'dir /w'))
check("dir /s /b 放行", ws_server._pc_cmd_allowed(cfg, 'dir /s /b'))

print("[T3] LOLBin 下载器/执行器阻断（子窗第12轮断言1）")
for c in ('certutil -urlcache -f http://x/a.exe a.exe',
          'bitsadmin /transfer x /download http://x a',
          'curl -o out.exe http://x',
          'mshta http://x/a.hta',
          'regsvr32 /s x.dll'):
    check(f"{c.split()[0]} 阻断", not ws_server._pc_cmd_allowed(cfg, c))

print("[T4] 危险字符链式注入拦截")
check("& 链式 阻断", not ws_server._pc_cmd_allowed(cfg, 'tasklist & echo pwned'))
check("| 管道 阻断", not ws_server._pc_cmd_allowed(cfg, 'tasklist | findstr x'))
check("> 重定向 阻断", not ws_server._pc_cmd_allowed(cfg, 'echo x > a.bat'))

print("[T5] 换行/同形字符注入拦截（子窗第12轮断言2，S0.9.1 修复项）")
check("换行符内嵌第二命令 阻断", not ws_server._pc_cmd_allowed(cfg, 'tasklist\ncurl http://x'))
check("回车符 阻断", not ws_server._pc_cmd_allowed(cfg, 'tasklist\rformat'))
check("NUL 字节 阻断", not ws_server._pc_cmd_allowed(cfg, 'tasklist\x00 /v'))
check("全角分号同形字符 阻断", not ws_server._pc_cmd_allowed(cfg, 'tasklist；echo pwned'))

print("[T6] 配置显式 allow 受控放行")
import io, contextlib
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    ok = ws_server._pc_cmd_allowed({'allow': ['python']}, 'python -c "print(1)"')
check("显式 allow python 放行（用户明知故开）", ok)
check("解释器留痕日志已输出（T6 断言，第12轮整改3）",
      'remote interpreter allowed by user config: python' in buf.getvalue())

print("[T7] realpath 归一化（第23轮收口安全师整改：同名二进制绕过阻断）")
check("C:\\\\evil\\\\dir 后缀匹配绕过 阻断",
      not ws_server._pc_cmd_allowed(cfg, 'C:\\\\evil\\\\dir /w'))
check("C:\\\\evil\\\\tasklist.exe 阻断",
      not ws_server._pc_cmd_allowed(cfg, 'C:\\\\evil\\\\tasklist.exe'))
check("真实 system32 dir 放行",
      ws_server._pc_cmd_allowed(cfg, 'C:\\\\Windows\\\\System32\\\\dir.exe' if os.path.exists('C:\\\\Windows\\\\System32\\\\dir.exe') else 'dir'))

print("[T8] % 环境变量展开拦截 + 审计落盘（第23轮收口安全师整改2/3）")
check("%PATH% 展开注入 阻断", not ws_server._pc_cmd_allowed(cfg, 'echo %PATH%'))
check("%cmddir% 阻断", not ws_server._pc_cmd_allowed(cfg, '%cmddir% x'))
check("审计文件已落盘且含留痕行",
      os.path.exists(ws_server._AUDIT_PATH) and
      'remote interpreter allowed by user config: python' in open(ws_server._AUDIT_PATH, encoding='utf-8').read())

print("[T9] 第24轮整改：危险词首词级匹配 + SystemApps 真实路径放行 + 按次留痕")
# 首词级黑名单：首词命中即拒
check("format 首词 阻断", not ws_server._pc_cmd_allowed(cfg, 'format x'))
check("del 首词 阻断", not ws_server._pc_cmd_allowed(cfg, 'del a.txt'))
check("shutdown 首词 阻断", not ws_server._pc_cmd_allowed(cfg, 'shutdown /s'))
# 参数含危险词字样不再误杀（安全师第24轮观察b）
check("tasklist 参数含 format 字样 放行（不再子串误杀）",
      ws_server._pc_cmd_allowed(cfg, 'tasklist /fi "FORMAT eq x"'))
check("echo 参数含 del 字样 放行", ws_server._pc_cmd_allowed(cfg, 'echo deleting done'))
# SystemApps 分支真实路径放行（验证师第24轮锐度提示）
_apps = os.path.join(os.environ.get('SystemRoot', r'C:\Windows'), 'SystemApps')
_real_apps = next((f for f in os.listdir(_apps) if f.lower().endswith('.exe')), None) if os.path.isdir(_apps) else None
if _real_apps:
    check("SystemApps 真实 exe 放行（SystemApps 分支覆盖）",
          ws_server._pc_cmd_allowed({'allow': [_real_apps.rsplit('.', 1)[0].lower()]},
                                    os.path.join(_apps, _real_apps)))
else:
    print("  [SKIP] SystemApps 无 exe 或目录不存在（分支断言留待环境具备时覆盖）")
# 按次留痕：同一条解释器命令第二次放行仍应写审计（第24轮安全师观察a）
import io as _io, contextlib as _cl
_b2 = _io.StringIO()
with _cl.redirect_stdout(_b2):
    ws_server._pc_cmd_allowed({'allow': ['python']}, 'python --version')
    ws_server._pc_cmd_allowed({'allow': ['python']}, 'python -V')
check("按次留痕：重复调用仍写 stdout 留痕（非首见一次）",
      _b2.getvalue().count('remote interpreter allowed by user config: python') == 2)

print(f"\nRESULT: {PASS} PASS / {FAIL} FAIL")


def test_ws_whitelist():
    """pytest 入口（快速优化冲刺 A4 20261123）：模块导入时已完整执行 T1-T9 检查。"""
    assert FAIL == 0, 'WS 白名单回归失败 %d 项（见上方 FAIL 明细）' % FAIL


if __name__ == '__main__':
    sys.exit(0 if FAIL == 0 else 1)
