package com.zhufeng.agent.mobile

import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URL
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * 网络助手：
 * 1. DNS 兜底：域名解析失败时改用预置 IP 直连（Host 头仍带原域名），专治运营商 DNS 抽风；
 * 2. 异常翻译：把英文异常转成人能看懂的中文提示。
 */
object ZFNet {
    // 域名 -> IP 兜底表（服务器换 IP 时记得同步更新）
    val HOST_FALLBACK = mapOf("www.zf3d.com" to "8.138.95.7")

    fun friendly(e: Throwable): String {
        val msg = e.message ?: e.toString()
        return when (e) {
            is java.net.UnknownHostException ->
                "无法连接服务器：手机暂时解析不了域名（常见于 WiFi/流量切换瞬间或 DNS 故障），请检查网络后重试"
            is java.net.SocketTimeoutException ->
                "连接超时：网络信号弱或服务器响应慢，请稍后重试"
            is java.net.ConnectException ->
                "无法建立连接：服务器不可达，请确认手机网络已连接（WiFi 或流量）后重试"
            is javax.net.ssl.SSLException ->
                "安全连接出错：请检查手机系统时间是否正确，或网络环境是否异常"
            is java.io.IOException ->
                "网络错误：$msg"
            else ->
                "请求失败：$msg"
        }
    }

    private val trustAll = arrayOf<TrustManager>(object : X509TrustManager {
        override fun checkClientTrusted(c: Array<java.security.cert.X509Certificate>?, a: String?) {}
        override fun checkServerTrusted(c: Array<java.security.cert.X509Certificate>?, a: String?) {}
        override fun getAcceptedIssuers(): Array<java.security.cert.X509Certificate> = arrayOf()
    })

    /** 打开连接；域名解析失败且在兜底表中时，改用 IP 直连 + Host 头（HTTPS 下临时信任证书） */
    fun open(urlStr: String): HttpURLConnection {
        var use = urlStr
        var hostHeader: String? = null
        try {
            val url = URL(urlStr)
            val host = url.host
            try {
                InetAddress.getByName(host)
            } catch (e: Exception) {
                val ip = HOST_FALLBACK[host]
                if (ip != null) {
                    hostHeader = host
                    use = urlStr.replaceFirst(host, ip)
                } else throw e
            }
        } catch (_: Exception) { }
        val conn = URL(use).openConnection() as HttpURLConnection
        if (hostHeader != null && conn is HttpsURLConnection) {
            val ctx = SSLContext.getInstance("TLS")
            ctx.init(null, trustAll, java.security.SecureRandom())
            conn.sslSocketFactory = ctx.socketFactory
            conn.hostnameVerifier = HostnameVerifier { _, _ -> true }
        }
        if (hostHeader != null) conn.setRequestProperty("Host", hostHeader)
        return conn
    }
}
