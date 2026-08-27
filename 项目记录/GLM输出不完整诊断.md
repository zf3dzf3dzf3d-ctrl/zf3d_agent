# GLM 输出不完整诊断记录

## 用户问题
输出消息不完整，疑似 GLM 思考模式（reasoning_content）结果丢失。

## 完整链路
前端 app-agent.js → DB.proxy(fetch /api/proxy, res.json()) → 后端 handler_routes.py `_handle_proxy`(urllib 转发, 300s 超时) → 上游 AI

## 三处硬伤
1. **后端 SSE 聚合丢弃 reasoning_content**：handler_routes.py 107-163 行，SSE 流式响应只收集 `delta.content` 和 `tool_calls`，GLM 思考模式的 `delta.reasoning_content` 完全被丢弃。若 GLM 将答案放在 reasoning_content（content 为空），输出直接丢失。
2. **前端不检查 finish_reason**：app-agent.js 全文无 finish_reason 处理。若 finish_reason='length'（max_tokens 截断），静默返回不完整输出。
3. **payload 无默认 max_tokens**：app-agent.js 请求体构造（约788-830行）只合并 model.body，无 max_tokens 兜底。

## 后端关键代码位置（server/handler_routes.py）
- 46行: `_handle_proxy`
- 107-163行: SSE 聚合逻辑（修复点1：加 reasoning_content 收集+空content回退）
- 160行: finish_reason 已收集并返回给前端

## 前端关键代码位置（public/js/app-agent.js）
- 770-830行: payload 构造（修复点3：加默认 max_tokens）
- 1050-1325行: 响应处理（修复点2：finish_reason 检查+截断提示）
- stream: true 仅当有 tool 消息时设置

## 修复方案
1. 后端：SSE 聚合时收集 reasoning_content；message 里透传 reasoning_content；若 content 为空且 reasoning 有值，用 reasoning_content 作 content 兜底。
2. 前端：响应处理中检查 finish_reason==='length' 时输出警告并提示继续；显示 reasoning_content（若有）。
3. 前端：payload 加默认 max_tokens（若 model.body 未指定）。
