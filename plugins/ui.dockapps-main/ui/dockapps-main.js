/* ui.dockapps-main —— Dock 主包 16 程序（R1-2 第二波，策划案v4 T1）
 * 与主文件解耦：只经 window.ZFDockBridge {register, createAppWindow, zfVerSrc,
 * prefetchAppJs} 交互；ui-mounts 装载器在 DOMContentLoaded 后注入（晚于
 * zf-app-dock.js 静态执行，桥必然就绪）。
 * 代码搬运自 zf-app-dock.js 冻结区，逻辑零改动；三处已注明的适配：
 * ① strict mode 下补 var townTimer 声明（原依赖隐式全局）；
 * ② i漫画窗口由 buildOnce 预建改为首次打开懒建（用户不可见差异）；
 * ③ 结尾把 open/close/mangaCmd 回挂 window.ZFDock（外部消费契约不变）。
 */
(function () {
  'use strict';
  var b = window.ZFDockBridge;
  if (!b || !b.register || !b.createAppWindow) {
    console.warn('[ui.dockapps-main] ZFDockBridge 未就绪，跳过');
    return;
  }
  var register = b.register, createAppWindow = b.createAppWindow,
      zfVerSrc = b.zfVerSrc, prefetchAppJs = b.prefetchAppJs;

  /* ---------- i大赛窗口：内嵌 contest.html iframe（2026-11-12 M1） ---------- */
  var ICON_CONTEST = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3"/></svg>';
  var contestWin = null;
  function openContest() {
    if (!contestWin) {
      contestWin = createAppWindow({
        id: 'zfContestWin',
        title: 'i大赛',
        icon: ICON_CONTEST,
        bodyHtml:
          '<div style="flex:1;overflow:hidden;">' +
          '  <iframe src="/contest.html" style="width:100%;height:100%;border:none;display:block;"></iframe>' +
          '</div>'
      });
      document.body.appendChild(contestWin);
    }
    contestWin.classList.add('open');
  }

  /* ---------- i漫画窗口（含 AppLock 门禁；窗口改懒建·适配②） ---------- */
  var ICON_MANGA = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 5.5C10.4 4.2 8.2 3.5 5.5 3.5c-.8 0-1.5.7-1.5 1.5v12c0 .8.7 1.5 1.5 1.5 2.7 0 4.9.7 6.5 2 1.6-1.3 3.8-2 6.5-2 .8 0 1.5-.7 1.5-1.5V5c0-.8-.7-1.5-1.5-1.5-2.7 0-4.9.7-6.5 2z"/>' +
    '<path d="M12 5.5V20.5"/>' +
    '</svg>';
  var mangaWin = null;
  function buildMangaWin() {
    return createAppWindow({
      id: 'zfMangaWin',
      title: 'i漫画',
      icon: ICON_MANGA,
      onClose: closeManga,
      bodyHtml:
        '<div class="zf-manga-body" id="zfMangaBody">' +
        '  <div class="zfm-handle" title="鼠标移到顶部显示工具条"></div>' +
        '  <div class="zfm-boot"><div class="zfm-spin"></div><p>正在准备书架…</p></div>' +
        '</div>'
    });
  }
  function openManga() {
    /* 应用锁门禁（策划案-App应用锁-v2）：已锁且未解锁则先弹密码盘 */
    if (window.ZFAppLock) {
      window.ZFAppLock.gate('manga', _openMangaLocked);
      return;
    }
    /* 密码盘脚本未加载（兜底直通）—— 正常流程 index.html 已先载入 */
    _openMangaLocked();
  }
  function _openMangaLocked() {
    /* 适配②：原 dock 在 buildOnce 预建窗口，插件化改首次打开懒建 */
    if (!mangaWin) { mangaWin = buildMangaWin(); document.body.appendChild(mangaWin); }
    mangaWin.classList.add('open');
    syncRbarHeight();
    /* 悬浮条 2.5s 无操作自动淡出：鼠标/键盘/滚动动作即移除 idle，恢复 hover 显示 */
    var body = mangaWin.querySelector('#zfMangaBody');
    if (body && !body.dataset.zfmIdleInit) {
      body.dataset.zfmIdleInit = '1';
      var idleTimer = null;
      var wake = function () {
        body.classList.remove('zfm-idle');
        clearTimeout(idleTimer);
        idleTimer = setTimeout(function () { body.classList.add('zfm-idle'); }, 2500);
      };
      body.addEventListener('mousemove', wake);
      body.addEventListener('mousedown', wake);
      body.addEventListener('keydown', wake);
      body.addEventListener('scroll', wake, true);
      wake();
    }
    // 挂载i漫画内容（zf-app-manga.js），只挂一次
    var body = mangaWin.querySelector('#zfMangaBody');
    if (body && !body.dataset.zfmMounted) {
      body.dataset.zfmMounted = '1';
      /* 首次引导提示条：6 秒后淡出，或用户首次唤出工具条后立即淡出 */
      var hint = body.querySelector('#zfmHint');
      if (hint) {
        setTimeout(function () { hint.classList.add('zfm-hint-off'); }, 6000);
        body.addEventListener('mouseenter', function once() {
          hint.classList.add('zfm-hint-off');
          body.removeEventListener('mouseenter', once);
        });
      }
      var s = document.createElement('script');
      s.src = zfVerSrc('js/zf-app-manga.js');  /* 固定版本号：命中浏览器缓存（旧 Date.now() 每次强制重新下载，打开慢主因） */
      s.onload = function () { window.ZFManga && window.ZFManga.onOpen(body); };
      document.head.appendChild(s);
    } else if (window.ZFManga) {
      window.ZFManga.onOpen(body);
    }
  }
  function closeManga() {
    window.ZFManga && window.ZFManga.onClose && window.ZFManga.onClose();
    mangaWin && mangaWin.classList.remove('open');
  }
  /* 同步 viewbar top 为 rbar 实际高度（rbar 换行时避免两悬浮条重叠）——随 i漫画迁入 */
  function syncRbarHeight() {
    var body = mangaWin && mangaWin.querySelector('#zfMangaBody');
    var rbar = body && body.querySelector('.zfm-rbar');
    if (rbar) body.style.setProperty('--zfm-rbar-h', (rbar.offsetHeight + 6) + 'px');
  }
  /* M-W2 对话→漫画指令通道：对话侧可调 window.ZFDock.mangaCmd('search', {kw:'海贼王'}) 驱动漫画窗口 */
  function mangaCmd(cmd, args) {
    openManga();
    var api = window.ZFManga;
    if (!api) return { ok: false, err: 'manga app not mounted' };
    if (cmd === 'search' && args && args.kw) return api.search(args.kw);
    if (cmd === 'src' && args && args.src) return api.setSrc(args.src);
    if (cmd === 'dlStatus') return api.dlStatus();
    return { ok: false, err: 'unknown cmd: ' + cmd };
  }

  /* ---------- i聊天（智能体广场）窗口：内嵌 plaza.html iframe ---------- */
  var ICON_CHAT = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="10" r="4.2"/><path d="M3.5 16.5c1.3-1.6 2.8-2.4 4.5-2.4s3.2.8 4.5 2.4"/><circle cx="16.5" cy="8.5" r="3.2"/><path d="M12.9 14.3c1-1.2 2.2-1.8 3.6-1.8 1.9 0 3.5 1 4.9 3"/><path d="M9.5 20h5"/></svg>';  /* 多智能体群像：两个头像=广场多人聊天，与 i对话(单气泡)区分 */
  var chatWin = null;
  function openChat() {
    if (!chatWin) {
      chatWin = createAppWindow({
        id: 'zfChatWin',
        title: 'i聊天',
        icon: ICON_CHAT,
        bodyHtml:
          '<div style="flex:1;overflow:hidden;">' +
          '  <iframe src="/plaza.html?v=4" style="width:100%;height:100%;border:none;display:block;"></iframe>' +
          '</div>'
      });
      document.body.appendChild(chatWin);
    }
    chatWin.classList.add('open');
  }

  /* ---------- i小说窗口：内嵌 inovel.html iframe（2026-11-11 S1） ---------- */
  var ICON_NOVEL = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5.5C10.5 4 8.5 3.5 6.5 3.5c-1 0-2 .2-3 .5v15c1-.3 2-.5 3-.5 2 0 4 .5 5.5 2 1.5-1.5 3.5-2 5.5-2 1 0 2 .2 3 .5v-15c-1-.3-2-.5-3-.5-2 0-4 .5-5.5 2z"/><path d="M12 5.5v15M8 8.5h1.5M8 11.5h1.5M14.5 8.5H16M14.5 11.5H16"/></svg>';
  var novelWin = null;
  function openNovel() {
    if (!novelWin) {
      novelWin = createAppWindow({
        id: 'zfNovelWin',
        title: 'i小说',
        icon: ICON_NOVEL,
        bodyHtml:
          '<div style="flex:1;overflow:hidden;">' +
          '  <iframe src="/inovel.html" style="width:100%;height:100%;border:none;display:block;"></iframe>' +
          '</div>'
      });
      document.body.appendChild(novelWin);
    }
    novelWin.classList.add('open');
  }
  function closeNovel() {
    novelWin && novelWin.classList.remove('open');
  }

  /* ---------- i小镇窗口：内嵌 town.html 群聊界面 iframe（2026-11-20 修正：统一以 public/town.html 村民直播广场为唯一真源） ---------- */
  var ICON_TOWN = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V10l4-3v14"/><path d="M13 21V7l6 3v11"/><path d="M15 12h2M15 15h2M7 13h1.5M7 16h1.5"/><path d="M9 7V4l2 1.5V7"/></svg>';
  var townWin = null;
  var townTimer;  /* 适配①：原依赖隐式全局，strict mode 下需显式声明 */
  function openTown() {
    if (!townWin) {
      townWin = createAppWindow({
        id: 'zfTownWin',
        title: 'i小镇',
        icon: ICON_TOWN,
        bodyHtml:
          '<div style="flex:1;overflow:hidden;">' +
          '  <iframe src="/town.html?v=6" style="width:100%;height:100%;border:none;display:block;"></iframe>' +
          '</div>',
        onClose: function () {
          townWin.classList.remove('open');
        }
      });
      document.body.appendChild(townWin);
    }
    townWin.classList.add('open');
  }
  function closeTown() {
    clearInterval(townTimer);
    townTimer = null;
    townWin && townWin.classList.remove('open');
  }

  /* ---------- i硬件窗口（AI硬件管家 M-H1） ---------- */
  var ICON_HW = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></svg>';
  var hwWin = null;
  function openHardware() {
    if (!hwWin) {
      hwWin = createAppWindow({
        id: 'zfHardwareWin',
        title: 'i硬件',
        icon: ICON_HW,
        bodyHtml: '<div id="zfHardwareBody" style="flex:1;overflow:auto;padding:12px;"></div>',
        onClose: function (w) { window.ZFHardware && window.ZFHardware.onClose && window.ZFHardware.onClose(); w.classList.remove('open'); }
      });
      document.body.appendChild(hwWin);
    }
    hwWin.classList.add('open');
    var body = hwWin.querySelector('#zfHardwareBody');
    if (body && !body.dataset.zfhMounted) {
      body.dataset.zfhMounted = '1';
      var s = document.createElement('script');
      s.src = zfVerSrc('js/zf-app-hardware.js');  /* 固定版本号：命中浏览器缓存（旧 Date.now() 每次强制重新下载，打开慢主因） */
      s.onload = function () { window.ZFHardware && window.ZFHardware.onOpen(body); };
      document.head.appendChild(s);
    } else if (window.ZFHardware) {
      window.ZFHardware.onOpen(body);
    }
  }

  /* ---------- i计算器窗口 ---------- */
  var ICON_CALC = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2.5" width="16" height="19" rx="2"/><rect x="7" y="5.5" width="10" height="3.5" rx="1"/><path d="M8 12.5h.01M12 12.5h.01M16 12.5h.01M8 16h.01M12 16h.01M16 16h.01M8 19h8"/></svg>';
  var calcWin = null;
  function openCalc() {
    if (!calcWin) {
      calcWin = createAppWindow({
        id: 'zfCalcWin',
        title: 'i计算器',
        icon: ICON_CALC,
        bodyHtml: '<div id="zfCalcBody" style="flex:1;overflow:hidden;display:flex;flex-direction:column;"></div>',
        onClose: function (w) { window.ZFCalc && window.ZFCalc.onClose && window.ZFCalc.onClose(); w.classList.remove('open'); }
      });
      document.body.appendChild(calcWin);
    }
    calcWin.classList.add('open');
    var body = calcWin.querySelector('#zfCalcBody');
    if (body) {
      if (!body.dataset.zfcMounted) {
        body.dataset.zfcMounted = '1';
        var s = document.createElement('script');
        s.src = zfVerSrc('js/zf-app-calc.js');  /* 固定版本号：命中浏览器缓存（旧 Date.now() 每次强制重新下载，打开慢主因） */
        s.onload = function () { window.ZFCalc && window.ZFCalc.onOpen(body); };
        document.head.appendChild(s);
      } else if (window.ZFCalc) {
        window.ZFCalc.onOpen(body);
      }
    }
  }
  function closeCalc() {
    if (!calcWin) return;
    window.ZFCalc && window.ZFCalc.onClose && window.ZFCalc.onClose();
    calcWin.classList.remove('open');
  }

  /* ---------- i记事本窗口（M-N1，仿 i硬件/i计算器） ---------- */
  var ICON_NOTES = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h11l4 4v14H5z"/><path d="M16 3v4h4M8.5 11h7M8.5 14.5h7M8.5 18h4.5"/></svg>';
  var notesWin = null;
  function openNotes() {
    if (!notesWin) {
      notesWin = createAppWindow({
        id: 'zfNotesWin',
        title: 'i记事本',
        icon: ICON_NOTES,
        bodyHtml: '<div id="zfNotesBody" style="flex:1;overflow:hidden;display:flex;"></div>',
        onClose: function (w) { window.ZFNotes && window.ZFNotes.onClose && window.ZFNotes.onClose(); w.classList.remove('open'); }
      });
      document.body.appendChild(notesWin);
    }
    notesWin.classList.add('open');
    var body = notesWin.querySelector('#zfNotesBody');
    if (body) {
      if (!body.dataset.zfnMounted) {
        body.dataset.zfnMounted = '1';
        var s = document.createElement('script');
        s.src = zfVerSrc('js/zf-app-notes.js');  /* 固定版本号：命中浏览器缓存（旧 Date.now() 每次强制重新下载，打开慢主因） */
        s.onload = function () { window.ZFNotes && window.ZFNotes.onOpen(body); };
        document.head.appendChild(s);
      } else if (window.ZFNotes) {
        window.ZFNotes.onOpen(body);
      }
    }
  }
  function closeNotes() {
    if (!notesWin) return;
    window.ZFNotes && window.ZFNotes.onClose && window.ZFNotes.onClose();
    notesWin.classList.remove('open');
  }

  /* ---------- i家电窗口（T0 设备台账，2026-11-11，仿 i记事本） ---------- */
  var ICON_HOME = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/></svg>';
  var homeWin = null;
  function openHome() {
    if (!homeWin) {
      homeWin = createAppWindow({
        id: 'zfHomeWin',
        title: 'i家电',
        icon: ICON_HOME,
        bodyHtml: '<div id="zfHomeBody" style="flex:1;overflow:hidden;display:flex;"></div>',
        onClose: function (w) { if (window.ZFHome && window.ZFHome.onClose) window.ZFHome.onClose(); w.classList.remove('open'); }
      });
      document.body.appendChild(homeWin);
    }
    homeWin.classList.add('open');
    var body = homeWin.querySelector('#zfHomeBody');
    if (body) {
      if (!body.dataset.zfhMounted) {
        body.dataset.zfhMounted = '1';
        var s = document.createElement('script');
        s.src = zfVerSrc('js/zf-app-home.js');  /* 固定版本号：命中浏览器缓存（旧 Date.now() 每次强制重新下载，打开慢主因） */
        s.onload = function () { if (window.ZFHome && window.ZFHome.onOpen) window.ZFHome.onOpen(body); };
        document.head.appendChild(s);
      } else if (window.ZFHome) {
        window.ZFHome.onOpen(body);
      }
    }
  }
  function closeHome() {
    if (!homeWin) return;
    if (window.ZFHome && window.ZFHome.onClose) window.ZFHome.onClose();
    homeWin.classList.remove('open');
  }

  /* ---------- i新闻窗口 ---------- */
  var ICON_NEWS = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="15" height="15" rx="2"/><path d="M6.5 8h8M6.5 11.5h8M6.5 15h5"/><path d="M18 9h2.5v8.5a2 2 0 0 1-2 2H6"/></svg>';
  var newsWin = null;
  function openNews() {
    if (!newsWin) {
      newsWin = createAppWindow({
        id: 'zfNewsWin',
        title: 'i新闻',
        icon: ICON_NEWS,
        bodyHtml: '<div id="zfNewsBody" style="flex:1;overflow:hidden;display:flex;"></div>',
        onClose: function (w) { if (window.ZFNews && window.ZFNews.onClose) window.ZFNews.onClose(); w.classList.remove('open'); }
      });
      document.body.appendChild(newsWin);
    }
    newsWin.classList.add('open');
    var body = newsWin.querySelector('#zfNewsBody');
    if (body) {
      if (!body.dataset.zfnMounted) {
        body.dataset.zfnMounted = '1';
        var s = document.createElement('script');
        s.src = zfVerSrc('js/zf-app-news.js');  /* 固定版本号：命中浏览器缓存（旧 Date.now() 每次强制重新下载，打开慢主因） */
        s.onload = function () { if (window.ZFNews && window.ZFNews.onOpen) window.ZFNews.onOpen(body); };
        document.head.appendChild(s);
      } else if (window.ZFNews) {
        window.ZFNews.onOpen(body);
      }
    }
  }
  function closeNews() {
    if (!newsWin) return;
    if (window.ZFNews && window.ZFNews.onClose) window.ZFNews.onClose();
    newsWin.classList.remove('open');
  }

  /* ---------- i视频窗口 ---------- */
  var ICON_VIDEO = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="19" height="15" rx="3.5"/><path d="M10 9l5 3-5 3z" fill="#fff" stroke="none"/></svg>';
  var videoWin = null;
  function openVideo() {
    if (!videoWin) {
      videoWin = createAppWindow({
        id: 'zfVideoWin',
        title: 'i视频',
        icon: ICON_VIDEO,
        bodyHtml: '<div id="zfVideoBody" style="flex:1;overflow:hidden;display:flex;"></div>',
        onClose: function (w) { if (window.ZFVideo && window.ZFVideo.onClose) window.ZFVideo.onClose(); w.classList.remove('open'); }
      });
      document.body.appendChild(videoWin);
    }
    videoWin.classList.add('open');
    /* 【v4】窗口标题栏不显示图标（用户要求：左上角 i视频 不要图标） */
    var headIcon = videoWin.querySelector('.zf-appwin-head h3 svg');
    if (headIcon) headIcon.remove();
    var body = videoWin.querySelector('#zfVideoBody');
    if (body) {
      /* v6.1 兜底：内存中已挂载脚本版本不符时强制重拉（预期ver须与 zf-app-video.js 尾部 ver 一致）。
         重挂载必须同时清 zfvUi 守卫标记——否则 onOpen 早退、重开窗口永久空白（2026-11-22 修复） */
      var stale = window.ZFVideo && window.ZFVideo.ver !== 'v6.1-rowfix-20261122';
      if (!body.dataset.zfvMounted || stale) {
        if (stale) { try { window.ZFVideo.onClose && window.ZFVideo.onClose(); } catch (e) {} window.ZFVideo = null; body.innerHTML = ''; body.dataset.zfvUi = ''; }
        body.dataset.zfvMounted = '1';
        var s = document.createElement('script');
        s.src = zfVerSrc('js/zf-app-video.js');
        s.onload = function () { if (window.ZFVideo && window.ZFVideo.onOpen) window.ZFVideo.onOpen(body); };
        document.head.appendChild(s);
      } else if (window.ZFVideo) {
        window.ZFVideo.onOpen(body);
      }
    }
  }
  function closeVideo() {
    if (!videoWin) return;
    if (window.ZFVideo && window.ZFVideo.onClose) window.ZFVideo.onClose();
    videoWin.classList.remove('open');
  }

  /* ---------- i图片窗口（M1） ---------- */
  var ICON_IMAGE = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="M21 15l-5-5L5 21"/></svg>';
  var imageWin = null;
  function openImage() {
    if (!imageWin) {
      imageWin = createAppWindow({
        id: 'zfImageWin',
        title: 'i图片',
        icon: ICON_IMAGE,
        bodyHtml: '<div id="zfImageBody" style="flex:1;overflow:hidden;display:flex;flex-direction:column;"></div>',
        onClose: function (w) { if (window.ZFImage && window.ZFImage.onClose) window.ZFImage.onClose(); w.classList.remove('open'); }
      });
      document.body.appendChild(imageWin);
    }
    imageWin.classList.add('open');
    var imgBody = imageWin.querySelector('#zfImageBody');
    if (imgBody) {
      if (!imgBody.dataset.zfiMounted) {
        imgBody.dataset.zfiMounted = '1';
        var si = document.createElement('script');
        si.src = zfVerSrc('js/zf-app-image.js');  /* 固定版本号：命中浏览器缓存（旧 Date.now() 每次强制重新下载，打开慢主因） */
        si.onload = function () { if (window.ZFImage && window.ZFImage.onOpen) window.ZFImage.onOpen(imgBody); };
        document.head.appendChild(si);
      } else if (window.ZFImage) {
        window.ZFImage.onOpen(imgBody);
      }
    }
  }

  /* ---------- i偶像窗口（私有档案馆 P0）【2026-11-17 图标去重】相框+五角星=偶像收藏册 ---------- */
  var ICON_IDOL = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 8.2l1.1 2.2 2.4.35-1.75 1.7.4 2.4L12 13.7l-2.15 1.15.4-2.4-1.75-1.7 2.4-.35z"/><circle cx="6.2" cy="7" r="0.7"/></svg>';
  var idolWin = null;
  function openIdol() {
    if (!idolWin) {
      idolWin = createAppWindow({
        id: 'zfIdolWin',
        title: 'i偶像',
        icon: ICON_IDOL,
        bodyHtml: '<div id="zfIdolBody" style="flex:1;overflow:hidden;display:flex;"></div>',
        onClose: function (w) { if (window.ZFIdol && window.ZFIdol.onClose) window.ZFIdol.onClose(); w.classList.remove('open'); }
      });
      document.body.appendChild(idolWin);
    }
    idolWin.classList.add('open');
    var body = idolWin.querySelector('#zfIdolBody');
    if (body) {
      if (!body.dataset.zfidolMounted) {
        body.dataset.zfidolMounted = '1';
        var s = document.createElement('script');
        s.src = zfVerSrc('js/zf-app-idol.js');
        s.onload = function () { if (window.ZFIdol && window.ZFIdol.onOpen) window.ZFIdol.onOpen(body); };
        document.head.appendChild(s);
      } else if (window.ZFIdol) {
        window.ZFIdol.onOpen(body);
      }
    }
  }
  function closeIdol() {
    if (!idolWin) return;
    if (window.ZFIdol && window.ZFIdol.onClose) window.ZFIdol.onClose();
    idolWin.classList.remove('open');
  }

  /* ---------- i音乐窗口 ---------- */
  var ICON_MUSIC = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>';
  var musicWin = null;
  function openMusic(kw, silent) {
    if (!musicWin) {
      musicWin = createAppWindow({
        id: 'zfMusicWin',
        title: 'i音乐',
        icon: ICON_MUSIC,
        bodyHtml: '<div id="zfMusicBody" style="flex:1;overflow:hidden;display:flex;"></div>',
        onClose: function (w) { if (window.ZFMusic && window.ZFMusic.onClose) window.ZFMusic.onClose(); w.classList.remove('open'); }
      });
      document.body.appendChild(musicWin);
    }
    if (!silent) musicWin.classList.add('open'); /* q: 静默歌单指令不弹窗 */
    var body = musicWin.querySelector('#zfMusicBody');
    if (kw) { window.__zfMusicPendingKw = kw; }
    if (body) {
      if (!body.dataset.zfmMounted) {
        body.dataset.zfmMounted = '1';
        var s = document.createElement('script');
        s.src = zfVerSrc('js/zf-app-music.js');  /* 固定版本号：命中浏览器缓存（旧 Date.now() 每次强制重新下载，打开慢主因） */
        s.onload = function () { if (window.ZFMusic && window.ZFMusic.onOpen) window.ZFMusic.onOpen(body); };
        document.head.appendChild(s);
      } else if (window.ZFMusic && window.ZFMusic.onOpen) {
        window.ZFMusic.onOpen(body);
      } else if (!body.dataset.zfmMounted && kw) {
        /* 兜底：脚本未就绪也把 kw 挂到全局，onOpen 时会消费 */
      }
    }
  }
  function closeMusic() {
    if (!musicWin) return;
    if (window.ZFMusic && window.ZFMusic.onClose) window.ZFMusic.onClose();
    musicWin.classList.remove('open');
  }

  /* ---------- i游戏窗口 ---------- */
  var ICON_GAME = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="7" width="19" height="10.5" rx="4"/><path d="M7 10.5v3.5M5.2 12.2h3.6"/><circle cx="15.5" cy="11" r=".9" fill="#fff" stroke="none"/><circle cx="17.8" cy="13.3" r=".9" fill="#fff" stroke="none"/></svg>';
  var gameWin = null;
  function openGame() {
    if (!gameWin) {
      gameWin = createAppWindow({
        id: 'zfGameWin',
        title: 'i游戏',
        icon: ICON_GAME,
        bodyHtml: '<div id="zfGameBody" style="flex:1;overflow:hidden;display:flex;"></div>',
        onClose: function (w) { if (window.ZFGame && window.ZFGame.onClose) window.ZFGame.onClose(); w.classList.remove('open'); }
      });
      document.body.appendChild(gameWin);
    }
    gameWin.classList.add('open');
    var body = gameWin.querySelector('#zfGameBody');
    if (body) {
      if (!body.dataset.zfgMounted) {
        body.dataset.zfgMounted = '1';
        var s = document.createElement('script');
        s.src = zfVerSrc('js/zf-app-game.js');  /* 固定版本号：命中浏览器缓存（旧 Date.now() 每次强制重新下载，打开慢主因） */
        s.onload = function () { if (window.ZFGame && window.ZFGame.onOpen) window.ZFGame.onOpen(body); };
        document.head.appendChild(s);
      } else if (window.ZFGame) {
        window.ZFGame.onOpen(body);
      }
    }
  }
  function closeGame() {
    if (!gameWin) return;
    if (window.ZFGame && window.ZFGame.onClose) window.ZFGame.onClose();
    gameWin.classList.remove('open');
  }

  /* ---------- i电视窗口（IPTV直播） ---------- */
  var ICON_TV = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="13" rx="2"/><path d="M8 2.5l4 3.5 4-3.5"/></svg>';
  var tvWin = null;
  function openTv() {
    if (!tvWin) {
      tvWin = createAppWindow({
        id: 'zfTvWin',
        title: 'i电视',
        icon: ICON_TV,
        bodyHtml: '<div id="zfTvBody" style="flex:1;overflow:hidden;display:flex;"></div>',
        onClose: function (w) { if (window.ZFTV && window.ZFTV.onClose) window.ZFTV.onClose(); w.classList.remove('open'); }
      });
      document.body.appendChild(tvWin);
    }
    tvWin.classList.add('open');
    var body = tvWin.querySelector('#zfTvBody');
    if (!window.ZFTV) {
      var s = document.createElement('script');
      s.src = zfVerSrc('js/zf-app-tv.js');  /* 固定版本号：命中浏览器缓存（旧 Date.now() 每次强制重新下载，打开慢主因） */
      s.onload = function () { if (window.ZFTV && window.ZFTV.onOpen) window.ZFTV.onOpen(body); };
      document.head.appendChild(s);
    } else {
      window.ZFTV.onOpen(body);
    }
  }
  function closeTv() {
    if (!tvWin) return;
    if (window.ZFTV && window.ZFTV.onClose) window.ZFTV.onClose();
    tvWin.classList.remove('open');
  }

  /* ---------- 注册进 Dock（onClick 与冻结区原文一致） ---------- */
  prefetchAppJs(['js/zf-app-calc.js', 'js/zf-app-notes.js', 'js/zf-app-hardware.js', 'js/zf-app-video.js']);
  register({
    id: 'contest-app',
    name: 'i大赛',
    icon: ICON_CONTEST,
    /* 【统一交互】点击打开，再点关闭 */
    onClick: function () {
      if (contestWin && contestWin.classList.contains('open')) { contestWin.classList.remove('open'); } else { openContest(); }
    }
  });
  register({
    id: 'manga-cabinet',
    name: 'i漫画',
    icon: ICON_MANGA,
    onClick: function () {
      /* 点击 dock 图标切换显示/隐藏；重开恢复上次阅读页面（除非重启）
         【2026-11-23 修复 i漫画打不开】窗口改懒建（适配②）后 mangaWin 初始为 null，
         此处 null.classList 直接抛 TypeError → 点击永远无响应。补空值守卫，
         与 i聊天/i小说/i大赛 同款写法；首开走 openManga()（内含懒建+AppLock 门禁）。 */
      if (mangaWin && mangaWin.classList.contains('open')) { closeManga(); } else { openManga(); }
    }
  });
  register({
    id: 'plaza-chat',
    name: 'i聊天',
    icon: ICON_CHAT,
    /* 【统一交互】点击打开，再点关闭（与 i计算器/i漫画 等一致） */
    onClick: function () {
      if (chatWin && chatWin.classList.contains('open')) { chatWin.classList.remove('open'); } else { openChat(); }
    }
  });
  register({
    id: 'novel-player',
    name: 'i小说',
    icon: ICON_NOVEL,
    /* 【统一交互】点击打开，再点关闭（与 i漫画/i聊天 等一致） */
    onClick: function () {
      if (novelWin && novelWin.classList.contains('open')) { closeNovel(); } else { openNovel(); }
    }
  });
  register({
    id: 'town-app',
    name: 'i小镇',
    icon: ICON_TOWN,
    /* 【统一交互】点击打开，再点关闭（与 i小说等一致） */
    onClick: function () {
      if (townWin && townWin.classList.contains('open')) { closeTown(); } else { openTown(); }
    }
  });
  register({
    id: 'hardware-master',
    name: 'i硬件',
    icon: ICON_HW,
    /* 【统一交互】点击打开，再点关闭 */
    onClick: function () {
      if (hwWin && hwWin.classList.contains('open')) { if (window.ZFHardware && window.ZFHardware.onClose) window.ZFHardware.onClose(); hwWin.classList.remove('open'); } else { openHardware(); }
    }
  });
  register({
    id: 'calc-app',
    name: 'i计算器',
    icon: ICON_CALC,
    onClick: function () {
      if (calcWin && calcWin.classList.contains('open')) { closeCalc(); } else { openCalc(); }
    }
  });
  register({
    id: 'news-app',
    name: 'i新闻',
    icon: ICON_NEWS,
    onClick: function () {
      if (newsWin && newsWin.classList.contains('open')) { closeNews(); } else { openNews(); }
    }
  });
  register({
    id: 'video-app',
    name: 'i视频',
    icon: ICON_VIDEO,
    onClick: function () {
      if (videoWin && videoWin.classList.contains('open')) { closeVideo(); } else { openVideo(); }
    }
  });
  register({
    id: 'image-app',
    name: 'i图片',
    icon: ICON_IMAGE,
    onClick: function () {
      if (imageWin && imageWin.classList.contains('open')) { if (window.ZFImage && window.ZFImage.onClose) window.ZFImage.onClose(); imageWin.classList.remove('open'); } else { openImage(); }
    }
  });
  register({
    id: 'idol-app',
    name: 'i偶像',
    icon: ICON_IDOL,
    onClick: function () {
      if (idolWin && idolWin.classList.contains('open')) { closeIdol(); } else { openIdol(); }
    }
  });
  register({
    id: 'home-app',
    name: 'i家电',
    icon: ICON_HOME,
    onClick: function () {
      if (homeWin && homeWin.classList.contains('open')) { closeHome(); } else { openHome(); }
    }
  });
  register({
    id: 'notes-app',
    name: 'i记事本',
    icon: ICON_NOTES,
    onClick: function () {
      if (notesWin && notesWin.classList.contains('open')) { closeNotes(); } else { openNotes(); }
    }
  });
  register({
    id: 'music-app',
    name: 'i音乐',
    icon: ICON_MUSIC,
    onClick: function () {
      if (musicWin && musicWin.classList.contains('open')) { closeMusic(); } else { openMusic(); }
    }
  });
  register({
    id: 'game-app',
    name: 'i游戏',
    icon: ICON_GAME,
    onClick: function () {
      if (gameWin && gameWin.classList.contains('open')) { closeGame(); } else { openGame(); }
    }
  });
  register({
    id: 'tv-app',
    name: 'i电视',
    icon: ICON_TV,
    onClick: function () {
      if (tvWin && tvWin.classList.contains('open')) { closeTv(); } else { openTv(); }
    }
  });

  /* ---------- 回挂 window.ZFDock 契约（适配③）：pollCmds/外部脚本运行时读取 ---------- */
  var ZFD = window.ZFDock;
  if (ZFD) {
    ZFD.openManga = openManga; ZFD.closeManga = closeManga; ZFD.mangaCmd = mangaCmd;
    ZFD.openCalc = openCalc; ZFD.closeCalc = closeCalc;
    ZFD.openNotes = openNotes; ZFD.closeNotes = closeNotes;
    ZFD.openMusic = openMusic; ZFD.closeMusic = closeMusic;
    ZFD.openGame = openGame; ZFD.closeGame = closeGame;
    ZFD.openHome = openHome; ZFD.closeHome = closeHome;
    ZFD.openTv = openTv; ZFD.closeTv = closeTv;
    ZFD.openNovel = openNovel; ZFD.closeNovel = closeNovel;
    ZFD.openTown = openTown; ZFD.closeTown = closeTown;
    ZFD.openNews = openNews; ZFD.closeNews = closeNews;
    ZFD.openVideo = openVideo; ZFD.closeVideo = closeVideo;
    ZFD.openImage = openImage;
    ZFD.openIdol = openIdol;
    ZFD.openHardware = openHardware;
    ZFD.openChat = openChat;
  }
})();
