# 朱峰智能体无限 · 手机版（mobile-app）

> 目标：手机里装一个 App，就是**完整的朱峰智能体无限**——和 PC 版几乎一模一样。
> 策略：App = WebView 壳 + 现有智能体 Web UI（复用 5.5.5 的移动自适应界面），界面零开发。
> 计划：lp-mobile-agent（P1 骨架 → P2 LLM+记忆 → P3 工具层 → P4 加固 → P5 APK）

## 架构

```
┌─ 手机 App (mobile-app) ──────────────┐
│  WebView 壳                          │
│   └─ 加载智能体 UI（与 PC 完全一致）    │
│  NativeBridge (window.ZFMobile)      │
│   ├─ P1: isApp/appVersion 占位        │
│   ├─ P2: Keystore token + LLM 直连    │
│   └─ P3: 无障碍读屏/SAF 文件/HTTP 工具 │
└──────────────────────────────────────┘
         │ 同一账号，同一大脑（社区 LLM/API）
```

## 服务器地址

- 调试（模拟器）：`http://10.0.2.2:8555`（映射宿主机 5.5.5 本地服务）
- 真机调试：PC 与手机同一局域网，`http://<PC局域网IP>:8555`（需把 port.json 的 host 改 0.0.0.0）
- 正式版：社区云端地址（P2 接入）

## 构建

前置条件（二选一）：
- **推荐**：用 Android Studio 打开 `mobile-app/` 目录（它会自动用内置 Gradle 同步构建，无需手动装 Gradle）
- 或：已安装 Gradle 8.7+ 与 JDK 17 的机器上命令行构建：

```
cd mobile-app
gradle assembleDebug   # 产物 app/build/outputs/apk/debug/app-debug.apk
```

注：图标暂用系统占位图标（@android:drawable/sym_def_app_icon），P5 打正式包时替换为品牌图标。

## 目录

- `app/src/main/java/com/zhufeng/agent/mobile/MainActivity.kt` — WebView 壳主体
- `NativeBridge.kt` — JS↔原生桥（P3 扩展工具层）
- `Prefs.kt` — 配置存储（P2 升级 Keystore）
