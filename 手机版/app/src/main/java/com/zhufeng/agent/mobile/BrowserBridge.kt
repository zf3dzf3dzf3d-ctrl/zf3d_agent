package com.zhufeng.agent.mobile

import android.graphics.Bitmap
import android.webkit.JavascriptInterface
import android.webkit.WebView
import java.io.ByteArrayOutputStream

/**
 * 内置浏览器控制桥：峰控助手（聊天页智能体）通过 window.ZFBrowser
 * 直接控制 App 自带的内置浏览器 browserView（导航/读正文/执行JS/截图/前进后退）。
 * 只挂在聊天 WebView（chatView）上，browserView 自身网页无法访问本桥（与 TermBridge 同策略）。
 * 注意：evalJS 只对助手注入的代码在 browserView 上执行，browserView 内页面拿不到桥引用。
 */
class BrowserBridge(private val activity: MainActivity) {

    private fun browser(): WebView? = activity.getBrowserView()

    @JavascriptInterface
    fun navigate(url: String): String {
        var u = url.trim()
        if (u.isEmpty()) return "{\"error\":\"空网址\"}"
        if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://$u"
        val wv = browser() ?: return "{\"error\":\"浏览器未就绪\"}"
        activity.runOnUiThread { wv.loadUrl(u) }
        return "{\"ok\":true,\"url\":\"$u\"}"
    }

    @JavascriptInterface
    fun currentUrl(): String {
        val wv = browser() ?: return "{\"error\":\"浏览器未就绪\"}"
        return "{\"ok\":true,\"url\":\"${wv.url ?: ""}\",\"title\":\"${wv.title ?: ""}\"}"
    }

    /** 同步读正文：JS 桥运行在独立后台线程，允许 latch 等待 UI 线程 evaluateJavascript 回调 */
    @JavascriptInterface
    fun getContent(): String {
        val wv = browser() ?: return "{\"error\":\"浏览器未就绪\"}"
        var result: String? = null
        val latch = java.util.concurrent.CountDownLatch(1)
        activity.runOnUiThread {
            wv.evaluateJavascript(
                "(function(){var t=document.body?document.body.innerText:'';return JSON.stringify({url:location.href,title:document.title,text:t});})()"
            ) { v -> result = v; latch.countDown() }
        }
        try {
            if (!latch.await(8, java.util.concurrent.TimeUnit.SECONDS)) return "{\"error\":\"读取超时\"}"
        } catch (e: InterruptedException) { return "{\"error\":\"读取中断\"}" }
        // evaluateJavascript 返回的是 JSON 字符串再包一层引号，剥壳还原
        var s = result ?: return "{\"error\":\"无结果\"}"
        if (s.length >= 2 && s.startsWith("\"") && s.endsWith("\"")) {
            s = s.substring(1, s.length - 1)
                .replace("\\\\\"", "\"").replace("\\\\\\\\", "\\\\")
                .replace("\\\\n", "\n").replace("\\\\r", "").replace("\\\\t", "\t")
        }
        if (s.length > 12000) s = s.substring(0, 12000) + "…[截断]"
        return s
    }

    @JavascriptInterface
    fun evalJS(script: String): String {
        if (script.isBlank()) return "{\"error\":\"空脚本\"}"
        val wv = browser() ?: return "{\"error\":\"浏览器未就绪\"}"
        var result: String? = null
        val latch = java.util.concurrent.CountDownLatch(1)
        activity.runOnUiThread {
            wv.evaluateJavascript(script) { v -> result = v; latch.countDown() }
        }
        try {
            if (!latch.await(10, java.util.concurrent.TimeUnit.SECONDS)) return "{\"error\":\"执行超时\"}"
        } catch (e: InterruptedException) { return "{\"error\":\"执行中断\"}" }
        val r = result ?: "null"
        return if (r.length > 6000) r.substring(0, 6000) + "…[截断]" else r
    }

    /** 截图 browserView 当前画面，返回 JPEG base64（quality 1-100） */
    @JavascriptInterface
    fun screenshot(quality: Int): String {
        val wv = browser() ?: return "{\"error\":\"浏览器未就绪\"}"
        var data: String? = null
        val latch = java.util.concurrent.CountDownLatch(1)
        activity.runOnUiThread {
            val bmp = try {
                wv.buildDrawingCache()
                val c = wv.drawingCache
                if (c != null) c.copy(Bitmap.Config.RGB_565, false) else null
            } catch (e: Exception) { null }
            wv.destroyDrawingCache()
            if (bmp != null) {
                val bos = ByteArrayOutputStream()
                bmp.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(10, 100), bos)
                bmp.recycle()
                data = android.util.Base64.encodeToString(bos.toByteArray(), android.util.Base64.NO_WRAP)
            }
            latch.countDown()
        }
        try {
            if (!latch.await(8, java.util.concurrent.TimeUnit.SECONDS)) return "{\"error\":\"截图超时\"}"
        } catch (e: InterruptedException) { return "{\"error\":\"截图中断\"}" }
        val d = data ?: return "{\"error\":\"截图失败\"}"
        return "{\"ok\":true,\"data\":\"$d\"}"
    }

    @JavascriptInterface
    fun goBack(): String {
        val wv = browser() ?: return "{\"error\":\"浏览器未就绪\"}"
        activity.runOnUiThread { if (wv.canGoBack()) wv.goBack() }
        return "{\"ok\":true}"
    }

    @JavascriptInterface
    fun goForward(): String {
        val wv = browser() ?: return "{\"error\":\"浏览器未就绪\"}"
        activity.runOnUiThread { if (wv.canGoForward()) wv.goForward() }
        return "{\"ok\":true}"
    }

    @JavascriptInterface
    fun reload(): String {
        val wv = browser() ?: return "{\"error\":\"浏览器未就绪\"}"
        activity.runOnUiThread { wv.reload() }
        return "{\"ok\":true}"
    }
}
