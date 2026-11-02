# -*- coding: utf-8 -*-
"""W3【P1】: H3 武戏合并工作流 UI->API 转换器，支持 SetNode/GetNode/Reroute 解析。
用法: python h3_ui2api.py <ui_workflow.json> <out_api.json> [comfy_url]
   comfy_url 可选（默认 http://127.0.0.1:8188），用于 object_info 对齐 widget 顺序；不可达时退化为位置映射。
"""
import json, sys, urllib.request

SKIP_TYPES = {'MarkdownNote','Note','Reroute','PrimitiveNode','SetNode','GetNode',
              'FastGroupsMuter','FastGroupsBypasser','忽略多组孤海'}

def node_inputs(t, base, cache):
    if t in cache: return cache[t]
    try:
        with urllib.request.urlopen(base + '/object_info/' + t, timeout=5) as r:
            cache[t] = json.load(r)[t]['input']
    except Exception as e:
        print('  [warn] object_info 不可用(%s): %s，widget 按位置映射' % (t, e))
        cache[t] = None
    return cache[t]

def convert(wf, base='http://127.0.0.1:8188'):
    nodes = {n['id']: n for n in wf.get('nodes', [])}
    link_map = {}
    for l in wf.get('links', []):
        if l: link_map[(l[3], l[4])] = (str(l[1]), l[2])
    # inputs 里也可能有带编号的 link（comfy 新格式）: node.inputs[i].link = link_id
    link_by_id = {l[0]: (str(l[1]), l[2], l[3], l[4]) for l in wf.get('links', []) if l}

    set_defs = {}
    for nid, n in nodes.items():
        if n.get('type') == 'SetNode':
            name = (n.get('widgets_values') or [''])[0]
            set_defs[name] = nid

    def incoming(node_id, slot):
        """该节点第 slot 个输入的来源；SetNode 的值在它的 inputs[0] link 上"""
        n = nodes.get(node_id)
        if n is None: return None
        for i in (n.get('inputs') or []):
            lk = i.get('link')
            if lk is not None and lk in link_by_id:
                f, fs, tn, ts = link_by_id[lk]
                if ts == slot: return (f, fs)
        return link_map.get((node_id, slot))

    def resolve(node_id, slot, seen=None):
        """沿 Reroute/GetNode 穿透，返回真实 (node_str, slot)"""
        if seen is None: seen = set()
        key = (node_id, slot)
        if key in seen: return None
        seen.add(key)
        n = nodes.get(node_id)
        if n is None: return None
        t = n.get('type')
        if t == 'Reroute':
            src = incoming(node_id, 0)
            if src is None: return None
            return resolve(src[0], src[1], seen)
        if t == 'GetNode':
            name = (n.get('widgets_values') or [''])[0]
            setter = set_defs.get(name)
            if setter is None: return None
            src = incoming(setter, 0)
            if src is None: return None
            return resolve(src[0], src[1], seen)
        return (str(node_id), slot)

    cache = {}
    out = {}
    skipped, warned = [], []
    for nid, n in nodes.items():
        t = n.get('type')
        if t in SKIP_TYPES: skipped.append(t); continue
        info = node_inputs(t, base, cache)
        inputs = {}
        # 连接输入：object_info 顺序
        if info:
            slot_i = 0
            for sec in ('required', 'optional'):
                for name, spec in (info.get(sec) or {}).items():
                    if isinstance(spec, (list, tuple)) and spec and isinstance(spec[0], str) and spec[0].isupper():
                        src = incoming(nid, slot_i)
                        if src is not None:
                            r = resolve(*src)
                            if r: inputs[name] = list(r)
                        slot_i += 1
            # widget 值
            wn = n.get('widgets_values_named')
            if isinstance(wn, dict):
                for k, v in wn.items():
                    if v is not None: inputs[k] = v
            else:
                names = []
                for sec in ('required', 'optional'):
                    for name, spec in (info.get(sec) or {}).items():
                        if isinstance(spec, (list, tuple)) and spec and isinstance(spec[0], str) and spec[0].isupper():
                            continue
                        names.append(name)
                wvals = n.get('widgets_values')
                if isinstance(wvals, list):
                    for i, v in enumerate(wvals):
                        if i < len(names) and v is not None:
                            inputs.setdefault(names[i], v)
        else:
            warned.append('%s:%s' % (nid, t))
            wvals = n.get('widgets_values')
            if isinstance(wvals, list):
                for i, v in enumerate(wvals):
                    if v is not None: inputs['w%d' % i] = v
        out[str(nid)] = {'class_type': t, 'inputs': inputs, '_meta': {'title': n.get('title', t)}}
    return out, skipped, warned

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    src, dst = sys.argv[1], sys.argv[2]
    base = sys.argv[3] if len(sys.argv) > 3 else 'http://127.0.0.1:8188'
    wf = json.load(open(src, encoding='utf-8'))
    out, skipped, warned = convert(wf, base)
    json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('OK %s -> %s, nodes=%d, skipped=%d, offline_warn=%s' % (src, dst, len(out), len(skipped), set(warned) or '无'))
    # 体检：列出仍为空的 LoadImage/widget
    bad = [(k, v['class_type']) for k, v in out.items() if v['class_type'] in ('LoadImage','VHS_LoadVideo') and not v['inputs'].get('image') and not v['inputs'].get('video')]
    print('Load 视频图节点空输入检查:', bad or '全部有值')
