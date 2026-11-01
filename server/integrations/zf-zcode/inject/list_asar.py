import struct, json
d = open(r'C:\Program Files\ZCode\resources\app.asar', 'rb').read()
hl, hsize = struct.unpack('<II', d[4:12])
raw = d[16:16+hl]
s = raw.decode('utf-8', 'ignore')
s = s[: s.rindex('}') + 1]
hdr = json.loads(s)
def walk(node, p=''):
    if 'files' in node:
        for k, v in node['files'].items():
            walk(v, p + '/' + k)
    else:
        if p.endswith(('.html', '.js', '.css')) and node.get('size', 0) < 300000:
            print(p)
walk(hdr)
