package com.zhufeng.agent.mobile

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.io.BufferedReader
import java.io.File
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.io.OutputStream

/**
 * 峰控「终端」Tab（方案B：自编译终端嵌入的轻量实现）
 * - busybox 直接打进 jniLibs（nativeLibraryDir 允许执行，绕开 W^X 限制）
 * - 持久 shell 会话：busybox sh（支持管道/脚本/python 调用，等同内置 cmd）
 * - 与 termux_bridge 兼容：环境变量注入 PREFIX/PATH，技能脚本可直接跑
 */
class TermView(private val activity: Activity) {

    private val root = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(0xFF0C0F13.toInt())
        visibility = View.GONE
    }
    private lateinit var out: TextView
    private lateinit var scroll: ScrollView
    private lateinit var input: EditText
    private var process: Process? = null
    private var stdin: OutputStream? = null
    private val buf = StringBuilder()
    private var ready = false

    init {
        val header = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(24, 24, 24, 8)
        }
        header.addView(TextView(activity).apply {
            text = "⌨️ 峰控内置终端（system sh/toybox）"
            setTextColor(0xFF8899AA.toInt()); textSize = 13f
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        // 【新增】右上角关闭按钮：直接切回助手页
        header.addView(Button(activity).apply {
            text = "✕"
            setTextColor(0xFF8899AA.toInt())
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            setOnClickListener { onClose?.invoke() }
        })
        out = TextView(activity).apply {
            setTextColor(0xFFC9D6E3.toInt()); textSize = 12f
            typeface = Typeface.MONOSPACE
            setPadding(24, 8, 24, 8)
            setTextIsSelectable(true)
        }
        scroll = ScrollView(activity).apply { addView(out) }
        val row = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(16, 8, 16, 16)
            gravity = Gravity.CENTER_VERTICAL
        }
        input = EditText(activity).apply {
            hint = "输入命令，如 ls /sdcard/Download"
            setTextColor(0xFFC9D6E3.toInt())
            setSingleLine(true)
            typeface = Typeface.MONOSPACE
            textSize = 12f
        }
        val send = Button(activity).apply { text = "▶" }
        row.addView(input, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(send)
        root.addView(header)
        root.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(row)
        send.setOnClickListener { submit() }
        root.post { ensureShell() }
    }

    fun getView(): View = root

    /** 【新增】关闭回调：由 MainActivity 注入，点 ✕ 切回助手页 */
    var onClose: (() -> Unit)? = null

    fun setVisible(v: Boolean) {
        root.visibility = if (v) View.VISIBLE else View.GONE
    }

    private fun log(s: String) {
        activity.runOnUiThread {
            buf.append(s).append('\n')
            if (buf.length > 60000) buf.delete(0, buf.length - 30000)
            out.text = buf
            scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
        }
    }

    /**
     * 启动持久 shell
     * 【v57 方案B】优先用 jniLibs 里的 libbusybox.so（nativeLibraryDir 允许执行，绕开 W^X 限制），
     * busybox sh 比 toybox 多 wget/telnet/vi/crontab 等；找不到则回退 /system/bin/sh。
     */
    private fun busyboxFile(): File? {
        val f = File(activity.applicationInfo.nativeLibraryDir, "libbusybox.so")
        return if (f.exists()) f else null
    }

    private fun ensureShell() {
        if (ready) return
        ready = true
        Thread {
            try {
                val binDir = File(activity.filesDir, "bin").apply { mkdirs() }
                // 【v58】启动持久会话前先探测可用 shell 组合，绝不再"一锤子"依赖单一路径/形态
                val combo = probeShell()
                if (combo == null) {
                    ready = false
                    log("[启动失败] 未找到可用的 shell（已探测 busybox/toybox/sh 各参数形态），请检查设备环境")
                    return@Thread
                }
                // 交互会话：直接进入交互模式（busybox 需带 sh applet，系统 sh 直接 -i）
                val cmdArgs = if (combo.needApplet) arrayOf(combo.path, "sh", "-i") else arrayOf(combo.path, "-i")
                val pb = ProcessBuilder(*cmdArgs)
                pb.environment().apply {
                    put("PATH", "/system/bin:/system/xbin:/vendor/bin:${binDir.absolutePath}")
                    put("HOME", activity.filesDir.absolutePath)
                    put("PREFIX", binDir.absolutePath)
                    put("TERM", "dumb")
                    put("LANG", "en_US.UTF-8")
                }
                pb.redirectErrorStream(true)
                val p = pb.start()
                process = p
                stdin = p.outputStream
                log("[峰控终端就绪] ${combo.path}${if (combo.needApplet) " sh" else ""}（技能脚本/管道均可用，输入命令回车执行）")
                val reader = BufferedReader(InputStreamReader(p.inputStream))
                val sb = StringBuilder()
                var c: Int
                while (reader.read().also { c = it } != -1) {
                    if (c == '\n'.code) {
                        log(sb.toString()); sb.setLength(0)
                    } else sb.append(c.toChar())
                }
                log("[会话已退出]")
                // 【v58】会话退出后自动重置，下次进入终端页重新探测并拉起新会话
                process = null
                stdin = null
                ready = false
            } catch (e: Exception) {
                ready = false
                log("[启动失败] ${e.message}")
            }
        }.start()
    }

    private fun runQuick(): String = try {
        probeShell()?.let { c ->
            val p = Runtime.getRuntime().exec(c.args("toybox --version 2>/dev/null || echo sh"))
            p.inputStream.bufferedReader().readText().trim().ifBlank { "sh" }
        } ?: "sh"
    } catch (e: Exception) { "sh" }

    private fun submit() {
        val cmd = input.text.toString().trim()
        if (cmd.isEmpty()) return
        input.setText("")
        log("\$ $cmd")
        if (cmd == "exit" || cmd == "clear") {
            if (cmd == "clear") { buf.setLength(0); out.text = ""; return }
        }
        Thread {
            val ps = process
            if (ps == null || stdin == null) {
                // 会话已退出（如之前 shell 失效），降级为一次性执行（内部走探测+回退）
                execOnce(cmd) { }
                return@Thread
            }
            try {
                stdin?.write((cmd + "\n").toByteArray())
                stdin?.flush()
            } catch (e: Exception) {
                log("[写入失败] ${e.message}（降级为一次性执行）")
                execOnce(cmd) { }
            }
        }.start()
    }

    /**
     * 候选 shell 列表：优先 jniLibs busybox（nativeLibraryDir 允许执行，绕开 W^X），
     * 再试系统分区常见位置，最后回退 toybox/sh——逐个回退，绝不再"一锤子"依赖单一路径。
     */
    private fun shellCandidates(): List<String> = buildList {
        File(activity.applicationInfo.nativeLibraryDir, "libbusybox.so").takeIf { it.exists() }?.let { add(it.absolutePath) }
        addAll(listOf(
            "/system/bin/busybox", "/system/xbin/busybox",
            "/system/bin/sh", "/system/xbin/sh",
            "/system/bin/toybox", "/system/xbin/toybox"
        ))
    }

    private fun shellPath(): String = shellCandidates().first()

    /** 探针命令：验证 shell 解释器本身能解析并执行命令（且保留 __ZF_OK__ 标记） */
    private companion object {
        const val PROBE_CMD = "echo __ZF_OK__"
    }

    /** 可用 shell 组合：路径 + 是否需要 busybox 风格的 "sh" applet 参数 */
    data class ShellCombo(val path: String, val needApplet: Boolean) {
        fun args(cmd: String, interactive: Boolean = false): Array<String> =
            if (needApplet) arrayOf(path, "sh", "-c", cmd)
            else arrayOf(path, *(if (interactive) arrayOf("-i") else emptyArray()), "-c", cmd)
    }

    /** 探测缓存 */
    @Volatile
    private var probed: ShellCombo? = null

    /**
     * 【v58】逐个真实探测：对每个候选 shell 用 `echo` 探针跑一次，
     * 只有 exit=0 且输出含标记的组合才算可用，绝不靠文件名猜参数形态。
     */
    @Synchronized
    private fun probeShell(): ShellCombo? {
        probed?.let { return it }
        for (path in shellCandidates()) {
            for (needApplet in listOf(true, false)) {
                try {
                    val combo = ShellCombo(path, needApplet)
                    val args = if (needApplet) arrayOf(path, "sh", "-c", PROBE_CMD) else arrayOf(path, "-c", PROBE_CMD)
                    val p = Runtime.getRuntime().exec(args)
                    // 【超时保护 v97】探测命令最多 10 秒，卡住即跳过该 shell 组合，避免探测阶段死锁
                    if (!p.waitFor(10, java.util.concurrent.TimeUnit.SECONDS)) { p.destroyForcibly(); continue }
                    val so = try { p.inputStream.bufferedReader().readText() } catch (e: Exception) { "" }
                    try { p.errorStream.bufferedReader().readText() } catch (e: Exception) {}
                    val code = p.exitValue()
                    if (code == 0 && so.contains("__ZF_OK__")) {
                        probed = combo
                        return combo
                    }
                } catch (_: Exception) { /* 换下一个形态 */ }
            }
        }
        return null
    }

    /**
     * 依次尝试【已探测可用】的 shell 组合执行命令。
     * 返回 (输出, exitCode)，输出末尾带 [shell=路径] 标注实际用的哪个。
     * 【v63】exit=127（shell 活着但命令/applet 缺失）时视为探测结果失效，
     * 置 probed=null 重探并换下一个组合重试，最多 3 轮防死循环。
     */
    fun execWithFallback(cmd: String): Pair<String, Int>? {
        var attempt = 0
        while (attempt < 3) {
            attempt++
            val combo = probeShell() ?: run {
                activity.runOnUiThread { log("[shell诊断] 所有候选 shell（含 busybox/toybox/sh 两种参数形态）探测均失败。nativeLibraryDir=${activity.applicationInfo.nativeLibraryDir}") }
                return null
            }
            try {
                val p = Runtime.getRuntime().exec(combo.args(cmd))
                // 【超时保护 v99】命令最多跑 30 秒（锁死30秒），到点强制终止，绝不让桥线程永久阻塞
                // （根治 term_run 卡 900 秒问题：原生 waitFor/readText 无超时，命令挂起即死锁，JS 层兜底救不回）
                var timedOut = false
                if (!p.waitFor(30, java.util.concurrent.TimeUnit.SECONDS)) {
                    timedOut = true
                    p.destroyForcibly()
                    p.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)
                }
                val so = try { p.inputStream.bufferedReader().readText() } catch (e: Exception) { "" }
                val se = try { p.errorStream.bufferedReader().readText() } catch (e: Exception) { "" }
                val code = if (timedOut) -1 else p.exitValue()
                val out = (if (timedOut) "[命令执行超时(30s)，已强制终止]\n" else "") + (so + if (se.isNotBlank()) "\n[stderr] $se" else "").trim() + "\n[shell=${combo.path}${if (combo.needApplet) " sh" else ""}]"
                if (code == 127 && attempt < 3) {
                    // shell 本体活着但命令不存在：探测缓存失效，换下一个组合重试
                    probed = null
                    activity.runOnUiThread { log("[shell诊断] ${combo.path} 返回 127（命令未找到），自动切换下一个 shell 组合重试…") }
                    continue
                }
                return Pair(out, code)
            } catch (e: Exception) {
                probed = null // 探测结果失效，下次重新探测
                activity.runOnUiThread { log("[shell诊断] ${combo.path} 执行失败：${e.message}") }
                return null
            }
        }
        return null
    }

    /** 供智能体（TermBridge.runCommand）同步执行命令：返回完整输出并回显到终端面板 */
    fun runCmd(cmd: String): String {
        val r = execWithFallback(cmd)
        val out = r?.let { "${it.first}\n[exit=${it.second}]" }
            ?: "[所有候选 shell 均无法执行，已输出诊断到终端面板]"
        activity.runOnUiThread {
            log("\$ $cmd")
            log(out)
        }
        return out
    }

    /** 供外部（如 JSBridge run_command）直接执行一次性命令并回传结果 */
    fun execOnce(cmd: String, cb: (String) -> Unit) {
        Thread {
            val r = execWithFallback(cmd)?.let { "${it.first}\n[exit=${it.second}]" }
                ?: "[所有候选 shell 均无法执行]"
            activity.runOnUiThread { cb(r) }
        }.start()
    }
}
