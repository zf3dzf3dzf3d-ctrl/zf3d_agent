# hermes_style

{desc}

- 模式：{mode}
- 生成：朱峰社区 new_engine.py 脚手架

## 改三处即可上线
1. engine.py 的 SYSTEM_PROMPT —— 智能体人格/规则
2. tools/ —— 工具集（local_loop 模式；preprocess 模式用朱峰全局工具）
3. engine.py 的 _chat_once() —— 换自己的模型调用（默认走朱峰网关）

改完保存即热加载，无需重启。
