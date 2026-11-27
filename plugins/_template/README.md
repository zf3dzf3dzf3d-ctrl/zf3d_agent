# plugins/_template —— 插件脚手架

**用法**：整个目录复制为 `plugins/<分类>.<名称>/`，然后：

1. 改 `manifest.json`：`id`（=目录名）、`name`、`type`（tool/engine/gateway/ui/schedule/store/prompt/brain/infra/bundle/mode）、`capabilities`（按实际用到的生活面裁剪，少申请）、`provides`（对外提供的能力名，可空）、`depends`、`config`（有配置项才留）。
2. 改 `main.py`：按注释里的样例挑需要的面板打开（tool/route/ui/schedule/event/store）。
3. 自验四件套：启用探针 → disable→enable 拔测 → .zplug 导出导入往返 → 坏 manifest 不崩。
4. `python scripts/check_plugin_only.py` 过门禁 → 提交。

**本目录带 `_` 前缀**：内核扫描跳过、门禁豁免，永不注册。别在它上面直接开发。

ctx API 白名单与禁项见《策划案-一切皆插件-全量可插拔-终局策划案v4.md》§3.2。
