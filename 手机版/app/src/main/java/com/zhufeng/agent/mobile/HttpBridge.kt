package com.zhufeng.agent.mobile

import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors

/**
 * 原生 HTTP 桥：解决 file:// 聊天页在新版 WebView 中 fetch() 被 CORS 拦截（Failed to fetch）。
 * 页面注入 fetch shim，把 http(s) 请求转给原生 HttpURLConnection 执行，结果回调 __zfHttpDone。
 */
class HttpBridge(private val webView: WebView) {
    private val executor = Executors.newCachedThreadPool()
    private val active = java.util.concurrent.ConcurrentHashMap<String, HttpURLConnection>()

    /** 页面停止时调用：立即断开对应请求的底层连接，不傻等响应 */
    @JavascriptInterface
    fun cancel(id: String) {
        active.remove(id)?.let { conn ->
            try { conn.disconnect() } catch (_: Exception) {}
        }
    }

    @JavascriptInterface
    fun request(id: String, url: String, method: String, headersJson: String, body: String?) {
        executor.execute {
            var status = 0
            var text = ""
            // 弱网/4G 下连接易抖动：网络类异常自动重试，最多 3 次尝试
            var lastErr: Exception? = null
            for (attempt in 1..3) {
                var conn: HttpURLConnection? = null
                try {
                    conn = ZFNet.open(url)
                    active[id] = conn   // 注册到活动表，供 cancel(id) 随时断开
                    conn.requestMethod = if (method.isBlank()) "GET" else method.uppercase()
                    conn.connectTimeout = 15000   // 外网/中继场景放宽到 15 秒
                    conn.readTimeout = 120000
                    conn.instanceFollowRedirects = true
                    // 不手动设置 Accept-Encoding: gzip —— HttpURLConnection 会自动加 gzip 头并透明解压；
                    // 手动设置后框架不再自动解压，导致响应体是乱码，页面 JSON.parse 失败报"响应异常"
                    try {
                        val headers = JSONObject(if (headersJson.isBlank()) "{}" else headersJson)
                        val keys = headers.keys()
                        while (keys.hasNext()) {
                            val k = keys.next()
                            if (k.equals("referer", true) || k.equals("origin", true) || k.equals("host", true)) continue
                            conn.setRequestProperty(k, headers.getString(k))
                        }
                    } catch (_: Exception) { }
                    if (!body.isNullOrEmpty() && conn.requestMethod != "GET" && conn.requestMethod != "HEAD") {
                        conn.doOutput = true
                        conn.outputStream.use { it.write(body.toByteArray(StandardCharsets.UTF_8)) }
                    }
                    status = conn.responseCode
                    val stream = if (status in 200..299) conn.inputStream else conn.errorStream
                    text = stream?.let {
                        BufferedReader(InputStreamReader(it, StandardCharsets.UTF_8)).use { r -> r.readText() }
                    } ?: ""
                    // 不调用 disconnect()：读完响应体后连接自动回 JVM 连接池，下次请求复用 keep-alive
                    break   // 成功则退出重试循环
                } catch (e: Exception) {
                    lastErr = e
                    try { conn?.disconnect() } catch (_: Exception) {}
                    val netErr = e is java.net.SocketTimeoutException || e is java.net.ConnectException ||
                            e is java.net.UnknownHostException || e is javax.net.ssl.SSLException
                    if (netErr && attempt < 3) {
                        try { Thread.sleep(800L * attempt) } catch (_: InterruptedException) {}
                        continue    // 网络类异常自动重试
                    }
                    status = -1
                    // 把异常翻译成用户能看懂的中文提示带回给页面
                    text = ZFNet.friendly(e)
                }
            }
            val payload = JSONObject().put("status", status).put("body", text)
            webView.post {
                webView.evaluateJavascript(
                    "window.__zfHttpDone&&window.__zfHttpDone(${JSONObject.quote(id)},$payload)", null
                )
            }
        }
    }
}
