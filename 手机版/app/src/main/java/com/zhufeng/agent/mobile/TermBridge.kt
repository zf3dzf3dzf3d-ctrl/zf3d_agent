package com.zhufeng.agent.mobile

import android.content.Context
import android.webkit.JavascriptInterface
import java.io.File

/**
 * 内置终端桥：峰控助手（聊天页智能体）通过 window.ZFTerm.runCommand(cmd)
 * 在手机本地 shell（busybox/toybox/sh）里执行一次性命令并同步返回输出。
 * 仅挂在聊天 WebView 上，内置浏览器页不暴露（与 PocketBridge 同策略）。
 *
 * 【v58 线程修复】旧实现走 activity.ensureTermView().runCmd()，而本桥运行在
 * WebView JS 桥的【独立后台线程】；ensureTermView() 首次会 new TermView，其构造
 * 里创建 TextView/EditText 等带 Handler 的 Android View，从非主线程创建即抛
 * "Can't create handler inside thread / CalledFromWrongThreadException"（即自检时
 * 看到的 Java 异常）。term_run 本是纯命令行执行、不需要终端面板 UI，故改为
 * 【无头执行】：直接探测可用 shell 并 Runtime.exec，彻底绕开 View/线程问题。
 * 终端 Tab 的可视化界面仍由 MainActivity.ensureTermView()（主线程调用）负责，互不影响。
 */
class TermBridge(private val activity: MainActivity) {

    /** 同步执行：JS 桥运行在独立后台线程，无头执行命令，不创建任何 View */
    @JavascriptInterface
    fun runCommand(cmd: String): String {
        if (cmd.isBlank()) return "[空命令]"
        return headlessExec(activity, cmd)
    }

    companion object {
        /** 探针命令：验证 shell 解释器能执行且保留标记 */
        private const val PROBE_CMD = "echo __ZF_OK__"

        /** 可用 shell 组合：路径 + 是否需要 busybox 风格的 "sh" applet 参数 */
        data class ShellCombo(val path: String, val needApplet: Boolean) {
            fun args(cmd: String): Array<String> =
                if (needApplet) arrayOf(path, "sh", "-c", cmd)
                else arrayOf(path, "-c", cmd)
        }

        /**
         * 候选 shell 列表：优先 jniLibs busybox（nativeLibraryDir 允许执行，绕开 W^X），
         * 再试系统分区常见位置，最后回退 toybox/sh——逐个回退，不依赖单一路径。
         */
        private fun shellCandidates(ctx: Context): List<String> = buildList {
            File(ctx.applicationInfo.nativeLibraryDir, "libbusybox.so").takeIf { it.exists() }
                ?.let { add(it.absolutePath) }
            addAll(listOf(
                "/system/bin/busybox", "/system/xbin/busybox",
                "/system/bin/sh", "/system/xbin/sh",
                "/system/bin/toybox", "/system/xbin/toybox"
            ))
        }

        /**
         * 逐个真实探测：对每个候选 shell 用 echo 探针跑一次，
         * 只有 exit=0 且输出含标记的组合才算可用。返回所有可用组合（按优先级）。
         */
        private fun probeAll(ctx: Context): List<ShellCombo> {
            val ok = ArrayList<ShellCombo>()
            for (path in shellCandidates(ctx)) {
                for (needApplet in listOf(true, false)) {
                    try {
                        val combo = ShellCombo(path, needApplet)
                        val p = Runtime.getRuntime().exec(combo.args(PROBE_CMD))
                        // 探针加超时：shell 挂起时不阻塞，直接跳过该组合
                        if (!p.waitFor(8, java.util.concurrent.TimeUnit.SECONDS)) { p.destroyForcibly(); continue }
                        val so = p.inputStream.bufferedReader().readText()
                        p.errorStream.bufferedReader().readText()
                        val code = p.exitValue()
                        if (code == 0 && so.contains("__ZF_OK__")) {
                            ok.add(combo)
                            break // 该路径已找到可用形态，不必再试另一种
                        }
                    } catch (_: Exception) { /* 换下一个形态 */ }
                }
            }
            return ok
        }

        /**
         * 无头执行（任意线程安全，不碰 UI）。返回输出文本（末尾带 [exit=..] / [shell=..] 标注）。
         * exit=127（shell 活着但命令/applet 缺失）时换下一个组合重试，最多 3 轮防死循环。
         */
        @Synchronized
        fun headlessExec(ctx: Context, cmd: String): String {
            val combos = probeAll(ctx)
            if (combos.isEmpty()) {
                return "[所有候选 shell 均无法执行]（nativeLibraryDir=${ctx.applicationInfo.nativeLibraryDir}）"
            }
            var idx = 0
            var attempt = 0
            while (attempt < 3) {
                attempt++
                val combo = combos[idx % combos.size]
                try {
                    val p = Runtime.getRuntime().exec(combo.args(cmd))
                    // 根治 term_run 卡死：waitFor 加 30s 硬超时（用户要求锁死30秒），命令挂起即强制终止返回，
                    // 绝不让原生 JS 桥线程被永久阻塞（JS 层 setTimeout 对已阻塞的桥线程无效）
                    if (!p.waitFor(30, java.util.concurrent.TimeUnit.SECONDS)) {
                        p.destroyForcibly()
                        p.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)
                        return "[命令执行超时(30s)，已强制终止]（shell=${combo.path}）"
                    }
                    val so = p.inputStream.bufferedReader().readText()
                    val se = p.errorStream.bufferedReader().readText()
                    val code = p.exitValue()
                    val out = (so + if (se.isNotBlank()) "\n[stderr] $se" else "").trim() +
                        "\n[shell=${combo.path}${if (combo.needApplet) " sh" else ""}]"
                    if (code == 127 && attempt < 3) {
                        // 命令在该 shell 不存在：换下一个候选组合重试
                        idx++
                        continue
                    }
                    return "$out\n[exit=$code]"
                } catch (e: Exception) {
                    // 该组合执行失败，换下一个
                    idx++
                    if (idx >= combos.size * attempt) {
                        return "[执行失败] ${e.message}（已尝试 ${combos.size} 个 shell 组合）"
                    }
                }
            }
            return "[命令执行未成功，已自动切换 shell 组合重试 3 次]"
        }
    }
}
