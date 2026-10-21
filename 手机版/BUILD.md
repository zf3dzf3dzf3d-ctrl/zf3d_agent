# mobile-app 构建说明

## 前置条件
- 安装 JDK 17（`java -version` 可用）
- 无需本机安装 Gradle：gradlew 三件套已就位
  （gradlew / gradlew.bat / gradle/wrapper/gradle-wrapper.jar + gradle-wrapper.properties 8.7）
  - 注：wrapper jar 为官方 GitHub 下载版 + 手写脚本，非 `gradle wrapper` 生成，功能等价

## 构建
```bat
gradlew.bat assembleDebug
```
产物：`app/build/outputs/apk/debug/app-debug.apk`

## 历史包归档
历史 APK 均在 `_archive/`，最新包见 mobile-app 根目录 `zf-fengkong-v*.apk`。
