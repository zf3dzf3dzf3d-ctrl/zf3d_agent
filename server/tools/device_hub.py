# -*- coding: utf-8 -*-
"""
device_hub — 峰控家庭设备网关 v1
插件式适配器架构：设备注册表(JSON) + 适配器(adb_tv/http)，新增设备零代码（只改 JSON）。
对外接口（供 API/CLI 调用）：
  list_devices()                 -> 设备清单
  control(device_id, action, value, confirm_token=None) -> 执行控制
  run_scene(scene_name, confirm_token=None)             -> 场景联动
安全：【2026-11-23 统一确认原语】confirm_required 的设备/操作不再接受任何来自请求
参数的确认值（confirm_token 属模型可自填的伪确认），统一走 syscall 人工审批闸：
以 `device_hub:<设备id>:<动作>` 为工具名登记 dangerous 并 check_permission
（fail-closed），未批准返回 need_confirm 并经 approve_hook.notify_pending 推审批码，
人工在手机回复「同意 工具名 审批码」（或本机 syscall.approve）后放行，1 小时免重复。
临时兼容：环境变量 ZF_DEVICE_CONFIRM_LEGACY=1 时退回旧 confirm_token='yes' 行为
（仅迁移期保留，计划移除）。
"""
import json
import os
import subprocess

from util_log import get_logger

log = get_logger('device_hub')
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REG_PATH = os.path.join(BASE, "data", "device_registry.json")
KEY_NAME_MAP = {
    "up": "19", "down": "20", "left": "21", "right": "22", "ok": "23",
    "back": "4", "home": "3", "menu": "82", "power": "26",
    "volume_up": "24", "volume_down": "25", "mute": "164", "play_pause": "126",
}

_LEGACY_ENV = "ZF_DEVICE_CONFIRM_LEGACY"   # 临时兼容开关（迁移期，计划移除）


def _legacy_confirm():
    """临时兼容：ZF_DEVICE_CONFIRM_LEGACY=1 时保留旧 confirm_token 语义。"""
    try:
        return os.environ.get(_LEGACY_ENV, "") == "1"
    except Exception:
        return False


def _sys_gate(tool):
    """syscall 人工审批闸：登记 dangerous + check_permission（fail-closed）。
    返回 (ok, reason)；闸不可用时也拒绝，不给伪确认留旁路。"""
    for attempt in range(2):
        try:
            if attempt == 1:
                import sys as _sys
                if BASE not in _sys.path:   # 独立加载（CLI/importlib）时兜底
                    _sys.path.insert(0, BASE)
            from engines.common.syscall import gate
            return gate(tool, "tools:device_hub", "峰控设备控制(人工审批闸,dangerous)")
        except Exception as e:
            err = e
    return False, "SYSCALL_UNAVAILABLE: 人工审批闸不可用(%s)，fail-closed 拒绝" % err


def _push_pending(tool, reason):
    """审批推手机（无 bot 配置/任何失败静默降级，不影响 need_confirm 返回）。"""
    for attempt in range(2):
        try:
            if attempt == 1:
                import sys as _sys
                if BASE not in _sys.path:
                    _sys.path.insert(0, BASE)
            from bot_gateway.approve_hook import notify_pending
            notify_pending(tool, reason)
            return
        except Exception:
            continue


def _how_to_approve(tool):
    """写进 need_confirm 返回消息的人工批准指引（bot 回复格式 / 本机 API）。"""
    return ("人工批准方式：已配置 IM 审批推送（data/bot_tokens.json 的 approve_push）时，"
            "审批码已推送到手机，回复「同意 %s <审批码>」（码见推送，10分钟内有效，批准后"
            "1小时内免重复确认）；未配置推送时，在服务器本机以 Python 调 "
            "engines.common.syscall.approve('%s') 完成批准，然后重试。" % (tool, tool))


def _load():
    # 【2026-11-23 修复】注册表缺失/损坏时按空注册表兜底（首装/未配置设备为常态），
    # 不再 FileNotFoundError 让 /api/device/* 整体 500。
    try:
        with open(REG_PATH, "r", encoding="utf-8") as f:
            reg = json.load(f)
        return reg if isinstance(reg, dict) else {}
    except Exception:
        return {"devices": [], "scenes": {}}


def list_devices():
    reg = _load()
    devs = []
    for d in reg.get("devices", []):
        devs.append({
            "id": d["id"], "name": d["name"], "type": d["type"],
            "adapter": d.get("adapter"), "enabled": d.get("enabled", False),
            "confirm_required": d.get("confirm_required", False),
            "apps": sorted(d.get("apps", {}).keys()),
        })
    return {"ok": True, "devices": devs, "scenes": sorted(reg.get("scenes", {}).keys())}


# ---------- ADB 安卓电视适配器 ----------
def _adb(device, args, timeout=10):
    target = "%s:%s" % (device.get("host"), device.get("port", 5555))
    cmd = ["adb", "-s", target] + args
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return p.returncode == 0, (p.stdout or p.stderr or "").strip()
    except FileNotFoundError:
        return False, "未找到 adb，请安装 Android platform-tools 并加入 PATH"
    except subprocess.TimeoutExpired:
        return False, "adb 命令超时"


def _tv_connect(device):
    target = "%s:%s" % (device.get("host"), device.get("port", 5555))
    ok, out = _adb(device, ["connect", target], timeout=8)
    if not ok:
        return False, out
    if "connected" not in out and "already" not in out:
        return False, "连接失败: " + out
    return True, target


def _do_adb_tv(device, action, value):
    if action == "connect":
        return _tv_connect(device)
    if action == "key":
        key = str(value).lower()
        code = KEY_NAME_MAP.get(key, value if str(value).isdigit() else None)
        if code is None:
            return False, "未知按键: %s（可用 %s 或数字 code）" % (value, ",".join(KEY_NAME_MAP))
        return _adb(device, ["shell", "input", "keyevent", str(code)])
    if action == "launch":
        app = device.get("apps", {}).get(value) or value
        return _adb(device, ["shell", "monkey", "-p", app, "-c",
                             "android.intent.category.LAUNCHER", "1"], timeout=15)
    if action == "text":
        return _adb(device, ["shell", "input", "text", str(value)])
    if action == "screenshot":
        ok, out = _adb(device, ["exec-out", "screencap", "-p"], timeout=15)
        return ok, out
    if action == "power":
        return _adb(device, ["shell", "input", "keyevent", "26"]) if str(value) in ("toggle", "") \
            else _adb(device, ["shell", "input", "keyevent", KEY_NAME_MAP["power"]])
    return False, "adb_tv 适配器不支持 action: %s" % action


def _do_http(device, action, value):
    """极简 HTTP 设备（如自DIY插座）：commands[action+(_value)] 直接 GET"""
    import urllib.request
    cmds = device.get("commands", {})
    url = cmds.get(action)
    if not url:
        return False, "该设备未定义 action: %s" % action
    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            return True, ("HTTP %s" % r.status)
    except Exception as e:
        return False, str(e)


def control(device_id, action, value=None, confirm_token=None):
    """confirm_token 参数仅为兼容保留：仅 ZF_DEVICE_CONFIRM_LEGACY=1 时生效，
    新语义下不读取（模型不可经请求参数自确认）。"""
    reg = _load()
    dev = next((d for d in reg.get("devices", []) if d["id"] == device_id), None)
    if not dev:
        return {"ok": False, "error": "设备不存在: %s" % device_id}
    if not dev.get("enabled", False):
        return {"ok": False, "error": "设备未启用，请在注册表中将 enabled 设为 true"}
    if dev.get("confirm_required"):
        if _legacy_confirm():
            # 【临时兼容】ZF_DEVICE_CONFIRM_LEGACY=1：保留旧 confirm_token 语义（迁移期，计划移除）
            if confirm_token != "yes":
                return {"ok": False, "error": "该设备为敏感设备(%s)，需要二次确认：请带 confirm_token='yes' 再执行" % dev["name"]}
        else:
            # 【2026-11-23 统一确认原语】不再接受请求参数里的任何确认值：
            # 以 device_hub:<设备id>:<动作> 为工具名走 syscall 人工审批闸（dangerous，fail-closed）
            tool = "device_hub:%s:%s" % (device_id, action)
            ok, reason = _sys_gate(tool)
            if not ok:
                _push_pending(tool, reason)
                return {"ok": False, "need_confirm": True, "tool": tool,
                        "error": "设备 %s 的 %s 操作为 dangerous 级，需人工审批后执行。%s（拦截原因: %s）"
                                 % (dev["name"], action, _how_to_approve(tool), reason)}

    adapter = dev.get("adapter", "adb_tv")
    if adapter == "adb_tv":
        if dev.get("host"):
            _tv_connect(dev)  # 尽力连接，失败由具体命令报错
        ok, out = _do_adb_tv(dev, action, value)
    elif adapter == "http":
        ok, out = _do_http(dev, action, value)
    else:
        return {"ok": False, "error": "未知适配器: %s" % adapter}
    return {"ok": ok, "device": dev["name"], "action": action, "value": value,
            "output": out[:500] if ok else "错误:" + str(out)}


def run_scene(scene_name, confirm_token=None):
    """confirm_token 仅 ZF_DEVICE_CONFIRM_LEGACY=1 时透传生效；新语义下每个
    confirm_required 步骤各自走 syscall 人工闸（工具名 device_hub:<设备id>:<动作>），
    未批准的步骤在 results 里返回 need_confirm，不影响其他步骤照常回报。"""
    reg = _load()
    steps = reg.get("scenes", {}).get(scene_name)
    if not steps:
        return {"ok": False, "error": "场景不存在，可用场景: " + ",".join(reg.get("scenes", {}).keys())}
    results = []
    for st in steps:
        r = control(st["device"], st["action"], st.get("value"), confirm_token)
        results.append({"device": st["device"], "ok": r.get("ok"), "msg": r.get("output", r.get("error", ""))})
    return {"ok": all(r["ok"] for r in results), "scene": scene_name, "results": results}


if __name__ == "__main__":
    import sys
    a = sys.argv[1:]
    if not a or a[0] == "list":
        log.info(json.dumps(list_devices(), ensure_ascii=False, indent=1))
    elif a[0] == "control" and len(a) >= 3:
        log.info(json.dumps(control(a[1], a[2], a[3] if len(a) > 3 else None,
                                 a[4] if len(a) > 4 else None), ensure_ascii=False))
    elif a[0] == "scene" and len(a) >= 2:
        log.info(json.dumps(run_scene(a[1], a[2] if len(a) > 2 else None), ensure_ascii=False))
    else:
        log.info("用法: device_hub.py list | control <设备id> <action> [value] [confirm] | scene <场景名> [confirm]")
        log.info("（confirm 参数仅 ZF_DEVICE_CONFIRM_LEGACY=1 兼容模式生效；默认走 syscall 人工审批闸）")
