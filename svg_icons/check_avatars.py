# -*- coding: utf-8 -*-
import io, json, re, sys, traceback
out = io.open("svg_icons/_chk.out", "w", encoding="utf-8")
try:
    src = io.open("public/js/icons.js", encoding="utf-8").read()
    i = src.index("var MAP =")
    out.write("start at %d, ctx=%r\n" % (i, src[i:i+30]))
    line_end = src.index("\n", i)
    seg = src[i+len("var MAP ="):line_end].strip().rstrip(";")
    data = json.loads(seg)
    out.write("icons: %d\n" % len(data))
    rsrc = io.open("public/js/chatbox-roles.js", encoding="utf-8").read()
    a = rsrc.index("AVATAR_LIST")
    b = rsrc.index(".split", a)
    avatars = [e for p in re.findall(r"'([^']*)'", rsrc[a:b]) for e in p.split() if e]
    out.write("avatars: %d -> %s\n" % (len(avatars), " ".join(avatars)))
    norm = lambda e: e.replace("\ufe0f", "")
    nmap = {norm(k): k for k in data}
    missing = [x for x in avatars if x not in data and norm(x) not in nmap]
    out.write("missing: %s\n" % (",".join(missing) if missing else "(none)"))
except Exception:
    out.write(traceback.format_exc())
out.close()
print("done")
