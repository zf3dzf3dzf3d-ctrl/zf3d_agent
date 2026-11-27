/* zf-dock-defaultorder.js —— 【2026-11-12】i桌面图标默认排序（用户需求：常用放外面，不常用收进「无限 ∞」面板）
   机制：zf-app-dock.js 用 localStorage.zfDockAppOrder 存图标顺序，MAX_VISIBLE=10，
        前 10 个显示在 Dock 上，其余自动进「无限 ∞」面板。
   本文件只在【用户从未自定义过顺序】时写入默认顺序（不覆盖已有拖拽结果）。
   必须在 zf-app-dock.js 之前加载。 */
(function () {
  'use strict';
  var ORDER_KEY = 'zfDockAppOrder';
  /* 前 10 个 = 常用（Dock 外面，按使用频率排序）；其余为不常用，自动溢出到「无限 ∞」面板 */
  var DEFAULT_ORDER = [
    /* —— 常用 10：Dock 外面 —— */
    'new-chat',        // 新建对话
    'plaza-chat',      // i聊天
    'manga-cabinet',   // i漫画
    'novel-player',    // i小说
    'image-app',       // i图片
    'idol-app',        // i偶像
    'igen-app',        // i模型生成
    'video-app',       // i视频
    'music-app',       // i音乐
    'game-app',        // i游戏
    /* —— 不常用：溢出进「无限 ∞」面板（顺序即面板内顺序） —— */
    'web-app',         // i网页
    'collect-app',      // i采集
    'iauth-app',        // i授权
    'news-app',        // i新闻
    'contest-app',      // i大赛
    'hardware-master',  // i硬件
    'calc-app',         // i计算器
    'home-app',         // i家电
    'notes-app',        // i记事本
    'tv-app',           // i电视
    'app-settings',     // 设置
    'zf-sys-tts',       // 朗读助手
    'zf-sys-site',      // 朱峰社区网站
    'zf-sys-cmd',       // 指挥台
    'zf-sys-theme',     // i界面
    'zf-sys-lang',      // 切换语言
    'zf-sys-growth',    // 智能体等级
    'zf-sys-butler',    // 管家团
    'zf-sys-focus',     // 专注模式
    'zf-sys-about',     // 关于我们
    'zf-sys-privacy'    // i隐私
  ];
  try {
    if (!localStorage.getItem(ORDER_KEY)) {
      localStorage.setItem(ORDER_KEY, JSON.stringify(DEFAULT_ORDER));
    }
  } catch (e) { /* localStorage 不可用（隐私模式等）时静默降级 */ }
})();
