plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.zhufeng.agent.mobile"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.zhufeng.agent.mobile"
        minSdk = 24
        targetSdk = 34
        versionCode = 130
        versionName = "5.7.0-v105-session-isolation+inkblack"
    }

    // 打包卫生：构建时忽略 assets 内所有备份/临时文件（*.bak*、*.orig、*.rej、隐藏文件等），
    // 防止历史乱码坏版 index.html.bak.broken_* 等被打进 APK 分发到设备。
    androidResources {
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!*.bak:!*.bak.*:!*bak*:!*.orig:!*.rej:!*.swp:!*.swo"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
    // P2: EncryptedSharedPreferences / Keystore
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    // P3: OkHttp（HTTP 工具层）
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
