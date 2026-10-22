package com.zhufeng.agent.mobile

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.*
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/**
 * 峰控 · 一体化手机智能体（整合原「手机遥控器」+「朱峰口袋助手」）
 * 阶段1最小合并版：双 WebView + 底部导航（🎮遥控 = PC 智能体界面·懒加载 / 💬助手 = 本地聊天页 assets/web/index.html·默认）
 * 启动策略：默认仅加载本地助手页（不联网）；用户首次切到「遥控」标签才联网加载 PC 页，提升启动速度
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView        // 遥控：加载 PC 智能体
    private lateinit var chatView: WebView       // 助手：本地 assets 聊天页
    private lateinit var splash: View
    private lateinit var prefs: Prefs
    private lateinit var tabMore: Button
    private var filesView: FilesView? = null
    private var termView: TermView? = null
    private lateinit var browserView: WebView        // 🌐 浏览：通用网页浏览（不挂原生桥，隔离任意网页风险）
    private lateinit var browserContainer: android.view.ViewGroup
    private lateinit var urlInput: EditText
    private var chatExported = false   // 登录态一次性搬迁标记

    // 网页文件选择（加号菜单：相册/拍照/选文件）回调
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null
    private val REQ_FILE_CHOOSER = 42001

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_FILE_CHOOSER) {
            val cb = pendingFileCallback
            pendingFileCallback = null
            /* 【修复·相册选图挂不上】parseResult 只读 data.getData()，
               相册多选时结果放在 data.clipData 里，会返回 null。
               这里补 clipData 兜底：逐条收集所有选中项 */
            var uris: Array<Uri>? = if (resultCode == RESULT_OK && data != null)
                WebChromeClient.FileChooserParams.parseResult(resultCode, data) else null
            if ((uris == null || uris.isEmpty()) && resultCode == RESULT_OK) {
                val clip = data?.clipData
                if (clip != null) {
                    val list = ArrayList<Uri>(clip.itemCount)
                    for (i in 0 until clip.itemCount) {
                        clip.getItemAt(i)?.uri?.let { list.add(it) }
                    }
                    if (list.isNotEmpty()) uris = list.toTypedArray()
                }
            }
            cb?.onReceiveValue(uris)
            return
        }
        if (requestCode == 43001) {
            filesView?.handleUploadResult(if (resultCode == RESULT_OK) data?.data else null)
        }
    }

    // 默认服务器地址：PC 版本机调试；正式版可改为社区云端地址
    private val defaultServer = "http://192.168.31.49:8570" // 局域网内网直连（5.7.x 端口段 8570，与 5.5.x 的 8555 区分；PC 服务已绑 0.0.0.0 可局域网直连）
    private val serverUrl: String
        get() = prefs.serverUrl.ifBlank { defaultServer }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        // 【防息屏】App 在前台期间屏幕保持常亮（智能体运行中不能黑屏）
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.webview_remote)
        chatView = findViewById(R.id.webview_chat)
        splash = findViewById(R.id.splash)
        tabMore = findViewById(R.id.tab_more)
        browserContainer = findViewById(R.id.browser_container)
        browserView = findViewById(R.id.webview_browser)
        urlInput = findViewById(R.id.url_input)
        setupBrowser()
        // 【新增】内置浏览器右上角关闭按钮：直接切回助手页，不必绕道左上角图标
        findViewById<Button>(R.id.btn_close_browser).setOnClickListener { switchTab(false) }

        // 【提速】权限不再 onCreate 弹窗轰炸，改为功能首次使用时按需申请（ensureMicPermission / ensureStoragePermission）

        setupWebView(webView, isChat = false)
        setupWebView(chatView, isChat = true)
        webView.setOnLongClickListener {
            showServerDialog()
            true
        }

        tabMore.setOnClickListener { showMoreMenu(it) }
        switchTab(false)

        // 助手页（本地 assets）直接加载；遥控页懒加载：只在用户切到遥控标签时才联网，提升启动速度
        loadChat()
    }

    // 【白屏修复·收窄】仅当用户主动跳「系统无障碍设置页」往返时，才刷新助手页 WebView。
    // 原因：① 跳系统设置页返回白屏是用户明确反馈的场景；② 普通切后台/息屏不应整页 reload，
    //       否则会打断正在跑的 agent 循环、丢弃未提交输入（蜂群收口审核员#2 指出的副作用）。
    private var a11yReturnPending = false

    override fun onResume() {
        super.onResume()
        // 【防息屏双保险】从后台/锁屏回来时重新确保常亮 Flag 未丢失
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // 【白屏修复】仅从无障碍设置页返回时刷新一次 WebView（跳系统设置页返回最易白屏）。
        // 普通往返后台不再刷新，避免打断助手页常驻的 agent 运行。
        if (a11yReturnPending) {
            a11yReturnPending = false
            if (::chatView.isInitialized && chatView.visibility == View.VISIBLE) {
                chatView.reload()
            }
        }
        // 【移除 v63 自动弹无障碍】不再每次回前台自动弹引导框（启动即弹、且开/关返回后反复弹造成白屏）。
        // 改为用户在「更多」菜单里手动点「♿ 开启无障碍」按需开启。
    }

    /** 手动开启无障碍：用户从「更多」菜单主动触发，跳转系统无障碍设置页 */
    private fun openA11yManual() {
        if (NativeBridge(this).a11yReady()) {
            Toast.makeText(this, "无障碍服务已开启", Toast.LENGTH_SHORT).show()
            return
        }
        try {
            // 标记：本次跳的是系统无障碍设置页，返回时需刷新 WebView 治白屏
            a11yReturnPending = true
            startActivity(android.content.Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS)
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
            a11yReturnPending = false
            Toast.makeText(this, "无法打开无障碍设置", Toast.LENGTH_SHORT).show()
        }
    }

    /** 按需申请：麦克风（语音对话首次使用时调用） */
    fun ensureMicPermission() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M &&
            checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(android.Manifest.permission.RECORD_AUDIO), 100)
        }
    }

    /** 按需申请：存储+通知+所有文件访问（文件/导出功能首次使用时调用） */
    fun ensureStoragePermission() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            val need = mutableListOf<String>()
            if (checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) != android.content.pm.PackageManager.PERMISSION_GRANTED)
                need.add(android.Manifest.permission.READ_EXTERNAL_STORAGE)
            if (checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != android.content.pm.PackageManager.PERMISSION_GRANTED)
                need.add(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
            if (android.os.Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED)
                need.add("android.permission.POST_NOTIFICATIONS")
            if (need.isNotEmpty()) requestPermissions(need.toTypedArray(), 101)
        }
        // Android 11+（targetSdk 30+ legacy 失效）：引导用户授予「所有文件访问」
        if (android.os.Build.VERSION.SDK_INT >= 30 && !android.os.Environment.isExternalStorageManager()) {
            try {
                startActivity(android.content.Intent(
                    android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    android.net.Uri.parse("package:$packageName")))
            } catch (_: Exception) { }
        }
    }

    private var remoteLoaded = false   // 遥控页是否已联网加载过
    private var confirmDialogShowing = false  // 防止连续点「遥控」叠出多个确认弹窗
    private var chatDirty = false  // 【黑屏修复】离开助手页后置脏，切回时刷新一次聊天页（View.GONE 销毁渲染表面导致回来黑屏）

    private fun switchTab(remote: Boolean) {
        webView.visibility = if (remote) View.VISIBLE else View.GONE
        chatView.visibility = if (remote) View.GONE else View.VISIBLE
        filesView?.setVisible(false)
        termView?.setVisible(false)
        browserContainer.visibility = View.GONE
        // 【修复】切回助手页必须清掉启动遮罩：遥控加载中切走后 splash 若不隐藏会永久盖住界面（黑屏）
        if (!remote) {
            splash.visibility = View.GONE
            // 【对话丢失修复】从遥控/文件/终端/浏览器切回助手页时，只做"保活重绘"恢复 GPU 渲染表面，
            // 不再 chatView.reload()——reload 会清空 WebView 内存，导致当前会话的对话与工具问答全部丢失。
            if (chatDirty) {
                chatDirty = false
                refreshChatViewSurface()
            }
        } else {
            chatDirty = true
        }
        if (remote) {
            if (!remoteLoaded) {
                if (confirmDialogShowing) return
                confirmDialogShowing = true
                // 【按需求】首次切遥控不自动连接，先弹窗让用户确认
                android.app.AlertDialog.Builder(this)
                    .setTitle("连接智能体")
                    .setMessage("要连接电脑上的智能体（$serverUrl）吗？\n连接后手机可遥控电脑；不点「连接」不会联网。")
                    .setPositiveButton("连接") { _, _ ->
                        remoteLoaded = true
                        confirmDialogShowing = false
                        loadAgent()
                        splash.visibility = View.VISIBLE
                    }
                    .setNegativeButton("暂不") { _, _ ->
                        // 取消则回到助手页
                        confirmDialogShowing = false
                        switchTab(false)
                    }
                    .setOnCancelListener {
                        confirmDialogShowing = false
                        switchTab(false)
                    }
                    .show()
            }
            if (remoteLoaded) splash.visibility = if (webView.progress < 100) View.VISIBLE else View.GONE
            else splash.visibility = View.GONE
        }
    }

    /**
     * 助手页从 GONE 切回 VISIBLE 后的"保活重绘"：仅恢复 WebView 渲染表面，不重新加载页面。
     * 旧实现用 chatView.reload() 治黑屏，但 reload 会清空 JS 内存，导致切走前正在进行的
     * 对话与工具问答全部丢失（用户反馈：切到工具/浏览器/日志等再切回，之前的对话没了）。
     * 这里改用 onResume+invalidate+requestLayout 触发重绘，并向页面派发 resize 事件让
     * canvas/echarts 等重排，既治黑屏又保留会话内容。
     */
    private fun refreshChatViewSurface() {
        if (!::chatView.isInitialized) return
        try {
            chatView.onResume()
            chatView.invalidate()
            chatView.requestLayout()
        } catch (_: Exception) { }
        try {
            chatView.evaluateJavascript(
                "window.dispatchEvent(new Event('resize'));if(window.__zfRepaintSurface){try{window.__zfRepaintSurface();}catch(e){}}",
                null
            )
        } catch (_: Exception) { }
    }

    /** 在聊天页 WebView 中执行 JS（顶部栏 工具/列表/新建 及更多菜单的对话日志入口） */
    private fun chatJs(expr: String) {
        if (webView.visibility == View.VISIBLE) {
            Toast.makeText(this, "请先切到助手页", Toast.LENGTH_SHORT).show()
            return
        }
        chatView.evaluateJavascript(expr, null)
    }

    /** 更多菜单：原本顶部一排按钮（助手/遥控/工具/历史/新建）全部收纳于此，浮空「⋯」按钮触发 */
    private fun showMoreMenu(anchor: View) {
        val popup = android.widget.PopupMenu(this, anchor)
        popup.menu.add(0, 6, 0, "💬 助手")
        popup.menu.add(0, 7, 0, "🎮 遥控器")
        popup.menu.add(0, 1, 0, "🛠 工具")
        popup.menu.add(0, 2, 0, "📜 历史对话")
        popup.menu.add(0, 3, 0, "➕ 新建对话")
        popup.menu.add(0, 8, 0, "📁 文件")
        popup.menu.add(0, 9, 0, "🖥 终端")
        popup.menu.add(0, 10, 0, "🌐 浏览器")
        popup.menu.add(0, 4, 0, "📋 对话日志")
        popup.menu.add(0, 5, 0, "♿ 开启无障碍")
        popup.menu.add(0, 11, 0, "💳 充值Token")
        popup.menu.add(0, 12, 0, "🚪 退出登录")
        popup.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                6 -> switchTab(false)
                7 -> switchTab(true)
                1 -> chatJs("\$('btnTools').click()")
                2 -> chatJs("\$('btnHist').click()")
                3 -> chatJs("\$('btnNew').click()")
                8 -> switchFiles()
                9 -> switchTerm()
                10 -> switchBrowser()
                4 -> chatJs("\$('btnLogs').click()")
                5 -> openA11yManual()
                11 -> openRecharge()
                12 -> confirmLogout()
            }
            true
        }
        popup.show()
    }

    /** 💳 充值Token：用系统浏览器打开朱峰官网 AI Token 充值页 */
    private fun openRecharge() {
        val url = "https://www.zf3d.com/airecharge.asp"
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: Exception) {
            Toast.makeText(this, "无法打开充值页：$url", Toast.LENGTH_SHORT).show()
        }
    }

    /** 🚪 退出登录：二次确认后清除登录凭证（原生 authToken + 助手页 localStorage），回登录页 */
    private fun confirmLogout() {
        android.app.AlertDialog.Builder(this)
            .setTitle("退出登录")
            .setMessage("确定要退出当前账号吗？退出后需重新登录。对话历史会保留。")
            .setPositiveButton("退出登录") { _, _ -> doLogout() }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun doLogout() {
        // 1) 清原生登录 token
        prefs.authToken = ""
        // 2) 确保在助手页（隐藏 WebView 可能不执行 JS），清登录凭证并回登录页
        switchTab(false)
        if (::chatView.isInitialized) {
            chatView.evaluateJavascript(
                "try{localStorage.removeItem('zf_agkey');localStorage.removeItem('zf_uid');localStorage.removeItem('zf_name');}catch(e){}",
                null
            )
            // reload 后 index.html 的 init() 因 agKey 为空 → 停在登录页
            chatView.postDelayed({ if (::chatView.isInitialized) chatView.reload() }, 150)
        }
        Toast.makeText(this, "已退出登录", Toast.LENGTH_SHORT).show()
    }

    private fun switchFiles() {
        webView.visibility = View.GONE
        chatView.visibility = View.GONE
        chatDirty = true  // 【黑屏修复】助手页被 GONE 过，切回必须 reload 一次
        termView?.setVisible(false)
        browserContainer.visibility = View.GONE
        splash.visibility = View.GONE
        if (filesView == null) {
            val host = findViewById<View>(R.id.splash).parent as android.view.ViewGroup
            val fv = FilesView(this, serverUrl)
            fv.onClose = { switchTab(false) } // 【新增】点 ✕ 直接切回助手页
            host.addView(fv.getView(), 0)
            filesView = fv
        }
        filesView?.setVisible(true)
        tabMore.setTextColor(0xFFFFFFFF.toInt())
    }

    private fun switchTerm() {
        webView.visibility = View.GONE
        chatView.visibility = View.GONE
        chatDirty = true  // 【黑屏修复】助手页被 GONE 过，切回必须 reload 一次
        filesView?.setVisible(false)
        browserContainer.visibility = View.GONE
        splash.visibility = View.GONE
        val tvE = ensureTermView()
        tvE.setVisible(true)
        tabMore.setTextColor(0xFFFFFFFF.toInt())
    }

    /** 🌐 浏览器 Tab：显示/隐藏，状态常驻内存 */
    private fun switchBrowser() {
        webView.visibility = View.GONE
        chatView.visibility = View.GONE
        chatDirty = true  // 【黑屏修复】助手页被 GONE 过，切回必须 reload 一次
        filesView?.setVisible(false)
        termView?.setVisible(false)
        splash.visibility = View.GONE
        browserContainer.visibility = View.VISIBLE
        tabMore.setTextColor(0xFFFFFFFF.toInt())
    }

    /**
     * 内置浏览器初始化：
     * - 复用 setupWebView 基础配置，但不挂任何 JS 桥（防任意网页调用原生能力）
     * - target=_blank / 非http(s) 链接交系统浏览器处理
     * - 下载走系统 DownloadManager
     */
    @SuppressLint("SetJavaScriptEnabled")
    private fun setupBrowser() {
        setupWebView(browserView, isChat = true) // isChat=true 避免挂 ZFMobile 桥 & 不触发离线提示
        browserView.removeJavascriptInterface("ZFBridge") // 保险：隔离 PocketBridge，浏览器页不暴露任何原生桥
        browserView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.startsWith("http://") || url.startsWith("https://")) return false // 内部加载
                try {
                    startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)))
                } catch (e: Exception) { Toast.makeText(this@MainActivity, "无法打开：$url", Toast.LENGTH_SHORT).show() }
                return true
            }
            override fun onPageFinished(view: WebView?, url: String?) {
                if (url?.startsWith("http") == true) urlInput.setText(url)
            }
        }
        browserView.webChromeClient = object : WebChromeClient() {}
        browserView.setDownloadListener { url, _, _, _, _ ->
            try {
                startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)))
            } catch (e: Exception) { }
        }
        fun go() {
            var u = urlInput.text.toString().trim()
            if (u.isEmpty()) return
            if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://$u"
            browserView.loadUrl(u)
        }
        urlInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_GO) { go(); true } else false
        }
    }

    private fun showServerDialog() {
        val input = android.widget.EditText(this)
        input.hint = "http://192.168.31.49:8570"
        input.setText(prefs.serverUrl.ifBlank { defaultServer })
        android.app.AlertDialog.Builder(this)
            .setTitle("服务器地址")
            .setMessage("输入电脑上智能体服务的地址")
            .setView(input)
            .setPositiveButton("保存并连接") { _, _ ->
                reloadWithServer(input.text.toString().trim())
            }
            .setNegativeButton("取消", null)
            .show()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView(wv: WebView, isChat: Boolean) {
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true          // 聊天页依赖 localStorage 多会话
            databaseEnabled = true
            // 【修复·峰控遥控初始缩放】不再 overview 缩小整页：强制初始缩放 100%，
            // 避免宽版 PC 页被 WebView 自动缩小到「所有东西都变小」
            loadWithOverviewMode = false
            useWideViewPort = true
            textZoom = 100
            mediaPlaybackRequiresUserGesture = false // TTS/语音自动播放
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            cacheMode = WebSettings.LOAD_DEFAULT // 静态资源走缓存，弱网/重开更快
            allowFileAccess = true
            // file:// 页面跨域 fetch zf3d.com 必需（登录/模型接口），否则 Failed to fetch
            @Suppress("DEPRECATION")
            setAllowUniversalAccessFromFileURLs(true)
            @Suppress("DEPRECATION")
            setAllowFileAccessFromFileURLs(true)
        }
        if (!isChat) WebView.setWebContentsDebuggingEnabled(true) // P1 调试期开启，release 关闭

        wv.webViewClient = object : WebViewClient() {
            // 【提速】首帧可见即隐藏 splash，不等全部资源加载完
            override fun onPageCommitVisible(view: WebView?, url: String?) {
                splash.visibility = View.GONE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                if (view === webView) {
                    splash.visibility = View.GONE
                    injectTouchShim(view)
                }
                if (view === chatView) {
                    // 【修复】助手页加载完成也必须隐藏启动遮罩，否则重开 App 卡在「正在连接智能体…」
                    splash.visibility = View.GONE
                    // 【修复】file:// 页 location.origin 是 "file://"，device_list 等会拼出 file:///api/...
                    // 传给原生 HttpBridge 报 FileURLConnection 强转错误。注入真实服务端地址供 JS 兜底。
                    view?.evaluateJavascript("window.ZF_SERVER_BASE='$serverUrl';", null)
                    if (!chatExported) {
                        chatExported = true
                        injectSessionBridge()
                    }
                }
            }

            override fun onReceivedError(view: WebView?, req: WebResourceRequest?, err: WebResourceError?) {
                if (view === webView && req?.isForMainFrame == true) showOffline()
            }
        }
        wv.webChromeClient = object : WebChromeClient() {
            /* 【修复】对话列表"不好使"根因：网页 prompt()/confirm() 无回调时 WebView 静默返回 null/false，
               导致历史对话重命名弹不出、高危确认恒拒绝。补齐三个 JS 对话框的原生实现。 */
            private fun jsDialog(
                view: WebView?, url: String?, message: String?, defaultValue: String?,
                isConfirm: Boolean, result: JsResult?, promptResult: JsPromptResult?
            ): Boolean {
                val ctx = view?.context ?: return false
                val input = if (isConfirm) null else android.widget.EditText(ctx).apply {
                    setText(defaultValue ?: "")
                    setSingleLine()
                    setPadding(48, 32, 48, 32)
                }
                val builder = android.app.AlertDialog.Builder(ctx)
                    .setTitle(url?.takeLast(30) ?: "提示")
                    .setMessage(message ?: "")
                if (input != null) builder.setView(input)
                builder.setPositiveButton("确定") { _, _ ->
                    if (promptResult != null) promptResult.confirm(input?.text?.toString() ?: "")
                    else result?.confirm()
                }
                /* 纯 alert（isConfirm 且无输入框）不显示取消按钮 */
                if (input != null || promptResult != null) builder.setNegativeButton("取消") { _, _ ->
                    if (promptResult != null) promptResult.cancel() else result?.cancel()
                }
                builder.setOnCancelListener {
                    if (promptResult != null) promptResult.cancel() else result?.cancel()
                }
                try { builder.show() } catch (e: Exception) {
                    if (promptResult != null) promptResult.cancel() else result?.cancel()
                }
                return true
            }
            override fun onJsAlert(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean =
                jsDialog(view, url, message, null, isConfirm = true, result = result, promptResult = null)
            override fun onJsConfirm(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean =
                jsDialog(view, url, message, null, isConfirm = true, result = result, promptResult = null)
            override fun onJsPrompt(view: WebView?, url: String?, message: String?, defaultValue: String?, result: JsPromptResult?): Boolean =
                jsDialog(view, url, message, defaultValue, isConfirm = false, result = null, promptResult = result)

            override fun onPermissionRequest(request: PermissionRequest?) {
                // 仅授予媒体采集类资源（P4 收口前最小授权）
                val grant = request?.resources?.filter {
                    it == PermissionRequest.RESOURCE_AUDIO_CAPTURE || it == PermissionRequest.RESOURCE_VIDEO_CAPTURE
                }
                request?.grant(grant?.toTypedArray() ?: emptyArray())
            }

            // 【修复】网页 <input type=file> 无此回调时点击无反应 → 弹系统选择器
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                pendingFileCallback?.onReceiveValue(null) // 上一个未结束的直接取消，防卡死
                pendingFileCallback = filePathCallback
                return try {
                    val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE); type = "*/*"
                    }
                    // 审核员#2：capture 分支为死代码（createIntent 不带该 extra）已删除；
                    // 「拍照」实际走系统选择器（相册/相机 App 均可选），真正 ACTION_IMAGE_CAPTURE + FileProvider 留待下版
                    startActivityForResult(intent, REQ_FILE_CHOOSER)
                    true
                } catch (e: Exception) {
                    pendingFileCallback = null
                    Toast.makeText(this@MainActivity, "无法打开选择器: ${e.message}", Toast.LENGTH_SHORT).show()
                    false
                }
            }
        }
        if (wv === chatView) {
            // 兼容聊天页依赖的口袋助手桥（v1 最小集：振动 + 剪贴板）
            val pocketObj = PocketBridge(this)
            wv.addJavascriptInterface(pocketObj, "ZFBridge")
            // 原生 HTTP 桥：file:// 页 fetch 走原生，绕开新版 WebView CORS 拦截（登录 Failed to fetch 根因）
            wv.addJavascriptInterface(HttpBridge(wv), "ZFHttp")
            // 审核 P0 修复：聊天页 phone_* 工具也需要手机操控桥，bCall 优先取 ZFMobile
            val mobileObj = NativeBridge(this)
            wv.addJavascriptInterface(mobileObj, "ZFMobile")
            // 内置终端桥：聊天页智能体可通过 window.ZFTerm.runCommand 操作 App 自带 busybox 终端
            val termObj = TermBridge(this)
            wv.addJavascriptInterface(termObj, "ZFTerm")
            // v56 方案C：Termux 桥（RUN_COMMAND 广播），聊天页智能体通过 window.ZFTermux.run(cmd) 让 Termux 后台执行命令
            val termuxObj = TermuxBridge(this)
            wv.addJavascriptInterface(termuxObj, "ZFTermux")
            // 内置浏览器控制桥：聊天页智能体通过 window.ZFBrowser 操作 App 自带浏览器（browserView 网页自身拿不到本桥）
            val browserObj = BrowserBridge(this)
            wv.addJavascriptInterface(browserObj, "ZFBrowser")
            // v72 媒体桥：聊天页智能体通过 window.ZFMedia 播放音频/视频 + 断点续传下载
            val mediaObj = MediaBridge(this)
            wv.addJavascriptInterface(mediaObj, "ZFMedia")
            val uiObj = ZFUIBridge(java.lang.ref.WeakReference(this))
            wv.addJavascriptInterface(uiObj, "ZFUI")
            // 通用异步桥：把各同步桥的耗时调用转后台线程，修复"计算中界面定住/无法拖拽/无法停止"。
            // 复用上面已 new 的同一份实例（保持内部 executor/活动请求表等状态一致），反射按命名空间路由。
            wv.addJavascriptInterface(
                AsyncBridge(wv, mapOf(
                    "ZFMobile" to mobileObj,
                    "ZFBridge" to pocketObj,
                    "ZFTerm" to termObj,
                    "ZFTermux" to termuxObj,
                    "ZFBrowser" to browserObj,
                    "ZFMedia" to mediaObj,
                    "ZFUI" to uiObj
                )),
                "ZFAsync"
            )
        } else if (wv === webView) {
            // 主 WebView 注入原生工具桥：window.ZFMobile
            wv.addJavascriptInterface(NativeBridge(this), "ZFMobile")
        }
    }

    /** browserView 供 BrowserBridge 使用（助手页桥只读引用，browserView 网页自身拿不到桥） */
    fun getBrowserView(): WebView? = if (::browserView.isInitialized) browserView else null

    /** 供 PocketBridge 反射读取当前服务器地址（服务端 TTS 原生播放用） */
    fun getServerUrlPublic(): String = serverUrl

    /** 获取（或懒创建）内置终端视图，供终端 Tab 与 TermBridge 共用 */
    fun ensureTermView(): TermView {
        if (termView == null) {
            val host = findViewById<View>(R.id.splash).parent as android.view.ViewGroup
            val tvCreated = TermView(this)
            tvCreated.onClose = { switchTab(false) } // 【新增】点 ✕ 直接切回助手页
            host.addView(tvCreated.getView(), 0)
            termView = tvCreated
        }
        return termView!!
    }

    private fun loadAgent() {
        splash.visibility = View.VISIBLE
        webView.loadUrl(serverUrl)
    }

    private fun loadChat() {
        chatView.loadUrl("file:///android_asset/web/index.html")
    }

    /**
     * 峰控 v2 登录态打通：
     * 1) 启动时若原生 Prefs 有备份的 zf_sessions 而 localStorage 为空 → 回灌（换机/重装恢复）；
     * 2) 之后 localStorage 变化即自动备份到 Prefs（页面源更新也不丢）。
     */
    private fun injectSessionBridge() {
        val js = """
        (function(){
          if (window.__zfSessionBridge) return; window.__zfSessionBridge = true;
          function backup(){
            try {
              var s = localStorage.getItem('zf_sessions') || '';
              var saved = window.ZFBridge.loadSessions ? window.ZFBridge.loadSessions() : '';
              if (s && s !== saved) window.ZFBridge.saveSessions(s);
            } catch(e){}
          }
          // 恢复：Prefs 有备份而本地为空
          try {
            var saved = window.ZFBridge.loadSessions ? window.ZFBridge.loadSessions() : '';
            if (saved && !localStorage.getItem('zf_sessions')) {
              localStorage.setItem('zf_sessions', saved);
              if (typeof window.__zfReloadSessions === 'function') window.__zfReloadSessions();
              else location.reload();
              return;
            }
          } catch(e){}
          backup();
          setInterval(backup, 5000);
          window.addEventListener('beforeunload', backup);
        })();
        """.trimIndent()
        chatView.evaluateJavascript(js, null)
    }

    /**
     * 触摸→鼠标事件转发：
     * 网页版画布（风筝点击、导航拖拽、画布平移）基于 mousedown/mousemove/mouseup 实现，
     * 手机触屏只产生 touch 事件，这里把单指触摸实时转成对应鼠标事件，恢复桌面端交互。
     */
    private fun injectTouchShim(wv: WebView?) {
        val js = """
        (function(){
          if (window.__zfTouchShim) return; window.__zfTouchShim = true;
          function mk(type, t, buttons){
            return new MouseEvent(type, {
              bubbles:true, cancelable:true, view:window,
              clientX:t.clientX, clientY:t.clientY,
              screenX:t.screenX, screenY:t.screenY,
              button:0, buttons:buttons
            });
          }
          var CLICKABLE = 'a,button,input,textarea,select,label,[onclick],[role=button]';
          var sx=0, sy=0, moved=false, downSent=false, startEl=null, suppressClick=false;
          function reset(){ sx=0; sy=0; moved=false; downSent=false; startEl=null; }
          function sendDown(t, el){ (el||document).dispatchEvent(mk('mousedown',t,1)); downSent=true; }
          function sendUp(t){
            if(!downSent) return;
            var el=document.elementFromPoint(t.clientX,t.clientY)||document;
            el.dispatchEvent(mk('mouseup',t,0)); downSent=false; suppressClick=true;
          }
          document.addEventListener('touchstart', function(e){
            if(e.touches.length!==1){ if(downSent) sendUp(e.changedTouches[0]||e.touches[0]); reset(); return; }
            var t=e.touches[0]; sx=t.clientX; sy=t.clientY;
            moved=false; downSent=false;
            startEl=(e.target&&e.target.closest)?e.target.closest(CLICKABLE):null;
          }, {passive:true});
          document.addEventListener('touchmove', function(e){
            if(e.touches.length!==1) return;
            var t=e.touches[0];
            var dx=t.clientX-sx, dy=t.clientY-sy;
            if(!moved && (dx*dx+dy*dy)>64) moved=true; // 位移超约8px才认定为拖拽
            if(!moved) return;
            // 起点若是链接/按钮且还没补发过 mousedown，让位给原生点击，不抢手势
            if(!downSent && startEl) return;
            if(!downSent) sendDown(t, startEl||e.target);
            e.target.dispatchEvent(mk('mousemove',t,1));
            e.preventDefault();
          }, {passive:false});
          document.addEventListener('touchend', function(e){
            var t=(e.changedTouches&&e.changedTouches[0])||null; if(!t) return;
            if(downSent){ sendUp(t); e.preventDefault(); }
            reset();
          }, {passive:false});
          document.addEventListener('touchcancel', function(){ if(downSent) suppressClick=true; reset(); }, {passive:true});
          // 拖拽结束后吞掉紧随的多余原生 click（mousedown 序列已模拟过，再触发会误点按钮）
          document.addEventListener('click', function(e){
            if(suppressClick){ suppressClick=false; e.stopPropagation(); e.preventDefault(); }
          }, true);
        })();
        """.trimIndent()
        wv?.evaluateJavascript(js, null)
    }

    private fun showOffline() {
        splash.visibility = View.VISIBLE
        Toast.makeText(this, "无法连接智能体服务：$serverUrl\n长按页面可在设置中配置服务器地址", Toast.LENGTH_LONG).show()
    }

    override fun onBackPressed() {
        when {
            browserContainer.visibility == View.VISIBLE && browserView.canGoBack() -> browserView.goBack()
            webView.visibility == View.VISIBLE && webView.canGoBack() -> webView.goBack()
            chatView.visibility == View.VISIBLE && chatView.canGoBack() -> chatView.goBack()
            else -> super.onBackPressed()
        }
    }

    /** 供后续设置页调用的重载入口 */
    fun reloadWithServer(url: String) {
        prefs.serverUrl = url
        remoteLoaded = true // 已指向新地址，避免首次切遥控被懒加载守卫吞掉
        loadAgent()
    }
}
