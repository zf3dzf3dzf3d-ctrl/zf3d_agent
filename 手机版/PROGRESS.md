# 手机即智能体 · 开发进度存档

> 更新时间：第5轮收口后（纯文档/流程轮次，无新代码改动）
> 真源：《策划案-手机即智能体》v1.1（private/记忆/）
> 开发目录：F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.5\mobile-app\
> 计划：lp-mobile-agent（已 handoff，剩余 3 步）

## 一、当前状态总览

| 阶段 | 状态 | 说明 |
|---|---|---|
| P1 骨架（WebView壳） | ✅ 完成并过审 | 第2轮审核双通过，正式关闭 |
| P3 无障碍工具层 | ⚠️ 代码完成、待真机验证 | ZFAccessibilityService + NativeBridge 全套桥接已落盘，**跑完 M1 六项清单前不得标记完成** |
| P4 安全收口 | ⏳ 未开始 | cleartext 收回、WebView 调试关闭、token 安全 |
| P5 正式包 | ⏳ 未开始 | 品牌 mipmap 图标替换系统占位图标 |

## 二、已完成事项（含提交）

- **P1 骨架**（commit `b9a3299`）：MainActivity.kt / NativeBridge.kt / Prefs.kt / 布局 / 主题 / Gradle（AGP 8.5.2 + Kotlin 1.9.24 + Gradle 8.7）
- **P1 审核修复**：
  - Manifest 图标改 `@android:drawable/sym_def_app_icon`（编译必过；品牌图标 P5 换）
  - onPermissionRequest 收紧为仅 AUDIO/VIDEO_CAPTURE 放行
  - RECORD_AUDIO 运行时权限申请已加（MainActivity L34-36）
  - 删除死代码 serverFile()
  - README 补前置条件（推荐 Android Studio；命令行需 Gradle 8.7+ / JDK 17）
- **scrcpy v5.0 装机**：`C:\Programs\scrcpy\scrcpy-win64-v5.0\`（自带 adb 37.0.1）
- **WS 协议 v1 冻结**：项目记录「手机智能体-WS协议v1」
- **P3 工具层核心**（commit `5194efa`）：ZFAccessibilityService.kt（readScreen maxNodes=120 / clickByText 找可点击父节点 / inputText 兜底扫描）、NativeBridge 八接口（readScreen/clickText/clickTextExact/inputText/pressBack/Home/Recents/a11yReady）全带 @JavascriptInterface；Manifest 注册 BIND_ACCESSIBILITY_SERVICE + config（typeAllMask、canRetrieveWindowContent=true）
- **.gitignore 补 `*.bak*`**（commit `c2494de`，属冗余兜底，L18/19 已有覆盖）

## 三、⚠️ 唯一硬卡点：真机未接入

`adb devices` 实测输出为空（List of devices attached，0 设备）。

**续做入口**：用户插 USB 真机并开启 USB 调试后，说"手机连上了"，然后：
1. adb devices 确认识别（scrcpy 自带 adb：`C:\Programs\scrcpy\scrcpy-win64-v5.0\adb.exe`）
2. 安装 APK（gradle assembleDebug 或 Android Studio 构建）
3. 跑 **M1 六项清单**：① readScreen 返回非空 ② clickText ③ inputText ④ pressBack ⑤ 微信setText（国产ROM重点坑）⑥ WS 连接 PC 端

## 四、流程规矩（多轮审核沉淀，必须遵守）

1. **提交口径**：先 `git status` 核对改动清单再写 commit message；同功能文件一并 add 进同一提交（防止账实错位）
2. **先查现状再整改**：审核整改前先查现有规则，已覆盖就答复"已有规则、无需改动"，不做象征性提交
3. **状态纪律**：M1 六项跑完前，不得把 P3"可用"等乐观结论写进记忆/策划案
4. **进展汇报**：必须附 adb devices 实际输出 + M1 实测结果，否则不算实质推进

## 五、已知遗留（非阻塞，P4 处理）

- usesCleartextTraffic 全局放行 → P4 收口
- WebView 调试常开 → P4 关闭
- authToken 明文存储（Prefs）→ P2/P4 加密
- gradle wrapper 缺 gradlew/gradle-wrapper.jar 三件套 → 补齐或 README 已注明用 Android Studio
- 国产 ROM 风险预案：保活、clickByText 父节点查找、inputText 焦点兜底 —— 全部等真机实测；备选方案 Shizuku

## 六、iOS 范围声明

iOS 端因无障碍能力受限（无公开自动化接口），本期不在范围内，仅做 WebView 壳。

## 七、v91 打包记录（2026-10-20 14:11）

**背景**：用户报「手机版安装失败，好像没升级」。核查发现两个独立问题：

### 问题 1：APK 确实比源码旧
- 旧包 `zf-fengkong-v90.apk`（10:12 打包，versionCode 115）
- 源码 `assets/web/index.html` 最后修改 11:16，**晚于 APK 打包时间 1 小时**
- 即 11:16 之后的两次修复（`741600770` agentExecTool 同步 bJson→await bJsonA 补漏等）**从未进过任何 APK**

**处理**：
1. `app/build.gradle.kts`：versionCode 115→116，versionName 5.5.28-v90→5.5.28-v91
2. `gradlew clean assembleDebug` 全量重建（BUILD SUCCESSFUL）
3. **剔除误打包的 15 个 `.bak` 备份文件**（源码目录里残留的 `*.bak.2026xxxx` 被 Gradle 当资源打进 assets，白占约 300KB）。已移出到 `手机版/_bak_outside_assets/`（已被 .gitignore 忽略）
4. 归档 `手机版/zf-fengkong-v91.apk`（6,914,192 字节）

### 问题 2：安装失败的可能原因（签名）
历次 APK 签名实测（apksigner --print-certs）：
- v86 / v88：`52728...` 之外的那把（`b30b7eae...`）
- v87 / v89 / v90 / **v91**：`52728...`（同一把）

v91 与 v90 **签名 SHA-256 完全一致**，可正常覆盖升级。若用户手机里装的是 v86/v88 那把签名，必须先卸载再装。

### 校验结果（全部实测）
| 项 | 结果 |
|---|---|
| APK 内 `assets/web/` vs 源码 | 13/13 文件 MD5 **逐字节一致**，差异 0 |
| APK ZIP 完整性 | `testzip()` = OK |
| versionCode / versionName | 116 / 5.5.28-v91（aapt badging 确认） |
| 签名 SHA-256 | 与 v90 一致（可覆盖升级） |
| APK 内 `.bak` 文件 | 0 个（已剔除） |
| minSdk / targetSdk | 24 / 34（Android 7.0+ 均可装） |
| 原生库 | arm64-v8a（仅 64 位机） |
| PC 端 8560 端口 | LISTENING（PID 16948）正常 |

### 遗留（需真机）
- **adb devices 输出为空，仍无真机接入**，无法代为安装
- 手机端硬编码 `http://192.168.31.49:8560` 连 PC 端，PC 端 IP 变了必须重打包
- APK 只含 arm64-v8a，若手机是 32 位需补 abiFilters

### 安装指引（用户手动）
```
C:\Programs\scrcpy\scrcpy-win64-v5.0\adb.exe install -r -d "F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.6.0\手机版\zf-fengkong-v92.apk"
```
`-r` 覆盖安装、`-d` 允许降级；若报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`（签名不一致），先 `adb uninstall com.zhufeng.agent.mobile` 再装。

---

## 2026-10-20 16:xx v92：等待点+台球位置修复（点在上球在下 + 全场景压底）

**背景**：用户报「手机版运行中的等待点位置不对，应在 AI 回复下方、台球上方」。

**处理（两个 commit）**：
1. `0c3cd2ac9` 等待点位置修复：`tt-row` 改上下布局（`flex-direction:column;align-items:flex-start`，等待点在上、台球在下）；四处流式收尾 `appendChild(bub)` 后补压 `_ttRow`，确保等待点+台球始终位于所有 AI 回复下方。
2. `d24236d6a` 审核整改：catch 错误分支（index.html 1774 行）`appendChild(bub)` 后补 `_ttRow` 压底，覆盖审核员所指「异常路径下错误气泡反超等待点+台球」边缘反例。压底语句现共 5 处收尾（含初始 1 处），全场景闭环。

**打包**：
- `app/build.gradle.kts`：versionCode 116→**117**，versionName 5.5.28-v91→**5.5.28-v92**
- `gradlew assembleDebug`（日志 `_build_v92.log`，BUILD SUCCESSFUL）
- 归档 `手机版/zf-fengkong-v92.apk`（7,281,530 字节，源自 app-debug.apk 复制转正）

**校验（全部实测）**：
| 项 | 结果 |
|---|---|
| APK 内 `assets/web/index.html` 含本次修复 | ✅ `catch(_y)` 压底存在，`appendChild(_ttRow)` 共 6 处 |
| versionCode / versionName | 117 / 5.5.28-v92（aapt2 badging 确认） |
| 签名 SHA-256 | `52728...`，与 v87/v89/v90/v91 **同一把**，可覆盖升级，无需卸载 |

**遗留**：仍无真机接入，需用户手动安装 v92 验证。

---

## 2026-10-20 16:4x v93：峰控「⋯更多」菜单新增 充值Token + 退出登录

**源码改动**（上一对话 commit `2b4875da6`，MainActivity.kt +40 行）：
- 充值Token：`openRecharge()` 用系统浏览器 `ACTION_VIEW` 打开 `https://www.zf3d.com/airecharge.asp`
- 退出登录：`confirmLogout()` 二次确认 → `doLogout()` 清原生 Prefs.authToken + 切助手页 + 清 chatView localStorage(zf_agkey/zf_uid/zf_name) + reload，agKey 空自动停登录页（对话历史保留）

**打包**：
- `app/build.gradle.kts`：versionCode 117→**118**，versionName 5.5.28-v92→**5.5.28-v93**
- `gradlew assembleDebug`（BUILD SUCCESSFUL，compileDebugKotlin 重新执行 + packageDebug）
- 归档 `手机版/zf-fengkong-v93.apk`（7,281,530 字节，MD5 `e81aa34bb0cd33cee53962aab565cfe5`）

**进包实证**（Python 解 classes*.dex 对照 v92 旧包）：
| 标记 | v92 旧包 | v93 新包 |
|---|---|---|
| `airecharge.asp` URL | ❌ False | ✅ True |
| 「充值」中文菜单项 | ❌ False | ✅ True |
| 「退出登录」中文菜单项 | ❌ False | ✅ True |

| 项 | 结果 |
|---|---|
| versionCode / versionName | 118 / 5.5.28-v93（build.gradle.kts 源码即产物真源） |
| 签名 | debug.keystore 统一，与 v87~v92 同一把，117→118 可覆盖升级，无需卸载 |

**遗留**：需用户在手机安装 v93 验证「⋯更多」菜单两项功能。
