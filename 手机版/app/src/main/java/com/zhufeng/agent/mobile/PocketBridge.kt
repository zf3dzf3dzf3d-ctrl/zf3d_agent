package com.zhufeng.agent.mobile

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import androidx.core.app.ActivityCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URL
import java.util.Locale
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

/**
 * 峰控完整桥：聊天页 v22（assets/web/index.html）的 agentExecTool 依赖 window.ZFBridge 的
 * 全套原生方法。此前只有 vibrate/clipboardCopy，导致助手面板所有工具报「bridge不可用」。
 * 现补齐：readFile/writeFile/appendFile/listFiles/searchFiles/deleteFile/httpGet/
 * deviceInfo/netInfo/openUrl/speak/speakStop/notify，以及 v23 扩展 18 个：
 * clipboardPaste/storageInfo/requestStorage/screenInfo/setBrightness/volume/
 * openApp/notifyMe/fileInfo/moveFile/replaceInFile/treeDir/grepFiles/runCmd/
 * noteSave/noteGet/noteList（+clipboardCopy 等既有方法）。
 * 文件操作统一限制在 /sdcard 下，防止越权访问。
 */
class PocketBridge(private val activity: Activity) {

    private val seq = AtomicLong(0)
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    @Volatile private var ttsReadyVolatile = false
    private var ttsRate = 1.0f
    private var lastSpeakId: String? = null
    @Volatile private var lastSpeakError: String? = null
    @Volatile private var speakingTts = false
    /* 服务端 TTS 音频播放器（原生 MediaPlayer，绕开 WebView audio 自动播放静默失败） */
    @Volatile private var mediaPlayer: android.media.MediaPlayer? = null
    private val serverBaseUrl: String

    init {
        /* 从 Activity 取已配置的服务器地址（MainActivity 传参，取不到则空） */
        serverBaseUrl = try {
            val m = activity.javaClass.getMethod("getServerUrlPublic")
            m.invoke(activity) as? String ?: ""
        } catch (_: Throwable) { "" }
    }

    private fun stopPlayback() {
        try { mediaPlayer?.let { mp -> try { mp.stop() } catch (_: Throwable) {}; try { mp.release() } catch (_: Throwable) {} } } catch (_: Throwable) {}
        mediaPlayer = null
        speakingTts = false
    }

    /** 查询原生是否仍在朗读（服务端 MediaPlayer 播放中 或 本机 TTS 播报中）。
     *  供前端 file:// 逐段续读轮询：返回 busy=true 表示当前段未读完，前端继续等待后续读下一段。 */
    @JavascriptInterface
    fun speakBusy(): String {
        val mpBusy = try { mediaPlayer?.let { it.isPlaying } == true } catch (_: Throwable) { false }
        return JSONObject().put("ok", true).put("busy", mpBusy || speakingTts).toString()
    }

    /* ---------- 工具方法 ---------- */

    @JavascriptInterface
    fun vibrate(ms: Int): String {
        return try {
            val v = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                (activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
            else @Suppress("DEPRECATION") activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            if (v == null || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !v.hasVibrator())) {
                err("设备无震动马达或震动服务不可用")
            } else {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createOneShot(ms.toLong(), VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION") v.vibrate(ms.toLong())
                }
                ok()
            }
        } catch (e: Throwable) { err(e.message) }
    }

    @JavascriptInterface
    fun clipboardCopy(text: String): String {
        return try {
            val cm = activity.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return err("无剪贴板服务")
            cm.setPrimaryClip(ClipData.newPlainText("zf", text ?: ""))
            activity.runOnUiThread {
                Toast.makeText(activity, "已复制", Toast.LENGTH_SHORT).show()
            }
            ok()
        } catch (e: Throwable) { err(e.message) }
    }

    /* ---------- 文件操作（限 /sdcard） ---------- */

    private fun safeFile(path: String): File? {
        val p = (path ?: "").replace("^/storage/emulated/0".toRegex(RegexOption.IGNORE_CASE), "/sdcard")
        val root = Environment.getExternalStorageDirectory().canonicalFile
        /* 用 canonicalFile 规范化掉 .. 等符号链接/相对段，防止 /sdcard/../../data 路径穿越绕过限制 */
        val f = File(if (p.startsWith("/sdcard")) p.replace("^/sdcard".toRegex(), root.absolutePath) else p).canonicalFile
        return if (f.absolutePath.startsWith(root.absolutePath)) f else null
    }

    @JavascriptInterface
    fun readFile(path: String): String {
        return try {
            val f = safeFile(path) ?: return err("路径必须在 /sdcard 下")
            if (!f.exists()) return err("文件不存在:$path")
            if (f.isDirectory) return err("是目录，请用 listFiles")
            if (f.length() > 2 * 1024 * 1024) return err("文件过大(${f.length()}B)，拒绝整读")
            JSONObject().put("ok", true).put("path", f.absolutePath).put("size", f.length())
                .put("content", f.readText(Charsets.UTF_8)).toString()
        } catch (e: Throwable) { err(e.message) }
    }

    @JavascriptInterface
    fun writeFile(path: String, content: String): String {
        return try {
            val f = safeFile(path) ?: return err("路径必须在 /sdcard 下")
            f.parentFile?.mkdirs()
            f.writeText(content ?: "", Charsets.UTF_8)
            JSONObject().put("ok", true).put("path", f.absolutePath).put("size", f.length()).toString()
        } catch (e: Throwable) { err(e.message ?: "写入失败（检查存储权限）") }
    }

    @JavascriptInterface
    fun appendFile(path: String, content: String): String {
        return try {
            val f = safeFile(path) ?: return err("路径必须在 /sdcard 下")
            f.parentFile?.mkdirs()
            f.appendText(content ?: "", Charsets.UTF_8)
            JSONObject().put("ok", true).put("path", f.absolutePath).put("size", f.length()).toString()
        } catch (e: Throwable) { err(e.message ?: "追加失败") }
    }

    @JavascriptInterface
    fun listFiles(path: String): String {
        return try {
            val f = safeFile(path) ?: return err("路径必须在 /sdcard 下")
            if (!f.exists()) return err("目录不存在:$path")
            if (!f.isDirectory) return err("不是目录:$path")
            val items = JSONArray()
            f.listFiles()?.sortedWith(compareByDescending<File> { it.isDirectory }.thenBy { it.name.lowercase() })?.forEach { c ->
                items.put(JSONObject().put("name", c.name).put("dir", c.isDirectory).put("size", if (c.isDirectory) 0 else c.length()))
            }
            JSONObject().put("ok", true).put("path", f.absolutePath).put("items", items).toString()
        } catch (e: Throwable) { err(e.message ?: "列目录失败（检查存储权限）") }
    }

    @JavascriptInterface
    fun searchFiles(dir: String, keyword: String, recursive: Boolean): String {
        return try {
            val root = safeFile(dir) ?: return err("路径必须在 /sdcard 下")
            if (!root.exists() || !root.isDirectory) return err("目录不存在:$dir")
            val hits = JSONArray()
            var total = 0
            val kw = (keyword ?: "").lowercase()
            fun walk(d: File) {
                if (total >= 200) return
                d.listFiles()?.forEach { c ->
                    if (total >= 200) return
                    if (c.isDirectory && recursive) walk(c)
                    else if (c.name.lowercase().contains(kw)) { total++; if (hits.length() < 100) hits.put(c.absolutePath) }
                }
            }
            walk(root)
            JSONObject().put("ok", true).put("total", total).put("hits", hits).toString()
        } catch (e: Throwable) { err(e.message ?: "搜索失败") }
    }

    @JavascriptInterface
    fun deleteFile(path: String): String {
        return try {
            val f = safeFile(path) ?: return err("路径必须在 /sdcard 下")
            if (!f.exists()) return err("不存在:$path")
            if (f.isDirectory) return err("不支持删目录")
            if (!f.delete()) return err("删除失败")
            JSONObject().put("ok", true).toString()
        } catch (e: Throwable) { err(e.message ?: "删除失败") }
    }

    /* ---------- 网络 ---------- */

    @JavascriptInterface
    fun httpGet(url: String): String {
        return try {
            val conn = ZFNet.open(url)
            conn.connectTimeout = 12000
            conn.readTimeout = 20000
            conn.instanceFollowRedirects = true
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android ${Build.VERSION.RELEASE}) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36")
            val code = conn.responseCode
            val reader = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()
            /* 限制响应体最大 5MB，防止大响应撑爆内存（与 readFile 的 2MB 限制对齐思路） */
            val sb = StringBuilder()
            val buf = CharArray(8192)
            var n: Int = 0
            val maxChars = 5 * 1024 * 1024 / 2  // 约5MB UTF-8中文按2字节算的上限字符数
            while (reader?.read(buf)?.also { n = it } != null && n > 0 && sb.length < maxChars) {
                sb.append(buf, 0, n)
            }
            val text = sb.toString()
            reader?.close()
            conn.disconnect()
            if (code in 200..299) JSONObject().put("ok", true).put("status", code).put("text", text).toString()
            else err("HTTP $code")
        } catch (e: Throwable) { err(ZFNet.friendly(e)) }
    }

    /* ---------- 设备信息 ---------- */

    @JavascriptInterface
    fun deviceInfo(): String {
        return try {
            val bm = activity.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
            val battery = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1
            val status = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_STATUS) ?: 0
            JSONObject()
                .put("ok", true)
                .put("battery", battery)
                .put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL)
                .put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
                .put("android", Build.VERSION.RELEASE).toString()
        } catch (e: Throwable) { err(e.message) }
    }

    @JavascriptInterface
    fun netInfo(): String {
        return try {
            var ip = ""
            var online = false
            var type = "未知"
            NetworkInterface.getNetworkInterfaces()?.toList()?.forEach { ni ->
                if (ni.isUp && !ni.isLoopback) {
                    ni.inetAddresses?.toList()?.forEach { a ->
                        if (a is Inet4Address) {
                            val h = ni.name.lowercase()
                            if (h.contains("wlan")) { online = true; type = "WiFi"; if (ip.isBlank()) ip = a.hostAddress ?: "" }
                            else if (h.contains("rmnet") || h.contains("ccmni")) { online = true; type = "移动数据"; if (ip.isBlank()) ip = a.hostAddress ?: "" }
                        }
                    }
                }
            }
            JSONObject().put("ok", true).put("online", online).put("type", type).put("ip", ip).toString()
        } catch (e: Throwable) { err(e.message) }
    }

    /* ---------- 打开网址 ---------- */

    @JavascriptInterface
    fun openUrl(url: String): String {
        return try {
            var u = url ?: return err("空URL")
            if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://$u"
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u)))
            JSONObject().put("ok", true).put("resolver", "system").put("note", "已交给系统浏览器").toString()
        } catch (e: Throwable) { err(e.message ?: "打开失败") }
    }

    /* ---------- TTS 朗读 ---------- */

    private fun ensureTts(): TextToSpeech? {
        if (tts != null) return tts
        val t = TextToSpeech(activity.applicationContext) { st ->
            ttsReadyVolatile = st == TextToSpeech.SUCCESS
            if (ttsReadyVolatile) {
                try { tts?.setLanguage(Locale.CHINA) } catch (_: Throwable) {}
                try { tts?.setSpeechRate(ttsRate) } catch (_: Throwable) {}
            }
        }
        /* 朗读出错实时上报：把最近一次错误存起来，供 speak() 返回真实失败而不是假成功 */
        try {
            t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) { speakingTts = true }
                override fun onDone(utteranceId: String?) { speakingTts = false }
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) { lastSpeakError = "朗读出错(TTS引擎错误)"; speakingTts = false }
                override fun onError(utteranceId: String?, errorCode: Int) { lastSpeakError = "朗读出错(code=$errorCode)"; speakingTts = false }
            })
        } catch (_: Throwable) {}
        tts = t
        return t
    }

    @JavascriptInterface
    fun speak(text: String, rate: Double): String {
        return try {
            val t = ensureTts() ?: return err("TTS初始化失败")
            ttsRate = rate.toFloat().takeIf { it > 0 } ?: 1.0f
            /* TTS引擎异步初始化需要时间：未就绪时用 latch 等待（最多3秒），避免忙等空转；ttsReadyVolatile 加 volatile 保证跨线程可见性 */
            var waited = 0
            while (!ttsReadyVolatile && waited < 3000) {
                Thread.sleep(50); waited += 50
            }
            if (!ttsReadyVolatile) return err("TTS引擎未就绪")
            lastSpeakError = null
            /* 语言可用性硬校验：手机没装中文语音包时 setLanguage 返回 MISSING_DATA，
               此时 speak() 只会入队成功但实际无声——必须判失败，让前端回退服务端朗读 */
            val langRes = try { t.setLanguage(Locale.CHINA) } catch (_: Throwable) { TextToSpeech.LANG_MISSING_DATA }
            if (langRes == TextToSpeech.LANG_MISSING_DATA || langRes == TextToSpeech.LANG_NOT_SUPPORTED) {
                /* 尝试系统默认语言，仍不可用才判死 */
                val fb = try { t.setLanguage(Locale.getDefault()) } catch (_: Throwable) { TextToSpeech.LANG_MISSING_DATA }
                if (fb == TextToSpeech.LANG_MISSING_DATA || fb == TextToSpeech.LANG_NOT_SUPPORTED)
                    return err("本机TTS无可用中文语音包(请在系统设置-文字转语音安装)")
            }
            t.setSpeechRate(ttsRate)
            val id = "zf_${seq.incrementAndGet()}"
            lastSpeakId = id
            val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP)
                t.speak(text ?: "", TextToSpeech.QUEUE_FLUSH, null, id)
            else {
                val hp = HashMap<String, String>(); hp[TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID] = id
                @Suppress("DEPRECATION") t.speak(text ?: "", TextToSpeech.QUEUE_FLUSH, hp)
            }
            if (r == TextToSpeech.SUCCESS) JSONObject().put("ok", true).put("rate", ttsRate.toDouble()).toString()
            else err("朗读队列失败" + (lastSpeakError?.let { "($it)" } ?: ""))
        } catch (e: Throwable) { err(e.message ?: "朗读失败") }
    }

    @JavascriptInterface
    fun speakStop(): String {
        return try {
            ensureTts()
            tts?.stop()
            stopPlayback()
            JSONObject().put("ok", true).toString()
        } catch (e: Throwable) { err(e.message ?: "停止失败") }
    }

    /* ---------- 服务端 TTS 原生播放 ----------
     * 原理：电脑端 /api/avatar/tts 返回音频 url，手机原生 MediaPlayer 直接播。
     * 绕开两条已知死路：1) 本机 TTS 缺中文语音包无声；2) WebView audio 自动播放静默失败。
     * 前提：手机 App 已连接电脑服务器（serverUrl 已配置）。 */
    @JavascriptInterface
    fun serverSpeak(text: String): String {
        return try {
            val base = serverBaseUrl.trimEnd('/')
            if (base.isEmpty()) return err("未配置服务器地址(请先在设置里连接电脑智能体)")
            stopPlayback()
            /* 同步调 /api/avatar/tts 拿音频 url（JavascriptInterface 线程，可阻塞） */
            val u = java.net.URL("$base/api/avatar/tts?text=" + java.net.URLEncoder.encode(text ?: "", "UTF-8"))
            val conn = u.openConnection() as java.net.HttpURLConnection
            conn.connectTimeout = 8000; conn.readTimeout = 30000
            conn.requestMethod = "GET"
            val code = conn.responseCode
            val body = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            conn.disconnect()
            if (code !in 200..299) return err("tts接口失败(HTTP $code)")
            /* 解析 {"ok":true,"url":"/audio/xxx.mp3"} */
            var url: String? = null
            try {
                val jo = JSONObject(body)
                if (jo.optBoolean("ok")) url = jo.optString("url", "")
            } catch (_: Throwable) {}
            if (url.isNullOrBlank()) return err("tts接口无音频url")
            val full = if (url.startsWith("http")) url else base + (if (url.startsWith("/")) url else "/$url")
            val mp = android.media.MediaPlayer()
            mp.setAudioStreamType(android.media.AudioManager.STREAM_MUSIC)
            mp.setDataSource(full)
            mp.setOnCompletionListener { stopPlayback() }
            mp.setOnErrorListener { _, _, _ -> stopPlayback(); true }
            mp.prepare()  // 同步准备：本地局域网文件很快
            mp.start()
            mediaPlayer = mp
            JSONObject().put("ok", true).put("url", full).toString()
        } catch (e: Throwable) {
            stopPlayback()
            err("服务端朗读失败:" + (e.message ?: e.javaClass.simpleName))
        }
    }

    /* ---------- 系统通知 ---------- */

    @JavascriptInterface
    fun notify(title: String, body: String): String {
        return try {
            val nm = activity.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return err("无通知服务")
            val chId = "zf_agent"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.createNotificationChannel(NotificationChannel(chId, "朱峰智能体", NotificationManager.IMPORTANCE_DEFAULT))
            }
            val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                Notification.Builder(activity, chId)
            else @Suppress("DEPRECATION") Notification.Builder(activity)
            b.setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title ?: "朱峰智能体")
                .setContentText(body ?: "")
                .setAutoCancel(true)
            // 直接发（峰控界面在前台时也可见）；Android 13+ 若用户未授通知权限，系统会静默丢弃
            nm.notify((seq.incrementAndGet() % 100000).toInt(), b.build())
            JSONObject().put("ok", true).toString()
        } catch (e: Throwable) { err(e.message ?: "通知失败（Android 13+ 需允许通知权限）") }
    }

    /* ---------- 峰控扩展 v2：剪贴板读/存储/屏幕亮度/音量/打开App/通知/文件进阶/命令/记事本 ---------- */

    @JavascriptInterface
    fun clipboardPaste(): String {
        return try {
            val cm = activity.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return err("无剪贴板服务")
            val clip = cm.primaryClip ?: return err("剪贴板为空")
            if (clip.itemCount < 1) return err("剪贴板为空")
            JSONObject().put("ok", true).put("text", clip.getItemAt(0).coerceToText(activity)?.toString() ?: "").toString()
        } catch (e: Throwable) { err(e.message ?: "读取失败") }
    }

    /** 读剪贴板里的图片：支持 imageUri / Intent.clipData 两种形式，返回 {ok,dataUrl,name} JSON（配合聊天页加号→粘贴图片） */
    @JavascriptInterface
    fun clipboardImage(): String {
        return try {
            val cm = activity.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return err("无剪贴板服务")
            val clip = cm.primaryClip ?: return err("剪贴板为空")
            if (clip.itemCount < 1) return err("剪贴板为空")
            var imgUri: Uri? = null
            for (i in 0 until clip.itemCount) {
                val it = clip.getItemAt(i)
                imgUri = it.uri ?: it.intent?.clipData?.let { ic -> if (ic.itemCount > 0) ic.getItemAt(0).uri else null }
                if (imgUri != null) break
            }
            if (imgUri == null) return err("剪贴板里没有图片")
            val cr = activity.contentResolver
            val type = cr.getType(imgUri)
            if (type != null && !type.startsWith("image/")) return err("剪贴板里没有图片")
            val bmp = android.graphics.ImageDecoder.decodeBitmap(
                android.graphics.ImageDecoder.createSource(cr, imgUri)
            ) { d, _, _ -> d.setAllocator(android.graphics.ImageDecoder.ALLOCATOR_SOFTWARE) }
            val bos = java.io.ByteArrayOutputStream()
            bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, bos)
            bmp.recycle()
            val b64 = android.util.Base64.encodeToString(bos.toByteArray(), android.util.Base64.NO_WRAP)
            JSONObject().put("ok", true)
                .put("dataUrl", "data:image/png;base64," + b64)
                .put("name", "clipboard.png")
                .toString()
        } catch (e: Throwable) { err(e.message ?: "读取剪贴板图片失败") }
    }

    @JavascriptInterface
    fun storageInfo(): String {
        return try {
            val ext = Environment.getExternalStorageDirectory()
            val appDir = activity.getExternalFilesDir(null)?.absolutePath ?: activity.filesDir.absolutePath
            val stat = android.os.StatFs(ext.absolutePath)
            val granted = android.os.Build.VERSION.SDK_INT < 30 ||
                Environment.isExternalStorageManager() ||
                activity.checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) == android.content.pm.PackageManager.PERMISSION_GRANTED
            JSONObject().put("ok", true)
                .put("external", ext.absolutePath)
                .put("appDir", appDir)
                .put("granted", granted)
                .put("freeGB", Math.round(stat.availableBytes / 1073741824.0 * 10) / 10.0)
                .put("totalGB", Math.round(stat.totalBytes / 1073741824.0 * 10) / 10.0)
                .toString()
        } catch (e: Throwable) { err(e.message ?: "获取失败") }
    }

    @JavascriptInterface
    fun requestStorage(): String {
        return try {
            /* Android 11+ 用 MANAGE_EXTERNAL_STORAGE 系统设置页；低版本直接弹运行时权限 */
            if (Build.VERSION.SDK_INT >= 30) {
                val i = Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + activity.packageName))
                activity.startActivity(i)
            } else {
                androidx.core.app.ActivityCompat.requestPermissions(
                    activity,
                    arrayOf(android.Manifest.permission.READ_EXTERNAL_STORAGE, android.Manifest.permission.WRITE_EXTERNAL_STORAGE), 9001)
            }
            ok()
        } catch (e: Throwable) {
            try {
                activity.startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + activity.packageName)))
                ok()
            } catch (e2: Throwable) { err(e2.message ?: "跳转失败") }
        }
    }

    @JavascriptInterface
    fun screenInfo(): String {
        return try {
            val m = activity.resources.displayMetrics
            val b = try { android.provider.Settings.System.getInt(activity.contentResolver, android.provider.Settings.System.SCREEN_BRIGHTNESS) } catch (_: Throwable) { -1 }
            JSONObject().put("ok", true).put("w", m.widthPixels).put("h", m.heightPixels)
                .put("density", Math.round(m.density * 10) / 10.0).put("brightness", b).toString()
        } catch (e: Throwable) { err(e.message ?: "获取失败") }
    }

    @JavascriptInterface
    fun setBrightness(v: Int): String {
        return try {
            if (!android.provider.Settings.System.canWrite(activity)) {
                activity.startActivity(Intent(android.provider.Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:" + activity.packageName)))
                return err("需要「修改系统设置」权限，已跳转授权页")
            }
            val c = activity.contentResolver
            android.provider.Settings.System.putInt(c, android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE, android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
            android.provider.Settings.System.putInt(c, android.provider.Settings.System.SCREEN_BRIGHTNESS, v.coerceIn(1, 255))
            ok()
        } catch (e: Throwable) { err(e.message ?: "设置失败") }
    }

    @JavascriptInterface
    fun volume(percent: Int): String {
        return try {
            val am = activity.getSystemService(Context.AUDIO_SERVICE) as? android.media.AudioManager ?: return err("无音频服务")
            val p = percent.coerceIn(0, 100)
            val max = am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC)
            am.setStreamVolume(android.media.AudioManager.STREAM_MUSIC, (max * p + 50) / 100, 0)
            JSONObject().put("ok", true).put("volume", p).toString()
        } catch (e: Throwable) { err(e.message ?: "设置失败") }
    }

    @JavascriptInterface
    fun openApp(pkg: String): String {
        return try {
            val pm = activity.packageManager
            val i = pm.getLaunchIntentForPackage(pkg ?: "")
                ?: return err("未安装该应用：$pkg")
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(i)
            ok()
        } catch (e: Throwable) { err(e.message ?: "启动失败") }
    }

    @JavascriptInterface
    fun notifyMe(title: String, body: String): String = notify(title, body)

    @JavascriptInterface
    fun fileInfo(path: String): String {
        return try {
            val f = safeFile(path) ?: return err("路径必须在 /sdcard 下")
            if (!f.exists()) return err("不存在:$path")
            JSONObject().put("ok", true).put("dir", f.isDirectory).put("size", f.length())
                .put("modified", f.lastModified()).put("canWrite", f.canWrite())
                .put("canRead", f.canRead()).put("path", f.absolutePath).toString()
        } catch (e: Throwable) { err(e.message ?: "获取失败") }
    }

    @JavascriptInterface
    fun moveFile(from: String, to: String): String {
        return try {
            val src = safeFile(from) ?: return err("源路径必须在 /sdcard 下")
            val dst = safeFile(to) ?: return err("目标路径必须在 /sdcard 下")
            if (!src.exists()) return err("源不存在:$from")
            dst.parentFile?.mkdirs()
            if (src.renameTo(dst)) ok() else {
                /* rename 跨分区可能失败，回退复制+删源 */
                if (src.isDirectory) return err("移动目录失败（跨分区不支持目录）")
                dst.outputStream().use { o -> src.inputStream().use { it.copyTo(o) } }
                if (src.delete()) ok() else err("复制成功但删除源失败")
            }
        } catch (e: Throwable) { err(e.message ?: "移动失败") }
    }

    @JavascriptInterface
    fun replaceInFile(path: String, from: String, to: String): String {
        return try {
            val f = safeFile(path) ?: return err("路径必须在 /sdcard 下")
            if (!f.exists()) return err("文件不存在:$path")
            if (f.length() > 2 * 1024 * 1024) return err("文件过大，拒绝替换")
            val text = f.readText(Charsets.UTF_8)
            var count = 0
            var idx = text.indexOf(from)
            if (idx < 0 || from.isEmpty()) return err("未找到目标文本")
            while (idx >= 0) { count++; idx = text.indexOf(from, idx + from.length) }
            f.writeText(text.replace(from, to), Charsets.UTF_8)
            JSONObject().put("ok", true).put("count", count).toString()
        } catch (e: Throwable) { err(e.message ?: "替换失败") }
    }

    @JavascriptInterface
    fun treeDir(path: String, depth: Int): String {
        return try {
            val root = safeFile(path) ?: return err("路径必须在 /sdcard 下")
            if (!root.isDirectory) return err("不是目录:$path")
            val sb = StringBuilder()
            fun walk(d: File, prefix: String, level: Int) {
                if (level > depth.coerceIn(1, 6) || sb.length > 60000) return
                val kids = d.listFiles()?.sortedWith(compareByDescending<File> { it.isDirectory }.thenBy { it.name.lowercase() }) ?: return
                kids.forEachIndexed { i, c ->
                    if (sb.length > 60000) return
                    val branch = if (i == kids.lastIndex) "└─ " else "├─ "
                    sb.append(prefix).append(branch).append(c.name).append(if (c.isDirectory) "/" else "").append('\n')
                    if (c.isDirectory) walk(c, prefix + if (i == kids.lastIndex) "   " else "│  ", level + 1)
                }
            }
            sb.append(root.name).append("/\n")
            walk(root, "", 1)
            JSONObject().put("ok", true).put("tree", sb.toString().trimEnd('\n')).toString()
        } catch (e: Throwable) { err(e.message ?: "失败") }
    }

    @JavascriptInterface
    fun grepFiles(dir: String, keyword: String): String {
        return try {
            val root = safeFile(dir) ?: return err("路径必须在 /sdcard 下")
            if (!root.isDirectory) return err("目录不存在:$dir")
            val hits = JSONArray(); var total = 0
            val kw = (keyword ?: "").lowercase()
            fun walk(d: File, depth: Int) {
                if (total >= 100 || depth > 5) return
                d.listFiles()?.forEach { c ->
                    if (total >= 100) return
                    if (c.isDirectory) walk(c, depth + 1)
                    else if (c.length() < 1024 * 1024) {
                        try {
                            if (c.readText(Charsets.UTF_8).lowercase().contains(kw)) {
                                total++
                                if (hits.length() < 50) hits.put(c.absolutePath)
                            }
                        } catch (_: Throwable) {}
                    }
                }
            }
            walk(root, 0)
            JSONObject().put("ok", true).put("total", total).put("hits", hits).toString()
        } catch (e: Throwable) { err(e.message ?: "失败") }
    }

    @JavascriptInterface
    fun runCmd(cmd: String): String {
        return try {
            /* 安全白名单 shell：按命令前缀白名单放行（仅只读/低危命令），输出截断 8KB */
            val allow = setOf("ls","cat","df","ps","top","free","id","whoami","uname","getprop","date","uptime","ifconfig","netstat","ip","ping","dumpsys","logcat","pm","am","settings","wc","head","tail","echo","stat","du","find","grep","sleep","wm","svc","cmd","toybox","busybox","mount","catlog")
            val first = (cmd ?: "").trim().split(Regex("[\\s;&|]+")).filter { it.isNotBlank() }.firstOrNull() ?: return err("空命令")
            if (first !in allow) return err("命令不在白名单: $first")
            /* 多候选 shell 逐个回退：libbusybox.so(jniLibs) → 系统 busybox/sh/toybox，任一可用即执行 */
            val cands = buildList {
                val nld = activity.applicationInfo.nativeLibraryDir
                nld?.let { File(it, "libbusybox.so").takeIf { f -> f.exists() }?.let { f -> add(f.absolutePath) } }
                addAll(listOf("/system/bin/busybox","/system/xbin/busybox","/system/bin/sh","/system/xbin/sh","/system/bin/toybox","/system/xbin/toybox"))
            }
            var lastErr = ""
            var done = false
            var out = ""
            var code = -1
            for (sh in cands) {
                try {
                    val isBusybox = sh.endsWith("busybox.so") || sh.endsWith("busybox")
                    val args = if (isBusybox) arrayOf(sh, "sh", "-c", cmd ?: "") else arrayOf(sh, "-c", cmd ?: "")
                    val p2 = Runtime.getRuntime().exec(args)
                    val so2 = p2.inputStream.bufferedReader().use { it.readText() }.take(8000)
                    val se2 = p2.errorStream.bufferedReader().use { it.readText() }.take(2000)
                    code = p2.waitFor()
                    if (code == 127) { lastErr += "$sh → sh applet缺失(exit 127); "; continue }
                    out = (so2 + if (se2.isNotBlank()) "\n[stderr] $se2" else "").trim() + "\n[shell=$sh]"
                    done = true
                    break
                } catch (e: Throwable) { lastErr += "$sh → ${e.message}; " }
            }
            if (!done) return err("所有候选 shell 均失败: $lastErr")
            JSONObject().put("ok", true).put("code", code).put("output", out).toString()
        } catch (e: Throwable) { err(e.message ?: "执行失败") }
    }

    /* 记事本：持久化到 /sdcard/Android/data/<pkg>/zf_notes.json（应用专属目录，无需权限） */
    private fun notesFile(): File {
        val dir = activity.getExternalFilesDir(null) ?: activity.filesDir
        return File(dir, "zf_notes.json")
    }
    private fun loadNotes(): MutableMap<String, String> {
        val m = LinkedHashMap<String, String>()
        try {
            val f = notesFile()
            if (f.exists()) {
                val o = JSONObject(f.readText(Charsets.UTF_8))
                o.keys().forEach { k -> m[k] = o.optString(k) }
            }
        } catch (_: Throwable) {}
        return m
    }
    private fun saveNotes(m: Map<String, String>) {
        val o = JSONObject()
        m.forEach { (k, v) -> o.put(k, v) }
        notesFile().writeText(o.toString(), Charsets.UTF_8)
    }

    @JavascriptInterface
    fun noteSave(key: String, value: String): String {
        return try {
            val m = loadNotes()
            m[key ?: ""] = value ?: ""
            if (m.size > 500) { val it = m.entries.iterator(); while (m.size > 500) { it.next(); it.remove() } }
            saveNotes(m)
            ok()
        } catch (e: Throwable) { err(e.message ?: "保存失败") }
    }

    @JavascriptInterface
    fun noteGet(key: String): String {
        return try {
            val m = loadNotes()
            if (!m.containsKey(key)) return err("没有这条记录:$key")
            JSONObject().put("ok", true).put("val", m[key] ?: "").toString()
        } catch (e: Throwable) { err(e.message ?: "失败") }
    }

    @JavascriptInterface
    fun noteList(): String {
        return try {
            val m = loadNotes()
            val arr = JSONArray(); m.keys.forEach { arr.put(it) }
            JSONObject().put("ok", true).put("keys", arr).toString()
        } catch (e: Throwable) { err(e.message ?: "失败") }
    }

    /* ---------- 登录态持久化 ---------- */

    @JavascriptInterface
    fun saveSessions(json: String) {
        try {
            activity.getSharedPreferences("zf_mobile", Context.MODE_PRIVATE)
                .edit().putString("zf_sessions", json ?: "").apply()
        } catch (_: Throwable) { }
    }

    @JavascriptInterface
    fun loadSessions(): String {
        return try {
            activity.getSharedPreferences("zf_mobile", Context.MODE_PRIVATE)
                .getString("zf_sessions", "") ?: ""
        } catch (_: Throwable) { "" }
    }

    /* ---------- JSON 工具 ---------- */

    private fun ok() = JSONObject().put("ok", true).toString()
    private fun err(msg: String?) = JSONObject().put("ok", false).put("error", msg ?: "失败").toString()

    companion object { private const val TAG = "PocketBridge" }
}
