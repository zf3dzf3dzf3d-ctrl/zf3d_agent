// input.js — 输入系统 v1.0：键盘/鼠标统一事件 + 按键映射
"use strict";
class Input {
  constructor(target) {
    this.t = target || window;
    this.down = new Set();        // 当前按住的物理键 code
    this.pressed = new Set();     // 本帧刚按下
    this.released = new Set();    // 本帧刚松开
    this.map = new Map();         // 逻辑动作 -> [物理键 code]
    this.mouse = { x: 0, y: 0, buttons: new Set(), pressedBtns: new Set(), releasedBtns: new Set(), wheel: 0 };

    // 键盘事件绑到 window：canvas 等非聚焦元素收不到 keydown，
    // 且 iframe 内嵌时也保证按键可用；鼠标事件仍绑在目标元素上
    this.kt = window;
    this.kt.addEventListener("keydown", e => {
      if (e.repeat) return;
      this.down.add(e.code); this.pressed.add(e.code);
      if (["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code)) e.preventDefault();
    });
    this.kt.addEventListener("keyup", e => { this.down.delete(e.code); this.released.add(e.code); });
    this.kt.addEventListener("blur", () => { this.down.clear(); this.mouse.buttons.clear(); });

    const toLocal = e => {
      if (this.t === window) return [e.clientX, e.clientY];
      const r = this.t.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    this.t.addEventListener("mousemove", e => { [this.mouse.x, this.mouse.y] = toLocal(e); });
    this.t.addEventListener("mousedown", e => { this.mouse.buttons.add(e.button); this.mouse.pressedBtns.add(e.button); [this.mouse.x, this.mouse.y] = toLocal(e); });
    this.t.addEventListener("mouseup", e => { this.mouse.buttons.delete(e.button); this.mouse.releasedBtns.add(e.button); });
    this.t.addEventListener("wheel", e => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    this.t.addEventListener("contextmenu", e => e.preventDefault());
  }

  // 绑定动作：input.bind("jump", "Space");  input.bind("move_left", "KeyA","ArrowLeft")
  bind(action, ...codes) { this.map.set(action, codes); }

  isDown(actionOrCode) { return this._any(actionOrCode, this.down); }
  wasPressed(actionOrCode) { return this._any(actionOrCode, this.pressed); }
  wasReleased(actionOrCode) { return this._any(actionOrCode, this.released); }
  _any(k, set) {
    const codes = this.map.get(k) || [k];
    return codes.some(c => set.has(c));
  }
  mouseDown(btn = 0) { return this.mouse.buttons.has(btn); }
  mousePressed(btn = 0) { return this.mouse.pressedBtns.has(btn); }
  mouseReleased(btn = 0) { return this.mouse.releasedBtns.has(btn); }

  // 每帧末尾调用，清空单帧状态
  endFrame() {
    this.pressed.clear(); this.released.clear();
    this.mouse.pressedBtns.clear(); this.mouse.releasedBtns.clear(); this.mouse.wheel = 0;
  }
}
if (typeof module !== "undefined") module.exports = { Input };
