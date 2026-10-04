# -*- coding: utf-8 -*-
"""从 gen_color_icons.py 提取图标定义，生成 public/js/icons.js（全局 emoji→SVG 替换器）"""
import ast, io, os, re, json, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extra_icons import EXTRA
from extra2_icons import A as EXTRA2
from extra2b_icons import B as EXTRA2B
from extra3_icons import build as build_extra3, fill_missing

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "svg_icons", "gen_color_icons.py")
OUT = os.path.join(ROOT, "public", "js", "icons.js")

src = io.open(SRC, encoding="utf-8").read()
tree = ast.parse(src)
grads = icons = None
for node in tree.body:
    if isinstance(node, ast.Assign):
        for t in node.targets:
            if getattr(t, "id", "") == "GRADS":
                grads = ast.literal_eval(node.value)
            if getattr(t, "id", "") == "ICONS":
                icons = ast.literal_eval(node.value)
assert grads and icons, "未找到 GRADS/ICONS 定义"

# 每个图标 -> 完整独立 svg 字符串（内嵌自己的渐变，避免 id 冲突直接每个都带 defs，用 name 命名 id）
# 为控制体积：渐变 defs 只保留被用到的，且按图标内嵌并重命名 id
def build_svg(name, body):
    used = set(re.findall(r'url\(#(g\w+)\)', body))
    defs = ""
    if used:
        parts = []
        for gid in used:
            m = re.search(r'<linearGradient id="%s".*?</linearGradient>' % gid, grads, re.S)
            if m:
                parts.append(m.group(0))
        defs = "<defs>%s</defs>" % "".join(parts)
    return '<svg class="zf-svg" viewBox="1 1 22 22" width="1.18em" height="1.18em" style="vertical-align:-0.22em" aria-hidden="true">%s%s</svg>' % (defs, body)

mapping = {}
for name, emoji, _grad, body in icons:
    if emoji and emoji not in ("", None):
        mapping[emoji] = build_svg(name, body)

# 合并补充图标（更多菜单等），不覆盖已有
for k, v in EXTRA.items():
    mapping.setdefault(k, build_svg("x" + hex(ord(k[0]))[2:], v))
for k, v in list(EXTRA2.items()) + list(EXTRA2B.items()):
    mapping.setdefault(k, build_svg("x" + hex(ord(k[0]))[2:], v))
# 第三批：箭头/星形/天气/角色脸/功能符号（extra3 内部直接给完整 body，build_svg 按 url(#gX...) 提取 defs）
for k, v in build_extra3().items():
    mapping.setdefault(k, build_svg("x" + hex(ord(k[0]))[2:], v))
# 兜底：扫描 public 下仍未覆盖的 emoji，用彩色徽章补齐，争取全量替换
try:
    _emoji_pat = re.compile(u"[\\U0001F300-\\U0001FAFF\\u2600-\\u27BF\\u2B00-\\u2BFF\\u2900-\\u297F]")
    _seen = set()
    for _root, _dirs, _fs in os.walk(os.path.join(ROOT, "public")):
        if "__pycache__" in _root:
            continue
        for _f in _fs:
            if not (_f.endswith(".js") or _f.endswith(".html")) or _f.startswith("_"):
                continue
            try:
                _t = io.open(os.path.join(_root, _f), encoding="utf-8").read()
            except Exception:
                continue
            for _m in _emoji_pat.finditer(_t):
                _seen.add(_m.group(0))
    _before = len(mapping)
    mapping = fill_missing(mapping, sorted(_seen))
    print("badge fallback:", len(mapping) - _before, "of", len(_seen), "scanned")
except Exception as _e:
    print("scan fallback skipped:", _e)

# 修复：兜底徽章/补充 body 可能是裸 SVG 片段（无 <svg> 包裹），浏览器会整块丢弃导致图标不显示
# （放在 try 外：即使上游扫描异常，也保证所有值都被完整包裹，坏值不再漏网）
_SVG_OPEN = '<svg class="zf-svg" viewBox="1 1 22 22" width="1.18em" height="1.18em" style="vertical-align:-0.22em" aria-hidden="true">'
_fixed = 0
for _k in list(mapping):
    if not mapping[_k].startswith("<svg"):
        mapping[_k] = _SVG_OPEN + mapping[_k] + "</svg>"
        _fixed += 1
if _fixed:
    print("wrapped raw svg bodies:", _fixed)

# HAL 9000 头像（用户指定默认角色 🎭 使用《2001太空漫游》HAL 9000 形象）
mapping[chr(0x1F3AD)] = "<svg class='zf-svg' viewBox='1 1 22 22' width='1.18em' height='1.18em' style='vertical-align:-0.22em' aria-hidden='true'><defs><linearGradient id='gHAL_X9001' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#4A4A52'/><stop offset='1' stop-color='#141418'/></linearGradient><radialGradient id='gHALEye_X9001'><stop offset='0' stop-color='#FFD0C8'/><stop offset='0.35' stop-color='#FF3B23'/><stop offset='1' stop-color='#8E0F04'/></radialGradient></defs><rect x='3' y='5.5' width='18' height='13' rx='3.2' fill='url(#gHAL_X9001)' stroke='#000' stroke-opacity='.5' stroke-width='.6'/><rect x='4.2' y='6.6' width='15.6' height='1.6' rx='0.8' fill='#fff' opacity='.12'/><circle cx='12' cy='12.4' r='4.6' fill='url(#gHALEye_X9001)'/><circle cx='12' cy='12.4' r='5.4' fill='none' stroke='#FF5A40' stroke-opacity='.4' stroke-width='.9'/><circle cx='10.4' cy='10.8' r='1.1' fill='#fff' opacity='.75'/></svg>"

# 变体别名（双向）：
# A) 带 VS16 的键 → 补不带 VS16 的形式
extra = {}
for k in list(mapping):
    base = k.replace("\ufe0f", "")
    if base != k and base not in mapping:
        extra[base] = mapping[k]
# B) 纯 emoji（不含 VS16）的键 → 补 emoji+VS16 形式（页面源码常写成 🐶️，若只替换本体，
#    残留的 VS16 会被浏览器渲染成红色 tofu 方块，出现"图标旁边跟一个小方块"）
VS16 = "\ufe0f"
for k in list(mapping):
    if VS16 not in k and len(k) <= 2 and any(ord(c) > 0x2000 for c in k):
        kv = k + VS16
        if kv not in mapping and k in mapping:
            extra[kv] = mapping[k]
mapping.update(extra)

data = json.dumps(mapping, ensure_ascii=False, separators=(",", ":"))

js = u"""/* 全局 emoji→SVG 图标替换器（自动生成，勿手改；重跑 svg_icons/build_icons_js.py 重新生成） */
(function () {
  var MAP = %s;
  var UID = 0;
  var KEYS = Object.keys(MAP).sort(function (a, b) { return b.length - a.length; });
  // 合并正则（长键优先）
  var RE = new RegExp(KEYS.map(function (k) {
    return k.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
  }).join("|"), "g");

  function replaceInText(node) {
    var text = node.nodeValue;
    if (!text || !/[^\\x00-\\x7F]/.test(text)) return;
    RE.lastIndex = 0;
    if (!RE.test(text)) return;
    RE.lastIndex = 0;
    var html = text.replace(RE, function (m) { return MAP[m] || m; });
    // 渐变 id 唯一化：同一图标多次注入会产生重复 id，url(#id) 只认文档第一个实例，
    // 若该实例在 display:none 容器内会导致后续所有引用此渐变的图标渲染空白
    if (html.indexOf("url(#") !== -1) {
      var ren = {};
      html = html.replace(/id="([^"]+)"/g, function (_, id) {
        var nid = id + "_u" + (++UID);
        ren[id] = nid;
        return 'id="' + nid + '"';
      }).replace(/url\\(#([^)]+)\\)/g, function (_, id) {
        return "url(#" + (ren[id] || id) + ")";
      });
    }
    var span = document.createElement("span");
    span.className = "zf-icons";
    span.innerHTML = html;
    node.parentNode.replaceChild(span, node);
  }

  function walk(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        if (!p || p.nodeName === "SCRIPT" || p.nodeName === "STYLE" || p.nodeName === "TEXTAREA") return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(replaceInText);
  }

  function start() {
    walk(document.body);
    var mo = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType === 3) replaceInText(n);
          else if (n.nodeType === 1 && !n.classList.contains("zf-icons")) walk(n);
        });
        if (m.type === "characterData" && m.target.nodeType === 3) replaceInText(m.target);
      });
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
""" % data

io.open(OUT, "w", encoding="utf-8").write(js)

# 渐变 id 唯一化（与 svg_icons/fix_gradient_ids.py 同逻辑）：
# 多个图标共用 id="gGold" 等会导致 url(#gGold) 全部指向文档中第一个该 id，
# 若那个图标所在节点被隐藏/移除，其余图标渐变填充失效（图标只剩一半）。
import re as _re
_pair = _re.compile(r'("(?:[^"\\]|\\.)*"\s*:\s*")(<svg.*?</svg>)(")', _re.S)
_id_re = _re.compile(r'id=\\"([^"\\]+)\\"')

def _uniq(m):
    key_raw, svg, tail = m.group(1), m.group(2), m.group(3)
    # 后缀取 key 原文中的字母数字（如 \ud83d\udcc1 → ud83udcc1），不做 unicode_escape（会损坏非 BMP）
    suffix = ''.join(c for c in key_raw if c.isalnum()) or ('X%d' % (abs(hash(key_raw)) % 100000))
    for i in set(_id_re.findall(svg)):
        svg = svg.replace('id=\\"%s\\"' % i, 'id=\\"%s_%s\\"' % (i, suffix))
        svg = svg.replace("url(#%s)" % i, "url(#%s_%s)" % (i, suffix))
        svg = svg.replace('href=\\"#%s\\"' % i, 'href=\\"#%s_%s\\"' % (i, suffix))
    return key_raw + svg + tail

js2, _n = _pair.subn(_uniq, js)
io.open(OUT, "w", encoding="utf-8").write(js2)
print("uniq gradient ids:", _n)
print("OK", OUT, len(js2), "bytes,", len(mapping), "icons")
