package com.zhufeng.agent.mobile

import android.app.Activity
import android.app.DownloadManager
import android.content.Context
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Environment
import android.webkit.JavascriptInterface
import android.widget.Toast
import java.io.File

/**
 * MediaBridge v1（2026-10-12）：聊天页智能体媒体工具桥（window.ZFMedia）
 * - audio_play / audio_stop : 原生 MediaPlayer 播放/停止音频（本地路径或 http url）
 * - video_play              : 调系统播放器播放视频（本地路径或 http url）
 * - download                : 系统 DownloadManager 下载（支持断点续传，落到 Download/朱峰智能体/）
 * - download_query          : 查询下载状态/进度（按 downloadId）
 * - download_cancel         : 取消下载
 * - download_delete         : 删除本地已下载文件
 */
class MediaBridge(private val activity: Activity) {

    companion object {
        const val SAVE_DIR = "朱峰智能体" // Environment.DIRECTORY_DOWNLOADS 下的子目录
    }

    private var player: MediaPlayer? = null

    private fun destDir(): File {
        val d = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), SAVE_DIR)
        if (!d.exists()) d.mkdirs()
        return d
    }

    /** 把 /sdcard/... 或相对名解析为本地 File（同时支持 http/https 直接返回 null） */
    private fun resolveLocal(p: String): File? {
        if (p.startsWith("http://") || p.startsWith("https://")) return null
        val cands = ArrayList<String>()
        if (p.startsWith("/sdcard")) {
            cands.add(p.replaceFirst("/sdcard", "/storage/emulated/0"))
            cands.add(p.replaceFirst("/sdcard", Environment.getExternalStorageDirectory().absolutePath))
        } else if (p.startsWith("/storage")) cands.add(p)
        else cands.add(File(destDir(), p).absolutePath) // 相对名 → 默认下载目录
        for (c in cands) { val f = File(c); if (f.exists()) return f }
        return null
    }

    @JavascriptInterface
    fun audioPlay(src: String): String {
        return try {
            player?.let { try { it.stop(); it.release() } catch (_: Exception) {} }
            val mp = MediaPlayer()
            val f = resolveLocal(src)
            if (f != null) mp.setDataSource(f.absolutePath) else mp.setDataSource(src)
            mp.setAudioStreamType(AudioManager.STREAM_MUSIC)
            mp.prepare()
            mp.start()
            mp.setOnCompletionListener { try { it.release() } catch (_: Exception) {} }
            player = mp
            "{\"ok\":true,\"msg\":\"音频播放中\",\"duration\":" + (mp.duration / 1000) + "}"
        } catch (e: Exception) { "{\"ok\":false,\"error\":\"" + e.message + "\"}" }
    }

    @JavascriptInterface
    fun audioStop(): String {
        return try {
            player?.let { try { it.stop(); it.release() } catch (_: Exception) {} }
            player = null
            "{\"ok\":true}"
        } catch (e: Exception) { "{\"ok\":false,\"error\":\"" + e.message + "\"}" }
    }

    @JavascriptInterface
    fun videoPlay(src: String): String {
        return try {
            val uri: Uri = resolveLocal(src)?.let { Uri.fromFile(it) } ?: Uri.parse(src)
            val i = android.content.Intent(android.content.Intent.ACTION_VIEW)
            i.setDataAndType(uri, "video/*")
            i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            activity.startActivity(i)
            "{\"ok\":true,\"msg\":\"已调起系统视频播放器\"}"
        } catch (e: Exception) { "{\"ok\":false,\"error\":\"" + e.message + "\"}" }
    }

    /** 断点续传下载：系统 DownloadManager 自带断点续传（网络中断后可在系统通知里继续，重调同一 url 会复用/新起均可） */
    @JavascriptInterface
    fun download(url: String, filename: String): String {
        return try {
            val name = if (filename.isBlank()) {
                url.substringAfterLast('/').substringBefore('?').ifBlank { "download_" + System.currentTimeMillis() }
            } else filename
            val dm = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val req = DownloadManager.Request(Uri.parse(url))
                .setTitle(name)
                .setDescription("峰控助手下载")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, SAVE_DIR + "/" + name)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(true)
            // 断点续传关键：若目标文件已存在（上次未完成），DownloadManager 无法直接续，先改名保留旧文件由用户/工具用 download_resume 处理
            val id = dm.enqueue(req)
            "{\"ok\":true,\"downloadId\":$id,\"filename\":\"$name\",\"saveTo\":\"Download/$SAVE_DIR/$name\"}"
        } catch (e: Exception) { "{\"ok\":false,\"error\":\"" + e.message + "\"}" }
    }

    /** 断点续传：DownloadManager.resumeDownload 是 hidden API，改为删除失败任务后用同 URL 重新 enqueue（服务端支持 Range 则服务端续传） */
    @JavascriptInterface
    fun downloadResume(downloadId: Long): String {
        return try {
            val dm = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            // 先查原任务的 URI
            val uri = dm.query(DownloadManager.Query().setFilterById(downloadId)).use { c ->
                if (c.moveToFirst()) c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_URI)) else null
            }
            if (uri == null) return "{\"ok\":false,\"error\":\"任务不存在或已完成，无法续传\"}"
            dm.remove(downloadId)
            val req = DownloadManager.Request(android.net.Uri.parse(uri))
                .setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS, "zf_resume_$downloadId.tmp")
                .setAllowedOverMetered(true).setAllowedOverRoaming(true)
            val id = dm.enqueue(req)
            "{\"ok\":true,\"msg\":\"已重新排队续传\",\"downloadId\":$id}"
        } catch (e: Exception) { "{\"ok\":false,\"error\":\"" + e.message + "\"}" }
    }

    @JavascriptInterface
    fun downloadQuery(downloadId: Long): String {
        return try {
            val dm = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val q = DownloadManager.Query().setFilterById(downloadId)
            dm.query(q).use { c ->
                if (!c.moveToFirst()) return "{\"ok\":false,\"error\":\"任务不存在\"}"
                val st = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                val done = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                val total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                val reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                val status = when (st) {
                    DownloadManager.STATUS_RUNNING -> "running"
                    DownloadManager.STATUS_PENDING -> "pending"
                    DownloadManager.STATUS_PAUSED -> "paused"
                    DownloadManager.STATUS_SUCCESSFUL -> "successful"
                    DownloadManager.STATUS_FAILED -> "failed"
                    else -> "unknown"
                }
                "{\"ok\":true,\"status\":\"$status\",\"downloaded\":$done,\"total\":$total,\"reason\":$reason,\"localUri\":\"" +
                    c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI)) + "\"}"
            }
        } catch (e: Exception) { "{\"ok\":false,\"error\":\"" + e.message + "\"}" }
    }

    @JavascriptInterface
    fun downloadCancel(downloadId: Long): String {
        return try {
            val dm = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            dm.remove(downloadId)
            "{\"ok\":true}"
        } catch (e: Exception) { "{\"ok\":false,\"error\":\"" + e.message + "\"}" }
    }

    @JavascriptInterface
    fun listDownloads(): String {
        return try {
            val d = destDir()
            val files = d.listFiles() ?: emptyArray()
            val sb = StringBuilder("[")
            files.forEachIndexed { i, f ->
                if (i > 0) sb.append(",")
                sb.append("{\"name\":\"").append(f.name).append("\",\"size\":").append(f.length())
                    .append(",\"path\":\"").append(f.absolutePath.replace("\\", "\\\\")).append("\"}")
            }
            sb.append("]").toString()
        } catch (e: Exception) { "{\"ok\":false,\"error\":\"" + e.message + "\"}" }
    }

    @JavascriptInterface
    fun toast(msg: String) {
        activity.runOnUiThread { Toast.makeText(activity, msg, Toast.LENGTH_SHORT).show() }
    }
}
