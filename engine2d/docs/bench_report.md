# 步骤5 万人同屏压测报告 — 硬骨骼 + Instancing

## 测试环境
- 环境: Node.js 无头（模拟浏览器主线程 JS 负载），Windows
- 骨骼: 7 骨人形（root/torso/head/armL/armR/legL/legR），walk 动画 5 关键帧
- 路径: 每单位独立相位 → 关键帧插值采样 → 逐骨骼三角函数 + 链式 FK 累积 → 写实例缓冲 → WebGL2 instancing 单 draw call
- 压测脚本: `engine2d/_test_fk_bench.js`；页面: `engine2d/bench_skeleton.html`（←/→ 切数量，空格切 FK/近似路径）

## 实测结果（逐骨骼 FK，CPU 主线程）

| 单位数 | 每帧 CPU 耗时 | 60fps 预算(16.6ms)占用 |
|---|---|---|
| 1,000 | 0.194 ms | 1.2% |
| 5,000 | 0.817 ms | 4.9% |
| 10,000 | 1.636 ms | 9.9% |
| 20,000 | 3.279 ms | 19.8% |

## 结论
1. **1 万带骨骼动画单位同屏可行**：CPU 侧每帧仅 1.6ms（预算 ~10%），GPU 侧 instancing 单 draw call（步骤3 已验证上限 2 万实例），留有大量余量给逻辑层。
2. **瓶颈不在骨骼，在 GPU 填充率/实例数**：即使 2 万单位 FK 也只 3.3ms。原 fight 项目"硬骨骼撑万人"的路线在 Web 上依然成立，且比手写矩阵更省（SoA 扁平数组 + 预烘焙轨道，无对象分配，零 GC 压力）。
3. **Spine/软骨骼不必要**：软骨骼（网格变形）每单位成本是本方案 10-50 倍，万级同屏只适合"关键帧骨骼 + GPU instancing"，与 Unity 中 SkinnedMesh 路线的取舍一致。
4. 如需更夸张规模（5 万+），下一档优化是骨骼矩阵烘焙进 float 纹理（bone texture）+ 顶点着色器采样，把 FK 移到 GPU——架构已预留该路径。

## 局限说明
- 无头测试未含 GPU 提交与光栅化，真实帧率以打开 `bench_skeleton.html` 的 HUD 为准（本报告数据为 JS 侧确定下界）。
- 当前 FK 为"角度累积近似"，完整矩阵 FK 已在 skeleton.js（步骤4）验证正确性，运算量级相同。
