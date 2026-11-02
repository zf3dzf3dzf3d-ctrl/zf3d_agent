# MiniMax H3 报错修复包（复制粘贴两步搞定）

## 报错真相（不是模型问题，也不是马赛克问题）
你点运行后，"自定义采样器（高级）"节点报错，ComfyUI 日志里的真实异常是：

```
AttributeError: 'NoneType' object has no attribute '_comfy_cuda_graph_modules'
```

这是 ComfyUI 新版自带的 **CUDA Graph 加速器（aimdo malloc graph）** 的 bug：
在你的显卡/驱动上录制加速图失败返回了 None，代码没判空就直接用 → 采样第一步就崩。
**和模型文件无关，和你的提示词无关。**

## 修复方法（二选一，方法 A 最简单）

### 方法 A：启动时禁用有 bug 的加速器（推荐，10 秒）
1. 完全关闭 ComfyUI（那个黑色命令行窗口也关掉）
2. 用记事本打开 `D:\ComfyUI-H3\ComfyUI_windows_portable\启动ComfyUI.bat`
3. 把这一行：
   ```
   .\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --auto-launch
   ```
   改成（加一个参数）：
   ```
   .\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --auto-launch --disable-comfy-compiler
   ```
4. 保存，重新双击启动。再跑工作流。

> 如果没有 `启动ComfyUI.bat`，就改你平时双击的那个 bat（一键启动.bat 里也有同样的启动行，同样加参数）。

### 方法 B：改源码补丁（治本，改一个文件）
文件：`D:\ComfyUI-H3\ComfyUI_windows_portable\ComfyUI\comfy\model_prefetch.py`
用记事本打开，找到大约第 70-75 行：

```python
    graph = MALLOC_GRAPHS.get(thread_id)
    if graph is None:
        graph = comfy_aimdo.malloc_graph.record(
            comfy.model_management.current_stream(device), args.assert_graph_breaks
        )
        graph._comfy_cuda_graph_modules = weakref.WeakSet()
```

改成：

```python
    graph = MALLOC_GRAPHS.get(thread_id)
    if graph is None:
        graph = comfy_aimdo.malloc_graph.record(
            comfy.model_management.current_stream(device), args.assert_graph_breaks
        )
        if graph is None:
            import logging
            logging.warning("Comfy model compiler: malloc_graph.record() returned None, disabling for this run.")
            return
        graph._comfy_cuda_graph_modules = weakref.WeakSet()
```

保存后重启 ComfyUI。这样即使加速器录不上，也会自动回退到普通模式正常出片。

## 两个方法做哪个？
- 只想赶紧出片 → 方法 A
- 想保留加速功能、以后不用管 → 方法 B（也可以两个都做，A 优先级更高，会直接跳过加速器）

## 附注
- 我的进程对 D:\ComfyUI-H3 目录只有只读权限（实测 Users:RX、写入被拒），所以没法替你直接改，只能给你这份一键照抄的补丁。
- 模型文件此前已全部核对就位（主模型/双VAE/LoRA/文本编码器文件名与工作流一致），无需再下载任何东西。
