package com.zhufeng.agent.mobile

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Base64

/**
 * L3 通知栏读取服务：用户在系统设置授予「通知使用权」后生效。
 * ZFN Bridge 通过 instance 快照读取当前通知列表。
 */
class ZFNotificationListener : NotificationListenerService() {

    companion object {
        @Volatile
        var instance: ZFNotificationListener? = null
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    /** 读取当前活跃通知，返回 JSON 数组字符串 */
    fun readNotificationsJson(limit: Int = 30): String {
        val list = try { activeNotifications } catch (e: Exception) { emptyArray() }
        val sb = StringBuilder("[")
        var n = 0
        for (sbn in list) {
            if (n >= limit) break
            val notif: Notification = sbn.notification ?: continue
            val extras = notif.extras
            val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
            val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
            val pkg = sbn.packageName ?: ""
            val whenMs = sbn.postTime
            val json = "{\"pkg\":\"" + esc(pkg) + "\",\"title\":\"" + esc(title) +
                    "\",\"text\":\"" + esc(text) + "\",\"when\":" + whenMs + "}"
            if (n > 0) sb.append(",")
            sb.append(json)
            n++
        }
        sb.append("]")
        return sb.toString()
    }

    private fun esc(s: String): String =
        s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "").replace("\t", " ")
}
