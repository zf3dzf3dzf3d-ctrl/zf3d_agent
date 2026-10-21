package com.zhufeng.agent.mobile

import android.annotation.SuppressLint
import android.graphics.PixelFormat
import android.os.Build
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * L4-3 悬浮指令台：显示当前任务状态 + 一键停止。
 * 前置：用户已在系统设置授予「显示在其他应用上层」(SYSTEM_ALERT_WINDOW) 权限。
 * 可拖动；点停止回调 onStop（由 NativeBridge 注册，通常 = 执行中的中断请求）。
 */
object ZFFloatConsole {
    private var view: View? = null
    private var wm: WindowManager? = null
    private var statusText: TextView? = null
    var onStop: (() -> Unit)? = null

    val isShowing: Boolean get() = view != null

    @SuppressLint("ClickableViewAccessibility")
    @Synchronized
    fun show(context: android.content.Context, title: String) {
        if (view != null) { statusText?.text = title; return }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !android.provider.Settings.canDrawOverlays(context)) return
        val manager = context.getSystemService(android.content.Context.WINDOW_SERVICE) as WindowManager
        wm = manager
        val box = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(0xE6111111.toInt())
            setPadding(24, 16, 24, 16)
        }
        val tv = TextView(context).apply {
            text = title
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 13f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        statusText = tv
        val btn = Button(context).apply {
            text = "停止"
            textSize = 12f
            setOnClickListener { onStop?.invoke() }
        }
        box.addView(tv); box.addView(btn)

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.TOP or Gravity.START; x = 60; y = 160 }

        // 拖动
        var downX = 0f; var downY = 0f; var px = 0; var py = 0; var moved = false
        box.setOnTouchListener { v, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> { downX = e.rawX; downY = e.rawY; px = params.x; py = params.y; moved = false; true }
                MotionEvent.ACTION_MOVE -> {
                    if (Math.abs(e.rawX - downX) > 8 || Math.abs(e.rawY - downY) > 8) moved = true
                    params.x = px + (e.rawX - downX).toInt()
                    params.y = py + (e.rawY - downY).toInt()
                    wm?.updateViewLayout(v, params); true
                }
                else -> false
            }
        }

        try {
            manager.addView(box, params)
            view = box
        } catch (_: Exception) { }
    }

    @Synchronized
    fun update(title: String) { statusText?.text = title }

    @Synchronized
    fun hide() {
        try { view?.let { wm?.removeView(it) } } catch (_: Exception) { }
        view = null; statusText = null
    }
}
