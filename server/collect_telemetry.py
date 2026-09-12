# -*- coding: utf-8 -*-
"""
玩法数据采集（步骤5）
用法: python collect_telemetry.py <游戏名> [局数=1] [每局秒数=20]
无头浏览器自动玩（持续射击 + 正弦左右移动），每局结束把 Telemetry 快照
落盘到 server/data/telemetry/<游戏>/<时间戳>.json
"""
import os, sys, json, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "server", "data", "telemetry")

SNAP = """() => {
  try {
    if (!window.Telemetry) return null;
    const t = Telemetry.data;
    if (!t || !t.start) return null;
    return Object.assign({}, t, {duration_sec: +((Date.now() - t.start)/1000).toFixed(1)});
  } catch(e) { return {error: String(e)}; }
}"""

def play_round(pw, name, secs):
    url = f"http://127.0.0.1:8505/engine2d/games/{name}/index.html"
    errs = []
    b = pw.chromium.launch(headless=True)
    page = b.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(url, wait_until="load", timeout=15000)
    page.wait_for_timeout(800)
    page.evaluate("() => window.dispatchEvent(new KeyboardEvent('keydown',{code:'Enter',key:'Enter',bubbles:true}))")
    page.wait_for_timeout(300)
    page.keyboard.down("Space")
    # 智能自动玩家: 每 120ms 朝最近敌人的 x 移动（跟踪瞄准）
    page.evaluate("""() => {
      const move = (code, down) => window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code,key:code,bubbles:true}));
      window._aiTimer = setInterval(() => {
        move('ArrowLeft', false); move('ArrowRight', false);
        let best = null, bd = 1e9;
        for (const e of em.list) if (e instanceof Enemy && !e.dead) {
          const d = Math.abs(e.x - player.x);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) { if (best.x < player.x - 8) move('ArrowLeft', true); else if (best.x > player.x + 8) move('ArrowRight', true); }
      }, 120);
    }""")
    end = time.time() + secs
    while time.time() < end:
        page.wait_for_timeout(500)
    page.evaluate("() => clearInterval(window._aiTimer)")
    page.keyboard.up("Space")
    data = page.evaluate("""() => {
      try {
        if (typeof Telemetry === 'undefined') return {error: 'no Telemetry'};
        const t = Telemetry.data;
        if (!t) return {error: 'no data'};
        return {score: t.score, max_progress: t.max_progress, status: t.status || null,
                duration_sec: +((Date.now() - t.start)/1000).toFixed(1), events: t.events};
      } catch(e) { return {error: String(e)}; }
    }""")
    over = page.evaluate("() => (typeof state!=='undefined') ? state : null")
    b.close()
    return {"telemetry": data, "final_state": over, "js_errors": errs}

def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "space-shooter"
    rounds = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    secs = int(sys.argv[3]) if len(sys.argv) > 3 else 20
    from playwright.sync_api import sync_playwright
    res = []
    with sync_playwright() as p:
        for i in range(rounds):
            r = play_round(p, name, secs)
            r["round"] = i + 1
            res.append(r)
            t = r["telemetry"] or {}
            print(f"round {i+1}: score={t.get('score')} wave={t.get('max_progress')} dur={t.get('duration_sec')}s events={len(t.get('events') or [])} errors={len(r['js_errors'])}")
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    fn = os.path.join(d, time.strftime("%Y%m%d_%H%M%S") + ".json")
    with open(fn, "w", encoding="utf-8") as f:
        json.dump({"game": name, "collected": time.strftime("%Y-%m-%d %H:%M:%S"), "rounds": res}, f, ensure_ascii=False, indent=2)
    print("saved:", fn)

if __name__ == "__main__":
    main()

