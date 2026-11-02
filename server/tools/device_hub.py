# -*- coding: utf-8 -*-
"""
device_hub — 峰控家庭设备网关 v1
插件式适配器架构：设备注册表(JSON) + 适配器(adb_tv/http)，新增设备零代码（只改 JSON）。
对外接口（供 API/CLI 调用）：
  list_devices()                 -> 设备清单
  control(device_id, action, value, confirm_token=None) -> 执行控制
  run_scene(scene_name, confirm_token=None)             -> 场景联动
安全：confirm_required 的设备/操作必须带 confirm_token="yes"（二次确认）。
"""
import json
import os
import subprocess

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REG_PATH = os.path.join(BASE, "data", "device_registry.json")
KEY_NAME_MAP = {
    "up": "19", "down": "20", "left": "21", "right": "22", "ok": "23",
    "back": "4", "home": "3", "menu": "82", "power": "26",
    "volume_up": "24", "volume_down": "25", "mute": "164", "play_pause": "126",
}


def _load():
    with open(REG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


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
    reg = _load()
    dev = next((d for d in reg.get("devices", []) if d["id"] == device_id), None)
    if not dev:
        return {"ok": False, "error": "设备不存在: %s" % device_id}
    if not dev.get("enabled", False):
        return {"ok": False, "error": "设备未启用，请在注册表中将 enabled 设为 true"}
    if dev.get("confirm_required") and confirm_token != "yes":
        return {"ok": False, "error": "该设备为敏感设备(%s)，需要二次确认：请带 confirm_token='yes' 再执行" % dev["name"]}

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
        print(json.dumps(list_devices(), ensure_ascii=False, indent=1))
    elif a[0] == "control" and len(a) >= 3:
        print(json.dumps(control(a[1], a[2], a[3] if len(a) > 3 else None,
                                 a[4] if len(a) > 4 else None), ensure_ascii=False))
    elif a[0] == "scene" and len(a) >= 2:
        print(json.dumps(run_scene(a[1], a[2] if len(a) > 2 else None), ensure_ascii=False))
    else:
        print("用法: device_hub.py list | control <设备id> <action> [value] [confirm] | scene <场景名> [confirm]")
