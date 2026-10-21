package com.zhufeng.agent.mobile

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.concurrent.thread

/**
 * 峰控「文件」Tab：直通电脑智能体产出目录。
 * 数据来自 server /api/fengkong/files|download|thumb；点条目下载到手机 Downloads\ZF峰控\。
 */
class FilesView(private val activity: Activity, private val serverUrl: String) {

    private val root = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(0xFF101418.toInt())
        visibility = View.GONE
    }
    private val status = TextView(activity).apply {
        setTextColor(0xFF8899AA.toInt())
        textSize = 13f
        setPadding(24, 32, 24, 16)
    }
    private lateinit var list: ListView
    private var items: JSONArray = JSONArray()
    /** 【新增】关闭回调：由 MainActivity 注入，点 ✕ 切回助手页 */
    var onClose: (() -> Unit)? = null

    init {
        // 【新增】顶部栏：标题 + 右上角关闭按钮（点 ✕ 切回助手页）
        val headerBar = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(24, 32, 24, 0)
        }
        headerBar.addView(TextView(activity).apply {
            setTextColor(0xFF8899AA.toInt())
            textSize = 13f
            text = "📁 峰控文件"
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        headerBar.addView(android.widget.Button(activity).apply {
            text = "✕"
            setTextColor(0xFF8899AA.toInt())
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            setOnClickListener { onClose?.invoke() }
        })
        root.addView(headerBar)
        root.addView(status)
        // 顶部操作栏：「⬆ 上传到电脑」按钮（SAF 选文件 → multipart 流式上传到 downloads\from_phone）
        val bar = android.widget.Button(activity).apply {
            text = "⬆ 上传到电脑"
            setOnClickListener { pickAndUpload() }
            setPadding(24, 16, 24, 16)
        }
        root.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(24, 16, 24, 8) })
        list = ListView(activity).apply { dividerHeight = 1; divider = android.graphics.drawable.ColorDrawable(0xFF232A33.toInt()) }
        root.addView(list, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        list.setOnItemClickListener { _, _, pos, _ -> onItem(pos) }
        refresh()
        startToPhoneWatcher()
    }

    // 【阶段B】轮询 downloads\to_phone，电脑端「📲 发到手机」推送新文件时 Toast 提醒
    private var lastToPhoneKey = ""
    private var watcherStarted = false
    private fun startToPhoneWatcher() {
        if (watcherStarted) return
        watcherStarted = true
        thread {
            while (true) {
                try {
                    val u = "${serverUrl.trimEnd('/')}/api/fengkong/files?dir=downloads/to_phone&limit=10"
                    val conn = URL(u).openConnection() as HttpURLConnection
                    conn.connectTimeout = 4000; conn.readTimeout = 6000
                    conn.setRequestProperty("X-FK-Key", Prefs(activity).authToken)
                    val obj = JSONObject(conn.inputStream.bufferedReader().readText())
                    if (obj.optBoolean("ok")) {
                        val arr = obj.optJSONArray("items") ?: JSONArray()
                        val key = (0 until arr.length()).joinToString("|") { i ->
                            arr.optJSONObject(i)?.optString("name") ?: ""
                        }
                        if (lastToPhoneKey.isNotEmpty() && key != lastToPhoneKey) {
                            val old = lastToPhoneKey.split("|").toSet()
                            val newNames = (0 until arr.length()).mapNotNull { i ->
                                arr.optJSONObject(i)?.optString("name")
                            }.filter { it.isNotEmpty() && it !in old }
                            if (newNames.isNotEmpty()) {
                                activity.runOnUiThread {
                                    Toast.makeText(activity, "📲 电脑推送了 ${newNames.size} 个新文件，去「文件」Tab 查看下载", Toast.LENGTH_LONG).show()
                                }
                            }
                        }
                        lastToPhoneKey = key
                    }
                } catch (e: Exception) { /* 静默重试 */ }
                try { Thread.sleep(5000) } catch (e: InterruptedException) { return@thread }
            }
        }
    }

    private val REQ_UPLOAD = 43001

    fun handleUploadResult(uri: Uri?) {
        if (uri != null) uploadToPc(uri)
    }

    private fun pickAndUpload() {
        try {
            val intent = android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(android.content.Intent.CATEGORY_OPENABLE)
                setType("*/*")
            }
            activity.startActivityForResult(intent, REQ_UPLOAD)
        } catch (e: Exception) {
            Toast.makeText(activity, "无法打开选择器：${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun uploadToPc(uri: Uri) {
        status.text = "正在上传到电脑…"
        thread {
            try {
                val name = queryName(uri) ?: "upload_${System.currentTimeMillis()}.bin"
                val boundary = "----ZFBoundary${System.currentTimeMillis()}"
                val u = "${serverUrl.trimEnd('/')}/api/fengkong/upload"
                val conn = URL(u).openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.connectTimeout = 6000
                conn.readTimeout = 120000
                conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
                conn.setRequestProperty("X-FK-Key", Prefs(activity).authToken)
                val crlf = "\r\n".toByteArray()
                conn.outputStream.use { out ->
                    out.write(("--$boundary$crlf").toByteArray())
                    // filename 直塞 UTF-8 原名，勿再 URL 编码
                    out.write(("Content-Disposition: form-data; name=\"file\"; filename=\"$name\"$crlf").toByteArray())
                    out.write(("Content-Type: application/octet-stream$crlf$crlf").toByteArray())
                    // 8KB 分块流式读取，禁 readBytes 防 OOM
                    activity.contentResolver.openInputStream(uri)?.use { ins ->
                        val buf = ByteArray(8192)
                        while (true) {
                            val n = ins.read(buf)
                            if (n <= 0) break
                            out.write(buf, 0, n)
                        }
                    }
                    out.write(crlf)
                    out.write(("--$boundary--$crlf").toByteArray())
                    out.flush()
                }
                val resp = conn.inputStream.bufferedReader().readText()
                if (JSONObject(resp).optBoolean("ok")) {
                    activity.runOnUiThread {
                        status.text = "已上传到电脑 downloads\\from_phone\\$name"
                        Toast.makeText(activity, "✅ 已上传到电脑", Toast.LENGTH_LONG).show()
                        refresh()
                    }
                } else throw Exception(JSONObject(resp).optString("error", "上传失败"))
            } catch (e: Exception) {
                activity.runOnUiThread { status.text = "上传失败：${e.message}" }
            }
        }
    }

    private fun queryName(uri: Uri): String? = try {
        activity.contentResolver.query(uri, null, null, null, null)?.use { c ->
            val idx = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            if (idx >= 0 && c.moveToFirst()) c.getString(idx) else null
        }
    } catch (e: Exception) { null }

    fun getView(): View = root

    fun setVisible(v: Boolean) {
        root.visibility = if (v) View.VISIBLE else View.GONE
        if (v) refresh()
    }

    fun refresh() {
        status.text = "正在读取电脑产出文件…"
        thread {
            try {
                val u = "${serverUrl.trimEnd('/')}/api/fengkong/files?limit=200"
                val conn = URL(u).openConnection() as HttpURLConnection
                conn.connectTimeout = 6000; conn.readTimeout = 10000
                val body = conn.inputStream.bufferedReader().readText()
                val obj = JSONObject(body)
                if (obj.optBoolean("ok")) {
                    items = obj.optJSONArray("items") ?: JSONArray()
                    activity.runOnUiThread {
                        status.text = "电脑产出 · 最近 ${items.length()} 个文件（点击下载到手机）"
                        list.adapter = adapter
                    }
                } else throw Exception("bad resp")
            } catch (e: Exception) {
                activity.runOnUiThread { status.text = "读取失败：${e.message}\n请确认已连接服务器 $serverUrl" }
            }
        }
    }

    private fun meta(pos: Int): JSONObject? =
        if (pos in 0 until items.length()) items.optJSONObject(pos) else null

    private fun onItem(pos: Int) {
        val m = meta(pos) ?: return
        val p = m.optString("path")
        val name = m.optString("name")
        if (m.optBoolean("img")) {
            // 图片：弹预览对话框（缩略图大图）
            try {
                val u = "${serverUrl.trimEnd('/')}/api/fengkong/download?p=${URLEncoder.encode(p, "UTF-8")}"
                val iv = android.widget.ImageView(activity)
                iv.adjustViewBounds = true
                thread {
                    val bmp = android.graphics.BitmapFactory.decodeStream(URL(u).openStream())
                    activity.runOnUiThread {
                        iv.setImageBitmap(bmp)
                        android.app.AlertDialog.Builder(activity)
                            .setTitle(name)
                            .setView(iv)
                            .setPositiveButton("保存到手机") { _, _ -> download(p, name) }
                            .setNegativeButton("关闭", null).show()
                    }
                }
            } catch (e: Exception) {
                Toast.makeText(activity, "预览失败：${e.message}", Toast.LENGTH_SHORT).show()
            }
        } else {
            download(p, name)
        }
    }

    private fun download(p: String, name: String) {
        Toast.makeText(activity, "开始下载：$name", Toast.LENGTH_SHORT).show()
        thread {
            try {
                val u = "${serverUrl.trimEnd('/')}/api/fengkong/download?p=${URLEncoder.encode(p, "UTF-8")}"
                val conn = URL(u).openConnection() as HttpURLConnection
                conn.connectTimeout = 6000; conn.readTimeout = 30000
                val dir = File(
                    android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS),
                    "ZF峰控"
                )
                dir.mkdirs()
                val dest = File(dir, name)
                conn.inputStream.use { ins -> dest.outputStream().use { ins.copyTo(it) } }
                // 通知媒体库扫描
                android.media.MediaScannerConnection.scanFile(activity, arrayOf(dest.absolutePath), null, null)
                activity.runOnUiThread { Toast.makeText(activity, "已保存：${dest.absolutePath}", Toast.LENGTH_LONG).show() }
            } catch (e: Exception) {
                activity.runOnUiThread { Toast.makeText(activity, "下载失败：${e.message}", Toast.LENGTH_SHORT).show() }
            }
        }
    }

    private val adapter = object : BaseAdapter() {
        override fun getCount() = items.length()
        override fun getItem(p: Int) = meta(p)
        override fun getItemId(p: Int) = p.toLong()
        override fun getView(p: Int, cv: View?, parent: ViewGroup?): View {
            val m = meta(p)!!
            val row = LinearLayout(parent?.context).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(24, 20, 24, 20)
                gravity = Gravity.CENTER_VERTICAL
            }
            val icon = TextView(parent?.context).apply {
                text = if (m.optBoolean("img")) "🖼️" else "📄"
                textSize = 20f
                setPadding(0, 0, 20, 0)
            }
            val col = LinearLayout(parent?.context).apply { orientation = LinearLayout.VERTICAL }
            col.addView(TextView(parent?.context).apply {
                text = m.optString("name")
                setTextColor(Color.WHITE); textSize = 14f
                typeface = Typeface.DEFAULT_BOLD
                maxLines = 1
            })
            col.addView(TextView(parent?.context).apply {
                val sz = m.optLong("size")
                val kb = if (sz > 1024 * 1024) "%.1fMB".format(sz / 1048576f) else "%.0fKB".format(sz / 1024f)
                text = "${m.optString("dir")} · $kb"
                setTextColor(0xFF8899AA.toInt()); textSize = 12f
            })
            row.addView(icon)
            row.addView(col, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            return row
        }
    }
}
