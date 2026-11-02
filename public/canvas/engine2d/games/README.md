# 三款小游戏使用说明（engine2d 引擎能力验证）

三款可玩游戏均基于 engine2d 自研引擎（core/input/audio/games/common.js），浏览器即开即玩，无需任何插件。

## 打开方式
1. 引擎主页入口：`/engine2d/index.html` → 底部「🎮 可玩游戏」三个链接
2. 直接访问（服务端口以实际运行为准，如 8512）：
   - 超级玛丽（平台跳跃）：`/engine2d/games/super-mario/index.html`
   - 魂斗罗（双人横版射击）：`/engine2d/games/contra/index.html`
   - 沙罗曼蛇（纵版飞行射击）：`/engine2d/games/salamander/index.html`
3. 无限画布：游戏引擎节点 iframe 填上述路径即可嵌入。

## 玩法
| 游戏 | 操作 | 内容 |
|------|------|------|
| 超级玛丽 | ←→/AD 移动，空格/W/↑ 跳 | 踩敌人、吃金币、旗杆通关 |
| 魂斗罗 | 双人：P1 WASD+J 射击，P2 方向键+L 射击 | 横版滚动关卡、敌人 |
| 沙罗曼蛇 | 方向键/WASD 移动，自动/按键射击 | 敌机波次、Boss |

## 目录结构
- `engine2d/games/<游戏名>/index.html` — 入口页（引 engine2d 模块 + 本游戏 game.js）
- `engine2d/games/<游戏名>/game.js` — 游戏逻辑
- `engine2d/games/common.js` — 三游戏共用基础模块

## 验收记录（2026-09-06）
- 三游戏 game.js `node --check` 语法全部通过；
- 三游戏入口页浏览器实测（8512 端口）：canvas 正常、Input 模块加载、页面标题正确、无控制台报错；
- 引擎主页 index.html 含三个游戏入口链接。
