package com.zhufeng.agent.mobile

import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.webkit.JavascriptInterface

/**
 * 原生工具桥：Web UI 智能体通过 window.ZFMobile.* 调用手机原生能力。
 * 命名与 PC 端 mobile_control 工具对齐，P3 工具层核心。
 * 增强：手势（tap/longPress/swipe/drag/doubleTap）、节点级操作、截屏、通知栏/快捷设置、启动 App。
 */
class NativeBridge(private val context: Context) {

    @JavascriptInterface
    fun isApp(): Boolean = true

    @JavascriptInterface
    fun appVersion(): String = "5.5.5-mobile"

    @JavascriptInterface
    fun getServerUrl(): String {
        val prefs = Prefs(context)
        return prefs.serverUrl
    }

    // ---------- 无障碍状态 ----------

    @JavascriptInterface
    fun a11yReady(): Boolean = ZFAccessibilityService.isReady()

    /** v62 诊断：返回无障碍服务详细状态，用于排查 Android 13+ 受限设置问题 */
    @JavascriptInterface
    fun a11yStatus(): String {
        val svc = ZFAccessibilityService.instance
        val enabledInSettings = try {
            val am = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as android.view.accessibility.AccessibilityManager
            am.getEnabledAccessibilityServiceList(android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_GENERIC)
                .any { it.resolveInfo.serviceInfo.packageName == context.packageName }
        } catch (e: Exception) { false }
        return "{\"serviceBound\":" + (svc != null) +
                ",\"enabledInSettings\":" + enabledInSettings +
                ",\"sdk\":" + android.os.Build.VERSION.SDK_INT +
                ",\"restrictedHint\":" + (enabledInSettings && svc == null) + "}"
    }

    /**
     * 自动引导开启无障碍（v63）：
     * 1. 已开启 → 直接返回 enabled，什么都不做；
     * 2. 未开启 → 跳系统无障碍设置页（Android N+ 尽量直达本服务的子页面），用户点一下开关即完成；
     * 返回 {ok:true, action:"none"|"settings"} 供 JS 判断。
     */
    @JavascriptInterface
    fun openA11ySettings(): String {
        return try {
            if (ZFAccessibilityService.isReady()) return "{\"ok\":true,\"action\":\"none\"}"
            val i = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            var deep = false
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                try {
                    // Android 10+：带 :settings:fragment 直达「下载的应用服务」列表（含峰控开关）
                    i.putExtra(":settings:fragment_args_key", "accessibility_service_heading")
                    deep = true
                } catch (_: Exception) {}
            }
            context.startActivity(i)
            "{\"ok\":true,\"action\":\"settings\",\"deep\":" + deep + "}"
        } catch (e: Exception) {
            "{\"ok\":false,\"error\":\"" + e.message?.replace("\"", "'") + "\"}"
        }
    }

    // ---------- 读屏 / 截屏 ----------

    /** 返回当前屏幕控件树 JSON 数组字符串 */
    @JavascriptInterface
    fun readScreen(): String {
        val svc = ZFAccessibilityService.instance ?: return "{\"error\":\"accessibility service not enabled\"}"
        return svc.readScreen()
    }

    /** 截屏，返回 {ok,base64} JSON（Android 11+，首次需系统授权） */
    @JavascriptInterface
    fun screenshot(): String {
        val svc = ZFAccessibilityService.instance ?: return "{\"error\":\"accessibility service not enabled\"}"
        return svc.screenshotBase64()
    }

    @JavascriptInterface
    fun screenshotQuality(quality: Int): String {
        val svc = ZFAccessibilityService.instance ?: return "{\"error\":\"accessibility service not enabled\"}"
        return svc.screenshotBase64(quality)
    }

    // ---------- 手势 ----------

    @JavascriptInterface
    fun tap(x: Float, y: Float): Boolean = ZFAccessibilityService.instance?.tap(x, y) ?: false

    @JavascriptInterface
    fun longPress(x: Float, y: Float): Boolean = ZFAccessibilityService.instance?.longPress(x, y) ?: false

    @JavascriptInterface
    fun doubleTap(x: Float, y: Float): Boolean = ZFAccessibilityService.instance?.doubleTap(x, y) ?: false

    @JavascriptInterface
    fun swipe(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long): Boolean =
        ZFAccessibilityService.instance?.swipe(x1, y1, x2, y2, durationMs) ?: false

    @JavascriptInterface
    fun drag(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long): Boolean =
        ZFAccessibilityService.instance?.drag(x1, y1, x2, y2, durationMs) ?: false

    /** 整屏滑动：direction = up/down/left/right */
    @JavascriptInterface
    fun swipeScreen(direction: String): Boolean =
        ZFAccessibilityService.instance?.swipeScreen(direction) ?: false

    // ---------- 执行（节点级） ----------

    @JavascriptInterface
    fun clickText(text: String): Boolean =
        ZFAccessibilityService.instance?.clickByText(text, exact = false) ?: false

    @JavascriptInterface
    fun clickTextExact(text: String): Boolean =
        ZFAccessibilityService.instance?.clickByText(text, exact = true) ?: false

    /** 只查存在性，不点击（审核 P1 修复：check 实为切换开关，误用会误切） */
    @JavascriptInterface
    fun existsByText(text: String, exact: Boolean = false): Boolean =
        ZFAccessibilityService.instance?.existsByText(text, exact = exact) ?: false

    @JavascriptInterface
    fun clickId(viewId: String): Boolean =
        ZFAccessibilityService.instance?.clickById(viewId) ?: false

    @JavascriptInterface
    fun longPressText(text: String): Boolean =
        ZFAccessibilityService.instance?.longPressByText(text, exact = false) ?: false

    /** 节点滚动：text 非空滚该文本所在可滚动容器，forward=true 向下滚 */
    @JavascriptInterface
    fun scroll(text: String, forward: Boolean): Boolean =
        ZFAccessibilityService.instance?.scrollNode(text, forward) ?: false

    /** 勾选/切换 checkbox/switch */
    @JavascriptInterface
    fun check(text: String): Boolean =
        ZFAccessibilityService.instance?.checkByText(text, exact = false) ?: false

    @JavascriptInterface
    fun inputText(text: String): Boolean =
        ZFAccessibilityService.instance?.inputText(text) ?: false

    // ---------- 全局动作 ----------

    @JavascriptInterface
    fun pressBack(): Boolean = ZFAccessibilityService.instance?.pressBack() ?: false

    @JavascriptInterface
    fun pressHome(): Boolean = ZFAccessibilityService.instance?.pressHome() ?: false

    @JavascriptInterface
    fun pressRecents(): Boolean = ZFAccessibilityService.instance?.pressRecents() ?: false

    /** 下拉通知栏 */
    @JavascriptInterface
    fun openNotifications(): Boolean = ZFAccessibilityService.instance?.openNotifications() ?: false

    /** 拉起快捷设置面板 */
    @JavascriptInterface
    fun openQuickSettings(): Boolean = ZFAccessibilityService.instance?.openQuickSettings() ?: false

    // ---------- App 管理 ----------

    /** 启动指定包名的 App */
    @JavascriptInterface
    fun launchApp(packageName: String): Boolean =
        ZFAccessibilityService.instance?.launchApp(packageName) ?: false

    /** 列出有桌面入口的已装应用 JSON：[{pkg,label}] */
    @JavascriptInterface
    fun listApps(): String = ZFAccessibilityService.instance?.listApps() ?: "[]"

    // ===== ===== 四层权限升级：L2 系统能力 + L3 敏感能力（2026-10-12）===== =====

    private fun okJson(s: String): String = s

    private fun err(e: Exception): String =
        "{\"ok\":false,\"error\":\"" + (e.message ?: e.javaClass.simpleName).replace("\"", "'") + "\"}"

    /** 运行时权限批量申请（MainActivity 转发），permissions 为逗号分隔 */
    @JavascriptInterface
    fun requestPermissions(permissions: String): String {
        return try {
            val act = (context as? android.app.Activity)
                ?: (context as? android.content.ContextWrapper)?.let { cw ->
                    var c: android.content.Context = cw
                    while (c is android.content.ContextWrapper) {
                        if (c is android.app.Activity) return@let c
                        c = c.baseContext
                    }
                    null
                }
                ?: return "{\"ok\":false,\"error\":\"no-activity\"}"
            act.runOnUiThread { act.requestPermissions(permissions.split(",").map { it.trim() }.toTypedArray(), 9001) }
            "{\"ok\":true}"
        } catch (e: Exception) { err(e) }
    }

    /** 定位：返回 {ok,lat,lng,provider} */
    @JavascriptInterface
    fun getLocation(): String {
        return try {
            val lm = context.getSystemService(Context.LOCATION_SERVICE) as android.location.LocationManager
            var loc: android.location.Location? = null
            for (p in listOf(android.location.LocationManager.GPS_PROVIDER, android.location.LocationManager.NETWORK_PROVIDER, android.location.LocationManager.PASSIVE_PROVIDER)) {
                try {
                    if (lm.isProviderEnabled(p)) {
                        loc = lm.getLastKnownLocation(p)
                        if (loc != null) break
                    }
                } catch (_: SecurityException) {}
            }
            if (loc == null) "{\"ok\":false,\"error\":\"no-fix\",\"hint\":\"需已授予定位权限且曾有定位记录\"}"
            else "{\"ok\":true,\"lat\":" + loc.latitude + ",\"lng\":" + loc.longitude + ",\"provider\":\"" + loc.provider + "\"}"
        } catch (e: Exception) { err(e) }
    }

    /** 亮度：读 {ok,value(0-255)}；设 {ok,value}（需 WRITE_SETTINGS 授权，见 openWriteSettings） */
    @JavascriptInterface
    fun getBrightness(): String = try {
        val v = Settings.System.getInt(context.contentResolver, Settings.System.SCREEN_BRIGHTNESS)
        "{\"ok\":true,\"value\":$v}"
    } catch (e: Exception) { err(e) }

    @JavascriptInterface
    fun setBrightness(value: Int): String = try {
        val v = value.coerceIn(1, 255)
        if (Settings.System.canWrite(context)) {
            if (Settings.System.putInt(context.contentResolver, Settings.System.SCREEN_BRIGHTNESS, v)) "{\"ok\":true,\"value\":$v}"
            else "{\"ok\":false,\"error\":\"put-failed\"}"
        } else "{\"ok\":false,\"error\":\"need-write-settings\",\"hint\":\"调 openWriteSettings 引导授权\"}"
    } catch (e: Exception) { err(e) }

    /** 音量：type = music/ring/alarm；读 {ok,value,max}；设 {ok,value} */
    @JavascriptInterface
    fun getVolume(type: String): String = try {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
        val st = when (type) {
            "ring" -> android.media.AudioManager.STREAM_RING
            "alarm" -> android.media.AudioManager.STREAM_ALARM
            else -> android.media.AudioManager.STREAM_MUSIC
        }
        val max = am.getStreamMaxVolume(st)
        val v = am.getStreamVolume(st)
        "{\"ok\":true,\"value\":$v,\"max\":$max}"
    } catch (e: Exception) { err(e) }

    @JavascriptInterface
    fun setVolume(type: String, value: Int): String = try {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
        val st = when (type) {
            "ring" -> android.media.AudioManager.STREAM_RING
            "alarm" -> android.media.AudioManager.STREAM_ALARM
            else -> android.media.AudioManager.STREAM_MUSIC
        }
        am.setStreamVolume(st, value.coerceIn(0, am.getStreamMaxVolume(st)), 0)
        "{\"ok\":true,\"value\":$value}"
    } catch (e: Exception) { err(e) }

    /** 读取剪贴板 */
    @JavascriptInterface
    fun clipboardRead(): String = try {
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        val t = cm.primaryClip?.getItemAt(0)?.coerceToText(context)?.toString() ?: ""
        "{\"ok\":true,\"text\":\"" + t.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "") + "\"}"
    } catch (e: Exception) { err(e) }

    /** 写入剪贴板 */
    @JavascriptInterface
    fun clipboardWrite(text: String): String = try {
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        cm.setPrimaryClip(android.content.ClipData.newPlainText("zf", text))
        "{\"ok\":true}"
    } catch (e: Exception) { err(e) }

    /** 设置闹钟（AlarmClock intent）：hour/minute 24小时制 */
    @JavascriptInterface
    fun setAlarm(hour: Int, minute: Int, label: String): String = try {
        val i = Intent(android.provider.AlarmClock.ACTION_SET_ALARM)
        i.putExtra(android.provider.AlarmClock.EXTRA_HOUR, hour)
        i.putExtra(android.provider.AlarmClock.EXTRA_MINUTES, minute)
        if (label.isNotBlank()) i.putExtra(android.provider.AlarmClock.EXTRA_MESSAGE, label)
        i.putExtra(android.provider.AlarmClock.EXTRA_SKIP_UI, true)
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(i)
        "{\"ok\":true}"
    } catch (e: Exception) { err(e) }

    /** 系统分享文本 */
    @JavascriptInterface
    fun shareText(text: String): String = try {
        val i = Intent(Intent.ACTION_SEND)
        i.type = "text/plain"
        i.putExtra(Intent.EXTRA_TEXT, text)
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(Intent.createChooser(i, "分享").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        "{\"ok\":true}"
    } catch (e: Exception) { err(e) }

    /** 打开指定系统设置页：settings = wifi/bluetooth/location/display/sound/apps/battery/notification 或留空主页 */
    @JavascriptInterface
    fun openSettingsPage(settings: String): String = try {
        val action = when (settings) {
            "wifi" -> Settings.ACTION_WIFI_SETTINGS
            "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
            "location" -> Settings.ACTION_LOCATION_SOURCE_SETTINGS
            "display" -> Settings.ACTION_DISPLAY_SETTINGS
            "sound" -> Settings.ACTION_SOUND_SETTINGS
            "apps" -> Settings.ACTION_APPLICATION_SETTINGS
            "battery" -> Settings.ACTION_BATTERY_SAVER_SETTINGS
            "notification" -> "android.settings.SETTINGS" /* ACTION_NOTIFICATION_SETTINGS 部分SDK版本缺失，用字符串兜底 */
            else -> Settings.ACTION_SETTINGS
        }
        val i = Intent(action)
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(i)
        "{\"ok\":true}"
    } catch (e: Exception) { err(e) }

    /** 跳转「修改系统设置」授权页（setBrightness 需要） */
    @JavascriptInterface
    fun openWriteSettings(): String = try {
        val i = Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS)
        i.data = android.net.Uri.parse("package:" + context.packageName)
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(i)
        "{\"ok\":true}"
    } catch (e: Exception) { err(e) }

    /** 受限沙盒 shell：白名单命令直接 Runtime.exec，返回 {ok,output}（高风险命令不在此列） */
    @JavascriptInterface
    fun execSandbox(cmd: String): String {
        val allow = listOf("ls", "pwd", "date", "uptime", "cat /proc/", "dumpsys battery", "getprop", "df", "ping -c", "whoami", "id")
        if (allow.none { cmd.trim().startsWith(it) }) {
            return "{\"ok\":false,\"error\":\"cmd-not-allowed\",\"allow\":\"" + allow.joinToString("|") + "\"}"
        }
        return try {
            val p = Runtime.getRuntime().exec(arrayOf("/system/bin/sh", "-c", cmd))
            // 根治 phone_shell 卡死：waitFor 加 30s 超时，命令挂起即强制终止返回，
            // 不再让原生桥线程被永久阻塞导致整轮对话干等数分钟
            if (!p.waitFor(30, java.util.concurrent.TimeUnit.SECONDS)) {
                p.destroyForcibly()
                return "{\"ok\":false,\"error\":\"timeout-30s\"}"
            }
            val out = p.inputStream.bufferedReader().readText()
            val e = p.errorStream.bufferedReader().readText()
            p.waitFor()
            "{\"ok\":true,\"output\":\"" + (out + e).replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "") + "\"}"
        } catch (e: Exception) { err(e) }
    }

    // ---------- L3：通知 / 联系人 / 短信 / 电话 / 日历 ----------

    /** 通知读取状态与列表：{ok,enabled,list:[...]} */
    @JavascriptInterface
    fun readNotifications(): String = try {
        val lis = ZFNotificationListener.instance
        if (lis == null) {
            val enabled = try { android.provider.Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")?.contains(context.packageName) == true } catch (_: Throwable) { false }
            "{\"ok\":false,\"enabled\":$enabled,\"error\":\"listener-not-bound\",\"hint\":\"设置→通知使用权 中开启\"}"
        } else {
            "{\"ok\":true,\"enabled\":true,\"list\":" + lis.readNotificationsJson() + "}"
        }
    } catch (e: Exception) { err(e) }

    /** 跳转通知使用权设置页 */
    @JavascriptInterface
    fun openNotificationAccess(): String = try {
        val i = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(i)
        "{\"ok\":true}"
    } catch (e: Exception) { err(e) }

    /** 读联系人：返回 {ok,list:[{name,phone}]}（需 READ_CONTACTS 运行时授权） */
    @JavascriptInterface
    fun readContacts(limit: Int): String = try {
        val sb = StringBuilder("{\"ok\":true,\"list\":[")
        val cur = context.contentResolver.query(
            android.provider.ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, android.provider.ContactsContract.CommonDataKinds.Phone.NUMBER),
            null, null, null)
        cur?.use { c ->
            val iName = c.getColumnIndex(android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
            val iPhone = c.getColumnIndex(android.provider.ContactsContract.CommonDataKinds.Phone.NUMBER)
            var n = 0
            while (c.moveToNext() && n < limit) {
                if (n > 0) sb.append(",")
                sb.append("{\"name\":\"" + escJ(c.getString(iName) ?: "") + "\",\"phone\":\"" + escJ(c.getString(iPhone) ?: "") + "\"}")
                n++
            }
        }
        sb.append("]}")
        sb.toString()
    } catch (e: Exception) { err(e) }

    /** 读短信收件箱：返回 {ok,list:[{from,body,date}]}（需 READ_SMS） */
    @JavascriptInterface
    fun readSms(limit: Int): String = try {
        val sb = StringBuilder("{\"ok\":true,\"list\":[")
        val cur = context.contentResolver.query(
            android.net.Uri.parse("content://sms/inbox"),
            arrayOf("address", "body", "date"), null, null, "date DESC")
        cur?.use { c ->
            val ia = c.getColumnIndex("address"); val ib = c.getColumnIndex("body"); val id = c.getColumnIndex("date")
            var n = 0
            while (c.moveToNext() && n < limit) {
                if (n > 0) sb.append(",")
                sb.append("{\"from\":\"" + escJ(c.getString(ia) ?: "") + "\",\"body\":\"" + escJ(c.getString(ib) ?: "") + "\",\"date\":" + (c.getLong(id)) + "}")
                n++
            }
        }
        sb.append("]}")
        sb.toString()
    } catch (e: Exception) { err(e) }

    /** 【高危】发短信：Web 层需先经用户确认再调用 */
    @JavascriptInterface
    fun sendSms(phone: String, text: String): String = try {
        val sm = android.telephony.SmsManager.getDefault()
        sm.sendTextMessage(phone, null, text, null, null)
        "{\"ok\":true}"
    } catch (e: Exception) { err(e) }

    /** 【高危】拨打电话（直接拨出）：Web 层需先经用户确认再调用 */
    @JavascriptInterface
    fun callPhone(phone: String): String = try {
        val i = Intent(Intent.ACTION_CALL, android.net.Uri.parse("tel:$phone"))
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(i)
        "{\"ok\":true}"
    } catch (e: Exception) { err(e) }

    /** 读日历事件（未来 limit 条）：{ok,list:[{title,start}]}（需 READ_CALENDAR） */
    @JavascriptInterface
    fun readCalendar(limit: Int): String = try {
        val sb = StringBuilder("{\"ok\":true,\"list\":[")
        val now = System.currentTimeMillis()
        val cur = context.contentResolver.query(
            android.provider.CalendarContract.Events.CONTENT_URI,
            arrayOf(android.provider.CalendarContract.Events.TITLE, android.provider.CalendarContract.Events.DTSTART),
            android.provider.CalendarContract.Events.DTSTART + ">=?",
            arrayOf(now.toString()),
            android.provider.CalendarContract.Events.DTSTART + " ASC")
        cur?.use { c ->
            val it_ = c.getColumnIndex(android.provider.CalendarContract.Events.TITLE)
            val ids = c.getColumnIndex(android.provider.CalendarContract.Events.DTSTART)
            var n = 0
            while (c.moveToNext() && n < limit) {
                if (n > 0) sb.append(",")
                sb.append("{\"title\":\"" + escJ(c.getString(it_) ?: "") + "\",\"start\":" + c.getLong(ids) + "}")
                n++
            }
        }
        sb.append("]}")
        sb.toString()
    } catch (e: Exception) { err(e) }

    /** 写日历事件：title/startTimeMs（epoch 毫秒） */
    @JavascriptInterface
    fun addCalendarEvent(title: String, startTimeMs: Long): String = try {
        val vals = android.content.ContentValues()
        vals.put(android.provider.CalendarContract.Events.TITLE, title)
        vals.put(android.provider.CalendarContract.Events.DTSTART, startTimeMs)
        vals.put(android.provider.CalendarContract.Events.DTEND, startTimeMs + 3600_000L)
        vals.put(android.provider.CalendarContract.Events.CALENDAR_ID, 1L)
        vals.put(android.provider.CalendarContract.Events.EVENT_TIMEZONE, java.util.TimeZone.getDefault().id)
        val uri = context.contentResolver.insert(android.provider.CalendarContract.Events.CONTENT_URI, vals)
        "{\"ok\":true,\"uri\":\"" + (uri?.toString() ?: "") + "\"}"
    } catch (e: Exception) { err(e) }

    /** 列出媒体图片：返回 {ok,list:[path]}（Android13 走 READ_MEDIA_IMAGES） */
    @JavascriptInterface
    fun listImages(limit: Int): String = try {
        val sb = StringBuilder("{\"ok\":true,\"list\":[")
        val cur = context.contentResolver.query(
            android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            arrayOf(android.provider.MediaStore.Images.Media.DATA),
            null, null, android.provider.MediaStore.Images.Media.DATE_ADDED + " DESC")
        cur?.use { c ->
            val ip = c.getColumnIndex(android.provider.MediaStore.Images.Media.DATA)
            var n = 0
            while (c.moveToNext() && n < limit) {
                if (n > 0) sb.append(",")
                sb.append("\"" + escJ(c.getString(ip) ?: "") + "\"")
                n++
            }
        }
        sb.append("]}")
        sb.toString()
    } catch (e: Exception) { err(e) }

    private fun escJ(s: String): String =
        s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "").replace("\t", " ")

    // ---------- L4 悬浮指令台 ----------

    /** 显示悬浮状态条（需 SYSTEM_ALERT_WINDOW 授权），onStop 留空由 Web 层自行处理中断 */
    @JavascriptInterface
    fun floatConsoleShow(title: String): String = try {
        ZFFloatConsole.show(context, title)
        if (ZFFloatConsole.isShowing) "{\"ok\":true}" else "{\"ok\":false,\"error\":\"无悬浮窗权限，请到系统设置授权「显示在其他应用上层」\"}"
    } catch (e: Exception) { err(e) }

    @JavascriptInterface
    fun floatConsoleUpdate(title: String): String = try {
        ZFFloatConsole.update(title); "{\"ok\":true}"
    } catch (e: Exception) { err(e) }

    @JavascriptInterface
    fun floatConsoleHide(): String = try {
        ZFFloatConsole.hide(); "{\"ok\":true}"
    } catch (e: Exception) { err(e) }

    // ---------- L4 连续执行 ----------

    /** 批量手势队列（节流、失败即停），委托无障碍服务 runSequence */
    @JavascriptInterface
    fun runSequence(steps: String, intervalMs: Int): String = try {
        ZFAccessibilityService.instance?.runSequence(steps, intervalMs.toLong())
            ?: "{\"ok\":false,\"error\":\"无障碍服务未就绪\"}"
    } catch (e: Exception) { err(e) }
}

/** UI 桥：网页登录成功后调用 ZFUI.setToolsVisible(true) 显示原生顶部工具按钮 */
class ZFUIBridge(private val activity: java.lang.ref.WeakReference<MainActivity>) {
    @JavascriptInterface
    fun setToolsVisible(visible: Boolean) {
        val act = activity.get() ?: return
        act.runOnUiThread {
            val v = if (visible) android.view.View.VISIBLE else android.view.View.GONE
            // 右上角浮空「⋯更多」按钮整体显示/隐藏（含其工具计数徽标）。登录前隐藏，登录后显示。
            act.findViewById<android.view.View>(R.id.tab_more_wrap)?.visibility = v
        }
    }

    /** 工具执行计数：网页 toolBump 后调用，把数字同步到原生顶部工具按钮徽标并播放放大动画 */
    @JavascriptInterface
    fun setToolCount(n: Int) {
        val act = activity.get() ?: return
        act.runOnUiThread {
            val badge = act.findViewById<android.widget.TextView>(R.id.tab_tools_badge) ?: return@runOnUiThread
            if (n <= 0) {
                badge.visibility = android.view.View.GONE
                return@runOnUiThread
            }
            badge.text = if (n > 99) "99+" else n.toString()
            badge.visibility = android.view.View.VISIBLE
            badge.animate().cancel()
            badge.scaleX = 1f; badge.scaleY = 1f
            badge.animate().scaleX(1.7f).scaleY(1.7f).setDuration(160)
                .withEndAction {
                    badge.animate().scaleX(1f).scaleY(1f).setDuration(220).start()
                }.start()
        }
    }
}
