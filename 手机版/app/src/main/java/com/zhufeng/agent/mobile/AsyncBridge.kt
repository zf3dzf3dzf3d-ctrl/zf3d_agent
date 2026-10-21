package com.zhufeng.agent.mobile

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import java.lang.reflect.InvocationTargetException
import java.util.concurrent.Executors

/**
 * 通用异步原生桥（修复"计算过程中界面定住、无法拖拽/无法停止"根因）。
 *
 * 背景：WebView 的 @JavascriptInterface 同步调用会阻塞 Blink renderer 主线程
 * （页面 DOM/触摸/滚动/点击事件都靠这条线程处理），所以只要 AI 工具循环里
 * 有一个耗时工具（runSequence 连续手势 / term 命令 / httpGet / 截屏 等）在跑，
 * 整个界面就会冻结，用户既滑不动也点不了"停止"。
 *
 * 方案：页面侧用 Promise 包装后调用本桥 call(ns, method, argsJson, callId)，
 * 本桥在后台线程池反射调用各原生桥对象的同名同步方法，拿到结果后切回 UI 线程
 * 经 evaluateJavascript 回调 window.__zfAsyncDone(callId, resultJson)，
 * 从而把阻塞从"JS 主线程"转移到"后台线程"，页面全程保持响应。
 *
 * 仅做透明转发，不改变任何工具的行为与返回值语义（返回值原样作为字符串回传，
 * 由页面 JSON.parse，与旧 bJson 完全一致）。各对象实例复用 MainActivity 已注入的
 * 同一份，避免重复 new 导致内部状态（executor/活动请求表等）割裂。
 */
class AsyncBridge(
    private val webView: WebView,
    private val objects: Map<String, Any>
) {
    private val executor = Executors.newCachedThreadPool()
    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun call(ns: String, method: String, argsJson: String, callId: String) {
        executor.execute {
            val result: String = try {
                val target = objects[ns]
                if (target == null) {
                    "bridge-missing"
                } else {
                    val raw = invokeMethod(target, method, argsJson)
                    when (raw) {
                        null -> ""
                        is String -> raw
                        else -> raw.toString()
                    }
                }
            } catch (e: NoSuchMethodException) {
                // 【关键修复】命名空间路由错误（方法不在本对象上，实际在另一个桥里）。
                // 必须返回 bridge-missing 而非 bridge-error：前端 bJsonA 兜底只认
                // bridge-missing 才会回退到 ZFBridge。原先返回 bridge-error 使
                // 15 个仅在 ZFBridge 定义的方法（httpGet/listFiles/readFile/writeFile/
                // appendFile/deleteFile/searchFiles/deviceInfo/netInfo/clipboardCopy/
                // vibrate/openUrl/speak/speakStop/notify）经 ZFMobile 反射失败后
                // 不回退，JSON.parse("bridge-error:...") 失败 → 工具全体"获取失败"。
                "bridge-missing"
            } catch (e: InvocationTargetException) {
                val cause = e.cause ?: e
                // 真·方法执行期异常（被反射包装），保留 bridge-error 语义
                "bridge-error:" + (cause.message ?: cause.javaClass.simpleName)
            } catch (e: Exception) {
                "bridge-error:" + (e.message ?: e.javaClass.simpleName)
            }
            // 切回 UI 线程回调页面（evaluateJavascript 必须在主线程调用）
            mainHandler.post {
                try {
                    webView.evaluateJavascript(
                        "window.__zfAsyncDone&&window.__zfAsyncDone(" +
                            JSONArray().put(callId).put(result).toString().removePrefix("[").removeSuffix("]"),
                        null
                    )
                } catch (_: Exception) {}
            }
        }
    }

    /** 反射查找 name + 参数个数匹配的方法，把 argsJson（JSON 数组）按形参类型自适应转换后调用 */
    private fun invokeMethod(target: Any, method: String, argsJson: String): Any? {
        val args = try {
            if (argsJson.isBlank() || argsJson == "null") JSONArray() else JSONArray(argsJson)
        } catch (_: Exception) {
            JSONArray()
        }
        val cls = target.javaClass
        var best: java.lang.reflect.Method? = null
        for (m in cls.methods) {
            if (m.name == method && m.parameterTypes.size == args.length()) {
                best = m; break
            }
        }
        if (best == null) {
            // 允许参数个数多于实参（带默认值的 Kotlin 方法反射须显式补齐）
            for (m in cls.methods) {
                if (m.name == method && m.parameterTypes.size >= args.length()) { best = m; break }
            }
        }
        val found = best ?: throw NoSuchMethodException("method not found: $method/${args.length()}")
        val pts = found.parameterTypes
        val vals = arrayOfNulls<Any>(pts.size)
        for (i in pts.indices) {
            vals[i] = coerce(if (i < args.length()) args.get(i) else null, pts[i])
        }
        found.isAccessible = true
        return found.invoke(target, *vals)
    }

    /** 把 JSONArray 元素（可能为 JSONObject.NULL）转成目标形参类型 */
    private fun coerce(v: Any?, pt: Class<*>): Any? {
        if (v == null || v == JSONObject0.NULL) {
            // 基本类型不能为 null，给安全默认值
            return when (pt) {
                java.lang.Boolean.TYPE, java.lang.Boolean::class.java -> false
                java.lang.Integer.TYPE, java.lang.Integer::class.java -> 0
                java.lang.Long.TYPE, java.lang.Long::class.java -> 0L
                java.lang.Float.TYPE, java.lang.Float::class.java -> 0f
                java.lang.Double.TYPE, java.lang.Double::class.java -> 0.0
                else -> null
            }
        }
        return when (pt) {
            java.lang.String::class.java, CharSequence::class.java -> v.toString()
            java.lang.Boolean.TYPE, java.lang.Boolean::class.java -> when (v) {
                is Boolean -> v
                else -> v.toString().trim().equals("true", true) || v.toString().trim() == "1"
            }
            java.lang.Integer.TYPE, java.lang.Integer::class.java -> toInt(v)
            java.lang.Long.TYPE, java.lang.Long::class.java -> toLong(v)
            java.lang.Float.TYPE, java.lang.Float::class.java -> toFloat(v)
            java.lang.Double.TYPE, java.lang.Double::class.java -> toDouble(v)
            java.lang.Object::class.java -> v
            else -> v
        }
    }

    private fun toInt(v: Any): Int = when (v) {
        is Int -> v; is Long -> v.toInt(); is Double -> v.toInt(); is Float -> v.toInt()
        else -> v.toString().trim().toDoubleOrNull()?.toInt() ?: 0
    }
    private fun toLong(v: Any): Long = when (v) {
        is Long -> v; is Int -> v.toLong(); is Double -> v.toLong(); is Float -> v.toLong()
        else -> v.toString().trim().toDoubleOrNull()?.toLong() ?: 0L
    }
    private fun toFloat(v: Any): Float = when (v) {
        is Float -> v; is Int -> v.toFloat(); is Long -> v.toFloat(); is Double -> v.toFloat()
        else -> v.toString().trim().toFloatOrNull() ?: 0f
    }
    private fun toDouble(v: Any): Double = when (v) {
        is Double -> v; is Float -> v.toDouble(); is Int -> v.toDouble(); is Long -> v.toDouble()
        else -> v.toString().trim().toDoubleOrNull() ?: 0.0
    }

    /** 占位：org.json 的 NULL 常量引用（避免直接依赖命名冲突） */
    private object JSONObject0 { val NULL: Any = org.json.JSONObject.NULL }
}
