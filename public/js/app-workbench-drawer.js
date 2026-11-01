
/* ===== 自研对话框 shim (auto-injected) ===== */
function _dlgAlert(msg){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.alert({ title: '提示', icon: 'ℹ️', confirmText: '知道了', message: typeof msg === 'string' ? msg : String(msg) });
  }
  _dlgAlert(typeof msg === 'string' ? msg : String(msg));
  return Promise.resolve();
}
function _dlgConfirm(msg){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.confirm({ title: '请确认', icon: '❓', confirmText: '确定', cancelText: '取消', message: msg });
  }
  return Promise.resolve(window.confirm(msg));
}
function _dlgPrompt(msg, val){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.prompt({ title: '请输入', icon: '✏️', confirmText: '确定', cancelText: '取消', message: msg, value: val || '' });
  }
  return Promise.resolve(window.prompt(msg, val || ''));
}

﻿// ============================================================
// app-workbench-drawer.js - 工作台抽屉（一期：图片工作台）
// 挂在对话面板(#taskPanel)左侧，抽屉式开合，可扩展多工作台 Tab。
// 图片→AI 注入点：App._addPendingImages(box,[File])，与拖拽/粘贴同管道。
// ============================================================
(function () {
    'use strict';
    var NS = window.__KiteNS = window.__KiteNS || {};

    // ===== 全局 JS 错误收集（供工作台「🐞 错误」按钮查看/复制，代替 F12） =====
    (function () {
        if (window.__wbErrLog) return;
        var logs = window.__wbErrLog = [];
        function push(kind, msg) {
            logs.push('[' + new Date().toLocaleTimeString() + '][' + kind + '] ' + msg);
            if (logs.length > 100) logs.shift();
        }
        window.addEventListener('error', function (e) {
            push('error', (e.message || '未知错误') + ' @ ' + (e.filename || '?') + ':' + (e.lineno || 0) + ':' + (e.colno || 0));
        });
        window.addEventListener('unhandledrejection', function (e) {
            var r = e.reason; push('promise', (r && (r.message || r)) ? String(r.message || r) : '未处理的 Promise 拒绝');
        });
    })();

    // == Instance manager: one independent workbench per chatbox ==
    var instances = new Map();
    function getInstance(box) {
        box = box || NS.workbenchActiveNode || document.querySelector('.chatbox, .chat-box, .chat-node');
        if (!box) return null;
        if (!instances.has(box)) instances.set(box, createWorkbench(box));
        return instances.get(box);
    }

    function createWorkbench(hostBox) {

    // 工作台按钮图标（画笔 SVG）——此前被误删导致按钮注入失败、按钮不可见
    // 2026-10-04 换风格：由羽毛笔改为「油漆刷」图标（区分度更高，与编辑笔区分）
    var WB_BRUSH_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 3.5L20.5 9.5a2 2 0 0 1 0 2.8l-4.2 4.2a2 2 0 0 1-2.8 0L7.5 10.5a2 2 0 0 1 0-2.8l4.2-4.2a2 2 0 0 1 2.8 0z"/><path d="M8 13l-3.2 3.2c-1.2 1.2-1.2 2.6-.6 3.6.8 1.2 2.6 1.4 3.8.2L11 17"/></svg>';

    // ---------- 状态 ----------
    var drawer = null;
    var layers = [];            // { id, name, canvas, visible, locked, opacity, x, y, ai }
    var activeLayerId = null;
    var tool = 'pan';           // pan | select
    var view = { x: 0, y: 0, scale: 1 };
    var sel = null;             // 选区 {x,y,w,h}（stage 坐标）
    var history = [];           // [{ label, layersSnapshot(dataURL map) }]
    var histIndex = -1;
    var histBusy = false;

    function uid(p) { return (p || 'wb') + '_' + (++_uidN) + '_' + Date.now().toString(36); }
    var _uidN = 0;
    // 稳定兜底键：无 id/currentChatId 时用「DOM 序号 + id/文本长度/className 签名哈希」生成确定性键。
    // ⚠️ 弱签名：文本长度/className 会随消息增删、选中态变化，仅保证「恢复窗口期」（页面刚加载、
    // 内容未大变时）两次计算一致；并非全局跨重启保证。正常路径 host.id / currentChatId 不走此分支。
    function _stableSlotKey(host, seq) {
        try {
            var sig = (host.id || '') + '|' + (host.textContent || '').length + '|' + (host.className || '');
            var hsh = 0;
            for (var i = 0; i < sig.length; i++) { hsh = ((hsh << 5) - hsh + sig.charCodeAt(i)) | 0; }
            return 'wb_h' + seq + '_' + (hsh >>> 0).toString(36);
        } catch (e) { return 'wb_' + seq + '_x'; }
    }
    var restoredSlot = null;
    var curSlot = null;   // 当前已恢复状态所属的对话槽位（每个对话框独立工作台）

    // ---------- DOM ----------
    function buildDrawer() {
        if (drawer) return drawer;
        drawer = document.createElement('div');
        drawer.className = 'wb-drawer';
        drawer.innerHTML =
            '<div class="wb-drawer-resize" title="拖拽调宽（双击复位）"></div>' +
            '<div class="wb-drawer-tabs">' +
                '<button class="wb-tab active" data-wbtab="browser" title="本对话专属内置浏览器"><svg class="wb-tab-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="M2.5 9h19"/><circle cx="5.5" cy="6.5" r="0.6"/><circle cx="8" cy="6.5" r="0.6"/></svg>浏览器</button>' +
                '<button class="wb-tab" data-wbtab="engine" title="2D 游戏引擎"><svg class="wb-tab-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>引擎</button>' +
                '<button class="wb-tab" data-wbtab="image"><svg class="wb-tab-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M3.5 17.5l5-4.5 4 3.5 3.5-3 4.5 4"/></svg>图片</button>' +
                '<button class="wb-tab" data-wbtab="video" title="AI 视频剪辑工作台"><svg class="wb-tab-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="13" height="12" rx="2"/><path d="M15.5 10.5l6-3.5v10l-6-3.5z"/></svg>视频</button>' +
                '<button class="wb-tab" data-wbtab="model3d" title="3D 模型生成"><svg class="wb-tab-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5l8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3z"/><path d="M12 2.5v9.4M3.5 7.3l8.5 4.6 8.5-4.6M12 21.5v-9.6"/></svg>3D</button>' +
                '<button class="wb-tab" data-wbtab="files" title="文本编辑器：Markdown 渲染 / 代码高亮"><svg class="wb-tab-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5h6l2 2.5h8v12.5H4z"/><path d="M8 12.5h8M8 16h5"/></svg>文本</button>' +
                '<button class="wb-tab" data-wbtab="ppt" title="敬请期待"><svg class="wb-tab-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12.5" rx="1.5"/><path d="M12 16.5V21M8.5 21h7M7.5 12V8.5M12 12V7.5M16.5 12v-2.5"/></svg>PPT</button>' +
                '<button class="wb-flip" title="切换到右侧/左侧"><svg class="wb-tab-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 12h13"/><path d="M16.5 8.5 20 12l-3.5 3.5"/><path d="M17 12H4"/><path d="M7.5 8.5 4 12l3.5 3.5"/></svg></button>' +
                '<button class="wb-close" title="收起抽屉"><svg class="wb-tab-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
            '</div>' +
            '<div class="wb-drawer-body">' +
                '<div class="wb-workbench" data-wbwork="image">' +
                    '<div class="wb-img-toolbar" style="display:none">' +
                        '<span class="wb-sel-info"></span>' +
                    '</div>' +
                    '<div class="wb-img-stage-wrap">' +
                        '<div class="wb-img-stage"></div>' +
                        '<canvas class="wb-mini-map" width="84" height="56" title="缩略图导航：点击/拖动跳转视角"></canvas>' +
                        
                    '</div>' +
                    '<div class="wb-img-statusbar">' +
                        '<span class="wb-msg"></span>' +
                    '</div>' +
                    '<div class="wb-img-bottom">' +
                        '<div class="wb-img-bottom" style="position:relative">' +
                        '<div class="wb-img-bottom-tabs" style="display:flex;justify-content:center">' +
                            '<button id="wbbotToggle" data-wbbot="gallery" title="展开/收起历史生成记录（含图片与视频）" style="display:flex;align-items:center;gap:5px"><svg class="wb-line-ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h13M12 7l5 5-5 5"/><rect x="18.5" y="5" width="3" height="14" rx="1"/></svg>历史记录</button>' +
                        '</div>' +
                        '<div class="wb-bot-switch" style="display:none;justify-content:center;gap:4px;padding:4px 0 0">' +
                            '<button data-wbsrc="image" class="active" style="padding:2px 10px;font-size:11px;border-radius:6px;border:1px solid #2a3b55;background:#16233a;color:#cfe3ff;cursor:pointer">图片</button>' +
                            '<button data-wbsrc="video" style="padding:2px 10px;font-size:11px;border-radius:6px;border:1px solid #2a3b55;background:#16233a;color:#cfe3ff;cursor:pointer">视频</button>' +
                        '</div>' +
                        '<button id="wbbotPrev" title="向左翻页" style="position:absolute;left:4px;top:50%;transform:translateY(-50%);z-index:2;border:none;background:rgba(22,35,58,.9);color:#cfe;cursor:pointer;border-radius:6px;padding:4px 6px;font-size:12px">‹</button>' +
                        '<button id="wbbotNext" title="向右翻页" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);z-index:2;border:none;background:rgba(22,35,58,.9);color:#cfe;cursor:pointer;border-radius:6px;padding:4px 6px;font-size:12px">›</button>' +
                        '<div class="wb-img-bottom-body" data-wbbotbody="gallery" style="display:none;flex-direction:row;flex-wrap:nowrap;gap:8px;overflow-x:auto;overflow-y:hidden;padding:6px;scrollbar-width:none"></div>' +
                        '<div class="wb-img-bottom-body" data-wbbotbody="layers" style="display:none;flex-direction:row;gap:8px;overflow-x:auto;overflow-y:hidden;padding:6px"></div>' +
                        '<div class="wb-img-bottom-body" data-wbbotbody="aitools" style="display:none"></div>' +
                    '</div>' +
                    '<div class="wb-send-bar" style="display:none">' +
                        '<textarea class="wb-prompt" placeholder="对选中区域/全图的指令（先框选）..."></textarea>' +
                        '<button class="wb-send" style="display:none">发送<br>AI</button>' +
                    '</div>' +
                '</div>' +
                '<div class="wb-workbench" data-wbwork="files"></div>' +
                '<div class="wb-workbench" data-wbwork="ppt"><div class="wb-img-empty">PPT 工作台 · 预留扩展位</div></div>' +
                '<div class="wb-workbench" data-wbwork="video">' +
                    '<iframe class="wb-video-frame" data-lazysrc="/video-studio.html" style="width:100%;height:100%;border:none;background:#0d0f14"></iframe>' +
                '</div>' +
                '<div class="wb-workbench" data-wbwork="model3d">' +
                    '<div class="wb-3d-panel">' +
                        '<div class="wb-3d-mode" style="display:flex;gap:6px;margin-bottom:8px">' +
                            '<button class="wb-3d-mode-btn active" data-3dmode="image2model" style="flex:1;padding:6px;border-radius:8px;border:1px solid #2a3b55;background:#16233a;color:#cfe3ff;cursor:pointer"><svg class="wb-line-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M3.5 17.5l5-4.5 4 3.5 3.5-3 4.5 4"/></svg>图生 3D</button>' +
                            '<button class="wb-3d-mode-btn" data-3dmode="text2model" style="flex:1;padding:6px;border-radius:8px;border:1px solid #2a3b55;background:#16233a;color:#cfe3ff;cursor:pointer"><svg class="wb-line-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/></svg>文生 3D</button>' +
                        '</div>' +
                        '<div class="wb-3d-src-wrap" style="text-align:center;padding:14px;border:1px dashed #2a3b55;border-radius:10px;background:rgba(20,32,54,.6)">' +
                            '<div class="wb-3d-src-hint" style="color:#7d93b8;font-size:12px;margin-bottom:6px">拖入 / 粘贴 / 点击上传参考图</div>' +
                            '<img class="wb-3d-src-img" style="display:none;max-width:100%;max-height:180px;border-radius:8px" alt="参考图">' +
                            '<input type="file" class="wb-3d-src-file" accept="image/*" style="display:none">' +
                        '</div>' +
                        '<textarea class="wb-3d-prompt" placeholder="3D 生成描述（文生3D 必填；图生3D 可补充细节，如：古风龙纹浮雕，深度 5mm，适合雕刻）" style="width:100%;min-height:60px;margin-top:8px;border-radius:8px;border:1px solid #2a3b55;background:#10192b;color:#dfe9ff;padding:8px;font-size:12px;box-sizing:border-box;resize:vertical"></textarea>' +
                        '<div style="display:flex;gap:6px;align-items:center;margin-top:8px">' +
                            '<select class="wb-3d-model" style="flex:1;padding:6px;border-radius:8px;border:1px solid var(--border,#333344);background:var(--bg-card,#1e1e2e);color:var(--text,#fff);font-size:12px"></select>' +
                            '<select class="wb-3d-format" style="width:86px;padding:6px;border-radius:8px;border:1px solid var(--border,#333344);background:var(--bg-card,#1e1e2e);color:var(--text,#fff);font-size:12px">' +
                                '<option value="glb">GLB</option><option value="obj">OBJ</option><option value="stl">STL</option><option value="fbx">FBX</option>' +
                            '</select>' +
                        '</div>' +
                        '<button class="wb-3d-run" style="width:100%;margin-top:8px;padding:8px;border-radius:8px;border:none;background:linear-gradient(135deg,#2f6fed,#7c3aed);color:#fff;font-size:13px;cursor:pointer"><svg class="wb-line-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l3 6 6 .9-4.5 4.3 1.1 6L12 17l-5.6 3.2 1.1-6L3 9.9 9 9z"/></svg>生成 3D 模型</button>' +
                        '<div class="wb-3d-result" style="margin-top:10px;min-height:40px;font-size:12px;color:#9ab"></div>' +
                        '<div class="wb-3d-tip" style="margin-top:6px;font-size:11px;color:#5f7494;line-height:1.6">使用前请在「大模型设置 → 3D」中新建对应服务商配置并填 API Key（Tripo / Meshy / Rodin / 混元3D，混元填 SecretId:SecretKey）。生成完成后返回模型下载链接（GLB/OBJ/STL，可直接导入 ZBrush/Blender 雕刻）。</div>' +
                    '</div>' +
                '</div>' +
                '<div class="wb-workbench" data-wbwork="engine" style="position:relative;overflow:hidden">' +
                    '<div class="wb-eng-empty" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#5f7494;font-size:13px;flex-direction:column;gap:8px;background:#0d1219">🎮 2D 游戏引擎<br>点击上方「🎮 引擎」标签即自动加载（本对话内状态保留）</div>' +
                '</div>' +
                '<div class="wb-workbench active" data-wbwork="browser">' +
                    '<div class="wb-br-panel" style="display:flex;flex-direction:column;height:100%;min-height:0">' +
                        '<div class="wb-br-bar" style="position:relative;display:flex;align-items:center;gap:6px">' +
                            '<button class="wb-br-btn" data-brnav="back" title="后退"><svg class="wb-line-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>' +
                            '<button class="wb-br-btn" data-brnav="forward" title="前进"><svg class="wb-line-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button>' +
                            '<button class="wb-br-btn" data-brnav="reload" title="刷新"><svg class="wb-line-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 4v7h-7"/></svg></button>' +
                            '<input class="wb-br-url" placeholder="输入网址，回车打开（本对话独立会话）">' +
                            '<button class="wb-br-btn" data-brnav="fav" title="收藏/取消收藏当前网址"><svg class="wb-line-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.9z"/></svg></button>' +
                            '<button class="wb-br-btn" data-brnav="history" title="历史记录"><svg class="wb-line-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.5 2"/></svg></button>' +
                            '<div class="wb-br-histlist" style="display:none;position:absolute;top:100%;left:8px;right:8px;max-height:280px;overflow-y:auto;background:#151b23;border:1px solid #2c3644;border-radius:8px;z-index:60;box-shadow:0 8px 24px rgba(0,0,0,.5);padding:4px"></div>' +
                        '</div>' +
                        '<div class="wb-br-progress" style="height:2px;background:transparent;position:relative;overflow:hidden;flex:none"><div class="wb-br-progress-in" style="position:absolute;left:0;top:0;bottom:0;width:0;background:#3d8bfd;transition:width .3s ease"></div></div>' +
                        '<div class="wb-br-tabs" style="display:flex;align-items:center;gap:4px;padding:4px 8px 0;overflow-x:auto;flex:none;scrollbar-width:thin;min-height:26px"></div>' +
                        '<div class="wb-br-arch"></div>' +
                        '<div class="wb-br-view-wrap" style="position:relative">' +
                            '<img class="wb-br-view" draggable="false" tabindex="-1" alt="浏览器画面">' +
                            '<div class="wb-br-sbtrack" title="拖拽滚动页面" style="display:none;position:absolute;top:0;right:0;bottom:0;width:10px;background:rgba(255,255,255,.06);z-index:6;cursor:pointer"><div class="wb-br-sbthumb" style="position:absolute;left:1px;right:1px;top:0;height:0;background:rgba(120,170,220,.75);border-radius:5px"></div></div>' +

                            '<div class="wb-br-errcard" style="display:none;position:absolute;inset:0;align-items:center;justify-content:center;background:rgba(13,18,25,.72);z-index:5"></div>' +
                            '<div class="wb-br-ailock" style="display:none;position:absolute;left:0;right:0;top:0;z-index:7;pointer-events:none;overflow:hidden;color:#fff;font-size:12px;padding:6px 10px;text-align:center;background:linear-gradient(180deg,rgba(30,90,160,.92),rgba(30,90,160,.6));box-shadow:0 2px 14px rgba(47,111,237,.55);animation:wbAiGlow 1.4s ease-in-out infinite"><span class="wb-br-aispin" style="display:inline-block;width:12px;height:12px;margin-right:7px;vertical-align:-2px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:wbAiSpin .8s linear infinite"></span>🤖 AI 正在操作浏览器，请勿点击（结束后自动消失）</div>' +
                            '<style>@keyframes wbAiSpin{to{transform:rotate(360deg)}}@keyframes wbAiGlow{0%,100%{background:linear-gradient(180deg,rgba(30,90,160,.92),rgba(30,90,160,.6))}50%{background:linear-gradient(180deg,rgba(47,111,237,1),rgba(124,58,237,.7));box-shadow:0 2px 22px rgba(124,58,237,.8)}}</style>' +
                        '</div>' +
                        '<div class="wb-br-status" style="display:flex;align-items:center;gap:10px"><span class="wb-br-dot" style="width:8px;height:8px;border-radius:50%;background:#5f7494;flex:none"></span><span class="wb-br-stl">就绪</span><span class="wb-br-session"></span><span style="flex:1"></span><button class="wb-br-btn" data-brnav="fps" title="帧率切换：8/15/24 fps 循环（高动态页面选高帧率更流畅）"><span class="wb-br-fps-txt">15fps</span></button><button class="wb-br-btn" data-brnav="mark" title="标记模式：点画面任意处，写一句话给AI（如：这里点一下）"><svg class="wb-line-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.5-5.5-6.5-10a6.5 6.5 0 0 1 13 0c0 4.5-6.5 10-6.5 10z"/><circle cx="12" cy="11" r="2.3"/></svg></button><button class="wb-br-btn" data-brnav="lasso" title="圈问：在画面上框选一块区域，截图裁剪+位置一起发给AI"><svg class="wb-line-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5.5"/><path d="M7.2 11.8c-1.6.9-2.7 2.1-2.7 3.4 0 1.4 1.4 2.4 3 1.9.3 2.1-1.2 3.6-3.7 4.2"/></svg></button><button class="wb-br-btn" data-brnav="inputtext" title="键盘输入：点画面后可直接打字；此按钮可一次把一段文字（含中文）打进网页当前输入框"><svg class="wb-line-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 10.5v3M10 12h4M15.5 10.5v3"/></svg></button><button class="wb-br-btn" data-brnav="maplinks" title="抓取当前页同域全部链接"><svg class="wb-line-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.7 1.7"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.7-1.7"/></svg></button>' +
                        '<button class="wb-br-btn" data-brnav="archive" title="抓取链接并存入网站档案（public/项目记录/网站档案/）"><svg class="wb-line-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="5" rx="1"/><path d="M5 9v10.5h14V9M9.5 13h5"/></svg></button>' +
                        '<button class="wb-br-btn" data-brnav="archpanel" title="网站档案库（查看/复查）"><svg class="wb-line-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5h7l2 2.5h9v11H3z"/></svg></button>' +
                        '<button class="wb-br-btn" data-brnav="viewsource" title="查看当前页面内容/源代码">&lt;/&gt;</button>' +
'<button class="wb-br-btn" data-brnav="askai" title="把当前页网址+正文摘要发到对话输入框，让 AI 分析"><svg class="wb-line-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8.5 8.5 0 0 1-12.4 7.5L3 21l1.6-5.3A8.5 8.5 0 1 1 21 12z"/></svg></button>' +
                        '<button class="wb-br-btn" data-brnav="mempanel" title="浏览记忆面板：笔记摘要+历史+收藏，可搜索，点击直达"><svg class="wb-line-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4.5h4A2.5 2.5 0 0 1 11.5 7v12A2.5 2.5 0 0 0 9 16.5H5zM19 4.5h-4A2.5 2.5 0 0 0 12.5 7v12a2.5 2.5 0 0 1 2.5-2.5h4z"/></svg></button>' + '<button class="wb-br-btn" data-brnav="hardreload" title="强制刷新：清空缓存并重载工作台页面（等同 Ctrl+F5）"><svg class="wb-line-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 4v7h-7"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/></svg></button>' + '<button class="wb-br-btn" data-brnav="errlog" title="查看/复制页面JS报错（等同F12控制台）"><svg class="wb-line-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="8" ry="5.5"/><circle cx="9" cy="10" r="0.5" fill="currentColor"/><circle cx="15" cy="10" r="0.5" fill="currentColor"/><path d="M9.5 14.5h5"/></svg></button>' +
                        '<button type="button" class="wb-br-copyerr" style="margin-left:0" title="复制全部错误信息"><svg class="wb-line-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="8.5" width="12" height="12" rx="1.5"/><path d="M5.5 15.5h-1a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg></button></div>' +
                    '</div>' +
                '</div>' +
            '</div>';
        // v2：工作台是对话框的一部分，挂到当前激活对话框节点内部（从底部长出）。
        // 若找不到对话框节点，退回挂到对话面板 #taskPanel。
        var host = NS.workbenchActiveNode
            || document.querySelector('.chatbox, .chat-box, .chat-node')
            || document.getElementById('taskPanel');
        (host || document.body).appendChild(drawer);
        bindDrawerEvents();
        // 左右位置：构建时立即恢复（localStorage 优先，服务端兜底），保证任何打开路径都不丢
        try {
            var _side = localStorage.getItem('wbDrawerSide');
            if (_side === 'right') drawer.classList.add('wb-side-right');
        } catch (err) {}
        try {
            fetch('/api/workbench/state?slot=__global_side__').then(function (r) { return r.json(); }).then(function (j) {
                if (j && j.ok && j.state && j.state._side === 'right') {
                    drawer.classList.add('wb-side-right');
                    try { localStorage.setItem('wbDrawerSide', 'right'); } catch (err) {}
                }
            }).catch(function () {});
        } catch (err) {}
        return drawer;
    }
    // ---------- 3D 查看器（纯查看：three.js GLTFLoader，生成在对话中完成） ----------
    var wb3d = { viewer: null, renderer: null, scene: null, camera: null, model: null, grid: null, gridOn: true, wire: false, animId: null };

    function _loadScriptOnce(src, cb) {
        if (window.__wb3dLoadedScripts && window.__wb3dLoadedScripts[src]) { cb(); return; }
        window.__wb3dLoadedScripts = window.__wb3dLoadedScripts || {};
        var s = document.createElement('script'); s.src = src; s.onload = function () { window.__wb3dLoadedScripts[src] = true; cb(); };
        s.onerror = function () { cb(new Error('脚本加载失败: ' + src)); };
        document.head.appendChild(s);
    }

    function ensureViewer(cb) {
        var wrap = drawer.querySelector('.wb-3d-viewer-wrap');
        var canvas = drawer.querySelector('.wb-3d-viewer-canvas');
        if (!wrap || !canvas) { cb && cb(new Error('查看器容器不存在')); return; }
        var done = function (err) {
            if (err) { cb && cb(err); return; }
            if (wb3d.viewer) { cb && cb(null, true); return; }
            try {
                var W = wrap.clientWidth || 400, H = wrap.clientHeight || 300;
                var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
                renderer.setSize(W, H, false);
                renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
                var scene = new THREE.Scene();
                var camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 5000);
                camera.position.set(3, 2.2, 4);
                scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.1));
                var dir = new THREE.DirectionalLight(0xffffff, 1.2); dir.position.set(5, 10, 7); scene.add(dir);
                var grid = new THREE.GridHelper(10, 20, 0x3a5a8a, 0x22344f); grid.visible = true; scene.add(grid);
                wb3d.renderer = renderer; wb3d.scene = scene; wb3d.camera = camera; wb3d.grid = grid;
                bindViewerOrbit(canvas);
                animateViewer();
                wb3d.viewer = true;
                cb && cb(null, true);
            } catch (e) { cb && cb(e); }
        };
        if (window.THREE) {
            if (typeof THREE.GLTFLoader === 'function') { done(null); return; }
            _loadScriptOnce('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js', done);
        } else {
            _loadScriptOnce('https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js', function (e1) {
                if (e1) { cb && cb(e1); return; }
                _loadScriptOnce('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js', done);
            });
        }
    }

    function bindViewerOrbit(canvas) {
        var st = { down: false, btn: 0, x: 0, y: 0, theta: 0.6, phi: 1.1, dist: 6, target: new THREE.Vector3(0, 0.8, 0) };
        function apply() {
            var sp = { x: st.target.x + st.dist * Math.sin(st.phi) * Math.sin(st.theta), y: st.target.y + st.dist * Math.cos(st.phi), z: st.target.z + st.dist * Math.sin(st.phi) * Math.cos(st.theta) };
            wb3d.camera.position.set(sp.x, sp.y, sp.z); wb3d.camera.lookAt(st.target);
        }
        wb3d._orbitApply = apply; wb3d._orbitState = st; apply();
        canvas.addEventListener('mousedown', function (e) { st.down = true; st.btn = e.button; st.x = e.clientX; st.y = e.clientY; });
        window.addEventListener('mouseup', function () { st.down = false; });
        window.addEventListener('mousemove', function (e) {
            if (!st.down) return;
            var dx = e.clientX - st.x, dy = e.clientY - st.y; st.x = e.clientX; st.y = e.clientY;
            if (st.btn === 0) { st.theta -= dx * 0.008; st.phi = Math.max(0.05, Math.min(Math.PI - 0.05, st.phi - dy * 0.008)); }
            else {
                var right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), fwd = new THREE.Vector3();
                fwd.subVectors(st.target, wb3d.camera.position); fwd.y = 0; fwd.normalize();
                right.crossVectors(fwd, up).negate();
                var k = st.dist * 0.0016;
                st.target.addScaledVector(right, dx * k); st.target.y = Math.max(0, st.target.y + dy * k);
            }
            apply();
        });
        canvas.addEventListener('wheel', function (e) { e.preventDefault(); st.dist = Math.max(0.05, Math.min(500, st.dist * (e.deltaY > 0 ? 1.12 : 0.89))); apply(); }, { passive: false });
        canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    }

    function animateViewer() {
        if (wb3d.animId) cancelAnimationFrame(wb3d.animId);
        (function loop() {
            if (!wb3d.renderer || !wb3d.renderer.domElement.isConnected) { wb3d.animId = null; return; }
            wb3d.renderer.render(wb3d.scene, wb3d.camera);
            wb3d.animId = requestAnimationFrame(loop);
        })();
    }

    function clearViewerModel() {
        if (wb3d.model && wb3d.scene) { wb3d.scene.remove(wb3d.model); wb3d.model = null; }
        var hint = drawer.querySelector('.wb-3d-viewer-empty');
        if (hint) hint.style.display = '';
    }

    function fitViewer() {
        if (!wb3d.model) { toastViewer('请先加载一个模型'); return; }
        var box = new THREE.Box3().setFromObject(wb3d.model);
        var size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
        var maxDim = Math.max(size.x, size.y, size.z) || 1;
        var st = wb3d._orbitState;
        st.dist = maxDim * 2.2;
        st.target.set(center.x, center.y, center.z);
        if (wb3d._orbitApply) wb3d._orbitApply();
    }

    function _loadGLTFInto(loader, url, label) {
        var loading = drawer.querySelector('.wb-3d-viewer-loading');
        var empty = drawer.querySelector('.wb-3d-viewer-empty');
        if (loading) loading.style.display = 'flex';
        if (empty) empty.style.display = 'none';
        try {
            loader.load(url, function (gltf) {
                if (loading) loading.style.display = 'none';
                clearViewerModel();
                wb3d.model = gltf.scene;
                wb3d.scene.add(gltf.scene);
                fitViewer();
                showViewerHint(label);
                toastViewer('模型已加载');
            }, undefined, function (e) {
                if (loading) loading.style.display = 'none';
                toastViewer('模型加载失败：' + ((e && e.message) || e));
            });
        } catch (e2) { if (loading) loading.style.display = 'none'; toastViewer('加载异常：' + (e2.message || e2)); }
    }

    function loadViewerModelFromUrl(url) {
        if (!/\.glb(\?|#|$)/i.test(url) && !/\.gltf(\?|#|$)/i.test(url)) {
            toastViewer('仅支持 GLB/GLTF 格式预览：' + url); return;
        }
        ensureViewer(function (err) {
            if (err) { toastViewer('查看器初始化失败：' + (err.message || err)); return; }
            _loadGLTFInto(new THREE.GLTFLoader(), url, url);
        });
    }

    function loadViewerModelFromData(dataUrl) {
        ensureViewer(function (err) {
            if (err) { toastViewer('查看器初始化失败：' + (err.message || err)); return; }
            _loadGLTFInto(new THREE.GLTFLoader(), dataUrl, '本地文件');
        });
    }

    function showViewerHint(src) {
        var el = drawer.querySelector('.wb-3d-viewer-hint');
        if (el) { el.textContent = src || ''; el.style.display = ''; }
    }

    function toastViewer(msg) {
        try { if (window.App && App._toast) App._toast(msg); } catch (e) {}
    }

    function bindModel3D() {
        var panel = drawer.querySelector('.wb-3d-panel');
        if (!panel) return;
        var file = panel.querySelector('.wb-3d-viewer-file');
        if (!file) return;
        file.addEventListener('change', function () {
            var f = file.files && file.files[0]; if (!f) return;
            var r = new FileReader(); r.onload = function () { loadViewerModelFromData(r.result); }; r.readAsDataURL(f);
        });
        panel.addEventListener('dragover', function (e) { e.preventDefault(); });
        panel.addEventListener('drop', function (e) {
            e.preventDefault();
            var f = e.dataTransfer.files && e.dataTransfer.files[0];
            if (f && /\.(glb|gltf)$/i.test(f.name)) { var r = new FileReader(); r.onload = function () { loadViewerModelFromData(r.result); }; r.readAsDataURL(f); }
        });
        panel.querySelector('.wb-3d-btn-fit').addEventListener('click', fitViewer);
        panel.querySelector('.wb-3d-btn-grid').addEventListener('click', function () {
            wb3d.gridOn = !wb3d.gridOn; if (wb3d.grid) wb3d.grid.visible = wb3d.gridOn;
            this.textContent = wb3d.gridOn ? '# 网格 开' : '# 网格 关';
        });
        panel.querySelector('.wb-3d-btn-wire').addEventListener('click', function () {
            wb3d.wire = !wb3d.wire;
            if (wb3d.model) wb3d.model.traverse(function (o) { if (o.isMesh && o.material) { var ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(function (m) { m.wireframe = wb3d.wire; }); } });
            this.textContent = wb3d.wire ? '◈ 线框 开' : '◈ 线框 关';
        });
    }

    // 对外 API：AI 生成完成后调用（window.WB3DViewer.load(url)）
    window.WB3DViewer = {
        load: function (url) { loadViewerModelFromUrl(url); },
        loadData: function (dataUrl) { loadViewerModelFromData(dataUrl); },
        clear: clearViewerModel
    };

    // ---------- 内置浏览器（本对话槽位独立会话） ----------
    var br = null;   // { session, url, sig, busy, timer, vp:{w,h}, target:{w,h}, navSrc }
    function brEl(cls) { return drawer.querySelector(cls); }
    function brApi(action, params) {
        var body = Object.assign({ action: action, session: br ? br.session : 'default' }, params || {});
        return fetch('/api/browser', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
    }
    function brState() { return (NS.workbenchBrowserState = NS.workbenchBrowserState || {}); }
    function brToast(msg) {
        var el = brEl('.wb-br-stl');
        if (el) el.textContent = msg;
        var btn = brEl('.wb-br-copyerr');
        var isError = msg && (/失败|错误|Error|异常|超时|timeout/i.test(String(msg)));
        var isLoading = msg && (/正在加载/i.test(String(msg)));
        // 状态点：加载中黄转圈 → 出错红 → 正常绿
        if (isLoading) brDotSet('#f0b429', true);
        else if (isError) brDotSet('#e5534b', false);
        else brDotSet('#3fb950', false);
        // 错误卡（覆盖在画面上，含重试按钮）
        var card = brEl('.wb-br-errcard');
        if (card) {
            if (isError) {
                var slot0 = br ? br.session : 'default';
                brState()[slot0] = brState()[slot0] || {};
                brState()[slot0].lastError = (msg instanceof Error) ? (msg.stack || msg.message) : String(msg);
                card.innerHTML = '<div style="background:#2a1518;border:1px solid #e5534b;border-radius:8px;padding:14px 18px;max-width:80%;color:#ffb3ad;font-size:13px;line-height:1.6">' +
                    '<b style="color:#e5534b">⚠ 页面打开出错了</b><br>' +
                    '<span style="word-break:break-all">' + String(msg).replace(/</g, '&lt;') + '</span><br>' +
                    '<button class="wb-br-btn wb-br-errretry" style="margin-top:8px"><svg class="wb-br-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 4v7h-7"/></svg> 重试</button> ' +
                    '<button type="button" class="wb-br-copyerr wb-br-errcopy" data-slot="' + slot0 + '" style="margin-left:0"><svg class="wb-br-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="8.5" width="12" height="12" rx="1.5"/><path d="M5.5 15.5h-1a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg> 复制错误信息</button></div>';
                card.style.display = 'flex';
                var rb = card.querySelector('.wb-br-errretry');
                if (rb) rb.addEventListener('click', function () {
                    card.style.display = 'none';
                    brToast('正在重试…');
                    if (br && br.url) brNav(br.url); else brRefresh();
                });
            } else {
                card.style.display = 'none';
            }
        }
        var btn2 = brEl('.wb-br-copyerr');
        if (!btn2) return;
        if (isError) {
            var slot = br ? br.session : 'default';
            brState()[slot] = brState()[slot] || {};
            if (!brState()[slot].lastError) brState()[slot].lastError = String(msg);
            btn2.dataset.slot = slot;
            btn2.style.display = '';
            btn2.innerHTML = '<svg class="wb-line-ico" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg> 一键复制错误信息';
        } else {
            btn2.style.display = 'none';
        }
    }
    // ---------- 批次1：状态点 + 假进度条 ----------
    function brDotSet(color, spin) {
        var d = brEl('.wb-br-dot');
        if (!d) return;
        d.style.background = color;
        if (spin) { d.style.width = '10px'; d.style.height = '10px'; } else { d.style.width = '8px'; d.style.height = '8px'; }
    }
    var _brProgTimer = 0;
    function brProgStart() {
        var bar = brEl('.wb-br-progress-in');
        if (!bar) return;
        if (_brProgTimer) clearInterval(_brProgTimer);
        bar.style.transition = 'none'; bar.style.width = '5%';
        requestAnimationFrame(function () {
            bar.style.transition = 'width .3s ease';
            var p = 5;
            _brProgTimer = setInterval(function () {
                p = Math.min(92, p + Math.random() * 8);
                bar.style.width = p + '%';
            }, 300);
        });
    }
    function brProgDone(ok) {
        var bar = brEl('.wb-br-progress-in');
        if (!bar) return;
        if (_brProgTimer) { clearInterval(_brProgTimer); _brProgTimer = 0; }
        bar.style.width = ok ? '100%' : '0';
        setTimeout(function () { bar.style.transition = 'none'; bar.style.width = '0'; setTimeout(function () { bar.style.transition = 'width .3s ease'; }, 50); }, 350);
    }
    // ---------- 批次1：网址历史 + 收藏（localStorage 按 slot 隔离，上限50） ----------
    // 【云持久化 wbStore】历史/收藏/笔记/浏览器状态在 localStorage 之外，同步一份到服务端
    // SQLite（/api/workbench/state，slot 加后缀 key），清缓存/换浏览器/重启后不丢。
    // 合并策略（保证「老数据位置不变，新数据追加」）：以本地顺序为基准，服务端有而本地没有的项追加到尾部；
    // 对象型（wbBr_ 状态）则浅合并：服务端字段为底、本地字段覆盖。
    function wbStoreSrvKey(key) { return 'wbcloud_' + key; }   // 服务端 slot key（避开前端 key 空间）
    function wbStoreSave(key, val) {
        try {
            fetch('/api/workbench/state', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slot: wbStoreSrvKey(key), state: { v: val } })
            }).catch(function () {});
        } catch (e) {}
    }
    function wbStoreLoad(key, cb) {
        try {
            fetch('/api/workbench/state?slot=' + encodeURIComponent(wbStoreSrvKey(key)))
                .then(function (r) { return r.json(); })
                .then(function (j) { cb((j && j.ok && j.state) ? j.state.v : null); })
                .catch(function () { cb(null); });
        } catch (e) { cb(null); }
    }
    // 数组合并：base（本地，位置权威）在前，remote 独有项按原顺序追加到尾部
    function wbMergeArr(base, remote) {
        var seen = {}; (base || []).forEach(function (u) { seen[u] = 1; });
        return (base || []).concat((remote || []).filter(function (u) { return !seen[u]; }));
    }
    function wbStoreSyncBack(key, lsKey, isObject) {
        wbStoreLoad(key, function (rv) {
            if (rv == null) return;   // 服务端无记录：不动本地
            try {
                var lv = null;
                try { lv = JSON.parse(localStorage.getItem(lsKey) || 'null'); } catch (e) {}
                if (isObject) {
                    var merged = Object.assign({}, rv, lv || {});
                    localStorage.setItem(lsKey, JSON.stringify(merged));
                    wbStoreSave(key, merged);   // 回写统一态
                } else {
                    var merged2 = wbMergeArr(lv || [], rv).slice(0, 50);   // 合并后截断，保持上限与本地一致
                    localStorage.setItem(lsKey, JSON.stringify(merged2));
                    if (merged2.length !== (lv || []).length) wbStoreSave(key, merged2);
                }
            } catch (e) {}
        });
    }
    function brHistKey(slot) { return 'wb_br_hist_' + (slot || 'default'); }
    function brFavKey(slot) { return 'wb_br_fav_' + (slot || 'default'); }
    function brHistLoad(slot) {
        try { return JSON.parse(localStorage.getItem(brHistKey(slot)) || '[]'); } catch (e) { return []; }
    }
    function brHistAdd(slot, u) {
        if (!u || !/^https?:/i.test(u)) return;
        var h = brHistLoad(slot);
        h = h.filter(function (x) { return x !== u; });
        h.unshift(u);
        h = h.slice(0, 50);
        try { localStorage.setItem(brHistKey(slot), JSON.stringify(h)); } catch (e) {}
        wbStoreSave('hist_' + (slot || 'default'), h);   // 云同步：重启/清缓存不丢
    }
    function brFavLoad(slot) {
        try { return JSON.parse(localStorage.getItem(brFavKey(slot)) || '[]'); } catch (e) { return []; }
    }
    function brHistRender(filter) {
        var list = brEl('.wb-br-histlist');
        if (!list) return;
        var slot = br ? br.session : 'default';
        var favs = brFavLoad(slot), hist = brHistLoad(slot);
        var f = (filter || '').toLowerCase();
        // 📚 浏览笔记：URL 匹配的最近一条摘要，显示在下拉里（下次打开知道上次看的是什么）
        var notes = {};
        try { JSON.parse(localStorage.getItem('wb_br_notes_' + (curSlot || hostBox.dataset.wbSlot || 'default') ) || '[]').forEach(function (n) { if (!notes[n.url]) notes[n.url] = n; }); } catch (e) {}
        hist = hist.filter(function (u) { return !f || u.toLowerCase().indexOf(f) >= 0; });
        favs = favs.filter(function (u) { return !f || u.toLowerCase().indexOf(f) >= 0; });
        if (!favs.length && !hist.length) { list.style.display = 'none'; return; }
        var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); };
        var short = function (u) { try { return (new URL(u)).host + (new URL(u)).pathname.replace(/\/$/, ''); } catch (e) { return u; } };
        var html = '';
        if (favs.length) html += '<div style="padding:4px 8px;font-size:10px;color:#7d8aa0">★ 收藏（' + favs.length + '）</div>';
        favs.forEach(function (u) { html += '<div class="wb-br-hitem" style="display:flex;align-items:center" data-histitem><span data-histgo="' + esc(u) + '" style="flex:1;cursor:pointer" title="' + esc(u) + '"><span style="color:#f0b429">★</span> ' + esc(short(u)) + '</span><span data-unfav="' + esc(u) + '" title="取消收藏" style="opacity:.6;cursor:pointer;padding:0 4px">✕</span></div>'; });
        if (hist.length) html += '<div style="padding:4px 8px;font-size:10px;color:#7d8aa0">🕘 历史（' + hist.length + '，最近50条）</div>';
        hist.forEach(function (u) {
            var isFav = favs.indexOf(u) >= 0;
            var n = notes[u];
            var tip = esc(u) + (n ? '\n📝 ' + (n.title || '') + ' ' + (n.brief || '').slice(0, 80) : '');
            html += '<div class="wb-br-hitem" data-histgo="' + esc(u) + '" title="' + tip + '"><span style="color:#5f7494">' + (isFav ? '★' : (n ? '📝' : '·')) + '</span> ' + esc(short(u)) + '</div>';
        });
        list.innerHTML = html;
        list.style.display = 'block';
    }
    function brHistHide() { var l = brEl('.wb-br-histlist'); if (l) l.style.display = 'none'; }
    function brToggleFav() {
        var slot = br ? br.session : 'default';
        var u = (br && br.url) || (brEl('.wb-br-url') || {}).value || '';
        if (!u) { brToast('当前没有可收藏的网址'); return; }
        var favs = brFavLoad(slot);
        var i = favs.indexOf(u);
        if (i >= 0) { favs.splice(i, 1); brToast('已取消收藏 ' + u); }
        else { favs.unshift(u); brToast('已收藏 ' + u); }
        try { localStorage.setItem(brFavKey(slot), JSON.stringify(favs.slice(0, 50))); } catch (e) {}
        wbStoreSave('fav_' + (slot || 'default'), favs.slice(0, 50));   // 云同步
        var fb = brEl('[data-brnav="fav"]'); if (fb) fb.innerHTML = favs.indexOf(u) >= 0 ? '<svg class="wb-line-ico" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01z"/></svg>' : '<svg class="wb-line-ico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01z"/></svg>';
    }
    // 🌙 暗色三档滤镜：原色(0) → 柔和(1) → 夜间反色(2) 循环；UserSettings 持久化（全局键，跨会话生效）
    function brDarkApply() {
        var view = brEl('.wb-br-view');
        if (!view) return;
        var mode = 0;
        try { mode = parseInt(window.UserSettings ? UserSettings.get('wb_br_dark', '0') : '0', 10) || 0; } catch (e) {}
        if (mode === 1) view.style.filter = 'brightness(0.8) contrast(1.05)';
        else if (mode === 2) view.style.filter = 'invert(1) hue-rotate(180deg) contrast(0.9)';
        else view.style.filter = '';
        var db = brEl('[data-brnav="dark"]');
        if (db) { var _darkPaths = ['<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>', '<path d="M17 18a5 5 0 0 0 0-10 6.5 6.5 0 0 0-12.3 2A4.5 4.5 0 0 0 6 18z"/>', '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>']; db.innerHTML = '<svg class="wb-line-ico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + _darkPaths[mode] + '</svg>'; db.title = '画面护眼（当前：' + ['原色', '柔和', '夜间反色'][mode] + '，点击切换）'; }
    }
    function brDarkToggle() {
        var mode = 0;
        try { mode = parseInt(window.UserSettings ? UserSettings.get('wb_br_dark', '0') : '0', 10) || 0; } catch (e) {}
        mode = (mode + 1) % 3;
        try { if (window.UserSettings) UserSettings.set('wb_br_dark', String(mode)); } catch (e) {}
        brDarkApply();
        brToast('画面护眼：' + ['原色', '柔和（降低亮度）', '夜间反色'][mode]);
    }
    // 📌 标记模式：开启后点击画面 → 弹输入框写备注 → 写入 human_note（AI 下轮先读）+ 本地缓存点位（问AI附带）
    var brMarkMode = false;
    var brMarkLast = null;
    function brMarkToggle() {
        brMarkMode = !brMarkMode;
        var view = brEl('.wb-br-view');
        if (view) view.style.cursor = brMarkMode ? 'crosshair' : '';
        var mb = brEl('[data-brnav="mark"]');
        if (mb) { mb.style.background = brMarkMode ? '#3a5a3a' : ''; mb.title = brMarkMode ? '标记模式已开启：点击画面任意处写备注（再点此退出）' : '标记模式：点画面任意处，写一句话给AI'; }
        brToast(brMarkMode ? '📌 标记模式已开启：点击画面任意处，写一句话告诉 AI' : '标记模式已关闭');
    }
    function brMarkClick(p, view) {
        var note = window.prompt('📌 给 AI 的标记备注（这一处要做什么？）', '');
        if (note === null) return;   // 取消
        note = (note || '').trim();
        if (!note) { brToast('已取消（备注为空）'); return; }
        brMarkLast = { x: p.x, y: p.y, w: view.clientWidth || 0, h: view.clientHeight || 0, note: note };
        brApi('touch_human', { note: '标记(' + Math.round(p.x) + ',' + Math.round(p.y) + ')：' + note }).then(function () {
            brToast('✅ 已标记给 AI：' + note + '（点「💬问AI」会自动带上这个位置）');
        }, function () {
            brToast('标记已暂存（离线）：' + note);
        });
        brMarkToggle();   // 标完自动退出标记模式
    }
    // 🎯 圈问：开启后在画面上拖框选区域 → canvas 裁剪当前截图 → base64 塞对话输入框（失败退化坐标描述）
    var brLassoMode = false, brLassoBox = null;
    function brLassoToggle() {
        brLassoMode = !brLassoMode;
        if (brMarkMode && brLassoMode) brMarkToggle();   // 两种模式互斥
        var view = brEl('.wb-br-view');
        if (view) view.style.cursor = brLassoMode ? 'crosshair' : '';
        var lb = brEl('[data-brnav="lasso"]');
        if (lb) { lb.style.background = brLassoMode ? '#3a5a3a' : ''; }
        brToast(brLassoMode ? '🎯 圈问模式：在画面上拖一个框，把那块截图发给 AI' : '圈问模式已关闭');
    }
    function brLassoEnsureBox() {
        if (brLassoBox) return brLassoBox;
        var wrap = brEl('.wb-br-view').parentElement;
        var st = wrap.style.position;
        if (!st || st === 'static') wrap.style.position = 'relative';
        var box = document.createElement('div');
        box.style.cssText = 'position:absolute;border:2px dashed #4a9eff;background:rgba(74,158,255,.12);pointer-events:none;display:none;z-index:9;';
        wrap.appendChild(box);
        brLassoBox = box;
        return box;
    }
    function brLassoSend(rect, view) {
        var note = window.prompt('🎯 想问 AI 这块区域的什么？', '');
        if (note === null) return;
        note = (note || '').trim() || '请分析这块区域';
        var dataUrl = '';
        try {
            var cv = document.createElement('canvas');
            cv.width = Math.max(2, Math.round(rect.w)); cv.height = Math.max(2, Math.round(rect.h));
            cv.getContext('2d').drawImage(view, rect.x, rect.y, rect.w, rect.h, 0, 0, cv.width, cv.height);
            dataUrl = cv.toDataURL('image/jpeg', 0.85);
        } catch (e) { dataUrl = ''; }   // 截图跨域污染等情况退化
        var box = document.querySelector('.chatbox.focused') || document.querySelector('.chatbox');
        if (!box) { brToast('没有可用的对话窗口'); return; }
        var input = box.querySelector('textarea') || box.querySelector('[contenteditable="true"]');
        if (!input) { brToast('找不到对话输入框'); return; }
        var pos = '画面坐标 x=' + Math.round(rect.x + rect.w / 2) + ', y=' + Math.round(rect.y + rect.h / 2) + '，框选区域 ' + Math.round(rect.w) + '×' + Math.round(rect.h) + '（画面 ' + (view.clientWidth || 0) + '×' + (view.clientHeight || 0) + '）';
        var msg = '🎯 圈问（' + pos + '）：\n【我的问题】' + note + '\n【当前网址】' + (br.url || '');
        if (input.tagName === 'TEXTAREA') {
            input.value = input.value ? input.value + '\n' + msg : msg;
        } else {
            input.textContent = input.textContent ? input.textContent + '\n' + msg : msg;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        if (dataUrl) {
            // 尝试把裁剪图粘贴为剪贴板图片（若对话支持粘贴图片则直接 Ctrl+V）
            try {
                var bin = atob(dataUrl.split(',')[1]); var arr = new Uint8Array(bin.length);
                for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                navigator.clipboard.write([new ClipboardItem({ 'image/jpeg': new Blob([arr], { type: 'image/jpeg' }) })]).then(function () {
                    brToast('✅ 圈选截图已复制到剪贴板：在输入框 Ctrl+V 粘贴即可附图');
                }, function () { brToast('✅ 圈问已写入输入框（附图复制失败，已含坐标描述）'); });
            } catch (e) { brToast('✅ 圈问已写入输入框（已含坐标描述）'); }
        } else {
            brToast('✅ 圈问已写入输入框（含坐标描述）');
        }
        brLassoToggle();   // 用完自动退出
    }
    function brSyncFavIcon() {
        var fb = brEl('[data-brnav="fav"]');
        if (!fb) return;
        var slot = br ? br.session : 'default';
        var favs = brFavLoad(slot);
        fb.innerHTML = (br && br.url && favs.indexOf(br.url) >= 0) ? '<svg class="wb-line-ico" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01z"/></svg>' : '<svg class="wb-line-ico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01z"/></svg>';
    }
    // 一键复制错误信息（点按钮复制最近一次错误，成功后反馈）
    (function () {
        document.addEventListener('click', function (ev) {
            var btn = ev.target && ev.target.closest ? ev.target.closest('.wb-br-copyerr') : null;
            if (!btn) return;
            var slot = btn.dataset.slot || (br ? br.session : 'default');
            var st = brState()[slot] || {};
            var txt = st.lastError || (btn.closest('.wb-br-status') && btn.closest('.wb-br-status').querySelector('.wb-br-stl') ? btn.closest('.wb-br-status').querySelector('.wb-br-stl').textContent : '');
            if (!txt) txt = '（无错误信息）';
            var done = function () {
                btn.innerHTML = '<svg class="wb-line-ico" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> 已复制';
                setTimeout(function () { btn.innerHTML = '<svg class="wb-line-ico" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg> 一键复制错误信息'; }, 1500);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt, done); });
            } else { fallbackCopy(txt, done); }
        }, true);
        function fallbackCopy(txt, done) {
            var ta = document.createElement('textarea');
            ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(ta);
            if (ok) done();
        }
    })();
    function brActive() {
        var w = drawer.querySelector('.wb-workbench[data-wbwork="browser"]');
        return w && w.classList.contains('active') && drawer.classList.contains('open');
    }
    // ---------- 状态持久化：刷新/重启后恢复上次会话的网址与活动标签 ----------
    function brSlotKey() {
        return curSlot || hostBox.dataset.wbSlot || 'default';
    }
    function brPersistSave(activeIdx) {
        try {
            var slot = brSlotKey();
            var st = brState()[slot] || {};
            if (br) st.url = br.url;
            if (typeof activeIdx === 'number') st.active = activeIdx;
            brState()[slot] = st;
            localStorage.setItem('wbBr_' + slot, JSON.stringify(st));
            wbStoreSave('br_' + (slot || 'default'), st);   // 云同步：浏览器状态（网址/活动标签）
        } catch (e) {}
    }
    function brEnsure() {
        var slot = curSlot || hostBox.dataset.wbSlot || 'default';
        // 【会话独立】切换对话后强制换新会话：旧会话的浏览器状态不带入新对话
        if (br && br.session !== slot) {
            try { brStopPoll(); } catch (e) {}
            try { brStreamStop(); } catch (e) {}
            try { var _v = brEl('.wb-br-view'); if (_v) { _v.removeAttribute('src'); } } catch (e) {}
            br = null;
        }
        if (br) return br;
        br = { session: slot, url: '', sig: '', busy: false, timer: 0, vp: { w: 1280, h: 800 }, target: { w: 1280, h: 800 }, tabRestored: false };
        var saved = brState()[slot];
        if (!saved || !saved.url) {
            // 内存态为空时从 localStorage 恢复（跨刷新/重启长期记忆）
            try { saved = JSON.parse(localStorage.getItem('wbBr_' + slot) || 'null'); if (saved) brState()[slot] = saved; } catch (e) {}
        }
        if (saved && saved.url) br.url = saved.url;
        // 云回填：服务端 wbBr_ 状态合并到本地（服务端字段为底、本地覆盖），下次保存即统一
        wbStoreSyncBack('br_' + (slot || 'default'), 'wbBr_' + slot, true);
        // 云回填：历史/收藏（本地顺序为权威，服务端独有条目追加到尾部，老数据位置不变）
        wbStoreSyncBack('hist_' + (slot || 'default'), brHistKey(slot), false);
        wbStoreSyncBack('fav_' + (slot || 'default'), brFavKey(slot), false);
        wbStoreSyncBack('notes_' + (slot || 'default'), 'wb_br_notes_' + (slot || 'default'), false);
        // 云回填：页签记忆（字符串值，服务端有则回填本地，不覆盖本地已有）
        (function () {
            var tk = 'wbDrawerTab_' + slot;
            wbStoreLoad('tab_' + (slot || 'default'), function (tv) {
                if (!tv) return;
                try {
                    if (!localStorage.getItem(tk)) {
                        localStorage.setItem(tk, String(tv));
                        wbStoreSave('tab_' + (slot || 'default'), tv);
                    }
                } catch (e) {}
            });
        })();
        brEl('.wb-br-session').textContent = '会话: ' + br.session;
        brBindOnce();
        return br;
    }
    function brResizeSync(force) {
        var view = brEl('.wb-br-view'), wrap = brEl('.wb-br-view-wrap');
        if (!view || !wrap) return;
        var w = Math.max(320, Math.round(wrap.clientWidth)), h = Math.max(240, Math.round(wrap.clientHeight));
        if (!force && w === br.target.w && h === br.target.h) return;
        br.target.w = w; br.target.h = h;
        brApi('resize', { width: w, height: h }).then(function () { br.vp.w = w; br.vp.h = h; brRefresh(); }, function () {});
    }
    // ---------- MJPEG 视频流：长连接自动推帧（服务端丢旧帧，前端零轮询拉图） ----------
    function brStreamStart() {
        if (!br) return;
        // 帧率偏好恢复（拉流前拼参，避免二次断流闪屏）：UserSettings 读取 + 白名单校验，缺省 15
        if (!br.fps) {
            try {
                var _f = parseInt(window.UserSettings ? UserSettings.get('wb_br_fps', '15') : '15', 10);
                if (_f === 8 || _f === 15 || _f === 24) br.fps = _f;
            } catch (e) {}
            if (br.fps && br.fps !== 15) { var _ft = brEl('.wb-br-fps-txt'); if (_ft) _ft.textContent = br.fps + 'fps'; }
        }
        var view = brEl('.wb-br-view');
        if (!view) return;
        br.streamOn = true;
        var cur = view.getAttribute('src') || '';
        // 只有当前 src 不是本会话的 MJPEG 流时才（重）连；
        // 地址里不能放时间戳——否则每次激活/切标签都判定“不同”而断流重连 → 白屏
        var u = '/api/browser?action=mjpeg&session=' + encodeURIComponent(br.session) + '&fps=' + (br.fps || 15);
        if (cur.indexOf('action=mjpeg') === -1 || cur.indexOf('session=' + encodeURIComponent(br.session) + '&') === -1) view.src = u + '&t=' + Date.now();
    }
    function brStreamStop() {
        if (br) br.streamOn = false;
        var view = brEl('.wb-br-view');
        if (!view) return;
        // 换成 1px 透明图：img 换源会立刻断开 MJPEG 长连接（释放服务端线程）
        view.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    }
    // 「⌨ 输入」：一次把整段文字（含中文）打进网页当前焦点输入框
    function brInputText() {
        if (!brActive()) { brToast('先切到浏览器页签'); return; }
        var t = prompt('要输入到网页里的文字（会打进页面当前聚焦的输入框）：', '');
        if (t === null || t === undefined) return;
        t = String(t);
        if (!t) return;
        brApi('key', { text: t }).then(function () {
            brToast('✅ 已输入到网页（' + t.length + ' 字）');
        }, function () { brToast('输入失败'); });
    }
    function brRefresh() {
        if (!brActive()) return;
        var view = brEl('.wb-br-view');
        brDarkApply();
        brTabsRender();
        // 视频流模式：MJPEG 自动推帧，不再轮询拉单张图（避免闪烁与轮询延迟）；
        // 流没连上时（首次/断流兜底）才退回单张截图
        if (!br.streamOn) {
            var pull = function () { view.src = '/api/browser?action=shot&fmt=jpeg&session=' + encodeURIComponent(br.session) + '&t=' + Date.now(); };
            // 首拍兜底：会话从未截过图时 GET shot 返回 404 → 白屏。先让后端现拍一张再拉图
            brApi('shot_jpeg').then(pull, pull);
        }
        brApi('status').then(function (s) {
            if (s && s.ok) {
                br.url = s.url || br.url;
                var ub = brEl('.wb-br-url');
                if (document.activeElement !== ub) ub.value = br.url;
                brToast(br.url || '就绪');
                brPersistSave(s.active);
                // 重启/刷新后首次激活：恢复上次保存的活动标签
                if (!br.tabRestored) {
                    br.tabRestored = true;
                    try {
                        var ls = JSON.parse(localStorage.getItem('wbBr_' + brSlotKey()) || 'null');
                        if (ls && typeof ls.active === 'number' && ls.active !== s.active) {
                            brApi('switchtab', { index: ls.active }).then(function () { brTabsRender(); brRefresh(); }, function () {});
                        }
                    } catch (e) {}
                }
            }
        }, function () {});
    }
    function brPoll() {
        if (!br || br.busy || !brActive()) return;
        br.busy = true;
        // 视频流已由服务端推帧：轮询只用来同步网址，不再拉截图
        // changed 必须声明在 brPoll 作用域：第二个 .then 里要读它开追赶模式
        var changed = false;
        brApi('status').then(function (r) {
            var followNeeded = false;
            if (r && r.ok && r.url && r.url !== br.url) {
                br.url = r.url; changed = true; var ub = brEl('.wb-br-url'); if (document.activeElement !== ub) ub.value = r.url;
                // AI 侧导航/开新标签时，底部标签条要跟着变（只在变化时重渲染，低频）
                brPersistSave();
                brTabsRender();
            }
            // AI 开/关非活动标签时 active 不变，靠 tabs 签名（URL 序列）变化刷新标签条，
            // 用签名而非数量，覆盖"关一开数量不变"的场景
            if (r && r.ok && Array.isArray(r.tabs)) {
                var tabsSig = r.tabs.map(function (t) { return (t && t.url) || ''; }).join('|') + '#' + r.tabs.length;
                if (tabsSig !== br.lastTabsSig) {
                    br.lastTabsSig = tabsSig; changed = true;
                    brTabsRender();
                }
            }
            // AI 在无头侧切换/新开/关闭标签时，工作台画面自动跟随活动标签
            if (r && r.ok && typeof r.active === 'number') {
                if (typeof br.lastActive !== 'number') br.lastActive = r.active;
                else if (br.lastActive !== r.active) { br.lastActive = r.active; followNeeded = true; changed = true; }
            } else if (r && !r.ok) {
                // 会话被 kill_session 重建等情况下 status 不可用：重置基线，
                // 避免重建后拿旧 lastActive 误判"变化"多触发一次断流重连
                br.lastActive = undefined;
                br.lastTabsSig = undefined;
            }
            if (followNeeded) {
                br.sig = '';
                // 仅人操作时才持久化标签偏好，AI 侧切换不覆盖用户上次停留的标签
                if (!r.ai_active || r.human_active) brPersistSave(br.lastActive);
                brTabsRender();
                // MJPEG 流推的是「活动页」帧，服务端 switchtab 时已切源；断流重连确保立刻跟上
                if (br.streamOn) { brStreamStop(); setTimeout(brStreamStart, 120); } else brRefresh();
                if (r.ai_active && !r.human_active) brToast('🤖 AI 切换到标签 ' + br.lastActive);
            }
            // AI 操作中提示：ai_active 且人不在操作时显示（人优先），
            // 屏蔽范围含画面/地址栏/工具栏/标签条，防止人机竞态
            try {
                var lock = brEl('.wb-br-ailock');
                if (lock) {
                    var on = !!(r && r.ok && r.ai_active && !r.human_active);
                    lock.style.display = on ? 'block' : 'none';
                    var vw = brEl('.wb-br-view');
                    if (vw) vw.style.pointerEvents = on ? 'none' : '';
                    var ub = brEl('.wb-br-url');
                    if (ub) ub.disabled = !!on;
                    var bar = brEl('.wb-br-toolbar');
                    if (bar) bar.style.pointerEvents = on ? 'none' : '';
                    var tbs = brEl('.wb-br-tabs');
                    if (tbs) tbs.style.pointerEvents = on ? 'none' : '';
                }
            } catch (e) {}
        }, function () {}).then(function () {
            br.busy = false;
            // 有变化 → 进入追赶模式：200ms 高频轮询 2s，追 AI 快速操作链
            if (changed) br.fastUntil = Date.now() + 2000;
        });
    }
    // 自适应轮询：稳定期 600ms；检测到 AI 变化后进入追赶期（200ms 高频），
    // 持续 2s 无新变化再回落——AI 快速连续操作时能逐拍跟上，不错过中间态
    function brPollLoop() {
        br.timer = setTimeout(function () {
            brPoll();
            brPollLoop();
        }, br.fastUntil && Date.now() < br.fastUntil ? 200 : 600);
    }
    function brStartPoll() { brStopPoll(); brPollLoop(); }
    function brStopPoll() { if (br && br.timer) { clearTimeout(br.timer); br.timer = 0; } }
    function brNav(u) {
        u = (u || '').trim();
        if (!u) return;
        if (!/^https?:/i.test(u) && !/^about:/i.test(u)) {
            u = u.indexOf(' ') < 0 && u.indexOf('.') > 0 ? 'http://' + u : 'https://www.bing.com/search?q=' + encodeURIComponent(u);
        }
        brToast('正在加载 ' + u + ' …');
        brProgStart();
        brHistAdd(curSlot || hostBox.dataset.wbSlot || 'default', u);
        brApi('goto', { url: u }).then(function (res) {
            if (!res || !res.ok) { brProgDone(false); brToast('打开失败: ' + ((res && res.error) || '未知错误')); return; }
            br.url = res.url; br.sig = '';
            brEl('.wb-br-url').value = res.url;
            brHistAdd(curSlot || hostBox.dataset.wbSlot || 'default', res.url);
            brProgDone(true);
            brToast('完成 · ' + res.url);
            brPersistSave();
            brSyncFavIcon();
            brRefresh();
        }, function () { brProgDone(false); brToast('请求失败：无法连接浏览器服务，请稍后重试'); });
    }
    // ---------- 多标签页：人可看、可点切换、可关（走后端 tabs/newtab/switchtab/closetab） ----------
    function brTabsRender() {
        var bar = brEl('.wb-br-tabs');
        if (!bar) return;
        brApi('tabs').then(function (r) {
            if (!r || !r.ok || !r.tabs || !r.tabs.length) { bar.innerHTML = ''; return; }
            var activeIdx = (typeof r.active === 'number') ? r.active : -1;
            var esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); };
            var short = function (u) { try { return (new URL(u)).host || u; } catch (e) { return u || '空白页'; } };
            var html = r.tabs.map(function (t) {
                var act = t.index === activeIdx;
                return '<span class="wb-br-tab" data-tidx="' + t.index + '" title="' + esc(t.url) + '\n左键切换 · 右键/✕关闭" style="display:inline-flex;align-items:center;gap:4px;max-width:170px;padding:3px 8px;border-radius:6px;cursor:pointer;flex:none;font-size:11px;color:' + (act ? '#fff' : '#8a94a6') + ';background:' + (act ? '#2f6fed' : '#1a212c') + ';border:1px solid ' + (act ? '#2f6fed' : '#2c3644') + ';white-space:nowrap;">' +
                    '<span class="wb-br-tab-t" style="overflow:hidden;text-overflow:ellipsis;">' + esc(t.title || short(t.url) || '空白页') + '</span>' +
                    '<span class="wb-br-tab-x" data-tclose="' + t.index + '" style="opacity:.7;cursor:pointer;flex:none;">✕</span></span>';
            }).join('');
            html += '<span class="wb-br-tab-plus" title="新开一个标签页" style="flex:none;padding:3px 9px;border-radius:6px;cursor:pointer;font-size:12px;color:#8a94a6;background:#1a212c;border:1px solid #2c3644;">＋</span>';
            bar.innerHTML = html;
            bar.querySelectorAll('.wb-br-tab').forEach(function (el) {
                el.addEventListener('click', function (ev) {
                    var x = ev.target.closest ? ev.target.closest('.wb-br-tab-x') : null;
                    var idx = parseInt(el.dataset.tidx, 10);
                    if (x) {
                        ev.stopPropagation();
                        brApi('closetab', { index: idx }).then(function (r2) {
                            if (r2 && r2.ok) { brToast('已关闭标签 ' + idx); br.sig = ''; brTabsRender(); brRefresh(); if (br.streamOn) brStreamStart(); }
                            else brToast('关闭失败: ' + ((r2 && r2.error) || ''));
                        });
                    } else {
                        brApi('switchtab', { index: idx }).then(function (r2) {
                            if (r2 && r2.ok) {
                                br.url = r2.url || ''; br.sig = '';
                                var ub = brEl('.wb-br-url'); if (ub && document.activeElement !== ub) ub.value = br.url;
                                brToast('已切换: ' + br.url);
                                brPersistSave(idx);
                                brSyncFavIcon();
                                brRefresh();  // brRefresh 内部已含 brTabsRender，去掉重复调用
                            } else brToast('切换失败: ' + ((r2 && r2.error) || ''));
                        });
                    }
                });
                el.addEventListener('contextmenu', function (ev) {
                    ev.preventDefault();
                    var idx = parseInt(el.dataset.tidx, 10);
                    brApi('closetab', { index: idx }).then(function (r2) {
                        if (r2 && r2.ok) { brToast('已关闭标签 ' + idx); brTabsRender(); brRefresh(); }
                        else brToast('关闭失败: ' + ((r2 && r2.error) || ''));
                    });
                });
            });
            var plus = bar.querySelector('.wb-br-tab-plus');
            if (plus) plus.addEventListener('click', function () { brTabNew(); });
        }, function () {});
    }
    function brTabNew(url) {
        brApi('newtab', url ? { url: url } : {}).then(function (r) {
            if (r && r.ok) {
                br.url = r.url || 'about:blank'; br.sig = '';
                var ub = brEl('.wb-br-url'); if (ub) ub.value = br.url;
                brToast('✅ 已新开标签 ' + r.index + (url ? ' → ' + url : ''));
                brPersistSave(r.index);
                brSyncFavIcon();
                brTabsRender(); brRefresh();
            } else brToast('新开标签失败: ' + ((r && r.error) || ''));
        }, function () { brToast('新开标签失败：无法连接浏览器服务'); });
    }
    function brToPageXY(ev) {
        var view = brEl('.wb-br-view'), vr = view.getBoundingClientRect();
        var scale = Math.min(vr.width / br.vp.w, vr.height / br.vp.h);
        var ox = (vr.width - br.vp.w * scale) / 2, oy = (vr.height - br.vp.h * scale) / 2;
        return { x: Math.round((ev.clientX - vr.left - ox) / scale), y: Math.round((ev.clientY - vr.top - oy) / scale) };
    }
    var _brBound = false;
    function brBindOnce() {
        if (_brBound) return;
        _brBound = true;
        var view = brEl('.wb-br-view');
        var wrap = brEl('.wb-br-view-wrap');
        view.addEventListener('mousedown', function (ev) {
            if (document.activeElement === brEl('.wb-br-url')) return;
            ev.preventDefault();
            // 画面获得焦点：随后键盘按键才转发给网页（否则网页输入框打不了字）
            try { view.focus({ preventScroll: true }); } catch (e) { try { view.focus(); } catch (e2) {} }
            var p = brToPageXY(ev);
            // 📌 标记模式：不转发点击到页面，改为采集标记
            if (brMarkMode && ev.button === 0) { brMarkClick(p, view); return; }
            // 🎯 圈问模式：左键拖框，松开后裁剪发AI
            if (brLassoMode && ev.button === 0) {
                var box = brLassoEnsureBox();
                var wr = view.getBoundingClientRect();
                var sx = ev.clientX - wr.left, sy = ev.clientY - wr.top;
                box.style.display = 'block';
                var move = function (e2) {
                    var cx = Math.min(Math.max(e2.clientX - wr.left, 0), wr.width), cy = Math.min(Math.max(e2.clientY - wr.top, 0), wr.height);
                    box.style.left = Math.min(sx, cx) + 'px'; box.style.top = Math.min(sy, cy) + 'px';
                    box.style.width = Math.abs(cx - sx) + 'px'; box.style.height = Math.abs(cy - sy) + 'px';
                };
                var up = function (e2) {
                    document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
                    var rect = { x: parseFloat(box.style.left), y: parseFloat(box.style.top), w: parseFloat(box.style.width), h: parseFloat(box.style.height) };
                    box.style.display = 'none';
                    if (rect.w < 8 || rect.h < 8) { brToast('框太小了，重新框一次'); return; }
                    brLassoSend(rect, view);
                };
                document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
                return;
            }
            var acts = { 0: 'click', 1: 'middleclick', 2: 'rightclick' };
            var body = { x: p.x, y: p.y };
            if (ev.detail >= 2) body.clickCount = 2;
            brApi(acts[ev.button] || 'click', body).then(function (res) { if (res && res.url) br.url = res.url; brRefresh(); }, function () {});
        });
        view.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
        view.addEventListener('wheel', function (ev) {
            ev.preventDefault();
            var p = brToPageXY(ev);
            if (!view._wp) view._wp = { x: p.x, y: p.y, dy: 0, t: 0 };
            var wp = view._wp; wp.x = p.x; wp.y = p.y; wp.dy += ev.deltaY;
            if (wp.t) clearTimeout(wp.t);
            wp.t = setTimeout(function () { wp.t = 0; brApi('wheel', { x: wp.x, y: wp.y, deltaY: wp.dy }).then(brRefresh, function () {}); }, 60);
        }, { passive: false });
        // ===== 自绘滚动条：截图流没有原生滚动条，这里自画一条，可点击/拖拽滚动远端页面 =====
        var sbTrack = brEl('.wb-br-sbtrack'), sbThumb = brEl('.wb-br-sbthumb');
        var brSbTimer = 0;
        var brScrollUpdate = function () {
            brApi('scrollinfo').then(function (info) {
                if (!info || !info.ok) return;
                var sh = info.sh || 0, ch = info.ch || 0, sy = info.sy || 0;
                br._sbSh = sh; br._sbCh = ch;
                if (sh <= ch + 4) { sbTrack.style.display = 'none'; return; }   // 页面不满一屏，不显示
                sbTrack.style.display = 'block';
                var h = sbTrack.clientHeight || 1;
                var th = Math.max(24, h * ch / sh);
                var ty = (h - th) * (sy / (sh - ch));
                sbThumb.style.height = th + 'px';
                sbThumb.style.top = ty + 'px';
            }, function () {});
        };
        var brScrollSchedule = function () {
            if (brSbTimer) return;
            brSbTimer = setTimeout(function () { brSbTimer = 0; brScrollUpdate(); }, 200);
        };
        sbTrack.addEventListener('mousedown', function (ev) {
            ev.preventDefault(); ev.stopPropagation();
            var sh = br._sbSh || 0, ch = br._sbCh || 0;
            if (sh <= ch) return;
            var moveTo = function (clientY) {
                var rect = sbTrack.getBoundingClientRect();
                var ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
                var th = Math.max(24, sbTrack.clientHeight * ch / sh);
                var maxScroll = sh - ch;
                var sy = ratio * (maxScroll + th) - th / 2;   // 滑块中心大致对齐指针
                sy = Math.min(maxScroll, Math.max(0, sy));
                brApi('scrollto', { y: sy }).then(brScrollUpdate, function () {});
            };
            moveTo(ev.clientY);
            var lastMove = 0;
            var mv = function (e2) { var now = Date.now(); if (now - lastMove < 80) return; lastMove = now; moveTo(e2.clientY); };   // 80ms 节流，防拖拽堆叠请求
            var up = function () { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
            document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
        });
        // 滚轮/点击后刷新滑块位置；另有低频兜底轮询
        view.addEventListener('wheel', brScrollSchedule);
        var sbPoll = setInterval(function () {
            if (!document.contains(drawer)) { clearInterval(sbPoll); return; }   // 抽屉销毁后自动清理，避免定时器累积
            if (brActive()) brScrollSchedule();
        }, 1500);
        // 键盘输入转发：只在「画面自身持有焦点」时生效——
        // 焦点在地址栏/主界面输入框时完全放行，绝不干扰主界面打字；
        // 点中网页输入框（画面聚焦）后，本机键盘即可直接往网页里打字。
        var BR_KEYS = { Enter: 1, Backspace: 1, Delete: 1, Tab: 1, Escape: 1,
                        ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
                        Home: 1, End: 1, PageUp: 1, PageDown: 1 };
        view.addEventListener('keydown', function (ev) {
            if (!br || !brActive()) return;
            if (document.activeElement !== view) return;
            var k = ev.key;
            if (k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta') return;
            var mod = ev.ctrlKey || ev.metaKey;
            var sent = null;
            if (mod && k.length === 1) {
                var lk = k.toLowerCase();
                if ('cvaxzsfpwy'.indexOf(lk) >= 0) sent = (ev.metaKey ? 'Meta+' : 'Control+') + lk;
            } else if (!mod && !ev.altKey && k.length === 1) {
                sent = k;                                        // 普通可打印字符（含空格）
            } else if (BR_KEYS[k]) {
                sent = k;                                        // 编辑/导航键
            }
            if (!sent) return;
            ev.preventDefault();
            ev.stopPropagation();
            brApi('key', { key: sent });                          // 画面由视频流自动刷新，无需手动拉图
        });
        // 视频流断线自动重连（后端重启/被顶掉后 1.5s 恢复）
        view.addEventListener('error', function () {
            if (!br || !br.streamOn || !brActive()) return;
            if (view._brReconnecting) return;
            view._brReconnecting = true;
            setTimeout(function () {
                view._brReconnecting = false;
                if (br && br.streamOn && brActive()) brStreamStart();
            }, 1500);
        });

        drawer.querySelector('.wb-br-bar').addEventListener('click', function (ev) {
            var b = ev.target.closest('[data-brnav]');
            if (!b) return;
            var n = b.dataset.brnav;
            if (n === 'go') brNav(brEl('.wb-br-url').value);
            else if (n === 'fav') brToggleFav();
            else if (n === 'history') {
                var hl = brEl('.wb-br-histlist');
                if (hl && hl.style.display !== 'none') brHistHide();
                else { brSyncFavIcon(); brHistRender(''); }
            }
            else if (n === 'maplinks') brMapLinks();
            else if (n === 'dark') brDarkToggle();
            else if (n === 'fps') {
                // 帧率三档循环 8→15→24（后端 mjpeg 支持 4~30），切换后断流重连生效
                br.fps = (br.fps || 15) === 8 ? 15 : (br.fps === 15 ? 24 : 8);
                var ft = brEl('.wb-br-fps-txt'); if (ft) ft.textContent = br.fps + 'fps';
                // 帧率偏好走后端 UserSettings（项目禁 localStorage 规范），白名单 8/15/24
                try { if (window.UserSettings) UserSettings.set('wb_br_fps', String(br.fps)); } catch (e) {}
                if (br.streamOn) {
                    var v2 = brEl('.wb-br-view');
                    if (v2) { v2.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='; setTimeout(brStreamStart, 120); }
                }
                brToast('画面帧率已切换为 ' + br.fps + ' fps');
            }
            else if (n === 'mark') brMarkToggle();
            else if (n === 'lasso') brLassoToggle();
            else if (n === 'viewsource') brViewSource();
            else if (n === 'askai') brAskAI();
            else if (n === 'archive') brArchive();
            else if (n === 'archpanel') brArchList();
            else if (n === 'mempanel') brMemList('');
            else if (n === 'inputtext') brInputText();
            else if (n === 'hardreload') {
                // 强制刷新：绕过缓存重新加载整个页面（等同 Ctrl+F5）
                if (window.sessionStorage) { try { sessionStorage.setItem('__wbHardReload', '1'); } catch (e) {} }
                location.reload(true);
            }
            else if (n === 'errlog') {
                var logs = (window.__wbErrLog || []).join('\n');
                if (!logs) logs = '（没有捕获到任何 JS 报错，页面运行正常）';
                var txt = '=== 页面 JS 错误日志 ===\n' + logs + '\n=== UA: ' + navigator.userAgent + ' ===';
                var showAndCopy = function () {
                    try {
                        var ta = document.createElement('textarea');
                        ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
                        document.body.appendChild(ta); ta.select();
                        var ok = false;
                        try { ok = document.execCommand('copy'); } catch (e) {}
                        document.body.removeChild(ta);
                        brToast(ok ? '✅ 错误日志已复制，可直接粘贴发给AI' : '⚠️ 复制失败，请手动选中下方文本复制');
                    } catch (e) {}
                    alert(txt.length > 3000 ? txt.slice(0, 3000) + '\n…(已截断，完整内容已复制到剪贴板)' : txt);
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(txt).then(showAndCopy, showAndCopy);
                } else showAndCopy();
            }
            else brApi(n === 'reload' ? 'reload' : n).then(function (r) { if (r && r.url) br.url = r.url; brRefresh(); }, function () {});
        });
        // 历史下拉项点击（委托到地址栏行）
        drawer.querySelector('.wb-br-bar').addEventListener('click', function (ev) {
            var uf = ev.target.closest ? ev.target.closest('[data-unfav]') : null;
            if (uf) {
                ev.preventDefault(); ev.stopPropagation();
                var slotU = br ? br.session : 'default';
                var fs = brFavLoad(slotU).filter(function (x) { return x !== uf.dataset.unfav; });
                try { localStorage.setItem(brFavKey(slotU), JSON.stringify(fs)); } catch (e) {}
                brToast('已取消收藏');
                brSyncFavIcon(); brHistRender((brEl('.wb-br-url') || {}).value || '');
                return;
            }
            var it = ev.target.closest('[data-histgo]');
            if (!it) return;
            ev.preventDefault();
            brHistHide();
            brNav(it.dataset.histgo);
        });
        // 地址栏：聚焦弹历史、输入过滤、失焦/回车收起
        (function () {
            var ub = brEl('.wb-br-url');
            if (!ub) return;
            ub.addEventListener('focus', function () { brSyncFavIcon(); brHistRender(ub.value); });
            ub.addEventListener('input', function () { brHistRender(ub.value); });
            ub.addEventListener('blur', function () { setTimeout(brHistHide, 180); });
            ub.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault(); e.stopPropagation();
                    brHistHide(); brTabNew(ub.value);
                }
            });
        })();
        // 点击抽屉其他位置收起历史下拉
        drawer.addEventListener('mousedown', function (ev) {
            if (!ev.target.closest('.wb-br-bar')) brHistHide();
        });
        // 档案面板内点击
        brEl('.wb-br-arch').addEventListener('click', function (ev) {
            var a = ev.target.closest('a');
            if (!a) return;
            ev.preventDefault();
            if (a.dataset.brarchact === 'close') brArchRender('');
            else if (a.dataset.brarchact === 'copysrc') {
                ev.preventDefault();
                var pre = document.getElementById(a.dataset.brsrcid);
                var raw = pre ? decodeURIComponent(pre.dataset.rawsrc || '') : '';
                if (!raw) { brToast('无源码可复制'); return; }
                var done = function () { brToast('✅ 已复制 ' + raw.length + ' 字符到剪贴板'); a.innerHTML = '<svg class="wb-line-ico" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> 已复制'; setTimeout(function () { a.innerHTML = '<svg class="wb-line-ico" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg> 复制源码'; }, 2000); };
                if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(raw).then(done, function () {
                    var ta = document.createElement('textarea'); ta.value = raw; document.body.appendChild(ta); ta.select();
                    var _ok2 = false; try { _ok2 = document.execCommand('copy'); } catch (e) {}
                    document.body.removeChild(ta);
                    if (_ok2) done(); else { brToast('⚠️ 复制失败，请手动选择文本复制'); a.innerHTML = '<svg class="wb-line-ico" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg> 复制源码'; }
                });
                else { var ta = document.createElement('textarea'); ta.value = raw; document.body.appendChild(ta); ta.select(); var _ok3 = false; try { _ok3 = document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); if (_ok3) done(); else brToast('⚠️ 复制失败，请手动选择文本复制'); }
            }
            else if (a.dataset.brarchact === 'save') brArchive();
            else if (a.dataset.brarchurl) brArchOpen(a.dataset.brarchurl);
            else if (a.dataset.brarchfile) fetch('/项目记录/网站档案/' + a.dataset.brarchfile).then(function (r) { return r.text(); }).then(function (t) {
                brArchRender('<b style="color:#dfe9ff">📄 ' + a.dataset.brarchfile + '</b>　<a href="#" data-brarchact="close" style="color:#6b7686">收起</a><hr style="border-color:#2a313d"><pre style="white-space:pre-wrap;color:#9fb2c9;font-size:11px;max-height:300px;overflow:auto">' + t.replace(/</g, '&lt;') + '</pre>');
            });
            else if (a.dataset.brarchdiff) brArchDiff(a.dataset.brarchdiff);
        });
        // 记忆面板内点击：直达网址 / 收起
        brEl('.wb-br-arch').addEventListener('click', function (ev) {
            var a = ev.target.closest('[data-brmemgo], [data-brmemact]');
            if (!a) return;
            ev.preventDefault();
            if (a.dataset.brmemgo) { brArchRender(''); brNav(a.dataset.brmemgo); }
            else if (a.dataset.brmemact === 'close') brArchRender('');
        });
        // 回车跳转：挂在 document 捕获阶段定向接管，防止其他全局 keydown 处理器抢先拦截/吞掉 Enter
        document.addEventListener('keydown', function (e) {
            var ub = brEl('.wb-br-url');
            if (!ub || e.target !== ub) return;
            if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); brNav(ub.value); }
        }, true);
        // 视口跟随抽屉尺寸变化
        if (window.ResizeObserver) new ResizeObserver(function () { if (brActive()) brResizeSync(); }).observe(wrap);
    }
    // --- 网站档案：抓链接 / 存档 / 档案面板 ---
    function brArchPanel() { return brEl('.wb-br-arch'); }
    function brArchRender(html) { var p = brArchPanel(); p.innerHTML = html; p.style.display = html ? 'block' : 'none'; }
    function brMapLinks() {
        brToast('正在抓取同域链接…');
        brApi('map_site', {}).then(function (r) {
            if (!r || !r.ok) { brToast('抓取失败: ' + ((r && r.error) || '')); return; }
            var links = r.links || [];
            var h = '<b style="color:#dfe9ff">🔗 ' + (r.domain || '') + ' 共 ' + links.length + ' 个链接</b>　' +
                '<a href="#" data-brarchact="save" style="color:#6ea8ff">💾 存入档案</a>　' +
                '<a href="#" data-brarchact="close" style="color:#6b7686">收起</a><hr style="border-color:#2a313d">';
            links.slice(0, 300).forEach(function (l) {
                h += '<div style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">· <a href="#" data-brarchurl="' + l.url.replace(/"/g, '&quot;') + '" style="color:#9fb2c9">' + (l.text || l.url).replace(/</g, '&lt;').slice(0, 60) + '</a></div>';
            });
            if (links.length > 300) h += '<div style="color:#6b7686">…仅预览前 300 条，存档保留全部</div>';
            brArchRender(h);
            brToast('抓到 ' + links.length + ' 个链接，可点「存入档案」');
        }, function () { brToast('请求失败'); });
    }
    function brArchive() {
        brToast('正在抓取并存入档案…');
        brApi('archive_site', {}).then(function (r) {
            if (!r || !r.ok) { brToast('存档失败: ' + ((r && r.error) || '')); return; }
            brToast('✅ 已存档 ' + (r.domain || '') + '：' + ((r.added != null) ? ('新增 ' + r.added + ' 条，') : '') + '共 ' + (r.total || (r.links || []).length) + ' 条 → public/项目记录/网站档案/');
            brArchList();
        }, function () { brToast('请求失败'); });
    }
    function brArchList() {
        var p = brArchPanel();
        fetch('/项目记录/网站档案/_索引.md?t=' + Date.now()).then(function (r) { return r.ok ? r.text() : Promise.reject(0); }).then(function (t) {
            var h = '<b style="color:#dfe9ff">📁 网站档案库</b>　<a href="#" data-brarchact="close" style="color:#6b7686">收起</a><hr style="border-color:#2a313d">';
            // 解析索引中的档案行：- [域名](域名.md) …
            var re = /\[([^\]]+)\]\(([^)]+\.md)\)/g, m, found = 0;
            while ((m = re.exec(t))) {
                if (m[2].charAt(0) === '/') continue;
                found++;
                h += '<div>📄 <a href="#" data-brarchfile="' + m[2] + '" style="color:#9fb2c9">' + m[1] + '</a>　' +
                     '<a href="#" data-brarchdiff="' + m[1] + '" style="color:#6ea8ff">复查diff</a>　' +
                     '<a href="/项目记录/网站档案/' + m[2] + '" target="_blank" style="color:#6b7686">原文</a></div>';
            }
            if (!found) h += '<div style="color:#6b7686">暂无档案（浏览网站后点「💾 存档案」生成）</div>';
            brArchRender(h);
        }, function () {
            brArchRender('<b style="color:#dfe9ff">📁 网站档案库</b>　<a href="#" data-brarchact="close" style="color:#6b7686">收起</a><hr style="border-color:#2a313d"><div style="color:#6b7686">暂无档案索引（先浏览网站并「💾 存档案」）</div>');
        });
    }
    function brArchDiff(domain) {
        brToast('正在复查 ' + domain + ' …');
        brApi('archive_site', { mode: 'diff' }).then(function (r) {
            if (!r || !r.ok) { brToast('复查失败: ' + ((r && r.error) || '')); return; }
            var added = r.new_links || [], gone = r.gone_links || [];
            var h = '<b style="color:#dfe9ff">🔍 ' + domain + ' 复查结果</b>　<a href="#" data-brarchact="close" style="color:#6b7686">收起</a><hr style="border-color:#2a313d">';
            h += '<div style="color:#7ee787">🆕 新增 ' + added.length + ' 条</div>';
            added.slice(0, 50).forEach(function (u) { h += '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">· <a href="#" data-brarchurl="' + u.replace(/"/g, '&quot;') + '" style="color:#9fb2c9">' + u.replace(/</g, '&lt;') + '</a></div>'; });
            h += '<div style="color:#ff7b72;margin-top:4px">💀 失效 ' + gone.length + ' 条</div>';
            gone.slice(0, 50).forEach(function (u) { h += '<div style="color:#6b7686;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">· ' + u.replace(/</g, '&lt;') + '</div>'; });
            h += '<div style="margin-top:6px"><a href="#" data-brarchact="save" style="color:#6ea8ff">💾 把最新抓取合并存档</a></div>';
            brArchRender(h);
        }, function () { brToast('请求失败'); });
    }
    function brArchOpen(url) { brNav(url); brArchRender(''); }
    // ---------- 📚 记忆面板：浏览笔记+历史+收藏聚合时间线，可搜索、点击直达（复用档案面板容器） ----------
    function brMemPanel() { return brEl('.wb-br-arch'); }
    function brMemList(filter) {
        var slot = br ? br.session : 'default';
        var ns = 'wb_br_notes_' + (curSlot || hostBox.dataset.wbSlot || 'default');
        var notes = [], favs = [], hist = [];
        try { notes = JSON.parse(localStorage.getItem(ns) || '[]'); } catch (e) {}
        try { favs = brFavLoad(slot); } catch (e) {}
        try { hist = JSON.parse(localStorage.getItem(brHistKey(slot)) || '[]'); } catch (e) {}
        var f = (filter || '').toLowerCase();
        var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); };
        var short = function (u) { try { return (new URL(u)).host + (new URL(u)).pathname.replace(/\/$/, ''); } catch (e) { return u; } };
        var match = function (u, t) { u = (u || '').toLowerCase(); t = (t || '').toLowerCase(); return !f || u.indexOf(f) >= 0 || t.indexOf(f) >= 0; };
        var noteHit = {}, favSet = {}; favs.forEach(function (u) { favSet[u] = 1; });
        var h = '<b style="color:#dfe9ff">📚 浏览记忆</b>　' +
            '<input class="wb-br-memsearch" placeholder="搜索 网址/标题/摘要…" value="' + esc(filter) + '" style="width:150px;background:#0e131c;border:1px solid #2c3644;color:#dfe9ff;border-radius:6px;padding:2px 6px;font-size:11px;vertical-align:middle">　' +
            '<a href="#" data-brmemact="close" style="color:#6b7686">收起</a><hr style="border-color:#2a313d">';
        var nShow = 0;
        notes.forEach(function (n) {
            if (!match(n.url, (n.title || '') + ' ' + (n.brief || ''))) return;
            nShow++; noteHit[n.url] = 1;
            var d = new Date(n.t || Date.now());
            h += '<div style="margin:4px 0">📝 <a href="#" data-brmemgo="' + esc(n.url) + '" style="color:#9fb2c9">' + esc((n.title || short(n.url)).slice(0, 40)) + '</a>' +
                (favSet[n.url] ? ' <span style="color:#f0b429">★</span>' : '') +
                '<div style="color:#6b7686;font-size:10px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">' + esc(short(n.url)) + ' · ' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0') + '</div>' +
                '<div style="color:#5f7494;font-size:10px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">' + esc((n.brief || '').slice(0, 80)) + '</div></div>';
        });
        var hShow = 0;
        hist.forEach(function (u) {
            if (noteHit[u] || !match(u, '')) return;
            hShow++;
            h += '<div style="margin:2px 0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">' + (favSet[u] ? '<span style="color:#f0b429">★</span>' : '·') + ' <a href="#" data-brmemgo="' + esc(u) + '" style="color:#6b7686">' + esc(short(u)) + '</a></div>';
        });
        if (!nShow && !hShow) h += '<div style="color:#6b7686">暂无记忆（浏览网页并点「💬问AI」会自动存摘要）</div>';
        else h += '<div style="color:#4a5568;font-size:10px;margin-top:4px">笔记 ' + nShow + ' 条 · 其余历史 ' + hShow + ' 条 · 收藏 ' + favs.length + ' 条</div>';
        brArchRender(h);
        var sb = brMemPanel().querySelector('.wb-br-memsearch');
        if (sb) sb.addEventListener('input', function () { brMemList(sb.value); });
    }
    function brViewSource() {
        brToast('正在获取页面内容/源码…');
        brApi('content', { mode: 'raw' }).then(function (r) {
            if (!r || !r.ok) { brToast('获取失败: ' + ((r && r.error) || '')); return; }
            var t = ((r.html || '') + '\n\n【正文摘要】\n' + (r.title || '')).replace(/</g, '&lt;');
            var srcId = 'wb-src-' + Date.now();
            brArchRender('<b style="color:#dfe9ff">&lt;/&gt; 页面源码 · ' + ((r.url || br.url || '').replace(/</g, '&lt;')) + '</b>　' +
                '<a href="#" data-brarchact="copysrc" data-brsrcid="' + srcId + '" style="color:#6ea8ff"><svg class="wb-line-ico" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg> 复制源码</a>　' +
                '<a href="#" data-brarchact="close" style="color:#6b7686">收起</a><hr style="border-color:#2a313d"><pre id="' + srcId + '" data-rawsrc="' + encodeURIComponent(r.html || '') + '" style="white-space:pre-wrap;color:#9fb2c9;font-size:11px;max-height:340px;overflow:auto">' + t + '</pre>');
            brToast('已显示源码（约 ' + (encodeURIComponent(r.html || '').length / 1024).toFixed(1) + ' KB）');
        }, function () { brToast('请求失败'); });
    }
    // ---------- 💬问AI：把当前页网址+正文摘要塞进对话输入框 ----------
    function brAskAI() {
        if (!br.url || br.url === 'about:blank') { brToast('当前没有打开的网页'); return; }
        brToast('正在获取页面正文…');
        brApi('content', { mode: 'raw' }).then(function (r) {
            var box = document.querySelector('.chatbox.focused') || document.querySelector('.chatbox');
            if (!box) { brToast('没有可用的对话窗口'); return; }
            var input = box.querySelector('textarea') || box.querySelector('[contenteditable="true"]');
            if (!input) { brToast('找不到对话输入框'); return; }
            var body = (r && r.ok && r.html) ? String(r.html) : '';
            // 去标签取正文，压掉多余空白
            var text = body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
            if (text.length > 3000) text = text.slice(0, 3000) + '…（已截断）';
            var url = (r && r.url) || br.url;
            var title = (r && r.title) || '';
            // 📚 浏览笔记：问AI 时自动存一条摘要（localStorage 按 slot，上限 200 条滚动）
            try {
                var ns = 'wb_br_notes_' + (curSlot || hostBox.dataset.wbSlot || 'default');
                var notes = JSON.parse(localStorage.getItem(ns) || '[]');
                notes.unshift({ url: url, title: title, brief: text.slice(0, 160), t: Date.now() });
                if (notes.length > 200) notes = notes.slice(0, 200);
                localStorage.setItem(ns, JSON.stringify(notes));
                wbStoreSave('notes_' + (curSlot || hostBox.dataset.wbSlot || 'default'), notes);   // 云同步
            } catch (e) {}
            var msg = '请分析这个网页：\n【网址】' + url + (title ? '\n【标题】' + title : '') + '\n【正文摘要】\n' + text;
            // 人机协作：若抽屉处于「标记模式」，附带最后标记的点位与备注，AI 就知道“人说的是哪里”
            if (brMarkLast && brMarkLast.note) {
                msg = '请分析这个网页（我在页面上标记了一个位置）：\n【标记位置】截图坐标 x=' + Math.round(brMarkLast.x) + ', y=' + Math.round(brMarkLast.y) + '（画面宽 ' + Math.round(brMarkLast.w) + ' × 高 ' + Math.round(brMarkLast.h) + '）\n【标记备注】' + brMarkLast.note + '\n【网址】' + url + (title ? '\n【标题】' + title : '') + '\n【正文摘要】\n' + text;
                brMarkLast = null;
            }
            if (input.tagName === 'TEXTAREA') {
                input.value = input.value ? input.value + '\n' + msg : msg;
            } else {
                input.textContent = input.textContent ? input.textContent + '\n' + msg : msg;
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
            brToast('✅ 已把页面正文写入对话输入框，检查后点发送');
        }, function () { brToast('请求失败'); });
    }

    // 【视频独立】按当前对话同步 video-studio iframe 地址（?conv=），
    // 页签点击和抽屉打开（含切换对话后抽屉停视频页签）都调用，防止 iframe 残留旧对话会话
    function wbVideoEnsure() {
        var vf = drawer.querySelector('.wb-video-frame');
        if (!vf) return;
        var _cid = (window.Tools && Tools.currentChatId) || curSlot || '';
        var _src = '/video-studio.html' + (_cid ? '?conv=' + encodeURIComponent(_cid) : '');
        if (vf.getAttribute('data-lazysrc')) { vf.removeAttribute('data-lazysrc'); vf.src = _src; }
        else if (vf.getAttribute('src') !== _src) vf.src = _src;
    }
    function brActivate() {
        brEnsure();
        brTabsRender();   // 打开浏览器页签即刷新标签条
        brResizeSync(true);
        brStartPoll();
        brStreamStart();
        // 重启兜底：后端会话被回收成 about:blank 但本地记有上次网址时，自动重新打开；
        // 本地没网址时改用后端 status 存档的 url_archived（回收前的"上次页面"，AI 打开的页面也在内）
        brApi('status').then(function (s) {
            var backendUrl = s && s.ok ? (s.url || '') : '';
            var archived = !!(s && s.ok && s.url_archived && backendUrl &&
                backendUrl !== 'about:blank');
            if (archived) {
                // 会话已被空闲回收，backendUrl 是存档值：goto 会惰性重启浏览器恢复该页
                br.url = backendUrl;
                brApi('goto', { url: backendUrl }).then(function () { brRefresh(); },
                    function () { brRefresh(); });
            } else if (br.url && (!backendUrl || backendUrl === 'about:blank')) {
                brApi('goto', { url: br.url }).then(function () { brRefresh(); },
                    function () { brRefresh(); });
            } else {
                if (backendUrl) {
                    br.url = backendUrl;
                    // 补丁：本地原本无网址时占位提示已显示，设置 url 后同步隐藏（MJPEG 不触发 load）
                    if (empty) empty.style.display = 'none';
                }
                if (br.url) brRefresh();
            }
        }, function () { if (br.url) brRefresh(); });
        if (!br.url) empty.style.display = 'flex';
    }

    function toast(msg) {
        var el = drawer && drawer.querySelector('.wb-msg');
        if (el) { el.textContent = msg; setTimeout(function () { if (el.textContent === msg) el.textContent = ''; }, 3000); }
        try { if (window.App && App._toast) App._toast(msg); } catch (e) {}
    }

    // ---------- 事件 ----------
    function bindDrawerEvents() {
        // Tab 切换（图片可用；ppt/video 占位）
        // 【工作台页签全隔离】切换页签时：上一个页签的内容清出当前视图（内存快照），
        // 切回来时再原样恢复；不同页签之间互不带数据。
        var tabStash = {};   // { image: {frag, layers, activeLayerId, sel, view} }
        var curTab = 'browser';
        function deactivateTab(t) {
            if (t === 'image') {
                if (tabStash.image) return;
                var st = stageEl();
                var frag = document.createDocumentFragment();
                Array.prototype.forEach.call(st.childNodes, function (n) { frag.appendChild(n); });
                tabStash.image = {
                    frag: frag,
                    layers: layers,
                    activeLayerId: activeLayerId,
                    sel: sel,
                    view: view
                };
                // 清出当前视图：画布为空，图片不再"带"到其他工作台
                layers = []; activeLayerId = null; sel = null; view = { x: 0, y: 0, scale: 1 };
                clearSelection();
                syncEmptyHint();
                renderLayers();
            }
        }
        function activateTab(t) {
            // 【页签互不关联】切到非「图片」页签（含浏览器）时，丢弃该对话暂存的
            // 粘贴图片与截图关联——浏览器页签说话不再带上图片页签的图。
            // 【放行窗口】发送在途（__sendInFlight）或刚注入识图图（__wbInjectAt 1.5s 内）不删，
            // 避免把圈问/画布识图刚附加的图在切页签瞬间误删。
            if (t && t !== 'image') {
                try {
                    var _now = Date.now();
                    var _bx = document.querySelector('.chatbox.focused');
                    if (_bx && _bx.__sendInFlight) { /* 发送中，不删 */ }
                    else if (_bx && _bx.__wbInjectAt && (_now - _bx.__wbInjectAt) < 1500) { /* 圈问刚注入，不删 */ }
                    else if (_bx && window.App && App._pendingImages && App._pendingImages[_bx.id]) {
                        delete App._pendingImages[_bx.id];
                        if (typeof App.renderPendingImages === 'function') App.renderPendingImages(_bx);
                    }
                } catch (e) {}
            }
            if (t === 'image') {
                var s = tabStash.image;
                if (s && (!layers || !layers.length)) {
                    layers = s.layers; activeLayerId = s.activeLayerId; sel = s.sel; view = s.view;
                    stageEl().appendChild(s.frag);
                    layers.forEach(applyLayerStyle);
                    drawSelOverlay();
                    showOnlyActive();   // 去图层化：恢复后强制单图显示
                    applyView(); updateStatus();
                    syncEmptyHint(); renderLayers();
                }
            }
        }
        // 事件委托：动态注入的页签（如 👥团队/📊数据）也能触发切页
        var _tabsBar = drawer.querySelector('.wb-drawer-tabs');
        if (_tabsBar) _tabsBar.addEventListener('click', function (e) {
            var b = e.target.closest('.wb-tab[data-wbtab]');
            if (!b || !drawer.contains(b)) return;
            {
                var t = b.dataset.wbtab;
                if (t === curTab) return;
                deactivateTab(curTab);
                curTab = t;
                drawer.querySelectorAll('.wb-tab').forEach(function (x) { x.classList.toggle('active', x === b); });
                drawer.querySelectorAll('.wb-workbench').forEach(function (w) { w.classList.toggle('active', w.dataset.wbwork === t); });
                activateTab(t);
                try {
                    saveState();   // 抽屉展开状态即持久化（_open），重启后可恢复
                    localStorage.setItem('wbDrawerTab_' + (hostBox.dataset.wbSlot || curSlot || 'default'), t);   // 页签记忆：重启后恢复上次页签
                    wbStoreSave('tab_' + (hostBox.dataset.wbSlot || curSlot || 'default'), t);   // 云同步
                } catch (e) {}
                if (t === 'image') setTimeout(fitView, 50);
                if (t === 'browser') { brActivate(); }
                else {
                    brStopPoll();
                    brStreamStop();   // 切走页签即断开 MJPEG 流（释放服务端连接）
                    try { var gf = drawer.querySelector('.wb-engine-frame'); if (gf && gf.contentWindow) gf.contentWindow.blur(); } catch (e) {}
                }
                if (t === 'engine') {
                    // 懒加载：首次进入才建 iframe；切走只隐藏不销毁，游戏状态保留
                    var ew = drawer.querySelector('.wb-workbench[data-wbwork="engine"]');
                    if (ew && !ew.querySelector('.wb-engine-frame')) {
                        var hint = ew.querySelector('.wb-eng-empty');
                        var f = document.createElement('iframe');
                        f.className = 'wb-engine-frame';
                        f.src = '/engine2d/index.html';
                        f.allow = 'autoplay; gamepad';
                        f.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;border:none;background:#0d0f14');
                        ew.appendChild(f);
                        if (hint) hint.style.display = 'none';
                        f.addEventListener('load', function () { try { f.contentWindow.focus(); } catch (e) {} });
                    }
                    try { var af = ew.querySelector('.wb-engine-frame'); if (af && af.contentWindow) af.contentWindow.focus(); } catch (e) {}
                }
                if (t === 'video') {
                    wbVideoEnsure();
                }
        }
        });
        drawer.querySelector('.wb-close').addEventListener('click', function () { toggleDrawer(false); });
        drawer.querySelector('.wb-flip').addEventListener('click', function () { flipDrawerSide(); });
        drawer.querySelector('.wb-send').addEventListener('click', sendToAI);

        // 工具条
        drawer.querySelectorAll('.wb-img-toolbar [data-tool]').forEach(function (b) {
            b.addEventListener('click', function () {
                tool = b.dataset.tool;
                drawer.querySelectorAll('.wb-img-toolbar [data-tool]').forEach(function (x) { x.classList.toggle('active', x === b); });
                stageWrap().classList.toggle('wb-selecting', tool === 'select');
                if (tool !== 'select') clearSelection();
            });
        });
        drawer.querySelectorAll('.wb-img-toolbar [data-act]').forEach(function (b) {
            b.addEventListener('click', function () { doAct(b.dataset.act); });
        });
        // 底部：单开关 展开/收起 历史记录 + 图片/视频切换
        var _botOpen = false, _botSrc = 'image';
        var _botSwitch = drawer.querySelector('.wb-bot-switch');
        var _gBox2 = drawer.querySelector('[data-wbbotbody="gallery"]');
        var _toggleBtn = drawer.querySelector('#wbbotToggle');
        function _applyBotVis() {
            if (_botOpen) {
                _gBox2.style.display = 'flex';
                if (_botSwitch) _botSwitch.style.display = 'flex';
                if (_toggleBtn) _toggleBtn.classList.add('active');
                try { renderGalleryTab(); } catch (e) {}
            } else {
                _gBox2.style.display = 'none';
                if (_botSwitch) _botSwitch.style.display = 'none';
                if (_toggleBtn) _toggleBtn.classList.remove('active');
            }
        }
        if (_toggleBtn) _toggleBtn.addEventListener('click', function () { _botOpen = !_botOpen; _applyBotVis(); });
        if (_botSwitch) _botSwitch.querySelectorAll('[data-wbsrc]').forEach(function (b) {
            b.addEventListener('click', function () {
                _botSrc = b.dataset.wbsrc;
                _botSwitch.querySelectorAll('[data-wbsrc]').forEach(function (x) { x.classList.toggle('active', x === b); x.style.background = x === b ? '#2f6fdb' : '#16233a'; });
                try { renderGalleryTab(); } catch (e) {}
            });
        });
        // 生成记录横排左右翻页箭头
        var _gBox = drawer.querySelector('[data-wbbotbody="gallery"]');
        var _gPrev = drawer.querySelector('#wbbotPrev'), _gNext = drawer.querySelector('#wbbotNext');
        if (_gPrev && _gNext && _gBox) {
            var _gScroll = function (dir) { _gBox.scrollBy({ left: dir * Math.max(240, _gBox.clientWidth * 0.8), behavior: 'smooth' }); };
            _gPrev.addEventListener('click', function () { _gScroll(-1); });
            _gNext.addEventListener('click', function () { _gScroll(1); });
            var _gArrowUpd = function () {
                var hidden = _gBox.style.display === 'none';
                _gPrev.style.display = _gNext.style.display = hidden ? 'none' : '';
            };
            new MutationObserver(_gArrowUpd).observe(_gBox, { attributes: true, attributeFilter: ['style'] });
            _gArrowUpd();
        }
        // 默认收起历史记录（点开关才展开）
        bindStageEvents();
        bindMinimap();
        bindDrag();
        bindResize();
        bindHotkeys();
        bindModel3D();
        // 拖放导入图片到画布
        var stage = drawer.querySelector('.wb-img-stage-wrap');
        if (stage) {
            stage.addEventListener('dragover', function (e) { e.preventDefault(); stage.classList.add('wb-dragover'); });
            stage.addEventListener('dragleave', function () { stage.classList.remove('wb-dragover'); });
            stage.addEventListener('drop', function (e) {
                e.preventDefault();
                stage.classList.remove('wb-dragover');
                var files = e.dataTransfer && e.dataTransfer.files;
                if (files && files.length) {
                    Array.prototype.forEach.call(files, function (f) {
                        if (f.type && f.type.indexOf('image/') === 0) addBlobAsLayer(f, f.name || 'drop.png');
                    });
                }
            });
        }
        drawer.querySelector('.wb-prompt').addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendToAI(); }
        });
    }

    function stageWrap() { return drawer.querySelector('.wb-img-stage-wrap'); }
    function stageEl() { return drawer.querySelector('.wb-img-stage'); }

    function doAct(act) {
        if (act === 'import') { pickFiles(); }
        else if (act === 'paste') { navigator.clipboard.read().then(function (items) {
            var found = false;
            items.forEach(function (it) {
                if (it.types.indexOf('image/png') !== -1) {
                    found = true;
                    it.getType('image/png').then(function (blob) { addBlobAsLayer(blob, 'clipboard.png'); });
                }
            });
            if (!found) toast('剪贴板没有图片');
        }).catch(function () { toast('请用 Ctrl+V 在画布上粘贴'); }); }
        else if (act === 'undo') { jumpHistory(histIndex - 1); }
        else if (act === 'redo') { jumpHistory(histIndex + 1); }
        else if (act === 'export') { exportPNG(); }
        else if (act === 'fit') { fitView(); }
        else if (act === 'gallery') { openWbGallery(); }
    }

    // ---------- 🗂 生成记录画廊（序列化查看 data/workbench/ 全部产物） ----------
    var _wbGalleryItems = [], _wbGalleryIdx = 0;
    function _wbThumbUrl(url) {
        // 静态图走服务端缩略图接口（320px 缓存），视频和异常路径回退原图
        try {
            if (/\/data\/workbench\/([^\/?#]+)/.test(url)) {
                return '/api/workbench/thumb?f=' + encodeURIComponent(decodeURIComponent(RegExp.$1));
            }
        } catch (e) {}
        return url;
    }
    var _wbPreloadCache = {};
    function _wbPreload(url) {
        if (_wbPreloadCache[url]) return;
        _wbPreloadCache[url] = true;
        var im = new Image(); im.src = url;
    }
    function _wbTimeFmt(ts) {
        var d = new Date(ts * 1000), p = function (n) { return (n < 10 ? '0' : '') + n; };
        return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    function _wbGalleryLayerFromUrl(url, name, video) {
        if (video) {
            // 视频：直接塞进底部图片条用 <video> 展示（画布只支持静态图）
            var box2 = drawer.querySelector('[data-wbbotbody="layers"]');
            var v = document.createElement('video');
            v.src = url; v.controls = true; v.muted = true; v.loop = true;
            v.style.maxHeight = '160px'; v.style.maxWidth = '260px'; v.style.borderRadius = '8px';
            v.title = name;
            box2.appendChild(v);
            showOnlyActive();
            toast('视频已加入图片条：' + name);
            return;
        }
        fetch(url).then(function (r) { return r.blob(); }).then(function (b) { addBlobAsLayer(b, name); toast('已载入画布：' + name); });
    }
    function openWbGallery(startIdx) {
        var old = document.getElementById('wbGalleryOverlay');
        if (old) old.remove();
        var ov = document.createElement('div');
        ov.id = 'wbGalleryOverlay';
        ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(5,8,14,.92);display:flex;flex-direction:column;align-items:center;justify-content:center';
        ov.innerHTML =
            '<div style="position:absolute;top:12px;right:16px;color:#cfe;cursor:pointer;font-size:22px" id="wbgClose">✕</div>' +
            '<div style="position:absolute;top:14px;left:16px;color:#9ab;font-size:13px" id="wbgInfo"></div>' +
            '<div style="max-width:86vw;max-height:74vh;display:flex;align-items:center;justify-content:center" id="wbgView"></div>' +
            '<div style="display:flex;gap:14px;margin-top:14px;align-items:center">' +
            '<button id="wbgPrev" style="padding:8px 18px;border-radius:8px;border:1px solid #2a3b55;background:#16233a;color:#cfe;cursor:pointer"><svg class="wb-br-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg> 上一张</button>' +
            '<button id="wbgLoad" style="padding:8px 18px;border-radius:8px;border:1px solid #2a3b55;background:#1d3a2a;color:#cfe;cursor:pointer">⤵ 载入工作台</button>' +
            '<button id="wbgNext" style="padding:8px 18px;border-radius:8px;border:1px solid #2a3b55;background:#16233a;color:#cfe;cursor:pointer">下一张 <svg class="wb-br-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button>' +
            '</div>' +
            '<div id="wbgStrip" style="display:flex;gap:6px;margin-top:14px;max-width:90vw;overflow-x:auto;padding:6px"></div>';
        document.body.appendChild(ov);
        function show(i) {
            if (!_wbGalleryItems.length) return;
            _wbGalleryIdx = (i + _wbGalleryItems.length) % _wbGalleryItems.length;
            var it = _wbGalleryItems[_wbGalleryIdx];
            ov.querySelector('#wbgInfo').textContent = it.name + ' · ' + _wbTimeFmt(it.ts) + ' · ' + (_wbGalleryIdx + 1) + '/' + _wbGalleryItems.length;
            var view = ov.querySelector('#wbgView');
            view.innerHTML = '<div style="color:#7d93b8;font-size:13px;padding:30px">大图加载中…</div>';
            // 预取相邻两张原图，翻页/双击时秒开
            [_wbGalleryIdx - 1, _wbGalleryIdx + 1].forEach(function (ni) {
                var nit = _wbGalleryItems[(ni + _wbGalleryItems.length) % _wbGalleryItems.length];
                if (nit && !nit.video) _wbPreload(nit.url);
            });
            if (it.video) {
                var v = document.createElement('video');
                v.src = it.url; v.controls = true; v.autoplay = true; v.loop = true;
                v.style.cssText = 'max-width:86vw;max-height:72vh;border-radius:10px';
                view.innerHTML = ''; view.appendChild(v);
            } else {
                var im = document.createElement('img');
                im.style.cssText = 'max-width:86vw;max-height:72vh;border-radius:10px;object-fit:contain;display:none';
                im.onload = function () { view.innerHTML = ''; view.appendChild(im); im.style.display = ''; };
                im.onerror = function () { view.innerHTML = '<div style="color:#a77;font-size:13px">加载失败</div>'; };
                im.src = it.url;
                // 已缓存则立即显示（onload 也会触发，这里兜底）
                if (im.complete && im.naturalWidth) { view.innerHTML = ''; im.style.display = ''; view.appendChild(im); }
            }
        }
        ov.querySelector('#wbgClose').onclick = function () { ov.remove(); };
        ov.querySelector('#wbgPrev').onclick = function () { show(_wbGalleryIdx - 1); };
        ov.querySelector('#wbgNext').onclick = function () { show(_wbGalleryIdx + 1); };
        ov.querySelector('#wbgLoad').onclick = function () {
            var it = _wbGalleryItems[_wbGalleryIdx];
            _wbGalleryLayerFromUrl(it.url, it.name, it.video);
        };
        ov.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowLeft') show(_wbGalleryIdx - 1);
            else if (e.key === 'ArrowRight') show(_wbGalleryIdx + 1);
            else if (e.key === 'Escape') ov.remove();
        });
        ov.tabIndex = 0; ov.focus();
        // 底部缩略图条
        var strip = ov.querySelector('#wbgStrip');
        _wbGalleryItems.forEach(function (it, i) {
            var th = document.createElement(it.video ? 'video' : 'img');
            th.src = it.video ? it.url : _wbThumbUrl(it.url);
            if (!it.video) { th.loading = 'lazy'; }
            if (it.video) { th.muted = true; }
            th.style.cssText = 'height:56px;border-radius:6px;cursor:pointer;border:2px solid ' + (i === _wbGalleryIdx ? '#4a9eff' : 'transparent');
            th.title = it.name;
            th.onclick = function () {
                show(i);
                Array.prototype.forEach.call(strip.children, function (c, j) { c.style.borderColor = j === i ? '#4a9eff' : 'transparent'; });
            };
            strip.appendChild(th);
        });
        show(typeof startIdx === 'number' ? startIdx : 0);
    }
    function renderGalleryTab() {
        var box = drawer.querySelector('[data-wbbotbody="gallery"]');
        if (!box) return;
        box.innerHTML = '<span style="color:#7d93b8;font-size:12px">加载中…</span>';
        var _wantSrc = (typeof _botSrc !== 'undefined') ? _botSrc : 'image';
        fetch('/api/workbench/gallery').then(function (r) { return r.json(); }).then(function (j) {
            box.innerHTML = '';
            if (!j.ok) { box.innerHTML = '<span style="color:#7d93b8;font-size:12px">暂无生成记录</span>'; return; }
            var items = j.items.filter(function (it) { return _wantSrc === 'video' ? it.video : !it.video; });
            if (!items.length) { box.innerHTML = '<span style="color:#7d93b8;font-size:12px">暂无' + (_wantSrc === 'video' ? '视频' : '图片') + '生成记录</span>'; return; }
            _wbGalleryItems = items;
            items.forEach(function (it, i) {
                var wrap = document.createElement('div');
                wrap.style.cssText = 'position:relative;cursor:pointer;width:120px';
                var el = document.createElement(it.video ? 'video' : 'img');
                el.src = it.video ? it.url : _wbThumbUrl(it.url);
                if (!it.video) { el.loading = 'lazy'; }
                if (it.video) { el.muted = true; }
                el.style.cssText = 'width:120px;height:68px;object-fit:cover;border-radius:8px;border:1px solid #2a3b55';
                var cap = document.createElement('div');
                cap.textContent = it.name.replace(/\.[a-z]+$/i, '') + ' · ' + _wbTimeFmt(it.ts);
                cap.style.cssText = 'color:#9ab;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px';
                wrap.appendChild(el); wrap.appendChild(cap);
                wrap.title = '点击载入上方大图显示';
                wrap.onclick = function () { _wbGalleryLayerFromUrl(it.url, it.name, it.video); };
                box.appendChild(wrap);
            });
        }).catch(function () { box.innerHTML = '<span style="color:#a77;font-size:12px">画廊加载失败</span>'; });
    }

    function pickFiles() {
        var input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
        input.addEventListener('change', function () {
            Array.prototype.forEach.call(input.files, function (f) { addBlobAsLayer(f, f.name); });
        });
        document.body.appendChild(input); input.click();
    }

    // ---------- 图层 ----------
    function addBlobAsLayer(blob, name) {
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () {
            var c = document.createElement('canvas');
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            var layer = {
                id: uid('layer'), name: name || ('image_' + layers.length + 1),
                canvas: c, visible: true, locked: false, opacity: 1,
                x: layers.length * 24, y: layers.length * 18, ai: /ai|result|out/.test(name || '')
            };
            layers.push(layer);
            activeLayerId = layer.id;
            c.style.left = layer.x + 'px'; c.style.top = layer.y + 'px';
            stageEl().appendChild(c);
            var _emptyHint = drawer.querySelector('[data-wbwork="image"] .wb-img-empty'); if (_emptyHint) _emptyHint.style.display = 'none';
            applyLayerStyle(layer);
            // 去图层化：新图自动成为当前显示，旧图全部隐藏归档到历史
            showOnlyActive();
            syncEmptyHint();
            renderLayers(); pushHistory('导入 ' + layer.name); fitView();
        };
        img.onerror = function () { toast('图片加载失败：' + name); };
        img.src = url;
    }

    // v5.2.2：有图层时隐藏空状态提示，无图层时显示
    function syncEmptyHint() {
        try {
            var el = drawer.querySelector('.wb-img-empty');
            if (el && el.closest('[data-wbwork="image"]')) el.style.display = layers.length ? 'none' : '';
        } catch (e) {}
    }

    function activeLayer() {
        for (var i = 0; i < layers.length; i++) if (layers[i].id === activeLayerId) return layers[i];
        return layers[layers.length - 1] || null;
    }

    function applyLayerStyle(l) {
        l.canvas.style.opacity = l.opacity;
        l.canvas.style.display = l.visible ? '' : 'none';
        l.canvas.style.pointerEvents = l.locked ? 'none' : 'auto';
    }

    // v5.9 去图层化：底部列表改为「历史图片缩略图」，点击切换当前显示的大图，仅显示激活图片
    function renderLayers() {
        var box = drawer.querySelector('[data-wbbotbody="layers"]');
        if (!box) return;
        if (typeof updateMinimap === 'function') setTimeout(updateMinimap, 0);
        box.innerHTML = '';
        // 无图时给空提示
        if (!layers.length) {
            var hint = document.createElement('div');
            hint.style.cssText = 'color:#5f7494;font-size:12px;align-self:center;padding:0 8px;white-space:nowrap';
            hint.textContent = '暂无图片，AI 出图或导入后显示在这里';
            box.appendChild(hint);
            return;
        }
        // 若激活图已被删除，回落到最后一张
        if (!activeLayer() ) activeLayerId = layers[layers.length - 1].id;
        for (var i = layers.length - 1; i >= 0; i--) {
            (function (l) {
                var cell = document.createElement('div');
                cell.className = 'wb-layer-row' + (l.id === activeLayerId ? ' active' : '');
                cell.title = l.name + (l.id === activeLayerId ? '（当前显示）' : '（点击切换显示）');
                cell.style.cssText = 'position:relative;flex:none;width:72px;height:72px;border-radius:8px;overflow:hidden;cursor:pointer;border:2px solid ' +
                    (l.id === activeLayerId ? '#4a9eff' : 'transparent') + ';background:#0d1219';
                var th = document.createElement('canvas');
                th.width = 72; th.height = 72;
                var tc = th.getContext('2d');
                var s = Math.min(72 / l.canvas.width, 72 / l.canvas.height);
                tc.drawImage(l.canvas, (72 - l.canvas.width * s) / 2, (72 - l.canvas.height * s) / 2, l.canvas.width * s, l.canvas.height * s);
                th.style.cssText = 'width:100%;height:100%;display:block';
                cell.appendChild(th);
                // 删除按钮：默认隐藏，鼠标悬停缩略图时显示；点击需二次确认
                var del = document.createElement('button');
                del.textContent = '✕'; del.title = '删除这张图';
                del.className = 'wb-layer-del';
                del.style.cssText = 'position:absolute;top:2px;right:2px;width:20px;height:20px;line-height:18px;padding:0;border:none;border-radius:50%;background:rgba(220,40,40,.85);color:#fff;font-size:12px;cursor:pointer;opacity:0;visibility:hidden;transition:opacity .12s;z-index:5';
                cell.addEventListener('mouseenter', function () { del.style.opacity = '1'; del.style.visibility = 'visible'; });
                cell.addEventListener('mouseleave', function () { del.style.opacity = '0'; del.style.visibility = 'hidden'; });
                del.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var doDelete = function () {
                        try { l.canvas.remove(); } catch (err) {}
                        var idx = layers.indexOf(l);
                        if (idx >= 0) layers.splice(idx, 1);
                        if (activeLayerId === l.id) activeLayerId = null;
                        syncEmptyHint();
                        renderLayers(); fitView(); saveStateNow();   // 删除立即持久化，不走 1.2s 延迟
                    };
                    if (typeof _dlgConfirm === 'function') {
                        _dlgConfirm('确定要删除「' + (l.name || '这张图') + '」吗？删除后不可恢复。').then(function (ok) { if (ok) doDelete(); });
                    } else if (window.confirm('确定要删除「' + (l.name || '这张图') + '」吗？删除后不可恢复。')) {
                        doDelete();
                    }
                });
                cell.appendChild(del);
                cell.addEventListener('click', function () {
                    activeLayerId = l.id;
                    showOnlyActive();
                    renderLayers(); fitView(); saveState();
                });
                box.appendChild(cell);
            })(layers[i]);
        }
    }

    // 只显示激活的那张图，其余隐藏（同一时间画布上只有一张当前图片）
    function showOnlyActive() {
        var act = activeLayer();
        layers.forEach(function (l) {
            l.visible = (act && l.id === act.id);
            l.opacity = 1; l.locked = false;
            l.x = 0; l.y = 0;   // 单图模式：全部对齐原点，不再层叠错位
            applyLayerStyle(l);
            if (l.canvas.isConnected) {
                l.canvas.style.left = '0px'; l.canvas.style.top = '0px';
            }
        });
        pushHistory('切换图片');
    }

    // ---------- 画布交互（平移/缩放/框选） ----------
    function bindStageEvents() {
        var wrap = stageWrap(), panning = false, sx = 0, sy = 0, ox = 0, oy = 0, panningJustMoved = false;
        var selStart = null;

        wrap.addEventListener('wheel', function (e) {
            e.preventDefault();
            var r = wrap.getBoundingClientRect();
            var mx = e.clientX - r.left, my = e.clientY - r.top;
            var k = e.deltaY < 0 ? 1.12 : 1 / 1.12;
            var ns = Math.min(8, Math.max(0.05, view.scale * k));
            k = ns / view.scale;
            view.x = mx - (mx - view.x) * k;
            view.y = my - (my - view.y) * k;
            view.scale = ns;
            applyView(); updateStatus();
            saveState();   // 【持久化】缩放/平移后保存视角，关闭/重启后恢复
        }, { passive: false });

        wrap.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            var r = wrap.getBoundingClientRect();
            if (tool === 'pan' || e.target.closest('.wb-img-empty')) {
                panning = true; sx = e.clientX; sy = e.clientY; ox = view.x; oy = view.y; panningJustMoved = true;
                wrap.classList.add('wb-panning');
            } else if (tool === 'select') {
                selStart = { x: e.clientX - r.left, y: e.clientY - r.top };
                clearSelection();
            }
            e.preventDefault();
        });
        document.addEventListener('mousemove', function (e) {
            if (panning) { view.x = ox + e.clientX - sx; view.y = oy + e.clientY - sy; applyView(); return; }
            if (selStart) {
                var r = wrap.getBoundingClientRect();
                var cx = e.clientX - r.left, cy = e.clientY - r.top;
                sel = normRect(selStart, { x: cx, y: cy });
                drawSelOverlay();
                var si = drawer.querySelector('.wb-sel-info');
                si.textContent = Math.round(sel.w) + '×' + Math.round(sel.h);
            }
        });
        document.addEventListener('mouseup', function () {
            panning = false; wrap.classList.remove('wb-panning');
            if (panningJustMoved) { panningJustMoved = false; saveState(); }   // 【持久化】平移结束后保存视角
            if (selStart) {
                selStart = null;
                if (sel && (sel.w < 4 || sel.h < 4)) sel = null;   // 过滤点击误触
                drawSelOverlay();
            }
        });

        // Ctrl+V 粘贴图片
        document.addEventListener('paste', function (e) {
            if (!drawer || !drawer.classList.contains('open')) return;
            var items = e.clipboardData && e.clipboardData.items; if (!items) return;
            for (var i = 0; i < items.length; i++) {
                if (/^image\//.test(items[i].type)) {
                    e.preventDefault();
                    addBlobAsLayer(items[i].getAsFile(), 'paste.png');
                }
            }
        });
        // 全局拖入
        wrap.addEventListener('dragover', function (e) { e.preventDefault(); });
        wrap.addEventListener('drop', function (e) {
            e.preventDefault();
            Array.prototype.forEach.call(e.dataTransfer.files, function (f) {
                if (/^image\//.test(f.type)) addBlobAsLayer(f, f.name);
            });
        });
        // 双击大图 → 最大化（打开生成记录画廊查看器，含全屏浏览/翻页）
        wrap.addEventListener('dblclick', function (e) {
            if (e.target && e.target.tagName === 'CANVAS') {
                var act = activeLayer();
                var idx = -1;
                if (act) {
                    var base = (act.name || '').replace(/\.[a-z]+$/i, '');
                    _wbGalleryItems.forEach(function (it, i) {
                        var nb = (it.name || '').replace(/\.[a-z]+$/i, '');
                        if (idx < 0 && (it.name === act.name || nb === base)) idx = i;
                    });
                }
                openWbGallery(idx >= 0 ? idx : 0);
            }
        });
    }

    function normRect(a, b) {
        return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
    }

    var selOverlay = null;
    function drawSelOverlay() {
        var wrap = stageWrap();
        if (selOverlay) { selOverlay.remove(); selOverlay = null; }
        if (!sel) { drawer.querySelector('.wb-sel-info').textContent = ''; return; }
        var d = document.createElement('div');
        d.style.cssText = 'position:absolute;pointer-events:none;border:1px dashed #4a9eff;background:rgba(74,158,255,.12);z-index:50;' +
            'left:' + sel.x + 'px;top:' + sel.y + 'px;width:' + sel.w + 'px;height:' + sel.h + 'px;';
        wrap.appendChild(d);
        selOverlay = d;
    }
    function clearSelection() { sel = null; drawSelOverlay(); }

    function applyView() {
        var st = stageEl();
        st.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')';
        updateMinimap();
    }
    // ---------- 缩略图导航地图（Minimap） ----------
    var miniDragging = false;
    function minimapEl() { return drawer.querySelector('.wb-mini-map'); }
    function updateMinimap() {
        var _pf0 = window.Perf ? performance.now() : 0;
        var mini = minimapEl(); if (!mini) return;
        var wrap = stageWrap(); if (!wrap) return;
        var W = mini.width, H = mini.height;
        var ctx = mini.getContext('2d');
        ctx.clearRect(0, 0, W, H);
        // 背景
        ctx.fillStyle = 'rgba(10,14,20,0.85)'; ctx.fillRect(0, 0, W, H);
        if (!layers.length) { mini.style.display = 'none'; return; }
        mini.style.display = 'block';
        // 内容边界（与 compositeCanvas 相同口径）
        var minx = 0, miny = 0, maxx = 0, maxy = 0;
        layers.forEach(function (l) {
            minx = Math.min(minx, l.x); miny = Math.min(miny, l.y);
            maxx = Math.max(maxx, l.x + l.canvas.width); maxy = Math.max(maxy, l.y + l.canvas.height);
        });
        var cw = Math.max(1, maxx - minx), ch = Math.max(1, maxy - miny);
        var pad = 8;
        var s = Math.min((W - pad * 2) / cw, (H - pad * 2) / ch);
        var ox = (W - cw * s) / 2 - minx * s, oy = (H - ch * s) / 2 - miny * s;
        // 画内容占位方块（不画图片内容，只显示宽高比例）+ 视口框
        ctx.fillStyle = 'rgba(74,163,255,0.18)';
        ctx.fillRect(ox, oy, cw * s, ch * s);
        // 视口框：屏幕(0,0)-(w,h) 映射回内容坐标再乘 s
        var w = wrap.clientWidth, h = wrap.clientHeight;
        var vx0 = (0 - view.x) / view.scale, vy0 = (0 - view.y) / view.scale;
        var vx1 = (w - view.x) / view.scale, vy1 = (h - view.y) / view.scale;
        ctx.strokeStyle = '#4aa3ff'; ctx.lineWidth = 1.5;
        ctx.strokeRect(ox + vx0 * s, oy + vy0 * s, (vx1 - vx0) * s, (vy1 - vy0) * s);
        mini._map = { s: s, ox: ox, oy: oy }; // 供点击跳转
        if (window.Perf) Perf.mark('工作台:updateMinimap', _pf0);
    }
    function miniJump(e) {
        var mini = minimapEl(); if (!mini || !mini._map) return;
        var wrap = stageWrap(); if (!wrap) return;
        var r = mini.getBoundingClientRect();
        var m = mini._map;
        var cx = (e.clientX - r.left - m.ox) / m.s;
        var cy = (e.clientY - r.top - m.oy) / m.s;
        view.x = wrap.clientWidth / 2 - cx * view.scale;
        view.y = wrap.clientHeight / 2 - cy * view.scale;
        applyView(); updateStatus();
    }
    function bindMinimap() {
        var mini = minimapEl(); if (!mini) return;
        mini.addEventListener('mousedown', function (e) { miniDragging = true; miniJump(e); e.preventDefault(); });
        document.addEventListener('mousemove', function (e) { if (miniDragging) miniJump(e); });
        document.addEventListener('mouseup', function () { miniDragging = false; });
    }
    function updateStatus() {
        var z = drawer.querySelector('.wb-zoom');
        if (z) z.textContent = Math.round(view.scale * 100) + '%';
    }

    function fitView() {
        if (!layers.length) { view = { x: 0, y: 0, scale: 1 }; applyView(); updateStatus(); return; }
        var wrap = stageWrap(), minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
        layers.forEach(function (l) {
            minx = Math.min(minx, l.x); miny = Math.min(miny, l.y);
            maxx = Math.max(maxx, l.x + l.canvas.width); maxy = Math.max(maxy, l.y + l.canvas.height);
        });
        var w = wrap.clientWidth, h = wrap.clientHeight;
        var s = Math.min((w - 40) / (maxx - minx), (h - 40) / (maxy - miny), 2);
        view.scale = s;
        view.x = (w - (maxx - minx) * s) / 2 - minx * s;
        view.y = (h - (maxy - miny) * s) / 2 - miny * s;
        applyView(); updateStatus();
    }

    // ---------- 历史（快照合成图） ----------
    function compositeCanvas() {
        var minx = 0, miny = 0, maxx = 0, maxy = 0, has = false;
        layers.forEach(function (l) {
            minx = Math.min(minx, l.x); miny = Math.min(miny, l.y);
            maxx = Math.max(maxx, l.x + l.canvas.width); maxy = Math.max(maxy, l.y + l.canvas.height);
            has = true;
        });
        if (!has) return null;
        var c = document.createElement('canvas');
        c.width = maxx - minx; c.height = maxy - miny;
        var ctx = c.getContext('2d');
        layers.forEach(function (l) {
            if (!l.visible || l.opacity <= 0) return;
            ctx.globalAlpha = l.opacity;
            ctx.drawImage(l.canvas, l.x - minx, l.y - miny);
        });
        return c;
    }

    function snapshotLayers() {
        var m = {};
        layers.forEach(function (l) { m[l.id] = { name: l.name, visible: l.visible, locked: l.locked, opacity: l.opacity, x: l.x, y: l.y, ai: l.ai, data: l.canvas.toDataURL('image/png') }; });
        return m;
    }

    function pushHistory(label) {
        if (histBusy) return;
        history = history.slice(0, histIndex + 1);
        history.push({ label: label || '操作', time: new Date().toLocaleTimeString(), snap: snapshotLayers() });
        if (history.length > 40) history.shift();
        histIndex = history.length - 1;
        renderHistory();
        saveState();
    }

    function jumpHistory(idx) {
        if (idx < 0 || idx >= history.length || idx === histIndex) return;
        histBusy = true;
        var snap = history[idx].snap;
        // 清掉旧画布
        layers.forEach(function (l) { if (l.canvas.isConnected) l.canvas.remove(); });
        layers = [];
        var restore = Object.keys(snap).map(function (id) {
            var s = snap[id];
            var img = new Image();
            var p = new Promise(function (res) {
                img.onload = function () {
                    var c = document.createElement('canvas');
                    c.width = img.naturalWidth; c.height = img.naturalHeight;
                    c.getContext('2d').drawImage(img, 0, 0);
                    var l = { id: id, name: s.name, visible: s.visible, locked: s.locked, opacity: s.opacity, x: s.x, y: s.y, ai: s.ai, canvas: c };
                    layers.push(l);
                    c.style.left = l.x + 'px'; c.style.top = l.y + 'px';
                    stageEl().appendChild(c);
                    applyLayerStyle(l);
                    res();
                };
                img.src = s.data;
            });
            return p;
        });
        Promise.all(restore).then(function () {
            activeLayerId = layers.length ? layers[layers.length - 1].id : null;
            histIndex = idx;
            histBusy = false;
            syncEmptyHint();
            renderLayers(); renderHistory(); fitView();
        });
    }

    function renderHistory() {
        var box = drawer.querySelector('[data-wbbotbody="history"]');
        box.innerHTML = '';
        history.forEach(function (h, i) {
            var row = document.createElement('div');
            row.className = 'wb-hist-row' + (i === histIndex ? ' current' : '') + (i > histIndex ? ' future' : '');
            row.textContent = (i + 1) + '. ' + h.label + ' · ' + h.time;
            row.addEventListener('click', function () { jumpHistory(i); });
            box.appendChild(row);
        });
    }

    // ---------- 框选 → 发送 AI ----------
    function sendToAI() {
        var box = document.querySelector('.chatbox.focused') || document.querySelector('.chatbox');
        if (!box) { toast('没有可用的对话窗口'); return; }
        if (typeof App === 'undefined' || typeof App._addPendingImages !== 'function') { toast('对话系统未就绪'); return; }

        var canvas;
        if (sel && sel.w > 2 && sel.h > 2) {
            // 选区是「wrap 视口坐标」→ 转换为 stage 世界坐标 → 裁剪各图层
            var st = stageEl();
            var wx = (sel.x - view.x) / view.scale, wy = (sel.y - view.y) / view.scale;
            var ww = sel.w / view.scale, wh = sel.h / view.scale;
            // 限制到合成图范围
            var c = compositeCanvas(); if (!c) { toast('画布为空'); return; }
            var sx = Math.max(0, Math.round(wx)), sy = Math.max(0, Math.round(wy));
            var ex = Math.min(c.width, Math.round(wx + ww)), ey = Math.min(c.height, Math.round(wy + wh));
            if (ex - sx < 2 || ey - sy < 2) { toast('选区在图片外'); return; }
            canvas = document.createElement('canvas');
            canvas.width = ex - sx; canvas.height = ey - sy;
            canvas.getContext('2d').drawImage(c, sx, sy, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
        } else {
            canvas = compositeCanvas();
            if (!canvas) { toast('画布为空，先导入图片'); return; }
        }

        // 缩到合理尺寸（最长边 1600）并导出
        var MAXS = 1600, out = canvas;
        if (Math.max(canvas.width, canvas.height) > MAXS) {
            var k = MAXS / Math.max(canvas.width, canvas.height);
            out = document.createElement('canvas');
            out.width = Math.round(canvas.width * k); out.height = Math.round(canvas.height * k);
            out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
        }
        var dataUrl = out.toDataURL('image/png');
        var bin = atob(dataUrl.split(',')[1]), arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        var file = new File([arr], 'workbench_' + (sel ? 'region' : 'full') + '.png', { type: 'image/png' });

        App._addPendingImages(box, [file]);
        // 把指令写进对话输入框（保留用户文本）
        var input = box.querySelector('textarea') || box.querySelector('[contenteditable="true"]');
        var prompt = (drawer.querySelector('.wb-prompt').value || '').trim();
        if (input && prompt) {
            if (input.tagName === 'TEXTAREA') input.value = prompt;
            else input.textContent = prompt;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        toast(sel ? '🖼️ 已附加选区局部图，回对话点发送' : '🖼️ 已附加全图，回对话点发送');
        clearSelection();
    }

    // ---------- 导出 PNG ----------
    function exportPNG() {
        var c = compositeCanvas();
        if (!c) { toast('画布为空'); return; }
        var a = document.createElement('a');
        a.href = c.toDataURL('image/png');
        a.download = 'workbench_' + Date.now() + '.png';
        a.click();
    }

    // ---------- AI 工具面板（调 /api/workbench 工具注册表，直接作用于当前图层） ----------
    var wbTools = null;
    function loadWbTools() {
        if (wbTools) { renderAiTools(); return; }
        fetch('/api/workbench/tools').then(function (r) { return r.json(); }).then(function (j) {
            if (j && j.ok) { wbTools = j.tools || []; renderAiTools(); }
            else toast('工具列表加载失败');
        }).catch(function () { toast('工具列表加载失败'); });
    }
    function renderAiTools() {
        var box = drawer.querySelector('[data-wbbotbody="aitools"]');
        if (!box) return;
        box.innerHTML = '';
        if (!wbTools || !wbTools.length) { box.innerHTML = '<div class="wb-hist-empty">工具未加载</div>'; return; }
        var hint = document.createElement('div');
        hint.className = 'wb-hist-empty';
        hint.textContent = '作用于当前图片' + (sel ? '的框选区域' : '全图');
        box.appendChild(hint);
        // 【2026-10-02 瘦身】核心工具平铺；演示滤镜收进「更多滤镜」折叠区（后端 ?all=1 才下发，此处按需二次拉取）
        function renderRows(list, container) {
            list.forEach(function (t) {
                var row = document.createElement('div');
                row.className = 'wb-aitool-row';
                var needParam = t.params && Object.keys(t.params).length > 0;
                row.innerHTML = '<button class="wb-aitool-btn">' + t.name + '</button>' +
                    '<span class="wb-aitool-desc" title="' + (t.description || '') + '">' + (t.description || '') + '</span>';
                row.querySelector('.wb-aitool-btn').addEventListener('click', function () {
                    var params = {};
                    if (needParam) {
                        var v = _dlgPrompt('参数（' + Object.keys(t.params).join(', ') + '，JSON 或 单值）:', JSON.stringify(t.params.defaults || {}));
                        if (v === null) return;
                        try { params = JSON.parse(v); } catch (e) { var ks = Object.keys(t.params); params = {}; params[ks[0]] = isNaN(+v) ? v : +v; }
                    }
                    applyToolLocal(t.name, params);
                });
                container.appendChild(row);
            });
        }
        renderRows(wbTools, box);
        var more = document.createElement('details');
        more.className = 'wb-aitool-more';
        more.style.marginTop = '6px';
        var sum = document.createElement('summary');
        sum.textContent = '▾ 更多滤镜（演示效果）';
        sum.style.cssText = 'cursor:pointer;font-size:12px;opacity:.7;padding:4px 0;';
        more.appendChild(sum);
        var mbox = document.createElement('div');
        more.appendChild(mbox);
        box.appendChild(more);
        fetch('/api/workbench/tools?all=1').then(function (r) { return r.json(); }).then(function (j) {
            if (!(j && j.ok)) return;
            var coreNames = {};
            (wbTools || []).forEach(function (t) { coreNames[t.name] = 1; });
            var extra = (j.tools || []).filter(function (t) { return !coreNames[t.name]; });
            renderRows(extra, mbox);
        }).catch(function () {});
    }
    function layerAt(x, y, w, h) {
        var l = activeLayer(); if (!l) return null;
        var c = document.createElement('canvas');
        // 截取图层与选区交集
        var sx = Math.max(0, Math.round(x - l.x)), sy = Math.max(0, Math.round(y - l.y));
        var ex = Math.min(l.canvas.width, Math.round(x + w - l.x)), ey = Math.min(l.canvas.height, Math.round(y + h - l.y));
        if (ex - sx < 2 || ey - sy < 2) return null;
        c.width = ex - sx; c.height = ey - sy;
        c.getContext('2d').drawImage(l.canvas, sx, sy, c.width, c.height, 0, 0, c.width, c.height);
        return c;
    }
    function applyToolLocal(toolName, params) {
        var l = activeLayer();
        if (!l) { toast('还没有图片，先让 AI 出图或导入一张'); return; }
        var src;
        if (sel && sel.w > 2 && sel.h > 2) {
            var wx = (sel.x - view.x) / view.scale, wy = (sel.y - view.y) / view.scale;
            var ww = sel.w / view.scale, wh = sel.h / view.scale;
            src = layerAt(wx, wy, ww, wh);
            if (!src) { toast('框选区域不在当前图片内'); return; }
        } else {
            src = l.canvas;
        }
        toast('⏳ ' + toolName + ' 执行中...');
        fetch('/api/workbench/tools/apply', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool: toolName, image: src.toDataURL('image/png'), params: params || {} })
        }).then(function (r) { return r.json(); }).then(function (j) {
            if (!j || !j.ok) { toast('❌ ' + (j && j.err || '执行失败')); return; }
            var img = new Image();
            img.onload = function () {
                var nc = document.createElement('canvas');
                nc.width = img.width; nc.height = img.height;
                nc.getContext('2d').drawImage(img, 0, 0);
                nc.className = 'wb-layer-canvas';
                nc.style.cssText = l.canvas.style.cssText;
                l.canvas.parentNode.replaceChild(nc, l.canvas);
                l.canvas = nc;
                applyLayerStyle(l); pushHistory(toolName + (sel ? ' · 选区' : ''));
                toast('✅ ' + toolName + ' 完成，已写入当前图片（历史列表可切回旧图）');
            };
            img.onerror = function () { toast('结果图加载失败'); };
            img.src = j.resultUrl;
        }).catch(function (e) { toast('执行失败: ' + e); });
    }

    // ---------- AI 结果自动回贴（轮询 .ai_latest.json 游标，AI 调 wb_apply 后新图自动进画布新图层） ----------
    var _aiCursor = null;
    setInterval(function () {
        // 任一抽屉展开时才轮询，省请求
        if (!document.querySelector('.wb-drawer.open')) return;
        fetch('/data/workbench/.ai_latest.json?t=' + Date.now(), { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
                if (!j || !j.url || j.url === _aiCursor) return;
                _aiCursor = j.url;
                // 【2026-10-03 视频支持】video:true 或 .mp4/.webm 结尾 → 以 <video> 图层回贴画布，可播放/暂停/拖动
                var _isVideo = j.video === true || /\.(mp4|webm|mov)(\?|$)/i.test(j.url || '');
                if (_isVideo) {
                    var v = document.createElement('video');
                    v.className = 'wb-layer-canvas';
                    v.src = j.url;
                    v.loop = true; v.muted = true; v.autoplay = true;
                    v.controls = true;
                    v.style.cssText = 'position:absolute;left:20px;top:20px;max-width:80%;z-index:5;box-shadow:0 4px 24px rgba(0,0,0,.5);border-radius:6px;';
                    v.onloadedmetadata = function () {
                        if (v.videoWidth > 640) { v.style.width = '640px'; }
                        stageEl().appendChild(v);
                        toast('🎬 AI 视频已更新到工作台：' + (j.tool || 'video'));
                        saveState();
                    };
                    v.onerror = function () { toast('AI 视频加载失败：' + j.url); };
                    return;
                }
                var img = new Image();
                img.onload = function () {
                    var c = document.createElement('canvas');
                    c.width = img.width; c.height = img.height;
                    c.getContext('2d').drawImage(img, 0, 0);
                    c.toBlob(function (blob) {
                        if (blob) addBlobAsLayer(blob, 'AI·' + (j.tool || 'result'));
                        toast('🤖 AI 图片已更新到工作台：' + (j.tool || ''));
                    }, 'image/png');
                };
                img.src = j.url;
            }).catch(function () {});
    }, 3000);

    // ---------- 状态持久化（服务端 SQLite） ----------
    var saveTimer = null;
    function snapshotState() {
        return {
            layers: layers.map(function (l) {
                return { id: l.id, name: l.name, visible: l.visible, locked: l.locked, opacity: l.opacity, x: l.x, y: l.y, ai: !!l.ai, data: l.canvas.toDataURL('image/png') };
            }),
            activeLayerId: activeLayerId, view: view
        };
    }
    function saveState() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
            try {
                var _st = snapshotState();
                _st._open = drawer.classList.contains('open');
                // 页签不持久化：默认固定为浏览器页签（见 restoreState 注释）
                fetch('/api/workbench/state', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ slot: (hostBox.dataset.wbSlot || curSlot || 'default'), state: _st })
                }).catch(function () {});
            } catch (e) {}
        }, 1200);
    }
    function saveStateNow() {   // 立即同步（绕过 debounce）：开合等关键状态不容 1.2s 延迟，防刷新/重启丢 _open
        clearTimeout(saveTimer);
        try {
            var _st = snapshotState();
            _st._open = drawer.classList.contains('open');
            fetch('/api/workbench/state', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slot: (hostBox.dataset.wbSlot || curSlot || 'default'), state: _st })
            }).catch(function () {});
        } catch (e) {}
    }
    function restoreState(cb) {
        // per-slot 读取：与 saveState 同源 key（审核员#1 阻断项修复）
        var _slot = hostBox.dataset.wbSlot || curSlot || 'default';
        function _fetchSlot(s) { return fetch('/api/workbench/state?slot=' + encodeURIComponent(s)).then(function (r) { return r.json(); }); }
        _fetchSlot(_slot).then(function (j) {
            // 迁移兜底：本对话 per-slot 记录尚不存在（升级前数据全写在 default 下）→ 回退读 default 一次
            if (_slot !== 'default' && !(j && j.ok && j.state)) return _fetchSlot('default');
            return j;
        }).then(function (j) {
            // 页签固定为浏览器，不读服务端旧 _tab/_open 覆盖（此处直接进入图层状态恢复）
            if (j && j.ok && j.state && j.state.layers && j.state.layers.length) {
                var pending = j.state.layers.length, restored = [];
                j.state.layers.forEach(function (sl) {
                    var img = new Image();
                    img.onload = function () {
                        var c = document.createElement('canvas');
                        c.width = img.width; c.height = img.height;
                        c.getContext('2d').drawImage(img, 0, 0);
                        c.className = 'wb-layer-canvas';
                        c.style.left = sl.x + 'px'; c.style.top = sl.y + 'px';
                        restored.push({ id: sl.id, name: sl.name, canvas: c, visible: sl.visible, locked: sl.locked, opacity: sl.opacity, x: sl.x, y: sl.y, ai: sl.ai });
                        stageEl().appendChild(c);
                        if (--pending === 0) {
                            layers = restored; activeLayerId = j.state.activeLayerId || (layers[layers.length - 1] && layers[layers.length - 1].id);
                            layers.forEach(applyLayerStyle);
                            showOnlyActive();   // 去图层化：恢复后强制单图显示
                            renderLayers();
                            if (j.state.view) { view = j.state.view; applyView(); updateStatus(); }
                            toast('📂 已恢复上次工作台状态');
                            if (cb) cb();
                        }
                    };
                    img.src = sl.data;
                });
                return true;
            }
            if (cb) cb();
            return false;
        }).catch(function () { if (cb) cb(); return false; });
    }

    // ---------- 快捷键 ----------
    function bindHotkeys() {
        document.addEventListener('keydown', function (e) {
            if (!drawer || !drawer.classList.contains('open')) return;
            var tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'textarea' || tag === 'input' || e.target.isContentEditable) return;
            if (e.ctrlKey && e.key === 'z') { e.preventDefault(); jumpHistory(histIndex - 1); }
            else if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); jumpHistory(histIndex + 1); }
            else if (e.key === 'Escape') { clearSelection(); }
            else if (e.key === 'v' && (e.ctrlKey || e.metaKey)) { /* 画布粘贴已有处理 */ }
            else if (e.key === '0' && e.ctrlKey) { e.preventDefault(); fitView(); }
            // ---------- 浏览器抽屉快捷键（仅当浏览器面板可见时生效，严格作用域） ----------
            else if (browserPanelVisible()) {
                if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
                    e.preventDefault();
                    var ub0 = brEl('.wb-br-url');
                    if (ub0) { ub0.focus(); ub0.select(); }
                } else if (e.ctrlKey && (e.key === 'r' || e.key === 'R')) {
                    e.preventDefault(); brRefresh();
                } else if (e.altKey && e.key === 'ArrowLeft') {
                    e.preventDefault(); brNavCmd('back');
                } else if (e.altKey && e.key === 'ArrowRight') {
                    e.preventDefault(); brNavCmd('forward');
                }
            }
        });
    }
    // 浏览器面板可见性 + 命令桥（供快捷键复用导航委托）
    function browserPanelVisible() {
        var p = drawer.querySelector('.wb-br-panel');
        return !!(p && p.offsetParent !== null);
    }
    function brNavCmd(cmd) {
        var btn = drawer.querySelector('[data-brnav="' + cmd + '"]');
        if (btn) btn.click();
    }

    // ---------- 锚点同步：v2 已改为对话框内部布局，无需再计算 fixed 定位 ----------
    function syncAnchor() {
        // 抽屉是对话框的一部分（文档流内），位置随对话框自动变化，仅做打开态挂载校验
        if (!drawer || !drawer.classList.contains('open')) return;
        if (drawer.parentElement === document.body) {
            var host = hostBox || document.getElementById('taskPanel');
            if (host) host.appendChild(drawer);
        }
        // 【修复】移除宽度钳制：抽屉是从对话框向外抽出的（right:100%），
        // 不受对话框宽度约束；旧逻辑每 300ms 把超宽抽屉压回 host*0.95，
        // 导致用户拖宽后被"弹回/锁死"。抽屉宽度完全由用户拖拽决定。
        if (window.Perf) { /* 修复：原来把终点时间当起点传入，恒为 0ms 假数据 */ }
    }
    (function watchAnchor() {
        // 【性能】仅在抽屉打开时轮询同步；关闭时空转浪费（300ms 全量 rect 计算是卡顿源之一）
        setInterval(function () {
            if (drawer && drawer.style.display !== 'none' && !drawer.hidden) syncAnchor();
        }, 300);              // 常规跟随（画布平移/拖动对话框）
        window.addEventListener('resize', syncAnchor);
        // 【平移卡顿优化】syncAnchor 内含 getBoundingClientRect/offsetWidth（强制回流），
    // 画布每帧派发 wb-canvas-view，若同步执行会帧帧强制 layout。改为 rAF 合并 + 120ms 节流。
    var _syncRaf = 0, _syncLast = 0;
    function syncAnchorThrottled() {
        if (_syncRaf) return;
        _syncRaf = requestAnimationFrame(function () {
            _syncRaf = 0;
            var now = performance.now();
            if (now - _syncLast < 120) return;
            _syncLast = now;
            syncAnchor();
        });
    }
    window.addEventListener('wb-canvas-view', syncAnchorThrottled);
        try {
            var mo = new MutationObserver(function () { syncAnchorThrottled(); });
            var root = document.getElementById('canvasContent') || document.getElementById('canvasArea') || document.body;
            mo.observe(root, { attributes: true, subtree: true, childList: true });
        } catch (e) {}
    })();

    // ---------- 开合/宽度 ----------
    // ---------- 拖拽调宽（抽屉外侧缘把手：左抽屉=左缘，右抽屉=右缘，向外拖变宽） ----------
    function bindDrawerResize() {
        if (!drawer) return;
        var handle = drawer.querySelector('.wb-drawer-resize');
        if (!handle || handle._bound) return;
        handle._bound = true;
        var startX = 0, startW = 0;
        // Pointer Events + setPointerCapture：事件锁定在把手上，防止对话框/面板拖拽体系抢占
        handle.addEventListener('pointerdown', function (e) {
            e.preventDefault(); e.stopPropagation();
            startX = e.clientX; startW = drawer.offsetWidth;
            drawer.classList.add('wb-dragging');
            try { handle.setPointerCapture(e.pointerId); } catch (err) {}
        });
        handle.addEventListener('pointermove', function (e) {
            if (!handle.hasPointerCapture || !handle.hasPointerCapture(e.pointerId)) return;
            var rightSide = drawer.classList.contains('wb-side-right');
            var w = rightSide ? (e.clientX - startX + startW) : startW + (startX - e.clientX);
            var maxW = 2600; // 上限仅防极端溢出屏幕，不再绑定对话框宽度
            w = Math.max(240, Math.min(w, maxW));
            drawer.style.setProperty('--wb-drawer-w', Math.round(w) + 'px');
            try { localStorage.setItem('wbDrawerWidth', String(Math.round(w))); } catch (err) {}
        });
        function endDrag(e) {
            if (!handle.hasPointerCapture || !handle.hasPointerCapture(e.pointerId)) return;
            try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
            drawer.classList.remove('wb-dragging');
        }
        handle.addEventListener('pointerup', endDrag);
        handle.addEventListener('pointercancel', endDrag);
        // 双击横向把手：恢复默认宽
        handle.addEventListener('dblclick', function (e) {
            e.preventDefault(); e.stopPropagation();
            drawer.style.removeProperty('--wb-drawer-w');
            try { localStorage.removeItem('wbDrawerWidth'); } catch (err) {}
            if (drawer.classList.contains('open')) setTimeout(fitView, 300);
        });
        try {
            var saved = parseInt(localStorage.getItem('wbDrawerWidth'), 10);
            if (saved >= 240) drawer.style.setProperty('--wb-drawer-w', saved + 'px');
        } catch (err) {}
    }

    // ---------- 左右切换：把抽屉从对话框左缘换到右缘（或反之） ----------
    function flipDrawerSide() {
        if (!drawer) return;
        var toRight = !drawer.classList.contains('wb-side-right');
        drawer.classList.toggle('wb-side-right', toRight);
        try { localStorage.setItem('wbDrawerSide', toRight ? 'right' : 'left'); } catch (err) {}
        // 同步到服务端（跨浏览器/清缓存后仍记得左右位置）
        try {
            fetch('/api/workbench/state', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slot: '__global_side__', state: { _side: toRight ? 'right' : 'left' } })
            }).catch(function () {});
        } catch (err) {}
        var btn = drawer.querySelector('.wb-flip');
        if (btn) btn.title = toRight ? '切换到左侧' : '切换到右侧';
        if (drawer.classList.contains('open')) setTimeout(fitView, 300);
        // 【联动修复】左右切换后立即刷新整理面板的虚拟框（否则整理面板仍画在旧侧）
        try {
            if (window.MinimapOrganize && typeof MinimapOrganize.refresh === 'function') {
                MinimapOrganize.refresh();
                setTimeout(function () { try { MinimapOrganize.refresh(); } catch (e) {} }, 320);
            }
        } catch (err) {}
    }

    function toggleDrawer(force) {
        var drawer = buildDrawer();
        bindDrawerResize();
        try { if (localStorage.getItem('wbDrawerSide') === 'right') drawer.classList.add('wb-side-right'); } catch (err) {}
        var open = typeof force === 'boolean' ? force : !drawer.classList.contains('open');
        var host = hostBox;
        if (!host) {
            drawer.classList.toggle('open', open);
            // 【修复：开合状态丢失】兜底早退路径（host 尚未挂载/引用失效）此前只切 class 不持久化，
            // 导致重启后抽屉永远恢复不了。此处兜底：从 drawer 反查宿主对话框，算出稳定槽位并写
            // localStorage + 同步服务端，保证任何路径下开合状态都被记住。
            var _fbHost = null;
            try { _fbHost = drawer.closest('.chatbox, .chat-box, .chat-node'); } catch (e) {}
            if (!_fbHost && drawer.parentElement) {
                try { _fbHost = drawer.parentElement.closest('.chatbox, .chat-box, .chat-node'); } catch (e) {}
            }
            if (_fbHost) {
                try {
                    if (!_fbHost.dataset.wbSlot) {
                        var _seq = document.querySelectorAll('[data-wb-slot]').length;
                        var _stable = _fbHost.id || (window.Tools && Tools.currentChatId) || '';
                        _fbHost.dataset.wbSlot = _stable ? 'wb_c_' + _stable : _stableSlotKey(_fbHost, _seq + 1);
                    }
                    var _fslot = _fbHost.dataset.wbSlot;
                    localStorage.setItem('wbDrawerOpen_' + _fslot, open ? '1' : '0');
                    _fbHost.classList.toggle('wb-drawer-open', open);
                    var _myBtn = _fbHost.querySelector('.wb-toggle-btn');
                    if (_myBtn) _myBtn.classList.toggle('on', open);
                    try {
                        fetch('/api/workbench/state', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ slot: _fslot, state: { _open: open } })
                        }).catch(function () {});
                    } catch (e2) {}
                } catch (e) {}
            }
            // 兜底早退路径（host 尚未挂载）同样即时刷新小地图，避免方块滞后 2s 轮询
            try {
                if (window.App && typeof App.updateMinimap === 'function') {
                    if (App._mmRaf) { cancelAnimationFrame(App._mmRaf); App._mmRaf = 0; }
                    App.updateMinimap();
                }
            } catch (e) {}
            return;
        }
        // 鎸夐挳楂樹寒锛氬彧鐐逛寒褰撳墠瀵硅瘽鑷繁鐨勬寜閽紝鍏朵綑瀵硅瘽鎸夐挳鍙栨秷楂樹寒
        var myBtn = host.querySelector('.wb-toggle-btn');
        if (myBtn) myBtn.classList.toggle('on', open);
        // 浼氳瘽妲戒綅锛氭瘡涓璇濈嫭绔嬩竴浠藉伐浣滃彴鐘舵€?
        if (!host.dataset.wbSlot) {
            var seq = document.querySelectorAll('[data-wb-slot]').length;
            var stable = host.id || (window.Tools && Tools.currentChatId) || '';
            host.dataset.wbSlot = stable ? 'wb_c_' + stable : _stableSlotKey(host, ++seq);
        }
        var newSlot = host.dataset.wbSlot;
        curSlot = newSlot;   // 激活 curSlot（此前仅声明从未赋值=死变量），服务端读写与 per-slot key 对齐
        // 页签记忆：恢复上次使用的页签（默认浏览器）——必须在槽位确定之后，否则首次打开会读到旧对话的页签
        try {
            var _lastTab = localStorage.getItem('wbDrawerTab_' + (newSlot || curSlot || 'default'));
            if (_lastTab && _lastTab !== 'browser') {
                var _ltb = drawer.querySelector('.wb-tab[data-wbtab="' + _lastTab + '"]');
                if (_ltb) {
                    drawer.querySelectorAll('.wb-tab').forEach(function (x) { x.classList.toggle('active', x === _ltb); });
                    drawer.querySelectorAll('.wb-workbench').forEach(function (w) { w.classList.toggle('active', w.dataset.wbwork === _lastTab); });
                    // 【修复：点页签没反应】样式类恢复但 curTab 仍是初始值 'browser'，
                    // 用户随后点击该页签会被 t === curTab 早退吞掉（表现为点击无任何反应）。
                    // 此处必须同步 curTab，与视觉激活态一致。
                    curTab = _lastTab;
                }
            }
        } catch (err) {}
        var slotChanged = NS.workbenchSlot && NS.workbenchSlot !== newSlot;
        // 鍒囨崲瀵硅瘽鏃讹細瀛樺洖涓婁竴涓璇濈殑鐘舵€侊紝骞舵竻鎺夊畠鐨勫睍寮€鎬?
        if (slotChanged) {
            var prev = drawer.parentElement;
            if (prev && prev !== host && prev.classList) prev.classList.remove('wb-drawer-open');
            try { saveStateNow(); } catch (e) {}
        }
        // 鎶藉眽鎻掍负瀵硅瘽妗嗙涓€涓瓙鑺傜偣锛氫粠瀵硅瘽妗嗗乏缂樺悜澶栨娊鍑虹殑鍏ㄩ珮鎶藉眽
        // 【专注模式进坞 guard】抽屉被专注模式搬进 #zfWbDock 时，禁止本函数再 reparent 回对话框
        if (drawer.classList.contains('zf-wb-docked')) {
            drawer.classList.toggle('open', open);
            return;
        }
        if (drawer.parentElement !== host) {
            host.insertBefore(drawer, host.firstChild);
        }
        host.classList.add('wb-drawer-host');
        host.classList.toggle('wb-drawer-open', open);
        // 注：下行 classList.toggle 与上一行重复，为兼容旧恢复逻辑保留的已知冗余，故意不动（勿当 bug 反复上报）
        try { host.classList.toggle('wb-drawer-open', open); localStorage.setItem('wbDrawerOpen_' + (host.dataset.wbSlot || curSlot || 'default'), open ? '1' : '0'); } catch (err) {}
        if (open) {
            drawer.classList.add('open');
            setTimeout(fitView, 300);
            restoreState();     // 姣忔打开/鍒囨崲閮借浇鍏ユ湰瀵硅瘽鑷繁鐨勭姸鎬?
            loadWbTools();
            syncEmptyHint();
            // 默认页签为浏览器：打开即激活浏览器面板（无需手点页签）
            try {
                var _btab = drawer.querySelector('.wb-tab[data-wbtab="browser"]');
                if (_btab && _btab.classList.contains('active')) brActivate();
                // 【视频独立】切换对话后若页签记忆停在视频，立即按新对话 ?conv= 重载 iframe
                var _vtab = drawer.querySelector('.wb-tab[data-wbtab="video"]');
                if (_vtab && _vtab.classList.contains('active')) wbVideoEnsure();
            } catch (e) {}
        } else {
            drawer.classList.remove('open');
            host.classList.remove('wb-drawer-open');
            try { brStopPoll(); } catch (e) {}
            try { brStreamStop(); } catch (e) {}   // 抽屉关闭即断开视频流
        }
        try { saveStateNow(); } catch (e) {}   // 开合状态立即同步服务端（绕过 debounce，防 1.2s 内刷新丢失）
        // 【联动】工作台（含工作台浏览器）开合 → 立即刷新右下角导航小地图，
        // 关闭即消失、打开即出现，不再等 2s 轮询（清 _mmRaf 防去重吞掉本次刷新）
        try {
            if (window.App && typeof App.updateMinimap === 'function') {
                if (App._mmRaf) { cancelAnimationFrame(App._mmRaf); App._mmRaf = 0; }
                App.updateMinimap();
                setTimeout(function () {
                    try {
                        if (App._mmRaf) { cancelAnimationFrame(App._mmRaf); App._mmRaf = 0; }
                        App.updateMinimap();
                    } catch (e) {}
                }, 320);   // 抽屉 0.28s 动画结束后按最终尺寸补一帧
            }
        } catch (e) {}
        // 【联动 v2】工作台开合 → 同步刷新左下角整理面板的工作台虚拟框
        try {
            if (window.MinimapOrganize && typeof MinimapOrganize.refresh === 'function') {
                MinimapOrganize.refresh();
                setTimeout(function () { try { MinimapOrganize.refresh(); } catch (e) {} }, 320);
            }
        } catch (e) {}
    }

    // ---------- 拖拽移动（标题栏）：v2 已废弃自由拖拽，抽屉随对话框布局 ----------
    function bindDrag() {
        var bar = drawer.querySelector('.wb-drawer-tabs');
        bar.style.cursor = 'default';
    }

    function bindResize() {
        // v2：宽度改为 100%（跟随对话框），调宽把手已隐藏，此函数保留为空实现
    }


        // == per-instance API ==
        return {
        _getDrawer: function () { return drawer; },
        toggle: toggleDrawer,
        open: function () { toggleDrawer(true); },
        close: function () { toggleDrawer(false); },
        addImage: addBlobAsLayer,          // 供画布节点「送入工作台」等后续集成
        getLayers: function () { return layers; },
        getSelection: function () { return sel ? { x: Math.round(sel.x), y: Math.round(sel.y), w: Math.round(sel.w), h: Math.round(sel.h) } : null; },
        fit: fitView,
        applyTool: applyToolLocal,         // AI 侧回写入口：NS.workbench.applyTool('brightness',{factor:1.3})
        saveState: saveState,
            restoreState: restoreState,
        openBrowserAt: function (u) {          // 论坛等外部入口：打开工作台并直达浏览器页签
            var dw = null;
            try { dw = buildDrawer(); } catch (e) {}
            var alreadyOpen = !!(dw && dw.classList.contains('open'));
            if (!alreadyOpen) toggleDrawer(true);
            var tb = dw && dw.querySelector('.wb-tab[data-wbtab="browser"]');   // 统一用 dw（buildDrawer 返回值），避免与闭包 drawer 混用
            if (tb && !tb.classList.contains('active')) tb.click();   // 已在浏览器页签则不重复切换（避免画面闪动）
            setTimeout(function () { try { brNav(u); } catch (e) {} }, alreadyOpen ? 0 : 120);
        }
        };
    }   // == end createWorkbench ==

    // ---------- 启动：恢复每个对话上次的工作台展开状态与页签 ----------
    function _restoreOne(box) {   // 单个对话框的恢复（供启动扫描与延迟重试共用）
        var unresolved = 0;
        var slot = box.dataset && box.dataset.wbSlot;
            if (!slot) {
                // 重启后新建的对话框可能还没分配槽位：按稳定 id 现算，保证与保存时的 key 一致
                var stable = box.id || (window.Tools && Tools.currentChatId) || '';
                if (!stable) {
                    // 此时无法确定槽位：不永久放弃，延迟后重试本对话框（修复：重启后抽屉开关丢失）
                    box.dataset.wbRestoreTries = String((parseInt(box.dataset.wbRestoreTries || '0', 10) || 0) + 1);
                    if (parseInt(box.dataset.wbRestoreTries, 10) <= 20) {
                        setTimeout(function () { try { _restoreOne(box); } catch (e) {} }, 500);
                    }
                    return { unresolved: 0 };
                }
                slot = 'wb_c_' + stable;
                try { box.dataset.wbSlot = slot; } catch (e) {}
            }
            var flag = null;
            try { flag = localStorage.getItem('wbDrawerOpen_' + slot); } catch (e) {}
            function _applyOpen() {
                var inst = getInstance(box);
                var _dw = inst && inst._getDrawer && inst._getDrawer();
                if (!(inst && _dw)) return false;   // 实例未就绪：返回 false，交由重试调度再试
                if (!_dw.classList.contains('open')) {
                    inst.open();
                    // 页签记忆：恢复该对话上次使用的页签（localStorage，非浏览器时模拟点击触发 activateTab）
                    try {
                        var _lt = localStorage.getItem('wbDrawerTab_' + slot);
                        if (_lt && _lt !== 'browser') {
                            var _tb = inst._getDrawer().querySelector('.wb-tab[data-wbtab="' + _lt + '"]');
                            if (_tb) setTimeout(function () { try { _tb.click(); } catch (e) {} }, 120);
                        }
                    } catch (e) {}
                }
                // 【修复：重启恢复到引擎/视频页签时白屏】上面的模拟点击仅在「抽屉原本未展开」分支里执行；
                // 抽屉已展开时 inst.open() 不触发、curTab 也不更新 → 点击被 t === curTab 吞掉。
                // 这里补一刀：展开态下也确保页签记忆被真实点击一次（click 内部有 t === curTab 防抖，幂等安全）。
                try {
                    var _lt2 = localStorage.getItem('wbDrawerTab_' + slot);
                    var _tb2 = _dw.querySelector('.wb-tab[data-wbtab="' + _lt2 + '"]');
                    if (_lt2 && _tb2 && !_tb2.classList.contains('active')) setTimeout(function () { try { _tb2.click(); } catch (e) {} }, 120);
                } catch (e) {}
                return true;   // 实例就绪并已应用（或本就处于展开态）
            }
            if (box.dataset.wbRestored === '1') return { unresolved: 0 };   // 已落地，重扫时跳过
            if (flag === '1') {
                var _ok = _applyOpen();
                if (!_ok) unresolved++;   // 实例未就绪，本次落空 → 交给重试
                else { try { box.dataset.wbRestored = '1'; } catch (e) {} }
            } else if (flag !== '0') {
                // localStorage 无记录（可能被清/不可靠）→ 回退读服务端 _open
                unresolved++;
                try {
                    fetch('/api/workbench/state?slot=' + encodeURIComponent(slot)).then(function (r) { return r.json(); }).then(function (j) {
                        if (j && j.ok && j.state && j.state._open === true) {
                            if (_applyOpen()) { try { box.dataset.wbRestored = '1'; } catch (e) {} }
                        } else { try { box.dataset.wbRestored = '1'; } catch (e) {} }   // 服务端确认关闭：不再重试
                    }).catch(function () {});
                } catch (e) {}
            }
        return { unresolved: unresolved };
    }
    function restoreOpenState() {
        var unresolved = 0;   // 尚无法判定/应用的对话框数（供重试调度参考）
        document.querySelectorAll('.chatbox, .chat-box, .chat-node').forEach(function (box) {
            try {
                var _r = _restoreOne(box);
                if (_r && _r.unresolved) unresolved += _r.unresolved;
            } catch (e) {}
        });
        return { unresolved: unresolved, total: document.querySelectorAll('.chatbox, .chat-box, .chat-node').length };
    }
    var _rosTries = 0;
    function restoreOpenStateRetry() {
        var _r = restoreOpenState();
        _rosTries++;
        // 逐对话框判定而非全局短路：只要有任一对话框仍无法应用（实例未就绪 / DB 慢），
        // 前 30 秒内每 3 秒重扫一次；全部落地或达上限后停止。
        // 旧逻辑只要页面出现一个已展开抽屉就停止重试，先恢复的对话会“截胡”，
        // 后渲染的对话永远不再恢复 → 重启后开合状态丢失。
        if (_rosTries < 10 && _r.unresolved > 0) {
            setTimeout(restoreOpenStateRetry, 3000);
        }
    }
    setTimeout(restoreOpenStateRetry, 800);
    setTimeout(restoreOpenState, 2500);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectToggle);
    else injectToggle();

    // == Manager layer: button injection / delegation / global API routing ==
    function makeToggleBtn() {
        var b = document.createElement('button');
        b.className = 'hd-btn wb-toggle-btn';
        b.title = '工作区';
        // 2026-10-04 v2：改为「扳手+尺子」工具风格图标（实用感强，区别于编辑笔和调色板）
        b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 0 0 6-6L14 13l-3-3 3.7-3.7z"/></svg>';
        b.style.cssText = 'display:inline-flex;align-items:center;gap:0;padding:2px 8px;';
        b.addEventListener('click', function () {
            // 2026-10-18：专注模式内 = 与右上角「显示/隐藏工作台」同一行为（进坞/出坞切换）
            if (document.body.classList.contains('zf-focus') && document.getElementById('zfFocusRoot') && typeof window.__focusModeToggleWb === 'function') {
                window.__focusModeToggleWb();
                return;
            }
            var box = b.closest('.chatbox, .chat-box, .chat-node');
            // 2026-10-18 修复：对话框可能嵌套（皮肤/角色节点再包一层 .chatbox），
            // closest 会命中内层导致实例表对不上、抽屉被内层 overflow 裁剪 → 打不开。
            // 统一取最外层宿主，与 getInstance/restoreOpenState 的注册对象保持一致。
            if (box) { var _p = box.parentElement; while (_p && _p !== document.body) { if (_p.matches && _p.matches('.chatbox, .chat-box, .chat-node')) { box = _p; } _p = _p.parentElement; } }
            var inst = getInstance(box);
            if (inst) inst.toggle();
        });
        return b;
    }
    function injectToggleInto(box) {
        // ② 工作台按钮并入底部「加号/语音同排」(inputrow)，不再锚定 mastercluster-btn（它已搬进⋯菜单）
        if (!box || box.querySelector('.wb-toggle-btn')) return;
        var inputrow = box.querySelector('.chatbox-inputrow');
        if (inputrow) { inputrow.appendChild(makeToggleBtn()); return; }
        var anchor = box.querySelector('.model-picker-wrap')
            || box.querySelector('.cfg-branch-btn')
            || box.querySelector('.chatbox-configrow')
            || box.querySelector('.chatbox-inputrow');
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(makeToggleBtn(), anchor);
        else if (typeof box.appendChild === 'function') box.appendChild(makeToggleBtn());
    }
    function injectToggle() {
        document.querySelectorAll('.chatbox, .chat-box, .chat-node').forEach(injectToggleInto);
    }
    var MO_PENDING = false;
    function onDomChange() {
        if (MO_PENDING) return;
        MO_PENDING = true;
        setTimeout(function () { MO_PENDING = false; injectToggle(); }, 100);
    }
    (function watchToggle() {
        try {
            new MutationObserver(onDomChange).observe(document.body, { childList: true, subtree: true });
        } catch (e) {}
        try {
            if (window.App && App.createChatBox) {
                var orig = App.createChatBox;
                App.createChatBox = function () {
                    var bx = orig.apply(this, arguments);
                    try { injectToggleInto(bx); } catch (e) {}
                    return bx;
                };
            }
        } catch (e) {}
        setInterval(injectToggle, 10000);
    })();
    document.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('.wb-chat-btn');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        var box = btn.closest('.chatbox, .chat-box, .chat-node');
        if (box) NS.workbenchActiveNode = box;
        var inst = getInstance(box);
        if (inst) inst.toggle(true);
    });

    // == Global API: routes to active chatbox instance ==
    NS.workbench = {
        toggle: function (box) { var i = getInstance(box); if (i) i.toggle(); },
        open: function (box) { var i = getInstance(box); if (i) i.open(); },
        close: function (box) { var i = getInstance(box); if (i) i.close(); },
        addImage: function (blob, box) { var i = getInstance(box); if (i) i.addImage(blob); },
        // 读取工作台当前画面（含选区）供 AI/控制台读取：
        // NS.workbench.getImage() -> { hasImage, dataUrl, sel:{x,y,w,h}|null, layers:n }
        // 【2026-10-02 页签闸门】getActiveTab() 供发送链路判定当前激活页签；
        // 取不到状态返回 null（调用方默认放行，保持普通对话行为）。
        getActiveTab: function () {
            try {
                var _i = document.querySelector('.chatbox.focused');
                var inst = getInstance(_i);
                if (inst && inst._getDrawer) {
                    var _dw = inst._getDrawer();
                    if (_dw && _dw.classList.contains('open')) {
                        var _act = _dw.querySelector('.wb-tab.active');
                        return _act ? (_act.dataset.wbtab || null) : null;
                    }
                }
            } catch (e) {}
            return null;
        },
        getImage: function (box) {
            var i = getInstance(box);
            if (!i) return { hasImage: false, dataUrl: null, sel: null, layers: 0 };
            // 【放宽·2026-10-02】只要抽屉打开就允许识图（原要求 image 页签前台，易静默失效）。
            // 返回 tabActive 标记供调用方提示；画面合成限最长边 1024 控 token。
            var _tabActive = true;
            try {
                var _dw = i._getDrawer && i._getDrawer();
                if (!_dw || !_dw.classList.contains('open')) {
                    return { hasImage: false, dataUrl: null, sel: null, layers: 0 };
                }
                var _imgPane = _dw.querySelector('.wb-workbench[data-wbwork="image"]');
                _tabActive = !!(_imgPane && _imgPane.classList.contains('active'));
            } catch (e) {}
            var vis = i.getLayers().filter(function (l) { return l.visible && l.canvas; });
            if (!vis.length) return { hasImage: false, dataUrl: null, sel: null, layers: 0 };
            var maxX = 0, maxY = 0;
            vis.forEach(function (l) {
                maxX = Math.max(maxX, l.x + l.canvas.width);
                maxY = Math.max(maxY, l.y + l.canvas.height);
            });
            var c = document.createElement('canvas');
            c.width = maxX; c.height = maxY;
            var ctx = c.getContext('2d');
            vis.forEach(function (l) {
                ctx.globalAlpha = l.opacity == null ? 1 : l.opacity;
                ctx.drawImage(l.canvas, l.x, l.y);
            });
            ctx.globalAlpha = 1;
            // 限最长边 1024（识图注入控 token；原图数据不动）
            var _out = c, _m = Math.max(c.width, c.height);
            if (_m > 1024) {
                var _k = 1024 / _m;
                var _sc = document.createElement('canvas');
                _sc.width = Math.round(c.width * _k); _sc.height = Math.round(c.height * _k);
                _sc.getContext('2d').drawImage(c, 0, 0, _sc.width, _sc.height);
                _out = _sc;
            }
            return { hasImage: true, dataUrl: _out.toDataURL('image/png'), sel: i.getSelection(), layers: vis.length, tabActive: _tabActive };
        },
        getSelection: function (box) {
            var i = getInstance(box);
            return i ? i.getSelection() : null;
        },
        getLayers: function (box) { var i = getInstance(box); return i ? i.getLayers() : []; },
        fit: function (box) { var i = getInstance(box); if (i) i.fit(); },
        applyTool: function (t2, p, box) { var i = getInstance(box); if (i) i.applyTool(t2, p); },
        saveState: function (box) { var i = getInstance(box); if (i) i.saveState(); },
        restoreOpenState: function () { try { restoreOpenState(); } catch (e) {} },   // 供 App.restoreSession 末尾补调（DB 冷启动慢时 800/2500ms 扫描会落空）
        restoreState: function (box, cb) { var i = getInstance(box); if (i) i.restoreState(cb); },
        openBrowserAt: function (url, box) {
            var i = getInstance(box);
            if (i && i.openBrowserAt) i.openBrowserAt(url);
            else if (i) { i.open(); setTimeout(function () { try { i.openBrowserAt(url); } catch (e) {} }, 100); }
        }
    };
})();
