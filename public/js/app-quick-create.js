
/* 自研对话框 shim 已抽取至公共 zf-dialog-shim.js（S4 去重 2026-11-22），本文件不再重复注入 */

// ========== app-quick-create.js - Tab/双击 快速创建条 =========
// 【重构 2026-11-23 第2轮】照抄对话框底部输入壳的极简形态（用户参考图）：
// 一个输入框独占首行 + 下面一排按钮（＋上传图片/文件夹菜单 / 🎤语音 …… 右下角 模型选择器 + 发送）。
// 【用户令 2026-11-23】① 不再单设 📁 图标：文件夹路径走「＋」菜单，直接附带上次使用的路径
//（全局记忆 UserSettings.lastFolderPath，首次无记录时选一次并记住）。
// ② 模型选择不重复造轮子：直接复用对话框同款 _initModelPicker（挂桩 chat 对象，
//    默认模型跟随上一个对话的选择，点开可调 模型线路/模型ID/思考强度，习惯记忆全继承）。
// 发送后：用所选模型走 App.createChatBox + sendToModel 全套原有流程，然后自动聚焦新对话输入框。
// 呼出通道：Tab / 画布空白右键（非总览态）/ 总览(缩小整理)态左键双击空白。总览态右键=批量问题面板（zf-organize-batch-entry.js 接管）。
(function () {
  'use strict';

  let bar = null;           // 快速创建条 DOM
  let overlay = null;       // 聚焦遮罩
  let inputEl = null;       // 输入框
  let sending = false;      // 防重复提交
  let pendingImgs = [];     // 待发送图片 [{ dataUrl, name }]
  let pendingTexts = [];    // 待附加附件文本（文件夹路径等）
  let mpChat = null;        // 桩对话对象：模型选择器状态容器（复用对话框 _initModelPicker）

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c];
    });
  }
  // 上一个对话使用的模型（默认选中项）
  // 优先级：用户习惯（持久化保存的上次选择）> 上一个对话的模型
  function getLastUsedModelId() {
    try {
      if (window.UserSettings && UserSettings.get) {
        var h = UserSettings.get('lastModelSelection', null);
        if (h && h.modelId) return String(h.modelId);
      }
      var App = window.App;
      var boxes = App && App.chatBoxes;
      if (boxes && boxes.length) {
        var b = boxes[boxes.length - 1];
        if (b && b.modelId) return String(b.modelId);
      }
    } catch (e) {}
    return '';
  }

  // ---------- 样式注入 ----------
  function injectStyles() {
    if (document.getElementById('qcStyles')) return;
    const st = document.createElement('style');
    st.id = 'qcStyles';
    st.textContent = `
/* ---------- 遮罩：让整个画面只聚焦这一个输入框 ---------- */
#qcOverlay {
  position: fixed; inset: 0; z-index: 99999; display: none;
  /* 半透明遮罩：轻微压暗四周，聚焦输入框；不用 blur（避免大画布重绘卡顿），透明度够低不影响透视画布 */
  background: rgba(8, 10, 16, .35);
}
#qcOverlay.open { display: block; }

#qcQuickBar {
  position: fixed; left: 50%; top: calc(34% + 50px); transform: translate(-50%, -50%);
  z-index: 100000; display: none; flex-direction: column; gap: 0;
  /* 【收敛 2026-11-23 第4轮】面板本体退化为纯定位容器：透明无边框无投影，全场只留输入壳一个框 */
  background: transparent; border: none; box-shadow: none;
  border-radius: 18px; padding: 0;
  width: min(620px, calc(100vw - 48px));
}
#qcQuickBar.open { display:flex; }

/* ---------- 输入外壳：全场唯一的框——包住 3 行输入区 + 底部图标排，无边框，靠渐变底+深投影显形 ---------- */
#qcQuickBar .qc-inputwrap {
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(30, 32, 44, .85), rgba(15, 16, 24, .78));
  backdrop-filter: blur(18px) saturate(1.25); -webkit-backdrop-filter: blur(18px) saturate(1.25);
  border: none;
  box-shadow:
    0 10px 28px rgba(0,0,0,.45),
    0 26px 68px rgba(0,0,0,.40);
  padding: 2px 10px 6px;
  display: flex; flex-direction: column;
}
/* 聚焦不加描边框：只把投影略微加深 */
#qcQuickBar .qc-inputwrap:focus-within {
  box-shadow:
    0 10px 30px rgba(0,0,0,.50),
    0 26px 72px rgba(0,0,0,.44);
}

/* ---------- 输入框：独占首行，默认 3 行高；去一切框感（防全局皮肤给 textarea 加底/框） ---------- */
#qcQuickBar .qc-input {
  display: block; width: 100%; box-sizing: border-box;
  border: none !important; outline: none !important; background: transparent !important; box-shadow: none !important;
  font-size: 15px; color: #fff; padding: 10px 6px 6px; letter-spacing: .2px;
  font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  text-shadow: 0 1px 2px rgba(0,0,0,.3);
  resize: none; overflow-y: auto; min-height: 76px; max-height: 200px; line-height: 1.5;
}
#qcQuickBar .qc-input::placeholder { color: rgba(255,255,255,.35); }

/* ---------- 按钮排：＋ 🎤 📁 ……（右下角）模型名▾ 发送 ---------- */
#qcQuickBar .qc-btnrow {
  display: flex; align-items: center; gap: 2px;
}
#qcQuickBar .qc-btnrow .qc-spacer { flex: 1; }

#qcQuickBar .qc-icon-btn {
  flex-shrink: 0; cursor: pointer; padding: 5px;
  background: transparent !important; border: none !important; box-shadow: none !important; color: rgba(255,255,255,.62);
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 8px;
  transition: color .15s, background .15s;
}
#qcQuickBar .qc-icon-btn:hover { color: #fff; background: transparent !important; }
#qcQuickBar .qc-icon-btn svg { width: 17px; height: 17px; pointer-events: none; }

/* ---------- 模型选择器：复用对话框同款 _initModelPicker（.model-picker-wrap/btn/menu 全局样式直接生效），
   这里只做外观融入：透明底融入按钮排，与对话框底部同待遇 ---------- */
#qcQuickBar .model-picker-wrap {
  margin-left: auto;                 /* 模型靠右，发送紧随其后（与对话框底部同布局） */
  position: relative; max-width: 60%;
}
#qcQuickBar .model-picker-btn {
  background: transparent !important; border: none !important; box-shadow: none !important;
  color: rgba(255,255,255,.72); font-size: 12px;
  padding: 5px 8px; border-radius: 8px; max-width: 220px;
  gap: 3px;
  transition: background-color .15s, color .15s;
}
#qcQuickBar .model-picker-btn:hover { background: transparent !important; color: #fff; }
#qcQuickBar .model-picker-name { font-size: 12px; }
#qcQuickBar .model-picker-arrow { font-size: 10px; opacity: .7; }
/* 浮层挂到 body 时（mp-floating）层级必须压过创建条本体（z 100000） */
.model-picker-menu.mp-floating { z-index: 100002; }

/* ---------- 发送：对话框同款「小茶壶(神灯)」图标，第5轮去底色——与其余图标一致裸显，仅悬停淡底 ---------- */
#qcQuickBar .qc-send {
  flex-shrink: 0; border: none !important; cursor: pointer; margin-left: 4px;
  width: 28px; height: 28px; border-radius: 8px;
  background: transparent !important;
  color: rgba(255,255,255,.62) !important; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  box-shadow: none !important;
  transition: color .15s, background .15s, transform .15s;
}
#qcQuickBar .qc-send svg { pointer-events: none; }
#qcQuickBar .qc-send:hover { color: #fff !important; background: transparent !important; box-shadow: none !important; }
#qcQuickBar .qc-send:active { transform: scale(.97); }
#qcQuickBar .qc-send:disabled { opacity: .5; cursor: default; }
/* 神灯火焰/烟雾粒子动画（缺级时静置不破型） */
#qcQuickBar .qc-send .a-flame { animation: qcFlame 1.6s ease-in-out infinite; transform-origin: 8px 10px; }
#qcQuickBar .qc-send .a-smoke { animation: qcSmoke 2.4s ease-in infinite; }
@keyframes qcFlame {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: .75; transform: scale(1.12) translateY(-.4px); }
}
@keyframes qcSmoke {
  0% { opacity: 0; transform: translateY(1px); }
  30% { opacity: .7; }
  100% { opacity: 0; transform: translateY(-2.5px); }
}

/* ---------- 下拉修正：模型线路的自绘下拉（mp-custom-drop）必须压过创建条本体 ---------- */
/* 创建条 z=100000、选择器浮层 mp-floating z=100001；drop 原默认 99999 会被创建条盖住 */
.mp-custom-drop { z-index: 100003 !important; }

/* ---------- 语音录音中：红色脉动 ---------- */
#qcQuickBar .voice-btn--rec { color: #ff6b6b !important; animation: qcVoicePulse 1.2s ease-in-out infinite; }
@keyframes qcVoicePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .45; }
}

/* ---------- ＋弹出菜单：上传图片 / 上传文件夹（上次路径直用） ---------- */
.qc-plus-menu {
  position: fixed; z-index: 100001; min-width: 190px;
  background: rgba(30,30,46,.85); border: none; /* 毛玻璃透明化，呼应主框风格 */
  backdrop-filter: blur(14px) saturate(1.2); -webkit-backdrop-filter: blur(14px) saturate(1.2);
  border-radius: 12px; padding: 6px; box-shadow: 0 12px 40px rgba(0,0,0,.5);
  opacity: 0; transform: translateY(6px); transition: opacity .15s, transform .15s;
  pointer-events: none;
}
.qc-plus-menu.show { opacity: 1; transform: translateY(0); pointer-events: auto; }
.qc-plus-menu .qc-menu-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  border: none; background: transparent; color: #ddd; cursor: pointer;
  font-size: 13px; padding: 8px 10px; border-radius: 8px; text-align: left;
}
.qc-plus-menu .qc-menu-item:hover { background: rgba(255,255,255,.1); color: #fff; }
.qc-plus-menu .qc-menu-item .qc-menu-sub { font-size: 10px; color: rgba(255,255,255,.4); margin-left: auto; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---------- 待发送附件条（输入框与按钮排之间） ---------- */
#qcQuickBar .qc-attach-bar {
  display: none; flex-wrap: wrap; gap: 6px; align-items: center;
  padding: 2px 6px 4px;
}
#qcQuickBar .qc-attach-bar.has-items { display: flex; }
#qcQuickBar .qc-attach-item {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 8px; border: 1px solid rgba(255,255,255,.16); border-radius: 10px;
  background: rgba(255,255,255,.07); font-size: 11px; color: #ddd; max-width: 220px;
}
#qcQuickBar .qc-attach-item img { width: 20px; height: 20px; object-fit: cover; border-radius: 3px; }
#qcQuickBar .qc-attach-item .qc-attach-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 56px; font-size: 10px; }
#qcQuickBar .qc-attach-del {
  border: none; background: none; color: rgba(255,255,255,.55); cursor: pointer;
  font-size: 13px; padding: 0 2px; line-height: 1;
}
#qcQuickBar .qc-attach-del:hover { color: #ff6b6b; }

/* ---------- 主题适配（2026-11-23 第7轮）：纸白/亮主题联动——白纸壳墨字，与大师纸白一致 ---------- */
/* 壳：白纸渐变 + 淡墨投影（深投影换墨色，亮底上黑影才显形） */
[data-theme="light"] #qcQuickBar .qc-inputwrap,
[data-theme="paper"] #qcQuickBar .qc-inputwrap {
  background: linear-gradient(180deg, rgba(255,255,255,.94), rgba(246,245,240,.90));
  box-shadow:
    0 10px 28px rgba(38,36,31,.18),
    0 26px 68px rgba(38,36,31,.14);
}
[data-theme="light"] #qcQuickBar .qc-inputwrap:focus-within,
[data-theme="paper"] #qcQuickBar .qc-inputwrap:focus-within {
  box-shadow:
    0 10px 30px rgba(38,36,31,.22),
    0 26px 72px rgba(38,36,31,.16);
}
/* 文字/图标：墨色（base 的 !important 底色护甲只管 background，色字用同权重+更高特异度覆盖） */
[data-theme="light"] #qcQuickBar .qc-input,
[data-theme="paper"] #qcQuickBar .qc-input {
  color: #26241f !important; text-shadow: none !important;
}
[data-theme="light"] #qcQuickBar .qc-input::placeholder,
[data-theme="paper"] #qcQuickBar .qc-input::placeholder { color: rgba(38,36,31,.38); }
[data-theme="light"] #qcQuickBar .qc-icon-btn,
[data-theme="paper"] #qcQuickBar .qc-icon-btn,
[data-theme="light"] #qcQuickBar .model-picker-btn,
[data-theme="paper"] #qcQuickBar .model-picker-btn,
[data-theme="light"] #qcQuickBar .qc-send,
[data-theme="paper"] #qcQuickBar .qc-send { color: rgba(38,36,31,.62) !important; }
[data-theme="light"] #qcQuickBar .qc-icon-btn:hover,
[data-theme="paper"] #qcQuickBar .qc-icon-btn:hover,
[data-theme="light"] #qcQuickBar .model-picker-btn:hover,
[data-theme="paper"] #qcQuickBar .model-picker-btn:hover,
[data-theme="light"] #qcQuickBar .qc-send:hover,
[data-theme="paper"] #qcQuickBar .qc-send:hover { color: #26241f !important; }
/* 附件卡：墨描边淡墨底 */
[data-theme="light"] #qcQuickBar .qc-attach-item,
[data-theme="paper"] #qcQuickBar .qc-attach-item {
  border-color: rgba(38,36,31,.18); background: rgba(38,36,31,.05); color: #26241f;
}
[data-theme="light"] #qcQuickBar .qc-attach-del,
[data-theme="paper"] #qcQuickBar .qc-attach-del { color: rgba(38,36,31,.55); }
/* ＋弹出菜单：白纸底墨字 */
[data-theme="light"] .qc-plus-menu,
[data-theme="paper"] .qc-plus-menu {
  background: rgba(252,251,248,.96); box-shadow: 0 12px 40px rgba(38,36,31,.25);
}
[data-theme="light"] .qc-plus-menu .qc-menu-item,
[data-theme="paper"] .qc-plus-menu .qc-menu-item { color: #26241f; }
[data-theme="light"] .qc-plus-menu .qc-menu-item:hover,
[data-theme="paper"] .qc-plus-menu .qc-menu-item:hover { background: rgba(38,36,31,.08); color: #111; }
[data-theme="light"] .qc-plus-menu .qc-menu-item .qc-menu-sub,
[data-theme="paper"] .qc-plus-menu .qc-menu-item .qc-menu-sub { color: rgba(38,36,31,.4); }
    `;
    document.head.appendChild(st);
  }

  // ---------- 构建 UI ----------
  function build() {
    if (bar) return;
    injectStyles();
    overlay = document.createElement('div');
    overlay.id = 'qcOverlay';
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', hide);
    bar = document.createElement('div');
    bar.id = 'qcQuickBar';

    // 【重构 2026-11-23 第3轮】照抄对话框底部输入壳布局：上=输入框独占首行（默认3行高），下=图标排包在壳内
    // ＋上传菜单 / 🎤语音 ……（spacer）…… 模型选择器(对话框同款) 发送(对话框同款小茶壶·神灯)
    // 【用户令 2026-11-23】① 不设 📁 图标：文件夹路径收进 ＋ 菜单，直接用上次路径
    // ② 模型选择器直接复用对话框 _initModelPicker（同款 DOM 结构 + 桩 chat）
    // 隐藏 .chatbox-body：模型选择器切换线路/ID/强度时会 addMsg 系统提示，这里作为静默接收槽
    bar.innerHTML =
      '<div class="chatbox-body" hidden style="display:none"></div>' +
      '<div class="qc-inputwrap">' +
        '<textarea class="qc-input" rows="3" placeholder="输入内容，可直接粘贴图片 / 文字…"></textarea>' +
        '<div class="qc-attach-bar"></div>' +
        '<div class="qc-btnrow">' +
          '<button class="qc-icon-btn qc-plus" type="button" title="上传图片 / 附带上次文件夹路径"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>' +
          '<button class="qc-icon-btn voice-btn qc-voice" type="button" title="语音输入"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="16" height="16"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg></button>' +
          '<span class="qc-spacer"></span>' +
          '<div class="model-picker-wrap">' +
            '<button class="model-picker-btn" title="点击选择模型 / 模型ID / 思考强度（与对话框同款）"><span class="model-picker-name">未选择模型</span><span class="model-picker-arrow">▾</span></button>' +
            '<div class="model-picker-menu mp-horizontal" hidden>' +
              '<div class="mp-cats"></div>' +
              '<div class="mp-row">' +
                '<select class="mp-line-select" title="选择大模型"></select>' +
                '<select class="mp-modelid-input" title="选择模型 ID"></select>' +
                '<select class="mp-re-input" title="思考强度（reasoning_effort）"></select>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<button class="qc-send" type="button" title="发送"><svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M4.6 13.8c0-2.9 3.1-4.7 7.4-4.7 2.1 0 4 .5 5.4 1.3.9-.6 1.7-1.5 2.1-2.5.15-.4.75-.35.85.05.35 1.5-.1 3.2-1.2 4.4.3.5.45 1 .45 1.5 0 2.6-3.2 4.3-7.6 4.3s-7.4-1.7-7.4-4.3z"/><path d="M12 7.4c.5-1.2 1.7-2 3-2h1.2c.4 0 .4.6 0 .6H15c-1 0-2 .7-2.3 1.7l-.7-.3z"/><path d="M4.2 12.2c-1.3.3-2.2 1.2-2.2 2.3 0 1.1.9 2 2.2 2.3l.4-.9c-.9-.2-1.5-.8-1.5-1.4s.6-1.2 1.5-1.4l-.4-.9z"/><circle cx="12" cy="8" r="1.3"/><g class="aladdin-fx"><path class="a-flame" d="M4.6 11.2c-1.1-1-1.2-2.6-.2-4 .2 1 .8 1.5 1.6 1.4-.5-1.4.1-2.6 1.3-3.3-.4 1.2.1 1.9.9 2.6.8.7 1.2 1.7.8 2.8-.5 1.3-1.5 1.9-2.7 1.9-.7 0-1.3-.5-1.7-1.4z"/><circle class="a-smoke" cx="6.5" cy="6" r="1.1"/><circle class="a-smoke" cx="8" cy="4.6" r=".9" style="animation-delay:.15s"/><circle class="a-smoke" cx="4.8" cy="4.4" r=".8" style="animation-delay:.3s"/></g></svg></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bar);
    inputEl = bar.querySelector('.qc-input');
    const sendBtn = bar.querySelector('.qc-send');
    const plusBtn = bar.querySelector('.qc-plus');

    ensureModelPicker();

    sendBtn.addEventListener('click', submit);
    plusBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePlusMenu(plusBtn);
    });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); hide(); }
    });
    // 【2026-11-28】粘贴图片 -> 产生浮动附件卡片（复用 pickQuickImages 的入列逻辑）
    inputEl.addEventListener('paste', function (e) {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      let hasImg = false;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === 'file' && /^image\//.test(it.type || '')) {
          hasImg = true;
          const f = it.getAsFile();
          if (!f) continue;
          const MAX_IMAGES = 4, MAX_BYTES = 8 * 1024 * 1024;
          if (pendingImgs.length >= MAX_IMAGES) { toastQuick('⚠️ 最多附带 ' + MAX_IMAGES + ' 张图片'); break; }
          if (f.size > MAX_BYTES) { toastQuick('❌ 图片过大（>8MB）: ' + (f.name || '粘贴图片')); continue; }
          const fr = new FileReader();
          fr.onload = function () {
            if (typeof fr.result === 'string' && fr.result.indexOf('data:image/') === 0) {
              pendingImgs.push({ dataUrl: fr.result, name: f.name || ('粘贴图片' + Date.now() + '.png') });
              renderAttachBar();
            }
          };
          fr.readAsDataURL(f);
        }
      }
      if (hasImg) e.preventDefault(); // 图片走附件卡片，不往输入框塞乱码
    });
    // 自动长高：随内容增加最多 200px，超出滚动（默认 3 行高，与对话框一致）
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
    });
    // 阻止面板内按键冒泡，避免触发画布快捷键
    ['keydown', 'keyup', 'keypress'].forEach(t =>
      bar.addEventListener(t, e => e.stopPropagation()));
    // mousedown/click 不再全局拦截：语音按钮依赖 document 级委托（voice-input.js），
    // 只拦截非语音按钮区域的点击冒泡
    bar.addEventListener('mousedown', e => {
      if (!e.target.closest('.voice-btn')) e.stopPropagation();
    });
    bar.addEventListener('click', e => {
      if (!e.target.closest('.voice-btn')) e.stopPropagation();
    });
  }

  // ---------- 模型选择器：复用对话框同款 _initModelPicker（不重复造轮子） ----------
  // 桩对话 mpChat 只是选择器的状态容器（modelId / _modelIdOverride / _reasoningEffort / 分类记忆），
  // 打/关菜单、渲染三列下拉、分层记忆、习惯保存全部由对话框同款代码完成。
  // _closed=true：Store.saveChatBox 的关闭守卫会拦截一切落库，桩状态绝不污染持久层。
  function ensureModelPicker() {
    if (!bar || mpChat) return;
    const App = window.App;
    if (!App || typeof App._initModelPicker !== 'function') return; // App 未就绪：show() 时会重试
    mpChat = {
      id: '',                          // addLog 的 boxId 留空，日志面板永不显示
      _closed: true,                   // 关键：saveChatBox 守卫直接拒绝，桩不落库
      el: bar,
      modelId: '',
      _modelIdOverride: '',
      _reasoningEffort: '',
      _mpCategory: 'language',
      _mpCatModels: {}
    };
    try { App._initModelPicker(bar, mpChat); } catch (e) { console.warn('[QuickCreate] 模型选择器初始化失败', e); }
  }

  // 每次打开：默认模型跟随上一个对话的选择（习惯 > 最近对话），并回填该线路记住的模型ID/思考强度
  function syncModelFromLastDialog() {
    ensureModelPicker();
    if (!mpChat) return;
    try {
      var last = getLastUsedModelId();
      if (window.Models && Models.get && last && !Models.get(last)) last = ''; // 已下架线路作废
      mpChat.modelId = last;
      mpChat._mpCategory = 'language';
      // 与对话框 _initModelPicker.memRestore 同源：回填该线路记住的模型ID/思考强度
      if (last && window.UserSettings && UserSettings.get) {
        var mem = UserSettings.get('modelSelectionMemory', null) || {};
        var rec = (mem['language'] && mem['language'][last]) || null;
        mpChat._modelIdOverride = (rec && rec.modelIdOverride) ? String(rec.modelIdOverride) : '';
        mpChat._reasoningEffort = (rec && rec.reasoningEffort) ? String(rec.reasoningEffort) : '';
      } else {
        mpChat._modelIdOverride = '';
        mpChat._reasoningEffort = '';
      }
      if (typeof mpChat._refreshModelPickerBtn === 'function') mpChat._refreshModelPickerBtn();
    } catch (e) { console.warn('[QuickCreate] 模型跟随同步失败', e); }
  }

  // ---------- ＋菜单：上传图片 / 附带上次文件夹路径 ----------
  function togglePlusMenu(anchorBtn) {
    const existing = document.querySelector('.qc-plus-menu');
    if (existing) { existing.remove(); return; }
    var lastPath = getLastFolderPath();
    const rect = anchorBtn.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'qc-plus-menu';
    menu.innerHTML =
      '<button class="qc-menu-item" data-act="image"><span>🖼️</span><span>上传图片</span></button>' +
      '<button class="qc-menu-item" data-act="folder"><span>📂</span><span>上传文件夹</span>' +
      '<span class="qc-menu-sub" title="' + esc(lastPath || '尚未使用过，首次将弹出选择') + '">' + esc(lastPath ? lastPath : '用上次路径') + '</span></button>';
    document.body.appendChild(menu);
    const mw = menu.offsetWidth || 190;
    let left = rect.left;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    menu.style.left = left + 'px';
    menu.style.top = (rect.bottom + 6) + 'px';
    requestAnimationFrame(() => menu.classList.add('show'));

    menu.querySelector('[data-act="image"]').addEventListener('click', function () {
      menu.remove();
      pickQuickImages();
    });
    menu.querySelector('[data-act="folder"]').addEventListener('click', function () {
      menu.remove();
      attachLastOrPickFolder();
    });
    setTimeout(function () {
      const close = function (e) {
        if (!menu.contains(e.target)) {
          menu.classList.remove('show');
          setTimeout(() => menu.remove(), 160);
          document.removeEventListener('mousedown', close, true);
        }
      };
      document.addEventListener('mousedown', close, true);
    }, 10);
  }

  // 全局「上次文件夹路径」记忆（主对话框/快速创建条选过的路径都会写入，见 app-upload.js 与 pickQuickFolder）
  function getLastFolderPath() {
    try {
      if (window.UserSettings && UserSettings.get) return String(UserSettings.get('lastFolderPath') || '').trim();
    } catch (e) {}
    return '';
  }
  // 【用户令 2026-11-23】不再弹路径选择器：直接附带上次使用的文件夹路径；从未用过才退回选一次（之后一直走记忆）
  function attachLastOrPickFolder() {
    var last = getLastFolderPath();
    if (last) {
      addFolderAttachment(last);
      toastQuick('已附带上次的文件夹路径: ' + last);
    } else {
      pickQuickFolder();
    }
  }

  // 【2026-11-23】加号弹出菜单已移除：＋=上传图片、📁=服务器文件夹路径 两个直连按钮
  //（原 togglePlusMenu 的「上传图片/上传文件夹」二选一菜单拆成两颗独立图标，与参考图一致）

  // 选择本地图片 → 转成待发送缩略卡（发送时随消息走识图通道）
  function pickQuickImages() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.multiple = true;
    input.style.display = 'none';
    input.addEventListener('change', function (e) {
      const files = e.target.files;
      if (!files || !files.length) return;
      const MAX_IMAGES = 4, MAX_BYTES = 8 * 1024 * 1024;
      Array.prototype.slice.call(files).forEach(function (f) {
        if (!/^image\//.test(f.type || '') && !/\.(png|jpe?g|webp|gif)$/i.test(f.name || '')) return;
        if (f.size > MAX_BYTES) { toastQuick('❌ 图片过大（>8MB）: ' + f.name); return; }
        if (pendingImgs.length >= MAX_IMAGES) { toastQuick('⚠️ 最多附带 ' + MAX_IMAGES + ' 张图片'); return; }
        const fr = new FileReader();
        fr.onload = function () {
          if (typeof fr.result === 'string' && fr.result.indexOf('data:image/') === 0) {
            pendingImgs.push({ dataUrl: fr.result, name: f.name });
            renderAttachBar();
          } else {
            toastQuick('❌ 图片读取失败: ' + f.name);
          }
        };
        fr.readAsDataURL(f);
      });
    });
    document.body.appendChild(input);
    input.click();
    setTimeout(function () { if (input.parentNode) input.parentNode.removeChild(input); }, 5000);
  }

  // 选择服务器文件夹路径（复用 App._pickFolder 的服务器目录浏览器）
  function pickQuickFolder() {
    const App = window.App;
    if (App && typeof App._pickFolder === 'function') {
      // 传入一个假的 box/chat 引导：借一个临时桥接，回调里把路径塞进待发附件
      const fakeBox = {
        querySelector: function () { return null; }, // 阻止 _handleFolderPath 直接写输入框
        id: '__qc__'
      };
      const fakeChat = { id: '__qc__' };
      // 直接调用文件夹浏览器，确认后走 _handleFolderPath -> 会尝试写 textarea（拿不到则忽略），
      // 因此这里包一层：从 _handleFolderPath 的行为里截获路径。
      // 【2026-11-23 分流式包装】不再"打枪即换"：包装函数只在 box === fakeBox（本函数自建桩）时
      // 走快速创建逻辑；其余调用（主对话框选路径等）立即透传 origHandle 并原样返回，
      // 消除补丁安装窗口内对主对话框 _handleFolderPath 的污染与嵌套补丁。
      const origHandle = App._handleFolderPath;
      const qcHandle = function (box, chat, folderPath) {
        if (box !== fakeBox) {
          return origHandle.apply(this, arguments);
        }
        // 【上次路径记忆】选过一次就全局记住，之后 ＋菜单「上传文件夹」直接用，不再弹选择器
        try { if (window.UserSettings && UserSettings.set) UserSettings.set('lastFolderPath', String(folderPath || '')); } catch (eSave) {}
        addFolderAttachment(folderPath);
      };
      App._handleFolderPath = qcHandle;
      App._pickFolder(fakeBox, fakeChat, 'upload');
      // 兜底恢复：万一用户长期不确认，5 分钟后强制还原（只还原自己装的这层，不误伤更新的包装）
      setTimeout(function () {
        if (App._handleFolderPath === qcHandle) App._handleFolderPath = origHandle;
      }, 5 * 60 * 1000);
    } else {
      // 兜底：手动输入路径
      const p = _dlgPrompt('请输入文件夹路径：');
      if (p && p.trim()) addFolderAttachment(p.trim());
    }
  }

  function addFolderAttachment(folderPath) {
    pendingTexts.push({ type: 'folder', path: folderPath });
    renderAttachBar();
  }

  function renderAttachBar() {
    if (!bar) return;
    const barEl = bar.querySelector('.qc-attach-bar');
    if (!barEl) return;
    let html = '';
    pendingImgs.forEach(function (it, i) {
      html += '<span class="qc-attach-item" title="' + esc(it.name) + '（点击查看大图）">' +
        '<img src="' + it.dataUrl + '" alt="img" title="点击查看大图">' +
        '<span class="qc-attach-name">' + esc(it.name) + '</span>' +
        '<button type="button" class="qc-attach-del" data-kind="img" data-idx="' + i + '" title="移除">×</button></span>';
    });
    pendingTexts.forEach(function (it, i) {
      html += '<span class="qc-attach-item" title="' + esc(it.path) + '">' +
        '<span>📁</span>' +
        '<span class="qc-attach-name">' + esc(it.path) + '</span>' +
        '<button type="button" class="qc-attach-del" data-kind="folder" data-idx="' + i + '" title="移除">×</button></span>';
    });
    barEl.innerHTML = html;
    barEl.classList.toggle('has-items', pendingImgs.length + pendingTexts.length > 0);
    barEl.querySelectorAll('.qc-attach-del').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const kind = btn.getAttribute('data-kind');
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        if (kind === 'img') pendingImgs.splice(idx, 1);
        else pendingTexts.splice(idx, 1);
        renderAttachBar();
      });
    });
    // 【点击查看大图】与主对话/批量对话共用全局灯箱 App._openImageLightbox（不重复造轮子）
    barEl.querySelectorAll('.qc-attach-item img').forEach(function (imgEl) {
      imgEl.style.cursor = 'zoom-in';
      imgEl.addEventListener('click', function (e) {
        e.stopPropagation();
        if (window.App && typeof App._openImageLightbox === 'function') App._openImageLightbox(imgEl.src);
        else if (window.ImageViewer && ImageViewer.show) ImageViewer.show(imgEl.src);
      });
    });
  }

  function toastQuick(msg) {
    try { if (window.App && App._toast) return void App._toast(msg); } catch (e) {}
    try { console.log('[QuickCreate]', msg); } catch (e2) {}
  }

  // ---------- 打开 / 关闭 ----------
    // 【兜底精确还原】minimap 原始位置持久化：异常中断后仍能 insertBefore 回到原兄弟位
  function _qcSaveOrigin(el) {
    try {
      var next = el.nextSibling;
      sessionStorage.setItem('zf_qc_mm_origin', JSON.stringify({
        parent: el.parentElement.id || '',
        nextId: next && next.id || '',
        nextCls: next && next.className || '',
        idx: Array.prototype.indexOf.call(el.parentElement.children, el)
      }));
    } catch (e) {}
  }
  function _qcRestoreOrigin(el) {
    try {
      var o = JSON.parse(sessionStorage.getItem('zf_qc_mm_origin') || 'null');
      if (!o) return false;
      var parent = o.parent ? document.getElementById(o.parent) : null;
      if (!parent) return false;
      var next = null;
      if (o.nextId) next = document.getElementById(o.nextId);
      else if (o.nextCls) next = parent.querySelector('.' + String(o.nextCls).trim().split(/\s+/).join('.'));
      if (next && next.parentElement === parent) parent.insertBefore(el, next);
      else parent.insertBefore(el, parent.children[o.idx] || null);
      sessionStorage.removeItem('zf_qc_mm_origin');
      return true;
    } catch (e) { return false; }
  }
function show() {
    build();
    bar.classList.add('open');
    if (overlay) overlay.classList.add('open');
    document.body.classList.add('qc-open'); // 标记快速创建面板打开：minimap 只显示不可点，防误触导航
    // 【修复】minimap 位于带 transform 的 #canvasContent 内，其 fixed/z-index 无法越过 body 层遮罩。
    // 这里直接把 #minimap DOM 临时搬到 body 下（脱离 transform 层叠上下文），关闭面板时移回原位。
    // 【bug修复·位置下推10px】注意：qc-open 类的 CSS `position:fixed` 不能在测量前生效——
    // 在 transform 父级内 fixed 的包含块是该元素的 padding box，与原 absolute 定位基准相差
    // 边框/内边距（实测约 10px），先加类再测量 getBoundingClientRect 会把偏移固化成内联坐标，
    // 导致每次开面板缩略图被下推、且小地图反推摄像机随之偏移。因此测量搬移完成后再加标记类。
    // （改为在下方搬移逻辑结束后统一 add）
    (function () {
      var mm = document.getElementById('minimap');
      if (!mm) { // minimap 尚未初始化（页面刚加载就开面板）：稍后重试搬移，避免它困在画布上下文被遮罩盖住
        var _retry = 0;
        var _t = setInterval(function () {
          var el = document.getElementById('minimap');
          if (el && el.parentElement && el.parentElement !== document.body) {
            clearInterval(_t);
            try {
              el._qcOriginParent = el.parentElement; el._qcOriginNext = el.nextSibling;
              el._qcOriginInline = { left: el.style.left, top: el.style.top, right: el.style.right, bottom: el.style.bottom };
              // 【加固】与主路径一致：按当前视口坐标（夹紧到视口内）fixed 定位，不依赖 CSS 默认规则
              var _r = el.getBoundingClientRect();
              var _vw = window.innerWidth, _vh = window.innerHeight;
              var _l = Math.min(Math.max(_r.left, 0), Math.max(_vw - _r.width, 0));
              var _top = Math.min(Math.max(_r.top, 0), Math.max(_vh - _r.height, 0));
              el.style.left = el.style.top = el.style.right = el.style.bottom = '';
              _qcSaveOrigin(el);
              document.body.appendChild(el);
              el.style.left = Math.round(_l) + 'px';
              el.style.top = Math.round(_top) + 'px';
            } catch (e) {}
          } else if (++_retry > 20 || !(bar && bar.classList.contains('open'))) { clearInterval(_t); }
        }, 150);
        return;
      }
      if (mm && mm.parentElement && mm.parentElement !== document.body) {
        mm._qcOriginParent = mm.parentElement;
        mm._qcOriginNext = mm.nextSibling;
        // 【修复】拖拽过的 minimap 带有内联 left/top（画布坐标系像素值），
        // 搬到 body 下后 fixed 定位会拿这套坐标当视口坐标 → 位置跳到别处/看不到。
        // 先备份内联定位并清空，交给 CSS 的 fixed right/bottom 规则稳定显示在右下角。
        mm._qcOriginInline = {
          left: mm.style.left, top: mm.style.top,
          right: mm.style.right, bottom: mm.style.bottom
        };
        // 【修复】面板打开期间保持 minimap 原地不动：先记录当前视口坐标，
        // 搬到 body 下后用同样的视口坐标 fixed 定位，而不是套用 CSS 写死的右下角。
        // 【加固】极端窗口尺寸下（刚改窗口/首帧渲染）getBoundingClientRect 可能给出
        // 视口外或贴边异常坐标，先夹紧到视口内再固化，避免面板期间跑到屏幕外。
        var _r = mm.getBoundingClientRect();
        var _vw = window.innerWidth, _vh = window.innerHeight;
        var _l = Math.min(Math.max(_r.left, 0), Math.max(_vw - _r.width, 0));
        var _top = Math.min(Math.max(_r.top, 0), Math.max(_vh - _r.height, 0));
        mm.style.left = ''; mm.style.top = ''; mm.style.right = ''; mm.style.bottom = '';
        _qcSaveOrigin(mm);
        document.body.appendChild(mm);
        mm.style.left = Math.round(_l) + 'px';
        mm.style.top = Math.round(_top) + 'px';
        mm.style.right = 'auto'; mm.style.bottom = 'auto';
      }
      // 搬移与坐标固化全部完成后才打 qc-open 标记：避免 fixed 定位提前生效
      // 使 getBoundingClientRect 读到「含边框偏移」的错误坐标，导致缩略图每次开面板被下推 ~10px
      document.body.classList.add('qc-open');
    })();
    inputEl.value = '';
    inputEl.style.height = 'auto';
    syncModelFromLastDialog(); // 每次打开：模型跟随上一个对话的选择并回填该线路记忆
    inputEl.focus();
    const _h = document.getElementById('canvasHint');
    if (_h && _h.style.display !== 'none') { _h.style.display = 'none'; _h._hiddenByDualPanel = true; }
  }
  function hide() {
    // 关闭时若语音正在对本条录音，静默停止
    if (bar && bar.classList.contains('open') && window.VoiceInput) {
      try { VoiceInput.stop(); } catch (err) {}
    }
    if (bar) bar.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    document.body.classList.remove('qc-open');
    // 关闭面板：把临时搬到 body 下的 #minimap 移回画布原位
    (function () {
      const mm = document.getElementById('minimap');
      // 兜底①：搬移发生过但备份丢失（异常中断/面板期间刷新残留），minimap 滞留 body 下时送回画布
      if (mm && !mm._qcOriginParent && mm.parentElement === document.body) {
        const cc = document.getElementById('canvasContent');
        if (cc) {
          mm.style.left = mm.style.top = mm.style.right = mm.style.bottom = '';
          if (!_qcRestoreOrigin(mm)) cc.appendChild(mm); // sessionStorage 也丢失才退回末尾
          mm = null;
        }
      }
      if (mm && mm._qcOriginParent) {
        try { mm._qcOriginParent.insertBefore(mm, mm._qcOriginNext || null); } catch (e) { mm._qcOriginParent.appendChild(mm); }
        // 【修复】还原拖拽保存的内联定位（画布坐标系），恢复原显示位置
        if (mm._qcOriginInline) {
          mm.style.left = mm._qcOriginInline.left;
          mm.style.top = mm._qcOriginInline.top;
          mm.style.right = mm._qcOriginInline.right;
          mm.style.bottom = mm._qcOriginInline.bottom;
          mm._qcOriginInline = null;
        }
        mm._qcOriginParent = null; mm._qcOriginNext = null;
        // 【修复】还原后校验可视性：若画布坐标落在视口外（脏坐标/窗口尺寸变化），
        // 清掉内联定位与拖拽记忆，让 CSS 默认规则把它放回右下角；随后强制重绘一次
        requestAnimationFrame(function () {
          // 下帧校验一次；若此刻 minimap 为 display:none（width=0），再等一帧兜底校验
          function _check() {
            try {
              var _r = mm.getBoundingClientRect();
              if (!_r.width) { requestAnimationFrame(_check); return; }
              if (_r.right < 0 || _r.bottom < 0 || _r.left > window.innerWidth || _r.top > window.innerHeight) {
                mm.style.left = ''; mm.style.top = ''; mm.style.right = ''; mm.style.bottom = '';
                try { localStorage.removeItem('zf_minimap_pos'); } catch (_e) {}
              }
            } catch (_e) {}
            if (window.App && App._minimapDraw) App._minimapDraw(true);
          }
          _check();
        });
      }
    })();
    const plusMenu = document.querySelector('.qc-plus-menu');
    if (plusMenu) plusMenu.remove();
    // 关闭对话框同款模型选择器弹层（若开着；打开期间菜单可能挂在 body 下，两处都查）
    try {
      const mpMenu = (bar && bar.querySelector('.model-picker-menu')) || document.querySelector('.model-picker-menu');
      if (mpMenu && !mpMenu.hidden) mpMenu.hidden = true;
    } catch (e) {}
  }
  function toggle() {
    if (bar && bar.classList.contains('open')) hide(); else show();
  }

  // ---------- 发送 ----------
  function submit() {
    const text = (inputEl.value || '').trim();
    if (!text && !pendingImgs.length && !pendingTexts.length) { inputEl.focus(); return; }
    if (sending) return;
    sending = true;
    // 模型：优先用选择器选中的线路（须在模型表中）；否则沿用上一个对话的模型
    const selModelId = (mpChat && mpChat.modelId && window.Models && Models.get && Models.get(mpChat.modelId))
      ? mpChat.modelId : null;
    const theImages = pendingImgs.slice();
    const theTexts = pendingTexts.slice();
    // 发送即清空：文字已提交，输入框与附件条不留残留
    inputEl.value = '';
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    pendingImgs = [];
    pendingTexts = [];
    renderAttachBar();

    const App = window.App;
    if (!App || typeof App.createChatBox !== 'function') {
      console.warn('[QuickCreate] App.createChatBox 不可用');
      sending = false;
      return;
    }

    // 模型：优先用下拉选择的模型；否则沿用上一个对话的模型
    const lastBox = App.chatBoxes && App.chatBoxes.length ? App.chatBoxes[App.chatBoxes.length - 1] : null;
    const modelId = selModelId || (lastBox ? lastBox.modelId : null);

    // 创建位置：紧贴最近对话的右侧同一横排（间隔 36px）；超出画布可视区时自动换到下一行
    const canvas = document.getElementById('canvasContent') || document.getElementById('canvasArea');
    const cRect = canvas.getBoundingClientRect();
    const GAP_X = 80, GAP_Y = 24; // 横排间隔 / 换行间隔
    let posX, posY;
    if (lastBox && lastBox.el) {
      const lb = lastBox.el;
      const w = lb.offsetWidth || 420;
      const h = lb.offsetHeight || 480;
      const left = parseInt(lb.style.left) || 0;
      const top = parseInt(lb.style.top) || 0;
      // 新框宽度先估一个（创建后如不同影响不大），画布可视右边界
      const estW = 420;
      const viewRight = -cRect.left + window.innerWidth;   // 画布坐标系下的可视右缘
      if (left + w + GAP_X + estW <= viewRight) {
        // 仍在可视区内 → 紧贴右侧同排
        posX = left + w + GAP_X;
        posY = top;
      } else {
        // 换行：回到本行行首 x，放到下一行
        posX = Math.max(10, left - 0);
        posY = top + h + GAP_Y;
      }
    } else {
      // 【鼠标跟随优先】快速创建条跟随鼠标位置
      const _m = window.__zfLastMouse || {};
      posX = (_m.clientX != null) ? (_m.clientX - cRect.left) : Math.max(10, -cRect.left + 100);
      posY = (_m.clientY != null) ? (_m.clientY - cRect.top) : Math.max(10, -cRect.top + 60);
    }
    const clientX = posX + cRect.left;
    const clientY = posY + cRect.top;

    const chat = App.createChatBox(clientX, clientY, modelId);
    if (!chat) { sending = false; return; }

    // 模型 ID / 思考强度：选择器（对话框同款）里的当前值写入新对话（与主对话框 _modelIdOverride 同机制）
    // 选择器自身修改时已保存用户习惯（lastModelSelection + 分层记忆），这里只管落进新对话
    if (mpChat && mpChat._modelIdOverride) {
      try { chat._modelIdOverride = String(mpChat._modelIdOverride).trim(); if (window.Store && Store.saveChatBox) Store.saveChatBox(chat, true); } catch (err) {}
    }
    if (mpChat && mpChat._reasoningEffort && typeof ReasoningLevels !== 'undefined') {
      try {
        chat._reasoningEffort = mpChat._reasoningEffort;
        if (window.Store && Store.addLog) Store.addLog('info', chat.id, 'reasoning-switch', '快速创建思考强度: ' + (ReasoningLevels.labelOf(mpChat._reasoningEffort) || mpChat._reasoningEffort) + ' (' + mpChat._reasoningEffort + ')');
      } catch (err) { console.warn('[QuickCreate] 思考强度写入失败', err); }
    }

    // 项目：不再提供下拉，走 createChatBox 的默认归属（当前活动项目，与其他对话框一致）

    // 组装最终消息文本：用户文字 + 文件夹路径附件
    let finalText = text;
    theTexts.forEach(function (it) {
      const line = '📁 文件夹路径: ' + it.path;
      finalText = finalText ? (finalText + '\n' + line) : (line + '\n请查看以上文件夹路径信息，告诉我你的分析或处理意见。');
    });
    if (!finalText) finalText = '请查看以上图片，告诉我你的分析或处理意见。';

    // 与 chat_manage auto_send 完全一致的发送流程
    const input = chat.el.querySelector('textarea');
    if (input) input.value = finalText;
    // 图片：写入识图暂存区，随消息以 base64 发给模型
    if (theImages.length) {
      try {
        var arr = App._pendingImages = App._pendingImages || {};
        arr[chat.id] = theImages.map(function (it) { return { dataUrl: it.dataUrl, name: it.name }; });
        if (typeof App.renderPendingImages === 'function') App.renderPendingImages(chat.el);
      } catch (err) { console.warn('[QuickCreate] 图片附加失败', err); }
    }
    App.addMsg(chat.el, finalText, 'user', chat.modelId);
    if (typeof App.showQueryPin === 'function') App.showQueryPin(chat.el, finalText);
    if (typeof App.updateChatTitle === 'function') App.updateChatTitle(chat.el, text || '图片/文件夹对话');
    chat.history.push({ role: 'user', content: finalText });
    if (window.Store && Store.addLog) Store.addLog('info', chat.id, 'send', 'Tab 快速创建并发送');
    App.sendToModel(chat.el, chat);
    // 发送完成后清空新对话框输入框（sendToModel 可能不会清这条路径写入的值），文字已发出不应残留
    if (input && (input.value === finalText || input.value.trim() === finalText.trim())) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.style.height = 'auto';
    }

    // 关闭快速创建条，焦点交给新对话输入框（try/catch/finally 保证无论发送链路是否报错，菜单都隐藏）
    if (input) setTimeout(() => input.focus(), 60);
  }
  // 用 finally 包裹发送主流程：hide 必执行，防止异常导致快捷发送菜单残留
  const _origSubmit = submit;
  submit = function () {
    try {
      _origSubmit.apply(this, arguments);
    } catch (err) {
      console.error('[QuickCreate] 发送流程异常，强制关闭快捷条', err);
      sending = false;
    } finally {
      sending = false;
      if (bar && bar.classList.contains('open')) hide();
    }
  };

  // ---------- 全局按键：Tab 呼出（与右键并存） ----------
  // 仅当焦点不在输入框/文本域/可编辑元素上时拦截 Tab 并呼出/关闭快速创建条，
  // 并 preventDefault 阻止默认焦点跳转（避免引发右侧导航小地图频繁重绘）。
  // 输入框内部按 Tab 不拦截，保留浏览器默认行为。
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target;
    if (t) {
      const tag = (t.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable) return;
    }
    e.preventDefault();
    toggle();
  }, true);

  // ---------- 全局右键：右键呼出/关闭切换 ----------
  // 仅在无限画布空白区域右键时生效；标题栏/工具条/语音按钮等上方区域不触发
  document.addEventListener('contextmenu', (e) => {
    // 只在画布空白处判定（排除标题栏、工具条、语音按钮、文件树等）
    const canvas = document.getElementById('canvasArea');
    const onCanvasBlank = canvas && canvas.contains(e.target)
      && (!App || !App._isCanvasBlankTarget || App._isCanvasBlankTarget(e.target));
    // 缩小整理模式（总览态）：右键仍用于平移画布（app-canvas.js 处理），需抑制浏览器原生右键菜单
    // （否则松开右键会弹系统菜单打断平移）。
    // 【v2 改动】总览态右键"未拖动"（快速右键）也呼出创建条——拖没拖的标志 __ovPanMoved 由 app-canvas.js 维护：
    //   mousedown 时复位 false，mousemove 位移>6px 置 true。拖动平移 = 不呼出；原地快速右键 = 呼出。
    if (document.body.classList.contains('zf-overview-mode')) {
      if (onCanvasBlank) {
        e.preventDefault();
        if (!window.__ovPanMoved) {
          /* 【总览右键通道 2026-11-23 更新】总览态快速右键由 zf-organize-batch-entry.js 在 window 捕获层
             接管（改呼出本快速创建条并 stopPropagation），本监听收不到该事件。
             保留旧语义兜底：创建条开着时右键=先关它；双击空白 / Tab 单发通道不变。 */
          if (bar && bar.classList.contains('open')) { hide(); }
          else toggle();
        }
        window.__ovPanMoved = false;
      }
      return;
    }
    // 右键点在快速创建条内部的输入框等位置时，保留默认右键菜单
    if (bar && bar.classList.contains('open') && e.target && bar.contains(e.target)) return;
    // 右键点在小狗守卫上不呼出快速创建条（小狗右键是调出聊天面板）
    var dg = App && App._dogGuardEl;
    if (dg && e.target && dg.contains(e.target)) return;
    if (!onCanvasBlank) return;
    e.preventDefault();
    toggle();
  }, true);

  // ---------- 总览态：单击画布空白处关闭已打开的快速创建条 ----------
  // 【用户令 2026-11-27】空白处单击（非拖动）应隐藏创建条，否则只能靠 Tab/右键切换，很麻烦。
  document.addEventListener('click', (e) => {
    if (!bar || !bar.classList.contains('open')) return;
    if (!document.body.classList.contains('zf-overview-mode')) return;
    if (e.target && bar.contains(e.target)) return;
    if (window.__ovPanMoved) return; // 拖动平移结束产生的 click 不算单击
    // 【修复 2026-11-21·根因】创建条打开时 #qcOverlay 全屏遮罩盖住画布，单击空白 e.target 是遮罩本身，
    // 不在 canvasArea 内 → 下面 canvas.contains 判定恒 false，hide 永不执行（只能 Esc 关）。
    // 遮罩命中 = 用户意图点空白 → 直接关闭。
    if (e.target && e.target.id === 'qcOverlay') { hide(); return; }
    const canvas = document.getElementById('canvasArea');
    const onCanvasBlank = canvas && canvas.contains(e.target)
      && (!App || !App._isCanvasBlankTarget || App._isCanvasBlankTarget(e.target));
    if (onCanvasBlank) hide();
  }, true);

  // ---------- 缩小整理模式（总览态）：双击空白处呼出/关闭快速创建条 ----------
  // 【用户拍板 2026-11-20】i缩小模式下：双击空白、右键空白（未拖动）、Tab 三通道均可呼出创建条。
  // 注意：总览态单击/拖动空白=平移画布（app-canvas.js），双击天然由两次单击触发——
  // 单击本身无副作用（不选中不创建），因此双击不会留下残留状态，可放心呼出。
  document.addEventListener('dblclick', (e) => {
    if (!document.body.classList.contains('zf-overview-mode')) return;
    const canvas = document.getElementById('canvasArea');
    const onCanvasBlank = canvas && canvas.contains(e.target)
      && (!App || !App._isCanvasBlankTarget || App._isCanvasBlankTarget(e.target));
    if (!onCanvasBlank) return;
    // 双击点在创建条内部/小狗守卫上不处理
    if (bar && bar.classList.contains('open') && e.target && bar.contains(e.target)) return;
    var dg = App && App._dogGuardEl;
    if (dg && e.target && dg.contains(e.target)) return;
    e.preventDefault();
    toggle();
  }, true);

  // ---------- 导出 ----------
  window.QuickCreate = { show: show, hide: hide, toggle: toggle, submit: submit };
})();
