/* =========================================================================
 * ZFRich — 对话内富媒体渲染引擎 v1.0
 * AI 回复中嵌入 :::zfrich 围栏即可输出活 HTML / 图 / 视频 / 音频 / PPT /
 * 动画 / 图表 / 时间轴时序 / 宏 / 无限嵌套，对标并超越 OpenAI Canvas。
 * 全部动态内容走 sandbox iframe 隔离，防 XSS。
 * ========================================================================= */
(function () {
  'use strict';
  if (window.ZFRich) return;

  var MAX_DEPTH = 20;          // 嵌套上限
  var MAX_IFRAMES_PER_MSG = 12;// 单条消息 iframe 上限（性能保护）
  var _iframeCount = 0;

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function attr(s) { return esc(s).replace(/'/g, '&#39;'); }

  /* ---------------- 围栏解析 ----------------
   * 识别:
   *   :::zfrich {json 头}
   *   ...内容...
   *   :::
   * json 头缺省时按内容首行 lang 猜类型。兼容 ```zfrich 围栏。
   */
  var FENCE_RE = /(?:^|\n)(?:```zfrich[^\n]*\n|:::zfrich[ \t]*([^\n]*)\n)([\s\S]*?)(?:\n```|\n:::)(?=\n|$)/g;

  /* 扫描式解析：```zfrich 只认 ``` 闭合，:::zfrich 只认 ::: 闭合，
     避免内层 ``` 代码块把 :::zfrich 围栏提前截断（v2.1 边界修复） */
  function parseFences(text) {
    var src = String(text || ''), blocks = [], i = 0;
    while (i < src.length) {
      var open = src.slice(i).search(/(?:^|\n)(```zfrich[^\n]*|:::zfrich[ \t]*[^\n]*)\n/);
      if (open < 0) break;
      var absOpen = i + open;
      var nl = src.indexOf('\n', absOpen + 1);
      if (nl < 0) break;
      var headLine = src.slice(absOpen, nl);
      var tick = headLine.indexOf('```zfrich') >= 0 ? '```' : ':::';
      var head = headLine.replace(/^\s*(```zfrich|:::zfrich)/, '').trim();
      // 从 nl+1 起逐行找匹配的闭合符（::: 闭合需嵌套计数：内层 :::xxx 开嵌套、裸 ::: 关一层）
      var j = nl + 1, close = -1, depth = 0;
      while (j <= src.length) {
        var eol = src.indexOf('\n', j);
        var line = (eol < 0 ? src.slice(j) : src.slice(j, eol)).trim();
        if (tick === ':::') {
          if (/^:::\S/.test(line)) { depth++; }
          else if (line === ':::') {
            if (depth === 0) { close = j; break; }
            depth--;
          }
        } else if (line === tick) { close = j; break; }
        if (eol < 0) break;
        j = eol + 1;
      }
      if (close < 0) break; // 未闭合：留给流式阶段
      var body = src.slice(nl + 1, close);
      var raw = src.slice(absOpen, close) + tick;
      var meta = {};
      if (head) {
        try { meta = JSON.parse(head.replace(/^JSON\.?parse\?/i, '')); } catch (e) {
          head.replace(/^\[|\]$/g, '').split(/\s+/).forEach(function (kv) {
            var p = kv.indexOf('='); if (p > 0) meta[kv.slice(0, p)] = kv.slice(p + 1);
          });
        }
      }
      blocks.push({ meta: meta, body: body, raw: raw });
      i = close + tick.length;
    }
    return blocks;
  }

  /* ---------------- 宏定义与展开 ---------------- */
  function collectMacros(text) {
    var macros = {};
    String(text || '').replace(/:::macro\s+(\S+)\s*\n([\s\S]*?)\n:::/g, function (m, name, body) {
      // 兼容带参数定义头 :::macro name(a,b) → 只取函数名
      var base = name.replace(/\(.*$/, '');
      macros[base] = body; return '';
    });
    return macros;
  }
  function expandMacros(text, macros, depth) {
    if (depth > 5) return text; // 防死循环
    return String(text || '').replace(/\{\{\s*([\w.-]+)\s*(?:\(([^)]*)\))?\s*\}\}/g, function (m, name, argStr) {
      if (!(name in macros)) return m;
      var body = macros[name];
      // 参数化：{{name(a=1,b="x")}} → 先把宏体内的 {{a}}/{{b}} 替换为实参值
      if (argStr && argStr.trim()) {
        var args = {};
        argStr.split(',').forEach(function (kv) {
          kv = kv.trim(); if (!kv) return;
          var p = kv.indexOf('='); if (p < 1) return;
          var k = kv.slice(0, p).trim(), v = kv.slice(p + 1).trim().replace(/^["']|["']$/g, '');
          args[k] = v;
        });
        body = body.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, function (mm, k) {
          return (k in args) ? args[k] : mm;
        });
      }
      return expandMacros(body, macros, depth + 1);
    });
  }

  /* ---------------- :::chat 内嵌对话块 ----------------
   * 语法：
   *   :::chat title=迷你对话
   *   user: 你好
   *   ai: 你好！下面是演示 :::zfrich[type=css]...:::
   *   user: 继续
   *   :::
   * 行首 user:/ai:/system:（兼容 **user:** 写法）切分气泡；
   * 可嵌套 :::chat（深度匹配解析），体内可含 zfrich 围栏递归渲染。纯 DOM，不开 iframe。
   */
  function parseMeta(head) {
    var meta = {};
    if (head && head.trim()) {
      try { meta = JSON.parse(head.trim()); } catch (e) {
        head.trim().split(/\s+/).forEach(function (kv) {
          var p = kv.indexOf('='); if (p > 0) meta[kv.slice(0, p)] = kv.slice(p + 1);
        });
      }
    }
    return meta;
  }
  function parseChatBlocks(text) {
    var lines = String(text || '').split('\n');
    var blocks = [], depth = 0, start = -1, head = '', bodyLines = [];
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (depth === 0) {
        if (/^:::chat(\s|$)/.test(t)) { depth = 1; start = i; head = t.replace(/^:::chat\s*/, ''); bodyLines = []; }
      } else {
        if (/^:::chat(\s|$)/.test(t)) { depth++; bodyLines.push(lines[i]); }
        else if (/^:::(zfrich|macro|group|tabs)\b/.test(t)) { depth++; bodyLines.push(lines[i]); } // 内嵌其他 :::xxx 围栏也要计层，防其闭合 ::: 提前截断 chat
        else if (/^:::$/.test(t)) {
          depth--;
          if (depth === 0) {
            blocks.push({ meta: parseMeta(head), body: bodyLines.join('\n'), raw: lines.slice(start, i + 1).join('\n') });
          } else bodyLines.push(lines[i]);
        }
        else bodyLines.push(lines[i]);
      }
    }
    return blocks;
  }
  var CHAT_ROLE = { user: { label: '你', cls: 'zf-chat-user', bg: 'linear-gradient(135deg,#2b6cb0,#2c5282)', self: 1 }, ai: { label: 'AI', cls: 'zf-chat-ai', bg: 'rgba(255,255,255,.08)', self: 0 }, system: { label: '系统', cls: 'zf-chat-sys', bg: 'rgba(255,200,60,.12)', self: 0 } };
  function renderChat(body, meta, depth) {
    var msgs = [], cur = null;
    body.split('\n').forEach(function (l) {
      var m = l.match(/^\s*(?:\*{1,3})?\s*(user|ai|system)\s*(?:\*{1,3})?\s*[:：]\s?(.*)$/i);
      if (m) { cur = { role: m[1].toLowerCase(), text: String(m[2]||'').replace(/^\*{1,3}\s*/,'') }; msgs.push(cur); }
      else if (cur) cur.text += '\n' + l;
    });
    var inner = msgs.map(function (msg) {
      var r = CHAT_ROLE[msg.role] || CHAT_ROLE.ai;
      var text = msg.text.trim();
      var html = /:::zfrich|:::chat/.test(text) ? renderBlocks(text, depth + 1) : esc(text).replace(/\n/g, '<br>');
      return '<div class="zf-chat-row ' + r.cls + '" style="display:flex;justify-content:' + (r.self ? 'flex-end' : 'flex-start') + ';margin:6px 0">' +
        '<div style="max-width:86%;padding:8px 12px;border-radius:12px;font-size:13.5px;line-height:1.6;background:' + r.bg + '">' + html + '</div></div>';
    }).join('');
    var title = meta.title ? '<div style="font-size:12px;opacity:.7;margin-bottom:4px">💬 ' + esc(meta.title) + '</div>' : '';
    return '<div class="zfrich-chat" style="border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:10px 12px;margin:6px 0;max-width:720px;background:rgba(0,0,0,.15)">' + title + inner + '</div>';
  }

  /* ---------------- 渲染器注册表 ---------------- */
  var renderers = {};

  /* html / css 动画 / js 动效 —— 全部 sandbox iframe */
  function sandboxHtml(inner, extraCss, extraJs) {
    var doc = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>html,body{margin:0;padding:8px;font-family:system-ui,-apple-system,sans-serif;background:transparent;color:#e8e8e8;overflow-x:auto}' + (extraCss || '') + '</style></head><body>' +
      inner +
      '<' + 'script>' + (extraJs || '') + '<\/script></body></html>';
    _iframeCount++;
    return '<iframe class="zfrich-frame" sandbox="allow-scripts" style="border:0;width:100%;min-height:60px" loading="lazy" srcdoc="' + attr(doc) + '"></iframe>';
  }

  renderers.html = {
    render: function (body) { return sandboxHtml(body); }
  };
  renderers.css = {
    render: function (body) {
      var m = body.match(/<style>([\s\S]*?)<\/style>/i);
      return sandboxHtml(m ? body : '<style>' + body + '</style>');
    }
  };
  renderers.js = {
    render: function (body) { return sandboxHtml('', '', body); }
  };
  renderers.chart = {
    render: function (body, meta) {
      var src = meta.src || 'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js';
      var doc = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:transparent}#c{width:100%;height:100%}</style></head><body><div id="c"></div>' +
        '<' + 'script src="' + attr(src) + '" onerror="parent.postMessage({zfrichChartFail:1},\'*\')"><\/script>' +
        '<' + 'script>try{var c=echarts.init(document.getElementById("c"),null,{renderer:"canvas"});c.setOption(' + body + ');window.addEventListener("resize",function(){c.resize()});}catch(e){document.body.textContent="图表初始化失败:"+e.message}<\/script></body></html>';
      _iframeCount++;
      return '<iframe class="zfrich-frame zfrich-chart" sandbox="allow-scripts" style="border:0;width:100%;height:' + (parseInt(meta.height, 10) || 300) + 'px" loading="lazy" srcdoc="' + attr(doc) + '"></iframe>';
    }
  };

  renderers.image = {
    render: function (body, meta) {
      var url = (meta.src || body.trim()).trim();
      return '<div class="zfrich-img-wrap"><img class="zfrich-img" src="' + attr(url) + '" alt="' + attr(meta.alt || '') + '" loading="lazy" style="max-width:100%;border-radius:8px"></div>';
    }
  };
  /* 类型别名容错：AI 常见写法 img/picture/audio/jpg 统一映射到正式类型 */
  renderers.img = renderers.image;
  renderers.picture = renderers.image;
  renderers.audio_ = renderers.audio; renderers.sound = renderers.audio;
  renderers.mp4 = renderers.video;
  renderers.video = {
    render: function (body, meta) {
      var url = (meta.src || body.trim()).trim();
      if (/youtube|youtu\.be|bilibili/.test(url)) {
        return '<div class="zfrich-video-wrap" style="position:relative;padding-top:56.25%"><iframe src="' + attr(url) + '" sandbox="allow-scripts allow-same-origin allow-presentation" style="position:absolute;inset:0;width:100%;height:100%;border:0" allowfullscreen></iframe></div>';
      }
      return '<video class="zfrich-video" src="' + attr(url) + '" controls preload="metadata" style="width:100%;max-width:640px;border-radius:8px"></video>';
    }
  };
  renderers.audio = {
    render: function (body, meta) {
      return '<audio src="' + attr((meta.src || body.trim())) + '" controls preload="none" style="width:100%;max-width:480px"></audio>';
    }
  };
  renderers.table = {
    render: function (body) {
      var rows = body.trim().split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      var html = '<div class="zfrich-table-wrap" style="overflow-x:auto"><table class="zfrich-table" style="border-collapse:collapse;width:100%;font-size:13px">';
      rows.forEach(function (row, i) {
        var cells = row.replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); });
        var tag = i === 0 ? 'th' : 'td';
        html += '<tr>' + cells.map(function (c) { return '<' + tag + ' style="border:1px solid rgba(255,255,255,.15);padding:6px 10px;text-align:left">' + c + '</' + tag + '>'; }).join('') + '</tr>';
      });
      return html + '</table></div>';
    }
  };
  renderers.ppt = {
    render: function (body, meta) {
      var slides = body.split(/\n---+\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      var id = 'zfppt' + Date.now() + Math.random().toString(36).slice(2, 7);
      var h = '<div class="zfrich-ppt" id="' + id + '" style="border:1px solid rgba(255,255,255,.12);border-radius:10px;overflow:hidden;max-width:720px">' +
        '<div class="zp-slides">';
      slides.forEach(function (s, i) {
        h += '<div class="zp-slide" data-i="' + i + '" style="display:' + (i === 0 ? 'block' : 'none') + ';padding:24px 28px;min-height:180px">' +
          '<div class="zp-inner">' + markedParse(s) + '</div></div>';
      });
      h += '</div><div class="zp-bar" style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-top:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.25)">' +
        '<button class="zp-prev zfbtn">◀</button>' +
        '<span class="zp-idx" style="font-size:12px;opacity:.75">1 / ' + slides.length + '</span>' +
        '<button class="zp-next zfbtn">▶</button>' +
        (meta.autoplay ? '<button class="zp-auto zfbtn">▶️ 自动</button>' : '') +
        '</div></div>';
      // 内联脚本驱动翻页（非沙箱，纯 DOM 操作，无外部数据）
      h += '<' + 'script>(function(){var r=document.getElementById("' + id + '");if(!r||r._zp)return;r._zp=1;' +
        'var ss=r.querySelectorAll(".zp-slide"),ix=r.querySelector(".zp-idx"),cur=0;' +
        'function go(n){cur=(n+ss.length)%ss.length;ss.forEach(function(s,i){s.style.display=i===cur?"block":"none"});ix.textContent=(cur+1)+" / "+ss.length;}' +
        'r.querySelector(".zp-prev").onclick=function(){go(cur-1)};r.querySelector(".zp-next").onclick=function(){go(cur+1)};' +
        'var au=r.querySelector(".zp-auto");if(au)au.onclick=function(){if(au._t){clearInterval(au._t);au._t=0;au.textContent="▶️ 自动"}else{au._t=setInterval(function(){go(cur+1)},2500);au.textContent="⏸ 停"}}};})();<\/script>';
      return h;
    }
  };
  // PPT 页内轻量 markdown（不递归 zfrich，防复杂化）
  function markedParse(s) {
    if (typeof marked !== 'undefined') { try { return marked.parse(s); } catch (e) {} }
    return '<p>' + esc(s).replace(/\n/g, '<br>') + '</p>';
  }

  /* ---------------- timeline 时序块 ---------------- */
  renderers.timeline = {
    render: function (body, meta, depth) {
      // 子块语法：每段以 [delay=1.5s][parallel][at=3s][lane=2] 开头，段落之间空行分隔
      // meta.lanes=2 或 >=2 时启用泳道布局，各 lane 一列并行展示
      var lanes = Math.max(1, Math.min(4, parseInt(meta.lanes, 10) || 1));
      var segs = [];
      body.split(/\n\s*\n/).forEach(function (seg) {
        seg = seg.trim(); if (!seg) return;
        var m = seg.match(/^\[(delay=([\d.]+)s)?\s*(at=([\d.]+)s)?\s*(parallel)?\s*(lane=(\d+))?\]\s*\n?([\s\S]*)$/);
        if (m) segs.push({ delay: m[2] ? parseFloat(m[2]) : (m[4] ? parseFloat(m[4]) : 0), parallel: !!m[5], lane: m[7] ? parseInt(m[7], 10) : 1, content: m[8] });
        else segs.push({ delay: 0, parallel: false, lane: 1, content: seg });
      });
      // timeline 内部再递归渲染 zfrich 子块
      function itemHtml(s, i) {
        var inner = renderBlocks(s.content, depth + 1);
        return '<div class="zf-tl-item" data-delay="' + s.delay + '" data-parallel="' + (s.parallel ? 1 : 0) + '" data-order="' + i + '" style="opacity:0;transform:translateY(10px);transition:all .5s ease;margin:8px 0">' +
          '<div class="zf-tl-dot" style="position:absolute;left:-14px;top:6px;width:8px;height:8px;border-radius:50%;background:#4a9eff"></div>' + inner + '</div>';
      }
      var h;
      if (lanes > 1) {
        // 泳道模式：lanes 列并排，每列独立时序轴（列内串行/延时逻辑各自独立）
        var cols = [];
        for (var li = 1; li <= lanes; li++) cols.push(segs.filter(function (s) { return s.lane === li; }));
        h = '<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">';
        cols.forEach(function (col, ci) {
          var colItems = col.map(function (s, i) { return itemHtml(s, ci + '-' + i); }).join('');
          var laneTitle = '泳道 ' + (ci + 1);
          h += '<div class="zf-tl-lane" style="flex:1;min-width:220px;position:relative;margin-left:14px;padding-left:12px;border-left:2px solid rgba(74,158,255,.35)">' +
            '<div style="font-size:12px;opacity:.6;margin-bottom:4px">' + esc(laneTitle) + '</div>' + colItems + '</div>';
        });
        h += '</div>';
      } else {
        var items = segs.map(itemHtml).join('');
        var id = 'zftl' + Date.now() + Math.random().toString(36).slice(2, 7);
        h = '<div class="zfrich-timeline" id="' + id + '" style="position:relative;margin-left:14px;padding-left:12px;border-left:2px solid rgba(74,158,255,.35)">' + items + '</div>';
        h += '<' + 'script>(function(){var t=document.getElementById("' + id + '");if(!t||t._zt)return;t._zt=1;' +
          'var items=[].slice.call(t.querySelectorAll(".zf-tl-item")),t0=Date.now();' +
          'items.forEach(function(it){var d=parseFloat(it.dataset.delay)*1000||0;var par=it.dataset.parallel==="1";' +
          'var prev=it.previousElementSibling,wait=Promise.resolve();' +
          'if(!par&&prev){wait=new Promise(function(res){var chk=setInterval(function(){if(prev.dataset.done==="1"){clearInterval(chk);res()}},80)});}' +
          'wait.then(function(){setTimeout(function(){it.style.opacity=1;it.style.transform="none";it.dataset.done="1"},d)})});})();<\/script>';
      }
      return h;
    }
  };

  /* ---------------- 预设动画宏库（animation=/delay= 块参数） ---------------- */
  var ANIM_PRESETS = {
    'fade-in':     { kf: 'zffa-fadein',     dur: '.6s' },
    'slide-up':    { kf: 'zffa-slideup',    dur: '.6s' },
    'slide-down':  { kf: 'zffa-slidedown',  dur: '.6s' },
    'slide-left':  { kf: 'zffa-slideleft',  dur: '.6s' },
    'slide-right': { kf: 'zffa-slideright', dur: '.6s' },
    'zoom-in':     { kf: 'zffa-zoomin',     dur: '.5s' },
    'zoom-out':    { kf: 'zffa-zoomout',    dur: '.5s' },
    'bounce':      { kf: 'zffa-bounce',     dur: '.8s' },
    'flip':        { kf: 'zffa-flip',       dur: '.7s' },
    'shake':       { kf: 'zffa-shake',      dur: '.6s' },
    'pulse':       { kf: 'zffa-pulse',      dur: '1.2s', inf: true },
    'glow':        { kf: 'zffa-glow',       dur: '1.5s', inf: true },
    'float':       { kf: 'zffa-float',      dur: '2s',   inf: true }
  };
  var ANIM_STYLE_ID = 'zfrich-anim-style';
  function ensureAnimStyle() {
    if (document.getElementById(ANIM_STYLE_ID)) return;
    var css = [
      '@keyframes zffa-fadein{from{opacity:0}to{opacity:1}}',
      '@keyframes zffa-slideup{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}',
      '@keyframes zffa-slidedown{from{opacity:0;transform:translateY(-24px)}to{opacity:1;transform:none}}',
      '@keyframes zffa-slideleft{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}',
      '@keyframes zffa-slideright{from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:none}}',
      '@keyframes zffa-zoomin{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:scale(1)}}',
      '@keyframes zffa-zoomout{from{opacity:0;transform:scale(1.3)}to{opacity:1;transform:scale(1)}}',
      '@keyframes zffa-bounce{0%{opacity:0;transform:translateY(-30px)}60%{opacity:1;transform:translateY(6px)}80%{transform:translateY(-3px)}100%{transform:none}}',
      '@keyframes zffa-flip{from{opacity:0;transform:perspective(600px) rotateX(70deg)}to{opacity:1;transform:none}}',
      '@keyframes zffa-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(7px)}60%{transform:translateX(-5px)}80%{transform:translateX(3px)}}',
      '@keyframes zffa-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}',
      '@keyframes zffa-glow{0%,100%{box-shadow:0 0 4px rgba(74,158,255,.3)}50%{box-shadow:0 0 18px rgba(74,158,255,.75)}}',
      '@keyframes zffa-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}'
    ].join('');
    var st = document.createElement('style');
    st.id = ANIM_STYLE_ID;
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }
  // 给任意渲染结果包一层动画壳；animation 不识别时不包
  function wrapAnim(html, meta) {
    var a = meta && meta.animation ? String(meta.animation).toLowerCase().trim() : '';
    if (!a || !ANIM_PRESETS[a]) return html;
    ensureAnimStyle();
    var p = ANIM_PRESETS[a];
    var d = parseFloat(meta.delay) || 0;
    var style = 'animation:' + p.kf + ' ' + p.dur + ' ease ' + (p.inf ? 'infinite' : '1') + ' both';
    if (d) style += ' ' + d + 's';
    return '<div class="zfrich-anim" data-anim="' + esc(a) + '" style="' + style + '">' + html + '</div>';
  }

  /* ---------------- 嵌套容器 ---------------- */
  renderers.group = {
    render: function (body, meta, depth) {
      var inner = renderBlocks(body, depth + 1);
      var title = meta.title ? '<div class="zfrich-group-title" style="font-weight:600;font-size:13px;opacity:.85;margin-bottom:6px">' + esc(meta.title) + '</div>' : '';
      return '<div class="zfrich-group" style="border:1px dashed rgba(255,255,255,.18);border-radius:10px;padding:12px;margin:6px 0">' + title + inner + '</div>';
    }
  };
  renderers.tabs = {
    render: function (body, meta, depth) {
      var parts = body.split(/\n(?=##\s)/).map(function (p) { return p.trim(); }).filter(Boolean);
      var id = 'zftb' + Date.now() + Math.random().toString(36).slice(2, 7);
      var heads = '', panels = '';
      parts.forEach(function (p, i) {
        var nl = p.indexOf('\n');
        var title = p.slice(0, nl).replace(/^##\s*/, '').trim() || ('页' + (i + 1));
        var content = p.slice(nl + 1);
        heads += '<button class="zf-tab-h zfbtn" data-t="' + id + '-' + i + '" style="opacity:' + (i === 0 ? 1 : .6) + '">' + esc(title) + '</button>';
        panels += '<div class="zf-tab-p" id="' + id + '-' + i + '" style="display:' + (i === 0 ? 'block' : 'none') + ';padding-top:8px">' + renderBlocks(content, depth + 1) + '</div>';
      });
      var h = '<div class="zfrich-tabs" style="margin:6px 0"><div style="display:flex;gap:6px;flex-wrap:wrap">' + heads + '</div>' + panels + '</div>';
      h += '<' + 'script>(function(){document.querySelectorAll(".zf-tab-h[data-t^=' + JSON.stringify(id) + ']")' +
        '.forEach?0:0;})();<\/script>'; // 占位（下面统一绑定）
      h = h.replace(/<script>[\s\S]*?<\/script>\s*$/, ''); // 去占位
      h += '<' + 'script>(function(){var r=document.querySelector("[data-zftabs=\'' + id + '\']");})();<\/script>';
      // 简化：直接事件委托已由全局 ZFRich.bindTabs 处理
      return '<div data-zftabs="' + id + '">' + h + '</div>';
    }
  };

  /* ---------------- 主渲染管线 ---------------- */
  function renderBlocks(text, depth) {
    if (depth > MAX_DEPTH) return '<p style="opacity:.6">[zfrich 嵌套超限]</p>';
    // 先渲染 :::chat 嵌套对话块（内部再递归 renderBlocks，可含 zfrich 围栏/再嵌 chat）
    var chatBlocks = parseChatBlocks(text);
    if (chatBlocks.length) {
      var tout = String(text);
      chatBlocks.forEach(function (cb) {
        var ch = '';
        try { ch = renderChat(expandMacros(cb.body, collectMacros(text), 0), cb.meta, depth); }
        catch (e) { ch = '<p style="color:#f66">[chat 渲染失败: ' + esc(e.message) + ']</p>'; }
        tout = tout.replace(cb.raw, ch);
      });
      text = tout;
    }
    var blocks = parseFences(text);
    if (!blocks.length) return expandMacros(collectMacros(text) && stripMacros(text) || text, collectMacros(text), 0);
    var macros = collectMacros(text);
    var out = String(text);
    blocks.forEach(function (b) {
      var type = (b.meta.type || guessType(b.body) || 'html').toLowerCase();
      var body = expandMacros(b.body, macros, 0);
      var html;
      var r = renderers[type];
      if (r && _iframeCount < MAX_IFRAMES_PER_MSG) {
        try { html = r.render(body, b.meta, depth); }
        catch (e) { html = '<p style="color:#f66">[zfrich 渲染失败: ' + esc(e.message) + ']</p>'; }
      } else if (!r) {
        html = '<p style="opacity:.6">[未知 zfrich 类型: ' + esc(type) + ']</p>';
      } else {
        html = '<p style="opacity:.6">[zfrich 组件数量超限，已降级为源码]</p><pre>' + esc(body) + '</pre>';
      }
      html = wrapAnim(html, b.meta);
      out = out.replace(b.raw, html);
    });
    return out;
  }
  function stripMacros(text) {
    return String(text || '').replace(/:::macro\s+\S+\s*\n[\s\S]*?\n:::/g, '');
  }
  function guessType(body) {
    var t = body.trim();
    // 嵌套围栏头可直接推断类型：:::chart / :::timeline / :::tabs / :::ppt / :::chat
    var nested = t.match(/^:::(chart|timeline|tabs|ppt|chat)\b/);
    if (nested) return nested[1];
    if (/^#|\|\s*---/.test(t)) return 'table';
    if (/^<video|\.mp4|\.webm/.test(t)) return 'video';
    if (/^<style|@keyframes/.test(t)) return 'css';
    if (/^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)/i.test(t)) return 'image';
    return null;
  }

  /* ---------------- 对外 API：占位符方案 ---------------- */
  var _seq = 0;
  var _store = {}; // pid -> 原文
  var _chatStore = {}; // cpid -> chatBlocks（extract 阶段暂存）
  var _chatSrc = {};   // zfrich pid -> {src, blocks, pid} 混合场景
  var _chatSrcSrc = {}; // cpid -> 原文
  var _chatOnly = {};  // 仅 chat 场景 pid -> {src, blocks}

  // 在 marked 前调用：抽出 zfrich 块，返回 { text: 替换后的文本, extract: 还原函数 }
  function extract(text) {
    _iframeCount = 0;
    // 全文宏展开（含参数化 {{name(a=1)}}），并剥离 :::macro 定义块，围栏内外均生效
    var macros = collectMacros(text);
    if (Object.keys(macros).length) {
      text = stripMacros(expandMacros(text, macros, 0));
    }
    // :::chat 块先抽占位（防 marked 破坏其内部 zfrich 围栏）
    var chatBlocks = parseChatBlocks(text);
    var chatStore = {};
    if (chatBlocks.length) {
      var cpid = 'ZFCHATPID' + (++_seq) + 'X';
      chatStore[cpid] = text;
      _chatStore[cpid] = chatBlocks;
      _chatSrcSrc[cpid] = chatStore[cpid];
      var tout = String(text);
      chatBlocks.forEach(function (cb, i) {
        tout = tout.replace(cb.raw, '\n\n' + cpid + (i > 0 ? 'R' + i : '') + '\n\n');
      });
      text = tout;
    }
    var blocks = parseFences(text);
    if (!blocks.length) {
      if (!chatBlocks.length) return null;
      var pidOnly = 'ZFCHATONLY' + (++_seq) + 'X';
      _chatOnly[pidOnly] = { src: chatStore[cpid], blocks: chatBlocks };
      var t2 = String(text).replace(/ZFCHATPID\d+X(?:R\d+)?/g, pidOnly);
      return { text: t2, pid: pidOnly };
    }
    var pid = 'ZFRICHPID' + (++_seq) + 'X';
    _store[pid] = text;
    _chatSrc[pid] = { src: chatStore[cpid], blocks: chatBlocks, pid: cpid };
    var out = String(text);
    blocks.forEach(function (b, i) {
      out = out.replace(b.raw, '\n\n' + pid + (i > 0 ? 'R' + i : '') + '\n\n');
    });
    return { text: out, pid: pid };
  }
  // 在 marked 后调用：把占位段落还原为渲染好的组件
  function restore(html) {
    return html.replace(/<p>\s*(ZFRICHPID\d+X(?:R\d+)?|ZFCHATPID\d+X(?:R\d+)?|ZFCHATONLY\d+X)\s*<\/p>/g, function (m, key) {
      // 仅 chat 场景（无 zfrich 围栏）
      if (/^ZFCHATONLY/.test(key)) {
        var co = _chatOnly[key.replace(/R\d+$/, '')];
        if (!co) return m;
        delete _chatOnly[key.replace(/R\d+$/, '')];
        var cbs = co.blocks, ci = /R(\d+)$/.test(key) ? parseInt(key.match(/R(\d+)$/)[1], 10) : 0;
        var cb0 = cbs[ci]; if (!cb0) return m;
        try { return renderChat(expandMacros(cb0.body, collectMacros(co.src), 0), cb0.meta, 0); }
        catch (e) { return '<p style="color:#f66">[chat 渲染失败: ' + esc(e.message) + ']</p>'; }
      }
      // 混合场景：chat 占位（ZFCHATPID...）尚未渲染时直接还原为 chat HTML
      if (/^ZFCHATPID/.test(key) && !_store[key.replace(/R\d+$/, '')]) {
        var ck = key.replace(/R\d+$/, '');
        var cs = _chatStore[ck] && { src: _chatSrcSrc[ck], blocks: _chatStore[ck], pid: ck };
        if (!cs) return m;
        var cidx = /R(\d+)$/.test(key) ? parseInt(key.match(/R(\d+)$/)[1], 10) : 0;
        var cbb = cs.blocks[cidx]; if (!cbb) return m;
        try { return renderChat(expandMacros(cbb.body, collectMacros(cs.src), 0), cbb.meta, 0); }
        catch (e) { return '<p style="color:#f66">[chat 渲染失败: ' + esc(e.message) + ']</p>'; }
      }
      var base = key.replace(/R\d+$/, '');
      var src = _store[base];
      if (!src) return m;
      // 混合场景里内嵌的 chat 占位 → 先还原为 chat HTML
      var chatInfo = _chatSrc[base];
      if (chatInfo) {
        delete _chatSrc[base];
        if (chatInfo.blocks && chatInfo.blocks.length && chatInfo.src) {
          html = html; // chat 占位已在下方 src 处理中还原
          src = chatInfo.src;
        }
      }
      // 找到该 key 对应的块
      var blocks = parseFences(src);
      var idx = /R(\d+)$/.test(key) ? parseInt(key.match(/R(\d+)$/)[1], 10) : 0;
      var b = blocks[idx];
      if (!b) return m;
      var type = (b.meta.type || guessType(b.body) || 'html').toLowerCase();
      var macros = collectMacros(src);
      var body = expandMacros(b.body, macros, 0);
      var r = renderers[type];
      if (!r) return '<p>[未知 zfrich 类型: ' + esc(type) + ']</p>';
      try {
        var outHtml = wrapAnim(r.render(body, b.meta, 0), b.meta);
        // 所有兄弟占位块都处理完后再清理 _store（修：一次性删除导致 R1~R3 还原失败）
        var anySibling = /ZFRICHPID\d+XR?\d*/.test(html.replace(m, ''));
        if (!anySibling) delete _store[base];
        return outHtml;
      }
      catch (e) { return '<p style="color:#f66">[zfrich 渲染失败: ' + esc(e.message) + ']</p>'; }
    });
  }

  window.ZFRich = {
    extract: extract,
    restore: restore,
    renderers: renderers,
    version: '2.1'
  };
})();
