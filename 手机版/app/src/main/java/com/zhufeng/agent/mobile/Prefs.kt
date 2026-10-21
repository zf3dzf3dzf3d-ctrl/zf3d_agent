package com.zhufeng.agent.mobile

import android.content.Context

/** 轻量配置存储（P2 迁移到 EncryptedSharedPreferences/Keystore） */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("zf_mobile", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = sp.getString("server_url", "") ?: ""
        set(value) = sp.edit().putString("server_url", value).apply()

    var authToken: String
        get() = sp.getString("auth_token", "") ?: ""
        set(value) = sp.edit().putString("auth_token", value).apply()
}
