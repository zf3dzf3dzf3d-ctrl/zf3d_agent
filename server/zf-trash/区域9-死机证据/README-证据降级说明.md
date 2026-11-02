# 区域9 死机证据档（2026-10-30 固定）

## 事件
2026-10-30 ComfyUI 内存泄漏导致整机 77GB 内存耗尽死机（实锤，详见「10/30死机调查记录」）。

## 证据链说明（⚠️ 证据降级声明）
- 原始 comfyui.log / prev2.log 已被 ComfyUI 滚动日志机制清理，2026-10-31 全盘检索（dir /s /b *comfyui*.log）零命中，无法找回。
- 本档以调查黑板记录 + 截获的日志字节数作为降级证据链：
  - comfyui.log 截获时字节数：216,724 B
  - prev2.log 截获时字节数：85,856 B
- 教训固化：ComfyUI 滚动日志会丢失死机证据 → 探针(T2)上线后改为外置日志（本目录 comfy_probe.log），不再依赖 ComfyUI 本体日志。

## 影子模式声明
探针 server/zf_comfy_probe.py 当前为影子模式（AUTO_RESTART=False，只报警不重启）。
任何重启动作需用户明确授权后才能开开关。

## 日志
- comfy_probe.log：探针每 10 分钟心跳/内存读数
- comfy_probe_state.json：最近一次 WARN/CRIT 状态快照
