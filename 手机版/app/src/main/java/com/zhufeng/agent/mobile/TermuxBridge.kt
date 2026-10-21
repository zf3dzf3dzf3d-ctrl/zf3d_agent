package com.zhufeng.agent.mobile

import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface

/**
 * Termux 桥（方案C·v56）：通过 Termux 官方 RUN_COMMAND 广播 API，
 * 让峰控助手把命令直接推给 Termux 后台执行，无需打开 Termux 界面、
 * 无需人工敲 zf。彻底解决"桥进程死了要人手动救"的问题。
 *
 * 前提（一次性）：
 * 1. 用户已装 Termux（建议 F-Droid 版）
 * 2. Termux 侧允许外部 API（默认支持）
 * 3. Android 10+ 需在系统设置里给峰控授予
 *    com.termux.permission.RUN_COMMAND（通过 AppOps：adb shell appops set
 *    com.zhufeng.agent.mobile RUN_COMMAND allow，或在 Termux:API 设置界面授权）
 *
 * 广播是异步的：结果可在 Termux 的会话里查看；本桥返回"已投递"回执。
 */
class TermuxBridge(private val activity: MainActivity) {

    /** 发送 RUN_COMMAND 广播，让 Termux 后台执行命令并返回回执 */
    @JavascriptInterface
    fun run(cmd: String): String {
        if (cmd.isBlank()) return "[空命令]"
        return try {
            val intent = Intent("com.termux.RUN_COMMAND").apply {
                setClassName("com.termux", "com.termux.app.RunCommandService")
                putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash")
                putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("-c", cmd))
                putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home")
                putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
                // Android 14+ 必须显式指定接收包，否则抛 SecurityException
                `package` = "com.termux"
            }
            activity.startService(intent)
            "[已投递到Termux后台执行] $cmd"
        } catch (e: Exception) {
            "[Termux桥失败] ${e.message}（请确认已装Termux并授权RUN_COMMAND）"
        }
    }
}
