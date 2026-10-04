// 流场寻路核心 v1.0（气体扩散式）
// 思路：从目标格子开始做 BFS，成本像气体一样向外扩散；
// 每个可通行格子记录"指向目标的最佳方向"。所有单位 O(1) 采样场向量即可移动，
// 1000+ 单位共享同一张场，无需逐个 A*。
"use strict";

class FlowField {
  constructor(cols, rows, cellSize) {
    this.cols = cols; this.rows = rows; this.cell = cellSize;
    this.w = cols * cellSize; this.h = rows * cellSize;
    const n = cols * rows;
    // 0 = 可通行, 1 = 障碍
    this.obstacle = new Uint8Array(n);
    // BFS 扩散成本（0 = 未到达/不可达，>=1 为距离目标的步数）
    this.cost = new Uint16Array(n);
    // 归一化方向场 (dx, dy)，障碍为 0
    this.dirX = new Float32Array(n);
    this.dirY = new Float32Array(n);
    this.lastBakeMs = 0;
    this.target = -1; // 目标格子索引
  }

  idx(cx, cy) { return cy * this.cols + cx; }
  inBounds(cx, cy) { return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows; }

  worldToCell(x, y) {
    return [Math.floor(x / this.cell), Math.floor(y / this.cell)];
  }

  setObstacle(cx, cy, on) {
    if (!this.inBounds(cx, cy)) return false;
    const i = this.idx(cx, cy);
    if (this.obstacle[i] === (on ? 1 : 0)) return false;
    // 目标格不允许放障碍
    if (on && i === this.target) return false;
    this.obstacle[i] = on ? 1 : 0;
    return true;
  }

  setTargetWorld(x, y) {
    const [cx, cy] = this.worldToCell(x, y);
    if (this.inBounds(cx, cy) && !this.obstacle[this.idx(cx, cy)]) {
      this.target = this.idx(cx, cy);
      return true;
    }
    return false;
  }

  // 从 target 做 BFS 扩散（4 邻域 + 对角修正），成本像气体从目标向外扩散
  bake() {
    const t0 = performance.now();
    const { cols, rows, obstacle, cost, dirX, dirY } = this;
    cost.fill(0);
    dirX.fill(0); dirY.fill(0);
    if (this.target < 0) { this.lastBakeMs = 0; return; }

    const queue = new Int32Array(cols * rows);
    let head = 0, tail = 0;
    cost[this.target] = 1;
    queue[tail++] = this.target;

    while (head < tail) {
      const cur = queue[head++];
      const cx = cur % cols, cy = (cur / cols) | 0;
      const c = cost[cur];
      // 4 邻域
      for (let d = 0; d < 4; d++) {
        const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = ny * cols + nx;
        if (obstacle[ni] || cost[ni]) continue;
        cost[ni] = c + 1;
        queue[tail++] = ni;
      }
    }

    // 方向场：每格指向成本更低的邻居（含对角），归一化
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx;
        if (obstacle[i] || cost[i] === 0) continue;
        let bx = 0, by = 0, best = cost[i];
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const nx = cx + ox, ny = cy + oy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const ni = ny * cols + nx;
            if (obstacle[ni] || cost[ni] === 0) continue;
            // 防止穿墙角：对角必须两正交邻域都可通行
            if (ox && oy && (obstacle[cy * cols + nx] || obstacle[ny * cols + cx])) continue;
            if (cost[ni] < best) { best = cost[ni]; bx = ox; by = oy; }
          }
        }
        if (bx || by) {
          const len = Math.hypot(bx, by);
          dirX[i] = bx / len; dirY[i] = by / len;
        }
      }
    }
    this.lastBakeMs = performance.now() - t0;
  }

  // 世界坐标 → 场方向（单位外的插值可选，这里最近格直读，够快）
  sample(x, y, out) {
    const [cx, cy] = this.worldToCell(x, y);
    if (!this.inBounds(cx, cy)) { out.x = 0; out.y = 0; return out; }
    const i = this.idx(cx, cy);
    out.x = this.dirX[i]; out.y = this.dirY[i];
    return out;
  }
}
