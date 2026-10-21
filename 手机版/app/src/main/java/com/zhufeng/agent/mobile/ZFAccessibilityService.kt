package com.zhufeng.agent.mobile

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Build
import android.util.Base64
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.io.ByteArrayOutputStream

/**
 * P3 工具层：无障碍服务 —— 智能体的"眼睛和手"（增强版）。
 * 读屏：控件树（文本/id/可点击/可滚动/bounds）
 * 手势：tap/longPress/swipe/drag/doubleTap（dispatchGesture，可操作自绘界面）
 * 节点：按文本/ID点击、长按、滚动、勾选
 * 截屏：API 30+ takeScreenshot 返回 base64（配合视觉模型感知自绘界面）
 * 全局：Back/Home/Recents/通知栏/快捷设置 + 启动任意 App
 */
class ZFAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile
        var instance: ZFAccessibilityService? = null
            private set

        fun isReady(): Boolean = instance != null
    }

    override fun onServiceConnected() {
        instance = this
        // v62 修复：不要用新对象覆盖 serviceInfo —— 那会清掉 XML 里声明的
        // canRetrieveWindowContent / canPerformGestures / canTakeScreenshot 能力，
        // 导致服务即使连接成功也读不了屏、做不了手势。XML 配置已完整，直接沿用。
        // 如需在代码层微调，应基于现有 serviceInfo 追加 flags。
        serviceInfo = serviceInfo.apply {
            eventTypes = AccessibilityEvent.TYPES_ALL_MASK
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            flags = flags or AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                    AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    // ---------- 读屏 ----------

    /** 抓取当前屏幕的简化控件树：文本/id/可点击/可滚动/bounds，最多 maxNodes 个，JSON 数组字符串 */
    fun readScreen(maxNodes: Int = 120): String {
        val out = StringBuilder("[")
        var count = 0
        fun walk(node: AccessibilityNodeInfo?) {
            if (node == null || count >= maxNodes) return
            val text = node.text?.toString() ?: ""
            val desc = node.contentDescription?.toString() ?: ""
            val cls = node.className?.toString()?.substringAfterLast('.') ?: ""
            if (text.isNotEmpty() || desc.isNotEmpty() || node.isClickable) {
                if (count > 0) out.append(",")
                out.append("{\"text\":").append(jsonStr(text))
                    .append(",\"desc\":").append(jsonStr(desc))
                    .append(",\"cls\":\"").append(cls).append("\"")
                    .append(",\"id\":\"").append(node.viewIdResourceName ?: "").append("\"")
                    .append(",\"clickable\":").append(node.isClickable)
                    .append(",\"scrollable\":").append(node.isScrollable)
                    .append(",\"bounds\":\"").append(Rect().also { node.getBoundsInScreen(it) }.toShortString()).append("\"")
                    .append("}")
                count++
            }
            for (i in 0 until node.childCount) walk(node.getChild(i))
        }
        walk(rootInActiveWindow)
        out.append("]")
        return out.toString()
    }

    // ---------- 手势（dispatchGesture，覆盖无障碍树读不到的自绘界面） ----------

    private fun stroke(path: android.graphics.Path, startTime: Long, duration: Long): GestureDescription {
        val builder = GestureDescription.Builder()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            builder.addStroke(GestureDescription.StrokeDescription(path, startTime, duration))
        }
        return builder.build()
    }

    /** 坐标点击 */
    fun tap(x: Float, y: Float): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
        val path = android.graphics.Path().apply { moveTo(x, y) }
        return dispatchGesture(stroke(path, 0, 50), null, null)
    }

    /** 坐标长按 */
    fun longPress(x: Float, y: Float, durationMs: Long = 600): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
        val path = android.graphics.Path().apply { moveTo(x, y) }
        return dispatchGesture(stroke(path, 0, durationMs), null, null)
    }

    /** 双击 */
    fun doubleTap(x: Float, y: Float): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
        val path = android.graphics.Path().apply { moveTo(x, y) }
        val first = stroke(path, 0, 50)
        val second = stroke(android.graphics.Path().apply { moveTo(x, y) }, 220, 50)
        val builder = GestureDescription.Builder()
        @Suppress("DEPRECATION")
        builder.addStroke(first.getStroke(0))
        builder.addStroke(second.getStroke(0))
        return dispatchGesture(builder.build(), null, null)
    }

    /** 滑动：从 (x1,y1) 滑到 (x2,y2)，durationMs 控制速度 */
    fun swipe(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long = 300): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
        val path = android.graphics.Path().apply { moveTo(x1, y1); lineTo(x2, y2) }
        return dispatchGesture(stroke(path, 0, durationMs), null, null)
    }

    /** 拖拽（长按后拖动）：按住起点 durationMs/2，再拖到终点 */
    fun drag(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long = 800): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
        val path = android.graphics.Path().apply { moveTo(x1, y1); lineTo(x2, y2) }
        return dispatchGesture(stroke(path, 0, durationMs), null, null)
    }

    /** 屏幕内滑动（按方向 up/down/left/right，幅度为屏幕的 2/3） */
    fun swipeScreen(direction: String): Boolean {
        val metrics = resources.displayMetrics
        val cx = metrics.widthPixels / 2f
        val cy = metrics.heightPixels / 2f
        return when (direction.lowercase()) {
            "up" -> swipe(cx, cy + cy * 0.6f, cx, cy - cy * 0.6f)
            "down" -> swipe(cx, cy - cy * 0.6f, cx, cy + cy * 0.6f)
            "left" -> swipe(cx + cx * 0.7f, cy, cx - cx * 0.7f, cy)
            "right" -> swipe(cx - cx * 0.7f, cy, cx + cx * 0.7f, cy)
            else -> false
        }
    }

    // ---------- 节点级操作 ----------

    /** 从节点向上找可执行某动作的祖先并执行 */
    private fun performUp(node: AccessibilityNodeInfo?, action: Int): Boolean {
        var t: AccessibilityNodeInfo? = node
        var depth = 0
        while (t != null && depth < 10) {
            if (t.performAction(action)) return true
            t = t.parent; depth++
        }
        return false
    }

    private fun rootOrNull(): AccessibilityNodeInfo? = rootInActiveWindow

    /** 按资源 id 点击，如 com.example:id/btn_ok */
    fun clickById(viewId: String): Boolean {
        val root = rootOrNull() ?: return false
        val nodes = root.findAccessibilityNodeInfosByViewId(viewId)
        for (n in nodes) if (performUp(n, AccessibilityNodeInfo.ACTION_CLICK)) return true
        return false
    }

    /** 按坐标找到节点并长按（无障碍树版本，比手势长按更可靠） */
    fun longPressByText(text: String, exact: Boolean = true): Boolean {
        val root = rootOrNull() ?: return false
        val nodes = root.findAccessibilityNodeInfosByText(text)
        for (n in nodes) {
            if (exact && n.text?.toString() != text) continue
            if (performUp(n, AccessibilityNodeInfo.ACTION_LONG_CLICK)) return true
        }
        return false
    }

    /** 节点滚动：text 非空时滚包含该文本的可滚动容器，否则滚第一个可滚动节点 */
    fun scrollNode(text: String = "", forward: Boolean = true): Boolean {
        val root = rootOrNull() ?: return false
        val action = if (forward) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                     else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        val candidates = if (text.isNotEmpty()) root.findAccessibilityNodeInfosByText(text) else emptyList()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        // 优先候选节点的可滚动祖先
        for (n in candidates) {
            var t: AccessibilityNodeInfo? = n
            var depth = 0
            while (t != null && depth < 8) {
                if (t.isScrollable && t.performAction(action)) return true
                t = t.parent; depth++
            }
        }
        // 兜底：广度优先找第一个可滚动节点
        while (queue.isNotEmpty()) {
            val n = queue.removeFirst()
            if (n.isScrollable && n.performAction(action)) return true
            for (i in 0 until n.childCount) n.getChild(i)?.let { queue.add(it) }
        }
        return false
    }

    /** 勾选/取消勾选 checkbox/switch：按文本找节点 */
    fun checkByText(text: String, exact: Boolean = true): Boolean {
        val root = rootOrNull() ?: return false
        val nodes = root.findAccessibilityNodeInfosByText(text)
        for (n in nodes) {
            if (exact && n.text?.toString() != text) continue
            if (performUp(n, AccessibilityNodeInfo.ACTION_CLICK)) return true
        }
        return false
    }

    /** 只检查屏幕上是否存在某文字（不点击任何节点），供 phone_check 使用 */
    fun existsByText(text: String, exact: Boolean = false): Boolean {
        val root = rootOrNull() ?: return false
        val nodes = root.findAccessibilityNodeInfosByText(text) ?: return false
        for (n in nodes) {
            if (exact && n.text?.toString() != text) continue
            return true
        }
        return false
    }

    // ---------- 执行（原有） ----------

    /** 按可见文本点击（contains 时模糊匹配） */
    fun clickByText(text: String, exact: Boolean = true): Boolean {
        val root = rootOrNull() ?: return false
        val nodes = root.findAccessibilityNodeInfosByText(text)
        for (n in nodes) {
            if (exact && n.text?.toString() != text) continue
            if (performUp(n, AccessibilityNodeInfo.ACTION_CLICK)) return true
        }
        return false
    }

    /** 在焦点输入框中输入文本（先清空） */
    fun inputText(text: String): Boolean {
        val root = rootOrNull() ?: return false
        var target: AccessibilityNodeInfo? = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        if (target == null || !target.isEditable) {
            val q = ArrayDeque<AccessibilityNodeInfo>(); q.add(root)
            while (q.isNotEmpty()) {
                val n = q.removeFirst()
                if (n.isEditable) { target = n; break }
                for (i in 0 until n.childCount) n.getChild(i)?.let { q.add(it) }
            }
        }
        val args = android.os.Bundle()
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        return target?.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args) == true
    }

    // ---------- 全局动作 ----------

    fun pressBack(): Boolean = performGlobalAction(GLOBAL_ACTION_BACK)
    fun pressHome(): Boolean = performGlobalAction(GLOBAL_ACTION_HOME)
    fun pressRecents(): Boolean = performGlobalAction(GLOBAL_ACTION_RECENTS)
    fun openNotifications(): Boolean = performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)
    fun openQuickSettings(): Boolean = performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS)
    fun goHome() = pressHome()

    // ---------- 截屏（API 30+） ----------

    /**
     * 截屏并返回 JPEG base64（quality 可调，默认 60 控制体积）。
     * 需要 API 30+ 且服务配置 canTakeScreenshot，用户会收到系统截屏授权提示。
     */
    fun screenshotBase64(quality: Int = 60): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return "{\"error\":\"screenshot requires Android 11+\"}"
        }
        val latch = java.util.concurrent.CountDownLatch(1)
        var result = "{\"error\":\"timeout\"}"
        takeScreenshot(java.util.concurrent.TimeUnit.SECONDS.toMillis(3).toInt(),
            mainExecutor,
            object : AccessibilityService.TakeScreenshotCallback {
                override fun onSuccess(screenshot: AccessibilityService.ScreenshotResult) {
                    try {
                        val bmp = Bitmap.wrapHardwareBuffer(screenshot.hardwareBuffer, screenshot.colorSpace)
                        val copied = bmp?.copy(Bitmap.Config.ARGB_8888, false)
                        val out = ByteArrayOutputStream()
                        if (copied == null) {
                            screenshot.hardwareBuffer.close()
                            result = "{\"error\":\"截屏位图转换失败(hardware buffer 已失效)\"}"
                            return
                        }
                        copied.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(10, 100), out)
                        screenshot.hardwareBuffer.close()
                        val b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                        result = "{\"ok\":true,\"format\":\"jpeg\",\"base64\":\"$b64\"}"
                    } catch (e: Exception) {
                        result = "{\"error\":\"${e.message?.replace("\"", "'")}\"}"
                    } finally { latch.countDown() }
                }
                override fun onFailure(errorCode: Int) {
                    result = "{\"error\":\"screenshot failed code=$errorCode\"}"
                    latch.countDown()
                }
            })
        latch.await(5, java.util.concurrent.TimeUnit.SECONDS)
        return result
    }

    // ---------- App 启动 / 已装应用 ----------

    /** 启动指定包名的 App（主入口 Activity） */
    fun launchApp(packageName: String): Boolean {
        return try {
            val pm = packageManager
            val intent = pm.getLaunchIntentForPackage(packageName) ?: return false
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
            true
        } catch (e: Exception) { false }
    }

    /** 列出有桌面入口的已装应用 JSON 数组：[{pkg,label}] */
    fun listApps(): String {
        return try {
            val pm = packageManager
            val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val ris = pm.queryIntentActivities(intent, 0)
            val seen = HashSet<String>()
            val out = StringBuilder("[")
            var count = 0
            for (ri in ris) {
                val pkg = ri.activityInfo.packageName
                if (!seen.add(pkg)) continue
                val label = try { ri.loadLabel(pm)?.toString() ?: pkg } catch (e: Exception) { pkg }
                if (count > 0) out.append(",")
                out.append("{\"pkg\":\"").append(pkg).append("\",\"label\":").append(jsonStr(label)).append("}")
                count++
            }
            out.append("]").toString()
        } catch (e: Exception) { "[]" }
    }

    // ---------- L4-1 连续执行（批量手势队列，节流，失败即停） ----------

    /**
     * steps JSON 数组，每项: {op:"tap"|"longPress"|"swipe"|"drag"|"text"|"back"|"home",
     *  x,y,x2,y2,duration,text}
     * 每步之间节流 intervalMs（默认500，最小200），任一步失败即停。
     * 返回 {ok,done,failed,total,step} JSON。
     */
    fun runSequence(stepsJson: String, intervalMs: Long = 500): String {
        return try {
            val arr = org.json.JSONArray(stepsJson)
            val total = arr.length()
            if (total > 20) return "{\"ok\":false,\"error\":\"单次最多20步\"}"
            val interval = maxOf(200L, intervalMs)
            for (i in 0 until total) {
                val o = arr.optJSONObject(i) ?: continue
                val ok = when (o.optString("op")) {
                    "tap" -> tap(o.optDouble("x", 0.0).toFloat(), o.optDouble("y", 0.0).toFloat())
                    "longPress" -> longPress(o.optDouble("x", 0.0).toFloat(), o.optDouble("y", 0.0).toFloat())
                    "swipe" -> swipe(o.optDouble("x", 0.0).toFloat(), o.optDouble("y", 0.0).toFloat(),
                        o.optDouble("x2", 0.0).toFloat(), o.optDouble("y2", 0.0).toFloat(),
                        o.optLong("duration", 300))
                    "drag" -> drag(o.optDouble("x", 0.0).toFloat(), o.optDouble("y", 0.0).toFloat(),
                        o.optDouble("x2", 0.0).toFloat(), o.optDouble("y2", 0.0).toFloat(),
                        o.optLong("duration", 800))
                    "text" -> inputText(o.optString("text"))
                    "back" -> pressBack()
                    "home" -> pressHome()
                    else -> false
                }
                if (!ok) {
                    return "{\"ok\":false,\"done\":$i,\"failed\":true,\"total\":$total,\"step\":$i}"
                }
                if (i < total - 1) Thread.sleep(interval)
            }
            "{\"ok\":true,\"done\":$total,\"total\":$total}"
        } catch (e: Exception) {
            "{\"ok\":false,\"error\":\"${e.message?.replace("\"", "'")}\"}"
        }
    }

    // ---------- 工具 ----------

    private fun jsonStr(s: String): String {
        val sb = StringBuilder("\"")
        for (c in s) when (c) {
            '"' -> sb.append("\\\"")
            '\\' -> sb.append("\\\\")
            '\n' -> sb.append("\\n")
            '\r' -> sb.append("\\r")
            '\t' -> sb.append("\\t")
            else -> if (c.code < 0x20) sb.append("\\u%04x".format(c.code)) else sb.append(c)
        }
        return sb.append("\"").toString()
    }
}
