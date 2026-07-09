# Houdini 插件 — 安装说明

## 概述

此插件让 zf3d_Agent 智能体能够操作 SideFX Houdini，包括：
- 创建/删除/连接节点
- 设置节点参数
- 执行 VEX / Python 代码
- 查询网络结构和几何信息
- 截取 3D 视口截图
- 搜索节点类型
- 管理 NetworkBox 分组
- 撤销/重做

**完全隔离**：不修改智能体核心代码。删除插件文件即完全卸载。

## 文件结构

```
公共区/插件/
├── Houdini插件.py               ← 主插件文件（被插件加载器自动加载）
├── Houdini插件说明.md            ← 本说明文件
└── Houdini/                      ← 支持包（不被加载器扫描）
    ├── __init__.py               ← 包初始化
    ├── _bridge_client.py         ← TCP 套接字客户端
    ├── _data.py                  ← 静态数据（节点输入缓存+语义映射）
    └── bridge_server_for_houdini.py ← Bridge Server（安装到 Houdini）
```

## 安装步骤

### 第一步：安装 Bridge Server 到 Houdini

将 Bridge Server 安装到 Houdini，使其启动时自动运行 TCP 服务。

#### 方法 A：直接复制到 pythonrc.py（最简单）

1. 找到你的 Houdini 用户配置目录：
   ```
   C:\Users\<用户名>\Documents\houdini20.5\
   ```
   （20.5 对应你的 Houdini 版本）

2. 创建目录（如果不存在）：
   ```
   C:\Users\<用户名>\Documents\houdini20.5\scripts\python\
   ```

3. 将 `公共区/插件/Houdini/bridge_server_for_houdini.py` 的内容
   追加到 `pythonrc.py` 文件中（如果文件不存在则创建）

#### 方法 B：作为 Houdini Package 安装（推荐，更干净）

1. 创建目录：`C:\Users\<用户名>\Documents\houdini20.5\packages\`

2. 创建 JSON 文件 `zf3d_bridge.json`：
   ```json
   {
     "enable": true,
     "env": [
       {"HOUDINI_BRIDGE_PORT": "45172"}
     ],
     "path": "<项目根目录>/公共区/插件/Houdini"
   }
   ```

3. 将 `bridge_server_for_houdini.py` 复制到：
   ```
   C:\Users\<用户名>\Documents\houdini20.5\scripts\python\pythonrc.py
   ```

### 第二步：重启 Houdini

启动 Houdini。如果成功，Houdini 控制台会显示：
```
[Houdini Bridge] 监听 127.0.0.1:45172
```

### 第三步：在智能体中测试

在智能体对话中输入：
```
帮我检测 Houdini 连接
```

或直接说：
```
创建一个 box 节点
```

## 操作列表（10 个）

| 操作 | 命令 | 说明 |
|------|------|------|
| Houdini连接检测 | — | 检测 Bridge 连接，获取场景信息 |
| Houdini节点创建 | 创建节点/创建Wrangle/批量创建 | 创建各类 Houdini 节点 |
| Houdini节点修改 | 删除/连接/复制/设置显示/布局/保存 | 修改已有节点 |
| Houdini参数设置 | 设置/批量设置/按参数搜索 | 设置节点参数 |
| Houdini网络查询 | 网络结构/节点参数/子节点/选中节点/检查错误/几何信息 | 查询场景（只读） |
| Houdini执行代码 | Python/Shell | 在 Houdini 中执行代码 |
| Houdini视口截图 | — | 截取 3D 视口 |
| Houdini搜索节点 | 关键词/语义/输入端口 | 搜索节点类型 |
| Houdini撤销重做 | undo/redo | 撤销重做 |
| Houdini网络分组 | 创建/添加/列出 | 管理 NetworkBox |

## 使用示例

```
用户：检测 Houdini 连接
AI：[调用 Houdini连接检测] → Houdini 20.5.278 已连接

用户：创建一个 box，在上面散点 500 个
AI：[调用 Houdini节点创建(创建节点, 类型=box)]
    [调用 Houdini节点创建(创建节点, 类型=scatter)]
    [调用 Houdini参数设置(设置, 参数名=npts, 参数值=500)]
    [调用 Houdini节点修改(连接)]
    完成。

用户：给所有点加随机颜色
AI：[调用 Houdini节点创建(创建Wrangle, VEX代码="@Cd=rand(@ptnum);")]
    完成。

用户：截个图看看效果
AI：[调用 Houdini视口截图]
```

## Token 优化

插件操作不在任何操作分组中，因此**始终注入**到 AI 请求。
但由于只有 10 个操作（非 35 个），每次约增加 ~500 token。
不提 Houdini 时 AI 不会主动调用这些操作。

如果需要进一步优化，可以在 `操作注册中心.py` 的 `_操作分组` 中添加：
```python
"Houdini": {
    "操作": ["Houdini连接检测", "Houdini节点创建", ...],
    "关键词": ["houdini", "节点", "VEX", "建模", ...],
    "始终启用": False
}
```
这样不提 Houdini 时操作列表完全不注入。

## 端口配置

默认端口 `45172`。修改方式：

1. 设置环境变量 `HOUDINI_BRIDGE_PORT=端口号`
2. 或修改 `bridge_server_for_houdini.py` 和 `_bridge_client.py` 中的 `_DEFAULT_PORT`

## 安全

- Bridge Server 仅绑定 `127.0.0.1`，不接受外部连接
- Python 执行有危险模式黑名单（os.remove, shutil.rmtree 等）
- Shell 执行有危险命令黑名单（rm -rf, format, shutdown 等）
- 所有变更类操作自动包裹 undo 分组，可撤销

## 卸载

1. 删除 `公共区/插件/Houdini插件.py`
2. 删除 `公共区/插件/Houdini/` 目录
3. 从 Houdini 的 `pythonrc.py` 中删除 Bridge Server 代码
4. 重启智能体和 Houdini
