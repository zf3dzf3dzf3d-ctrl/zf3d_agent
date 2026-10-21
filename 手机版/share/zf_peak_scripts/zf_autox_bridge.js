/**
 * zf_autox_bridge.js — 峰控助手第二操控桥（文件队列版）
 * 用法：AutoX.js 里运行本脚本（建议悬浮窗常驻或开机自启）。
 * 队列：/sdcard/zf_peak/autox_queue/*.json
 * 回执：/sdcard/zf_peak/autox_done/<同名>.res（纯文本结果）
 * 任务格式：{"action":"tap|longTap|swipe|text|key|launch|screen|find|stop",
 *           "x":100,"y":200,"x2":300,"y2":400,"dur":300,
 *           "pkg":"com.example","key":"back|home|recents","text":"要输入的内容","target":"控件文本"}
 */
var Q = '/sdcard/zf_peak/autox_queue/';
var D = '/sdcard/zf_peak/autox_done/';
files.ensureDir(Q);
files.ensureDir(D);

function execTask(t) {
    switch (t.action) {
        case 'tap':      return click(t.x, t.y) ? 'ok' : 'click failed';
        case 'longTap':  return longClick(t.x, t.y) ? 'ok' : 'longClick failed';
        case 'swipe':    return swipe(t.x, t.y, t.x2, t.y2, t.dur || 300) ? 'ok' : 'swipe failed';
        case 'text':     t && input ? (input(t.text), 'ok') : 'no input';
        case 'key':      var m = {back: KEY_BACK, home: KEY_HOME, recents: KEY_RECENTS};
                         var k = m[t.key]; return k !== undefined && pressKey(k) ? 'ok' : 'key failed';
        case 'launch':   return launch(t.pkg) ? 'ok' : 'launch failed';
        case 'screen':   var f = D + Date.now() + '.png';
                         if (!requestScreenCapture()) return 'screen capture denied';
                         return captureScreen() && saveImage ? (save ? 'ok' : f) : 'capture failed';
        case 'find':     var w = textContains(t.target).findOnce() || descContains(t.target).findOnce();
                         if (!w) return 'not found: ' + t.target;
                         if (t.x !== undefined) return click(w.bounds().centerX(), w.bounds().centerY()) ? 'ok' : 'click failed';
                         return JSON.stringify(w.bounds());
        case 'stop':     return 'BRIDGE_STOP';
        default:         return 'unknown action: ' + t.action;
    }
}

toast('峰控操控桥已启动，监视 ' + Q);
while (true) {
    var fs = files.listDir(Q, function(n){ return n.endsWith('.json'); });
    for (var i = 0; i < fs.length; i++) {
        var name = fs[i];
        var res;
        try {
            var t = JSON.parse(files.read(Q + name));
            res = execTask(t);
        } catch (e) { res = 'ERROR: ' + e.message; }
        files.write(D + name.replace('.json', '.res'), String(res));
        files.remove(Q + name);
        if (res === 'BRIDGE_STOP') { toast('峰控操控桥已停止'); exit(); }
    }
    sleep(500);
}
