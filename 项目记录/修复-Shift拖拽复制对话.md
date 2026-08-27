# 修复-Shift拖拽复制对话（按下即生成版）

## 问题
原实现：Shift+左键拖拽复制对话需先松开鼠标才生成副本，且位置在原对话处，体验不符合预期。

## 需求（用户 4 点）
1. 按下（mousedown）时就生成对话副本
2. 副本直接出现在鼠标的位置，随后继续拖拽移动
3. 内容与渲染方式与原对话完全一致
4. 数据库单独保存一条与原对话一模一样的会话（仅对话 id 不同）

## 修改文件
- public/js/app-chatbox.js（自动备份 app-chatbox.js.bak）

## 核心改动
### 1. cloneChatBox(srcChat, pressX, pressY)（~237-412 行）
- 按下即在鼠标位置创建副本：createChatBox(pressX, pressY, srcModelId)（屏幕坐标→画布坐标，与新建对话同算法）
- 深拷贝：消息（role/content/type/ts/model_id 逐属性拷贝）、history、标题（不加"(副本)"后缀）、宽高、折叠状态、项目归属（DB.setNodeProject）、工具分类（Tools.chatCategories + 重建下拉菜单高亮）
- 渲染一致：分块（CHUNK=8）异步渲染，setMsgContent 同源渲染，final 类型套 ai-final 样式，跳过 typing/tool_call 临时类型，最后 _refreshUserMsgBtns
- DB 单独会话：新 id（nextBoxId）；DB.clearChatHistory 后逐条 DB.addChatMessage 按原始 ts 归档
- Store.addLog 记录 clone 日志；updateProjectView/updateStatus/updateMinimap 刷新

### 2. 拖拽事件绑定（~1159-1257 行）
- header mousedown：e.shiftKey 且 button===0 时立即 cloneChatBox(chat, e.clientX, e.clientY)，记录副本基准坐标 csl/cst，dragging=false（原对话不动），shiftCloneDone=true 防重复
- document mousemove：shiftCloneDone && cloneBox 时移动副本 cloneBox.style.left/top = csl/cst + delta/canvasScale（rAF 节流，缩放跟手），并 _updateAllNavArrows
- mouseup / window blur（stopBoxDrag）：持久化副本位置 cloneChat.x/y + Store.saveChatBox(cloneChat)，复位 shiftCloneDone/cloneChat/cloneBox

## 验证
- node --check public/js/app-chatbox.js → SYNTAX_OK
- 逐行确认：按下即建（1168-1196）、副本拖动（1206-1220）、mouseup 持久化（1234-1256）、DB 按 ts 归档（348-354）

## 使用方式
按住 Shift 在对话标题栏按下左键 → 副本立即出现在鼠标处 → 拖到目标位置松手。浏览器强刷（Ctrl+F5）生效。