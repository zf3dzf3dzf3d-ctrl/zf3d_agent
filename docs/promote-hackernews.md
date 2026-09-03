# Hacker News「Show HN」发布材料

## 发布地址
https://news.ycombinator.com/submit（需先登录，账号用你注册的 Medium 同款 zf3d 即可，HN 注册很宽松）

## 标题（title 栏，严格按格式：Show HN + 产品名 + 一句话）
```
Show HN: An AI Agent Workspace That Runs 400+ Conversations at Once, Pure Python Stdlib
```

## URL 栏
```
https://gitee.com/zf3d/zf3d_agent
```
（也可以填官网/在线演示地址，如果有；没有就填仓库，Show HN 允许直接填 GitHub/Gitee 仓库）

## 正文（可选，帖子里作为首条评论发，HN 没有正文框，提交后自己补第一条评论）
```
Hi HN, I'm the author.

I got frustrated with chat apps that force one conversation at a time, so I built a local-first agent workspace:

- Run 400+ concurrent AI conversations in tabs (I stress-tested it)
- Visual node canvas: spawn sub-agents as graph nodes, run them, feed results downstream
- Self-healing: failed tool calls get auto-retried and repaired mid-task
- Long-horizon planning: persistent multi-session plans an agent can hand off between chats
- Zero JS frameworks, zero Node modules, no bundler — backend is pure Python standard library, frontend is plain HTML/JS
- Runs on Windows/Linux, single process, all data local

The "no dependencies" part was deliberate: the whole HTTP server is http.server with a custom keep-alive fix (there was a nasty 501 bug caused by un-drained request bodies, writeup in the repo).

Happy to answer questions about the architecture or the concurrency model.
```

## 发布时机（重要，HN 流量就靠发布时间）
- **北京时间周二～周四晚上 21:00–23:00**（对应美东上午 9–11 点，HN 黄金时段）
- 周末和周五发效果差很多

## 发布后必做
1. 自己在评论区补充技术细节（HN 用户吃这套）
2. 诚实回答质疑（第一个小时内回复速度决定帖子生死）
3. **不要刷票**——HN 反作弊很严，新号拉票直接被 shadowban
4. 30 分钟内没动静正常，别急

## 备注
- HN 对营销文案极敏感：贴子被闻出"推广味"会被 dead，语气务必像工程师分享
- 之后可考虑 Lobsters（lobste.rs，需邀请码）、Product Hunt（需要产品有在线 demo 更好）
